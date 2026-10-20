import { Link } from 'react-router'
import { clsx } from 'clsx'
import type { Customer, Order, OrderItem } from '../../types/db'
import type { OrderTotals } from '../../domain/pricing'
import { itemsSummary } from '../../domain/messages'
import { formatDate, formatRupiah } from '../../lib/format'
import { dateLine } from './orderUtils'
import { ExpressBadge, LateBadge, OrderStatusBadge, PayStatusBadge, TenantBadge } from './components'

/**
 * One order in the list, a single tap target to its detail page: customer and Anak kos badge, items, number, status,
 * express; on the right the total and the pay status; underneath the promised date (red "Terlambat" once passed) or
 * when it was ready / picked up.
 */
export function OrderRow({ order, customer, items, totals, today }: { order: Order; customer: Customer | undefined; items: OrderItem[]; totals: OrderTotals; today: string }) {
  const when = dateLine(order, today)
  const cancelled = order.status === 'cancelled'
  return (
    <li data-testid="order-row" data-order-number={order.order_number}>
      <Link to={`/pesanan/${order.id}`} className="block px-3 py-3 hover:bg-slate-50 focus-visible:bg-brand-50 focus-visible:outline-none sm:px-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className={clsx('min-w-0 truncate font-medium', cancelled ? 'text-slate-500 line-through' : 'text-slate-900')}>{customer?.name ?? 'Pelanggan tidak ditemukan'}</span>
              <TenantBadge customer={customer} />
            </p>
            <p className="truncate text-sm text-slate-600">{items.length > 0 ? itemsSummary(items) : '—'}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-xs text-slate-500">{order.order_number}</span>
              <OrderStatusBadge status={order.status} />
              {order.express && <ExpressBadge />}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className={clsx('font-semibold tabular-nums', cancelled ? 'text-slate-400 line-through' : 'text-slate-900')}>{formatRupiah(totals.total)}</span>
            {!cancelled && <PayStatusBadge status={totals.payStatus} />}
          </div>
        </div>
        {when.label && (
          <p className={clsx('mt-1 flex flex-wrap items-center gap-1.5 text-xs', when.late ? 'font-medium text-red-700' : 'text-slate-500')}>
            <span>{`${when.label} ${formatDate(when.date)}`}</span>
            {when.late && <LateBadge />}
          </p>
        )}
      </Link>
    </li>
  )
}
