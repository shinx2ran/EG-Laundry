// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Customer } from '../../types/db'
import {
  buildAbsentSheet,
  buildCsvBlob,
  buildCustomersSheet,
  buildServicesSheet,
  buildXlsxBlob,
  csvCell,
  exportFileName,
  safeSheetName,
  slugify,
  toCsv,
  toXlsxCell,
  toXlsxSheet,
  type ExportSheet,
} from './export'
import type { AbsentRow, CustomerReportRow, OrdersSummary } from './reportModel'

const ts = { org_id: 'org', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const ani: Customer = { id: 'c1', name: 'Ani', phone: '0812-1111-0001', is_tenant: true, room_name: 'A1', kos_tenant_id: null, address: null, notes: null, ...ts }
const budi: Customer = { id: 'c2', name: '=Budi; "B"', phone: null, is_tenant: false, room_name: 'X', kos_tenant_id: null, address: null, notes: null, ...ts }

const summary: OrdersSummary = {
  count: 3,
  kg: 10,
  pcs: 1,
  value: 74_000,
  subtotal: 76_000,
  discount: 2_000,
  services: [
    { key: 'cuci kering|kg', service_name: 'Cuci kering', unit: 'kg', orders: 1, qty: 4.5, qtyFromPackage: 0, value: 27_000 },
    { key: 'cuci setrika|kg', service_name: 'Cuci setrika', unit: 'kg', orders: 2, qty: 5.5, qtyFromPackage: 2.5, value: 49_000 },
  ],
}

describe('sheets', () => {
  it('per service, with Diskon and Total rows so Nilai adds up to the order value', () => {
    const sheet = buildServicesSheet(summary)
    expect(sheet.name).toBe('Per layanan')
    expect(sheet.columns.map((c) => c.header)).toEqual(['Layanan', 'Satuan', 'Pesanan', 'Jumlah', 'Dari paket', 'Nilai'])
    expect(sheet.rows).toEqual([
      { service: 'Cuci kering', unit: 'kg', orders: 1, qty: 4.5, from_package: 0, value: 27_000 },
      { service: 'Cuci setrika', unit: 'kg', orders: 2, qty: 5.5, from_package: 2.5, value: 49_000 },
      { service: 'Diskon', unit: null, orders: null, qty: null, from_package: null, value: -2_000 },
      { service: 'Total', unit: null, orders: 3, qty: null, from_package: null, value: 74_000 },
    ])
    expect(sheet.rows.slice(0, -1).reduce((s, r) => s + (r.value as number), 0)).toBe(74_000)
    // without a discount there is no Diskon row
    expect(buildServicesSheet({ ...summary, discount: 0, value: 76_000 }).rows.map((r) => r.service)).toEqual(['Cuci kering', 'Cuci setrika', 'Total'])
  })

  it('customers: name, phone, Anak kos / Umum with the room, visits and the range figures', () => {
    const rows: CustomerReportRow[] = [
      { customer: ani, lastVisit: '2026-10-20', orders30: 2, orders90: 5, ordersInRange: 2, kg: 5.5, pcs: 1, value: 49_000 },
      { customer: budi, lastVisit: null, orders30: 0, orders90: 0, ordersInRange: 0, kg: 0, pcs: 0, value: 0 },
    ]
    const sheet = buildCustomersSheet(rows)
    expect(sheet.columns.map((c) => c.header)).toEqual(['Nama', 'HP', 'Jenis', 'Kamar', 'Kunjungan terakhir', 'Pesanan 30 hari', 'Pesanan 90 hari', 'Pesanan periode', 'Kg periode', 'Pcs periode', 'Nilai periode'])
    expect(sheet.rows[0]).toEqual({ name: 'Ani', phone: '0812-1111-0001', kind: 'Anak kos', room: 'A1', last_visit: '2026-10-20', orders30: 2, orders90: 5, orders: 2, kg: 5.5, pcs: 1, value: 49_000 })
    // a walk-in's room is never shown; missing text is '-'
    expect(sheet.rows[1]).toMatchObject({ phone: '-', kind: 'Umum', room: '-', last_visit: null })
  })

  it('lama tidak datang', () => {
    const rows: AbsentRow[] = [{ customer: ani, lastVisit: '2026-09-25', daysAway: 25, orderCount: 2 }]
    const sheet = buildAbsentSheet(rows)
    expect(sheet.name).toBe('Lama tidak datang')
    expect(sheet.rows).toEqual([{ name: 'Ani', phone: '0812-1111-0001', kind: 'Anak kos', room: 'A1', last_visit: '2026-09-25', days: 25, orders: 2 }])
  })
})

const sheet: ExportSheet = {
  name: 'Pelanggan',
  columns: [
    { key: 'date', header: 'Tanggal', type: 'date' },
    { key: 'name', header: 'Nama', type: 'string' },
    { key: 'value', header: 'Nilai', type: 'money' },
    { key: 'qty', header: 'Kg', type: 'number' },
  ],
  rows: [
    { date: '2026-10-05', name: 'Ani', value: 49_000, qty: 5.5 },
    { date: null, name: '=Budi; "B"', value: -2_000, qty: null },
  ],
}

describe('CSV', () => {
  it('BOM, ";" separator, plain numbers, quoting and the formula guard', () => {
    const csv = toCsv(sheet)
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual(['Tanggal;Nama;Nilai;Kg', '2026-10-05;Ani;49000;5.5', `;"'=Budi; ""B""";-2000;`])
    expect(toCsv(sheet, ',').split('\r\n')[2]).toBe(`,"'=Budi; ""B""",-2000,`)
    expect(toCsv({ ...sheet, rows: [{ date: '2026-10-05', name: 'Ani; Budi', value: 1, qty: 1 }] }, ',').split('\r\n')[1]).toBe('2026-10-05,Ani; Budi,1,1')
  })

  it('csvCell leaves the placeholder and signed numbers alone', () => {
    expect(csvCell('-')).toBe('-')
    expect(csvCell('+6281211110001')).toBe('+6281211110001')
    expect(csvCell('-5 ribu')).toBe("'-5 ribu")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell(null)).toBe('')
    expect(csvCell(0)).toBe('0')
  })

  it('buildCsvBlob is UTF-8 with a BOM', async () => {
    const blob = buildCsvBlob(sheet)
    expect(Array.from(new Uint8Array(await blob.slice(0, 3).arrayBuffer()))).toEqual([0xef, 0xbb, 0xbf])
    expect(await blob.text()).toContain('2026-10-05;Ani;49000;5.5')
  })
})

describe('file names', () => {
  it('eg-laundry-<what>-<from>_<to>', () => {
    const range = { start: '2026-10-01', end: '2026-10-31' }
    expect(exportFileName('layanan', range, 'xlsx')).toBe('eg-laundry-layanan-2026-10-01_2026-10-31.xlsx')
    expect(exportFileName('Lama tidak datang', range, 'csv')).toBe('eg-laundry-lama-tidak-datang-2026-10-01_2026-10-31.csv')
    expect(exportFileName('!!', range, 'csv')).toBe('eg-laundry-2026-10-01_2026-10-31.csv')
    expect(slugify('  Per Layanan / Okt ')).toBe('per-layanan-okt')
  })
})

describe('XLSX', () => {
  it('cells: money with thousands, dates as dates, text otherwise', () => {
    expect(toXlsxCell(49_000, 'money')).toEqual({ value: 49_000, type: Number, format: '#,##0' })
    expect(toXlsxCell(5.5, 'number')).toEqual({ value: 5.5, type: Number })
    const date = toXlsxCell('2026-10-05', 'date')
    expect(date?.type).toBe(Date)
    expect(date?.format).toBe('dd/mm/yyyy')
    const value = date?.value
    expect(value).toBeInstanceOf(Date)
    expect([(value as Date).getFullYear(), (value as Date).getMonth(), (value as Date).getDate()]).toEqual([2026, 9, 5])
    expect(toXlsxCell('-', 'date')).toEqual({ value: '-', type: String })
    expect(toXlsxCell(null, 'money')).toBeNull()
  })

  it('a bold header, one row per data row, column widths', () => {
    const out = toXlsxSheet(sheet)
    expect(out.sheet).toBe('Pelanggan')
    expect(out.data).toHaveLength(3)
    expect(out.data[0]?.[0]).toEqual({ value: 'Tanggal', type: String, fontWeight: 'bold' })
    expect(out.data[2]?.[0]).toBeNull()
    expect(out.columns?.[1]?.width).toBe('=Budi; "B"'.length + 2)
    expect(safeSheetName('A/B:C*D?')).toBe('A B C D')
    expect(safeSheetName('x'.repeat(40))).toHaveLength(31)
    expect(safeSheetName(' ')).toBe('Lembar')
  })

  it('buildXlsxBlob returns a zip', async () => {
    const blob = await buildXlsxBlob([sheet])
    expect(blob.size).toBeGreaterThan(500)
    expect(Array.from(new Uint8Array(await blob.slice(0, 2).arrayBuffer()))).toEqual([0x50, 0x4b])
  })
})
