/**
 * Writes of the customers module (SPEC 3.2, 3.4, 3.10). Every action checks the role and the input before
 * its first write (the UI hides what a role may not do; online the database refuses it too) and invalidates
 * the affected tables at the end.
 */
import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import type { Customer, CustomerPackage, PackageCatalogItem, PaymentMethod } from '../../types/db'
import {
  ERR_PACKAGE_INACTIVE,
  formToCustomerPatch,
  formToCustomerPayload,
  packageSaleRow,
  validateCustomerForm,
  validatePackageSale,
  type CustomerFormErrors,
  type CustomerFormValues,
} from './customerUtils'

export const STAFF_DELETE_CUSTOMER_MESSAGE = 'Hanya pemilik/admin yang dapat menghapus pelanggan.'
export const STAFF_DELETE_PACKAGE_MESSAGE = 'Hanya pemilik/admin yang dapat menghapus paket terjual.'
export const CATALOG_MISSING_MESSAGE = 'Paket tidak ditemukan di katalog.'

export interface SellPackageInput {
  customer: Pick<Customer, 'id'>
  catalog: PackageCatalogItem
  /** 'YYYY-MM-DD' */
  purchasedAt: string
  method: PaymentMethod
  notes: string
}

function firstError(errors: CustomerFormErrors): string | null {
  for (const key of Object.keys(errors) as (keyof CustomerFormErrors)[]) {
    const msg = errors[key]
    if (msg) return msg
  }
  return null
}

export function useCustomerActions() {
  const { repo, role } = useOrg()
  const invalidate = useInvalidate()

  return useMemo(() => {
    const isAdmin = role === 'owner' || role === 'admin'
    // SPEC 3.10: staff add and edit customers and sell packages; only owner/admin delete a customer.
    const canDeleteCustomers = isAdmin

    async function createCustomer(values: CustomerFormValues): Promise<Customer> {
      const problem = firstError(validateCustomerForm(values))
      if (problem) throw new Error(problem)
      const row = await repo.insert('customers', formToCustomerPayload(values))
      await invalidate('customers')
      return row
    }

    async function updateCustomer(customer: Pick<Customer, 'id'>, values: CustomerFormValues): Promise<Customer> {
      const problem = firstError(validateCustomerForm(values))
      if (problem) throw new Error(problem)
      const row = await repo.update('customers', customer.id, formToCustomerPatch(values))
      await invalidate('customers')
      return row
    }

    /**
     * Owner/admin only. A customer with orders or packages is refused by the database (FK restrict) with
     * IN_USE_MESSAGE; the list is refreshed either way so a customer deleted on another device disappears.
     */
    async function deleteCustomer(customer: Pick<Customer, 'id'>): Promise<void> {
      if (!canDeleteCustomers) throw new Error(STAFF_DELETE_CUSTOMER_MESSAGE)
      try {
        await repo.remove('customers', customer.id)
      } finally {
        await invalidate('customers')
      }
    }

    /**
     * Sells a catalog package to the customer (every member may). The copied name/service/qty/price are read
     * fresh from the catalog, so a price changed on another phone after this screen loaded is what is sold.
     */
    async function sellPackage(input: SellPackageInput): Promise<CustomerPackage> {
      const problem = validatePackageSale({ catalog: input.catalog, purchasedAt: input.purchasedAt })
      if (problem) throw new Error(problem)
      const fresh = await repo.get('package_catalog', input.catalog.id)
      if (!fresh || !fresh.active) {
        await invalidate('package_catalog')
        throw new Error(fresh ? ERR_PACKAGE_INACTIVE : CATALOG_MISSING_MESSAGE)
      }
      const row = await repo.insert(
        'customer_packages',
        packageSaleRow({ catalog: fresh, customerId: input.customer.id, purchasedAt: input.purchasedAt, method: input.method, notes: input.notes }),
      )
      await invalidate('customer_packages', 'package_catalog')
      return row
    }

    /**
     * Owner/admin only (SPEC 2.2, 3.10): undo a package sold by mistake (wrong customer or wrong package), so its
     * price no longer counts as uang masuk. A package that an order item uses is refused (FK restrict,
     * IN_USE_MESSAGE): change those orders first.
     */
    async function deletePackage(pkg: Pick<CustomerPackage, 'id'>): Promise<void> {
      if (!isAdmin) throw new Error(STAFF_DELETE_PACKAGE_MESSAGE)
      try {
        await repo.remove('customer_packages', pkg.id)
      } finally {
        await invalidate('customer_packages')
      }
    }

    return { isAdmin, canDeleteCustomers, createCustomer, updateCustomer, deleteCustomer, sellPackage, deletePackage }
  }, [repo, role, invalidate])
}

export type CustomerActions = ReturnType<typeof useCustomerActions>
