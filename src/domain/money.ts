/**
 * Uang masuk (SPEC 3.5), the one definition the Dashboard and Laporan both use:
 *   Σ payments.amount by `paid_at` + Σ customer_packages.price by `purchased_at`,
 * each counted on its calendar day and under its method (Tunai / Transfer / QRIS). Pure: the range or `today` is
 * always passed in.
 */
import type { CustomerPackage, Payment, PaymentMethod } from '../types/db'
import { PAYMENT_METHODS } from '../types/db'
import { addDaysISO } from '../lib/format'
import { daysInRange, inRange, type DateRange } from '../lib/dateRange'

export type MoneyPayment = Pick<Payment, 'amount' | 'paid_at' | 'method'>
export type MoneyPackage = Pick<CustomerPackage, 'price' | 'purchased_at' | 'method'>

/** Uang masuk of one calendar day. */
export interface MoneyInDay {
  /** 'YYYY-MM-DD' */
  date: string
  total: number
  byMethod: Record<PaymentMethod, number>
  /** the part of `total` that came from prepaid packages sold that day */
  packages: number
}

/** Uang masuk of a whole range. */
export interface MoneyInTotals {
  total: number
  /** payments on orders, by paid_at */
  fromPayments: number
  /** prepaid packages sold, by purchased_at */
  fromPackages: number
  byMethod: Record<PaymentMethod, number>
}

export function emptyByMethod(): Record<PaymentMethod, number> {
  const out = {} as Record<PaymentMethod, number>
  for (const m of PAYMENT_METHODS) out[m] = 0
  return out
}

/** Every row that counts as uang masuk, on its day: payments by paid_at, package sales by purchased_at. */
function eachMoneyIn(
  payments: readonly MoneyPayment[],
  packages: readonly MoneyPackage[],
  visit: (date: string, amount: number, method: PaymentMethod, isPackage: boolean) => void,
): void {
  for (const p of payments) visit(p.paid_at.slice(0, 10), p.amount, p.method, false)
  for (const k of packages) visit(k.purchased_at.slice(0, 10), k.price, k.method, true)
}

/** Uang masuk of the range (both ends included): total, per source and per method. */
export function moneyInTotals(payments: readonly MoneyPayment[], packages: readonly MoneyPackage[], range: DateRange): MoneyInTotals {
  const out: MoneyInTotals = { total: 0, fromPayments: 0, fromPackages: 0, byMethod: emptyByMethod() }
  eachMoneyIn(payments, packages, (date, amount, method, isPackage) => {
    if (!inRange(date, range)) return
    out.total += amount
    if (isPackage) out.fromPackages += amount
    else out.fromPayments += amount
    if (method in out.byMethod) out.byMethod[method] += amount
  })
  return out
}

/**
 * Uang masuk per day from `from` to `to` (both included, oldest first, one entry per calendar day even when nothing
 * came in), each split by method.
 */
export function moneyInByDay(from: string, to: string, payments: readonly MoneyPayment[], packages: readonly MoneyPackage[]): MoneyInDay[] {
  const days = daysInRange({ start: from, end: to }).map((date): MoneyInDay => ({ date, total: 0, byMethod: emptyByMethod(), packages: 0 }))
  const byDate = new Map(days.map((d) => [d.date, d]))
  eachMoneyIn(payments, packages, (date, amount, method, isPackage) => {
    const day = byDate.get(date)
    if (!day) return
    day.total += amount
    if (method in day.byMethod) day.byMethod[method] += amount
    if (isPackage) day.packages += amount
  })
  return days
}

/** The last `days` days ending on `today` (oldest first, today last). */
export function moneyInSeries(today: string, payments: readonly MoneyPayment[], packages: readonly MoneyPackage[], days: number): MoneyInDay[] {
  return moneyInByDay(addDaysISO(today, -(days - 1)), today, payments, packages)
}
