import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { todayISO } from '../../lib/format'
import { CUSTOMER_FILTER_PARAM, parseCustomerFilter, type CustomerFilter } from '../pelanggan/customerUtils'
import { PRESET_PARAM, rangeLabel, resolveRange, type RangePreset } from './reportModel'
import type { DateRange } from '../../lib/dateRange'

export type LaporanTab = 'pelanggan' | 'lama'

/**
 * Period, the customer tab and its Semua / Anak kos / Umum filter live in the query string
 * (?periode=khusus&dari=2026-10-01&sampai=2026-10-15&tab=lama&jenis=kos), so back and reload keep them.
 */
export function useLaporanParams() {
  const [params, setParams] = useSearchParams()
  const today = todayISO()

  const { preset, range } = useMemo(
    () => resolveRange({ periode: params.get('periode'), from: params.get('dari'), to: params.get('sampai') }, today),
    [params, today],
  )
  const tab: LaporanTab = params.get('tab') === 'lama' ? 'lama' : 'pelanggan'
  const filter = parseCustomerFilter(params.get('jenis'))

  const patch = useCallback(
    (edit: (p: URLSearchParams) => void) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          edit(p)
          return p
        },
        { replace: true },
      )
    },
    [setParams],
  )

  const setPreset = useCallback(
    (next: RangePreset) =>
      patch((p) => {
        if (next === 'month') p.delete('periode')
        else p.set('periode', PRESET_PARAM[next])
        if (next === 'custom') {
          // Khusus starts from the range on screen
          p.set('dari', range.start)
          p.set('sampai', range.end)
        } else {
          p.delete('dari')
          p.delete('sampai')
        }
      }),
    [patch, range.start, range.end],
  )
  const setCustomRange = useCallback(
    (next: DateRange) =>
      patch((p) => {
        p.set('periode', PRESET_PARAM.custom)
        p.set('dari', next.start)
        p.set('sampai', next.end)
      }),
    [patch],
  )
  const setTab = useCallback((next: LaporanTab) => patch((p) => (next === 'lama' ? p.set('tab', 'lama') : p.delete('tab'))), [patch])
  const setFilter = useCallback(
    (next: CustomerFilter) =>
      patch((p) => {
        const value = CUSTOMER_FILTER_PARAM[next]
        if (value === null) p.delete('jenis')
        else p.set('jenis', value)
      }),
    [patch],
  )

  return { today, preset, range, label: rangeLabel(range), tab, filter, setPreset, setCustomRange, setTab, setFilter }
}

export type LaporanParams = ReturnType<typeof useLaporanParams>
