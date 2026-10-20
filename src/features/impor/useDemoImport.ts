/**
 * "Pindahkan data Mode Demo ke online": owner/admin only, online only, and only while the online laundry has no
 * orders yet (the card is hidden afterwards; the hook checks again right before writing). The plan is made from
 * what is online at that moment, so a service or customer added meanwhile is reused instead of duplicated. When
 * the import stops halfway (the network drops), what it wrote is removed again, so the owner can simply retry
 * instead of being left with orders without items or payments and a blocked retry.
 */
import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOrg } from '../../hooks/useOrg'
import type { ParsedBackup } from '../settings/data/backupFormat'
import { planDemoImport, type DemoImportPlan, type ExistingOnline } from './demoImport'
import { runDemoImport, undoDemoImport, type DemoImportProgress, type DemoImportResult } from './runDemoImport'

export const STAFF_DEMO_IMPORT_MESSAGE = 'Hanya pemilik/admin yang dapat memindahkan data Mode Demo.'
export const LOCAL_DEMO_IMPORT_MESSAGE = 'Tersedia setelah terhubung ke Supabase.'
export const ORDERS_EXIST_MESSAGE = 'Laundry online ini sudah punya pesanan, jadi data Mode Demo tidak dipindahkan.'

export function useDemoImport() {
  const { repo, role, isLocalMode } = useOrg()
  const qc = useQueryClient()

  return useMemo(() => {
    const isAdmin = role === 'owner' || role === 'admin'
    const canImport = isAdmin && !isLocalMode

    const refuse = () => {
      if (!isAdmin) throw new Error(STAFF_DEMO_IMPORT_MESSAGE)
      if (isLocalMode) throw new Error(LOCAL_DEMO_IMPORT_MESSAGE)
    }

    async function existingOnline(): Promise<ExistingOnline> {
      const [services, package_catalog, customers] = await Promise.all([repo.list('services'), repo.list('package_catalog'), repo.list('customers')])
      return { services, package_catalog, customers }
    }

    /** The preview: what would be moved now. */
    async function preview(backup: ParsedBackup, includeSample: boolean): Promise<DemoImportPlan> {
      refuse()
      return planDemoImport(backup, await existingOnline(), { includeSample })
    }

    async function moveToOnline(backup: ParsedBackup, includeSample: boolean, onProgress?: (p: DemoImportProgress) => void): Promise<DemoImportResult> {
      refuse()
      if ((await repo.list('orders', { limit: 1 })).length > 0) throw new Error(ORDERS_EXIST_MESSAGE)
      const plan = planDemoImport(backup, await existingOnline(), { includeSample })
      try {
        const result = await runDemoImport(plan, (table, rows) => repo.insertMany(table, rows as never), { onProgress })
        if (result.error === null) return result
        return await undoDemoImport(plan, result, {
          remove: (table, id) => repo.remove(table, id),
          exists: async (table, id) => (await repo.get(table, id)) !== null,
        })
      } finally {
        await qc.invalidateQueries({ queryKey: ['org', repo.orgId] })
      }
    }

    return { canImport, preview, moveToOnline }
  }, [repo, role, isLocalMode, qc])
}
