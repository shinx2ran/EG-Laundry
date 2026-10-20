import { describe, expect, it } from 'vitest'
import type { Order, OrderStatus } from '../../types/db'
import { CANCEL_STATUS_MESSAGE, CANCEL_WITH_PAYMENTS_MESSAGE, DONE_ORDER_ADMIN_MESSAGE } from '../../lib/repo/types'
import { formatDate } from '../../lib/format'
import {
  CANCELLED_PAYMENT_MESSAGE,
  ORDER_PAID_MESSAGE,
  PAYMENT_DATE_MESSAGE,
  PAYMENT_POSITIVE_MESSAGE,
  PROMISED_BEFORE_RECEIVED_MESSAGE,
  PROMISED_DATE_MESSAGE,
  RECEIVED_DATE_MESSAGE,
  cancelProblem,
  dateLine,
  datesProblem,
  editProblem,
  isClosed,
  isSamePayment,
  matchesCustomerQuery,
  matchesOrderSearch,
  newCustomerPrefill,
  nextStatuses,
  offeredActions,
  orderReadyText,
  orderReceiptText,
  parseOrderTab,
  payNowCaption,
  paymentExceedsMessage,
  paymentProblem,
  parseDetailAction,
  paymentRoom,
  pickCustomers,
  sortOrdersNewest,
  tabCounts,
  tabMatches,
  tenantLabel,
  totalBelowPaidMessage,
  transitionProblem,
  validatePaymentEdit,
} from './orderUtils'

const order = (status: OrderStatus, extra: Partial<Order> = {}) => ({
  id: 'o1',
  order_number: 'LD-202610-0007',
  discount: 0,
  status,
  received_at: '2026-10-19',
  promised_at: '2026-10-22',
  ready_at: null,
  picked_up_at: null,
  created_at: '2026-10-19T02:00:00.000Z',
  ...extra,
})

describe('messages', () => {
  it('formats the amounts in rupiah', () => {
    expect(paymentExceedsMessage(25_000)).toBe('Jumlah melebihi sisa bayar (Rp 25.000).')
    expect(totalBelowPaidMessage(45_000)).toBe('Total pesanan tidak boleh lebih kecil dari yang sudah dibayar (Rp 45.000).')
  })
})

describe('order dates', () => {
  it('needs a received date; the promised date is optional but never before it', () => {
    expect(datesProblem('2026-10-19', '2026-10-22')).toBeNull()
    expect(datesProblem('2026-10-19', '2026-10-19')).toBeNull()
    expect(datesProblem('2026-10-19', null)).toBeNull()
    expect(datesProblem('2026-10-19', '')).toBeNull()
    expect(datesProblem('', '2026-10-22')).toBe(RECEIVED_DATE_MESSAGE)
    expect(datesProblem('2026-10-19', '22/10/2026')).toBe(PROMISED_DATE_MESSAGE)
    expect(datesProblem('2026-10-19', '2026-10-18')).toBe(PROMISED_BEFORE_RECEIVED_MESSAGE)
  })
})

describe('list tabs and search', () => {
  it('reads the tab from the URL, Semua for anything unknown', () => {
    expect(parseOrderTab('siap')).toBe('siap')
    expect(parseOrderTab('selesai')).toBe('selesai')
    expect(parseOrderTab('dibatalkan')).toBe('semua')
    expect(parseOrderTab(null)).toBe('semua')
  })

  it('Semua lists every status, cancelled included; the other tabs one status each', () => {
    expect(tabMatches('semua', 'cancelled')).toBe(true)
    expect(tabMatches('diterima', 'received')).toBe(true)
    expect(tabMatches('proses', 'processing')).toBe(true)
    expect(tabMatches('siap', 'ready')).toBe(true)
    expect(tabMatches('selesai', 'done')).toBe(true)
    expect(tabMatches('selesai', 'cancelled')).toBe(false)
    expect(tabMatches('diterima', 'processing')).toBe(false)
    expect(tabCounts([{ status: 'received' }, { status: 'ready' }, { status: 'ready' }, { status: 'cancelled' }, { status: 'done' }])).toEqual({
      semua: 5,
      diterima: 1,
      proses: 0,
      siap: 2,
      selesai: 1,
    })
  })

  it('searches the order number, the customer name and the phone digits', () => {
    const customer = { name: 'Rina Putri', phone: '0812-0000-0001' }
    expect(matchesOrderSearch(order('received'), customer, '')).toBe(true)
    expect(matchesOrderSearch(order('received'), customer, 'ld-202610-0007')).toBe(true)
    expect(matchesOrderSearch(order('received'), customer, '0007')).toBe(true)
    expect(matchesOrderSearch(order('received'), customer, 'rina')).toBe(true)
    expect(matchesOrderSearch(order('received'), customer, 'PUTRI')).toBe(true)
    expect(matchesOrderSearch(order('received'), customer, 'dimas')).toBe(false)
    expect(matchesOrderSearch(order('received'), undefined, 'rina')).toBe(false)
  })

  it('matches a phone typed as 0812… against +62812… and the other way round, from 3 digits', () => {
    expect(matchesCustomerQuery({ name: 'A', phone: '+6281200000001' }, '0812 0000')).toBe(true)
    expect(matchesCustomerQuery({ name: 'A', phone: '0812-0000-0001' }, '+62812')).toBe(true)
    expect(matchesCustomerQuery({ name: 'A', phone: '0812-0000-0001' }, '0001')).toBe(true)
    expect(matchesCustomerQuery({ name: 'A', phone: '0812-0000-0001' }, '01')).toBe(false)
    expect(matchesCustomerQuery({ name: 'A', phone: null }, '0812')).toBe(false)
  })

  it('sorts newest first: received date, then the time it was entered', () => {
    const rows = [
      order('done', { id: 'a', received_at: '2026-10-17', created_at: '2026-10-17T03:00:00Z' }),
      order('done', { id: 'b', received_at: '2026-10-19', created_at: '2026-10-19T01:00:00Z' }),
      order('done', { id: 'c', received_at: '2026-10-19', created_at: '2026-10-19T05:00:00Z' }),
    ]
    expect(sortOrdersNewest(rows).map((o) => o.id)).toEqual(['c', 'b', 'a'])
    expect(rows.map((o) => o.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('customer picker', () => {
  const customers = [
    { id: 'c1', name: 'Andi Wijaya', phone: '0812-0000-0008' },
    { id: 'c2', name: 'Bu Wati', phone: '0812-0000-0007' },
    { id: 'c3', name: 'Mega', phone: null },
    { id: 'c4', name: 'Rina Andini', phone: '0812-0000-0001' },
  ]
  const orders = [
    { customer_id: 'c2', received_at: '2026-10-10', status: 'done' as const },
    { customer_id: 'c3', received_at: '2026-10-18', status: 'done' as const },
    { customer_id: 'c1', received_at: '2026-10-19', status: 'cancelled' as const },
  ]

  it('without a query: the latest visitors first (cancelled orders do not count), then by name', () => {
    expect(pickCustomers(customers, orders, '').map((c) => c.id)).toEqual(['c3', 'c2', 'c1', 'c4'])
    expect(pickCustomers(customers, orders, '', 2).map((c) => c.id)).toEqual(['c3', 'c2'])
  })

  it('with a query: names starting with it first, then the other matches', () => {
    expect(pickCustomers(customers, orders, 'andi').map((c) => c.id)).toEqual(['c1', 'c4'])
    expect(pickCustomers(customers, orders, '0007').map((c) => c.id)).toEqual(['c2'])
    expect(pickCustomers(customers, orders, 'zzz')).toEqual([])
  })

  it('Tambah pelanggan baru starts from what was searched', () => {
    expect(newCustomerPrefill('Ibu Tini')).toEqual({ name: 'Ibu Tini', phone: '' })
    expect(newCustomerPrefill(' 0812-3456 ')).toEqual({ name: '', phone: '0812-3456' })
    expect(newCustomerPrefill('+62 812')).toEqual({ name: '', phone: '+62 812' })
    expect(newCustomerPrefill('12')).toEqual({ name: '12', phone: '' })
    expect(newCustomerPrefill('')).toEqual({ name: '', phone: '' })
  })
})

describe('status machine (SPEC 3.3)', () => {
  it('moves forward only; Siap diambil straight from Diterima; Batalkan from Diterima/Proses', () => {
    expect(nextStatuses('received')).toEqual(['processing', 'ready', 'cancelled'])
    expect(nextStatuses('processing')).toEqual(['ready', 'cancelled'])
    expect(nextStatuses('ready')).toEqual(['done'])
    expect(nextStatuses('done')).toEqual([])
    expect(nextStatuses('cancelled')).toEqual([])
    expect(transitionProblem('received', 'ready')).toBeNull()
    expect(transitionProblem('ready', 'done')).toBeNull()
    expect(transitionProblem('processing', 'received')).toBe('Pesanan Proses tidak dapat diubah menjadi Diterima.')
    expect(transitionProblem('received', 'done')).toBe('Pesanan Diterima tidak dapat diubah menjadi Selesai.')
    expect(transitionProblem('ready', 'cancelled')).toBe('Pesanan Siap diambil tidak dapat diubah menjadi Dibatalkan.')
    expect(transitionProblem('done', 'done')).toBe('Status pesanan tidak berubah.')
  })

  it('cancel: only Diterima/Proses and only without payments', () => {
    expect(cancelProblem(order('received'), [])).toBeNull()
    expect(cancelProblem(order('processing'), [{ order_id: 'other' }])).toBeNull()
    expect(cancelProblem(order('processing'), [{ order_id: 'o1' }])).toBe(CANCEL_WITH_PAYMENTS_MESSAGE)
    expect(cancelProblem(order('ready'), [])).toBe(CANCEL_STATUS_MESSAGE)
    expect(cancelProblem(order('cancelled'), [])).toBe(CANCEL_STATUS_MESSAGE)
  })

  it('edit: everyone while open; owner/admin only once Selesai or Dibatalkan', () => {
    for (const s of ['received', 'processing', 'ready'] as const) expect(editProblem(order(s), false)).toBeNull()
    expect(editProblem(order('done'), false)).toBe(DONE_ORDER_ADMIN_MESSAGE)
    expect(editProblem(order('cancelled'), false)).toBe(DONE_ORDER_ADMIN_MESSAGE)
    expect(editProblem(order('done'), true)).toBeNull()
    expect(isClosed(order('done'))).toBe(true)
    expect(isClosed(order('cancelled'))).toBe(true)
    expect(isClosed(order('ready'))).toBe(false)
  })
})

describe('offeredActions (detail page buttons)', () => {
  const keys = (status: OrderStatus, ctx: { hasPayments?: boolean; outstanding?: number; isAdmin?: boolean } = {}) =>
    offeredActions(order(status), { hasPayments: false, outstanding: 0, isAdmin: false, ...ctx }).map((a) => (a.disabledReason ? `${a.key}!` : a.key))

  it('per status for staff', () => {
    expect(keys('received', { outstanding: 10_000 })).toEqual(['process', 'ready', 'pay', 'edit', 'cancel'])
    expect(keys('processing')).toEqual(['ready', 'edit', 'cancel'])
    expect(keys('ready', { outstanding: 5_000, hasPayments: true })).toEqual(['pickup', 'pay', 'edit'])
    expect(keys('done')).toEqual([])
    expect(keys('done', { outstanding: 5_000 })).toEqual(['pay'])
    expect(keys('cancelled')).toEqual([])
  })

  it('Batalkan is shown but off once a payment exists; owner/admin also get Ubah after Selesai and Hapus', () => {
    expect(keys('received', { hasPayments: true })).toEqual(['process', 'ready', 'edit', 'cancel!'])
    expect(keys('done', { isAdmin: true })).toEqual(['edit', 'delete'])
    expect(keys('cancelled', { isAdmin: true })).toEqual(['edit', 'delete'])
    expect(keys('received', { isAdmin: true })).toEqual(['process', 'ready', 'edit', 'cancel', 'delete'])
  })
})

describe('detail deep links', () => {
  it('?aksi=diambil and ?aksi=bayar open their dialogs; anything else none', () => {
    expect(parseDetailAction('diambil')).toBe('pickup')
    expect(parseDetailAction('bayar')).toBe('pay')
    expect(parseDetailAction('hapus')).toBeNull()
    expect(parseDetailAction(null)).toBeNull()
  })
})

describe('payments (SPEC 3.5)', () => {
  it('Bayar sekarang caption: Lunas or DP with what is left', () => {
    expect(payNowCaption(0, 45_000)).toBe('')
    expect(payNowCaption(20_000, 45_000)).toBe('DP · sisa Rp 25.000')
    expect(payNowCaption(45_000, 45_000)).toBe('Lunas')
  })

  it('a payment is a whole positive amount up to the outstanding, never on a cancelled or paid order', () => {
    expect(paymentProblem(10_000, order('received'), { outstanding: 24_000 })).toBeNull()
    expect(paymentProblem(24_000, order('done'), { outstanding: 24_000 })).toBeNull()
    expect(paymentProblem(24_001, order('received'), { outstanding: 24_000 })).toBe(paymentExceedsMessage(24_000))
    expect(paymentProblem(0, order('received'), { outstanding: 24_000 })).toBe(PAYMENT_POSITIVE_MESSAGE)
    expect(paymentProblem(10.5, order('received'), { outstanding: 24_000 })).toBe(PAYMENT_POSITIVE_MESSAGE)
    expect(paymentProblem(1_000, order('received'), { outstanding: 0 })).toBe(ORDER_PAID_MESSAGE)
    expect(paymentProblem(1_000, order('cancelled'), { outstanding: 0 })).toBe(CANCELLED_PAYMENT_MESSAGE)
  })

  const items = [
    { order_id: 'o1', line_total: 20_000 },
    { order_id: 'o1', line_total: 25_000 },
    { order_id: 'o2', line_total: 99_000 },
  ]
  const payments = [
    { id: 'p1', order_id: 'o1', amount: 20_000 },
    { id: 'p2', order_id: 'o1', amount: 10_000 },
    { id: 'p3', order_id: 'o2', amount: 5_000 },
  ]

  it('Ubah pembayaran: at most what the order owes without this payment', () => {
    expect(paymentRoom({ id: 'p1' }, order('received'), items, payments)).toBe(35_000)
    expect(paymentRoom({ id: 'p2' }, order('received', { discount: 5_000 }), items, payments)).toBe(20_000)
    const patch = { amount: 35_000, paid_at: '2026-10-19', method: 'cash' as const, notes: null }
    expect(validatePaymentEdit({ id: 'p1' }, patch, order('received'), items, payments)).toBeNull()
    expect(validatePaymentEdit({ id: 'p1' }, { ...patch, amount: 35_001 }, order('received'), items, payments)).toBe('Jumlah melebihi sisa bayar pesanan LD-202610-0007 (Rp 35.000).')
    expect(validatePaymentEdit({ id: 'p1' }, { ...patch, amount: 0 }, order('received'), items, payments)).toBe(PAYMENT_POSITIVE_MESSAGE)
    expect(validatePaymentEdit({ id: 'p1' }, { ...patch, paid_at: '' }, order('received'), items, payments)).toBe(PAYMENT_DATE_MESSAGE)
  })

  it('isSamePayment: a blank note equals no note', () => {
    const p = { amount: 10_000, paid_at: '2026-10-19', method: 'cash' as const, notes: null }
    expect(isSamePayment(p, { ...p, notes: '  ' })).toBe(true)
    expect(isSamePayment(p, { ...p, notes: 'DP' })).toBe(false)
    expect(isSamePayment(p, { ...p, amount: 9_000 })).toBe(false)
    expect(isSamePayment(p, { ...p, method: 'qris' })).toBe(false)
    expect(isSamePayment(p, { ...p, paid_at: '2026-10-18' })).toBe(false)
  })
})

describe('WhatsApp texts (SPEC 3.9)', () => {
  const org = { name: 'EG Laundry', wa_footer: 'Buka 07.00-21.00' }
  const lines = [
    { service_name: 'Cuci setrika', qty: 2.5, unit: 'kg' as const },
    { service_name: 'Bed cover', qty: 1, unit: 'pcs' as const },
  ]
  const o = order('received')

  it('struk masuk with the DP taken', () => {
    const text = orderReceiptText(o, lines, { total: 45_000, paid: 20_000 }, { name: 'Rina Putri' }, org)
    expect(text).toBe(
      `Halo Rina Putri, terima kasih sudah mencuci di EG Laundry. Pesanan LD-202610-0007 (${formatDate('2026-10-19')}): Cuci setrika 2,5 kg, Bed cover 1 pcs. Total Rp 45.000, DP Rp 20.000. Perkiraan selesai ${formatDate('2026-10-22')}.\nBuka 07.00-21.00`,
    )
  })

  it('struk masuk without a payment, and paid in full (lunas, not DP)', () => {
    expect(orderReceiptText(o, lines, { total: 45_000, paid: 0 }, { name: 'Rina' }, org)).toContain('Total Rp 45.000. Perkiraan')
    const full = orderReceiptText(o, lines, { total: 45_000, paid: 45_000 }, { name: 'Rina' }, { name: 'EG Laundry', wa_footer: null })
    expect(full).toContain('Total Rp 45.000 (lunas). Perkiraan')
    expect(full).not.toContain('DP')
    expect(orderReceiptText(o, lines, { total: 0, paid: 0 }, undefined, org)).toMatch(/^Halo Pelanggan,/)
  })

  it('siap diambil with what is left, or lunas', () => {
    expect(orderReadyText(o, lines, { total: 45_000, outstanding: 25_000 }, { name: 'Rina' }, org)).toBe(
      'Halo Rina, cucian Anda di EG Laundry sudah siap diambil 😊 Pesanan LD-202610-0007: Cuci setrika 2,5 kg, Bed cover 1 pcs · Total Rp 45.000 (sisa Rp 25.000).\nBuka 07.00-21.00',
    )
    expect(orderReadyText(o, lines, { total: 45_000, outstanding: 0 }, { name: 'Rina' }, org)).toContain('Total Rp 45.000 (lunas).')
  })
})

describe('display', () => {
  it('tenant label with the room', () => {
    expect(tenantLabel({ is_tenant: true, room_name: ' B3 ' })).toBe('Anak kos · B3')
    expect(tenantLabel({ is_tenant: true, room_name: null })).toBe('Anak kos')
    expect(tenantLabel({ is_tenant: false, room_name: 'B3' })).toBeNull()
    expect(tenantLabel(undefined)).toBeNull()
  })

  it('the date line: the promise while open (late after the day), ready/picked up times afterwards', () => {
    const today = '2026-10-23'
    expect(dateLine(order('received'), today)).toEqual({ label: 'Perkiraan selesai', date: '2026-10-22', late: true })
    expect(dateLine(order('processing'), '2026-10-22')).toEqual({ label: 'Perkiraan selesai', date: '2026-10-22', late: false })
    expect(dateLine(order('ready', { ready_at: '2026-10-21T08:00:00Z' }), today)).toEqual({ label: 'Siap sejak', date: '2026-10-21T08:00:00Z', late: false })
    expect(dateLine(order('done', { picked_up_at: '2026-10-22T08:00:00Z' }), today)).toEqual({ label: 'Diambil', date: '2026-10-22T08:00:00Z', late: false })
    expect(dateLine(order('cancelled'), today)).toEqual({ label: null, date: null, late: false })
  })
})
