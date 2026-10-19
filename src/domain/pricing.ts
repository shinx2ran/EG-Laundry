/**
 * Laundry pricing rules (SPEC 3.3, 3.4, 3.5, 3.12). Pure functions, no I/O: Mode Demo and the online
 * client compute everything here; the database repeats the same rules in checks and triggers.
 *
 *  - An order item is a COPY of the service at the time (name, unit, unit_price) so later price changes
 *    never touch old orders. unit_price is the express price for an express order and 0 when the qty
 *    is taken from a prepaid package.
 *  - line_total = round(qty * unit_price); subtotal = sum(line_total); total = subtotal - discount;
 *    paid = sum(payments); outstanding = max(0, total - paid). Nothing of this is stored.
 *  - A package's remaining qty = qty_total - sum(qty of its items on orders that are not cancelled).
 */
import type { CustomerPackage, Order, OrderItem, Payment, Service, Unit } from '../types/db'
import { addDaysISO, formatQty } from '../lib/format'
import {
  PACKAGE_EXPIRED_MESSAGE,
  PACKAGE_INSUFFICIENT_MESSAGE,
  PACKAGE_OTHER_CUSTOMER_MESSAGE,
  PACKAGE_OTHER_SERVICE_MESSAGE,
  PAYMENT_EXCEEDS_TOTAL_MESSAGE,
} from '../lib/repo/types'

// ---------- Indonesian error texts (the UI shows these as they are) ----------

export const ERR_NO_CUSTOMER = 'Pilih pelanggan dulu.'
export const ERR_NO_ITEMS = 'Tambahkan minimal satu layanan.'
export const ERR_SERVICE_UNKNOWN = 'Layanan tidak ditemukan.'
export const ERR_QTY_POSITIVE = 'Jumlah harus lebih dari 0.'
export const ERR_QTY_PCS_WHOLE = 'Jumlah pcs harus bilangan bulat.'
export const ERR_QTY_KG_DECIMALS = 'Jumlah kg maksimal 2 angka di belakang koma.'
export const ERR_DISCOUNT_NEGATIVE = 'Diskon tidak boleh negatif.'
export const ERR_DISCOUNT_EXCEEDS = 'Diskon melebihi subtotal.'
export const ERR_PAYMENT_NEGATIVE = 'Jumlah pembayaran tidak boleh negatif.'
export const ERR_PAYMENT_EXCEEDS = PAYMENT_EXCEEDS_TOTAL_MESSAGE
export const ERR_PACKAGE_UNKNOWN = 'Paket tidak ditemukan.'
export const ERR_PACKAGE_OTHER_CUSTOMER = PACKAGE_OTHER_CUSTOMER_MESSAGE
export const ERR_PACKAGE_OTHER_SERVICE = PACKAGE_OTHER_SERVICE_MESSAGE
export const ERR_PACKAGE_EXPIRED = PACKAGE_EXPIRED_MESSAGE
export const ERR_PACKAGE_INSUFFICIENT = PACKAGE_INSUFFICIENT_MESSAGE

/** 'Layanan Setrika saja tidak ada harga express.' (SPEC 3.3) */
export function noExpressMessage(serviceName: string): string {
  return `Layanan ${serviceName} tidak ada harga express.`
}

/** 'Sisa paket tidak cukup (sisa 2,5 kg).' */
export function packageInsufficientMessage(remaining: number, unit: Unit): string {
  return `Sisa paket tidak cukup (sisa ${formatQty(remaining, unit)}).`
}

export const PAY_STATUSES = ['lunas', 'sebagian', 'belum'] as const
export type PayStatus = (typeof PAY_STATUSES)[number]

export const PAY_STATUS_LABEL: Record<PayStatus, string> = {
  lunas: 'Lunas',
  sebagian: 'Sebagian',
  belum: 'Belum bayar',
}

// ---------- quantities and prices ----------

/** Round to 2 decimals (kg) without float noise: 2.675 -> 2.68, 0.1 + 0.2 -> 0.3. */
export function roundQty(qty: number): number {
  return Math.round(qty * 100) / 100
}

/** The quantity billed: qty raised to min_qty when below it (SPEC 3.12); min_qty 0 = no minimum. */
export function effectiveQty(qty: number, minQty: number): number {
  return minQty > 0 && qty < minQty ? minQty : qty
}

/**
 * round(qty * unit_price) to whole rupiah, computed on hundredths so a kg price never lands a hair below
 * .5 through float error (2.55 kg x Rp 7.000 = Rp 17.850). Same result as PostgreSQL's round(numeric).
 */
export function lineTotal(qty: number, unitPrice: number): number {
  const hundredths = Math.round(qty * 100)
  return Math.round((hundredths * unitPrice) / 100)
}

/** Price per unit for the order kind; throws noExpressMessage when express is asked of a service without it. */
export function unitPrice(service: Pick<Service, 'name' | 'price' | 'price_express'>, express: boolean): number {
  if (!express) return service.price
  if (service.price_express == null) throw new Error(noExpressMessage(service.name))
  return service.price_express
}

/** kg: at most 2 decimals; pcs: whole. Returns the Indonesian problem or null. */
export function qtyProblem(qty: number, unit: Unit): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return ERR_QTY_POSITIVE
  if (unit === 'pcs') return Number.isInteger(qty) ? null : ERR_QTY_PCS_WHOLE
  return roundQty(qty) === qty ? null : ERR_QTY_KG_DECIMALS
}

// ---------- totals ----------

export interface OrderTotals {
  subtotal: number
  discount: number
  /** subtotal - discount, never below 0 */
  total: number
  paid: number
  /** max(0, total - paid); 0 for a cancelled order (nothing is owed on it) */
  outstanding: number
  /** lunas: paid >= total or total 0; sebagian: 0 < paid < total; belum: nothing paid */
  payStatus: PayStatus
}

/**
 * Derived money figures of one order. `items` and `payments` may be the organisation's whole lists or the
 * order's own: rows of other orders are ignored by order_id.
 */
export function orderTotals(
  order: Pick<Order, 'id' | 'discount' | 'status'>,
  items: Pick<OrderItem, 'order_id' | 'line_total'>[],
  payments: Pick<Payment, 'order_id' | 'amount'>[],
): OrderTotals {
  let subtotal = 0
  for (const it of items) if (it.order_id === order.id) subtotal += it.line_total
  let paid = 0
  for (const p of payments) if (p.order_id === order.id) paid += p.amount
  const discount = order.discount
  const total = Math.max(0, subtotal - discount)
  const outstanding = order.status === 'cancelled' ? 0 : Math.max(0, total - paid)
  const payStatus: PayStatus = total <= 0 || paid >= total ? 'lunas' : paid > 0 ? 'sebagian' : 'belum'
  return { subtotal, discount, total, paid, outstanding, payStatus }
}

/** sum of line_total */
export function sumLineTotals(items: Pick<OrderItem, 'line_total'>[]): number {
  let sum = 0
  for (const it of items) sum += it.line_total
  return sum
}

/** Late: promised day has passed and the laundry is not ready yet (SPEC 3.6). */
export function isOrderLate(order: Pick<Order, 'promised_at' | 'status'>, todayISO: string): boolean {
  return order.promised_at !== null && order.promised_at < todayISO && (order.status === 'received' || order.status === 'processing')
}

// ---------- dates ----------

/**
 * Estimated completion (SPEC 3.3, 3.12): received_at (day 0) + the longest working time among the items'
 * services (days_express when express, else days_regular; a missing days_express falls back to
 * days_regular). No calendar is consulted (Sundays count). No services -> received_at.
 */
export function promisedDate(receivedAt: string, services: Pick<Service, 'days_regular' | 'days_express'>[], express: boolean): string {
  let days = 0
  for (const s of services) {
    const d = express ? (s.days_express ?? s.days_regular) : s.days_regular
    if (d > days) days = d
  }
  return addDaysISO(receivedAt, days)
}

// ---------- order numbers ----------

const ORDER_NUMBER_RE = /^LD-(\d{6})-(\d+)$/

/**
 * 'LD-YYYYMM-NNNN' for the month of receivedAt: the highest sequence already used in that month + 1 (1 when
 * none), padded to 4 digits (longer when needed). On a unique-constraint error (two phones at once) the caller
 * reloads the numbers and tries again (ORDER_NUMBER_TAKEN_MESSAGE).
 */
export function nextOrderNumber(existingNumbers: Iterable<string>, receivedAt: string): string {
  const yyyymm = receivedAt.slice(0, 7).replace('-', '')
  let max = 0
  for (const n of existingNumbers) {
    const m = ORDER_NUMBER_RE.exec(n)
    if (!m || m[1] !== yyyymm) continue
    const seq = Number(m[2])
    if (seq > max) max = seq
  }
  return `LD-${yyyymm}-${String(max + 1).padStart(4, '0')}`
}

// ---------- prepaid packages ----------

/**
 * qty_total minus the qty of every item that draws on this package, except items on cancelled orders
 * (SPEC 3.4). `items` and `orders` may be the organisation's whole lists. An item whose order is not in
 * `orders` still counts (safer than giving away qty).
 */
export function packageRemaining(
  pkg: Pick<CustomerPackage, 'id' | 'qty_total'>,
  items: Pick<OrderItem, 'order_id' | 'customer_package_id' | 'qty'>[],
  orders: Pick<Order, 'id' | 'status'>[],
): number {
  const cancelled = new Set<string>()
  for (const o of orders) if (o.status === 'cancelled') cancelled.add(o.id)
  let used = 0
  for (const it of items) {
    if (it.customer_package_id === pkg.id && !cancelled.has(it.order_id)) used += it.qty
  }
  return roundQty(pkg.qty_total - used)
}

/**
 * Why this package cannot be used on an order of `customerId` for `serviceId` received on `receivedAt`
 * (SPEC 3.4), or null when it can: same customer, same service, not expired on the received date.
 * The remaining qty is checked separately (packageRemaining).
 */
export function packageProblem(
  pkg: Pick<CustomerPackage, 'customer_id' | 'service_id' | 'expires_at'>,
  customerId: string,
  serviceId: string,
  receivedAt: string,
): string | null {
  if (pkg.customer_id !== customerId) return ERR_PACKAGE_OTHER_CUSTOMER
  if (pkg.service_id !== serviceId) return ERR_PACKAGE_OTHER_SERVICE
  if (pkg.expires_at !== null && pkg.expires_at < receivedAt) return ERR_PACKAGE_EXPIRED
  return null
}

/** packageProblem(...) === null */
export function packageUsable(
  pkg: Pick<CustomerPackage, 'customer_id' | 'service_id' | 'expires_at'>,
  customerId: string,
  serviceId: string,
  receivedAt: string,
): boolean {
  return packageProblem(pkg, customerId, serviceId, receivedAt) === null
}

// ---------- order drafts (the order form) ----------

export interface OrderDraftItem {
  service_id: string
  /** as typed; the billed qty is effectiveQty(qty, service.min_qty) */
  qty: number
  /** take the qty from this prepaid package (unit_price becomes 0); null/undefined = pay per unit */
  customer_package_id?: string | null
  notes?: string | null
}

export interface OrderDraft {
  customer_id: string | null
  /** 'YYYY-MM-DD' */
  received_at: string
  express: boolean
  discount: number
  items: OrderDraftItem[]
  /** down payment taken with the order; 0 or undefined = none */
  payment?: number
}

/** What the draft is checked against: the organisation's lists (or the customer's subset of packages). */
export interface OrderDraftContext {
  services: Service[]
  packages: CustomerPackage[]
  /** every order item and order of the organisation, for the packages' remaining qty */
  orderItems: OrderItem[]
  orders: Order[]
  /** when editing an existing order: its own items are replaced, so they do not count against the packages */
  excludeOrderId?: string | null
}

/** A ready-to-insert order_items row (without org_id/order_id): the service copied at the time. */
export interface PricedItem {
  service_id: string
  service_name: string
  unit: Unit
  /** effective (minimum applied) qty */
  qty: number
  unit_price: number
  line_total: number
  customer_package_id: string | null
  notes: string | null
}

/**
 * Prices draft items against the price list: copies name/unit, applies min_qty, the express price (throws
 * noExpressMessage when a service has none) and 0 for package items. Throws ERR_SERVICE_UNKNOWN or the
 * qty problem (qtyProblem) too; validateOrderDraft collects the same problems as a list instead.
 */
export function priceDraftItems(items: OrderDraftItem[], services: Pick<Service, 'id' | 'name' | 'unit' | 'price' | 'price_express' | 'min_qty'>[], express: boolean): PricedItem[] {
  const byId = new Map(services.map((s) => [s.id, s]))
  return items.map((it) => {
    const service = byId.get(it.service_id)
    if (!service) throw new Error(ERR_SERVICE_UNKNOWN)
    const problem = qtyProblem(it.qty, service.unit)
    if (problem) throw new Error(problem)
    const qty = effectiveQty(it.qty, service.min_qty)
    const usesPackage = Boolean(it.customer_package_id)
    const price = usesPackage ? 0 : unitPrice(service, express)
    return {
      service_id: service.id,
      service_name: service.name,
      unit: service.unit,
      qty,
      unit_price: price,
      line_total: lineTotal(qty, price),
      customer_package_id: it.customer_package_id ?? null,
      notes: it.notes?.trim() || null,
    }
  })
}

/**
 * Every reason the draft cannot be saved, in Indonesian, in form order (customer, items, packages,
 * discount, payment); [] when it can. Duplicates are dropped.
 */
export function validateOrderDraft(draft: OrderDraft, ctx: OrderDraftContext): string[] {
  const errors: string[] = []
  const add = (msg: string) => {
    if (!errors.includes(msg)) errors.push(msg)
  }
  if (!draft.customer_id) add(ERR_NO_CUSTOMER)
  if (draft.items.length === 0) add(ERR_NO_ITEMS)

  const serviceById = new Map(ctx.services.map((s) => [s.id, s]))
  let itemsOk = true
  for (const it of draft.items) {
    const service = serviceById.get(it.service_id)
    if (!service) {
      add(ERR_SERVICE_UNKNOWN)
      itemsOk = false
      continue
    }
    const problem = qtyProblem(it.qty, service.unit)
    if (problem) {
      add(problem)
      itemsOk = false
    }
    if (draft.express && !it.customer_package_id && service.price_express == null) {
      add(noExpressMessage(service.name))
      itemsOk = false
    }
  }

  // packages: ownership, service, expiry, then the remaining qty across every draft line that uses one
  const packageById = new Map(ctx.packages.map((p) => [p.id, p]))
  const wanted = new Map<string, number>()
  for (const it of draft.items) {
    if (!it.customer_package_id) continue
    const pkg = packageById.get(it.customer_package_id)
    const service = serviceById.get(it.service_id)
    if (!pkg) {
      add(ERR_PACKAGE_UNKNOWN)
      itemsOk = false
      continue
    }
    if (draft.customer_id && service) {
      const problem = packageProblem(pkg, draft.customer_id, service.id, draft.received_at)
      if (problem) {
        add(problem)
        itemsOk = false
      }
    }
    const qty = service ? effectiveQty(it.qty, service.min_qty) : it.qty
    wanted.set(pkg.id, (wanted.get(pkg.id) ?? 0) + (Number.isFinite(qty) && qty > 0 ? qty : 0))
  }
  for (const [pkgId, qty] of wanted) {
    const pkg = packageById.get(pkgId)
    if (!pkg) continue
    const items = ctx.excludeOrderId ? ctx.orderItems.filter((i) => i.order_id !== ctx.excludeOrderId) : ctx.orderItems
    const remaining = packageRemaining(pkg, items, ctx.orders)
    if (roundQty(qty) > remaining) {
      const unit = serviceById.get(pkg.service_id)?.unit ?? 'kg'
      add(packageInsufficientMessage(remaining, unit))
      itemsOk = false
    }
  }

  if (!Number.isFinite(draft.discount) || draft.discount < 0) add(ERR_DISCOUNT_NEGATIVE)
  const payment = draft.payment ?? 0
  if (!Number.isFinite(payment) || payment < 0) add(ERR_PAYMENT_NEGATIVE)

  if (itemsOk && draft.items.length > 0 && draft.discount >= 0) {
    const subtotal = sumLineTotals(priceDraftItems(draft.items, ctx.services, draft.express))
    if (draft.discount > subtotal) add(ERR_DISCOUNT_EXCEEDS)
    else if (payment > subtotal - draft.discount) add(ERR_PAYMENT_EXCEEDS)
  }
  return errors
}
