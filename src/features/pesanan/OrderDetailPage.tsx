import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { ArrowLeft, Ban, CheckCircle2, PackageCheck, Pencil, Play, Plus, Shirt, Trash2, Wallet, X } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useLaundryData } from '../../hooks/useLaundryData'
import { PAYMENT_METHOD_LABEL, type Payment } from '../../types/db'
import { formatDate, formatDateTime, formatQty, formatRupiah, todayISO, whatsappLink } from '../../lib/format'
import { dateLine, offeredActions, orderReadyText, orderReceiptText, parseDetailAction, type OfferedAction, type OrderAction } from './orderUtils'
import { ExpressBadge, LateBadge, MissingPhoneLink, OrderStatusBadge, PayStatusBadge, Row, TenantBadge, WhatsAppLink } from './components'
import { EditPaymentModal, PickupModal, ReceivePaymentModal } from './OrderModals'
import { EditOrderModal } from './EditOrderModal'
import { useOrderActions } from './useOrderActions'
import { rowIconButtonClass } from './styles'

type Dialog = { kind: 'pay' } | { kind: 'pickup' } | { kind: 'edit' } | { kind: 'cancel' } | { kind: 'delete' } | { kind: 'edit-payment'; payment: Payment } | { kind: 'delete-payment'; payment: Payment }

const ACTION_LABEL: Record<OrderAction, string> = {
  process: 'Mulai proses',
  ready: 'Siap diambil',
  pickup: 'Diambil',
  pay: 'Terima pembayaran',
  edit: 'Ubah',
  cancel: 'Batalkan',
  delete: 'Hapus',
}

const ACTION_ICON: Record<OrderAction, typeof Play> = {
  process: Play,
  ready: CheckCircle2,
  pickup: PackageCheck,
  pay: Wallet,
  edit: Pencil,
  cancel: Ban,
  delete: Trash2,
}

/** The one step the order waits for, shown as the big button. */
function primaryAction(actions: OfferedAction[]): OrderAction | null {
  for (const key of ['ready', 'pickup', 'pay'] as const) if (actions.some((a) => a.key === key)) return key
  return null
}

/**
 * One order (SPEC 3.3, 3.5, 3.9, 3.10): number, status, express; customer with WhatsApp (or ➕ Nomor HP); items with
 * qty, price and line total; totals and payments (owner/admin may correct or delete one); the actions the status and
 * the role allow (Mulai proses, Siap diambil, Diambil with the remaining payment, Terima pembayaran, Ubah, Batalkan,
 * Hapus) and the WhatsApp texts: struk masuk and cucian siap diambil.
 */
export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { org } = useOrg()
  const data = useLaundryData()
  const actions = useOrderActions()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  // ?aksi=diambil / ?aksi=bayar (Dashboard) open that dialog once the order is there and allows it
  const [dialog, setDialog] = useState<Dialog | null>(() => {
    const kind = parseDetailAction(params.get('aksi'))
    return kind ? { kind } : null
  })
  const [busy, setBusy] = useState<OrderAction | 'confirm' | null>(null)
  const today = todayISO()
  const isAdmin = actions.isAdmin

  const order = id ? data.orderById.get(id) : undefined
  const items = useMemo(() => (id ? (data.itemsByOrder.get(id) ?? []) : []), [id, data.itemsByOrder])
  const payments = useMemo(
    () => [...(id ? (data.paymentsByOrder.get(id) ?? []) : [])].sort((a, b) => b.paid_at.localeCompare(a.paid_at) || b.created_at.localeCompare(a.created_at)),
    [id, data.paymentsByOrder],
  )

  if (data.isPending) return <LoadingState />
  if (data.error) return <ErrorState error={data.error} />
  if (!order) {
    return (
      <EmptyState
        title="Pesanan tidak ditemukan"
        description="Pesanan mungkin sudah dihapus atau tautannya salah."
        action={
          <Link to="/pesanan" className="inline-flex h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
            Kembali ke daftar pesanan
          </Link>
        }
      />
    )
  }

  const customer = data.customerById.get(order.customer_id)
  const totals = data.totalsFor(order)
  const offered = offeredActions(order, { hasPayments: payments.length > 0, outstanding: totals.outstanding, isAdmin })
  const primary = primaryAction(offered)
  const when = dateLine(order, today)
  const justCreated = params.get('baru') === '1'
  const cancelled = order.status === 'cancelled'

  const receiptLink = whatsappLink(customer?.phone, orderReceiptText(order, items, totals, customer, org))
  const readyLink = whatsappLink(customer?.phone, orderReadyText(order, items, totals, customer, org))

  const run = async (key: OrderAction, fn: () => Promise<unknown>, success: string) => {
    setBusy(key)
    try {
      await fn()
      toast.success(success)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.')
    } finally {
      setBusy(null)
    }
  }

  const onAction = (key: OrderAction) => {
    switch (key) {
      case 'process':
        return void run(key, () => actions.startProcessing(order), `Pesanan ${order.order_number} mulai diproses.`)
      case 'ready':
        return void run(key, () => actions.markReady(order), `Pesanan ${order.order_number} siap diambil.${customer?.phone ? ' Kabari pelanggan lewat WhatsApp.' : ''}`)
      case 'pickup':
        return setDialog({ kind: 'pickup' })
      case 'pay':
        return setDialog({ kind: 'pay' })
      case 'edit':
        return setDialog({ kind: 'edit' })
      case 'cancel':
        return setDialog({ kind: 'cancel' })
      case 'delete':
        return setDialog({ kind: 'delete' })
    }
  }

  const runConfirm = async () => {
    if (!dialog) return
    setBusy('confirm')
    try {
      if (dialog.kind === 'cancel') {
        await actions.cancelOrder(order, data)
        toast.success(`Pesanan ${order.order_number} dibatalkan.`)
      } else if (dialog.kind === 'delete') {
        await actions.deleteOrder(order)
        toast.success(`Pesanan ${order.order_number} dihapus.`)
        navigate('/pesanan', { replace: true })
        return
      } else if (dialog.kind === 'delete-payment') {
        await actions.deletePayment(dialog.payment)
        toast.success('Pembayaran dihapus.')
      }
      setDialog(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal memproses.')
    } finally {
      setBusy(null)
    }
  }

  const closeDialog = () => {
    setDialog(null)
    if (params.has('aksi')) {
      const next = new URLSearchParams(params)
      next.delete('aksi')
      setParams(next, { replace: true })
    }
  }

  const dismissCreated = () => {
    const next = new URLSearchParams(params)
    next.delete('baru')
    setParams(next, { replace: true })
  }

  const actionButtons = offered.filter((a) => a.key !== primary)

  return (
    <>
      <div className="mb-2">
        <Link to="/pesanan" className="inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Semua pesanan
        </Link>
      </div>
      <PageHeader
        title={order.order_number}
        subtitle={
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <OrderStatusBadge status={order.status} />
            {order.express && <ExpressBadge />}
            {!cancelled && <PayStatusBadge status={totals.payStatus} />}
            {when.late && <LateBadge />}
          </span>
        }
      />

      {justCreated && (
        <Card className="mb-4 border-emerald-200 bg-emerald-50">
          <CardBody className="space-y-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
              <p className="min-w-0 flex-1 text-sm text-emerald-900">
                <span className="block font-semibold">Pesanan tersimpan</span>
                {customer?.phone ? 'Kirim struk ke pelanggan lewat WhatsApp.' : 'Pelanggan belum punya nomor HP: struk WhatsApp bisa dikirim setelah nomornya diisi.'}
              </p>
              <button type="button" onClick={dismissCreated} aria-label="Tutup" className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            {receiptLink ? (
              <WhatsAppLink href={receiptLink} className="w-full">
                Kirim struk WhatsApp
              </WhatsAppLink>
            ) : customer ? (
              <MissingPhoneLink customer={customer} className="w-full" />
            ) : null}
          </CardBody>
        </Card>
      )}

      {offered.length > 0 && (
        <Card className="mb-4">
          <CardBody className="space-y-2" aria-label="Aksi pesanan">
            {primary && (
              <Button size="lg" fullWidth icon={(() => { const Icon = ACTION_ICON[primary]; return <Icon className="h-5 w-5" aria-hidden /> })()} loading={busy === primary} onClick={() => onAction(primary)}>
                {ACTION_LABEL[primary]}
              </Button>
            )}
            {actionButtons.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {actionButtons.map((a) => {
                  const Icon = ACTION_ICON[a.key]
                  const danger = a.key === 'cancel' || a.key === 'delete'
                  return (
                    <Button
                      key={a.key}
                      variant="outline"
                      className={clsx('h-11', danger && 'text-red-700 hover:bg-red-50')}
                      icon={<Icon className="h-4 w-4" aria-hidden />}
                      loading={busy === a.key}
                      disabled={Boolean(a.disabledReason) || (busy !== null && busy !== a.key)}
                      title={a.disabledReason}
                      onClick={() => onAction(a.key)}
                    >
                      {ACTION_LABEL[a.key]}
                    </Button>
                  )
                })}
              </div>
            )}
            {offered.find((a) => a.disabledReason) && <p className="text-xs text-slate-500">{`Batalkan: ${offered.find((a) => a.disabledReason)?.disabledReason}`}</p>}
          </CardBody>
        </Card>
      )}

      {/* on a phone: customer (WhatsApp) right under the actions, then items, info, payments; two columns on lg */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:items-start">
        <Card className="lg:col-start-3 lg:row-start-1">
          <CardHeader title="Pelanggan" />
          <CardBody className="space-y-3">
            {customer ? (
              <div>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link to={`/pelanggan/${customer.id}`} className="font-semibold text-brand-700 hover:underline">
                    {customer.name}
                  </Link>
                  <TenantBadge customer={customer} />
                </p>
                <p className="text-sm text-slate-600">{customer.phone ?? 'Nomor HP belum diisi'}</p>
                {customer.notes && <p className="mt-1 text-xs text-slate-500">{customer.notes}</p>}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Pelanggan tidak ditemukan.</p>
            )}
            {customer && !cancelled && (
              <div className="grid grid-cols-1 gap-2">
                {readyLink && order.status === 'ready' && (
                  <WhatsAppLink href={readyLink} className="w-full">
                    Kabari: siap diambil
                  </WhatsAppLink>
                )}
                {receiptLink && (
                  <a
                    href={receiptLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 text-sm font-medium text-emerald-800 hover:bg-emerald-100"
                  >
                    Kirim struk WhatsApp
                  </a>
                )}
                {!customer.phone && <MissingPhoneLink customer={customer} className="w-full" />}
              </div>
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <CardHeader title={`Item (${items.length})`} />
          <ul className="divide-y divide-slate-100" data-testid="order-items">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Tidak ada item.</li>}
            {items.map((it) => (
              <li key={it.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <Shirt className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium text-slate-900">{it.service_name}</span>
                    {it.customer_package_id && <Badge tone="brand">Paket</Badge>}
                  </p>
                  <p className="text-xs tabular-nums text-slate-500">
                    {it.customer_package_id ? `${formatQty(it.qty, it.unit)} dari paket` : `${formatQty(it.qty, it.unit)} × ${formatRupiah(it.unit_price)}/${it.unit}`}
                  </p>
                  {it.notes && <p className="text-xs text-slate-600">{it.notes}</p>}
                </div>
                <span className="shrink-0 font-medium tabular-nums text-slate-900">{formatRupiah(it.line_total)}</span>
              </li>
            ))}
          </ul>
          <CardBody className="space-y-1.5 border-t border-slate-100" data-testid="order-totals">
            <Row label="Subtotal" value={formatRupiah(totals.subtotal)} />
            {totals.discount > 0 && <Row label="Diskon" value={`− ${formatRupiah(totals.discount)}`} />}
            <Row label="Total" value={<span data-testid="order-total">{formatRupiah(totals.total)}</span>} strong className="text-base" />
            <Row label="Dibayar" value={formatRupiah(totals.paid)} />
            {!cancelled && (
              <Row
                label="Sisa"
                value={<span className={clsx(totals.outstanding > 0 ? 'font-semibold text-red-700' : 'text-emerald-700')} data-testid="order-outstanding">{formatRupiah(totals.outstanding)}</span>}
              />
            )}
          </CardBody>
        </Card>
        <Card className="lg:col-start-3 lg:row-start-2">
          <CardHeader title="Info pesanan" />
          <CardBody className="space-y-1.5">
            <Row label="Tanggal masuk" value={formatDate(order.received_at)} />
            <Row
              label="Perkiraan selesai"
              value={<span className={clsx(when.late && 'font-semibold text-red-700')}>{formatDate(order.promised_at)}</span>}
            />
            <Row label="Jenis" value={order.express ? 'Express' : 'Reguler'} />
            {order.ready_at && <Row label="Siap diambil" value={formatDateTime(order.ready_at)} />}
            {order.picked_up_at && <Row label="Diambil" value={formatDateTime(order.picked_up_at)} />}
            {order.notes && <p className="whitespace-pre-wrap border-t border-slate-100 pt-2 text-sm text-slate-700">{order.notes}</p>}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2 lg:col-start-1 lg:row-start-3">
          <CardHeader
            title={`Pembayaran (${payments.length})`}
            action={
              offered.some((a) => a.key === 'pay') ? (
                <Button size="sm" variant="secondary" className="h-11" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setDialog({ kind: 'pay' })}>
                  Terima
                </Button>
              ) : undefined
            }
          />
          {payments.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-slate-500">Belum ada pembayaran.</p>
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="order-payments">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center gap-2 px-4 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-slate-900">
                      <span className="font-medium">{formatDate(p.paid_at)}</span>
                      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{PAYMENT_METHOD_LABEL[p.method]}</span>
                    </p>
                    {p.notes && <p className="truncate text-xs text-slate-500">{p.notes}</p>}
                  </div>
                  <span className="shrink-0 font-semibold tabular-nums text-emerald-700">{formatRupiah(p.amount)}</span>
                  {isAdmin && (
                    <button type="button" aria-label={`Ubah pembayaran ${formatRupiah(p.amount)}`} onClick={() => setDialog({ kind: 'edit-payment', payment: p })} className={clsx(rowIconButtonClass, 'hover:bg-slate-100 hover:text-brand-700')}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                  {isAdmin && (
                    <button type="button" aria-label={`Hapus pembayaran ${formatRupiah(p.amount)}`} onClick={() => setDialog({ kind: 'delete-payment', payment: p })} className={clsx(rowIconButtonClass, 'hover:bg-red-50 hover:text-red-600')}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {dialog?.kind === 'pay' && totals.outstanding > 0 && !cancelled && <ReceivePaymentModal order={order} totals={totals} ctx={data} actions={actions} onClose={closeDialog} />}
      {dialog?.kind === 'pickup' && order.status === 'ready' && <PickupModal order={order} totals={totals} customer={customer} ctx={data} actions={actions} onClose={closeDialog} />}
      {dialog?.kind === 'edit' && <EditOrderModal order={order} items={items} data={data} actions={actions} onClose={closeDialog} />}
      {dialog?.kind === 'edit-payment' && <EditPaymentModal payment={dialog.payment} order={order} ctx={data} actions={actions} onClose={closeDialog} />}
      <ConfirmDialog
        open={dialog?.kind === 'cancel'}
        onClose={closeDialog}
        onConfirm={() => void runConfirm()}
        loading={busy === 'confirm'}
        title="Batalkan pesanan?"
        confirmLabel="Batalkan pesanan"
        cancelLabel="Kembali"
        message={`Pesanan ${order.order_number} ditandai Dibatalkan. Nomornya tetap tercatat; paket yang dipakai tersedia lagi.`}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onClose={closeDialog}
        onConfirm={() => void runConfirm()}
        loading={busy === 'confirm'}
        title="Hapus pesanan?"
        message={`Pesanan ${order.order_number} beserta item dan ${payments.length} pembayarannya dihapus permanen. Lebih disarankan membatalkan bila belum ada pembayaran.`}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete-payment'}
        onClose={closeDialog}
        onConfirm={() => void runConfirm()}
        loading={busy === 'confirm'}
        title="Hapus pembayaran?"
        message={dialog?.kind === 'delete-payment' ? `Pembayaran ${formatRupiah(dialog.payment.amount)} tanggal ${formatDate(dialog.payment.paid_at)} dihapus; sisa bayar pesanan dihitung ulang.` : ''}
      />
    </>
  )
}
