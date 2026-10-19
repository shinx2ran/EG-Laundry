import { useCallback, useMemo } from 'react'
import { useTable } from './useTable'
import type { Customer, CustomerPackage, Order, OrderItem, PackageCatalogItem, Payment, Service } from '../types/db'
import { orderTotals, type OrderTotals } from '../domain/pricing'

export interface LaundryData {
  /** price list, by sort_order (inactive services included: old orders refer to them) */
  services: Service[]
  /** by name */
  customers: Customer[]
  /** newest first (created_at desc) */
  orders: Order[]
  /** oldest first within an order */
  orderItems: OrderItem[]
  /** newest first */
  payments: Payment[]
  /** by name */
  packageCatalog: PackageCatalogItem[]
  /** newest purchase first */
  customerPackages: CustomerPackage[]
  serviceById: Map<string, Service>
  customerById: Map<string, Customer>
  orderById: Map<string, Order>
  itemsByOrder: Map<string, OrderItem[]>
  paymentsByOrder: Map<string, Payment[]>
  packagesByCustomer: Map<string, CustomerPackage[]>
  /** derived money figures of one order (orderTotals over its items and payments) */
  totalsFor: (order: Order) => OrderTotals
  isPending: boolean
  error: unknown
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}

const EMPTY: never[] = []

/**
 * Loads every laundry table in one go (a laundry's data set is small) and exposes lookup maps. Pages
 * filter/aggregate in useMemo with src/domain functions; nothing here is written.
 */
export function useLaundryData(): LaundryData {
  const services = useTable('services', { orderBy: { column: 'sort_order', ascending: true } })
  const customers = useTable('customers', { orderBy: { column: 'name', ascending: true } })
  const orders = useTable('orders', { orderBy: { column: 'created_at', ascending: false } })
  const orderItems = useTable('order_items', { orderBy: { column: 'created_at', ascending: true } })
  const payments = useTable('payments', { orderBy: { column: 'created_at', ascending: false } })
  const packageCatalog = useTable('package_catalog', { orderBy: { column: 'name', ascending: true } })
  const customerPackages = useTable('customer_packages', { orderBy: { column: 'purchased_at', ascending: false } })

  const queries = [services, customers, orders, orderItems, payments, packageCatalog, customerPackages]
  const isPending = queries.some((q) => q.isPending)
  const error = queries.find((q) => q.isError)?.error

  const serviceList = services.data ?? EMPTY
  const customerList = customers.data ?? EMPTY
  const orderList = orders.data ?? EMPTY
  const itemList = orderItems.data ?? EMPTY
  const paymentList = payments.data ?? EMPTY
  const packageList = customerPackages.data ?? EMPTY

  const serviceById = useMemo(() => new Map(serviceList.map((s) => [s.id, s])), [serviceList])
  const customerById = useMemo(() => new Map(customerList.map((c) => [c.id, c])), [customerList])
  const orderById = useMemo(() => new Map(orderList.map((o) => [o.id, o])), [orderList])
  const itemsByOrder = useMemo(() => groupBy(itemList, (i) => i.order_id), [itemList])
  const paymentsByOrder = useMemo(() => groupBy(paymentList, (p) => p.order_id), [paymentList])
  const packagesByCustomer = useMemo(() => groupBy(packageList, (p) => p.customer_id), [packageList])

  const totalsFor = useCallback(
    (order: Order) => orderTotals(order, itemsByOrder.get(order.id) ?? EMPTY, paymentsByOrder.get(order.id) ?? EMPTY),
    [itemsByOrder, paymentsByOrder],
  )

  return {
    services: serviceList,
    customers: customerList,
    orders: orderList,
    orderItems: itemList,
    payments: paymentList,
    packageCatalog: packageCatalog.data ?? EMPTY,
    customerPackages: packageList,
    serviceById,
    customerById,
    orderById,
    itemsByOrder,
    paymentsByOrder,
    packagesByCustomer,
    totalsFor,
    isPending,
    error,
  }
}
