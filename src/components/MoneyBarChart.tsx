import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import { formatCompactRupiah, formatRupiah } from '../lib/format'

export interface MoneyBarPoint {
  key: string
  /** axis label: 'Sen', '5 Okt', 'Okt 2026' */
  label: string
  /** tooltip and screen-reader heading: 'Senin, 19 Okt 2026' */
  title: string
  amount: number
}

const BAR = '#0369a1' // brand-700
const INK_MUTED = '#64748b' // slate-500
const GRID = '#e2e8f0' // slate-200
const AXIS_TICK = { fontSize: 11, fill: INK_MUTED }

function ChartTooltip({ active, payload }: Pick<TooltipContentProps, 'active' | 'payload'>) {
  const point = active ? (payload?.[0]?.payload as MoneyBarPoint | undefined) : undefined
  if (!point) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-slate-900">{point.title}</p>
      <p className="tabular-nums text-slate-700">{formatRupiah(point.amount)}</p>
    </div>
  )
}

/**
 * Uang masuk (SPEC 3.5) as one series of bars, for the Dashboard (7 days) and Laporan (per day or per month). Pages
 * load it with React.lazy so recharts stays out of the main bundle and is never fetched for staff, who see neither
 * chart. One series: no legend (the card title names it); the exact figures are in the tooltip and, for screen
 * readers, in a list next to the chart.
 */
export function MoneyBarChart({ points, height, testId }: { points: MoneyBarPoint[]; height: number; testId: string }) {
  const everyLabel = points.length <= 8
  return (
    <>
      <div className="w-full" style={{ height }} aria-hidden data-testid={testId}>
        <ResponsiveContainer width="100%" height={height} initialDimension={{ width: 296, height }}>
          <BarChart data={points} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID }} interval={everyLabel ? 0 : 'preserveStartEnd'} minTickGap={12} />
            <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={48} tickCount={4} allowDecimals={false} tickFormatter={(v: number) => formatCompactRupiah(v)} />
            <Tooltip content={(props) => <ChartTooltip active={props.active} payload={props.payload} />} cursor={{ fill: '#f1f5f9' }} />
            <Bar name="Uang masuk" dataKey="amount" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={everyLabel ? 32 : 24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only">
        {points.map((p) => (
          <li key={p.key}>{`${p.title}: ${formatRupiah(p.amount)}`}</li>
        ))}
      </ul>
    </>
  )
}
