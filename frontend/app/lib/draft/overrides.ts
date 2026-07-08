/**
 * Draft-mode override rules — the submit-time rewrite that turns a full-quality
 * run into a cheap/fast sketch (spec: docs/superpowers/specs/2026-07-07-
 * sketchbook-loop-design.md). Applied ONLY to the run-path copy of the workflow
 * (plainWorkflow in runVueWorkflow), never to live node state or save paths.
 *
 * HARD RULE: LoRA-bearing nodes must never have their model swapped — that
 * silently drops the trained LoRA. They draft via steps/megapixels instead.
 */

export interface DraftRule {
  /** widget-name → substitute value */
  set?: Record<string, string | number>
  /** JSON-string widget name → keys to merge into its parsed object */
  mergeJson?: Record<string, Record<string, string | number>>
  /** pre-run USD estimate for the whole node in draft */
  usd: number
}

export const DRAFT_RULES: Record<string, DraftRule> = {
  GenerateImageNode: {
    set: { model: 'flux-schnell' },
    // Flux megapixels is an enum: only "1" or "0.25" (see image_models.py /
    // nodes_replicate.py). "0.25" ≈ 512px — the fast/cheap draft tier.
    mergeJson: { model_options: { megapixels: '0.25' } },
    usd: 0.003,
  },
  FluxLoRARemoteNode: {
    set: { num_inference_steps: 8, megapixels: '0.25' },
    usd: 0.01,
  },
}

export interface DraftApplication {
  overriddenIds: string[]
  /** nodeId → original values of every widget the draft rule changed */
  restoreById: Record<string, Record<string, any>>
}

/** Rewrite widgets_values on the serialized workflow in place. `vnodes` supplies
 *  each node's widgetDefs (name → positional index). Returns what was changed. */
export function applyDraftOverrides(plainWorkflow: any, vnodes: any[]): DraftApplication {
  const res: DraftApplication = { overriddenIds: [], restoreById: {} }
  const vById = new Map((vnodes || []).map((n: any) => [String(n.id), n]))
  for (const wn of plainWorkflow?.nodes ?? []) {
    const rule = DRAFT_RULES[wn?.type as string]
    if (!rule) continue
    const vn = vById.get(String(wn.id))
    const defs = vn?.data?.widgetDefs as Array<{ name?: string }> | undefined
    if (!defs || !Array.isArray(wn.widgets_values)) continue
    const idx = (name: string) => defs.findIndex(d => d?.name === name)
    const restore: Record<string, any> = {}
    for (const [name, value] of Object.entries(rule.set ?? {})) {
      const i = idx(name)
      if (i < 0 || i >= wn.widgets_values.length) continue
      restore[name] = wn.widgets_values[i]
      wn.widgets_values[i] = value
    }
    for (const [name, patch] of Object.entries(rule.mergeJson ?? {})) {
      const i = idx(name)
      if (i < 0 || i >= wn.widgets_values.length) continue
      restore[name] = wn.widgets_values[i]
      let obj: Record<string, any> = {}
      try { obj = JSON.parse(String(wn.widgets_values[i] || '{}')) || {} } catch { obj = {} }
      wn.widgets_values[i] = JSON.stringify({ ...obj, ...patch })
    }
    if (Object.keys(restore).length) {
      res.overriddenIds.push(String(wn.id))
      res.restoreById[String(wn.id)] = restore
    }
  }
  return res
}

/** price_badge-shaped literal for the draft tier — feeds parseBadgeUsd. */
export function draftUsdExprFor(nodeType: string): string | null {
  const rule = DRAFT_RULES[nodeType]
  if (!rule) return null
  return JSON.stringify({ type: 'usd', usd: rule.usd, format: { approximate: true } })
}
