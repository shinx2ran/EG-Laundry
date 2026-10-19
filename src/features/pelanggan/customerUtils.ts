/**
 * Pure helpers of the customers module (SPEC 3.2 customers, 3.4 selling prepaid packages, 3.9 WhatsApp):
 * form <-> row mapping, validation, search, the Semua / Anak kos / Umum filter, visit statistics for the
 * list and the package sale row. No React, no I/O, so everything here is unit-tested in node.
 */
import type { Customer, CustomerPackage, Order, OrgInsert, PackageCatalogItem, PaymentMethod, Update } from '../../types/db'
import { addDaysISO, daysBetween, formatDate, normalizePhone, parseDate, toDateISO } from '../../lib/format'

// ---------------------------------------------------------------- form

/** Form state: every column as a string so inputs stay controlled; '' means "empty". */
export interface CustomerFormValues {
  name: string
  /** as typed; stored as typed (SPEC 3.2), matched through normalizePhone */
  phone: string
  /** "Anak kos EG Kost" switch; reveals the room field */
  is_tenant: boolean
  room_name: string
  address: string
  notes: string
}

export type CustomerFormErrors = Partial<Record<keyof CustomerFormValues, string>>

export const EMPTY_CUSTOMER_FORM: CustomerFormValues = {
  name: '',
  phone: '',
  is_tenant: false,
  room_name: '',
  address: '',
  notes: '',
}

export const ERR_NAME_REQUIRED = 'Nama wajib diisi.'
export const ERR_NAME_SHORT = 'Nama terlalu pendek.'
export const ERR_PHONE_INVALID = 'Nomor HP tidak valid. Contoh: 0812-3456-7890.'
export const ERR_ROOM_LONG = 'Nama kamar maksimal 20 karakter.'

/** Row -> form values (nulls become ''). */
export function customerToForm(customer: Customer): CustomerFormValues {
  return {
    name: customer.name,
    phone: customer.phone ?? '',
    is_tenant: customer.is_tenant,
    room_name: customer.room_name ?? '',
    address: customer.address ?? '',
    notes: customer.notes ?? '',
  }
}

function clean(value: string): string | null {
  const t = value.trim()
  return t === '' ? null : t
}

/** Only '+' and digits may remain after normalisation, and Indonesian numbers have 9..15 digits. */
export function isPlausiblePhone(normalized: string): boolean {
  const digits = normalized.replace(/[^0-9]/g, '')
  return /^\+?\d+$/.test(normalized) && digits.length >= 9 && digits.length <= 15
}

/** Validation messages in Indonesian; an empty object means valid. */
export function validateCustomerForm(values: CustomerFormValues): CustomerFormErrors {
  const errors: CustomerFormErrors = {}
  const name = values.name.trim()
  if (!name) errors.name = ERR_NAME_REQUIRED
  else if (name.length < 2) errors.name = ERR_NAME_SHORT
  const phone = normalizePhone(values.phone)
  if (values.phone.trim() && (!phone || !isPlausiblePhone(phone))) errors.phone = ERR_PHONE_INVALID
  if (values.is_tenant && values.room_name.trim().length > 20) errors.room_name = ERR_ROOM_LONG
  return errors
}

/**
 * Form values -> update patch. The phone is kept as typed (trimmed); the room only means something for a
 * tenant, so it is cleared otherwise; blanks become null. `kos_tenant_id` (the Woombad import, SPEC 3.8) is
 * not part of the form and stays untouched on an update.
 */
export function formToCustomerPatch(values: CustomerFormValues): Update<'customers'> {
  return {
    name: values.name.trim(),
    phone: clean(values.phone),
    is_tenant: values.is_tenant,
    room_name: values.is_tenant ? clean(values.room_name) : null,
    address: clean(values.address),
    notes: clean(values.notes),
  }
}

/** Form values -> insert payload of a new customer (no kos id: it comes from the import only). */
export function formToCustomerPayload(values: CustomerFormValues): OrgInsert<'customers'> {
  const patch = formToCustomerPatch(values)
  return {
    name: patch.name ?? '',
    phone: patch.phone ?? null,
    is_tenant: patch.is_tenant ?? false,
    room_name: patch.room_name ?? null,
    kos_tenant_id: null,
    address: patch.address ?? null,
    notes: patch.notes ?? null,
  }
}

export const PHONE_EXAMPLE_HINT = 'Contoh: 0812-3456-7890'

/** Under the phone field: how the typed number is recognised ('Dikenali sebagai +6281234567890'), or the example. */
export function phoneHint(phone: string): string {
  if (!phone.trim()) return PHONE_EXAMPLE_HINT
  const normalized = normalizePhone(phone)
  if (!normalized || !isPlausiblePhone(normalized)) return PHONE_EXAMPLE_HINT
  return `Dikenali sebagai ${normalized}`
}

// ---------------------------------------------------------------- list: filter, search, sort

export const CUSTOMER_FILTERS = ['all', 'tenant', 'walkin'] as const
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number]

export const CUSTOMER_FILTER_LABEL: Record<CustomerFilter, string> = {
  all: 'Semua',
  tenant: 'Anak kos',
  walkin: 'Umum',
}

/** `?jenis=` value per filter; null = not in the URL (the default) */
export const CUSTOMER_FILTER_PARAM: Record<CustomerFilter, string | null> = {
  all: null,
  tenant: 'kos',
  walkin: 'umum',
}

export function parseCustomerFilter(value: string | null | undefined): CustomerFilter {
  if (value === 'kos') return 'tenant'
  if (value === 'umum') return 'walkin'
  return 'all'
}

export function matchesCustomerFilter(customer: Pick<Customer, 'is_tenant'>, filter: CustomerFilter): boolean {
  if (filter === 'tenant') return customer.is_tenant
  if (filter === 'walkin') return !customer.is_tenant
  return true
}

/** How many customers each chip would show. */
export function customerFilterCounts(customers: Pick<Customer, 'is_tenant'>[]): Record<CustomerFilter, number> {
  let tenant = 0
  for (const c of customers) if (c.is_tenant) tenant++
  return { all: customers.length, tenant, walkin: customers.length - tenant }
}

/** a query that can only be a phone number: digits with + ( ) - . and spaces */
const PHONE_QUERY_RE = /^[+\d\s().-]+$/

/** A digit string in both Indonesian spellings: '62812…' and '0812…' (whichever it started as). */
function phoneForms(digits: string): string[] {
  const forms = new Set([digits])
  if (digits.startsWith('62')) forms.add(`0${digits.slice(2)}`)
  if (digits.startsWith('0')) forms.add(`62${digits.slice(1)}`)
  return [...forms]
}

/**
 * Case-insensitive search over the name and the phone. The phone is stored as typed (SPEC 3.2), so both sides
 * are compared digit by digit in the local and the +62 spelling ('0812' and '+62 812' both find
 * '0812-0000-0001') when the query looks like a phone number with at least 3 digits. A tenant is also found
 * by the exact room ('B3').
 */
export function matchesCustomerSearch(customer: Pick<Customer, 'name' | 'phone' | 'is_tenant' | 'room_name'>, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (customer.name.toLowerCase().includes(q)) return true
  if (customer.is_tenant && customer.room_name && customer.room_name.trim().toLowerCase() === q) return true
  const qDigits = q.replace(/[^0-9]/g, '')
  if (PHONE_QUERY_RE.test(q) && qDigits.length >= 3 && customer.phone) {
    const phone = phoneForms((normalizePhone(customer.phone) ?? customer.phone).replace(/[^0-9]/g, ''))
    const wanted = phoneForms(qDigits)
    if (phone.some((p) => wanted.some((w) => p.includes(w)))) return true
  }
  return false
}

export interface CustomerStats {
  /** received_at of the newest order that is not cancelled; null when the customer never had one */
  lastVisit: string | null
  /** orders that are not cancelled */
  orderCount: number
}

export const NO_VISITS: CustomerStats = { lastVisit: null, orderCount: 0 }

/**
 * Visits per customer in one pass over the organisation's orders. A cancelled order is not a visit (SPEC 3.2:
 * the list shows the last visit and the number of orders so the owner can pick who to send a promo to).
 */
export function customerStats(orders: Pick<Order, 'customer_id' | 'received_at' | 'status'>[]): Map<string, CustomerStats> {
  const map = new Map<string, CustomerStats>()
  for (const o of orders) {
    if (o.status === 'cancelled') continue
    const cur = map.get(o.customer_id)
    if (!cur) map.set(o.customer_id, { lastVisit: o.received_at, orderCount: 1 })
    else {
      cur.orderCount++
      if (cur.lastVisit === null || o.received_at > cur.lastVisit) cur.lastVisit = o.received_at
    }
  }
  return map
}

/** Name order for ties and for customers who never visited. */
function byName(a: Pick<Customer, 'name'>, b: Pick<Customer, 'name'>): number {
  return a.name.localeCompare(b.name, 'id', { sensitivity: 'base' })
}

/** Most recent visit first; customers without a visit come last, each group A-Z by name. */
export function sortCustomersByVisit<T extends Pick<Customer, 'id' | 'name'>>(customers: T[], stats: Map<string, CustomerStats>): T[] {
  return [...customers].sort((a, b) => {
    const va = stats.get(a.id)?.lastVisit ?? ''
    const vb = stats.get(b.id)?.lastVisit ?? ''
    if (va !== vb) return vb < va ? -1 : 1
    return byName(a, b)
  })
}

/** 'Anak kos · B3' / 'Anak kos' for a tenant, null for a walk-in. */
export function tenantBadgeText(customer: Pick<Customer, 'is_tenant' | 'room_name'>): string | null {
  if (!customer.is_tenant) return null
  const room = customer.room_name?.trim()
  return room ? `Anak kos · ${room}` : 'Anak kos'
}

/**
 * The last visit as people say it: 'Hari ini', 'Kemarin', '3 hari lalu', '2 minggu lalu' (up to 7 weeks),
 * then the date; 'Belum pernah' without a visit.
 */
export function lastVisitText(lastVisit: string | null, todayISO: string): string {
  if (!lastVisit) return 'Belum pernah'
  const days = daysBetween(lastVisit, todayISO)
  if (days <= 0) return 'Hari ini'
  if (days === 1) return 'Kemarin'
  if (days < 7) return `${days} hari lalu`
  if (days < 56) return `${Math.floor(days / 7)} minggu lalu`
  return formatDate(lastVisit)
}

/** Initials for the avatar: 'Rina Putri' -> 'RP'. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

// ---------------------------------------------------------------- detail

/** Every order of the customer (cancelled ones included: it is history), newest first. */
export function customerOrders<T extends Pick<Order, 'customer_id' | 'received_at' | 'created_at'>>(customerId: string, orders: T[]): T[] {
  return orders
    .filter((o) => o.customer_id === customerId)
    .sort((a, b) => b.received_at.localeCompare(a.received_at) || b.created_at.localeCompare(a.created_at))
}

/** SPEC 3.2: a customer with orders or packages cannot be deleted (FK restrict); the screen says so up front. */
export function canDeleteCustomer(customerId: string, orders: Pick<Order, 'customer_id'>[], packages: Pick<CustomerPackage, 'customer_id'>[]): boolean {
  return !orders.some((o) => o.customer_id === customerId) && !packages.some((p) => p.customer_id === customerId)
}

// ---------------------------------------------------------------- prepaid packages (SPEC 3.4)

export const PACKAGE_STATES = ['active', 'empty', 'expired'] as const
export type PackageState = (typeof PACKAGE_STATES)[number]

export const PACKAGE_STATE_LABEL: Record<PackageState, string> = {
  active: 'Aktif',
  empty: 'Habis',
  expired: 'Kedaluwarsa',
}

/** Habis when nothing is left (also when it expired meanwhile), Kedaluwarsa after expires_at, else Aktif. */
export function packageState(pkg: Pick<CustomerPackage, 'expires_at'>, remaining: number, todayISO: string): PackageState {
  if (remaining <= 0) return 'empty'
  if (pkg.expires_at !== null && pkg.expires_at < todayISO) return 'expired'
  return 'active'
}

export const ERR_PICK_PACKAGE = 'Pilih paket yang dijual.'
export const ERR_PACKAGE_INACTIVE = 'Paket ini sudah tidak dijual.'
export const ERR_PACKAGE_DATE = 'Tanggal pembelian tidak valid.'

/** 'YYYY-MM-DD' that really exists (no 2026-02-30). */
export function isValidDateISO(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = parseDate(iso)
  return d !== null && toDateISO(d) === iso
}

/** expires_at = purchased_at + valid_days; null = never expires. */
export function packageExpiry(purchasedAt: string, validDays: number | null): string | null {
  return validDays === null ? null : addDaysISO(purchasedAt, validDays)
}

/** Why the sale cannot be saved, in Indonesian, or null when it can. */
export function validatePackageSale(input: { catalog: Pick<PackageCatalogItem, 'active'> | null | undefined; purchasedAt: string }): string | null {
  if (!input.catalog) return ERR_PICK_PACKAGE
  if (!input.catalog.active) return ERR_PACKAGE_INACTIVE
  if (!isValidDateISO(input.purchasedAt)) return ERR_PACKAGE_DATE
  return null
}

export interface PackageSaleInput {
  catalog: PackageCatalogItem
  customerId: string
  /** 'YYYY-MM-DD'; the sale counts as money in on this day (SPEC 3.5) */
  purchasedAt: string
  method: PaymentMethod
  notes: string
}

/** The customer_packages row of a sale: a copy of the catalog entry at that moment (name, service, qty, price). */
export function packageSaleRow(input: PackageSaleInput): OrgInsert<'customer_packages'> {
  const { catalog } = input
  return {
    customer_id: input.customerId,
    catalog_id: catalog.id,
    name: catalog.name,
    service_id: catalog.service_id,
    qty_total: catalog.qty,
    price: catalog.price,
    purchased_at: input.purchasedAt,
    expires_at: packageExpiry(input.purchasedAt, catalog.valid_days),
    method: input.method,
    notes: clean(input.notes),
  }
}
