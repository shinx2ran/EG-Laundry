import { lazy, Suspense, useMemo } from 'react'
import { Link } from 'react-router'
import { clsx } from 'clsx'
import { Plus } from 'lucide-react'
import { ErrorState, LoadingState, PageHeader } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useLaundryData } from '../../hooks/useLaundryData'
import { formatDate, formatRupiah, todayISO } from '../../lib/format'
import { newOrderLinkClass } from '../pesanan/styles'
import { buildDashboard, dayLabel, firstRunSteps, SERIES_DAYS } from './dashboardModel'
import { StatTiles } from './StatTiles'
import { LateCard, ReadyCard, SectionCard, UnpaidCard } from './DashboardCards'
import { FirstRunCard } from './FirstRunCard'

// recharts is big: its own chunk, fetched only when an owner/admin opens the dashboard
const MoneyBarChart = lazy(() => import('../../components/MoneyBarChart').then((m) => ({ default: m.MoneyBarChart })))

/**
 * Dashboard (SPEC 3.6): the laundry's name and today's date, the big "+ Pesanan baru", the day's numbers (each opening
 * its list), Siap diambil with WhatsApp + Diambil, Terlambat in red, Belum bayar, and for the owner/admin a 7-day chart
 * of uang masuk (staff do not see reports, SPEC 3.10). A laundry without orders sees the first-run steps instead.
 */
export function DashboardPage() {
  const { org, isAdmin } = useOrg()
  const data = useLaundryData()
  const today = todayISO()
  const { orders, orderItems, payments, customerPackages, customers, services } = data
  const model = useMemo(
    () => buildDashboard({ orders, orderItems, payments, customerPackages, customers }, today),
    [orders, orderItems, payments, customerPackages, customers, today],
  )
  const weekTotal = model.moneySeries.reduce((sum, d) => sum + d.total, 0)
  const chartPoints = useMemo(
    () => model.moneySeries.map((d) => ({ key: d.date, label: dayLabel(d.date), title: formatDate(d.date, 'EEEE, d MMM yyyy'), amount: d.total })),
    [model.moneySeries],
  )

  return (
    <>
      <PageHeader title={org.name} subtitle={formatDate(today, 'EEEE, d MMMM yyyy')} />
      <Link to="/pesanan/baru" className={clsx(newOrderLinkClass, 'mb-4 w-full sm:w-auto')}>
        <Plus className="h-5 w-5" aria-hidden /> Pesanan baru
      </Link>

      {data.isPending ? (
        <LoadingState />
      ) : data.error ? (
        <ErrorState error={data.error} />
      ) : model.isEmpty ? (
        <FirstRunCard steps={firstRunSteps({ services, customers, orders })} isAdmin={isAdmin} laundryName={org.name} />
      ) : (
        <div className="space-y-4">
          <StatTiles model={model} isAdmin={isAdmin} />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
            <div className="space-y-4">
              <ReadyCard entries={model.ready} org={org} />
              {model.late.length > 0 && <LateCard entries={model.late} />}
            </div>
            <div className="space-y-4">
              <UnpaidCard unpaid={model.unpaid} />
              {isAdmin && (
                <SectionCard title={`Uang masuk ${SERIES_DAYS} hari`} subtitle={`Total ${formatRupiah(weekTotal)}`} link={{ to: '/laporan', label: 'Lihat laporan' }} testId="money-card">
                  <div className="px-1 pb-2 pt-3">
                    <Suspense fallback={<div className="h-[136px]" aria-hidden />}>
                      <MoneyBarChart points={chartPoints} height={136} testId="money-chart" />
                    </Suspense>
                  </div>
                </SectionCard>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
