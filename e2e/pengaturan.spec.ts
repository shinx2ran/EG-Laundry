import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const PHONE = { width: 360, height: 780 }
const WOOMBAD_FIXTURE = path.resolve(process.cwd(), 'src/features/impor/__fixtures__/woombad-backup.json')

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)

async function openSettings(page: Page) {
  await page.setViewportSize(PHONE)
  await page.goto('/login')
  await page.getByRole('button', { name: 'Masuk ke Mode Demo' }).click()
  await page.waitForURL(/\/dashboard$/)
  await page.goto('/pengaturan')
  await expect(page.getByRole('heading', { name: 'Pengaturan' })).toBeVisible()
}

test.use({ timezoneId: 'Asia/Jakarta' })

test.describe('Pengaturan (Mode Demo, 360px)', () => {
  test('Pesan WhatsApp: the preview greets Budi, the saved template survives a reload', async ({ page }) => {
    await openSettings(page)
    await expect(page.getByRole('heading', { name: 'Pesan WhatsApp' })).toBeVisible()
    const template = page.getByLabel('Template promo')
    await template.fill('Halo {nama}! Minggu ini cuci setrika diskon 10% di EG Laundry.')
    await expect(page.getByTestId('preview-promo')).toHaveText('Halo Budi! Minggu ini cuci setrika diskon 10% di EG Laundry.')
    await page.getByLabel('Footer pesan').fill('Buka 07.00-21.00 · QRIS di kasir')
    await expect(page.getByTestId('preview-ready')).toContainText('Halo Budi, cucian Anda di EG Laundry (Demo) sudah siap diambil')
    await expect(page.getByTestId('preview-ready')).toContainText('Buka 07.00-21.00 · QRIS di kasir')
    // a template without {nama} gets a hint
    await template.fill('Diskon 10%!')
    await expect(page.getByText('Tambahkan {nama} supaya pesan menyapa pelanggan dengan namanya.')).toBeVisible()
    await template.fill('Halo {nama}! Minggu ini cuci setrika diskon 10% di EG Laundry.')
    expect(await noHorizontalScroll(page)).toBe(true)

    await page.getByRole('button', { name: 'Simpan pesan' }).click()
    await expect(page.getByText('Pesan WhatsApp disimpan.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Simpan pesan' })).toBeDisabled()
    await page.reload()
    await expect(page.getByLabel('Template promo')).toHaveValue('Halo {nama}! Minggu ini cuci setrika diskon 10% di EG Laundry.')
    await expect(page.getByLabel('Footer pesan')).toHaveValue('Buka 07.00-21.00 · QRIS di kasir')
    await expect(page.getByTestId('preview-promo')).toHaveText('Halo Budi! Minggu ini cuci setrika diskon 10% di EG Laundry.')
  })

  test('Impor penyewa: the Woombad fixture previews the counts, Terapkan marks the tenants with their rooms', async ({ page }) => {
    await openSettings(page)
    await expect(page.getByRole('heading', { name: 'Impor penyewa dari Woombad' })).toBeVisible()
    await page.getByLabel('Berkas cadangan Woombad').setInputFiles(WOOMBAD_FIXTURE)
    const preview = page.getByTestId('tenant-import-preview')
    await expect(preview).toContainText('EG Kost (contoh)')
    await expect(page.getByTestId('import-count-update')).toContainText('2')
    await expect(page.getByTestId('import-count-create')).toContainText('3')
    await expect(page.getByTestId('import-count-deactivate')).toContainText('1')
    await expect(page.getByTestId('import-count-nophone')).toContainText('1')
    await expect(page.getByTestId('import-group-create')).toContainText('Fajar Nugroho · kamar D4')
    await expect(page.getByTestId('import-group-update')).toContainText('Sari Dewi · kamar B2')
    await expect(page.getByTestId('import-group-deactivate')).toContainText('Yoga Pratama · dulu kamar B3')
    expect(await noHorizontalScroll(page)).toBe(true)

    // "Buat pelanggan baru" off: nothing new, back on for the import
    const create = page.getByRole('switch', { name: 'Buat pelanggan baru' })
    await create.click()
    await expect(page.getByTestId('import-count-create')).toContainText('0')
    await expect(page.getByTestId('import-group-skipped')).toContainText('Fajar Nugroho')
    await create.click()
    await expect(page.getByTestId('import-count-create')).toContainText('3')

    await page.getByRole('button', { name: 'Terapkan' }).click()
    await expect(page.getByText('Impor selesai: 2 diperbarui, 3 baru, 1 dinonaktifkan.')).toBeVisible()
    await expect(preview).toHaveCount(0)

    await page.goto('/pelanggan')
    await page.getByRole('radio', { name: 'Anak kos (7)' }).click()
    const rows = page.getByTestId('customer-row')
    await expect(rows).toHaveCount(7)
    await expect(rows.filter({ hasText: 'Fajar Nugroho' })).toContainText('Anak kos · D4')
    await expect(rows.filter({ hasText: 'Bayu Saputra' })).toContainText('Anak kos · E1')
    await expect(rows.filter({ hasText: 'Sari Dewi' })).toContainText('Anak kos · B2')
    await expect(rows.filter({ hasText: 'Yoga Pratama' })).toHaveCount(0)
    expect(await noHorizontalScroll(page)).toBe(true)
  })

  test('Impor penyewa refuses a file that is not a Woombad backup', async ({ page }) => {
    await openSettings(page)
    await page.getByLabel('Berkas cadangan Woombad').setInputFiles({ name: 'catatan.json', mimeType: 'application/json', buffer: Buffer.from('{"halo": 1}') })
    await expect(page.getByRole('alert')).toHaveText('Berkas bukan cadangan Woombad.')
    await expect(page.getByTestId('tenant-import-preview')).toHaveCount(0)
  })

  test('Mode Demo shows the move-to-online card as not available yet', async ({ page }) => {
    await openSettings(page)
    const card = page.getByTestId('demo-import-card')
    await expect(card.getByRole('heading', { name: 'Pindahkan data Mode Demo ke online' })).toBeVisible()
    await expect(card).toContainText('Tersedia setelah terhubung ke Supabase')
    await expect(card.getByRole('button')).toHaveCount(0)
  })

  test('staff does not see Pesan WhatsApp, Impor penyewa or Pindahkan data', async ({ page }) => {
    await openSettings(page)
    await page.evaluate(() => {
      const raw = localStorage.getItem('eglaundry.local.db.v1')
      if (!raw) return
      const db = JSON.parse(raw)
      for (const m of db.organization_members) if (m.user_id === 'local-user') m.role = 'staff'
      localStorage.setItem('eglaundry.local.db.v1', JSON.stringify(db))
    })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Anggota' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Pesan WhatsApp' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Impor penyewa dari Woombad' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Pindahkan data Mode Demo ke online' })).toHaveCount(0)
    await expect(page.getByLabel('Berkas cadangan Woombad')).toHaveCount(0)
    expect(await noHorizontalScroll(page)).toBe(true)
  })
})
