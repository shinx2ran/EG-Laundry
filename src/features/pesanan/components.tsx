import { useId, type ReactNode } from 'react'
import { Link } from 'react-router'
import { clsx } from 'clsx'
import { MessageCircle, MessageCirclePlus } from 'lucide-react'
import { Badge } from '../../components/ui'
import { ORDER_STATUS_LABEL, type Customer, type OrderStatus } from '../../types/db'
import { PAY_STATUS_LABEL, type PayStatus } from '../../domain/pricing'
import { tenantLabel } from './orderUtils'

const ORDER_STATUS_TONE: Record<OrderStatus, 'info' | 'warning' | 'success' | 'neutral' | 'danger'> = {
  received: 'info',
  processing: 'warning',
  ready: 'success',
  done: 'neutral',
  cancelled: 'danger',
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <Badge tone={ORDER_STATUS_TONE[status]}>
      <span data-testid="order-status">{ORDER_STATUS_LABEL[status]}</span>
    </Badge>
  )
}

const PAY_STATUS_TONE: Record<PayStatus, 'success' | 'warning' | 'danger'> = {
  lunas: 'success',
  sebagian: 'warning',
  belum: 'danger',
}

export function PayStatusBadge({ status }: { status: PayStatus }) {
  return (
    <Badge tone={PAY_STATUS_TONE[status]}>
      <span data-testid="pay-status">{PAY_STATUS_LABEL[status]}</span>
    </Badge>
  )
}

export function ExpressBadge() {
  return <Badge tone="brand">Express</Badge>
}

/** 'Anak kos · B3' for a kos tenant; nothing for a walk-in. */
export function TenantBadge({ customer }: { customer: Pick<Customer, 'is_tenant' | 'room_name'> | undefined }) {
  const label = tenantLabel(customer)
  return label ? <Badge tone="info">{label}</Badge> : null
}

export function LateBadge() {
  return <Badge tone="danger">Terlambat</Badge>
}

/** Label/value row used in summary boxes. */
export function Row({ label, value, strong, className }: { label: ReactNode; value: ReactNode; strong?: boolean; className?: string }) {
  return (
    <div className={clsx('flex items-center justify-between gap-3 text-sm', className)}>
      <span className="text-slate-600">{label}</span>
      <span className={clsx('text-right tabular-nums', strong ? 'font-semibold text-slate-900' : 'text-slate-800')}>{value}</span>
    </div>
  )
}

/** A labelled on/off switch, 44px tall so a thumb hits it. */
export function Switch({ label, hint, checked, onChange, disabled }: { label: string; hint?: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
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
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative h-7 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50',
          checked ? 'bg-brand-600' : 'bg-slate-300',
        )}
      >
        <span className={clsx('absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0')} />
      </button>
    </div>
  )
}

/** Big green WhatsApp link (wa.me) with the text already filled in. */
export function WhatsAppLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={clsx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
        className,
      )}
    >
      <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
      {children}
    </a>
  )
}

/**
 * Stands in for a WhatsApp button when the customer has no phone number (SPEC 3.9): an amber "add" link that opens
 * the customer's form at Nomor HP (/pelanggan/:id?isi=hp), so the number is one tap away.
 */
export function MissingPhoneLink({ customer, className }: { customer: Pick<Customer, 'id' | 'name'>; className?: string }) {
  return (
    <Link
      to={`/pelanggan/${customer.id}?isi=hp`}
      aria-label={`Nomor HP ${customer.name} belum diisi: isi sekarang`}
      title="Nomor HP belum diisi: ketuk untuk mengisi"
      className={clsx('inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-800 hover:bg-amber-100', className)}
    >
      <MessageCirclePlus className="h-4 w-4 shrink-0" aria-hidden />
      Nomor HP belum diisi
    </Link>
  )
}

/** A segmented choice (radio group) with 44px targets. */
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
