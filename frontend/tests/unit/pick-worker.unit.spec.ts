import { describe, it, expect } from 'vitest'
import { pickWorker } from '~/lib/graph/pickWorker'

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
