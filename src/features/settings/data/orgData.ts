/** Reading the online organisation's data for the full backup. */
import type { ListOptions, OrgRepo } from '../../../lib/repo/types'
import { LAUNDRY_TABLES, type OrgTableName, type Row, type TableName } from '../../../types/db'
import { buildBackupFile, type BackupFile } from './backupFile'

/** Org tables in a full backup besides `organizations` (this org's row) and the optional `audit_log`: members, invitations and every laundry table. */
export const BACKUP_TABLES = ['organization_members', 'invitations', ...LAUNDRY_TABLES] as const satisfies readonly OrgTableName[]

function listOrdered<T extends OrgTableName>(repo: OrgRepo, table: T, column: string): Promise<Row<T>[]> {
  return repo.list(table, { orderBy: { column, ascending: true } } as ListOptions<Row<T>>)
}

/** Full online backup of the bound organisation (owner/admin: invitations and audit_log are admin-only). */
export async function fetchOrgBackup(repo: OrgRepo, now: Date = new Date()): Promise<BackupFile> {
  const [org, ...lists] = await Promise.all([
    repo.raw.get('organizations', repo.orgId),
    ...BACKUP_TABLES.map((t) => listOrdered(repo, t, 'created_at')),
  ])
  const tables: Partial<Record<TableName, unknown[]>> = { organizations: org ? [org] : [] }
  BACKUP_TABLES.forEach((t, i) => (tables[t] = lists[i] as unknown[]))
  try {
    // audit_log has no created_at; it is optional in a backup, so a failure here does not block the rest
    tables.audit_log = await listOrdered(repo, 'audit_log', 'changed_at')
  } catch {
    /* left out */
  }
  return buildBackupFile(tables, org?.name ?? null, now)
}

