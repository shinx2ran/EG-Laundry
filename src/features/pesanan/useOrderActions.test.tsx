// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import type { MemberRole, Order, Payment } from '../../types/db'
import { LocalRepo } from '../../lib/repo/localRepo'
import {
  CANCEL_STATUS_MESSAGE,
  CANCEL_WITH_PAYMENTS_MESSAGE,
  DELETE_DENIED_MESSAGE,
  DONE_ORDER_ADMIN_MESSAGE,
  ORDER_NUMBER_TAKEN_MESSAGE,
  PAYMENT_EXCEEDS_TOTAL_MESSAGE,
  bindOrg,
  type OrgRepo,
} from '../../lib/repo/types'
import { buildDemoDb, DEMO_ORG_ID, DEMO_SERVICE_ID } from '../../lib/repo/demoSeed'
import { ERR_DISCOUNT_EXCEEDS, ERR_NO_CUSTOMER, ERR_NO_ITEMS, ERR_PAYMENT_EXCEEDS, nextOrderNumber, noExpressMessage, orderTotals, packageInsufficientMessage, packageRemaining } from '../../domain/pricing'
import { addDaysISO, todayISO } from '../../lib/format'
import {
  CANCELLED_PAYMENT_MESSAGE,
  CUSTOMER_NAME_MESSAGE,
  ORDER_PAID_MESSAGE,
  PROMISED_BEFORE_RECEIVED_MESSAGE,
  STAFF_DELETE_ORDER_MESSAGE,
  STAFF_DELETE_PAYMENT_MESSAGE,
  STAFF_EDIT_PAYMENT_MESSAGE,
  paymentExceedsMessage,
  totalBelowPaidMessage,
} from './orderUtils'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }
const invalidate = vi.fn(async (..._tables: string[]) => undefined)

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: DEMO_ORG_ID, name: 'EG Laundry (Demo)' }, repo: state.repo, role: state.role, isAdmin: state.role !== 'staff', isLocalMode: true }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => invalidate }))

import { PartialSaveError, useOrderActions, type ActionContext } from './useOrderActions'

const TODAY = new Date(2026, 9, 19, 10, 0)
const today = todayISO(TODAY)
const S = DEMO_SERVICE_ID
// customers of the demo seed (see demoSeed.ts)
const RINA = 'demo-cust-01'
const RUDI = 'demo-cust-10'
const PKG_RUDI = 'demo-pkg-rudi'
// orders of the demo seed: 00 Rina received unpaid (3 kg cuci setrika = 24.000), 02 Dimas processing paid in full
// (2,5 kg cuci setrika + bed cover = 45.000), 04 Bu Wati ready unpaid (4 kg + selimut = 52.000), 08 Rudi done on
// his package, 09 Mega cancelled
const OPEN = 'demo-order-00'
const PAID = 'demo-order-02'
const READY = 'demo-order-04'
const DONE = 'demo-order-08'
const CANCELLED = 'demo-order-09'

let local: LocalRepo
let repo: OrgRepo

function seed() {
  local = new LocalRepo(buildDemoDb(TODAY))
  repo = bindOrg(local, DEMO_ORG_ID)
  state.repo = repo
  state.role = 'owner'
}

async function ctx(): Promise<ActionContext> {
  return {
    services: await repo.list('services'),
    customerPackages: await repo.list('customer_packages'),
    orderItems: await repo.list('order_items'),
    orders: await repo.list('orders'),
    payments: await repo.list('payments'),
  }
}

async function order(id: string): Promise<Order> {
  return (await repo.get('orders', id)) as Order
}

async function totals(id: string) {
  const o = await order(id)
  return orderTotals(o, await repo.list('order_items'), await repo.list('payments'))
}

function actions() {
  return renderHook(() => useOrderActions()).result.current
}

const basket = [
  { service_id: S.cuciSetrika, qty: 2.5 },
  { service_id: S.bedCover, qty: 1 },
]

beforeEach(() => {
  seed()
  invalidate.mockClear()
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('createOrder', () => {
  it('numbers the order after the last one of the month, copies the price list and takes the DP', async () => {
    const before = await ctx()
    const expectedNumber = nextOrderNumber(
      before.orders.map((o) => o.order_number),
      today,
    )
    const result = await actions().createOrder(
      { customer_id: RINA, received_at: today, express: false, discount: 0, notes: '  ', items: basket, payment: { amount: 20_000, method: 'cash' } },
      before,
    )
    expect(result.order).toMatchObject({ order_number: expectedNumber, customer_id: RINA, status: 'received', received_at: today, promised_at: addDaysISO(today, 3), express: false, discount: 0, notes: null, ready_at: null, picked_up_at: null })
    expect(result.items.map((i) => [i.service_name, i.unit, i.qty, i.unit_price, i.line_total, i.customer_package_id])).toEqual([
      ['Cuci setrika', 'kg', 2.5, 8_000, 20_000, null],
      ['Bed cover', 'pcs', 1, 25_000, 25_000, null],
    ])
    expect(result.payment).toMatchObject({ order_id: result.order.id, amount: 20_000, method: 'cash', paid_at: today, notes: null })
    expect(await totals(result.order.id)).toEqual({ subtotal: 45_000, discount: 0, total: 45_000, paid: 20_000, outstanding: 25_000, payStatus: 'sebagian' })
    expect(invalidate).toHaveBeenCalledWith('orders', 'order_items', 'payments')

    // the next order of the same month continues the sequence
    const second = await actions().createOrder({ customer_id: RINA, received_at: today, express: false, discount: 0, items: basket }, await ctx())
    expect(second.order.order_number).toBe(nextOrderNumber([expectedNumber], today))
    expect(second.payment).toBeNull()
    expect((await totals(second.order.id)).payStatus).toBe('belum')
  })

  it('express prices every line with the express price and promises the express days', async () => {
    const result = await actions().createOrder({ customer_id: RINA, received_at: today, express: true, discount: 0, items: [{ service_id: S.cuciSetrika, qty: 2.5 }] }, await ctx())
    expect(result.items[0]).toMatchObject({ unit_price: 13_000, line_total: 32_500 })
    expect(result.order).toMatchObject({ express: true, promised_at: addDaysISO(today, 1) })
  })

  it('applies the minimum quantity and keeps a given promised date', async () => {
    const result = await actions().createOrder({ customer_id: RINA, received_at: today, promised_at: addDaysISO(today, 5), express: false, discount: 0, items: [{ service_id: S.cuciSetrika, qty: 1 }] }, await ctx())
    expect(result.items[0]).toMatchObject({ qty: 2, line_total: 16_000 })
    expect(result.order.promised_at).toBe(addDaysISO(today, 5))
  })

  it('refuses express for a service without an express price, and writes nothing', async () => {
    const before = await ctx()
    await expect(actions().createOrder({ customer_id: RINA, received_at: today, express: true, discount: 0, items: [{ service_id: S.setrikaSaja, qty: 3 }] }, before)).rejects.toThrow(noExpressMessage('Setrika saja'))
    expect(await repo.list('orders')).toHaveLength(before.orders.length)
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('refuses a draft without customer, without items, with too much discount or too much DP', async () => {
    const c = await ctx()
    await expect(actions().createOrder({ customer_id: null, received_at: today, express: false, discount: 0, items: basket }, c)).rejects.toThrow(ERR_NO_CUSTOMER)
    await expect(actions().createOrder({ customer_id: RINA, received_at: today, express: false, discount: 0, items: [] }, c)).rejects.toThrow(ERR_NO_ITEMS)
    await expect(actions().createOrder({ customer_id: RINA, received_at: today, express: false, discount: 50_000, items: basket }, c)).rejects.toThrow(ERR_DISCOUNT_EXCEEDS)
    await expect(actions().createOrder({ customer_id: RINA, received_at: today, express: false, discount: 5_000, items: basket, payment: { amount: 40_001, method: 'cash' } }, c)).rejects.toThrow(ERR_PAYMENT_EXCEEDS)
    await expect(actions().createOrder({ customer_id: RINA, received_at: '', express: false, discount: 0, items: basket }, c)).rejects.toThrow('Isi tanggal masuk.')
    await expect(actions().createOrder({ customer_id: RINA, received_at: today, promised_at: addDaysISO(today, -1), express: false, discount: 0, items: basket }, c)).rejects.toThrow(PROMISED_BEFORE_RECEIVED_MESSAGE)
    expect(await repo.list('orders')).toHaveLength(c.orders.length)
  })

  it('a package line costs nothing and reduces what is left of the package', async () => {
    const before = await ctx()
    const pkg = before.customerPackages.find((p) => p.id === PKG_RUDI)!
    expect(packageRemaining(pkg, before.orderItems, before.orders)).toBe(13)
    const result = await actions().createOrder({ customer_id: RUDI, received_at: today, express: false, discount: 0, items: [{ service_id: S.cuciSetrika, qty: 2, customer_package_id: PKG_RUDI }] }, before)
    expect(result.items[0]).toMatchObject({ unit_price: 0, line_total: 0, customer_package_id: PKG_RUDI })
    expect((await totals(result.order.id)).payStatus).toBe('lunas')
    const after = await ctx()
    expect(packageRemaining(pkg, after.orderItems, after.orders)).toBe(11)
    // more than what is left, or another customer's package, is refused before any write
    await expect(actions().createOrder({ customer_id: RUDI, received_at: today, express: false, discount: 0, items: [{ service_id: S.cuciSetrika, qty: 12, customer_package_id: PKG_RUDI }] }, after)).rejects.toThrow(packageInsufficientMessage(11, 'kg'))
    await expect(actions().createOrder({ customer_id: RINA, received_at: today, express: false, discount: 0, items: [{ service_id: S.cuciSetrika, qty: 2, customer_package_id: PKG_RUDI }] }, after)).rejects.toThrow('Paket ini milik pelanggan lain.')
    expect(await repo.list('orders')).toHaveLength(after.orders.length)
  })

  it('takes the next number when another phone used the same one at the same moment', async () => {
    const before = await ctx()
    const first = nextOrderNumber(
      before.orders.map((o) => o.order_number),
      today,
    )
    let collided = false
    state.repo = {
      ...repo,
      insert: (async (table: string, row: never) => {
        if (table === 'orders' && !collided) {
          collided = true
          // the other phone's insert lands first; ours is refused by the unique constraint
          await repo.insert('orders', { ...(row as object), customer_id: RINA } as never)
          throw new Error(ORDER_NUMBER_TAKEN_MESSAGE)
        }
        return repo.insert(table as 'orders', row)
      }) as OrgRepo['insert'],
    }
    const result = await actions().createOrder({ customer_id: RINA, received_at: today, express: false, discount: 0, items: basket }, before)
    expect(result.order.order_number).toBe(nextOrderNumber([first], today))
    const numbers = (await repo.list('orders')).map((o) => o.order_number)
    expect(numbers).toContain(first)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('removes the header again when the items cannot be written', async () => {
    const before = await ctx()
    state.repo = {
      ...repo,
      insertMany: (async () => {
        throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.')
      }) as OrgRepo['insertMany'],
    }
    await expect(actions().createOrder({ customer_id: RINA, received_at: today, express: false, discount: 0, items: basket }, before)).rejects.toThrow('koneksi')
    expect(await repo.list('orders')).toHaveLength(before.orders.length)
    expect(invalidate).toHaveBeenCalledWith('orders', 'order_items')
  })

  it('keeps the order and reports it when only the payment fails', async () => {
    const before = await ctx()
    state.repo = {
      ...repo,
      insert: (async (table: string, row: never) => {
        if (table === 'payments') throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.')
        return repo.insert(table as 'orders', row)
      }) as OrgRepo['insert'],
    }
    const promise = actions().createOrder({ customer_id: RINA, received_at: today, express: false, discount: 0, items: basket, payment: { amount: 10_000, method: 'qris' } }, before)
    await expect(promise).rejects.toBeInstanceOf(PartialSaveError)
    const err = (await promise.catch((e) => e)) as PartialSaveError
    expect(err.message).toMatch(/tersimpan, tetapi pembayaran gagal/)
    expect(await repo.get('orders', err.order.id)).not.toBeNull()
    expect(await repo.list('order_items', { where: { order_id: err.order.id } })).toHaveLength(2)
    expect(await repo.list('payments', { where: { order_id: err.order.id } })).toHaveLength(0)
  })
})

describe('status flow (SPEC 3.3)', () => {
  it('Diterima -> Proses -> Siap diambil -> Diambil, filling ready_at and picked_up_at', async () => {
    const a = actions()
    let o = await a.startProcessing(await order(OPEN))
    expect(o.status).toBe('processing')
    o = await a.markReady(o)
    expect(o.status).toBe('ready')
    expect(o.ready_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(o.picked_up_at).toBeNull()
    const picked = await a.markPickedUp(o, await ctx())
    expect(picked.order.status).toBe('done')
    expect(picked.order.picked_up_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(picked.payment).toBeNull()
    expect(invalidate).toHaveBeenCalledWith('orders')
  })

  it('Siap diambil straight from Diterima', async () => {
    const o = await actions().markReady(await order(OPEN))
    expect(o.status).toBe('ready')
  })

  it('refuses steps the flow does not allow', async () => {
    const a = actions()
    await expect(a.startProcessing(await order(DONE))).rejects.toThrow('Pesanan Selesai tidak dapat diubah menjadi Proses.')
    await expect(a.markPickedUp(await order(OPEN), await ctx())).rejects.toThrow('Pesanan Diterima tidak dapat diubah menjadi Selesai.')
    await expect(a.markReady(await order(READY))).rejects.toThrow('Status pesanan tidak berubah.')
    await expect(a.startProcessing(await order(CANCELLED))).rejects.toThrow('Pesanan Dibatalkan tidak dapat diubah menjadi Proses.')
    expect((await order(OPEN)).status).toBe('received')
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('Diambil with the remaining payment writes the payment and the status together', async () => {
    expect(await totals(READY)).toMatchObject({ total: 52_000, outstanding: 52_000, payStatus: 'belum' })
    const picked = await actions().markPickedUp(await order(READY), await ctx(), { amount: 52_000, method: 'transfer', notes: 'Pelunasan' })
    expect(picked.payment).toMatchObject({ order_id: READY, amount: 52_000, method: 'transfer', paid_at: todayISO(), notes: 'Pelunasan' })
    expect(picked.order.status).toBe('done')
    expect(await totals(READY)).toMatchObject({ outstanding: 0, payStatus: 'lunas' })
    expect(invalidate).toHaveBeenCalledWith('payments')
    expect(invalidate).toHaveBeenCalledWith('orders')
  })

  it('Diambil with more than the remaining amount is refused before any write', async () => {
    await expect(actions().markPickedUp(await order(READY), await ctx(), { amount: 60_000, method: 'cash' })).rejects.toThrow(paymentExceedsMessage(52_000))
    expect((await order(READY)).status).toBe('ready')
    expect(await repo.list('payments', { where: { order_id: READY } })).toHaveLength(0)
  })
})

describe('payments (SPEC 3.5)', () => {
  it('DP then settlement makes the order lunas; more than the remaining amount is refused', async () => {
    const a = actions()
    const o = await order(OPEN)
    expect(await totals(OPEN)).toMatchObject({ total: 24_000, payStatus: 'belum' })
    await a.recordPayment(o, { amount: 10_000, method: 'cash', paid_at: today, notes: 'DP' }, await ctx())
    expect(await totals(OPEN)).toMatchObject({ paid: 10_000, outstanding: 14_000, payStatus: 'sebagian' })
    await expect(a.recordPayment(o, { amount: 20_000, method: 'cash' }, await ctx())).rejects.toThrow(paymentExceedsMessage(14_000))
    await expect(a.recordPayment(o, { amount: 0, method: 'cash' }, await ctx())).rejects.toThrow('Jumlah pembayaran harus lebih dari 0.')
    await a.recordPayment(o, { amount: 14_000, method: 'qris' }, await ctx())
    expect(await totals(OPEN)).toMatchObject({ paid: 24_000, outstanding: 0, payStatus: 'lunas' })
    await expect(a.recordPayment(o, { amount: 1_000, method: 'cash' }, await ctx())).rejects.toThrow(ORDER_PAID_MESSAGE)
    expect(await repo.list('payments', { where: { order_id: OPEN } })).toHaveLength(2)
    expect(invalidate).toHaveBeenCalledWith('payments')
  })

  it('a cancelled order takes no payment', async () => {
    await expect(actions().recordPayment(await order(CANCELLED), { amount: 1_000, method: 'cash' }, await ctx())).rejects.toThrow(CANCELLED_PAYMENT_MESSAGE)
  })

  it('Mode Demo refuses a payment above the total like the database (payments_limit)', async () => {
    await expect(repo.insert('payments', { order_id: OPEN, amount: 24_001, paid_at: today, method: 'cash', notes: null })).rejects.toThrow(PAYMENT_EXCEEDS_TOTAL_MESSAGE)
  })

  it('Ubah pembayaran corrects amount, date, method and note within what the order owes', async () => {
    const a = actions()
    const o = await order(OPEN)
    const dp = await a.recordPayment(o, { amount: 10_000, method: 'cash', paid_at: today, notes: 'DP' }, await ctx())
    await a.updatePayment(dp, { amount: 24_000, paid_at: addDaysISO(today, -1), method: 'transfer', notes: '  lunas ' }, await ctx())
    expect(await repo.get('payments', dp.id)).toMatchObject({ amount: 24_000, paid_at: addDaysISO(today, -1), method: 'transfer', notes: 'lunas' })
    expect((await totals(OPEN)).payStatus).toBe('lunas')
    await expect(a.updatePayment({ ...dp, amount: 24_000 }, { amount: 24_001, paid_at: today, method: 'cash', notes: null }, await ctx())).rejects.toThrow(`Jumlah melebihi sisa bayar pesanan ${o.order_number} (Rp 24.000).`)
    await expect(a.updatePayment(dp, { amount: 5_000, paid_at: '', method: 'cash', notes: null }, await ctx())).rejects.toThrow('Isi tanggal bayar.')
    expect((await repo.get('payments', dp.id))?.amount).toBe(24_000)
  })

  it('a deleted payment reopens the amount; deleting one that is already gone reports it', async () => {
    const a = actions()
    const [payment] = (await repo.list('payments', { where: { order_id: PAID } })) as Payment[]
    await a.deletePayment(payment)
    expect(await totals(PAID)).toMatchObject({ paid: 0, payStatus: 'belum' })
    await expect(a.deletePayment(payment)).rejects.toThrow(DELETE_DENIED_MESSAGE)
    expect(invalidate).toHaveBeenCalledWith('payments')
  })
})

describe('cancel (SPEC 3.3)', () => {
  it('is refused once a payment exists, and outside Diterima/Proses', async () => {
    const a = actions()
    await expect(a.cancelOrder(await order(PAID), await ctx())).rejects.toThrow(CANCEL_WITH_PAYMENTS_MESSAGE)
    await expect(a.cancelOrder(await order(READY), await ctx())).rejects.toThrow(CANCEL_STATUS_MESSAGE)
    await expect(a.cancelOrder(await order(DONE), await ctx())).rejects.toThrow(CANCEL_STATUS_MESSAGE)
    expect((await order(PAID)).status).toBe('processing')
    expect((await order(READY)).status).toBe('ready')
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('cancels an unpaid open order; nothing is owed on it any more', async () => {
    const o = await actions().cancelOrder(await order(OPEN), await ctx())
    expect(o.status).toBe('cancelled')
    expect(await totals(OPEN)).toMatchObject({ outstanding: 0 })
  })

  it('Mode Demo refuses the same cancels as the database (orders_cancel_guard)', async () => {
    await expect(repo.update('orders', PAID, { status: 'cancelled' })).rejects.toThrow(CANCEL_WITH_PAYMENTS_MESSAGE)
    await expect(repo.update('orders', READY, { status: 'cancelled' })).rejects.toThrow(CANCEL_STATUS_MESSAGE)
  })
})

describe('updateOrder (Ubah)', () => {
  const edit = async (id: string, patch: Partial<Parameters<ReturnType<typeof actions>['updateOrder']>[1]> = {}) => {
    const o = await order(id)
    const items = (await repo.list('order_items', { where: { order_id: id }, orderBy: { column: 'created_at', ascending: true } })).map((i) => ({ id: i.id, service_id: i.service_id ?? '', qty: i.qty, customer_package_id: i.customer_package_id, notes: i.notes }))
    return { o, input: { received_at: o.received_at, promised_at: o.promised_at, express: o.express, discount: o.discount, notes: o.notes, items, ...patch } }
  }

  it('changes a quantity in place on a paid order; the total never drops under what was paid', async () => {
    const { o, input } = await edit(PAID)
    expect(await totals(PAID)).toMatchObject({ total: 45_000, paid: 45_000 })
    const ids = input.items.map((i) => i.id)
    await actions().updateOrder(o, { ...input, items: [{ ...input.items[0], qty: 3 }, input.items[1]] }, await ctx())
    const items = await repo.list('order_items', { where: { order_id: PAID } })
    expect(items.map((i) => i.id).sort()).toEqual([...ids].sort())
    expect(items.find((i) => i.service_name === 'Cuci setrika')).toMatchObject({ qty: 3, line_total: 24_000 })
    expect(await totals(PAID)).toMatchObject({ total: 49_000, paid: 45_000, outstanding: 4_000, payStatus: 'sebagian' })
    expect(invalidate).toHaveBeenCalledWith('orders', 'order_items')

    // dropping the bed cover would leave 24.000 against 45.000 paid: refused before any write
    const again = await edit(PAID)
    await expect(actions().updateOrder(again.o, { ...again.input, items: [again.input.items[0]] }, await ctx())).rejects.toThrow(totalBelowPaidMessage(45_000))
    expect(await repo.list('order_items', { where: { order_id: PAID } })).toHaveLength(2)
    await expect(actions().updateOrder(again.o, { ...again.input, discount: 10_000 }, await ctx())).rejects.toThrow(totalBelowPaidMessage(45_000))
  })

  it('a smaller discount is written before a smaller line, so a paid order never dips under its payments', async () => {
    const created = await actions().createOrder({ customer_id: RINA, received_at: today, express: false, discount: 5_000, items: basket, payment: { amount: 40_000, method: 'cash' } }, await ctx())
    expect(await totals(created.order.id)).toMatchObject({ total: 40_000, paid: 40_000, payStatus: 'lunas' })
    const { o, input } = await edit(created.order.id)
    // 2,5 kg -> 2 kg (Rp 16.000) and no discount: 41.000 >= 40.000 paid; the other order would pass 36.000
    await actions().updateOrder(o, { ...input, discount: 0, notes: 'koreksi', items: [{ ...input.items[0], qty: 2 }, input.items[1]] }, await ctx())
    expect(await order(created.order.id)).toMatchObject({ discount: 0, notes: 'koreksi' })
    expect(await totals(created.order.id)).toMatchObject({ total: 41_000, paid: 40_000, outstanding: 1_000, payStatus: 'sebagian' })
  })

  it('switching to express reprices every line and moves the promised date; the header follows', async () => {
    const { o, input } = await edit(OPEN)
    await actions().updateOrder(o, { ...input, express: true, promised_at: null, discount: 2_000, notes: 'Noda kopi' }, await ctx())
    const [item] = await repo.list('order_items', { where: { order_id: OPEN } })
    expect(item).toMatchObject({ unit_price: 13_000, line_total: 39_000 })
    expect(await order(OPEN)).toMatchObject({ express: true, discount: 2_000, notes: 'Noda kopi', promised_at: addDaysISO(o.received_at, 1) })
    expect(await totals(OPEN)).toMatchObject({ total: 37_000 })
    // and back, with a service that has no express price added: refused as a whole
    const { o: o2, input: input2 } = await edit(OPEN)
    await expect(actions().updateOrder(o2, { ...input2, items: [...input2.items, { service_id: S.setrikaSaja, qty: 1 }] }, await ctx())).rejects.toThrow(noExpressMessage('Setrika saja'))
    expect(await repo.list('order_items', { where: { order_id: OPEN } })).toHaveLength(1)
  })

  it('adds and removes lines, package lines included, and frees the package again', async () => {
    const { o, input } = await edit(DONE)
    const pkg = (await repo.get('customer_packages', PKG_RUDI))!
    const before = await ctx()
    expect(packageRemaining(pkg, before.orderItems, before.orders)).toBe(13)
    // the 3 kg package line goes, a 1 kg package line and a bed cover come
    await actions().updateOrder(o, { ...input, items: [{ service_id: S.cuciSetrika, qty: 1, customer_package_id: PKG_RUDI }, { service_id: S.bedCover, qty: 1 }] }, before)
    const items = await repo.list('order_items', { where: { order_id: DONE } })
    expect(items.map((i) => [i.service_name, i.qty, i.line_total, i.customer_package_id]).sort()).toEqual([
      ['Bed cover', 1, 25_000, null],
      ['Cuci setrika', 2, 0, PKG_RUDI],
    ])
    const after = await ctx()
    expect(packageRemaining(pkg, after.orderItems, after.orders)).toBe(14)
    expect(await totals(DONE)).toMatchObject({ total: 25_000, payStatus: 'belum' })
  })

  it('a done order is frozen for staff, open for owner/admin', async () => {
    const { o, input } = await edit(DONE)
    state.role = 'staff'
    await expect(actions().updateOrder(o, { ...input, notes: 'coba' }, await ctx())).rejects.toThrow(DONE_ORDER_ADMIN_MESSAGE)
    expect((await order(DONE)).notes).toBe(o.notes)
    expect(invalidate).not.toHaveBeenCalled()
    state.role = 'admin'
    await actions().updateOrder(o, { ...input, notes: 'coba' }, await ctx())
    expect((await order(DONE)).notes).toBe('coba')
    // staff may still edit an open order
    state.role = 'staff'
    const open = await edit(OPEN)
    await actions().updateOrder(open.o, { ...open.input, notes: 'staf' }, await ctx())
    expect((await order(OPEN)).notes).toBe('staf')
  })
})

describe('roles (SPEC 3.10)', () => {
  it('staff: no deleting orders, no changing or deleting payments; nothing is written', async () => {
    state.role = 'staff'
    const a = actions()
    const [payment] = (await repo.list('payments', { where: { order_id: PAID } })) as Payment[]
    await expect(a.deleteOrder(await order(OPEN))).rejects.toThrow(STAFF_DELETE_ORDER_MESSAGE)
    await expect(a.updatePayment(payment, { amount: 1_000, paid_at: today, method: 'cash', notes: null }, await ctx())).rejects.toThrow(STAFF_EDIT_PAYMENT_MESSAGE)
    await expect(a.deletePayment(payment)).rejects.toThrow(STAFF_DELETE_PAYMENT_MESSAGE)
    expect(await repo.get('orders', OPEN)).not.toBeNull()
    expect(await repo.get('payments', payment.id)).toEqual(payment)
    expect(invalidate).not.toHaveBeenCalled()
    expect(a.isAdmin).toBe(false)
    expect(a.canEdit({ status: 'received' })).toBe(true)
    expect(a.canEdit({ status: 'done' })).toBe(false)
  })

  it('staff may record orders, payments and status changes', async () => {
    state.role = 'staff'
    const a = actions()
    const created = await a.createOrder({ customer_id: RINA, received_at: today, express: false, discount: 0, items: basket, payment: { amount: 5_000, method: 'cash' } }, await ctx())
    await a.recordPayment(created.order, { amount: 40_000, method: 'cash' }, await ctx())
    const ready = await a.markReady(created.order)
    const picked = await a.markPickedUp(ready, await ctx())
    expect(picked.order.status).toBe('done')
    expect((await totals(created.order.id)).payStatus).toBe('lunas')
    // a payment on a done order is still allowed (the guard covers the order and its items only)
    const late = await a.createOrder({ customer_id: RINA, received_at: today, express: false, discount: 0, items: basket }, await ctx())
    const done = await a.markPickedUp(await a.markReady(late.order), await ctx())
    await a.recordPayment(done.order, { amount: 45_000, method: 'qris' }, await ctx())
    expect((await totals(late.order.id)).payStatus).toBe('lunas')
  })

  it('owner: deleting an order removes its items and payments with it', async () => {
    await actions().deleteOrder(await order(PAID))
    expect(await repo.get('orders', PAID)).toBeNull()
    expect(await repo.list('order_items', { where: { order_id: PAID } })).toEqual([])
    expect(await repo.list('payments', { where: { order_id: PAID } })).toEqual([])
    expect(invalidate).toHaveBeenCalledWith('orders', 'order_items', 'payments')
    // deleting the package order frees the package
    const pkg = (await repo.get('customer_packages', PKG_RUDI))!
    await actions().deleteOrder(await order(DONE))
    const after = await ctx()
    expect(packageRemaining(pkg, after.orderItems, after.orders)).toBe(16)
  })
})

describe('createCustomer (Tambah pelanggan baru)', () => {
  it('needs a name; the phone may follow later', async () => {
    const a = actions()
    await expect(a.createCustomer({ name: '  ' })).rejects.toThrow(CUSTOMER_NAME_MESSAGE)
    const c = await a.createCustomer({ name: ' Ibu Tini ', phone: ' ' })
    expect(c).toMatchObject({ name: 'Ibu Tini', phone: null, is_tenant: false, room_name: null, kos_tenant_id: null })
    expect(invalidate).toHaveBeenCalledWith('customers')
    const d = await a.createCustomer({ name: 'Pak Budi', phone: '0812-0000-9999' })
    expect(d.phone).toBe('0812-0000-9999')
  })
})
