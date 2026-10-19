// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { LocalRepo, STORAGE_KEY, emptyLocalDb } from './localRepo'
import { DELETE_DENIED_MESSAGE, UPDATE_DENIED_MESSAGE } from './types'

async function setup() {
  const repo = new LocalRepo(emptyLocalDb())
  const invitation = (id: string) => ({
    id,
    org_id: 'o1',
    label: id,
    email: null,
    role: 'staff' as const,
    invited_by: null,
    expires_at: '2099-12-31T00:00:00.000Z',
    accepted_at: null,
    accepted_by: null,
  })
  await repo.insertMany('invitations', [invitation('inv-a'), invitation('inv-b')])
  return repo
}

describe('LocalRepo mirrors the database', () => {
  afterEach(() => localStorage.clear())

  it('update/remove of a missing row (or another organisation) is an error, never a silent no-op', async () => {
    const repo = await setup()
    await expect(repo.update('invitations', 'nope', { label: 'x' })).rejects.toThrow(UPDATE_DENIED_MESSAGE)
    await expect(repo.remove('invitations', 'nope')).rejects.toThrow(DELETE_DENIED_MESSAGE)
    await expect(repo.remove('invitations', 'inv-a', 'other-org')).rejects.toThrow(DELETE_DENIED_MESSAGE)
    await repo.remove('invitations', 'inv-a', 'o1')
    expect(await repo.get('invitations', 'inv-a')).toBeNull()
    await expect(repo.remove('invitations', 'inv-a', 'o1')).rejects.toThrow(DELETE_DENIED_MESSAGE)
  })

  it('lists with filters, order and limit, and never hands out its own row objects', async () => {
    const repo = await setup()
    const rows = await repo.list('invitations', { where: { org_id: 'o1' }, orderBy: { column: 'label', ascending: true }, limit: 1 })
    expect(rows.map((r) => r.id)).toEqual(['inv-a'])
    rows[0].label = 'changed outside'
    expect((await repo.get('invitations', 'inv-a'))?.label).toBe('inv-a')
    expect(await repo.list('invitations', { where: { id: ['inv-a', 'inv-b'] } })).toHaveLength(2)
  })

  it('fills in columns added after a row was stored (like a migration)', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ invitations: [{ id: 'old', org_id: 'o1', email: null, role: 'staff', invited_by: null, accepted_at: null, created_at: 'x' }] }),
    )
    const repo = new LocalRepo()
    expect(await repo.get('invitations', 'old')).toMatchObject({ label: null, accepted_by: null, expires_at: '2099-12-31T00:00:00.000Z' })
  })
})
