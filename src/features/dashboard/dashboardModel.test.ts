import { describe, expect, it } from 'vitest'
import type { Customer, CustomerPackage, Order, OrderItem, OrderStatus, Payment, PaymentMethod } from '../../types/db'
import { buildDemoDb } from '../../lib/repo/demoSeed'
import {
  SERIES_DAYS,
  UNPAID_TOP,
  buildDashboard,
  dayLabel,
  firstRunSteps,
  inProgressLink,
  intakeOn,
  intakeText,
  lateText,
  localDay,
  orderLink,
  readyDaysWaiting,
  waitingText,
  type DashboardSource,
} from './dashboardModel'

const TODAY = '2026-10-19' // a Monday
const ts = '2026-10-01T00:00:00.000Z'

/** A timestamp at `hour` local time on `date`, the way the app writes ready_at (new Date().toISOString()). */
function localTs(date: string, hour: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, hour).toISOString()
}

function customer(id: string, name: string, phone: string | null = null): Customer {
  return { id, org_id: 'o', name, phone, is_tenant: false, room_name: null, kos_tenant_id: null, address: null, notes: null, created_at: ts, updated_at: ts }
}

function order(id: string, o: Partial<Order> & { status: OrderStatus; received_at: string }): Order {
  return {
    id,
    org_id: 'o',
    order_number: `LD-202610-${id.padStart(4, '0')}`,
    customer_id: 'c1',
    promised_at: null,
    express: false,
    ready_at: null,
    picked_up_at: null,
    discount: 0,
    notes: null,
    created_at: ts,
    updated_at: ts,
    ...o,
  }
}

function item(orderId: string, n: number, service_name: string, unit: 'kg' | 'pcs', qty: number, unit_price: number): OrderItem {
  return {
    id: `${orderId}-${n}`, org_id: 'o', order_id: orderId, service_id: null, service_name, unit, unit_price, qty,
    line_total: Math.round(qty * unit_price), customer_package_id: null, notes: null, created_at: ts, updated_at: ts,
  }
}

function payment(orderId: string, amount: number, paid_at: string, method: PaymentMethod = 'cash'): Payment {
  return { id: `${orderId}-p-${paid_at}-${amount}`, org_id: 'o', order_id: orderId, amount, paid_at, method, notes: null, created_by: null, created_at: ts, updated_at: ts }
}

function pkg(price: number, purchased_at: string, method: PaymentMethod): Pick<CustomerPackage, 'price' | 'purchased_at' | 'method'> {
  return { price, purchased_at, method }
}

function source(partial: Partial<DashboardSource>): DashboardSource {
  return { orders: [], orderItems: [], payments: [], customerPackages: [], customers: [customer('c1', 'Rina'), customer('c2', 'Dimas', '0812-0000-0002')], ...partial }
}

describe('masuk hari ini', () => {
  it('counts today’s orders that are not cancelled: kg, pcs and their totals after discount', () => {
    const orders = [
      order('1', { status: 'received', received_at: TODAY, discount: 2_000 }),
      order('2', { status: 'ready', received_at: TODAY }),
      order('3', { status: 'cancelled', received_at: TODAY }),
      order('4', { status: 'received', received_at: '2026-10-18' }),
    ]
    const items = [
      item('1', 1, 'Cuci setrika', 'kg', 2.5, 8_000),
      item('1', 2, 'Bed cover', 'pcs', 1, 25_000),
      item('2', 1, 'Cuci kering', 'kg', 0.15, 6_000),
      item('3', 1, 'Cuci kering', 'kg', 9, 6_000),
      item('4', 1, 'Sepatu', 'pcs', 2, 35_000),
    ]
    const intake = intakeOn(TODAY, orders, items, [])
    expect(intake).toEqual({ count: 2, kg: 2.65, pcs: 1, value: 20_000 + 25_000 - 2_000 + 900 })
    expect(intakeText(intake)).toBe('2,65 kg · 1 pcs · Rp 43.900')
    expect(intakeText({ count: 0, kg: 0, pcs: 0, value: 0 })).toBe('Rp 0')
  })
})

describe('buildDashboard', () => {
  const orders = [
    // late: promised two days ago, still Proses; unpaid
    order('1', { status: 'processing', received_at: '2026-10-14', promised_at: '2026-10-17', customer_id: 'c1' }),
    // late: promised yesterday, still Diterima; paid
    order('2', { status: 'received', received_at: '2026-10-15', promised_at: '2026-10-18', customer_id: 'c2' }),
    // due today: not late yet
    order('3', { status: 'received', received_at: TODAY, promised_at: TODAY }),
    // ready since three days, partly paid
    order('4', { status: 'ready', received_at: '2026-10-14', promised_at: '2026-10-16', ready_at: localTs('2026-10-16', 15), customer_id: 'c2' }),
    // ready today, paid
    order('5', { status: 'ready', received_at: '2026-10-18', promised_at: '2026-10-19', ready_at: localTs(TODAY, 8) }),
    // ready "tomorrow" (a clock that was ahead): waiting 0, not negative
    order('6', { status: 'ready', received_at: '2026-10-18', promised_at: '2026-10-20', ready_at: localTs('2026-10-20', 9) }),
    // overdue promise but cancelled: neither late nor owed
    order('7', { status: 'cancelled', received_at: '2026-10-01', promised_at: '2026-10-03' }),
    // done but not paid in full: still piutang
    order('8', { status: 'done', received_at: '2026-10-02', promised_at: '2026-10-05', ready_at: localTs('2026-10-05', 9), picked_up_at: localTs('2026-10-06', 9) }),
  ]
  const items = [
    item('1', 1, 'Cuci setrika', 'kg', 6, 8_000), // 48.000
    item('2', 1, 'Bed cover', 'pcs', 2, 25_000), // 50.000
    item('3', 1, 'Cuci kering', 'kg', 3, 6_000), // 18.000
    item('4', 1, 'Cuci setrika', 'kg', 4, 8_000), // 32.000
    item('4', 2, 'Selimut', 'pcs', 1, 20_000), // 20.000
    item('5', 1, 'Setrika saja', 'kg', 3, 5_000), // 15.000
    item('6', 1, 'Sepatu', 'pcs', 1, 35_000), // 35.000
    item('7', 1, 'Cuci kering', 'kg', 2, 6_000), // 12.000
    item('8', 1, 'Cuci kering', 'kg', 5, 6_000), // 30.000
  ]
  const payments = [
    payment('2', 50_000, '2026-10-15', 'cash'),
    payment('4', 12_000, TODAY, 'transfer'),
    payment('5', 15_000, TODAY, 'qris'),
    payment('8', 10_000, '2026-10-06', 'cash'),
  ]
  const model = buildDashboard(source({ orders, orderItems: items, payments, customerPackages: [pkg(140_000, TODAY, 'cash')] }), TODAY)

  it('in progress = Diterima + Proses (cancelled and ready ones left out)', () => {
    expect(model.inProgress).toEqual({ count: 3, received: 2, processing: 1 })
  })

  it('late = promised day passed and not ready yet, most overdue first', () => {
    expect(model.late.map((e) => [e.order.id, e.daysLate])).toEqual([
      ['1', 2],
      ['2', 1],
    ])
    expect(model.late[0].customer?.name).toBe('Rina')
    expect(lateText(model.late[0])).toBe('Janji 17 Okt 2026 · terlambat 2 hari')
  })

  it('ready: longest waiting first, with what is still owed and the items', () => {
    expect(model.ready.map((e) => [e.order.id, e.daysWaiting, e.totals.outstanding])).toEqual([
      ['4', 3, 40_000],
      ['5', 0, 0],
      ['6', 0, 35_000],
    ])
    expect(model.ready[0].itemsText).toBe('Cuci setrika 4 kg, Selimut 1 pcs')
    expect(model.ready[0].customer?.name).toBe('Dimas')
  })

  it('belum bayar = outstanding of every order that is not cancelled (done ones too), largest first', () => {
    // 1: 48.000, 3: 18.000, 4: 40.000, 6: 35.000, 8: 20.000; 2 and 5 are paid, 7 is cancelled
    expect(model.unpaid.count).toBe(5)
    expect(model.unpaid.amount).toBe(48_000 + 18_000 + 40_000 + 35_000 + 20_000)
    expect(model.unpaid.top.map((e) => e.order.id)).toEqual(['1', '4', '6', '8', '3'])
  })

  it('lists at most five unpaid orders; ties: the oldest first', () => {
    const many = Array.from({ length: 8 }, (_, i) => order(String(i + 1), { status: 'received', received_at: `2026-10-1${8 - (i % 3)}` }))
    const manyItems = many.map((o) => item(o.id, 1, 'Cuci kering', 'kg', 2, 6_000))
    const m = buildDashboard(source({ orders: many, orderItems: manyItems }), TODAY)
    expect(m.unpaid.count).toBe(8)
    expect(m.unpaid.amount).toBe(8 * 12_000)
    expect(m.unpaid.top).toHaveLength(UNPAID_TOP)
    expect(m.unpaid.top.map((e) => e.order.received_at)).toEqual(['2026-10-16', '2026-10-16', '2026-10-17', '2026-10-17', '2026-10-17'])
  })

  it('uang masuk today: payments dated today + packages bought today, by method', () => {
    expect(model.moneyToday).toEqual({ date: TODAY, total: 167_000, byMethod: { cash: 140_000, transfer: 12_000, qris: 15_000 }, packages: 140_000 })
    expect(model.moneySeries).toHaveLength(SERIES_DAYS)
    expect(model.moneySeries[SERIES_DAYS - 1]).toBe(model.moneyToday)
    expect(model.moneySeries.map((d) => d.total)).toEqual([0, 0, 50_000, 0, 0, 0, 167_000])
  })

  it('masuk hari ini and the empty laundry', () => {
    expect(model.intake).toEqual({ count: 1, kg: 3, pcs: 0, value: 18_000 })
    expect(model.isEmpty).toBe(false)
    const empty = buildDashboard(source({}), TODAY)
    expect(empty.isEmpty).toBe(true)
    expect(empty.intake).toEqual({ count: 0, kg: 0, pcs: 0, value: 0 })
    expect(empty.unpaid).toEqual({ count: 0, amount: 0, top: [] })
    expect(empty.ready).toEqual([])
    expect(empty.late).toEqual([])
    expect(empty.moneyToday.total).toBe(0)
  })

  it('an order whose customer was not loaded still shows (customer undefined)', () => {
    const m = buildDashboard(source({ orders: [order('1', { status: 'ready', received_at: TODAY, customer_id: 'gone' })] }), TODAY)
    expect(m.ready[0].customer).toBeUndefined()
    expect(m.ready[0].itemsText).toBe('')
  })
})

describe('the demo seed (SPEC 3.11) on Monday 19 Oct 2026', () => {
  const db = buildDemoDb(new Date(2026, 9, 19, 10))
  const model = buildDashboard({ orders: db.orders, orderItems: db.order_items, payments: db.payments, customerPackages: db.customer_packages, customers: db.customers }, TODAY)
  const name = (e: { customer: Customer | undefined }) => e.customer?.name

  it('matches the numbers the e2e test expects', () => {
    // Rina 3 kg cuci setrika (24.000) + Pak Hendra 4,5 kg cuci kering express (45.000)
    expect(model.intake).toEqual({ count: 2, kg: 7.5, pcs: 0, value: 69_000 })
    expect(model.inProgress).toEqual({ count: 5, received: 3, processing: 2 })
    expect(model.late.map((e) => [name(e), e.daysLate])).toEqual([
      ['Lusi Anggraini', 3],
      ['Yoga Pratama', 2],
    ])
    expect(model.ready.map(name).sort()).toEqual(['Andi Wijaya', 'Bu Wati', 'Sari Dewi'])
    expect(model.unpaid.count).toBe(4)
    expect(model.unpaid.amount).toBe(52_000 + 48_000 + 27_000 + 24_000)
    expect(model.unpaid.top.map(name)).toEqual(['Bu Wati', 'Yoga Pratama', 'Pak Hendra', 'Rina Putri'])
    // Pak Hendra's DP by QRIS is the only money in today
    expect(model.moneyToday.total).toBe(18_000)
    expect(model.moneyToday.byMethod).toEqual({ cash: 0, transfer: 0, qris: 18_000 })
    expect(model.moneySeries.map((d) => d.total)).toEqual([82_000, 0, 15_000, 0, 18_000, 60_000, 18_000])
  })
})

describe('small rules', () => {
  it('readyDaysWaiting counts calendar days in the device timezone and never goes below 0', () => {
    expect(readyDaysWaiting(localTs('2026-10-16', 23), TODAY)).toBe(3)
    expect(readyDaysWaiting(localTs(TODAY, 0), TODAY)).toBe(0)
    expect(readyDaysWaiting(localTs('2026-10-21', 9), TODAY)).toBe(0)
    expect(readyDaysWaiting(null, TODAY)).toBe(0)
    expect(readyDaysWaiting('2026-10-17', TODAY)).toBe(2)
    expect(localDay(localTs('2026-10-16', 23))).toBe('2026-10-16')
    expect(localDay('2026-10-16')).toBe('2026-10-16')
  })

  it('waiting and late texts', () => {
    expect(waitingText(0)).toBe('Siap hari ini')
    expect(waitingText(1)).toBe('Menunggu 1 hari')
    expect(waitingText(4)).toBe('Menunggu 4 hari')
  })

  it('the Sedang proses tile opens the tab that holds all of them, else the whole list', () => {
    expect(inProgressLink({ received: 2, processing: 0 })).toBe('/pesanan?tab=diterima')
    expect(inProgressLink({ received: 0, processing: 3 })).toBe('/pesanan?tab=proses')
    expect(inProgressLink({ received: 2, processing: 3 })).toBe('/pesanan')
    expect(inProgressLink({ received: 0, processing: 0 })).toBe('/pesanan')
  })

  it('order links open the detail page, optionally with its Diambil / Terima pembayaran dialog', () => {
    expect(orderLink('demo-order-04')).toBe('/pesanan/demo-order-04')
    expect(orderLink('demo-order-04', 'diambil')).toBe('/pesanan/demo-order-04?aksi=diambil')
    expect(orderLink('demo-order-04', 'bayar')).toBe('/pesanan/demo-order-04?aksi=bayar')
  })

  it('weekday labels in Indonesian', () => {
    expect(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].map(dayLabel)).toEqual(['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'])
  })

  it('first-run steps: an active service, a customer, an order', () => {
    expect(firstRunSteps({ services: [], customers: [], orders: [] }).map((s) => s.done)).toEqual([false, false, false])
    expect(firstRunSteps({ services: [{ active: false }], customers: [{}], orders: [] }).map((s) => [s.key, s.done])).toEqual([
      ['harga', false],
      ['pelanggan', true],
      ['pesanan', false],
    ])
    expect(firstRunSteps({ services: [{ active: true }], customers: [{}], orders: [{}] }).every((s) => s.done)).toBe(true)
  })
})
