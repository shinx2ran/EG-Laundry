import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { Plus, Search } from 'lucide-react'
import { Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'
import { useLaundryData } from '../../hooks/useLaundryData'
import { isOrderLate } from '../../domain/pricing'
import { todayISO } from '../../lib/format'
import { ORDER_TABS, ORDER_TAB_LABEL, matchesOrderSearch, parseOrderTab, sortOrdersNewest, tabCounts, tabMatches, type OrderTab } from './orderUtils'
import { OrderRow } from './OrderRow'
import { newOrderLinkClass } from './styles'

const PAGE_SIZE = 50

/**
 * Pesanan (SPEC 3.3): newest first, tabs Semua / Diterima / Proses / Siap / Selesai (cancelled orders only under
 * Semua), search by customer name, phone or order number. Each row: customer + Anak kos badge, number, items,
 * total, pay status, express, the promised date with a red "Terlambat" once it has passed.
 */
export function PesananPage() {
  const data = useLaundryData()
  const [params, setParams] = useSearchParams()
  const tab = parseOrderTab(params.get('tab'))
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const today = todayISO()

  const setTab = (next: OrderTab) => {
    const p = new URLSearchParams(params)
    if (next === 'semua') p.delete('tab')
    else p.set('tab', next)
    setParams(p, { replace: true })
    setLimit(PAGE_SIZE)
  }

  const sorted = useMemo(() => sortOrdersNewest(data.orders), [data.orders])
  const counts = useMemo(() => tabCounts(data.orders), [data.orders])
  const late = useMemo(() => data.orders.filter((o) => isOrderLate(o, today)).length, [data.orders, today])
  const shown = useMemo(
    () => sorted.filter((o) => tabMatches(tab, o.status) && matchesOrderSearch(o, data.customerById.get(o.customer_id), search)),
    [sorted, tab, search, data.customerById],
  )
  const visible = shown.slice(0, limit)

  const working = counts.diterima + counts.proses
  const subtitle = data.isPending ? 'Memuat…' : `${working} dikerjakan · ${counts.siap} siap diambil${late > 0 ? ` · ${late} terlambat` : ''}`

  return (
    <>
      <PageHeader title="Pesanan" subtitle={subtitle} />
      <Link to="/pesanan/baru" className={clsx(newOrderLinkClass, 'mb-4 w-full sm:w-auto')}>
        <Plus className="h-5 w-5" aria-hidden /> Pesanan baru
      </Link>

      <div className="mb-3 space-y-2">
        <div role="tablist" aria-label="Status pesanan" className="grid grid-cols-5 gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {ORDER_TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={clsx(
                'flex min-h-11 min-w-0 flex-col items-center justify-center rounded-md px-0.5 text-xs font-medium transition-colors sm:text-sm',
                tab === key ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              <span className="max-w-full truncate">{ORDER_TAB_LABEL[key]}</span>
              <span className={clsx('text-[11px] tabular-nums', tab === key ? 'text-brand-100' : 'text-slate-400')}>{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setLimit(PAGE_SIZE)
            }}
            placeholder="Cari nama, HP atau nomor pesanan…"
            aria-label="Cari pesanan"
            className="h-11 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
      </div>

      {data.isPending ? (
        <LoadingState />
      ) : data.error ? (
        <ErrorState error={data.error} />
      ) : shown.length === 0 ? (
        <EmptyState
          title={search ? 'Tidak ada pesanan yang cocok' : data.orders.length === 0 ? 'Belum ada pesanan' : `Tidak ada pesanan ${ORDER_TAB_LABEL[tab]}`}
          description={search ? 'Coba nama, nomor HP atau nomor pesanan lain.' : data.orders.length === 0 ? 'Catat cucian pertama yang masuk.' : undefined}
          action={
            data.orders.length === 0 ? (
              <Link to="/pesanan/baru" className={newOrderLinkClass}>
                <Plus className="h-5 w-5" aria-hidden /> Pesanan baru
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100" aria-label="Daftar pesanan">
            {visible.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                customer={data.customerById.get(order.customer_id)}
                items={data.itemsByOrder.get(order.id) ?? []}
                totals={data.totalsFor(order)}
                today={today}
              />
            ))}
          </ul>
          {shown.length > visible.length && (
            <div className="border-t border-slate-100 p-2">
              <button type="button" onClick={() => setLimit((l) => l + PAGE_SIZE)} className="min-h-11 w-full rounded-lg text-sm font-medium text-brand-700 hover:bg-brand-50">
                {`Tampilkan lebih banyak (${shown.length - visible.length} lagi)`}
              </button>
            </div>
          )}
        </Card>
      )}
    </>
  )
}
