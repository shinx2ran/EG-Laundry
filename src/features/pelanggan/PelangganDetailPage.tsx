import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { ArrowLeft, ExternalLink, MessageCirclePlus, Package, Pencil, Plus, Trash2, UserX } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, EmptyState, ErrorState, LoadingState, PageHeader, useToast, WhatsAppLink } from '../../components/ui'
import { useLaundryData } from '../../hooks/useLaundryData'
import { isOrderLate, packageRemaining } from '../../domain/pricing'
import { itemsSummary } from '../../domain/messages'
import { formatDate, formatQty, formatRupiah, todayISO, whatsappLink } from '../../lib/format'
import { PAYMENT_METHOD_LABEL, type CustomerPackage, type Order } from '../../types/db'
import { CustomerFormModal } from './CustomerFormModal'
import { SellPackageModal } from './SellPackageModal'
import { Avatar, PackageStateBadge, TenantBadge } from './components'
import { LateBadge, OrderStatusBadge, PayStatusBadge } from '../pesanan/components'
import { newOrderLinkClass } from '../pesanan/styles'
import { useCustomerActions } from './useCustomerActions'
import { canDeleteCustomer, customerOrders, initials, packageState, tenantBadgeText } from './customerUtils'

function InfoList({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-slate-900">{it.value ?? <span className="text-slate-400">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

function dash(value: string | null | undefined): ReactNode {
  return value && value.trim() ? value : null
}

/** /pelanggan/:id (SPEC 3.2, 3.4): info card, prepaid packages with their remaining qty, order history. */
export function PelangganDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const data = useLaundryData()
  const actions = useCustomerActions()
  // ?isi=hp (a missing-phone WhatsApp button): the form opens at Nomor HP right away
  const [searchParams, setSearchParams] = useSearchParams()
  const askPhone = searchParams.get('isi') === 'hp'
  const [editOpen, setEditOpen] = useState(false)
  const [sellOpen, setSellOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const today = todayISO()

  const customer = id ? data.customerById.get(id) : undefined
  const myOrders = useMemo(() => (id ? customerOrders(id, data.orders) : []), [id, data.orders])
  const myPackages = useMemo(() => (id ? (data.packagesByCustomer.get(id) ?? []) : []), [id, data.packagesByCustomer])

  const closeEdit = () => {
    setEditOpen(false)
    if (askPhone) {
      const next = new URLSearchParams(searchParams)
      next.delete('isi')
      setSearchParams(next, { replace: true })
    }
  }

  if (data.isPending) return <LoadingState label="Memuat pelanggan…" />
  if (data.error) return <ErrorState error={data.error} />
  if (!customer) {
    return (
      <EmptyState
        icon={<UserX className="h-10 w-10" />}
        title="Pelanggan tidak ditemukan"
        description="Data mungkin sudah dihapus."
        action={
          <Button variant="outline" onClick={() => navigate('/pelanggan')}>
            Kembali ke daftar
          </Button>
        }
      />
    )
  }

  const c = customer
  const wa = whatsappLink(c.phone)
  const badge = tenantBadgeText(c)
  const deletable = canDeleteCustomer(c.id, data.orders, data.customerPackages)

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      await actions.deleteCustomer(c)
      toast.success(`Pelanggan ${c.name} dihapus.`)
      navigate('/pelanggan', { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus pelanggan.')
      setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Link to="/pelanggan" className="mb-2 inline-flex min-h-11 items-center gap-1 text-sm text-slate-600 hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Semua pelanggan
      </Link>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {c.is_tenant ? <TenantBadge customer={c} /> : <Badge tone="neutral">Umum</Badge>}
            <span>{myOrders.length} pesanan</span>
          </span>
        }
        actions={
          <>
            {wa && (
              <WhatsAppLink href={wa} aria-label={`WhatsApp ${c.name}`}>
                WhatsApp
              </WhatsAppLink>
            )}
            <Button variant="outline" className="h-11" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
              Ubah
            </Button>
            {actions.canDeleteCustomers && (
              <Button variant="outline" icon={<Trash2 className="h-4 w-4" />} className="h-11 text-red-700 hover:bg-red-50" onClick={() => setDeleteOpen(true)}>
                Hapus
              </Button>
            )}
          </>
        }
      />
      {/* the counter's usual next step: an order for this customer, already chosen in the form */}
      <Link to={`/pesanan/baru?customer=${c.id}`} className={clsx(newOrderLinkClass, 'mb-4 w-full sm:w-auto')}>
        <Plus className="h-5 w-5" aria-hidden /> Pesanan baru
      </Link>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card>
            <CardHeader title="Data pelanggan" action={<Avatar text={initials(c.name)} className="h-9 w-9" />} />
            <CardBody>
              <InfoList
                items={[
                  {
                    label: 'Nomor HP',
                    value: c.phone ? (
                      <a href={wa ?? `tel:${c.phone}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center tabular-nums text-brand-700 hover:underline">
                        {c.phone}
                      </a>
                    ) : (
                      <Link to={`/pelanggan/${c.id}?isi=hp`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-amber-700 hover:underline">
                        <MessageCirclePlus className="h-4 w-4" aria-hidden /> Nomor HP belum diisi: isi sekarang
                      </Link>
                    ),
                  },
                  { label: 'Jenis', value: badge ?? 'Pelanggan umum' },
                  { label: 'Alamat', value: dash(c.address) },
                  { label: 'Catatan', value: dash(c.notes) },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Paket prabayar"
              subtitle={myPackages.length === 0 ? 'Belum ada paket' : `${myPackages.length} paket`}
              action={
                <Button size="sm" className="h-11" icon={<Plus className="h-4 w-4" />} onClick={() => setSellOpen(true)}>
                  Jual paket
                </Button>
              }
            />
            <CardBody className="px-0 py-0">
              {myPackages.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-500">Paket prabayar yang dibeli pelanggan ini tampil di sini.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {myPackages.map((p) => (
                    <PackageRow key={p.id} pkg={p} remaining={packageRemaining(p, data.orderItems, data.orders)} unit={data.serviceById.get(p.service_id)?.unit ?? 'kg'} today={today} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Riwayat pesanan" subtitle={`${myOrders.length} pesanan`} />
            <CardBody className="px-0 py-0">
              {myOrders.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-500">Pelanggan ini belum pernah mencuci di sini.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {myOrders.map((o) => (
                    <OrderRow key={o.id} order={o} summary={itemsSummary(data.itemsByOrder.get(o.id) ?? [])} totals={data.totalsFor(o)} late={isOrderLate(o, today)} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <CustomerFormModal open={editOpen || askPhone} onClose={closeEdit} customer={c} actions={actions} focusPhone={askPhone} />
      <SellPackageModal open={sellOpen} onClose={() => setSellOpen(false)} customer={c} catalog={data.packageCatalog} serviceById={data.serviceById} actions={actions} isAdmin={actions.isAdmin} />

      {deletable ? (
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          onConfirm={confirmDelete}
          loading={deleting}
          title="Hapus pelanggan?"
          message={
            <>
              Data <strong>{c.name}</strong> akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
            </>
          }
        />
      ) : (
        <ConfirmDialog
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          onConfirm={() => setDeleteOpen(false)}
          title="Tidak bisa dihapus"
          danger={false}
          confirmLabel="Mengerti"
          cancelLabel={null}
          message={
            <>
              <strong>{c.name}</strong> sudah punya pesanan atau paket, jadi datanya masih dipakai dan tidak bisa dihapus agar riwayat tetap utuh. Cukup biarkan.
            </>
          }
        />
      )}
    </>
  )
}

function PackageRow({ pkg, remaining, unit, today }: { pkg: CustomerPackage; remaining: number; unit: string; today: string }) {
  const state = packageState(pkg, remaining, today)
  return (
    <li data-testid="package-row" className="px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{pkg.name}</p>
          <p className={clsx('text-sm tabular-nums', state === 'active' ? 'text-emerald-700' : 'text-slate-500')}>
            <Package className="mr-1 inline h-3.5 w-3.5 align-[-2px]" aria-hidden />
            Sisa {formatQty(remaining, unit)} dari {formatQty(pkg.qty_total, unit)}
          </p>
        </div>
        <PackageStateBadge state={state} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {pkg.expires_at ? `Berlaku s/d ${formatDate(pkg.expires_at)}` : 'Tanpa kedaluwarsa'} · dibeli {formatDate(pkg.purchased_at)} · {PAYMENT_METHOD_LABEL[pkg.method]} · {formatRupiah(pkg.price)}
      </p>
      {pkg.notes && <p className="mt-0.5 text-xs text-slate-500">{pkg.notes}</p>}
    </li>
  )
}

function OrderRow({ order, summary, totals, late }: { order: Order; summary: string; totals: { total: number; payStatus: 'lunas' | 'sebagian' | 'belum' }; late: boolean }) {
  return (
    <li data-testid="order-row">
      <Link to={`/pesanan/${order.id}`} className="block px-4 py-3 hover:bg-brand-50/50">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums text-brand-700">
            {order.order_number} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </span>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {formatDate(order.received_at)}
          {order.express && ' · Express'}
          {summary && ` · ${summary}`}
        </p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-sm font-medium tabular-nums text-slate-900">{formatRupiah(totals.total)}</span>
          <span className="flex items-center gap-1.5">
            {late && <LateBadge />}
            {order.status !== 'cancelled' && <PayStatusBadge status={totals.payStatus} />}
          </span>
        </div>
      </Link>
    </li>
  )
}
