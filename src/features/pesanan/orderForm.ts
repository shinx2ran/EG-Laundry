/**
 * The order form's draft rows (SPEC 3.3, 3.4, 3.12): what the kasir types per line, how a typed quantity is read
 * ('2,5' kg), which prepaid package a line may draw on, and the live totals shown while typing. Pure, unit-tested;
 * the hook prices and validates the finished draft with src/domain/pricing.ts.
 */
import type { CustomerPackage, Order, OrderItem, Service, Unit } from '../../types/db'
import { effectiveQty, lineTotal, noExpressMessage, packageRemaining, packageUsable, qtyProblem, roundQty, type OrderDraftItem } from '../../domain/pricing'
import { newId } from '../../lib/ids'

export interface DraftRow {
  /** stable key for React lists */
  key: string
  /** the order_items row this line edits; null for a new line */
  id: string | null
  /** '' = not chosen yet */
  service_id: string
  qty: number
  /** take the qty from this package (unit price 0); null = pay per unit */
  customer_package_id: string | null
  notes: string
}

export const ROW_SERVICE_MESSAGE = 'Pilih layanan pada setiap baris.'

export function newDraftRow(service_id = '', qty = 1): DraftRow {
  return { key: newId(), id: null, service_id, qty, customer_package_id: null, notes: '' }
}

/** Existing items of an order as editable rows (the Ubah dialog). */
export function rowsFromItems(items: Pick<OrderItem, 'id' | 'service_id' | 'qty' | 'customer_package_id' | 'notes'>[]): DraftRow[] {
  return items.map((it) => ({
    key: it.id,
    id: it.id,
    service_id: it.service_id ?? '',
    qty: it.qty,
    customer_package_id: it.customer_package_id,
    notes: it.notes ?? '',
  }))
}

/**
 * Rows as draft items for pricing/validation. Rows without a service are left out (rowProblem reports them), except
 * an existing line whose service was deleted later (`keepIds`: it keeps its old copy, see keepOldPrices).
 */
export function rowsToDraftItems(rows: DraftRow[], keepIds: ReadonlySet<string> = new Set()): (OrderDraftItem & { id: string | null })[] {
  return rows
    .filter((r) => r.service_id !== '' || (r.id !== null && keepIds.has(r.id)))
    .map((r) => ({ id: r.id, service_id: r.service_id, qty: r.qty, customer_package_id: r.customer_package_id, notes: r.notes.trim() || null }))
}

/** The form-level problem of the rows themselves, before the domain validation (`keepIds` as in rowsToDraftItems). */
export function rowProblem(rows: DraftRow[], keepIds: ReadonlySet<string> = new Set()): string | null {
  return rows.some((r) => r.service_id === '' && !(r.id !== null && keepIds.has(r.id))) ? ROW_SERVICE_MESSAGE : null
}

// ---------- quantities ----------

/** A typed kg amount: '2,5' or '2.5' -> 2.5; '' or nonsense -> null. Negative values read as null too. */
export function parseQtyText(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (!/^\d*(\.\d*)?$/.test(t) || t === '' || t === '.') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** 2.5 -> '2,5'; 3 -> '3' (Indonesian decimal comma, at most 2 decimals, no thousands separator). */
export function qtyText(qty: number): string {
  if (!Number.isFinite(qty)) return ''
  return String(roundQty(qty)).replace('.', ',')
}

/** qty + delta on 2 decimals, never below `min` (0.5 steps in the UI, SPEC 3.12). */
export function stepQty(qty: number, delta: number, min = 0): number {
  const next = roundQty((Number.isFinite(qty) ? qty : 0) + delta)
  return next < min ? min : next
}

/** 'min. 2 kg' when the typed qty is below the service's minimum (it is billed as the minimum), else null. */
export function minQtyHint(qty: number, service: Pick<Service, 'min_qty' | 'unit'> | undefined): string | null {
  if (!service || service.min_qty <= 0 || !(qty < service.min_qty)) return null
  return `min. ${qtyText(service.min_qty)} ${service.unit}`
}

// ---------- prepaid packages (SPEC 3.4) ----------

export interface PackageChoice {
  pkg: CustomerPackage
  /** what is left after the other orders (the edited order's own items excluded) */
  remaining: number
}

/**
 * The package a line for `serviceId` may draw on: the customer's, same service, not expired on `receivedAt`, with
 * something left. The one expiring first is offered when there are several; null when none.
 */
export function packageChoice(
  packages: CustomerPackage[],
  customerId: string | null,
  serviceId: string,
  receivedAt: string,
  orderItems: Pick<OrderItem, 'order_id' | 'customer_package_id' | 'qty'>[],
  orders: Pick<Order, 'id' | 'status'>[],
  excludeOrderId: string | null = null,
): PackageChoice | null {
  if (!customerId || !serviceId) return null
  const items = excludeOrderId ? orderItems.filter((i) => i.order_id !== excludeOrderId) : orderItems
  const usable = packages
    .filter((p) => packageUsable(p, customerId, serviceId, receivedAt))
    .map((pkg) => ({ pkg, remaining: packageRemaining(pkg, items, orders) }))
    .filter((c) => c.remaining > 0)
    .sort((a, b) => (a.pkg.expires_at ?? '9999').localeCompare(b.pkg.expires_at ?? '9999'))
  return usable[0] ?? null
}

// ---------- live totals ----------

export interface DraftLine {
  row: DraftRow
  service: Service | undefined
  /** qty raised to the service's minimum */
  billedQty: number
  /** null when the line cannot be priced (no service, no express price) */
  unitPrice: number | null
  lineTotal: number | null
  /** the Indonesian problem of this line, null when fine */
  problem: string | null
}

/** Prices each row on its own, so one unfinished row never blanks the totals of the others. */
export function draftLines(rows: DraftRow[], services: Pick<Service, 'id' | 'name' | 'unit' | 'price' | 'price_express' | 'min_qty'>[], express: boolean): DraftLine[] {
  const byId = new Map(services.map((s) => [s.id, s]))
  return rows.map((row) => {
    const service = byId.get(row.service_id) as Service | undefined
    if (!service) return { row, service, billedQty: row.qty, unitPrice: null, lineTotal: null, problem: ROW_SERVICE_MESSAGE }
    const problem = qtyProblem(row.qty, service.unit)
    const billedQty = effectiveQty(row.qty, service.min_qty)
    if (row.customer_package_id) return { row, service, billedQty, unitPrice: 0, lineTotal: 0, problem }
    const unitPrice = express ? service.price_express : service.price
    if (unitPrice === null) return { row, service, billedQty, unitPrice: null, lineTotal: null, problem: problem ?? noExpressMessage(service.name) }
    return { row, service, billedQty, unitPrice, lineTotal: problem ? null : lineTotal(billedQty, unitPrice), problem }
  })
}

export interface DraftSummary {
  subtotal: number
  discount: number
  total: number
}

/** subtotal over the priced lines; total never below 0. */
export function draftSummary(lines: Pick<DraftLine, 'lineTotal'>[], discount: number): DraftSummary {
  let subtotal = 0
  for (const l of lines) subtotal += l.lineTotal ?? 0
  const d = Number.isFinite(discount) && discount > 0 ? discount : 0
  return { subtotal, discount: d, total: Math.max(0, subtotal - d) }
}

/** 'Rp 8.000/kg' for the service select, with the express price when the order is express. */
export function servicePriceLabel(service: Pick<Service, 'price' | 'price_express' | 'unit'>, express: boolean, formatRupiah: (n: number) => string): string {
  const price = express ? service.price_express : service.price
  return price === null ? 'tidak ada express' : `${formatRupiah(price)}/${service.unit}`
}

/** The unit of the chosen service, kg when none is chosen yet. */
export function rowUnit(service: Pick<Service, 'unit'> | undefined): Unit {
  return service?.unit ?? 'kg'
}

/**
 * What the other rows of the draft already take from `packageId` (billed qty), so a row offers only what is
 * really left: two lines on the same package share it.
 */
export function draftPackageUse(rows: DraftRow[], services: Pick<Service, 'id' | 'min_qty'>[], packageId: string, exceptKey: string): number {
  const byId = new Map(services.map((s) => [s.id, s]))
  let used = 0
  for (const r of rows) {
    if (r.key === exceptKey || r.customer_package_id !== packageId) continue
    const s = byId.get(r.service_id)
    const qty = s ? effectiveQty(r.qty, s.min_qty) : r.qty
    if (Number.isFinite(qty) && qty > 0) used += qty
  }
  return roundQty(used)
}

// ---------- Ubah: old lines keep their prices (SPEC 3.1) ----------

const KEEP_PREFIX = 'keep:'

/** A line of the Ubah dialog: an existing order item (id) with new values, or a new line (id null/undefined). */
export interface EditLine {
  id?: string | null
  /** '' for an existing line whose service was deleted later */
  service_id: string
  qty: number
  customer_package_id?: string | null
}

export interface KeptPrices<T extends EditLine> {
  /** the lines, a kept line pointing at its stand-in service */
  lines: T[]
  /** the price list plus one stand-in service per kept line */
  services: Service[]
  /** per line: true when it keeps its old copy (name, unit, unit price) */
  kept: boolean[]
}

/**
 * An order keeps the prices it was made with (SPEC 3.1: order_items hold a copy). In the Ubah dialog a line that
 * still bills the same service the same way (no package before or after, the express switch unchanged) keeps its
 * copied name, unit and unit price, also when the price list changed since or the service was deactivated or
 * deleted; only its qty and notes change. Every other line (new, another service, package on or off, express
 * switched) is priced from the current price list. The kept lines point at a stand-in service ('keep:<item id>')
 * carrying the old copy, so validateOrderDraft, priceDraftItems and draftLines work on the result unchanged;
 * keptServiceId() maps a stand-in back. The minimum qty is applied again only when the qty was changed.
 */
export function keepOldPrices<T extends EditLine>(
  lines: T[],
  existing: Pick<OrderItem, 'id' | 'service_id' | 'service_name' | 'unit' | 'unit_price' | 'qty' | 'customer_package_id'>[],
  services: Service[],
  express: boolean,
  wasExpress: boolean,
): KeptPrices<T> {
  const existingById = new Map(existing.map((i) => [i.id, i]))
  const serviceById = new Map(services.map((s) => [s.id, s]))
  const extra: Service[] = []
  const used = new Set<string>()
  const kept: boolean[] = []
  const mapped = lines.map((line) => {
    const item = line.id ? existingById.get(line.id) : undefined
    const keep =
      item !== undefined &&
      !used.has(item.id) &&
      express === wasExpress &&
      !item.customer_package_id &&
      !line.customer_package_id &&
      line.service_id === (item.service_id ?? '')
    kept.push(keep)
    if (!keep || !item) return line
    used.add(item.id)
    const real = item.service_id ? serviceById.get(item.service_id) : undefined
    extra.push({
      id: `${KEEP_PREFIX}${item.id}`,
      org_id: real?.org_id ?? '',
      created_at: real?.created_at ?? '',
      updated_at: real?.updated_at ?? '',
      name: item.service_name,
      unit: item.unit,
      price: item.unit_price,
      price_express: item.unit_price,
      days_regular: real?.days_regular ?? 0,
      days_express: real?.days_express ?? null,
      min_qty: line.qty === item.qty ? 0 : (real?.min_qty ?? 0),
      sort_order: real?.sort_order ?? 0,
      active: true,
    })
    return { ...line, service_id: `${KEEP_PREFIX}${item.id}` }
  })
  return { lines: mapped, services: extra.length > 0 ? [...services, ...extra] : services, kept }
}

/** The real service id behind a (possibly stand-in) service id; null for a kept line whose service was deleted. */
export function keptServiceId(serviceId: string, existing: Pick<OrderItem, 'id' | 'service_id'>[]): string | null {
  if (!serviceId.startsWith(KEEP_PREFIX)) return serviceId
  const id = serviceId.slice(KEEP_PREFIX.length)
  return existing.find((i) => i.id === id)?.service_id ?? null
}
