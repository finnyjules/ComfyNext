/**
 * Stage 6 Task 4: real route-handler integration for the owner-scoped JSON
 * stores. Drives the ACTUAL brand-kits list/put/delete handlers and the
 * templates [id].get read-guard against a faked resource_owners table and a
 * temp SAILOR_DATA_DIR (so storeDir points the stores at a scratch volume).
 *
 * OPTS constants call storeDir() at import time, so SAILOR_DATA_DIR must be
 * set BEFORE the handlers are imported — hence the dynamic imports in
 * beforeAll (the cloud-train-ownership.unit.spec.ts global-stub pattern).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { __setResourceOwnersDbForTests } from '../../server/utils/resourceOwners'

const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.readBody = async (event: any) => event.body ?? {}
g.getQuery = (event: any) => event.query ?? {}
g.getRouterParam = (event: any, k: string) => event.params?.[k]
g.createError = (opts: { statusCode: number, message?: string, statusMessage?: string }) => {
  const err = new Error(opts.message ?? opts.statusMessage ?? 'error') as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
}

const CLERK_KEY = 'NUXT_CLERK_SECRET_KEY'
const savedClerk = process.env[CLERK_KEY]
const savedDataDir = process.env.SAILOR_DATA_DIR
function setHosted(): void { process.env[CLERK_KEY] = 'sk_test_hosted' }
function setLocal(): void { delete process.env[CLERK_KEY] }

// In-memory resource_owners table.
const owners = new Map<string, string>()
const query = vi.fn(async (sql: string, params: any[] = []) => {
  if (/INSERT INTO resource_owners/i.test(sql)) {
    const [kind, id, uid] = params
    const k = `${kind}:${id}`
    if (!owners.has(k)) owners.set(k, uid)
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

let dataDir: string
let kitsList: any, kitsPut: any, kitsDelete: any, tplGet: any

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'sailor-stage6-'))
  process.env.SAILOR_DATA_DIR = dataDir
  kitsList = (await import('../../server/api/brand-kits/index.get')).default
  kitsPut = (await import('../../server/api/brand-kits/[id].put')).default
  kitsDelete = (await import('../../server/api/brand-kits/[id].delete')).default
  tplGet = (await import('../../server/api/templates/[id].get')).default
})
afterAll(() => {
  if (savedDataDir === undefined) delete process.env.SAILOR_DATA_DIR
  else process.env.SAILOR_DATA_DIR = savedDataDir
})

beforeEach(() => {
  owners.clear()
  query.mockClear()
  __setResourceOwnersDbForTests({ query })
  // Scrub the store dirs so files never bleed between tests.
  for (const d of ['brand-kits', 'templates-layouts']) rmSync(join(dataDir, d), { recursive: true, force: true })
})
afterEach(() => {
  if (savedClerk === undefined) delete process.env[CLERK_KEY]
  else process.env[CLERK_KEY] = savedClerk
})

function kitFile(id: string, name: string): void {
  const dir = join(dataDir, 'brand-kits')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({ id, name, kit: {} }))
}
function ev(opts: { params?: any, body?: any, query?: any, userId?: string | null }) {
  return { params: opts.params, body: opts.body, query: opts.query, context: { userId: opts.userId ?? null } }
}

describe('brand-kits handlers — local mode', () => {
  beforeEach(setLocal)

  it('list returns all kits and never queries the owners db', async () => {
    kitFile('local-a', 'A'); kitFile('local-b', 'B')
    const res = await kitsList(ev({ userId: null }))
    expect(res.kits.map((k: any) => k.id).sort()).toEqual(expect.arrayContaining(['local-a', 'local-b']))
    expect(query).not.toHaveBeenCalled()
  })
})

describe('brand-kits handlers — hosted mode', () => {
  beforeEach(setHosted)

  it('create claims ownership; list scopes to owner + curated; delete releases', async () => {
    // A pre-existing curated kit (file present, no owner row) + another user's kit.
    kitFile('curated', 'Curated')
    kitFile('theirs', 'Theirs'); owners.set('brand-kit:theirs', 'u2')

    // u1 creates a brand-new kit.
    const putRes = await kitsPut(ev({ params: { id: 'mine' }, body: { id: 'mine', name: 'Mine', kit: {} }, userId: 'u1' }))
    expect(putRes).toEqual({ ok: true, id: 'mine' })
    expect(owners.get('brand-kit:mine')).toBe('u1')

    // u1's list = own ('mine') + curated ('curated'); never 'theirs'.
    const list = await kitsList(ev({ userId: 'u1' }))
    expect(list.kits.map((k: any) => k.id).sort()).toEqual(['curated', 'mine'])

    // u1 cannot overwrite the curated kit (read-only) nor u2's kit.
    await expect(kitsPut(ev({ params: { id: 'curated' }, body: { id: 'curated', name: 'X', kit: {} }, userId: 'u1' })))
      .rejects.toMatchObject({ statusCode: 404 })
    await expect(kitsPut(ev({ params: { id: 'theirs' }, body: { id: 'theirs', name: 'X', kit: {} }, userId: 'u1' })))
      .rejects.toMatchObject({ statusCode: 404 })

    // u1 deletes their own kit → file gone + owner row released.
    await kitsDelete(ev({ params: { id: 'mine' }, userId: 'u1' }))
    expect(existsSync(join(dataDir, 'brand-kits', 'mine.json'))).toBe(false)
    expect(owners.has('brand-kit:mine')).toBe(false)

    // u1 cannot delete u2's kit.
    await expect(kitsDelete(ev({ params: { id: 'theirs' }, userId: 'u1' })))
      .rejects.toMatchObject({ statusCode: 404 })
    expect(existsSync(join(dataDir, 'brand-kits', 'theirs.json'))).toBe(true)
  })
})

describe('templates [id].get — hosted read-guard', () => {
  beforeEach(setHosted)

  it('serves curated + own templates, 404s another user\'s', async () => {
    const dir = join(dataDir, 'templates-layouts')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'curated.json'), JSON.stringify({ id: 'curated', version: 2, formats: {} }))
    writeFileSync(join(dir, 'mine.json'), JSON.stringify({ id: 'mine', version: 2, formats: {} }))
    writeFileSync(join(dir, 'theirs.json'), JSON.stringify({ id: 'theirs', version: 2, formats: {} }))
    owners.set('template:mine', 'u1')
    owners.set('template:theirs', 'u2')

    expect((await tplGet(ev({ params: { id: 'curated' }, userId: 'u1' }))).id).toBe('curated')
    expect((await tplGet(ev({ params: { id: 'mine' }, userId: 'u1' }))).id).toBe('mine')
    await expect(tplGet(ev({ params: { id: 'theirs' }, userId: 'u1' })))
      .rejects.toMatchObject({ statusCode: 404 })
  })
})
