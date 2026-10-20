/**
 * Executes a DemoImportPlan with an injected bulk insert (OrgRepo.insertMany in the app, a fake or LocalRepo in
 * tests), table by table in DEMO_IMPORT_ORDER, in chunks. Stops at the first refused insert (each insert is one
 * statement, so a refused chunk writes nothing, unless only its answer was lost). undoDemoImport then removes what
 * this run wrote, so a stopped import leaves nothing behind and can simply be tried again; only when that also
 * fails (the network is still down) does the message say exactly what is online now.
 */
import { DELETE_DENIED_MESSAGE } from '../../lib/repo/types'
import { DEMO_IMPORT_ORDER, DEMO_TABLE_NOUN, countsText, emptyCounts, totalCount, type DemoImportPlan, type DemoImportTable, type DemoTableCounts } from './demoImport'

export type InsertRows = (table: DemoImportTable, rows: Record<string, unknown>[]) => Promise<unknown>

/** What undoDemoImport needs from the repo (OrgRepo.remove / OrgRepo.get in the app). */
export interface UndoOps {
  remove: (table: DemoImportTable, id: string) => Promise<unknown>
  exists: (table: DemoImportTable, id: string) => Promise<boolean>
}

export interface DemoImportProgress {
  table: DemoImportTable
  done: number
  total: number
}

export interface DemoImportResult {
  /** rows of this run that are online (after undoDemoImport: what is still online) */
  written: DemoTableCounts
  /** the table being written when the import stopped, null when it finished */
  failedTable: DemoImportTable | null
  error: string | null
  /** rows in the chunk that failed: refused, or written with the answer lost (undoDemoImport checks which) */
  failedChunk: number
  /** after a stop: true = what this run wrote was removed again, false = that removal failed too, null = nothing to remove / not tried */
  undone: boolean | null
}

export interface RunDemoImportOptions {
  chunkSize?: number
  onProgress?: (progress: DemoImportProgress) => void
}

export async function runDemoImport(plan: DemoImportPlan, insert: InsertRows, options: RunDemoImportOptions = {}): Promise<DemoImportResult> {
  const { chunkSize = 200, onProgress } = options
  const written = emptyCounts()
  const total = DEMO_IMPORT_ORDER.reduce((sum, t) => sum + plan.tables[t].length, 0)
  let done = 0
  for (const table of DEMO_IMPORT_ORDER) {
    const rows = plan.tables[table]
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize)
      onProgress?.({ table, done, total })
      try {
        await insert(table, chunk)
      } catch (err) {
        return { written, failedTable: table, error: errorText(err), failedChunk: chunk.length, undone: null }
      }
      written[table] += chunk.length
      done += chunk.length
    }
  }
  onProgress?.({ table: DEMO_IMPORT_ORDER[DEMO_IMPORT_ORDER.length - 1], done, total })
  return { written, failedTable: null, error: null, failedChunk: 0, undone: null }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Undo order: orders first (their items and payments go with them, ON DELETE CASCADE), then their parents. */
const UNDO_ORDER = ['orders', 'customer_packages', 'customers', 'package_catalog', 'services'] as const

/**
 * After a stopped import: remove every row this run wrote (plan.tables only holds new rows, never reused ones),
 * children before parents. The failed chunk is removed too when it was written after all (one statement: its
 * first row tells). A row that is already gone is fine; any other refusal stops the undo and `written` then says
 * what is still online.
 */
export async function undoDemoImport(plan: DemoImportPlan, result: DemoImportResult, ops: UndoOps): Promise<DemoImportResult> {
  if (result.error === null || result.failedTable === null) return result
  const failedAt = DEMO_IMPORT_ORDER.indexOf(result.failedTable)
  const left = { ...result.written }
  const removedOrders = new Set<string>()
  const stop = (undone: boolean): DemoImportResult => {
    // items and payments of removed orders went with them
    for (const child of ['order_items', 'payments'] as const) {
      left[child] = plan.tables[child].slice(0, left[child]).filter((r) => !removedOrders.has(r.order_id as string)).length
    }
    return { ...result, written: left, undone }
  }
  try {
    if (result.failedChunk > 0) {
      const first = plan.tables[result.failedTable][result.written[result.failedTable]]
      if (first && (await ops.exists(result.failedTable, first.id as string))) left[result.failedTable] += result.failedChunk
    }
  } catch {
    return stop(false)
  }
  // nothing was written: nothing to undo
  if (totalCount(left) === 0) return result
  for (const table of UNDO_ORDER) {
    if (DEMO_IMPORT_ORDER.indexOf(table) > failedAt) continue
    const rows = plan.tables[table].slice(0, left[table])
    for (const row of rows) {
      try {
        await ops.remove(table, row.id as string)
      } catch (err) {
        if (errorText(err) !== DELETE_DENIED_MESSAGE) return stop(false)
      }
      left[table]--
      if (table === 'orders') removedOrders.add(row.id as string)
    }
  }
  return stop(true)
}

/** The Indonesian result for the screen: what was moved, or where it stopped and what is online now. */
export function demoImportMessage(result: DemoImportResult): string {
  const saved = countsText(result.written)
  if (result.error === null) return saved ? `Data Mode Demo dipindahkan: ${saved}.` : 'Tidak ada data yang dipindahkan.'
  const where = result.failedTable ? ` saat menyimpan ${DEMO_TABLE_NOUN[result.failedTable]}` : ''
  let after: string
  if (totalCount(result.written) > 0) {
    after =
      result.undone === false
        ? `Sudah tersimpan online: ${saved}. Data itu gagal dihapus otomatis; periksa daftar harga, pelanggan dan pesanan sebelum mencoba lagi agar tidak dobel.`
        : `Sudah tersimpan online: ${saved}. Data itu tidak dihapus otomatis; periksa daftar harga dan pelanggan sebelum mencoba lagi agar tidak dobel.`
  } else {
    after = result.undone === true ? 'Yang sempat tersimpan sudah dihapus lagi, jadi belum ada data yang tersimpan online. Silakan coba lagi.' : 'Belum ada data yang tersimpan online.'
  }
  return `Pemindahan berhenti${where}: ${result.error.replace(/\.$/, '')}. ${after}`
}
