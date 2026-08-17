/**
 * Stage 5 Task 2: the stale-hold sweep. Holds reserve credits at preflight
 * and are settled or released by the chokepoint that took them — but a
 * process that dies between hold and settle/release leaves the reservation
 * open forever, silently shrinking that user's spendable balance with no
 * corresponding charge. The sweep is the backstop: anything still 'open'
 * past HOLD_TTL_MS gets released.
 *
 * All I/O is injected (the settleWatcher.ts DI style) so this is a pure,
 * fast unit — no DATABASE_URL, no timers, no ledger session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOLD_SWEEP_FIRST_RUN_MS,
  HOLD_SWEEP_INTERVAL_MS,
  HOLD_TTL_MS,
  startHoldSweeperWith,
  sweepStaleHoldsWith,
} from '../../server/utils/holdSweep'

let errorSpy: ReturnType<typeof vi.spyOn>
let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  errorSpy.mockRestore()
  warnSpy.mockRestore()
})

const NOW = new Date('2026-08-17T12:00:00.000Z')

describe('sweepStaleHoldsWith', () => {
  it('releases every stale hold and returns the count', async () => {
    const release = vi.fn(async (_id: number) => {})
    const released = await sweepStaleHoldsWith(
      { listStaleHoldIds: async () => [11, 12, 13], release }, NOW,
    )

    expect(released).toBe(3)
    expect(release.mock.calls.map(c => c[0])).toEqual([11, 12, 13])
  })

  it('asks for holds older than exactly now - HOLD_TTL_MS', async () => {
    const listStaleHoldIds = vi.fn(async (_cutoff: Date) => [] as number[])
    await sweepStaleHoldsWith({ listStaleHoldIds, release: async () => {} }, NOW)

    const cutoff = listStaleHoldIds.mock.calls[0][0]
    expect(cutoff.getTime()).toBe(NOW.getTime() - HOLD_TTL_MS)
  })

  it('nothing stale: returns 0 and stays quiet', async () => {
    const released = await sweepStaleHoldsWith(
      { listStaleHoldIds: async () => [], release: async () => {} }, NOW,
    )
    expect(released).toBe(0)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('one failing release is logged and does NOT abort the rest of the sweep', async () => {
    const release = vi.fn(async (id: number) => {
      if (id === 12) throw new Error('hold 12 vanished')
    })
    const released = await sweepStaleHoldsWith(
      { listStaleHoldIds: async () => [11, 12, 13], release }, NOW,
    )

    expect(release).toHaveBeenCalledTimes(3) // 13 still got its turn
    expect(released).toBe(2) // only the successful ones are counted
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[holdSweep] release failed'),
      expect.anything(),
    )
  })

  it('a listing failure surfaces to the caller rather than reporting a clean sweep', async () => {
    await expect(sweepStaleHoldsWith(
      { listStaleHoldIds: async () => { throw new Error('db down') }, release: async () => {} }, NOW,
    )).rejects.toThrow('db down')
  })

  it('the TTL is far longer than any legitimate job (2h)', () => {
    expect(HOLD_TTL_MS).toBe(2 * 60 * 60 * 1000)
  })
})

describe('startHoldSweeperWith (what the Nitro plugin wires up)', () => {
  function deps(over: Record<string, unknown> = {}) {
    return {
      isHosted: () => true,
      sweep: vi.fn(async () => 0),
      setTimeout: vi.fn((_fn: () => void, _ms: number) => 't' as unknown as ReturnType<typeof setTimeout>),
      setInterval: vi.fn((_fn: () => void, _ms: number) => 'i' as unknown as ReturnType<typeof setInterval>),
      ...over,
    }
  }

  it('local mode: schedules nothing at all (never opens a ledger session)', () => {
    const d = deps({ isHosted: () => false })
    const started = startHoldSweeperWith(d as any)

    expect(started).toBe(false)
    expect(d.setTimeout).not.toHaveBeenCalled()
    expect(d.setInterval).not.toHaveBeenCalled()
    expect(d.sweep).not.toHaveBeenCalled()
  })

  it('hosted: schedules a delayed first run and a repeating interval, and sweeps nothing synchronously (boot is never blocked)', () => {
    const d = deps()
    const started = startHoldSweeperWith(d as any)

    expect(started).toBe(true)
    expect(d.sweep).not.toHaveBeenCalled() // nothing runs during boot
    expect(d.setTimeout).toHaveBeenCalledWith(expect.any(Function), HOLD_SWEEP_FIRST_RUN_MS)
    expect(d.setInterval).toHaveBeenCalledWith(expect.any(Function), HOLD_SWEEP_INTERVAL_MS)
  })

  it('hosted: the scheduled callbacks actually run the sweep', async () => {
    const d = deps()
    startHoldSweeperWith(d as any)

    await (d.setTimeout.mock.calls[0][0] as () => Promise<void>)()
    await (d.setInterval.mock.calls[0][0] as () => Promise<void>)()

    expect(d.sweep).toHaveBeenCalledTimes(2)
  })

  it('a sweep that throws on its tick is swallowed (an unhandled rejection would take the server down)', async () => {
    const d = deps({ sweep: vi.fn(async () => { throw new Error('db down') }) })
    startHoldSweeperWith(d as any)

    await expect((d.setInterval.mock.calls[0][0] as () => Promise<void>)()).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[holdSweep] sweep failed'),
      expect.anything(),
    )
  })

  it('first run is delayed past boot, and the interval is well inside the TTL', () => {
    expect(HOLD_SWEEP_FIRST_RUN_MS).toBe(60_000)
    expect(HOLD_SWEEP_INTERVAL_MS).toBe(15 * 60_000)
    expect(HOLD_SWEEP_INTERVAL_MS).toBeLessThan(HOLD_TTL_MS)
  })
})
