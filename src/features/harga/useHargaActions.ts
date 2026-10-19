/**
 * Writes of the price list and the package catalog (SPEC 3.1, 3.4). Every function checks the role first
 * (SPEC 3.10: staff read only; the database repeats it with RLS online), validates with the same pure
 * functions the forms use, performs its repo calls, and invalidates the tables at the end.
 */
import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import type { PackageCatalogItem, Service } from '../../types/db'
import { IN_USE_MESSAGE } from '../../lib/repo/types'
import {
  PACKAGE_IN_USE_MESSAGE,
  SERVICE_IN_USE_MESSAGE,
  STAFF_PACKAGE_MESSAGE,
  STAFF_PRICE_MESSAGE,
  formToPackagePayload,
  formToServicePayload,
  moveService as moveServicePatches,
  nextSortOrder,
  validatePackageForm,
  validateServiceForm,
  type MoveDirection,
  type PackageFormValues,
  type ServiceFormValues,
} from './hargaUtils'

function firstError(errors: Record<string, string | undefined>): string | null {
  for (const msg of Object.values(errors)) if (msg) return msg
  return null
}

export function useHargaActions() {
  const { repo, role } = useOrg()
  const invalidate = useInvalidate()

  return useMemo(() => {
    const isAdmin = role === 'owner' || role === 'admin'
    const requireAdmin = (message: string) => {
      if (!isAdmin) throw new Error(message)
    }

    // ---- services ----

    async function createService(values: ServiceFormValues): Promise<Service> {
      requireAdmin(STAFF_PRICE_MESSAGE)
      const problem = firstError(validateServiceForm(values))
      if (problem) throw new Error(problem)
      // last in the list; read fresh so two phones adding at once still get different numbers
      const existing = await repo.list('services')
      const created = await repo.insert('services', { ...formToServicePayload(values), sort_order: nextSortOrder(existing) })
      await invalidate('services')
      return created
    }

    async function updateService(service: Service, values: ServiceFormValues): Promise<Service> {
      requireAdmin(STAFF_PRICE_MESSAGE)
      const problem = firstError(validateServiceForm(values))
      if (problem) throw new Error(problem)
      const updated = await repo.update('services', service.id, formToServicePayload(values))
      await invalidate('services')
      return updated
    }

    /** active=false hides the service from new orders and keeps its history (SPEC 3.1). */
    async function setServiceActive(service: Service, active: boolean): Promise<void> {
      requireAdmin(STAFF_PRICE_MESSAGE)
      await repo.update('services', service.id, { active })
      await invalidate('services')
    }

    /**
     * Only an unused service is deleted: order items keep a copy but would lose their link (set null), and
     * catalog entries / sold packages block the delete in the database (restrict). The usage is read fresh,
     * so an order taken on another phone a moment ago still counts.
     */
    async function deleteService(service: Service): Promise<void> {
      requireAdmin(STAFF_PRICE_MESSAGE)
      const [items, catalog, packages] = await Promise.all([
        repo.list('order_items', { where: { service_id: service.id }, limit: 1 }),
        repo.list('package_catalog', { where: { service_id: service.id }, limit: 1 }),
        repo.list('customer_packages', { where: { service_id: service.id }, limit: 1 }),
      ])
      if (items.length > 0 || catalog.length > 0 || packages.length > 0) throw new Error(SERVICE_IN_USE_MESSAGE)
      try {
        await repo.remove('services', service.id)
      } catch (err) {
        if (err instanceof Error && err.message === IN_USE_MESSAGE) throw new Error(SERVICE_IN_USE_MESSAGE)
        throw err
      } finally {
        // also after a refusal: the row may already be gone on another device
        await invalidate('services')
      }
    }

    /** ▲/▼ within the unit group (moveService in hargaUtils); the list is read fresh before renumbering. */
    async function moveService(service: Service, direction: MoveDirection): Promise<void> {
      requireAdmin(STAFF_PRICE_MESSAGE)
      const fresh = await repo.list('services')
      const patches = moveServicePatches(fresh, service.id, direction)
      if (patches.length === 0) return
      for (const p of patches) await repo.update('services', p.id, { sort_order: p.sort_order })
      await invalidate('services')
    }

    // ---- package catalog ----

    async function createPackage(values: PackageFormValues, services: Service[]): Promise<PackageCatalogItem> {
      requireAdmin(STAFF_PACKAGE_MESSAGE)
      const problem = firstError(validatePackageForm(values, services))
      if (problem) throw new Error(problem)
      const created = await repo.insert('package_catalog', formToPackagePayload(values))
      await invalidate('package_catalog')
      return created
    }

    async function updatePackage(item: PackageCatalogItem, values: PackageFormValues, services: Service[]): Promise<PackageCatalogItem> {
      requireAdmin(STAFF_PACKAGE_MESSAGE)
      const problem = firstError(validatePackageForm(values, services))
      if (problem) throw new Error(problem)
      const updated = await repo.update('package_catalog', item.id, formToPackagePayload(values))
      await invalidate('package_catalog')
      return updated
    }

    async function setPackageActive(item: PackageCatalogItem, active: boolean): Promise<void> {
      requireAdmin(STAFF_PACKAGE_MESSAGE)
      await repo.update('package_catalog', item.id, { active })
      await invalidate('package_catalog')
    }

    /** Deleting a bought entry would cut the purchases' link (set null): deactivate those instead. */
    async function deletePackage(item: PackageCatalogItem): Promise<void> {
      requireAdmin(STAFF_PACKAGE_MESSAGE)
      const sold = await repo.list('customer_packages', { where: { catalog_id: item.id }, limit: 1 })
      if (sold.length > 0) throw new Error(PACKAGE_IN_USE_MESSAGE)
      try {
        await repo.remove('package_catalog', item.id)
      } catch (err) {
        if (err instanceof Error && err.message === IN_USE_MESSAGE) throw new Error(PACKAGE_IN_USE_MESSAGE)
        throw err
      } finally {
        await invalidate('package_catalog')
      }
    }

    return {
      isAdmin,
      createService,
      updateService,
      setServiceActive,
      deleteService,
      moveService,
      createPackage,
      updatePackage,
      setPackageActive,
      deletePackage,
    }
  }, [repo, role, invalidate])
}

export type HargaActions = ReturnType<typeof useHargaActions>
