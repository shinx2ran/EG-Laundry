// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { MemberRole, PackageCatalogItem, Service } from '../../types/db'
import { LocalRepo } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import { buildDemoDb, DEMO_CATALOG_ID, DEMO_ORG_ID, DEMO_SERVICE_ID } from '../../lib/repo/demoSeed'
import {
  ERR_PACKAGE_SERVICE_KG,
  ERR_SERVICE_NAME,
  PACKAGE_IN_USE_MESSAGE,
  SERVICE_IN_USE_MESSAGE,
  STAFF_PACKAGE_MESSAGE,
  STAFF_PRICE_MESSAGE,
  initialPackageForm,
  initialServiceForm,
  serviceToForm,
} from './hargaUtils'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: DEMO_ORG_ID, name: 'EG Laundry (Demo)' }, repo: state.repo, role: state.role, isAdmin: state.role !== 'staff', isLocalMode: true }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { useHargaActions } from './useHargaActions'

let local: LocalRepo
let repo: OrgRepo

function seed(role: MemberRole = 'owner') {
  local = new LocalRepo(buildDemoDb(new Date(2026, 9, 19)))
  repo = bindOrg(local, DEMO_ORG_ID)
  state.repo = repo
  state.role = role
}

function actions() {
  return renderHook(() => useHargaActions()).result.current
}

const byId = async (id: string) => (await repo.get('services', id)) as Service
const services = () => repo.list('services', { orderBy: { column: 'sort_order', ascending: true } })
const jas = () => ({ ...initialServiceForm(), name: 'Jas', unit: 'pcs' as const, price: 15_000, hasExpress: true, price_express: 25_000, days_regular: '2', days_express: '1' })

beforeEach(() => invalidate.mockClear())
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('services (owner/admin)', () => {
  it('createService stores the payload last in the list', async () => {
    seed()
    const created = await actions().createService(jas())
    expect(created).toMatchObject({ name: 'Jas', unit: 'pcs', price: 15_000, price_express: 25_000, days_regular: 2, days_express: 1, min_qty: 0, active: true, sort_order: 7, org_id: DEMO_ORG_ID })
    expect((await services()).map((s) => s.name).at(-1)).toBe('Jas')
    expect(invalidate).toHaveBeenCalledWith('services')
  })

  it('createService refuses an invalid form before writing', async () => {
    seed()
    await expect(actions().createService({ ...jas(), name: ' ' })).rejects.toThrow(ERR_SERVICE_NAME)
    expect(await services()).toHaveLength(6)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('updateService changes the price and keeps the sort order; the express switch off clears express columns', async () => {
    seed()
    const before = await byId(DEMO_SERVICE_ID.setrikaSaja)
    const updated = await actions().updateService(before, { ...serviceToForm(before), price: 6_000 })
    expect(updated).toMatchObject({ price: 6_000, sort_order: before.sort_order, price_express: null })
    const kering = await byId(DEMO_SERVICE_ID.cuciKering)
    await actions().updateService(kering, { ...serviceToForm(kering), hasExpress: false })
    expect(await byId(DEMO_SERVICE_ID.cuciKering)).toMatchObject({ price_express: null, days_express: null, price: 6_000 })
  })

  it('setServiceActive hides a service without touching anything else', async () => {
    seed()
    const admin = (await byId(DEMO_SERVICE_ID.sepatu))
    state.role = 'admin'
    await actions().setServiceActive(admin, false)
    expect(await byId(DEMO_SERVICE_ID.sepatu)).toMatchObject({ active: false, price: 35_000 })
    expect(invalidate).toHaveBeenCalledWith('services')
  })

  it('deleteService refuses a service with order items (the database would only unlink them)', async () => {
    seed()
    await expect(actions().deleteService(await byId(DEMO_SERVICE_ID.sepatu))).rejects.toThrow(SERVICE_IN_USE_MESSAGE)
    expect(await byId(DEMO_SERVICE_ID.sepatu)).not.toBeNull()
    // refused before the delete was attempted: nothing changed, so nothing to refresh
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('deleteService translates the restrict error of a service that only a catalog entry refers to', async () => {
    seed()
    // a fresh service that only the catalog points at: the usage read sees it; and when it would not, LocalRepo says IN_USE
    const created = await actions().createService(jas())
    await repo.update('package_catalog', DEMO_CATALOG_ID, { service_id: created.id })
    await expect(actions().deleteService(created)).rejects.toThrow(SERVICE_IN_USE_MESSAGE)
    // bypass the usage read: the repo's own restrict rule is translated too
    const spy = vi.spyOn(repo, 'list').mockResolvedValue([])
    await expect(actions().deleteService(created)).rejects.toThrow(SERVICE_IN_USE_MESSAGE)
    spy.mockRestore()
    expect(await byId(created.id)).not.toBeNull()
    expect(invalidate).toHaveBeenCalledWith('services')
  })

  it('deleteService removes an unused service', async () => {
    seed()
    const created = await actions().createService(jas())
    await actions().deleteService(created)
    expect(await repo.get('services', created.id)).toBeNull()
    expect(await services()).toHaveLength(6)
  })

  it('moveService swaps two neighbours of the same unit and persists', async () => {
    seed()
    await actions().moveService(await byId(DEMO_SERVICE_ID.cuciSetrika), 'up')
    expect((await services()).map((s) => s.name)).toEqual(['Cuci setrika', 'Cuci kering', 'Setrika saja', 'Bed cover', 'Selimut', 'Sepatu'])
    expect(invalidate).toHaveBeenCalledWith('services')
    invalidate.mockClear()
    // at the top of its group: nothing happens, nothing is refreshed
    await actions().moveService(await byId(DEMO_SERVICE_ID.cuciSetrika), 'up')
    expect((await services()).map((s) => s.name)[0]).toBe('Cuci setrika')
    expect(invalidate).not.toHaveBeenCalled()
    // the pcs group is left alone when a kg service moves to the end of its group
    await actions().moveService(await byId(DEMO_SERVICE_ID.cuciKering), 'down')
    expect((await services()).map((s) => s.name)).toEqual(['Cuci setrika', 'Setrika saja', 'Cuci kering', 'Bed cover', 'Selimut', 'Sepatu'])
  })
})

describe('package catalog (owner/admin)', () => {
  const paket = (list: Service[]) => ({ ...initialPackageForm(list), name: 'Paket 10 kg cuci kering', service_id: DEMO_SERVICE_ID.cuciKering, qty: '10', price: 50_000, valid_days: '' })
  const catalog = async () => (await repo.get('package_catalog', DEMO_CATALOG_ID)) as PackageCatalogItem

  it('createPackage stores a per-kg package without expiry', async () => {
    seed()
    const list = await services()
    const created = await actions().createPackage(paket(list), list)
    expect(created).toMatchObject({ name: 'Paket 10 kg cuci kering', service_id: DEMO_SERVICE_ID.cuciKering, qty: 10, price: 50_000, valid_days: null, active: true })
    expect(invalidate).toHaveBeenCalledWith('package_catalog')
  })

  it('createPackage refuses a per-pcs service before writing', async () => {
    seed()
    const list = await services()
    await expect(actions().createPackage({ ...paket(list), service_id: DEMO_SERVICE_ID.bedCover }, list)).rejects.toThrow(ERR_PACKAGE_SERVICE_KG)
    expect(await repo.list('package_catalog')).toHaveLength(1)
  })

  it('updatePackage and setPackageActive change the entry in place', async () => {
    seed()
    const list = await services()
    const item = await catalog()
    const updated = await actions().updatePackage(item, { name: item.name, service_id: item.service_id, qty: '25', price: 160_000, valid_days: '90', active: true }, list)
    expect(updated).toMatchObject({ qty: 25, price: 160_000, valid_days: 90 })
    await actions().setPackageActive(updated, false)
    expect(await catalog()).toMatchObject({ active: false, qty: 25 })
  })

  it('deletePackage refuses a bought entry and removes an unsold one', async () => {
    seed()
    const list = await services()
    await expect(actions().deletePackage(await catalog())).rejects.toThrow(PACKAGE_IN_USE_MESSAGE)
    expect(await catalog()).not.toBeNull()
    const created = await actions().createPackage(paket(list), list)
    await actions().deletePackage(created)
    expect(await repo.get('package_catalog', created.id)).toBeNull()
  })
})

describe('staff (SPEC 3.10): every write is refused before it starts', () => {
  it('services', async () => {
    seed('staff')
    const a = actions()
    expect(a.isAdmin).toBe(false)
    const snapshot = JSON.stringify(local.snapshot())
    const sepatu = await byId(DEMO_SERVICE_ID.sepatu)
    await expect(a.createService(jas())).rejects.toThrow(STAFF_PRICE_MESSAGE)
    await expect(a.updateService(sepatu, { ...serviceToForm(sepatu), price: 1 })).rejects.toThrow(STAFF_PRICE_MESSAGE)
    await expect(a.setServiceActive(sepatu, false)).rejects.toThrow(STAFF_PRICE_MESSAGE)
    await expect(a.deleteService(sepatu)).rejects.toThrow(STAFF_PRICE_MESSAGE)
    await expect(a.moveService(sepatu, 'up')).rejects.toThrow(STAFF_PRICE_MESSAGE)
    expect(JSON.stringify(local.snapshot())).toBe(snapshot)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('package catalog', async () => {
    seed('staff')
    const a = actions()
    const list = await services()
    const snapshot = JSON.stringify(local.snapshot())
    const item = (await repo.get('package_catalog', DEMO_CATALOG_ID)) as PackageCatalogItem
    const values = { name: 'x', service_id: DEMO_SERVICE_ID.cuciKering, qty: '1', price: 1, valid_days: '', active: true }
    await expect(a.createPackage(values, list)).rejects.toThrow(STAFF_PACKAGE_MESSAGE)
    await expect(a.updatePackage(item, values, list)).rejects.toThrow(STAFF_PACKAGE_MESSAGE)
    await expect(a.setPackageActive(item, false)).rejects.toThrow(STAFF_PACKAGE_MESSAGE)
    await expect(a.deletePackage(item)).rejects.toThrow(STAFF_PACKAGE_MESSAGE)
    expect(JSON.stringify(local.snapshot())).toBe(snapshot)
    expect(invalidate).not.toHaveBeenCalled()
  })
})
