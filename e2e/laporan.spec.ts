import { test, expect, type Page } from '@playwright/test'

const DB_KEY = 'eglaundry.local.db.v1'
// the demo data is built relative to "today": a fixed clock makes every figure the same on every run
const NOW = new Date('2026-10-20T10:00:00+07:00')

test.use({ timezoneId: 'Asia/Jakarta' })

async function loginDemo(page: Page) {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.clock.setFixedTime(NOW)
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Laporan' }).first()).toBeVisible()
}

async function expectNoSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test.describe('Laporan (Mode Demo, 360 px)', () => {
  test('Bulan ini: uang masuk, per layanan, anak kos vs umum, XLSX download', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await loginDemo(page)
    await page.getByRole('link', { name: 'Laporan' }).first().click()
    await expect(page.getByRole('heading', { name: 'Laporan', level: 1 })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Bulan ini' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('1 Okt 2026 – 31 Okt 2026')).toBeVisible()

    const money = page.getByTestId('tile-uang-masuk')
    await expect(money).toBeVisible()
    expect(Number(await money.getAttribute('data-amount'))).toBeGreaterThan(0)
    await expect(money).not.toContainText('Rp 0')
    // the lazily loaded chart draws its bars
    await expect(page.getByTestId('uang-masuk-chart').locator('.recharts-bar-rectangle').first()).toBeVisible()

    await expect(page.getByTestId('service-row').first()).toBeVisible()

    // both kinds of customer brought orders this month, and the shares add up to 100
    const split = page.getByTestId('split-orders')
    const tenant = Number(await split.getAttribute('data-tenant-pct'))
    const walkin = Number(await split.getAttribute('data-walkin-pct'))
    expect(tenant).toBeGreaterThan(0)
    expect(walkin).toBeGreaterThan(0)
    expect(tenant + walkin).toBe(100)
    await expect(page.getByTestId('split-card')).toContainText('Anak kos')
    await expect(page.getByTestId('split-card')).toContainText('Umum')
    await expectNoSideScroll(page)

    const download = page.waitForEvent('download')
    await page.getByTestId('services-card').getByRole('button', { name: 'Unduh XLSX' }).click()
    expect((await download).suggestedFilename()).toBe('eg-laundry-layanan-2026-10-01_2026-10-31.xlsx')

    // Hari ini keeps working and fits too
    await page.getByRole('radio', { name: 'Hari ini' }).click()
    await expect(page).toHaveURL(/periode=hari/)
    await expect(page.getByText('20 Okt 2026', { exact: true })).toBeVisible()
    await expectNoSideScroll(page)
    expect(errors).toEqual([])
  })

  test('Lama tidak datang with N = 7: promo via WhatsApp; the CSV of the customer table', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/laporan')
    await expect(page.getByTestId('report-customer').first()).toBeVisible()
    const customerCsv = page.waitForEvent('download')
    await page.getByTestId('customers-card').getByRole('button', { name: 'Unduh CSV' }).click()
    expect((await customerCsv).suggestedFilename()).toBe('eg-laundry-pelanggan-2026-10-01_2026-10-31.csv')

    await page.getByRole('radio', { name: 'Lama tidak datang' }).click()
    await expect(page).toHaveURL(/tab=lama/)
    const days = page.getByLabel('Batas hari tidak datang')
    await expect(days).toHaveValue('21')
    await days.fill('7')
    const rows = page.getByTestId('absent-customer')
    await expect(rows.first()).toBeVisible()
    const away = await rows.evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-days'))))
    expect(away.every((d) => d > 7)).toBe(true)
    expect([...away].sort((a, b) => b - a)).toEqual(away)
    await expectNoSideScroll(page)

    // the demo laundry has a promo template: the link opens WhatsApp with the customer's name filled in
    const withPhone = rows.filter({ has: page.getByTestId('promo-link') }).first()
    const name = await withPhone.getAttribute('data-name')
    const promo = withPhone.getByRole('link', { name: `Kirim promo ke ${name}` })
    const href = await promo.getAttribute('href')
    expect(href).toMatch(/^https:\/\/wa\.me\/62\d+\?text=/)
    expect(decodeURIComponent(href!.split('?text=')[1])).toContain(`Halo ${name}`)
    await expect(page.getByTestId('promo-hint')).toHaveCount(0)

    // N is remembered on this phone
    await page.reload()
    await expect(page.getByLabel('Batas hari tidak datang')).toHaveValue('7')
    expect(await page.evaluate(() => localStorage.getItem('eglaundry.lamaTidakDatang'))).toBe('7')
  })

  test('staff get the owner-only message', async ({ page }) => {
    await loginDemo(page)
    await page.evaluate((key) => {
      const db = JSON.parse(localStorage.getItem(key) ?? '{}')
      for (const m of db.organization_members) if (m.user_id === 'local-user') m.role = 'staff'
      localStorage.setItem(key, JSON.stringify(db))
    }, DB_KEY)
    await page.goto('/laporan')
    await expect(page.getByText('Laporan hanya untuk pemilik/admin.')).toBeVisible()
    await expect(page.getByTestId('tile-uang-masuk')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Laporan' })).toHaveCount(0)
  })
})
