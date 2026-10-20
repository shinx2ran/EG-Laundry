import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SupabaseRepo, translateDbError } from './supabaseRepo'
import { DELETE_DENIED_MESSAGE, IN_USE_MESSAGE, ORDER_NUMBER_TAKEN_MESSAGE, UPDATE_DENIED_MESSAGE } from './types'

type Result = { data: unknown; error: { message: string; code?: string; details?: string } | null }

/** Minimal stand-in for the PostgREST query builder: records the calls, answers with `result`. */
function fakeClient(result: Result) {
  const calls: unknown[][] = []
  const answer = () => Object.assign(Promise.resolve(result), { single: () => Promise.resolve(result) })
  const builder = {
    delete: (...args: unknown[]) => (calls.push(['delete', ...args]), builder),
    update: (...args: unknown[]) => (calls.push(['update', ...args]), builder),
    eq: (...args: unknown[]) => (calls.push(['eq', ...args]), builder),
    select: (...args: unknown[]) => (calls.push(['select', ...args]), answer()),
  }
  const sb = { from: (table: string) => (calls.push(['from', table]), builder) }
  return { repo: new SupabaseRepo(sb as unknown as SupabaseClient), calls }
}

// What PostgreSQL returns when a delete hits ON DELETE RESTRICT (replayed against the real schema).
const fk = (table: string, constraint: string, child: string) => ({
  code: '23503',
  message: `update or delete on table "${table}" violates foreign key constraint "${constraint}" on table "${child}"`,
  details: `Key (org_id, id)=(00000000-0000-0000-0000-000000000001, 00000000-0000-0000-0000-000000000002) is still referenced from table "${child}".`,
})

describe('translateDbError', () => {
  it('a duplicate order number (two phones at once) tells the caller to retry', () => {
    const dup = { code: '23505', message: 'duplicate key value violates unique constraint "orders_org_id_order_number_key"', details: 'Key (org_id, order_number)=(..., LD-202610-0007) already exists.' }
    expect(translateDbError(dup)).toBe(ORDER_NUMBER_TAKEN_MESSAGE)
    expect(translateDbError(dup.message)).toBe(ORDER_NUMBER_TAKEN_MESSAGE)
    // other unique violations keep their text
    const other = { code: '23505', message: 'duplicate key value violates unique constraint "organization_members_org_id_user_id_key"' }
    expect(translateDbError(other)).toBe(other.message)
  })

  it('a delete refused because the row is still in use is Indonesian', () => {
    for (const e of [
      fk('customers', 'orders_org_id_customer_id_fkey', 'orders'),
      fk('customers', 'customer_packages_org_id_customer_id_fkey', 'customer_packages'),
      fk('services', 'package_catalog_org_id_service_id_fkey', 'package_catalog'),
      fk('customer_packages', 'order_items_org_id_customer_package_id_fkey', 'order_items'),
    ]) {
      expect(translateDbError(e)).toBe(IN_USE_MESSAGE)
      // callers that only kept the message text
      expect(translateDbError(e.message)).toBe(IN_USE_MESSAGE)
    }
  })

  it('leaves other errors as they were', () => {
    // a missing parent on insert is a different problem, not "still in use"
    const insertFk = { code: '23503', message: 'insert or update on table "orders" violates foreign key constraint "orders_org_id_customer_id_fkey"', details: 'Key (...) is not present in table "customers".' }
    expect(translateDbError(insertFk)).toBe(insertFk.message)
    expect(translateDbError({ code: '42501', message: 'new row violates row-level security policy for table "payments"' })).toBe('Anda tidak memiliki izin untuk tindakan ini.')
    expect(translateDbError('TypeError: Failed to fetch')).toBe('Tidak dapat terhubung ke server. Periksa koneksi internet.')
    expect(translateDbError({ code: 'P0001', message: 'Hanya pemilik/admin yang dapat membuat kode undangan.' })).toBe('Hanya pemilik/admin yang dapat membuat kode undangan.')
  })
})

describe('SupabaseRepo.remove', () => {
  it('asks for the deleted ids, scoped to the organisation', async () => {
    const { repo, calls } = fakeClient({ data: [{ id: 'x' }], error: null })
    await expect(repo.remove('invitations', 'x', 'org-1')).resolves.toBeUndefined()
    expect(calls).toEqual([['from', 'invitations'], ['delete'], ['eq', 'id', 'x'], ['eq', 'org_id', 'org-1'], ['select', 'id']])
  })

  it('0 rows deleted (RLS, e.g. a demoted admin, or already gone) is an error, not a success', async () => {
    const { repo } = fakeClient({ data: [], error: null })
    await expect(repo.remove('invitations', 'x', 'org-1')).rejects.toThrow(DELETE_DENIED_MESSAGE)
  })

  it('a row still in use gives the Indonesian message', async () => {
    const { repo } = fakeClient({ data: null, error: fk('customers', 'orders_org_id_customer_id_fkey', 'orders') })
    await expect(repo.remove('invitations', 'x', 'org-1')).rejects.toThrow(IN_USE_MESSAGE)
  })
})

describe('SupabaseRepo.update', () => {
  it('PGRST116 (no row came back: RLS or gone) is Indonesian', async () => {
    const { repo } = fakeClient({ data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'The result contains 0 rows' } })
    await expect(repo.update('invitations', 'x', { label: 'x' }, 'org-1')).rejects.toThrow(UPDATE_DENIED_MESSAGE)
  })

  it('a trigger message passes through', async () => {
    const { repo } = fakeClient({ data: null, error: { code: 'P0001', message: 'Data tidak dapat dipindah ke organisasi lain.' } })
    await expect(repo.update('invitations', 'x', { label: 'x' }, 'org-1')).rejects.toThrow('Data tidak dapat dipindah ke organisasi lain.')
  })
})

describe('SupabaseRepo.list paging', () => {
  /** A table read newest first, 1000 rows per page; `between` runs after the first page (another phone writes). */
  function pagedClient(rows: { id: string }[], between: (rows: { id: string }[]) => void) {
    const ranges: [number, number][] = []
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: (from: number, to: number) => {
        ranges.push([from, to])
        const page = rows.slice(from, to + 1)
        if (ranges.length === 1) between(rows)
        return Promise.resolve({ data: page, error: null })
      },
    }
    const sb = { from: () => builder }
    return { repo: new SupabaseRepo(sb as unknown as SupabaseClient), ranges }
  }

  it('a payment recorded on another phone between two pages is not counted twice', async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `p${String(1500 - i).padStart(4, '0')}` }))
    // the new payment is the newest: every older row moves one place down, p0501 comes again on page 2
    const { repo, ranges } = pagedClient(rows, (r) => r.unshift({ id: 'p1501' }))
    const listed = await repo.list('payments')
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ])
    expect(listed).toHaveLength(1500)
    expect(new Set(listed.map((r) => r.id)).size).toBe(1500)
  })
})
