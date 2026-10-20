import type { ReactNode } from 'react'
import { clsx } from 'clsx'

/** Label/value row of a summary box (totals, order info): the label left, the value right-aligned. */
export function Row({ label, value, strong, className }: { label: ReactNode; value: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={clsx('flex items-center justify-between gap-3 text-sm', className)}>
      <span className="text-slate-600">{label}</span>
      <span className={clsx('text-right tabular-nums', strong ? 'font-semibold text-slate-900' : 'text-slate-800')}>{value}</span>
    </div>
  )
}
