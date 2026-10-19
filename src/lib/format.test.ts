import { describe, expect, it } from 'vitest'
import {
  addDaysISO,
  daysBetween,
  formatDate,
  formatDateTime,
  formatMonth,
  formatNumber,
  formatQty,
  formatRupiah,
  normalizePhone,
  parseCount,
  parseRupiah,
  todayISO,
  toDateISO,
  whatsappLink,
} from './format'

describe('quantities', () => {
  it('writes kg with an Indonesian decimal comma and pcs whole', () => {
    expect(formatQty(2.5, 'kg')).toBe('2,5 kg')
    expect(formatQty(3, 'kg')).toBe('3 kg')
    expect(formatQty(1.25, 'kg')).toBe('1,25 kg')
    expect(formatQty(1, 'pcs')).toBe('1 pcs')
    expect(formatQty(null, 'kg')).toBe('0 kg')
  })
})

describe('calendar arithmetic', () => {
  it('adds calendar days across month, year and DST boundaries', () => {
    expect(addDaysISO('2026-10-19', 3)).toBe('2026-10-22')
    expect(addDaysISO('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDaysISO('2026-10-19T10:00:00Z', 0)).toBe('2026-10-19')
  })

  it('counts days between dates, negative backwards', () => {
    expect(daysBetween('2026-10-19', '2026-10-22')).toBe(3)
    expect(daysBetween('2026-10-22', '2026-10-19')).toBe(-3)
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364)
    expect(daysBetween('2026-10-19', '2026-10-19')).toBe(0)
  })
})

describe('money', () => {
  it('formats Rupiah without decimals and with a plain space', () => {
    expect(formatRupiah(1_500_000)).toBe('Rp 1.500.000')
    expect(formatRupiah(-7_500)).toBe('-Rp 7.500')
    expect(formatRupiah(null)).toBe('Rp 0')
    expect(formatRupiah(Number.NaN)).toBe('Rp 0')
    expect(formatNumber(12_345.6)).toBe('12.346')
  })

  it('parses what people type', () => {
    expect(parseRupiah('Rp 1.500.000')).toBe(1_500_000)
    expect(parseRupiah('')).toBe(0)
    expect(parseCount('12 kg')).toBe(12)
    expect(parseCount('')).toBeNull()
    expect(parseCount('123456')).toBe(1234)
  })
})

describe('dates', () => {
  it('uses the local calendar day, Indonesian month names', () => {
    expect(todayISO(new Date(2026, 9, 19, 23, 30))).toBe('2026-10-19')
    expect(toDateISO(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(formatDate('2026-03-05')).toBe('5 Mar 2026')
    expect(formatDate('bukan tanggal')).toBe('-')
    expect(formatDate(null)).toBe('-')
    expect(formatDateTime('2026-03-05T10:20:00')).toBe('5 Mar 2026, 10.20')
    expect(formatMonth('2026-03')).toBe('Mar 2026')
    expect(formatMonth('x')).toBe('x')
  })
})

describe('phones and WhatsApp', () => {
  it('normalises Indonesian numbers to +62', () => {
    expect(normalizePhone('0812-3456-7890')).toBe('+6281234567890')
    expect(normalizePhone('62812 3456 7890')).toBe('+6281234567890')
    expect(normalizePhone('+6281234567890')).toBe('+6281234567890')
    expect(normalizePhone('-')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })

  it('builds wa.me links with the message encoded', () => {
    expect(whatsappLink('081234567890')).toBe('https://wa.me/6281234567890')
    expect(whatsappLink('081234567890', 'Cucian Anda siap diambil & terima kasih')).toBe(
      'https://wa.me/6281234567890?text=Cucian%20Anda%20siap%20diambil%20%26%20terima%20kasih',
    )
    expect(whatsappLink('')).toBeNull()
  })
})
