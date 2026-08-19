/**
 * Stage 7 Task 4: operator safety valves — kill-switch + daily ceiling.
 * `assertSpendAllowed` is the backstop for a metering bug spiking spend: it
 * refuses (503) when the system is globally paused, the user is disabled, or
 * today's summed ledger debit credits have hit SAILOR_DAILY_CREDIT_CEILING.
 * Money code — it FAILS CLOSED: an unreadable control state refuses rather
 * than proceeds. Local mode is a pure no-op (no query at all).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertSpendAllowed,
  getControls,
  setGlobalPaused,
  setUserDisabled,
  getTodayCredits,
  __setSystemControlsDbForTests,
} from '../../server/utils/systemControls'
import { MeterRefusalError } from '../../server/utils/requestMeter'

const KEY = 'NUXT_CLERK_SECRET_KEY'
const CEIL = 'SAILOR_DAILY_CREDIT_CEILING'
const savedKey = process.env[KEY]
const savedCeil = process.env[CEIL]

function setHosted(): void { process.env[KEY] = 'sk_test_hosted' }
function setLocal(): void { delete process.env[KEY] }

type Opts = { paused?: boolean; disabled?: boolean; credits?: number }
function makeQuery(opts: Opts = {}) {
  return vi.fn(async (sql: string) => {
    if (/FROM system_controls/i.test(sql)) return { rows: [{ global_paused: opts.paused ?? false }] }
    if (/FROM disabled_users/i.test(sql)) return { rows: opts.disabled ? [{ ok: 1 }] : [] }
    if (/SUM\(amount\)/i.test(sql)) return { rows: [{ c: opts.credits ?? 0 }] }
    return { rows: [] }
  })
}
const sumCalls = (q: ReturnType<typeof makeQuery>) =>
  q.mock.calls.filter(c => /SUM\(amount\)/i.test(String(c[0]))).length

let query: ReturnType<typeof makeQuery>

beforeEach(() => {
  setHosted()
  delete process.env[CEIL]
  query = makeQuery()
  __setSystemControlsDbForTests({ query })
})

afterEach(() => {
  __setSystemControlsDbForTests(null)
  if (savedKey === undefined) delete process.env[KEY]; else process.env[KEY] = savedKey
  if (savedCeil === undefined) delete process.env[CEIL]; else process.env[CEIL] = savedCeil
})

describe('assertSpendAllowed', () => {
  it('resolves when not paused, user not disabled, no ceiling', async () => {
    await expect(assertSpendAllowed('u1')).resolves.toBeUndefined()
  })

  it('local mode is a pure no-op — no query issued', async () => {
    setLocal()
    query = makeQuery()
    __setSystemControlsDbForTests({ query })
    await expect(assertSpendAllowed('u1')).resolves.toBeUndefined()
    expect(query).not.toHaveBeenCalled()
  })

  it('throws 503 when globally paused', async () => {
    query = makeQuery({ paused: true })
    __setSystemControlsDbForTests({ query })
    const err = await assertSpendAllowed('u1').then(() => null, e => e)
    expect(err).toBeInstanceOf(MeterRefusalError)
    expect(err.statusCode).toBe(503)
  })

  it('throws 503 when the user is disabled', async () => {
    query = makeQuery({ disabled: true })
    __setSystemControlsDbForTests({ query })
    await expect(assertSpendAllowed('u1')).rejects.toMatchObject({ statusCode: 503 })
  })

  it('throws 503 when today ledger debit credits >= ceiling', async () => {
    process.env[CEIL] = '100'
    query = makeQuery({ credits: 100 })
    __setSystemControlsDbForTests({ query })
    await expect(assertSpendAllowed('u1')).rejects.toMatchObject({ statusCode: 503 })
    expect(sumCalls(query)).toBe(1)
  })

  it('resolves when today credits are below the ceiling', async () => {
    process.env[CEIL] = '100'
    query = makeQuery({ credits: 99 })
    __setSystemControlsDbForTests({ query })
    await expect(assertSpendAllowed('u1')).resolves.toBeUndefined()
  })

  it('skips the sum query entirely when no ceiling is set', async () => {
    delete process.env[CEIL]
    await assertSpendAllowed('u1')
    expect(sumCalls(query)).toBe(0)
  })

  it('FAILS CLOSED — a controls read that throws refuses with 503', async () => {
    query = vi.fn(async () => { throw new Error('neon is down') })
    __setSystemControlsDbForTests({ query })
    const err = await assertSpendAllowed('u1').then(() => null, e => e)
    expect(err).toBeInstanceOf(MeterRefusalError)
    expect(err.statusCode).toBe(503)
  })

  it('memoizes the daily-credits sum ~30s — two calls in-window issue ONE sum query', async () => {
    process.env[CEIL] = '1000'
    query = makeQuery({ credits: 10 })
    __setSystemControlsDbForTests({ query })
    await assertSpendAllowed('u1')
    await assertSpendAllowed('u2')
    expect(sumCalls(query)).toBe(1)
  })
})

describe('admin setters + reads', () => {
  it('getControls returns paused flag + disabled user list', async () => {
    const q = vi.fn(async (sql: string) => {
      if (/FROM system_controls/i.test(sql)) return { rows: [{ global_paused: true }] }
      if (/FROM disabled_users/i.test(sql)) return { rows: [{ user_id: 'a' }, { user_id: 'b' }] }
      return { rows: [] }
    })
    __setSystemControlsDbForTests({ query: q })
    expect(await getControls()).toEqual({ globalPaused: true, disabledUsers: ['a', 'b'] })
  })

  it('setGlobalPaused updates the single control row', async () => {
    await setGlobalPaused(true)
    const [sql, params] = query.mock.calls[0]
    expect(sql).toMatch(/UPDATE system_controls/i)
    expect(params).toEqual([true])
  })

  it('setUserDisabled true inserts, false deletes', async () => {
    await setUserDisabled('u9', true)
    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO disabled_users/i)
    expect(query.mock.calls[0][1]).toEqual(['u9'])
    query.mockClear()
    await setUserDisabled('u9', false)
    expect(query.mock.calls[0][0]).toMatch(/DELETE FROM disabled_users/i)
    expect(query.mock.calls[0][1]).toEqual(['u9'])
  })

  it('getTodayCredits returns the summed debit credits', async () => {
    query = makeQuery({ credits: 42 })
    __setSystemControlsDbForTests({ query })
    expect(await getTodayCredits()).toBe(42)
  })
})
