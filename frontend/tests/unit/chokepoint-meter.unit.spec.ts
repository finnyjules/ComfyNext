/**
 * Task 2 (Stage 4 metering): wiring the meter into the two provider
 * chokepoints — runReplicate (server/utils/replicate.ts) and runFal
 * (server/utils/falRun.ts). Both call preflightMeter(model) BEFORE any
 * provider HTTP call (so a 402/refusal never touches the network), and
 * settle the ticket ONLY at the exact point the existing ok:true logSpend
 * already fires — never on failure/timeout paths.
 *
 * replicate.ts references `createError`, a Nitro auto-import that doesn't
 * exist under plain vitest — stub it globally, the auth-middleware-helpers
 * pattern. `fetch` is mocked globally with canned Replicate/fal HTTP
 * responses so no real network call is ever made.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runReplicate } from '../../server/utils/replicate'
import { runFal } from '../../server/utils/falRun'
import {
  __resetMeterContextForTests,
  __setLedgerForTests,
  bindMeterContext,
} from '../../server/utils/requestMeter'

const g = globalThis as any
g.createError = (opts: { statusCode: number, message?: string, statusMessage?: string }) => {
  const err = new Error(opts.message ?? opts.statusMessage) as Error & { statusCode: number }
  err.statusCode = opts.statusCode
  return err
}

const CLERK_KEY = 'NUXT_CLERK_SECRET_KEY'
const savedClerkKey = process.env[CLERK_KEY]
const savedFalKey = process.env.FAL_KEY

function setHosted(): void {
  process.env[CLERK_KEY] = 'sk_test_hosted'
}
function setLocal(): void {
  delete process.env[CLERK_KEY]
}

/**
 * Stage 5 Task 2: the chokepoint tickets are HOLD-based. `hold` reserves
 * against a live counter here too, so "refuses before any fetch" is driven
 * by a genuinely refused hold rather than by a stubbed comparison.
 */
type FakeLedger = {
  getAvailable: ReturnType<typeof vi.fn>
  hold: ReturnType<typeof vi.fn>
  settleHold: ReturnType<typeof vi.fn>
  releaseHold: ReturnType<typeof vi.fn>
  debit: ReturnType<typeof vi.fn>
  setAvailable(n: number): void
}
function makeFakeLedger(startingAvailable = 1000): FakeLedger {
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
    setAvailable(n: number) { available = n },
  }
}
let fakeLedger: FakeLedger

function jsonResponse(body: unknown, ok = true, status = 200): any {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    statusText: ok ? 'OK' : 'Error',
  }
}

const REPLICATE_MODEL = 'black-forest-labs/flux-dev' // priced in MODEL_COSTS
const FAL_APP = 'fal-ai/flux/dev' // priced in MODEL_COSTS

type ReplicateScenario = 'succeeded' | 'failed' | 'submit-error' | 'lookup-error'

function makeReplicateFetchMock(scenario: ReplicateScenario): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (url === `https://api.replicate.com/v1/models/${REPLICATE_MODEL}`) {
      if (scenario === 'lookup-error') return jsonResponse({ detail: 'nope' }, false, 500)
      return jsonResponse({ latest_version: { id: 'v1' } })
    }
    if (url === 'https://api.replicate.com/v1/predictions') {
      if (scenario === 'submit-error') return jsonResponse({ detail: 'rejected' }, false, 422)
      return jsonResponse({
        id: 'pred123',
        status: scenario,
        output: scenario === 'succeeded' ? ['https://out.png'] : undefined,
        error: scenario === 'failed' ? 'boom' : undefined,
      })
    }
    throw new Error('unexpected replicate fetch url: ' + url)
  })
}

type FalScenario = 'COMPLETED' | 'FAILED' | 'submit-error' | 'result-error' | 'status-4xx'

function makeFalFetchMock(scenario: FalScenario): ReturnType<typeof vi.fn> {
  const base = `https://queue.fal.run/${FAL_APP}`
  return vi.fn(async (url: string) => {
    if (url === base) {
      if (scenario === 'submit-error') return jsonResponse({ detail: 'rejected' }, false, 422)
      return jsonResponse({
        request_id: 'req1',
        status_url: `${base}/requests/req1/status`,
        response_url: `${base}/requests/req1`,
      })
    }
    if (url === `${base}/requests/req1/status`) {
      if (scenario === 'status-4xx') return jsonResponse({ detail: 'gone' }, false, 404)
      return jsonResponse({ status: scenario === 'result-error' ? 'COMPLETED' : scenario })
    }
    if (url === `${base}/requests/req1`) {
      if (scenario === 'result-error') return jsonResponse({ detail: 'boom' }, false, 500)
      return jsonResponse({ images: [{ url: 'https://out.png' }] })
    }
    throw new Error('unexpected fal fetch url: ' + url)
  })
}

beforeEach(() => {
  __resetMeterContextForTests()
  fakeLedger = makeFakeLedger()
  __setLedgerForTests(fakeLedger as any)
  process.env.FAL_KEY = 'test-fal-key'
})

afterEach(() => {
  if (savedClerkKey === undefined) delete process.env[CLERK_KEY]
  else process.env[CLERK_KEY] = savedClerkKey
  if (savedFalKey === undefined) delete process.env.FAL_KEY
  else process.env.FAL_KEY = savedFalKey
  __setLedgerForTests(null)
  __resetMeterContextForTests()
  vi.unstubAllGlobals()
})

describe('runReplicate + meter', () => {
  it('local mode: no ledger interaction, output round-trips unchanged', async () => {
    setLocal()
    const fetchMock = makeReplicateFetchMock('succeeded')
    vi.stubGlobal('fetch', fetchMock)

    const output = await runReplicate(REPLICATE_MODEL, { prompt: 'x' }, 'tok')

    expect(output).toEqual(['https://out.png'])
    expect(fakeLedger.hold).not.toHaveBeenCalled()
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).not.toHaveBeenCalled()
  })

  it('hosted, success: holds before dispatch and settles that hold exactly once', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    const fetchMock = makeReplicateFetchMock('succeeded')
    vi.stubGlobal('fetch', fetchMock)

    const output = await runReplicate(REPLICATE_MODEL, { prompt: 'x' }, 'tok')

    expect(output).toEqual(['https://out.png'])
    expect(fakeLedger.hold).toHaveBeenCalledWith('u1', 5, expect.stringMatching(/^meter:/))
    expect(fakeLedger.settleHold).toHaveBeenCalledTimes(1)
    expect(fakeLedger.settleHold).toHaveBeenCalledWith(1, 5, `provider:${REPLICATE_MODEL}`)
    expect(fakeLedger.releaseHold).not.toHaveBeenCalled()
  })

  it('hosted, provider failure: RELEASES the hold, never settles, still throws', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    const fetchMock = makeReplicateFetchMock('failed')
    vi.stubGlobal('fetch', fetchMock)

    await expect(runReplicate(REPLICATE_MODEL, { prompt: 'x' }, 'tok')).rejects.toMatchObject({ statusCode: 502 })
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1)
  })

  it('hosted, submit rejected by the provider: RELEASES the hold, never settles', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    vi.stubGlobal('fetch', makeReplicateFetchMock('submit-error'))

    await expect(runReplicate(REPLICATE_MODEL, { prompt: 'x' }, 'tok')).rejects.toMatchObject({ statusCode: 502 })
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1)
  })

  it('hosted, version lookup fails before submit: RELEASES the hold', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    vi.stubGlobal('fetch', makeReplicateFetchMock('lookup-error'))

    await expect(runReplicate(REPLICATE_MODEL, { prompt: 'x' }, 'tok')).rejects.toMatchObject({ statusCode: 502 })
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1)
  })

  it('hosted, polling times out: RELEASES the hold', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    // A prediction that never leaves 'processing' + a zero timeout budget.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === `https://api.replicate.com/v1/models/${REPLICATE_MODEL}`) return jsonResponse({ latest_version: { id: 'v1' } })
      return jsonResponse({ id: 'pred123', status: 'processing' })
    }))

    await expect(runReplicate(REPLICATE_MODEL, { prompt: 'x' }, 'tok', { timeoutMs: -1, pollMs: 1 }))
      .rejects.toMatchObject({ statusCode: 504 })
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1)
  })

  it('hosted, insufficient credits: refuses before any fetch (402), holds nothing to release', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(0)
    const fetchMock = makeReplicateFetchMock('succeeded')
    vi.stubGlobal('fetch', fetchMock)

    await expect(runReplicate(REPLICATE_MODEL, { prompt: 'x' }, 'tok')).rejects.toMatchObject({ statusCode: 402 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).not.toHaveBeenCalled()
  })
})

describe('runFal + meter', () => {
  it('local mode: no ledger interaction, result round-trips unchanged', async () => {
    setLocal()
    const fetchMock = makeFalFetchMock('COMPLETED')
    vi.stubGlobal('fetch', fetchMock)

    const result = await runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1 })

    expect(result).toEqual({ images: [{ url: 'https://out.png' }] })
    expect(fakeLedger.hold).not.toHaveBeenCalled()
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).not.toHaveBeenCalled()
  })

  it('hosted, success: holds before dispatch and settles that hold exactly once', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    const fetchMock = makeFalFetchMock('COMPLETED')
    vi.stubGlobal('fetch', fetchMock)

    const result = await runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1 })

    expect(result).toEqual({ images: [{ url: 'https://out.png' }] })
    expect(fakeLedger.hold).toHaveBeenCalledWith('u1', 5, expect.stringMatching(/^meter:/))
    expect(fakeLedger.settleHold).toHaveBeenCalledTimes(1)
    expect(fakeLedger.settleHold).toHaveBeenCalledWith(1, 5, `provider:${FAL_APP}`)
    expect(fakeLedger.releaseHold).not.toHaveBeenCalled()
  })

  it('hosted, provider failure: RELEASES the hold, never settles, still throws', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    const fetchMock = makeFalFetchMock('FAILED')
    vi.stubGlobal('fetch', fetchMock)

    await expect(runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1 })).rejects.toThrow()
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1)
  })

  it('hosted, submit rejected by fal: RELEASES the hold, never settles', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    vi.stubGlobal('fetch', makeFalFetchMock('submit-error'))

    await expect(runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1 })).rejects.toThrow(/fal submit 422/)
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1)
  })

  it('hosted, non-retryable 4xx while polling: RELEASES the hold', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    vi.stubGlobal('fetch', makeFalFetchMock('status-4xx'))

    await expect(runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1 })).rejects.toThrow(/not retryable/)
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1)
  })

  it('hosted, COMPLETED but the result fetch fails: RELEASES the hold (no output was delivered)', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    vi.stubGlobal('fetch', makeFalFetchMock('result-error'))

    await expect(runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1 })).rejects.toThrow(/fal result 500/)
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1)
  })

  it('hosted, polling deadline expires: RELEASES the hold', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(100)
    vi.stubGlobal('fetch', makeFalFetchMock('COMPLETED'))

    await expect(runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1, pollDeadlineMs: -1 }))
      .rejects.toThrow(/timed out/)
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).toHaveBeenCalledWith(1)
  })

  it('hosted, insufficient credits: refuses before any fetch (402), holds nothing to release', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.setAvailable(0)
    const fetchMock = makeFalFetchMock('COMPLETED')
    vi.stubGlobal('fetch', fetchMock)

    await expect(runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1 })).rejects.toMatchObject({ statusCode: 402 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fakeLedger.settleHold).not.toHaveBeenCalled()
    expect(fakeLedger.releaseHold).not.toHaveBeenCalled()
  })
})

/**
 * Coverage guard (Stage 5 Task 2), the same enforcement idea as
 * bypass-route-meter.unit.spec.ts: a hold that is neither settled nor
 * released locks the user's credits until holdSweep's 2h TTL. So every
 * server file that takes a ticket must also show a release path. A file
 * that deliberately has none carries a `HOLD-EXEMPT:` marker explaining why.
 */
describe('every preflight call site has a release path', () => {
  const serverRoot = fileURLToPath(new URL('../../server', import.meta.url))

  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, acc)
      else if (p.endsWith('.ts')) acc.push(p)
    }
    return acc
  }

  const callers = walk(serverRoot).filter((file) => {
    if (file.endsWith('requestMeter.ts')) return false // defines the ticket
    const src = readFileSync(file, 'utf8')
    return /\bpreflightMeter(For)?\s*\(/.test(src)
  })

  it('sanity: the scan finds the known preflight call sites', () => {
    expect(callers.length).toBeGreaterThan(5)
  })

  for (const file of callers) {
    const rel = relative(serverRoot, file)
    it(`${rel} releases its hold on failure (or is HOLD-EXEMPT)`, () => {
      const src = readFileSync(file, 'utf8')
      const covered = src.includes('.release()') || src.includes('HOLD-EXEMPT:')
      expect(
        covered,
        `${rel} takes a meter ticket but never calls ticket.release() — a failed job ` +
        'there leaks a ledger hold until holdSweep\'s TTL.',
      ).toBe(true)
    })
  }
})
