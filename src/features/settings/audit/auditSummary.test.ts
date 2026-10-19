import { describe, expect, it } from 'vitest'
import type { AuditLogEntry } from '../../../types/db'
import {
  FORMER_MEMBER_ACTOR,
  SYSTEM_ACTOR,
  actorLabel,
  auditSubject,
  changedColumns,
  formatAuditValue,
  memberEmails,
  relativeTime,
  summarizeAuditEntry,
  type RefResolver,
} from './auditSummary'

function entry(partial: Partial<AuditLogEntry>): AuditLogEntry {
  return {
    id: 'a1',
    org_id: 'org',
    table_name: 'organization_members',
    row_id: 'r1',
    action: 'update',
    changed_by: 'u1',
    changed_at: '2026-10-12T03:00:00Z',
    old_data: null,
    new_data: null,
    ...partial,
  }
}

const member = { id: 'm1', org_id: 'org', user_id: 'u2', email: 'istri@contoh.id', role: 'staff', created_at: '2026-10-01T02:00:00Z' }

describe('summarizeAuditEntry', () => {
  it('describes a role change with Indonesian labels', () => {
    const s = summarizeAuditEntry(entry({ old_data: member, new_data: { ...member, role: 'admin' } }))
    expect(s.tableLabel).toBe('Anggota')
    expect(s.actionLabel).toBe('Ubah')
    expect(s.subject).toBe('istri@contoh.id · Admin')
    expect(s.changes).toEqual(['Peran: Staf → Admin'])
  })

  it('ignores updated_at and other bookkeeping columns', () => {
    const before = { id: 'r', name: 'EG Laundry', updated_at: '2026-10-01T00:00:00Z', created_by: null }
    const after = { id: 'r', name: 'EG Laundry', updated_at: '2026-10-02T00:00:00Z', created_by: 'u1' }
    expect(summarizeAuditEntry(entry({ table_name: 'organizations', old_data: before, new_data: after })).changes).toEqual([])
  })

  it('lists money first, then status, with notes only reported as changed', () => {
    const before = { name: 'Cuci kering', price: 7_000, status: 'active', notes: null, updated_at: 'a' }
    const after = { name: 'Cuci kering', price: 8_000, status: 'inactive', notes: 'naik', updated_at: 'b' }
    const s = summarizeAuditEntry(entry({ table_name: 'services', old_data: before, new_data: after }))
    expect(s.tableLabel).toBe('Daftar harga')
    expect(s.subject).toBe('Cuci kering')
    expect(s.changes).toEqual(['Harga: Rp 7.000 → Rp 8.000', 'Status: active → inactive', 'Catatan diubah'])
  })

  it('names an invitation by who it is for, and a deleted row by its old data', () => {
    const inv = { label: 'Istri', role: 'admin', email: null }
    expect(summarizeAuditEntry(entry({ table_name: 'invitations', action: 'insert', new_data: inv })).subject).toBe('Istri · Admin')
    const s = summarizeAuditEntry(entry({ table_name: 'invitations', action: 'delete', old_data: inv }))
    expect(s.actionLabel).toBe('Hapus')
    expect(s.subject).toBe('Istri · Admin')
    expect(s.changes).toEqual([])
  })

  it('resolves referenced ids through the resolver, and says "diubah" when it cannot', () => {
    const resolve: RefResolver = (column, id) => (column === 'user_id' && id === 'u2' ? 'istri@contoh.id' : null)
    const before = { user_id: 'u2', role: 'staff', invited_by: 'x1' }
    const after = { user_id: 'u2', role: 'staff', invited_by: 'x2' }
    const s = summarizeAuditEntry(entry({ old_data: before, new_data: after }), resolve)
    expect(s.subject).toBe('istri@contoh.id · Staf')
    expect(s.changes).toEqual(['Diundang oleh diubah'])
  })
})

describe('formatAuditValue', () => {
  it('formats money, dates, timestamps, booleans and empties', () => {
    expect(formatAuditValue('orders', 'total_amount', '25000')).toBe('Rp 25.000')
    expect(formatAuditValue('orders', 'quantity', 3)).toBe('3')
    expect(formatAuditValue('orders', 'paid_at', '2026-10-12')).toBe('12 Okt 2026')
    expect(formatAuditValue('orders', 'accepted_at', '2026-10-12T03:00:00Z')).toMatch(/^12 Okt 2026, \d{2}\.\d{2}$/)
    expect(formatAuditValue('orders', 'express', true)).toBe('Ya')
    expect(formatAuditValue('orders', 'notes', null)).toBe('–')
    expect(formatAuditValue('orders', 'customer_id', 'c1')).toBeNull()
  })

  it('shortens long text', () => {
    expect(formatAuditValue('x', 'description', 'a'.repeat(60))).toBe(`${'a'.repeat(39)}…`)
  })
})

describe('changedColumns', () => {
  it('treats "1000" and 1000 as the same amount and orders money before names', () => {
    expect(changedColumns({ amount: '1000', name: 'a' }, { amount: 1000, name: 'b' })).toEqual(['name'])
    expect(changedColumns({ name: 'a', amount: 1, phone: '0' }, { name: 'b', amount: 2, phone: '1' })).toEqual(['amount', 'name', 'phone'])
  })
})

describe('auditSubject', () => {
  it('falls back to name or full_name for unknown tables', () => {
    expect(auditSubject('customers', { full_name: 'Budi' })).toBe('Budi')
    expect(auditSubject('services', { name: 'Setrika' })).toBe('Setrika')
    expect(auditSubject('services', { price: 1 })).toBeNull()
    expect(auditSubject('services', null)).toBeNull()
  })
})

describe('who and when', () => {
  it('finds emails of current and former members', () => {
    const emails = memberEmails([{ user_id: 'u1', email: 'owner@contoh.id' }], [
      entry({ table_name: 'organization_members', action: 'delete', old_data: { user_id: 'u9', email: 'lama@contoh.id' } }),
    ])
    expect(actorLabel('u1', emails)).toBe('owner@contoh.id')
    expect(actorLabel('u9', emails)).toBe('lama@contoh.id')
    expect(actorLabel('u7', emails)).toBe(FORMER_MEMBER_ACTOR)
    expect(actorLabel(null, emails)).toBe(SYSTEM_ACTOR)
  })

  it('says how long ago, up to a week', () => {
    const now = new Date('2026-10-12T10:00:00Z')
    expect(relativeTime('2026-10-12T09:59:30Z', now)).toBe('baru saja')
    expect(relativeTime('2026-10-12T09:55:00Z', now)).toBe('5 menit lalu')
    expect(relativeTime('2026-10-12T07:00:00Z', now)).toBe('3 jam lalu')
    expect(relativeTime('2026-10-11T08:00:00Z', now)).toBe('kemarin')
    expect(relativeTime('2026-10-08T10:00:00Z', now)).toBe('4 hari lalu')
    expect(relativeTime('2026-10-01T10:00:00Z', now)).toBeNull()
    expect(relativeTime('nope', now)).toBeNull()
  })
})
