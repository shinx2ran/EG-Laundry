import { useState } from 'react'
import { Button, Input, Modal, MoneyInput, Row, Segmented, Switch, Textarea, useToast } from '../../components/ui'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Customer, type Order, type Payment, type PaymentMethod } from '../../types/db'
import type { OrderTotals } from '../../domain/pricing'
import { formatRupiah, todayISO } from '../../lib/format'
import { RecordHistory } from '../settings/audit/RecordHistory'
import { DATE_RE, PAYMENT_DATE_MESSAGE, isSamePayment, paymentProblem, paymentRoom, validatePaymentEdit, type PaymentEditPatch } from './orderUtils'
import { PaymentSavedError, type ActionContext, type OrderActions } from './useOrderActions'

const METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ key: m, label: PAYMENT_METHOD_LABEL[m] }))

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

// The dialogs below are mounted only while open (the page renders them conditionally), so their fields start from
// the current figures every time without syncing state in an effect.

/** Terima pembayaran (SPEC 3.5): any time something is owed; the amount starts at the outstanding and may be less. */
export function ReceivePaymentModal({ order, totals, ctx, actions, onClose }: { order: Order; totals: OrderTotals; ctx: ActionContext; actions: OrderActions; onClose: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState(totals.outstanding)
  const [paidAt, setPaidAt] = useState(() => todayISO())
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const error = paymentProblem(amount, order, totals) ?? (DATE_RE.test(paidAt) ? null : PAYMENT_DATE_MESSAGE)

  const submit = async () => {
    if (error) return
    setSaving(true)
    try {
      await actions.recordPayment(order, { amount, method, paid_at: paidAt, notes }, ctx)
      const left = totals.outstanding - amount
      toast.success(left > 0 ? `Pembayaran ${formatRupiah(amount)} dicatat. Sisa ${formatRupiah(left)}.` : `Pembayaran ${formatRupiah(amount)} dicatat. Lunas.`)
      onClose()
    } catch (err) {
      toast.error(errorText(err, 'Gagal mencatat pembayaran.'))
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Terima pembayaran"
      size="sm"
      footer={
        <>
          <Button variant="ghost" className="h-11" onClick={onClose}>
            Batal
          </Button>
          <Button className="h-11" onClick={() => void submit()} loading={saving} disabled={Boolean(error)}>
            Simpan pembayaran
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1 rounded-lg bg-slate-50 p-3">
          <Row label="Total pesanan" value={formatRupiah(totals.total)} />
          <Row label="Sudah dibayar" value={formatRupiah(totals.paid)} />
          <Row label="Sisa bayar" value={formatRupiah(totals.outstanding)} strong />
        </div>
        <MoneyInput label="Jumlah" value={amount} onChange={setAmount} min={0} required className="h-11" hint={`Paling banyak ${formatRupiah(totals.outstanding)}.`} />
        <Input label="Tanggal bayar" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required className="h-11" />
        <Segmented label="Metode bayar" value={method} options={METHOD_OPTIONS} onChange={setMethod} />
        <Input label="Catatan" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opsional" className="h-11" />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

/**
 * Diambil (SPEC 3.3): Siap → Selesai. While something is owed the same dialog offers to take it (on by default,
 * amount = the outstanding), written before the status changes. When the payment was saved but the status change
 * failed, the dialog switches to status only, so a retry never records the same money twice.
 */
export function PickupModal({ order, totals, customer, ctx, actions, onClose }: { order: Order; totals: OrderTotals; customer: Customer | undefined; ctx: ActionContext; actions: OrderActions; onClose: () => void }) {
  const toast = useToast()
  const owes = totals.outstanding > 0
  const [takePayment, setTakePayment] = useState(owes)
  const [amount, setAmount] = useState(totals.outstanding)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [saving, setSaving] = useState(false)
  const [savedPayment, setSavedPayment] = useState<number | null>(null)
  const paying = owes && takePayment
  const error = paying ? paymentProblem(amount, order, totals) : null

  const submit = async () => {
    if (error) return
    setSaving(true)
    try {
      await actions.markPickedUp(order, ctx, paying ? { amount, method } : null)
      const left = totals.outstanding - (paying ? amount : 0)
      toast.success(left > 0 ? `Pesanan ${order.order_number} diambil. Sisa bayar ${formatRupiah(left)}.` : `Pesanan ${order.order_number} diambil dan lunas.`)
      onClose()
    } catch (err) {
      if (err instanceof PaymentSavedError) {
        setTakePayment(false)
        setSavedPayment(err.payment.amount)
      }
      toast.error(errorText(err, 'Gagal menyimpan.'))
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Cucian diambil"
      size="sm"
      footer={
        <>
          <Button variant="ghost" className="h-11" onClick={onClose}>
            Batal
          </Button>
          <Button className="h-11" onClick={() => void submit()} loading={saving} disabled={Boolean(error)}>
            {paying ? 'Bayar & tandai diambil' : 'Tandai diambil'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{`Pesanan ${order.order_number}${customer ? ` milik ${customer.name}` : ''} sudah diambil? Status menjadi Selesai.`}</p>
        {savedPayment !== null && !paying && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{`Pembayaran ${formatRupiah(savedPayment)} sudah tercatat. Ketuk Tandai diambil untuk mengubah statusnya saja.`}</p>
        )}
        {owes ? (
          <>
            <div className="space-y-1 rounded-lg bg-amber-50 p-3">
              <Row label="Total pesanan" value={formatRupiah(totals.total)} />
              <Row label="Sudah dibayar" value={formatRupiah(totals.paid)} />
              <Row label="Sisa bayar" value={formatRupiah(totals.outstanding)} strong />
            </div>
            <Switch label="Terima pembayaran" hint="Pelunasan saat diambil" checked={takePayment} onChange={setTakePayment} />
            {takePayment && (
              <>
                <MoneyInput label="Jumlah" value={amount} onChange={setAmount} min={0} className="h-11" hint={`Paling banyak ${formatRupiah(totals.outstanding)}.`} />
                <Segmented label="Metode bayar" value={method} options={METHOD_OPTIONS} onChange={setMethod} />
              </>
            )}
            {!takePayment && <p className="text-xs text-amber-700">{`Sisa ${formatRupiah(totals.outstanding)} tetap tercatat sebagai belum bayar.`}</p>}
          </>
        ) : (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Pesanan sudah lunas.</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}

/** Ubah pembayaran (owner/admin; SPEC 3.5): amount up to what the order owes without it, date, method, note, history. */
export function EditPaymentModal({ payment, order, ctx, actions, onClose }: { payment: Payment; order: Order; ctx: ActionContext; actions: OrderActions; onClose: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState(payment.amount)
  const [paidAt, setPaidAt] = useState(payment.paid_at)
  const [method, setMethod] = useState<PaymentMethod>(payment.method)
  const [notes, setNotes] = useState(payment.notes ?? '')
  const [saving, setSaving] = useState(false)

  const patch: PaymentEditPatch = { amount, paid_at: paidAt, method, notes: notes.trim() || null }
  const error = validatePaymentEdit(payment, patch, order, ctx.orderItems, ctx.payments)
  const unchanged = isSamePayment(payment, patch)
  const room = paymentRoom(payment, order, ctx.orderItems, ctx.payments)

  const submit = async () => {
    if (error || unchanged) return
    setSaving(true)
    try {
      await actions.updatePayment(payment, patch, ctx)
      toast.success('Pembayaran diperbarui.')
      onClose()
    } catch (err) {
      toast.error(errorText(err, 'Gagal memperbarui pembayaran.'))
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Ubah pembayaran"
      size="sm"
      footer={
        <>
          <Button variant="ghost" className="h-11" onClick={onClose}>
            Batal
          </Button>
          <Button className="h-11" onClick={() => void submit()} loading={saving} disabled={Boolean(error) || unchanged}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{`Pesanan ${order.order_number}`}</p>
        <MoneyInput label="Jumlah" value={amount} onChange={setAmount} min={0} required className="h-11" hint={`Paling banyak ${formatRupiah(room)} (sisa pesanan tanpa pembayaran ini).`} />
        <Input label="Tanggal bayar" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required className="h-11" />
        <Segmented label="Metode bayar" value={method} options={METHOD_OPTIONS} onChange={setMethod} />
        <Textarea label="Catatan" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="opsional" />
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <RecordHistory table="payments" rowId={payment.id} />
      </div>
    </Modal>
  )
}
