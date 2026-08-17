// Which cost figure (if any) CanvasStatusBar should render for a finished
// run. Extracted so the hosted-vs-local decision is one pure, testable
// function instead of two template v-if/v-else-if branches reading
// lastResult directly (see CanvasStatusBar.vue).
//
// Why hosted needs its own branch: layouts/default.vue populates `usd` from
// tallyReplicateUsd, which prices Replicate-billed nodes in raw dollars the
// same way for every deploy mode. But a HOSTED tenant is actually debited
// CREDITS through the ledger for those same nodes (costEstimate.ts's
// `hosted` option) — the dollar figure is real for local (the operator's own
// Replicate account) and fiction for hosted (their balance never moved in
// dollars). Rendering `usd` unconditionally showed a hosted user "~$3.20"
// for a run that actually debited 481 credits.

export interface CostDisplayResult {
  kind: 'usd' | 'credits'
  value: number
  /** Only meaningful for kind 'usd' — omitted (not merely false) for 'credits'. */
  approximate?: boolean
}

export interface CostDisplayInput {
  usd?: number | null
  usdApproximate?: boolean
  cost?: number | null
}

/**
 * Local: prefer the dollar figure (its true cost surface), falling back to
 * credits for Comfy-native credit-delta runs. Hosted: NEVER show the dollar
 * figure — go straight to credits. Either mode renders nothing when the
 * relevant figure is absent, zero, or negative (an unknown/free cost reads
 * as "no cost line", not as an advertised $0).
 */
export function resolveCostDisplay(result: CostDisplayInput | null | undefined, hosted: boolean): CostDisplayResult | null {
  if (!result) return null
  if (!hosted && typeof result.usd === 'number' && result.usd > 0) {
    return { kind: 'usd', value: result.usd, approximate: !!result.usdApproximate }
  }
  if (typeof result.cost === 'number' && result.cost > 0) {
    return { kind: 'credits', value: result.cost }
  }
  return null
}
