// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ToastProvider } from '../../components/ui'
import type { MemberRole } from '../../types/db'
import { LocalRepo, emptyLocalDb } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import { buildDemoDb } from '../../lib/repo/demoSeed'
import { buildBackupFile } from '../settings/data/backupFile'
import { parseBackupText } from '../settings/data/backupFormat'

const ONLINE_ORG = 'b1f0c2aa-0000-4000-8000-0000000000ff'
const state: { repo: OrgRepo | null; role: MemberRole; isLocalMode: boolean } = { repo: null, role: 'owner', isLocalMode: false }

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: ONLINE_ORG, name: 'EG Laundry' }, repo: state.repo, role: state.role, isAdmin: state.role !== 'staff', isLocalMode: state.isLocalMode }),
}))

import { DemoImportCard } from './DemoImportCard'
import { LOCAL_DEMO_IMPORT_MESSAGE, ORDERS_EXIST_MESSAGE, STAFF_DEMO_IMPORT_MESSAGE, useDemoImport } from './useDemoImport'

let local: LocalRepo

function online(role: MemberRole = 'owner', isLocalMode = false) {
  const db = emptyLocalDb()
  db.organizations.push({ id: ONLINE_ORG, name: 'EG Laundry', created_by: 'u1', created_at: '2026-10-20T00:00:00.000Z', promo_template: null, wa_footer: null })
  local = new LocalRepo(db)
  state.repo = bindOrg(local, ONLINE_ORG)
  state.role = role
  state.isLocalMode = isLocalMode
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  )
}

const demoBackupText = () => JSON.stringify(buildBackupFile(buildDemoDb(new Date(2026, 9, 20)), 'EG Laundry (Demo)', new Date('2026-10-20T03:00:00Z')))

function pick(label: string, text: string, name = 'cadangan.json') {
  fireEvent.change(screen.getByLabelText(label), { target: { files: [new File([text], name, { type: 'application/json' })] } })
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('DemoImportCard', () => {
  it('online without orders: preview, the sample switch, then everything is moved with new ids', async () => {
    online()
    render(<DemoImportCard />, { wrapper })
    await screen.findByText('Pilih berkas cadangan Mode Demo')
    pick('Berkas cadangan Mode Demo', demoBackupText())
    // only the price list without the sample data
    await waitFor(() => expect(screen.getByTestId('demo-count-services').textContent).toBe('layanan6'))
    expect(screen.getByTestId('demo-count-orders').textContent).toBe('pesanan0')
    expect(screen.getByText('12 pelanggan dan 40 pesanan contoh tidak dipindahkan.')).toBeTruthy()

    fireEvent.click(screen.getByRole('switch', { name: 'Sertakan data contoh Mode Demo' }))
    await waitFor(() => expect(screen.getByTestId('demo-count-orders').textContent).toBe('pesanan40'))
    fireEvent.click(screen.getByRole('button', { name: 'Pindahkan ke online' }))
    await screen.findAllByText(/^Data Mode Demo dipindahkan: 6 layanan, 1 paket katalog, 12 pelanggan, 2 paket terjual, 40 pesanan/)

    const db = local.snapshot()
    expect(db.orders).toHaveLength(40)
    expect(db.customers).toHaveLength(12)
    expect(db.orders.every((o) => o.org_id === ONLINE_ORG && !o.id.startsWith('demo-'))).toBe(true)
    expect(db.organization_members).toHaveLength(0)
  })

  it('a file without laundry data is refused', async () => {
    online()
    render(<DemoImportCard />, { wrapper })
    await screen.findByText('Pilih berkas cadangan Mode Demo')
    pick('Berkas cadangan Mode Demo', JSON.stringify({ version: 1, tables: { organizations: [{ id: 'o1', name: 'EG Kost' }], tenants: [] } }))
    expect(await screen.findByText('Berkas ini tidak berisi data laundry. Pilih berkas cadangan dari Mode Demo EG Laundry.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pindahkan ke online' })).toBeNull()
  })

  it('hidden once the online laundry has orders', async () => {
    online()
    await state.repo!.insert('customers', { name: 'A', phone: null, is_tenant: false, room_name: null, kos_tenant_id: null, address: null, notes: null })
    const [c] = await state.repo!.list('customers')
    await state.repo!.insert('orders', {
      order_number: 'LD-202610-0001', customer_id: c.id, received_at: '2026-10-20', promised_at: null, express: false, status: 'received', ready_at: null, picked_up_at: null, discount: 0, notes: null,
    })
    const { container } = render(<DemoImportCard />, { wrapper })
    await new Promise((r) => setTimeout(r, 50))
    expect(container.textContent).toBe('')
  })

  it('Mode Demo: the card says it needs Supabase and offers no button', () => {
    online('owner', true)
    render(<DemoImportCard />, { wrapper })
    expect(screen.getByText(LOCAL_DEMO_IMPORT_MESSAGE)).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('useDemoImport', () => {
  it('refuses staff and Mode Demo before reading or writing', async () => {
    const backup = parseBackupText(demoBackupText())
    for (const [role, isLocal, message] of [
      ['staff', false, STAFF_DEMO_IMPORT_MESSAGE],
      ['admin', true, LOCAL_DEMO_IMPORT_MESSAGE],
    ] as const) {
      online(role, isLocal)
      const list = vi.spyOn(state.repo!, 'list')
      const insertMany = vi.spyOn(state.repo!, 'insertMany')
      const { result } = renderHook(() => useDemoImport(), { wrapper })
      expect(result.current.canImport).toBe(false)
      await expect(result.current.preview(backup, false)).rejects.toThrow(message)
      await expect(result.current.moveToOnline(backup, false)).rejects.toThrow(message)
      expect(list).not.toHaveBeenCalled()
      expect(insertMany).not.toHaveBeenCalled()
    }
  })

  it('checks again for orders right before writing', async () => {
    online('admin')
    const backup = parseBackupText(demoBackupText())
    const { result } = renderHook(() => useDemoImport(), { wrapper })
    expect(result.current.canImport).toBe(true)
    await result.current.moveToOnline(backup, true)
    const before = local.snapshot().services.length
    await expect(result.current.moveToOnline(backup, true)).rejects.toThrow(ORDERS_EXIST_MESSAGE)
    expect(local.snapshot().services).toHaveLength(before)
  })

  it('a move that stops halfway is undone, so the retry is allowed and nothing is doubled', async () => {
    online('owner')
    const backup = parseBackupText(demoBackupText())
    const base = state.repo!
    let fail = true
    state.repo = {
      ...base,
      insertMany: (async (table: string, rows: never[]) => {
        if (table === 'order_items' && fail) {
          fail = false
          throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.')
        }
        return base.insertMany(table as 'orders', rows)
      }) as OrgRepo['insertMany'],
    }
    const { result } = renderHook(() => useDemoImport(), { wrapper })
    const stopped = await result.current.moveToOnline(backup, true)
    expect(stopped).toMatchObject({ failedTable: 'order_items', undone: true })
    expect(local.snapshot().orders).toHaveLength(0)
    expect(local.snapshot().customer_packages).toHaveLength(0)

    const moved = await result.current.moveToOnline(backup, true)
    expect(moved.error).toBeNull()
    const db = local.snapshot()
    expect(db.orders).toHaveLength(40)
    expect(db.customer_packages).toHaveLength(2)
    expect(db.customers).toHaveLength(12)
  })
})
