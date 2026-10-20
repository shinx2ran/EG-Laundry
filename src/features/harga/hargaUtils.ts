/**
 * Pure helpers of the price list (SPEC 3.1) and the package catalog (SPEC 3.4): form values, validation
 * with Indonesian messages, grouping/ordering of services, and "is it still used" checks that decide
 * between delete and deactivate. No I/O; everything here is unit-tested.
 */
import type { CustomerPackage, OrderItem, PackageCatalogItem, Service, Unit } from '../../types/db'
import { UNITS, UNIT_LABEL } from '../../types/db'
import { ERR_QTY_POSITIVE, qtyProblem, roundQty } from '../../domain/pricing'
import { formatQty, formatRupiah } from '../../lib/format'

// ---------- Indonesian texts ----------

/** Thrown by the action hook before any write when a staff member tries to change prices (SPEC 3.10). */
export const STAFF_PRICE_MESSAGE = 'Hanya pemilik/admin yang dapat mengubah daftar harga.'
export const STAFF_PACKAGE_MESSAGE = 'Hanya pemilik/admin yang dapat mengubah katalog paket.'
/** A service with order items / catalog entries / sold packages is deactivated, never deleted. */
export const SERVICE_IN_USE_MESSAGE = 'Layanan ini masih dipakai di pesanan atau paket dan tidak dapat dihapus. Nonaktifkan saja.'
/** A catalog entry a customer has bought stays (the purchase keeps a copy, but the link is kept too). */
export const PACKAGE_IN_USE_MESSAGE = 'Paket ini sudah pernah dibeli pelanggan dan tidak dapat dihapus. Nonaktifkan saja.'
/** Shown to staff on the page instead of the buttons. */
export const STAFF_READ_ONLY_NOTE = 'Hanya pemilik/admin yang dapat mengubah harga dan paket. Minta pemilik bila ada harga yang perlu diperbarui.'

export const ERR_SERVICE_NAME = 'Nama layanan wajib diisi.'
export const ERR_PRICE_NEGATIVE = 'Harga tidak boleh negatif.'
export const ERR_PRICE_EXPRESS_REQUIRED = 'Isi harga express, atau matikan saklar "Ada express".'
export const ERR_DAYS = 'Lama pengerjaan harus bilangan bulat hari (0 = selesai hari yang sama).'
export const ERR_MIN_QTY = 'Minimal pesanan harus berupa angka (0 = tanpa minimal).'
export const ERR_PACKAGE_NAME = 'Nama paket wajib diisi.'
export const ERR_PACKAGE_SERVICE = 'Pilih layanan untuk paket ini.'
export const ERR_PACKAGE_SERVICE_KG = 'Paket prabayar hanya untuk layanan per kg.'
export const ERR_VALID_DAYS = 'Masa berlaku harus bilangan bulat hari lebih dari 0, atau kosong bila tanpa kedaluwarsa.'

/** Heading of each group on the page and the labels of the unit picker. */
export const UNIT_GROUP_LABEL: Record<Unit, string> = {
  kg: 'Per kg',
  pcs: 'Per pcs',
}

export const UNIT_GROUP_HINT: Record<Unit, string> = {
  kg: 'Ditimbang; jumlah sampai 2 angka di belakang koma',
  pcs: 'Per potong: bed cover, selimut, sepatu, …',
}

// ---------- typed numbers ----------

/** A typed quantity ('2,5', '2.5', '3'): the number; '' -> null; anything else -> NaN. */
export function parseDecimalInput(text: string): number | null {
  const t = text.trim().replace(',', '.')
  if (t === '') return null
  return /^\d+(\.\d*)?$/.test(t) ? Number(t) : Number.NaN
}

/** A typed whole number ('3'): the number; '' -> null; anything else (including '2,5') -> NaN. */
export function parseWholeInput(text: string): number | null {
  const t = text.trim()
  if (t === '') return null
  return /^\d+$/.test(t) ? Number(t) : Number.NaN
}

/** 2.5 -> '2,5' for a text box; 0 -> '' */
export function qtyToInput(qty: number): string {
  return qty === 0 ? '' : String(qty).replace('.', ',')
}

// ---------- service form (SPEC 3.1) ----------

/** Numeric text fields stay strings while typing ('2,' is a valid draft); money fields are integers (MoneyInput). */
export interface ServiceFormValues {
  name: string
  unit: Unit
  price: number
  /** the "Ada express" switch; off = price_express null */
  hasExpress: boolean
  price_express: number
  days_regular: string
  /** '' = same as regular */
  days_express: string
  /** '' = 0 = no minimum */
  min_qty: string
  active: boolean
}

export type ServiceFormErrors = Partial<Record<keyof ServiceFormValues, string>>

/** The columns the form writes; sort_order is assigned by the action hook on create and kept on update. */
export type ServicePayload = Pick<Service, 'name' | 'unit' | 'price' | 'price_express' | 'days_regular' | 'days_express' | 'min_qty' | 'active'>

export function initialServiceForm(unit: Unit = 'kg'): ServiceFormValues {
  return { name: '', unit, price: 0, hasExpress: false, price_express: 0, days_regular: '3', days_express: '', min_qty: '', active: true }
}

export function serviceToForm(s: Service): ServiceFormValues {
  return {
    name: s.name,
    unit: s.unit,
    price: s.price,
    hasExpress: s.price_express !== null,
    price_express: s.price_express ?? 0,
    days_regular: String(s.days_regular),
    days_express: s.days_express === null ? '' : String(s.days_express),
    min_qty: qtyToInput(s.min_qty),
    active: s.active,
  }
}

/**
 * Field errors in Indonesian: name required, prices >= 0, an express price when the switch is on, whole
 * non-negative days, a minimum that fits the unit (pcs whole, kg 2 decimals). {} when the form can be saved.
 */
export function validateServiceForm(v: ServiceFormValues): ServiceFormErrors {
  const errors: ServiceFormErrors = {}
  if (!v.name.trim()) errors.name = ERR_SERVICE_NAME
  if (!Number.isInteger(v.price) || v.price < 0) errors.price = ERR_PRICE_NEGATIVE
  if (v.hasExpress && (!Number.isInteger(v.price_express) || v.price_express <= 0)) errors.price_express = ERR_PRICE_EXPRESS_REQUIRED
  const regular = parseWholeInput(v.days_regular)
  if (regular === null || Number.isNaN(regular)) errors.days_regular = ERR_DAYS
  if (v.hasExpress) {
    const express = parseWholeInput(v.days_express)
    if (express !== null && Number.isNaN(express)) errors.days_express = ERR_DAYS
  }
  const min = parseDecimalInput(v.min_qty)
  if (min !== null) {
    if (Number.isNaN(min)) errors.min_qty = ERR_MIN_QTY
    else if (min > 0) {
      const problem = qtyProblem(min, v.unit)
      if (problem) errors.min_qty = problem
    }
  }
  return errors
}

/** Assumes validateServiceForm(v) is empty. */
export function formToServicePayload(v: ServiceFormValues): ServicePayload {
  const expressDays = v.hasExpress ? parseWholeInput(v.days_express) : null
  return {
    name: v.name.trim(),
    unit: v.unit,
    price: v.price,
    price_express: v.hasExpress ? v.price_express : null,
    days_regular: parseWholeInput(v.days_regular) ?? 0,
    days_express: expressDays === null || Number.isNaN(expressDays) ? null : expressDays,
    min_qty: roundQty(parseDecimalInput(v.min_qty) ?? 0),
    active: v.active,
  }
}

// ---------- package catalog form (SPEC 3.4) ----------

export interface PackageFormValues {
  name: string
  service_id: string
  /** kg, text while typing */
  qty: string
  price: number
  /** '' = never expires */
  valid_days: string
  active: boolean
}

export type PackageFormErrors = Partial<Record<keyof PackageFormValues, string>>

export type PackagePayload = Pick<PackageCatalogItem, 'name' | 'service_id' | 'qty' | 'price' | 'valid_days' | 'active'>

/** Services a package can be sold for: active per-kg ones, plus the entry's current service when editing. */
export function packageServiceOptions(services: Service[], currentServiceId: string | null = null): Service[] {
  return sortServices(services.filter((s) => (s.unit === 'kg' && s.active) || s.id === currentServiceId))
}

export function initialPackageForm(services: Service[]): PackageFormValues {
  const options = packageServiceOptions(services)
  return { name: '', service_id: options.length === 1 ? options[0].id : '', qty: '', price: 0, valid_days: '', active: true }
}

export function packageToForm(p: PackageCatalogItem): PackageFormValues {
  return {
    name: p.name,
    service_id: p.service_id,
    qty: qtyToInput(p.qty),
    price: p.price,
    valid_days: p.valid_days === null ? '' : String(p.valid_days),
    active: p.active,
  }
}

/** Name required, a per-kg service, qty > 0 with 2 decimals, price >= 0, valid_days whole > 0 or empty. */
export function validatePackageForm(v: PackageFormValues, services: Pick<Service, 'id' | 'unit'>[]): PackageFormErrors {
  const errors: PackageFormErrors = {}
  if (!v.name.trim()) errors.name = ERR_PACKAGE_NAME
  const service = services.find((s) => s.id === v.service_id)
  if (!service) errors.service_id = ERR_PACKAGE_SERVICE
  else if (service.unit !== 'kg') errors.service_id = ERR_PACKAGE_SERVICE_KG
  const qty = parseDecimalInput(v.qty)
  if (qty === null || Number.isNaN(qty)) errors.qty = ERR_QTY_POSITIVE
  else {
    const problem = qtyProblem(qty, 'kg')
    if (problem) errors.qty = problem
  }
  if (!Number.isInteger(v.price) || v.price < 0) errors.price = ERR_PRICE_NEGATIVE
  const days = parseWholeInput(v.valid_days)
  if (days !== null && (Number.isNaN(days) || days <= 0)) errors.valid_days = ERR_VALID_DAYS
  return errors
}

/** Assumes validatePackageForm(v) is empty. */
export function formToPackagePayload(v: PackageFormValues): PackagePayload {
  const days = parseWholeInput(v.valid_days)
  return {
    name: v.name.trim(),
    service_id: v.service_id,
    qty: roundQty(parseDecimalInput(v.qty) ?? 0),
    price: v.price,
    valid_days: days === null || Number.isNaN(days) ? null : days,
    active: v.active,
  }
}

// ---------- grouping and ordering ----------

type Sortable = Pick<Service, 'sort_order' | 'name'>

/** By sort_order, then name (ties happen after an import or a seed with the same number). */
export function sortServices<T extends Sortable>(services: T[]): T[] {
  return [...services].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'id'))
}

export interface ServiceGroup {
  unit: Unit
  label: string
  hint: string
  services: Service[]
}

/** Both groups, kg first, each in sort order; a group without services is still listed (empty). */
export function groupServicesByUnit(services: Service[]): ServiceGroup[] {
  const sorted = sortServices(services)
  return UNITS.map((unit) => ({ unit, label: UNIT_GROUP_LABEL[unit], hint: UNIT_GROUP_HINT[unit], services: sorted.filter((s) => s.unit === unit) }))
}

/** A new service goes last. */
export function nextSortOrder(services: Pick<Service, 'sort_order'>[]): number {
  let max = 0
  for (const s of services) if (s.sort_order > max) max = s.sort_order
  return max + 1
}

export type MoveDirection = 'up' | 'down'

export interface SortPatch {
  id: string
  sort_order: number
}

type Movable = Pick<Service, 'id' | 'unit' | 'sort_order' | 'name'>

/** Index (in the sorted list) of the nearest service of the same unit in that direction; -1 when at the edge. */
function neighbourIndex(sorted: Movable[], index: number, direction: MoveDirection): number {
  const step = direction === 'up' ? -1 : 1
  for (let j = index + step; j >= 0 && j < sorted.length; j += step) if (sorted[j].unit === sorted[index].unit) return j
  return -1
}

/** Whether ▲/▼ does anything: there is another service of the same unit in that direction. */
export function canMoveService(services: Movable[], id: string, direction: MoveDirection): boolean {
  const sorted = sortServices(services)
  const i = sorted.findIndex((s) => s.id === id)
  return i >= 0 && neighbourIndex(sorted, i, direction) >= 0
}

/**
 * The sort_order writes that move a service one step within its unit group: it swaps places with its
 * neighbour of the same unit in the overall order, and the whole list is renumbered 1..n so duplicate or
 * gapped numbers heal; only rows whose number changes are returned (normally two). [] = nothing to do.
 */
export function moveService(services: Movable[], id: string, direction: MoveDirection): SortPatch[] {
  const sorted = sortServices(services)
  const i = sorted.findIndex((s) => s.id === id)
  if (i < 0) return []
  const j = neighbourIndex(sorted, i, direction)
  if (j < 0) return []
  const next = [...sorted]
  next[i] = sorted[j]
  next[j] = sorted[i]
  const patches: SortPatch[] = []
  next.forEach((s, k) => {
    if (s.sort_order !== k + 1) patches.push({ id: s.id, sort_order: k + 1 })
  })
  return patches
}

// ---------- usage: delete or deactivate ----------

export interface ServiceUsage {
  /** distinct orders with an item of this service */
  orders: number
  /** catalog entries for this service */
  catalog: number
  /** packages customers bought for this service */
  packages: number
}

export const NO_USAGE: ServiceUsage = { orders: 0, catalog: 0, packages: 0 }

export function serviceUsage(
  serviceId: string,
  orderItems: Pick<OrderItem, 'service_id' | 'order_id'>[],
  catalog: Pick<PackageCatalogItem, 'service_id'>[],
  packages: Pick<CustomerPackage, 'service_id'>[],
): ServiceUsage {
  const orders = new Set<string>()
  for (const it of orderItems) if (it.service_id === serviceId) orders.add(it.order_id)
  return {
    orders: orders.size,
    catalog: catalog.filter((c) => c.service_id === serviceId).length,
    packages: packages.filter((p) => p.service_id === serviceId).length,
  }
}

/** Used anywhere: the service can only be deactivated (SPEC 3.1: history is kept). */
export function isServiceUsed(u: ServiceUsage): boolean {
  return u.orders > 0 || u.catalog > 0 || u.packages > 0
}

/** 'Dipakai di 12 pesanan dan 1 paket di katalog.'; null when unused. */
export function serviceUsageText(u: ServiceUsage): string | null {
  const parts: string[] = []
  if (u.orders > 0) parts.push(`${u.orders} pesanan`)
  if (u.catalog > 0) parts.push(`${u.catalog} paket di katalog`)
  if (u.packages > 0) parts.push(`${u.packages} paket pelanggan`)
  if (parts.length === 0) return null
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} dan ${parts[parts.length - 1]}`
  return `Dipakai di ${list}.`
}

/** How many sold packages point at this catalog entry. */
export function catalogUsage(catalogId: string, packages: Pick<CustomerPackage, 'catalog_id'>[]): number {
  return packages.filter((p) => p.catalog_id === catalogId).length
}

/** 'Sudah dibeli 2 pelanggan.'; null when never sold. */
export function catalogUsageText(sold: number): string | null {
  return sold > 0 ? `Sudah dibeli ${sold} kali.` : null
}

// ---------- display ----------

/** 'Rp 6.000/kg' */
export function priceText(price: number, unit: Unit): string {
  return `${formatRupiah(price)}/${UNIT_LABEL[unit]}`
}

function dayText(days: number): string {
  return days === 0 ? 'hari yang sama' : `${days} hari`
}

/** '3 hari · express 1 hari' (express days fall back to regular, like promisedDate); '2 hari' without express. */
export function describeDays(s: Pick<Service, 'days_regular' | 'days_express' | 'price_express'>): string {
  const regular = dayText(s.days_regular)
  if (s.price_express === null) return regular
  return `${regular} · express ${dayText(s.days_express ?? s.days_regular)}`
}

/** 'min. 2 kg'; null when there is no minimum (SPEC 3.12). */
export function describeMinQty(s: Pick<Service, 'min_qty' | 'unit'>): string | null {
  return s.min_qty > 0 ? `min. ${formatQty(s.min_qty, s.unit)}` : null
}

/** '20 kg Cuci setrika'; the service may be gone (restrict FK makes that rare, but the demo data can be edited). */
export function describePackageContent(p: Pick<PackageCatalogItem, 'qty' | 'service_id'>, service: Pick<Service, 'name' | 'unit'> | undefined): string {
  return `${formatQty(p.qty, service?.unit ?? 'kg')} ${service?.name ?? 'layanan tidak ditemukan'}`
}

/** 'Berlaku 60 hari' / 'Tanpa kedaluwarsa' */
export function describeValidity(p: Pick<PackageCatalogItem, 'valid_days'>): string {
  return p.valid_days === null ? 'Tanpa kedaluwarsa' : `Berlaku ${p.valid_days} hari`
}
