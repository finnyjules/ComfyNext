/**
 * creditAttribution — pure credit-delta resolution for concurrent runs.
 *
 * Extracted from default.vue's `watch(credits, ...)` post-run cost watcher
 * (see runRegistry.ts perRun().startCredits / .costDeadline). Comfy's credit
 * balance is a SINGLE number shared by the whole account — when N credit-
 * billed runs are in flight at once, a single balance refresh can't tell us
 * which run(s) it reflects. We can't split the observed delta precisely, so
 * this applies a documented heuristic instead of silently mis-attributing
 * (or worse, letting the second run's `execution_start` clobber the first's
 * baseline, as the pre-Task-4 single-global version did).
 *
 * Heuristic: among runs with an "armed" credit watch (costDeadline > now;
 * 0 means the watch is disabled — Replicate/BYOK runs don't move Comfy's
 * balance) and a known startCredits, attribute the whole delta to the run
 * with the HIGHEST startCredits. Rationale: startCredits is a snapshot of
 * the balance at that run's execution_start, so the highest value belongs to
 * whichever armed run started MOST RECENTLY (every run before it already
 * spent some credits, pulling their startCredits lower). The most recent
 * run is also the one whose completion is most likely to be the reason the
 * balance just moved. This is approximate when two credit-billed runs are
 * truly concurrent (the observed delta may cover both), but the per-run
 * RunState (Task 1) means each run's `pendingGenRecord` is still a distinct
 * object — no cross-contamination of the record itself, only of the number
 * attached to it.
 */

export interface CreditWatchCandidate {
  promptId: string
  startCredits: number | null
  /** 0 = watch disabled (e.g. Replicate-billed run). */
  costDeadline: number
}

export type CreditResolution = { promptId: string; delta: number }

/**
 * Picks which in-flight run (if any) a freshly-observed credit balance
 * should be attributed to, and computes its delta. Returns null when no
 * candidate is armed, or the balance didn't drop (delta <= 0 — e.g. the
 * user bought credits mid-run, or this is an unrelated balance refresh).
 */
export function resolveCreditDelta(
  candidates: CreditWatchCandidate[],
  newBalance: number,
  now: number,
): CreditResolution | null {
  let best: CreditWatchCandidate | null = null
  for (const c of candidates) {
    if (c.costDeadline <= 0) continue // watch disabled (Replicate-billed)
    if (c.costDeadline <= now) continue // deadline passed
    if (c.startCredits == null) continue // never armed
    if (!best || c.startCredits > best.startCredits!) best = c
  }
  if (!best) return null
  const delta = best.startCredits! - newBalance
  if (delta <= 0) return null
  return { promptId: best.promptId, delta }
}
