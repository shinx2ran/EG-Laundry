import { clsx } from 'clsx'
import { Badge } from '../../components/ui'
import type { Customer } from '../../types/db'
import { PACKAGE_STATE_LABEL, tenantBadgeText, type PackageState } from './customerUtils'

// Switch and Row live in src/components/ui; the order and pay status badges in src/features/pesanan/components.

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

/** 'Anak kos · B3' for a kos tenant (SPEC 3.2); nothing for a walk-in. Used on the customer and the order screens. */
export function TenantBadge({ customer }: { customer: Pick<Customer, 'is_tenant' | 'room_name'> | null | undefined }) {
  const label = customer ? tenantBadgeText(customer) : null
  return label ? <Badge tone="info">{label}</Badge> : null
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
