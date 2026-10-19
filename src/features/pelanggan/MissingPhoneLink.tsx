import { Link } from 'react-router'
import { clsx } from 'clsx'
import { MessageCirclePlus } from 'lucide-react'
import type { Customer } from '../../types/db'

/**
 * Stands in for a WhatsApp button when the customer has no phone number (SPEC 3.9): an amber "add" bubble that
 * opens the customer's form at Nomor HP, so the number is one tap away instead of a dead grey icon.
 */
export function MissingPhoneLink({ customer, className, iconClassName = 'h-5 w-5' }: { customer: Pick<Customer, 'id' | 'name'> | null | undefined; className: string; iconClassName?: string }) {
  if (!customer) {
    return (
      <span aria-label="Nomor HP belum diisi" title="Nomor HP belum diisi" className={clsx(className, 'bg-slate-100 text-slate-300')}>
        <MessageCirclePlus className={iconClassName} aria-hidden />
      </span>
    )
  }
  return (
    <Link
      // PelangganDetailPage opens the form at Nomor HP for ?isi=hp
      to={`/pelanggan/${customer.id}?isi=hp`}
      aria-label={`Nomor HP ${customer.name} belum diisi: isi sekarang`}
      title="Nomor HP belum diisi: ketuk untuk mengisi"
      className={clsx(className, 'bg-amber-50 text-amber-600 hover:bg-amber-100')}
    >
      <MessageCirclePlus className={iconClassName} aria-hidden />
    </Link>
  )
}
