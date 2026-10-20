/**
 * Pure helpers of the orders module (SPEC 3.3, 3.5, 3.9, 3.10): the list tabs and search, the status machine,
 * what each role may do, the payment rules of one order and the WhatsApp texts. No React, no I/O; unit-tested.
 * Money and package arithmetic stays in src/domain/pricing.ts.
 */
import type { Customer, Order, OrderItem, OrderStatus, Organization, Payment, PaymentMethod } from '../../types/db'
import { ORDER_STATUS_LABEL } from '../../types/db'
import { isOrderLate, orderTotals, type OrderTotals } from '../../domain/pricing'
import { readyText, receiptText } from '../../domain/messages'
import { formatRupiah } from '../../lib/format'
import { CANCELLED_PAYMENT_MESSAGE, CANCEL_STATUS_MESSAGE, CANCEL_WITH_PAYMENTS_MESSAGE, DONE_ORDER_ADMIN_MESSAGE } from '../../lib/repo/types'
import { matchesCustomerSearch } from '../pelanggan/customerUtils'

// ---------- Indonesian messages ----------

/** SPEC 3.10: deleting an order and correcting payments are owner/admin only. */
export const STAFF_DELETE_ORDER_MESSAGE = 'Hanya pemilik/admin yang dapat menghapus pesanan.'
export const STAFF_EDIT_PAYMENT_MESSAGE = 'Hanya pemilik/admin yang dapat mengubah pembayaran.'
export const STAFF_DELETE_PAYMENT_MESSAGE = 'Hanya pemilik/admin yang dapat menghapus pembayaran.'
export const PAYMENT_POSITIVE_MESSAGE = 'Jumlah pembayaran harus lebih dari 0.'
export const PAYMENT_DATE_MESSAGE = 'Isi tanggal bayar.'
export const ORDER_PAID_MESSAGE = 'Pesanan ini sudah lunas.'
export { CANCELLED_PAYMENT_MESSAGE } from '../../lib/repo/types'
export const RECEIVED_DATE_MESSAGE = 'Isi tanggal masuk.'
export const PROMISED_DATE_MESSAGE = 'Tanggal perkiraan selesai tidak valid.'

export const PROMISED_BEFORE_RECEIVED_MESSAGE = 'Perkiraan selesai tidak boleh sebelum tanggal masuk.'

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** The order's dates: a received date is required; a promised date (optional) is a date not before it. */
export function datesProblem(receivedAt: string, promisedAt: string | null | undefined): string | null {
  if (!DATE_RE.test(receivedAt)) return RECEIVED_DATE_MESSAGE
  if (!promisedAt) return null
  if (!DATE_RE.test(promisedAt)) return PROMISED_DATE_MESSAGE
  if (promisedAt < receivedAt) return PROMISED_BEFORE_RECEIVED_MESSAGE
  return null
}

/** 'Jumlah melebihi sisa bayar (Rp 25.000).' */
export function paymentExceedsMessage(outstanding: number): string {
  return `Jumlah melebihi sisa bayar (${formatRupiah(outstanding)}).`
}

/** When an edit would push the total under what was already paid. */
export function totalBelowPaidMessage(paid: number): string {
  return `Total pesanan tidak boleh lebih kecil dari yang sudah dibayar (${formatRupiah(paid)}).`
}

// ---------- list tabs & search ----------

export const ORDER_TABS = ['semua', 'diterima', 'proses', 'siap', 'selesai'] as const
export type OrderTab = (typeof ORDER_TABS)[number]

export const ORDER_TAB_LABEL: Record<OrderTab, string> = {
  semua: 'Semua',
  diterima: 'Diterima',
  proses: 'Proses',
  siap: 'Siap',
  selesai: 'Selesai',
}

const TAB_STATUS: Record<Exclude<OrderTab, 'semua'>, OrderStatus> = {
  diterima: 'received',
  proses: 'processing',
  siap: 'ready',
  selesai: 'done',
}

export function parseOrderTab(value: string | null | undefined): OrderTab {
  return (ORDER_TABS as readonly string[]).includes(value ?? '') ? (value as OrderTab) : 'semua'
}

/** Semua shows every order (cancelled ones included); the other tabs one status each. */
export function tabMatches(tab: OrderTab, status: OrderStatus): boolean {
  return tab === 'semua' || TAB_STATUS[tab] === status
}

type SearchCustomer = Pick<Customer, 'name' | 'phone' | 'is_tenant' | 'room_name'>

/**
 * Case-insensitive match on the order number, or the customer as the Pelanggan list searches them
 * (matchesCustomerSearch: name, phone in the 0812 / +62 spelling, a tenant's room).
 */
export function matchesOrderSearch(order: Pick<Order, 'order_number'>, customer: SearchCustomer | undefined, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (order.order_number.toLowerCase().includes(q)) return true
  return customer !== undefined && matchesCustomerSearch(customer, q)
}

/** Newest first: received date, then the time it was entered. */
export function sortOrdersNewest<T extends Pick<Order, 'received_at' | 'created_at'>>(orders: T[]): T[] {
  return [...orders].sort((a, b) => b.received_at.localeCompare(a.received_at) || b.created_at.localeCompare(a.created_at))
}

/** How many orders each tab lists (Semua includes the cancelled ones). */
export function tabCounts(orders: Pick<Order, 'status'>[]): Record<OrderTab, number> {
  const counts: Record<OrderTab, number> = { semua: 0, diterima: 0, proses: 0, siap: 0, selesai: 0 }
  for (const o of orders) for (const tab of ORDER_TABS) if (tabMatches(tab, o.status)) counts[tab]++
  return counts
}

// ---------- customer picker (order form) ----------

/**
 * The customers the picker lists: with a query, the matches (names starting with it first); without one, the most
 * recent visitors first (last received date of an order that is not cancelled), then the rest by name.
 */
export function pickCustomers<C extends Pick<Customer, 'id'> & SearchCustomer>(
  customers: C[],
  orders: Pick<Order, 'customer_id' | 'received_at' | 'status'>[],
  query: string,
  limit = 8,
): C[] {
  const last = new Map<string, string>()
  for (const o of orders) {
    if (o.status === 'cancelled') continue
    const prev = last.get(o.customer_id)
    if (!prev || o.received_at > prev) last.set(o.customer_id, o.received_at)
  }
  const q = query.trim().toLowerCase()
  const byVisit = (a: C, b: C) => (last.get(b.id) ?? '').localeCompare(last.get(a.id) ?? '') || a.name.localeCompare(b.name, 'id')
  const list = customers.filter((c) => matchesCustomerSearch(c, q))
  const starts = (c: C) => (q && c.name.toLowerCase().startsWith(q) ? 0 : 1)
  return list.sort((a, b) => starts(a) - starts(b) || byVisit(a, b)).slice(0, limit)
}

/** 'Tambah pelanggan baru' starts from what was searched: digits go to Nomor HP, words to Nama. */
export function newCustomerPrefill(query: string): { name: string; phone: string } {
  const q = query.trim()
  if (/^[+\d][\d\s-]*$/.test(q) && q.replace(/\D/g, '').length >= 3) return { name: '', phone: q }
  return { name: q, phone: '' }
}

// ---------- actions on one order (what the detail page offers) ----------

export const ORDER_ACTIONS = ['process', 'ready', 'pickup', 'pay', 'edit', 'cancel', 'delete'] as const
export type OrderAction = (typeof ORDER_ACTIONS)[number]

export interface OfferedAction {
  key: OrderAction
  /** shown but not usable, with the reason (Batalkan once a payment exists) */
  disabledReason?: string
}

/**
 * The buttons of the detail page (SPEC 3.3, 3.10), in display order: the next status step, Terima pembayaran while
 * something is owed, Ubah (staff: only until Selesai), Batalkan (Diterima/Proses; off with a reason once paid),
 * Hapus (owner/admin). The hook refuses the same things again before writing.
 */
export function offeredActions(order: Pick<Order, 'status'>, ctx: { hasPayments: boolean; outstanding: number; isAdmin: boolean }): OfferedAction[] {
  const out: OfferedAction[] = []
  if (order.status === 'received') out.push({ key: 'process' })
  if (order.status === 'received' || order.status === 'processing') out.push({ key: 'ready' })
  if (order.status === 'ready') out.push({ key: 'pickup' })
  if (order.status !== 'cancelled' && ctx.outstanding > 0) out.push({ key: 'pay' })
  if (editProblem(order, ctx.isAdmin) === null) out.push({ key: 'edit' })
  if (order.status === 'received' || order.status === 'processing') {
    out.push(ctx.hasPayments ? { key: 'cancel', disabledReason: 'Sudah ada pembayaran: hapus pembayarannya dulu (pemilik/admin).' } : { key: 'cancel' })
  }
  if (ctx.isAdmin) out.push({ key: 'delete' })
  return out
}

/**
 * Deep links into the detail page's dialogs, e.g. from the Dashboard's "siap diambil" list:
 * /pesanan/:id?aksi=diambil opens Diambil, ?aksi=bayar opens Terima pembayaran; anything else opens nothing.
 */
export function parseDetailAction(value: string | null | undefined): 'pickup' | 'pay' | null {
  if (value === 'diambil') return 'pickup'
  if (value === 'bayar') return 'pay'
  return null
}

/** 'Lunas' / 'DP · sisa Rp 25.000' for the Bayar sekarang box; '' when nothing is paid. */
export function payNowCaption(amount: number, total: number): string {
  if (!(amount > 0)) return ''
  if (amount >= total) return 'Lunas'
  return `DP · sisa ${formatRupiah(total - amount)}`
}

// ---------- status machine (SPEC 3.3) ----------

const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  received: ['processing', 'ready', 'cancelled'],
  processing: ['ready', 'cancelled'],
  ready: ['done'],
  done: [],
  cancelled: [],
}

/** The statuses an order may move to from `status` (cancelled included; cancelProblem adds its own rules). */
export function nextStatuses(status: OrderStatus): OrderStatus[] {
  return NEXT_STATUSES[status]
}

/** Why the order cannot move from `from` to `to`, or null when it can. */
export function transitionProblem(from: OrderStatus, to: OrderStatus): string | null {
  if (from === to) return 'Status pesanan tidak berubah.'
  if (NEXT_STATUSES[from].includes(to)) return null
  return `Pesanan ${ORDER_STATUS_LABEL[from]} tidak dapat diubah menjadi ${ORDER_STATUS_LABEL[to]}.`
}

/** Batalkan: only from Diterima/Proses and only without payments (the database raises the same texts). */
export function cancelProblem(order: Pick<Order, 'id' | 'status'>, payments: Pick<Payment, 'order_id'>[]): string | null {
  if (order.status !== 'received' && order.status !== 'processing') return CANCEL_STATUS_MESSAGE
  if (payments.some((p) => p.order_id === order.id)) return CANCEL_WITH_PAYMENTS_MESSAGE
  return null
}

/** Ubah: anyone while the order is open; after Selesai/Dibatalkan only owner/admin (orders_done_guard). */
export function editProblem(order: Pick<Order, 'status'>, isAdmin: boolean): string | null {
  if ((order.status === 'done' || order.status === 'cancelled') && !isAdmin) return DONE_ORDER_ADMIN_MESSAGE
  return null
}

export function isClosed(order: Pick<Order, 'status'>): boolean {
  return order.status === 'done' || order.status === 'cancelled'
}

// ---------- payments (SPEC 3.5) ----------

/** Why `amount` cannot be taken on the order now (amount <= outstanding, never on a cancelled order). */
export function paymentProblem(amount: number, order: Pick<Order, 'status'>, totals: Pick<OrderTotals, 'outstanding'>): string | null {
  if (order.status === 'cancelled') return CANCELLED_PAYMENT_MESSAGE
  if (totals.outstanding <= 0) return ORDER_PAID_MESSAGE
  if (!Number.isInteger(amount) || amount <= 0) return PAYMENT_POSITIVE_MESSAGE
  if (amount > totals.outstanding) return paymentExceedsMessage(totals.outstanding)
  return null
}

export interface PaymentEditPatch {
  amount: number
  paid_at: string
  method: PaymentMethod
  notes: string | null
}

/** What the order still owes without this payment: the most the corrected payment may be. */
export function paymentRoom(payment: Pick<Payment, 'id'>, order: Pick<Order, 'id' | 'discount' | 'status'>, items: Pick<OrderItem, 'order_id' | 'line_total'>[], payments: Pick<Payment, 'id' | 'order_id' | 'amount'>[]): number {
  const t = orderTotals(order, items, payments.filter((p) => p.id !== payment.id))
  return Math.max(0, t.total - t.paid)
}

/** Ubah pembayaran (owner/admin): amount > 0, a date, and amount <= outstanding without this payment. */
export function validatePaymentEdit(
  payment: Pick<Payment, 'id'>,
  patch: PaymentEditPatch,
  order: Pick<Order, 'id' | 'order_number' | 'discount' | 'status'>,
  items: Pick<OrderItem, 'order_id' | 'line_total'>[],
  payments: Pick<Payment, 'id' | 'order_id' | 'amount'>[],
): string | null {
  if (!Number.isInteger(patch.amount) || patch.amount <= 0) return PAYMENT_POSITIVE_MESSAGE
  if (!DATE_RE.test(patch.paid_at)) return PAYMENT_DATE_MESSAGE
  const room = paymentRoom(payment, order, items, payments)
  if (patch.amount > room) return `Jumlah melebihi sisa bayar pesanan ${order.order_number} (${formatRupiah(room)}).`
  return null
}

/** True when nothing would change (Simpan stays off); a blank note equals no note. */
export function isSamePayment(payment: Pick<Payment, 'amount' | 'paid_at' | 'method' | 'notes'>, patch: PaymentEditPatch): boolean {
  const note = (n: string | null) => n?.trim() || null
  return patch.amount === payment.amount && patch.paid_at === payment.paid_at && patch.method === payment.method && note(patch.notes) === note(payment.notes)
}

// ---------- WhatsApp (SPEC 3.9) ----------

type MessageOrder = Pick<Order, 'order_number' | 'received_at' | 'promised_at'>
type MessageItem = Pick<OrderItem, 'service_name' | 'qty' | 'unit'>
type MessageOrg = Pick<Organization, 'name' | 'wa_footer'>

/**
 * Struk masuk: the items, the total and what was paid so far as DP. A fully paid order says "lunas" instead of
 * "DP" (paying everything up front is no down payment).
 */
export function orderReceiptText(order: MessageOrder, items: MessageItem[], totals: Pick<OrderTotals, 'total' | 'paid'>, customer: Pick<Customer, 'name'> | undefined, org: MessageOrg): string {
  const paidInFull = totals.total > 0 && totals.paid >= totals.total
  const text = receiptText({
    customerName: customer?.name ?? 'Pelanggan',
    laundryName: org.name,
    orderNumber: order.order_number,
    receivedAt: order.received_at,
    items,
    total: totals.total,
    dp: paidInFull ? 0 : totals.paid,
    promisedAt: order.promised_at,
    footer: org.wa_footer,
  })
  if (!paidInFull) return text
  const total = `Total ${formatRupiah(totals.total)}.`
  return text.replace(total, `Total ${formatRupiah(totals.total)} (lunas).`)
}

/** Cucian siap diambil: the items, the total and the remaining amount (or lunas). */
export function orderReadyText(order: MessageOrder, items: MessageItem[], totals: Pick<OrderTotals, 'total' | 'outstanding'>, customer: Pick<Customer, 'name'> | undefined, org: MessageOrg): string {
  return readyText({
    customerName: customer?.name ?? 'Pelanggan',
    laundryName: org.name,
    orderNumber: order.order_number,
    items,
    total: totals.total,
    outstanding: totals.outstanding,
    footer: org.wa_footer,
  })
}

// ---------- display ----------

export interface DateLine {
  /** 'Perkiraan selesai' while open, 'Siap sejak' / 'Diambil' afterwards; null for a cancelled order */
  label: string | null
  /** 'YYYY-MM-DD' or an ISO timestamp (the UI formats it); null when unknown */
  date: string | null
  /** promised day passed and not ready yet (SPEC 3.6) */
  late: boolean
}

/** The list row's date line: the promise while open, when it was ready / picked up afterwards. */
export function dateLine(order: Pick<Order, 'status' | 'promised_at' | 'ready_at' | 'picked_up_at'>, todayISO: string): DateLine {
  if (order.status === 'received' || order.status === 'processing') {
    return { label: 'Perkiraan selesai', date: order.promised_at, late: isOrderLate(order, todayISO) }
  }
  if (order.status === 'ready') return { label: 'Siap sejak', date: order.ready_at, late: false }
  if (order.status === 'done') return { label: 'Diambil', date: order.picked_up_at, late: false }
  return { label: null, date: null, late: false }
}
