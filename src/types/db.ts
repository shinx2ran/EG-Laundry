/**
 * Central data model for EG Laundry.
 *
 * Every business table carries `org_id` (denormalised) so Supabase Row Level Security can be a
 * single `is_org_member(org_id)` check, and so the local/demo adapter can filter trivially.
 *
 * Money is stored as integer Rupiah (no decimals). Dates are ISO strings:
 *   - `*_date`, `*_at` date columns -> 'YYYY-MM-DD' (date only)
 *   - `created_at`, `updated_at`     -> full ISO timestamp
 *
 * This file holds the core (organisation, members, invitations, change history). The laundry tables
 * (price list, customers, orders) are added by the laundry modules (SPEC section 3).
 *
 * NOTE: tsconfig has `erasableSyntaxOnly`, so no TypeScript enums. Use the `as const` arrays below.
 */

// ---------- Enumerations ----------

export const MEMBER_ROLES = ['owner', 'admin', 'staff'] as const
export type MemberRole = (typeof MEMBER_ROLES)[number]

export const AUDIT_ACTIONS = ['insert', 'update', 'delete'] as const
export type AuditAction = (typeof AUDIT_ACTIONS)[number]

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

// ---------- Table map ----------

export interface Tables {
  organizations: Organization
  organization_members: OrganizationMember
  invitations: Invitation
  audit_log: AuditLogEntry
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

export const TABLE_NAMES: TableName[] = ['organizations', 'organization_members', 'invitations', 'audit_log']

// ---------- Indonesian labels (shared vocabulary) ----------

export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Pemilik',
  admin: 'Admin',
  staff: 'Staf',
}
