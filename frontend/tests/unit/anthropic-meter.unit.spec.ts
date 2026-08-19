/**
 * Task 6 (Stage 4 metering): flat-rate metering on the Anthropic "assist"
 * family — short single-message Claude calls that (like Task 4's bypass
 * routes) don't route through preflightMeter's model-priced chokepoint, so
 * they need their own gate. Two halves:
 *
 * 1. A coverage scan mirroring bypass-route-meter.unit.spec.ts's discovery
 *    approach (walk server/, filter by fetch-host string, assert every hit
 *    references the gate) so the two guards can't drift apart. Written
 *    FIRST per the task's TDD requirement — on the unmodified tree this
 *    failed for every api.anthropic.com file, because none referenced
 *    meterAssist yet. That failure was this test's RED.
 * 2. Unit tests for meterAssist itself: local no-op, hosted debit with exact
 *    args, 402 on insufficient balance, 500 on a missing (invariant-broken)
 *    context — same shape as request-meter.unit.spec.ts's preflightMeter
 *    coverage.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ANTHROPIC_ASSIST_CREDITS, meterAssist } from '../../server/utils/anthropicMeter'
import { MeterRefusalError, __resetMeterContextForTests, __setLedgerForTests, bindMeterContext } from '../../server/utils/requestMeter'
import { __setSystemControlsDbForTests } from '../../server/utils/systemControls'

// A permissive controls db: not paused, no disabled users, no ceiling — so the
// operator spend guard (Stage 7 final review C1) is a pass-through and the
// existing hosted assertions exercise only the ledger path. Hosted meterAssist
// now calls assertSpendAllowed before the debit; without this seam it would hit
// the real db() and 503 on a missing DATABASE_URL.
const allowAllControlsDb = { query: async () => ({ rows: [] as any[] }) }

const serverRoot = fileURLToPath(new URL('../../server', import.meta.url))

// The exact fetch target that means "this file talks to Anthropic directly"
// — same string every wired route in this file's coverage list uses.
const ANTHROPIC_FETCH_PATTERN = 'api.anthropic.com'

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (p.endsWith('.ts')) acc.push(p)
  }
  return acc
}

describe('anthropic-meter coverage guard', () => {
  const allFiles = walk(join(serverRoot, 'api'))

  it('scan is alive (sanity: server/api has plenty of .ts files)', () => {
    expect(allFiles.length).toBeGreaterThan(10)
  })

  const anthropicFiles = allFiles.filter((file) => {
    const src = readFileSync(file, 'utf8')
    return src.includes(ANTHROPIC_FETCH_PATTERN)
  })

  it('found the full known set of Anthropic assist routes (sanity: matcher is not vacuous)', () => {
    expect(anthropicFiles.length).toBeGreaterThanOrEqual(6)
  })

  for (const file of anthropicFiles) {
    const rel = relative(serverRoot, file)
    it(`${rel} references meterAssist`, () => {
      const src = readFileSync(file, 'utf8')
      expect(
        src.includes('meterAssist'),
        `${rel} fetches ${ANTHROPIC_FETCH_PATTERN} but never calls meterAssist — unmetered Anthropic spend risk.`,
      ).toBe(true)
    })
  }
})

const KEY = 'NUXT_CLERK_SECRET_KEY'
const savedKey = process.env[KEY]

function setHosted(): void {
  process.env[KEY] = 'sk_test_hosted'
}
function setLocal(): void {
  delete process.env[KEY]
}

type FakeLedger = {
  getAvailable: ReturnType<typeof vi.fn>
  debit: ReturnType<typeof vi.fn>
}

function makeFakeLedger(opts: { available?: number } = {}): FakeLedger {
  const available = opts.available ?? 1000
  return {
    getAvailable: vi.fn(async (_userId: string) => available),
    debit: vi.fn(async (_userId: string, _amount: number, _reason: string, _key: string) => ({ ok: true })),
  }
}

let fakeLedger: FakeLedger
const fakeEvent = {} as any

beforeEach(() => {
  __resetMeterContextForTests()
  fakeLedger = makeFakeLedger()
  __setLedgerForTests(fakeLedger as any)
  __setSystemControlsDbForTests(allowAllControlsDb)
})

afterEach(() => {
  if (savedKey === undefined) delete process.env[KEY]
  else process.env[KEY] = savedKey
  __setLedgerForTests(null)
  __setSystemControlsDbForTests(null)
  __resetMeterContextForTests()
})

describe('meterAssist', () => {
  it('local mode: no-op — never touches the ledger', async () => {
    setLocal()
    await expect(meterAssist(fakeEvent)).resolves.toBeUndefined()
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted, no bound context: throws a 500 refusal (invariant break on an authed route, fail closed)', async () => {
    setHosted()
    await expect(meterAssist(fakeEvent)).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringContaining('unmetered spend refused'),
    })
    expect(fakeLedger.getAvailable).not.toHaveBeenCalled()
  })

  it('the no-context rejection is a MeterRefusalError instance', async () => {
    setHosted()
    await expect(meterAssist(fakeEvent)).rejects.toBeInstanceOf(MeterRefusalError)
  })

  // Stage 7 final review C1 (secondary bypass): the flat-rate assist path
  // debited without ever consulting the operator spend guard, so the
  // kill-switch never stopped it. A paused system must refuse (503) BEFORE the
  // debit — no ledger charge at all.
  it('hosted, system paused: refuses 503 BEFORE debiting (spend guard)', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    __setSystemControlsDbForTests({ query: async () => ({ rows: [{ global_paused: true }] }) })

    await expect(meterAssist(fakeEvent)).rejects.toMatchObject({ statusCode: 503 })
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted, insufficient balance: throws 402 with {required, available} and never debits', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(ANTHROPIC_ASSIST_CREDITS - 1)

    await expect(meterAssist(fakeEvent)).rejects.toMatchObject({
      statusCode: 402,
      data: { required: ANTHROPIC_ASSIST_CREDITS, available: ANTHROPIC_ASSIST_CREDITS - 1 },
    })
    expect(fakeLedger.debit).not.toHaveBeenCalled()
  })

  it('hosted, sufficient balance: debits the current context user immediately with exact args', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(100)

    await expect(meterAssist(fakeEvent)).resolves.toBeUndefined()

    expect(fakeLedger.getAvailable).toHaveBeenCalledWith('u1')
    expect(fakeLedger.debit).toHaveBeenCalledTimes(1)
    const [userId, amount, reason, idempotencyKey] = fakeLedger.debit.mock.calls[0]
    expect(userId).toBe('u1')
    expect(amount).toBe(ANTHROPIC_ASSIST_CREDITS)
    expect(reason).toBe('anthropic_assist')
    expect(idempotencyKey).toMatch(/^assist:[0-9a-f-]{36}$/)
  })

  it('two calls in the same context mint two distinct idempotency keys', async () => {
    setHosted()
    bindMeterContext({ userId: 'u1' })
    fakeLedger.getAvailable.mockResolvedValue(100)

    await meterAssist(fakeEvent)
    await meterAssist(fakeEvent)

    const keys = fakeLedger.debit.mock.calls.map(call => call[3])
    expect(keys[0]).not.toBe(keys[1])
  })
})

describe('ANTHROPIC_ASSIST_CREDITS', () => {
  it('is the flat rate of 2', () => {
    expect(ANTHROPIC_ASSIST_CREDITS).toBe(2)
  })
})
