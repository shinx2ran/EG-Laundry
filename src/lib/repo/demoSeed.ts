import type { Customer, CustomerPackage, Order, OrderItem, OrderStatus, PackageCatalogItem, Payment, PaymentMethod, Service } from '../../types/db'
import { addDaysISO, todayISO } from '../format'
import { effectiveQty, lineTotal, nextOrderNumber, promisedDate, unitPrice } from '../../domain/pricing'
import { emptyLocalDb, type LocalDb } from './localRepo'

export const DEMO_ORG_ID = 'demo-org'
export const DEMO_USER_ID = 'local-user'

/** Fixed ids of the demo price list, for tests and screens that want a known service. */
export const DEMO_SERVICE_ID = {
  cuciKering: 'demo-svc-cuci-kering',
  cuciSetrika: 'demo-svc-cuci-setrika',
  setrikaSaja: 'demo-svc-setrika-saja',
  bedCover: 'demo-svc-bed-cover',
  selimut: 'demo-svc-selimut',
  sepatu: 'demo-svc-sepatu',
} as const

export const DEMO_CATALOG_ID = 'demo-pkg-20kg'

interface ItemSpec {
  service: string
  qty: number
  /** take the qty from this customer package */
  pkg?: string
}

interface OrderSpec {
  /** index into the customers list */
  customer: number
  daysAgo: number
  items: ItemSpec[]
  status: OrderStatus
  express?: boolean
  discount?: number
  /** 'full' = paid at pickup (done) or at receipt (other statuses); 'dp' = 40% at receipt + rest at pickup when done; 'none' */
  pay: 'full' | 'dp' | 'none'
  method: PaymentMethod
}

const METHODS: PaymentMethod[] = ['cash', 'transfer', 'qris']

/**
 * Builds the Mode Demo dataset of SPEC 3.11: the demo laundry, its owner, the price list, one package on
 * offer, 12 customers (5 kos tenants with rooms, 7 walk-ins, 2 without a phone), about 40 orders over the
 * last two months with every status (2 late, 3 ready to pick up, 4 not fully paid, 1 cancelled), payments by
 * cash/transfer/QRIS and 2 sold packages that are partly used. Every date is relative to `today`; ids are
 * fixed, so the result is the same for the same clock.
 */
export function buildDemoDb(today: Date = new Date()): LocalDb {
  const db = emptyLocalDb()
  const now = today.toISOString()
  const todayIso = todayISO(today)
  const ts = { created_at: now, updated_at: now }
  const daysAgo = (n: number) => addDaysISO(todayIso, -n)
  const at = (dateISO: string, hour: number, minute = 0, second = 0) => {
    const [y, m, d] = dateISO.split('-').map(Number)
    return new Date(y, m - 1, d, hour, minute, second).toISOString()
  }

  db.organizations.push({
    id: DEMO_ORG_ID,
    name: 'EG Laundry (Demo)',
    created_by: DEMO_USER_ID,
    created_at: now,
    promo_template: 'Halo {nama}, sudah lama tidak mampir ke EG Laundry 😊 Minggu ini ada diskon 10% untuk cuci setrika. Ditunggu ya!',
    wa_footer: 'EG Laundry · buka setiap hari 07.00-21.00',
  })
  db.organization_members.push({
    id: 'demo-member-owner',
    org_id: DEMO_ORG_ID,
    user_id: DEMO_USER_ID,
    email: 'demo@eglaundry.local',
    role: 'owner',
    created_at: now,
  })

  // ---- price list (SPEC 3.11) ----
  const mkService = (id: string, name: string, unit: Service['unit'], price: number, price_express: number | null, days_regular: number, days_express: number | null, min_qty: number, sort_order: number): Service => ({
    id, org_id: DEMO_ORG_ID, name, unit, price, price_express, days_regular, days_express, min_qty, sort_order, active: true, ...ts,
  })
  const services: Service[] = [
    mkService(DEMO_SERVICE_ID.cuciKering, 'Cuci kering', 'kg', 6_000, 10_000, 3, 1, 2, 1),
    mkService(DEMO_SERVICE_ID.cuciSetrika, 'Cuci setrika', 'kg', 8_000, 13_000, 3, 1, 2, 2),
    mkService(DEMO_SERVICE_ID.setrikaSaja, 'Setrika saja', 'kg', 5_000, null, 2, null, 0, 3),
    mkService(DEMO_SERVICE_ID.bedCover, 'Bed cover', 'pcs', 25_000, null, 3, null, 0, 4),
    mkService(DEMO_SERVICE_ID.selimut, 'Selimut', 'pcs', 20_000, null, 3, null, 0, 5),
    mkService(DEMO_SERVICE_ID.sepatu, 'Sepatu', 'pcs', 35_000, null, 4, null, 0, 6),
  ]
  db.services.push(...services)
  const serviceById = new Map(services.map((s) => [s.id, s]))

  const catalog: PackageCatalogItem = {
    id: DEMO_CATALOG_ID, org_id: DEMO_ORG_ID, name: 'Paket 20 kg cuci setrika', service_id: DEMO_SERVICE_ID.cuciSetrika,
    qty: 20, price: 140_000, valid_days: 60, active: true, ...ts,
  }
  db.package_catalog.push(catalog)

  // ---- customers: 5 kos tenants (0-4), 7 walk-ins (5-11); Mega and Bang Jali have no phone ----
  const mkCustomer = (n: number, name: string, phone: string | null, room: string | null, notes: string | null = null): Customer => ({
    id: `demo-cust-${String(n).padStart(2, '0')}`, org_id: DEMO_ORG_ID, name, phone, is_tenant: room !== null, room_name: room,
    kos_tenant_id: null, address: null, notes, ...ts,
  })
  const customers: Customer[] = [
    mkCustomer(1, 'Rina Putri', '0812-0000-0001', 'A1'),
    mkCustomer(2, 'Dimas Saputra', '0812-0000-0002', 'A2'),
    mkCustomer(3, 'Sari Dewi', '0812-0000-0003', 'B1', 'Pisahkan baju putih'),
    mkCustomer(4, 'Yoga Pratama', '0812-0000-0004', 'B3'),
    mkCustomer(5, 'Nabila Zahra', '0812-0000-0005', 'C2'),
    mkCustomer(6, 'Pak Hendra', '0812-0000-0006', null),
    mkCustomer(7, 'Bu Wati', '0812-0000-0007', null, 'Tetangga depan'),
    mkCustomer(8, 'Andi Wijaya', '0812-0000-0008', null),
    mkCustomer(9, 'Lusi Anggraini', '0812-0000-0009', null),
    mkCustomer(10, 'Rudi Hartono', '0812-0000-0010', null),
    mkCustomer(11, 'Mega', null, null),
    mkCustomer(12, 'Bang Jali', null, null, 'Warung sebelah'),
  ]
  db.customers.push(...customers)

  // ---- 2 sold packages, partly used below ----
  const mkPackage = (id: string, customer: number, purchasedDaysAgo: number, method: PaymentMethod): CustomerPackage => {
    const purchased_at = daysAgo(purchasedDaysAgo)
    return {
      id, org_id: DEMO_ORG_ID, customer_id: customers[customer].id, catalog_id: catalog.id, name: catalog.name, service_id: catalog.service_id,
      qty_total: catalog.qty, price: catalog.price, purchased_at, expires_at: addDaysISO(purchased_at, catalog.valid_days ?? 0), method, notes: null,
      created_at: at(purchased_at, 10), updated_at: at(purchased_at, 10),
    }
  }
  const pkgRudi = mkPackage('demo-pkg-rudi', 9, 20, 'transfer')
  const pkgNabila = mkPackage('demo-pkg-nabila', 4, 45, 'cash')
  db.customer_packages.push(pkgRudi, pkgNabila)

  // ---- orders: index 0 = newest. The first ten are hand-picked (today's intake, ready, late, cancelled,
  // a package pickup); the rest rotate through a few baskets and are done and paid.
  const S = DEMO_SERVICE_ID
  const specs: OrderSpec[] = [
    { customer: 0, daysAgo: 0, items: [{ service: S.cuciSetrika, qty: 3 }], status: 'received', pay: 'none', method: 'cash' },
    { customer: 5, daysAgo: 0, items: [{ service: S.cuciKering, qty: 4.5 }], status: 'received', express: true, pay: 'dp', method: 'qris' },
    { customer: 1, daysAgo: 1, items: [{ service: S.cuciSetrika, qty: 2.5 }, { service: S.bedCover, qty: 1 }], status: 'processing', pay: 'full', method: 'transfer' },
    { customer: 2, daysAgo: 1, items: [{ service: S.setrikaSaja, qty: 3 }], status: 'ready', pay: 'full', method: 'cash' },
    { customer: 6, daysAgo: 2, items: [{ service: S.cuciSetrika, qty: 4 }, { service: S.selimut, qty: 1 }], status: 'ready', pay: 'none', method: 'cash' },
    { customer: 7, daysAgo: 2, items: [{ service: S.cuciKering, qty: 3 }], status: 'ready', pay: 'full', method: 'qris' },
    { customer: 3, daysAgo: 5, items: [{ service: S.cuciSetrika, qty: 6 }], status: 'processing', pay: 'none', method: 'cash' },
    { customer: 8, daysAgo: 6, items: [{ service: S.bedCover, qty: 2 }], status: 'received', pay: 'full', method: 'cash' },
    { customer: 9, daysAgo: 3, items: [{ service: S.cuciSetrika, qty: 3, pkg: pkgRudi.id }], status: 'done', pay: 'none', method: 'cash' },
    { customer: 10, daysAgo: 4, items: [{ service: S.cuciKering, qty: 2 }], status: 'cancelled', pay: 'none', method: 'cash' },
  ]
  const baskets: ItemSpec[][] = [
    [{ service: S.cuciSetrika, qty: 3 }],
    [{ service: S.cuciKering, qty: 4.5 }],
    [{ service: S.cuciSetrika, qty: 2.5 }, { service: S.bedCover, qty: 1 }],
    [{ service: S.setrikaSaja, qty: 3 }],
    [{ service: S.selimut, qty: 1 }, { service: S.cuciKering, qty: 2 }],
    [{ service: S.cuciSetrika, qty: 5 }],
    [{ service: S.sepatu, qty: 1 }],
  ]
  for (let i = 10; i < 40; i++) {
    const spec: OrderSpec = {
      customer: (i * 7) % 12,
      daysAgo: 7 + Math.round((i - 10) * 1.75),
      items: baskets[i % 7],
      status: 'done',
      express: i % 7 === 5,
      discount: i % 9 === 0 ? 2_000 : 0,
      pay: i % 4 === 0 ? 'dp' : 'full',
      method: METHODS[i % 3],
    }
    // the package owners draw on their packages
    if (i === 16) Object.assign(spec, { customer: 9, items: [{ service: S.cuciSetrika, qty: 4, pkg: pkgRudi.id }], pay: 'none', express: false, discount: 0 })
    if (i === 22) Object.assign(spec, { customer: 4, items: [{ service: S.cuciSetrika, qty: 5, pkg: pkgNabila.id }, { service: S.selimut, qty: 1 }], pay: 'full', express: false, discount: 0 })
    if (i === 30) Object.assign(spec, { customer: 4, items: [{ service: S.cuciSetrika, qty: 3.5, pkg: pkgNabila.id }], pay: 'none', express: false, discount: 0 })
    specs.push(spec)
  }

  // oldest first, so order numbers climb with time (created_at follows the same order within a day)
  const chronological = specs.map((_, i) => i).sort((a, b) => specs[b].daysAgo - specs[a].daysAgo || b - a)
  for (const i of chronological) {
    const spec = specs[i]
    const received_at = daysAgo(spec.daysAgo)
    const express = spec.express ?? false
    const orderId = `demo-order-${String(i).padStart(2, '0')}`
    const minute = 59 - i
    const items: OrderItem[] = spec.items.map((it, k) => {
      const service = serviceById.get(it.service)!
      const qty = effectiveQty(it.qty, service.min_qty)
      const price = it.pkg ? 0 : unitPrice(service, express)
      return {
        id: `${orderId}-item-${k + 1}`, org_id: DEMO_ORG_ID, order_id: orderId, service_id: service.id, service_name: service.name, unit: service.unit,
        unit_price: price, qty, line_total: lineTotal(qty, price), customer_package_id: it.pkg ?? null, notes: null,
        created_at: at(received_at, 9, minute, k), updated_at: at(received_at, 9, minute, k),
      }
    })
    const promised_at = promisedDate(received_at, spec.items.map((it) => serviceById.get(it.service)!), express)
    const readyDate = promised_at
    const pickupDate = addDaysISO(readyDate, i % 5 === 0 ? 1 : 0)
    const closed = spec.status === 'done' || spec.status === 'ready'
    const order: Order = {
      id: orderId,
      org_id: DEMO_ORG_ID,
      order_number: nextOrderNumber(db.orders.map((o) => o.order_number), received_at),
      customer_id: customers[spec.customer].id,
      received_at,
      promised_at,
      express,
      status: spec.status,
      ready_at: closed ? at(readyDate, 15) : null,
      picked_up_at: spec.status === 'done' ? at(pickupDate, 17) : null,
      discount: spec.discount ?? 0,
      notes: i === 6 ? 'Ada noda kopi di kemeja putih' : i === 2 ? 'Bed cover jangan disetrika' : null,
      created_at: at(received_at, 9, minute),
      updated_at: at(received_at, 9, minute),
    }
    db.orders.push(order)
    db.order_items.push(...items)

    const total = items.reduce((s, it) => s + it.line_total, 0) - order.discount
    const mkPayment = (n: number, amount: number, paid_at: string, method: PaymentMethod, notes: string | null): Payment => ({
      id: `${orderId}-pay-${n}`, org_id: DEMO_ORG_ID, order_id: orderId, amount, paid_at, method, notes, created_by: null,
      created_at: at(paid_at, 9, 30 + n), updated_at: at(paid_at, 9, 30 + n),
    })
    if (total > 0 && spec.pay === 'full') {
      db.payments.push(mkPayment(1, total, spec.status === 'done' ? pickupDate : received_at, spec.method, null))
    } else if (total > 0 && spec.pay === 'dp') {
      const dp = Math.round(total * 0.4)
      db.payments.push(mkPayment(1, dp, received_at, spec.method, 'DP'))
      if (spec.status === 'done') db.payments.push(mkPayment(2, total - dp, pickupDate, METHODS[(i + 1) % 3], 'Pelunasan'))
    }
  }
  return db
}
