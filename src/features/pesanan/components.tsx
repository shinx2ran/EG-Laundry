import { Badge } from '../../components/ui'
import { ORDER_STATUS_LABEL, type OrderStatus } from '../../types/db'
import { PAY_STATUS_LABEL, type PayStatus } from '../../domain/pricing'

/*
 * Order badges for every screen that lists orders (Pesanan, the customer's history, later the Dashboard).
 * Row, Switch, Segmented and WhatsAppLink live in src/components/ui; TenantBadge and MissingPhoneLink in
 * src/features/pelanggan.
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
