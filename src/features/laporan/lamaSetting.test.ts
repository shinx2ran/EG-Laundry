import { describe, expect, it } from 'vitest'
import { LAMA_STORAGE_KEY, readLamaDays, writeLamaDays } from './lamaSetting'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

const blocked = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('Lama tidak datang threshold in browser storage', () => {
  it('uses the key eglaundry.lamaTidakDatang', () => {
    expect(LAMA_STORAGE_KEY).toBe('eglaundry.lamaTidakDatang')
  })

  it('reads the stored days, 21 when nothing or junk is stored', () => {
    expect(readLamaDays(memoryStorage())).toBe(21)
    expect(readLamaDays(memoryStorage({ [LAMA_STORAGE_KEY]: '7' }))).toBe(7)
    expect(readLamaDays(memoryStorage({ [LAMA_STORAGE_KEY]: 'abc' }))).toBe(21)
    expect(readLamaDays(memoryStorage({ [LAMA_STORAGE_KEY]: '9999' }))).toBe(365)
  })

  it('writes clamped whole days', () => {
    const s = memoryStorage()
    writeLamaDays(14, s)
    expect(s.data.get(LAMA_STORAGE_KEY)).toBe('14')
    writeLamaDays(0, s)
    expect(s.data.get(LAMA_STORAGE_KEY)).toBe('1')
    expect(readLamaDays(s)).toBe(1)
  })

  it('a blocked or full storage never throws', () => {
    expect(readLamaDays(blocked)).toBe(21)
    expect(() => writeLamaDays(10, blocked)).not.toThrow()
  })
})
