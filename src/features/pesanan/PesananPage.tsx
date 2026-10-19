import { EmptyState, PageHeader } from '../../components/ui'

/** Placeholder: the laundry module for this page is built next (SPEC section 3). */
export function PesananPage() {
  return (
    <>
      <PageHeader title="Pesanan" subtitle="Cucian masuk, diproses, siap diambil" />
      <EmptyState title="Segera hadir" description="Pencatatan pesanan laundry akan tampil di sini." />
    </>
  )
}
