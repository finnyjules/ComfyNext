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
 *
 * HOSTED (opt-in, `{ hosted: true }`): the static badge is a fiction on the
 * five model-PICKER classes — GenerateVideoNode ships ONE badge figure for a
 * model range spanning $0.04 to $3.20 — so those nodes are re-priced from the
 * model widget through the same helper the node cost badge uses. The result
 * carries `hostedCredits`, the credits figure to DISPLAY: the run surfaces must
 * not re-convert it (creditsForUsd would ceil a second time and the dialog
 * would disagree with the badge it sits next to). Local mode never takes any
 * of this path — the flag is a parameter, never read from runtime config here,
 * so this module stays pure and unit-testable.
 */
import { modelPricedUsd, BASE_RENDER_CREDITS } from '~/lib/nodeCreditEstimate'
import { creditsForUsd } from '~/lib/pricing'

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
  /** Ordered widget definitions (Vue node `data.widgetDefs`). Carried so the
   *  hosted path can find the `model` widget; unused in local mode. */
  widgetDefs?: { name?: string }[] | null
  /** Widget values, positionally aligned with `widgetDefs`. */
  widgetsValues?: unknown[] | null
}
export interface CostBreakdownItem { id: string; label: string; usd: number; credits?: boolean }
export interface CostEstimate {
  usd: number
  approximate: boolean
  breakdown: CostBreakdownItem[]
  /** Hosted only: the total to DISPLAY, already through the markup policy.
   *  Null/absent in local mode. Never feed this back through creditsForUsd. */
  hostedCredits?: number | null
}

/** The value of a node's `model` widget, or undefined when it has none.
 *  Mirrors ComfyNode.vue's `widgetIndex('model')` lookup — widgetsValues is
 *  positional against widgetDefs, so the name must be resolved to an index. */
export function modelWidgetValue(n: EstimateInputNode): unknown {
  const idx = (n.widgetDefs || []).findIndex(d => d?.name === 'model')
  return idx >= 0 ? n.widgetsValues?.[idx] : undefined
}

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

/** Sum USD across Replicate BYOK and credit-billed API nodes in the list. Null when none are priced.
 *
 *  `opts.hosted` (default false → local mode unchanged) re-prices the five
 *  model-picker classes off their selected model and fills `hostedCredits`.
 *  Credits are summed PER NODE and only then totalled: the markup policy has a
 *  tier boundary at $0.10, so converting the summed dollars in one shot
 *  under-quotes any mix of cheap nodes ($0.10 + $0.10 → 30cr one-shot vs 40cr
 *  per node) and disagrees with the per-node badges.
 *
 *  base_render is added ONCE per run — priceGraph's semantics, since the run is
 *  one graph submit. (The per-node badge adds it per node; for a single-node
 *  run, the common case, both land on the same figure.) A run whose graph has
 *  no terminal output node would not be charged base_render at all, so this
 *  can over-quote by 1 credit — deliberate, an estimate should err high. */
export function estimateUsdForNodes(
  nodes: EstimateInputNode[],
  opts: { hosted?: boolean } = {},
): CostEstimate | null {
  const hosted = opts.hosted === true
  let usd = 0
  let approximate = false
  let credits = 0
  const breakdown: CostBreakdownItem[] = []
  for (const n of nodes) {
    const creditBilled = isApiCreditBilled(n)
    // Hosted: a model-priced picker is charged by the server whatever its
    // billing class, so price it even if the badge/category filter misses it.
    const modelUsd = hosted ? modelPricedUsd(n.type, modelWidgetValue(n)) : null
    if (modelUsd == null && !isReplicateBilled(n) && !creditBilled) continue
    // The selected model's real price beats the static badge when we have it.
    const cost = modelUsd != null ? { usd: modelUsd, approximate: true } : parseBadgeUsd(n.badgeExpr)
    if (!cost) continue
    usd += cost.usd
    if (hosted) credits += creditsForUsd(cost.usd)
    approximate = approximate || cost.approximate || creditBilled
    breakdown.push({
      id: n.id,
      label: (n.title || n.type) + (creditBilled ? ' (credits)' : ''),
      usd: cost.usd,
      ...(creditBilled ? { credits: true } : {}),
    })
  }
  if (!breakdown.length) return null
  return { usd, approximate, breakdown, ...(hosted ? { hostedCredits: credits + BASE_RENDER_CREDITS } : {}) }
}

/** Adapt Vue Flow canvas nodes (ComfyNode data shape) to estimate input.
 *  The LiteGraph class name lives in data.nodeType (data.type is the Vue Flow
 *  renderer type). Disabled nodes (mode 2) are excluded — they don't run.
 *  widgetDefs/widgetsValues ride along so the hosted estimate can read the
 *  selected model; local mode ignores them. */
export function vueNodesToEstimateInput(nodes: any[]): EstimateInputNode[] {
  return (nodes || [])
    .filter((n: any) => ((n?.data?.mode ?? 0) !== 2))
    .map((n: any) => ({
      id: String(n.id),
      type: String(n?.data?.nodeType || ''),
      title: n?.data?.title,
      badgeExpr: n?.data?.priceBadge?.expr ?? null,
      category: n?.data?.category ?? null,
      widgetDefs: n?.data?.widgetDefs ?? null,
      widgetsValues: n?.data?.widgetsValues ?? null,
    }))
}
