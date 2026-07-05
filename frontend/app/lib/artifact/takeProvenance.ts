/**
 * Take provenance (Direction Loop, Slice 1). Captures HOW a generated result was
 * made — the small set of generator params worth remembering so a later "breed
 * from this take" can perturb around it. Populated onto `Take.params` at the
 * appendTake sites (a take is otherwise just pixels with no memory of its recipe).
 *
 * Pure + node-shape only, so it's unit-testable without the canvas.
 */

type NodeLike = { data?: { nodeType?: string; widgetDefs?: Array<{ name?: string }>; widgetsValues?: any[] } }

/** Widget names that carry the text prompt, in priority order (first present wins). */
const PROMPT_KEYS = ['prompt', 'text', 'instruction', 'positive_prompt', 'positive']
/** Named generator params worth capturing verbatim when present + non-empty. */
const MODEL_KEYS = ['model', 'ckpt_name', 'lora_name']
const SHAPE_KEYS = ['aspect_ratio', 'aspect', 'resolution', 'size']

/**
 * Extract a compact provenance record from a generator node: prompt, seed, model/
 * LoRA, any *strength* widget, and an aspect/size — whatever's present. Returns a
 * flat object suitable to spread onto `Take.params`. Empty object if nothing found.
 */
export function nodeGenParams(node: NodeLike | null | undefined): Record<string, any> {
  const defs = node?.data?.widgetDefs ?? []
  const vals = node?.data?.widgetsValues ?? []
  const get = (name: string): any => {
    const i = defs.findIndex(d => d?.name === name)
    return i >= 0 ? vals[i] : undefined
  }
  const params: Record<string, any> = {}
  if (node?.data?.nodeType) params.nodeType = node.data.nodeType

  for (const k of PROMPT_KEYS) {
    const v = get(k)
    if (typeof v === 'string' && v.trim()) { params.prompt = v; break }
  }
  // First seed-ish widget (name contains "seed").
  const seedDef = defs.find(d => /seed/i.test(d?.name ?? ''))
  if (seedDef?.name) {
    const v = get(seedDef.name)
    if (v !== undefined && v !== null && v !== '') params.seed = v
  }
  for (const k of MODEL_KEYS) {
    const v = get(k)
    if (v !== undefined && v !== null && v !== '') params[k] = v
  }
  // Any *strength* control (lora_strength, style_strength, denoise-ish), numeric only.
  for (const d of defs) {
    if (d?.name && /strength/i.test(d.name)) {
      const v = get(d.name)
      if (typeof v === 'number') params[d.name] = v
    }
  }
  for (const k of SHAPE_KEYS) {
    const v = get(k)
    if (v !== undefined && v !== null && v !== '') { params[k] = v; break }
  }
  return params
}
