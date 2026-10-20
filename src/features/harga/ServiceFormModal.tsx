import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Input, Modal, MoneyInput, Switch, useToast } from '../../components/ui'
import type { Service } from '../../types/db'
import { UNIT_LABEL } from '../../types/db'
import { UnitPicker } from './components'
import {
  NO_USAGE,
  initialServiceForm,
  isServiceUsed,
  serviceToForm,
  serviceUsageText,
  validateServiceForm,
  type ServiceFormErrors,
  type ServiceFormValues,
  type ServiceUsage,
} from './hargaUtils'
import type { HargaActions } from './useHargaActions'

/**
 * Add / edit a service (SPEC 3.1) in a bottom sheet. Mounted only while open, so the state starts from the
 * row. A used service (orders, catalog, sold packages) offers no delete: it is deactivated instead.
 */
export function ServiceFormModal({ service, usage = NO_USAGE, actions, onClose }: { service: Service | null; usage?: ServiceUsage; actions: HargaActions; onClose: () => void }) {
  const toast = useToast()
  const [values, setValues] = useState<ServiceFormValues>(() => (service ? serviceToForm(service) : initialServiceForm()))
  const [errors, setErrors] = useState<ServiceFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isEdit = service !== null
  const used = isServiceUsed(usage)
  const usageText = serviceUsageText(usage)
  const unit = UNIT_LABEL[values.unit]

  const set = <K extends keyof ServiceFormValues>(key: K, value: ServiceFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validateServiceForm(values)
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    setSaving(true)
    try {
      const saved = service ? await actions.updateService(service, values) : await actions.createService(values)
      toast.success(isEdit ? `Layanan ${saved.name} diperbarui.` : `Layanan ${saved.name} ditambahkan.`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan layanan.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!service) return
    setSaving(true)
    try {
      await actions.deleteService(service)
      toast.success(`Layanan ${service.name} dihapus.`)
      onClose()
    } catch (err) {
      setConfirmDelete(false)
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus layanan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Ubah layanan' : 'Tambah layanan'}
      footer={
        <>
          {isEdit && !used && (
            <Button type="button" variant="ghost" className="mr-auto text-red-700 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)} disabled={saving}>
              Hapus
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="service-form" loading={saving}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="service-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Nama layanan" required value={values.name} onChange={(e) => set('name', e.target.value)} error={errors.name} placeholder="Mis. Cuci setrika" maxLength={60} autoFocus={!isEdit} />
        <UnitPicker value={values.unit} onChange={(u) => set('unit', u)} />
        <MoneyInput label="Harga reguler" required value={values.price} onChange={(v) => set('price', v)} error={errors.price} hint={`Per ${unit}.`} />
        <Switch label="Ada express" hint="Bisa dikerjakan lebih cepat dengan harga berbeda." checked={values.hasExpress} onChange={(on) => set('hasExpress', on)} />
        {values.hasExpress && <MoneyInput label="Harga express" required value={values.price_express} onChange={(v) => set('price_express', v)} error={errors.price_express} hint={`Per ${unit}, dipakai bila pesanan ditandai express.`} />}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Lama pengerjaan reguler"
            required
            inputMode="numeric"
            pattern="[0-9]*"
            value={values.days_regular}
            onChange={(e) => set('days_regular', e.target.value)}
            error={errors.days_regular}
            hint="Hari; 0 = hari yang sama."
          />
          {values.hasExpress && (
            <Input
              label="Lama pengerjaan express"
              inputMode="numeric"
              pattern="[0-9]*"
              value={values.days_express}
              onChange={(e) => set('days_express', e.target.value)}
              error={errors.days_express}
              hint="Hari; kosong = sama dengan reguler."
            />
          )}
        </div>
        <Input
          label="Minimal pesanan"
          inputMode="decimal"
          value={values.min_qty}
          onChange={(e) => set('min_qty', e.target.value)}
          error={errors.min_qty}
          placeholder="0"
          hint={`Dalam ${unit}; di bawah ini dihitung sebagai minimal. Kosong = tanpa minimal.`}
        />
        <Switch label="Aktif" hint="Nonaktif: disembunyikan dari pesanan baru, riwayat tetap ada." checked={values.active} onChange={(on) => set('active', on)} />
        {isEdit && usageText && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{usageText} Layanan yang sudah dipakai tidak bisa dihapus; nonaktifkan saja.</p>}
      </form>
      {confirmDelete && service && (
        <ConfirmDialog
          open
          onClose={() => setConfirmDelete(false)}
          onConfirm={remove}
          title="Hapus layanan?"
          message={`Layanan ${service.name} belum pernah dipakai dan akan dihapus dari daftar harga.`}
          loading={saving}
        />
      )}
    </Modal>
  )
}
