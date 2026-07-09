/**
 * runCost — pure per-run Replicate USD tally.
 *
 * Extracted from default.vue's `estimateReplicateUsd` so the node set is
 * passed in (a single run's `perRun(promptId).executedNodeIds`) instead of
 * read from a shared global. A global accumulator unions every concurrent
 * run's executed nodes, so tallying it at ANY run's completion sums every
 * OTHER in-flight run's Replicate nodes too (N² overcount). Passing the
 * per-run set in keeps each run's tally scoped to its own nodes.
 *
 * Filtered to Replicate-billed nodes only (unlike the pre-run estimate in
 * costEstimate.ts, which also counts credit-billed API nodes) so credit-delta
 * accounting still wins for those.
 */
import { estimateUsdForNodes, vueNodesToEstimateInput, isReplicateBilled } from '~/lib/costEstimate'

export function tallyReplicateUsd(
  executedNodeIds: Set<string>,
  allNodes: any[],
): { usd: number; approximate: boolean } | null {
  const ran = (allNodes || []).filter((n: any) => executedNodeIds.has(String(n.id)))
  const est = estimateUsdForNodes(vueNodesToEstimateInput(ran).filter(isReplicateBilled))
  return est ? { usd: est.usd, approximate: est.approximate } : null
}
