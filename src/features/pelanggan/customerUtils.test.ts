import { describe, expect, it } from 'vitest'
import type { Customer, CustomerPackage, Order, PackageCatalogItem } from '../../types/db'
import {
  EMPTY_CUSTOMER_FORM,
  ERR_NAME_REQUIRED,
  ERR_PACKAGE_DATE,
  ERR_PACKAGE_INACTIVE,
  ERR_PHONE_INVALID,
  ERR_PICK_PACKAGE,
  ERR_ROOM_LONG,
  PHONE_EXAMPLE_HINT,
  canDeleteCustomer,
  customerFilterCounts,
  customerOrders,
  customerStats,
  customerToForm,
  formToCustomerPatch,
  formToCustomerPayload,
  initials,
  lastVisitText,
  matchesCustomerFilter,
  matchesCustomerSearch,
  packageExpiry,
  packageSaleRow,
  packageState,
  parseCustomerFilter,
  phoneHint,
  sortCustomersByVisit,
  tenantBadgeText,
  validateCustomerForm,
  validatePackageSale,
} from './customerUtils'

const ts = { created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }

function customer(partial: Partial<Customer> = {}): Customer {
  return {
    id: 'c1',
    org_id: 'o',
    name: 'Rina Putri',
    phone: '0812-0000-0001',
    is_tenant: true,
    room_name: 'A1',
    kos_tenant_id: null,
    address: null,
    notes: null,
    ...ts,
    ...partial,
  }
}

function order(partial: Partial<Order> & Pick<Order, 'id' | 'customer_id' | 'received_at'>): Order {
  return {
    org_id: 'o',
    order_number: `LD-202610-${partial.id}`,
    promised_at: null,
    express: false,
    status: 'done',
    ready_at: null,
    picked_up_at: null,
    discount: 0,
    notes: null,
    ...ts,
    ...partial,
  }
}

const catalog: PackageCatalogItem = {
  id: 'cat1',
  org_id: 'o',
  name: 'Paket 20 kg cuci setrika',
  service_id: 'svc-cs',
  qty: 20,
  price: 140_000,
  valid_days: 60,
  active: true,
  ...ts,
}

describe('customer form', () => {
  it('requires a name of at least 2 characters', () => {
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM }).name).toBe(ERR_NAME_REQUIRED)
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, name: ' A ' }).name).toMatch(/pendek/)
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, name: 'Mega' })).toEqual({})
  })

  it('accepts an empty phone and refuses an implausible one', () => {
    const base = { ...EMPTY_CUSTOMER_FORM, name: 'Mega' }
    expect(validateCustomerForm({ ...base, phone: '' })).toEqual({})
    expect(validateCustomerForm({ ...base, phone: '0812-3456-7890' })).toEqual({})
    expect(validateCustomerForm({ ...base, phone: '+62 812 3456 7890' })).toEqual({})
    expect(validateCustomerForm({ ...base, phone: '12' }).phone).toBe(ERR_PHONE_INVALID)
    expect(validateCustomerForm({ ...base, phone: 'abc' }).phone).toBe(ERR_PHONE_INVALID)
  })

  it('limits the room name only for a tenant', () => {
    const long = 'K'.repeat(21)
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, name: 'Mega', is_tenant: true, room_name: long }).room_name).toBe(ERR_ROOM_LONG)
    expect(validateCustomerForm({ ...EMPTY_CUSTOMER_FORM, name: 'Mega', is_tenant: false, room_name: long })).toEqual({})
  })

  it('keeps the phone as typed, trims, nulls blanks and clears the room of a walk-in', () => {
    const payload = formToCustomerPayload({ name: '  Bang Jali ', phone: ' 0812-0000-0012 ', is_tenant: false, room_name: 'B3', address: ' ', notes: 'Warung sebelah' })
    expect(payload).toEqual({ name: 'Bang Jali', phone: '0812-0000-0012', is_tenant: false, room_name: null, kos_tenant_id: null, address: null, notes: 'Warung sebelah' })
    const tenant = formToCustomerPatch({ ...EMPTY_CUSTOMER_FORM, name: 'Yoga', is_tenant: true, room_name: ' B3 ' })
    expect(tenant).toEqual({ name: 'Yoga', phone: null, is_tenant: true, room_name: 'B3', address: null, notes: null })
    // the import id is not part of the form: an update never touches it
    expect('kos_tenant_id' in tenant).toBe(false)
  })

  it('round-trips a row through the form', () => {
    const c = customer({ address: 'Jl. Melati 1', notes: null, phone: null })
    const form = customerToForm(c)
    expect(form).toEqual({ name: 'Rina Putri', phone: '', is_tenant: true, room_name: 'A1', address: 'Jl. Melati 1', notes: '' })
    expect(formToCustomerPatch(form)).toEqual({ name: 'Rina Putri', phone: null, is_tenant: true, room_name: 'A1', address: 'Jl. Melati 1', notes: null })
  })

  it('phoneHint shows the recognised number or the example', () => {
    expect(phoneHint('')).toBe(PHONE_EXAMPLE_HINT)
    expect(phoneHint('08')).toBe(PHONE_EXAMPLE_HINT)
    expect(phoneHint('0812-3456-7890')).toBe('Dikenali sebagai +6281234567890')
    expect(phoneHint('+62 812 3456 7890')).toBe('Dikenali sebagai +6281234567890')
  })
})

describe('list filter and search', () => {
  const rows = [customer({ id: '1' }), customer({ id: '2', name: 'Pak Hendra', is_tenant: false, room_name: null, phone: '0812-0000-0006' }), customer({ id: '3', name: 'Mega', is_tenant: false, room_name: null, phone: null })]

  it('Semua / Anak kos / Umum with counts, from and to the URL', () => {
    expect(customerFilterCounts(rows)).toEqual({ all: 3, tenant: 1, walkin: 2 })
    expect(rows.filter((c) => matchesCustomerFilter(c, 'tenant')).map((c) => c.id)).toEqual(['1'])
    expect(rows.filter((c) => matchesCustomerFilter(c, 'walkin')).map((c) => c.id)).toEqual(['2', '3'])
    expect(rows.filter((c) => matchesCustomerFilter(c, 'all'))).toHaveLength(3)
    expect(parseCustomerFilter('kos')).toBe('tenant')
    expect(parseCustomerFilter('umum')).toBe('walkin')
    expect(parseCustomerFilter(null)).toBe('all')
    expect(parseCustomerFilter('apa')).toBe('all')
  })

  it('matches the name case-insensitively, the phone by digits (local or +62) and a tenant by room', () => {
    const rina = rows[0]
    expect(matchesCustomerSearch(rina, 'rina')).toBe(true)
    expect(matchesCustomerSearch(rina, 'PUTRI')).toBe(true)
    expect(matchesCustomerSearch(rina, '  ')).toBe(true)
    expect(matchesCustomerSearch(rina, '0812 0000')).toBe(true)
    expect(matchesCustomerSearch(rina, '+62812')).toBe(true)
    expect(matchesCustomerSearch(rina, '(0812) 0000-0001')).toBe(true)
    expect(matchesCustomerSearch(rina, 'a1')).toBe(true)
    expect(matchesCustomerSearch(rina, 'hendra')).toBe(false)
    expect(matchesCustomerSearch(rina, '999')).toBe(false)
    // fewer than 3 digits never searches the phone
    expect(matchesCustomerSearch(rina, '08')).toBe(false)
    // a stored +62 number is found by its local form
    expect(matchesCustomerSearch(customer({ phone: '+6281200000001' }), '0812')).toBe(true)
    // no phone, no room: only the name
    expect(matchesCustomerSearch(rows[2], '0812')).toBe(false)
    expect(matchesCustomerSearch(rows[1], 'a1')).toBe(false)
  })
})

describe('visits', () => {
  const orders = [
    order({ id: 'o1', customer_id: 'rina', received_at: '2026-10-01' }),
    order({ id: 'o2', customer_id: 'rina', received_at: '2026-10-15' }),
    order({ id: 'o3', customer_id: 'rina', received_at: '2026-10-18', status: 'cancelled' }),
    order({ id: 'o4', customer_id: 'hendra', received_at: '2026-10-17', status: 'received' }),
  ]

  it('customerStats: the newest non-cancelled order is the last visit, cancelled orders do not count', () => {
    const stats = customerStats(orders)
    expect(stats.get('rina')).toEqual({ lastVisit: '2026-10-15', orderCount: 2 })
    expect(stats.get('hendra')).toEqual({ lastVisit: '2026-10-17', orderCount: 1 })
    expect(stats.get('mega')).toBeUndefined()
  })

  it('sortCustomersByVisit: most recent first, never-visited last A-Z', () => {
    const stats = customerStats(orders)
    const rows = [customer({ id: 'mega', name: 'Mega' }), customer({ id: 'rina', name: 'Rina Putri' }), customer({ id: 'bang', name: 'Bang Jali' }), customer({ id: 'hendra', name: 'Pak Hendra' })]
    expect(sortCustomersByVisit(rows, stats).map((c) => c.id)).toEqual(['hendra', 'rina', 'bang', 'mega'])
    // the input is not mutated
    expect(rows.map((c) => c.id)).toEqual(['mega', 'rina', 'bang', 'hendra'])
  })

  it('customerOrders: every order of the customer newest first, cancelled included', () => {
    const mine = customerOrders('rina', [...orders, order({ id: 'o5', customer_id: 'rina', received_at: '2026-10-15', created_at: '2026-10-15T10:00:00Z' })])
    expect(mine.map((o) => o.id)).toEqual(['o3', 'o5', 'o2', 'o1'])
  })

  it('lastVisitText', () => {
    const today = '2026-10-19'
    expect(lastVisitText(null, today)).toBe('Belum pernah')
    expect(lastVisitText('2026-10-19', today)).toBe('Hari ini')
    expect(lastVisitText('2026-10-20', today)).toBe('Hari ini')
    expect(lastVisitText('2026-10-18', today)).toBe('Kemarin')
    expect(lastVisitText('2026-10-16', today)).toBe('3 hari lalu')
    expect(lastVisitText('2026-10-12', today)).toBe('1 minggu lalu')
    expect(lastVisitText('2026-09-28', today)).toBe('3 minggu lalu')
    expect(lastVisitText('2026-08-25', today)).toBe('7 minggu lalu')
    expect(lastVisitText('2026-08-24', today)).toBe('24 Agt 2026')
  })

  it('tenantBadgeText and initials', () => {
    expect(tenantBadgeText(customer())).toBe('Anak kos · A1')
    expect(tenantBadgeText(customer({ room_name: ' ' }))).toBe('Anak kos')
    expect(tenantBadgeText(customer({ room_name: null }))).toBe('Anak kos')
    expect(tenantBadgeText(customer({ is_tenant: false, room_name: 'A1' }))).toBeNull()
    expect(initials('Rina Putri')).toBe('RP')
    expect(initials('Mega')).toBe('M')
    expect(initials('  ')).toBe('?')
  })

  it('canDeleteCustomer: only without orders and packages', () => {
    const pkg = { customer_id: 'nabila' }
    expect(canDeleteCustomer('mega', orders, [pkg])).toBe(true)
    expect(canDeleteCustomer('rina', orders, [pkg])).toBe(false)
    expect(canDeleteCustomer('nabila', orders, [pkg])).toBe(false)
  })
})

describe('prepaid package sale (SPEC 3.4)', () => {
  it('packageSaleRow copies the catalog entry and sets expires_at from valid_days', () => {
    const row = packageSaleRow({ catalog, customerId: 'c1', purchasedAt: '2026-10-19', method: 'qris', notes: ' ' })
    expect(row).toEqual({
      customer_id: 'c1',
      catalog_id: 'cat1',
      name: 'Paket 20 kg cuci setrika',
      service_id: 'svc-cs',
      qty_total: 20,
      price: 140_000,
      purchased_at: '2026-10-19',
      expires_at: '2026-12-18',
      method: 'qris',
      notes: null,
    })
    expect(packageSaleRow({ catalog: { ...catalog, valid_days: null }, customerId: 'c1', purchasedAt: '2026-10-19', method: 'cash', notes: 'bayar nanti' })).toMatchObject({ expires_at: null, notes: 'bayar nanti' })
    expect(packageExpiry('2026-12-31', 1)).toBe('2027-01-01')
    expect(packageExpiry('2026-12-31', null)).toBeNull()
  })

  it('validatePackageSale: a package, an active one, a real date', () => {
    expect(validatePackageSale({ catalog: null, purchasedAt: '2026-10-19' })).toBe(ERR_PICK_PACKAGE)
    expect(validatePackageSale({ catalog: { ...catalog, active: false }, purchasedAt: '2026-10-19' })).toBe(ERR_PACKAGE_INACTIVE)
    expect(validatePackageSale({ catalog, purchasedAt: '' })).toBe(ERR_PACKAGE_DATE)
    expect(validatePackageSale({ catalog, purchasedAt: '2026-02-30' })).toBe(ERR_PACKAGE_DATE)
    expect(validatePackageSale({ catalog, purchasedAt: '2026-10-19' })).toBeNull()
    expect(validatePackageSale({ catalog, purchasedAt: '2026-13-01' })).toBe(ERR_PACKAGE_DATE)
    expect(validatePackageSale({ catalog, purchasedAt: '19-10-2026' })).toBe(ERR_PACKAGE_DATE)
    expect(validatePackageSale({ catalog, purchasedAt: '2024-02-29' })).toBeNull()
  })

  it('packageState: Habis beats Kedaluwarsa, Aktif otherwise', () => {
    const pkg: Pick<CustomerPackage, 'expires_at'> = { expires_at: '2026-10-18' }
    expect(packageState(pkg, 0, '2026-10-19')).toBe('empty')
    expect(packageState(pkg, 2.5, '2026-10-19')).toBe('expired')
    expect(packageState(pkg, 2.5, '2026-10-18')).toBe('active')
    expect(packageState({ expires_at: null }, 2.5, '2099-01-01')).toBe('active')
  })
})
