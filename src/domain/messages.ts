/**
 * Indonesian WhatsApp texts (SPEC 3.9). Pure functions: the UI passes names and figures and opens
 * wa.me through whatsappLink(). A footer (organizations.wa_footer) is appended on its own line when set.
 */
import type { Unit } from '../types/db'
import { formatDate, formatQty, formatRupiah } from '../lib/format'

export interface MessageItem {
  service_name: string
  qty: number
  unit: Unit
}

/** 'Cuci setrika 2,5 kg, Bed cover 1 pcs' */
export function itemsSummary(items: MessageItem[]): string {
  return items.map((it) => `${it.service_name} ${formatQty(it.qty, it.unit)}`).join(', ')
}

function withFooter(text: string, footer: string | null | undefined): string {
  const f = footer?.trim()
  return f ? `${text}\n${f}` : text
}

export interface ReceiptInput {
  customerName: string
  laundryName: string
  orderNumber: string
  /** 'YYYY-MM-DD' */
  receivedAt: string
  items: MessageItem[]
  total: number
  /** down payment taken with the order; 0/undefined = none */
  dp?: number
  /** 'YYYY-MM-DD'; omitted when unknown */
  promisedAt?: string | null
  footer?: string | null
}

/**
 * Intake receipt: "Halo {nama}, terima kasih sudah mencuci di {laundry}. Pesanan {nomor} ({tgl masuk}):
 * {daftar item}. Total Rp X{, DP Rp Y}. Perkiraan selesai {tgl}." + footer.
 */
export function receiptText(input: ReceiptInput): string {
  const dp = input.dp && input.dp > 0 ? `, DP ${formatRupiah(input.dp)}` : ''
  const parts = [
    `Halo ${input.customerName.trim()}, terima kasih sudah mencuci di ${input.laundryName}.`,
    `Pesanan ${input.orderNumber} (${formatDate(input.receivedAt)}): ${itemsSummary(input.items)}.`,
    `Total ${formatRupiah(input.total)}${dp}.`,
  ]
  if (input.promisedAt) parts.push(`Perkiraan selesai ${formatDate(input.promisedAt)}.`)
  return withFooter(parts.join(' '), input.footer)
}

export interface ReadyInput {
  customerName: string
  laundryName: string
  orderNumber: string
  items: MessageItem[]
  total: number
  /** what is still owed; 0 = lunas */
  outstanding: number
  footer?: string | null
}

/**
 * Ready for pickup: "Halo {nama}, cucian Anda di {laundry} sudah siap diambil 😊 Pesanan {nomor}:
 * {daftar item} · Total Rp X ({lunas | sisa Rp Y})." + footer.
 */
export function readyText(input: ReadyInput): string {
  const pay = input.outstanding > 0 ? `sisa ${formatRupiah(input.outstanding)}` : 'lunas'
  const text = `Halo ${input.customerName.trim()}, cucian Anda di ${input.laundryName} sudah siap diambil 😊 Pesanan ${input.orderNumber}: ${itemsSummary(input.items)} · Total ${formatRupiah(input.total)} (${pay}).`
  return withFooter(text, input.footer)
}

/** Promo: the organisation's template with every `{nama}` replaced; null/empty template -> ''. */
export function promoText(template: string | null | undefined, customerName: string): string {
  const t = template?.trim()
  if (!t) return ''
  return t.replace(/\{nama\}/gi, customerName.trim())
}
