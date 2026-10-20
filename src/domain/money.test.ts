import { describe, expect, it } from 'vitest'
import type { CustomerPackage, Payment, PaymentMethod } from '../types/db'
import { moneyInByDay, moneyInSeries, moneyInTotals } from './money'

const TODAY = '2026-10-19' // a Monday

function payment(amount: number, paid_at: string, method: PaymentMethod = 'cash'): Pick<Payment, 'amount' | 'paid_at' | 'method'> {
  return { amount, paid_at, method }
}

function pkg(price: number, purchased_at: string, method: PaymentMethod): Pick<CustomerPackage, 'price' | 'purchased_at' | 'method'> {
  return { price, purchased_at, method }
}

describe('uang masuk (SPEC 3.5: payments by paid_at + packages by purchased_at)', () => {
  const payments = [
    payment(20_000, '2026-10-19', 'cash'),
    payment(15_000, '2026-10-19', 'qris'),
    payment(7_000, '2026-10-18', 'transfer'),
    payment(99_000, '2026-10-12', 'cash'), // a day before the 7-day window
    payment(5_000, '2026-10-20', 'cash'), // tomorrow: never counted today
  ]
  const packages = [pkg(140_000, '2026-10-19', 'transfer'), pkg(140_000, '2026-10-13', 'cash')]

  it('sums each day by method, with the packages sold that day', () => {
    const days = moneyInByDay('2026-10-18', '2026-10-19', payments, packages)
    expect(days.map((d) => d.date)).toEqual(['2026-10-18', '2026-10-19'])
    expect(days[1]).toEqual({ date: '2026-10-19', total: 175_000, byMethod: { cash: 20_000, transfer: 140_000, qris: 15_000 }, packages: 140_000 })
    expect(days[0]).toEqual({ date: '2026-10-18', total: 7_000, byMethod: { cash: 0, transfer: 7_000, qris: 0 }, packages: 0 })
  })

  it('a series ends today, oldest first, with empty days kept', () => {
    const series = moneyInSeries(TODAY, payments, packages, 7)
    expect(series).toHaveLength(7)
    expect(series.map((d) => d.date)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'])
    expect(series.map((d) => d.total)).toEqual([140_000, 0, 0, 0, 0, 7_000, 175_000])
    expect(series[0].byMethod).toEqual({ cash: 140_000, transfer: 0, qris: 0 })
  })

  it('crosses a month end', () => {
    const series = moneyInSeries('2026-03-02', [payment(1_000, '2026-02-27')], [], 4)
    expect(series.map((d) => d.date)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
    expect(series[0].total).toBe(1_000)
  })

  it('totals of a range per source and per method, timestamps counted on their date part', () => {
    const t = moneyInTotals([...payments, payment(1_000, '2026-10-19T23:30:00Z', 'qris')], packages, { start: '2026-10-13', end: '2026-10-19' })
    expect(t).toEqual({ total: 323_000, fromPayments: 43_000, fromPackages: 280_000, byMethod: { cash: 160_000, transfer: 147_000, qris: 16_000 } })
    // the totals and the per-day split agree
    const days = moneyInByDay('2026-10-13', '2026-10-19', payments, packages)
    expect(days.reduce((s, d) => s + d.total, 0)).toBe(t.total - 1_000)
    expect(moneyInTotals(payments, packages, { start: '2026-11-01', end: '2026-11-30' }).total).toBe(0)
  })
})
