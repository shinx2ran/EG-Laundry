import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDate, formatRupiah } from '../../lib/format'
import { dayLabel, formatCompactRupiah, type MoneyIn } from './dashboardModel'

const BAR = '#0284c7' // brand-600
const INK_MUTED = '#64748b' // slate-500
const GRID = '#e2e8f0' // slate-200

interface Point {
  date: string
  label: string
  total: number
}

/**
 * Seven bars of uang masuk (SPEC 3.5), oldest left, today right. Loaded on its own (React.lazy in DashboardPage) so
 * recharts stays out of the main bundle and is never fetched for staff, who do not see it. One series: no legend (the
 * card title names it); the exact figures are in the tooltip and in a list for screen readers.
 */
export function MoneyChart({ series }: { series: MoneyIn[] }) {
  const data: Point[] = series.map((d) => ({ date: d.date, label: dayLabel(d.date), total: d.total }))
  return (
    <>
      <div className="h-40 px-1 pb-2 pt-3" aria-hidden data-testid="money-chart">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 296, height: 148 }}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK_MUTED }} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
            <YAxis tick={{ fontSize: 11, fill: INK_MUTED }} tickLine={false} axisLine={false} width={56} tickCount={3} allowDecimals={false} tickFormatter={(v: number) => formatCompactRupiah(v)} />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              formatter={(value) => [formatRupiah(Number(value)), 'Uang masuk']}
              labelFormatter={(_label, payload) => {
                const date = (payload?.[0]?.payload as Point | undefined)?.date
                return date ? formatDate(date, 'EEEE, d MMM yyyy') : ''
              }}
              labelStyle={{ color: '#0f172a', fontWeight: 600 }}
            />
            <Bar dataKey="total" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={32} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only">
        {series.map((d) => (
          <li key={d.date}>{`${formatDate(d.date, 'EEEE, d MMM')}: ${formatRupiah(d.total)}`}</li>
        ))}
      </ul>
    </>
  )
}
