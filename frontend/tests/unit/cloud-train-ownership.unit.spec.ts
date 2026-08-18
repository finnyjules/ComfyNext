/**
 * Stage 6 Task 3b: cloud-train direct-training ownership (legacy path, found
 * in review — sibling gap to Task 3's training-queue). Today
 * cloud-train/start.post.ts is metered (charges the right wallet) but
 * records no durable owner for the Replicate training id it creates, and
 * cloud-train/status.get.ts polls ANY training id + downloads the resulting
 * LoRA weights with ZERO ownership check — any signed-in hosted user could
 * poll (and pull the weights for) another user's training.
 *
 * Fix: `start` records the training id's owner via resourceOwners (kind
 * 'cloud-training') the moment the id is known (right after the Replicate
 * create call succeeds — mirrors the metering's own "settle right after
 * create" timing). `status` gates on that ownership BEFORE polling Replicate
 * or touching disk — an id with no owner row (legacy/pre-3b) or owned by
 * someone else both 404, no existence disclosure, exactly the voice-clone/
 * training-queue discipline.
 *
 * Drives the REAL route handlers (server/api/cloud-train/{start,status})
 * against a faked Replicate `fetch` and a faked resource_owners db (the
 * resourceOwners.unit.spec.ts / training-queue-ownership.unit.spec.ts
 * pattern) — no real network, no real Postgres. The handlers rely on Nitro
 * auto-imports (defineEventHandler/readBody/getQuery/createError/
 * requireReplicateToken), stubbed as globals before the modules are
 * imported (the voice-clone-owners.unit.spec.ts pattern).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setResourceOwnersDbForTests, ownerOf } from '../../server/utils/resourceOwners'
import { __resetMeterContextForTests, __setLedgerForTests, bindMeterContext } from '../../server/utils/requestMeter'
import { _resetRateLimits } from '../../server/lib/rateLimit'

const g = globalThis as any
g.defineEventHandler = (fn: any) => fn
g.readBody = async (event: any) => event.body ?? {}
g.getQuery = (event: any) => event.query ?? {}
g.createError = (opts: { statusCode: number, message?: string, statusMessage?: string }) => {
  const err = new Error(opts.message ?? opts.statusMessage ?? 'error') as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
}
g.requireReplicateToken = () => 'test-replicate-token'

const CLERK_KEY = 'NUXT_CLERK_SECRET_KEY'
const savedClerkKey = process.env[CLERK_KEY]
function setHosted(): void { process.env[CLERK_KEY] = 'sk_test_hosted' }
function setLocal(): void { delete process.env[CLERK_KEY] }

let startHandler: (event: any) => Promise<any>
let statusHandler: (event: any) => Promise<any>

beforeAll(async () => {
  startHandler = (await import('../../server/api/cloud-train/start.post')).default as any
  statusHandler = (await import('../../server/api/cloud-train/status.get')).default as any
})

/** In-memory fake standing in for the resource_owners table — same query
 *  shapes resourceOwners.ts issues (INSERT ... ON CONFLICT DO NOTHING,
 *  SELECT user_id ..., DELETE ...), backed by a Map so recordOwner + ownerOf
 *  round-trip for real instead of being independently stubbed. */
function makeFakeOwnersDb() {
  const rows = new Map<string, string>()
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO resource_owners/i.test(sql)) {
      const [kind, id, userId] = params as [string, string, string]
      const key = `${kind}::${id}`
      if (!rows.has(key)) rows.set(key, userId)
      return { rows: [] }
    }
    if (/SELECT user_id FROM resource_owners/i.test(sql)) {
      const [kind, id] = params as [string, string]
      const key = `${kind}::${id}`
      return rows.has(key) ? { rows: [{ user_id: rows.get(key) }] } : { rows: [] }
    }
    if (/DELETE FROM resource_owners/i.test(sql)) {
      const [kind, id] = params as [string, string]
      rows.delete(`${kind}::${id}`)
      return { rows: [] }
    }
    throw new Error('unexpected query: ' + sql)
  })
  return { query, rows }
}

type FakeLedger = {
  getAvailable: ReturnType<typeof vi.fn>
  hold: ReturnType<typeof vi.fn>
  settleHold: ReturnType<typeof vi.fn>
  releaseHold: ReturnType<typeof vi.fn>
  debit: ReturnType<typeof vi.fn>
}
function makeFakeLedger(startingAvailable = 10_000): FakeLedger {
  let available = startingAvailable
  let holdSeq = 0
  return {
    getAvailable: vi.fn(async (_userId: string) => available),
    hold: vi.fn(async (_userId: string, estimate: number, _key: string) => {
      if (estimate > available) return { ok: false as const, reason: 'insufficient' as const }
      available -= estimate
      return { ok: true as const, holdId: ++holdSeq }
    }),
    settleHold: vi.fn(async (_holdId: number, _actual: number, _reason: string) => ({ ok: true as const, balance: 0, settled: true })),
    releaseHold: vi.fn(async (_holdId: number) => {}),
    debit: vi.fn(async (_userId: string, _amount: number, _reason: string, _key: string) => ({ ok: true })),
  }
}

function evt(over: Record<string, unknown> = {}): any {
  return { node: { req: { socket: { remoteAddress: '10.0.0.7' } } }, context: {}, ...over }
}
function startEvent(userId: string | null): any {
  return evt({
    context: { userId },
    body: { family: 'flux', datasetUrl: 'https://example.com/data.zip', outputName: 'my-lora' },
  })
}
function statusEvent(id: string, userId: string | null): any {
  return evt({ context: { userId }, query: { id } })
}
function json(body: unknown, ok = true, status = 200): any {
  return { ok, status, statusText: ok ? 'OK' : 'Error', json: async () => body, text: async () => JSON.stringify(body) }
}

/** Replicate stub for start.post.ts's create-training flow. */
function makeReplicateStartMock(trainingId = 'train_1'): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string, init?: any) => {
    if (/\/v1\/models\/[^/]+\/[^/]+$/.test(url) && (!init || !init.method || init.method === 'GET')) {
      return json({ latest_version: { id: 'v1' } })
    }
    if (url === 'https://api.replicate.com/v1/account') {
      return json({ username: 'jules' })
    }
    if (url === 'https://api.replicate.com/v1/models' && init?.method === 'POST') {
      return json({ ok: true })
    }
    if (/\/trainings$/.test(url) && init?.method === 'POST') {
      return json({ id: trainingId, status: 'starting' })
    }
    throw new Error('unexpected fetch url in start mock: ' + url)
  })
}

/** Replicate stub for status.get.ts's poll — 'processing' so no download/
 *  character-link side path runs; that's out of scope for the ownership gate. */
function makeReplicateStatusMock(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (/\/v1\/trainings\//.test(url)) {
      return json({ id: url.split('/').pop(), status: 'processing' })
    }
    throw new Error('unexpected fetch url in status mock: ' + url)
  })
}

let fakeOwnersDb: ReturnType<typeof makeFakeOwnersDb>

beforeEach(() => {
  _resetRateLimits()
  __resetMeterContextForTests()
  __setLedgerForTests(makeFakeLedger() as any)
  fakeOwnersDb = makeFakeOwnersDb()
  __setResourceOwnersDbForTests(fakeOwnersDb)
})

afterEach(() => {
  if (savedClerkKey === undefined) delete process.env[CLERK_KEY]
  else process.env[CLERK_KEY] = savedClerkKey
  __setLedgerForTests(null)
  __resetMeterContextForTests()
  __setResourceOwnersDbForTests(null)
  vi.unstubAllGlobals()
})

// --------------------------------------------------------------- start.post

describe('POST /api/cloud-train/start — hosted ownership recording', () => {
  it('on a successful training create, records the caller as owner of the returned training id', async () => {
    setHosted()
    bindMeterContext({ userId: 'u_owner' })
    vi.stubGlobal('fetch', makeReplicateStartMock('train_abc'))

    const result = await startHandler(startEvent('u_owner'))
    expect(result.id).toBe('train_abc')
    expect(await ownerOf('cloud-training', 'train_abc')).toBe('u_owner')
  })

  it('a hosted request with no userId in context (defensive: metering should already require one) records NO owner row', async () => {
    setHosted()
    bindMeterContext({ userId: '' })
    vi.stubGlobal('fetch', makeReplicateStartMock('train_no_owner'))

    const result = await startHandler(startEvent(''))
    expect(result.id).toBe('train_no_owner')
    expect(await ownerOf('cloud-training', 'train_no_owner')).toBeNull()
  })

  it('LOCAL mode: unchanged — no registry write at all', async () => {
    setLocal()
    vi.stubGlobal('fetch', makeReplicateStartMock('train_local'))

    const result = await startHandler(startEvent(null))
    expect(result.id).toBe('train_local')
    expect(fakeOwnersDb.query).not.toHaveBeenCalled()
  })
})

// -------------------------------------------------------------- status.get

describe('GET /api/cloud-train/status — hosted ownership gate', () => {
  it('a training id owned by ANOTHER user: 404, and Replicate is NEVER polled', async () => {
    setHosted()
    // Seed ownership as if start.post.ts had already recorded it for u_owner.
    fakeOwnersDb.rows.set('cloud-training::train_theirs', 'u_owner')
    const fetchMock = makeReplicateStatusMock()
    vi.stubGlobal('fetch', fetchMock)

    await expect(statusHandler(statusEvent('train_theirs', 'u_other'))).rejects.toMatchObject({ statusCode: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an id with NO owner row (legacy/pre-3b training): 404 too — fail closed, never guess an owner', async () => {
    setHosted()
    const fetchMock = makeReplicateStatusMock()
    vi.stubGlobal('fetch', fetchMock)

    await expect(statusHandler(statusEvent('train_legacy', 'u_owner'))).rejects.toMatchObject({ statusCode: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('own training id: proceeds — Replicate IS polled and the status is returned', async () => {
    setHosted()
    fakeOwnersDb.rows.set('cloud-training::train_mine', 'u_owner')
    const fetchMock = makeReplicateStatusMock()
    vi.stubGlobal('fetch', fetchMock)

    const result = await statusHandler(statusEvent('train_mine', 'u_owner'))
    expect(fetchMock).toHaveBeenCalled()
    expect(result.status).toBe('processing')
  })

  it('LOCAL mode: unchanged — polls ANY id regardless of owner, no registry read', async () => {
    setLocal()
    const fetchMock = makeReplicateStatusMock()
    vi.stubGlobal('fetch', fetchMock)

    const result = await statusHandler(statusEvent('train_anyones', null))
    expect(fetchMock).toHaveBeenCalled()
    expect(result.status).toBe('processing')
    expect(fakeOwnersDb.query).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------- end-to-end

describe('end-to-end: start then status, same vs. different caller', () => {
  it('the user who started the training can poll it; a different hosted user gets 404', async () => {
    setHosted()
    bindMeterContext({ userId: 'u_owner' })
    vi.stubGlobal('fetch', makeReplicateStartMock('train_e2e'))
    const started = await startHandler(startEvent('u_owner'))
    expect(started.id).toBe('train_e2e')

    vi.stubGlobal('fetch', makeReplicateStatusMock())
    const own = await statusHandler(statusEvent('train_e2e', 'u_owner'))
    expect(own.status).toBe('processing')

    const otherFetch = makeReplicateStatusMock()
    vi.stubGlobal('fetch', otherFetch)
    await expect(statusHandler(statusEvent('train_e2e', 'u_intruder'))).rejects.toMatchObject({ statusCode: 404 })
    expect(otherFetch).not.toHaveBeenCalled()
  })
})
