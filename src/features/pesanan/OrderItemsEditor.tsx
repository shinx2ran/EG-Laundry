import { useId, useState } from 'react'
import { clsx } from 'clsx'
import { Minus, Plus, Trash2 } from 'lucide-react'
import { CountInput, Field, Input, inputClass } from '../../components/ui'
import type { OrderItem, Service } from '../../types/db'
import { formatQty, formatRupiah } from '../../lib/format'
import { minQtyHint, newDraftRow, parseQtyText, qtyText, rowUnit, servicePriceLabel, stepQty, type DraftLine, type DraftRow, type PackageChoice } from './orderForm'

export interface OrderItemsEditorProps {
  rows: DraftRow[]
  onChange: (rows: DraftRow[]) => void
  /** the whole price list: a line that already bills an inactive service keeps it selectable */
  services: Service[]
  express: boolean
  /** priced lines in the order of `rows` (draftLines; in the Ubah dialog over keepOldPrices) */
  lines: DraftLine[]
  /** per row: the line keeps the price it was made with (Ubah) */
  kept?: boolean[]
  /** the package a row may draw on and what is left of it for this row (the other rows of the draft deducted) */
  packageFor: (row: DraftRow) => PackageChoice | null
  /** the order's current items (Ubah): names of lines whose service was deleted later */
  existing?: Pick<OrderItem, 'id' | 'service_id' | 'service_name' | 'unit'>[]
}

/**
 * The order lines (SPEC 3.3, 3.4, 3.12): a service per line (active ones; express prices when the order is express),
 * the qty (kg in 0,5 steps with 2 decimals accepted, pcs whole), "Pakai paket (sisa X kg)" when the customer has a
 * usable package for that service, a note, and the line total with the minimum applied. Problems are shown per line.
 */
export function OrderItemsEditor({ rows, onChange, services, express, lines, kept, packageFor, existing = [] }: OrderItemsEditorProps) {
  const byId = new Map(services.map((s) => [s.id, s]))
  const update = (key: string, patch: Partial<DraftRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key))
  const add = () => onChange([...rows, newDraftRow()])

  const setService = (row: DraftRow, serviceId: string) => {
    const service = byId.get(serviceId)
    const qty = service?.unit === 'pcs' ? Math.max(1, Math.round(row.qty)) : row.qty > 0 ? row.qty : 1
    update(row.key, { service_id: serviceId, qty, customer_package_id: null })
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {rows.map((row, i) => {
          const line = lines[i]
          const service = byId.get(row.service_id)
          const old = row.id ? existing.find((it) => it.id === row.id) : undefined
          const deletedService = old !== undefined && old.service_id === null && row.service_id === ''
          const unit = service ? rowUnit(service) : deletedService ? old.unit : 'kg'
          const options = services
            .filter((s) => s.active || s.id === row.service_id)
            .map((s) => ({ value: s.id, label: `${s.name}${s.active ? '' : ' (nonaktif)'} · ${servicePriceLabel(s, express, formatRupiah)}` }))
          const choice = row.service_id ? packageFor(row) : null
          const usesPackage = row.customer_package_id !== null
          const hint = service ? minQtyHint(row.qty, service) : null
          const keptPrice = kept?.[i] && line?.unitPrice != null && service && !usesPackage ? line.unitPrice : null
          const currentPrice = service ? (express ? service.price_express : service.price) : null
          return (
            <li key={row.key} data-testid="item-row" className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-end gap-2">
                <ServiceSelect
                  label={`Layanan ${rows.length > 1 ? i + 1 : ''}`.trim()}
                  value={row.service_id}
                  placeholder={deletedService ? `${old.service_name} (layanan dihapus)` : 'Pilih layanan'}
                  options={options}
                  onChange={(id) => setService(row, id)}
                />
                <button
                  type="button"
                  onClick={() => remove(row.key)}
                  disabled={rows.length === 1}
                  aria-label={`Hapus item ${i + 1}`}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-end justify-between gap-3">
                {unit === 'pcs' ? (
                  <div className="w-28">
                    <CountInput label="Jumlah (pcs)" value={Math.max(1, Math.round(row.qty))} onChange={(qty) => update(row.key, { qty })} className="h-11" />
                  </div>
                ) : (
                  <KgInput value={row.qty} onChange={(qty) => update(row.key, { qty })} />
                )}
                <div className="min-w-0 pb-1 text-right" data-testid="line-total">
                  <p className="text-base font-semibold tabular-nums text-slate-900">{line?.lineTotal != null ? formatRupiah(line.lineTotal) : '–'}</p>
                  {line?.service && line.unitPrice != null && (
                    <p className="text-xs tabular-nums text-slate-500">{usesPackage ? `${formatQty(line.billedQty, unit)} dari paket` : `${formatQty(line.billedQty, unit)} × ${formatRupiah(line.unitPrice)}`}</p>
                  )}
                </div>
              </div>

              {hint && <p className="text-xs text-amber-700">{`Dihitung ${hint} (minimal pesanan).`}</p>}
              {keptPrice !== null && currentPrice !== null && keptPrice !== currentPrice && (
                <p className="text-xs text-slate-500">{`Harga saat pesanan dibuat dipakai: ${formatRupiah(keptPrice)}/${unit} (sekarang ${formatRupiah(currentPrice)}).`}</p>
              )}

              {(choice || usesPackage) && (
                <label className="flex min-h-11 items-center gap-3 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
                  <input
                    type="checkbox"
                    className="h-5 w-5 shrink-0 accent-violet-700"
                    checked={usesPackage}
                    onChange={(e) => update(row.key, { customer_package_id: e.target.checked && choice ? choice.pkg.id : null })}
                  />
                  <span className="min-w-0">
                    <span className="block font-medium">{choice ? `Pakai paket (sisa ${formatQty(choice.remaining, unit)})` : 'Pakai paket'}</span>
                    {choice && <span className="block truncate text-xs text-violet-700">{choice.pkg.name}</span>}
                  </span>
                </label>
              )}

              <Input label="Catatan item" value={row.notes} onChange={(e) => update(row.key, { notes: e.target.value })} placeholder="opsional, mis. noda di kerah" className="h-11" />

              {line?.problem && row.service_id !== '' && (
                <p role="alert" className="text-sm text-red-600" data-testid="line-problem">
                  {line.problem}
                </p>
              )}
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={add}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-brand-300 bg-brand-50/40 text-sm font-medium text-brand-800 hover:bg-brand-50"
      >
        <Plus className="h-4 w-4" aria-hidden /> Tambah layanan
      </button>
    </div>
  )
}

function ServiceSelect({ label, value, placeholder, options, onChange }: { label: string; value: string; placeholder: string; options: { value: string; label: string }[]; onChange: (id: string) => void }) {
  const id = useId()
  return (
    <Field label={label} htmlFor={id} className="min-w-0 flex-1">
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={clsx(inputClass, 'h-11', value === '' && 'text-slate-500')}>
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

/**
 * Weight in kg: typed with a comma or a dot ('2,5'), 2 decimals accepted, and − / + buttons in 0,5 kg steps.
 * The parent keeps the last number read; the box shows it again when it loses focus.
 */
export function KgInput({ value, onChange, label = 'Berat (kg)' }: { value: number; onChange: (qty: number) => void; label?: string }) {
  const id = useId()
  const [text, setText] = useState(qtyText(value))
  const [synced, setSynced] = useState(value)
  // the parent changed the qty (a step button, another service): show it, unless the box already says the same
  if (value !== synced) {
    setSynced(value)
    if (parseQtyText(text) !== value) setText(qtyText(value))
  }
  const step = (delta: number) => onChange(stepQty(value, delta, 0.5))
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label="Kurangi 0,5 kg" onClick={() => step(-0.5)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
          <Minus className="h-4 w-4" />
        </button>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          className={clsx(inputClass, 'h-11 w-20 text-center tabular-nums')}
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d.,]/g, '').slice(0, 7)
            setText(t)
            const n = parseQtyText(t)
            if (n !== null) onChange(n)
          }}
          onBlur={() => setText(qtyText(value))}
        />
        <button type="button" aria-label="Tambah 0,5 kg" onClick={() => step(0.5)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </Field>
  )
}
