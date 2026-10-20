import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { clsx } from 'clsx'
import { MessageCircle } from 'lucide-react'
import { Card, CardBody, Segmented } from '../../components/ui'
import { formatDate, formatNumber, whatsappLink } from '../../lib/format'
import { promoText } from '../../domain/messages'
import type { Customer, Order } from '../../types/db'
import { FilterChips, TenantBadge } from '../pelanggan/components'
import { MissingPhoneLink } from '../pelanggan/MissingPhoneLink'
import { CUSTOMER_FILTERS, CUSTOMER_FILTER_LABEL, customerFilterCounts, lastVisitText, matchesCustomerFilter, type CustomerFilter } from '../pelanggan/customerUtils'
import { LAMA_MAX_DAYS, LAMA_MIN_DAYS, absentCustomers, customerPeriodText, parseLamaDays, type CustomerReportRow, type DateRange, type Laporan } from './reportModel'
import { buildAbsentSheet, buildCustomersSheet } from './export'
import { readLamaDays, writeLamaDays } from './lamaSetting'
import { ExportButtons } from './sections'
import type { LaporanTab } from './useLaporanParams'

const BUBBLE = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full'

/**
 * Green "Kirim promo" (wa.me with the organisation's promo text, {nama} filled in); without a phone number the amber
 * "Nomor HP belum diisi" bubble that opens the customer's form at Nomor HP.
 */
function PromoLink({ customer, template }: { customer: Customer; template: string | null }) {
  const text = promoText(template, customer.name)
  const href = whatsappLink(customer.phone, text || undefined)
  if (!href) return <MissingPhoneLink customer={customer} className={BUBBLE} />
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Kirim promo ke ${customer.name}`}
      data-testid="promo-link"
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
    >
      <MessageCircle className="h-4 w-4" aria-hidden />
      Kirim promo
    </a>
  )
}

function PromoHint() {
  return (
    <p data-testid="promo-hint" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
      Template promo belum diisi.{' '}
      <Link to="/pengaturan" className="font-medium underline">
        Isi di Pengaturan
      </Link>{' '}
      supaya Kirim promo langsung berisi pesannya.
    </p>
  )
}

function CustomerName({ customer }: { customer: Customer }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <Link to={`/pelanggan/${customer.id}`} className="truncate text-sm font-semibold text-slate-900 hover:underline">
        {customer.name}
      </Link>
      <TenantBadge customer={customer} />
    </span>
  )
}

/** The Pelanggan and Lama tidak datang lists, as two tabs, each with its own XLSX / CSV download. */
export function CustomersCard({
  report,
  today,
  tab,
  onTab,
  filter,
  onFilter,
  promoTemplate,
  customers,
  orders,
}: {
  report: Laporan
  /** every customer and order: Lama tidak datang looks at all visits, not only the range */
  customers: Customer[]
  orders: Pick<Order, 'customer_id' | 'received_at' | 'status'>[]
  today: string
  tab: LaporanTab
  onTab: (tab: LaporanTab) => void
  filter: CustomerFilter
  onFilter: (filter: CustomerFilter) => void
  promoTemplate: string | null
}) {
  const hasTemplate = Boolean(promoTemplate?.trim())
  return (
    <section aria-label="Pelanggan" className="mb-4 space-y-3">
      <Segmented<LaporanTab>
        label="Daftar pelanggan"
        value={tab}
        options={[
          { key: 'pelanggan', label: 'Pelanggan' },
          { key: 'lama', label: 'Lama tidak datang' },
        ]}
        onChange={onTab}
      />
      {!hasTemplate && <PromoHint />}
      {tab === 'pelanggan' ? (
        <CustomerTable rows={report.customers} range={report.range} today={today} filter={filter} onFilter={onFilter} template={promoTemplate} />
      ) : (
        <AbsentList customers={customers} orders={orders} today={today} template={promoTemplate} />
      )}
    </section>
  )
}

function CustomerTable({
  rows,
  range,
  today,
  filter,
  onFilter,
  template,
}: {
  rows: CustomerReportRow[]
  range: DateRange
  today: string
  filter: CustomerFilter
  onFilter: (filter: CustomerFilter) => void
  template: string | null
}) {
  const counts = useMemo(() => customerFilterCounts(rows.map((r) => r.customer)), [rows])
  const visible = useMemo(() => rows.filter((r) => matchesCustomerFilter(r.customer, filter)), [rows, filter])
  return (
    <>
      <FilterChips label="Jenis pelanggan" value={filter} onChange={onFilter} options={CUSTOMER_FILTERS.map((k) => ({ key: k, label: CUSTOMER_FILTER_LABEL[k], count: counts[k] }))} />
      <Card data-testid="customers-card">
        <CardBody>
          <p className="text-xs text-slate-500">Urut dari yang paling sering pada periode ini. 30 / 90 hari dihitung sampai {range.end < today ? formatDate(range.end) : 'hari ini'}.</p>
        </CardBody>
        {visible.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">Tidak ada pelanggan.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {visible.map((r) => (
              <li key={r.customer.id} data-testid="report-customer" data-name={r.customer.name} data-tenant={r.customer.is_tenant ? '1' : '0'} className="flex items-center gap-3 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <CustomerName customer={r.customer} />
                  <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
                    <span className="whitespace-nowrap">{lastVisitText(r.lastVisit, today)}</span>
                    <span className="whitespace-nowrap tabular-nums">
                      30 hr: {r.orders30} · 90 hr: {r.orders90}
                    </span>
                  </span>
                  <span className={clsx('block text-xs tabular-nums', r.ordersInRange > 0 ? 'text-slate-700' : 'text-slate-400')}>
                    {customerPeriodText(r)}
                  </span>
                </span>
                <PromoLink customer={r.customer} template={template} />
              </li>
            ))}
          </ul>
        )}
        <CardBody className="border-t border-slate-100">
          <ExportButtons what="pelanggan" range={range} build={() => buildCustomersSheet(visible)} disabled={visible.length === 0} />
        </CardBody>
      </Card>
    </>
  )
}

function AbsentList({
  customers,
  orders,
  today,
  template,
}: {
  customers: Customer[]
  orders: Pick<Order, 'customer_id' | 'received_at' | 'status'>[]
  today: string
  template: string | null
}) {
  const [text, setText] = useState(() => String(readLamaDays()))
  const days = parseLamaDays(text)
  const rows = useMemo(() => absentCustomers(customers, orders, today, days), [customers, orders, today, days])
  return (
    <Card data-testid="absent-card">
      <CardBody className="space-y-2">
        <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <span>Terakhir datang lebih dari</span>
          <input
            type="number"
            inputMode="numeric"
            min={LAMA_MIN_DAYS}
            max={LAMA_MAX_DAYS}
            aria-label="Batas hari tidak datang"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (e.target.value.trim() !== '') writeLamaDays(parseLamaDays(e.target.value))
            }}
            className="h-11 w-20 rounded-lg border border-slate-300 bg-white px-3 text-center text-sm tabular-nums text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <span>hari lalu</span>
        </label>
        <p className="text-xs text-slate-500">Target promosi: pelanggan yang pernah mencuci, paling lama tidak datang di atas.</p>
      </CardBody>
      {rows.length === 0 ? (
        <p className="border-t border-slate-100 px-4 py-6 text-center text-sm text-slate-500">Semua pelanggan datang dalam {days} hari terakhir.</p>
      ) : (
        <ul className="divide-y divide-slate-100 border-t border-slate-100">
          {rows.map((r) => (
            <li key={r.customer.id} data-testid="absent-customer" data-name={r.customer.name} data-days={r.daysAway} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <CustomerName customer={r.customer} />
                <span className="mt-0.5 block text-xs text-slate-500">
                  <span className="font-medium text-red-700">{r.daysAway} hari</span> · terakhir {formatDate(r.lastVisit)} · {formatNumber(r.orderCount)} pesanan
                </span>
              </span>
              <PromoLink customer={r.customer} template={template} />
            </li>
          ))}
        </ul>
      )}
      <CardBody className="border-t border-slate-100">
        <ExportButtons what="lama-tidak-datang" range={{ start: today, end: today }} build={() => buildAbsentSheet(rows)} disabled={rows.length === 0} />
      </CardBody>
    </Card>
  )
}
