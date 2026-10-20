/** Rows grouped by a key, in their original order within each group; rows whose key is null/undefined are left out. */
export function groupBy<T>(rows: readonly T[], key: (row: T) => string | null | undefined): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    if (k == null) continue
    const list = map.get(k)
    if (list) list.push(row)
    else map.set(k, [row])
  }
  return map
}
