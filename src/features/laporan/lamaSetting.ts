/**
 * The "Lama tidak datang" threshold (N days) is a per-phone convenience kept in browser storage. Storage can be
 * blocked (private window, previews) or hold junk, so every access is guarded and falls back to the default 21.
 */
import { LAMA_DEFAULT_DAYS, parseLamaDays } from './reportModel'

export const LAMA_STORAGE_KEY = 'eglaundry.lamaTidakDatang'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

/** The stored N, or 21 when nothing (valid) is stored or storage is unavailable. */
export function readLamaDays(storage: StorageLike | undefined = defaultStorage()): number {
  try {
    const raw = storage?.getItem(LAMA_STORAGE_KEY)
    return raw == null ? LAMA_DEFAULT_DAYS : parseLamaDays(raw)
  } catch {
    return LAMA_DEFAULT_DAYS
  }
}

/** Stores N (clamped to 1..365); a blocked or full storage is ignored. */
export function writeLamaDays(days: number, storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.setItem(LAMA_STORAGE_KEY, String(parseLamaDays(days)))
  } catch {
    // not remembered on this phone; the page still works with the typed value
  }
}
