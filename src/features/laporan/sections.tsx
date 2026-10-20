import { lazy, Suspense, useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Banknote, FileSpreadsheet, FileText, Scale, ShoppingBag, Wallet } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, Segmented, StatCard, useToast } from '../../components/ui'
import { inputClass } from '../../components/ui/Input'
import { formatDate, formatNumber, formatQty, formatRupiah } from '../../lib/format'
import { PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from '../../types/db'
import {
  RANGE_PRESETS,
  RANGE_PRESET_LABEL,
  describeDelta,
  formatPct,
  isISODate,
  rangeLabel,
  type DateRange,
  type Delta,
  type Laporan,
  type RangePreset,
  type SegmentKey,
  type TenantSplit,
} from './reportModel'
import { buildCsvBlob, buildXlsxBlob, downloadBlob, exportFileName, type ExportSheet } from './export'

const UangMasukChart = lazy(() => import('./UangMasukChart').then((m) => ({ default: m.UangMasukChart })))

// ---------------------------------------------------------------- range

/** Hari ini / Minggu ini / Bulan ini / Tahun ini / Khusus, and the two dates of Khusus. */
export function RangeControls({
  preset,
  range,
  onPreset,
  onCustom,
}: {
  preset: RangePreset
  range: DateRange
  onPreset: (preset: RangePreset) => void
  onCustom: (range: DateRange) => void
}) {
  return (
    <div className="mb-4 space-y-2" data-dirty-ignore>
      <Segmented label="Periode laporan" value={preset} options={RANGE_PRESETS.map((key) => ({ key, label: RANGE_PRESET_LABEL[key] }))} onChange={onPreset} />
      {/* keyed by the range: the inputs start over when the range changes from outside (another preset, the URL) */}
      {preset === 'custom' && <CustomRange key={`${range.start}_${range.end}`} range={range} onChange={onCustom} />}
    </div>
  )
}

function CustomRange({ range, onChange }: { range: DateRange; onChange: (range: DateRange) => void }) {
  const [start, setStart] = useState(range.start)
  const [end, setEnd] = useState(range.end)
  const [error, setError] = useState<string | null>(null)
  const apply = (s: string, e: string) => {
    if (!isISODate(s) || !isISODate(e)) return setError('Isi tanggal awal dan akhir.')
    if (s > e) return setError('Tanggal awal harus sebelum tanggal akhir.')
    setError(null)
    onChange({ start: s, end: e })
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600">
        Dari
        <input
          type="date"
          aria-label="Tanggal awal"
          className={clsx(inputClass, 'h-11 min-w-0')}
          value={start}
          max={end || undefined}
          onChange={(e) => {
            setStart(e.target.value)
            apply(e.target.value, end)
          }}
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-600">
        Sampai
        <input
          type="date"
          aria-label="Tanggal akhir"
          className={clsx(inputClass, 'h-11 min-w-0')}
          value={end}
          min={start || undefined}
          onChange={(e) => {
            setEnd(e.target.value)
            apply(start, e.target.value)
          }}
        />
      </label>
      {error && <p className="col-span-2 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------- tiles

function DeltaLine({ delta, higherIsBad = false }: { delta: Delta; higherIsBad?: boolean }) {
  const good = higherIsBad ? delta.direction === 'down' : delta.direction === 'up'
  const bad = higherIsBad ? delta.direction === 'up' : delta.direction === 'down'
  return (
    <span data-testid="delta" className={clsx('block tabular-nums', good && 'text-emerald-700', bad && 'text-red-700', delta.direction === 'flat' && 'text-slate-500')}>
      {delta.text}
    </span>
  )
}

const kg = (n: number) => formatQty(n, 'kg')

/** Uang masuk, Pesanan, Kg, Piutang with the change vs the same span of the previous period. */
export function SummaryTiles({ report, today }: { report: Laporan; today: string }) {
  const { figures: f, current: c, previous: p, comparison } = report
  return (
    <section aria-label="Ringkasan" className="mb-4">
      <p className="mb-2 text-xs text-slate-500" data-testid="compare-label">
        Dibanding {rangeLabel(comparison.previous)}
        {comparison.isPartial ? ' (sampai tanggal yang sama)' : ''}
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div data-testid="tile-uang-masuk" data-amount={f.moneyIn}>
          <StatCard label="Uang masuk" value={formatRupiah(f.moneyIn)} icon={<Wallet className="h-4 w-4" />} sub={<DeltaLine delta={describeDelta(c.moneyIn, p.moneyIn, formatRupiah)} />} />
        </div>
        <div data-testid="tile-pesanan" data-count={f.orders}>
          <StatCard
            label="Pesanan"
            value={formatNumber(f.orders)}
            icon={<ShoppingBag className="h-4 w-4" />}
            sub={
              <>
                <span className="block tabular-nums">Nilai {formatRupiah(report.orders.value)}</span>
                <DeltaLine delta={describeDelta(c.orders, p.orders, formatNumber)} />
              </>
            }
          />
        </div>
        <div data-testid="tile-kg">
          <StatCard
            label="Kg"
            value={kg(f.kg)}
            icon={<Scale className="h-4 w-4" />}
            sub={
              <>
                {report.orders.pcs > 0 && <span className="block tabular-nums">+ {formatQty(report.orders.pcs, 'pcs')}</span>}
                <DeltaLine delta={describeDelta(c.kg, p.kg, kg)} />
              </>
            }
          />
        </div>
        <div data-testid="tile-piutang">
          <StatCard
            label="Piutang"
            value={formatRupiah(f.piutang)}
            tone={f.piutang > 0 ? 'warning' : 'default'}
            icon={<Banknote className="h-4 w-4" />}
            sub={
              <>
                <span className="block">{report.piutangAsOf === today ? 'Belum dibayar, per hari ini' : `Belum dibayar, per ${formatDate(report.piutangAsOf)}`}</span>
                <DeltaLine delta={describeDelta(c.piutang, p.piutang, formatRupiah)} higherIsBad />
              </>
            }
          />
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- uang masuk

/** Daily (or monthly) bars of uang masuk, the total and its split per method and per source. */
export function MoneyInCard({ report }: { report: Laporan }) {
  const { money } = report
  const empty = money.total === 0
  return (
    <Card className="mb-4" data-testid="uang-masuk-card">
      <CardHeader
        title={report.granularity === 'day' ? 'Uang masuk per hari' : 'Uang masuk per bulan'}
        subtitle="Pembayaran pesanan (tanggal bayar) + paket terjual (tanggal beli)"
      />
      <CardBody className="space-y-3">
        <p className="text-2xl font-semibold tabular-nums text-slate-900">{formatRupiah(money.total)}</p>
        {empty ? (
          <p className="flex h-[120px] items-center justify-center rounded-lg bg-slate-50 text-sm text-slate-500">Belum ada uang masuk pada periode ini.</p>
        ) : (
          <Suspense fallback={<div className="h-[200px] animate-pulse rounded-lg bg-slate-50" aria-label="Memuat grafik" />}>
            <UangMasukChart data={report.chart} />
          </Suspense>
        )}
        <dl className="grid grid-cols-3 gap-2 text-center text-xs" aria-label="Per metode bayar">
          {PAYMENT_METHODS.map((m) => (
            <div key={m} className="rounded-lg bg-slate-50 px-1 py-2">
              <dt className="text-slate-500">{PAYMENT_METHOD_LABEL[m]}</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{formatRupiah(money.byMethod[m])}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-slate-500">
          Pembayaran pesanan <span className="font-medium tabular-nums text-slate-700">{formatRupiah(money.fromPayments)}</span> · Paket terjual{' '}
          <span className="font-medium tabular-nums text-slate-700">{formatRupiah(money.fromPackages)}</span>
        </p>
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------- export buttons

/** "Unduh XLSX" and "Unduh CSV" for one table; files are named eg-laundry-<what>-<from>_<to>. */
export function ExportButtons({ what, range, build, disabled }: { what: string; range: DateRange; build: () => ExportSheet; disabled?: boolean }) {
  const toast = useToast()
  const [busy, setBusy] = useState<'xlsx' | 'csv' | null>(null)
  const run = async (format: 'xlsx' | 'csv') => {
    setBusy(format)
    try {
      const sheet = build()
      const blob = format === 'xlsx' ? await buildXlsxBlob([sheet]) : buildCsvBlob(sheet)
      downloadBlob(blob, exportFileName(what, range, format))
    } catch (err) {
      toast.error(err instanceof Error ? `Gagal mengunduh: ${err.message}` : 'Gagal mengunduh.')
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" className="h-11" icon={<FileSpreadsheet className="h-4 w-4" />} loading={busy === 'xlsx'} disabled={disabled || busy !== null} onClick={() => void run('xlsx')}>
        Unduh XLSX
      </Button>
      <Button variant="outline" className="h-11" icon={<FileText className="h-4 w-4" />} loading={busy === 'csv'} disabled={disabled || busy !== null} onClick={() => void run('csv')}>
        Unduh CSV
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------- per service

/** Orders of the range per service (from the item snapshots): orders, kg / pcs (package part), value. */
export function ServicesCard({ report, build }: { report: Laporan; build: () => ExportSheet }) {
  const { orders } = report
  return (
    <Card className="mb-4" data-testid="services-card">
      <CardHeader title="Pesanan per layanan" subtitle={`${formatNumber(orders.count)} pesanan · ${kg(orders.kg)} · ${formatQty(orders.pcs, 'pcs')} · tanpa yang dibatalkan`} />
      {orders.services.length === 0 ? (
        <CardBody>
          <p className="py-4 text-center text-sm text-slate-500">Belum ada pesanan pada periode ini.</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-slate-100">
          {orders.services.map((s) => (
            <li key={s.key} data-testid="service-row" className="flex items-start justify-between gap-3 px-4 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-900">{s.service_name}</span>
                <span className="block text-xs text-slate-500">
                  {formatNumber(s.orders)} pesanan
                  {s.qtyFromPackage > 0 && ` · ${formatQty(s.qtyFromPackage, s.unit)} dari paket`}
                </span>
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="block font-semibold text-slate-900">{formatRupiah(s.value)}</span>
                <span className="block text-xs text-slate-500">{formatQty(s.qty, s.unit)}</span>
              </span>
            </li>
          ))}
          {orders.discount > 0 && (
            <li className="flex justify-between gap-3 px-4 py-2 text-sm text-slate-600">
              <span>Diskon</span>
              <span className="tabular-nums">−{formatRupiah(orders.discount)}</span>
            </li>
          )}
          <li className="flex justify-between gap-3 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-900">
            <span>Nilai pesanan</span>
            <span className="tabular-nums">{formatRupiah(orders.value)}</span>
          </li>
        </ul>
      )}
      <CardBody className="border-t border-slate-100">
        <ExportButtons what="layanan" range={report.range} build={build} disabled={orders.services.length === 0} />
      </CardBody>
    </Card>
  )
}

// ---------------------------------------------------------------- anak kos vs umum

const SPLIT_ROWS: { key: SegmentKey; label: string; format: (n: number) => string }[] = [
  { key: 'orders', label: 'Pesanan', format: formatNumber },
  { key: 'kg', label: 'Kg', format: kg },
  { key: 'value', label: 'Nilai pesanan', format: formatRupiah },
  { key: 'moneyIn', label: 'Uang masuk', format: formatRupiah },
]

function SplitRow({ label, tenant, walkin, tenantPct, walkinPct, testId }: { label: string; tenant: ReactNode; walkin: ReactNode; tenantPct: number | null; walkinPct: number | null; testId: string }) {
  return (
    <div data-testid={testId} data-tenant-pct={tenantPct ?? ''} data-walkin-pct={walkinPct ?? ''}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 flex h-3 overflow-hidden rounded-full bg-slate-100" aria-hidden>
        {tenantPct !== null && tenantPct > 0 && <div className="bg-sky-600" style={{ width: `${tenantPct}%` }} />}
        {walkinPct !== null && walkinPct > 0 && <div className="bg-amber-400" style={{ width: `${walkinPct}%` }} />}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-sm">
        <p className="min-w-0">
          <span className="font-semibold tabular-nums text-slate-900">{tenant}</span> <span className="text-xs tabular-nums text-sky-700">{formatPct(tenantPct)}</span>
        </p>
        <p className="min-w-0 text-right">
          <span className="font-semibold tabular-nums text-slate-900">{walkin}</span> <span className="text-xs tabular-nums text-amber-700">{formatPct(walkinPct)}</span>
        </p>
      </div>
    </div>
  )
}

/** Anak kos (kos tenants) vs umum: orders, kg, value and uang masuk with their shares. */
export function TenantSplitCard({ split }: { split: TenantSplit }) {
  return (
    <Card className="mb-4" data-testid="split-card">
      <CardHeader title="Anak kos vs umum" subtitle="Menurut status pelanggan saat ini" />
      <CardBody className="space-y-4">
        <div className="flex justify-between text-xs font-medium">
          <span className="inline-flex items-center gap-1.5 text-sky-800">
            <span className="h-2.5 w-2.5 rounded-sm bg-sky-600" aria-hidden />
            Anak kos
          </span>
          <span className="inline-flex items-center gap-1.5 text-amber-800">
            Umum
            <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" aria-hidden />
          </span>
        </div>
        {SPLIT_ROWS.map((r) => (
          <SplitRow
            key={r.key}
            testId={`split-${r.key}`}
            label={r.label}
            tenant={r.format(split.tenant[r.key])}
            walkin={r.format(split.walkin[r.key])}
            tenantPct={split.tenantPct[r.key]}
            walkinPct={split.walkinPct[r.key]}
          />
        ))}
      </CardBody>
    </Card>
  )
}
