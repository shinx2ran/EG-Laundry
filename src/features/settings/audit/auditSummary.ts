/**
 * Turns raw audit_log rows (SPEC 2.3) into short Indonesian lines for the "Riwayat perubahan" card:
 * who, when, and what (table + action + the columns that changed). Pure: no React, no I/O.
 * The laundry modules extend the table labels, money columns and subjects below for their tables.
 */
import { differenceInCalendarDays } from 'date-fns'
import { formatDate, formatDateTime, formatNumber, formatRupiah, parseDate } from '../../../lib/format'
import { MEMBER_ROLE_LABEL, type AuditAction, type AuditLogEntry, type OrganizationMember } from '../../../types/db'

export const AUDIT_TABLE_LABEL: Record<string, string> = {
  organizations: 'Laundry',
  organization_members: 'Anggota',
  invitations: 'Undangan',
}

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  insert: 'Tambah',
  update: 'Ubah',
  delete: 'Hapus',
}

/** Shown when a change was not made by a signed-in member (SQL editor, maintenance). */
export const SYSTEM_ACTOR = 'Sistem/Operator'
/** A member who has since been removed and whose email is unknown. */
export const FORMER_MEMBER_ACTOR = 'Mantan anggota'

const MONEY_COLUMNS = new Set(['amount', 'total_amount', 'discount_amount', 'paid_amount', 'price', 'unit_price', 'subtotal'])

/** Bookkeeping columns that never say anything to the owner. */
const IGNORED_COLUMNS = new Set(['id', 'org_id', 'created_at', 'updated_at', 'created_by'])

/** Long free text: say that it changed instead of quoting it. */
const TEXT_COLUMNS = new Set(['notes'])

/** Storage paths: added / replaced / removed. */
const FILE_COLUMNS = new Set(['logo_path'])

const COLUMN_LABEL: Record<string, string> = {
  amount: 'Jumlah',
  total_amount: 'Total',
  discount_amount: 'Diskon',
  paid_amount: 'Dibayar',
  price: 'Harga',
  unit_price: 'Harga satuan',
  subtotal: 'Subtotal',
  status: 'Status',
  method: 'Metode',
  role: 'Peran',
  name: 'Nama',
  full_name: 'Nama',
  phone: 'HP',
  email: 'Email',
  label: 'Untuk',
  invited_by: 'Diundang oleh',
  accepted_by: 'Diterima oleh',
  accepted_at: 'Diterima',
  expires_at: 'Berlaku s/d',
  user_id: 'Pengguna',
  address: 'Alamat',
  description: 'Deskripsi',
  quantity: 'Jumlah',
  unit: 'Satuan',
  logo_path: 'Logo',
  notes: 'Catatan',
}

/** Money first (what the owner checks), then status and names; anything else after, alphabetically. */
const COLUMN_ORDER = [...MONEY_COLUMNS, 'status', 'method', 'role', 'name', 'full_name', 'phone']

const ENUM_LABELS: Record<string, Record<string, string>> = {
  role: MEMBER_ROLE_LABEL,
}

/** Per table: how a `status` value reads; the laundry modules add theirs. */
const STATUS_LABELS: Record<string, Record<string, string>> = {}

/** Resolves a referenced id (user_id, customer_id, ...) to a readable name; null when unknown. */
export type RefResolver = (column: string, id: string) => string | null

export interface AuditSummary {
  /** 'Anggota' (falls back to the raw table name) */
  tableLabel: string
  action: AuditAction
  /** 'Tambah' | 'Ubah' | 'Hapus' */
  actionLabel: string
  /** which row: 'istri@contoh.id · Admin', 'Budi' */
  subject: string | null
  /** one line per changed column (updates only): 'Peran: Staf → Admin' */
  changes: string[]
}

type Data = Record<string, unknown>

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T/
const MAX_TEXT = 40

function truncate(text: string, max = MAX_TEXT): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

function asMoney(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return null
}

function columnLabel(column: string): string {
  return COLUMN_LABEL[column] ?? column.replace(/_/g, ' ')
}

/** One value as the owner would say it; null when it cannot be shown (an unresolved id). */
export function formatAuditValue(table: string, column: string, value: unknown, resolve?: RefResolver): string | null {
  if (isEmpty(value)) return '–'
  if (MONEY_COLUMNS.has(column)) {
    const n = asMoney(value)
    if (n !== null) return formatRupiah(n)
  }
  if (typeof value === 'string') {
    if (column === 'status') return STATUS_LABELS[table]?.[value] ?? value
    const enumLabel = ENUM_LABELS[column]?.[value]
    if (enumLabel) return enumLabel
    if (column.endsWith('_id') || column === 'invited_by' || column === 'accepted_by') return resolve?.(column, value) ?? null
    if (DATE_RE.test(value)) return formatDate(value)
    if (TIMESTAMP_RE.test(value)) return formatDateTime(value)
    return truncate(value)
  }
  if (typeof value === 'number') return formatNumber(value)
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak'
  return truncate(JSON.stringify(value))
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isEmpty(a) && isEmpty(b)) return true
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  if (asMoney(a) !== null && asMoney(b) !== null && typeof a !== typeof b) return asMoney(a) === asMoney(b)
  return a === b
}

function orderColumns(columns: string[]): string[] {
  const rank = (c: string) => {
    const i = COLUMN_ORDER.indexOf(c)
    return i === -1 ? COLUMN_ORDER.length : i
  }
  return [...columns].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** Changed columns of an update, most important first. */
export function changedColumns(oldData: Data | null, newData: Data | null): string[] {
  if (!oldData || !newData) return []
  const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)])
  const changed = [...keys].filter((k) => !IGNORED_COLUMNS.has(k) && !sameValue(oldData[k], newData[k]))
  return orderColumns(changed)
}

function describeChange(table: string, column: string, before: unknown, after: unknown, resolve?: RefResolver): string {
  const label = columnLabel(column)
  if (FILE_COLUMNS.has(column)) {
    if (isEmpty(before)) return `${label} ditambahkan`
    if (isEmpty(after)) return `${label} dihapus`
    return `${label} diganti`
  }
  if (TEXT_COLUMNS.has(column)) return `${label} diubah`
  const from = formatAuditValue(table, column, before, resolve)
  const to = formatAuditValue(table, column, after, resolve)
  if (from === null || to === null) return `${label} diubah`
  return `${label}: ${from} → ${to}`
}

function str(data: Data, key: string): string | null {
  const v = data[key]
  return typeof v === 'string' && v.trim() ? v : null
}

function enumText(map: Record<string, string>, value: string | null): string | null {
  return value ? (map[value] ?? value) : null
}

function join(...parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter((p): p is string => Boolean(p))
  return kept.length > 0 ? kept.join(' · ') : null
}

/** Which row the entry is about, from the row's own data (new for insert/update, old for delete). */
export function auditSubject(table: string, data: Data | null, resolve?: RefResolver): string | null {
  if (!data) return null
  const ref = (column: string) => {
    const id = str(data, column)
    return id ? (resolve?.(column, id) ?? null) : null
  }
  switch (table) {
    case 'organization_members':
      return join(str(data, 'email') ?? ref('user_id'), enumText(MEMBER_ROLE_LABEL, str(data, 'role')))
    case 'invitations':
      return join(str(data, 'label') ?? str(data, 'email'), enumText(MEMBER_ROLE_LABEL, str(data, 'role')))
    default:
      return str(data, 'name') ?? str(data, 'full_name')
  }
}

/** Table, action, row and (for updates) the changed columns of one audit_log row. */
export function summarizeAuditEntry(entry: Pick<AuditLogEntry, 'table_name' | 'action' | 'old_data' | 'new_data'>, resolve?: RefResolver): AuditSummary {
  const table = entry.table_name
  const data = entry.action === 'delete' ? entry.old_data : (entry.new_data ?? entry.old_data)
  const changes =
    entry.action === 'update'
      ? changedColumns(entry.old_data, entry.new_data).map((c) => describeChange(table, c, entry.old_data?.[c], entry.new_data?.[c], resolve))
      : []
  return {
    tableLabel: AUDIT_TABLE_LABEL[table] ?? table,
    action: entry.action,
    actionLabel: AUDIT_ACTION_LABEL[entry.action] ?? entry.action,
    subject: auditSubject(table, data, resolve),
    changes,
  }
}

/**
 * user_id → email for everyone who appears in the log: current members, plus members who were removed
 * since (their organization_members rows are in the log too).
 */
export function memberEmails(members: Pick<OrganizationMember, 'user_id' | 'email'>[], entries: Pick<AuditLogEntry, 'table_name' | 'old_data' | 'new_data'>[] = []): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of entries) {
    if (e.table_name !== 'organization_members') continue
    for (const d of [e.old_data, e.new_data]) {
      const userId = d && typeof d.user_id === 'string' ? d.user_id : null
      const email = d && typeof d.email === 'string' && d.email ? d.email : null
      if (userId && email && !map.has(userId)) map.set(userId, email)
    }
  }
  for (const m of members) if (m.email) map.set(m.user_id, m.email)
  return map
}

/** Who made the change: the member's email, 'Sistem/Operator' without a signed-in user. */
export function actorLabel(changedBy: string | null, emails: Map<string, string>): string {
  if (!changedBy) return SYSTEM_ACTOR
  return emails.get(changedBy) ?? FORMER_MEMBER_ACTOR
}

/** 'baru saja', '5 menit lalu', '3 jam lalu', 'kemarin', '4 hari lalu'; null after a week (show the date only). */
export function relativeTime(iso: string, now: Date = new Date()): string | null {
  const d = parseDate(iso)
  if (!d) return null
  const seconds = Math.floor((now.getTime() - d.getTime()) / 1000)
  if (seconds < 60) return 'baru saja'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} menit lalu`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} jam lalu`
  const days = differenceInCalendarDays(now, d)
  if (days <= 1) return 'kemarin'
  if (days < 7) return `${days} hari lalu`
  return null
}
