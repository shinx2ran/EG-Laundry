import { useState } from 'react'
import { Link } from 'react-router'
import { Button, Input, Modal, Select, Textarea, useToast } from '../../components/ui'
import type { Customer, PackageCatalogItem, PaymentMethod, Service } from '../../types/db'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABEL } from '../../types/db'
import { formatDate, formatQty, formatRupiah, todayISO } from '../../lib/format'
import { packageExpiry, validatePackageSale } from './customerUtils'
import { Row } from './components'
import type { CustomerActions } from './useCustomerActions'

export interface SellPackageModalProps {
  open: boolean
  onClose: () => void
  customer: Customer
  /** the whole catalog; only active entries are offered */
  catalog: PackageCatalogItem[]
  serviceById: Map<string, Service>
  actions: CustomerActions
  /** owner/admin see a link to the catalog when it is empty */
  isAdmin: boolean
}

/** Sell a prepaid package to the customer (SPEC 3.4): pick a catalog entry, date, payment method, notes. */
export function SellPackageModal(props: SellPackageModalProps) {
  if (!props.open) return null
  return <SellPackageDialog {...props} />
}

function SellPackageDialog({ onClose, customer, catalog, serviceById, actions, isAdmin }: SellPackageModalProps) {
  const toast = useToast()
  const active = catalog.filter((c) => c.active)
  const [catalogId, setCatalogId] = useState(active[0]?.id ?? '')
  const [purchasedAt, setPurchasedAt] = useState(todayISO())
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const selected = active.find((c) => c.id === catalogId) ?? null
  const error = validatePackageSale({ catalog: selected, purchasedAt })
  const service = selected ? serviceById.get(selected.service_id) : undefined
  const expires = selected ? packageExpiry(purchasedAt, selected.valid_days) : null

  const submit = async () => {
    if (!selected || error) return
    setSaving(true)
    try {
      await actions.sellPackage({ customer, catalog: selected, purchasedAt, method, notes })
      toast.success(`${selected.name} dijual ke ${customer.name}.`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan penjualan paket.')
    } finally {
      setSaving(false)
    }
  }

  if (active.length === 0) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Jual paket prabayar"
        size="sm"
        footer={
          <Button variant="ghost" onClick={onClose}>
            Tutup
          </Button>
        }
      >
        <p className="text-sm text-slate-700">Belum ada paket aktif di katalog.</p>
        {isAdmin ? (
          <Link to="/harga" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">
            Atur katalog paket di Daftar harga
          </Link>
        ) : (
          <p className="mt-2 text-sm text-slate-500">Minta pemilik/admin menambahkan paket di Daftar harga.</p>
        )}
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Jual paket prabayar"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button onClick={submit} loading={saving} disabled={Boolean(error)}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Untuk <strong className="text-slate-900">{customer.name}</strong>. Pembelian dicatat sebagai uang masuk pada tanggal beli.
        </p>
        <Select
          label="Paket"
          value={catalogId}
          onChange={(e) => setCatalogId(e.target.value)}
          options={active.map((c) => ({ value: c.id, label: `${c.name} · ${formatRupiah(c.price)}` }))}
        />
        {selected && (
          <div className="space-y-1 rounded-lg bg-slate-50 p-3">
            <Row label="Layanan" value={service?.name ?? '—'} />
            <Row label="Isi paket" value={formatQty(selected.qty, service?.unit ?? 'kg')} />
            <Row label="Berlaku sampai" value={expires ? formatDate(expires) : 'Tanpa kedaluwarsa'} />
            <Row label="Harga" value={formatRupiah(selected.price)} strong />
          </div>
        )}
        <Input label="Tanggal beli" type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} required error={purchasedAt && error === 'Tanggal pembelian tidak valid.' ? error : undefined} />
        <Select label="Metode bayar" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABEL[m] }))} />
        <Textarea label="Catatan" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="opsional" />
      </div>
    </Modal>
  )
}
