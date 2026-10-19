import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { MemberRole, Organization } from '../types/db'
import { getRepo, bindOrg, LocalRepo, NotMemberError, type OrgRepo } from '../lib/repo'
import { JoinOrganization } from '../features/auth/JoinOrganization'
import { clearPendingCode, readPendingEntry } from '../features/auth/pendingCode'
import { useToast } from '../components/ui'
import { buildDemoDb, DEMO_ORG_ID } from '../lib/repo/demoSeed'
import { useAuth } from './useAuth'
import { ErrorScreen } from '../components/ErrorBoundary'

/** The role can change on another phone (owner demotes an admin); a PWA may stay open for days. */
const MEMBERSHIP_STALE_MS = 60_000

interface OrgContextValue {
  org: Organization
  role: MemberRole
  /** owner or admin: prices, reports, members, history */
  isAdmin: boolean
  repo: OrgRepo
  /** demo mode only: wipe and reseed demo data */
  resetDemoData: () => Promise<void>
  isLocalMode: boolean
}

const OrgContext = createContext<OrgContextValue | null>(null)

async function loadMembership(userId: string, email: string | null) {
  const repo = getRepo()
  if (repo.mode === 'local') {
    const local = repo as LocalRepo
    if (local.isEmpty()) local.replaceAll(buildDemoDb())
  }
  // Membership is resolved server-side (ensure_membership RPC): the client never creates organisations
  // and never picks an organisation itself, which closes the "invite the owner into my org" attack.
  const orgId = await repo.ensureMembership({ id: userId, email })
  const [org, members] = await Promise.all([
    repo.get('organizations', orgId),
    repo.list('organization_members', { where: { org_id: orgId, user_id: userId } }),
  ])
  if (!org) throw new Error('Organisasi tidak ditemukan.')
  return { org, role: members[0]?.role ?? ('staff' as MemberRole) }
}

// Texts of a write the database refused for the user's role: RLS, a role check in a trigger/RPC, or an
// update/delete that matched no row the user may change.
const REFUSED_RE = /izin|Hanya pemilik|Tidak memiliki akses|permission denied|row-level security|PGRST116|multiple \(or no\) rows/i

/** Re-reads the role after a refused write, so a demoted member stops seeing actions they lost. */
function refetchRoleOnRefusal(repo: OrgRepo, onRefused: () => void): OrgRepo {
  const watch =
    <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args)
      } catch (err) {
        if (err instanceof Error && REFUSED_RE.test(err.message)) onRefused()
        throw err
      }
    }
  return {
    ...repo,
    insert: watch(repo.insert),
    insertMany: watch(repo.insertMany),
    update: watch(repo.update),
    remove: watch(repo.remove),
    uploadFile: watch(repo.uploadFile),
    removeFile: watch(repo.removeFile),
    createInvitation: watch(repo.createInvitation),
    setMemberRole: watch(repo.setMemberRole),
    removeMember: watch(repo.removeMember),
  }
}

export function OrgProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const userId = session?.user.id ?? ''
  const email = session?.user.email ?? null

  const membership = useQuery({
    queryKey: ['membership', userId],
    queryFn: () => loadMembership(userId, email),
    // a non-member is a normal state (join screen), not a transient failure
    retry: (count, err) => !(err instanceof NotMemberError) && count < 1,
    enabled: Boolean(userId),
    staleTime: MEMBERSHIP_STALE_MS,
    refetchOnWindowFocus: true,
  })

  const orgId = membership.data?.org.id
  const repo = useMemo(
    () =>
      orgId
        ? refetchRoleOnRefusal(bindOrg(getRepo(), orgId), () => void queryClient.invalidateQueries({ queryKey: ['membership'] }))
        : null,
    [orgId, queryClient],
  )

  // An invitation link opened by a member: the join screen never shows, so drop the code here.
  const isMember = membership.isSuccess
  useEffect(() => {
    if (!isMember || !readPendingEntry()) return
    clearPendingCode()
    toast.toast('Anda sudah menjadi anggota; kode undangan tidak dipakai.')
  }, [isMember, toast])

  const value = useMemo<OrgContextValue | null>(() => {
    if (!membership.data || !repo) return null
    const role = membership.data.role
    return {
      org: membership.data.org,
      role,
      isAdmin: role === 'owner' || role === 'admin',
      repo,
      resetDemoData: async () => {
        if (repo.mode !== 'local') return
        ;(repo.raw as LocalRepo).replaceAll(buildDemoDb())
        await queryClient.invalidateQueries()
      },
      isLocalMode: repo.mode === 'local',
    }
  }, [membership.data, repo, queryClient])

  if (membership.isError && membership.error instanceof NotMemberError) {
    return <JoinOrganization onJoined={() => void queryClient.invalidateQueries({ queryKey: ['membership', userId] })} />
  }
  // a failed background refresh keeps the app on the role it already has
  if (membership.isError && !membership.data) return <ErrorScreen error={membership.error} />
  if (!value) return <>{fallback}</>
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be used inside <OrgProvider>')
  return ctx
}

/** Shortcut for the org-bound repository. */
export function useRepo(): OrgRepo {
  return useOrg().repo
}

// Re-export for convenience in feature modules.
export { DEMO_ORG_ID }
