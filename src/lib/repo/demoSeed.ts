import { newId } from '../ids'
import { emptyLocalDb, type LocalDb } from './localRepo'

export const DEMO_ORG_ID = 'demo-org'
export const DEMO_USER_ID = 'local-user'

/**
 * Builds the Mode Demo dataset: the demo laundry and its owner. The laundry modules add their own sample
 * rows (price list, customers, orders) here. Deterministic apart from `today`.
 */
export function buildDemoDb(today: Date = new Date()): LocalDb {
  const db = emptyLocalDb()
  const now = today.toISOString()

  db.organizations.push({ id: DEMO_ORG_ID, name: 'EG Laundry (Demo)', created_by: DEMO_USER_ID, created_at: now })
  db.organization_members.push({
    id: newId(),
    org_id: DEMO_ORG_ID,
    user_id: DEMO_USER_ID,
    email: 'demo@eglaundry.local',
    role: 'owner',
    created_at: now,
  })
  return db
}
