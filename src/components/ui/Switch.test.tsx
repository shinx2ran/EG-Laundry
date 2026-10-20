// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Switch } from './Switch'

afterEach(cleanup)

describe('Switch', () => {
  it('is one switch named by its label; a tap anywhere on the row flips it', () => {
    const onChange = vi.fn()
    render(<Switch label="Express" hint="Reguler" checked={false} onChange={onChange} />)
    const sw = screen.getByRole('switch', { name: 'Express' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByText('Reguler'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('does nothing while disabled', () => {
    const onChange = vi.fn()
    render(<Switch label="Aktif" checked onChange={onChange} disabled />)
    fireEvent.click(screen.getByRole('switch', { name: 'Aktif' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
