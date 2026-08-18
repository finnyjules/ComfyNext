/**
 * Stage 6 Task 4: ownedJsonStore.ts — shared owner-scoping for the flat JSON
 * file stores. Drives the helper against a faked resource_owners table (the
 * resourceOwners.unit.spec.ts pattern) and toggles deployMode via env.
 *
 * Contract:
 *  - LOCAL: no filtering, always-allow, ZERO registry calls (byte-identical).
 *  - HOSTED list: own records PLUS unowned/curated ones — never other-owned.
 *  - HOSTED guardMutation: refuse other-owned AND unowned-but-existing
 *    (curated = read-only) with 404; allow a brand-new id and an own id.
 *  - null userId in hosted is safe: list shows only curated, mutation 404s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setResourceOwnersDbForTests } from '../../server/utils/resourceOwners'
import { listOwned, guardMutation, claimNew, releaseRecord } from '../../server/utils/ownedJsonStore'

const g = globalThis as any
g.createError = (opts: { statusCode: number, message?: string, statusMessage?: string }) => {
  const err = new Error(opts.message ?? opts.statusMessage ?? 'error') as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
}

const CLERK_KEY = 'NUXT_CLERK_SECRET_KEY'
const saved = process.env[CLERK_KEY]
function setHosted(): void { process.env[CLERK_KEY] = 'sk_test_hosted' }
function setLocal(): void { delete process.env[CLERK_KEY] }

// A stateful in-memory model of the resource_owners table.
const owners = new Map<string, string>() // `${kind}:${id}` -> userId
const query = vi.fn(async (sql: string, params: any[] = []) => {
  if (/INSERT INTO resource_owners/i.test(sql)) {
    const [kind, id, uid] = params
    const k = `${kind}:${id}`
    if (!owners.has(k)) owners.set(k, uid) // ON CONFLICT DO NOTHING (first-owner-wins)
    return { rows: [] }
  }
  if (/SELECT user_id FROM resource_owners/i.test(sql)) {
    const [kind, id] = params
    const v = owners.get(`${kind}:${id}`)
    return { rows: v ? [{ user_id: v }] : [] }
  }
  if (/SELECT resource_id FROM resource_owners/i.test(sql)) {
    const [kind, uid] = params
    const rows = [...owners.entries()]
      .filter(([k, u]) => k.startsWith(`${kind}:`) && u === uid)
      .map(([k]) => ({ resource_id: k.slice(kind.length + 1) }))
    return { rows }
  }
  if (/DELETE FROM resource_owners/i.test(sql)) {
    const [kind, id] = params
    owners.delete(`${kind}:${id}`)
    return { rows: [] }
  }
  return { rows: [] }
})

const OPTS = { kind: 'brand-kit', dir: '/tmp/nowhere' }

beforeEach(() => {
  owners.clear()
  query.mockClear()
  __setResourceOwnersDbForTests({ query })
})
afterEach(() => {
  if (saved === undefined) delete process.env[CLERK_KEY]
  else process.env[CLERK_KEY] = saved
})

type Rec = { id: string, name: string }
function readAll(recs: Rec[]) {
  return async () => recs.map(r => ({ id: r.id, record: r }))
}

describe('local mode — byte-identical, zero registry calls', () => {
  beforeEach(setLocal)

  it('listOwned returns every record untouched and never queries the db', async () => {
    const recs = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    const out = await listOwned(OPTS, null, readAll(recs))
    expect(out).toEqual(recs)
    expect(query).not.toHaveBeenCalled()
  })

  it('guardMutation always allows and never queries the db', async () => {
    await expect(guardMutation(OPTS, null, 'anything', true)).resolves.toBeUndefined()
    await expect(guardMutation(OPTS, 'u1', 'x', false)).resolves.toBeUndefined()
    expect(query).not.toHaveBeenCalled()
  })

  it('claimNew and releaseRecord are no-ops that never query the db', async () => {
    await claimNew(OPTS, 'u1', 'a')
    await releaseRecord(OPTS, 'a')
    expect(query).not.toHaveBeenCalled()
  })
})

describe('hosted mode — listOwned', () => {
  beforeEach(setHosted)

  it('returns own records PLUS unowned/curated, never other-owned', async () => {
    owners.set('brand-kit:mine', 'u1')
    owners.set('brand-kit:theirs', 'u2')
    // 'curated' has no owner row.
    const recs = [
      { id: 'mine', name: 'Mine' },
      { id: 'theirs', name: 'Theirs' },
      { id: 'curated', name: 'Curated' },
    ]
    const out = await listOwned(OPTS, 'u1', readAll(recs))
    expect(out.map(r => r.id).sort()).toEqual(['curated', 'mine'])
  })

  it('null userId sees only curated/unowned records', async () => {
    owners.set('brand-kit:mine', 'u1')
    const recs = [{ id: 'mine', name: 'Mine' }, { id: 'curated', name: 'Curated' }]
    const out = await listOwned(OPTS, null, readAll(recs))
    expect(out.map(r => r.id)).toEqual(['curated'])
  })
})

describe('hosted mode — guardMutation', () => {
  beforeEach(setHosted)

  it('allows a brand-new id (no owner row, not on disk)', async () => {
    await expect(guardMutation(OPTS, 'u1', 'fresh', false)).resolves.toBeUndefined()
  })

  it('allows the owner', async () => {
    owners.set('brand-kit:mine', 'u1')
    await expect(guardMutation(OPTS, 'u1', 'mine', true)).resolves.toBeUndefined()
  })

  it('refuses another user\'s record with 404', async () => {
    owners.set('brand-kit:theirs', 'u2')
    await expect(guardMutation(OPTS, 'u1', 'theirs', true)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('refuses an unowned-but-existing record (curated = read-only) with 404', async () => {
    // No owner row, but the file exists on disk → curated, mutable by none.
    await expect(guardMutation(OPTS, 'u1', 'curated', true)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('refuses everything for a null userId (fail closed)', async () => {
    await expect(guardMutation(OPTS, null, 'fresh', false)).rejects.toMatchObject({ statusCode: 404 })
    await expect(guardMutation(OPTS, null, 'curated', true)).rejects.toMatchObject({ statusCode: 404 })
  })
})

describe('hosted mode — claimNew / releaseRecord', () => {
  beforeEach(setHosted)

  it('claimNew records ownership (first-owner-wins)', async () => {
    await claimNew(OPTS, 'u1', 'fresh')
    expect(owners.get('brand-kit:fresh')).toBe('u1')
    // A brand-new id is now mutable by its owner and refused for others.
    await expect(guardMutation(OPTS, 'u1', 'fresh', true)).resolves.toBeUndefined()
    await expect(guardMutation(OPTS, 'u2', 'fresh', true)).rejects.toMatchObject({ statusCode: 404 })
  })

  it('claimNew with a null userId is a no-op (never guesses an owner)', async () => {
    await claimNew(OPTS, null, 'fresh')
    expect(owners.has('brand-kit:fresh')).toBe(false)
  })

  it('releaseRecord drops the ownership row', async () => {
    owners.set('brand-kit:mine', 'u1')
    await releaseRecord(OPTS, 'mine')
    expect(owners.has('brand-kit:mine')).toBe(false)
  })
})
