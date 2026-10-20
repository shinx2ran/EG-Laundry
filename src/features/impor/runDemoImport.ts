/**
 * Executes a DemoImportPlan with an injected bulk insert (OrgRepo.insertMany in the app, a fake or LocalRepo in
 * tests), table by table in DEMO_IMPORT_ORDER, in chunks. Stops at the first refused insert: rows already
 * written stay (each insert is one statement, so a refused chunk writes nothing) and the message says exactly
 * what is online now, so the owner can check it before trying again.
 */
import { DEMO_IMPORT_ORDER, DEMO_TABLE_NOUN, countsText, emptyCounts, totalCount, type DemoImportPlan, type DemoImportTable, type DemoTableCounts } from './demoImport'

export type InsertRows = (table: DemoImportTable, rows: Record<string, unknown>[]) => Promise<unknown>

export interface DemoImportProgress {
  table: DemoImportTable
  done: number
  total: number
}

export interface DemoImportResult {
  written: DemoTableCounts
  /** the table being written when the import stopped, null when it finished */
  failedTable: DemoImportTable | null
  error: string | null
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
        return { written, failedTable: table, error: err instanceof Error ? err.message : String(err) }
      }
      written[table] += chunk.length
      done += chunk.length
    }
  }
  onProgress?.({ table: DEMO_IMPORT_ORDER[DEMO_IMPORT_ORDER.length - 1], done, total })
  return { written, failedTable: null, error: null }
}

/** The Indonesian result for the screen: what was moved, or where it stopped and what is online already. */
export function demoImportMessage(result: DemoImportResult): string {
  const saved = countsText(result.written)
  if (result.error === null) return saved ? `Data Mode Demo dipindahkan: ${saved}.` : 'Tidak ada data yang dipindahkan.'
  const where = result.failedTable ? ` saat menyimpan ${DEMO_TABLE_NOUN[result.failedTable]}` : ''
  const after =
    totalCount(result.written) > 0
      ? `Sudah tersimpan online: ${saved}. Data itu tidak dihapus otomatis; periksa daftar harga dan pelanggan sebelum mencoba lagi agar tidak dobel.`
      : 'Belum ada data yang tersimpan online.'
  return `Pemindahan berhenti${where}: ${result.error.replace(/\.$/, '')}. ${after}`
}
