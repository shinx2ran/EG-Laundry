import { Link } from 'react-router'
import { clsx } from 'clsx'
import { ArrowRight, CircleCheck } from 'lucide-react'
import type { FirstRunKey, FirstRunStep } from './dashboardModel'

interface StepText {
  title: string
  description: string
  /** shown to staff instead of the description when the step is for the owner/admin */
  staffNote?: string
  to: string
  cta: string
  adminOnly?: boolean
}

const STEP_TEXT: Record<FirstRunKey, StepText> = {
  harga: {
    title: 'Atur daftar harga',
    description: 'Isi layanan dengan harga per kg atau per potong, harga express dan lama pengerjaan.',
    staffNote: 'Daftar harga diatur oleh pemilik atau admin.',
    to: '/harga',
    cta: 'Atur daftar harga',
    adminOnly: true,
  },
  pelanggan: {
    title: 'Tambah pelanggan',
    description: 'Anak kos dan pelanggan umum; nomor HP dipakai untuk pesan WhatsApp.',
    to: '/pelanggan?baru=1',
    cta: 'Tambah pelanggan',
  },
  pesanan: {
    title: 'Catat pesanan pertama',
    description: 'Pilih pelanggan, layanan dan beratnya; struk bisa langsung dikirim lewat WhatsApp.',
    to: '/pesanan/baru',
    cta: 'Catat pesanan',
  },
}

/**
 * A brand-new laundry (no orders yet) sees three steps instead of empty numbers: 1) Atur daftar harga (owner/admin;
 * staff read that it is theirs to do), 2) Tambah pelanggan, 3) Catat pesanan pertama. Done steps are ticked off.
 */
export function FirstRunCard({ steps, isAdmin, laundryName }: { steps: FirstRunStep[]; isAdmin: boolean; laundryName: string }) {
  const nextIndex = steps.findIndex((s) => !s.done)
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" data-testid="first-run">
      <div className="bg-gradient-to-br from-brand-700 to-brand-900 px-5 py-5 text-white">
        <h2 className="text-lg font-semibold">{`Selamat datang di ${laundryName} 👋`}</h2>
        <p className="mt-1 text-sm text-brand-100">Belum ada pesanan. Tiga langkah singkat dan dashboard ini mulai menghitung cucian dan uang masuk Anda.</p>
      </div>
      <ol className="divide-y divide-slate-100">
        {steps.map((step, i) => {
          const text = STEP_TEXT[step.key]
          const isNext = i === nextIndex
          const canDo = !text.adminOnly || isAdmin
          return (
            <li key={step.key} data-testid={`first-run-${step.key}`} data-done={step.done ? '1' : '0'} className={clsx('flex items-start gap-3 px-4 py-4', isNext && 'bg-brand-50/60')}>
              <span
                className={clsx(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                  step.done ? 'bg-emerald-100 text-emerald-700' : isNext ? 'bg-brand-700 text-white' : 'bg-slate-100 text-slate-500',
                )}
              >
                {step.done ? <CircleCheck className="h-5 w-5" aria-label="Selesai" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className={clsx('text-sm font-semibold', step.done ? 'text-slate-500 line-through' : 'text-slate-900')}>{text.title}</h3>
                <p className="mt-0.5 text-xs text-slate-500">{canDo ? text.description : (text.staffNote ?? text.description)}</p>
                {!step.done && canDo && (
                  <Link
                    to={text.to}
                    className={clsx(
                      'mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium',
                      isNext ? 'bg-brand-700 text-white hover:bg-brand-800' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {text.cta}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
