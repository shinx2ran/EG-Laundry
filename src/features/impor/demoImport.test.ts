import { describe, expect, it } from 'vitest'
import { buildDemoDb, DEMO_CATALOG_ID, DEMO_ORG_ID, DEMO_SERVICE_ID } from '../../lib/repo/demoSeed'
import { LocalRepo, emptyLocalDb, type LocalDb } from '../../lib/repo/localRepo'
import { bindOrg, PAYMENT_EXCEEDS_TOTAL_MESSAGE } from '../../lib/repo/types'
import { orderTotals, packageRemaining } from '../../domain/pricing'
import { buildBackupFile } from '../settings/data/backupFile'
import { parseBackupText, type ParsedBackup } from '../settings/data/backupFormat'
import { DEMO_IMPORT_ORDER, countsText, normalizeDemoRow, planDemoImport, plannedCounts, totalCount, type DemoImportPlan } from './demoImport'
import { demoImportMessage, runDemoImport } from './runDemoImport'

const NOW = new Date('2026-10-20T03:00:00.000Z')
const OWN = {
  customer: '6a1d2c9e-0000-4000-8000-000000000001',
  order: '6a1d2c9e-0000-4000-8000-000000000002',
  item1: '6a1d2c9e-0000-4000-8000-000000000003',
  item2: '6a1d2c9e-0000-4000-8000-000000000004',
  payment: '6a1d2c9e-0000-4000-8000-000000000005',
  pkg: '6a1d2c9e-0000-4000-8000-000000000006',
  rinaOrder: '6a1d2c9e-0000-4000-8000-000000000007',
  rinaItem: '6a1d2c9e-0000-4000-8000-000000000008',
}

/** Mode Demo after the owner used it for real: one own customer with a package and an order, one order for sample Rina. */
function demoDbWithOwnRows(): LocalDb {
  const db = buildDemoDb(new Date(2026, 9, 20))
  const ts = { created_at: '2026-10-19T02:00:00.000Z', updated_at: '2026-10-19T02:00:00.000Z' }
  const org_id = DEMO_ORG_ID
  db.customers.push({ id: OWN.customer, org_id, name: 'Pak Joko', phone: '0812-3456-0001', is_tenant: false, room_name: null, kos_tenant_id: null, address: 'Gang Melati', notes: null, ...ts })
  db.customer_packages.push({
    id: OWN.pkg, org_id, customer_id: OWN.customer, catalog_id: DEMO_CATALOG_ID, name: 'Paket 20 kg cuci setrika', service_id: DEMO_SERVICE_ID.cuciSetrika,
    qty_total: 20, price: 140_000, purchased_at: '2026-10-19', expires_at: '2026-12-18', method: 'qris', notes: null, ...ts,
  })
  db.orders.push({
    id: OWN.order, org_id, order_number: 'LD-202610-0099', customer_id: OWN.customer, received_at: '2026-10-19', promised_at: '2026-10-22', express: false,
    status: 'processing', ready_at: null, picked_up_at: null, discount: 0, notes: 'Pisahkan putih', ...ts,
  })
  db.order_items.push(
    { id: OWN.item1, org_id, order_id: OWN.order, service_id: DEMO_SERVICE_ID.cuciSetrika, service_name: 'Cuci setrika', unit: 'kg', unit_price: 0, qty: 4.5, line_total: 0, customer_package_id: OWN.pkg, notes: null, ...ts },
    { id: OWN.item2, org_id, order_id: OWN.order, service_id: DEMO_SERVICE_ID.bedCover, service_name: 'Bed cover', unit: 'pcs', unit_price: 25_000, qty: 1, line_total: 25_000, customer_package_id: null, notes: null, ...ts },
  )
  db.payments.push({ id: OWN.payment, org_id, order_id: OWN.order, amount: 10_000, paid_at: '2026-10-19', method: 'cash', notes: 'DP', created_by: null, ...ts })
  db.orders.push({
    id: OWN.rinaOrder, org_id, order_number: 'LD-202610-0100', customer_id: 'demo-cust-01', received_at: '2026-10-19', promised_at: '2026-10-22', express: false,
    status: 'received', ready_at: null, picked_up_at: null, discount: 0, notes: null, ...ts,
  })
  db.order_items.push({ id: OWN.rinaItem, org_id, order_id: OWN.rinaOrder, service_id: DEMO_SERVICE_ID.cuciKering, service_name: 'Cuci kering', unit: 'kg', unit_price: 6_000, qty: 3, line_total: 18_000, customer_package_id: null, notes: null, ...ts })
  return db
}

function parsed(db: LocalDb): ParsedBackup {
  return parseBackupText(JSON.stringify(buildBackupFile(db, 'EG Laundry (Demo)', NOW)))
}

function counter() {
  let n = 0
  return () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`
}

const ids = (rows: Record<string, unknown>[]) => new Set(rows.map((r) => r.id as string))

/** Every foreign key of the plan points at a row of the plan (or one of `online`). */
function expectConsistent(plan: DemoImportPlan, online: Set<string> = new Set()) {
  const t = plan.tables
  const has = (set: Set<string>, id: unknown) => typeof id === 'string' && (set.has(id) || online.has(id))
  const services = ids(t.services)
  const catalog = ids(t.package_catalog)
  const customers = ids(t.customers)
  const packages = ids(t.customer_packages)
  const orders = ids(t.orders)
  for (const c of t.package_catalog) expect(has(services, c.service_id)).toBe(true)
  for (const p of t.customer_packages) {
    expect(has(customers, p.customer_id)).toBe(true)
    expect(has(services, p.service_id)).toBe(true)
    if (p.catalog_id !== null) expect(has(catalog, p.catalog_id)).toBe(true)
  }
  for (const o of t.orders) expect(has(customers, o.customer_id)).toBe(true)
  for (const i of t.order_items) {
    expect(orders.has(i.order_id as string)).toBe(true)
    if (i.service_id !== null) expect(has(services, i.service_id)).toBe(true)
    if (i.customer_package_id !== null) expect(packages.has(i.customer_package_id as string)).toBe(true)
  }
  for (const p of t.payments) expect(orders.has(p.order_id as string)).toBe(true)
  // no demo id survives, and the server columns are left to the database / the OrgRepo
  for (const table of DEMO_IMPORT_ORDER) {
    for (const row of t[table]) {
      expect(JSON.stringify(row)).not.toMatch(/"demo-/)
      expect(row).not.toHaveProperty('org_id')
      expect(row).not.toHaveProperty('updated_at')
      expect(row).not.toHaveProperty('created_by')
      expect(typeof row.created_at).toBe('string')
    }
  }
}

describe('planDemoImport', () => {
  it('with the sample data: every row gets a new UUID and every reference is remapped', () => {
    const db = demoDbWithOwnRows()
    const plan = planDemoImport(parsed(db), undefined, { includeSample: true, newId: counter(), now: NOW })
    expect(plannedCounts(plan)).toEqual({
      services: 6,
      package_catalog: 1,
      customers: 13,
      customer_packages: 3,
      orders: db.orders.length,
      order_items: db.order_items.length,
      payments: db.payments.length,
    })
    expectConsistent(plan)
    const newOrder = plan.idMap.get('demo-order-01')!
    expect(newOrder).toMatch(/^00000000-0000-4000-9000-\d{12}$/)
    const source = db.orders.find((o) => o.id === 'demo-order-01')!
    const copy = plan.tables.orders.find((o) => o.id === newOrder)!
    expect(copy).toMatchObject({ order_number: source.order_number, status: source.status, received_at: source.received_at, created_at: source.created_at, customer_id: plan.idMap.get(source.customer_id) })
    const items = plan.tables.order_items.filter((i) => i.order_id === newOrder)
    expect(items.map((i) => i.service_name)).toEqual(db.order_items.filter((i) => i.order_id === 'demo-order-01').map((i) => i.service_name))
    expect(plan.sampleLeftOut).toEqual({ customers: 0, customer_packages: 0, orders: 0 })
    expect(plan.hasSample).toBe(true)
    expect(totalCount(plan.skipped)).toBe(0)
  })

  it('ids are new on every plan (a backup imported twice never collides with itself)', () => {
    const backup = parsed(demoDbWithOwnRows())
    const a = planDemoImport(backup, undefined, { includeSample: true })
    const b = planDemoImport(backup, undefined, { includeSample: true })
    const all = [...a.idMap.values(), ...b.idMap.values()]
    expect(new Set(all).size).toBe(all.length)
    for (const id of all) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('without the sample data: the price list, the own rows and the sample rows they use', () => {
    const plan = planDemoImport(parsed(demoDbWithOwnRows()), undefined, { newId: counter(), now: NOW })
    expect(plannedCounts(plan)).toEqual({ services: 6, package_catalog: 1, customers: 2, customer_packages: 1, orders: 2, order_items: 3, payments: 1 })
    expect(plan.tables.customers.map((c) => c.name)).toEqual(['Rina Putri', 'Pak Joko'])
    expect(plan.sampleLeftOut).toEqual({ customers: 11, customer_packages: 2, orders: 40 })
    expect(plan.hasSample).toBe(true)
    expectConsistent(plan)
    // the package item draws on the copied package of the copied customer, for the copied service
    const pkg = plan.tables.customer_packages[0]
    const item = plan.tables.order_items.find((i) => i.customer_package_id !== null)!
    expect(pkg).toMatchObject({ customer_id: plan.idMap.get(OWN.customer), service_id: plan.idMap.get(DEMO_SERVICE_ID.cuciSetrika), catalog_id: plan.idMap.get(DEMO_CATALOG_ID), qty_total: 20, price: 140_000 })
    expect(item).toMatchObject({ customer_package_id: pkg.id, service_id: pkg.service_id, unit_price: 0, line_total: 0, qty: 4.5 })
    expect(plan.tables.payments).toEqual([{ id: plan.idMap.get(OWN.payment), order_id: plan.idMap.get(OWN.order), amount: 10_000, paid_at: '2026-10-19', method: 'cash', notes: 'DP', created_at: '2026-10-19T02:00:00.000Z' }])
  })

  it('a sample package used by an own order comes along with its customer', () => {
    const db = demoDbWithOwnRows()
    db.order_items.push({ ...db.order_items.find((i) => i.id === OWN.rinaItem)!, id: '6a1d2c9e-0000-4000-8000-0000000000aa', order_id: OWN.order, customer_package_id: null })
    db.orders.push({ ...db.orders.find((o) => o.id === OWN.order)!, id: '6a1d2c9e-0000-4000-8000-0000000000ab', order_number: 'LD-202610-0101', customer_id: 'demo-cust-10' })
    db.order_items.push({ ...db.order_items.find((i) => i.id === OWN.item1)!, id: '6a1d2c9e-0000-4000-8000-0000000000ac', order_id: '6a1d2c9e-0000-4000-8000-0000000000ab', qty: 1, customer_package_id: 'demo-pkg-rudi' })
    const plan = planDemoImport(parsed(db), undefined, { newId: counter(), now: NOW })
    expect(plan.tables.customers.map((c) => c.name).sort()).toEqual(['Pak Joko', 'Rina Putri', 'Rudi Hartono'])
    expect(plan.tables.customer_packages).toHaveLength(2)
    expectConsistent(plan)
  })

  it('reuses what is already online: services by name and unit, catalog by name, customers by phone', () => {
    const backup = parsed(demoDbWithOwnRows())
    const online = {
      services: [
        { id: 'online-svc-setrika', name: ' cuci SETRIKA ', unit: 'kg' as const },
        { id: 'online-svc-bedcover-kg', name: 'Bed cover', unit: 'kg' as const },
      ],
      package_catalog: [{ id: 'online-pkg', name: 'Paket 20 KG cuci setrika', service_id: 'online-svc-setrika' }],
      customers: [
        { id: 'online-joko', phone: '+62 812 3456 0001' },
        { id: 'online-rina-1', phone: '0812-0000-0001' },
        { id: 'online-rina-2', phone: '62812 0000 0001' },
      ],
    }
    const plan = planDemoImport(backup, online, { newId: counter(), now: NOW })
    expect(plan.reused).toEqual({ services: 1, package_catalog: 1, customers: 1 })
    expect(plannedCounts(plan)).toMatchObject({ services: 5, package_catalog: 0, customers: 1 })
    // Rina's number is on two online customers: she is copied, not guessed
    expect(plan.tables.customers.map((c) => c.name)).toEqual(['Rina Putri'])
    expect(plan.idMap.get(DEMO_SERVICE_ID.cuciSetrika)).toBe('online-svc-setrika')
    expect(plan.idMap.get(OWN.customer)).toBe('online-joko')
    expect(plan.tables.customer_packages[0]).toMatchObject({ customer_id: 'online-joko', service_id: 'online-svc-setrika', catalog_id: 'online-pkg' })
    expect(plan.tables.orders.find((o) => o.order_number === 'LD-202610-0099')).toMatchObject({ customer_id: 'online-joko' })
    expectConsistent(plan, new Set(['online-svc-setrika', 'online-pkg', 'online-joko']))
  })

  it('skips rows the database would refuse, and the rows that depend on them', () => {
    const db = demoDbWithOwnRows()
    const bad = '6a1d2c9e-0000-4000-8000-0000000000b'
    db.orders.push({ ...db.orders.find((o) => o.id === OWN.order)!, id: `${bad}1`, order_number: 'LD-202610-0200', customer_id: 'gone' })
    db.order_items.push({ ...db.order_items.find((i) => i.id === OWN.item2)!, id: `${bad}2`, order_id: `${bad}1` })
    db.payments.push({ ...db.payments.find((p) => p.id === OWN.payment)!, id: `${bad}3`, order_id: `${bad}1` })
    // a line total that does not match qty x price, and a second payment above the order total
    db.order_items.push({ ...db.order_items.find((i) => i.id === OWN.item2)!, id: `${bad}4`, line_total: 1 })
    db.payments.push({ ...db.payments.find((p) => p.id === OWN.payment)!, id: `${bad}5`, amount: 20_000, paid_at: '2026-10-20' })
    db.customers.push({ ...db.customers.find((c) => c.id === OWN.customer)!, id: `${bad}6`, name: '   ' })
    const plan = planDemoImport(parsed(db), undefined, { newId: counter(), now: NOW })
    expect(plan.skipped).toEqual({ services: 0, package_catalog: 0, customers: 1, customer_packages: 0, orders: 1, order_items: 2, payments: 2 })
    expect(plannedCounts(plan)).toEqual({ services: 6, package_catalog: 1, customers: 2, customer_packages: 1, orders: 2, order_items: 3, payments: 1 })
    expectConsistent(plan)
  })

  it('never copies the demo organisation, its members or invitations; an online backup has no sample', () => {
    const db = demoDbWithOwnRows()
    db.invitations.push({ id: 'inv', org_id: DEMO_ORG_ID, label: 'Istri', email: null, role: 'staff', invited_by: null, expires_at: '2099-01-01T00:00:00Z', accepted_at: null, accepted_by: null, created_at: NOW.toISOString() })
    const plan = planDemoImport(parsed(db), undefined, { newId: counter(), now: NOW })
    expect(Object.keys(plan.tables)).toEqual([...DEMO_IMPORT_ORDER])
    expect(JSON.stringify(plan.tables)).not.toContain('local-user')
    expect(JSON.stringify(plan.tables)).not.toContain('Istri')
    // the same rows from an online organisation are all the owner's
    const online = JSON.parse(JSON.stringify(db)) as LocalDb
    online.organizations[0].id = 'b1f0c2aa-0000-4000-8000-000000000000'
    for (const table of DEMO_IMPORT_ORDER) for (const row of online[table]) (row as { org_id: string }).org_id = online.organizations[0].id
    const fromOnline = planDemoImport(parsed(online), undefined, { newId: counter(), now: NOW })
    expect(fromOnline.hasSample).toBe(false)
    expect(plannedCounts(fromOnline).orders).toBe(db.orders.length)
  })

  it('normalizeDemoRow writes every column, with defaults, and refuses what the database would', () => {
    expect(normalizeDemoRow('customers', { id: 'x', name: 'Mega', phone: '', extra: 1 })).toEqual({ name: 'Mega', phone: null, is_tenant: false, room_name: null, kos_tenant_id: null, address: null, notes: null })
    expect(normalizeDemoRow('services', { id: 's', name: 'Karpet', unit: 'm2', price: 1 })).toBeNull()
    expect(normalizeDemoRow('services', { id: 's', name: 'Karpet', unit: 'pcs', price: 1.5 })).toBeNull()
    expect(normalizeDemoRow('order_items', { id: 'i', order_id: 'o', service_name: 'Sepatu', unit: 'pcs', unit_price: 35_000, qty: 1.5, line_total: 52_500 })).toBeNull()
    expect(normalizeDemoRow('order_items', { id: 'i', order_id: 'o', service_name: 'Cuci', unit: 'kg', unit_price: 6_000, qty: 2.555, line_total: 15_360 })).toMatchObject({ qty: 2.56, line_total: 15_360, service_id: null })
    expect(normalizeDemoRow('payments', { id: 'p', order_id: 'o', amount: 0, paid_at: '2026-10-01' })).toBeNull()
    expect(normalizeDemoRow('orders', { id: 'o', order_number: 'LD-1', customer_id: 'c', received_at: '2026-10-01T00:00:00Z', status: 'hilang' })).toBeNull()
  })
})

describe('runDemoImport', () => {
  const ONLINE_ORG = 'b1f0c2aa-0000-4000-8000-0000000000ff'
  function onlineRepo() {
    const db = emptyLocalDb()
    db.organizations.push({ id: ONLINE_ORG, name: 'EG Laundry', created_by: 'u1', created_at: NOW.toISOString(), promo_template: null, wa_footer: null })
    const local = new LocalRepo(db)
    return { local, repo: bindOrg(local, ONLINE_ORG) }
  }

  it('inserts everything in an order the guards accept (packages, payment limits) and keeps the money right', async () => {
    const source = demoDbWithOwnRows()
    const plan = planDemoImport(parsed(source), undefined, { includeSample: true, now: NOW })
    const { local, repo } = onlineRepo()
    const progress: string[] = []
    const result = await runDemoImport(plan, (table, rows) => repo.insertMany(table, rows as never), { chunkSize: 25, onProgress: (p) => progress.push(`${p.table}:${p.done}/${p.total}`) })
    expect(result.error).toBeNull()
    expect(result.written).toEqual(plannedCounts(plan))
    expect(progress[0]).toBe(`services:0/${totalCount(result.written)}`)
    expect(progress.at(-1)).toBe(`payments:${totalCount(result.written)}/${totalCount(result.written)}`)

    const after = local.snapshot()
    for (const table of DEMO_IMPORT_ORDER) {
      expect(after[table]).toHaveLength(source[table].length)
      for (const row of after[table]) expect(row.org_id).toBe(ONLINE_ORG)
    }
    // the same money per order, and the same package balances
    for (const o of source.orders) {
      const copy = after.orders.find((x) => x.id === plan.idMap.get(o.id))!
      expect(orderTotals(copy, after.order_items, after.payments)).toEqual(orderTotals(o, source.order_items, source.payments))
    }
    for (const p of source.customer_packages) {
      const copy = after.customer_packages.find((x) => x.id === plan.idMap.get(p.id))!
      expect(packageRemaining(copy, after.order_items, after.orders)).toBe(packageRemaining(p, source.order_items, source.orders))
    }
    expect(demoImportMessage(result)).toBe(`Data Mode Demo dipindahkan: ${countsText(result.written)}.`)
  })

  it('stops at the first refused insert and says what is already online', async () => {
    const plan = planDemoImport(parsed(demoDbWithOwnRows()), undefined, { now: NOW })
    const calls: string[] = []
    const result = await runDemoImport(plan, async (table) => {
      calls.push(table)
      if (table === 'orders') throw new Error('Anda tidak memiliki izin untuk tindakan ini.')
    })
    expect(calls).toEqual(['services', 'package_catalog', 'customers', 'customer_packages', 'orders'])
    expect(result).toEqual({ written: { services: 6, package_catalog: 1, customers: 2, customer_packages: 1, orders: 0, order_items: 0, payments: 0 }, failedTable: 'orders', error: 'Anda tidak memiliki izin untuk tindakan ini.' })
    expect(demoImportMessage(result)).toBe(
      'Pemindahan berhenti saat menyimpan pesanan: Anda tidak memiliki izin untuk tindakan ini. Sudah tersimpan online: 6 layanan, 1 paket katalog, 2 pelanggan, 1 paket terjual. Data itu tidak dihapus otomatis; periksa daftar harga dan pelanggan sebelum mencoba lagi agar tidak dobel.',
    )
  })

  it('a refusal by the database guard on the first insert: nothing saved', async () => {
    const plan = planDemoImport(parsed(demoDbWithOwnRows()), undefined, { now: NOW })
    const result = await runDemoImport(plan, async () => Promise.reject(new Error(PAYMENT_EXCEEDS_TOTAL_MESSAGE)))
    expect(result.failedTable).toBe('services')
    expect(demoImportMessage(result)).toBe('Pemindahan berhenti saat menyimpan layanan: Pembayaran melebihi total pesanan. Belum ada data yang tersimpan online.')
  })
})
