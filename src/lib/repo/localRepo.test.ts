// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { LocalRepo, STORAGE_KEY, emptyLocalDb } from './localRepo'
import {
  CANCEL_STATUS_MESSAGE,
  CANCEL_WITH_PAYMENTS_MESSAGE,
  DELETE_DENIED_MESSAGE,
  IN_USE_MESSAGE,
  PACKAGE_EXPIRED_MESSAGE,
  PACKAGE_INSUFFICIENT_MESSAGE,
  PACKAGE_OTHER_CUSTOMER_MESSAGE,
  PACKAGE_OTHER_SERVICE_MESSAGE,
  PAYMENT_EXCEEDS_TOTAL_MESSAGE,
  UPDATE_DENIED_MESSAGE,
  bindOrg,
} from './types'
import { buildDemoDb, DEMO_CATALOG_ID, DEMO_ORG_ID, DEMO_SERVICE_ID } from './demoSeed'
import { packageRemaining } from '../../domain/pricing'

async function setup() {
  const repo = new LocalRepo(emptyLocalDb())
  const invitation = (id: string) => ({
    id,
    org_id: 'o1',
    label: id,
    email: null,
    role: 'staff' as const,
    invited_by: null,
    expires_at: '2099-12-31T00:00:00.000Z',
    accepted_at: null,
    accepted_by: null,
  })
  await repo.insertMany('invitations', [invitation('inv-a'), invitation('inv-b')])
  return repo
}

describe('LocalRepo mirrors the database', () => {
  afterEach(() => localStorage.clear())

  it('update/remove of a missing row (or another organisation) is an error, never a silent no-op', async () => {
    const repo = await setup()
    await expect(repo.update('invitations', 'nope', { label: 'x' })).rejects.toThrow(UPDATE_DENIED_MESSAGE)
    await expect(repo.remove('invitations', 'nope')).rejects.toThrow(DELETE_DENIED_MESSAGE)
    await expect(repo.remove('invitations', 'inv-a', 'other-org')).rejects.toThrow(DELETE_DENIED_MESSAGE)
    await repo.remove('invitations', 'inv-a', 'o1')
    expect(await repo.get('invitations', 'inv-a')).toBeNull()
    await expect(repo.remove('invitations', 'inv-a', 'o1')).rejects.toThrow(DELETE_DENIED_MESSAGE)
  })

  it('lists with filters, order and limit, and never hands out its own row objects', async () => {
    const repo = await setup()
    const rows = await repo.list('invitations', { where: { org_id: 'o1' }, orderBy: { column: 'label', ascending: true }, limit: 1 })
    expect(rows.map((r) => r.id)).toEqual(['inv-a'])
    rows[0].label = 'changed outside'
    expect((await repo.get('invitations', 'inv-a'))?.label).toBe('inv-a')
    expect(await repo.list('invitations', { where: { id: ['inv-a', 'inv-b'] } })).toHaveLength(2)
  })

  it('fills in columns added after a row was stored (like a migration)', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        invitations: [{ id: 'old', org_id: 'o1', email: null, role: 'staff', invited_by: null, accepted_at: null, created_at: 'x' }],
        organizations: [{ id: 'o1', name: 'Lama', created_by: 'u', created_at: 'x' }],
      }),
    )
    const repo = new LocalRepo()
    expect(await repo.get('invitations', 'old')).toMatchObject({ label: null, accepted_by: null, expires_at: '2099-12-31T00:00:00.000Z' })
    expect(await repo.get('organizations', 'o1')).toMatchObject({ promo_template: null, wa_footer: null })
  })
})

/** The demo data through an org-bound repo, like the app sees it. */
function demo() {
  const db = buildDemoDb(new Date(2026, 9, 19))
  const repo = bindOrg(new LocalRepo(db), DEMO_ORG_ID)
  const order = db.orders.find((o) => o.status === 'received' && !db.payments.some((p) => p.order_id === o.id))!
  const paidOrder = db.orders.find((o) => o.status === 'done' && db.payments.some((p) => p.order_id === o.id))!
  const pkg = db.customer_packages[0]
  return { db, repo, order, paidOrder, pkg }
}

describe('LocalRepo mirrors the laundry schema (delete rules)', () => {
  afterEach(() => localStorage.clear())

  it('deleting an order takes its items and payments along (cascade) and frees the package qty', async () => {
    const { db, repo, paidOrder, pkg } = demo()
    const pkgOrder = db.orders.find((o) => db.order_items.some((i) => i.order_id === o.id && i.customer_package_id === pkg.id))!
    const before = packageRemaining(pkg, await repo.list('order_items'), await repo.list('orders'))
    await repo.remove('orders', paidOrder.id)
    expect(await repo.list('order_items', { where: { order_id: paidOrder.id } })).toEqual([])
    expect(await repo.list('payments', { where: { order_id: paidOrder.id } })).toEqual([])
    await repo.remove('orders', pkgOrder.id)
    expect(packageRemaining(pkg, await repo.list('order_items'), await repo.list('orders'))).toBeGreaterThan(before)
  })

  it('a customer, service or package that is still used cannot be deleted (restrict)', async () => {
    const { db, repo, pkg } = demo()
    await expect(repo.remove('customers', db.orders[0].customer_id)).rejects.toThrow(IN_USE_MESSAGE)
    await expect(repo.remove('services', DEMO_SERVICE_ID.cuciSetrika)).rejects.toThrow(IN_USE_MESSAGE)
    await expect(repo.remove('customer_packages', pkg.id)).rejects.toThrow(IN_USE_MESSAGE)
    const unused = await repo.insert('customers', { name: 'Baru', phone: null, is_tenant: false, room_name: null, kos_tenant_id: null, address: null, notes: null })
    await repo.remove('customers', unused.id)
    expect(await repo.get('customers', unused.id)).toBeNull()
  })

  it('deleting a service or a catalog entry clears the references (set null)', async () => {
    const { repo } = demo()
    await repo.remove('services', DEMO_SERVICE_ID.sepatu)
    const items = await repo.list('order_items', { where: { service_name: 'Sepatu' } })
    expect(items.length).toBeGreaterThan(0)
    for (const it of items) expect(it.service_id).toBeNull()
    await repo.remove('package_catalog', DEMO_CATALOG_ID)
    for (const p of await repo.list('customer_packages')) expect(p.catalog_id).toBeNull()
  })
})

describe('LocalRepo mirrors the laundry schema (guards)', () => {
  afterEach(() => localStorage.clear())

  it('orders_cancel_guard: only Diterima/Proses, and only without payments', async () => {
    const { repo, order, paidOrder } = demo()
    await expect(repo.update('orders', paidOrder.id, { status: 'cancelled' })).rejects.toThrow(CANCEL_STATUS_MESSAGE)
    const readyPaid = (await repo.list('orders', { where: { status: 'ready' } })).find((o) => o.id !== order.id)!
    await expect(repo.update('orders', readyPaid.id, { status: 'cancelled' })).rejects.toThrow(CANCEL_STATUS_MESSAGE)
    await repo.insert('payments', { order_id: order.id, amount: 1_000, paid_at: '2026-10-19', method: 'cash', notes: null })
    await expect(repo.update('orders', order.id, { status: 'cancelled' })).rejects.toThrow(CANCEL_WITH_PAYMENTS_MESSAGE)
    const [p] = await repo.list('payments', { where: { order_id: order.id } })
    await repo.remove('payments', p.id)
    expect((await repo.update('orders', order.id, { status: 'cancelled' })).status).toBe('cancelled')
  })

  it('payments_limit: payments, discounts and item edits never leave an order paid above its total', async () => {
    const { repo, order } = demo()
    const items = await repo.list('order_items', { where: { order_id: order.id } })
    const total = items.reduce((s, i) => s + i.line_total, 0)
    await expect(repo.insert('payments', { order_id: order.id, amount: total + 1, paid_at: '2026-10-19', method: 'cash', notes: null })).rejects.toThrow(PAYMENT_EXCEEDS_TOTAL_MESSAGE)
    expect(await repo.list('payments', { where: { order_id: order.id } })).toEqual([])
    const dp = await repo.insert('payments', { order_id: order.id, amount: total - 1_000, paid_at: '2026-10-19', method: 'qris', notes: 'DP' })
    await expect(repo.insert('payments', { order_id: order.id, amount: 1_001, paid_at: '2026-10-19', method: 'cash', notes: null })).rejects.toThrow(PAYMENT_EXCEEDS_TOTAL_MESSAGE)
    await repo.insert('payments', { order_id: order.id, amount: 1_000, paid_at: '2026-10-19', method: 'cash', notes: null })
    await expect(repo.update('payments', dp.id, { amount: total })).rejects.toThrow(PAYMENT_EXCEEDS_TOTAL_MESSAGE)
    await expect(repo.update('orders', order.id, { discount: 500 })).rejects.toThrow(PAYMENT_EXCEEDS_TOTAL_MESSAGE)
    await expect(repo.update('order_items', items[0].id, { qty: items[0].qty - 0.5, line_total: items[0].line_total - 1 })).rejects.toThrow(PAYMENT_EXCEEDS_TOTAL_MESSAGE)
    await expect(repo.remove('order_items', items[0].id)).rejects.toThrow(PAYMENT_EXCEEDS_TOTAL_MESSAGE)
    // raising the total is always fine
    await repo.update('order_items', items[0].id, { qty: items[0].qty + 1, line_total: items[0].line_total + items[0].unit_price })
    await repo.update('orders', order.id, { discount: 500 })
  })

  it('package_use_guard: same customer, same service, not expired, within the remaining qty', async () => {
    const { db, repo, pkg } = demo()
    const remaining = packageRemaining(pkg, db.order_items, db.orders)
    const other = db.customers.find((c) => c.id !== pkg.customer_id)!
    const mkOrder = (customer_id: string, received_at: string) =>
      repo.insert('orders', { order_number: `LD-${received_at.slice(0, 7).replace('-', '')}-9${received_at.slice(8)}`, customer_id, received_at, promised_at: null, express: false, status: 'received', ready_at: null, picked_up_at: null, discount: 0, notes: null })
    const pkgItem = (order_id: string, qty: number, service_id = pkg.service_id) =>
      repo.insert('order_items', { order_id, service_id, service_name: 'Cuci setrika', unit: 'kg', unit_price: 0, qty, line_total: 0, customer_package_id: pkg.id, notes: null })
    const own = await mkOrder(pkg.customer_id, '2026-10-19')
    const theirs = await mkOrder(other.id, '2026-10-19')
    const late = await mkOrder(pkg.customer_id, '2027-01-01')
    await expect(pkgItem(theirs.id, 1)).rejects.toThrow(PACKAGE_OTHER_CUSTOMER_MESSAGE)
    await expect(pkgItem(own.id, 1, DEMO_SERVICE_ID.cuciKering)).rejects.toThrow(PACKAGE_OTHER_SERVICE_MESSAGE)
    await expect(pkgItem(late.id, 1)).rejects.toThrow(PACKAGE_EXPIRED_MESSAGE)
    await expect(pkgItem(own.id, remaining + 0.5)).rejects.toThrow(PACKAGE_INSUFFICIENT_MESSAGE)
    const it = await pkgItem(own.id, remaining)
    expect(packageRemaining(pkg, await repo.list('order_items'), await repo.list('orders'))).toBe(0)
    await expect(repo.update('order_items', it.id, { qty: remaining + 1 })).rejects.toThrow(PACKAGE_INSUFFICIENT_MESSAGE)
    await repo.update('order_items', it.id, { qty: remaining - 1 })
    expect(packageRemaining(pkg, await repo.list('order_items'), await repo.list('orders'))).toBe(1)
  })
})

describe('LocalRepo shared by two copies of the app on one device', () => {
  afterEach(() => localStorage.clear())

  const order = (id: string, number: string) => ({
    id,
    org_id: DEMO_ORG_ID,
    order_number: number,
    customer_id: 'demo-cust-01',
    received_at: '2026-10-19',
    promised_at: null,
    express: false,
    status: 'received' as const,
    ready_at: null,
    picked_up_at: null,
    discount: 0,
    notes: null,
  })

  /** The installed PWA and a browser tab: each loaded the same stored data once. */
  function twoCopies() {
    new LocalRepo().replaceAll(buildDemoDb(new Date(2026, 9, 19)))
    return { pwa: new LocalRepo(), tab: new LocalRepo() }
  }

  it('a write in one copy keeps what the other copy saved meanwhile', async () => {
    const { pwa, tab } = twoCopies()
    // the tab records an order with a DP
    await tab.insert('orders', order('tab-order', 'LD-202610-0999'))
    await tab.insert('order_items', {
      org_id: DEMO_ORG_ID, order_id: 'tab-order', service_id: DEMO_SERVICE_ID.cuciSetrika, service_name: 'Cuci setrika', unit: 'kg', unit_price: 8_000, qty: 2, line_total: 16_000, customer_package_id: null, notes: null,
    })
    await tab.insert('payments', { id: 'tab-dp', org_id: DEMO_ORG_ID, order_id: 'tab-order', amount: 10_000, paid_at: '2026-10-19', method: 'cash', notes: 'DP', created_by: null })
    // the PWA, still holding what it loaded at start, changes another order and records one
    const [other] = (await pwa.list('orders')).filter((o) => o.id !== 'tab-order')
    await pwa.update('orders', other.id, { notes: 'dari PWA' })
    await pwa.insert('orders', order('pwa-order', 'LD-202610-0998'))

    const stored = new LocalRepo()
    expect(await stored.get('orders', 'tab-order')).not.toBeNull()
    expect(await stored.get('payments', 'tab-dp')).toMatchObject({ amount: 10_000 })
    expect(await stored.get('orders', 'pwa-order')).not.toBeNull()
    expect((await stored.get('orders', other.id))?.notes).toBe('dari PWA')
    // and the guards see the other copy's rows
    expect(await pwa.get('orders', 'tab-order')).not.toBeNull()
    await pwa.remove('orders', 'tab-order')
    expect(await new LocalRepo().get('orders', 'tab-order')).toBeNull()
  })

  it('a restore (replaceAll) in one copy is not overwritten by the next write in the other', async () => {
    const { pwa, tab } = twoCopies()
    const restored = buildDemoDb(new Date(2026, 9, 19))
    restored.orders = restored.orders.slice(0, 3)
    restored.order_items = restored.order_items.filter((i) => restored.orders.some((o) => o.id === i.order_id))
    restored.payments = restored.payments.filter((p) => restored.orders.some((o) => o.id === p.order_id))
    tab.replaceAll(restored)
    await pwa.update('customers', 'demo-cust-01', { notes: 'x' })
    expect(await new LocalRepo().list('orders')).toHaveLength(3)
  })

  it('the storage event of another copy reloads this one and tells the screens', async () => {
    const { pwa, tab } = twoCopies()
    let changes = 0
    const stop = pwa.watchOtherCopies(() => changes++)
    await tab.insert('orders', order('tab-order', 'LD-202610-0999'))
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    expect(changes).toBe(1)
    expect(await pwa.get('orders', 'tab-order')).not.toBeNull()
    window.dispatchEvent(new StorageEvent('storage', { key: 'eglaundry.lamaTidakDatang' }))
    expect(changes).toBe(1)
    stop()
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }))
    expect(changes).toBe(1)
  })

  it('an instance given its own data stays in memory (tests, previews)', async () => {
    new LocalRepo().replaceAll(buildDemoDb(new Date(2026, 9, 19)))
    const memory = new LocalRepo(emptyLocalDb())
    await memory.insert('organizations', { id: 'o-mem', name: 'Memori', created_by: 'u', promo_template: null, wa_footer: null })
    expect(await memory.list('orders')).toHaveLength(0)
  })
})
