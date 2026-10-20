import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import { formatRupiah } from '../../lib/format'
import { formatCompactRupiah, type ChartPoint } from './reportModel'

const AXIS_TICK = { fontSize: 11, fill: '#64748b' }
const CHART_HEIGHT = 200

function ChartTooltip({ active, payload }: Pick<TooltipContentProps, 'active' | 'payload'>) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0]?.payload as ChartPoint | undefined
  if (!point) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-slate-900">{point.label}</p>
      <p className="tabular-nums text-slate-700">{formatRupiah(point.amount)}</p>
    </div>
  )
}

/** Uang masuk per day (or per month for long ranges) as bars. Loaded lazily: recharts is a large library. */
export function UangMasukChart({ data }: { data: ChartPoint[] }) {
  return (
    <div data-testid="uang-masuk-chart" style={{ height: CHART_HEIGHT }} className="w-full">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCompactRupiah(v)} width={56} />
          <Tooltip content={(props) => <ChartTooltip active={props.active} payload={props.payload} />} cursor={{ fill: '#f1f5f9' }} />
          <Bar isAnimationActive={false} name="Uang masuk" dataKey="amount" fill="#0369a1" radius={[3, 3, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
