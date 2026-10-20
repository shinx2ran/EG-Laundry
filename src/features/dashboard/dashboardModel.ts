/**
 * Dashboard (SPEC 3.6): today's numbers for the cashier, as pure functions. No React, no I/O and no clock: `today`
 * ('YYYY-MM-DD') is passed in, so every rule is unit-tested with fixed dates.
 *
 *  - Masuk hari ini: orders received today that are not cancelled (count, kg, pcs, value = their totals).
 *  - Sedang proses: Diterima + Proses; late ones (isOrderLate) listed separately, most overdue first.
 *  - Siap diambil: every ready order with what is still owed and how long it has been waiting.
 *  - Belum bayar (piutang, SPEC 3.5): outstanding of every order that is not cancelled; the largest five listed.
 *  - Uang masuk (SPEC 3.5): payments by paid_at + package purchases by purchased_at, split by method, for today and
 *    for the last seven days.
 * Order arithmetic (totals, outstanding, late) comes from src/domain/pricing.
 */
import type { Customer, CustomerPackage, Order, OrderItem, Payment, PaymentMethod, Service } from '../../types/db'
import { isOrderLate, orderTotals, roundQty, type OrderTotals } from '../../domain/pricing'
import { itemsSummary } from '../../domain/messages'
import { addDaysISO, daysBetween, formatDate, formatNumber, formatQty, formatRupiah, toDateISO } from '../../lib/format'

/** Days in the mini chart of uang masuk (today included). */
export const SERIES_DAYS = 7
/** How many unpaid orders the Belum bayar card lists. */
export const UNPAID_TOP = 5

// ---------- input & output ----------

/** The organisation's lists (useLaundryData gives exactly these). */
export interface DashboardSource {
  orders: Order[]
  orderItems: OrderItem[]
  payments: Pick<Payment, 'order_id' | 'amount' | 'paid_at' | 'method'>[]
  customerPackages: Pick<CustomerPackage, 'price' | 'purchased_at' | 'method'>[]
  customers: Customer[]
}

/** One order with what a dashboard row shows about it. */
export interface OrderEntry {
  order: Order
  customer: Customer | undefined
  items: OrderItem[]
  /** 'Cuci setrika 3 kg, Bed cover 1 pcs' ('' without items) */
  itemsText: string
  totals: OrderTotals
}

export interface ReadyEntry extends OrderEntry {
  /** whole days since the day it was marked ready (0 = today; never negative) */
  daysWaiting: number
}

export interface LateEntry extends OrderEntry {
  /** days past the promised date (>= 1) */
  daysLate: number
}

export interface Intake {
  count: number
  /** sum of the kg items (2 decimals) */
  kg: number
  /** sum of the pcs items */
  pcs: number
  /** sum of the orders' totals (after discount) */
  value: number
}

export interface MoneyIn {
  /** 'YYYY-MM-DD' */
  date: string
  total: number
  byMethod: Record<PaymentMethod, number>
  /** the part of `total` that came from prepaid packages sold that day */
  packages: number
}

export interface DashboardModel {
  today: string
  /** no order recorded yet: the page shows the first-run card instead of the numbers */
  isEmpty: boolean
  intake: Intake
  inProgress: { count: number; received: number; processing: number }
  /** late orders (promised day passed, not ready yet), most overdue first */
  late: LateEntry[]
  /** ready orders, longest waiting first */
  ready: ReadyEntry[]
  /** piutang: every order that is not cancelled and still owes something */
  unpaid: { count: number; amount: number; top: OrderEntry[] }
  moneyToday: MoneyIn
  /** SERIES_DAYS days ending today, oldest first */
  moneySeries: MoneyIn[]
}

// ---------- uang masuk (SPEC 3.5) ----------

function emptyMoney(date: string): MoneyIn {
  return { date, total: 0, byMethod: { cash: 0, transfer: 0, qris: 0 }, packages: 0 }
}

/**
 * Uang masuk per day from `from` to `to` (inclusive, oldest first, one entry per calendar day even when nothing came
 * in): Σ payments.amount by paid_at + Σ customer_packages.price by purchased_at, each split by its method.
 */
export function moneyInByDay(
  from: string,
  to: string,
  payments: Pick<Payment, 'amount' | 'paid_at' | 'method'>[],
  packages: Pick<CustomerPackage, 'price' | 'purchased_at' | 'method'>[],
): MoneyIn[] {
  const days: MoneyIn[] = []
  const byDate = new Map<string, MoneyIn>()
  for (let d = from; d <= to; d = addDaysISO(d, 1)) {
    const day = emptyMoney(d)
    days.push(day)
    byDate.set(d, day)
  }
  const add = (date: string, amount: number, method: PaymentMethod, isPackage: boolean) => {
    const day = byDate.get(date.slice(0, 10))
    if (!day) return
    day.total += amount
    day.byMethod[method] = (day.byMethod[method] ?? 0) + amount
    if (isPackage) day.packages += amount
  }
  for (const p of payments) add(p.paid_at, p.amount, p.method, false)
  for (const pkg of packages) add(pkg.purchased_at, pkg.price, pkg.method, true)
  return days
}

/** The last `days` days ending on `today` (oldest first). */
export function moneyInSeries(
  today: string,
  payments: Pick<Payment, 'amount' | 'paid_at' | 'method'>[],
  packages: Pick<CustomerPackage, 'price' | 'purchased_at' | 'method'>[],
  days = SERIES_DAYS,
): MoneyIn[] {
  return moneyInByDay(addDaysISO(today, -(days - 1)), today, payments, packages)
}

// ---------- orders ----------

/** Calendar day of a timestamp ('…T…Z') in the device's timezone; a plain date stays as it is. */
export function localDay(value: string): string {
  if (value.length <= 10) return value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value.slice(0, 10) : toDateISO(d)
}

/** Whole days a ready order has been waiting: from the day of ready_at to today, never below 0 (unknown = 0). */
export function readyDaysWaiting(readyAt: string | null, today: string): number {
  if (!readyAt) return 0
  return Math.max(0, daysBetween(localDay(readyAt), today))
}

/** Orders received on `day` that are not cancelled: how many, kg, pcs and their value. */
export function intakeOn(day: string, orders: Pick<Order, 'id' | 'received_at' | 'status' | 'discount'>[], items: Pick<OrderItem, 'order_id' | 'unit' | 'qty' | 'line_total'>[], payments: Pick<Payment, 'order_id' | 'amount'>[]): Intake {
  const ids = new Set<string>()
  const counted = orders.filter((o) => o.received_at === day && o.status !== 'cancelled')
  for (const o of counted) ids.add(o.id)
  let kg = 0
  let pcs = 0
  const own = items.filter((it) => ids.has(it.order_id))
  for (const it of own) {
    if (it.unit === 'kg') kg += it.qty
    else pcs += it.qty
  }
  let value = 0
  for (const o of counted) value += orderTotals(o, own, payments).total
  return { count: counted.length, kg: roundQty(kg), pcs, value }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}

/** Everything the dashboard shows, for `today`. */
export function buildDashboard(src: DashboardSource, today: string): DashboardModel {
  const itemsByOrder = groupBy(src.orderItems, (i) => i.order_id)
  const paymentsByOrder = groupBy(src.payments, (p) => p.order_id)
  const customerById = new Map(src.customers.map((c) => [c.id, c]))

  const entry = (order: Order): OrderEntry => {
    const items = itemsByOrder.get(order.id) ?? []
    return {
      order,
      customer: customerById.get(order.customer_id),
      items,
      itemsText: itemsSummary(items),
      totals: orderTotals(order, items, paymentsByOrder.get(order.id) ?? []),
    }
  }

  let received = 0
  let processing = 0
  const late: LateEntry[] = []
  const ready: ReadyEntry[] = []
  const unpaid: OrderEntry[] = []
  let unpaidAmount = 0

  for (const order of src.orders) {
    if (order.status === 'cancelled') continue
    const e = entry(order)
    if (order.status === 'received') received++
    if (order.status === 'processing') processing++
    if (isOrderLate(order, today)) late.push({ ...e, daysLate: daysBetween(order.promised_at ?? today, today) })
    if (order.status === 'ready') ready.push({ ...e, daysWaiting: readyDaysWaiting(order.ready_at, today) })
    if (e.totals.outstanding > 0) {
      unpaid.push(e)
      unpaidAmount += e.totals.outstanding
    }
  }

  const byNumber = (a: OrderEntry, b: OrderEntry) => a.order.order_number.localeCompare(b.order.order_number)
  late.sort((a, b) => (a.order.promised_at ?? '').localeCompare(b.order.promised_at ?? '') || byNumber(a, b))
  // longest waiting first; an order without ready_at (should not happen) goes last
  ready.sort((a, b) => b.daysWaiting - a.daysWaiting || (a.order.ready_at ?? '￿').localeCompare(b.order.ready_at ?? '￿') || byNumber(a, b))
  unpaid.sort((a, b) => b.totals.outstanding - a.totals.outstanding || a.order.received_at.localeCompare(b.order.received_at) || byNumber(a, b))

  const moneySeries = moneyInSeries(today, src.payments, src.customerPackages)
  return {
    today,
    isEmpty: src.orders.length === 0,
    intake: intakeOn(today, src.orders, src.orderItems, src.payments),
    inProgress: { count: received + processing, received, processing },
    late,
    ready,
    unpaid: { count: unpaid.length, amount: unpaidAmount, top: unpaid.slice(0, UNPAID_TOP) },
    moneyToday: moneySeries[moneySeries.length - 1],
    moneySeries,
  }
}

// ---------- links (PesananPage reads ?tab=diterima|proses|siap|selesai) ----------

/**
 * Where the Sedang proses tile leads: the Diterima or the Proses tab when every open order is in that one status,
 * otherwise the whole list (there is no tab for both).
 */
export function inProgressLink(inProgress: { received: number; processing: number }): string {
  if (inProgress.received > 0 && inProgress.processing === 0) return '/pesanan?tab=diterima'
  if (inProgress.processing > 0 && inProgress.received === 0) return '/pesanan?tab=proses'
  return '/pesanan'
}

/** The order's detail page; `aksi` opens its Diambil or Terima pembayaran dialog (parseDetailAction). */
export function orderLink(orderId: string, aksi?: 'diambil' | 'bayar'): string {
  const path = `/pesanan/${encodeURIComponent(orderId)}`
  return aksi ? `${path}?aksi=${aksi}` : path
}

// ---------- texts ----------

/** '7,5 kg · 2 pcs · Rp 69.000'; the kg / pcs parts only when there are any. */
export function intakeText(intake: Intake): string {
  const parts: string[] = []
  if (intake.kg > 0) parts.push(formatQty(intake.kg, 'kg'))
  if (intake.pcs > 0) parts.push(formatQty(intake.pcs, 'pcs'))
  parts.push(formatRupiah(intake.value))
  return parts.join(' · ')
}

/** 'Siap hari ini' / 'Menunggu 1 hari' / 'Menunggu 4 hari'. */
export function waitingText(daysWaiting: number): string {
  return daysWaiting <= 0 ? 'Siap hari ini' : `Menunggu ${daysWaiting} hari`
}

/** 'Janji 16 Okt 2026 · terlambat 3 hari'. */
export function lateText(entry: Pick<LateEntry, 'daysLate'> & { order: Pick<Order, 'promised_at'> }): string {
  return `Janji ${formatDate(entry.order.promised_at)} · terlambat ${entry.daysLate} hari`
}

/** Chart axis: 0 -> 'Rp 0', 18.000 -> 'Rp 18 rb', 1.250.000 -> 'Rp 1,3 jt' (Indonesian thousands / millions). */
export function formatCompactRupiah(amount: number): string {
  const sign = amount < 0 ? '−' : ''
  const n = Math.abs(Math.round(amount))
  const rb = Math.round(n / 1_000)
  if (rb >= 1_000) {
    const jt = Math.round(n / 100_000) / 10
    return `${sign}Rp ${jt.toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`
  }
  if (n >= 1_000) return `${sign}Rp ${formatNumber(rb)} rb`
  return `${sign}Rp ${n}`
}

/** Short weekday for the chart's axis: '2026-10-19' -> 'Sen'. */
export function dayLabel(date: string): string {
  return formatDate(date, 'EEE')
}

// ---------- first run (no orders yet) ----------

export type FirstRunKey = 'harga' | 'pelanggan' | 'pesanan'

export interface FirstRunStep {
  key: FirstRunKey
  done: boolean
}

/**
 * The three steps of a brand-new laundry: 1) Atur daftar harga (an active service exists), 2) Tambah pelanggan (a
 * customer exists), 3) Catat pesanan pertama (an order exists).
 */
export function firstRunSteps(src: { services: Pick<Service, 'active'>[]; customers: unknown[]; orders: unknown[] }): FirstRunStep[] {
  return [
    { key: 'harga', done: src.services.some((s) => s.active) },
    { key: 'pelanggan', done: src.customers.length > 0 },
    { key: 'pesanan', done: src.orders.length > 0 },
  ]
}
