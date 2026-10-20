import { describe, expect, it } from 'vitest'
import fixtureText from './__fixtures__/woombad-backup.json?raw'
import { buildDemoDb } from '../../lib/repo/demoSeed'
import { buildBackupFile } from '../settings/data/backupFile'
import {
  MSG_WOOMBAD_LAUNDRY_BACKUP,
  MSG_WOOMBAD_NEWER,
  MSG_WOOMBAD_NOT_BACKUP,
  MSG_WOOMBAD_NOT_JSON,
  WoombadFileError,
  currentLease,
  leaseOccupiesOn,
  parseWoombadBackup,
  phoneKey,
  planTenantImport,
  tenantImportSummary,
  tenantPlanSize,
  tidyName,
  type ImportCustomer,
  type WoombadBackup,
  type WoombadLease,
} from './tenantImport'

const TODAY = '2026-10-20'

const parseError = (text: string): string => {
  try {
    parseWoombadBackup(text)
  } catch (err) {
    expect(err).toBeInstanceOf(WoombadFileError)
    return (err as Error).message
  }
  throw new Error('expected parseWoombadBackup to throw')
}

let leaseSeq = 0
function lease(tenant_id: string, room_id: string | null, status: string, start_date: string, end_date: string | null = null, checkout_date: string | null = null): WoombadLease {
  leaseSeq++
  return { id: `l${String(leaseSeq).padStart(3, '0')}`, tenant_id, room_id, status, start_date, end_date: end_date ?? start_date, checkout_date }
}

function backup(parts: Partial<WoombadBackup>): WoombadBackup {
  return { orgNames: [], exportedAt: null, tenants: [], leases: [], rooms: [{ id: 'r1', name: 'A1' }, { id: 'r2', name: 'B2' }, { id: 'r3', name: 'C3' }], ...parts }
}

function customer(id: string, name: string, phone: string | null, extra: Partial<ImportCustomer> = {}): ImportCustomer {
  return { id, name, phone, is_tenant: false, room_name: null, kos_tenant_id: null, ...extra }
}

describe('parseWoombadBackup', () => {
  it('reads the fixture: one organisation file with tenants, leases and rooms', () => {
    const parsed = parseWoombadBackup(fixtureText)
    expect(parsed.orgNames).toEqual(['EG Kost (contoh)'])
    expect(parsed.exportedAt).toBe('2026-10-18T14:07:00.000Z')
    expect(parsed.tenants).toHaveLength(7)
    expect(parsed.leases).toHaveLength(8)
    expect(parsed.rooms.map((r) => r.name)).toEqual(['A1', 'A3', 'B2', 'B3', 'C1', 'D4', 'E1'])
    // only what the import needs is kept (no NIK, address, ...)
    expect(Object.keys(parsed.tenants[0]).sort()).toEqual(['full_name', 'id', 'phone'])
    expect(parsed.tenants.find((t) => t.full_name === 'Putri Ayu')?.phone).toBeNull()
  })

  it('accepts the weekly export (an array of organisation files) and merges them; a repeated id counts once', () => {
    const one = JSON.parse(fixtureText)
    const other = {
      version: 1,
      exportedAt: '2026-10-19T14:07:00.000Z',
      orgName: 'Kos Kedua',
      tables: {
        tenants: [{ id: 't-x', full_name: 'Tamu Lain', phone: '0812-0000-0199' }],
        leases: [{ id: 'l-x', tenant_id: 't-x', room_id: 'r-x', status: 'active', start_date: '2026-01-01', end_date: '2026-02-01', checkout_date: null }],
        rooms: [{ id: 'r-x', name: 'K1' }],
      },
    }
    const parsed = parseWoombadBackup(JSON.stringify([one, other, one]))
    expect(parsed.orgNames).toEqual(['EG Kost (contoh)', 'Kos Kedua'])
    expect(parsed.exportedAt).toBe('2026-10-19T14:07:00.000Z')
    expect(parsed.tenants).toHaveLength(8)
    expect(parsed.leases).toHaveLength(9)
    expect(parsed.rooms).toHaveLength(8)
  })

  it('accepts an older Mode Demo snapshot (bare tables) and trims timestamps to dates', () => {
    const parsed = parseWoombadBackup(
      JSON.stringify({
        tenants: [{ id: 'demo-tenant-1', full_name: 'Demo', phone: undefined }],
        leases: [{ id: 'demo-lease-1', tenant_id: 'demo-tenant-1', room_id: 'demo-room-1', status: 'active', start_date: '2026-01-01T00:00:00Z', end_date: '2026-02-01' }],
      }),
    )
    expect(parsed.tenants).toEqual([{ id: 'demo-tenant-1', full_name: 'Demo', phone: null }])
    expect(parsed.leases[0]).toMatchObject({ start_date: '2026-01-01', checkout_date: null })
    expect(parsed.rooms).toEqual([])
  })

  it('refuses what is not a Woombad backup, in Indonesian', () => {
    expect(parseError('{ bukan json')).toBe(MSG_WOOMBAD_NOT_JSON)
    expect(parseError('')).toBe(MSG_WOOMBAD_NOT_JSON)
    expect(parseError('"teks"')).toBe(MSG_WOOMBAD_NOT_BACKUP)
    expect(parseError('null')).toBe(MSG_WOOMBAD_NOT_BACKUP)
    expect(parseError('[]')).toBe(MSG_WOOMBAD_NOT_BACKUP)
    expect(parseError('[1, 2]')).toBe(MSG_WOOMBAD_NOT_BACKUP)
    expect(parseError('{"version":1,"tables":[]}')).toBe(MSG_WOOMBAD_NOT_BACKUP)
    expect(parseError('{"version":"1","tables":{"tenants":[]}}')).toBe(MSG_WOOMBAD_NOT_BACKUP)
    expect(parseError('{"version":1,"tables":{"rooms":[]}}')).toBe(MSG_WOOMBAD_NOT_BACKUP)
    expect(parseError('{"version":2,"tables":{"tenants":[]}}')).toBe(MSG_WOOMBAD_NEWER)
    expect(MSG_WOOMBAD_NOT_BACKUP).toBe('Berkas bukan cadangan Woombad.')
  })

  it('recognises an EG Laundry backup picked by mistake', () => {
    const laundry = buildBackupFile(buildDemoDb(new Date(2026, 9, 20)), 'EG Laundry (Demo)')
    expect(parseError(JSON.stringify(laundry))).toBe(MSG_WOOMBAD_LAUNDRY_BACKUP)
    expect(parseError(JSON.stringify(buildDemoDb(new Date(2026, 9, 20))))).toBe(MSG_WOOMBAD_LAUNDRY_BACKUP)
  })

  it('names the broken part and row', () => {
    const file = (tables: Record<string, unknown>) => JSON.stringify({ version: 1, tables })
    expect(parseError(file({ tenants: [{ id: 't1', full_name: 'A' }, { id: 't2' }] }))).toBe('Berkas cadangan Woombad rusak: bagian "Penyewa" baris ke-2 tidak valid.')
    expect(parseError(file({ tenants: [], leases: [{ id: 'l1', tenant_id: 't1', status: 'active', start_date: 'kemarin' }] }))).toBe(
      'Berkas cadangan Woombad rusak: bagian "Sewa" baris ke-1 tidak valid.',
    )
    expect(parseError(file({ tenants: [], rooms: 'A1' }))).toBe('Berkas cadangan Woombad rusak: bagian "Kamar" tidak valid.')
    expect(parseError(file({ tenants: [{ id: 't1', full_name: 'A', phone: 812 }] }))).toContain('"Penyewa" baris ke-1')
  })
})

describe('leaseOccupiesOn / currentLease (Woombad occupancy)', () => {
  it('active holds the room from start_date on, also past end_date; a future start is a booking', () => {
    expect(leaseOccupiesOn(lease('t', 'r1', 'active', '2026-01-01', '2026-02-01'), TODAY)).toBe(true)
    expect(leaseOccupiesOn(lease('t', 'r1', 'active', TODAY), TODAY)).toBe(true)
    expect(leaseOccupiesOn(lease('t', 'r1', 'active', '2026-10-21'), TODAY)).toBe(false)
    expect(leaseOccupiesOn(lease('t', 'r1', 'cancelled', '2026-01-01', '2026-12-31'), TODAY)).toBe(false)
  })

  it('ended holds it until the day before checkout (or through end_date without one)', () => {
    expect(leaseOccupiesOn(lease('t', 'r1', 'ended', '2026-01-01', '2026-10-31', '2026-10-21'), TODAY)).toBe(true)
    expect(leaseOccupiesOn(lease('t', 'r1', 'ended', '2026-01-01', '2026-10-31', '2026-10-20'), TODAY)).toBe(false)
    expect(leaseOccupiesOn(lease('t', 'r1', 'ended', '2026-01-01', '2026-10-20'), TODAY)).toBe(true)
    expect(leaseOccupiesOn(lease('t', 'r1', 'ended', '2026-01-01', '2026-10-19'), TODAY)).toBe(false)
  })

  it('several running leases: the latest start wins; active beats an ended one running out', () => {
    const older = lease('t', 'r1', 'active', '2026-01-01')
    const newer = lease('t', 'r2', 'active', '2026-06-01')
    expect(currentLease([older, newer], TODAY)).toBe(newer)
    expect(currentLease([newer, older], TODAY)).toBe(newer)
    const runningOut = lease('t', 'r3', 'ended', '2026-09-01', '2026-10-31', '2026-10-25')
    expect(currentLease([runningOut, older], TODAY)).toBe(older)
    expect(currentLease([runningOut], TODAY)).toBe(runningOut)
  })

  it('a booking counts only without a running lease; the earliest booking; cancelled never', () => {
    const living = lease('t', 'r1', 'active', '2026-01-01')
    const booked = lease('t', 'r2', 'active', '2026-11-01')
    const later = lease('t', 'r3', 'active', '2026-12-01')
    expect(currentLease([booked, living], TODAY)).toBe(living)
    expect(currentLease([later, booked], TODAY)).toBe(booked)
    expect(currentLease([lease('t', 'r1', 'cancelled', '2026-01-01', '2026-12-31'), lease('t', 'r1', 'ended', '2025-01-01', '2025-06-30')], TODAY)).toBeNull()
    expect(currentLease([], TODAY)).toBeNull()
  })
})

describe('phoneKey / tidyName', () => {
  it('compares 08…, +62…, 62… and spaced forms as the same number', () => {
    const key = '6281200000001'
    expect(phoneKey('0812-0000-0001')).toBe(key)
    expect(phoneKey('+62 812 0000 0001')).toBe(key)
    expect(phoneKey('6281200000001')).toBe(key)
    expect(phoneKey('(0812) 0000.0001')).toBe(key)
    expect(phoneKey('+62 0812-0000-0001')).toBe(key)
    expect(phoneKey('0812')).toBeNull()
    expect(phoneKey('-')).toBeNull()
    expect(phoneKey(null)).toBeNull()
  })

  it('turns KTP capitals into a readable name and leaves typed names alone', () => {
    expect(tidyName('FAJAR  NUGROHO ')).toBe('Fajar Nugroho')
    expect(tidyName("NI LUH AYU-WULAN D'SOUZA")).toBe("Ni Luh Ayu-Wulan D'Souza")
    expect(tidyName('Budi santoso')).toBe('Budi santoso')
    expect(tidyName('  ')).toBe('')
    expect(tidyName('123')).toBe('123')
  })
})

describe('planTenantImport', () => {
  it('matches by kos_tenant_id before the phone, even after the number changed', () => {
    const b = backup({ tenants: [{ id: 'T1', full_name: 'Rina Putri', phone: '0812-0000-0999' }], leases: [lease('T1', 'r2', 'active', '2026-01-01')] })
    const plan = planTenantImport(
      b,
      [customer('c1', 'Rina', '0812-0000-0001', { is_tenant: true, room_name: 'A1', kos_tenant_id: 'T1' }), customer('c2', 'Orang lain', '0812-0000-0999')],
      { today: TODAY },
    )
    expect(plan.toUpdate).toEqual([{ customerId: 'c1', customerName: 'Rina', tenantName: 'Rina Putri', room_name: 'B2', patch: { room_name: 'B2' }, reason: 'kos_tenant_id' }])
    expect(plan.toCreate).toEqual([])
    expect(plan.counts).toMatchObject({ current: 1, update: 1, create: 0, unchanged: 0, skipped: 0 })
  })

  it('matches by phone in the 08… and +62… forms and links the customer', () => {
    const b = backup({
      tenants: [
        { id: 'T1', full_name: 'Sari Dewi', phone: '+62 812-0000-0003' },
        { id: 'T2', full_name: 'Dimas', phone: '0812 0000 0002' },
      ],
      leases: [lease('T1', 'r2', 'active', '2026-01-01'), lease('T2', 'r1', 'active', '2026-02-01')],
    })
    const plan = planTenantImport(b, [customer('c3', 'Sari', '0812-0000-0003'), customer('c2', 'Dimas S', '+6281200000002', { is_tenant: true, room_name: 'Z9' })], { today: TODAY })
    expect(plan.toUpdate).toEqual([
      { customerId: 'c2', customerName: 'Dimas S', tenantName: 'Dimas', room_name: 'A1', patch: { room_name: 'A1', kos_tenant_id: 'T2' }, reason: 'phone' },
      { customerId: 'c3', customerName: 'Sari', tenantName: 'Sari Dewi', room_name: 'B2', patch: { is_tenant: true, room_name: 'B2', kos_tenant_id: 'T1' }, reason: 'phone' },
    ])
  })

  it('a customer that already says all this is counted as unchanged, not written', () => {
    const b = backup({ tenants: [{ id: 'T1', full_name: 'Rina', phone: '0812-0000-0001' }], leases: [lease('T1', 'r1', 'active', '2026-01-01')] })
    const plan = planTenantImport(b, [customer('c1', 'Rina', '0812-0000-0001', { is_tenant: true, room_name: 'A1', kos_tenant_id: 'T1' })], { today: TODAY })
    expect(tenantPlanSize(plan)).toBe(0)
    expect(plan.counts).toMatchObject({ current: 1, unchanged: 1, update: 0 })
  })

  it('fills a missing phone of a customer matched by id, never overwrites one', () => {
    const b = backup({
      tenants: [
        { id: 'T1', full_name: 'Mega', phone: '0812-0000-0011' },
        { id: 'T2', full_name: 'Andi', phone: '0812-0000-0012' },
      ],
      leases: [lease('T1', 'r1', 'active', '2026-01-01'), lease('T2', 'r2', 'active', '2026-01-01')],
    })
    const plan = planTenantImport(
      b,
      [customer('c1', 'Mega', null, { is_tenant: true, room_name: 'A1', kos_tenant_id: 'T1' }), customer('c2', 'Andi', '0812-9999-0000', { is_tenant: true, room_name: 'B2', kos_tenant_id: 'T2' })],
      { today: TODAY },
    )
    expect(plan.toUpdate).toEqual([expect.objectContaining({ customerId: 'c1', patch: { phone: '0812-0000-0011' } })])
    expect(plan.counts.unchanged).toBe(1)
  })

  it('a tenant without a match becomes a new customer (name tidied, phone as written, room, kos id)', () => {
    const b = backup({
      tenants: [
        { id: 'T1', full_name: 'FAJAR NUGROHO', phone: ' 0812-0000-0101 ' },
        { id: 'T2', full_name: 'Putri Ayu', phone: null },
      ],
      leases: [lease('T1', 'r3', 'active', '2026-01-01'), lease('T2', 'missing-room', 'active', '2026-01-01')],
    })
    const plan = planTenantImport(b, [customer('c1', 'Budi', '0812-0000-0001')], { today: TODAY })
    expect(plan.toCreate).toEqual([
      { name: 'Fajar Nugroho', phone: '0812-0000-0101', room_name: 'C3', kos_tenant_id: 'T1' },
      { name: 'Putri Ayu', phone: null, room_name: null, kos_tenant_id: 'T2' },
    ])
    expect(plan.counts).toMatchObject({ current: 2, create: 2, noPhone: 1 })
  })

  it('a tenant without a phone is matched only by kos_tenant_id', () => {
    const b = backup({ tenants: [{ id: 'T2', full_name: 'Putri Ayu', phone: null }], leases: [lease('T2', 'r1', 'active', '2026-01-01')] })
    const plan = planTenantImport(b, [customer('c9', 'Putri', null, { kos_tenant_id: 'T2' }), customer('c8', 'Tanpa HP', null)], { today: TODAY })
    expect(plan.toUpdate).toEqual([expect.objectContaining({ customerId: 'c9', reason: 'kos_tenant_id', patch: { is_tenant: true, room_name: 'A1' } })])
    expect(plan.toCreate).toEqual([])
    expect(plan.counts.noPhone).toBe(1)
  })

  it('createMissing off: unmatched tenants are listed as skipped, nothing created', () => {
    const b = backup({ tenants: [{ id: 'T1', full_name: 'Fajar', phone: '0812-0000-0101' }], leases: [lease('T1', 'r1', 'active', '2026-01-01')] })
    const plan = planTenantImport(b, [], { today: TODAY, createMissing: false })
    expect(plan.toCreate).toEqual([])
    expect(plan.skipped).toEqual([{ name: 'Fajar', reason: 'Belum ada di daftar pelanggan (pelanggan baru tidak dibuat).' }])
  })

  it('an ended lease un-marks the Anak kos it matches (room cleared, linked)', () => {
    const b = backup({
      tenants: [
        { id: 'T1', full_name: 'Yoga', phone: '0812 0000 0004' },
        { id: 'T2', full_name: 'Lama', phone: '0812-0000-0005' },
        { id: 'T3', full_name: 'Umum', phone: '0812-0000-0006' },
      ],
      leases: [lease('T1', 'r1', 'ended', '2025-01-01', '2025-06-30', '2025-06-30'), lease('T2', 'r2', 'ended', '2025-01-01', '2025-03-01'), lease('T3', 'r3', 'ended', '2025-01-01', '2025-03-01')],
    })
    const plan = planTenantImport(
      b,
      [
        customer('c4', 'Yoga Pratama', '0812-0000-0004', { is_tenant: true, room_name: 'B3' }),
        customer('c5', 'Lama', null, { is_tenant: true, room_name: 'B2', kos_tenant_id: 'T2' }),
        customer('c6', 'Umum', '0812-0000-0006'),
      ],
      { today: TODAY },
    )
    expect(plan.toDeactivate).toEqual([
      { customerId: 'c5', customerName: 'Lama', room_name: 'B2', patch: { is_tenant: false, room_name: null }, reason: 'kos_tenant_id' },
      { customerId: 'c4', customerName: 'Yoga Pratama', room_name: 'B3', patch: { is_tenant: false, room_name: null, kos_tenant_id: 'T1' }, reason: 'phone' },
    ])
    expect(plan.counts).toMatchObject({ current: 0, former: 3, deactivate: 2, keptEnded: 0 })
  })

  it('deactivateEnded off ("jangan ubah yang lama"): ended tenants stay Anak kos and are only counted', () => {
    const b = backup({ tenants: [{ id: 'T1', full_name: 'Yoga', phone: '0812-0000-0004' }], leases: [lease('T1', 'r1', 'ended', '2025-01-01', '2025-06-30')] })
    const plan = planTenantImport(b, [customer('c4', 'Yoga', '0812-0000-0004', { is_tenant: true, room_name: 'B3' })], { today: TODAY, deactivateEnded: false })
    expect(plan.toDeactivate).toEqual([])
    expect(plan.counts).toMatchObject({ deactivate: 0, keptEnded: 1 })
  })

  it('a tenant who ended one lease but holds another is current, not deactivated', () => {
    const b = backup({
      tenants: [{ id: 'T1', full_name: 'Bayu', phone: '0812-0000-0102' }],
      leases: [lease('T1', 'r1', 'ended', '2025-01-01', '2025-03-01'), lease('T1', 'r2', 'active', '2025-03-01')],
    })
    const plan = planTenantImport(b, [customer('c1', 'Bayu', '0812-0000-0102', { is_tenant: true, room_name: 'A1' })], { today: TODAY })
    expect(plan.toDeactivate).toEqual([])
    expect(plan.toUpdate).toEqual([expect.objectContaining({ patch: { room_name: 'B2', kos_tenant_id: 'T1' } })])
  })

  it('duplicate phones among customers: skipped with the reason, nothing written for them', () => {
    const b = backup({
      tenants: [
        { id: 'T1', full_name: 'Sari', phone: '0812-0000-0003' },
        { id: 'T2', full_name: 'Yoga', phone: '0812-0000-0004' },
      ],
      leases: [lease('T1', 'r1', 'active', '2026-01-01'), lease('T2', 'r2', 'ended', '2025-01-01', '2025-02-01')],
    })
    const plan = planTenantImport(
      b,
      [
        customer('c1', 'Sari', '0812-0000-0003'),
        customer('c2', 'Sari (HP ibu)', '+62 812 0000 0003'),
        customer('c3', 'Yoga', '0812-0000-0004', { is_tenant: true }),
        customer('c4', 'Yoga 2', '0812-0000-0004'),
      ],
      { today: TODAY },
    )
    expect(tenantPlanSize(plan)).toBe(0)
    expect(plan.skipped).toEqual([
      { name: 'Sari', reason: 'Nomor HP ini dipakai 2 pelanggan: Sari, Sari (HP ibu). Rapikan dulu di daftar pelanggan.' },
      { name: 'Yoga', reason: 'Nomor HP ini dipakai 2 pelanggan: Yoga, Yoga 2. Rapikan dulu di daftar pelanggan.' },
    ])
    expect(plan.counts.skipped).toBe(2)
  })

  it('a customer linked to another tenant of the file is not taken over by a shared number', () => {
    const b = backup({
      tenants: [
        { id: 'T1', full_name: 'Kakak', phone: '0812-0000-0020' },
        { id: 'T2', full_name: 'Adik', phone: '0812-0000-0020' },
      ],
      leases: [lease('T1', 'r1', 'active', '2026-01-01'), lease('T2', 'r2', 'active', '2026-01-01')],
    })
    const plan = planTenantImport(b, [customer('c1', 'Kakak', '0812-0000-0020', { is_tenant: true, room_name: 'A1', kos_tenant_id: 'T1' })], { today: TODAY })
    expect(plan.counts.unchanged).toBe(1)
    expect(plan.toCreate).toEqual([])
    expect(plan.skipped).toEqual([{ name: 'Adik', reason: 'Nomor HP sama dengan Kakak, yang terhubung ke penyewa lain.' }])
  })

  it('a link to a tenant no longer in the file is replaced through the phone', () => {
    const b = backup({ tenants: [{ id: 'T-new', full_name: 'Rina', phone: '0812-0000-0001' }], leases: [lease('T-new', 'r1', 'active', '2026-01-01')] })
    const plan = planTenantImport(b, [customer('c1', 'Rina', '0812-0000-0001', { is_tenant: true, room_name: 'A1', kos_tenant_id: 'T-deleted' })], { today: TODAY })
    expect(plan.toUpdate).toEqual([expect.objectContaining({ patch: { kos_tenant_id: 'T-new' }, reason: 'phone' })])
  })

  it('two new tenants with one phone: one customer is created, the other skipped; a customer is claimed once', () => {
    const b = backup({
      tenants: [
        { id: 'T1', full_name: 'Ani', phone: '0812-0000-0030' },
        { id: 'T2', full_name: 'Ani Kembar', phone: '+62 812 0000 0030' },
        { id: 'T3', full_name: 'Cici', phone: '0812-0000-0031' },
        { id: 'T4', full_name: 'Cici Lagi', phone: '0812-0000-0031' },
      ],
      leases: ['T1', 'T2', 'T3', 'T4'].map((t) => lease(t, 'r1', 'active', '2026-01-01')),
    })
    const plan = planTenantImport(b, [customer('c1', 'Cici', '0812-0000-0031')], { today: TODAY })
    expect(plan.toCreate.map((c) => c.name)).toEqual(['Ani'])
    expect(plan.toUpdate.map((u) => u.customerId)).toEqual(['c1'])
    expect(plan.skipped).toEqual([
      { name: 'Ani Kembar', reason: 'Nomor HP sama dengan penyewa Ani; hanya satu pelanggan baru yang dibuat.' },
      { name: 'Cici Lagi', reason: 'Pelanggan Cici sudah dicocokkan dengan penyewa Cici.' },
    ])
  })

  it('ignores tenants with only cancelled leases or none, and customers the file does not mention', () => {
    const b = backup({
      tenants: [
        { id: 'T1', full_name: 'Calon', phone: '0812-0000-0040' },
        { id: 'T2', full_name: 'Terdaftar', phone: '0812-0000-0041' },
      ],
      leases: [lease('T1', 'r1', 'cancelled', '2026-01-01')],
    })
    const plan = planTenantImport(b, [customer('c1', 'Calon', '0812-0000-0040', { is_tenant: true }), customer('c2', 'Anak kos manual', '0812-0000-0042', { is_tenant: true, room_name: 'Z1' })], { today: TODAY })
    expect(tenantPlanSize(plan)).toBe(0)
    expect(plan.counts).toMatchObject({ current: 0, former: 0, skipped: 0 })
  })

  it('a tenant without a name is skipped', () => {
    const b = backup({ tenants: [{ id: 'T1', full_name: '  ', phone: '0812-0000-0050' }], leases: [lease('T1', 'r1', 'active', '2026-01-01')] })
    expect(planTenantImport(b, [], { today: TODAY }).skipped).toEqual([{ name: '(tanpa nama)', reason: 'Nama penyewa kosong di Woombad.' }])
  })

  it('the fixture against the Mode Demo customers: 2 matched, 3 new, 1 deactivated, 1 without phone', () => {
    const db = buildDemoDb(new Date(2026, 9, 20))
    const plan = planTenantImport(parseWoombadBackup(fixtureText), db.customers, { today: TODAY })
    expect(plan.counts).toEqual({ current: 5, former: 1, update: 2, create: 3, deactivate: 1, unchanged: 0, skipped: 0, noPhone: 1, keptEnded: 0 })
    expect(plan.toUpdate.map((u) => [u.customerName, u.room_name, u.reason])).toEqual([
      ['Rina Putri', 'A1', 'phone'],
      ['Sari Dewi', 'B2', 'phone'],
    ])
    expect(plan.toCreate.map((c) => [c.name, c.room_name, c.phone])).toEqual([
      ['Bayu Saputra', 'E1', '0812-0000-0102'],
      ['Fajar Nugroho', 'D4', '0812-0000-0101'],
      ['Putri Ayu', 'C1', null],
    ])
    expect(plan.toDeactivate.map((d) => [d.customerName, d.room_name])).toEqual([['Yoga Pratama', 'B3']])
    expect(tenantImportSummary(plan.counts)).toBe('2 diperbarui, 3 baru, 1 dinonaktifkan')
  })
})
