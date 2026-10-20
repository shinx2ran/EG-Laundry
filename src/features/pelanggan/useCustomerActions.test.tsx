// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { Customer, MemberRole } from '../../types/db'
import { LocalRepo } from '../../lib/repo/localRepo'
import { IN_USE_MESSAGE, bindOrg, type OrgRepo } from '../../lib/repo/types'
import { buildDemoDb, DEMO_CATALOG_ID, DEMO_ORG_ID, DEMO_SERVICE_ID } from '../../lib/repo/demoSeed'
import { EMPTY_CUSTOMER_FORM, ERR_NAME_REQUIRED, ERR_PACKAGE_INACTIVE, ERR_PHONE_INVALID } from './customerUtils'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: DEMO_ORG_ID, name: 'EG Laundry (Demo)' }, repo: state.repo, role: state.role, isAdmin: state.role !== 'staff', isLocalMode: true }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { CATALOG_MISSING_MESSAGE, STAFF_DELETE_CUSTOMER_MESSAGE, useCustomerActions } from './useCustomerActions'

let local: LocalRepo
let repo: OrgRepo

function seed(role: MemberRole = 'owner') {
  local = new LocalRepo(buildDemoDb(new Date(2026, 9, 19)))
  repo = bindOrg(local, DEMO_ORG_ID)
  state.repo = repo
  state.role = role
}

function actions() {
  return renderHook(() => useCustomerActions()).result.current
}

const byId = async (id: string) => repo.get('customers', id)

beforeEach(() => invalidate.mockClear())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('createCustomer / updateCustomer', () => {
  it('staff adds a customer with the name only; the phone stays as typed, the walk-in has no room', async () => {
    seed('staff')
    const saved = await actions().createCustomer({ ...EMPTY_CUSTOMER_FORM, name: ' Tanpa Nomor ', room_name: 'B9' })
    expect(saved).toMatchObject({ org_id: DEMO_ORG_ID, name: 'Tanpa Nomor', phone: null, is_tenant: false, room_name: null, kos_tenant_id: null, address: null, notes: null })
    expect(await byId(saved.id)).toMatchObject({ name: 'Tanpa Nomor' })
    const withPhone = await actions().createCustomer({ ...EMPTY_CUSTOMER_FORM, name: 'Bu Ani', phone: '0812-3456-7890', is_tenant: true, room_name: 'C1' })
    expect(withPhone).toMatchObject({ phone: '0812-3456-7890', is_tenant: true, room_name: 'C1' })
    expect(invalidate).toHaveBeenCalledWith('customers')
  })

  it('an invalid form is refused before any write', async () => {
    seed()
    const before = (await repo.list('customers')).length
    await expect(actions().createCustomer({ ...EMPTY_CUSTOMER_FORM })).rejects.toThrow(ERR_NAME_REQUIRED)
    await expect(actions().createCustomer({ ...EMPTY_CUSTOMER_FORM, name: 'Mega', phone: '12' })).rejects.toThrow(ERR_PHONE_INVALID)
    expect((await repo.list('customers')).length).toBe(before)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('an update rewrites the form columns and leaves the Woombad import id alone', async () => {
    seed('staff')
    await repo.update('customers', 'demo-cust-11', { kos_tenant_id: 'kos-tenant-7' })
    const mega = (await byId('demo-cust-11')) as Customer
    const saved = await actions().updateCustomer(mega, { name: 'Mega Lestari', phone: '0812-0000-0011', is_tenant: true, room_name: 'D2', address: 'Jl. Mawar 3', notes: '' })
    expect(saved).toMatchObject({ id: 'demo-cust-11', name: 'Mega Lestari', phone: '0812-0000-0011', is_tenant: true, room_name: 'D2', address: 'Jl. Mawar 3', notes: null, kos_tenant_id: 'kos-tenant-7' })
    expect(invalidate).toHaveBeenCalledWith('customers')
    // switching the tenant flag off clears the room
    const back = await actions().updateCustomer(saved, { ...EMPTY_CUSTOMER_FORM, name: 'Mega Lestari', is_tenant: false, room_name: 'D2' })
    expect(back).toMatchObject({ is_tenant: false, room_name: null })
  })
})

describe('deleteCustomer (SPEC 3.10: owner/admin only)', () => {
  it('staff is refused before any write', async () => {
    seed('staff')
    const removes: string[] = []
    state.repo = {
      ...repo,
      remove: (async (table: string, id: string) => {
        removes.push(`${table}:${id}`)
        return repo.remove(table as 'customers', id)
      }) as OrgRepo['remove'],
    }
    await expect(actions().deleteCustomer({ id: 'demo-cust-11' })).rejects.toThrow(STAFF_DELETE_CUSTOMER_MESSAGE)
    expect(removes).toEqual([])
    expect(await byId('demo-cust-11')).not.toBeNull()
  })

  it('admin deletes a customer without orders; one with orders or packages is "masih dipakai"', async () => {
    seed('admin')
    const fresh = await actions().createCustomer({ ...EMPTY_CUSTOMER_FORM, name: 'Sekali Lewat' })
    await actions().deleteCustomer(fresh)
    expect(await byId(fresh.id)).toBeNull()
    expect(invalidate).toHaveBeenCalledWith('customers')
    // Rina has orders, Rudi has a package: FK restrict, like the database
    await expect(actions().deleteCustomer({ id: 'demo-cust-01' })).rejects.toThrow(IN_USE_MESSAGE)
    await expect(actions().deleteCustomer({ id: 'demo-cust-10' })).rejects.toThrow(IN_USE_MESSAGE)
    expect(await byId('demo-cust-01')).not.toBeNull()
    // refreshed after each refusal too (the row may be gone on another device): create, delete, 2 refusals
    expect(invalidate).toHaveBeenCalledTimes(4)
  })
})

describe('sellPackage (SPEC 3.4)', () => {
  it('staff sells a catalog package: a copy of name/service/qty/price with expires_at from valid_days', async () => {
    seed('staff')
    const catalog = (await repo.get('package_catalog', DEMO_CATALOG_ID))!
    const sold = await actions().sellPackage({ customer: { id: 'demo-cust-02' }, catalog, purchasedAt: '2026-10-19', method: 'qris', notes: ' ' })
    expect(sold).toMatchObject({
      org_id: DEMO_ORG_ID,
      customer_id: 'demo-cust-02',
      catalog_id: DEMO_CATALOG_ID,
      name: 'Paket 20 kg cuci setrika',
      service_id: DEMO_SERVICE_ID.cuciSetrika,
      qty_total: 20,
      price: 140_000,
      purchased_at: '2026-10-19',
      expires_at: '2026-12-18',
      method: 'qris',
      notes: null,
    })
    expect(await repo.get('customer_packages', sold.id)).not.toBeNull()
    expect(invalidate).toHaveBeenCalledWith('customer_packages', 'package_catalog')
  })

  it('copies the price the catalog has now, not the one this screen loaded with', async () => {
    seed()
    const stale = (await repo.get('package_catalog', DEMO_CATALOG_ID))!
    await repo.update('package_catalog', DEMO_CATALOG_ID, { price: 150_000, valid_days: null })
    const sold = await actions().sellPackage({ customer: { id: 'demo-cust-02' }, catalog: stale, purchasedAt: '2026-10-19', method: 'cash', notes: 'promo' })
    expect(sold).toMatchObject({ price: 150_000, expires_at: null, notes: 'promo' })
  })

  it('an inactive or deleted catalog entry and a bad date are refused before any write', async () => {
    seed()
    const catalog = (await repo.get('package_catalog', DEMO_CATALOG_ID))!
    const before = (await repo.list('customer_packages')).length
    await expect(actions().sellPackage({ customer: { id: 'demo-cust-02' }, catalog, purchasedAt: '2026-02-30', method: 'cash', notes: '' })).rejects.toThrow('Tanggal')
    await repo.update('package_catalog', DEMO_CATALOG_ID, { active: false })
    await expect(actions().sellPackage({ customer: { id: 'demo-cust-02' }, catalog, purchasedAt: '2026-10-19', method: 'cash', notes: '' })).rejects.toThrow(ERR_PACKAGE_INACTIVE)
    expect(invalidate).toHaveBeenCalledWith('package_catalog')
    await expect(actions().sellPackage({ customer: { id: 'demo-cust-02' }, catalog: { ...catalog, id: 'gone' }, purchasedAt: '2026-10-19', method: 'cash', notes: '' })).rejects.toThrow(CATALOG_MISSING_MESSAGE)
    expect((await repo.list('customer_packages')).length).toBe(before)
  })
})
