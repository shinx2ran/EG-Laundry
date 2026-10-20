// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import fixtureText from './__fixtures__/woombad-backup.json?raw'
import type { MemberRole } from '../../types/db'
import { LocalRepo } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import { buildDemoDb, DEMO_ORG_ID } from '../../lib/repo/demoSeed'
import { parseWoombadBackup, planTenantImport } from './tenantImport'
import { applyTenantImport, TenantImportError } from './applyTenantImport'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: DEMO_ORG_ID, name: 'EG Laundry (Demo)' }, repo: state.repo, role: state.role, isAdmin: state.role !== 'staff', isLocalMode: true }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { STAFF_TENANT_IMPORT_MESSAGE, useTenantImport } from './useTenantImport'

let repo: OrgRepo
const backup = parseWoombadBackup(fixtureText)
// the fixture's leases are all in 2025, so any later day gives the same plan; the hook plans for today
const TODAY = '2026-10-20'

function seed(role: MemberRole = 'owner') {
  repo = bindOrg(new LocalRepo(buildDemoDb(new Date(2026, 9, 20))), DEMO_ORG_ID)
  state.repo = repo
  state.role = role
}

const customerByName = async (name: string) => (await repo.list('customers')).find((c) => c.name === name)

beforeEach(() => invalidate.mockClear())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('applyTenantImport', () => {
  it('writes updates, new customers and deactivations through the repo', async () => {
    seed()
    const plan = planTenantImport(backup, await repo.list('customers'), { today: TODAY })
    expect(await applyTenantImport(repo, plan)).toEqual({ update: 2, create: 3, deactivate: 1 })

    expect(await customerByName('Sari Dewi')).toMatchObject({ is_tenant: true, room_name: 'B2', kos_tenant_id: '00000000-0000-4000-8000-000000000102', phone: '0812-0000-0003' })
    expect(await customerByName('Fajar Nugroho')).toMatchObject({ org_id: DEMO_ORG_ID, is_tenant: true, room_name: 'D4', phone: '0812-0000-0101', kos_tenant_id: '00000000-0000-4000-8000-000000000101' })
    expect(await customerByName('Putri Ayu')).toMatchObject({ is_tenant: true, room_name: 'C1', phone: null })
    expect(await customerByName('Yoga Pratama')).toMatchObject({ is_tenant: false, room_name: null, kos_tenant_id: '00000000-0000-4000-8000-000000000103' })

    // a second run finds everything in place
    const again = planTenantImport(backup, await repo.list('customers'), { today: TODAY })
    expect(again.counts).toMatchObject({ update: 0, create: 0, deactivate: 0, unchanged: 5 })
  })

  it('stops at the first error and says what was already saved', async () => {
    seed()
    const plan = planTenantImport(backup, await repo.list('customers'), { today: TODAY })
    const writes: string[] = []
    const failing = {
      update: vi.fn(async (_t: 'customers', id: string) => {
        writes.push(id)
        if (writes.length === 2) throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.')
        return {} as never
      }),
      insertMany: vi.fn(async () => []),
    }
    const err = await applyTenantImport(failing as never, plan).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TenantImportError)
    expect((err as TenantImportError).message).toBe(
      'Impor berhenti: Tidak dapat terhubung ke server. Periksa koneksi internet. Sudah tersimpan: 1 diperbarui, 0 baru, 0 dinonaktifkan.',
    )
    expect((err as TenantImportError).done).toEqual({ update: 1, create: 0, deactivate: 0 })
    expect(failing.insertMany).not.toHaveBeenCalled()

    const first = await applyTenantImport({ update: vi.fn(async () => Promise.reject(new Error('Anda tidak memiliki izin untuk tindakan ini.'))), insertMany: vi.fn() } as never, plan).catch(
      (e: unknown) => (e as Error).message,
    )
    expect(first).toBe('Impor berhenti: Anda tidak memiliki izin untuk tindakan ini. Belum ada perubahan yang tersimpan.')
  })
})

describe('useTenantImport (SPEC 3.10: owner/admin only)', () => {
  it('staff is refused before anything is read or written', async () => {
    seed('staff')
    const list = vi.spyOn(repo, 'list')
    const { result } = renderHook(() => useTenantImport())
    expect(result.current.canImport).toBe(false)
    await expect(result.current.importTenants(backup, {})).rejects.toThrow(STAFF_TENANT_IMPORT_MESSAGE)
    expect(list).not.toHaveBeenCalled()
    expect((await repo.list('customers')).filter((c) => c.is_tenant)).toHaveLength(5)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('an admin imports with the options and the customers list is refreshed', async () => {
    seed('admin')
    const { result } = renderHook(() => useTenantImport())
    expect(result.current.canImport).toBe(true)
    const done = await result.current.importTenants(backup, { createMissing: false, deactivateEnded: false })
    expect(done).toEqual({ update: 2, create: 0, deactivate: 0 })
    expect(await customerByName('Fajar Nugroho')).toBeUndefined()
    expect(await customerByName('Yoga Pratama')).toMatchObject({ is_tenant: true, room_name: 'B3' })
    expect(invalidate).toHaveBeenCalledWith('customers')
  })
})
