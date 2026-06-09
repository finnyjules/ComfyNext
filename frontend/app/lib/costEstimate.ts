/**
 * costEstimate — pure USD estimation from node price badges.
 *
 * Replicate BYOK nodes (class names end in "RemoteNode", see
 * comfy_api_nodes/nodes_replicate.py) declare a price_badge whose expr is
 * either a static JSON literal (`{"type":"usd","usd":0.04,...}`) or a dynamic
 * JSONata expression. Static parses exactly; dynamic contributes its first
 * numeric "usd" value as a floor and marks the whole estimate approximate.
 * Used pre-run (Run button + confirm guard) and post-run (status bar tally).
 */

export interface BadgeCost { usd: number; approximate: boolean }

export function parseBadgeUsd(expr: string | null | undefined): BadgeCost | null {
  if (!expr) return null
  const s = String(expr).trim()
  try {
    const parsed = JSON.parse(s)
    if (typeof parsed?.usd === 'number') {
      return { usd: parsed.usd, approximate: !!parsed?.format?.approximate }
    }
  } catch { /* not a JSON literal — fall through to the JSONata floor */ }
  const match = s.match(/"usd"\s*:\s*([0-9]+\.?[0-9]*)/)
  if (match) return { usd: parseFloat(match[1]!), approximate: true }
  return null
}

export interface EstimateInputNode {
  id: string
  type: string
  title?: string
  badgeExpr?: string | null
}
export interface CostBreakdownItem { id: string; label: string; usd: number }
export interface CostEstimate { usd: number; approximate: boolean; breakdown: CostBreakdownItem[] }

/** Sum USD across the BYOK Replicate nodes in the list. Null when none are priced. */
export function estimateUsdForNodes(nodes: EstimateInputNode[]): CostEstimate | null {
  let usd = 0
  let approximate = false
  const breakdown: CostBreakdownItem[] = []
  for (const n of nodes) {
    if (!n.type?.endsWith('RemoteNode')) continue
    const cost = parseBadgeUsd(n.badgeExpr)
    if (!cost) continue
    usd += cost.usd
    approximate = approximate || cost.approximate
    breakdown.push({ id: n.id, label: n.title || n.type, usd: cost.usd })
  }
  return breakdown.length ? { usd, approximate, breakdown } : null
}

/** Adapt Vue Flow canvas nodes (ComfyNode data shape) to estimate input.
 *  Disabled nodes (mode 2) are excluded — they don't run. */
export function vueNodesToEstimateInput(nodes: any[]): EstimateInputNode[] {
  return (nodes || [])
    .filter((n: any) => ((n?.data?.mode ?? 0) !== 2))
    .map((n: any) => ({
      id: String(n.id),
      type: String(n?.data?.type || ''),
      title: n?.data?.title,
      badgeExpr: n?.data?.priceBadge?.expr ?? null,
    }))
}
