import { describe, expect, it } from 'vitest'
import {
  ERR_FOOTER_TOO_LONG,
  ERR_PROMO_TOO_LONG,
  FOOTER_MAX_LENGTH,
  PROMO_MAX_LENGTH,
  PROMO_PLACEHOLDER,
  templateNotes,
  validateWhatsAppTexts,
  whatsAppChanged,
  whatsAppPatch,
  whatsAppPreview,
  whatsAppTextsOf,
} from './whatsappTexts'

const TODAY = '2026-10-20'

describe('whatsAppPreview', () => {
  it('shows the promo for Budi and the ready message with the footer', () => {
    const p = whatsAppPreview({
      laundryName: 'EG Laundry',
      values: { promoTemplate: PROMO_PLACEHOLDER, footer: 'Buka 07.00-21.00' },
      todayISO: TODAY,
    })
    expect(p.promo).toBe('Halo Budi! Minggu ini cuci setrika diskon 10% di EG Laundry. Berlaku s/d Minggu.')
    expect(p.ready).toBe(
      'Halo Budi, cucian Anda di EG Laundry sudah siap diambil 😊 Pesanan LD-202610-0007: Cuci setrika 3 kg · Total Rp 24.000 (lunas).\nBuka 07.00-21.00',
    )
  })

  it('replaces every {nama} in any case; an empty template gives no promo; no footer, no extra line', () => {
    const p = whatsAppPreview({ laundryName: 'EG', values: { promoTemplate: '  {NAMA}, halo {nama}!  ', footer: '   ' }, todayISO: '2027-01-05' })
    expect(p.promo).toBe('Budi, halo Budi!')
    expect(p.ready).toContain('Pesanan LD-202701-0007')
    expect(p.ready).not.toContain('\n')
    expect(whatsAppPreview({ laundryName: 'EG', values: { promoTemplate: ' \n ', footer: '' }, todayISO: TODAY }).promo).toBe('')
  })

  it('keeps line breaks of a multi-line footer', () => {
    const p = whatsAppPreview({ laundryName: 'EG', values: { promoTemplate: '', footer: 'Jam buka 07-21\r\nQRIS di kasir  ' }, todayISO: TODAY })
    expect(p.ready.endsWith('(lunas).\nJam buka 07-21\nQRIS di kasir')).toBe(true)
  })
})

describe('whatsAppPatch / whatsAppChanged / whatsAppTextsOf', () => {
  it('trims, turns blanks into null and Windows line breaks into \\n', () => {
    expect(whatsAppPatch({ promoTemplate: '  Halo {nama}\r\nDiskon!  ', footer: '  ' })).toEqual({ promo_template: 'Halo {nama}\nDiskon!', wa_footer: null })
  })

  it('compares with the stored texts after tidying', () => {
    const org = { promo_template: 'Halo {nama}', wa_footer: null }
    expect(whatsAppTextsOf(org)).toEqual({ promoTemplate: 'Halo {nama}', footer: '' })
    expect(whatsAppChanged({ promoTemplate: ' Halo {nama} ', footer: ' ' }, org)).toBe(false)
    expect(whatsAppChanged({ promoTemplate: 'Halo {nama}!', footer: '' }, org)).toBe(true)
    expect(whatsAppChanged({ promoTemplate: 'Halo {nama}', footer: 'Buka' }, org)).toBe(true)
    expect(whatsAppChanged({ promoTemplate: '', footer: '' }, { promo_template: null, wa_footer: null })).toBe(false)
  })
})

describe('validateWhatsAppTexts / templateNotes', () => {
  it('limits the lengths', () => {
    expect(validateWhatsAppTexts({ promoTemplate: 'a'.repeat(PROMO_MAX_LENGTH), footer: 'b'.repeat(FOOTER_MAX_LENGTH) })).toBeNull()
    expect(validateWhatsAppTexts({ promoTemplate: 'a'.repeat(PROMO_MAX_LENGTH + 1), footer: '' })).toBe(ERR_PROMO_TOO_LONG)
    expect(validateWhatsAppTexts({ promoTemplate: '', footer: 'b'.repeat(FOOTER_MAX_LENGTH + 1) })).toBe(ERR_FOOTER_TOO_LONG)
  })

  it('asks for {nama} and names markers that are not filled in', () => {
    expect(templateNotes('')).toEqual([])
    expect(templateNotes(PROMO_PLACEHOLDER)).toEqual([])
    expect(templateNotes('Diskon 10%!')).toEqual(['Tambahkan {nama} supaya pesan menyapa pelanggan dengan namanya.'])
    expect(templateNotes('Halo {Nama}, kamar {kamar} dan {name} {kamar}')).toEqual([
      'Penanda {kamar} tidak dikenal; hanya {nama} yang diganti.',
      'Penanda {name} tidak dikenal; hanya {nama} yang diganti.',
    ])
  })
})
