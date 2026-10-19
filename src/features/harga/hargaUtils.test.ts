import { describe, expect, it } from 'vitest'
import type { CustomerPackage, OrderItem, PackageCatalogItem, Service } from '../../types/db'
import { ERR_QTY_KG_DECIMALS, ERR_QTY_PCS_WHOLE, ERR_QTY_POSITIVE } from '../../domain/pricing'
import {
  ERR_DAYS,
  ERR_MIN_QTY,
  ERR_PACKAGE_NAME,
  ERR_PACKAGE_SERVICE,
  ERR_PACKAGE_SERVICE_KG,
  ERR_PRICE_EXPRESS_REQUIRED,
  ERR_PRICE_NEGATIVE,
  ERR_SERVICE_NAME,
  ERR_VALID_DAYS,
  canMoveService,
  catalogUsage,
  catalogUsageText,
  describeDays,
  describeMinQty,
  describePackageContent,
  describeValidity,
  formToPackagePayload,
  formToServicePayload,
  groupServicesByUnit,
  initialPackageForm,
  initialServiceForm,
  isServiceUsed,
  moveService,
  nextSortOrder,
  packageServiceOptions,
  packageToForm,
  parseDecimalInput,
  parseWholeInput,
  priceText,
  qtyToInput,
  serviceToForm,
  serviceUsage,
  serviceUsageText,
  sortServices,
  validatePackageForm,
  validateServiceForm,
} from './hargaUtils'

const ts = { org_id: 'org', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' }

const service = (id: string, over: Partial<Service> = {}): Service => ({
  id,
  name: id,
  unit: 'kg',
  price: 8_000,
  price_express: 13_000,
  days_regular: 3,
  days_express: 1,
  min_qty: 0,
  sort_order: 0,
  active: true,
  ...ts,
  ...over,
})

const cuciKering = service('cuci-kering', { name: 'Cuci kering', price: 6_000, price_express: 10_000, min_qty: 2, sort_order: 1 })
const cuciSetrika = service('cuci-setrika', { name: 'Cuci setrika', min_qty: 2, sort_order: 2 })
const setrikaSaja = service('setrika-saja', { name: 'Setrika saja', price: 5_000, price_express: null, days_regular: 2, days_express: null, sort_order: 3 })
const bedCover = service('bed-cover', { name: 'Bed cover', unit: 'pcs', price: 25_000, price_express: null, days_express: null, sort_order: 4 })
const selimut = service('selimut', { name: 'Selimut', unit: 'pcs', price: 20_000, price_express: null, days_express: null, sort_order: 5 })
const sepatu = service('sepatu', { name: 'Sepatu', unit: 'pcs', price: 35_000, price_express: null, days_regular: 4, days_express: null, sort_order: 6 })
const services = [cuciKering, cuciSetrika, setrikaSaja, bedCover, selimut, sepatu]

const validService = () => ({ ...initialServiceForm(), name: 'Jas', unit: 'pcs' as const, price: 15_000, days_regular: '2' })

describe('typed numbers', () => {
  it('parseDecimalInput accepts comma or dot, empty is null, anything else NaN', () => {
    expect(parseDecimalInput('2,5')).toBe(2.5)
    expect(parseDecimalInput('2.5')).toBe(2.5)
    expect(parseDecimalInput(' 3 ')).toBe(3)
    expect(parseDecimalInput('2,')).toBe(2)
    expect(parseDecimalInput('')).toBeNull()
    expect(parseDecimalInput('   ')).toBeNull()
    expect(parseDecimalInput('-1')).toBeNaN()
    expect(parseDecimalInput('abc')).toBeNaN()
    expect(parseDecimalInput('1,2,3')).toBeNaN()
  })

  it('parseWholeInput takes digits only', () => {
    expect(parseWholeInput('3')).toBe(3)
    expect(parseWholeInput('0')).toBe(0)
    expect(parseWholeInput('')).toBeNull()
    expect(parseWholeInput('2,5')).toBeNaN()
    expect(parseWholeInput('-2')).toBeNaN()
  })

  it('qtyToInput writes the Indonesian decimal comma and hides 0', () => {
    expect(qtyToInput(2.5)).toBe('2,5')
    expect(qtyToInput(20)).toBe('20')
    expect(qtyToInput(0)).toBe('')
  })
})

describe('service form (SPEC 3.1)', () => {
  it('round-trips a row through the form', () => {
    expect(serviceToForm(cuciKering)).toEqual({ name: 'Cuci kering', unit: 'kg', price: 6_000, hasExpress: true, price_express: 10_000, days_regular: '3', days_express: '1', min_qty: '2', active: true })
    expect(formToServicePayload(serviceToForm(cuciKering))).toEqual({ name: 'Cuci kering', unit: 'kg', price: 6_000, price_express: 10_000, days_regular: 3, days_express: 1, min_qty: 2, active: true })
    expect(serviceToForm(setrikaSaja)).toMatchObject({ hasExpress: false, price_express: 0, days_express: '', min_qty: '' })
    expect(formToServicePayload(serviceToForm(setrikaSaja))).toEqual({ name: 'Setrika saja', unit: 'kg', price: 5_000, price_express: null, days_regular: 2, days_express: null, min_qty: 0, active: true })
  })

  it('a valid new service has no errors; the defaults are kg, 3 days, active', () => {
    expect(initialServiceForm()).toMatchObject({ unit: 'kg', days_regular: '3', active: true, hasExpress: false })
    expect(validateServiceForm(validService())).toEqual({})
  })

  it('requires a name and trims it', () => {
    expect(validateServiceForm({ ...validService(), name: '   ' })).toEqual({ name: ERR_SERVICE_NAME })
    expect(formToServicePayload({ ...validService(), name: '  Jas  ' }).name).toBe('Jas')
  })

  it('prices: regular >= 0, express required (> 0) only when the switch is on', () => {
    expect(validateServiceForm({ ...validService(), price: -1 })).toEqual({ price: ERR_PRICE_NEGATIVE })
    expect(validateServiceForm({ ...validService(), price: 0 })).toEqual({})
    expect(validateServiceForm({ ...validService(), hasExpress: true, price_express: 0 })).toEqual({ price_express: ERR_PRICE_EXPRESS_REQUIRED })
    expect(validateServiceForm({ ...validService(), hasExpress: true, price_express: 25_000 })).toEqual({})
    // switch off: whatever is left in the express box is ignored and not stored
    expect(validateServiceForm({ ...validService(), hasExpress: false, price_express: 0 })).toEqual({})
    expect(formToServicePayload({ ...validService(), hasExpress: false, price_express: 25_000, days_express: '1' })).toMatchObject({ price_express: null, days_express: null })
  })

  it('days: whole and >= 0; express days optional (empty = same as regular)', () => {
    expect(validateServiceForm({ ...validService(), days_regular: '' })).toEqual({ days_regular: ERR_DAYS })
    expect(validateServiceForm({ ...validService(), days_regular: '1,5' })).toEqual({ days_regular: ERR_DAYS })
    expect(validateServiceForm({ ...validService(), days_regular: '0' })).toEqual({})
    expect(validateServiceForm({ ...validService(), hasExpress: true, price_express: 1, days_express: 'x' })).toEqual({ days_express: ERR_DAYS })
    expect(validateServiceForm({ ...validService(), hasExpress: true, price_express: 1, days_express: '' })).toEqual({})
    expect(formToServicePayload({ ...validService(), hasExpress: true, price_express: 1, days_express: '' })).toMatchObject({ days_express: null })
    expect(formToServicePayload({ ...validService(), hasExpress: true, price_express: 1, days_express: '1' })).toMatchObject({ days_express: 1 })
  })

  it('min qty: empty = 0, pcs whole, kg 2 decimals, never garbage', () => {
    expect(validateServiceForm({ ...validService(), min_qty: '' })).toEqual({})
    expect(validateServiceForm({ ...validService(), min_qty: '0' })).toEqual({})
    expect(validateServiceForm({ ...validService(), min_qty: 'abc' })).toEqual({ min_qty: ERR_MIN_QTY })
    expect(validateServiceForm({ ...validService(), unit: 'pcs', min_qty: '1,5' })).toEqual({ min_qty: ERR_QTY_PCS_WHOLE })
    expect(validateServiceForm({ ...validService(), unit: 'kg', min_qty: '1,555' })).toEqual({ min_qty: ERR_QTY_KG_DECIMALS })
    expect(validateServiceForm({ ...validService(), unit: 'kg', min_qty: '2,5' })).toEqual({})
    expect(formToServicePayload({ ...validService(), unit: 'kg', min_qty: '2,5' }).min_qty).toBe(2.5)
    expect(formToServicePayload({ ...validService(), min_qty: '' }).min_qty).toBe(0)
  })

  it('reports every broken field at once', () => {
    const errs = validateServiceForm({ ...initialServiceForm(), price: -5, hasExpress: true, days_regular: 'x' })
    expect(Object.keys(errs).sort()).toEqual(['days_regular', 'name', 'price', 'price_express'])
  })
})

describe('package catalog form (SPEC 3.4)', () => {
  const catalog: PackageCatalogItem = { id: 'pkg', name: 'Paket 20 kg cuci setrika', service_id: cuciSetrika.id, qty: 20, price: 140_000, valid_days: 60, active: true, ...ts }
  const valid = () => ({ ...initialPackageForm(services), name: 'Paket 10 kg', service_id: cuciKering.id, qty: '10', price: 50_000 })

  it('round-trips a row through the form', () => {
    expect(packageToForm(catalog)).toEqual({ name: 'Paket 20 kg cuci setrika', service_id: cuciSetrika.id, qty: '20', price: 140_000, valid_days: '60', active: true })
    expect(formToPackagePayload(packageToForm(catalog))).toEqual({ name: 'Paket 20 kg cuci setrika', service_id: cuciSetrika.id, qty: 20, price: 140_000, valid_days: 60, active: true })
    expect(packageToForm({ ...catalog, valid_days: null })).toMatchObject({ valid_days: '' })
  })

  it('offers active per-kg services only, plus the current one when editing', () => {
    const inactive = service('lama', { name: 'Cuci lama', active: false, sort_order: 0 })
    expect(packageServiceOptions([...services, inactive]).map((s) => s.name)).toEqual(['Cuci kering', 'Cuci setrika', 'Setrika saja'])
    expect(packageServiceOptions([...services, inactive], inactive.id).map((s) => s.name)).toEqual(['Cuci lama', 'Cuci kering', 'Cuci setrika', 'Setrika saja'])
    // one option: preselected; several: the owner picks
    expect(initialPackageForm([cuciKering, bedCover]).service_id).toBe(cuciKering.id)
    expect(initialPackageForm(services).service_id).toBe('')
  })

  it('validates name, service (per kg), qty, price and validity', () => {
    expect(validatePackageForm(valid(), services)).toEqual({})
    expect(validatePackageForm({ ...valid(), name: ' ' }, services)).toEqual({ name: ERR_PACKAGE_NAME })
    expect(validatePackageForm({ ...valid(), service_id: '' }, services)).toEqual({ service_id: ERR_PACKAGE_SERVICE })
    expect(validatePackageForm({ ...valid(), service_id: 'gone' }, services)).toEqual({ service_id: ERR_PACKAGE_SERVICE })
    expect(validatePackageForm({ ...valid(), service_id: bedCover.id }, services)).toEqual({ service_id: ERR_PACKAGE_SERVICE_KG })
    expect(validatePackageForm({ ...valid(), qty: '' }, services)).toEqual({ qty: ERR_QTY_POSITIVE })
    expect(validatePackageForm({ ...valid(), qty: '0' }, services)).toEqual({ qty: ERR_QTY_POSITIVE })
    expect(validatePackageForm({ ...valid(), qty: '1,555' }, services)).toEqual({ qty: ERR_QTY_KG_DECIMALS })
    expect(validatePackageForm({ ...valid(), qty: '12,5' }, services)).toEqual({})
    expect(validatePackageForm({ ...valid(), price: -1 }, services)).toEqual({ price: ERR_PRICE_NEGATIVE })
    expect(validatePackageForm({ ...valid(), valid_days: '0' }, services)).toEqual({ valid_days: ERR_VALID_DAYS })
    expect(validatePackageForm({ ...valid(), valid_days: '1,5' }, services)).toEqual({ valid_days: ERR_VALID_DAYS })
    expect(validatePackageForm({ ...valid(), valid_days: '' }, services)).toEqual({})
    expect(validatePackageForm({ ...valid(), valid_days: '60' }, services)).toEqual({})
  })

  it('stores an empty validity as null and the qty with 2 decimals', () => {
    expect(formToPackagePayload({ ...valid(), valid_days: '', qty: '12,5' })).toMatchObject({ valid_days: null, qty: 12.5 })
    expect(formToPackagePayload({ ...valid(), valid_days: '30', name: '  Paket  ' })).toMatchObject({ valid_days: 30, name: 'Paket' })
  })
})

describe('grouping and ordering', () => {
  it('sortServices orders by sort_order, then name', () => {
    const shuffled = [sepatu, { ...cuciSetrika, sort_order: 1 }, cuciKering, bedCover]
    expect(sortServices(shuffled).map((s) => s.name)).toEqual(['Cuci kering', 'Cuci setrika', 'Bed cover', 'Sepatu'])
  })

  it('groupServicesByUnit lists kg then pcs, each in sort order, and keeps an empty group', () => {
    const groups = groupServicesByUnit([sepatu, bedCover, setrikaSaja, cuciSetrika, cuciKering, selimut])
    expect(groups.map((g) => g.unit)).toEqual(['kg', 'pcs'])
    expect(groups[0].label).toBe('Per kg')
    expect(groups[0].services.map((s) => s.name)).toEqual(['Cuci kering', 'Cuci setrika', 'Setrika saja'])
    expect(groups[1].services.map((s) => s.name)).toEqual(['Bed cover', 'Selimut', 'Sepatu'])
    expect(groupServicesByUnit([cuciKering])[1].services).toEqual([])
    expect(groupServicesByUnit([])).toHaveLength(2)
  })

  it('nextSortOrder goes after the last one', () => {
    expect(nextSortOrder([])).toBe(1)
    expect(nextSortOrder(services)).toBe(7)
    expect(nextSortOrder([{ sort_order: 10 }, { sort_order: 3 }])).toBe(11)
  })

  it('moveService swaps with the neighbour of the same unit and writes only the changed rows', () => {
    expect(moveService(services, cuciSetrika.id, 'up')).toEqual([
      { id: cuciSetrika.id, sort_order: 1 },
      { id: cuciKering.id, sort_order: 2 },
    ])
    expect(moveService(services, cuciKering.id, 'down')).toEqual([
      { id: cuciSetrika.id, sort_order: 1 },
      { id: cuciKering.id, sort_order: 2 },
    ])
    expect(moveService(services, selimut.id, 'down')).toEqual([
      { id: sepatu.id, sort_order: 5 },
      { id: selimut.id, sort_order: 6 },
    ])
  })

  it('moveService stays inside the unit group and does nothing at the edges', () => {
    // kg1(1) pcs1(2) kg2(3): kg2 up skips the pcs service in between
    const mixed = [{ ...cuciKering, sort_order: 1 }, { ...bedCover, sort_order: 2 }, { ...cuciSetrika, sort_order: 3 }]
    expect(moveService(mixed, cuciSetrika.id, 'up')).toEqual([
      { id: cuciSetrika.id, sort_order: 1 },
      { id: cuciKering.id, sort_order: 3 },
    ])
    expect(moveService(mixed, bedCover.id, 'up')).toEqual([])
    expect(moveService(mixed, bedCover.id, 'down')).toEqual([])
    expect(moveService(services, cuciKering.id, 'up')).toEqual([])
    expect(moveService(services, setrikaSaja.id, 'down')).toEqual([])
    expect(moveService(services, 'unknown', 'down')).toEqual([])
  })

  it('moveService renumbers duplicate or gapped sort orders', () => {
    const dup = [{ ...cuciKering, sort_order: 0 }, { ...cuciSetrika, sort_order: 0 }, { ...setrikaSaja, sort_order: 9 }]
    // ties sort by name: Cuci kering, Cuci setrika; moving Cuci setrika up puts it first and heals the numbers
    expect(moveService(dup, cuciSetrika.id, 'up')).toEqual([
      { id: cuciSetrika.id, sort_order: 1 },
      { id: cuciKering.id, sort_order: 2 },
      { id: setrikaSaja.id, sort_order: 3 },
    ])
  })

  it('canMoveService mirrors the arrows', () => {
    expect(canMoveService(services, cuciKering.id, 'up')).toBe(false)
    expect(canMoveService(services, cuciKering.id, 'down')).toBe(true)
    expect(canMoveService(services, setrikaSaja.id, 'down')).toBe(false)
    expect(canMoveService(services, bedCover.id, 'up')).toBe(false)
    expect(canMoveService(services, sepatu.id, 'up')).toBe(true)
    expect(canMoveService(services, 'unknown', 'up')).toBe(false)
  })
})

describe('usage: delete or deactivate', () => {
  const item = (order_id: string, service_id: string | null): Pick<OrderItem, 'order_id' | 'service_id'> => ({ order_id, service_id })
  const pkg = (service_id: string, catalog_id: string | null): Pick<CustomerPackage, 'service_id' | 'catalog_id'> => ({ service_id, catalog_id })

  it('counts distinct orders, catalog entries and sold packages', () => {
    const items = [item('o1', cuciKering.id), item('o1', cuciKering.id), item('o2', cuciKering.id), item('o3', bedCover.id), item('o4', null)]
    const catalog = [{ service_id: cuciSetrika.id }, { service_id: cuciKering.id }]
    const packages = [pkg(cuciSetrika.id, 'c1'), pkg(cuciSetrika.id, 'c1'), pkg(cuciKering.id, null)]
    expect(serviceUsage(cuciKering.id, items, catalog, packages)).toEqual({ orders: 2, catalog: 1, packages: 1 })
    expect(serviceUsage(cuciSetrika.id, items, catalog, packages)).toEqual({ orders: 0, catalog: 1, packages: 2 })
    expect(serviceUsage(sepatu.id, items, catalog, packages)).toEqual({ orders: 0, catalog: 0, packages: 0 })
    expect(isServiceUsed({ orders: 0, catalog: 0, packages: 0 })).toBe(false)
    expect(isServiceUsed({ orders: 0, catalog: 0, packages: 1 })).toBe(true)
    expect(catalogUsage('c1', packages)).toBe(2)
    expect(catalogUsage('c2', packages)).toBe(0)
  })

  it('describes the usage in Indonesian', () => {
    expect(serviceUsageText({ orders: 0, catalog: 0, packages: 0 })).toBeNull()
    expect(serviceUsageText({ orders: 12, catalog: 0, packages: 0 })).toBe('Dipakai di 12 pesanan.')
    expect(serviceUsageText({ orders: 12, catalog: 1, packages: 0 })).toBe('Dipakai di 12 pesanan dan 1 paket di katalog.')
    expect(serviceUsageText({ orders: 1, catalog: 1, packages: 2 })).toBe('Dipakai di 1 pesanan, 1 paket di katalog dan 2 paket pelanggan.')
    expect(catalogUsageText(0)).toBeNull()
    expect(catalogUsageText(2)).toBe('Sudah dibeli 2 kali.')
  })
})

describe('display', () => {
  it('prices, days and minimums read like the price board', () => {
    expect(priceText(6_000, 'kg')).toBe('Rp 6.000/kg')
    expect(priceText(25_000, 'pcs')).toBe('Rp 25.000/pcs')
    expect(describeDays(cuciKering)).toBe('3 hari · express 1 hari')
    expect(describeDays(setrikaSaja)).toBe('2 hari')
    expect(describeDays({ days_regular: 0, days_express: null, price_express: 1 })).toBe('hari yang sama · express hari yang sama')
    expect(describeDays({ days_regular: 3, days_express: null, price_express: 1 })).toBe('3 hari · express 3 hari')
    expect(describeMinQty(cuciKering)).toBe('min. 2 kg')
    expect(describeMinQty({ min_qty: 2.5, unit: 'kg' })).toBe('min. 2,5 kg')
    expect(describeMinQty(bedCover)).toBeNull()
  })

  it('describes a catalog entry', () => {
    expect(describePackageContent({ qty: 20, service_id: cuciSetrika.id }, cuciSetrika)).toBe('20 kg Cuci setrika')
    expect(describePackageContent({ qty: 20, service_id: 'gone' }, undefined)).toBe('20 kg layanan tidak ditemukan')
    expect(describeValidity({ valid_days: 60 })).toBe('Berlaku 60 hari')
    expect(describeValidity({ valid_days: null })).toBe('Tanpa kedaluwarsa')
  })
})
