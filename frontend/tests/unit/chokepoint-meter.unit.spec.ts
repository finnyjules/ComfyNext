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

type FakeLedger = {
  getAvailable: ReturnType<typeof vi.fn>
  debit: ReturnType<typeof vi.fn>
}
function makeFakeLedger(available = 1000): FakeLedger {
  return {
    getAvailable: vi.fn(async (_userId: string) => available),
    debit: vi.fn(async (_userId: string, _amount: number, _reason: string, _key: string) => ({ ok: true })),
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

function makeReplicateFetchMock(scenario: 'succeeded' | 'failed'): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    if (url === `https://api.replicate.com/v1/models/${REPLICATE_MODEL}`) {
      return jsonResponse({ latest_version: { id: 'v1' } })
    }
    if (url === 'https://api.replicate.com/v1/predictions') {
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

function makeFalFetchMock(scenario: 'COMPLETED' | 'FAILED'): ReturnType<typeof vi.fn> {
  const base = `https://queue.fal.run/${FAL_APP}`
  return vi.fn(async (url: string) => {
    if (url === base) {
      return jsonResponse({
        request_id: 'req1',
        status_url: `${base}/requests/req1/status`,
        response_url: `${base}/requests/req1`,
      })
    }
    if (url === `${base}/requests/req1/status`) {
      return jsonResponse({ status: scenario })
    }
    if (url === `${base}/requests/req1`) {
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
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted, success: settles exactly once with key rep:<pred.id>', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(100)
    const fetchMock = makeReplicateFetchMock('succeeded')
    vi.stubGlobal('fetch', fetchMock)

    const output = await runReplicate(REPLICATE_MODEL, { prompt: 'x' }, 'tok')

    expect(output).toEqual(['https://out.png'])
    expect(fakeLedger.debit).toHaveBeenCalledTimes(1)
    expect(fakeLedger.debit).toHaveBeenCalledWith('u1', 5, `provider:${REPLICATE_MODEL}`, 'rep:pred123')
  })

  it('hosted, provider failure: never settles, still throws', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(100)
    const fetchMock = makeReplicateFetchMock('failed')
    vi.stubGlobal('fetch', fetchMock)

    await expect(runReplicate(REPLICATE_MODEL, { prompt: 'x' }, 'tok')).rejects.toMatchObject({ statusCode: 502 })
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted, insufficient credits: refuses before any fetch (402), never settles', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(0)
    const fetchMock = makeReplicateFetchMock('succeeded')
    vi.stubGlobal('fetch', fetchMock)

    await expect(runReplicate(REPLICATE_MODEL, { prompt: 'x' }, 'tok')).rejects.toMatchObject({ statusCode: 402 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })
})

describe('runFal + meter', () => {
  it('local mode: no ledger interaction, result round-trips unchanged', async () => {
    setLocal()
    const fetchMock = makeFalFetchMock('COMPLETED')
    vi.stubGlobal('fetch', fetchMock)

    const result = await runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1 })

    expect(result).toEqual({ images: [{ url: 'https://out.png' }] })
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted, success: settles exactly once with key fal:<request_id>', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(100)
    const fetchMock = makeFalFetchMock('COMPLETED')
    vi.stubGlobal('fetch', fetchMock)

    const result = await runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1 })

    expect(result).toEqual({ images: [{ url: 'https://out.png' }] })
    expect(fakeLedger.debit).toHaveBeenCalledTimes(1)
    expect(fakeLedger.debit).toHaveBeenCalledWith('u1', 5, `provider:${FAL_APP}`, 'fal:req1')
  })

  it('hosted, provider failure: never settles, still throws', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(100)
    const fetchMock = makeFalFetchMock('FAILED')
    vi.stubGlobal('fetch', fetchMock)

    await expect(runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1 })).rejects.toThrow()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted, insufficient credits: refuses before any fetch (402), never settles', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(0)
    const fetchMock = makeFalFetchMock('COMPLETED')
    vi.stubGlobal('fetch', fetchMock)

    await expect(runFal(FAL_APP, { prompt: 'x' }, { pollIntervalMs: 1 })).rejects.toMatchObject({ statusCode: 402 })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })
})
