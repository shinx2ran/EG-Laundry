import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import { Badge, Segmented } from '../../components/ui'
import type { PackageCatalogItem, Service, Unit } from '../../types/db'
import { UNITS } from '../../types/db'
import { formatRupiah } from '../../lib/format'
import { UNIT_GROUP_LABEL, describeDays, describeMinQty, describePackageContent, describeValidity, priceText } from './hargaUtils'

// ---------- form widgets ----------

/** Per kg / Per pcs as a segmented control (SPEC 3.1 unit); the label sits above it like an input's. */
export function UnitPicker({ value, onChange, label = 'Satuan' }: { value: Unit; onChange: (unit: Unit) => void; label?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <Segmented label={label} value={value} options={UNITS.map((u) => ({ key: u, label: UNIT_GROUP_LABEL[u] }))} onChange={onChange} />
    </div>
  )
}

// ---------- list rows ----------

/**
 * The text block of a row is a button that opens the edit form for owner/admin ("Ubah <nama>"); for staff it is
 * plain text (SPEC 3.10: read only, no buttons).
 */
function RowBody({ editable, name, onEdit, children }: { editable: boolean; name: string; onEdit: () => void; children: ReactNode }) {
  const className = 'flex min-h-14 min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left'
  if (!editable) return <div className={className}>{children}</div>
  return (
    <button type="button" onClick={onEdit} className={clsx(className, 'hover:bg-slate-50')}>
      <span className="sr-only">Ubah {name} </span>
      {children}
      <Pencil className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
    </button>
  )
}

/** One service: name (+ Nonaktif), regular and express price, working days, minimum; ▲/▼ for owner/admin. */
export function ServiceRow({
  service,
  editable,
  canUp,
  canDown,
  busy,
  onEdit,
  onMove,
}: {
  service: Service
  editable: boolean
  canUp: boolean
  canDown: boolean
  /** a move is in flight: both arrows wait */
  busy: boolean
  onEdit: () => void
  onMove: (direction: 'up' | 'down') => void
}) {
  const minQty = describeMinQty(service)
  return (
    <li data-testid="service-row" data-service={service.name} className="flex items-stretch">
      <RowBody editable={editable} name={service.name} onEdit={onEdit}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={clsx('truncate text-sm font-semibold', service.active ? 'text-slate-900' : 'text-slate-500')}>{service.name}</span>
            {!service.active && <Badge tone="neutral">Nonaktif</Badge>}
          </span>
          {/* regular and express price on their own lines: never broken mid-price on a 360 px phone */}
          <span className="block whitespace-nowrap text-sm tabular-nums text-slate-800" data-testid="price-regular">
            {priceText(service.price, service.unit)}
          </span>
          <span className="block whitespace-nowrap text-sm tabular-nums text-slate-800" data-testid="price-express">
            <span className="text-slate-500">express </span>
            {service.price_express === null ? <span className="text-slate-400">—</span> : priceText(service.price_express, service.unit)}
          </span>
          <span className="block text-xs text-slate-500">
            {describeDays(service)}
            {minQty && ` · ${minQty}`}
          </span>
        </span>
      </RowBody>
      {editable && (
        <span className="flex shrink-0 items-center pr-1">
          <SortButton label={`Naikkan ${service.name}`} disabled={busy || !canUp} onClick={() => onMove('up')}>
            <ChevronUp className="h-5 w-5" aria-hidden />
          </SortButton>
          <SortButton label={`Turunkan ${service.name}`} disabled={busy || !canDown} onClick={() => onMove('down')}>
            <ChevronDown className="h-5 w-5" aria-hidden />
          </SortButton>
        </span>
      )}
    </li>
  )
}

function SortButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

/** One catalog entry: name (+ Nonaktif), qty + service, price, validity. */
export function PackageRow({ item, service, editable, onEdit }: { item: PackageCatalogItem; service: Service | undefined; editable: boolean; onEdit: () => void }) {
  return (
    <li data-testid="package-row" data-package={item.name} className="flex items-stretch">
      <RowBody editable={editable} name={item.name} onEdit={onEdit}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className={clsx('truncate text-sm font-semibold', item.active ? 'text-slate-900' : 'text-slate-500')}>{item.name}</span>
            {!item.active && <Badge tone="neutral">Nonaktif</Badge>}
          </span>
          <span className="block text-sm tabular-nums text-slate-800">
            {describePackageContent(item, service)}
            <span className="text-slate-500"> · </span>
            {formatRupiah(item.price)}
          </span>
          <span className="block text-xs text-slate-500">{describeValidity(item)}</span>
        </span>
      </RowBody>
    </li>
  )
}
