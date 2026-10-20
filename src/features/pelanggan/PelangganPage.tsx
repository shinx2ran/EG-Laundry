import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { clsx } from 'clsx'
import { MessageCircle, Plus, Search, UserPlus, Users } from 'lucide-react'
import { Button, Card, EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'
import { useLaundryData } from '../../hooks/useLaundryData'
import { todayISO, whatsappLink } from '../../lib/format'
import type { Customer } from '../../types/db'
import { CustomerFormModal } from './CustomerFormModal'
import { MissingPhoneLink } from './MissingPhoneLink'
import { Avatar, FilterChips, TenantBadge } from './components'
import { useCustomerActions } from './useCustomerActions'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import {
  CUSTOMER_FILTERS,
  CUSTOMER_FILTER_LABEL,
  CUSTOMER_FILTER_PARAM,
  NO_VISITS,
  customerFilterCounts,
  customerStats,
  initials,
  lastVisitText,
  matchesCustomerFilter,
  matchesCustomerSearch,
  parseCustomerFilter,
  sortCustomersByVisit,
  type CustomerFilter,
  type CustomerStats,
} from './customerUtils'

const BUBBLE = 'flex h-11 w-11 items-center justify-center rounded-full'

/** /pelanggan (SPEC 3.2): search, Semua / Anak kos / Umum, rows by last visit, "+ Pelanggan". */
export function PelangganPage() {
  const data = useLaundryData()
  const actions = useCustomerActions()
  const [params, setParams] = useSearchParams()
  const filter = parseCustomerFilter(params.get('jenis'))
  const formOpen = params.get('baru') === '1'
  const [search, setSearch] = useState('')
  const query = useDebouncedValue(search, 250)
  const today = todayISO()

  const setFilter = useCallback(
    (next: CustomerFilter) => {
      const sp = new URLSearchParams(params)
      const value = CUSTOMER_FILTER_PARAM[next]
      if (value === null) sp.delete('jenis')
      else sp.set('jenis', value)
      setParams(sp, { replace: true })
    },
    [params, setParams],
  )
  const openForm = useCallback(() => {
    const sp = new URLSearchParams(params)
    sp.set('baru', '1')
    setParams(sp)
  }, [params, setParams])
  const closeForm = useCallback(() => {
    const sp = new URLSearchParams(params)
    sp.delete('baru')
    setParams(sp, { replace: true })
  }, [params, setParams])

  const stats = useMemo(() => customerStats(data.orders), [data.orders])
  const counts = useMemo(() => customerFilterCounts(data.customers), [data.customers])
  const visible = useMemo(
    () => sortCustomersByVisit(data.customers.filter((c) => matchesCustomerFilter(c, filter) && matchesCustomerSearch(c, query)), stats),
    [data.customers, filter, query, stats],
  )

  return (
    <>
      <PageHeader
        title="Pelanggan"
        subtitle={data.isPending ? 'Memuat…' : `${counts.all} pelanggan · ${counts.tenant} anak kos`}
        actions={
          <div className="hidden sm:block">
            <Button icon={<Plus className="h-4 w-4" />} onClick={openForm} aria-label="Tambah pelanggan">
              Pelanggan
            </Button>
          </div>
        }
      />

      <div className="mb-3 space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama atau nomor HP…"
            aria-label="Cari pelanggan"
            className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
        <FilterChips label="Jenis pelanggan" value={filter} onChange={setFilter} options={CUSTOMER_FILTERS.map((k) => ({ key: k, label: CUSTOMER_FILTER_LABEL[k], count: counts[k] }))} />
      </div>

      {data.isPending ? (
        <LoadingState label="Memuat pelanggan…" />
      ) : data.error ? (
        <ErrorState error={data.error} />
      ) : visible.length === 0 ? (
        query.trim() ? (
          <EmptyState
            icon={<Search className="h-10 w-10" />}
            title="Tidak ditemukan"
            description={`Tidak ada pelanggan yang cocok dengan "${query.trim()}".`}
            action={
              <Button variant="outline" onClick={() => setSearch('')}>
                Hapus pencarian
              </Button>
            }
          />
        ) : data.customers.length === 0 ? (
          <EmptyState
            icon={<Users className="h-10 w-10" />}
            title="Belum ada pelanggan"
            description="Tambahkan pelanggan pertama: cukup nama, nomor HP boleh menyusul."
            action={
              <Button icon={<UserPlus className="h-4 w-4" />} onClick={openForm}>
                Tambah pelanggan
              </Button>
            }
          />
        ) : (
          <EmptyState icon={<Users className="h-10 w-10" />} title={filter === 'tenant' ? 'Belum ada anak kos' : 'Belum ada pelanggan umum'} description="Ubah filter untuk melihat pelanggan lain." />
        )
      ) : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {visible.map((c) => (
              <CustomerRow key={c.id} customer={c} stats={stats.get(c.id) ?? NO_VISITS} today={today} />
            ))}
          </ul>
        </Card>
      )}

      {/* FAB on phones (bottom bar is 56px + safe area) */}
      <button
        type="button"
        onClick={openForm}
        aria-label="Tambah pelanggan"
        className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-brand-700 text-white shadow-lg transition-colors hover:bg-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 sm:hidden"
      >
        <Plus className="h-6 w-6" />
      </button>

      <CustomerFormModal open={formOpen} onClose={closeForm} actions={actions} />
    </>
  )
}

/**
 * One customer per row: name with the "Anak kos · B3" badge, phone · last visit · order count, and at the
 * right a WhatsApp bubble (wa.me) or the amber "Nomor HP belum diisi" bubble that opens the form at Nomor HP.
 */
function CustomerRow({ customer, stats, today }: { customer: Customer; stats: CustomerStats; today: string }) {
  const wa = whatsappLink(customer.phone)
  return (
    <li data-testid="customer-row" data-name={customer.name} data-tenant={customer.is_tenant ? '1' : '0'} className="flex items-stretch">
      <Link to={`/pelanggan/${customer.id}`} data-testid="customer-link" className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3 py-2 hover:bg-brand-50/50">
        <Avatar text={initials(customer.name)} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{customer.name}</span>
            <TenantBadge customer={customer} />
          </span>
          {/* two chunks that sit on one line where they fit and wrap on a narrow phone, so the order count is never cut */}
          <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
            <span className={clsx('whitespace-nowrap tabular-nums', !customer.phone && 'italic text-amber-700')}>{customer.phone ?? 'HP belum diisi'}</span>
            <span className="whitespace-nowrap">{`${lastVisitText(stats.lastVisit, today)} · ${stats.orderCount} pesanan`}</span>
          </span>
        </span>
      </Link>
      <span className="flex shrink-0 items-center pr-2">
        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${customer.name}`} title={customer.phone ?? undefined} className={clsx(BUBBLE, 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100')}>
            <MessageCircle className="h-5 w-5" aria-hidden />
          </a>
        ) : (
          <MissingPhoneLink customer={customer} className={BUBBLE} />
        )}
      </span>
    </li>
  )
}
