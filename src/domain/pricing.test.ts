import { describe, expect, it } from 'vitest'
import type { CustomerPackage, Order, OrderItem, Payment, Service } from '../types/db'
import {
  ERR_DISCOUNT_EXCEEDS,
  ERR_DISCOUNT_NEGATIVE,
  ERR_NO_CUSTOMER,
  ERR_NO_ITEMS,
  ERR_PACKAGE_EXPIRED,
  ERR_PACKAGE_OTHER_CUSTOMER,
  ERR_PACKAGE_OTHER_SERVICE,
  ERR_PACKAGE_UNKNOWN,
  ERR_PAYMENT_EXCEEDS,
  ERR_PAYMENT_NEGATIVE,
  ERR_QTY_KG_DECIMALS,
  ERR_QTY_PCS_WHOLE,
  ERR_QTY_POSITIVE,
  ERR_SERVICE_UNKNOWN,
  effectiveQty,
  isOrderLate,
  lineTotal,
  nextOrderNumber,
  noExpressMessage,
  orderTotals,
  packageInsufficientMessage,
  packageProblem,
  packageRemaining,
  packageUsable,
  priceDraftItems,
  promisedDate,
  qtyProblem,
  roundQty,
  unitPrice,
  validateOrderDraft,
  type OrderDraft,
  type OrderDraftContext,
} from './pricing'

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
const cuciSetrika = service('cuci-setrika', { name: 'Cuci setrika', min_qty: 2 })
const cuciKering = service('cuci-kering', { name: 'Cuci kering', price: 6_000, price_express: 10_000 })
const setrikaSaja = service('setrika-saja', { name: 'Setrika saja', price: 5_000, price_express: null, days_regular: 2, days_express: null })
const bedCover = service('bed-cover', { name: 'Bed cover', unit: 'pcs', price: 25_000, price_express: null, days_regular: 3, days_express: null })
const sepatu = service('sepatu', { name: 'Sepatu', unit: 'pcs', price: 35_000, price_express: null, days_regular: 4, days_express: null })
const services = [cuciSetrika, cuciKering, setrikaSaja, bedCover, sepatu]

const order = (id: string, over: Partial<Order> = {}): Order => ({
  id,
  order_number: 'LD-202610-0001',
  customer_id: 'c1',
  received_at: '2026-10-19',
  promised_at: '2026-10-22',
  express: false,
  status: 'received',
  ready_at: null,
  picked_up_at: null,
  discount: 0,
  notes: null,
  ...ts,
  ...over,
})
const item = (order_id: string, line_total: number, over: Partial<OrderItem> = {}): OrderItem => ({
  id: `${order_id}-${line_total}-${over.customer_package_id ?? ''}`,
  order_id,
  service_id: 'cuci-setrika',
  service_name: 'Cuci setrika',
  unit: 'kg',
  unit_price: 8_000,
  qty: 1,
  line_total,
  customer_package_id: null,
  notes: null,
  ...ts,
  ...over,
})
const payment = (order_id: string, amount: number): Payment => ({ id: `${order_id}-${amount}`, order_id, amount, paid_at: '2026-10-19', method: 'cash', notes: null, created_by: null, ...ts })
const pkg = (over: Partial<CustomerPackage> = {}): CustomerPackage => ({
  id: 'pkg-1',
  customer_id: 'c1',
  catalog_id: 'cat-1',
  name: 'Paket 20 kg cuci setrika',
  service_id: 'cuci-setrika',
  qty_total: 20,
  price: 140_000,
  purchased_at: '2026-09-01',
  expires_at: '2026-10-31',
  method: 'cash',
  notes: null,
  ...ts,
  ...over,
})

describe('quantities and prices (SPEC 3.12)', () => {
  it('raises the qty to the minimum, nothing else', () => {
    expect(effectiveQty(1.5, 2)).toBe(2)
    expect(effectiveQty(2, 2)).toBe(2)
    expect(effectiveQty(3.5, 2)).toBe(3.5)
    expect(effectiveQty(0.5, 0)).toBe(0.5)
  })

  it('rounds the line to whole rupiah like PostgreSQL round(numeric)', () => {
    expect(lineTotal(2.5, 8_000)).toBe(20_000)
    expect(lineTotal(1, 25_000)).toBe(25_000)
    // 2.55 x 7.000 = 17.850 exactly; float math gives 17849.999999999996
    expect(lineTotal(2.55, 7_000)).toBe(17_850)
    // .5 rounds up (half away from zero for positive amounts)
    expect(lineTotal(0.25, 7_002)).toBe(1_751)
    expect(lineTotal(0.33, 1_000)).toBe(330)
    expect(lineTotal(3, 0)).toBe(0)
  })

  it('keeps kg to two decimals', () => {
    expect(roundQty(2.675)).toBe(2.68)
    expect(roundQty(0.1 + 0.2)).toBe(0.3)
    expect(qtyProblem(2.5, 'kg')).toBeNull()
    expect(qtyProblem(2.555, 'kg')).toBe(ERR_QTY_KG_DECIMALS)
    expect(qtyProblem(1.5, 'pcs')).toBe(ERR_QTY_PCS_WHOLE)
    expect(qtyProblem(0, 'kg')).toBe(ERR_QTY_POSITIVE)
    expect(qtyProblem(-1, 'pcs')).toBe(ERR_QTY_POSITIVE)
    expect(qtyProblem(Number.NaN, 'kg')).toBe(ERR_QTY_POSITIVE)
  })

  it('picks the express price only where one exists', () => {
    expect(unitPrice(cuciSetrika, false)).toBe(8_000)
    expect(unitPrice(cuciSetrika, true)).toBe(13_000)
    expect(unitPrice(setrikaSaja, false)).toBe(5_000)
    expect(() => unitPrice(setrikaSaja, true)).toThrow('Layanan Setrika saja tidak ada harga express.')
    expect(noExpressMessage('Bed cover')).toBe('Layanan Bed cover tidak ada harga express.')
  })
})

describe('orderTotals (SPEC 3.3)', () => {
  const o = order('o1', { discount: 5_000 })
  const items = [item('o1', 20_000), item('o1', 25_000), item('other', 99_000)]

  it('derives subtotal, total, paid and the pay status from rows of this order only', () => {
    expect(orderTotals(o, items, [])).toEqual({ subtotal: 45_000, discount: 5_000, total: 40_000, paid: 0, outstanding: 40_000, payStatus: 'belum' })
    expect(orderTotals(o, items, [payment('o1', 15_000), payment('other', 1)])).toMatchObject({ paid: 15_000, outstanding: 25_000, payStatus: 'sebagian' })
    expect(orderTotals(o, items, [payment('o1', 15_000), payment('o1', 25_000)])).toMatchObject({ paid: 40_000, outstanding: 0, payStatus: 'lunas' })
  })

  it('a zero total is lunas; a cancelled order owes nothing', () => {
    expect(orderTotals(order('o2'), [item('o2', 0)], [])).toMatchObject({ total: 0, outstanding: 0, payStatus: 'lunas' })
    expect(orderTotals(order('o3', { status: 'cancelled' }), [item('o3', 30_000)], [])).toMatchObject({ total: 30_000, outstanding: 0, payStatus: 'belum' })
    // a discount larger than the subtotal (bad data) never gives a negative total
    expect(orderTotals(order('o4', { discount: 50_000 }), [item('o4', 30_000)], []).total).toBe(0)
  })

  it('flags late orders only while they are not ready', () => {
    expect(isOrderLate(order('x', { promised_at: '2026-10-18', status: 'processing' }), '2026-10-19')).toBe(true)
    expect(isOrderLate(order('x', { promised_at: '2026-10-19', status: 'received' }), '2026-10-19')).toBe(false)
    expect(isOrderLate(order('x', { promised_at: '2026-10-18', status: 'ready' }), '2026-10-19')).toBe(false)
    expect(isOrderLate(order('x', { promised_at: null, status: 'received' }), '2026-10-19')).toBe(false)
  })
})

describe('promisedDate (SPEC 3.3, 3.12)', () => {
  it('adds the longest working time of the items, regular or express', () => {
    expect(promisedDate('2026-10-19', [cuciSetrika, setrikaSaja], false)).toBe('2026-10-22')
    expect(promisedDate('2026-10-19', [cuciSetrika, cuciKering], true)).toBe('2026-10-20')
    // a service without days_express falls back to its regular days
    expect(promisedDate('2026-10-19', [cuciKering, sepatu], true)).toBe('2026-10-23')
    expect(promisedDate('2026-10-30', [sepatu], false)).toBe('2026-11-03')
    expect(promisedDate('2026-10-19', [], false)).toBe('2026-10-19')
  })
})

describe('nextOrderNumber (SPEC 3.3)', () => {
  it('continues the month, starts each month at 0001 and ignores other formats', () => {
    expect(nextOrderNumber([], '2026-10-19')).toBe('LD-202610-0001')
    expect(nextOrderNumber(['LD-202610-0003', 'LD-202610-0001', 'LD-202609-0040'], '2026-10-19')).toBe('LD-202610-0004')
    expect(nextOrderNumber(['LD-202610-0003'], '2026-11-01')).toBe('LD-202611-0001')
    expect(nextOrderNumber(['INV-202610-0009', 'LD-202610-12'], '2026-10-19')).toBe('LD-202610-0013')
    expect(nextOrderNumber(['LD-202610-9999'], '2026-10-19')).toBe('LD-202610-10000')
    expect(nextOrderNumber(new Set(['LD-202610-0002']), '2026-10-19')).toBe('LD-202610-0003')
  })
})

describe('prepaid packages (SPEC 3.4)', () => {
  const p = pkg()
  const orders = [order('o1'), order('o2', { status: 'cancelled' }), order('o3', { status: 'done' })]

  it('remaining = total minus the qty on orders that are not cancelled', () => {
    const items = [
      item('o1', 0, { qty: 3, customer_package_id: 'pkg-1', unit_price: 0 }),
      item('o2', 0, { qty: 5, customer_package_id: 'pkg-1', unit_price: 0 }),
      item('o3', 0, { qty: 4.5, customer_package_id: 'pkg-1', unit_price: 0 }),
      item('o3', 0, { qty: 2, customer_package_id: 'pkg-other', unit_price: 0 }),
      item('o3', 16_000, { qty: 2 }),
    ]
    expect(packageRemaining(p, items, orders)).toBe(12.5)
    expect(packageRemaining(p, [], orders)).toBe(20)
    // an item whose order is unknown still counts
    expect(packageRemaining(p, [item('o9', 0, { qty: 1, customer_package_id: 'pkg-1' })], orders)).toBe(19)
    expect(packageRemaining(pkg({ qty_total: 1 }), [item('o1', 0, { qty: 0.1, customer_package_id: 'pkg-1' }), item('o1', 0, { qty: 0.2, customer_package_id: 'pkg-1' })], orders)).toBe(0.7)
  })

  it('is usable for the same customer and service while not expired on the received date', () => {
    expect(packageProblem(p, 'c1', 'cuci-setrika', '2026-10-19')).toBeNull()
    expect(packageUsable(p, 'c1', 'cuci-setrika', '2026-10-31')).toBe(true)
    expect(packageProblem(p, 'c2', 'cuci-setrika', '2026-10-19')).toBe(ERR_PACKAGE_OTHER_CUSTOMER)
    expect(packageProblem(p, 'c1', 'cuci-kering', '2026-10-19')).toBe(ERR_PACKAGE_OTHER_SERVICE)
    expect(packageProblem(p, 'c1', 'cuci-setrika', '2026-11-01')).toBe(ERR_PACKAGE_EXPIRED)
    expect(packageUsable(pkg({ expires_at: null }), 'c1', 'cuci-setrika', '2099-01-01')).toBe(true)
    expect(packageInsufficientMessage(2.5, 'kg')).toBe('Sisa paket tidak cukup (sisa 2,5 kg).')
  })
})

describe('priceDraftItems', () => {
  it('copies the service, applies the minimum and the express price, zero for package items', () => {
    const priced = priceDraftItems(
      [
        { service_id: 'cuci-setrika', qty: 1.5, notes: ' noda ' },
        { service_id: 'bed-cover', qty: 2 },
        { service_id: 'cuci-setrika', qty: 3, customer_package_id: 'pkg-1' },
      ],
      services,
      false,
    )
    expect(priced).toEqual([
      { service_id: 'cuci-setrika', service_name: 'Cuci setrika', unit: 'kg', qty: 2, unit_price: 8_000, line_total: 16_000, customer_package_id: null, notes: 'noda' },
      { service_id: 'bed-cover', service_name: 'Bed cover', unit: 'pcs', qty: 2, unit_price: 25_000, line_total: 50_000, customer_package_id: null, notes: null },
      { service_id: 'cuci-setrika', service_name: 'Cuci setrika', unit: 'kg', qty: 3, unit_price: 0, line_total: 0, customer_package_id: 'pkg-1', notes: null },
    ])
    expect(priceDraftItems([{ service_id: 'cuci-kering', qty: 2.5 }], services, true)[0]).toMatchObject({ unit_price: 10_000, line_total: 25_000 })
  })

  it('throws the same Indonesian messages validateOrderDraft lists', () => {
    expect(() => priceDraftItems([{ service_id: 'nope', qty: 1 }], services, false)).toThrow(ERR_SERVICE_UNKNOWN)
    expect(() => priceDraftItems([{ service_id: 'bed-cover', qty: 1.5 }], services, false)).toThrow(ERR_QTY_PCS_WHOLE)
    expect(() => priceDraftItems([{ service_id: 'setrika-saja', qty: 1 }], services, true)).toThrow(noExpressMessage('Setrika saja'))
  })
})

describe('validateOrderDraft', () => {
  const ctx: OrderDraftContext = {
    services,
    packages: [pkg()],
    orderItems: [item('o-old', 0, { qty: 18, customer_package_id: 'pkg-1', unit_price: 0 })],
    orders: [order('o-old', { status: 'done' })],
  }
  const draft: OrderDraft = { customer_id: 'c1', received_at: '2026-10-19', express: false, discount: 0, items: [{ service_id: 'cuci-setrika', qty: 3 }] }

  it('accepts a sound draft', () => {
    expect(validateOrderDraft(draft, ctx)).toEqual([])
    expect(validateOrderDraft({ ...draft, discount: 24_000, payment: 0 }, ctx)).toEqual([])
  })

  it('needs a customer and at least one item', () => {
    expect(validateOrderDraft({ ...draft, customer_id: null, items: [] }, ctx)).toEqual([ERR_NO_CUSTOMER, ERR_NO_ITEMS])
    expect(validateOrderDraft({ ...draft, customer_id: '' }, ctx)).toEqual([ERR_NO_CUSTOMER])
  })

  it('checks every item: service, qty, express price', () => {
    expect(validateOrderDraft({ ...draft, items: [{ service_id: 'cuci-setrika', qty: 0 }, { service_id: 'bed-cover', qty: 1.5 }, { service_id: 'x', qty: 1 }] }, ctx)).toEqual([
      ERR_QTY_POSITIVE,
      ERR_QTY_PCS_WHOLE,
      ERR_SERVICE_UNKNOWN,
    ])
    expect(validateOrderDraft({ ...draft, express: true, items: [{ service_id: 'cuci-setrika', qty: 2 }, { service_id: 'setrika-saja', qty: 2 }, { service_id: 'bed-cover', qty: 1 }] }, ctx)).toEqual([
      noExpressMessage('Setrika saja'),
      noExpressMessage('Bed cover'),
    ])
    // a package item is free, so a missing express price does not matter for it
    expect(validateOrderDraft({ ...draft, express: true, items: [{ service_id: 'cuci-setrika', qty: 2, customer_package_id: 'pkg-1' }] }, ctx)).toEqual([])
  })

  it('checks the package: owner, service, expiry, remaining qty across the draft', () => {
    const withPkg = (items: OrderDraft['items'], over: Partial<OrderDraft> = {}) => validateOrderDraft({ ...draft, ...over, items }, ctx)
    expect(withPkg([{ service_id: 'cuci-setrika', qty: 2, customer_package_id: 'pkg-1' }])).toEqual([])
    expect(withPkg([{ service_id: 'cuci-setrika', qty: 2, customer_package_id: 'pkg-9' }])).toEqual([ERR_PACKAGE_UNKNOWN])
    expect(withPkg([{ service_id: 'cuci-setrika', qty: 2, customer_package_id: 'pkg-1' }], { customer_id: 'c2' })).toEqual([ERR_PACKAGE_OTHER_CUSTOMER])
    expect(withPkg([{ service_id: 'cuci-kering', qty: 2, customer_package_id: 'pkg-1' }])).toEqual([ERR_PACKAGE_OTHER_SERVICE])
    expect(withPkg([{ service_id: 'cuci-setrika', qty: 2, customer_package_id: 'pkg-1' }], { received_at: '2026-11-01' })).toEqual([ERR_PACKAGE_EXPIRED])
    // 18 of 20 used: 2 left; the minimum (2 kg) is applied before the check; two lines add up
    expect(withPkg([{ service_id: 'cuci-setrika', qty: 2.5, customer_package_id: 'pkg-1' }])).toEqual([packageInsufficientMessage(2, 'kg')])
    expect(withPkg([{ service_id: 'cuci-setrika', qty: 1, customer_package_id: 'pkg-1' }, { service_id: 'cuci-setrika', qty: 1, customer_package_id: 'pkg-1' }])).toEqual([packageInsufficientMessage(2, 'kg')])
    // editing the order that used the 18 kg: its own items do not count
    expect(validateOrderDraft({ ...draft, items: [{ service_id: 'cuci-setrika', qty: 15, customer_package_id: 'pkg-1' }] }, { ...ctx, excludeOrderId: 'o-old' })).toEqual([])
  })

  it('checks the discount and the down payment against the priced items', () => {
    // 3 kg x 8.000 = 24.000
    expect(validateOrderDraft({ ...draft, discount: -1 }, ctx)).toEqual([ERR_DISCOUNT_NEGATIVE])
    expect(validateOrderDraft({ ...draft, discount: 24_001 }, ctx)).toEqual([ERR_DISCOUNT_EXCEEDS])
    expect(validateOrderDraft({ ...draft, payment: -5 }, ctx)).toEqual([ERR_PAYMENT_NEGATIVE])
    expect(validateOrderDraft({ ...draft, discount: 4_000, payment: 20_001 }, ctx)).toEqual([ERR_PAYMENT_EXCEEDS])
    expect(validateOrderDraft({ ...draft, discount: 4_000, payment: 20_000 }, ctx)).toEqual([])
    // the money checks wait until the items are right
    expect(validateOrderDraft({ ...draft, items: [{ service_id: 'x', qty: 1 }], discount: 1, payment: 1 }, ctx)).toEqual([ERR_SERVICE_UNKNOWN])
  })
})
