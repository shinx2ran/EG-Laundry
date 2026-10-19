import { EmptyState, PageHeader } from '../../components/ui'

/** Placeholder: the laundry module for this page is built next (SPEC section 3). */
export function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Ringkasan hari ini" />
      <EmptyState title="Segera hadir" description="Ringkasan cucian masuk, siap diambil, dan belum bayar akan tampil di sini." />
    </>
  )
}
