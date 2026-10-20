import { useId } from 'react'
import { clsx } from 'clsx'

/**
 * A labelled on/off switch (role="switch"). The whole row is the tap target, at least 44px tall; the label names
 * the switch, the hint under it explains the current state. The hint is plain text: the row is one button.
 */
export function Switch({
  label,
  hint,
  checked,
  onChange,
  disabled,
  className,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}) {
  const labelId = useId()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    >
      <span className="min-w-0">
        <span id={labelId} className="block text-sm font-medium text-slate-700">
          {label}
        </span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
      <span aria-hidden className={clsx('relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors', checked ? 'bg-brand-700' : 'bg-slate-300')}>
        <span className={clsx('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
      </span>
    </button>
  )
}
