import { test, expect, type Page } from '@playwright/test'

const PHONE = { width: 360, height: 780 }

async function loginDemo(page: Page) {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
}

async function openCustomers(page: Page) {
  await page.setViewportSize(PHONE)
  await loginDemo(page)
  await page.goto('/pelanggan')
  await expect(page.getByTestId('customer-row').first()).toBeVisible()
}

const rows = (page: Page) => page.getByTestId('customer-row')

test.use({ timezoneId: 'Asia/Jakarta' })

test.describe('Pelanggan (Mode Demo, 360px)', () => {
  test('a customer added without a phone: the ➕ bubble opens the form at Nomor HP, then becomes WhatsApp', async ({ page }) => {
    await openCustomers(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    // the header button is hidden on a phone; the FAB carries the same name
    await page.getByRole('button', { name: 'Tambah pelanggan' }).click()
    const form = page.getByRole('dialog')
    await expect(form.getByRole('heading', { name: 'Tambah pelanggan' })).toBeVisible()
    await form.getByLabel('Nama').fill('Tanpa Nomor')
    await form.getByRole('button', { name: 'Simpan' }).click()
    await expect(form).toBeHidden()
    await expect(page).toHaveURL(/\/pelanggan$/)

    await page.getByLabel('Cari pelanggan').fill('tanpa')
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText('HP belum diisi')
    const fill = page.getByRole('link', { name: 'Nomor HP Tanpa Nomor belum diisi: isi sekarang' })
    await expect(fill).toBeVisible()
    await fill.click()

    await page.waitForURL(/\/pelanggan\/[^/?]+\?isi=hp$/)
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Ubah pelanggan' })).toBeVisible()
    const phone = dialog.getByLabel('Nomor HP / WhatsApp')
    await expect(phone).toBeFocused()
    await expect(dialog.getByText(/Isi nomor HP supaya pesan WhatsApp bisa dikirim/)).toBeVisible()
    await page.keyboard.type('0812-3456-7890')
    await expect(dialog.getByText('Dikenali sebagai +6281234567890')).toBeVisible()
    await dialog.getByRole('button', { name: 'Simpan perubahan' }).click()
    await expect(dialog).toBeHidden()
    // the param is dropped, so the form does not reopen on reload
    await expect(page).toHaveURL(/\/pelanggan\/[^/?]+$/)
    await expect(page.getByRole('link', { name: 'WhatsApp Tanpa Nomor' })).toHaveAttribute('href', 'https://wa.me/6281234567890')

    await page.goto('/pelanggan')
    await page.getByLabel('Cari pelanggan').fill('0812-3456')
    await expect(rows(page)).toHaveCount(1)
    await expect(page.getByRole('link', { name: 'Nomor HP Tanpa Nomor belum diisi: isi sekarang' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'WhatsApp Tanpa Nomor' })).toHaveAttribute('href', 'https://wa.me/6281234567890')
  })

  test('the Anak kos chip shows only tenants with their rooms, Umum only walk-ins', async ({ page }) => {
    await openCustomers(page)
    await expect(rows(page)).toHaveCount(12)
    await page.getByRole('radio', { name: 'Anak kos (5)' }).click()
    await expect(page).toHaveURL(/jenis=kos/)
    await expect(rows(page)).toHaveCount(5)
    expect(await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-tenant')))).toEqual(['1', '1', '1', '1', '1'])
    await expect(rows(page).filter({ hasText: 'Anak kos · B3' })).toHaveCount(1)
    await page.getByRole('radio', { name: 'Umum (7)' }).click()
    await expect(page).toHaveURL(/jenis=umum/)
    await expect(rows(page)).toHaveCount(7)
    expect(await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-tenant')))).toEqual(Array(7).fill('0'))
    await expect(rows(page).filter({ hasText: 'Anak kos' })).toHaveCount(0)
    // the filter survives a reload and a search narrows within it
    await page.reload()
    await expect(rows(page)).toHaveCount(7)
    await page.getByLabel('Cari pelanggan').fill('bu wati')
    await expect(rows(page)).toHaveCount(1)
    await page.getByRole('radio', { name: 'Semua (12)' }).click()
    await expect(page).not.toHaveURL(/jenis=/)
  })

  test('selling a package shows it with its remaining quantity on the customer', async ({ page }) => {
    await openCustomers(page)
    await page.getByLabel('Cari pelanggan').fill('dimas')
    // the search is debounced: wait until only Dimas is listed before tapping the row
    await expect(rows(page)).toHaveCount(1)
    await rows(page).filter({ hasText: 'Dimas Saputra' }).getByTestId('customer-link').click()
    await page.waitForURL(/\/pelanggan\/demo-cust-02$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dimas Saputra')
    await expect(page.getByTestId('package-row')).toHaveCount(0)

    await page.getByRole('button', { name: 'Jual paket' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Jual paket prabayar' })).toBeVisible()
    await expect(dialog.getByLabel('Paket')).toHaveValue('demo-pkg-20kg')
    // the summary box (the option label also carries the price, so match the whole text)
    await expect(dialog.getByText('Rp 140.000', { exact: true })).toBeVisible()
    await dialog.getByLabel('Metode bayar').selectOption('qris')
    await dialog.getByRole('button', { name: 'Simpan' }).click()
    await expect(dialog).toBeHidden()

    const pkg = page.getByTestId('package-row')
    await expect(pkg).toHaveCount(1)
    await expect(pkg).toContainText('Paket 20 kg cuci setrika')
    await expect(pkg).toContainText('Sisa 20 kg dari 20 kg')
    await expect(pkg).toContainText('QRIS')
    await expect(pkg.getByText('Aktif')).toBeVisible()

    // sold by mistake: the owner removes the unused sale again
    await pkg.getByRole('button', { name: 'Hapus paket Paket 20 kg cuci setrika' }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Hapus paket terjual?' })).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Hapus', exact: true }).click()
    await expect(page.getByTestId('package-row')).toHaveCount(0)

    // a customer whose package is partly used shows what is left (Rudi: 20 - 3 - 4); in use, it cannot be removed
    await page.goto('/pelanggan/demo-cust-10')
    await expect(page.getByTestId('package-row')).toContainText('Sisa 13 kg dari 20 kg')
    await expect(page.getByTestId('package-row').getByRole('button', { name: /Hapus paket/ })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})
