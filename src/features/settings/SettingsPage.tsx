import { Link } from 'react-router'
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

export function SettingsPage() {
  const { org, role, repo, isLocalMode, isAdmin } = useOrg()
  const { auth, session } = useAuth()

  return (
    <>
      <PageHeader title="Pengaturan" subtitle={isLocalMode ? 'Mode Demo: data hanya di perangkat ini' : 'Mode Online: data tersinkron lewat Supabase'} />
      <div className="grid gap-4 lg:grid-cols-2">
        <OrganizationCard orgId={org.id} orgName={org.name} role={role} isAdmin={isAdmin} isLocalMode={isLocalMode} />
        <MembersCard isAdmin={isAdmin} currentUserId={session?.user.id ?? ''} />
        <PriceListCard isAdmin={isAdmin} />
        <DataCard isLocalMode={isLocalMode} isAdmin={isAdmin} />
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
