import { EmptyState, PageHeader } from '../../components/ui'

/** Placeholder: the laundry module for this page is built next (SPEC section 3). */
export function PelangganPage() {
  return (
    <>
      <PageHeader title="Pelanggan" subtitle="Anak kos EG Kost dan pelanggan umum" />
      <EmptyState title="Segera hadir" description="Daftar pelanggan beserta riwayat cuciannya akan tampil di sini." />
    </>
  )
}
