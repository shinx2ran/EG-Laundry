import type { Insert, Row, TableName, Update } from '../../types/db'
import { TABLE_NAMES } from '../../types/db'
import { newId } from '../ids'
import type { CreatedInvitation, ListOptions, Repo, StorageBucket } from './types'
import {
  CANCEL_STATUS_MESSAGE,
  CANCEL_WITH_PAYMENTS_MESSAGE,
  CODE_ALPHABET,
  DELETE_DENIED_MESSAGE,
  IN_USE_MESSAGE,
  PACKAGE_INSUFFICIENT_MESSAGE,
  PAYMENT_EXCEEDS_TOTAL_MESSAGE,
  UPDATE_DENIED_MESSAGE,
  formatCode,
} from './types'
import { orderTotals, packageProblem, packageRemaining, roundQty } from '../../domain/pricing'
import type { MemberRole } from '../../types/db'

export const STORAGE_KEY = 'eglaundry.local.db.v1'

type Db = { [K in TableName]: Row<K>[] }

function emptyDb(): Db {
  const db = {} as Db
  for (const t of TABLE_NAMES) (db as Record<string, unknown[]>)[t] = []
  return db
}

function loadDb(): Db {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return emptyDb()
    const parsed = JSON.parse(raw) as Partial<Db>
    const db = emptyDb()
    for (const t of TABLE_NAMES) {
      const rows = parsed[t]
      if (Array.isArray(rows)) (db as Record<string, unknown[]>)[t] = rows.map((r) => withColumnDefaults(t, r as unknown as Record<string, unknown>))
    }
    return db
  } catch {
    // keep unreadable data for recovery; the demo seed would otherwise overwrite it on start
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
      if (raw) globalThis.localStorage?.setItem(`${STORAGE_KEY}.corrupt`, raw)
    } catch {
      // storage blocked or full
    }
    return emptyDb()
  }
}

/** Columns added after the first release default to null (like a DB migration) for rows stored earlier. */
const COLUMN_DEFAULTS: Partial<Record<TableName, Record<string, unknown>>> = {
  organizations: { promo_template: null, wa_footer: null },
  invitations: { label: null, expires_at: '2099-12-31T00:00:00.000Z', accepted_by: null },
}

function withColumnDefaults(table: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const defaults = COLUMN_DEFAULTS[table]
  if (!defaults) return row
  const next = { ...row }
  for (const [k, v] of Object.entries(defaults)) if (next[k] === undefined) next[k] = v
  return next
}

function saveDb(db: Db) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(db))
  } catch (err) {
    console.error('Gagal menyimpan data lokal', err)
    throw new Error('Penyimpanan browser penuh atau tidak tersedia.')
  }
}

const rec = (r: unknown) => r as Record<string, unknown>

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/**
 * Browser-only persistence (localStorage). Used for "Mode Demo" when Supabase is not configured,
 * and for unit tests. Data never leaves the device. The integrity rules of supabase/schema.sql
 * (cascade / set null / restrict on delete, the order and payment guards) are mirrored here so Mode
 * Demo behaves like the database; the role rules (SPEC 3.10) live in the action hooks.
 */
export class LocalRepo implements Repo {
  readonly mode = 'local' as const
  private db: Db

  constructor(initial?: Db) {
    this.db = initial ?? loadDb()
  }

  /** Replace everything (used by demo seeding / reset). */
  replaceAll(db: Db) {
    this.db = db
    saveDb(this.db)
  }

  snapshot(): Db {
    return JSON.parse(JSON.stringify(this.db)) as Db
  }

  isEmpty(): boolean {
    return TABLE_NAMES.every((t) => this.db[t].length === 0)
  }

  async list<T extends TableName>(table: T, opts: ListOptions<Row<T>> = {}): Promise<Row<T>[]> {
    let rows = this.db[table] as Row<T>[]
    const where = opts.where ?? {}
    rows = rows.filter((r) => {
      for (const [col, val] of Object.entries(where)) {
        if (val === undefined) continue
        const actual = rec(r)[col]
        if (Array.isArray(val)) {
          if (!(val as unknown[]).includes(actual)) return false
        } else if (actual !== val) return false
      }
      for (const [col, val] of Object.entries(opts.gte ?? {})) {
        if (val == null) continue
        if (compare(rec(r)[col], val) < 0) return false
      }
      for (const [col, val] of Object.entries(opts.lte ?? {})) {
        if (val == null) continue
        if (compare(rec(r)[col], val) > 0) return false
      }
      return true
    })
    const order = opts.orderBy ?? { column: 'created_at', ascending: false }
    rows = [...rows].sort((a, b) => {
      const c = compare(rec(a)[order.column], rec(b)[order.column])
      return order.ascending === false ? -c : c
    })
    if (opts.limit) rows = rows.slice(0, opts.limit)
    return rows.map((r) => ({ ...r }))
  }

  async get<T extends TableName>(table: T, id: string): Promise<Row<T> | null> {
    const row = (this.db[table] as Row<T>[]).find((r) => r.id === id)
    return row ? { ...row } : null
  }

  async insert<T extends TableName>(table: T, row: Insert<T>): Promise<Row<T>> {
    const [created] = await this.insertMany(table, [row])
    return created
  }

  async insertMany<T extends TableName>(table: T, rows: Insert<T>[]): Promise<Row<T>[]> {
    const now = new Date().toISOString()
    const created = rows.map((row) => {
      const full = {
        ...row,
        id: (row as { id?: string }).id ?? newId(),
        created_at: (row as { created_at?: string }).created_at ?? now,
      } as Record<string, unknown>
      if (hasUpdatedAt(table)) full.updated_at = (row as { updated_at?: string }).updated_at ?? now
      return full as unknown as Row<T>
    })
    // like the database: the whole statement fails, nothing is written
    for (const r of created) this.guardWrite(table, r as unknown as Record<string, unknown>, null)
    ;(this.db[table] as Row<T>[]).push(...created)
    saveDb(this.db)
    return created.map((r) => ({ ...r }))
  }

  async update<T extends TableName>(table: T, id: string, patch: Update<T>, orgId?: string): Promise<Row<T>> {
    const rows = this.db[table] as Row<T>[]
    const idx = rows.findIndex((r) => r.id === id && (!orgId || rec(r).org_id === orgId))
    if (idx < 0) throw new Error(UPDATE_DENIED_MESSAGE)
    const next = { ...rows[idx], ...patch } as Record<string, unknown>
    if (hasUpdatedAt(table)) next.updated_at = new Date().toISOString()
    this.guardWrite(table, next, rows[idx] as unknown as Record<string, unknown>)
    rows[idx] = next as unknown as Row<T>
    saveDb(this.db)
    return { ...rows[idx] }
  }

  async remove<T extends TableName>(table: T, id: string, orgId?: string): Promise<void> {
    const rows = this.db[table] as Row<T>[]
    const idx = rows.findIndex((r) => r.id === id && (!orgId || rec(r).org_id === orgId))
    // like SupabaseRepo: deleting nothing is an error, never a silent success
    if (idx < 0) throw new Error(DELETE_DENIED_MESSAGE)
    if (this.isReferenced(table, id)) throw new Error(IN_USE_MESSAGE)
    // payments_limit: removing an item may not leave the order paid above its total
    if (table === 'order_items') this.assertPaidWithinTotal((rows[idx] as unknown as Row<'order_items'>).order_id, { removeItem: id })
    rows.splice(idx, 1)
    this.cascadeDelete(table, id)
    saveDb(this.db)
  }

  /** Mirror the database's ON DELETE RESTRICT rules so demo mode behaves like online mode. */
  private isReferenced(table: TableName, id: string): boolean {
    switch (table) {
      case 'customers':
        return this.db.orders.some((o) => o.customer_id === id) || this.db.customer_packages.some((p) => p.customer_id === id)
      case 'services':
        return this.db.package_catalog.some((c) => c.service_id === id) || this.db.customer_packages.some((p) => p.service_id === id)
      case 'customer_packages':
        return this.db.order_items.some((i) => i.customer_package_id === id)
      default:
        return false
    }
  }

  /** ON DELETE CASCADE / SET NULL of the schema. */
  private cascadeDelete(table: TableName, id: string): void {
    switch (table) {
      case 'orders':
        this.db.order_items = this.db.order_items.filter((i) => i.order_id !== id)
        this.db.payments = this.db.payments.filter((p) => p.order_id !== id)
        break
      case 'services':
        for (const i of this.db.order_items) if (i.service_id === id) i.service_id = null
        break
      case 'package_catalog':
        for (const p of this.db.customer_packages) if (p.catalog_id === id) p.catalog_id = null
        break
      default:
        break
    }
  }

  /**
   * The integrity triggers of schema.sql (orders_cancel_guard, payments_limit, package_use_guard), raised
   * with the same texts before anything is written. `before` is the stored row for an update, null for an insert.
   */
  private guardWrite(table: TableName, next: Record<string, unknown>, before: Record<string, unknown> | null): void {
    if (table === 'orders') {
      const status = next.status as string
      if (status === 'cancelled' && before && before.status !== 'cancelled') {
        if (before.status !== 'received' && before.status !== 'processing') throw new Error(CANCEL_STATUS_MESSAGE)
        if (this.db.payments.some((p) => p.order_id === next.id)) throw new Error(CANCEL_WITH_PAYMENTS_MESSAGE)
      }
      if (before && next.discount !== before.discount) this.assertPaidWithinTotal(next.id as string, { discount: next.discount as number })
      return
    }
    if (table === 'payments') {
      this.assertPaidWithinTotal(next.order_id as string, { extraPayment: next as unknown as Row<'payments'>, replaces: before?.id as string | undefined })
      return
    }
    if (table === 'order_items') {
      const item = next as unknown as Row<'order_items'>
      if (item.customer_package_id) this.assertPackageUse(item)
      if (before) this.assertPaidWithinTotal(item.order_id, { replaceItem: item })
    }
  }

  private assertPaidWithinTotal(
    orderId: string,
    change: { discount?: number; extraPayment?: Row<'payments'>; replaces?: string; replaceItem?: Row<'order_items'>; removeItem?: string },
  ): void {
    const order = this.db.orders.find((o) => o.id === orderId)
    if (!order) return
    const dropped = change.replaceItem?.id ?? change.removeItem
    let items = dropped ? this.db.order_items.filter((i) => i.id !== dropped) : this.db.order_items
    if (change.replaceItem) items = [...items, change.replaceItem]
    const payments = change.extraPayment ? [...this.db.payments.filter((p) => p.id !== change.replaces), change.extraPayment] : this.db.payments
    const t = orderTotals({ ...order, discount: change.discount ?? order.discount }, items, payments)
    if (t.paid > t.total) throw new Error(PAYMENT_EXCEEDS_TOTAL_MESSAGE)
  }

  private assertPackageUse(item: Row<'order_items'>): void {
    const pkg = this.db.customer_packages.find((p) => p.id === item.customer_package_id)
    const order = this.db.orders.find((o) => o.id === item.order_id)
    if (!pkg || !order) return
    const problem = packageProblem(pkg, order.customer_id, item.service_id ?? '', order.received_at)
    if (problem) throw new Error(problem)
    const others = this.db.order_items.filter((i) => i.id !== item.id)
    if (roundQty(item.qty) > packageRemaining(pkg, others, this.db.orders)) throw new Error(PACKAGE_INSUFFICIENT_MESSAGE)
  }

  async ensureMembership(user: { id: string; email: string | null }): Promise<string> {
    const [org] = this.db.organizations
    if (!org) throw new Error('Data demo belum tersedia.')
    if (!this.db.organization_members.some((m) => m.org_id === org.id && m.user_id === user.id)) {
      await this.insert('organization_members', { org_id: org.id, user_id: user.id, email: user.email, role: 'owner' })
    }
    return org.id
  }

  async uploadFile(_bucket: StorageBucket, _path: string, _file: Blob): Promise<string | null> {
    // Files are not persisted in local mode (localStorage is too small for photos).
    return null
  }

  async getFileUrl(): Promise<string | null> {
    return null
  }

  async removeFile(): Promise<void> {
    /* nothing stored */
  }

  /** Demo mode has a single local user who is always a member, so any code simply returns the org. */
  async joinWithCode(): Promise<string> {
    const [org] = this.db.organizations
    if (!org) throw new Error('Data demo belum tersedia.')
    return org.id
  }

  async createInvitation(orgId: string, role: 'admin' | 'staff', label: string | null): Promise<CreatedInvitation> {
    const bytes = new Uint8Array(8)
    crypto.getRandomValues(bytes)
    const code = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    await this.insert('invitations', {
      org_id: orgId,
      label: label?.trim() || null,
      email: null,
      role,
      invited_by: null,
      expires_at: expiresAt,
      accepted_at: null,
      accepted_by: null,
    })
    return { code: formatCode(code), expiresAt }
  }

  async setMemberRole(orgId: string, userId: string, role: MemberRole): Promise<void> {
    const members = this.db.organization_members.filter((m) => m.org_id === orgId)
    const target = members.find((m) => m.user_id === userId)
    if (!target) throw new Error('Anggota tidak ditemukan.')
    if (target.role === 'owner' && role !== 'owner' && members.filter((m) => m.role === 'owner').length <= 1) {
      throw new Error('Tidak dapat mengubah peran pemilik terakhir.')
    }
    target.role = role
    saveDb(this.db)
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    this.db.organization_members = this.db.organization_members.filter(
      (m) => !(m.org_id === orgId && m.user_id === userId),
    )
    saveDb(this.db)
  }
}

// tables with an updated_at column
const TABLES_WITH_UPDATED_AT: ReadonlySet<TableName> = new Set<TableName>([
  'services',
  'customers',
  'orders',
  'order_items',
  'package_catalog',
  'customer_packages',
  'payments',
])

function hasUpdatedAt(table: TableName): boolean {
  return TABLES_WITH_UPDATED_AT.has(table)
}

export type { Db as LocalDb }
export { emptyDb as emptyLocalDb }
