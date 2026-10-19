/**
 * Central data model for EG Laundry.
 *
 * Every business table carries `org_id` (denormalised) so Supabase Row Level Security can be a
 * single `is_org_member(org_id)` check, and so the local/demo adapter can filter trivially.
 *
 * Money is stored as integer Rupiah (no decimals). Quantities are numbers: kg with up to 2 decimals
 * (`numeric(8,2)` online), pcs whole. Dates are ISO strings:
 *   - `received_at`, `promised_at`, `paid_at`, `purchased_at`, `expires_at` -> 'YYYY-MM-DD' (date only)
 *   - `ready_at`, `picked_up_at`, `created_at`, `updated_at`                -> full ISO timestamp
 *
 * Core (organisation, members, invitations, change history) + the laundry tables of SPEC section 3.
 *
 * NOTE: tsconfig has `erasableSyntaxOnly`, so no TypeScript enums. Use the `as const` arrays below.
 */

// ---------- Enumerations ----------

export const MEMBER_ROLES = ['owner', 'admin', 'staff'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export const AUDIT_ACTIONS = ['insert', 'update', 'delete'] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

/** kg = weighed (2 decimals), pcs = counted (whole numbers) */
export const UNITS = ['kg', 'pcs'] as const
export type Unit = (typeof UNITS)[number]

/**
 * received (Diterima) -> processing (Proses) -> ready (Siap diambil) -> done (Selesai/diambil);
 * cancelled (Dibatalkan) only from received/processing and only without payments (SPEC 3.3).
 */
export const ORDER_STATUSES = ['received', 'processing', 'ready', 'done', 'cancelled'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const PAYMENT_METHODS = ['cash', 'transfer', 'qris'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

// ---------- Row types ----------

export interface BaseRow {
  id: string
  org_id: string
  created_at: string
}

export interface TimestampedRow extends BaseRow {
  updated_at: string
}

export interface Organization {
  id: string
  name: string
  created_by: string
  created_at: string
  /** WhatsApp promo text with `{nama}` for the customer's name (SPEC 3.7); null = not set yet */
  promo_template: string | null
  /** appended to every WhatsApp message (opening hours, address, ...); null = none */
  wa_footer: string | null
}

export interface OrganizationMember extends BaseRow {
  user_id: string
  /** denormalised for display; may be null if unknown */
  email: string | null
  role: MemberRole
}

/**
 * An invitation is a one-time code (shown once to the admin who creates it, stored only as a hash) that
 * the invitee enters after creating an account. No email delivery is involved.
 */
export interface Invitation extends BaseRow {
  /** who it is for, free text shown in the list (e.g. "Istri", "Mbak Sari"); optional */
  label: string | null
  /** unused; kept for compatibility with the shared schema */
  email: string | null
  role: MemberRole
  invited_by: string | null
  expires_at: string
  accepted_at: string | null
  accepted_by: string | null
}

/** Append-only change history written by database triggers (online mode only). Owner/admin can read it. */
export interface AuditLogEntry {
  id: string
  org_id: string
  table_name: string
  row_id: string | null
  action: AuditAction
  changed_by: string | null
  changed_at: string
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}

// ---------- Laundry tables (SPEC 3.1 - 3.5) ----------

/** Price list (SPEC 3.1). Only owner/admin change it; order items keep a copy of name/unit/price. */
export interface Service extends TimestampedRow {
  name: string
  unit: Unit
  /** regular price per unit (Rp) */
  price: number
  /** express price per unit; null = this service has no express option */
  price_express: number | null
  /** working days, regular */
  days_regular: number
  /** working days, express; null = same as regular (only meaningful with price_express) */
  days_express: number | null
  /** minimum quantity billed (e.g. 2 kg); 0 = none */
  min_qty: number
  sort_order: number
  /** false = hidden from the order form, history kept */
  active: boolean
}

/** Customer (SPEC 3.2): kos tenants (is_tenant + room) and walk-ins. */
export interface Customer extends TimestampedRow {
  name: string
  /** stored as typed; matched with normalizePhone */
  phone: string | null
  /** "Anak kos": a tenant of the kos */
  is_tenant: boolean
  /** room, e.g. "B3"; only meaningful when is_tenant */
  room_name: string | null
  /** tenant id in the kos app (Woombad backup import, SPEC 3.8) */
  kos_tenant_id: string | null
  address: string | null
  notes: string | null
}

/** Order header (SPEC 3.3). Totals and the pay status are derived from items and payments, never stored. */
export interface Order extends TimestampedRow {
  /** 'LD-YYYYMM-NNNN', unique per organisation */
  order_number: string
  customer_id: string
  /** date received, 'YYYY-MM-DD' */
  received_at: string
  /** estimated completion, 'YYYY-MM-DD' (promisedDate); editable */
  promised_at: string | null
  /** one switch for the whole order: items use the services' express price */
  express: boolean
  status: OrderStatus
  /** when marked ready / picked up (timestamps) */
  ready_at: string | null
  picked_up_at: string | null
  /** rupiah discount, 0 <= discount <= subtotal */
  discount: number
  notes: string | null
}

/** Order line (SPEC 3.3): a copy of the service at the time of the order. */
export interface OrderItem extends TimestampedRow {
  order_id: string
  /** null once the service was deleted (the copies below keep the history readable) */
  service_id: string | null
  service_name: string
  unit: Unit
  /** price per unit at the time (already the express price for an express order; 0 when paid by package) */
  unit_price: number
  /** > 0; kg up to 2 decimals, pcs whole */
  qty: number
  /** round(qty * unit_price) */
  line_total: number
  /** set when the qty is taken from a prepaid package (SPEC 3.4): unit_price and line_total are 0 */
  customer_package_id: string | null
  notes: string | null
}

/** Prepaid package on offer (SPEC 3.4), admin only. */
export interface PackageCatalogItem extends TimestampedRow {
  name: string
  service_id: string
  /** quantity bought (kg or pcs of the service) */
  qty: number
  price: number
  /** validity in days from purchase; null = never expires */
  valid_days: number | null
  active: boolean
}

/** A package a customer bought (SPEC 3.4). Remaining qty is computed from order items. */
export interface CustomerPackage extends TimestampedRow {
  customer_id: string
  /** null once the catalog entry was deleted */
  catalog_id: string | null
  /** copies of the catalog entry at purchase */
  name: string
  service_id: string
  qty_total: number
  price: number
  /** 'YYYY-MM-DD'; counts as money in on this date */
  purchased_at: string
  /** 'YYYY-MM-DD' = purchased_at + valid_days; null = never expires */
  expires_at: string | null
  method: PaymentMethod
  notes: string | null
}

/** Payment on an order (SPEC 3.5): DP or settlement; the sum never exceeds the order total. */
export interface Payment extends TimestampedRow {
  order_id: string
  /** > 0 */
  amount: number
  /** 'YYYY-MM-DD' */
  paid_at: string
  method: PaymentMethod
  notes: string | null
  /** filled by the database from auth.uid(); null in Mode Demo */
  created_by: string | null
}

// ---------- Table map ----------

export interface Tables {
  organizations: Organization
  organization_members: OrganizationMember
  invitations: Invitation
  audit_log: AuditLogEntry
  services: Service
  customers: Customer
  orders: Order
  order_items: OrderItem
  package_catalog: PackageCatalogItem
  customer_packages: CustomerPackage
  payments: Payment
}

export type TableName = keyof Tables
export type Row<T extends TableName> = Tables[T]

/** Tables scoped to an organisation (everything except `organizations`). */
export type OrgTableName = Exclude<TableName, 'organizations'>

type GeneratedKeys = 'id' | 'created_at' | 'updated_at' | 'created_by'

/** Insert payload: generated columns optional. */
export type Insert<T extends TableName> = Omit<Row<T>, Extract<keyof Row<T>, GeneratedKeys>> &
  Partial<Pick<Row<T>, Extract<keyof Row<T>, GeneratedKeys>>>

/** Insert payload when org_id is filled in by the OrgRepo wrapper. */
export type OrgInsert<T extends OrgTableName> = Omit<Insert<T>, 'org_id'> & { org_id?: string }

/** Partial update; id/org_id/created_at are never updatable. */
export type Update<T extends TableName> = Partial<Omit<Row<T>, 'id' | 'org_id' | 'created_at'>>

/** Every table, parents before children (the order a restore inserts them in). */
export const TABLE_NAMES: TableName[] = [
  'organizations',
  'organization_members',
  'invitations',
  'audit_log',
  'services',
  'customers',
  'orders',
  'order_items',
  'package_catalog',
  'customer_packages',
  'payments',
]

/** The laundry tables (SPEC 3), parents before children. */
export const LAUNDRY_TABLES = ['services', 'customers', 'orders', 'order_items', 'package_catalog', 'customer_packages', 'payments'] as const satisfies readonly OrgTableName[]
export type LaundryTableName = (typeof LAUNDRY_TABLES)[number]

// ---------- Indonesian labels (shared vocabulary) ----------

export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Pemilik',
  admin: 'Admin',
  staff: 'Staf',
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  received: 'Diterima',
  processing: 'Proses',
  ready: 'Siap diambil',
  done: 'Selesai',
  cancelled: 'Dibatalkan',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Tunai',
  transfer: 'Transfer',
  qris: 'QRIS',
}

export const UNIT_LABEL: Record<Unit, string> = {
  kg: 'kg',
  pcs: 'pcs',
}
