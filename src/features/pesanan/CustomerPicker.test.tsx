// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToastProvider } from '../../components/ui'
import type { Customer } from '../../types/db'
import { CustomerPicker, type NewCustomerInput } from './CustomerPicker'

afterEach(cleanup)

const budi: Customer = {
  id: 'c-budi', org_id: 'o1', name: 'Budi', phone: null, is_tenant: false, room_name: null, kos_tenant_id: null, address: null, notes: null,
  created_at: '2026-10-20T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z',
}

describe('CustomerPicker: Tambah pelanggan baru', () => {
  it('Enter pressed again while the new customer is being saved adds it only once', async () => {
    let finish: (c: Customer) => void = () => undefined
    const onCreate = vi.fn((_input: NewCustomerInput) => new Promise<Customer>((resolve) => (finish = resolve)))
    const onChange = vi.fn()
    render(<CustomerPicker customers={[]} orders={[]} value={undefined} onChange={onChange} onCreate={onCreate} />, { wrapper: ToastProvider })
    fireEvent.click(screen.getByRole('button', { name: 'Tambah pelanggan baru' }))
    const name = screen.getByLabelText(/^Nama/)
    fireEvent.change(name, { target: { value: 'Budi' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    fireEvent.keyDown(name, { key: 'Enter' })
    fireEvent.keyDown(screen.getByLabelText(/^Nomor HP/), { key: 'Enter' })
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate).toHaveBeenCalledWith({ name: 'Budi', phone: '' })
    await act(async () => finish(budi))
    expect(onChange).toHaveBeenCalledWith('c-budi')
  })
})
