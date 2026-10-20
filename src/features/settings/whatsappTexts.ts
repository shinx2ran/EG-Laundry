/**
 * Pengaturan → Pesan WhatsApp (SPEC 3.7, 3.9): the promo template and the footer stored on the organisation,
 * and the live preview built with the real message functions of src/domain/messages.ts for a sample customer.
 * Pure; the card and useWhatsAppSettings do the I/O.
 */
import type { Organization } from '../../types/db'
import { promoText, readyText } from '../../domain/messages'

/** The card's element id: /pengaturan#pesan-whatsapp opens Pengaturan scrolled to it (Laporan's promo hint). */
export const WHATSAPP_CARD_ID = 'pesan-whatsapp'

export const PROMO_PLACEHOLDER = 'Halo {nama}! Minggu ini cuci setrika diskon 10% di EG Laundry. Berlaku s/d Minggu.'
export const FOOTER_PLACEHOLDER = 'Buka setiap hari 07.00-21.00 · Jl. Contoh No. 1 · Transfer/QRIS: BCA 1234567890 a.n. EG Laundry'
/** the sample customer of the preview */
export const PREVIEW_CUSTOMER = 'Budi'
export const PROMO_MAX_LENGTH = 1000
export const FOOTER_MAX_LENGTH = 300

export const ERR_PROMO_TOO_LONG = `Template promo maksimal ${PROMO_MAX_LENGTH} karakter.`
export const ERR_FOOTER_TOO_LONG = `Footer maksimal ${FOOTER_MAX_LENGTH} karakter.`

export interface WhatsAppTexts {
  promoTemplate: string
  footer: string
}

/** Form values from the organisation row (null -> ''). */
export function whatsAppTextsOf(org: Pick<Organization, 'promo_template' | 'wa_footer'>): WhatsAppTexts {
  return { promoTemplate: org.promo_template ?? '', footer: org.wa_footer ?? '' }
}

/** Windows line breaks from a pasted text, trailing spaces and blank edges removed; '' = not set. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .trim()
}

/** The organisations patch: trimmed texts, blank -> null (not set). */
export function whatsAppPatch(values: WhatsAppTexts): Pick<Organization, 'promo_template' | 'wa_footer'> {
  const promo = tidy(values.promoTemplate)
  const footer = tidy(values.footer)
  return { promo_template: promo || null, wa_footer: footer || null }
}

/** True when saving would change the stored texts. */
export function whatsAppChanged(values: WhatsAppTexts, org: Pick<Organization, 'promo_template' | 'wa_footer'>): boolean {
  const patch = whatsAppPatch(values)
  return patch.promo_template !== (org.promo_template ?? null) || patch.wa_footer !== (org.wa_footer ?? null)
}

/** Why the texts cannot be saved, or null. */
export function validateWhatsAppTexts(values: WhatsAppTexts): string | null {
  const patch = whatsAppPatch(values)
  if ((patch.promo_template ?? '').length > PROMO_MAX_LENGTH) return ERR_PROMO_TOO_LONG
  if ((patch.wa_footer ?? '').length > FOOTER_MAX_LENGTH) return ERR_FOOTER_TOO_LONG
  return null
}

/** Hints under the template: it should greet by {nama}, and other {…} markers are not filled in. */
export function templateNotes(template: string): string[] {
  const t = template.trim()
  if (!t) return []
  const notes: string[] = []
  if (!/\{nama\}/i.test(t)) notes.push('Tambahkan {nama} supaya pesan menyapa pelanggan dengan namanya.')
  const unknown = new Set<string>()
  for (const m of t.matchAll(/\{([^{}\s]{1,30})\}/g)) if (m[1].toLowerCase() !== 'nama') unknown.add(`{${m[1]}}`)
  for (const marker of unknown) notes.push(`Penanda ${marker} tidak dikenal; hanya {nama} yang diganti.`)
  return notes
}

export interface WhatsAppPreview {
  /** '' while no template is set (the promo buttons then have nothing to send) */
  promo: string
  /** the "siap diambil" message of a sample paid order, with the footer */
  ready: string
}

/**
 * The messages as customer Budi would receive them, through promoText/readyText. `todayISO` only shapes the
 * sample order number (LD-YYYYMM-0007).
 */
export function whatsAppPreview(input: { laundryName: string; values: WhatsAppTexts; todayISO: string }): WhatsAppPreview {
  const patch = whatsAppPatch(input.values)
  const month = input.todayISO.slice(0, 7).replace('-', '')
  return {
    promo: promoText(patch.promo_template, PREVIEW_CUSTOMER),
    ready: readyText({
      customerName: PREVIEW_CUSTOMER,
      laundryName: input.laundryName,
      orderNumber: `LD-${month}-0007`,
      items: [{ service_name: 'Cuci setrika', qty: 3, unit: 'kg' }],
      total: 24_000,
      outstanding: 0,
      footer: patch.wa_footer,
    }),
  }
}
