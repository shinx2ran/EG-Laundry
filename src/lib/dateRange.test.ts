import { describe, expect, it } from 'vitest'
import { MAX_LISTED_DAYS, daysInRange, inRange, isValidDateISO, minISO, rangeLength } from './dateRange'

const OCT = { start: '2026-10-01', end: '2026-10-31' }

describe('date ranges', () => {
  it('isValidDateISO accepts only real calendar dates in YYYY-MM-DD', () => {
    expect(isValidDateISO('2026-02-28')).toBe(true)
    expect(isValidDateISO('2024-02-29')).toBe(true)
    expect(isValidDateISO('2026-02-29')).toBe(false)
    expect(isValidDateISO('2026-13-01')).toBe(false)
    expect(isValidDateISO('2026-2-1')).toBe(false)
    expect(isValidDateISO('19-10-2026')).toBe(false)
    expect(isValidDateISO(null)).toBe(false)
    expect(isValidDateISO(undefined)).toBe(false)
    expect(isValidDateISO('')).toBe(false)
  })

  it('length, days, membership and the earlier date', () => {
    expect(rangeLength(OCT)).toBe(31)
    expect(rangeLength({ start: '2026-10-02', end: '2026-10-01' })).toBe(0)
    expect(daysInRange({ start: '2026-10-30', end: '2026-11-02' })).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
    expect(daysInRange({ start: '2026-01-01', end: '20266-01-01' })).toHaveLength(MAX_LISTED_DAYS)
    expect(inRange('2026-10-31T23:00:00Z', OCT)).toBe(true)
    expect(inRange('2026-10-01', OCT)).toBe(true)
    expect(inRange('2026-11-01', OCT)).toBe(false)
    expect(minISO('2026-10-20', '2026-10-31')).toBe('2026-10-20')
    expect(minISO('2026-11-01', '2026-10-31')).toBe('2026-10-31')
  })
})
