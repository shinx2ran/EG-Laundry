/**
 * Laporan (SPEC 3.7) as pure functions over the laundry tables: no React, no I/O, no clock. Every function takes
 * `today` / the range explicitly, so it is unit-tested with fixed data (reportModel.test.ts).
 *
 * Money definitions are exactly SPEC 3.5:
 *  - **Uang masuk** = Σ payments.amount by `paid_at` + Σ customer_packages.price by `purchased_at`.
 *  - **Piutang** = Σ outstanding (orderTotals) of the orders that are not cancelled.
 * Orders count by `received_at` and never when cancelled; quantities and per-service figures come from the
 * order_items snapshots (service_name, unit, qty, line_total), so a later price or name change never rewrites
 * history. Items paid by a prepaid package count in kg/pcs with Rp 0 (their line_total is 0).
 */
import type { Customer, CustomerPackage, Order, OrderItem, Payment, PaymentMethod, Unit } from '../../types/db'
import { PAYMENT_METHODS } from '../../types/db'
import { orderTotals, roundQty } from '../../domain/pricing'
import { addDaysISO, daysBetween, formatDate, formatMonth } from '../../lib/format'

/** What staff see on /laporan (SPEC 3.10: reports are for the owner and admins; the menu entry is hidden too). */
export const STAFF_MESSAGE = 'Laporan hanya untuk pemilik/admin.'

// =====================================================================================================================
// Ranges
// =====================================================================================================================

export const RANGE_PRESETS = ['today', 'week', 'month', 'year', 'custom'] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

export const RANGE_PRESET_LABEL: Record<RangePreset, string> = {
  today: 'Hari ini',
  week: 'Minggu ini',
  month: 'Bulan ini',
  year: 'Tahun ini',
  custom: 'Khusus',
}

/** Both ends included, 'YYYY-MM-DD'. */
export interface DateRange {
  start: string
  end: string
}

export const DEFAULT_PRESET: RangePreset = 'month'

/** `?periode=` value per preset (Indonesian, like `?jenis=kos` on Pelanggan). */
export const PRESET_PARAM: Record<RangePreset, string> = {
  today: 'hari',
  week: 'minggu',
  month: 'bulan',
  year: 'tahun',
  custom: 'khusus',
}

/** `?periode=` value -> preset; unknown or missing -> Bulan ini. */
export function parsePresetParam(value: string | null | undefined): RangePreset {
  for (const p of RANGE_PRESETS) if (PRESET_PARAM[p] === value) return p
  return DEFAULT_PRESET
}

function ymd(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return [y, m, d]
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** Calendar date from parts (day/month overflow is normalised: day 0 = last day of the previous month). */
function isoOf(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

/** Strict, calendar-valid 'YYYY-MM-DD' (no 2026-02-30). */
export function isISODate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = ymd(value)
  return isoOf(y, m, d) === value
}

/** Monday = 0 … Sunday = 6. */
function weekdayFromMonday(iso: string): number {
  const [y, m, d] = ymd(iso)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

/** The range of a preset around `today`: Hari ini, Minggu ini (Senin–Minggu), Bulan ini, Tahun ini. */
export function rangeForPreset(preset: Exclude<RangePreset, 'custom'>, today: string): DateRange {
  const [y, m] = ymd(today)
  switch (preset) {
    case 'today':
      return { start: today, end: today }
    case 'week': {
      const start = addDaysISO(today, -weekdayFromMonday(today))
      return { start, end: addDaysISO(start, 6) }
    }
    case 'month':
      return { start: isoOf(y, m, 1), end: isoOf(y, m + 1, 0) }
    case 'year':
      return { start: isoOf(y, 1, 1), end: isoOf(y, 12, 31) }
  }
}

/** Number of days in the range, both ends included (0 when reversed). */
export function rangeLength(range: DateRange): number {
  return Math.max(0, daysBetween(range.start, range.end) + 1)
}

/**
 * The period before: the day before, the week before, the previous calendar month / year; a custom range is
 * followed by the same number of days right before it.
 */
export function previousRange(range: DateRange, preset: RangePreset): DateRange {
  const [y, m] = ymd(range.start)
  switch (preset) {
    case 'today':
      return { start: addDaysISO(range.start, -1), end: addDaysISO(range.start, -1) }
    case 'week':
      return { start: addDaysISO(range.start, -7), end: addDaysISO(range.end, -7) }
    case 'month':
      return { start: isoOf(y, m - 1, 1), end: isoOf(y, m, 0) }
    case 'year':
      return { start: isoOf(y - 1, 1, 1), end: isoOf(y - 1, 12, 31) }
    case 'custom': {
      const end = addDaysISO(range.start, -1)
      return { start: addDaysISO(end, -(rangeLength(range) - 1)), end }
    }
  }
}

export interface Comparison {
  /** the part of the range that has happened (up to today) */
  current: DateRange
  /** the same span of the previous period */
  previous: DateRange
  /** true while the range is still running: "Oktober s/d tgl 20" vs "September s/d tgl 20" */
  isPartial: boolean
}

/**
 * Like with like: a range that is still running (today inside it, before its last day) is compared up to today with
 * the same number of days of the previous period (capped at its end: 31 March vs 28 February). A finished or future
 * range is compared whole with the whole previous period.
 */
export function comparableRanges(range: DateRange, preset: RangePreset, today: string): Comparison {
  const previous = previousRange(range, preset)
  if (today >= range.end || today < range.start) return { current: range, previous, isPartial: false }
  const elapsed = daysBetween(range.start, today)
  const prevEnd = addDaysISO(previous.start, elapsed)
  return {
    current: { start: range.start, end: today },
    previous: { start: previous.start, end: prevEnd < previous.end ? prevEnd : previous.end },
    isPartial: true,
  }
}

/**
 * Page state from the query string (?periode=khusus&dari=…&sampai=…). An unknown periode falls back to Bulan ini. A
 * preset is always re-derived from today; Khusus takes dari/sampai (swapped when reversed, Bulan ini's ends when
 * missing or invalid).
 */
export function resolveRange(params: { periode: string | null; from: string | null; to: string | null }, today: string): { preset: RangePreset; range: DateRange } {
  const preset = parsePresetParam(params.periode)
  if (preset !== 'custom') return { preset, range: rangeForPreset(preset, today) }
  const month = rangeForPreset('month', today)
  const from = isISODate(params.from) ? params.from : month.start
  const to = isISODate(params.to) ? params.to : month.end
  return { preset, range: from <= to ? { start: from, end: to } : { start: to, end: from } }
}

/** '20 Okt 2026' for one day, '1 Okt 2026 – 31 Okt 2026' otherwise. */
export function rangeLabel(range: DateRange): string {
  return range.start === range.end ? formatDate(range.start) : `${formatDate(range.start)} – ${formatDate(range.end)}`
}

export function inRange(iso: string, range: DateRange): boolean {
  const d = iso.slice(0, 10)
  return d >= range.start && d <= range.end
}

/** Every day of the range, oldest first (at most ~11 years, a guard against a typo like year 20266). */
export function daysInRange(range: DateRange): string[] {
  const n = Math.min(rangeLength(range), 4_000)
  const days: string[] = []
  for (let i = 0; i < n; i++) days.push(addDaysISO(range.start, i))
  return days
}

/** The earlier of two dates. */
export function minISO(a: string, b: string): string {
  return a <= b ? a : b
}

// =====================================================================================================================
// Uang masuk (SPEC 3.5)
// =====================================================================================================================

type PaymentRow = Pick<Payment, 'order_id' | 'amount' | 'paid_at' | 'method'>
type PackageRow = Pick<CustomerPackage, 'customer_id' | 'price' | 'purchased_at' | 'method'>

export interface DayAmount {
  /** 'YYYY-MM-DD' */
  date: string
  amount: number
}

export interface MoneyIn {
  total: number
  /** payments on orders, by paid_at */
  fromPayments: number
  /** prepaid packages sold, by purchased_at */
  fromPackages: number
  byMethod: Record<PaymentMethod, number>
  /** one entry per day of the range, zero days included */
  byDay: DayAmount[]
}

function emptyByMethod(): Record<PaymentMethod, number> {
  const out = {} as Record<PaymentMethod, number>
  for (const m of PAYMENT_METHODS) out[m] = 0
  return out
}

/** Uang masuk of the range: payments by paid_at + package purchases by purchased_at, per day and per method. */
export function moneyIn(payments: PaymentRow[], packages: PackageRow[], range: DateRange, opts: { withDays?: boolean } = {}): MoneyIn {
  const withDays = opts.withDays ?? true
  const perDay = new Map<string, number>()
  const byMethod = emptyByMethod()
  let fromPayments = 0
  let fromPackages = 0
  const add = (date: string, amount: number, method: PaymentMethod) => {
    if (withDays) perDay.set(date, (perDay.get(date) ?? 0) + amount)
    if (method in byMethod) byMethod[method] += amount
  }
  for (const p of payments) {
    if (!inRange(p.paid_at, range)) continue
    fromPayments += p.amount
    add(p.paid_at.slice(0, 10), p.amount, p.method)
  }
  for (const k of packages) {
    if (!inRange(k.purchased_at, range)) continue
    fromPackages += k.price
    add(k.purchased_at.slice(0, 10), k.price, k.method)
  }
  const byDay = withDays ? daysInRange(range).map((date) => ({ date, amount: perDay.get(date) ?? 0 })) : []
  return { total: fromPayments + fromPackages, fromPayments, fromPackages, byMethod, byDay }
}

export type ChartGranularity = 'day' | 'month'

export interface ChartPoint {
  /** 'YYYY-MM-DD' (day) or 'YYYY-MM' (month) */
  key: string
  /** axis label: '5 Okt' / 'Okt 2026' */
  label: string
  amount: number
}

/** Bars per day up to two months; a longer range (Tahun ini) is charted per month so the bars stay readable. */
export function chartGranularity(range: DateRange): ChartGranularity {
  return rangeLength(range) <= 62 ? 'day' : 'month'
}

/** The daily series as chart points, summed per month when `granularity` is 'month'. */
export function chartSeries(byDay: DayAmount[], granularity: ChartGranularity): ChartPoint[] {
  if (granularity === 'day') return byDay.map((d) => ({ key: d.date, label: formatDate(d.date, 'd MMM'), amount: d.amount }))
  const points: ChartPoint[] = []
  for (const d of byDay) {
    const key = d.date.slice(0, 7)
    const last = points[points.length - 1]
    if (last && last.key === key) last.amount += d.amount
    else points.push({ key, label: formatMonth(key), amount: d.amount })
  }
  return points
}

// =====================================================================================================================
// Orders and services
// =====================================================================================================================

type OrderRow = Pick<Order, 'id' | 'customer_id' | 'received_at' | 'status' | 'discount'>
type ItemRow = Pick<OrderItem, 'order_id' | 'service_name' | 'unit' | 'qty' | 'line_total' | 'customer_package_id'>

/** Orders received in the range that are not cancelled. */
export function ordersInRange<T extends Pick<Order, 'received_at' | 'status'>>(orders: T[], range: DateRange): T[] {
  return orders.filter((o) => o.status !== 'cancelled' && inRange(o.received_at, range))
}

export function groupItemsByOrder<T extends Pick<OrderItem, 'order_id'>>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const it of items) {
    const list = map.get(it.order_id)
    if (list) list.push(it)
    else map.set(it.order_id, [it])
  }
  return map
}

export interface ServiceRow {
  /** grouping key: the snapshot name (case-insensitive) + unit */
  key: string
  service_name: string
  unit: Unit
  /** orders with at least one line of this service */
  orders: number
  /** kg or pcs, packages included */
  qty: number
  /** the part of qty taken from prepaid packages (Rp 0) */
  qtyFromPackage: number
  /** Σ line_total, before the order discount */
  value: number
}

export interface OrdersSummary {
  count: number
  kg: number
  pcs: number
  /** Σ order total (line totals − discount) */
  value: number
  /** Σ line totals, before discounts (= Σ services[].value) */
  subtotal: number
  discount: number
  /** by value, then qty, then name */
  services: ServiceRow[]
}

/** Orders of the range (by received_at, not cancelled): count, kg, pcs, value and the per-service table. */
export function summarizeOrders(orders: OrderRow[], items: ItemRow[], range: DateRange, itemsByOrder?: Map<string, ItemRow[]>): OrdersSummary {
  const byOrder = itemsByOrder ?? groupItemsByOrder(items)
  const services = new Map<string, ServiceRow>()
  let count = 0
  let kg = 0
  let pcs = 0
  let value = 0
  let subtotal = 0
  let discount = 0
  for (const o of ordersInRange(orders, range)) {
    count++
    const lines = byOrder.get(o.id) ?? []
    const totals = orderTotals(o, lines, [])
    value += totals.total
    subtotal += totals.subtotal
    discount += totals.subtotal - totals.total
    const seen = new Set<string>()
    for (const it of lines) {
      if (it.unit === 'kg') kg += it.qty
      else pcs += it.qty
      const key = `${it.service_name.trim().toLowerCase()}|${it.unit}`
      let row = services.get(key)
      if (!row) {
        row = { key, service_name: it.service_name.trim(), unit: it.unit, orders: 0, qty: 0, qtyFromPackage: 0, value: 0 }
        services.set(key, row)
      }
      row.qty += it.qty
      if (it.customer_package_id) row.qtyFromPackage += it.qty
      row.value += it.line_total
      if (!seen.has(key)) {
        seen.add(key)
        row.orders++
      }
    }
  }
  const list = [...services.values()].map((r) => ({ ...r, qty: roundQty(r.qty), qtyFromPackage: roundQty(r.qtyFromPackage) }))
  list.sort((a, b) => b.value - a.value || b.qty - a.qty || a.service_name.localeCompare(b.service_name, 'id'))
  return { count, kg: roundQty(kg), pcs: roundQty(pcs), value, subtotal, discount, services: list }
}

// =====================================================================================================================
// Piutang (SPEC 3.5)
// =====================================================================================================================

/**
 * Σ outstanding of the orders that are not cancelled. With `asOf` it is the balance on that day: orders received up
 * to then, payments paid up to then (what was still owed at the end of that day). Without it: everything recorded,
 * the "piutang now" of the Dashboard.
 */
export function piutang(orders: OrderRow[], items: ItemRow[], payments: PaymentRow[], asOf?: string, itemsByOrder?: Map<string, ItemRow[]>): number {
  const byOrder = itemsByOrder ?? groupItemsByOrder(items)
  const paid = new Map<string, number>()
  for (const p of payments) {
    if (asOf !== undefined && p.paid_at.slice(0, 10) > asOf) continue
    paid.set(p.order_id, (paid.get(p.order_id) ?? 0) + p.amount)
  }
  let sum = 0
  for (const o of orders) {
    if (o.status === 'cancelled') continue
    if (asOf !== undefined && o.received_at > asOf) continue
    const totals = orderTotals(o, byOrder.get(o.id) ?? [], [])
    sum += Math.max(0, totals.total - (paid.get(o.id) ?? 0))
  }
  return sum
}

// =====================================================================================================================
// Anak kos vs umum
// =====================================================================================================================

export interface SegmentFigures {
  orders: number
  kg: number
  /** Σ order totals (Rp) */
  value: number
  /** payments of the segment's orders + its package purchases (Rp) */
  moneyIn: number
}

export type SegmentKey = keyof SegmentFigures

export const SEGMENT_KEYS: SegmentKey[] = ['orders', 'kg', 'value', 'moneyIn']

export interface TenantSplit {
  tenant: SegmentFigures
  walkin: SegmentFigures
  total: SegmentFigures
  /** whole percentages of the total that add up to 100, null (shown "—") when the total is 0 */
  tenantPct: Record<SegmentKey, number | null>
  walkinPct: Record<SegmentKey, number | null>
}

/**
 * Two whole percentages of a + b that always add up to 100 (the larger remainder takes the rounding), or null when
 * a + b is 0. 1 of 3 -> [33, 67]; 1 of 2 -> [50, 50].
 */
export function splitPercent(a: number, b: number): [number, number] | null {
  const total = a + b
  if (!(total > 0)) return null
  const pa = Math.round((a / total) * 100)
  return [pa, 100 - pa]
}

/** 33 -> '33%'; null -> '—' */
export function formatPct(pct: number | null): string {
  return pct === null ? '—' : `${pct}%`
}

function emptySegment(): SegmentFigures {
  return { orders: 0, kg: 0, value: 0, moneyIn: 0 }
}

/**
 * Anak kos (customers.is_tenant, as it is now) vs umum in the range: orders, kg and value by received_at (not
 * cancelled), uang masuk by paid_at / purchased_at. A row whose customer or order is unknown counts as umum.
 */
export function tenantSplit(
  input: {
    customers: Pick<Customer, 'id' | 'is_tenant'>[]
    orders: OrderRow[]
    items: ItemRow[]
    payments: PaymentRow[]
    packages: PackageRow[]
  },
  range: DateRange,
  itemsByOrder?: Map<string, ItemRow[]>,
): TenantSplit {
  const byOrder = itemsByOrder ?? groupItemsByOrder(input.items)
  const tenantIds = new Set<string>()
  for (const c of input.customers) if (c.is_tenant) tenantIds.add(c.id)
  const customerOfOrder = new Map<string, string>()
  for (const o of input.orders) customerOfOrder.set(o.id, o.customer_id)

  const tenant = emptySegment()
  const walkin = emptySegment()
  const seg = (customerId: string | undefined) => (customerId !== undefined && tenantIds.has(customerId) ? tenant : walkin)

  for (const o of ordersInRange(input.orders, range)) {
    const s = seg(o.customer_id)
    const lines = byOrder.get(o.id) ?? []
    s.orders++
    s.value += orderTotals(o, lines, []).total
    for (const it of lines) if (it.unit === 'kg') s.kg += it.qty
  }
  for (const p of input.payments) if (inRange(p.paid_at, range)) seg(customerOfOrder.get(p.order_id)).moneyIn += p.amount
  for (const k of input.packages) if (inRange(k.purchased_at, range)) seg(k.customer_id).moneyIn += k.price
  tenant.kg = roundQty(tenant.kg)
  walkin.kg = roundQty(walkin.kg)

  const total: SegmentFigures = {
    orders: tenant.orders + walkin.orders,
    kg: roundQty(tenant.kg + walkin.kg),
    value: tenant.value + walkin.value,
    moneyIn: tenant.moneyIn + walkin.moneyIn,
  }
  const tenantPct = {} as Record<SegmentKey, number | null>
  const walkinPct = {} as Record<SegmentKey, number | null>
  for (const key of SEGMENT_KEYS) {
    const pct = splitPercent(tenant[key], walkin[key])
    tenantPct[key] = pct ? pct[0] : null
    walkinPct[key] = pct ? pct[1] : null
  }
  return { tenant, walkin, total, tenantPct, walkinPct }
}

// =====================================================================================================================
// Customers
// =====================================================================================================================

export interface CustomerReportRow {
  customer: Customer
  /** newest received_at of a non-cancelled order up to the reference day; null = no visit yet */
  lastVisit: string | null
  /** non-cancelled orders in the 30 / 90 days that end on the reference day */
  orders30: number
  orders90: number
  /** non-cancelled orders received in the range, their kg / pcs and value */
  ordersInRange: number
  kg: number
  pcs: number
  value: number
}

/**
 * One row per customer for the Pelanggan table. The reference day is the end of the range, or today while the range
 * is still running, so "30 hari" means the 30 days up to that day (that day included). Sorted by orders in the range
 * (most first), then the latest visit, then name; customers who never came last.
 */
export function customerReport(customers: Customer[], orders: OrderRow[], items: ItemRow[], range: DateRange, today: string, itemsByOrder?: Map<string, ItemRow[]>): CustomerReportRow[] {
  const byOrder = itemsByOrder ?? groupItemsByOrder(items)
  const ref = minISO(range.end, today)
  const from30 = addDaysISO(ref, -29)
  const from90 = addDaysISO(ref, -89)
  const rows = new Map<string, CustomerReportRow>()
  for (const c of customers) rows.set(c.id, { customer: c, lastVisit: null, orders30: 0, orders90: 0, ordersInRange: 0, kg: 0, pcs: 0, value: 0 })
  for (const o of orders) {
    if (o.status === 'cancelled') continue
    const row = rows.get(o.customer_id)
    if (!row) continue
    const d = o.received_at
    if (d <= ref) {
      if (row.lastVisit === null || d > row.lastVisit) row.lastVisit = d
      if (d >= from30) row.orders30++
      if (d >= from90) row.orders90++
    }
    if (inRange(d, range)) {
      const lines = byOrder.get(o.id) ?? []
      row.ordersInRange++
      row.value += orderTotals(o, lines, []).total
      for (const it of lines) {
        if (it.unit === 'kg') row.kg += it.qty
        else row.pcs += it.qty
      }
    }
  }
  const list = [...rows.values()].map((r) => ({ ...r, kg: roundQty(r.kg), pcs: roundQty(r.pcs) }))
  list.sort(
    (a, b) =>
      b.ordersInRange - a.ordersInRange ||
      (b.lastVisit ?? '').localeCompare(a.lastVisit ?? '') ||
      a.customer.name.localeCompare(b.customer.name, 'id', { sensitivity: 'base' }),
  )
  return list
}

// =====================================================================================================================
// Lama tidak datang
// =====================================================================================================================

export const LAMA_DEFAULT_DAYS = 21
export const LAMA_MIN_DAYS = 1
export const LAMA_MAX_DAYS = 365

/** A typed / stored number of days: whole, 1..365; anything else -> the default 21. */
export function parseLamaDays(raw: string | number | null | undefined): number {
  const n = typeof raw === 'number' ? raw : raw == null || raw.trim() === '' ? Number.NaN : Number(raw.trim())
  if (!Number.isFinite(n)) return LAMA_DEFAULT_DAYS
  const whole = Math.round(n)
  if (whole < LAMA_MIN_DAYS) return LAMA_MIN_DAYS
  if (whole > LAMA_MAX_DAYS) return LAMA_MAX_DAYS
  return whole
}

export interface AbsentRow {
  customer: Customer
  /** newest received_at of a non-cancelled order */
  lastVisit: string
  /** days from the last visit to today */
  daysAway: number
  /** non-cancelled orders ever */
  orderCount: number
}

/**
 * Promotion targets (SPEC 3.7): customers with at least one order (not cancelled) whose last visit is more than
 * `days` days before today. Longest absence first, then name.
 */
export function absentCustomers(customers: Customer[], orders: Pick<Order, 'customer_id' | 'received_at' | 'status'>[], today: string, days: number): AbsentRow[] {
  const last = new Map<string, { lastVisit: string; count: number }>()
  for (const o of orders) {
    if (o.status === 'cancelled') continue
    const cur = last.get(o.customer_id)
    if (!cur) last.set(o.customer_id, { lastVisit: o.received_at, count: 1 })
    else {
      cur.count++
      if (o.received_at > cur.lastVisit) cur.lastVisit = o.received_at
    }
  }
  const rows: AbsentRow[] = []
  for (const c of customers) {
    const s = last.get(c.id)
    if (!s) continue
    const daysAway = daysBetween(s.lastVisit, today)
    if (daysAway > days) rows.push({ customer: c, lastVisit: s.lastVisit, daysAway, orderCount: s.count })
  }
  rows.sort((a, b) => b.daysAway - a.daysAway || a.customer.name.localeCompare(b.customer.name, 'id', { sensitivity: 'base' }))
  return rows
}

// =====================================================================================================================
// Formatting and the change vs the previous period
// =====================================================================================================================

/** At most one decimal with a decimal comma, no trailing ',0': 1.25 -> '1,3'; 2 -> '2'. */
function oneDecimal(n: number): string {
  return String(Math.round(n * 10) / 10).replace('.', ',')
}

/** Axis ticks: 1_200_000 -> '1,2 jt'; 850_000 -> '850 rb'; 1_500_000_000 -> '1,5 M'; 0 -> '0'. */
export function formatCompactRupiah(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0'
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return `${sign}${oneDecimal(abs / 1_000_000_000)} M`
  if (abs >= 1_000_000) return `${sign}${oneDecimal(abs / 1_000_000)} jt`
  if (abs >= 1_000) return `${sign}${oneDecimal(abs / 1_000)} rb`
  return `${sign}${Math.round(abs)}`
}

export interface Delta {
  direction: 'up' | 'down' | 'flat'
  /** '▲ Rp 12.000 (25%)', '▼ 2', '— sama' */
  text: string
}

/**
 * current − previous with ▲ / ▼ and the change as a whole percentage of the previous figure (left out when the
 * previous figure is 0). `format` renders the absolute change.
 */
export function describeDelta(current: number, previous: number, format: (n: number) => string): Delta {
  const delta = Math.round((current - previous) * 100) / 100
  if (delta === 0) return { direction: 'flat', text: '— sama' }
  const pct = previous !== 0 ? ` (${Math.round((Math.abs(delta) / Math.abs(previous)) * 100)}%)` : ''
  return { direction: delta > 0 ? 'up' : 'down', text: `${delta > 0 ? '▲' : '▼'} ${format(Math.abs(delta))}${pct}` }
}

// =====================================================================================================================
// The whole page
// =====================================================================================================================

export interface LaporanInput {
  customers: Customer[]
  orders: Order[]
  orderItems: OrderItem[]
  payments: Payment[]
  customerPackages: CustomerPackage[]
}

export interface Figures {
  moneyIn: number
  orders: number
  kg: number
  piutang: number
}

export interface Laporan {
  range: DateRange
  comparison: Comparison
  money: MoneyIn
  granularity: ChartGranularity
  chart: ChartPoint[]
  orders: OrdersSummary
  /** shown on the tiles: uang masuk / orders / kg of the whole range; piutang now (or at the range end when it is past) */
  figures: Figures
  /** like-with-like pair for the change line under each tile */
  current: Figures
  previous: Figures
  /** the day the piutang figure is taken (today while the range runs) */
  piutangAsOf: string
  split: TenantSplit
  customers: CustomerReportRow[]
}

/** Everything the Laporan page shows for one range, in one pass of pure functions. */
export function buildLaporan(input: LaporanInput, range: DateRange, preset: RangePreset, today: string): Laporan {
  const byOrder = groupItemsByOrder(input.orderItems)
  const comparison = comparableRanges(range, preset, today)
  const money = moneyIn(input.payments, input.customerPackages, range)
  const granularity = chartGranularity(range)
  const orders = summarizeOrders(input.orders, input.orderItems, range, byOrder)

  const piutangAsOf = minISO(range.end, today)
  // "now" includes every recorded row (a payment typed with a later date too), exactly the Dashboard's figure
  const piutangShown = piutangAsOf === today ? piutang(input.orders, input.orderItems, input.payments, undefined, byOrder) : piutang(input.orders, input.orderItems, input.payments, piutangAsOf, byOrder)

  const at = (r: DateRange): Figures => {
    const o = summarizeOrders(input.orders, input.orderItems, r, byOrder)
    return {
      moneyIn: moneyIn(input.payments, input.customerPackages, r, { withDays: false }).total,
      orders: o.count,
      kg: o.kg,
      piutang: piutang(input.orders, input.orderItems, input.payments, minISO(r.end, today), byOrder),
    }
  }
  const current = at(comparison.current)
  const previous = at(comparison.previous)

  return {
    range,
    comparison,
    money,
    granularity,
    chart: chartSeries(money.byDay, granularity),
    orders,
    figures: { moneyIn: money.total, orders: orders.count, kg: orders.kg, piutang: piutangShown },
    current,
    previous,
    piutangAsOf,
    split: tenantSplit(
      { customers: input.customers, orders: input.orders, items: input.orderItems, payments: input.payments, packages: input.customerPackages },
      range,
      byOrder,
    ),
    customers: customerReport(input.customers, input.orders, input.orderItems, range, today, byOrder),
  }
}
