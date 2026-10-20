import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { clsx } from 'clsx'
import { ChevronRight, PackageCheck } from 'lucide-react'
import { Badge, WhatsAppLink } from '../../components/ui'
import type { Organization } from '../../types/db'
import { formatRupiah, whatsappLink } from '../../lib/format'
import { orderReadyText } from '../pesanan/orderUtils'
import { OrderStatusBadge, PayStatusBadge } from '../pesanan/components'
import { TenantBadge } from '../pelanggan/components'
import { MissingPhoneLink } from '../pelanggan/MissingPhoneLink'
import { lateText, orderLink, waitingText, type DashboardModel, type LateEntry, type OrderEntry, type ReadyEntry } from './dashboardModel'

const NO_CUSTOMER = 'Pelanggan tidak ditemukan'

/** A dashboard card: title with a count, an optional link at the right (44 px tall), then the list. */
export function SectionCard({
  title,
  count,
  countTone = 'neutral',
  subtitle,
  link,
  danger = false,
  testId,
  children,
}: {
  title: string
  count?: number
  countTone?: 'neutral' | 'danger' | 'warning' | 'success'
  subtitle?: ReactNode
  link?: { to: string; label: string }
  /** red frame and title (Terlambat) */
  danger?: boolean
  testId?: string
  children: ReactNode
}) {
  return (
    <section className={clsx('rounded-xl border bg-white shadow-sm', danger ? 'border-red-200' : 'border-slate-200')} data-testid={testId}>
      <div className={clsx('flex items-center justify-between gap-3 border-b py-1 pl-4 pr-2', danger ? 'border-red-100' : 'border-slate-100')}>
        <div className="min-w-0 py-2">
          <h2 className={clsx('flex items-center gap-2 text-sm font-semibold', danger ? 'text-red-800' : 'text-slate-900')}>
            <span className="truncate">{title}</span>
            {count !== undefined && count > 0 && <Badge tone={countTone}>{count}</Badge>}
          </h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {link && (
          <Link to={link.to} className="inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg px-2 text-xs font-medium text-brand-700 hover:bg-brand-50">
            {link.label}
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

export function SectionEmpty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-sm text-slate-500">{children}</p>
}

function CustomerLine({ entry }: { entry: OrderEntry }) {
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 truncate font-medium text-slate-900">{entry.customer?.name ?? NO_CUSTOMER}</span>
      <TenantBadge customer={entry.customer} />
    </p>
  )
}

const OUTLINE_LINK =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2'

function ReadyRow({ entry, org }: { entry: ReadyEntry; org: Pick<Organization, 'name' | 'wa_footer'> }) {
  const { order, customer, items, totals } = entry
  const wa = whatsappLink(customer?.phone, orderReadyText(order, items, totals, customer, org))
  return (
    <li data-testid="ready-row" data-order-number={order.order_number} className="px-4 py-3">
      <Link to={orderLink(order.id)} className="-mx-2 -mt-1 block rounded-lg px-2 py-1 hover:bg-slate-50">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <CustomerLine entry={entry} />
            <p className="truncate text-sm text-slate-600">{entry.itemsText || '—'}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              <span className="font-mono">{order.order_number}</span>
              {` · ${waitingText(entry.daysWaiting)}`}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {totals.outstanding > 0 ? (
              <>
                <span className="block text-xs text-slate-500">Sisa</span>
                <span className="font-semibold tabular-nums text-red-700" data-testid="ready-outstanding">
                  {formatRupiah(totals.outstanding)}
                </span>
              </>
            ) : (
              <PayStatusBadge status="lunas" />
            )}
          </div>
        </div>
      </Link>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {wa ? (
          <WhatsAppLink href={wa} className="w-full">
            <span aria-hidden>Kabari</span>
            <span className="sr-only">{`Kabari ${customer?.name ?? 'pelanggan'} lewat WhatsApp`}</span>
          </WhatsAppLink>
        ) : (
          <MissingPhoneLink variant="button" customer={customer} className="w-full text-center leading-tight" />
        )}
        <Link to={orderLink(order.id, 'diambil')} className={OUTLINE_LINK}>
          <PackageCheck className="h-4 w-4 shrink-0" aria-hidden />
          <span aria-hidden>Diambil</span>
          <span className="sr-only">{`Diambil ${order.order_number}`}</span>
        </Link>
      </div>
    </li>
  )
}

/**
 * Siap diambil (SPEC 3.6): every ready order, longest waiting first, with what is still owed, a green WhatsApp button
 * with the "cucian siap diambil" text (➕ Nomor HP when the customer has none) and Diambil, which opens the order's
 * pickup dialog (and its remaining payment) through ?aksi=diambil.
 */
export function ReadyCard({ entries, org }: { entries: ReadyEntry[]; org: Pick<Organization, 'name' | 'wa_footer'> }) {
  return (
    <SectionCard title="Siap diambil" count={entries.length} countTone="success" link={entries.length > 0 ? { to: '/pesanan?tab=siap', label: 'Semua' } : undefined} testId="ready-card">
      {entries.length === 0 ? (
        <SectionEmpty>Belum ada cucian yang siap diambil.</SectionEmpty>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label="Cucian siap diambil">
          {entries.map((e) => (
            <ReadyRow key={e.order.id} entry={e} org={org} />
          ))}
        </ul>
      )}
    </SectionCard>
  )
}

/** Terlambat (SPEC 3.6): promised day passed and not ready yet, in red with the promised date; most overdue first. */
export function LateCard({ entries }: { entries: LateEntry[] }) {
  return (
    <SectionCard title="Terlambat" count={entries.length} countTone="danger" danger testId="late-card">
      <ul className="divide-y divide-red-100" aria-label="Pesanan terlambat">
        {entries.map((e) => (
          <li key={e.order.id} data-testid="late-row" data-order-number={e.order.order_number}>
            <Link to={orderLink(e.order.id)} className="block min-h-11 px-4 py-3 hover:bg-red-50/60">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <CustomerLine entry={e} />
                  <p className="truncate text-sm text-slate-600">{e.itemsText || '—'}</p>
                  <p className="font-mono text-xs text-slate-500">{e.order.order_number}</p>
                  <p className="mt-0.5 text-xs font-medium text-red-700">{lateText(e)}</p>
                </div>
                <div className="shrink-0">
                  <OrderStatusBadge status={e.order.status} />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </SectionCard>
  )
}

/**
 * Belum bayar (SPEC 3.5 piutang): how many orders still owe and how much; the largest few, each opening Terima
 * pembayaran on the order (?aksi=bayar).
 */
export function UnpaidCard({ unpaid }: { unpaid: DashboardModel['unpaid'] }) {
  const rest = unpaid.count - unpaid.top.length
  return (
    <SectionCard
      title="Belum bayar"
      count={unpaid.count}
      countTone="warning"
      subtitle={unpaid.count > 0 ? `Total ${formatRupiah(unpaid.amount)}` : undefined}
      testId="unpaid-card"
    >
      {unpaid.count === 0 ? (
        <SectionEmpty>Semua pesanan sudah lunas.</SectionEmpty>
      ) : (
        <ul className="divide-y divide-slate-100" aria-label="Pesanan belum bayar">
          {unpaid.top.map((e) => (
            <li key={e.order.id} data-testid="unpaid-row" data-order-number={e.order.order_number}>
              <Link to={orderLink(e.order.id, 'bayar')} className="flex min-h-11 items-center gap-3 px-4 py-3 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <CustomerLine entry={e} />
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-mono text-slate-500">{e.order.order_number}</span>
                    <OrderStatusBadge status={e.order.status} />
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className="font-semibold tabular-nums text-red-700">{formatRupiah(e.totals.outstanding)}</span>
                  <span className="inline-flex items-center text-xs font-medium text-brand-700">
                    Bayar
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rest > 0 && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">{`dan ${rest} pesanan lain belum lunas`}</p>}
    </SectionCard>
  )
}
