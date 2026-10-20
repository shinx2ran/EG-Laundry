import { describe, expect, it } from 'vitest'
import type { CustomerPackage, OrderItem, Service } from '../../types/db'
import { noExpressMessage, priceDraftItems, validateOrderDraft } from '../../domain/pricing'
import { formatRupiah } from '../../lib/format'
import {
  ROW_SERVICE_MESSAGE,
  draftLines,
  draftPackageUse,
  draftSummary,
  keepOldPrices,
  keptServiceId,
  minQtyHint,
  newDraftRow,
  packageChoice,
  parseQtyText,
  qtyText,
  rowProblem,
  rowPackageChoice,
  rowUnit,
  rowsFromItems,
  rowsToDraftItems,
  servicePriceLabel,
  stepQty,
  usablePackages,
  type DraftRow,
} from './orderForm'

const ts = { org_id: 'org', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const svc = (id: string, name: string, unit: Service['unit'], price: number, price_express: number | null, min_qty = 0, extra: Partial<Service> = {}): Service => ({
  id,
  name,
  unit,
  price,
  price_express,
  days_regular: 3,
  days_express: price_express === null ? null : 1,
  min_qty,
  sort_order: 0,
  active: true,
  ...ts,
  ...extra,
})
const CS = svc('cs', 'Cuci setrika', 'kg', 8_000, 13_000, 2)
const SS = svc('ss', 'Setrika saja', 'kg', 5_000, null)
const BC = svc('bc', 'Bed cover', 'pcs', 25_000, null)
const services = [CS, SS, BC]

const row = (patch: Partial<DraftRow>): DraftRow => ({ ...newDraftRow(), ...patch })

const pkg = (id: string, patch: Partial<CustomerPackage> = {}): CustomerPackage => ({
  id,
  customer_id: 'c1',
  catalog_id: null,
  name: 'Paket 20 kg cuci setrika',
  service_id: 'cs',
  qty_total: 20,
  price: 140_000,
  purchased_at: '2026-10-01',
  expires_at: '2026-11-30',
  method: 'cash',
  notes: null,
  ...ts,
  ...patch,
})

describe('draft rows', () => {
  it('a new row has its own key and no service yet', () => {
    const a = newDraftRow()
    const b = newDraftRow('cs', 2)
    expect(a).toMatchObject({ id: null, service_id: '', qty: 1, customer_package_id: null, notes: '' })
    expect(b).toMatchObject({ service_id: 'cs', qty: 2 })
    expect(a.key).not.toBe(b.key)
  })

  it('existing items become rows keyed by their id', () => {
    const rows = rowsFromItems([{ id: 'i1', service_id: null, qty: 2.5, customer_package_id: 'p1', notes: null }])
    expect(rows).toEqual([{ key: 'i1', id: 'i1', service_id: '', qty: 2.5, customer_package_id: 'p1', notes: '' }])
  })

  it('rows without a service are left out and reported, except kept old lines', () => {
    const rows = [row({ service_id: 'cs', qty: 3, notes: '  kerah ' }), row({ service_id: '' }), row({ id: 'i9', service_id: '' })]
    expect(rowsToDraftItems(rows)).toEqual([{ id: null, service_id: 'cs', qty: 3, customer_package_id: null, notes: 'kerah' }])
    expect(rowsToDraftItems(rows, new Set(['i9'])).map((r) => r.id)).toEqual([null, 'i9'])
    expect(rowProblem(rows)).toBe(ROW_SERVICE_MESSAGE)
    expect(rowProblem([rows[0], rows[2]], new Set(['i9']))).toBeNull()
    expect(rowProblem([rows[0]])).toBeNull()
  })
})

describe('quantities (SPEC 3.12)', () => {
  it('reads a typed kg amount with a comma or a dot', () => {
    expect(parseQtyText('2,5')).toBe(2.5)
    expect(parseQtyText('2.25')).toBe(2.25)
    expect(parseQtyText(' 3 ')).toBe(3)
    expect(parseQtyText('3,')).toBe(3)
    expect(parseQtyText(',5')).toBe(0.5)
    expect(parseQtyText('')).toBeNull()
    expect(parseQtyText(',')).toBeNull()
    expect(parseQtyText('-1')).toBeNull()
    expect(parseQtyText('2,5,1')).toBeNull()
    expect(parseQtyText('abc')).toBeNull()
  })

  it('shows a qty with the Indonesian comma and at most 2 decimals', () => {
    expect(qtyText(2.5)).toBe('2,5')
    expect(qtyText(3)).toBe('3')
    expect(qtyText(1.234)).toBe('1,23')
    expect(qtyText(Number.NaN)).toBe('')
  })

  it('steps in 0,5 kg without float noise and never below the floor', () => {
    expect(stepQty(2, 0.5)).toBe(2.5)
    expect(stepQty(0.1, 0.2)).toBe(0.3)
    expect(stepQty(0.5, -0.5, 0.5)).toBe(0.5)
    expect(stepQty(Number.NaN, 0.5)).toBe(0.5)
  })

  it('hints the minimum when the qty is below it', () => {
    expect(minQtyHint(1, CS)).toBe('min. 2 kg')
    expect(minQtyHint(2, CS)).toBeNull()
    expect(minQtyHint(1, SS)).toBeNull()
    expect(minQtyHint(1, undefined)).toBeNull()
    expect(minQtyHint(0.5, { min_qty: 1.5, unit: 'kg' })).toBe('min. 1,5 kg')
  })
})

describe('package choice (SPEC 3.4)', () => {
  const orders = [
    { id: 'o1', status: 'done' as const },
    { id: 'o2', status: 'cancelled' as const },
    { id: 'o3', status: 'received' as const },
  ]
  const items = [
    { order_id: 'o1', customer_package_id: 'p1', qty: 5 },
    { order_id: 'o2', customer_package_id: 'p1', qty: 4 },
    { order_id: 'o3', customer_package_id: 'p1', qty: 3 },
  ]

  it('offers the customer’s usable package with what is left (cancelled orders give it back)', () => {
    const choice = packageChoice([pkg('p1')], 'c1', 'cs', '2026-10-19', items, orders)
    expect(choice?.pkg.id).toBe('p1')
    expect(choice?.remaining).toBe(12)
    // the order being edited does not count against its own lines
    expect(packageChoice([pkg('p1')], 'c1', 'cs', '2026-10-19', items, orders, 'o3')?.remaining).toBe(15)
  })

  it('nothing for another customer, another service, an expired or used-up package, or no customer', () => {
    expect(packageChoice([pkg('p1')], 'c2', 'cs', '2026-10-19', [], [])).toBeNull()
    expect(packageChoice([pkg('p1')], 'c1', 'ss', '2026-10-19', [], [])).toBeNull()
    expect(packageChoice([pkg('p1')], 'c1', 'cs', '2026-12-01', [], [])).toBeNull()
    expect(packageChoice([pkg('p1', { qty_total: 8 })], 'c1', 'cs', '2026-10-19', items, orders)).toBeNull()
    expect(packageChoice([pkg('p1')], null, 'cs', '2026-10-19', [], [])).toBeNull()
    expect(packageChoice([pkg('p1')], 'c1', '', '2026-10-19', [], [])).toBeNull()
  })

  it('the package expiring first is offered when there are several', () => {
    const choice = packageChoice([pkg('late', { expires_at: null }), pkg('soon', { expires_at: '2026-10-25' }), pkg('mid', { expires_at: '2026-11-01' })], 'c1', 'cs', '2026-10-19', [], [])
    expect(choice?.pkg.id).toBe('soon')
  })

  it('lists every package of the customer still usable on the received date, expiring first first', () => {
    const packages = [
      pkg('p1', { expires_at: '2026-11-30' }),
      pkg('p2', { service_id: 'bc', expires_at: '2026-10-25', qty_total: 5 }),
      pkg('old', { expires_at: '2026-10-01' }),
      pkg('other', { customer_id: 'c2' }),
      pkg('used', { qty_total: 8 }),
    ]
    const used = [{ order_id: 'o1', customer_package_id: 'used', qty: 8 }]
    expect(usablePackages(packages, 'c1', '2026-10-19', used, orders).map((c) => [c.pkg.id, c.remaining])).toEqual([
      ['p2', 5],
      ['p1', 20],
    ])
    expect(usablePackages(packages, null, '2026-10-19', [], [])).toEqual([])
  })

  it('what the other rows of the draft already take from a package (minimum applied)', () => {
    const rows = [row({ key: 'a', service_id: 'cs', qty: 1, customer_package_id: 'p1' }), row({ key: 'b', service_id: 'cs', qty: 3.5, customer_package_id: 'p1' }), row({ key: 'c', service_id: 'cs', qty: 4 })]
    expect(draftPackageUse(rows, services, 'p1', 'b')).toBe(2)
    expect(draftPackageUse(rows, services, 'p1', 'a')).toBe(3.5)
    expect(draftPackageUse(rows, services, 'p1', 'none')).toBe(5.5)
    expect(draftPackageUse(rows, services, 'p2', 'none')).toBe(0)
  })

  it('a row is offered what the other rows leave of the package; a row already on it can switch it off', () => {
    const choice = { pkg: pkg('p1'), remaining: 6 }
    const rows = [row({ key: 'a', service_id: 'cs', qty: 4, customer_package_id: 'p1' }), row({ key: 'b', service_id: 'cs', qty: 3 })]
    expect(rowPackageChoice(choice, rows, services, rows[1])?.remaining).toBe(2)
    expect(rowPackageChoice(choice, rows, services, rows[0])?.remaining).toBe(6)
    const full = [row({ key: 'a', service_id: 'cs', qty: 6, customer_package_id: 'p1' }), row({ key: 'b', service_id: 'cs', qty: 2, customer_package_id: 'p1' }), row({ key: 'c', service_id: 'cs', qty: 2 })]
    expect(rowPackageChoice(choice, full, services, full[2])).toBeNull()
    expect(rowPackageChoice(choice, full, services, full[1])).toEqual({ pkg: choice.pkg, remaining: 0 })
    expect(rowPackageChoice(null, rows, services, rows[0])).toBeNull()
  })
})

describe('live totals', () => {
  it('prices each line on its own: minimum, express, package, unfinished rows', () => {
    const rows = [
      row({ service_id: 'cs', qty: 1 }),
      row({ service_id: 'bc', qty: 1 }),
      row({ service_id: '' }),
      row({ service_id: 'cs', qty: 3, customer_package_id: 'p1' }),
    ]
    const lines = draftLines(rows, services, false)
    expect(lines.map((l) => [l.billedQty, l.unitPrice, l.lineTotal, l.problem])).toEqual([
      [2, 8_000, 16_000, null],
      [1, 25_000, 25_000, null],
      [1, null, null, ROW_SERVICE_MESSAGE],
      [3, 0, 0, null],
    ])
    expect(draftSummary(lines, 1_000)).toEqual({ subtotal: 41_000, discount: 1_000, total: 40_000 })
  })

  it('express: the express price, or the spec error for a service without one (the others still count)', () => {
    const lines = draftLines([row({ service_id: 'cs', qty: 2.5 }), row({ service_id: 'bc', qty: 1 })], services, true)
    expect(lines[0]).toMatchObject({ unitPrice: 13_000, lineTotal: 32_500, problem: null })
    expect(lines[1]).toMatchObject({ unitPrice: null, lineTotal: null, problem: noExpressMessage('Bed cover') })
    expect(lines[1].problem).toBe('Layanan Bed cover tidak ada harga express.')
    expect(draftSummary(lines, 0).subtotal).toBe(32_500)
  })

  it('a qty problem keeps the line out of the total', () => {
    const [kg, pcs] = draftLines([row({ service_id: 'ss', qty: 1.234 }), row({ service_id: 'bc', qty: 1.5 })], services, false)
    expect(kg).toMatchObject({ lineTotal: null, problem: 'Jumlah kg maksimal 2 angka di belakang koma.' })
    expect(pcs).toMatchObject({ lineTotal: null, problem: 'Jumlah pcs harus bilangan bulat.' })
  })

  it('the total never drops below 0 and a negative discount counts as none', () => {
    expect(draftSummary([{ lineTotal: 10_000 }], 15_000)).toEqual({ subtotal: 10_000, discount: 15_000, total: 0 })
    expect(draftSummary([{ lineTotal: 10_000 }], -5)).toEqual({ subtotal: 10_000, discount: 0, total: 10_000 })
  })

  it('the service select shows the price for the order kind', () => {
    expect(servicePriceLabel(CS, false, formatRupiah)).toBe('Rp 8.000/kg')
    expect(servicePriceLabel(CS, true, formatRupiah)).toBe('Rp 13.000/kg')
    expect(servicePriceLabel(BC, true, formatRupiah)).toBe('tidak ada express')
    expect(rowUnit(BC)).toBe('pcs')
    expect(rowUnit(undefined)).toBe('kg')
  })
})

describe('Ubah keeps the prices the order was made with (SPEC 3.1)', () => {
  const item = (patch: Partial<OrderItem>): OrderItem => ({
    id: 'i1',
    order_id: 'o1',
    service_id: 'cs',
    service_name: 'Cuci setrika',
    unit: 'kg',
    unit_price: 7_000,
    qty: 3,
    line_total: 21_000,
    customer_package_id: null,
    notes: null,
    ...ts,
    ...patch,
  })
  // the price list went up from 7.000 to 8.000 since the order was made
  const existing = [item({}), item({ id: 'i2', service_id: null, service_name: 'Karpet', unit: 'pcs', unit_price: 30_000, qty: 1, line_total: 30_000 })]

  it('an unchanged service keeps its old copy; the qty change is billed at the old price', () => {
    const view = keepOldPrices([{ id: 'i1', service_id: 'cs', qty: 4 }], existing, services, false, false)
    expect(view.kept).toEqual([true])
    expect(view.lines[0].service_id).toBe('keep:i1')
    const [priced] = priceDraftItems(view.lines, view.services, false)
    expect(priced).toMatchObject({ service_name: 'Cuci setrika', unit: 'kg', qty: 4, unit_price: 7_000, line_total: 28_000 })
    expect(keptServiceId(priced.service_id, existing)).toBe('cs')
  })

  it('the minimum is applied again only when the qty changed', () => {
    const lowOld = [item({ qty: 1.5, line_total: 10_500 })]
    const same = keepOldPrices([{ id: 'i1', service_id: 'cs', qty: 1.5 }], lowOld, services, false, false)
    expect(priceDraftItems(same.lines, same.services, false)[0]).toMatchObject({ qty: 1.5, line_total: 10_500 })
    const changed = keepOldPrices([{ id: 'i1', service_id: 'cs', qty: 1 }], lowOld, services, false, false)
    expect(priceDraftItems(changed.lines, changed.services, false)[0]).toMatchObject({ qty: 2, line_total: 14_000 })
  })

  it('a line whose service was deleted later keeps its copy and validates', () => {
    const view = keepOldPrices([{ id: 'i2', service_id: '', qty: 2 }], existing, services, false, false)
    expect(view.kept).toEqual([true])
    const [priced] = priceDraftItems(view.lines, view.services, false)
    expect(priced).toMatchObject({ service_name: 'Karpet', unit: 'pcs', qty: 2, unit_price: 30_000, line_total: 60_000 })
    expect(keptServiceId(priced.service_id, existing)).toBeNull()
    expect(validateOrderDraft({ customer_id: 'c1', received_at: '2026-10-19', express: false, discount: 0, items: view.lines }, { services: view.services, packages: [], orderItems: [], orders: [] })).toEqual([])
  })

  it('another service, a package switched on, an express switch or a new line take the current price list', () => {
    expect(keepOldPrices([{ id: 'i1', service_id: 'ss', qty: 3 }], existing, services, false, false).kept).toEqual([false])
    expect(keepOldPrices([{ id: 'i1', service_id: 'cs', qty: 3, customer_package_id: 'p1' }], existing, services, false, false).kept).toEqual([false])
    expect(keepOldPrices([{ id: 'i1', service_id: 'cs', qty: 3 }], existing, services, true, false).kept).toEqual([false])
    expect(keepOldPrices([{ service_id: 'cs', qty: 3 }], existing, services, false, false).kept).toEqual([false])
    // the same item twice: only the first keeps it
    expect(keepOldPrices([{ id: 'i1', service_id: 'cs', qty: 3 }, { id: 'i1', service_id: 'cs', qty: 1 }], existing, services, false, false).kept).toEqual([true, false])
    // nothing kept: the price list is passed through as it is
    const view = keepOldPrices([{ service_id: 'cs', qty: 3 }], existing, services, false, false)
    expect(view.services).toBe(services)
    expect(keptServiceId('cs', existing)).toBe('cs')
  })
})
