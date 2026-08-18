import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  recordOwner, ownerOf, ownedIds, releaseOwner,
  hostedCanRead, hostedCanMutate, __setResourceOwnersDbForTests,
} from '../../server/utils/resourceOwners'

const query = vi.fn()
beforeEach(() => { query.mockReset(); __setResourceOwnersDbForTests({ query }) })

describe('recordOwner', () => {
  it('inserts with ON CONFLICT DO NOTHING and params [kind, id, userId]', async () => {
    query.mockResolvedValue({ rows: [] })
    await recordOwner('brand-kit', 'kit-1', 'u1')
    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/INSERT INTO resource_owners/i)
    expect(sql).toMatch(/ON CONFLICT.*DO NOTHING/is)
    expect(params).toEqual(['brand-kit', 'kit-1', 'u1'])
  })
})

describe('ownerOf', () => {
  it('returns the row\'s user_id when one exists', async () => {
    query.mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] })
    expect(await ownerOf('brand-kit', 'kit-1')).toBe('u1')
  })

  it('returns null when no row matches', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    expect(await ownerOf('brand-kit', 'missing')).toBeNull()
  })
})

describe('ownedIds', () => {
  it('returns a Set of resource_id for the kind+user', async () => {
    query.mockResolvedValue({ rows: [{ resource_id: 'a' }, { resource_id: 'b' }] })
    const ids = await ownedIds('brand-kit', 'u1')
    expect(ids).toEqual(new Set(['a', 'b']))
  })
})

describe('releaseOwner', () => {
  it('deletes by (kind, id)', async () => {
    query.mockResolvedValue({ rows: [] })
    await releaseOwner('brand-kit', 'kit-1')
    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/DELETE FROM resource_owners/i)
    expect(params).toEqual(['brand-kit', 'kit-1'])
  })
})

describe('hostedCanRead', () => {
  it('true when owner is null (curated/global)', () => {
    expect(hostedCanRead(null, 'u1')).toBe(true)
  })
  it('false when owned by a different user', () => {
    expect(hostedCanRead('u2', 'u1')).toBe(false)
  })
  it('true when owned by the caller', () => {
    expect(hostedCanRead('u1', 'u1')).toBe(true)
  })
})

describe('hostedCanMutate', () => {
  it('false when owner is null — unowned is read-only, no first-touch claiming', () => {
    expect(hostedCanMutate(null, 'u1')).toBe(false)
  })
  it('false when owned by a different user', () => {
    expect(hostedCanMutate('u2', 'u1')).toBe(false)
  })
  it('true when owned by the caller', () => {
    expect(hostedCanMutate('u1', 'u1')).toBe(true)
  })
})
