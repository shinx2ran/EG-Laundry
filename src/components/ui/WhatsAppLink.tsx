import type { AnchorHTMLAttributes, ReactNode } from 'react'
import { clsx } from 'clsx'
import { MessageCircle } from 'lucide-react'

/**
 * The green WhatsApp button (a wa.me link, usually with the text already filled in): struk, siap diambil, Kirim promo,
 * chat with a customer. 44 px tall; opens WhatsApp in a new tab. Build the href with whatsappLink (src/lib/format);
 * without a phone number show MissingPhoneLink (src/features/pelanggan) instead.
 */
export function WhatsAppLink({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel' | 'children' | 'className'>) {
  return (
    <a
      {...rest}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2',
        className,
      )}
    >
      <MessageCircle className="h-4 w-4 shrink-0" aria-hidden />
      {children}
    </a>
  )
}
