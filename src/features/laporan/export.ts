/**
 * Unduh XLSX / CSV for the Laporan tables (SPEC 3.7), ported from the kos app's export helpers: rows become flat
 * sheets with Indonesian headers ('date' cells hold 'YYYY-MM-DD', 'money' cells integer rupiah), written as XLSX
 * (write-excel-file, lazy-loaded) or as CSV with a UTF-8 BOM and ';' (Indonesian Excel). Everything here is pure;
 * the download itself is `downloadBlob` (src/components/deviceData).
 */
import type { CellObject, Row, Sheet, SheetData } from 'write-excel-file/browser'
import type { Customer } from '../../types/db'
import type { AbsentRow, CustomerReportRow, OrdersSummary } from './reportModel'
import { isValidDateISO, type DateRange } from '../../lib/dateRange'

export type CellType = 'string' | 'number' | 'money' | 'date'
export type ExportCell = string | number | null

export interface ExportColumn {
  key: string
  header: string
  type: CellType
}

export interface ExportSheet {
  /** sheet name, <= 31 chars, no []:*?/\ */
  name: string
  columns: ExportColumn[]
  rows: Record<string, ExportCell>[]
}

/** Placeholder for an empty text cell. */
export const MISSING = '-'

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const CSV_MIME = 'text/csv;charset=utf-8'
export const MONEY_FORMAT = '#,##0'
export const DATE_FORMAT = 'dd/mm/yyyy'

function text(value: string | null | undefined): string {
  const t = value?.trim()
  return t ? t : MISSING
}

const TENANT_LABEL = 'Anak kos'
const WALKIN_LABEL = 'Umum'

function customerCells(c: Customer): Record<string, ExportCell> {
  return {
    name: c.name,
    phone: text(c.phone),
    kind: c.is_tenant ? TENANT_LABEL : WALKIN_LABEL,
    room: c.is_tenant ? text(c.room_name) : MISSING,
  }
}

const CUSTOMER_COLUMNS: ExportColumn[] = [
  { key: 'name', header: 'Nama', type: 'string' },
  { key: 'phone', header: 'HP', type: 'string' },
  { key: 'kind', header: 'Jenis', type: 'string' },
  { key: 'room', header: 'Kamar', type: 'string' },
]

// ---------- sheets ----------

/**
 * Per service of the range: Layanan, Satuan, Pesanan, Jumlah, Dari paket, Nilai; then 'Diskon' (negative, when
 * there was any) and 'Total' (orders, value after discounts), so the Nilai column adds up to the order value.
 */
export function buildServicesSheet(summary: OrdersSummary): ExportSheet {
  const rows: Record<string, ExportCell>[] = summary.services.map((s) => ({
    service: s.service_name,
    unit: s.unit,
    orders: s.orders,
    qty: s.qty,
    from_package: s.qtyFromPackage,
    value: s.value,
  }))
  if (summary.discount > 0) rows.push({ service: 'Diskon', unit: null, orders: null, qty: null, from_package: null, value: -summary.discount })
  rows.push({ service: 'Total', unit: null, orders: summary.count, qty: null, from_package: null, value: summary.value })
  return {
    name: 'Per layanan',
    columns: [
      { key: 'service', header: 'Layanan', type: 'string' },
      { key: 'unit', header: 'Satuan', type: 'string' },
      { key: 'orders', header: 'Pesanan', type: 'number' },
      { key: 'qty', header: 'Jumlah', type: 'number' },
      { key: 'from_package', header: 'Dari paket', type: 'number' },
      { key: 'value', header: 'Nilai', type: 'money' },
    ],
    rows,
  }
}

/** The Pelanggan table as shown (filter and order kept). */
export function buildCustomersSheet(rows: CustomerReportRow[]): ExportSheet {
  return {
    name: 'Pelanggan',
    columns: [
      ...CUSTOMER_COLUMNS,
      { key: 'last_visit', header: 'Kunjungan terakhir', type: 'date' },
      { key: 'orders30', header: 'Pesanan 30 hari', type: 'number' },
      { key: 'orders90', header: 'Pesanan 90 hari', type: 'number' },
      { key: 'orders', header: 'Pesanan periode', type: 'number' },
      { key: 'kg', header: 'Kg periode', type: 'number' },
      { key: 'pcs', header: 'Pcs periode', type: 'number' },
      { key: 'value', header: 'Nilai periode', type: 'money' },
    ],
    rows: rows.map((r) => ({
      ...customerCells(r.customer),
      last_visit: r.lastVisit,
      orders30: r.orders30,
      orders90: r.orders90,
      orders: r.ordersInRange,
      kg: r.kg,
      pcs: r.pcs,
      value: r.value,
    })),
  }
}

/** The Lama tidak datang list: longest absence first. */
export function buildAbsentSheet(rows: AbsentRow[]): ExportSheet {
  return {
    name: 'Lama tidak datang',
    columns: [
      ...CUSTOMER_COLUMNS,
      { key: 'last_visit', header: 'Kunjungan terakhir', type: 'date' },
      { key: 'days', header: 'Hari tidak datang', type: 'number' },
      { key: 'orders', header: 'Jumlah pesanan', type: 'number' },
    ],
    rows: rows.map((r) => ({ ...customerCells(r.customer), last_visit: r.lastVisit, days: r.daysAway, orders: r.orderCount })),
  }
}

// ---------- CSV ----------

/** Leading characters a spreadsheet may read as a formula (OWASP CSV injection list). */
const FORMULA_LEAD = ['=', '+', '-', '@', '\t', '\r']

/** A signed plain number or percentage ('-68%', '+6281234'): never a formula, so it is not guarded. */
const SIGNED_NUMBER = /^[-+]\d[\d.,]*%?$/

/** "'" in front of a text cell that starts like a formula; the '-' placeholder and signed numbers stay as they are. */
function guardFormula(value: string): string {
  if (value === '' || value === MISSING || SIGNED_NUMBER.test(value)) return value
  return FORMULA_LEAD.includes(value[0] ?? '') ? `'${value}` : value
}

function csvEscape(value: string, delimiter: string): string {
  const needsQuotes = value.includes(delimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value
}

/** null -> ''; numbers as plain digits (no separators, '.' for decimals); text formula-guarded and quoted when needed. */
export function csvCell(cell: ExportCell | undefined, delimiter: ';' | ',' = ';'): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'number') return String(cell)
  return csvEscape(guardFormula(cell), delimiter)
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens it right; ';' by default (Indonesian Excel). */
export function toCsv(sheet: ExportSheet, delimiter: ';' | ',' = ';'): string {
  const lines: string[] = [sheet.columns.map((c) => csvEscape(c.header, delimiter)).join(delimiter)]
  for (const row of sheet.rows) lines.push(sheet.columns.map((c) => csvCell(row[c.key], delimiter)).join(delimiter))
  return `﻿${lines.join('\r\n')}`
}

/** 'Lama tidak datang!' -> 'lama-tidak-datang'. */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** 'eg-laundry-layanan-2026-10-01_2026-10-31.xlsx' */
export function exportFileName(what: string, range: DateRange, ext: 'csv' | 'xlsx'): string {
  const slug = slugify(what)
  return `${slug ? `eg-laundry-${slug}` : 'eg-laundry'}-${range.start}_${range.end}.${ext}`
}

// ---------- XLSX ----------

/** Excel sheet names: at most 31 characters, none of []:*?/\ . */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, ' ').trim()
  return (cleaned === '' ? 'Lembar' : cleaned).slice(0, 31)
}

/** money -> Number '#,##0'; date -> Date 'dd/mm/yyyy' (text when not a date); number -> Number; null -> empty. */
export function toXlsxCell(cell: ExportCell | undefined, type: CellType): CellObject | null {
  if (cell === null || cell === undefined) return null
  if (typeof cell === 'number') return type === 'money' ? { value: cell, type: Number, format: MONEY_FORMAT } : { value: cell, type: Number }
  if (type === 'date' && isValidDateISO(cell)) {
    const [y, m, d] = cell.split('-').map(Number)
    return { value: new Date(y, m - 1, d), type: Date, format: DATE_FORMAT }
  }
  return { value: cell, type: String }
}

/** Bold header row + one row per data row; column widths from the longest text (10..48). */
export function toXlsxSheet(sheet: ExportSheet): Sheet<Blob> {
  const header: Row = sheet.columns.map((c) => ({ value: c.header, type: String, fontWeight: 'bold' }))
  const data: SheetData = [header]
  for (const row of sheet.rows) data.push(sheet.columns.map((c) => toXlsxCell(row[c.key], c.type)))
  const widths = sheet.columns.map((c) => {
    let max = c.header.length
    for (const row of sheet.rows) {
      const v = row[c.key]
      const len = v === null || v === undefined ? 0 : String(v).length
      if (len > max) max = len
    }
    return { width: Math.min(48, Math.max(10, max + 2)) }
  })
  return { data, sheet: safeSheetName(sheet.name), columns: widths }
}

/** An XLSX workbook, one sheet per ExportSheet (the writer is loaded on first use). */
export async function buildXlsxBlob(sheets: ExportSheet[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser')
  return writeXlsxFile(sheets.map(toXlsxSheet)).toBlob()
}

export function buildCsvBlob(sheet: ExportSheet, delimiter: ';' | ',' = ';'): Blob {
  return new Blob([toCsv(sheet, delimiter)], { type: CSV_MIME })
}
