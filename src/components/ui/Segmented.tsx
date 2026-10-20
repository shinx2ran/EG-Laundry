import { clsx } from 'clsx'

/** A segmented choice (radio group, e.g. Tunai / Transfer / QRIS or Per kg / Per pcs) with 44px targets on phones. */
export function Segmented<K extends string>({ label, value, options, onChange }: { label: string; value: K; options: { key: K; label: string }[]; onChange: (key: K) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid rounded-lg border border-slate-200 bg-white p-1 text-sm" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={o.key === value}
          onClick={() => onChange(o.key)}
          className={clsx('min-h-11 rounded-md px-2 font-medium transition-colors sm:min-h-9', o.key === value ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
