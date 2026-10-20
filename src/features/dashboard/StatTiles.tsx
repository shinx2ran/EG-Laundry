import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { clsx } from 'clsx'
import { Clock, Inbox, PackageCheck, ReceiptText, Wallet } from 'lucide-react'
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from '../../types/db'
import { formatRupiah } from '../../lib/format'
import { inProgressLink, intakeText, type DashboardModel } from './dashboardModel'

const TILE = 'block min-h-11 rounded-xl border border-slate-200 bg-white p-3 shadow-sm'
const TILE_LINK = 'transition-colors hover:border-brand-300 hover:bg-brand-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2'

function Tile({ label, value, sub, to, icon, testId, valueClassName, className }: { label: string; value: ReactNode; sub?: ReactNode; to?: string; icon: ReactNode; testId: string; valueClassName?: string; className?: string }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        <span className="shrink-0 text-slate-400">{icon}</span>
        {label}
      </span>
      <span className={clsx('mt-1 block whitespace-nowrap text-2xl font-semibold tabular-nums', valueClassName ?? 'text-slate-900')} data-testid="tile-value">
        {value}
      </span>
      {sub && <span className="mt-0.5 block text-xs text-slate-500">{sub}</span>}
    </>
  )
  return to ? (
    <Link to={to} data-testid={testId} className={clsx(TILE, TILE_LINK, className)}>
      {body}
    </Link>
  ) : (
    <div data-testid={testId} className={clsx(TILE, className)}>
      {body}
    </div>
  )
}

/**
 * The five numbers of the day (SPEC 3.6), each opening the matching list: Masuk hari ini, Sedang proses (late ones in
 * red), Siap diambil, Belum bayar and Uang masuk hari ini split by Tunai / Transfer / QRIS. The money tile leads to
 * Laporan for the owner/admin; staff do not have that page (SPEC 3.10), so for them it is not a link.
 */
export function StatTiles({ model, isAdmin }: { model: DashboardModel; isAdmin: boolean }) {
  const { intake, inProgress, late, ready, unpaid, moneyToday } = model
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <Tile
        testId="tile-masuk"
        label="Masuk hari ini"
        icon={<Inbox className="h-4 w-4" aria-hidden />}
        value={intake.count}
        sub={intake.count > 0 ? intakeText(intake) : 'Belum ada cucian masuk'}
        to="/pesanan"
      />
      <Tile
        testId="tile-proses"
        label="Sedang proses"
        icon={<Clock className="h-4 w-4" aria-hidden />}
        value={inProgress.count}
        sub={
          <>
            {`${inProgress.received} diterima · ${inProgress.processing} proses`}
            {late.length > 0 && <span className="block font-medium text-red-700">{`${late.length} terlambat`}</span>}
          </>
        }
        to={inProgressLink(inProgress)}
      />
      <Tile
        testId="tile-siap"
        label="Siap diambil"
        icon={<PackageCheck className="h-4 w-4" aria-hidden />}
        value={ready.length}
        valueClassName={ready.length > 0 ? 'text-emerald-700' : undefined}
        sub={ready.length > 0 ? 'menunggu diambil' : 'Tidak ada'}
        to="/pesanan?tab=siap"
      />
      <Tile
        testId="tile-belum-bayar"
        label="Belum bayar"
        icon={<ReceiptText className="h-4 w-4" aria-hidden />}
        value={unpaid.count}
        sub={unpaid.count > 0 ? <span className="font-medium text-red-700">{formatRupiah(unpaid.amount)}</span> : 'Semua lunas'}
        to="/pesanan"
      />
      <Tile
        testId="tile-uang-masuk"
        className="col-span-2"
        label="Uang masuk hari ini"
        icon={<Wallet className="h-4 w-4" aria-hidden />}
        value={formatRupiah(moneyToday.total)}
        valueClassName={moneyToday.total > 0 ? 'text-emerald-700' : undefined}
        sub={
          <>
            <span className="mt-1 grid grid-cols-3 gap-2">
              {PAYMENT_METHODS.map((m) => (
                <span key={m} className="min-w-0" data-testid={`money-${m}`}>
                  <span className="block">{PAYMENT_METHOD_LABEL[m]}</span>
                  <span className="block truncate font-medium tabular-nums text-slate-800">{formatRupiah(moneyToday.byMethod[m])}</span>
                </span>
              ))}
            </span>
            {moneyToday.packages > 0 && <span className="mt-1 block">{`termasuk paket ${formatRupiah(moneyToday.packages)}`}</span>}
          </>
        }
        to={isAdmin ? '/laporan' : undefined}
      />
    </div>
  )
}
