import type { Insert, OrgInsert, OrgTableName, Row, TableName, Update } from '../../types/db'
import type { MemberRole } from '../../types/db'

export type RepoMode = 'supabase' | 'local'

/** Equality filter; an array value means "IN (...)". */
export type Where<T> = { [K in keyof T]?: T[K] | NonNullable<T[K]>[] }

export interface ListOptions<T> {
  where?: Where<T>
  /** column >= value (inclusive) */
  gte?: { [K in keyof T]?: T[K] }
  /** column <= value (inclusive) */
  lte?: { [K in keyof T]?: T[K] }
  orderBy?: { column: keyof T & string; ascending?: boolean }
  limit?: number
}

/** logos = the laundry logo (1 MB, image only) */
export type StorageBucket = 'logos'

/** Thrown by ensureMembership when the signed-in account belongs to no organisation yet. */
export class NotMemberError extends Error {
  readonly code = 'NOT_MEMBER'
  constructor(message = 'Akun ini belum menjadi anggota. Masukkan kode dari pemilik laundry.') {
    super(message)
    this.name = 'NotMemberError'
  }
}

/** A write that reached no row: the row is gone, or row-level security hides it from this member. */
export const UPDATE_DENIED_MESSAGE = 'Data tidak ditemukan atau Anda tidak memiliki izin untuk mengubahnya.'
export const DELETE_DENIED_MESSAGE = 'Data tidak ditemukan atau Anda tidak memiliki izin untuk menghapusnya.'
/** ON DELETE RESTRICT: another row still points at the one being deleted. */
export const IN_USE_MESSAGE = 'Data ini masih dipakai oleh data lain dan tidak dapat dihapus.'
/** unique (org_id, order_number) hit (two phones at the same moment): the caller retries with the next number. */
export const ORDER_NUMBER_TAKEN_MESSAGE = 'Nomor pesanan sudah dipakai. Coba lagi.'

// Texts of the laundry triggers in supabase/schema.sql; LocalRepo raises the same ones in Mode Demo.
/** orders_done_guard: a done/cancelled order and its items are frozen for staff. */
export const DONE_ORDER_ADMIN_MESSAGE = 'Pesanan yang sudah selesai hanya bisa diubah pemilik/admin.'
/** orders_cancel_guard: delete the payments first (admin). */
export const CANCEL_WITH_PAYMENTS_MESSAGE = 'Pesanan yang sudah ada pembayarannya tidak dapat dibatalkan.'
/** orders_cancel_guard: only Diterima/Proses can be cancelled (SPEC 3.3). */
export const CANCEL_STATUS_MESSAGE = 'Pesanan hanya dapat dibatalkan selama Diterima/Proses.'
/** payments_limit: the sum of payments never exceeds the order total. */
export const PAYMENT_EXCEEDS_TOTAL_MESSAGE = 'Pembayaran melebihi total pesanan.'
/** package_use_guard (SPEC 3.4) */
export const PACKAGE_OTHER_CUSTOMER_MESSAGE = 'Paket ini milik pelanggan lain.'
export const PACKAGE_OTHER_SERVICE_MESSAGE = 'Paket ini tidak berlaku untuk layanan tersebut.'
export const PACKAGE_EXPIRED_MESSAGE = 'Paket sudah kedaluwarsa pada tanggal masuk pesanan.'
export const PACKAGE_INSUFFICIENT_MESSAGE = 'Sisa paket tidak cukup.'

export interface CreatedInvitation {
  /** plain code, formatted 'ABCD-EFGH'; shown once, the database keeps only a hash */
  code: string
  expiresAt: string
}

/** Invitation/setup codes: uppercase, no separators, no look-alike characters (no 0/O/1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function formatCode(normalized: string): string {
  return normalized.length === 8 ? `${normalized.slice(0, 4)}-${normalized.slice(4)}` : normalized
}

/**
 * Minimal, table-generic persistence API. Both the Supabase adapter and the local (browser)
 * adapter implement this. All aggregation is done client-side in `src/domain` with pure functions,
 * which keeps both adapters tiny and the business logic testable.
 */
export interface Repo {
  readonly mode: RepoMode
  list<T extends TableName>(table: T, opts?: ListOptions<Row<T>>): Promise<Row<T>[]>
  get<T extends TableName>(table: T, id: string): Promise<Row<T> | null>
  insert<T extends TableName>(table: T, row: Insert<T>): Promise<Row<T>>
  insertMany<T extends TableName>(table: T, rows: Insert<T>[]): Promise<Row<T>[]>
  /** `orgId`, when given, additionally scopes the write to that organisation (defence in depth). */
  update<T extends TableName>(table: T, id: string, patch: Update<T>, orgId?: string): Promise<Row<T>>
  remove<T extends TableName>(table: T, id: string, orgId?: string): Promise<void>

  /**
   * Resolve the signed-in user's organisation server-side (existing membership only; the owner is
   * listed first). Throws NotMemberError when the account belongs to no organisation: the UI then asks
   * for a code (joinWithCode). Never creates organisations and never matches invitations by email.
   */
  ensureMembership(user: { id: string; email: string | null }): Promise<string>

  /**
   * Join with a code: an invitation code (one-time, 7 days) or, while no organisation exists yet, the
   * owner setup code configured on the server. Returns the organisation id. Errors are Indonesian.
   */
  joinWithCode(code: string): Promise<string>

  /** Upload a file; returns the storage path to persist on the row. Local mode returns null (not stored). */
  uploadFile(bucket: StorageBucket, path: string, file: Blob, contentType?: string): Promise<string | null>
  /** Resolve a storage path to a viewable URL (signed, short-lived in Supabase mode). */
  getFileUrl(bucket: StorageBucket, path: string | null | undefined): Promise<string | null>
  removeFile(bucket: StorageBucket, path: string): Promise<void>

  /** Admin only. Creates a one-time invitation code for the role; `label` says who it is for. */
  createInvitation(orgId: string, role: 'admin' | 'staff', label: string | null): Promise<CreatedInvitation>
  /** Owner only. Refuses to demote the last owner. */
  setMemberRole(orgId: string, userId: string, role: MemberRole): Promise<void>
  removeMember(orgId: string, userId: string): Promise<void>
}

/**
 * Repo bound to one organisation: fills `org_id` on insert and filters lists by it.
 * Feature modules should use this (via `useRepo()`) rather than the raw Repo.
 */
export interface OrgRepo {
  readonly mode: RepoMode
  readonly orgId: string
  list<T extends OrgTableName>(table: T, opts?: ListOptions<Row<T>>): Promise<Row<T>[]>
  get<T extends OrgTableName>(table: T, id: string): Promise<Row<T> | null>
  insert<T extends OrgTableName>(table: T, row: OrgInsert<T>): Promise<Row<T>>
  insertMany<T extends OrgTableName>(table: T, rows: OrgInsert<T>[]): Promise<Row<T>[]>
  update<T extends OrgTableName>(table: T, id: string, patch: Update<T>): Promise<Row<T>>
  remove<T extends OrgTableName>(table: T, id: string): Promise<void>
  uploadFile(bucket: StorageBucket, fileName: string, file: Blob, contentType?: string): Promise<string | null>
  getFileUrl(bucket: StorageBucket, path: string | null | undefined): Promise<string | null>
  removeFile(bucket: StorageBucket, path: string): Promise<void>
  createInvitation(role: 'admin' | 'staff', label: string | null): Promise<CreatedInvitation>
  setMemberRole(userId: string, role: MemberRole): Promise<void>
  removeMember(userId: string): Promise<void>
  /** underlying unscoped repo, for the rare cross-org operations (organisation switcher, etc.) */
  readonly raw: Repo
}

/** Never let a patch rewrite identity columns, whatever the caller passed at runtime. */
function stripImmutable<T extends TableName>(patch: Update<T>): Update<T> {
  const copy = { ...(patch as Record<string, unknown>) }
  delete copy.id
  delete copy.org_id
  delete copy.created_at
  delete copy.created_by
  return copy as Update<T>
}

export function bindOrg(repo: Repo, orgId: string): OrgRepo {
  const withOrg = <T extends OrgTableName>(opts?: ListOptions<Row<T>>): ListOptions<Row<T>> => ({
    ...opts,
    where: { ...(opts?.where ?? {}), org_id: orgId } as ListOptions<Row<T>>['where'],
  })
  return {
    mode: repo.mode,
    orgId,
    raw: repo,
    list: (table, opts) => repo.list(table, withOrg(opts)),
    get: async (table, id) => {
      const row = await repo.get(table, id)
      return row && row.org_id === orgId ? row : null
    },
    insert: (table, row) => repo.insert(table, { ...row, org_id: orgId } as unknown as Insert<typeof table>),
    insertMany: (table, rows) =>
      repo.insertMany(
        table,
        rows.map((r) => ({ ...r, org_id: orgId }) as unknown as Insert<typeof table>),
      ),
    update: (table, id, patch) => repo.update(table, id, stripImmutable(patch), orgId),
    remove: (table, id) => repo.remove(table, id, orgId),
    uploadFile: (bucket, fileName, file, contentType) =>
      repo.uploadFile(bucket, `${orgId}/${fileName}`, file, contentType),
    getFileUrl: (bucket, path) => repo.getFileUrl(bucket, path),
    removeFile: (bucket, path) => repo.removeFile(bucket, path),
    createInvitation: (role, label) => repo.createInvitation(orgId, role, label),
    setMemberRole: (userId, role) => repo.setMemberRole(orgId, userId, role),
    removeMember: (userId) => repo.removeMember(orgId, userId),
  }
}
