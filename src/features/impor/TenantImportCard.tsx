import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, Switch, useToast } from '../../components/ui'
import { useTable } from '../../hooks/useTable'
import { formatDateTime, todayISO } from '../../lib/format'
import { CountTile, JsonFileButton, PreviewGroup } from './components'
import { MATCH_REASON_LABEL, WoombadFileError, parseWoombadBackup, planTenantImport, tenantImportSummary, tenantPlanSize, type WoombadBackup } from './tenantImport'
import { useTenantImport } from './useTenantImport'

/** a weekly export of a big kos stays far below this; anything larger is not a Woombad backup */
const MAX_FILE_BYTES = 30 * 1024 * 1024

// ---------------------------------------------------------------- Impor penyewa dari Woombad (owner/admin, SPEC 3.8)

export function TenantImportCard() {
  const { importTenants } = useTenantImport()
  const customers = useTable('customers')
  const toast = useToast()
  const [file, setFile] = useState<{ name: string; backup: WoombadBackup } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createMissing, setCreateMissing] = useState(true)
  const [keepOld, setKeepOld] = useState(false)
  const [applying, setApplying] = useState(false)

  const today = todayISO()
  const plan = useMemo(
    () => (file && customers.data ? planTenantImport(file.backup, customers.data, { createMissing, deactivateEnded: !keepOld, today }) : null),
    [file, customers.data, createMissing, keepOld, today],
  )

  const onFile = async (picked: File) => {
    setError(null)
    setFile(null)
    try {
      if (picked.size > MAX_FILE_BYTES) throw new WoombadFileError('Berkas terlalu besar untuk cadangan Woombad.')
      setFile({ name: picked.name, backup: parseWoombadBackup(await picked.text()) })
    } catch (err) {
      setError(err instanceof WoombadFileError ? err.message : 'Berkas tidak bisa dibaca.')
    }
  }

  const apply = async () => {
    if (!file) return
    setApplying(true)
    try {
      const done = await importTenants(file.backup, { createMissing, deactivateEnded: !keepOld, today })
      toast.success(`Impor selesai: ${tenantImportSummary(done)}.`)
      setFile(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impor gagal.')
      toast.error('Impor penyewa berhenti. Lihat keterangan di kartu.')
    } finally {
      setApplying(false)
    }
  }

  const counts = plan?.counts
  return (
    <Card>
      <CardHeader title="Impor penyewa dari Woombad" subtitle="Tandai anak kos EG Kost dari cadangan aplikasi kos" action={<Users className="h-5 w-5 text-slate-400" />} />
      <CardBody className="space-y-3">
        <p className="text-sm text-slate-600">
          Unggah berkas cadangan Woombad (.json). Berkas hanya dibaca di HP ini; yang disimpan hanya nama, nomor HP, dan kamar penyewa yang
          sedang menyewa. Pelanggan dicocokkan lewat impor sebelumnya, lalu lewat nomor HP.
        </p>
        <JsonFileButton label={file ? 'Pilih berkas lain' : 'Pilih berkas cadangan Woombad'} inputLabel="Berkas cadangan Woombad" onFile={(f) => void onFile(f)} disabled={applying} />
        {error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        )}

        {file && (
          <div className="space-y-3 border-t border-slate-100 pt-3" data-testid="tenant-import-preview">
            <p className="break-words text-sm text-slate-700">
              <span className="font-medium">{file.name}</span>
              {file.backup.orgNames.length > 0 && <> · {file.backup.orgNames.join(', ')}</>}
              {file.backup.exportedAt && <> · dicadangkan {formatDateTime(file.backup.exportedAt)}</>}
            </p>
            <div className="space-y-2">
              <Switch
                label="Buat pelanggan baru"
                hint={createMissing ? 'Penyewa yang belum ada di daftar pelanggan ditambahkan.' : 'Hanya pelanggan yang sudah ada yang diperbarui.'}
                checked={createMissing}
                onChange={setCreateMissing}
                disabled={applying}
              />
              <Switch
                label="Jangan ubah yang lama"
                hint={keepOld ? 'Penyewa yang sewanya sudah berakhir tetap ditandai anak kos.' : 'Penyewa yang sewanya sudah berakhir dijadikan pelanggan umum.'}
                checked={keepOld}
                onChange={setKeepOld}
                disabled={applying}
              />
            </div>

            {!plan || !counts ? (
              <p className="text-sm text-slate-500">Memuat daftar pelanggan…</p>
            ) : (
              <>
                <p className="text-sm text-slate-700">
                  {counts.current} penyewa sedang menyewa, {counts.former} sudah berakhir.
                </p>
                <dl className="grid grid-cols-2 gap-2">
                  <CountTile label="Cocok (diperbarui)" value={counts.update} tone="positive" testId="import-count-update" />
                  <CountTile label="Baru" value={counts.create} tone="positive" testId="import-count-create" />
                  <CountTile label="Dinonaktifkan" value={counts.deactivate} tone="warning" testId="import-count-deactivate" />
                  <CountTile label="Tanpa HP" value={counts.noPhone} tone="muted" testId="import-count-nophone" />
                </dl>
                <p className="text-xs text-slate-500">
                  Tanpa HP: hanya bisa dicocokkan lewat impor sebelumnya.
                  {counts.unchanged > 0 && <> {counts.unchanged} pelanggan sudah sesuai.</>}
                  {counts.keptEnded > 0 && <> {counts.keptEnded} anak kos lama tidak diubah.</>}
                </p>
                <PreviewGroup
                  title="Diperbarui"
                  testId="import-group-update"
                  rows={plan.toUpdate}
                  render={(u) => (
                    <>
                      <span className="font-medium text-slate-900">{u.customerName}</span>
                      {u.room_name && <> · kamar {u.room_name}</>}
                      <span className="block text-xs text-slate-500">
                        {u.tenantName !== u.customerName ? `${u.tenantName} di Woombad, ` : ''}
                        {MATCH_REASON_LABEL[u.reason]}
                      </span>
                    </>
                  )}
                />
                <PreviewGroup
                  title="Pelanggan baru"
                  testId="import-group-create"
                  rows={plan.toCreate}
                  render={(c) => (
                    <>
                      <span className="font-medium text-slate-900">{c.name}</span>
                      {c.room_name && <> · kamar {c.room_name}</>}
                      <span className="block text-xs text-slate-500">{c.phone ?? 'Tanpa nomor HP'}</span>
                    </>
                  )}
                />
                <PreviewGroup
                  title="Dinonaktifkan (sewa berakhir)"
                  testId="import-group-deactivate"
                  rows={plan.toDeactivate}
                  render={(d) => (
                    <>
                      <span className="font-medium text-slate-900">{d.customerName}</span>
                      {d.room_name && <> · dulu kamar {d.room_name}</>}
                    </>
                  )}
                />
                <PreviewGroup
                  title="Dilewati"
                  testId="import-group-skipped"
                  rows={plan.skipped}
                  render={(s) => (
                    <>
                      <span className="font-medium text-slate-900">{s.name}</span>
                      <span className="block text-xs text-slate-500">{s.reason}</span>
                    </>
                  )}
                />
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void apply()} loading={applying} disabled={tenantPlanSize(plan) === 0} className="min-h-11">
                    Terapkan
                  </Button>
                  <Button variant="ghost" onClick={() => setFile(null)} disabled={applying} className="min-h-11">
                    Batal
                  </Button>
                </div>
                {tenantPlanSize(plan) === 0 && <p className="text-sm text-slate-500">Tidak ada yang perlu diubah.</p>}
              </>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
