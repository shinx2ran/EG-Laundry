// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { MemberRole, Order } from '../../types/db'
import { LocalRepo } from '../../lib/repo/localRepo'
import { bindOrg, type OrgRepo } from '../../lib/repo/types'
import { buildDemoDb, DEMO_ORG_ID } from '../../lib/repo/demoSeed'
import { orderTotals } from '../../domain/pricing'

const state: { repo: OrgRepo | null; role: MemberRole } = { repo: null, role: 'staff' }

vi.mock('../../hooks/useOrg', () => ({
  useOrg: () => ({ org: { id: DEMO_ORG_ID, name: 'EG Laundry (Demo)' }, repo: state.repo, role: state.role, isAdmin: state.role !== 'staff', isLocalMode: true }),
}))
vi.mock('../../hooks/useTable', () => ({ useInvalidate: () => async () => undefined }))

import { PickupModal } from './OrderModals'
import { PaymentSavedError, useOrderActions, type ActionContext } from './useOrderActions'

// demo-order-04: Bu Wati, Siap diambil, unpaid, total 52.000 (see demoSeed.ts)
const READY = 'demo-order-04'

let repo: OrgRepo

async function load(): Promise<{ order: Order; ctx: ActionContext }> {
  const ctx: ActionContext = {
    services: await repo.list('services'),
    customerPackages: await repo.list('customer_packages'),
    orderItems: await repo.list('order_items'),
    orders: await repo.list('orders'),
    payments: await repo.list('payments'),
  }
  return { order: ctx.orders.find((o) => o.id === READY)!, ctx }
}

/** The detail page keeps the dialog mounted while the order is Siap and passes it the reloaded figures. */
function Page({ order, ctx }: { order: Order; ctx: ActionContext }) {
  const actions = useOrderActions()
  return <PickupModal order={order} totals={orderTotals(order, ctx.orderItems, ctx.payments)} customer={undefined} ctx={ctx} actions={actions} onClose={() => undefined} />
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('PickupModal', () => {
  it('after "payment saved, status failed" the retry only changes the status (no second payment)', async () => {
    const local = new LocalRepo(buildDemoDb(new Date(2026, 9, 19, 10, 0)))
    const base = bindOrg(local, DEMO_ORG_ID)
    let failStatus = true
    repo = {
      ...base,
      update: (async (table: string, id: string, patch: never) => {
        if (table === 'orders' && failStatus) {
          failStatus = false
          throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.')
        }
        return base.update(table as 'orders', id, patch)
      }) as OrgRepo['update'],
    }
    state.repo = repo

    const first = await load()
    const view = render(<Page {...first} />, { wrapper: ToastProvider })
    // a partial payment of 10.000 of the 52.000 owed
    fireEvent.change(screen.getByLabelText('Jumlah'), { target: { value: '10.000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Bayar & tandai diambil' }))
    await screen.findByText(/Pembayaran tercatat, tetapi status pesanan gagal diubah/)
    expect(await repo.list('payments', { where: { order_id: READY } })).toHaveLength(1)

    // the page reloads: 42.000 still owed, the order is still Siap, the dialog stays open
    const second = await load()
    expect(second.order.status).toBe('ready')
    view.rerender(<Page {...second} />)
    expect(screen.getByText('Pembayaran Rp 10.000 sudah tercatat. Ketuk Tandai diambil untuk mengubah statusnya saja.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Tandai diambil' }))
    await screen.findByText(`Pesanan ${second.order.order_number} diambil. Sisa bayar Rp 42.000.`)

    const payments = await repo.list('payments', { where: { order_id: READY } })
    expect(payments.map((p) => p.amount)).toEqual([10_000])
    await waitFor(async () => expect((await repo.get('orders', READY))?.status).toBe('done'))
  })

  it('markPickedUp reports a saved payment with a failed status as PaymentSavedError', async () => {
    const local = new LocalRepo(buildDemoDb(new Date(2026, 9, 19, 10, 0)))
    const base = bindOrg(local, DEMO_ORG_ID)
    repo = {
      ...base,
      update: (async () => {
        throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.')
      }) as OrgRepo['update'],
    }
    state.repo = repo
    const actions = renderHook(() => useOrderActions()).result.current
    const { order, ctx } = await load()
    const err = await actions.markPickedUp(order, ctx, { amount: 10_000, method: 'cash' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PaymentSavedError)
    expect((err as PaymentSavedError).payment).toMatchObject({ order_id: READY, amount: 10_000 })
  })
})
