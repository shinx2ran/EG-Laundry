import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { MessageCircle } from 'lucide-react'
import { Badge } from '../../components/ui'
import { ORDER_STATUS_LABEL, type OrderStatus } from '../../types/db'
import { PAY_STATUS_LABEL, type PayStatus } from '../../domain/pricing'

/*
 * Order badges for every screen that lists orders (Pesanan, the customer's history, later the Dashboard).
 * Row, Switch and Segmented live in src/components/ui; TenantBadge and MissingPhoneLink in src/features/pelanggan.
 */

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

export function LateBadge() {
  return <Badge tone="danger">Terlambat</Badge>
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
