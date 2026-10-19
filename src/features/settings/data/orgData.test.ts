import { describe, expect, it } from 'vitest'
import { buildDemoDb, DEMO_ORG_ID } from '../../../lib/repo/demoSeed'
import { LocalRepo } from '../../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../../lib/repo/types'
import { parseBackupText } from './backupFormat'
import { localBackupFile } from './backupFile'
import { BACKUP_TABLES, fetchOrgBackup } from './orgData'

function demoRepo() {
  const db = buildDemoDb(new Date(2026, 9, 12))
  // a second organisation on the same "server" must never leak into the backup
  db.organizations.push({ id: 'other-org', name: 'Lain', created_by: 'x', created_at: '2026-01-01T00:00:00.000Z' })
  db.invitations.push(
    { id: 'i-mine', org_id: DEMO_ORG_ID, label: 'Istri', email: null, role: 'admin', invited_by: null, expires_at: '2099-01-01T00:00:00Z', accepted_at: null, accepted_by: null, created_at: '2026-10-01T00:00:00Z' },
    { id: 'i-other', org_id: 'other-org', label: 'X', email: null, role: 'staff', invited_by: null, expires_at: '2099-01-01T00:00:00Z', accepted_at: null, accepted_by: null, created_at: '2026-10-01T00:00:00Z' },
  )
  db.audit_log.push(
    { id: 'a2', org_id: DEMO_ORG_ID, table_name: 'invitations', row_id: null, action: 'update', changed_by: null, changed_at: '2026-10-02T00:00:00Z', old_data: null, new_data: null },
    { id: 'a1', org_id: DEMO_ORG_ID, table_name: 'invitations', row_id: null, action: 'insert', changed_by: null, changed_at: '2026-10-01T00:00:00Z', old_data: null, new_data: null },
  )
  return { db, repo: bindOrg(new LocalRepo(db), DEMO_ORG_ID) }
}

describe('fetchOrgBackup', () => {
  it('contains every table of this organisation only, in the version 1 format', async () => {
    const { db, repo } = demoRepo()
    const file = await fetchOrgBackup(repo, new Date('2026-10-12T03:00:00Z'))
    expect(file).toMatchObject({ version: 1, exportedAt: '2026-10-12T03:00:00.000Z', orgName: 'EG Laundry (Demo)' })
    expect(file.tables.organizations).toEqual([db.organizations[0]])
    for (const t of BACKUP_TABLES) {
      expect(file.tables[t], t).toHaveLength(db[t].filter((r) => r.org_id === DEMO_ORG_ID).length)
    }
    expect((file.tables.invitations as { id: string }[]).map((r) => r.id)).toEqual(['i-mine'])
    expect((file.tables.audit_log as { id: string }[]).map((r) => r.id)).toEqual(['a1', 'a2'])
    // the app can read its own file back
    expect(parseBackupText(JSON.stringify(file)).tables.organization_members).toHaveLength(1)
  })

  it('still produces a backup when the audit log cannot be read', async () => {
    const { repo } = demoRepo()
    const failingAudit: OrgRepo = {
      ...repo,
      list: ((table: Parameters<OrgRepo['list']>[0], opts?: Parameters<OrgRepo['list']>[1]) =>
        table === 'audit_log' ? Promise.reject(new Error('relation "audit_log" does not exist')) : repo.list(table, opts)) as OrgRepo['list'],
    }
    const file = await fetchOrgBackup(failingAudit)
    expect(file.tables).not.toHaveProperty('audit_log')
    expect(file.tables.invitations).toHaveLength(1)
  })
})

describe('localBackupFile', () => {
  it('wraps the whole device snapshot', () => {
    const { db, repo } = demoRepo()
    const file = localBackupFile(repo, 'EG Laundry (Demo)')
    expect(file.version).toBe(1)
    expect(file.tables).toEqual(db)
  })
})
