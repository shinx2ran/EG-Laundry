import { EmptyState, PageHeader } from '../../components/ui'

/** Placeholder: the laundry module for this page is built next (SPEC section 3). */
export function LaporanPage() {
  return (
    <>
      <PageHeader title="Laporan" subtitle="Omzet, pelanggan teratas, anak kos vs umum" />
      <EmptyState title="Segera hadir" description="Laporan penjualan dan pelanggan akan tampil di sini." />
    </>
  )
}
