import { describe, expect, it } from 'vitest'
import { itemsSummary, promoText, readyText, receiptText } from './messages'

const items = [
  { service_name: 'Cuci setrika', qty: 2.5, unit: 'kg' as const },
  { service_name: 'Bed cover', qty: 1, unit: 'pcs' as const },
]

describe('WhatsApp texts (SPEC 3.9)', () => {
  it('lists the items with Indonesian quantities', () => {
    expect(itemsSummary(items)).toBe('Cuci setrika 2,5 kg, Bed cover 1 pcs')
  })

  it('receipt: order, items, total, optional DP, estimate and footer', () => {
    const base = { customerName: 'Rina Putri', laundryName: 'EG Laundry', orderNumber: 'LD-202610-0007', receivedAt: '2026-10-19', items, total: 45_000, promisedAt: '2026-10-22' }
    expect(receiptText(base)).toBe(
      'Halo Rina Putri, terima kasih sudah mencuci di EG Laundry. Pesanan LD-202610-0007 (19 Okt 2026): Cuci setrika 2,5 kg, Bed cover 1 pcs. Total Rp 45.000. Perkiraan selesai 22 Okt 2026.',
    )
    expect(receiptText({ ...base, dp: 20_000, footer: ' Buka 07.00-21.00 ' })).toBe(
      'Halo Rina Putri, terima kasih sudah mencuci di EG Laundry. Pesanan LD-202610-0007 (19 Okt 2026): Cuci setrika 2,5 kg, Bed cover 1 pcs. Total Rp 45.000, DP Rp 20.000. Perkiraan selesai 22 Okt 2026.\nBuka 07.00-21.00',
    )
    expect(receiptText({ ...base, dp: 0, promisedAt: null, footer: '  ' })).toBe(
      'Halo Rina Putri, terima kasih sudah mencuci di EG Laundry. Pesanan LD-202610-0007 (19 Okt 2026): Cuci setrika 2,5 kg, Bed cover 1 pcs. Total Rp 45.000.',
    )
  })

  it('ready: lunas or the remaining amount, plus footer', () => {
    const base = { customerName: 'Pak Hendra', laundryName: 'EG Laundry', orderNumber: 'LD-202610-0008', items, total: 45_000 }
    expect(readyText({ ...base, outstanding: 0 })).toBe(
      'Halo Pak Hendra, cucian Anda di EG Laundry sudah siap diambil 😊 Pesanan LD-202610-0008: Cuci setrika 2,5 kg, Bed cover 1 pcs · Total Rp 45.000 (lunas).',
    )
    expect(readyText({ ...base, outstanding: 25_000, footer: 'Jl. Melati 12' })).toBe(
      'Halo Pak Hendra, cucian Anda di EG Laundry sudah siap diambil 😊 Pesanan LD-202610-0008: Cuci setrika 2,5 kg, Bed cover 1 pcs · Total Rp 45.000 (sisa Rp 25.000).\nJl. Melati 12',
    )
  })

  it('promo: fills {nama} everywhere, empty without a template', () => {
    expect(promoText('Halo {nama}, ada diskon untuk {NAMA}!', ' Sari ')).toBe('Halo Sari, ada diskon untuk Sari!')
    expect(promoText('Tanpa nama', 'Sari')).toBe('Tanpa nama')
    expect(promoText(null, 'Sari')).toBe('')
    expect(promoText('   ', 'Sari')).toBe('')
  })
})
