import { useRef, type ChangeEvent, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { Upload } from 'lucide-react'
import { Button } from '../../components/ui'

/**
 * A 44px button that opens the file picker for a .json backup. The input stays in the page (visually hidden, with
 * its own label) so tests and assistive technology can reach it; the picked file is handed over once.
 */
export function JsonFileButton({ label, inputLabel, onFile, disabled, loading }: { label: string; inputLabel: string; onFile: (file: File) => void; disabled?: boolean; loading?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onFile(file)
  }
  return (
    <>
      <Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => ref.current?.click()} disabled={disabled} loading={loading} className="min-h-11">
        {label}
      </Button>
      <input ref={ref} type="file" accept="application/json,.json" aria-label={inputLabel} className="sr-only" tabIndex={-1} onChange={onChange} disabled={disabled} />
    </>
  )
}

/** One figure of a preview: label above, number below. */
export function CountTile({ label, value, tone = 'default', testId }: { label: string; value: number; tone?: 'default' | 'positive' | 'warning' | 'muted'; testId: string }) {
  const tones = { default: 'text-slate-900', positive: 'text-emerald-700', warning: 'text-amber-700', muted: 'text-slate-500' }
  return (
    <div data-testid={testId} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={clsx('text-lg font-semibold tabular-nums', tones[tone])}>{value}</dd>
    </div>
  )
}

/** A titled list showing the first rows of a group, with "+N lainnya". */
export function PreviewGroup<T>({ title, rows, render, testId, limit = 5 }: { title: string; rows: T[]; render: (row: T) => ReactNode; testId: string; limit?: number }) {
  if (rows.length === 0) return null
  return (
    <div data-testid={testId} className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} ({rows.length})
      </p>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
        {rows.slice(0, limit).map((row, i) => (
          <li key={i} className="break-words px-3 py-2">
            {render(row)}
          </li>
        ))}
        {rows.length > limit && <li className="px-3 py-2 text-slate-500">+{rows.length - limit} lainnya</li>}
      </ul>
    </div>
  )
}
