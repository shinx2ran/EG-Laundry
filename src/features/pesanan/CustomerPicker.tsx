import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Phone, UserPlus, X } from 'lucide-react'
import { Button, Input, useToast } from '../../components/ui'
import type { Customer, Order } from '../../types/db'
import { newCustomerPrefill, pickCustomers } from './orderUtils'
import { TenantBadge } from '../pelanggan/components'

/** What the quick add asks: the name, and the phone as typed ('' = later). */
export interface NewCustomerInput {
  name: string
  phone: string
}

export interface CustomerPickerProps {
  customers: Customer[]
  /** for "latest visitors first" when nothing is typed */
  orders: Pick<Order, 'customer_id' | 'received_at' | 'status'>[]
  value: Customer | undefined
  onChange: (customerId: string | null) => void
  /** saves the customer (useCustomerActions.createCustomer: the same rules as the Pelanggan form) and returns it */
  onCreate: (input: NewCustomerInput) => Promise<Customer>
  /** extra line under the chosen customer (e.g. their packages) */
  chosenExtra?: ReactNode
}

/**
 * Pelanggan of the order form (SPEC 3.2): search by name or phone over the customers, the latest visitors first;
 * "Tambah pelanggan baru" right here with Nama (required) and Nomor HP (may follow later), which selects the new
 * customer at once.
 */
export function CustomerPicker({ customers, orders, value, onChange, onCreate, chosenExtra }: CustomerPickerProps) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  // Enter pressed again while the first save is still on its way must not add the customer twice
  const savingRef = useRef(false)

  if (value) {
    return (
      <div className="space-y-2">
        <div className="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50/50 p-3" data-testid="chosen-customer">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-slate-900">{value.name}</span>
              <TenantBadge customer={value} />
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-600">
              <Phone className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              {value.phone ?? <span className="text-amber-700">Nomor HP belum diisi</span>}
            </p>
            {value.notes && <p className="mt-1 text-xs text-slate-500">{value.notes}</p>}
          </div>
          <Button variant="outline" className="h-11 shrink-0" onClick={() => onChange(null)}>
            Ganti
          </Button>
        </div>
        {chosenExtra}
      </div>
    )
  }

  const startAdding = () => {
    const prefill = newCustomerPrefill(query)
    setName(prefill.name)
    setPhone(prefill.phone)
    setAdding(true)
  }

  const save = async () => {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const created = await onCreate({ name, phone })
      toast.success(`Pelanggan ${created.name} ditambahkan.`)
      setAdding(false)
      setQuery('')
      onChange(created.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menambah pelanggan.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // the page is no <form>: Enter saves the new customer instead of doing nothing
  const onEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void save()
    }
  }

  if (adding) {
    return (
      <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label="Pelanggan baru" role="group">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-900">Pelanggan baru</p>
          <button type="button" onClick={() => setAdding(false)} aria-label="Batal tambah pelanggan" className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        <Input label="Nama" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} required autoFocus className="h-11" autoComplete="off" />
        <Input
          label="Nomor HP"
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={onEnter}
          placeholder="opsional, mis. 0812-3456-7890"
          hint="Boleh diisi nanti."
          className="h-11"
          autoComplete="off"
        />
        <Button fullWidth size="lg" loading={saving} onClick={() => void save()}>
          Simpan pelanggan
        </Button>
      </div>
    )
  }

  const matches = pickCustomers(customers, orders, query)
  return (
    <div className="space-y-2">
      <Input
        type="search"
        label="Cari pelanggan"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Nama atau nomor HP"
        className="h-11"
        autoComplete="off"
      />
      {matches.length > 0 ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white" aria-label="Pilih pelanggan">
          {matches.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onChange(c.id)} className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-brand-50">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-medium text-slate-900">{c.name}</span>
                    <TenantBadge customer={c} />
                  </span>
                  <span className="block text-xs text-slate-500">{c.phone ?? 'Tanpa nomor HP'}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-slate-500">{query.trim() ? 'Tidak ada pelanggan yang cocok.' : 'Belum ada pelanggan.'}</p>
      )}
      <Button variant="secondary" fullWidth className="h-11" icon={<UserPlus className="h-4 w-4" />} onClick={startAdding}>
        Tambah pelanggan baru
      </Button>
    </div>
  )
}
