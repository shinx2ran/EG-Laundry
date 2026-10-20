/**
 * Saving the promo template and the WhatsApp footer (SPEC 3.7, 3.9) on the organisation, the same way the
 * Laundry card saves the name: repo.raw.update('organizations'), then the membership query is refreshed so
 * every screen (Laporan, Pesanan) gets the new texts from useOrg. Owner/admin only (RLS org_update online).
 */
import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useOrg } from '../../hooks/useOrg'
import { validateWhatsAppTexts, whatsAppPatch, type WhatsAppTexts } from './whatsappTexts'

export const STAFF_WHATSAPP_MESSAGE = 'Hanya pemilik/admin yang dapat mengubah pesan WhatsApp.'

export function useWhatsAppSettings() {
  const { org, repo, role } = useOrg()
  const qc = useQueryClient()

  return useMemo(() => {
    const canEdit = role === 'owner' || role === 'admin'

    async function saveTexts(values: WhatsAppTexts): Promise<void> {
      if (!canEdit) throw new Error(STAFF_WHATSAPP_MESSAGE)
      const problem = validateWhatsAppTexts(values)
      if (problem) throw new Error(problem)
      await repo.raw.update('organizations', org.id, whatsAppPatch(values))
      await qc.invalidateQueries({ queryKey: ['membership'] })
    }

    return { canEdit, saveTexts }
  }, [org.id, repo, role, qc])
}
