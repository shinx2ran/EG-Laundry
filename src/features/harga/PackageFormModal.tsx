import { useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmDialog, Input, Modal, MoneyInput, Select, useToast } from '../../components/ui'
import type { PackageCatalogItem, Service } from '../../types/db'
import { Switch } from './components'
import { formatRupiah } from '../../lib/format'
import { roundQty } from '../../domain/pricing'
import {
  catalogUsageText,
  initialPackageForm,
  packageServiceOptions,
  packageToForm,
  parseDecimalInput,
  qtyToInput,
  validatePackageForm,
  type PackageFormErrors,
  type PackageFormValues,
} from './hargaUtils'
import type { HargaActions } from './useHargaActions'

/**
 * Add / edit a prepaid package on offer (SPEC 3.4): name, a per-kg service, qty, price, validity. Mounted only
 * while open. An entry customers have bought offers no delete: it is deactivated instead.
 */
export function PackageFormModal({
  item,
  services,
  sold = 0,
  actions,
  onClose,
}: {
  item: PackageCatalogItem | null
  /** the whole price list; only active per-kg services are offered */
  services: Service[]
  /** how many customers bought this entry (edit) */
  sold?: number
  actions: HargaActions
  onClose: () => void
}) {
  const toast = useToast()
  const [values, setValues] = useState<PackageFormValues>(() => (item ? packageToForm(item) : initialPackageForm(services)))
  const [errors, setErrors] = useState<PackageFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isEdit = item !== null
  const options = packageServiceOptions(services, item?.service_id ?? null)
  const soldText = catalogUsageText(sold)

  const set = <K extends keyof PackageFormValues>(key: K, value: PackageFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  // price per kg as a hint, so the owner sees the discount the package gives; the stored qty when it rounds (2,555 -> 2,56)
  const typedQty = parseDecimalInput(values.qty)
  const qty = typedQty !== null && !Number.isNaN(typedQty) && typedQty > 0 ? typedQty : null
  const storedQty = qty !== null ? roundQty(qty) : null
  const service = services.find((s) => s.id === values.service_id)
  const perKg = storedQty && values.price > 0 ? Math.round(values.price / storedQty) : null
  const priceHint = perKg !== null ? `Setara ${formatRupiah(perKg)}/kg${service ? ` (reguler ${formatRupiah(service.price)}/kg)` : ''}.` : 'Harga seluruh paket, dibayar di muka.'
  const qtyHint = storedQty !== null && storedQty !== qty ? `Disimpan sebagai ${qtyToInput(storedQty)} kg.` : 'Sampai 2 angka di belakang koma.'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validatePackageForm(values, services)
    setErrors(errs)
    if (Object.values(errs).some(Boolean)) return
    setSaving(true)
    try {
      const saved = item ? await actions.updatePackage(item, values, services) : await actions.createPackage(values, services)
      toast.success(isEdit ? `Paket ${saved.name} diperbarui.` : `Paket ${saved.name} ditambahkan.`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan paket.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!item) return
    setSaving(true)
    try {
      await actions.deletePackage(item)
      toast.success(`Paket ${item.name} dihapus.`)
      onClose()
    } catch (err) {
      setConfirmDelete(false)
      toast.error(err instanceof Error ? err.message : 'Gagal menghapus paket.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Ubah paket' : 'Tambah paket'}
      footer={
        <>
          {isEdit && sold === 0 && (
            <Button type="button" variant="ghost" className="mr-auto text-red-700 hover:bg-red-50" icon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)} disabled={saving}>
              Hapus
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="package-form" loading={saving}>
            Simpan
          </Button>
        </>
      }
    >
      <form id="package-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Nama paket" required value={values.name} onChange={(e) => set('name', e.target.value)} error={errors.name} placeholder="Mis. Paket 20 kg cuci setrika" maxLength={80} autoFocus={!isEdit} />
        <Select
          label="Layanan"
          required
          value={values.service_id}
          onChange={(e) => set('service_id', e.target.value)}
          options={options.map((s) => ({ value: s.id, label: `${s.name} (${formatRupiah(s.price)}/kg)` }))}
          placeholder={options.length === 0 ? 'Belum ada layanan per kg yang aktif' : 'Pilih layanan'}
          error={errors.service_id}
          hint="Paket hanya untuk layanan per kg."
        />
        <Input
          label="Jumlah (kg)"
          required
          inputMode="decimal"
          value={values.qty}
          onChange={(e) => set('qty', e.target.value)}
          error={errors.qty}
          placeholder="20"
          hint={qtyHint}
        />
        <MoneyInput label="Harga paket" required value={values.price} onChange={(v) => set('price', v)} error={errors.price} hint={priceHint} />
        <Input
          label="Masa berlaku"
          inputMode="numeric"
          pattern="[0-9]*"
          value={values.valid_days}
          onChange={(e) => set('valid_days', e.target.value)}
          error={errors.valid_days}
          placeholder="Tanpa kedaluwarsa"
          hint="Hari sejak pembelian; kosong = tanpa kedaluwarsa."
        />
        <Switch label="Aktif" hint="Nonaktif: tidak ditawarkan lagi; paket yang sudah dibeli tetap berlaku." checked={values.active} onChange={(on) => set('active', on)} />
        {isEdit && soldText && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{soldText} Paket yang sudah dibeli tidak bisa dihapus; nonaktifkan saja.</p>}
      </form>
      {confirmDelete && item && (
        <ConfirmDialog
          open
          onClose={() => setConfirmDelete(false)}
          onConfirm={remove}
          title="Hapus paket?"
          message={`Paket ${item.name} belum pernah dibeli dan akan dihapus dari katalog.`}
          loading={saving}
        />
      )}
    </Modal>
  )
}
