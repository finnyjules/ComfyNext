/**
 * costEstimate — pure USD estimation from node price badges.
 *
 * Spans two billing modes:
 * - Replicate BYOK nodes (class names end in "RemoteNode", see
 *   comfy_api_nodes/nodes_replicate.py) declare a price_badge whose expr is
 *   either a static JSON literal (`{"type":"usd","usd":0.04,...}`) or a dynamic
 *   JSONata expression. Static parses exactly; dynamic contributes its first
 *   numeric "usd" value as a floor and marks the whole estimate approximate.
 * - Credit-billed API nodes (category starts with "api node", e.g. Kling,
 *   OpenAI) use the same badge structure as a USD-equivalent estimate for
 *   pre-run warning; post-run actual tally via credit-delta (Replicate-only).
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
  category?: string | null
}
export interface CostBreakdownItem { id: string; label: string; usd: number; credits?: boolean }
export interface CostEstimate { usd: number; approximate: boolean; breakdown: CostBreakdownItem[] }

/** A node bills the user in USD (Replicate BYOK) rather than Comfy credits.
 *  Most are class-named `*RemoteNode` (comfy_api_nodes/nodes_replicate.py), but
 *  the Sailor wrappers that call Replicate from comfy_extras (Person Swap,
 *  Pose Mannequin) aren't — they're caught by their `…/Replicate` category.
 *  Stock Comfy API nodes (OpenAI, Kling, …) are credit-billed and excluded. */
export function isReplicateBilled(n: EstimateInputNode): boolean {
  return !!n.type?.endsWith('RemoteNode') || /\/Replicate$/.test(n.category || '')
}

/** Stock Comfy API nodes (Kling, OpenAI, …) bill in Comfy credits. Their
 *  price_badge carries the same {"usd":N} literals, so the parsed floor doubles
 *  as a USD-equivalent estimate — approximate by nature. */
export function isApiCreditBilled(n: EstimateInputNode): boolean {
  return !isReplicateBilled(n) && (n.category || '').startsWith('api node')
}

/** Sum USD across Replicate BYOK and credit-billed API nodes in the list. Null when none are priced. */
export function estimateUsdForNodes(nodes: EstimateInputNode[]): CostEstimate | null {
  let usd = 0
  let approximate = false
  const breakdown: CostBreakdownItem[] = []
  for (const n of nodes) {
    const creditBilled = isApiCreditBilled(n)
    if (!isReplicateBilled(n) && !creditBilled) continue
    const cost = parseBadgeUsd(n.badgeExpr)
    if (!cost) continue
    usd += cost.usd
    approximate = approximate || cost.approximate || creditBilled
    breakdown.push({
      id: n.id,
      label: (n.title || n.type) + (creditBilled ? ' (credits)' : ''),
      usd: cost.usd,
      ...(creditBilled ? { credits: true } : {}),
    })
  }
  return breakdown.length ? { usd, approximate, breakdown } : null
}

/** Adapt Vue Flow canvas nodes (ComfyNode data shape) to estimate input.
 *  The LiteGraph class name lives in data.nodeType (data.type is the Vue Flow
 *  renderer type). Disabled nodes (mode 2) are excluded — they don't run. */
export function vueNodesToEstimateInput(nodes: any[]): EstimateInputNode[] {
  return (nodes || [])
    .filter((n: any) => ((n?.data?.mode ?? 0) !== 2))
    .map((n: any) => ({
      id: String(n.id),
      type: String(n?.data?.nodeType || ''),
      title: n?.data?.title,
      badgeExpr: n?.data?.priceBadge?.expr ?? null,
      category: n?.data?.category ?? null,
    }))
}
