/**
 * Status bar dollars (pre-deploy fix, Task 6 review minor).
 *
 * CanvasStatusBar.vue rendered a hard-coded `~$N.NN` for ANY successful run
 * carrying `lastResult.usd`, with no hosted gate. `layouts/default.vue`
 * populates `usd` from `tallyReplicateUsd`, which prices Replicate-billed
 * nodes in raw dollars regardless of deploy mode — but a hosted tenant is
 * actually debited CREDITS through the ledger for those same nodes (see
 * costEstimate.ts's `hosted` option), so the dollar figure a hosted user saw
 * was fiction: a run that debited 481 credits showed "~$3.20".
 *
 * `resolveCostDisplay` is the extracted pure decision the component renders
 * off: local prefers the dollar figure (its true cost surface), hosted must
 * never show it and falls through to the credits figure instead (which,
 * pre-existing behavior, is only populated for Comfy-native credit-delta
 * runs today — see layouts/default.vue's watch(credits)). Nothing renders
 * when neither is present.
 */
import { describe, expect, it } from 'vitest'
import { resolveCostDisplay } from '~/lib/canvas/runCostDisplay'

describe('resolveCostDisplay', () => {
  it('local mode shows the dollar figure when present', () => {
    expect(resolveCostDisplay({ usd: 3.2, usdApproximate: true }, false))
      .toEqual({ kind: 'usd', value: 3.2, approximate: true })
  })

  it('local mode marks approximate false when usdApproximate is absent', () => {
    expect(resolveCostDisplay({ usd: 1.5 }, false))
      .toEqual({ kind: 'usd', value: 1.5, approximate: false })
  })

  // The bug this closes: a hosted run debited credits, but usd (computed the
  // same way local's is) was still populated and rendered as a dollar figure.
  it('hosted mode NEVER shows the dollar figure, even when usd is populated', () => {
    expect(resolveCostDisplay({ usd: 3.2, usdApproximate: true, cost: null }, true)).toBeNull()
  })

  it('hosted mode falls through to credits when a credit delta is present', () => {
    expect(resolveCostDisplay({ usd: 3.2, cost: 481 }, true))
      .toEqual({ kind: 'credits', value: 481 })
  })

  it('local mode falls through to credits when there is no usd (Comfy-native run)', () => {
    expect(resolveCostDisplay({ usd: null, cost: 12 }, false))
      .toEqual({ kind: 'credits', value: 12 })
  })

  it('zero and negative figures are treated as unknown, not "free" — nothing renders', () => {
    expect(resolveCostDisplay({ usd: 0 }, false)).toBeNull()
    expect(resolveCostDisplay({ usd: -1 }, false)).toBeNull()
    expect(resolveCostDisplay({ cost: 0 }, true)).toBeNull()
  })

  it('null/undefined result renders nothing', () => {
    expect(resolveCostDisplay(null, false)).toBeNull()
    expect(resolveCostDisplay(undefined, true)).toBeNull()
  })

  it('neither figure present renders nothing, in either mode', () => {
    expect(resolveCostDisplay({}, false)).toBeNull()
    expect(resolveCostDisplay({}, true)).toBeNull()
  })
})
