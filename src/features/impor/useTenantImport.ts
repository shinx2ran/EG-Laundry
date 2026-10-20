/**
 * "Impor penyewa dari Woombad" action (SPEC 3.8, 3.10: owner/admin only). The plan is made again from the
 * customers as they are now, right before writing, so a customer added on another phone after the preview is
 * matched instead of duplicated.
 */
import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import { applyTenantImport, type TenantImportResult } from './applyTenantImport'
import { planTenantImport, type TenantImportOptions, type WoombadBackup } from './tenantImport'

export const STAFF_TENANT_IMPORT_MESSAGE = 'Hanya pemilik/admin yang dapat mengimpor penyewa.'

export function useTenantImport() {
  const { repo, role } = useOrg()
  const invalidate = useInvalidate()

  return useMemo(() => {
    const canImport = role === 'owner' || role === 'admin'

    async function importTenants(backup: WoombadBackup, options: TenantImportOptions): Promise<TenantImportResult> {
      if (!canImport) throw new Error(STAFF_TENANT_IMPORT_MESSAGE)
      const customers = await repo.list('customers')
      try {
        return await applyTenantImport(repo, planTenantImport(backup, customers, options))
      } finally {
        await invalidate('customers')
      }
    }

    return { canImport, importTenants }
  }, [repo, role, invalidate])
}
