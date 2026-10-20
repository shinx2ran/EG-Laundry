import { test, expect, type Locator, type Page } from '@playwright/test'

// The demo seed is built relative to the clock at the first demo login, so the clock is fixed before logging in:
// Monday 19 Oct 2026, 10:00 WIB. On that day the seed has 2 orders in today (Rina 3 kg + Pak Hendra 4,5 kg express),
// 5 being worked on (2 late: Lusi and Yoga), 3 ready (Sari, Bu Wati, Andi), 4 unpaid (Rp 151.000) and Pak Hendra's
// QRIS DP of Rp 18.000 as the only money in today.
const NOW = new Date('2026-10-19T10:00:00+07:00')
const DB_KEY = 'eglaundry.local.db.v1'

test.use({ timezoneId: 'Asia/Jakarta' })

async function loginDemo(page: Page) {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.clock.setFixedTime(NOW)
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await expect(page.getByTestId('tile-masuk')).toBeVisible()
}

async function expectNoSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

async function expectTapTarget(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
}

const tileValue = (page: Page, id: string) => page.getByTestId(id).getByTestId('tile-value')

test.describe('Dashboard (Mode Demo, 360 px, Senin 19 Okt 2026)', () => {
  test('the tiles match the seed, the ready order goes out on WhatsApp and Diambil opens the pickup dialog', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`)
    })
    await loginDemo(page)

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('EG Laundry (Demo)')
    await expect(page.getByText('Senin, 19 Oktober 2026')).toBeVisible()
    const newOrder = page.getByRole('link', { name: 'Pesanan baru' })
    await expect(newOrder).toHaveAttribute('href', '/pesanan/baru')
    await expectTapTarget(newOrder)

    await expect(tileValue(page, 'tile-masuk')).toHaveText('2')
    await expect(page.getByTestId('tile-masuk')).toContainText('7,5 kg · Rp 69.000')
    await expect(tileValue(page, 'tile-proses')).toHaveText('5')
    await expect(page.getByTestId('tile-proses')).toContainText('3 diterima · 2 proses')
    await expect(page.getByTestId('tile-proses')).toContainText('2 terlambat')
    await expect(tileValue(page, 'tile-siap')).toHaveText('3')
    await expect(tileValue(page, 'tile-belum-bayar')).toHaveText('4')
    await expect(page.getByTestId('tile-belum-bayar')).toContainText('Rp 151.000')
    await expect(tileValue(page, 'tile-uang-masuk')).toHaveText('Rp 18.000')
    await expect(page.getByTestId('money-qris')).toContainText('Rp 18.000')
    await expect(page.getByTestId('money-cash')).toContainText('Rp 0')

    // Terlambat in red with the promised date, most overdue first
    const late = page.getByTestId('late-row')
    await expect(late).toHaveCount(2)
    await expect(late.first()).toContainText('Lusi Anggraini')
    await expect(late.first()).toContainText('Janji 16 Okt 2026 · terlambat 3 hari')
    await expect(late.nth(1)).toContainText('Yoga Pratama')

    // Belum bayar: the largest first, opening Terima pembayaran
    const unpaid = page.getByTestId('unpaid-row')
    await expect(unpaid).toHaveCount(4)
    await expect(unpaid.first()).toContainText('Bu Wati')
    await expect(unpaid.first().getByRole('link')).toHaveAttribute('href', '/pesanan/demo-order-04?aksi=bayar')

    // the owner's 7-day chart (its own lazily loaded chunk): seven days, a bar for each of the five with money in
    await expect(page.getByTestId('money-card')).toContainText('Total Rp 193.000')
    const chart = page.getByTestId('money-chart')
    await expect(chart.locator('.recharts-xAxis .recharts-cartesian-axis-tick')).toHaveCount(7)
    await expect(chart).toContainText('Sen')
    await expect(chart.locator('.recharts-bar-rectangle')).toHaveCount(5)
    await expectNoSideScroll(page)

    // Siap diambil: green WhatsApp with the ready text, and Diambil
    const ready = page.getByTestId('ready-row')
    await expect(ready).toHaveCount(3)
    const wati = ready.filter({ hasText: 'Bu Wati' })
    const number = (await wati.getAttribute('data-order-number')) ?? ''
    expect(number).toMatch(/^LD-202610-\d{4}$/)
    await expect(wati).toContainText('Rp 52.000')
    const wa = wati.getByRole('link', { name: 'Kabari Bu Wati lewat WhatsApp' })
    await expect(wa).toHaveAttribute('href', /^https:\/\/wa\.me\/6281200000007\?text=/)
    const href = (await wa.getAttribute('href')) ?? ''
    expect(href).toContain(number)
    expect(decodeURIComponent(href)).toContain('sudah siap diambil')
    expect(decodeURIComponent(href)).toContain('sisa Rp 52.000')
    const pickup = wati.getByRole('link', { name: `Diambil ${number}` })
    await expectTapTarget(wa)
    await expectTapTarget(pickup)

    await pickup.click()
    await expect(page).toHaveURL(/\/pesanan\/demo-order-04\?aksi=diambil$/)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Cucian diambil' })).toBeVisible()
    await expect(dialog.getByLabel('Jumlah')).toHaveValue('52.000')
    await dialog.getByRole('button', { name: 'Bayar & tandai diambil' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('order-status').first()).toHaveText('Selesai')

    // back on the dashboard: one fewer to pick up and to collect, the payment counted as money in today
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(tileValue(page, 'tile-siap')).toHaveText('2')
    await expect(page.getByTestId('ready-row')).toHaveCount(2)
    await expect(tileValue(page, 'tile-belum-bayar')).toHaveText('3')
    await expect(page.getByTestId('tile-belum-bayar')).toContainText('Rp 99.000')
    await expect(tileValue(page, 'tile-uang-masuk')).toHaveText('Rp 70.000')
    await expect(page.getByTestId('money-cash')).toContainText('Rp 52.000')
    await expectNoSideScroll(page)
    expect(errors, errors.join('\n')).toEqual([])
  })

  test('tiles open their lists; a Belum bayar row opens Terima pembayaran', async ({ page }) => {
    await loginDemo(page)
    await page.getByTestId('tile-siap').click()
    await expect(page).toHaveURL(/\/pesanan\?tab=siap$/)
    await expect(page.getByRole('tab', { name: /Siap/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('order-row')).toHaveCount(3)

    await page.goBack()
    await page.getByTestId('unpaid-row').filter({ hasText: 'Yoga Pratama' }).getByRole('link').click()
    await expect(page).toHaveURL(/\/pesanan\/demo-order-06\?aksi=bayar$/)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Terima pembayaran' })).toBeVisible()
    await expect(dialog.getByLabel('Jumlah')).toHaveValue('48.000')
  })

  test('staff see the same day but no 7-day chart and no way to Laporan', async ({ page }) => {
    await loginDemo(page)
    await page.evaluate((key) => {
      const db = JSON.parse(localStorage.getItem(key) ?? '{}')
      for (const m of db.organization_members) if (m.user_id === 'local-user') m.role = 'staff'
      localStorage.setItem(key, JSON.stringify(db))
    }, DB_KEY)
    await page.reload()
    await expect(tileValue(page, 'tile-masuk')).toHaveText('2')
    await expect(tileValue(page, 'tile-uang-masuk')).toHaveText('Rp 18.000')
    await expect(page.getByTestId('ready-row')).toHaveCount(3)
    await expect(page.getByTestId('money-card')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Laporan' })).toHaveCount(0)
    expect(await page.locator('a[href="/laporan"]').count()).toBe(0)
    await expectNoSideScroll(page)
  })
})
