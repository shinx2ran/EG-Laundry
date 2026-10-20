import { describe, expect, it } from 'vitest'
import type { Customer, CustomerPackage, Order, OrderItem, OrderStatus, Payment, PaymentMethod, Unit } from '../../types/db'
import {
  LAMA_DEFAULT_DAYS,
  PRESET_PARAM,
  absentCustomers,
  buildLaporan,
  chartGranularity,
  chartSeries,
  comparableRanges,
  customerPeriodText,
  customerReport,
  describeDelta,
  formatPct,
  moneyIn,
  ordersInRange,
  parseLamaDays,
  parsePresetParam,
  piutang,
  previousRange,
  rangeForPreset,
  rangeLabel,
  resolveRange,
  splitPercent,
  summarizeOrders,
  tenantSplit,
} from './reportModel'

// ---------------------------------------------------------------- fixed data (today = Tuesday 20 Oct 2026)

const TODAY = '2026-10-20'
const OCT = { start: '2026-10-01', end: '2026-10-31' }
const ts = { org_id: 'org', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

function customer(id: string, name: string, opts: { tenant?: boolean; phone?: string | null; room?: string | null } = {}): Customer {
  return { id, name, phone: opts.phone === undefined ? '0812-1111-0000' : opts.phone, is_tenant: opts.tenant ?? false, room_name: opts.room ?? null, kos_tenant_id: null, address: null, notes: null, ...ts }
}

function order(id: string, customerId: string, receivedAt: string, status: OrderStatus, discount = 0): Order {
  return { id, order_number: `LD-${id}`, customer_id: customerId, received_at: receivedAt, promised_at: null, express: false, status, ready_at: null, picked_up_at: null, discount, notes: null, ...ts }
}

let itemSeq = 0
function item(orderId: string, name: string, unit: Unit, qty: number, unitPrice: number, pkg: string | null = null): OrderItem {
  const price = pkg ? 0 : unitPrice
  return { id: `i${++itemSeq}`, order_id: orderId, service_id: null, service_name: name, unit, unit_price: price, qty, line_total: Math.round(qty * price), customer_package_id: pkg, notes: null, ...ts }
}

function payment(orderId: string, amount: number, paidAt: string, method: PaymentMethod): Payment {
  return { id: `p-${orderId}-${paidAt}`, order_id: orderId, amount, paid_at: paidAt, method, notes: null, created_by: null, ...ts }
}

function pkg(id: string, customerId: string, price: number, purchasedAt: string, method: PaymentMethod): CustomerPackage {
  return { id, customer_id: customerId, catalog_id: null, name: 'Paket 20 kg', service_id: 's', qty_total: 20, price, purchased_at: purchasedAt, expires_at: null, method, notes: null, ...ts }
}

const ani = customer('c1', 'Ani', { tenant: true, room: 'A1' })
const budi = customer('c2', 'Budi')
const citra = customer('c3', 'Citra', { tenant: true, room: 'B2', phone: null })
const dedi = customer('c4', 'Dedi')
const customers = [ani, budi, citra, dedi]

const orders = [
  order('o1', 'c1', '2026-10-05', 'done'),
  order('o2', 'c2', '2026-10-19', 'ready', 2_000),
  order('o3', 'c1', '2026-10-20', 'received'),
  order('o4', 'c2', '2026-10-10', 'cancelled'),
  order('o5', 'c3', '2026-09-15', 'done'),
  order('o6', 'c3', '2026-09-25', 'done'),
]
const items = [
  item('o1', 'Cuci setrika', 'kg', 3, 8_000), // 24.000
  item('o1', 'Bed cover', 'pcs', 1, 25_000), // 25.000
  item('o2', 'Cuci kering', 'kg', 4.5, 6_000), // 27.000 (- 2.000 discount)
  item('o3', 'Cuci setrika', 'kg', 2.5, 8_000, 'k1'), // from the package: Rp 0
  item('o4', 'Cuci kering', 'kg', 2, 6_000), // cancelled
  item('o5', 'Cuci setrika', 'kg', 5, 8_000), // 40.000
  item('o6', 'Selimut', 'pcs', 1, 20_000), // 20.000
]
const payments = [
  payment('o1', 49_000, '2026-10-07', 'cash'),
  payment('o2', 10_000, '2026-10-19', 'qris'),
  payment('o5', 40_000, '2026-09-18', 'transfer'),
  payment('o6', 5_000, '2026-10-02', 'cash'),
]
const packages = [pkg('k1', 'c1', 140_000, '2026-10-01', 'transfer'), pkg('k2', 'c2', 140_000, '2026-08-01', 'cash')]

// ---------------------------------------------------------------- ranges

describe('ranges', () => {
  it('Hari ini, Minggu ini (Senin–Minggu), Bulan ini, Tahun ini', () => {
    expect(rangeForPreset('today', TODAY)).toEqual({ start: TODAY, end: TODAY })
    expect(rangeForPreset('week', TODAY)).toEqual({ start: '2026-10-19', end: '2026-10-25' })
    // Monday and Sunday belong to the same week
    expect(rangeForPreset('week', '2026-10-19')).toEqual({ start: '2026-10-19', end: '2026-10-25' })
    expect(rangeForPreset('week', '2026-10-25')).toEqual({ start: '2026-10-19', end: '2026-10-25' })
    // a week across the new year
    expect(rangeForPreset('week', '2027-01-01')).toEqual({ start: '2026-12-28', end: '2027-01-03' })
    expect(rangeForPreset('month', TODAY)).toEqual(OCT)
    expect(rangeForPreset('month', '2028-02-10')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
    expect(rangeForPreset('year', TODAY)).toEqual({ start: '2026-01-01', end: '2026-12-31' })
  })

  it('the previous period: day, week, calendar month / year, a custom range of the same length', () => {
    expect(previousRange({ start: TODAY, end: TODAY }, 'today')).toEqual({ start: '2026-10-19', end: '2026-10-19' })
    expect(previousRange({ start: '2026-10-19', end: '2026-10-25' }, 'week')).toEqual({ start: '2026-10-12', end: '2026-10-18' })
    expect(previousRange({ start: '2026-03-01', end: '2026-03-31' }, 'month')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(previousRange({ start: '2026-01-01', end: '2026-01-31' }, 'month')).toEqual({ start: '2025-12-01', end: '2025-12-31' })
    expect(previousRange({ start: '2026-01-01', end: '2026-12-31' }, 'year')).toEqual({ start: '2025-01-01', end: '2025-12-31' })
    expect(previousRange({ start: '2026-10-10', end: '2026-10-19' }, 'custom')).toEqual({ start: '2026-09-30', end: '2026-10-09' })
  })

  it('a running range is compared up to today with the same span of the previous period', () => {
    expect(comparableRanges(OCT, 'month', TODAY)).toEqual({
      current: { start: '2026-10-01', end: TODAY },
      previous: { start: '2026-09-01', end: '2026-09-20' },
      isPartial: true,
    })
    // capped at the end of a shorter month
    expect(comparableRanges({ start: '2026-03-01', end: '2026-03-31' }, 'month', '2026-03-30').previous).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    // the last day, a finished and a future range are compared whole
    expect(comparableRanges(OCT, 'month', '2026-10-31')).toEqual({ current: OCT, previous: { start: '2026-09-01', end: '2026-09-30' }, isPartial: false })
    expect(comparableRanges({ start: '2026-09-01', end: '2026-09-30' }, 'custom', TODAY).isPartial).toBe(false)
    expect(comparableRanges({ start: '2026-11-01', end: '2026-11-30' }, 'month', TODAY).current).toEqual({ start: '2026-11-01', end: '2026-11-30' })
    // Hari ini vs kemarin
    expect(comparableRanges({ start: TODAY, end: TODAY }, 'today', TODAY)).toEqual({
      current: { start: TODAY, end: TODAY },
      previous: { start: '2026-10-19', end: '2026-10-19' },
      isPartial: false,
    })
  })

  it('reads the query string: presets from today, Khusus from dari/sampai', () => {
    expect(parsePresetParam(PRESET_PARAM.week)).toBe('week')
    expect(parsePresetParam('xx')).toBe('month')
    expect(parsePresetParam(null)).toBe('month')
    expect(resolveRange({ periode: null, from: null, to: null }, TODAY)).toEqual({ preset: 'month', range: OCT })
    expect(resolveRange({ periode: 'hari', from: '2020-01-01', to: '2020-01-02' }, TODAY)).toEqual({ preset: 'today', range: { start: TODAY, end: TODAY } })
    expect(resolveRange({ periode: 'tahun', from: null, to: null }, TODAY).range).toEqual({ start: '2026-01-01', end: '2026-12-31' })
    expect(resolveRange({ periode: 'khusus', from: '2026-09-10', to: '2026-10-05' }, TODAY)).toEqual({ preset: 'custom', range: { start: '2026-09-10', end: '2026-10-05' } })
    // reversed dates are swapped, invalid ones fall back to this month's ends
    expect(resolveRange({ periode: 'khusus', from: '2026-10-05', to: '2026-09-10' }, TODAY).range).toEqual({ start: '2026-09-10', end: '2026-10-05' })
    expect(resolveRange({ periode: 'khusus', from: '2026-02-30', to: 'kemarin' }, TODAY).range).toEqual(OCT)
  })

  it('range labels', () => {
    expect(rangeLabel(OCT)).toBe('1 Okt 2026 – 31 Okt 2026')
    expect(rangeLabel({ start: TODAY, end: TODAY })).toBe('20 Okt 2026')
  })
})

// ---------------------------------------------------------------- money

describe('uang masuk (payments by paid_at + packages by purchased_at)', () => {
  it('totals, per source, per method and per day', () => {
    const m = moneyIn(payments, packages, OCT)
    expect(m.fromPayments).toBe(49_000 + 10_000 + 5_000)
    expect(m.fromPackages).toBe(140_000)
    expect(m.total).toBe(204_000)
    expect(m.byMethod).toEqual({ cash: 54_000, transfer: 140_000, qris: 10_000 })
    expect(m.byDay).toHaveLength(31)
    expect(m.byDay[0]).toEqual({ date: '2026-10-01', amount: 140_000 })
    expect(m.byDay[1]).toEqual({ date: '2026-10-02', amount: 5_000 })
    expect(m.byDay.find((d) => d.date === '2026-10-07')?.amount).toBe(49_000)
    expect(m.byDay.reduce((s, d) => s + d.amount, 0)).toBe(m.total)
    // September: one transfer; August: one package
    expect(moneyIn(payments, packages, { start: '2026-09-01', end: '2026-09-30' }).total).toBe(40_000)
    expect(moneyIn(payments, packages, { start: '2026-08-01', end: '2026-08-31' })).toMatchObject({ total: 140_000, fromPackages: 140_000, byMethod: { cash: 140_000, transfer: 0, qris: 0 } })
    expect(moneyIn(payments, packages, OCT, { withDays: false }).byDay).toEqual([])
  })

  it('the chart: per day up to two months, per month beyond', () => {
    expect(chartGranularity(OCT)).toBe('day')
    expect(chartGranularity({ start: '2026-09-01', end: '2026-10-31' })).toBe('day')
    expect(chartGranularity({ start: '2026-01-01', end: '2026-12-31' })).toBe('month')
    const days = moneyIn(payments, packages, { start: '2026-09-01', end: '2026-10-31' }).byDay
    expect(chartSeries(days, 'day')[0]).toEqual({ key: '2026-09-01', label: '1 Sep', amount: 0 })
    expect(chartSeries(days, 'month')).toEqual([
      { key: '2026-09', label: 'Sep 2026', amount: 40_000 },
      { key: '2026-10', label: 'Okt 2026', amount: 204_000 },
    ])
  })
})

// ---------------------------------------------------------------- orders

describe('orders of the range (received_at, not cancelled) and per service', () => {
  it('counts, kg, pcs and value; package lines count in kg with Rp 0', () => {
    expect(ordersInRange(orders, OCT).map((o) => o.id)).toEqual(['o1', 'o2', 'o3'])
    const s = summarizeOrders(orders, items, OCT)
    expect(s).toMatchObject({ count: 3, kg: 10, pcs: 1, value: 74_000, subtotal: 76_000, discount: 2_000 })
    expect(s.services).toEqual([
      { key: 'cuci kering|kg', service_name: 'Cuci kering', unit: 'kg', orders: 1, qty: 4.5, qtyFromPackage: 0, value: 27_000 },
      { key: 'bed cover|pcs', service_name: 'Bed cover', unit: 'pcs', orders: 1, qty: 1, qtyFromPackage: 0, value: 25_000 },
      { key: 'cuci setrika|kg', service_name: 'Cuci setrika', unit: 'kg', orders: 2, qty: 5.5, qtyFromPackage: 2.5, value: 24_000 },
    ])
    // Σ per service - discount = order value
    expect(s.services.reduce((sum, r) => sum + r.value, 0) - s.discount).toBe(s.value)
  })

  it('groups by the snapshot name and unit, not by the current price list', () => {
    const extra = [order('x1', 'c2', '2026-10-11', 'done')]
    const lines = [item('x1', 'cuci setrika ', 'kg', 1.25, 8_000), item('x1', 'Cuci setrika', 'kg', 1, 8_000), item('x1', 'Cuci setrika', 'pcs', 2, 1_000)]
    const s = summarizeOrders(extra, lines, OCT)
    expect(s.services.map((r) => [r.key, r.orders, r.qty])).toEqual([
      ['cuci setrika|kg', 1, 2.25],
      ['cuci setrika|pcs', 1, 2],
    ])
    expect(s.kg).toBe(2.25)
  })

  it('an empty range', () => {
    expect(summarizeOrders(orders, items, { start: '2025-01-01', end: '2025-01-31' })).toEqual({ count: 0, kg: 0, pcs: 0, value: 0, subtotal: 0, discount: 0, services: [] })
  })
})

describe('piutang (outstanding of non-cancelled orders)', () => {
  it('now and as it stood on a day', () => {
    // o2: 25.000 - 10.000; o6: 20.000 - 5.000
    expect(piutang(orders, items, payments)).toBe(30_000)
    // 30 Sep: o6 was received and not paid yet; o5 was paid on 18 Sep
    expect(piutang(orders, items, payments, '2026-09-30')).toBe(20_000)
    expect(piutang(orders, items, payments, '2026-09-16')).toBe(40_000)
    expect(piutang(orders, items, payments, '2026-09-01')).toBe(0)
  })

  it('a cancelled order owes nothing', () => {
    expect(piutang([order('z', 'c1', '2026-10-01', 'cancelled')], [item('z', 'Cuci kering', 'kg', 2, 6_000)], [])).toBe(0)
  })
})

// ---------------------------------------------------------------- anak kos vs umum

describe('anak kos vs umum', () => {
  it('orders, kg, value and uang masuk with whole percentages that add up to 100', () => {
    const split = tenantSplit({ customers, orders, items, payments, packages }, OCT)
    expect(split.tenant).toEqual({ orders: 2, kg: 5.5, value: 49_000, moneyIn: 49_000 + 5_000 + 140_000 })
    expect(split.walkin).toEqual({ orders: 1, kg: 4.5, value: 25_000, moneyIn: 10_000 })
    expect(split.total).toEqual({ orders: 3, kg: 10, value: 74_000, moneyIn: 204_000 })
    expect(split.tenantPct).toEqual({ orders: 67, kg: 55, value: 66, moneyIn: 95 })
    expect(split.walkinPct).toEqual({ orders: 33, kg: 45, value: 34, moneyIn: 5 })
  })

  it('shows "—" when there is nothing to divide', () => {
    const split = tenantSplit({ customers, orders, items, payments, packages }, { start: '2025-01-01', end: '2025-01-31' })
    expect(split.tenantPct).toEqual({ orders: null, kg: null, value: null, moneyIn: null })
    expect(formatPct(split.walkinPct.orders)).toBe('—')
  })

  it('splitPercent always sums to 100', () => {
    expect(splitPercent(1, 2)).toEqual([33, 67])
    expect(splitPercent(2, 1)).toEqual([67, 33])
    expect(splitPercent(1, 1)).toEqual([50, 50])
    expect(splitPercent(0, 5)).toEqual([0, 100])
    expect(splitPercent(1, 199)).toEqual([1, 99])
    expect(splitPercent(0, 0)).toBeNull()
    for (let a = 0; a < 40; a++) for (let b = 1; b < 40; b++) expect(splitPercent(a, b)!.reduce((x, y) => x + y)).toBe(100)
    expect(formatPct(33)).toBe('33%')
  })
})

// ---------------------------------------------------------------- customers

describe('customer table', () => {
  it('last visit, 30 / 90 days to today, the range figures, most orders first', () => {
    const rows = customerReport(customers, orders, items, OCT, TODAY)
    expect(rows.map((r) => r.customer.name)).toEqual(['Ani', 'Budi', 'Citra', 'Dedi'])
    expect(rows[0]).toMatchObject({ lastVisit: TODAY, orders30: 2, orders90: 2, ordersInRange: 2, kg: 5.5, pcs: 1, value: 49_000 })
    // the cancelled 10 Oct order is not a visit
    expect(rows[1]).toMatchObject({ lastVisit: '2026-10-19', orders30: 1, orders90: 1, ordersInRange: 1, kg: 4.5, value: 25_000 })
    // 25 Sep is within the 30 days ending today (21 Sep .. 20 Oct), 15 Sep only within 90
    expect(rows[2]).toMatchObject({ lastVisit: '2026-09-25', orders30: 1, orders90: 2, ordersInRange: 0, value: 0 })
    expect(rows[3]).toMatchObject({ lastVisit: null, orders30: 0, orders90: 0, ordersInRange: 0 })
  })

  it('a past range counts up to its own last day', () => {
    const rows = customerReport(customers, orders, items, { start: '2026-09-01', end: '2026-09-30' }, TODAY)
    expect(rows.map((r) => r.customer.name)).toEqual(['Citra', 'Ani', 'Budi', 'Dedi'])
    expect(rows[0]).toMatchObject({ lastVisit: '2026-09-25', orders30: 2, orders90: 2, ordersInRange: 2, kg: 5, pcs: 1, value: 60_000 })
    // Ani's October orders are after the range: no visit yet as of 30 Sep
    expect(rows[1].lastVisit).toBeNull()
  })

  it('ties on orders go to the latest visit, then the name', () => {
    const cs = [customer('a', 'Zaki'), customer('b', 'Yuni'), customer('c', 'Ahmad')]
    const os = [order('1', 'a', '2026-10-02', 'done'), order('2', 'b', '2026-10-05', 'done'), order('3', 'c', '2026-10-02', 'done')]
    expect(customerReport(cs, os, [], OCT, TODAY).map((r) => r.customer.name)).toEqual(['Yuni', 'Ahmad', 'Zaki'])
  })

  it('the range line of a row', () => {
    expect(customerPeriodText({ ordersInRange: 3, kg: 11.5, pcs: 1, value: 27_000 })).toBe('3 pesanan · 11,5 kg + 1 pcs · Rp 27.000')
    expect(customerPeriodText({ ordersInRange: 1, kg: 0, pcs: 2, value: 50_000 })).toBe('1 pesanan · 2 pcs · Rp 50.000')
    expect(customerPeriodText({ ordersInRange: 0, kg: 0, pcs: 0, value: 0 })).toBe('Tidak ada pesanan pada periode ini')
  })
})

describe('lama tidak datang', () => {
  it('customers with a visit, last one more than N days ago, longest absence first', () => {
    expect(absentCustomers(customers, orders, TODAY, 21).map((r) => [r.customer.name, r.daysAway, r.lastVisit, r.orderCount])).toEqual([['Citra', 25, '2026-09-25', 2]])
    // exactly N days is not "more than"
    expect(absentCustomers(customers, orders, TODAY, 25)).toEqual([])
    // Budi's cancelled 10 Oct order does not count as a visit: his last one is 19 Oct
    expect(absentCustomers(customers, orders, TODAY, 0).map((r) => [r.customer.name, r.daysAway])).toEqual([
      ['Citra', 25],
      ['Budi', 1],
    ])
    // Dedi never came: never listed
    expect(absentCustomers(customers, orders, '2027-06-01', 1).map((r) => r.customer.name)).toEqual(['Citra', 'Budi', 'Ani'])
  })

  it('N: whole days 1..365, default 21', () => {
    expect(LAMA_DEFAULT_DAYS).toBe(21)
    expect(parseLamaDays('7')).toBe(7)
    expect(parseLamaDays(' 30 ')).toBe(30)
    expect(parseLamaDays(7.6)).toBe(8)
    expect(parseLamaDays('0')).toBe(1)
    expect(parseLamaDays('-4')).toBe(1)
    expect(parseLamaDays('1000')).toBe(365)
    expect(parseLamaDays('')).toBe(21)
    expect(parseLamaDays('tiga')).toBe(21)
    expect(parseLamaDays(null)).toBe(21)
    expect(parseLamaDays(Number.NaN)).toBe(21)
  })
})

// ---------------------------------------------------------------- formatting

describe('formatting', () => {
  it('describeDelta: arrow, absolute change and the share of the previous figure', () => {
    expect(describeDelta(120, 100, String)).toEqual({ direction: 'up', text: '▲ 20 (20%)' })
    expect(describeDelta(0, 50, String)).toEqual({ direction: 'down', text: '▼ 50 (100%)' })
    expect(describeDelta(5, 0, String)).toEqual({ direction: 'up', text: '▲ 5' })
    expect(describeDelta(3, 3, String)).toEqual({ direction: 'flat', text: '— sama' })
    // kg without float noise
    expect(describeDelta(10, 5.5, (n) => `${n} kg`).text).toBe('▲ 4.5 kg (82%)')
    expect(describeDelta(0.3, 0.1 + 0.2, String).direction).toBe('flat')
  })
})

// ---------------------------------------------------------------- the whole page

describe('buildLaporan', () => {
  const input = { customers, orders, orderItems: items, payments, customerPackages: packages }

  it('Bulan ini on 20 Oct: tiles, like-with-like comparison and the sections', () => {
    const r = buildLaporan(input, OCT, 'month', TODAY)
    expect(r.figures).toEqual({ moneyIn: 204_000, orders: 3, kg: 10, piutang: 30_000 })
    expect(r.comparison.previous).toEqual({ start: '2026-09-01', end: '2026-09-20' })
    expect(r.current).toEqual({ moneyIn: 204_000, orders: 3, kg: 10, piutang: 30_000 })
    // 1–20 Sep: o5 received and paid
    expect(r.previous).toEqual({ moneyIn: 40_000, orders: 1, kg: 5, piutang: 0 })
    expect(r.piutangAsOf).toBe(TODAY)
    expect(r.granularity).toBe('day')
    expect(r.chart).toHaveLength(31)
    expect(r.orders.services).toHaveLength(3)
    expect(r.split.total.orders).toBe(3)
    expect(r.customers[0].customer.name).toBe('Ani')
  })

  it('a finished custom range: piutang at its last day, compared with the span before', () => {
    const sep = { start: '2026-09-01', end: '2026-09-30' }
    const r = buildLaporan(input, sep, 'custom', TODAY)
    expect(r.piutangAsOf).toBe('2026-09-30')
    expect(r.figures).toEqual({ moneyIn: 40_000, orders: 2, kg: 5, piutang: 20_000 })
    expect(r.comparison).toEqual({ current: sep, previous: { start: '2026-08-02', end: '2026-08-31' }, isPartial: false })
    // 2–31 Aug: nothing (Budi's package was bought on 1 Aug)
    expect(r.previous).toEqual({ moneyIn: 0, orders: 0, kg: 0, piutang: 0 })
  })
})
