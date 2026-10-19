import { useId, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Badge } from '../../components/ui'
import { ORDER_STATUS_LABEL, type OrderStatus } from '../../types/db'
import { PAY_STATUS_LABEL, type PayStatus } from '../../domain/pricing'
import { PACKAGE_STATE_LABEL, type PackageState } from './customerUtils'

/** A labelled on/off switch, 44px tall so a thumb hits it; the whole row toggles. */
export function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="min-w-0">
        <span id={id} className="block text-sm font-medium text-slate-700">
          {label}
        </span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative h-7 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
          checked ? 'bg-brand-600' : 'bg-slate-300',
        )}
      >
        <span className={clsx('absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} />
      </button>
    </div>
  )
}

export interface ChipOption<K extends string> {
  key: K
  label: string
  count?: number
}

/**
 * Filter chips (Semua / Anak kos / Umum) as a radio group. data-dirty-ignore: a filter only changes what is
 * shown, so it must not hold back an app update (dirtyState).
 */
export function FilterChips<K extends string>({ label, value, options, onChange }: { label: string; value: K; options: ChipOption<K>[]; onChange: (key: K) => void }) {
  return (
    <div role="radiogroup" aria-label={label} data-dirty-ignore className="flex gap-2 overflow-x-auto pb-0.5">
      {options.map((o) => {
        const selected = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.key)}
            className={clsx(
              'inline-flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors sm:min-h-9',
              selected ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {o.label}
            {o.count !== undefined && <span className={clsx('tabular-nums', selected ? 'text-brand-100' : 'text-slate-400')}>({o.count})</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Label/value row used in summary boxes. */
export function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className={clsx('text-right tabular-nums', strong ? 'font-semibold text-slate-900' : 'text-slate-800')}>{value}</span>
    </div>
  )
}

const ORDER_STATUS_TONE: Record<OrderStatus, 'info' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  received: 'info',
  processing: 'warning',
  ready: 'success',
  done: 'neutral',
  cancelled: 'danger',
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER_STATUS_TONE[status]}>{ORDER_STATUS_LABEL[status]}</Badge>
}

const PAY_STATUS_TONE: Record<PayStatus, 'success' | 'warning' | 'danger'> = {
  lunas: 'success',
  sebagian: 'warning',
  belum: 'danger',
}

export function PayStatusBadge({ status }: { status: PayStatus }) {
  return <Badge tone={PAY_STATUS_TONE[status]}>{PAY_STATUS_LABEL[status]}</Badge>
}

const PACKAGE_STATE_TONE: Record<PackageState, 'success' | 'neutral' | 'danger'> = {
  active: 'success',
  empty: 'neutral',
  expired: 'danger',
}

export function PackageStateBadge({ state }: { state: PackageState }) {
  return <Badge tone={PACKAGE_STATE_TONE[state]}>{PACKAGE_STATE_LABEL[state]}</Badge>
}

/** Round avatar with initials. */
export function Avatar({ text, className }: { text: string; className?: string }) {
  return (
    <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800', className)} aria-hidden>
      {text}
    </span>
  )
}
