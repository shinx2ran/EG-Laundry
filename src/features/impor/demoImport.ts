/**
 * "Pindahkan data Mode Demo ke online" planning. Pure: given an EG Laundry backup (Pengaturan → Data → Unduh
 * cadangan JSON in Mode Demo, parsed by parseBackupText) and what the online laundry already has, decide which rows
 * to insert, in an order the database accepts, each with a NEW UUID and every foreign key remapped (Mode Demo ids
 * such as 'demo-order-01' are not UUIDs, and a backup imported twice must not collide with itself).
 *
 * - Only the seven laundry tables are read: the demo organisation's own rows (organizations, members,
 *   invitations, audit_log) are never copied. org_id comes from the OrgRepo, created_by/updated_at from the
 *   database; created_at is kept so lists stay in their old order.
 * - Order: services → package_catalog → customers → customer_packages → orders → order_items → payments, i.e.
 *   every parent before its children, packages before the items that draw on them, items before the payments
 *   (payments_limit compares payments with the items' total).
 * - What is already online is reused instead of duplicated: a service with the same name and unit, a catalog
 *   package with the same name for that service, a customer with the same phone number (one match only).
 * - The Mode Demo sample data (buildDemoDb, fixed 'demo-…' ids) stays behind unless includeSample: the price list
 *   always comes along (it is the owner's to edit), sample customers and packages only when one of the owner's
 *   own rows uses them, sample orders (with their items and payments) never.
 * - Every column is written explicitly (a bulk insert turns a missing key into NULL) and checked like the
 *   database would; a row that would be refused is skipped and counted, and so is every row that depends on it.
 */
import { lineTotal, roundQty } from '../../domain/pricing'
import { newId as randomId } from '../../lib/ids'
import { DEMO_ORG_ID } from '../../lib/repo/demoSeed'
import { ORDER_STATUSES, PAYMENT_METHODS, UNITS, type Customer, type PackageCatalogItem, type Row, type Service } from '../../types/db'
import type { BackupRow, ParsedBackup } from '../settings/data/backupFormat'
import { phoneKey } from './tenantImport'

/** Insert order: parents before children. */
export const DEMO_IMPORT_ORDER = ['services', 'package_catalog', 'customers', 'customer_packages', 'orders', 'order_items', 'payments'] as const
export type DemoImportTable = (typeof DEMO_IMPORT_ORDER)[number]

/** Count nouns: '6 layanan, 12 pelanggan'. */
export const DEMO_TABLE_NOUN: Record<DemoImportTable, string> = {
  services: 'layanan',
  package_catalog: 'paket katalog',
  customers: 'pelanggan',
  customer_packages: 'paket terjual',
  orders: 'pesanan',
  order_items: 'item pesanan',
  payments: 'pembayaran',
}

// ---------------------------------------------------------------- columns

type ColType = 'text' | 'int' | 'qty' | 'bool' | 'date' | 'timestamp' | 'ref' | readonly string[]
interface Col {
  type: ColType
  required?: true
  /** value written when the backup has none */
  def?: string | number | boolean
  /** int/qty: smallest allowed value; qty also > 0 when positive */
  min?: number
  positive?: true
  /** ref: the table the id points into */
  target?: DemoImportTable
  /** ref: a nullable reference whose row is not imported is cleared (ON DELETE SET NULL) instead of skipping */
  nullIfMissing?: true
}

type ServerColumns = 'id' | 'org_id' | 'created_at' | 'updated_at' | 'created_by'
type DataColumns<T extends DemoImportTable> = Exclude<keyof Row<T>, ServerColumns> & string

const text: Col = { type: 'text' }
const reqText: Col = { type: 'text', required: true }
const money: Col = { type: 'int', required: true, min: 0 }
const optMoney: Col = { type: 'int', min: 0 }
const reqDate: Col = { type: 'date', required: true }
const ref = (target: DemoImportTable, opts: Partial<Col> = {}): Col => ({ type: 'ref', target, ...opts })

/** Every insertable column per table (typed against src/types/db.ts, so a new column fails to compile here). */
const COLUMNS: { [T in DemoImportTable]: { [K in DataColumns<T>]: Col } } = {
  services: {
    name: reqText,
    unit: { type: UNITS, required: true },
    price: money,
    price_express: optMoney,
    days_regular: { type: 'int', min: 0, def: 3 },
    days_express: { type: 'int', min: 0 },
    min_qty: { type: 'qty', min: 0, def: 0 },
    sort_order: { type: 'int', def: 0 },
    active: { type: 'bool', def: true },
  },
  package_catalog: {
    name: reqText,
    service_id: ref('services', { required: true }),
    qty: { type: 'qty', required: true, positive: true },
    price: money,
    valid_days: { type: 'int', min: 1 },
    active: { type: 'bool', def: true },
  },
  customers: {
    name: reqText,
    phone: text,
    is_tenant: { type: 'bool', def: false },
    room_name: text,
    kos_tenant_id: text,
    address: text,
    notes: text,
  },
  customer_packages: {
    customer_id: ref('customers', { required: true }),
    catalog_id: ref('package_catalog', { nullIfMissing: true }),
    name: reqText,
    service_id: ref('services', { required: true }),
    qty_total: { type: 'qty', required: true, positive: true },
    price: money,
    purchased_at: reqDate,
    expires_at: { type: 'date' },
    method: { type: PAYMENT_METHODS, def: 'cash' },
    notes: text,
  },
  orders: {
    order_number: reqText,
    customer_id: ref('customers', { required: true }),
    received_at: reqDate,
    promised_at: { type: 'date' },
    express: { type: 'bool', def: false },
    status: { type: ORDER_STATUSES, def: 'received' },
    ready_at: { type: 'timestamp' },
    picked_up_at: { type: 'timestamp' },
    discount: { type: 'int', min: 0, def: 0 },
    notes: text,
  },
  order_items: {
    order_id: ref('orders', { required: true }),
    service_id: ref('services', { nullIfMissing: true }),
    service_name: reqText,
    unit: { type: UNITS, required: true },
    unit_price: money,
    qty: { type: 'qty', required: true, positive: true },
    line_total: { type: 'int', required: true },
    customer_package_id: ref('customer_packages'),
    notes: text,
  },
  payments: {
    order_id: ref('orders', { required: true }),
    amount: { type: 'int', required: true, min: 1 },
    paid_at: reqDate,
    method: { type: PAYMENT_METHODS, def: 'cash' },
    notes: text,
  },
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/
/** numeric(8,2) */
const MAX_QTY = 999_999.99

type Result = { ok: true; value: unknown } | { ok: false }
const ok = (value: unknown): Result => ({ ok: true, value })
const FAIL: Result = { ok: false }

function normalizeValue(col: Col, value: unknown): Result {
  const missing = value === undefined || value === null || (typeof value === 'string' && value.trim() === '' && col.type !== 'text')
  if (missing || (col.required && col.type === 'text' && typeof value === 'string' && value.trim() === '')) {
    return col.required ? FAIL : ok(col.def ?? null)
  }
  switch (col.type) {
    case 'text':
      if (typeof value === 'number') return ok(String(value))
      if (typeof value !== 'string') return FAIL
      return ok(value.trim() === '' ? null : value)
    case 'ref':
      return typeof value === 'string' ? ok(value) : FAIL
    case 'int':
      return typeof value === 'number' && Number.isSafeInteger(value) && (col.min === undefined || value >= col.min) ? ok(value) : FAIL
    case 'qty': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return FAIL
      const q = roundQty(value)
      if (q > MAX_QTY || (col.min !== undefined && q < col.min) || (col.positive && q <= 0)) return FAIL
      return ok(q)
    }
    case 'bool':
      return typeof value === 'boolean' ? ok(value) : FAIL
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value) ? ok(value.slice(0, 10)) : FAIL
    case 'timestamp':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? ok(value) : FAIL
    default:
      return typeof value === 'string' && col.type.includes(value) ? ok(value) : FAIL
  }
}

/** The checks of supabase/schema.sql that span several columns. */
function passesChecks(table: DemoImportTable, r: Record<string, unknown>): boolean {
  if (table !== 'order_items') return true
  const qty = r.qty as number
  if (r.unit === 'pcs' && !Number.isInteger(qty)) return false
  if (r.customer_package_id !== null && r.unit_price !== 0) return false
  return r.line_total === lineTotal(qty, r.unit_price as number)
}

/** Whitelisted, defaulted copy of a backup row (references still the backup's ids), or null when the database would refuse it. */
export function normalizeDemoRow(table: DemoImportTable, raw: BackupRow): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  for (const [column, col] of Object.entries(COLUMNS[table] as Record<string, Col>)) {
    const result = normalizeValue(col, raw[column])
    if (!result.ok) return null
    out[column] = result.value
  }
  return passesChecks(table, out) ? out : null
}

function refColumns(table: DemoImportTable): [string, Col][] {
  return Object.entries(COLUMNS[table] as Record<string, Col>).filter(([, c]) => c.type === 'ref')
}

// ---------------------------------------------------------------- plan

export interface ExistingOnline {
  services: readonly Pick<Service, 'id' | 'name' | 'unit'>[]
  package_catalog: readonly Pick<PackageCatalogItem, 'id' | 'name' | 'service_id'>[]
  customers: readonly Pick<Customer, 'id' | 'phone'>[]
}

export const NOTHING_ONLINE: ExistingOnline = { services: [], package_catalog: [], customers: [] }

export interface DemoImportOptions {
  /** also bring the Mode Demo sample customers, packages and orders */
  includeSample?: boolean
  /** id generator (tests pass a counter) */
  newId?: () => string
  /** created_at for rows without a usable one */
  now?: Date
}

export type DemoTableCounts = Record<DemoImportTable, number>

export interface DemoImportPlan {
  /** rows to insert per table, in DEMO_IMPORT_ORDER, without org_id */
  tables: Record<DemoImportTable, Record<string, unknown>[]>
  /** backup rows that use a row already online instead of a new one */
  reused: Pick<DemoTableCounts, 'services' | 'package_catalog' | 'customers'>
  /** rows the database would refuse (missing/invalid data, a broken reference, a payment above the order total) */
  skipped: DemoTableCounts
  /** Mode Demo sample rows (fixed 'demo-…' ids) left behind; zero with includeSample */
  sampleLeftOut: Pick<DemoTableCounts, 'customers' | 'customer_packages' | 'orders'>
  /** the backup has Mode Demo sample customers or orders at all (the screen then offers includeSample) */
  hasSample: boolean
  /** backup id -> id online (new, or the reused row's) */
  idMap: ReadonlyMap<string, string>
}

export function emptyCounts(): DemoTableCounts {
  return { services: 0, package_catalog: 0, customers: 0, customer_packages: 0, orders: 0, order_items: 0, payments: 0 }
}

const nameKey = (name: unknown) => String(name ?? '').trim().toLowerCase()

/**
 * Decide what to insert (see the file comment). `existing` is what the online laundry already has; the screen
 * shows this card only while it has no orders, so order numbers cannot clash.
 */
export function planDemoImport(backup: ParsedBackup, existing: ExistingOnline = NOTHING_ONLINE, options: DemoImportOptions = {}): DemoImportPlan {
  const newId = options.newId ?? randomId
  const nowIso = (options.now ?? new Date()).toISOString()
  const includeSample = options.includeSample ?? false
  const sourceOrg = typeof backup.tables.organizations[0]?.id === 'string' ? backup.tables.organizations[0].id : null
  const isSample = (row: BackupRow) => sourceOrg === DEMO_ORG_ID && row.id.startsWith('demo-')

  const skipped = emptyCounts()
  /** valid rows per table by backup id, in backup order */
  const valid = {} as Record<DemoImportTable, Map<string, Record<string, unknown>>>
  const createdAt = new Map<string, string>()
  for (const table of DEMO_IMPORT_ORDER) {
    valid[table] = new Map()
    for (const raw of backup.tables[table]) {
      const fromOtherOrg = sourceOrg !== null && raw.org_id != null && raw.org_id !== sourceOrg
      const row = fromOtherOrg || valid[table].has(raw.id) ? null : normalizeDemoRow(table, raw)
      if (!row) {
        skipped[table]++
        continue
      }
      valid[table].set(raw.id, row)
      createdAt.set(`${table}:${raw.id}`, typeof raw.created_at === 'string' && !Number.isNaN(Date.parse(raw.created_at)) ? raw.created_at : nowIso)
    }
  }
  const sampleIds = new Set<string>()
  for (const table of DEMO_IMPORT_ORDER) for (const raw of backup.tables[table]) if (isSample(raw)) sampleIds.add(raw.id)

  /** backup ids chosen per table (insertion follows the backup order) */
  const chosen = {} as Record<DemoImportTable, Set<string>>
  for (const table of DEMO_IMPORT_ORDER) chosen[table] = new Set()
  const drop = (table: DemoImportTable, id: string) => {
    chosen[table].delete(id)
    skipped[table]++
  }

  // the price list always comes along
  for (const id of valid.services.keys()) chosen.services.add(id)
  for (const [id, row] of valid.package_catalog) {
    if (valid.services.has(row.service_id as string)) chosen.package_catalog.add(id)
    else skipped.package_catalog++
  }

  // orders: the owner's own (or all with includeSample), for a customer the backup still has
  const orderNumbers = new Set<string>()
  /** orders that cannot be imported: their items and payments are skipped with them */
  const lostOrders = new Set<string>()
  for (const raw of backup.tables.orders) if (!valid.orders.has(raw.id)) lostOrders.add(raw.id)
  for (const [id, row] of valid.orders) {
    if (!includeSample && sampleIds.has(id)) continue
    const number = row.order_number as string
    if (!valid.customers.has(row.customer_id as string) || orderNumbers.has(number)) {
      skipped.orders++
      lostOrders.add(id)
      continue
    }
    orderNumbers.add(number)
    chosen.orders.add(id)
  }

  // items of those orders; an item drawing on a package needs that package (same customer, same service)
  const neededPackages = new Set<string>()
  for (const [id, row] of valid.order_items) {
    const orderId = row.order_id as string
    if (!chosen.orders.has(orderId)) {
      if (lostOrders.has(orderId) || !valid.orders.has(orderId)) skipped.order_items++
      continue
    }
    const pkgId = row.customer_package_id as string | null
    if (pkgId !== null) {
      const pkg = valid.customer_packages.get(pkgId)
      const order = valid.orders.get(orderId)!
      const usable = pkg && pkg.customer_id === order.customer_id && pkg.service_id === row.service_id && valid.customers.has(pkg.customer_id as string) && valid.services.has(pkg.service_id as string)
      if (!usable) {
        skipped.order_items++
        continue
      }
      neededPackages.add(pkgId)
    }
    chosen.order_items.add(id)
  }

  for (const [id, row] of valid.customer_packages) {
    if (!includeSample && sampleIds.has(id) && !neededPackages.has(id)) continue
    if (valid.customers.has(row.customer_id as string) && valid.services.has(row.service_id as string)) chosen.customer_packages.add(id)
    else skipped.customer_packages++
  }

  const neededCustomers = new Set<string>()
  for (const id of chosen.orders) neededCustomers.add(valid.orders.get(id)!.customer_id as string)
  for (const id of chosen.customer_packages) neededCustomers.add(valid.customer_packages.get(id)!.customer_id as string)
  for (const id of valid.customers.keys()) if (includeSample || !sampleIds.has(id) || neededCustomers.has(id)) chosen.customers.add(id)

  // payments of the chosen orders, oldest first, never above the order's total
  const totals = new Map<string, number>()
  for (const id of chosen.order_items) {
    const item = valid.order_items.get(id)!
    const orderId = item.order_id as string
    totals.set(orderId, (totals.get(orderId) ?? 0) + (item.line_total as number))
  }
  const paid = new Map<string, number>()
  const paymentIds = [...valid.payments.keys()].sort((a, b) => {
    const pa = valid.payments.get(a)!
    const pb = valid.payments.get(b)!
    return String(pa.paid_at).localeCompare(String(pb.paid_at)) || createdAt.get(`payments:${a}`)!.localeCompare(createdAt.get(`payments:${b}`)!) || (a < b ? -1 : 1)
  })
  for (const id of paymentIds) {
    const row = valid.payments.get(id)!
    const orderId = row.order_id as string
    if (!chosen.orders.has(orderId)) {
      if (lostOrders.has(orderId) || !valid.orders.has(orderId)) skipped.payments++
      continue
    }
    const total = Math.max(0, (totals.get(orderId) ?? 0) - (valid.orders.get(orderId)!.discount as number))
    const sum = (paid.get(orderId) ?? 0) + (row.amount as number)
    if (sum > total) {
      skipped.payments++
      continue
    }
    paid.set(orderId, sum)
    chosen.payments.add(id)
  }
  // keep the backup order for the inserts
  chosen.payments = new Set([...valid.payments.keys()].filter((id) => chosen.payments.has(id)))

  // ids: reuse what is online, otherwise a new UUID
  const idMap = new Map<string, string>()
  const reused = { services: 0, package_catalog: 0, customers: 0 }
  const onlineService = new Map(existing.services.map((s) => [`${nameKey(s.name)}|${s.unit}`, s.id]))
  const onlineCatalog = new Map(existing.package_catalog.map((c) => [`${nameKey(c.name)}|${c.service_id}`, c.id]))
  const onlineByPhone = new Map<string, string[]>()
  for (const c of existing.customers) {
    const key = phoneKey(c.phone)
    if (key) onlineByPhone.set(key, [...(onlineByPhone.get(key) ?? []), c.id])
  }
  const tables = {} as DemoImportPlan['tables']
  const reuse = (table: 'services' | 'package_catalog' | 'customers', id: string, onlineId: string | undefined): boolean => {
    if (!onlineId) return false
    idMap.set(id, onlineId)
    reused[table]++
    return true
  }

  for (const table of DEMO_IMPORT_ORDER) {
    tables[table] = []
    for (const id of chosen[table]) {
      const row = { ...valid[table].get(id)! }
      // references first: they decide whether the row is still insertable (and the reuse keys use them)
      let broken = false
      for (const [column, col] of refColumns(table)) {
        const target = row[column] as string | null
        if (target === null) continue
        const mapped = idMap.get(target)
        if (mapped && chosen[col.target!].has(target)) row[column] = mapped
        else if (col.nullIfMissing) row[column] = null
        else broken = true
      }
      if (broken) {
        drop(table, id)
        continue
      }
      if (table === 'services' && reuse('services', id, onlineService.get(`${nameKey(row.name)}|${String(row.unit)}`))) continue
      if (table === 'package_catalog' && reuse('package_catalog', id, onlineCatalog.get(`${nameKey(row.name)}|${String(row.service_id)}`))) continue
      if (table === 'customers') {
        const matches = onlineByPhone.get(phoneKey(row.phone as string | null) ?? '') ?? []
        if (matches.length === 1 && reuse('customers', id, matches[0])) continue
      }
      const fresh = newId()
      idMap.set(id, fresh)
      tables[table].push({ id: fresh, ...row, created_at: createdAt.get(`${table}:${id}`) })
    }
  }

  const sampleLeftOut = { customers: 0, customer_packages: 0, orders: 0 }
  for (const t of ['customers', 'customer_packages', 'orders'] as const) {
    for (const id of valid[t].keys()) if (sampleIds.has(id) && !chosen[t].has(id)) sampleLeftOut[t]++
  }
  const hasSample = [...valid.customers.keys(), ...valid.orders.keys()].some((id) => sampleIds.has(id))
  return { tables, reused, skipped, sampleLeftOut, hasSample, idMap }
}

/** Rows to insert per table. */
export function plannedCounts(plan: DemoImportPlan): DemoTableCounts {
  const counts = emptyCounts()
  for (const t of DEMO_IMPORT_ORDER) counts[t] = plan.tables[t].length
  return counts
}

export function totalCount(counts: Partial<DemoTableCounts>): number {
  return DEMO_IMPORT_ORDER.reduce((sum, t) => sum + (counts[t] ?? 0), 0)
}

/** '6 layanan, 12 pelanggan, 40 pesanan' (zeros left out); '' when everything is zero. */
export function countsText(counts: Partial<DemoTableCounts>): string {
  return DEMO_IMPORT_ORDER.filter((t) => (counts[t] ?? 0) > 0)
    .map((t) => `${counts[t]} ${DEMO_TABLE_NOUN[t]}`)
    .join(', ')
}
