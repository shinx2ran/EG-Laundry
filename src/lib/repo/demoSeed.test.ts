import { describe, expect, it } from 'vitest'
import { buildDemoDb, DEMO_ORG_ID } from './demoSeed'
import { isOrderLate, lineTotal, nextOrderNumber, orderTotals, packageProblem, packageRemaining, validateOrderDraft } from '../../domain/pricing'
import { normalizePhone, todayISO } from '../format'
import { LAUNDRY_TABLES } from '../../types/db'

const TODAY = new Date(2026, 9, 19, 14, 30)

describe('demo data (SPEC 3.11)', () => {
  const db = buildDemoDb(TODAY)
  const today = todayISO(TODAY)
  const live = db.orders.filter((o) => o.status !== 'cancelled')

  it('has the price list, the package on offer, 12 customers and about 40 orders', () => {
    expect(db.services.map((s) => `${s.name} ${s.price}/${s.unit}${s.price_express ? ` express ${s.price_express}` : ''}`)).toEqual([
      'Cuci kering 6000/kg express 10000',
      'Cuci setrika 8000/kg express 13000',
      'Setrika saja 5000/kg',
      'Bed cover 25000/pcs',
      'Selimut 20000/pcs',
      'Sepatu 35000/pcs',
    ])
    expect(db.services.find((s) => s.name === 'Cuci kering')).toMatchObject({ days_regular: 3, days_express: 1 })
    expect(db.package_catalog).toHaveLength(1)
    expect(db.package_catalog[0]).toMatchObject({ name: 'Paket 20 kg cuci setrika', qty: 20, price: 140_000, valid_days: 60 })
    expect(db.customers).toHaveLength(12)
    expect(db.customers.filter((c) => c.is_tenant && c.room_name)).toHaveLength(5)
    expect(db.customers.filter((c) => !c.is_tenant)).toHaveLength(7)
    expect(db.customers.filter((c) => c.phone === null)).toHaveLength(2)
    expect(db.orders.length).toBeGreaterThanOrEqual(38)
    expect(db.orders.length).toBeLessThanOrEqual(42)
    for (const t of LAUNDRY_TABLES) expect(db[t].length, t).toBeGreaterThan(0)
    for (const t of LAUNDRY_TABLES) for (const r of db[t]) expect(r.org_id).toBe(DEMO_ORG_ID)
    expect(db.organizations[0].promo_template).toContain('{nama}')
    expect(db.organizations[0].wa_footer).toBeTruthy()
  })

  it('uses only 0812-0000-xxxx phone numbers, all different', () => {
    const phones = db.customers.map((c) => c.phone).filter((p): p is string => p !== null)
    for (const p of phones) expect(p).toMatch(/^0812-0000-\d{4}$/)
    expect(new Set(phones.map(normalizePhone)).size).toBe(phones.length)
  })

  it('covers the two months before today with every status: 2 late, 3 ready, 4 not fully paid, 1 cancelled', () => {
    for (const o of db.orders) {
      expect(o.received_at <= today).toBe(true)
      expect(o.received_at >= '2026-08-19').toBe(true)
    }
    expect(db.orders.filter((o) => o.received_at === today).length).toBeGreaterThan(0)
    expect(db.orders.filter((o) => isOrderLate(o, today))).toHaveLength(2)
    expect(db.orders.filter((o) => o.status === 'ready')).toHaveLength(3)
    expect(live.filter((o) => orderTotals(o, db.order_items, db.payments).outstanding > 0)).toHaveLength(4)
    expect(db.orders.filter((o) => o.status === 'cancelled')).toHaveLength(1)
    expect(db.orders.filter((o) => o.status === 'done').length).toBeGreaterThan(25)
    expect(db.orders.some((o) => o.express)).toBe(true)
    expect(new Set(db.payments.map((p) => p.method))).toEqual(new Set(['cash', 'transfer', 'qris']))
    // status timestamps match the status
    for (const o of db.orders) {
      expect(o.ready_at !== null, o.id).toBe(o.status === 'ready' || o.status === 'done')
      expect(o.picked_up_at !== null, o.id).toBe(o.status === 'done')
    }
  })

  it('never puts ready / pickup times or payments in the future, and keeps them in order', () => {
    const check = (seedClock: Date) => {
      const d = buildDemoDb(seedClock)
      const now = seedClock.toISOString()
      const day = todayISO(seedClock)
      for (const o of d.orders) {
        if (o.ready_at) {
          expect(o.ready_at <= now, `${o.id} ready_at ${o.ready_at}`).toBe(true)
          expect(o.ready_at >= o.created_at, o.id).toBe(true)
        }
        if (o.picked_up_at) {
          expect(o.picked_up_at <= now, `${o.id} picked_up_at ${o.picked_up_at}`).toBe(true)
          expect(o.picked_up_at >= o.ready_at!, o.id).toBe(true)
        }
      }
      for (const p of d.payments) expect(p.paid_at <= day, p.id).toBe(true)
      for (const k of d.customer_packages) expect(k.purchased_at <= day, k.id).toBe(true)
      return d
    }
    // ready orders were promised for tomorrow: they are ready today, at 09:00 once that has passed
    const ready = check(TODAY).orders.filter((o) => o.status === 'ready')
    expect(ready).toHaveLength(3)
    for (const o of ready) expect(o.ready_at).toBe(new Date(2026, 9, 19, 9).toISOString())
    // built just after midnight: nothing is later than the clock
    const early = check(new Date(2026, 9, 19, 0, 5))
    for (const o of early.orders.filter((x) => x.status === 'ready')) expect(o.ready_at).toBe(new Date(2026, 9, 19, 0, 5).toISOString())
    check(new Date(2026, 9, 19, 23, 59))
  })

  it('numbers orders LD-YYYYMM-NNNN in order of receipt, without gaps or duplicates', () => {
    expect(new Set(db.orders.map((o) => o.order_number)).size).toBe(db.orders.length)
    const chronological = [...db.orders].sort((a, b) => a.created_at.localeCompare(b.created_at))
    const seen: string[] = []
    for (const o of chronological) {
      expect(o.order_number).toBe(nextOrderNumber(seen, o.received_at))
      seen.push(o.order_number)
    }
  })

  it('keeps every money and package invariant the database enforces', () => {
    const serviceById = new Map(db.services.map((s) => [s.id, s]))
    for (const it of db.order_items) {
      expect(it.line_total, it.id).toBe(lineTotal(it.qty, it.unit_price))
      expect(it.qty).toBeGreaterThan(0)
      if (it.unit === 'pcs') expect(Number.isInteger(it.qty)).toBe(true)
      if (it.customer_package_id) expect(it.unit_price).toBe(0)
      const service = serviceById.get(it.service_id ?? '')!
      expect(it).toMatchObject({ service_name: service.name, unit: service.unit })
      expect(it.qty).toBeGreaterThanOrEqual(service.min_qty)
    }
    for (const o of db.orders) {
      const t = orderTotals(o, db.order_items, db.payments)
      expect(t.paid, o.order_number).toBeLessThanOrEqual(t.total)
      expect(o.discount).toBeGreaterThanOrEqual(0)
      expect(o.discount).toBeLessThanOrEqual(t.subtotal)
      if (o.status === 'cancelled') expect(t.paid).toBe(0)
      expect(db.order_items.some((it) => it.order_id === o.id), o.order_number).toBe(true)
    }
    for (const p of db.payments) {
      expect(p.amount).toBeGreaterThan(0)
      expect(db.orders.some((o) => o.id === p.order_id)).toBe(true)
    }
    expect(db.customer_packages).toHaveLength(2)
    for (const pkg of db.customer_packages) {
      const remaining = packageRemaining(pkg, db.order_items, db.orders)
      expect(remaining).toBeGreaterThanOrEqual(0)
      expect(remaining, pkg.id).toBeLessThan(pkg.qty_total)
      expect(pkg.expires_at! > today).toBe(true)
      for (const it of db.order_items.filter((i) => i.customer_package_id === pkg.id)) {
        const o = db.orders.find((x) => x.id === it.order_id)!
        expect(packageProblem(pkg, o.customer_id, it.service_id!, o.received_at)).toBeNull()
      }
    }
  })

  it('every order would pass the order form validation as a draft', () => {
    for (const o of db.orders) {
      const items = db.order_items.filter((i) => i.order_id === o.id)
      const errors = validateOrderDraft(
        {
          customer_id: o.customer_id,
          received_at: o.received_at,
          express: o.express,
          discount: o.discount,
          items: items.map((i) => ({ service_id: i.service_id!, qty: i.qty, customer_package_id: i.customer_package_id })),
          payment: db.payments.filter((p) => p.order_id === o.id).reduce((s, p) => s + p.amount, 0),
        },
        { services: db.services, packages: db.customer_packages, orderItems: db.order_items, orders: db.orders, excludeOrderId: o.id },
      )
      expect(errors, o.order_number).toEqual([])
    }
  })

  it('is the same for the same clock and moves with it', () => {
    expect(buildDemoDb(TODAY)).toEqual(db)
    const later = buildDemoDb(new Date(2026, 10, 2))
    expect(later.orders.filter((o) => o.received_at === '2026-11-02').length).toBe(db.orders.filter((o) => o.received_at === today).length)
    expect(later.orders.map((o) => o.order_number)).not.toEqual(db.orders.map((o) => o.order_number))
  })
})
