import { useState, type FormEvent } from 'react'
import { Button, Input, Modal, Switch, Textarea, useToast } from '../../components/ui'
import type { Customer } from '../../types/db'
import { customerToForm, EMPTY_CUSTOMER_FORM, phoneHint, validateCustomerForm, type CustomerFormErrors, type CustomerFormValues } from './customerUtils'
import type { CustomerActions } from './useCustomerActions'

export interface CustomerFormModalProps {
  open: boolean
  onClose: () => void
  /** existing row when editing; null/undefined when creating */
  customer?: Customer | null
  actions: CustomerActions
  onSaved?: (saved: Customer) => void
  /** opened from a missing-phone WhatsApp button (`?isi=hp`): start in Nomor HP */
  focusPhone?: boolean
}

/**
 * Create / edit customer form in a Modal (bottom sheet on phones): name, phone, the "Anak kos EG Kost" switch
 * that reveals the room, address and notes (SPEC 3.2). The dialog is mounted only while open, so every
 * opening starts from the row it edits.
 */
export function CustomerFormModal(props: CustomerFormModalProps) {
  if (!props.open) return null
  return <CustomerFormDialog key={props.customer?.id ?? 'new'} {...props} />
}

function CustomerFormDialog({ onClose, customer, actions, onSaved, focusPhone = false }: CustomerFormModalProps) {
  const toast = useToast()
  const [values, setValues] = useState<CustomerFormValues>(() => (customer ? customerToForm(customer) : EMPTY_CUSTOMER_FORM))
  const [errors, setErrors] = useState<CustomerFormErrors>({})
  const [saving, setSaving] = useState(false)
  const isEdit = Boolean(customer)

  const set = <K extends keyof CustomerFormValues>(key: K, value: CustomerFormValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const errs = validateCustomerForm(values)
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      toast.error('Periksa kembali data yang ditandai merah.')
      return
    }
    setSaving(true)
    try {
      const saved = customer ? await actions.updateCustomer(customer, values) : await actions.createCustomer(values)
      toast.success(isEdit ? 'Data pelanggan diperbarui.' : `Pelanggan ${saved.name} ditambahkan.`)
      onSaved?.(saved)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan pelanggan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? 'Ubah pelanggan' : 'Tambah pelanggan'}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" form="customer-form" loading={saving}>
            {isEdit ? 'Simpan perubahan' : 'Simpan'}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="space-y-4" noValidate>
        <Input label="Nama" required value={values.name} onChange={(e) => set('name', e.target.value)} error={errors.name} autoComplete="name" placeholder="Nama pelanggan" autoFocus={!focusPhone} />
        <Input
          label="Nomor HP / WhatsApp"
          type="tel"
          inputMode="tel"
          value={values.phone}
          onChange={(e) => set('phone', e.target.value)}
          error={errors.phone}
          hint={focusPhone && !values.phone.trim() ? 'Isi nomor HP supaya pesan WhatsApp bisa dikirim. Contoh: 0812-3456-7890' : `Boleh dikosongkan dulu. ${phoneHint(values.phone)}`}
          placeholder="08xx"
          autoFocus={focusPhone}
        />
        <Switch label="Anak kos EG Kost" hint="Penyewa kos: kamarnya tampil di daftar pelanggan" checked={values.is_tenant} onChange={(v) => set('is_tenant', v)} />
        {values.is_tenant && (
          <Input label="Kamar" value={values.room_name} onChange={(e) => set('room_name', e.target.value)} error={errors.room_name} placeholder="mis. B3" autoCapitalize="characters" maxLength={20} />
        )}
        <Textarea label="Alamat" rows={2} value={values.address} onChange={(e) => set('address', e.target.value)} placeholder="opsional" />
        <Textarea label="Catatan" rows={2} value={values.notes} onChange={(e) => set('notes', e.target.value)} placeholder="mis. pisahkan baju putih" />
      </form>
    </Modal>
  )
}
