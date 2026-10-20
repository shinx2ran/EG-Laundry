import { Link } from 'react-router'
import { clsx } from 'clsx'
import { MessageCirclePlus } from 'lucide-react'
import type { Customer } from '../../types/db'

const LABEL = 'Nomor HP belum diisi'

/**
 * Stands in for a WhatsApp button when the customer has no phone number (SPEC 3.9): an amber "add" link that opens
 * the customer's form at Nomor HP (/pelanggan/:id?isi=hp, handled by PelangganDetailPage), so the number is one tap
 * away instead of a dead grey icon. The one implementation for every screen:
 * - `bubble` (default): a round icon next to a list row; `className` gives its size;
 * - `button`: a full button with the text, where a WhatsApp button would be (order detail, receipt card).
 */
export function MissingPhoneLink({
  customer,
  className,
  iconClassName = 'h-5 w-5',
  variant = 'bubble',
}: {
  customer: Pick<Customer, 'id' | 'name'> | null | undefined
  className?: string
  iconClassName?: string
  variant?: 'bubble' | 'button'
}) {
  const look =
    variant === 'button'
      ? 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 text-sm font-medium text-amber-800 hover:bg-amber-100'
      : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
  const icon = <MessageCirclePlus className={variant === 'button' ? 'h-4 w-4 shrink-0' : iconClassName} aria-hidden />
  if (!customer) {
    return (
      <span aria-label={LABEL} title={LABEL} className={clsx(className, variant === 'button' ? look : 'bg-slate-100 text-slate-300')}>
        {icon}
        {variant === 'button' && LABEL}
      </span>
    )
  }
  return (
    <Link to={`/pelanggan/${customer.id}?isi=hp`} aria-label={`Nomor HP ${customer.name} belum diisi: isi sekarang`} title={`${LABEL}: ketuk untuk mengisi`} className={clsx(look, className)}>
      {icon}
      {variant === 'button' && LABEL}
    </Link>
  )
}
