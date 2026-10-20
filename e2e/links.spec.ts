import { test, expect, type Page } from '@playwright/test'

// The links between Pelanggan, Pesanan and Daftar harga, in Mode Demo.

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Pesanan' }).first()).toBeVisible()
}

async function expectNoSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test.use({ timezoneId: 'Asia/Jakarta' })

test.describe('Pelanggan <-> Pesanan (Mode Demo, 360 px)', () => {
  test('a new order from the customer page, its ➕ Nomor HP, and the links both ways', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await loginDemo(page)

    // Mega (demo-cust-11) is a walk-in without a phone number
    await page.goto('/pelanggan/demo-cust-11')
    await expect(page.getByRole('heading', { level: 1, name: 'Mega' })).toBeVisible()
    await expectNoSideScroll(page)
    await page.getByRole('link', { name: 'Pesanan baru' }).click()
    await expect(page).toHaveURL(/\/pesanan\/baru\?customer=demo-cust-11$/)
    await expect(page.getByTestId('chosen-customer')).toContainText('Mega')
    await page.getByTestId('item-row').first().getByRole('combobox').selectOption('demo-svc-sepatu')
    await page.getByRole('button', { name: 'Simpan pesanan' }).click()
    await expect(page).toHaveURL(/\/pesanan\/[^/?]+\?baru=1$/)
    const orderUrl = new URL(page.url()).pathname
    const orderNumber = (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? ''
    expect(orderNumber).toMatch(/^LD-\d{6}-\d{4}$/)

    // no phone: the receipt card offers ➕ Nomor HP, which opens the customer's form at the phone field
    await page.getByRole('link', { name: 'Nomor HP Mega belum diisi: isi sekarang' }).first().click()
    await expect(page).toHaveURL(/\/pelanggan\/demo-cust-11\?isi=hp$/)
    const form = page.getByRole('dialog')
    await expect(form.getByRole('heading', { name: 'Ubah pelanggan' })).toBeVisible()
    await expect(form.getByLabel('Nomor HP / WhatsApp')).toBeFocused()
    await form.getByRole('button', { name: 'Batal' }).click()
    await expect(page).toHaveURL(/\/pelanggan\/demo-cust-11$/)

    // the customer's history lists the new order and opens it
    const historyRow = page.getByTestId('order-row').filter({ hasText: orderNumber })
    await expect(historyRow).toHaveCount(1)
    await historyRow.getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`${orderUrl}$`))

    // and the order's customer card leads back to the customer
    await page.getByRole('link', { name: 'Mega', exact: true }).click()
    await expect(page).toHaveURL(/\/pelanggan\/demo-cust-11$/)
  })
})

test.describe('Daftar harga in the navigation', () => {
  test('the desktop sidebar lists Daftar harga; on a phone it stays out of the bottom bar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await loginDemo(page)
    await page.getByRole('link', { name: 'Daftar harga', exact: true }).click()
    await expect(page).toHaveURL(/\/harga$/)
    await expect(page.getByRole('heading', { name: 'Daftar harga' })).toBeVisible()

    await page.setViewportSize({ width: 360, height: 780 })
    await expect(page.getByRole('link', { name: 'Daftar harga', exact: true })).toHaveCount(0)
    await expectNoSideScroll(page)
  })
})
