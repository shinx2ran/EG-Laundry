import { test, expect, type Page } from '@playwright/test'

const DB_KEY = 'eglaundry.local.db.v1'

async function loginDemo(page: Page) {
  // the narrowest common Android width: every screen of the flow must fit without sideways scrolling
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Pesanan' }).first()).toBeVisible()
}

async function expectNoSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

async function orderCount(page: Page): Promise<number> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{"orders":[]}').orders.length as number, DB_KEY)
}

async function chooseCustomer(page: Page, name: string) {
  await page.getByLabel('Cari pelanggan').fill(name.split(' ')[0])
  await page.getByRole('list', { name: 'Pilih pelanggan' }).getByRole('button', { name: new RegExp(name) }).click()
  await expect(page.getByTestId('chosen-customer')).toContainText(name)
}

test.describe('Pesanan (Mode Demo, 360 px)', () => {
  test('new order with DP -> Siap diambil (WhatsApp) -> Diambil with pelunasan -> Selesai', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await loginDemo(page)

    await page.goto('/pesanan')
    await expect(page.getByRole('heading', { name: 'Pesanan', level: 1 })).toBeVisible()
    await expect(page.getByTestId('order-row').first()).toBeVisible()
    await expectNoSideScroll(page)
    await page.getByRole('link', { name: 'Pesanan baru' }).click()
    await expect(page).toHaveURL(/\/pesanan\/baru$/)

    // a demo tenant (Anak kos · B3) with a phone number
    await chooseCustomer(page, 'Yoga Pratama')
    await expect(page.getByTestId('chosen-customer')).toContainText('Anak kos · B3')

    const rows = page.getByTestId('item-row')
    await rows.nth(0).getByRole('combobox').selectOption('demo-svc-cuci-setrika')
    await rows.nth(0).getByLabel('Berat (kg)').fill('2,5')
    await page.getByRole('button', { name: 'Tambah layanan' }).click()
    await rows.nth(1).getByRole('combobox').selectOption('demo-svc-bed-cover')
    await expect(rows.nth(1).getByLabel('Jumlah (pcs)')).toHaveValue('1')
    await expect(page.getByRole('switch', { name: 'Express' })).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('draft-total')).toHaveText('Rp 45.000')

    await page.getByRole('switch', { name: 'Bayar sekarang' }).click()
    await page.getByLabel('Jumlah dibayar').fill('20000')
    await expect(page.getByText('DP · sisa Rp 25.000')).toBeVisible()
    await expectNoSideScroll(page)
    await page.getByRole('button', { name: 'Simpan pesanan' }).click()

    // the detail opens with the receipt ready to send
    await expect(page).toHaveURL(/\/pesanan\/[^/]+\?baru=1$/)
    const number = (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? ''
    expect(number).toMatch(/^LD-\d{6}-\d{4}$/)
    await expect(page.getByTestId('order-total')).toHaveText('Rp 45.000')
    await expect(page.getByTestId('pay-status').first()).toHaveText('Sebagian')
    await expect(page.getByTestId('order-outstanding')).toHaveText('Rp 25.000')
    await expect(page.getByTestId('order-status').first()).toHaveText('Diterima')
    const receipt = page.getByRole('link', { name: 'Kirim struk WhatsApp' }).first()
    await expect(receipt).toHaveAttribute('href', /wa\.me\/6281200000004\?text=/)
    expect(decodeURIComponent((await receipt.getAttribute('href')) ?? '')).toContain(`Pesanan ${number}`)
    await expectNoSideScroll(page)

    // Siap diambil -> WhatsApp "cucian siap diambil"
    await page.getByRole('button', { name: 'Siap diambil' }).click()
    await expect(page.getByTestId('order-status').first()).toHaveText('Siap diambil')
    const ready = page.getByRole('link', { name: 'Kabari: siap diambil' })
    await expect(ready).toHaveAttribute('href', /wa\.me/)
    const readyHref = (await ready.getAttribute('href')) ?? ''
    expect(readyHref).toContain(number)
    expect(decodeURIComponent(readyHref)).toContain('sisa Rp 25.000')

    // Diambil with the remaining payment in the same dialog
    await page.getByRole('button', { name: 'Diambil' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByLabel('Jumlah')).toHaveValue('25.000')
    await dialog.getByRole('button', { name: 'Bayar & tandai diambil' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('order-status').first()).toHaveText('Selesai')
    await expect(page.getByTestId('pay-status').first()).toHaveText('Lunas')
    await expect(page.getByTestId('order-outstanding')).toHaveText('Rp 0')
    await expect(page.getByTestId('order-payments').getByRole('listitem')).toHaveCount(2)

    // the list's Selesai tab shows it
    await page.getByRole('link', { name: 'Semua pesanan' }).click()
    await page.getByRole('tab', { name: /Selesai/ }).click()
    await expect(page).toHaveURL(/tab=selesai/)
    const row = page.locator(`[data-order-number="${number}"]`)
    await expect(row).toBeVisible()
    await expect(row).toContainText('Yoga Pratama')
    await expect(row).toContainText('Lunas')
    await expect(row).toContainText('Rp 45.000')
    await expectNoSideScroll(page)
    expect(errors).toEqual([])
  })

  test('express with a service that has no express price shows the error and saves nothing', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/pesanan/baru')
    await chooseCustomer(page, 'Rina Putri')
    const before = await orderCount(page)

    await page.getByRole('switch', { name: 'Express' }).click()
    const row = page.getByTestId('item-row').first()
    await row.getByRole('combobox').selectOption('demo-svc-bed-cover')
    await expect(row.getByTestId('line-problem')).toHaveText('Layanan Bed cover tidak ada harga express.')
    await page.getByRole('button', { name: 'Simpan pesanan' }).click()
    await expect(page.getByTestId('form-errors')).toContainText('Layanan Bed cover tidak ada harga express.')
    await expect(page).toHaveURL(/\/pesanan\/baru$/)
    expect(await orderCount(page)).toBe(before)

    // the express price applies to a service that has one
    await row.getByRole('combobox').selectOption('demo-svc-cuci-setrika')
    await row.getByLabel('Berat (kg)').fill('2')
    await expect(page.getByTestId('draft-total')).toHaveText('Rp 26.000')
    await expect(row.getByTestId('line-problem')).toHaveCount(0)
  })

  test('a new customer added inside the form, with ?customer= deep link and the package offer', async ({ page }) => {
    await loginDemo(page)
    // Rudi Hartono has a partly used 20 kg cuci setrika package (13 kg left)
    await page.goto('/pesanan/baru?customer=demo-cust-10')
    await expect(page.getByTestId('chosen-customer')).toContainText('Rudi Hartono')
    const row = page.getByTestId('item-row').first()
    await row.getByRole('combobox').selectOption('demo-svc-cuci-setrika')
    await row.getByLabel('Berat (kg)').fill('3')
    await row.getByText('Pakai paket (sisa 13 kg)').click()
    await expect(page.getByTestId('draft-total')).toHaveText('Rp 0')
    await page.getByRole('button', { name: 'Simpan pesanan' }).click()
    await expect(page).toHaveURL(/\?baru=1$/)
    await expect(page.getByTestId('order-items')).toContainText('3 kg dari paket')
    await expect(page.getByTestId('pay-status').first()).toHaveText('Lunas')

    // a walk-in without a phone, added from the form
    await page.goto('/pesanan/baru')
    await page.getByLabel('Cari pelanggan').fill('Ibu Tini')
    await page.getByRole('button', { name: 'Tambah pelanggan baru' }).click()
    await expect(page.getByLabel('Nama')).toHaveValue('Ibu Tini')
    await page.getByRole('button', { name: 'Simpan pelanggan' }).click()
    await expect(page.getByTestId('chosen-customer')).toContainText('Ibu Tini')
    await page.getByTestId('item-row').first().getByRole('combobox').selectOption('demo-svc-sepatu')
    await page.getByRole('button', { name: 'Simpan pesanan' }).click()
    await expect(page).toHaveURL(/\?baru=1$/)
    await expect(page.getByTestId('order-total')).toHaveText('Rp 35.000')
    // no phone: the WhatsApp button becomes ➕ Nomor HP belum diisi, opening the customer's form at the phone field
    await expect(page.getByRole('link', { name: /Nomor HP Ibu Tini belum diisi/ }).first()).toHaveAttribute('href', /\/pelanggan\/[^/]+\?isi=hp$/)
  })

  test('Ubah changes the weight, Terima pembayaran takes a DP, Ubah pembayaran stays within the total', async ({ page }) => {
    await loginDemo(page)
    // demo-order-00: Rina, Diterima, 3 kg cuci setrika = Rp 24.000, unpaid
    await page.goto('/pesanan/demo-order-00')
    await expect(page.getByTestId('order-total')).toHaveText('Rp 24.000')
    await page.getByRole('button', { name: 'Ubah', exact: true }).click()
    const edit = page.getByRole('dialog')
    await edit.getByLabel('Berat (kg)').fill('4,5')
    await edit.getByRole('button', { name: 'Simpan perubahan' }).click()
    await expect(edit).toHaveCount(0)
    await expect(page.getByTestId('order-total')).toHaveText('Rp 36.000')
    await expect(page.getByTestId('order-items')).toContainText('4,5 kg × Rp 8.000/kg')

    await page.getByRole('button', { name: 'Terima pembayaran' }).click()
    const pay = page.getByRole('dialog')
    await expect(pay.getByLabel('Jumlah')).toHaveValue('36.000')
    await pay.getByLabel('Jumlah').fill('40000')
    await expect(pay.getByRole('alert')).toHaveText('Jumlah melebihi sisa bayar (Rp 36.000).')
    await expect(pay.getByRole('button', { name: 'Simpan pembayaran' })).toBeDisabled()
    await pay.getByLabel('Jumlah').fill('10000')
    await pay.getByRole('radio', { name: 'QRIS' }).click()
    await pay.getByRole('button', { name: 'Simpan pembayaran' }).click()
    await expect(pay).toHaveCount(0)
    await expect(page.getByTestId('pay-status').first()).toHaveText('Sebagian')
    await expect(page.getByTestId('order-outstanding')).toHaveText('Rp 26.000')
    await expect(page.getByTestId('order-payments')).toContainText('QRIS')

    // owner: Ubah pembayaran up to what the order owes without it
    await page.getByRole('button', { name: 'Ubah pembayaran Rp 10.000' }).click()
    const fix = page.getByRole('dialog')
    await fix.getByLabel('Jumlah').fill('36001')
    await expect(fix.getByRole('alert')).toContainText('Rp 36.000')
    await fix.getByLabel('Jumlah').fill('36000')
    await fix.getByRole('button', { name: 'Simpan', exact: true }).click()
    await expect(fix).toHaveCount(0)
    await expect(page.getByTestId('pay-status').first()).toHaveText('Lunas')
    // paid: Batalkan is off now
    await expect(page.getByRole('button', { name: 'Batalkan', exact: true })).toBeDisabled()
  })

  test('cancel is refused with a payment; staff sees no Hapus and no payment corrections', async ({ page }) => {
    await loginDemo(page)
    // the Dashboard's deep link opens Diambil straight away (demo-order-04: Bu Wati, Siap, unpaid Rp 52.000)
    await page.goto('/pesanan/demo-order-04?aksi=diambil')
    await expect(page.getByRole('dialog').getByLabel('Jumlah')).toHaveValue('52.000')
    await page.getByRole('dialog').getByRole('button', { name: 'Batal' }).click()
    await expect(page).toHaveURL(/\/pesanan\/demo-order-04$/)

    // demo-order-02: Dimas, Proses, paid in full -> Batalkan is shown but off
    await page.goto('/pesanan/demo-order-02')
    await expect(page.getByRole('button', { name: 'Batalkan', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Hapus', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Ubah pembayaran/ })).toBeVisible()

    // demo-order-00: Rina, Diterima, unpaid -> cancel works
    await page.goto('/pesanan/demo-order-00')
    await page.getByRole('button', { name: 'Batalkan', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Batalkan pesanan' }).click()
    await expect(page.getByTestId('order-status').first()).toHaveText('Dibatalkan')

    // staff: no delete, no payment corrections, a done order cannot be edited
    await page.evaluate((key) => {
      const db = JSON.parse(localStorage.getItem(key) ?? '{}')
      for (const m of db.organization_members) if (m.user_id === 'local-user') m.role = 'staff'
      localStorage.setItem(key, JSON.stringify(db))
    }, DB_KEY)
    await page.goto('/pesanan/demo-order-02')
    await expect(page.getByRole('button', { name: 'Siap diambil' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hapus', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Ubah pembayaran/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Hapus pembayaran/ })).toHaveCount(0)
    await page.goto('/pesanan/demo-order-08')
    await expect(page.getByTestId('order-status').first()).toHaveText('Selesai')
    await expect(page.getByRole('button', { name: 'Ubah', exact: true })).toHaveCount(0)
  })

  test('Hapus goes straight back to the list without flashing "Pesanan tidak ditemukan"', async ({ page }) => {
    await loginDemo(page)
    await page.goto('/pesanan/demo-order-02')
    const number = (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? ''
    expect(number).toMatch(/^LD-\d{6}-\d{4}$/)
    // record every text the page ever shows from here on
    await page.evaluate(() => {
      const w = window as unknown as { __seen: string[] }
      w.__seen = []
      new MutationObserver(() => w.__seen.push(document.body.innerText)).observe(document.body, { childList: true, subtree: true, characterData: true })
    })
    await page.getByRole('button', { name: 'Hapus', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Hapus', exact: true }).click()
    await expect(page).toHaveURL(/\/pesanan$/)
    await expect(page.getByText(`Pesanan ${number} dihapus.`)).toBeVisible()
    await expect(page.getByTestId('order-row').first()).toBeVisible()
    const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)
    expect(seen.some((t) => t.includes('Pesanan tidak ditemukan'))).toBe(false)
    expect(await orderCount(page)).toBeGreaterThan(30)
  })
})
