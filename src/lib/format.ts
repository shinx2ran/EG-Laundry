import { format as dfFormat, parseISO, isValid } from 'date-fns'
import { id as localeId } from 'date-fns/locale'

const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
})

const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 })

/** 1500000 -> "Rp 1.500.000" (negative values keep the sign). */
export function formatRupiah(amount: number | null | undefined): string {
  if (amount == null || Number.isNaN(amount)) return 'Rp 0'
  // Intl renders "Rp 1.500.000" with a non-breaking space; normalise to a plain space.
  return rupiah.format(Math.round(amount)).replace(/ /g, ' ')
}

/** 1500000 -> "1.500.000" */
export function formatNumber(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '0'
  return number.format(Math.round(n))
}

const COMPACT_UNITS: [number, string][] = [
  [1_000_000_000, 'M'],
  [1_000_000, 'jt'],
  [1_000, 'rb'],
]

/**
 * Short rupiah for chart axes (the chart's title says it is rupiah): 0 -> '0', 500 -> '500', 18.000 -> '18 rb',
 * 152.400 -> '152 rb', 999.999 -> '1 jt', 1.250.000 -> '1,3 jt', 1.500.000.000 -> '1,5 M'. One decimal only below 10.
 */
export function formatCompactRupiah(amount: number): string {
  if (!Number.isFinite(amount)) return '0'
  const n = Math.abs(Math.round(amount))
  if (n === 0) return '0'
  const sign = amount < 0 ? '−' : ''
  for (const [unit, suffix] of COMPACT_UNITS) {
    const v = n / unit
    const shown = v < 9.95 ? Math.round(v * 10) / 10 : Math.round(v)
    if (shown >= 1) return `${sign}${shown.toLocaleString('id-ID', { maximumFractionDigits: 1 })} ${suffix}`
  }
  return `${sign}${n}`
}

/** Parse a user-typed Rupiah string ("1.500.000", "Rp 1,5jt" is NOT supported) to integer. */
export function parseRupiah(input: string): number {
  const digits = input.replace(/[^0-9-]/g, '')
  if (!digits || digits === '-') return 0
  return Number.parseInt(digits, 10)
}

/** A typed count ("12", "12 kg"): digits only, at most four; null when none. */
export function parseCount(text: string): number | null {
  const digits = text.replace(/\D/g, '').slice(0, 4)
  return digits === '' ? null : Number.parseInt(digits, 10)
}

/** Today's date as 'YYYY-MM-DD' in the user's local timezone. */
export function todayISO(now: Date = new Date()): string {
  return toDateISO(now)
}

/** Date -> 'YYYY-MM-DD' (local timezone, no UTC shift). */
export function toDateISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 'YYYY-MM-DD' + n days -> 'YYYY-MM-DD' (calendar days, local time, no DST drift). */
export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return toDateISO(new Date(y, m - 1, d + days))
}

/** Calendar days from `fromISO` to `toISO` ('YYYY-MM-DD'); negative when `toISO` is earlier. */
export function daysBetween(fromISO: string, toISO: string): number {
  const at = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((at(toISO) - at(fromISO)) / 86_400_000)
}

const qtyNumber = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 })

/** 2.5 + 'kg' -> '2,5 kg'; 1 + 'pcs' -> '1 pcs' (Indonesian decimal comma, at most 2 decimals). */
export function formatQty(qty: number | null | undefined, unit: string): string {
  const n = qty == null || Number.isNaN(qty) ? 0 : qty
  return `${qtyNumber.format(n)} ${unit}`.replace(/ /g, ' ')
}

/** 'YYYY-MM-DD' or ISO timestamp -> Date (local). Returns null when invalid. */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = parseISO(value)
  return isValid(d) ? d : null
}

/** '2026-03-05' -> '5 Mar 2026' */
export function formatDate(value: string | Date | null | undefined, pattern = 'd MMM yyyy'): string {
  const d = typeof value === 'string' ? parseDate(value) : value
  if (!d || !isValid(d)) return '-'
  return dfFormat(d, pattern, { locale: localeId })
}


/** '2026-03-05T10:20:00Z' -> '5 Mar 2026, 17.20' */
export function formatDateTime(value: string | Date | null | undefined): string {
  return formatDate(value, 'd MMM yyyy, HH.mm')
}

/** Month label for charts: '2026-03' -> 'Mar 2026' */
export function formatMonth(yyyyMm: string): string {
  const d = parseDate(`${yyyyMm}-01`)
  return d ? dfFormat(d, 'MMM yyyy', { locale: localeId }) : yyyyMm
}

/**
 * Indonesian phone normaliser: '0812-3456-7890' -> '+6281234567890' (best effort). A 0 typed after the country
 * code ('+62 0812…', how Woombad can store a tenant's number) is the trunk prefix and goes, so the WhatsApp link
 * reaches the real number.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null
  let digits = input.replace(/[^0-9+]/g, '')
  if (!digits) return null
  if (/^\+?620/.test(digits)) digits = `+62${digits.replace(/^\+?620/, '')}`
  if (digits.startsWith('+')) return digits
  if (digits.startsWith('62')) return `+${digits}`
  if (digits.startsWith('0')) digits = digits.slice(1)
  return `+62${digits}`
}

/** WhatsApp deep link for a phone number; null when phone missing. */
export function whatsappLink(phone: string | null | undefined, text?: string): string | null {
  const normalized = normalizePhone(phone)
  if (!normalized) return null
  const digits = normalized.replace(/[^0-9]/g, '')
  const q = text ? `?text=${encodeURIComponent(text)}` : ''
  return `https://wa.me/${digits}${q}`
}
