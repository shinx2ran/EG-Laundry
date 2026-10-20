/**
 * Writing a tenant import plan through the ordinary repo (SPEC 3.8): updates, then new customers, then the
 * customers whose lease ended, so online the audit log records every change as usual. Stops at the first error
 * and says what was already saved (those changes stay: running the import again finds them unchanged).
 */
import type { OrgRepo } from '../../lib/repo/types'
import { tenantImportSummary, type TenantImportCounts, type TenantImportPlan } from './tenantImport'

export type TenantImportWriter = Pick<OrgRepo, 'update' | 'insertMany'>

export interface TenantImportResult {
  update: number
  create: number
  deactivate: number
}

/** New customers per insert; small enough that one refused row does not cost much to report. */
const CREATE_CHUNK = 100

export class TenantImportError extends Error {
  readonly done: TenantImportResult
  constructor(message: string, done: TenantImportResult) {
    super(message)
    this.name = 'TenantImportError'
    this.done = done
  }
}

function stopMessage(cause: unknown, done: TenantImportResult): string {
  const reason = cause instanceof Error ? cause.message : String(cause)
  const saved = done.update + done.create + done.deactivate > 0 ? `Sudah tersimpan: ${tenantImportSummary(done)}.` : 'Belum ada perubahan yang tersimpan.'
  return `Impor berhenti: ${reason} ${saved}`
}

export async function applyTenantImport(repo: TenantImportWriter, plan: TenantImportPlan): Promise<TenantImportResult> {
  const done: TenantImportResult = { update: 0, create: 0, deactivate: 0 }
  try {
    for (const u of plan.toUpdate) {
      await repo.update('customers', u.customerId, u.patch)
      done.update++
    }
    for (let i = 0; i < plan.toCreate.length; i += CREATE_CHUNK) {
      const chunk = plan.toCreate.slice(i, i + CREATE_CHUNK)
      await repo.insertMany(
        'customers',
        chunk.map((c) => ({ name: c.name, phone: c.phone, is_tenant: true, room_name: c.room_name, kos_tenant_id: c.kos_tenant_id, address: null, notes: null })),
      )
      done.create += chunk.length
    }
    for (const d of plan.toDeactivate) {
      await repo.update('customers', d.customerId, d.patch)
      done.deactivate++
    }
  } catch (err) {
    throw new TenantImportError(stopMessage(err, done), done)
  }
  return done
}

/** The counts the screen shows for a plan, as the result would be. */
export function plannedResult(counts: Pick<TenantImportCounts, 'update' | 'create' | 'deactivate'>): TenantImportResult {
  return { update: counts.update, create: counts.create, deactivate: counts.deactivate }
}
