import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeft, Package, Save } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, ErrorState, Input, LoadingState, MoneyInput, PageHeader, Textarea, useToast } from '../../components/ui'
import { useLaundryData } from '../../hooks/useLaundryData'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type PaymentMethod, type Service } from '../../types/db'
import { promisedDate, validateOrderDraft } from '../../domain/pricing'
import { formatDate, formatQty, formatRupiah, todayISO } from '../../lib/format'
import { draftLines, draftSummary, newDraftRow, packageChoice, rowPackageChoice, rowProblem, rowsToDraftItems, usablePackages, type DraftRow } from './orderForm'
import { datesProblem, payNowCaption } from './orderUtils'
import { OrderItemsEditor } from './OrderItemsEditor'
import { CustomerPicker } from './CustomerPicker'
import { Row, Segmented, Switch } from './components'
import { PartialSaveError, useOrderActions } from './useOrderActions'

const METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ key: m, label: PAYMENT_METHOD_LABEL[m] }))

/**
 * Pesanan baru (SPEC 3.3, 3.4, 3.5, 3.12): customer (search or add with name + phone), service lines (kg in 0,5
 * steps, pcs whole, "Pakai paket" when the customer has a usable package), express, received and promised dates
 * (promised computed from the services until edited), discount, notes, live totals and an optional payment (DP or
 * lunas). Simpan validates the whole draft, saves through useOrderActions.createOrder and opens the order, where the
 * WhatsApp receipt is one tap away. `?customer=<id>` starts with that customer chosen.
 */
export function NewOrderPage() {
  const data = useLaundryData()
  const actions = useOrderActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [customerId, setCustomerId] = useState<string | null>(params.get('customer'))
  const [rows, setRows] = useState<DraftRow[]>(() => [newDraftRow()])
  const [express, setExpress] = useState(false)
  const [receivedAt, setReceivedAt] = useState(() => todayISO())
  /** null = computed from the services (promisedDate) */
  const [promisedAt, setPromisedAt] = useState<string | null>(null)
  const [discount, setDiscount] = useState(0)
  const [notes, setNotes] = useState('')
  const [payNow, setPayNow] = useState(false)
  /** null = follows the total (lunas) */
  const [payAmount, setPayAmount] = useState<number | null>(null)
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash')
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)

  const customer = customerId ? data.customerById.get(customerId) : undefined
  const chosenId = customer?.id ?? null
  const customerPackages = useMemo(() => (chosenId ? (data.packagesByCustomer.get(chosenId) ?? []) : []), [chosenId, data.packagesByCustomer])

  const lines = useMemo(() => draftLines(rows, data.services, express), [rows, data.services, express])
  const summary = draftSummary(lines, discount)
  const rowServices = useMemo(() => rows.map((r) => data.serviceById.get(r.service_id)).filter((s): s is Service => s !== undefined), [rows, data.serviceById])
  const autoPromised = promisedDate(receivedAt || todayISO(), rowServices, express)
  const promised = promisedAt ?? autoPromised
  const payment = payNow ? (payAmount ?? summary.total) : 0

  const draftItems = useMemo(() => rowsToDraftItems(rows), [rows])
  // cheap enough to recompute on every keystroke: the form shows exactly what Simpan would refuse
  const errors: string[] = []
  const addError = (e: string | null) => {
    if (e && !errors.includes(e)) errors.push(e)
  }
  addError(rowProblem(rows))
  addError(datesProblem(receivedAt, promised))
  for (const e of validateOrderDraft(
    { customer_id: chosenId, received_at: receivedAt, express, discount, items: draftItems, payment },
    { services: data.services, packages: data.customerPackages, orderItems: data.orderItems, orders: data.orders },
  )) {
    addError(e)
  }

  const chooseCustomer = (id: string | null) => {
    setCustomerId(id)
    // a package belongs to one customer: the lines start over without one
    setRows((rs) => rs.map((r) => (r.customer_package_id ? { ...r, customer_package_id: null } : r)))
  }

  const packageFor = (row: DraftRow) =>
    rowPackageChoice(packageChoice(customerPackages, chosenId, row.service_id, receivedAt, data.orderItems, data.orders), rows, data.services, row)

  const save = async () => {
    setSubmitted(true)
    if (errors.length > 0) {
      toast.error(errors[0])
      return
    }
    setSaving(true)
    try {
      const result = await actions.createOrder(
        {
          customer_id: chosenId,
          received_at: receivedAt,
          promised_at: promisedAt,
          express,
          discount,
          notes,
          items: draftItems.map((it) => ({ service_id: it.service_id, qty: it.qty, customer_package_id: it.customer_package_id, notes: it.notes })),
          payment: payment > 0 ? { amount: payment, method: payMethod } : null,
        },
        data,
      )
      toast.success(`Pesanan ${result.order.order_number} tersimpan.`)
      navigate(`/pesanan/${result.order.id}?baru=1`, { replace: true })
    } catch (err) {
      if (err instanceof PartialSaveError) {
        toast.error(err.message)
        navigate(`/pesanan/${err.order.id}`, { replace: true })
        return
      }
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan pesanan.')
      setSaving(false)
    }
  }

  if (data.isPending) return <LoadingState />
  if (data.error) return <ErrorState error={data.error} />

  const packagesNow = usablePackages(customerPackages, chosenId, receivedAt, data.orderItems, data.orders)
  const caption = payNowCaption(payment, summary.total)

  return (
    <>
      <div className="mb-2">
        <Link to="/pesanan" className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Semua pesanan
        </Link>
      </div>
      <PageHeader title="Pesanan baru" subtitle="Catat cucian yang masuk" />

      <div className="space-y-4">
        <Card>
          <CardHeader title="Pelanggan" />
          <CardBody>
            <CustomerPicker
              customers={data.customers}
              orders={data.orders}
              value={customer}
              onChange={chooseCustomer}
              onCreate={actions.createCustomer}
              chosenExtra={
                packagesNow.length > 0 ? (
                  <ul className="space-y-1" aria-label="Paket pelanggan">
                    {packagesNow.map(({ pkg, remaining }) => (
                      <li key={pkg.id} className="flex items-start gap-2 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-900">
                        <Package className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span>
                          {`${pkg.name} · sisa ${formatQty(remaining, data.serviceById.get(pkg.service_id)?.unit ?? 'kg')}`}
                          {pkg.expires_at && ` · berlaku s/d ${formatDate(pkg.expires_at)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : undefined
              }
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Layanan" subtitle="kg boleh pecahan (0,5); pcs bilangan bulat" />
          <CardBody className="space-y-3">
            <Switch label="Express" hint={express ? 'Harga express, selesai lebih cepat' : 'Reguler'} checked={express} onChange={setExpress} />
            <OrderItemsEditor rows={rows} onChange={setRows} services={data.services} express={express} lines={lines} packageFor={packageFor} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tanggal" />
          <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Tanggal masuk" type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} required className="h-11" />
            <div className="space-y-1">
              <Input
                label="Perkiraan selesai"
                type="date"
                value={promised}
                min={receivedAt || undefined}
                onChange={(e) => setPromisedAt(e.target.value || null)}
                className="h-11"
                hint={promisedAt === null ? 'Otomatis dari lama pengerjaan layanan.' : undefined}
              />
              {promisedAt !== null && (
                <button type="button" onClick={() => setPromisedAt(null)} className="min-h-11 text-left text-xs font-medium text-brand-700 hover:underline">
                  {`Hitung otomatis (${formatDate(autoPromised)})`}
                </button>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Diskon & catatan" />
          <CardBody className="space-y-3">
            <MoneyInput label="Diskon" value={discount} onChange={setDiscount} min={0} className="h-11" />
            <Textarea label="Catatan" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="opsional, mis. noda kopi, tas biru" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Ringkasan" />
          <CardBody className="space-y-1.5" data-testid="order-summary">
            <Row label="Subtotal" value={formatRupiah(summary.subtotal)} />
            <Row label="Diskon" value={summary.discount > 0 ? `− ${formatRupiah(summary.discount)}` : formatRupiah(0)} />
            <Row label="Total" value={<span data-testid="draft-total">{formatRupiah(summary.total)}</span>} strong className="border-t border-slate-100 pt-1.5 text-base" />
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-3">
            <Switch label="Bayar sekarang" hint={payNow ? caption || 'Isi jumlah yang dibayar' : 'DP atau lunas saat pesanan masuk'} checked={payNow} onChange={setPayNow} />
            {payNow && (
              <>
                <MoneyInput
                  label="Jumlah dibayar"
                  value={payment}
                  onChange={(v) => setPayAmount(v)}
                  min={0}
                  className="h-11"
                  hint={payAmount === null ? 'Sama dengan total (lunas). Ubah untuk DP.' : undefined}
                />
                {payAmount !== null && payAmount !== summary.total && (
                  <button type="button" onClick={() => setPayAmount(null)} className="min-h-11 text-left text-xs font-medium text-brand-700 hover:underline">
                    {`Bayar lunas (${formatRupiah(summary.total)})`}
                  </button>
                )}
                <Segmented label="Metode bayar" value={payMethod} options={METHOD_OPTIONS} onChange={setPayMethod} />
              </>
            )}
          </CardBody>
        </Card>

        {submitted && errors.length > 0 && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" data-testid="form-errors">
            <p className="font-medium">Pesanan belum dapat disimpan:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">Total</p>
            <p className="text-lg font-semibold tabular-nums text-slate-900">{formatRupiah(summary.total)}</p>
          </div>
          <Button size="lg" icon={<Save className="h-5 w-5" aria-hidden />} loading={saving} onClick={() => void save()}>
            Simpan pesanan
          </Button>
        </div>
      </div>
    </>
  )
}
