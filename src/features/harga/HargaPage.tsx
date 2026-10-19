import { EmptyState, PageHeader } from '../../components/ui'

/** Placeholder: the laundry module for this page is built next (SPEC section 3). */
export function HargaPage() {
  return (
    <>
      <PageHeader title="Daftar harga" subtitle="Layanan per kg, per potong, express, dan paket" />
      <EmptyState title="Segera hadir" description="Daftar layanan dan harganya akan tampil di sini." />
    </>
  )
}
