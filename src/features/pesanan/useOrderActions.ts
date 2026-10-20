/**
 * Multi-step writes of the orders module (SPEC 3.3, 3.4, 3.5, 3.10). Every function checks the role and the domain
 * rules BEFORE its first write, performs its repo calls one after the other, and invalidates the touched tables
 * at the end (also after a failure, so the screen shows what was saved). Online, the database repeats the role
 * rules (RLS, orders_done_guard) and the integrity rules (payments_limit, package_use_guard, orders_cancel_guard);
 * Mode Demo's LocalRepo raises the same texts, so the tests of this hook cover both.
 */
import { useMemo } from 'react'
import { useOrg } from '../../hooks/useOrg'
import { useInvalidate } from '../../hooks/useTable'
import type { Customer, CustomerPackage, Order, OrderItem, Payment, PaymentMethod, Service } from '../../types/db'
import { ORDER_NUMBER_TAKEN_MESSAGE } from '../../lib/repo/types'
import {
  ERR_PAYMENT_EXCEEDS,
  nextOrderNumber,
  orderTotals,
  priceDraftItems,
  promisedDate,
  validateOrderDraft,
  type OrderDraftContext,
  type OrderDraftItem,
  type PricedItem,
} from '../../domain/pricing'
import { todayISO } from '../../lib/format'
import {
  CUSTOMER_NAME_MESSAGE,
  DATE_RE,
  PAYMENT_DATE_MESSAGE,
  PAYMENT_POSITIVE_MESSAGE,
  STAFF_DELETE_ORDER_MESSAGE,
  STAFF_DELETE_PAYMENT_MESSAGE,
  STAFF_EDIT_PAYMENT_MESSAGE,
  cancelProblem,
  datesProblem,
  editProblem,
  paymentProblem,
  totalBelowPaidMessage,
  transitionProblem,
  validatePaymentEdit,
  type PaymentEditPatch,
} from './orderUtils'
import { keepOldPrices, keptServiceId } from './orderForm'

/** The organisation's rows the rules are checked against (useLaundryData has exactly these fields). */
export interface ActionContext {
  services: Service[]
  customerPackages: CustomerPackage[]
  orderItems: OrderItem[]
  orders: Order[]
  payments: Payment[]
}

export interface PaymentInput {
  amount: number
  method: PaymentMethod
  /** 'YYYY-MM-DD'; default today (createOrder: the received date) */
  paid_at?: string
  notes?: string | null
}

export interface CreateOrderInput {
  customer_id: string | null
  /** 'YYYY-MM-DD' */
  received_at: string
  /** 'YYYY-MM-DD'; null/undefined = computed from the services (promisedDate) */
  promised_at?: string | null
  express: boolean
  discount: number
  notes?: string | null
  items: OrderDraftItem[]
  /** DP or full payment taken with the order; amount 0 / null = none */
  payment?: PaymentInput | null
}

export interface CreateOrderResult {
  order: Order
  items: OrderItem[]
  payment: Payment | null
}

/** A line of the Ubah dialog: an existing item (id) with new values, or a new line (id null). */
export interface EditOrderItem extends OrderDraftItem {
  id?: string | null
}

export interface EditOrderInput {
  received_at: string
  promised_at: string | null
  express: boolean
  discount: number
  notes: string | null
  items: EditOrderItem[]
}

export interface NewCustomerInput {
  name: string
  phone?: string | null
}

/** The order was saved but a later step (its payment) failed: the screen still opens the order. */
export class PartialSaveError extends Error {
  readonly order: Order
  constructor(message: string, order: Order) {
    super(message)
    this.name = 'PartialSaveError'
    this.order = order
  }
}

const MAX_NUMBER_RETRIES = 3

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** A priced line as stored: service_id is null for a kept line whose service was deleted. */
type ItemValues = Omit<OrderItem, 'id' | 'org_id' | 'order_id' | 'created_at' | 'updated_at'>

function itemPatch(p: Omit<PricedItem, 'service_id'> & { service_id: string | null }): ItemValues {
  return {
    service_id: p.service_id,
    service_name: p.service_name,
    unit: p.unit,
    unit_price: p.unit_price,
    qty: p.qty,
    line_total: p.line_total,
    customer_package_id: p.customer_package_id,
    notes: p.notes,
  }
}

function sameItem(existing: OrderItem, next: ItemValues): boolean {
  return (Object.keys(next) as (keyof ItemValues)[]).every((k) => existing[k] === next[k])
}

/** qty this line takes from a package (0 when it pays per unit) */
function packageQty(item: Pick<OrderItem, 'customer_package_id' | 'qty'>): number {
  return item.customer_package_id ? item.qty : 0
}

export function useOrderActions() {
  const { repo, role } = useOrg()
  const invalidate = useInvalidate()

  return useMemo(() => {
    const isAdmin = role === 'owner' || role === 'admin'

    function draftContext(ctx: ActionContext, excludeOrderId: string | null = null): OrderDraftContext {
      return { services: ctx.services, packages: ctx.customerPackages, orderItems: ctx.orderItems, orders: ctx.orders, excludeOrderId }
    }

    function servicesOf(items: Pick<PricedItem, 'service_id'>[], services: Service[]): Service[] {
      const byId = new Map(services.map((s) => [s.id, s]))
      return items.map((it) => byId.get(it.service_id)).filter((s): s is Service => s !== undefined)
    }

    /** Insert the order header; on a duplicate number (two phones at once) reload the numbers and try the next. */
    async function insertHeader(row: Omit<Order, 'id' | 'org_id' | 'created_at' | 'updated_at' | 'order_number'>, numbers: string[]): Promise<Order> {
      let existing = numbers
      for (let attempt = 0; ; attempt++) {
        const order_number = nextOrderNumber(existing, row.received_at)
        try {
          return await repo.insert('orders', { ...row, order_number })
        } catch (err) {
          if (attempt < MAX_NUMBER_RETRIES && message(err) === ORDER_NUMBER_TAKEN_MESSAGE) {
            existing = (await repo.list('orders')).map((o) => o.order_number)
            continue
          }
          throw err
        }
      }
    }

    /**
     * New order (SPEC 3.3): validates the draft (customer, items, express prices, packages, discount, DP), prices
     * the items as copies of the services, numbers the order, then writes order -> items -> payment. A failed
     * items insert removes the header again (best effort: staff cannot delete online); a failed payment leaves the
     * order and reports it (PartialSaveError).
     */
    async function createOrder(input: CreateOrderInput, ctx: ActionContext): Promise<CreateOrderResult> {
      const dates = datesProblem(input.received_at, input.promised_at)
      if (dates) throw new Error(dates)
      const payment = input.payment && input.payment.amount > 0 ? input.payment : null
      if (payment && !Number.isInteger(payment.amount)) throw new Error(PAYMENT_POSITIVE_MESSAGE)
      if (payment?.paid_at && !DATE_RE.test(payment.paid_at)) throw new Error(PAYMENT_DATE_MESSAGE)
      const errors = validateOrderDraft(
        { customer_id: input.customer_id, received_at: input.received_at, express: input.express, discount: input.discount, items: input.items, payment: payment?.amount ?? 0 },
        draftContext(ctx),
      )
      if (errors.length > 0) throw new Error(errors[0])
      const customer_id = input.customer_id as string
      const priced = priceDraftItems(input.items, ctx.services, input.express)
      const promised_at = input.promised_at || promisedDate(input.received_at, servicesOf(priced, ctx.services), input.express)

      const order = await insertHeader(
        {
          customer_id,
          received_at: input.received_at,
          promised_at,
          express: input.express,
          status: 'received',
          ready_at: null,
          picked_up_at: null,
          discount: input.discount,
          notes: input.notes?.trim() || null,
        },
        ctx.orders.map((o) => o.order_number),
      )
      let items: OrderItem[]
      try {
        items = await repo.insertMany(
          'order_items',
          priced.map((p) => ({ order_id: order.id, ...itemPatch(p) })),
        )
      } catch (err) {
        await repo.remove('orders', order.id).catch(() => undefined)
        await invalidate('orders', 'order_items')
        throw err
      }
      let paymentRow: Payment | null = null
      if (payment) {
        try {
          paymentRow = await repo.insert('payments', {
            order_id: order.id,
            amount: payment.amount,
            paid_at: payment.paid_at ?? input.received_at,
            method: payment.method,
            notes: payment.notes?.trim() || null,
          })
        } catch (err) {
          await invalidate('orders', 'order_items', 'payments')
          throw new PartialSaveError(`Pesanan ${order.order_number} tersimpan, tetapi pembayaran gagal dicatat: ${message(err)}`, order)
        }
      }
      await invalidate('orders', 'order_items', 'payments')
      return { order, items, payment: paymentRow }
    }

    /**
     * Ubah (SPEC 3.3): items, qty, express, discount, notes, dates. Open orders: everyone; done/cancelled:
     * owner/admin only (refused here before any write, orders_done_guard online). Lines that bill the same service
     * the same way keep their old copy and price (keepOldPrices, SPEC 3.1); the new total may never drop under what
     * was paid. Writes are ordered so no intermediate state trips payments_limit (the total only rises, then
     * falls to the new one) or package_use_guard (package use only falls, then rises to the new one): a smaller
     * discount, removed package lines, changed package lines (most freed first), new lines, the other changed
     * lines (largest increase first), removed paid lines, then the rest of the header.
     */
    async function updateOrder(order: Order, input: EditOrderInput, ctx: ActionContext): Promise<void> {
      const refused = editProblem(order, isAdmin)
      if (refused) throw new Error(refused)
      const dates = datesProblem(input.received_at, input.promised_at)
      if (dates) throw new Error(dates)
      const existing = ctx.orderItems.filter((i) => i.order_id === order.id)
      const view = keepOldPrices(input.items, existing, ctx.services, input.express, order.express)
      const paid = orderTotals(order, ctx.orderItems, ctx.payments).paid
      const errors = validateOrderDraft(
        { customer_id: order.customer_id, received_at: input.received_at, express: input.express, discount: input.discount, items: view.lines, payment: paid },
        { ...draftContext(ctx, order.id), services: view.services },
      ).map((e) => (e === ERR_PAYMENT_EXCEEDS ? totalBelowPaidMessage(paid) : e))
      if (errors.length > 0) throw new Error(errors[0])

      const pricedView = priceDraftItems(view.lines, view.services, input.express)
      const promised_at = input.promised_at || promisedDate(input.received_at, servicesOf(pricedView, view.services), input.express)
      const priced = pricedView.map((p) => itemPatch({ ...p, service_id: keptServiceId(p.service_id, existing) }))
      const existingById = new Map(existing.map((i) => [i.id, i]))
      const keep = new Set<string>()
      const updates: { old: OrderItem; item: ItemValues }[] = []
      const inserts: ItemValues[] = []
      input.items.forEach((it, idx) => {
        const current = it.id ? existingById.get(it.id) : undefined
        if (current && !keep.has(current.id)) {
          keep.add(current.id)
          if (!sameItem(current, priced[idx])) updates.push({ old: current, item: priced[idx] })
        } else {
          inserts.push(priced[idx])
        }
      })
      const removed = existing.filter((i) => !keep.has(i.id))
      const packageUpdates = updates.filter((u) => u.old.customer_package_id).sort((a, b) => packageQty(a.item) - packageQty(a.old) - (packageQty(b.item) - packageQty(b.old)))
      const otherUpdates = updates.filter((u) => !u.old.customer_package_id).sort((a, b) => b.item.line_total - b.old.line_total - (a.item.line_total - a.old.line_total))
      const header: Partial<Pick<Order, 'express' | 'discount' | 'notes' | 'received_at' | 'promised_at'>> = {}
      if (input.express !== order.express) header.express = input.express
      if (input.discount !== order.discount) header.discount = input.discount
      const notes = input.notes?.trim() || null
      if (notes !== order.notes) header.notes = notes
      if (input.received_at !== order.received_at) header.received_at = input.received_at
      if (promised_at !== order.promised_at) header.promised_at = promised_at

      try {
        const discountDrops = header.discount !== undefined && header.discount < order.discount
        if (discountDrops) await repo.update('orders', order.id, header)
        for (const it of removed) if (it.customer_package_id) await repo.remove('order_items', it.id)
        for (const u of packageUpdates) await repo.update('order_items', u.old.id, u.item)
        if (inserts.length > 0) await repo.insertMany('order_items', inserts.map((p) => ({ order_id: order.id, ...p })))
        for (const u of otherUpdates) await repo.update('order_items', u.old.id, u.item)
        for (const it of removed) if (!it.customer_package_id) await repo.remove('order_items', it.id)
        if (!discountDrops && Object.keys(header).length > 0) await repo.update('orders', order.id, header)
      } finally {
        await invalidate('orders', 'order_items')
      }
    }

    async function setStatus(order: Order, status: Order['status'], extra: Partial<Pick<Order, 'ready_at' | 'picked_up_at'>> = {}): Promise<Order> {
      const problem = transitionProblem(order.status, status)
      if (problem) throw new Error(problem)
      try {
        return await repo.update('orders', order.id, { status, ...extra })
      } finally {
        await invalidate('orders')
      }
    }

    /** Diterima -> Proses (optional step). */
    function startProcessing(order: Order): Promise<Order> {
      return setStatus(order, 'processing')
    }

    /** Diterima/Proses -> Siap diambil; ready_at = now. The screen then offers the WhatsApp text. */
    function markReady(order: Order): Promise<Order> {
      return setStatus(order, 'ready', { ready_at: new Date().toISOString() })
    }

    /**
     * Diambil (SPEC 3.3): Siap -> Selesai, picked_up_at = now. With `payment` the remaining amount is taken
     * first (amount <= outstanding), then the status changes; a status failure after the payment reports both.
     */
    async function markPickedUp(order: Order, ctx: ActionContext, payment: PaymentInput | null = null): Promise<{ order: Order; payment: Payment | null }> {
      const problem = transitionProblem(order.status, 'done')
      if (problem) throw new Error(problem)
      let paymentRow: Payment | null = null
      if (payment && payment.amount > 0) {
        const refused = paymentProblem(payment.amount, order, orderTotals(order, ctx.orderItems, ctx.payments))
        if (refused) throw new Error(refused)
        if (payment.paid_at && !DATE_RE.test(payment.paid_at)) throw new Error(PAYMENT_DATE_MESSAGE)
        try {
          paymentRow = await repo.insert('payments', {
            order_id: order.id,
            amount: payment.amount,
            paid_at: payment.paid_at ?? todayISO(),
            method: payment.method,
            notes: payment.notes?.trim() || null,
          })
        } finally {
          await invalidate('payments')
        }
      }
      try {
        const updated = await repo.update('orders', order.id, { status: 'done', picked_up_at: new Date().toISOString() })
        return { order: updated, payment: paymentRow }
      } catch (err) {
        if (paymentRow) throw new Error(`Pembayaran tercatat, tetapi status pesanan gagal diubah: ${message(err)}`)
        throw err
      } finally {
        await invalidate('orders')
      }
    }

    /** Batalkan: only Diterima/Proses and only without payments (checked here and by the database). */
    async function cancelOrder(order: Order, ctx: Pick<ActionContext, 'payments'>): Promise<Order> {
      const problem = cancelProblem(order, ctx.payments)
      if (problem) throw new Error(problem)
      return setStatus(order, 'cancelled')
    }

    /** Terima pembayaran (SPEC 3.5): DP or settlement, never above the outstanding amount. */
    async function recordPayment(order: Order, input: PaymentInput, ctx: ActionContext): Promise<Payment> {
      const refused = paymentProblem(input.amount, order, orderTotals(order, ctx.orderItems, ctx.payments))
      if (refused) throw new Error(refused)
      if (input.paid_at && !DATE_RE.test(input.paid_at)) throw new Error(PAYMENT_DATE_MESSAGE)
      try {
        return await repo.insert('payments', {
          order_id: order.id,
          amount: input.amount,
          paid_at: input.paid_at ?? todayISO(),
          method: input.method,
          notes: input.notes?.trim() || null,
        })
      } finally {
        await invalidate('payments')
      }
    }

    /** Ubah pembayaran (owner/admin): amount, date, method, note; amount <= outstanding without this payment. */
    async function updatePayment(payment: Payment, patch: PaymentEditPatch, ctx: ActionContext): Promise<void> {
      if (!isAdmin) throw new Error(STAFF_EDIT_PAYMENT_MESSAGE)
      const order = ctx.orders.find((o) => o.id === payment.order_id)
      if (!order) throw new Error('Pesanan tidak ditemukan.')
      const error = validatePaymentEdit(payment, patch, order, ctx.orderItems, ctx.payments)
      if (error) throw new Error(error)
      try {
        await repo.update('payments', payment.id, { amount: patch.amount, paid_at: patch.paid_at, method: patch.method, notes: patch.notes?.trim() || null })
      } finally {
        await invalidate('payments')
      }
    }

    async function deletePayment(payment: Payment): Promise<void> {
      if (!isAdmin) throw new Error(STAFF_DELETE_PAYMENT_MESSAGE)
      try {
        await repo.remove('payments', payment.id)
      } finally {
        // also after a refusal: the row may already be gone on another device
        await invalidate('payments')
      }
    }

    /** Hapus pesanan (owner/admin): items and payments go with it; packages used become available again. */
    async function deleteOrder(order: Order): Promise<void> {
      if (!isAdmin) throw new Error(STAFF_DELETE_ORDER_MESSAGE)
      try {
        await repo.remove('orders', order.id)
      } finally {
        await invalidate('orders', 'order_items', 'payments')
      }
    }

    /** 'Tambah pelanggan baru' inside the order form: name required, phone may follow later (SPEC 3.2). */
    async function createCustomer(input: NewCustomerInput): Promise<Customer> {
      const name = input.name.trim()
      if (!name) throw new Error(CUSTOMER_NAME_MESSAGE)
      try {
        return await repo.insert('customers', {
          name,
          phone: input.phone?.trim() || null,
          is_tenant: false,
          room_name: null,
          kos_tenant_id: null,
          address: null,
          notes: null,
        })
      } finally {
        await invalidate('customers')
      }
    }

    return {
      isAdmin,
      /** Ubah allowed for this role on this order */
      canEdit: (order: Pick<Order, 'status'>) => editProblem(order, isAdmin) === null,
      createOrder,
      updateOrder,
      startProcessing,
      markReady,
      markPickedUp,
      cancelOrder,
      recordPayment,
      updatePayment,
      deletePayment,
      deleteOrder,
      createCustomer,
    }
  }, [repo, role, invalidate])
}

export type OrderActions = ReturnType<typeof useOrderActions>
