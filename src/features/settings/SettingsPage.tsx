import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { Tags } from 'lucide-react'
import { Card, CardBody, CardHeader, PageHeader } from '../../components/ui'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../hooks/useOrg'
import { OrganizationCard } from './OrganizationCard'
import { MembersCard } from './MembersCard'
import { DataCard } from './DataCard'
import { AuditCard } from './AuditCard'
import { InstallCard } from './InstallCard'
import { AboutCard } from './AboutCard'
import { WhatsAppCard } from './WhatsAppCard'
import { TenantImportCard } from '../impor/TenantImportCard'
import { DemoImportCard } from '../impor/DemoImportCard'

export function SettingsPage() {
  const { org, role, repo, isLocalMode, isAdmin } = useOrg()
  const { auth, session } = useAuth()
  const { hash } = useLocation()

  // /pengaturan#pesan-whatsapp (Laporan's "Isi di Pengaturan") opens the page at that card
  useEffect(() => {
    if (hash.length > 1) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: 'start' })
  }, [hash])

  return (
    <>
      <PageHeader title="Pengaturan" subtitle={isLocalMode ? 'Mode Demo: data hanya di perangkat ini' : 'Mode Online: data tersinkron lewat Supabase'} />
      <div className="grid gap-4 lg:grid-cols-2">
        <OrganizationCard orgId={org.id} orgName={org.name} role={role} isAdmin={isAdmin} isLocalMode={isLocalMode} />
        {/* SPEC 3.7-3.10: owner/admin only; staff does not see these cards and their hooks refuse */}
        {isAdmin && <WhatsAppCard />}
        <MembersCard isAdmin={isAdmin} currentUserId={session?.user.id ?? ''} />
        <PriceListCard isAdmin={isAdmin} />
        {isAdmin && <TenantImportCard />}
        <DataCard isLocalMode={isLocalMode} isAdmin={isAdmin} />
        {isAdmin && <DemoImportCard />}
        <InstallCard />
        <AboutCard onSignOut={() => auth.signOut()} email={session?.user.email ?? null} repoMode={repo.mode} />
        {isAdmin && <AuditCard isLocalMode={isLocalMode} />}
      </div>
    </>
  )
}

// ---------------------------------------------------------------- Price list (lives on its own page)

function PriceListCard({ isAdmin }: { isAdmin: boolean }) {
  return (
    <Card>
      <CardHeader title="Daftar harga" subtitle="Layanan per kg, per potong, express, dan paket" action={<Tags className="h-5 w-5 text-slate-400" />} />
      <CardBody className="space-y-3 text-sm text-slate-700">
        <p>
          Harga yang dipakai saat mencatat pesanan.{' '}
          {isAdmin ? 'Hanya pemilik/admin yang dapat mengubahnya.' : 'Perubahan harga dilakukan oleh pemilik/admin.'}
        </p>
        <Link
          to="/harga"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
        >
          Buka daftar harga
        </Link>
      </CardBody>
    </Card>
  )
}
