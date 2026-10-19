import { test, expect } from '@playwright/test'

test.describe('Mode Demo', () => {
  test('login demo -> dashboard shell renders', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('heading', { name: 'EG Laundry' })).toBeVisible()
    await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByText('Mode Demo', { exact: false }).first()).toBeVisible()
    // bottom navigation present on mobile viewport
    for (const name of ['Dashboard', 'Pesanan', 'Pelanggan', 'Laporan']) {
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
    }
  })

  test('a phone reaches Pengaturan (Anggota, Undang, Daftar harga) from the top bar', async ({ page }) => {
    // narrowest common Android width: the gear and Keluar fit without horizontal scrolling
    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto('/login')
    await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
    await page.waitForURL(/\/dashboard$/)
    const gear = page.getByRole('link', { name: 'Pengaturan' })
    await expect(gear).toBeVisible()
    await expect(page.getByRole('button', { name: 'Keluar' })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await gear.click()
    await expect(page).toHaveURL(/\/pengaturan$/)
    await expect(page.getByRole('heading', { name: 'Anggota' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Undang' })).toBeVisible()
    await page.getByRole('link', { name: 'Buka daftar harga' }).click()
    await expect(page).toHaveURL(/\/harga$/)
    await expect(page.getByRole('heading', { name: 'Daftar harga' })).toBeVisible()
  })
})
