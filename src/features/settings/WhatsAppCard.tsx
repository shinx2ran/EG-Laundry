import { useState, type FormEvent } from 'react'
import { MessageCircle } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, Textarea, useToast } from '../../components/ui'
import { useOrg } from '../../hooks/useOrg'
import { todayISO } from '../../lib/format'
import type { Organization } from '../../types/db'
import { useWhatsAppSettings } from './useWhatsAppSettings'
import {
  FOOTER_MAX_LENGTH,
  FOOTER_PLACEHOLDER,
  PREVIEW_CUSTOMER,
  PROMO_MAX_LENGTH,
  PROMO_PLACEHOLDER,
  templateNotes,
  WHATSAPP_CARD_ID,
  whatsAppChanged,
  whatsAppPreview,
  whatsAppTextsOf,
} from './whatsappTexts'

// ---------------------------------------------------------------- Pesan WhatsApp (owner/admin)

/** The form starts again from the stored texts whenever they change (after a save, or on another phone). */
export function WhatsAppCard() {
  const { org } = useOrg()
  return <WhatsAppForm key={`${org.id}\u0000${org.promo_template ?? ''}\u0000${org.wa_footer ?? ''}`} org={org} />
}

function Bubble({ title, text, empty, testId }: { title: string; text: string; empty: string; testId: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <p
        data-testid={testId}
        className={
          text
            ? 'whitespace-pre-wrap break-words rounded-lg rounded-tl-none border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-slate-800'
            : 'rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500'
        }
      >
        {text || empty}
      </p>
    </div>
  )
}

function WhatsAppForm({ org }: { org: Organization }) {
  const { saveTexts } = useWhatsAppSettings()
  const toast = useToast()
  const [values, setValues] = useState(() => whatsAppTextsOf(org))
  const [saving, setSaving] = useState(false)

  const preview = whatsAppPreview({ laundryName: org.name, values, todayISO: todayISO() })
  const notes = templateNotes(values.promoTemplate)
  const changed = whatsAppChanged(values, org)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await saveTexts(values)
      toast.success('Pesan WhatsApp disimpan.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal menyimpan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card id={WHATSAPP_CARD_ID} className="scroll-mt-20">
      <CardHeader title="Pesan WhatsApp" subtitle="Template promo dan footer setiap pesan" action={<MessageCircle className="h-5 w-5 text-slate-400" />} />
      <CardBody>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1">
            <Textarea
              label="Template promo"
              value={values.promoTemplate}
              onChange={(e) => setValues((v) => ({ ...v, promoTemplate: e.target.value }))}
              placeholder={PROMO_PLACEHOLDER}
              hint="{nama} diganti nama pelanggan. Dipakai tombol Kirim promo di Laporan."
              maxLength={PROMO_MAX_LENGTH}
              rows={4}
            />
            {notes.map((n) => (
              <p key={n} className="text-xs text-amber-700">
                {n}
              </p>
            ))}
          </div>
          <Textarea
            label="Footer pesan"
            value={values.footer}
            onChange={(e) => setValues((v) => ({ ...v, footer: e.target.value }))}
            placeholder={FOOTER_PLACEHOLDER}
            hint="Ditambahkan di bawah struk dan pesan siap diambil: jam buka, alamat, rekening/QRIS."
            maxLength={FOOTER_MAX_LENGTH}
            rows={3}
          />
          <section aria-label="Pratinjau pesan" className="space-y-3 rounded-lg bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-900">Pratinjau untuk pelanggan {PREVIEW_CUSTOMER}</p>
            <Bubble title="Promo" text={preview.promo} empty="Template promo belum diisi." testId="preview-promo" />
            <Bubble title="Cucian siap diambil" text={preview.ready} empty="" testId="preview-ready" />
          </section>
          <Button type="submit" loading={saving} disabled={!changed} className="min-h-11">
            Simpan pesan
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
