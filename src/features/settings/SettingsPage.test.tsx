// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import { ToastProvider } from '../../components/ui'
import type { MemberRole } from '../../types/db'
import { LocalRepo } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import { buildDemoDb, DEMO_ORG_ID } from '../../lib/repo/demoSeed'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'staff' }

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({
    org: { id: DEMO_ORG_ID, name: 'EG Laundry', created_by: 'u1', created_at: '2026-10-20T00:00:00.000Z', promo_template: null, wa_footer: null },
    repo: state.repo,
    role: state.role,
    isAdmin: state.role !== 'staff',
    isLocalMode: false,
    resetDemoData: async () => undefined,
  }),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ auth: { signOut: async () => undefined }, session: { user: { id: 'me', email: 'kasir@contoh.id' } } }),
}))

import { SettingsPage } from './SettingsPage'

// jsdom has no matchMedia (InstallCard asks whether the app runs installed)
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('SettingsPage', () => {
  it('staff do not see the Anggota card (members and their emails; SPEC 3.10)', async () => {
    state.repo = bindOrg(new LocalRepo(buildDemoDb(new Date(2026, 9, 20))), DEMO_ORG_ID)
    state.role = 'staff'
    render(<SettingsPage />, { wrapper })
    expect(await screen.findByRole('heading', { name: 'Pengaturan' })).toBeTruthy()
    expect(screen.getByText('Daftar harga')).toBeTruthy()
    expect(screen.queryByText('Anggota')).toBeNull()
  })

  it('owner and admin do', async () => {
    state.repo = bindOrg(new LocalRepo(buildDemoDb(new Date(2026, 9, 20))), DEMO_ORG_ID)
    state.role = 'admin'
    render(<SettingsPage />, { wrapper })
    expect(await screen.findByText('Anggota')).toBeTruthy()
  })
})
