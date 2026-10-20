import { useMemo, useState } from 'react'
import { Button, Input, Modal, MoneyInput, Row, Switch, Textarea, useToast } from '../../components/ui'
import { ORDER_STATUS_LABEL, type Order, type OrderItem, type Service } from '../../types/db'
import { ERR_PAYMENT_EXCEEDS, orderTotals, promisedDate, validateOrderDraft } from '../../domain/pricing'
import type { LaundryData } from '../../hooks/useLaundryData'
import { formatDate, formatRupiah } from '../../lib/format'
import { RecordHistory } from '../settings/audit/RecordHistory'
import { draftLines, draftSummary, keepOldPrices, packageChoice, rowPackageChoice, rowProblem, rowsFromItems, rowsToDraftItems, type DraftRow } from './orderForm'
import { datesProblem, isClosed, totalBelowPaidMessage } from './orderUtils'
import { OrderItemsEditor } from './OrderItemsEditor'
import type { OrderActions } from './useOrderActions'

type ModalData = Pick<LaundryData, 'services' | 'serviceById' | 'customerPackages' | 'packagesByCustomer' | 'orderItems' | 'orders' | 'payments'>

/**
 * Ubah pesanan (SPEC 3.3): lines, quantities, express, dates, discount and notes. Open orders: everyone; after
 * Selesai/Dibatalkan the page offers it to owner/admin only (and the hook refuses staff). Lines that still bill the
 * same service the same way keep the price the order was made with (keepOldPrices); the new total may not drop
 * under what was paid. Mounted only while open, so the fields start from the order every time.
 */
export function EditOrderModal({ order, items, data, actions, onClose }: { order: Order; items: OrderItem[]; data: ModalData; actions: OrderActions; onClose: () => void }) {
  const toast = useToast()
  const [rows, setRows] = useState<DraftRow[]>(() => rowsFromItems(items))
  const [express, setExpress] = useState(order.express)
  const [receivedAt, setReceivedAt] = useState(order.received_at)
  const servicesOf = (rs: Pick<DraftRow, 'service_id'>[]) => rs.map((r) => data.serviceById.get(r.service_id)).filter((s): s is Service => s !== undefined)
  // a promised date that is still the computed one keeps following the lines; one typed by hand stays
  const [promisedAuto, setPromisedAuto] = useState(() => order.promised_at === null || order.promised_at === promisedDate(order.received_at, servicesOf(rowsFromItems(items)), order.express))
  const [promisedAt, setPromisedAt] = useState(order.promised_at ?? '')
  const [discount, setDiscount] = useState(order.discount)
  const [notes, setNotes] = useState(order.notes ?? '')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const keepIds = useMemo(() => new Set(items.filter((i) => i.service_id === null).map((i) => i.id)), [items])
  const view = keepOldPrices(rows, items, data.services, express, order.express)
  const lines = draftLines(view.lines, view.services, express)
  const summary = draftSummary(lines, discount)
  const paid = orderTotals(order, data.orderItems, data.payments).paid
  const autoPromised = promisedDate(receivedAt || order.received_at, servicesOf(rows), express)
  const promised = promisedAuto ? autoPromised : promisedAt
  const draftItems = rowsToDraftItems(rows, keepIds)
  const customerPackages = data.packagesByCustomer.get(order.customer_id) ?? []

  const errors: string[] = []
  const add = (e: string | null) => {
    if (e && !errors.includes(e)) errors.push(e)
  }
  add(rowProblem(rows, keepIds))
  add(datesProblem(receivedAt, promised))
  const check = keepOldPrices(draftItems, items, data.services, express, order.express)
  for (const e of validateOrderDraft(
    { customer_id: order.customer_id, received_at: receivedAt, express, discount, items: check.lines, payment: paid },
    { services: check.services, packages: data.customerPackages, orderItems: data.orderItems, orders: data.orders, excludeOrderId: order.id },
  )) {
    add(e === ERR_PAYMENT_EXCEEDS ? totalBelowPaidMessage(paid) : e)
  }

  const packageFor = (row: DraftRow) =>
    rowPackageChoice(packageChoice(customerPackages, order.customer_id, row.service_id, receivedAt, data.orderItems, data.orders, order.id), rows, data.services, row)

  const submit = async () => {
    setSubmitted(true)
    if (errors.length > 0) {
      toast.error(errors[0])
      return
    }
    setSaving(true)
    try {
      await actions.updateOrder(order, { received_at: receivedAt, promised_at: promisedAuto ? null : promisedAt, express, discount, notes, items: draftItems }, data)
      toast.success(`Pesanan ${order.order_number} diperbarui.`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memperbarui pesanan.')
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Ubah ${order.order_number}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" className="h-11" onClick={onClose}>
            Batal
          </Button>
          <Button className="h-11" onClick={() => void submit()} loading={saving}>
            Simpan perubahan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {isClosed(order) && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{`Pesanan ini sudah ${ORDER_STATUS_LABEL[order.status]}: hanya pemilik/admin yang dapat mengubahnya.`}</p>
        )}
        <Switch label="Express" hint={express ? 'Harga express' : 'Reguler'} checked={express} onChange={setExpress} />
        <OrderItemsEditor rows={rows} onChange={setRows} services={data.services} express={express} lines={lines} kept={view.kept} packageFor={packageFor} existing={items} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Tanggal masuk" type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} required className="h-11" />
          <div className="space-y-1">
            <Input
              label="Perkiraan selesai"
              type="date"
              value={promised}
              min={receivedAt || undefined}
              onChange={(e) => {
                setPromisedAt(e.target.value)
                setPromisedAuto(false)
              }}
              className="h-11"
              hint={promisedAuto ? 'Otomatis dari lama pengerjaan layanan.' : undefined}
            />
            {!promisedAuto && (
              <button type="button" onClick={() => setPromisedAuto(true)} className="min-h-11 text-left text-xs font-medium text-brand-700 hover:underline">
                {`Hitung otomatis (${formatDate(autoPromised)})`}
              </button>
            )}
          </div>
        </div>
        <MoneyInput label="Diskon" value={discount} onChange={setDiscount} min={0} className="h-11" />
        <Textarea label="Catatan" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="opsional" />
        <div className="space-y-1 rounded-lg bg-slate-50 p-3">
          <Row label="Subtotal" value={formatRupiah(summary.subtotal)} />
          <Row label="Diskon" value={summary.discount > 0 ? `− ${formatRupiah(summary.discount)}` : formatRupiah(0)} />
          <Row label="Total" value={formatRupiah(summary.total)} strong />
          {paid > 0 && <Row label="Sudah dibayar" value={formatRupiah(paid)} />}
        </div>
        {submitted && errors.length > 0 && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <ul className="list-disc space-y-0.5 pl-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        <RecordHistory table="orders" rowId={order.id} />
      </div>
    </Modal>
  )
}
