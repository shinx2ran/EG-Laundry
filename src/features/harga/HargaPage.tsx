import { useMemo, useState } from 'react'
import { Package, Plus, Tags } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState, PageHeader, useToast } from '../../components/ui'
import { useLaundryData } from '../../hooks/useLaundryData'
import type { PackageCatalogItem, Service } from '../../types/db'
import { PackageRow, ServiceRow } from './components'
import { STAFF_READ_ONLY_NOTE, canMoveService, catalogUsage, groupServicesByUnit, serviceUsage, type MoveDirection } from './hargaUtils'
import { useHargaActions } from './useHargaActions'
import { ServiceFormModal } from './ServiceFormModal'
import { PackageFormModal } from './PackageFormModal'

/** null = closed; { row: null } = add; { row } = edit */
type Editing<T> = { row: T | null } | null

/**
 * Daftar harga (SPEC 3.1) grouped per kg / per pcs, with the package catalog (SPEC 3.4) below. Owner/admin
 * add, edit, reorder (▲/▼) and delete/deactivate; staff see the same list without buttons (SPEC 3.10).
 */
export function HargaPage() {
  const data = useLaundryData()
  const actions = useHargaActions()
  const toast = useToast()
  const editable = actions.isAdmin
  const [serviceModal, setServiceModal] = useState<Editing<Service>>(null)
  const [packageModal, setPackageModal] = useState<Editing<PackageCatalogItem>>(null)
  const [moving, setMoving] = useState(false)

  const groups = useMemo(() => groupServicesByUnit(data.services), [data.services])
  // active entries first, then by name
  const packages = useMemo(() => [...data.packageCatalog].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'id')), [data.packageCatalog])

  const move = async (service: Service, direction: MoveDirection) => {
    setMoving(true)
    try {
      await actions.moveService(service, direction)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal mengubah urutan.')
    } finally {
      setMoving(false)
    }
  }

  const serviceCount = data.services.length
  const addServiceButton = (
    <Button icon={<Plus className="h-4 w-4" />} onClick={() => setServiceModal({ row: null })}>
      Tambah layanan
    </Button>
  )

  return (
    <>
      <PageHeader title="Daftar harga" subtitle={data.isPending ? 'Memuat…' : `${serviceCount} layanan · ${packages.length} paket prabayar`} actions={editable ? addServiceButton : undefined} />
      {!editable && (
        <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600" data-testid="read-only-note">
          {STAFF_READ_ONLY_NOTE}
        </p>
      )}

      {data.isPending ? (
        <LoadingState label="Memuat daftar harga…" />
      ) : data.error ? (
        <ErrorState error={data.error} />
      ) : serviceCount === 0 ? (
        <EmptyState
          icon={<Tags className="h-10 w-10" />}
          title="Belum ada layanan"
          description={editable ? 'Tambahkan layanan pertama: cuci kering, cuci setrika, setrika saja, bed cover, …' : 'Pemilik belum mengisi daftar harga.'}
          action={editable ? addServiceButton : undefined}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <Card key={group.unit} data-testid={`group-${group.unit}`}>
              <CardHeader title={group.label} subtitle={group.hint} />
              {group.services.length === 0 ? (
                <CardBody>
                  <p className="text-sm text-slate-500">Belum ada layanan {group.label.toLowerCase()}.</p>
                </CardBody>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {group.services.map((service) => (
                    <ServiceRow
                      key={service.id}
                      service={service}
                      editable={editable}
                      canUp={canMoveService(data.services, service.id, 'up')}
                      canDown={canMoveService(data.services, service.id, 'down')}
                      busy={moving}
                      onEdit={() => setServiceModal({ row: service })}
                      onMove={(direction) => void move(service, direction)}
                    />
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}

      {!data.isPending && !data.error && (
        <Card className="mt-4" data-testid="group-paket">
          <CardHeader
            title="Paket prabayar"
            subtitle="Dibeli di muka, dipakai per pesanan sampai habis"
            action={
              editable ? (
                <Button size="sm" variant="secondary" className="h-11 shrink-0 whitespace-nowrap" icon={<Plus className="h-4 w-4" />} onClick={() => setPackageModal({ row: null })}>
                  Tambah paket
                </Button>
              ) : (
                <Package className="h-5 w-5 text-slate-400" aria-hidden />
              )
            }
          />
          {packages.length === 0 ? (
            <CardBody>
              <p className="text-sm text-slate-500">{editable ? 'Belum ada paket. Contoh: Paket 20 kg cuci setrika Rp 140.000, berlaku 60 hari.' : 'Belum ada paket prabayar.'}</p>
            </CardBody>
          ) : (
            <ul className="divide-y divide-slate-100">
              {packages.map((item) => (
                <PackageRow key={item.id} item={item} service={data.serviceById.get(item.service_id)} editable={editable} onEdit={() => setPackageModal({ row: item })} />
              ))}
            </ul>
          )}
        </Card>
      )}

      {serviceModal && (
        <ServiceFormModal
          service={serviceModal.row}
          usage={serviceModal.row ? serviceUsage(serviceModal.row.id, data.orderItems, data.packageCatalog, data.customerPackages) : undefined}
          actions={actions}
          onClose={() => setServiceModal(null)}
        />
      )}
      {packageModal && (
        <PackageFormModal
          item={packageModal.row}
          services={data.services}
          sold={packageModal.row ? catalogUsage(packageModal.row.id, data.customerPackages) : 0}
          actions={actions}
          onClose={() => setPackageModal(null)}
        />
      )}
    </>
  )
}
