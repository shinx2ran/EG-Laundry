import { useMemo } from 'react'
import { Link } from 'react-router'
import { ShieldOff } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useLaundryData } from '../../hooks/useLaundryData'
import { STAFF_MESSAGE, buildLaporan } from './reportModel'
import { buildServicesSheet } from './export'
import { useLaporanParams } from './useLaporanParams'
import { MoneyInCard, RangeControls, ServicesCard, SummaryTiles, TenantSplitCard } from './sections'
import { CustomersCard } from './CustomerSections'

/** /laporan (SPEC 3.7): owner/admin only; staff get a short message (the menu entry is hidden for them too). */
export function LaporanPage() {
  const { isAdmin } = useOrg()
  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Laporan" />
        <EmptyState
          icon={<ShieldOff className="h-10 w-10" />}
          title={STAFF_MESSAGE}
          description="Pesanan dan pelanggan tetap bisa dilihat di menunya masing-masing."
          action={
            <Link to="/dashboard" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline">
              Kembali ke dashboard
            </Link>
          }
        />
      </>
    )
  }
  return <LaporanContent />
}

function LaporanContent() {
  const { org } = useOrg()
  const data = useLaundryData()
  const p = useLaporanParams()
  const { customers, orders, orderItems, payments, customerPackages } = data

  const report = useMemo(
    () => buildLaporan({ customers, orders, orderItems, payments, customerPackages }, p.range, p.preset, p.today),
    [customers, orders, orderItems, payments, customerPackages, p.range, p.preset, p.today],
  )

  // data-dirty-ignore: every control here (period, tabs, filter, N days) only changes what is shown, so none of it
  // is unsaved work that should hold back an app update (dirtyState)
  return (
    <div data-dirty-ignore>
      <PageHeader title="Laporan" subtitle={p.label} />
      <RangeControls preset={p.preset} range={p.range} onPreset={p.setPreset} onCustom={p.setCustomRange} />
      {data.isPending ? (
        <LoadingState label="Menghitung laporan…" />
      ) : data.error ? (
        <ErrorState error={data.error} />
      ) : (
        <>
          <SummaryTiles report={report} today={p.today} />
          <MoneyInCard report={report} />
          <ServicesCard report={report} build={() => buildServicesSheet(report.orders)} />
          <TenantSplitCard split={report.split} />
          <CustomersCard
            report={report}
            customers={customers}
            orders={orders}
            today={p.today}
            tab={p.tab}
            onTab={p.setTab}
            filter={p.filter}
            onFilter={p.setFilter}
            promoTemplate={org.promo_template}
          />
        </>
      )}
    </div>
  )
}
