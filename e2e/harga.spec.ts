import { test, expect, type Page } from '@playwright/test'

// Daftar harga (SPEC 3.1, 3.4, 3.10) on the narrowest common phone, in Mode Demo.

async function loginDemo(page: Page) {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  // the shell (and the app's own start-up writes to the demo database) must be done before we go on
  await expect(page.getByRole('link', { name: 'Laporan' }).first()).toBeVisible()
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

test.describe('Daftar harga (Mode Demo, 360 px)', () => {
  test('owner adds a per-pcs service with express, edits a price and reorders', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/harga')
    await expect(page.getByRole('heading', { name: 'Daftar harga' })).toBeVisible()
    const kg = page.getByTestId('group-kg')
    const pcs = page.getByTestId('group-pcs')
    await expect(kg.getByTestId('service-row')).toHaveCount(3)
    await expect(pcs.getByTestId('service-row')).toHaveCount(3)
    const first = kg.getByTestId('service-row').first()
    await expect(first).toContainText('Cuci kering')
    await expect(first).toContainText('Rp 6.000/kg')
    await expect(first).toContainText('Rp 10.000/kg')
    await expect(first).toContainText('3 hari · express 1 hari · min. 2 kg')
    await expect(page.getByTestId('group-paket')).toContainText('Paket 20 kg cuci setrika')
    expect(await noHorizontalScroll(page)).toBe(true)

    // add: validation first, then a per-pcs service with an express price
    await page.getByRole('button', { name: 'Tambah layanan' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Tambah layanan' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Simpan' }).click()
    await expect(dialog.getByText('Nama layanan wajib diisi.')).toBeVisible()
    await dialog.getByLabel('Nama layanan').fill('Jas')
    await dialog.getByRole('radio', { name: 'Per pcs' }).click()
    await dialog.getByLabel('Harga reguler').fill('15000')
    await expect(dialog.getByLabel('Harga express')).toHaveCount(0)
    await dialog.getByRole('switch', { name: 'Ada express' }).click()
    await dialog.getByLabel('Harga express').fill('25000')
    await dialog.getByLabel('Lama pengerjaan reguler').fill('2')
    await dialog.getByLabel('Lama pengerjaan express').fill('1')
    await dialog.getByRole('button', { name: 'Simpan' }).click()
    await expect(dialog).toHaveCount(0)
    const jas = pcs.getByTestId('service-row').filter({ hasText: 'Jas' })
    await expect(jas).toHaveCount(1)
    await expect(jas).toContainText('Rp 15.000/pcs')
    await expect(jas).toContainText('Rp 25.000/pcs')
    await expect(jas).toContainText('2 hari · express 1 hari')
    await expect(pcs.getByTestId('service-row')).toHaveCount(4)
    await expect(pcs.getByTestId('service-row').last()).toContainText('Jas')

    // edit a price
    await page.getByRole('button', { name: /^Ubah Setrika saja/ }).click()
    await expect(dialog.getByRole('heading', { name: 'Ubah layanan' })).toBeVisible()
    await expect(dialog.getByLabel('Harga reguler')).toHaveValue('5.000')
    await dialog.getByLabel('Harga reguler').fill('6000')
    await dialog.getByRole('button', { name: 'Simpan' }).click()
    await expect(dialog).toHaveCount(0)
    const setrika = kg.getByTestId('service-row').filter({ hasText: 'Setrika saja' })
    await expect(setrika).toContainText('Rp 6.000/kg')
    await expect(setrika).toContainText('express —')

    // reorder within the kg group; the order survives a reload
    await expect(page.getByRole('button', { name: 'Naikkan Cuci kering' })).toBeDisabled()
    await page.getByRole('button', { name: 'Turunkan Cuci kering' }).click()
    await expect(kg.getByTestId('service-row').first()).toContainText('Cuci setrika')
    await expect(page.getByRole('button', { name: 'Naikkan Cuci setrika' })).toBeDisabled()
    await page.reload()
    await expect(page.getByTestId('group-kg').getByTestId('service-row').first()).toContainText('Cuci setrika')
    await expect(page.getByTestId('group-pcs').getByTestId('service-row').last()).toContainText('Jas')
    expect(await noHorizontalScroll(page)).toBe(true)
  })

  test('owner adds a prepaid package for a per-kg service', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/harga')
    await page.getByRole('button', { name: 'Tambah paket' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Tambah paket' })).toBeVisible()
    // only per-kg services are offered
    const options = await dialog.getByRole('combobox').locator('option').allTextContents()
    expect(options.some((o) => o.startsWith('Cuci kering'))).toBe(true)
    expect(options.some((o) => o.startsWith('Bed cover'))).toBe(false)
    await dialog.getByLabel('Nama paket').fill('Paket 10 kg cuci kering')
    await dialog.getByRole('combobox').selectOption('demo-svc-cuci-kering')
    await dialog.getByLabel('Jumlah (kg)').fill('10')
    await dialog.getByLabel('Harga paket').fill('50000')
    await expect(dialog.getByText('Setara Rp 5.000/kg')).toBeVisible()
    await dialog.getByRole('button', { name: 'Simpan' }).click()
    await expect(dialog).toHaveCount(0)
    const row = page.getByTestId('package-row').filter({ hasText: 'Paket 10 kg cuci kering' })
    await expect(row).toContainText('10 kg Cuci kering')
    await expect(row).toContainText('Rp 50.000')
    await expect(row).toContainText('Tanpa kedaluwarsa')
    expect(await noHorizontalScroll(page)).toBe(true)
  })

  test('staff sees the price list read-only', async ({ page }) => {
    await loginDemo(page)
    await page.evaluate(() => {
      const raw = localStorage.getItem('eglaundry.local.db.v1')
      if (!raw) return
      const db = JSON.parse(raw)
      for (const m of db.organization_members) if (m.user_id === 'local-user') m.role = 'staff'
      localStorage.setItem('eglaundry.local.db.v1', JSON.stringify(db))
    })
    await page.reload()
    await page.waitForURL(/\/dashboard$/)
    await expect(page.getByRole('link', { name: 'Laporan' })).toHaveCount(0)
    await page.goto('/harga')
    await expect(page.getByRole('heading', { name: 'Daftar harga' })).toBeVisible()
    await expect(page.getByTestId('read-only-note')).toContainText('Hanya pemilik/admin yang dapat mengubah harga dan paket.')
    await expect(page.getByTestId('service-row')).toHaveCount(6)
    await expect(page.getByTestId('group-kg')).toContainText('Rp 6.000/kg')
    await expect(page.getByTestId('group-paket')).toContainText('Paket 20 kg cuci setrika')
    await expect(page.getByRole('button', { name: 'Tambah layanan' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Tambah paket' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Ubah / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^(Naikkan|Turunkan) / })).toHaveCount(0)
    expect(await noHorizontalScroll(page)).toBe(true)
  })
})
