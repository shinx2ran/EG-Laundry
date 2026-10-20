// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { LocalRepo, emptyLocalDb, type LocalDb } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import { buildDemoDb, DEMO_ORG_ID } from '../../lib/repo/demoSeed'
import type { MemberRole, Organization } from '../../types/db'

const state: { repo: OrgRepo | null; role: MemberRole; org: Organization | null } = { repo: null, role: 'owner', org: null }

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: state.org, repo: state.repo, role: state.role, isAdmin: state.role !== 'staff', isLocalMode: true }),
}))
// recharts needs a real layout engine; the chart itself is checked in the e2e test
vi.mock('./MoneyChart', () => ({
  MoneyChart: ({ series }: { series: { total: number }[] }) => <div data-testid="money-chart">{series.map((d) => d.total).join(',')}</div>,
}))

import { DashboardPage } from './DashboardPage'

const NOW = new Date(2026, 9, 19, 10) // Monday 19 Oct 2026, 10:00 local time

function setup(db: LocalDb, role: MemberRole = 'owner') {
  state.org = db.organizations[0] ?? { id: DEMO_ORG_ID, name: 'Laundry Baru', created_by: 'u', created_at: NOW.toISOString(), promo_template: null, wa_footer: null }
  state.repo = bindOrg(new LocalRepo(db), DEMO_ORG_ID)
  state.role = role
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const tile = (id: string) => screen.getByTestId(id)
const tileValue = (id: string) => within(tile(id)).getByTestId('tile-value').textContent

describe('DashboardPage (demo seed on Monday 19 Oct 2026)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('owner: header, the five tiles with their links, ready / late / unpaid cards and the 7-day chart', async () => {
    setup(buildDemoDb(NOW))
    await screen.findByTestId('tile-masuk')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('EG Laundry (Demo)')
    expect(screen.getByText('Senin, 19 Oktober 2026')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Pesanan baru' }).getAttribute('href')).toBe('/pesanan/baru')

    expect(tileValue('tile-masuk')).toBe('2')
    expect(tile('tile-masuk').textContent).toContain('7,5 kg · Rp 69.000')
    expect(tileValue('tile-proses')).toBe('5')
    expect(tile('tile-proses').textContent).toContain('3 diterima · 2 proses')
    expect(tile('tile-proses').textContent).toContain('2 terlambat')
    expect(tile('tile-proses').getAttribute('href')).toBe('/pesanan')
    expect(tileValue('tile-siap')).toBe('3')
    expect(tile('tile-siap').getAttribute('href')).toBe('/pesanan?tab=siap')
    expect(tileValue('tile-belum-bayar')).toBe('4')
    expect(tile('tile-belum-bayar').textContent).toContain('Rp 151.000')
    expect(tileValue('tile-uang-masuk')).toBe('Rp 18.000')
    expect(screen.getByTestId('money-qris').textContent).toBe('QRISRp 18.000')
    expect(screen.getByTestId('money-cash').textContent).toBe('TunaiRp 0')
    expect(tile('tile-uang-masuk').getAttribute('href')).toBe('/laporan')

    // Siap diambil: WhatsApp with the ready text, Diambil opening the pickup dialog
    const ready = screen.getAllByTestId('ready-row')
    expect(ready).toHaveLength(3)
    const wati = ready.find((r) => r.textContent?.includes('Bu Wati'))!
    const number = wati.getAttribute('data-order-number')!
    const wa = within(wati).getByRole('link', { name: 'Kabari Bu Wati lewat WhatsApp' }).getAttribute('href')!
    expect(wa).toMatch(/^https:\/\/wa\.me\/6281200000007\?text=/)
    expect(decodeURIComponent(wa)).toContain(`Pesanan ${number}`)
    expect(decodeURIComponent(wa)).toContain('sisa Rp 52.000')
    expect(within(wati).getByRole('link', { name: `Diambil ${number}` }).getAttribute('href')).toBe('/pesanan/demo-order-04?aksi=diambil')
    expect(wati.textContent).toContain('Sisa')

    // Terlambat: Lusi (promised 16 Oct) before Yoga (17 Oct)
    const late = screen.getAllByTestId('late-row')
    expect(late.map((r) => r.textContent?.includes('Lusi') ? 'Lusi' : 'Yoga')).toEqual(['Lusi', 'Yoga'])
    expect(late[0].textContent).toContain('Janji 16 Okt 2026 · terlambat 3 hari')

    // Belum bayar: largest first, each opening Terima pembayaran
    const unpaid = screen.getAllByTestId('unpaid-row')
    expect(unpaid).toHaveLength(4)
    expect(unpaid[0].textContent).toContain('Bu Wati')
    expect(within(unpaid[0]).getByRole('link').getAttribute('href')).toBe('/pesanan/demo-order-04?aksi=bayar')
    expect(screen.getByTestId('unpaid-card').textContent).toContain('Total Rp 151.000')

    // the chart (lazy) gets the 7-day series
    expect((await screen.findByTestId('money-chart')).textContent).toBe('82000,0,15000,0,18000,60000,18000')
    expect(screen.getByTestId('money-card').textContent).toContain('Total Rp 193.000')
    expect(screen.getByRole('link', { name: /Lihat laporan/ }).getAttribute('href')).toBe('/laporan')
  })

  it('staff: the same numbers, but no chart and no way to Laporan (SPEC 3.10)', async () => {
    setup(buildDemoDb(NOW), 'staff')
    await screen.findByTestId('tile-masuk')
    expect(tileValue('tile-uang-masuk')).toBe('Rp 18.000')
    expect(tile('tile-uang-masuk').tagName).toBe('DIV')
    expect(screen.getAllByTestId('ready-row')).toHaveLength(3)
    expect(screen.getAllByTestId('unpaid-row')).toHaveLength(4)
    expect(screen.queryByTestId('money-card')).toBeNull()
    expect(screen.queryByTestId('money-chart')).toBeNull()
    expect(screen.queryAllByRole('link').filter((a) => a.getAttribute('href') === '/laporan')).toEqual([])
  })

  it('a ready customer without a phone gets ➕ Nomor HP instead of WhatsApp', async () => {
    const db = buildDemoDb(NOW)
    const wati = db.customers.find((c) => c.name === 'Bu Wati')!
    wati.phone = null
    setup(db)
    const row = (await screen.findAllByTestId('ready-row')).find((r) => r.textContent?.includes('Bu Wati'))!
    expect(within(row).queryByRole('link', { name: /WhatsApp/ })).toBeNull()
    expect(within(row).getByRole('link', { name: 'Nomor HP Bu Wati belum diisi: isi sekarang' }).getAttribute('href')).toBe(`/pelanggan/${wati.id}?isi=hp`)
  })

  it('nothing late and nothing owed: no Terlambat card, a friendly Belum bayar', async () => {
    const db = buildDemoDb(NOW)
    db.orders = db.orders.filter((o) => o.status === 'done')
    setup(db)
    await screen.findByTestId('tile-masuk')
    expect(screen.queryByTestId('late-card')).toBeNull()
    expect(screen.getByText('Semua pesanan sudah lunas.')).toBeTruthy()
    expect(screen.getByText('Belum ada cucian yang siap diambil.')).toBeTruthy()
    expect(tileValue('tile-masuk')).toBe('0')
  })
})

describe('DashboardPage for a brand-new laundry', () => {
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  const fresh = (): LocalDb => {
    const db = emptyLocalDb()
    db.organizations.push({ id: DEMO_ORG_ID, name: 'Laundry Baru', created_by: 'u', created_at: '2026-10-19T00:00:00.000Z', promo_template: null, wa_footer: null })
    return db
  }

  it('owner: the three first-run steps instead of numbers, starting at the price list', async () => {
    setup(fresh())
    await screen.findByTestId('first-run')
    expect(screen.queryByTestId('tile-masuk')).toBeNull()
    expect(screen.getByText('Selamat datang di Laundry Baru 👋')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Atur daftar harga' }).getAttribute('href')).toBe('/harga')
    expect(screen.getByRole('link', { name: 'Tambah pelanggan' }).getAttribute('href')).toBe('/pelanggan?baru=1')
    expect(screen.getByRole('link', { name: 'Catat pesanan' }).getAttribute('href')).toBe('/pesanan/baru')
    // the big button stays
    expect(screen.getByRole('link', { name: 'Pesanan baru' })).toBeTruthy()
  })

  it('staff: the price list is the owner’s step (no link); a step already done is ticked off', async () => {
    const db = fresh()
    db.customers.push({ id: 'c1', org_id: DEMO_ORG_ID, name: 'Rina', phone: null, is_tenant: false, room_name: null, kos_tenant_id: null, address: null, notes: null, created_at: '2026-10-19T00:00:00.000Z', updated_at: '2026-10-19T00:00:00.000Z' })
    setup(db, 'staff')
    await screen.findByTestId('first-run')
    expect(screen.queryByRole('link', { name: 'Atur daftar harga' })).toBeNull()
    expect(screen.getByText('Daftar harga diatur oleh pemilik atau admin.')).toBeTruthy()
    expect(screen.getByTestId('first-run-pelanggan').getAttribute('data-done')).toBe('1')
    expect(screen.queryByRole('link', { name: 'Tambah pelanggan' })).toBeNull()
    await waitFor(() => expect(screen.getByRole('link', { name: 'Catat pesanan' }).getAttribute('href')).toBe('/pesanan/baru'))
  })
})
