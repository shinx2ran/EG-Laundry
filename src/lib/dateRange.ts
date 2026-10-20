/**
 * Calendar ranges of 'YYYY-MM-DD' dates (both ends included), shared by the Dashboard, Laporan and the uang masuk
 * definition in src/domain/money. Pure string arithmetic: no clock and no timezone shift.
 */
import { addDaysISO, daysBetween } from './format'

/** Both ends included, 'YYYY-MM-DD'. */
export interface DateRange {
  start: string
  end: string
}

/** Strict, calendar-valid 'YYYY-MM-DD' (no 2026-02-30, no 2026-2-1). */
export function isValidDateISO(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** The date part of a date or timestamp falls inside the range. */
export function inRange(iso: string, range: DateRange): boolean {
  const d = iso.slice(0, 10)
  return d >= range.start && d <= range.end
}

/** Number of days in the range, both ends included (0 when reversed). */
export function rangeLength(range: DateRange): number {
  return Math.max(0, daysBetween(range.start, range.end) + 1)
}

/** At most this many days are listed one by one (~11 years): a guard against a typo like year 20266. */
export const MAX_LISTED_DAYS = 4_000

/** Every day of the range, oldest first (at most MAX_LISTED_DAYS). */
export function daysInRange(range: DateRange): string[] {
  const n = Math.min(rangeLength(range), MAX_LISTED_DAYS)
  const days: string[] = []
  for (let i = 0; i < n; i++) days.push(addDaysISO(range.start, i))
  return days
}

/** The earlier of two dates. */
export function minISO(a: string, b: string): string {
  return a <= b ? a : b
}
