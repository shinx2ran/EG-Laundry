/**
 * "Impor penyewa dari Woombad" (SPEC 3.8). Pure: reading a Woombad backup file and deciding which laundry
 * customers become (or stop being) "Anak kos". No React, no I/O; the screen calls parseWoombadBackup on the
 * uploaded text and planTenantImport with the customers it has, and applyTenantImport writes the plan.
 *
 * Woombad backup files (its src/features/settings/data/backupFile.ts and export_backup()):
 * - "Unduh cadangan lengkap": { version: 1, exportedAt, orgName, tables: { tenants, leases, rooms, properties, … } }
 * - the weekly export: an array of those, one per organisation
 * - older Mode Demo backups: the bare tables at the top level ({ tenants, leases, rooms, … })
 * Only tenants, leases and rooms are read (name, phone, room); everything else in the file is ignored.
 */
import { z } from 'zod'
import type { Customer, Update } from '../../types/db'
import { addDaysISO, normalizePhone, todayISO } from '../../lib/format'

// ---------------------------------------------------------------- reading the file

export interface WoombadTenant {
  id: string
  full_name: string
  phone: string | null
}

export interface WoombadLease {
  id: string
  tenant_id: string
  room_id: string | null
  /** Woombad: 'active' | 'ended' | 'cancelled' */
  status: string
  start_date: string
  end_date: string | null
  checkout_date: string | null
}

export interface WoombadRoom {
  id: string
  name: string
}

export interface WoombadBackup {
  /** organisation names found in the file (one per organisation file) */
  orgNames: string[]
  exportedAt: string | null
  tenants: WoombadTenant[]
  leases: WoombadLease[]
  rooms: WoombadRoom[]
}

/** Thrown with a message that can be shown to the user as is. */
export class WoombadFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WoombadFileError'
  }
}

export const MSG_WOOMBAD_NOT_JSON = 'Berkas tidak bisa dibaca. Pilih berkas cadangan Woombad (.json).'
export const MSG_WOOMBAD_NOT_BACKUP = 'Berkas bukan cadangan Woombad.'
export const MSG_WOOMBAD_LAUNDRY_BACKUP = 'Berkas ini cadangan EG Laundry, bukan cadangan Woombad. Pilih berkas cadangan dari aplikasi kos.'
export const MSG_WOOMBAD_NEWER = 'Berkas cadangan Woombad ini dibuat oleh versi yang lebih baru. Perbarui aplikasi lalu coba lagi.'

/** Woombad's backup version this reader understands. */
export const WOOMBAD_BACKUP_VERSION = 1

const TABLE_LABEL = { tenants: 'Penyewa', leases: 'Sewa', rooms: 'Kamar' } as const
type ReadTable = keyof typeof TABLE_LABEL

const DATE_RE = /^\d{4}-\d{2}-\d{2}/
const tenantSchema = z.looseObject({ id: z.string().min(1), full_name: z.string(), phone: z.string().nullish() })
const leaseSchema = z.looseObject({
  id: z.string().min(1),
  tenant_id: z.string().min(1),
  room_id: z.string().nullish(),
  status: z.string(),
  start_date: z.string().regex(DATE_RE),
  end_date: z.string().regex(DATE_RE).nullish(),
  checkout_date: z.string().regex(DATE_RE).nullish(),
})
const roomSchema = z.looseObject({ id: z.string().min(1), name: z.string() })
const SCHEMAS = { tenants: tenantSchema, leases: leaseSchema, rooms: roomSchema } as const

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Tables of an EG Laundry backup: a file with these and no tenants was picked by mistake. */
const LAUNDRY_ONLY_TABLES = ['customers', 'orders', 'services']

interface OrgFile {
  orgName: string | null
  exportedAt: string | null
  tables: Record<string, unknown>
}

function toOrgFile(value: unknown): OrgFile {
  if (!isPlainObject(value)) throw new WoombadFileError(MSG_WOOMBAD_NOT_BACKUP)
  if (!('tables' in value)) return { orgName: null, exportedAt: null, tables: value } // older Mode Demo snapshot
  const { version, tables, orgName, exportedAt } = value
  if (!isPlainObject(tables)) throw new WoombadFileError(MSG_WOOMBAD_NOT_BACKUP)
  if (version !== undefined && typeof version !== 'number') throw new WoombadFileError(MSG_WOOMBAD_NOT_BACKUP)
  if (typeof version === 'number' && version > WOOMBAD_BACKUP_VERSION) throw new WoombadFileError(MSG_WOOMBAD_NEWER)
  return {
    orgName: typeof orgName === 'string' ? orgName : null,
    exportedAt: typeof exportedAt === 'string' ? exportedAt : null,
    tables,
  }
}

function readTable<T extends ReadTable>(table: T, source: Record<string, unknown>): z.infer<(typeof SCHEMAS)[T]>[] {
  const raw = source[table]
  if (raw === undefined || raw === null) return []
  const parsed = z.array(SCHEMAS[table]).safeParse(raw)
  if (!parsed.success) {
    const index = parsed.error.issues[0]?.path[0]
    const where = typeof index === 'number' ? ` baris ke-${index + 1}` : ''
    throw new WoombadFileError(`Berkas cadangan Woombad rusak: bagian "${TABLE_LABEL[table]}"${where} tidak valid.`)
  }
  return parsed.data as z.infer<(typeof SCHEMAS)[T]>[]
}

/**
 * Validate the text of a Woombad backup: one organisation file, the weekly array of them, or an older Mode Demo
 * snapshot. Rows of every file are merged (the first row with an id wins). Throws WoombadFileError (Indonesian).
 */
export function parseWoombadBackup(text: string): WoombadBackup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new WoombadFileError(MSG_WOOMBAD_NOT_JSON)
  }
  const files = (Array.isArray(data) ? data : [data]).map(toOrgFile)
  if (files.length === 0) throw new WoombadFileError(MSG_WOOMBAD_NOT_BACKUP)
  if (!files.some((f) => Array.isArray(f.tables.tenants))) {
    const laundry = files.some((f) => LAUNDRY_ONLY_TABLES.some((t) => Array.isArray(f.tables[t])))
    throw new WoombadFileError(laundry ? MSG_WOOMBAD_LAUNDRY_BACKUP : MSG_WOOMBAD_NOT_BACKUP)
  }

  const tenants = new Map<string, WoombadTenant>()
  const leases = new Map<string, WoombadLease>()
  const rooms = new Map<string, WoombadRoom>()
  const orgNames: string[] = []
  let exportedAt: string | null = null
  for (const f of files) {
    if (f.orgName && !orgNames.includes(f.orgName)) orgNames.push(f.orgName)
    if (f.exportedAt && (exportedAt === null || f.exportedAt > exportedAt)) exportedAt = f.exportedAt
    for (const t of readTable('tenants', f.tables)) {
      if (!tenants.has(t.id)) tenants.set(t.id, { id: t.id, full_name: t.full_name, phone: t.phone ?? null })
    }
    for (const l of readTable('leases', f.tables)) {
      if (!leases.has(l.id)) {
        leases.set(l.id, {
          id: l.id,
          tenant_id: l.tenant_id,
          room_id: l.room_id ?? null,
          status: l.status,
          start_date: l.start_date.slice(0, 10),
          end_date: l.end_date ? l.end_date.slice(0, 10) : null,
          checkout_date: l.checkout_date ? l.checkout_date.slice(0, 10) : null,
        })
      }
    }
    for (const r of readTable('rooms', f.tables)) if (!rooms.has(r.id)) rooms.set(r.id, { id: r.id, name: r.name })
  }
  return { orgNames, exportedAt, tenants: [...tenants.values()], leases: [...leases.values()], rooms: [...rooms.values()] }
}

// ---------------------------------------------------------------- tenancy on a day

/**
 * Woombad's occupancy rule (its isLeaseActiveOn): an 'active' lease holds the room from start_date on, also
 * past end_date until a checkout is recorded; an 'ended' lease still holds it up to the day before checkout_date
 * (a checkout recorded ahead of time), or through end_date without one; 'cancelled' never.
 */
export function leaseOccupiesOn(lease: Pick<WoombadLease, 'status' | 'start_date' | 'end_date' | 'checkout_date'>, dateISO: string): boolean {
  if (dateISO < lease.start_date) return false
  if (lease.status === 'active') return true
  if (lease.status !== 'ended') return false
  const until = lease.checkout_date ? addDaysISO(lease.checkout_date, -1) : lease.end_date
  return until !== null && dateISO <= until
}

/**
 * The lease that makes the tenant an "Anak kos" on the date, or null:
 * - leases occupying the room that day (leaseOccupiesOn): an 'active' one beats an 'ended' one still running
 *   out, then the LATEST start_date wins (a new lease started before the old one was closed), then the id;
 * - otherwise a booking (status 'active', start_date after the date): the earliest one, with its room.
 * Cancelled leases never count.
 */
export function currentLease(leases: readonly WoombadLease[], dateISO: string): WoombadLease | null {
  const rank = (l: WoombadLease) => (l.status === 'active' ? 1 : 0)
  let best: WoombadLease | null = null
  for (const l of leases) {
    if (!leaseOccupiesOn(l, dateISO)) continue
    if (!best || rank(l) > rank(best) || (rank(l) === rank(best) && (l.start_date > best.start_date || (l.start_date === best.start_date && l.id < best.id)))) best = l
  }
  if (best) return best
  for (const l of leases) {
    if (l.status !== 'active' || l.start_date <= dateISO) continue
    if (!best || l.start_date < best.start_date || (l.start_date === best.start_date && l.id < best.id)) best = l
  }
  return best
}

// ---------------------------------------------------------------- matching helpers

/**
 * Digits of a phone in the +62 form, for comparing ('0812-0000-0001', '+62 812 0000 0001' and '62812…' are
 * the same number); null when there is no usable number (fewer than 9 digits).
 */
export function phoneKey(phone: string | null | undefined): string | null {
  const normalized = normalizePhone(phone)
  if (!normalized) return null
  let digits = normalized.replace(/\D/g, '')
  if (digits.startsWith('620')) digits = `62${digits.slice(3)}` // '+62 0812…'
  return digits.length >= 9 ? digits : null
}

/** Names typed in capitals (KTP scans: 'BUDI SANTOSO') become 'Budi Santoso'; other names stay as written. */
export function tidyName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ')
  if (trimmed !== trimmed.toUpperCase() || !/[A-Z]/.test(trimmed)) return trimmed
  return trimmed.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase())
}

// ---------------------------------------------------------------- plan

export type MatchReason = 'kos_tenant_id' | 'phone'

export const MATCH_REASON_LABEL: Record<MatchReason, string> = {
  kos_tenant_id: 'cocok lewat data impor sebelumnya',
  phone: 'cocok lewat nomor HP',
}

export interface TenantUpdate {
  customerId: string
  /** the customer's name in the laundry (not changed by the import) */
  customerName: string
  tenantName: string
  room_name: string | null
  /** only the columns that change */
  patch: Update<'customers'>
  reason: MatchReason
}

export interface TenantCreate {
  name: string
  /** as written in Woombad; null when the tenant has none */
  phone: string | null
  room_name: string | null
  kos_tenant_id: string
}

export interface TenantDeactivate {
  customerId: string
  customerName: string
  /** the room the customer had */
  room_name: string | null
  patch: Update<'customers'>
  reason: MatchReason
}

export interface TenantSkip {
  name: string
  reason: string
}

export interface TenantImportCounts {
  /** tenants with an active lease (or a booking) in the file */
  current: number
  /** tenants whose leases have all ended */
  former: number
  update: number
  create: number
  deactivate: number
  /** matched customers that already say so (nothing to write) */
  unchanged: number
  skipped: number
  /** current tenants without a usable phone: only kos_tenant_id can match them */
  noPhone: number
  /** customers of ended leases left as Anak kos because deactivateEnded is off */
  keptEnded: number
}

export interface TenantImportPlan {
  toUpdate: TenantUpdate[]
  toCreate: TenantCreate[]
  toDeactivate: TenantDeactivate[]
  skipped: TenantSkip[]
  counts: TenantImportCounts
}

export interface TenantImportOptions {
  /** current tenants without a matching customer become new customers (SPEC 3.8: on by default) */
  createMissing?: boolean
  /** customers of tenants whose lease ended stop being Anak kos (off = "jangan ubah yang lama") */
  deactivateEnded?: boolean
  /** 'YYYY-MM-DD' the leases are judged on; default today */
  today?: string
}

export type ImportCustomer = Pick<Customer, 'id' | 'name' | 'phone' | 'is_tenant' | 'room_name' | 'kos_tenant_id'>

type Match = { customer: ImportCustomer; reason: MatchReason } | { conflict: string; customers: ImportCustomer[] } | null

const byName = (a: WoombadTenant, b: WoombadTenant) => a.full_name.localeCompare(b.full_name, 'id', { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1)
const nameList = (customers: ImportCustomer[]) => customers.map((c) => c.name).join(', ')

function groupBy<T>(rows: readonly T[], key: (row: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    if (k === null) continue
    const list = map.get(k)
    if (list) list.push(r)
    else map.set(k, [r])
  }
  return map
}

/**
 * Decide what the import changes (SPEC 3.8). For every tenant with a current lease (currentLease) the customer is
 * found by kos_tenant_id first, then by phone (phoneKey); a match is set to Anak kos with the lease's room and
 * linked by kos_tenant_id (a missing phone is filled in), no match becomes a new customer (createMissing). A
 * tenant whose leases all ended un-marks the customer it matches (deactivateEnded). Skipped, with the reason:
 * a phone shared by several customers, a customer linked to another tenant of the file, a customer claimed by
 * another tenant, a second new tenant with the same phone, a tenant without a name. Tenants that never had a
 * lease (or only cancelled ones) are ignored, as are customers the file says nothing about.
 */
export function planTenantImport(backup: WoombadBackup, existingCustomers: readonly ImportCustomer[], options: TenantImportOptions = {}): TenantImportPlan {
  const createMissing = options.createMissing ?? true
  const deactivateEnded = options.deactivateEnded ?? true
  const today = options.today ?? todayISO()

  const leasesByTenant = groupBy(backup.leases, (l) => l.tenant_id)
  const roomName = new Map(backup.rooms.map((r) => [r.id, r.name.trim() || null]))
  const tenantIds = new Set(backup.tenants.map((t) => t.id))
  const byKosId = groupBy(existingCustomers, (c) => c.kos_tenant_id)
  const byPhone = groupBy(existingCustomers, (c) => phoneKey(c.phone))

  const plan: TenantImportPlan = {
    toUpdate: [],
    toCreate: [],
    toDeactivate: [],
    skipped: [],
    counts: { current: 0, former: 0, update: 0, create: 0, deactivate: 0, unchanged: 0, skipped: 0, noPhone: 0, keptEnded: 0 },
  }
  /** customer id -> tenant name that took it in this plan */
  const claimed = new Map<string, string>()
  /** phoneKey -> name of a tenant created in this plan */
  const createdPhones = new Map<string, string>()

  const findCustomer = (tenant: WoombadTenant): Match => {
    const linked = byKosId.get(tenant.id) ?? []
    if (linked.length === 1) return { customer: linked[0], reason: 'kos_tenant_id' }
    if (linked.length > 1) return { conflict: `Terhubung ke ${linked.length} pelanggan: ${nameList(linked)}.`, customers: linked }
    const key = phoneKey(tenant.phone)
    const same = key ? (byPhone.get(key) ?? []) : []
    if (same.length === 0) return null
    if (same.length > 1) return { conflict: `Nomor HP ini dipakai ${same.length} pelanggan: ${nameList(same)}. Rapikan dulu di daftar pelanggan.`, customers: same }
    const customer = same[0]
    // linked to another tenant of this file (a shared number): not this person
    if (customer.kos_tenant_id && customer.kos_tenant_id !== tenant.id && tenantIds.has(customer.kos_tenant_id)) {
      return { conflict: `Nomor HP sama dengan ${customer.name}, yang terhubung ke penyewa lain.`, customers: same }
    }
    return { customer, reason: 'phone' }
  }

  const skip = (name: string, reason: string) => plan.skipped.push({ name, reason })

  const current: { tenant: WoombadTenant; room: string | null }[] = []
  const former: WoombadTenant[] = []
  for (const tenant of [...backup.tenants].sort(byName)) {
    const leases = leasesByTenant.get(tenant.id) ?? []
    const lease = currentLease(leases, today)
    if (lease) current.push({ tenant, room: lease.room_id ? (roomName.get(lease.room_id) ?? null) : null })
    else if (leases.some((l) => l.status === 'ended' || l.status === 'active')) former.push(tenant)
  }
  plan.counts.current = current.length
  plan.counts.former = former.length

  for (const { tenant, room } of current) {
    const name = tidyName(tenant.full_name)
    const key = phoneKey(tenant.phone)
    if (!key) plan.counts.noPhone++
    if (!name) {
      skip('(tanpa nama)', 'Nama penyewa kosong di Woombad.')
      continue
    }
    const match = findCustomer(tenant)
    if (match && 'conflict' in match) {
      skip(name, match.conflict)
      continue
    }
    if (match) {
      const c = match.customer
      const holder = claimed.get(c.id)
      if (holder !== undefined) {
        skip(name, `Pelanggan ${c.name} sudah dicocokkan dengan penyewa ${holder}.`)
        continue
      }
      claimed.set(c.id, name)
      const patch: Update<'customers'> = {}
      if (!c.is_tenant) patch.is_tenant = true
      // a room missing from the file leaves the customer's room alone
      if (room !== null && c.room_name !== room) patch.room_name = room
      if (c.kos_tenant_id !== tenant.id) patch.kos_tenant_id = tenant.id
      if (!phoneKey(c.phone) && tenant.phone?.trim() && key) patch.phone = tenant.phone.trim()
      if (Object.keys(patch).length === 0) plan.counts.unchanged++
      else plan.toUpdate.push({ customerId: c.id, customerName: c.name, tenantName: name, room_name: room ?? c.room_name, patch, reason: match.reason })
      continue
    }
    if (!createMissing) {
      skip(name, 'Belum ada di daftar pelanggan (pelanggan baru tidak dibuat).')
      continue
    }
    const twin = key ? createdPhones.get(key) : undefined
    if (twin !== undefined) {
      skip(name, `Nomor HP sama dengan penyewa ${twin}; hanya satu pelanggan baru yang dibuat.`)
      continue
    }
    if (key) createdPhones.set(key, name)
    plan.toCreate.push({ name, phone: tenant.phone?.trim() || null, room_name: room, kos_tenant_id: tenant.id })
  }

  for (const tenant of former) {
    const match = findCustomer(tenant)
    if (!match) continue
    if ('conflict' in match) {
      // only worth mentioning when one of them is still marked Anak kos
      if (match.customers.some((c) => c.is_tenant && !claimed.has(c.id))) skip(tidyName(tenant.full_name) || '(tanpa nama)', match.conflict)
      continue
    }
    const c = match.customer
    if (claimed.has(c.id) || !c.is_tenant) continue
    claimed.set(c.id, tidyName(tenant.full_name))
    if (!deactivateEnded) {
      plan.counts.keptEnded++
      continue
    }
    const patch: Update<'customers'> = { is_tenant: false, room_name: null }
    if (!c.kos_tenant_id) patch.kos_tenant_id = tenant.id
    plan.toDeactivate.push({ customerId: c.id, customerName: c.name, room_name: c.room_name, patch, reason: match.reason })
  }

  plan.counts.update = plan.toUpdate.length
  plan.counts.create = plan.toCreate.length
  plan.counts.deactivate = plan.toDeactivate.length
  plan.counts.skipped = plan.skipped.length
  return plan
}

/** Rows the plan writes. */
export function tenantPlanSize(plan: TenantImportPlan): number {
  return plan.toUpdate.length + plan.toCreate.length + plan.toDeactivate.length
}

/** 'Impor selesai: 2 diperbarui, 3 baru, 1 dinonaktifkan.' */
export function tenantImportSummary(counts: Pick<TenantImportCounts, 'update' | 'create' | 'deactivate'>): string {
  return `${counts.update} diperbarui, ${counts.create} baru, ${counts.deactivate} dinonaktifkan`
}
