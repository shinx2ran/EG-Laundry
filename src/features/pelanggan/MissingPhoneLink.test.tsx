// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { MissingPhoneLink } from './MissingPhoneLink'

afterEach(cleanup)

describe('MissingPhoneLink (one implementation for the customer and the order screens)', () => {
  const customer = { id: 'c1', name: 'Ibu Tini' }

  it('opens the customer form at Nomor HP, as a bubble or as a button with the text', () => {
    render(
      <MemoryRouter>
        <MissingPhoneLink customer={customer} className="h-11 w-11" />
        <MissingPhoneLink customer={customer} variant="button" />
      </MemoryRouter>,
    )
    const links = screen.getAllByRole('link', { name: 'Nomor HP Ibu Tini belum diisi: isi sekarang' })
    expect(links).toHaveLength(2)
    for (const link of links) expect(link.getAttribute('href')).toBe('/pelanggan/c1?isi=hp')
    expect(links[0].textContent).toBe('')
    expect(links[1].textContent).toBe('Nomor HP belum diisi')
  })

  it('without a customer it is a plain, inactive marker', () => {
    render(
      <MemoryRouter>
        <MissingPhoneLink customer={null} className="h-11 w-11" />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByLabelText('Nomor HP belum diisi')).toBeTruthy()
  })
})
