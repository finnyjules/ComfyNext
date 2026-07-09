import { describe, expect, it } from 'vitest'
import { resolveCreditDelta, type CreditWatchCandidate } from '~/lib/graph/creditAttribution'

describe('resolveCreditDelta', () => {
  it('returns null when there are no candidates', () => {
    expect(resolveCreditDelta([], 100, Date.now())).toBeNull()
  })

  it('ignores candidates with costDeadline 0 (Replicate — credit watch disabled)', () => {
    const candidates: CreditWatchCandidate[] = [
      { promptId: 'p1', startCredits: 100, costDeadline: 0 },
    ]
    expect(resolveCreditDelta(candidates, 90, Date.now())).toBeNull()
  })

  it('ignores candidates whose deadline has already passed', () => {
    const now = Date.now()
    const candidates: CreditWatchCandidate[] = [
      { promptId: 'p1', startCredits: 100, costDeadline: now - 1 },
    ]
    expect(resolveCreditDelta(candidates, 90, now)).toBeNull()
  })

  it('ignores candidates with a null startCredits (never armed)', () => {
    const now = Date.now()
    const candidates: CreditWatchCandidate[] = [
      { promptId: 'p1', startCredits: null, costDeadline: now + 8000 },
    ]
    expect(resolveCreditDelta(candidates, 90, now)).toBeNull()
  })

  it('computes delta = startCredits - newBalance for the single armed run', () => {
    const now = Date.now()
    const candidates: CreditWatchCandidate[] = [
      { promptId: 'p1', startCredits: 100, costDeadline: now + 8000 },
    ]
    expect(resolveCreditDelta(candidates, 88, now)).toEqual({ promptId: 'p1', delta: 12 })
  })

  it('returns null when the delta is not positive (balance did not drop)', () => {
    const now = Date.now()
    const candidates: CreditWatchCandidate[] = [
      { promptId: 'p1', startCredits: 100, costDeadline: now + 8000 },
    ]
    expect(resolveCreditDelta(candidates, 100, now)).toBeNull()
    expect(resolveCreditDelta(candidates, 105, now)).toBeNull()
  })

  it('when multiple runs are armed, attributes to the one with the highest startCredits (most recent)', () => {
    const now = Date.now()
    const candidates: CreditWatchCandidate[] = [
      { promptId: 'older', startCredits: 100, costDeadline: now + 8000 },
      { promptId: 'newer', startCredits: 130, costDeadline: now + 5000 },
    ]
    // Both armed; the true balance reflects both runs' spend, but the
    // heuristic attributes the whole observed delta to the most recent
    // (highest startCredits) run — see doc comment in creditAttribution.ts.
    expect(resolveCreditDelta(candidates, 88, now)).toEqual({ promptId: 'newer', delta: 42 })
  })

  it('a passed-deadline candidate is excluded even if its startCredits is highest', () => {
    const now = Date.now()
    const candidates: CreditWatchCandidate[] = [
      { promptId: 'expired-but-highest', startCredits: 500, costDeadline: now - 100 },
      { promptId: 'armed', startCredits: 100, costDeadline: now + 8000 },
    ]
    expect(resolveCreditDelta(candidates, 88, now)).toEqual({ promptId: 'armed', delta: 12 })
  })

  it('a Replicate candidate (costDeadline 0) is excluded even alongside an armed one', () => {
    const now = Date.now()
    const candidates: CreditWatchCandidate[] = [
      { promptId: 'replicate', startCredits: 900, costDeadline: 0 },
      { promptId: 'comfy', startCredits: 100, costDeadline: now + 8000 },
    ]
    expect(resolveCreditDelta(candidates, 88, now)).toEqual({ promptId: 'comfy', delta: 12 })
  })
})
