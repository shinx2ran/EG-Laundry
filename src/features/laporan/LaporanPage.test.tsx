// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { ToastProvider } from '../../components/ui'
import { LocalRepo } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import { buildDemoDb, DEMO_ORG_ID } from '../../lib/repo/demoSeed'
import type { MemberRole } from '../../types/db'

const state: { repo: OrgRepo | null; role: MemberRole; template: string | null } = { repo: null, role: 'owner', template: null }

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({
    org: { id: DEMO_ORG_ID, name: 'EG Laundry (Demo)', promo_template: state.template, wa_footer: null },
    repo: state.repo,
    role: state.role,
    isAdmin: state.role !== 'staff',
    isLocalMode: true,
  }),
}))
// recharts needs a real layout engine; the chart itself is not what is tested here
vi.mock('./UangMasukChart', () => ({ UangMasukChart: () => <div data-testid="chart-stub" /> }))

import { LaporanPage } from './LaporanPage'
import { LAMA_STORAGE_KEY } from './lamaSetting'

const NOW = new Date(2026, 9, 20, 10, 0, 0)

function setup({ role = 'owner', template = 'Halo {nama}, ada promo!', url = '/laporan' }: { role?: MemberRole; template?: string | null; url?: string } = {}) {
  state.role = role
  state.template = template
  state.repo = bindOrg(new LocalRepo(buildDemoDb(NOW)), DEMO_ORG_ID)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <LaporanPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('LaporanPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    localStorage.clear()
  })

  it('staff only see that reports are for the owner/admin', () => {
    setup({ role: 'staff' })
    expect(screen.getByText('Laporan hanya untuk pemilik/admin.')).toBeTruthy()
    expect(screen.queryByTestId('tile-uang-masuk')).toBeNull()
    expect(screen.queryByText('Unduh XLSX')).toBeNull()
  })

  it('Bulan ini: uang masuk, orders per service, anak kos vs umum and Kirim promo per customer', async () => {
    setup()
    const tile = await screen.findByTestId('tile-uang-masuk')
    expect(Number(tile.getAttribute('data-amount'))).toBeGreaterThan(0)
    expect(screen.getByText('1 Okt 2026 – 31 Okt 2026')).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Bulan ini' }).getAttribute('aria-checked')).toBe('true')
    // view-only controls: choosing a period or a filter is not unsaved work (dirtyState)
    expect(screen.getByRole('radio', { name: 'Bulan ini' }).closest('[data-dirty-ignore]')).not.toBeNull()
    expect(screen.getAllByTestId('service-row').length).toBeGreaterThan(0)
    const orders = screen.getByTestId('split-orders')
    expect(Number(orders.getAttribute('data-tenant-pct'))).toBeGreaterThan(0)
    expect(Number(orders.getAttribute('data-tenant-pct')) + Number(orders.getAttribute('data-walkin-pct'))).toBe(100)

    // every demo customer is listed; the promo text carries the name
    const rows = screen.getAllByTestId('report-customer')
    expect(rows).toHaveLength(12)
    const rina = rows.find((r) => r.getAttribute('data-name') === 'Rina Putri')!
    const link = within(rina).getByRole('link', { name: 'Kirim promo ke Rina Putri' })
    expect(link.getAttribute('href')).toBe(`https://wa.me/6281200000001?text=${encodeURIComponent('Halo Rina Putri, ada promo!')}`)
    // no phone: the amber link to the customer's form
    const mega = rows.find((r) => r.getAttribute('data-name') === 'Mega')!
    expect(within(mega).getByRole('link', { name: 'Nomor HP Mega belum diisi: isi sekarang' })).toBeTruthy()
    expect(screen.queryByTestId('promo-hint')).toBeNull()

    // Anak kos filter
    fireEvent.click(screen.getByRole('radio', { name: /^Anak kos/ }))
    await waitFor(() => expect(screen.getAllByTestId('report-customer')).toHaveLength(5))
  })

  it('Lama tidak datang: N is adjustable and remembered on this phone', async () => {
    setup({ url: '/laporan?tab=lama' })
    await screen.findByTestId('absent-card')
    const input = screen.getByLabelText('Batas hari tidak datang') as HTMLInputElement
    expect(input.value).toBe('21')
    expect(input.closest('[data-dirty-ignore]')).not.toBeNull()
    // Nabila's last visit in the demo is 28 days ago
    expect(screen.getAllByTestId('absent-customer').map((r) => r.getAttribute('data-name'))).toContain('Nabila Zahra')
    fireEvent.change(input, { target: { value: '7' } })
    expect(localStorage.getItem(LAMA_STORAGE_KEY)).toBe('7')
    const rows = screen.getAllByTestId('absent-customer')
    const days = rows.map((r) => Number(r.getAttribute('data-days')))
    expect(days.every((d) => d > 7)).toBe(true)
    expect([...days].sort((a, b) => b - a)).toEqual(days)
    fireEvent.change(input, { target: { value: '60' } })
    expect(screen.getByText('Tidak ada pelanggan yang lebih dari 60 hari tidak datang.')).toBeTruthy()
  })

  it('without a promo template: a hint to Pengaturan, Kirim promo opens a blank chat', async () => {
    setup({ template: '  ' })
    const hint = await screen.findByTestId('promo-hint')
    expect(within(hint).getByRole('link', { name: 'Isi di Pengaturan' }).getAttribute('href')).toBe('/pengaturan')
    expect(screen.getByRole('link', { name: 'Kirim promo ke Rina Putri' }).getAttribute('href')).toBe('https://wa.me/6281200000001')
  })

  it('Khusus: the dates come from the URL and a reversed pair is refused', async () => {
    setup({ url: '/laporan?periode=khusus&dari=2026-09-01&sampai=2026-09-30' })
    await screen.findByTestId('tile-uang-masuk')
    expect(screen.getByText('1 Sep 2026 – 30 Sep 2026')).toBeTruthy()
    const from = screen.getByLabelText('Tanggal awal') as HTMLInputElement
    expect(from.value).toBe('2026-09-01')
    fireEvent.change(from, { target: { value: '2026-10-05' } })
    expect(screen.getByText('Tanggal awal harus sebelum tanggal akhir.')).toBeTruthy()
    expect(screen.getByText('1 Sep 2026 – 30 Sep 2026')).toBeTruthy()
    fireEvent.change(from, { target: { value: '2026-09-15' } })
    await waitFor(() => expect(screen.getByText('15 Sep 2026 – 30 Sep 2026')).toBeTruthy())
    // a finished range: piutang as it stood on its last day
    expect(screen.getByText('Belum dibayar, per 30 Sep 2026')).toBeTruthy()
  })
})
