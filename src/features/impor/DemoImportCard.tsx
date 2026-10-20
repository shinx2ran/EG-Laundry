import { useState } from 'react'
import { CloudUpload } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, Switch, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { useTable } from '../../hooks/useTable'
import { formatDateTime } from '../../lib/format'
import { LAUNDRY_TABLES } from '../../types/db'
import { BackupFileError, parseBackupText, type ParsedBackup } from '../settings/data/backupFormat'
import { CountTile, JsonFileButton } from './components'
import { DEMO_IMPORT_ORDER, DEMO_TABLE_NOUN, countsText, plannedCounts, totalCount, type DemoImportPlan } from './demoImport'
import { demoImportMessage, type DemoImportProgress } from './runDemoImport'
import { LOCAL_DEMO_IMPORT_MESSAGE, useDemoImport } from './useDemoImport'

const TITLE = 'Pindahkan data Mode Demo ke online'
const NO_LAUNDRY_DATA = 'Berkas ini tidak berisi data laundry. Pilih berkas cadangan dari Mode Demo EG Laundry.'

// ---------------------------------------------------------------- Mode Demo -> online (owner/admin)

/**
 * Online: shown while the laundry has no orders yet (and while a result is on screen). Mode Demo: the same card,
 * disabled, so the owner knows the way exists before going live.
 */
export function DemoImportCard() {
  const { isLocalMode } = useOrg()
  return isLocalMode ? <DemoImportUnavailable /> : <DemoImportOnline />
}

function Header() {
  return <CardHeader title={TITLE} subtitle="Daftar harga, pelanggan, paket, pesanan, pembayaran" action={<CloudUpload className="h-5 w-5 text-slate-400" />} />
}

function DemoImportUnavailable() {
  return (
    <Card data-testid="demo-import-card">
      <Header />
      <CardBody className="space-y-3">
        <p className="text-sm text-slate-600">
          Data yang dicatat di Mode Demo bisa dipindahkan ke laundry online dari berkas cadangan JSON (Data → Unduh cadangan JSON).
        </p>
        <p className="text-sm font-medium text-slate-500">{LOCAL_DEMO_IMPORT_MESSAGE}</p>
      </CardBody>
    </Card>
  )
}

function hasLaundryRows(backup: ParsedBackup): boolean {
  return LAUNDRY_TABLES.some((t) => backup.tables[t].length > 0)
}

function DemoImportOnline() {
  const { preview, moveToOnline } = useDemoImport()
  const orders = useTable('orders')
  const toast = useToast()
  const [file, setFile] = useState<{ name: string; backup: ParsedBackup } | null>(null)
  const [includeSample, setIncludeSample] = useState(false)
  const [plan, setPlan] = useState<DemoImportPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [progress, setProgress] = useState<DemoImportProgress | null>(null)
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null)

  if (orders.isPending || orders.isError) return null
  if ((orders.data?.length ?? 0) > 0 && !outcome) return null

  const loadPlan = async (backup: ParsedBackup, sample: boolean) => {
    setPlanning(true)
    try {
      setPlan(await preview(backup, sample))
    } catch (err) {
      setPlan(null)
      toast.error(err instanceof Error ? err.message : 'Gagal membaca data online.')
    } finally {
      setPlanning(false)
    }
  }

  const onFile = async (picked: File) => {
    setOutcome(null)
    setPlan(null)
    setFile(null)
    try {
      const backup = parseBackupText(await picked.text())
      if (!hasLaundryRows(backup)) throw new BackupFileError(NO_LAUNDRY_DATA)
      setFile({ name: picked.name, backup })
      setIncludeSample(false)
      await loadPlan(backup, false)
    } catch (err) {
      toast.error(err instanceof BackupFileError ? err.message : 'Berkas tidak bisa dibaca.')
    }
  }

  const toggleSample = (value: boolean) => {
    setIncludeSample(value)
    if (file) void loadPlan(file.backup, value)
  }

  const run = async () => {
    if (!file) return
    setProgress({ table: DEMO_IMPORT_ORDER[0], done: 0, total: plan ? totalCount(plannedCounts(plan)) : 0 })
    try {
      const result = await moveToOnline(file.backup, includeSample, setProgress)
      const message = demoImportMessage(result)
      setOutcome({ ok: result.error === null, message })
      if (result.error === null) toast.success(message)
      else toast.error('Pemindahan berhenti. Lihat keterangan di kartu.')
      setFile(null)
      setPlan(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Pemindahan gagal.'
      setOutcome({ ok: false, message })
      toast.error(message)
    } finally {
      setProgress(null)
    }
  }

  const counts = plan ? plannedCounts(plan) : null
  const busy = progress !== null
  return (
    <Card data-testid="demo-import-card">
      <Header />
      <CardBody className="space-y-3">
        <p className="text-sm text-slate-600">
          Sudah mencatat data sungguhan di Mode Demo? Unduh cadangan JSON di Mode Demo (Data → Unduh cadangan JSON), lalu pilih berkas itu di
          sini. Data contoh Mode Demo tidak ikut kecuali dipilih. Hanya bisa selama laundry online belum punya pesanan.
        </p>
        <JsonFileButton label={file ? 'Pilih berkas lain' : 'Pilih berkas cadangan Mode Demo'} inputLabel="Berkas cadangan Mode Demo" onFile={(f) => void onFile(f)} disabled={busy} loading={planning && !plan} />
        {outcome && (
          <p role={outcome.ok ? 'status' : 'alert'} className={outcome.ok ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900' : 'rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800'}>
            {outcome.message}
          </p>
        )}
        {file && plan && counts && (
          <div className="space-y-3 border-t border-slate-100 pt-3">
            <p className="break-words text-sm text-slate-700">
              <span className="font-medium">{file.name}</span>
              {file.backup.orgName && <> · {file.backup.orgName}</>}
              {file.backup.exportedAt && <> · dicadangkan {formatDateTime(file.backup.exportedAt)}</>}
            </p>
            {plan.hasSample && (
              <Switch
                label="Sertakan data contoh Mode Demo"
                hint={
                  includeSample
                    ? 'Pelanggan dan pesanan contoh ikut dipindahkan.'
                    : `${plan.sampleLeftOut.customers} pelanggan dan ${plan.sampleLeftOut.orders} pesanan contoh tidak dipindahkan.`
                }
                checked={includeSample}
                onChange={toggleSample}
                disabled={busy || planning}
              />
            )}
            <dl className="grid grid-cols-2 gap-2">
              {DEMO_IMPORT_ORDER.map((t) => (
                <CountTile key={t} label={DEMO_TABLE_NOUN[t]} value={counts[t]} testId={`demo-count-${t}`} />
              ))}
            </dl>
            {totalCount(plan.reused) > 0 && <p className="text-xs text-slate-500">Sudah ada online, dipakai yang lama: {countsText(plan.reused)}.</p>}
            {totalCount(plan.skipped) > 0 && <p className="text-xs text-amber-700">Dilewati karena datanya tidak lengkap atau tidak cocok: {countsText(plan.skipped)}.</p>}
            {progress && (
              <p className="text-sm text-slate-700" role="status">
                Menyimpan {DEMO_TABLE_NOUN[progress.table]}… {progress.done} dari {progress.total}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void run()} loading={busy} disabled={planning || totalCount(counts) === 0} className="min-h-11">
                Pindahkan ke online
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setFile(null)
                  setPlan(null)
                }}
                disabled={busy}
                className="min-h-11"
              >
                Batal
              </Button>
            </div>
            {totalCount(counts) === 0 && <p className="text-sm text-slate-500">Tidak ada data untuk dipindahkan.</p>}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
