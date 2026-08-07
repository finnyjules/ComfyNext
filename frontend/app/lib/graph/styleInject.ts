/**
 * Submit-time style injection (extracted from layouts/default.vue so it can be
 * unit-tested — moodboards Plan B, Task B2).
 *
 * FluxLoRARemoteNode / FluxMultiLoRARemoteNode keep their style/aesthetic in
 * node PROPERTIES (`properties.aesthetic`, per-slot `aesthetic_a..d`) rather
 * than a ComfyUI input — that keeps the node schema stable. At submit time the
 * composed block is folded into the prompt widget (index 0 — both nodes
 * declare `prompt` first, a load-bearing invariant of THOSE two schemas only).
 *
 * GenerateImageNode is different: its `prompt` is NOT at index 0 (the model
 * picker is), and it has a dedicated hidden `style_block` input appended LAST
 * in its schema. So the block is written into that widget BY NAME, resolving
 * the positional index from the /object_info widget order via widgetSlots —
 * NEVER a hardcoded position. The Python node prepends style_block to the
 * prompt server-side, mirroring the FLUX nodes' client-side fold.
 *
 * Mutates the workflow in place (callers pass a deep copy of the outgoing
 * workflow — the live node's widgets stay clean).
 */
import { composeLoraStyle } from '~/lib/graph/loraStyleBlocks'
import { widgetSlots } from '~/lib/graph/widgetOrder'

const PROMPT_INDEX0_NODES = new Set(['FluxLoRARemoteNode', 'FluxMultiLoRARemoteNode'])

export function injectLoraStyleIntoPrompt(
  workflow: any,
  objectInfo: Record<string, any>,
): void {
  for (const node of workflow?.nodes || []) {
    const type = node?.type
    if (PROMPT_INDEX0_NODES.has(type)) {
      // Both keep `prompt` at widget index 0, so the same fold applies.
      // composeLoraStyle concatenates the node-level `aesthetic` (with its
      // `tasteProfile` legacy fallback) and, on FluxMultiLoRARemoteNode, every
      // filled slot's `aesthetic_a`..`aesthetic_d` block — see loraStyleBlocks.ts.
      const style = composeLoraStyle(node.properties)
      if (!style) continue
      const wv = node.widgets_values
      if (!Array.isArray(wv)) continue
      const prompt = String(wv[0] ?? '')
      wv[0] = prompt ? `${style} ${prompt}` : style
      continue
    }

    if (type !== 'GenerateImageNode') continue
    // Applying IS wiring (2026-08-07 amendment): when the node's `style_in`
    // input is CONNECTED, the TASTE wire is the single carrier of the prose
    // block — the Moodboard twin's execute output flows in server-side, so
    // writing style_block here too would double-prepend the same block.
    // `style_refs` still rides the property channel below (file paths never
    // travel on the wire).
    const styleInLinked = Array.isArray(node.inputs)
      && node.inputs.some((i: any) => i?.name === 'style_in' && i.link != null)
    const style = styleInLinked ? '' : composeLoraStyle(node.properties)
    // Task B3: the moodboard refs payload rides in properties.style_refs
    // ('' when the model can't take refs) — injected into its own hidden
    // widget by NAME, exactly like style_block.
    const refs = typeof node.properties?.style_refs === 'string'
      ? node.properties.style_refs
      : ''
    if (!style && !refs) continue
    const wv = node.widgets_values
    if (!Array.isArray(wv)) continue

    // Resolve the positional slots from the schema — by NAME.
    let slots: { name: string; control?: true }[]
    try {
      slots = widgetSlots('GenerateImageNode', objectInfo)
    } catch {
      // Node type absent from /object_info (schema cache not loaded) — nowhere
      // safe to write. Skip rather than guess a position.
      console.warn('[styleInject] GenerateImageNode missing from objectInfo — style block not injected')
      continue
    }
    // A workflow saved pre-B2 may carry a short array; pad up to the slot.
    // (realignWidgetValues normally handles this, but stay safe standalone —
    // style_block/style_refs both default to ''.)
    const writeSlot = (name: string, value: string): void => {
      const idx = slots.findIndex((s) => s.name === name)
      if (idx < 0) {
        // Backend still serving a pre-B2/B3 schema (needs a restart) — the
        // input doesn't exist server-side, so writing anywhere would corrupt
        // values.
        console.warn(`[styleInject] ${name} not in GenerateImageNode schema (stale backend?) — not injected`)
        return
      }
      while (wv.length <= idx) wv.push('')
      wv[idx] = value
    }
    if (style) writeSlot('style_block', style)
    if (refs) writeSlot('style_refs', refs)
  }
}
