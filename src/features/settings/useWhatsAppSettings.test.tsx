// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MemberRole } from '../../types/db'
import { LocalRepo } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import { buildDemoDb, DEMO_ORG_ID } from '../../lib/repo/demoSeed'
import { ERR_PROMO_TOO_LONG, PROMO_MAX_LENGTH } from './whatsappTexts'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'owner' }

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: DEMO_ORG_ID, name: 'EG Laundry (Demo)' }, repo: state.repo, role: state.role, isAdmin: state.role !== 'staff', isLocalMode: true }),
}))

import { STAFF_WHATSAPP_MESSAGE, useWhatsAppSettings } from './useWhatsAppSettings'

let repo: OrgRepo
let qc: QueryClient

function setup(role: MemberRole) {
  repo = bindOrg(new LocalRepo(buildDemoDb(new Date(2026, 9, 20))), DEMO_ORG_ID)
  state.repo = repo
  state.role = role
  qc = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  return renderHook(() => useWhatsAppSettings(), { wrapper }).result.current
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('useWhatsAppSettings', () => {
  it('owner saves both texts on the organisation and refreshes the membership (useOrg)', async () => {
    const actions = setup('owner')
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    expect(actions.canEdit).toBe(true)
    await actions.saveTexts({ promoTemplate: ' Halo {nama}! Diskon 10%. ', footer: 'Buka 07.00-21.00\nQRIS di kasir' })
    expect(await repo.raw.get('organizations', DEMO_ORG_ID)).toMatchObject({ promo_template: 'Halo {nama}! Diskon 10%.', wa_footer: 'Buka 07.00-21.00\nQRIS di kasir' })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['membership'] })
    // clearing both stores null
    await actions.saveTexts({ promoTemplate: '', footer: '  ' })
    expect(await repo.raw.get('organizations', DEMO_ORG_ID)).toMatchObject({ promo_template: null, wa_footer: null })
  })

  it('staff is refused before any write; a too long text too', async () => {
    const staff = setup('staff')
    const update = vi.spyOn(repo.raw, 'update')
    expect(staff.canEdit).toBe(false)
    await expect(staff.saveTexts({ promoTemplate: 'Halo {nama}', footer: '' })).rejects.toThrow(STAFF_WHATSAPP_MESSAGE)
    const admin = setup('admin')
    const adminUpdate = vi.spyOn(repo.raw, 'update')
    await expect(admin.saveTexts({ promoTemplate: 'x'.repeat(PROMO_MAX_LENGTH + 1), footer: '' })).rejects.toThrow(ERR_PROMO_TOO_LONG)
    expect(update).not.toHaveBeenCalled()
    expect(adminUpdate).not.toHaveBeenCalled()
  })
})
