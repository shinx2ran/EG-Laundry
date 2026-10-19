// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { LocalRepo } from '../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../lib/repo/types'
import { buildDemoDb, DEMO_ORG_ID } from '../lib/repo/demoSeed'
import type { MemberRole } from '../types/db'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }

vi.mock('./useOrg', () => ({
  useOrg: () => ({ org: { id: DEMO_ORG_ID, name: 'EG Laundry (Demo)' }, repo: state.repo, role: state.role, isAdmin: state.role !== 'staff', isLocalMode: true }),
}))

import { useLaundryData } from './useLaundryData'

function setup() {
  const db = buildDemoDb(new Date(2026, 9, 19))
  // rows of another organisation on the same device must stay invisible
  db.customers.push({ ...db.customers[0], id: 'c-other', org_id: 'other-org', name: 'Orang lain' })
  db.orders.push({ ...db.orders[0], id: 'o-other', org_id: 'other-org', order_number: 'LD-999999-0001' })
  state.repo = bindOrg(new LocalRepo(db), DEMO_ORG_ID)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { db, ...renderHook(() => useLaundryData(), { wrapper }) }
}

describe('useLaundryData', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('loads every laundry table of the organisation and indexes it', async () => {
    const { db, result } = setup()
    expect(result.current.isPending).toBe(true)
    expect(result.current.orders).toEqual([])
    await waitFor(() => expect(result.current.isPending).toBe(false))
    const d = result.current
    expect(d.error).toBeUndefined()
    expect(d.services.map((s) => s.sort_order)).toEqual([1, 2, 3, 4, 5, 6])
    expect(d.customers.map((c) => c.name)).toEqual([...d.customers.map((c) => c.name)].sort((a, b) => a.localeCompare(b)))
    expect(d.customers.some((c) => c.id === 'c-other')).toBe(false)
    expect(d.orders).toHaveLength(db.orders.length - 1)
    expect(d.orders.some((o) => o.id === 'o-other')).toBe(false)
    // newest first
    for (let i = 1; i < d.orders.length; i++) expect(d.orders[i - 1].created_at >= d.orders[i].created_at).toBe(true)
    expect(d.orderItems).toHaveLength(db.order_items.length)
    expect(d.payments).toHaveLength(db.payments.length)
    expect(d.packageCatalog).toHaveLength(1)
    expect(d.customerPackages).toHaveLength(2)
    expect(d.customerPackages[0].purchased_at >= d.customerPackages[1].purchased_at).toBe(true)

    expect(d.serviceById.size).toBe(6)
    expect(d.customerById.size).toBe(12)
    expect(d.orderById.size).toBe(d.orders.length)
    let items = 0
    for (const [orderId, list] of d.itemsByOrder) {
      items += list.length
      for (const it of list) expect(it.order_id).toBe(orderId)
      // oldest first within the order
      for (let i = 1; i < list.length; i++) expect(list[i - 1].created_at <= list[i].created_at).toBe(true)
    }
    expect(items).toBe(d.orderItems.length)
    let payments = 0
    for (const [orderId, list] of d.paymentsByOrder) {
      payments += list.length
      for (const p of list) expect(p.order_id).toBe(orderId)
    }
    expect(payments).toBe(d.payments.length)
    expect([...d.packagesByCustomer.values()].flat()).toHaveLength(2)
    for (const [customerId, list] of d.packagesByCustomer) for (const p of list) expect(p.customer_id).toBe(customerId)
  })

  it('totalsFor derives the money of one order from its own rows', async () => {
    const { db, result } = setup()
    await waitFor(() => expect(result.current.isPending).toBe(false))
    const d = result.current
    const unpaid = db.orders.find((o) => o.status === 'received' && !db.payments.some((p) => p.order_id === o.id))!
    const t = d.totalsFor(unpaid)
    const subtotal = db.order_items.filter((i) => i.order_id === unpaid.id).reduce((s, i) => s + i.line_total, 0)
    expect(t).toEqual({ subtotal, discount: 0, total: subtotal, paid: 0, outstanding: subtotal, payStatus: 'belum' })
    const paid = db.orders.find((o) => o.status === 'done' && db.payments.some((p) => p.order_id === o.id))!
    expect(d.totalsFor(paid)).toMatchObject({ outstanding: 0, payStatus: 'lunas' })
    expect(d.totalsFor(paid).paid).toBe(db.payments.filter((p) => p.order_id === paid.id).reduce((s, p) => s + p.amount, 0))
  })

  it('reports a failing table instead of hanging', async () => {
    const db = buildDemoDb(new Date(2026, 9, 19))
    const repo = bindOrg(new LocalRepo(db), DEMO_ORG_ID)
    state.repo = {
      ...repo,
      list: ((table: Parameters<OrgRepo['list']>[0], opts?: Parameters<OrgRepo['list']>[1]) =>
        table === 'payments' ? Promise.reject(new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.')) : repo.list(table, opts)) as OrgRepo['list'],
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useLaundryData(), { wrapper })
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    expect((result.current.error as Error).message).toMatch(/koneksi/)
    expect(result.current.orders.length).toBeGreaterThan(0)
  })
})
