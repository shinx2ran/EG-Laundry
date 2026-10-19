import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button, useToast } from '../../../components/ui'
import { useOrg } from '../../../hooks/useOrg'
import { translateDbError } from '../../../lib/repo/supabaseRepo'
import { BackupStatus } from './BackupStatus'
import { downloadBackup } from './backupFile'
import { fetchOrgBackup } from './orgData'

/** Online mode, owner/admin: full JSON backup. */
export function OnlineBackupSection() {
  const { repo } = useOrg()
  const toast = useToast()
  const [downloading, setDownloading] = useState(false)

  const download = async () => {
    setDownloading(true)
    try {
      downloadBackup(await fetchOrgBackup(repo), 'cadangan-online')
      toast.success('Cadangan diunduh.')
    } catch (err) {
      toast.error(err instanceof Error ? translateDbError(err.message) : 'Gagal membuat cadangan.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <>
      <div className="space-y-2 border-t border-slate-100 pt-3">
        <p className="text-sm font-medium text-slate-900">Cadangan</p>
        <p className="text-sm text-slate-600">
          Salinan terenkripsi dibuat otomatis setiap Minggu malam dan disimpan 90 hari. Unduh juga cadangan sebulan sekali dan
          simpan sendiri di tempat aman (mis. Google Drive). File ini berisi data pelanggan, jangan dibagikan.
        </p>
        <BackupStatus />
        <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={download} loading={downloading}>
          Unduh cadangan lengkap (JSON)
        </Button>
      </div>

    </>
  )
}
