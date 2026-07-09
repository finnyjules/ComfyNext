import { describe, it, expect, beforeEach } from 'vitest'
import { pickWorker, routeSingleRun } from '~/lib/graph/pickWorker'
import { reserve, releaseReservation, registerRun, inFlight, clearAllRuns } from '~/lib/graph/runRegistry'

// pickWorker: pool workers are 1-based app-side indices 1..poolSize (0 = main,
// which is never picked here). Given an in-flight count per app-side worker,
// return the pool worker (1..poolSize) with the fewest in-flight runs; ties
// resolve to the lowest index. poolSize 0 → 0 (no pool, caller falls back to
// main).
describe('pickWorker', () => {
  it('returns 0 when poolSize is 0 (no pool available)', () => {
    expect(pickWorker([], 0)).toBe(0)
    expect(pickWorker([5, 2], 0)).toBe(0)
  })

  it('picks the only pool worker when poolSize is 1', () => {
    // index 0 = main (ignored), index 1 = the sole pool worker.
    expect(pickWorker([0, 0], 1)).toBe(1)
    expect(pickWorker([9, 3], 1)).toBe(1)
  })

  it('picks the least-loaded pool worker', () => {
    // main=index0 ignored; worker 1 has 3 in-flight, worker 2 has 1 → pick 2.
    expect(pickWorker([0, 3, 1], 2)).toBe(2)
  })

  it('breaks ties to the lowest index', () => {
    // both pool workers idle → lowest wins.
    expect(pickWorker([0, 0, 0], 2)).toBe(1)
    // both pool workers have 2 in-flight → lowest wins.
    expect(pickWorker([0, 2, 2], 2)).toBe(1)
  })

  it('treats a missing in-flight entry as zero load', () => {
    // array shorter than poolSize+1: worker 2 unrecorded → counts as 0 → picked.
    expect(pickWorker([0, 4], 2)).toBe(2)
    // fully empty array, poolSize 2 → both zero → lowest.
    expect(pickWorker([], 2)).toBe(1)
  })
})

describe('routeSingleRun (spill-to-pool decision)', () => {
  // Single direct runs: keep main when it's free (no worker-boot latency),
  // spill to the least-loaded pool worker when main is busy and the prompt
  // is pool-eligible; ineligible or pool-less prompts always stay on main.
  it('stays on main when main is idle', () => {
    expect(routeSingleRun({ eligible: true, mainInFlight: 0, poolInFlight: [0, 0], poolSize: 2 })).toBe(0)
  })
  it('spills to the least-loaded pool worker when main is busy', () => {
    expect(routeSingleRun({ eligible: true, mainInFlight: 1, poolInFlight: [1, 0], poolSize: 2 })).toBe(2)
  })
  it('stays on main when ineligible, busy or not', () => {
    expect(routeSingleRun({ eligible: false, mainInFlight: 3, poolInFlight: [0, 0], poolSize: 2 })).toBe(0)
  })
  it('stays on main when the pool is disabled', () => {
    expect(routeSingleRun({ eligible: true, mainInFlight: 2, poolInFlight: [], poolSize: 0 })).toBe(0)
  })
})

// Task 6 Part A: the synchronous-reservation spill fix ("sometimes still
// serial"). queueSmart reads mainInFlight = inFlight({worker:0}).length to
// decide main-vs-spill, but registerRun only lands AFTER the POST resolves — so
// without a synchronous reservation a second rapid run sees main idle and also
// picks main (two runs serialize on one ComfyUI). The fix is reserve(worker) at
// pick time, BEFORE any await, so inFlight({worker:0}) counts the reservation.
// This exercises that decision against the REAL registry, modeling the exact
// two-back-to-back-queueSmart sequence (the reserve happening inside a POST that
// hasn't resolved is elided — the registry state it produces is identical).
describe('queueSmart reservation → spill sequence (Part A)', () => {
  beforeEach(() => clearAllRuns())

  const decide = () => {
    const mainInFlight = inFlight({ worker: 0 }).length
    // eligible + a warmed pool of 2 workers, both idle (poolInFlight [0,0]).
    return routeSingleRun({ eligible: true, mainInFlight, poolInFlight: [0, 0], poolSize: 2 })
  }

  it('first call sees main idle → picks main; the reservation makes the second spill', () => {
    // Call 1: main idle (no reservations, no runs) → route to main (0).
    expect(decide()).toBe(0)
    // Call 1 reserves worker 0 synchronously (before its POST resolves).
    const r1 = reserve(0)
    expect(inFlight({ worker: 0 })).toHaveLength(1)

    // Call 2 (back-to-back, before call 1's POST resolves / registerRun lands):
    // it now sees main busy via the reservation → spills to a pool worker
    // (worker 1 — ties resolve to the lowest index among idle pool workers).
    const spill = decide()
    expect(spill).not.toBe(0) // the whole point: it does NOT serialize on main
    expect(spill).toBe(1)
  })

  it('reservation upgrades to a real run (no double count) when registerRun consumes it', () => {
    const r1 = reserve(0)
    expect(inFlight({ worker: 0 })).toHaveLength(1) // reservation counted

    // The dispatch POST resolved: registerRun(entry, reservationId) turns the
    // reservation INTO the real run rather than adding a second slot.
    registerRun({ promptId: 'p1', tabId: 'tabA', live: false, worker: 0, canvasId: 'canvasX' }, r1)
    const main = inFlight({ worker: 0 })
    expect(main).toHaveLength(1) // still 1 — upgraded, not doubled
    expect(main[0]!.promptId).toBe('p1')
    expect(main[0]!.canvasId).toBe('canvasX') // Part B: canvasId threaded through
  })

  it('a dispatch failure releases the reservation (no leaked slot)', () => {
    const r1 = reserve(1)
    expect(inFlight({ worker: 1 })).toHaveLength(1)
    releaseReservation(r1) // queue()'s catch path on POST failure
    expect(inFlight({ worker: 1 })).toHaveLength(0)
  })
})
