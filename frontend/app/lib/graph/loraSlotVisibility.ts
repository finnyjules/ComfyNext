/**
 * Progressive disclosure for FluxMultiLoRARemoteNode's four LoRA slots.
 *
 * The node has slots A–D, but showing four empty pickers at rest would make a
 * two-LoRA job look like a four-LoRA chore. Slot N appears only once every
 * earlier slot is filled. A and B are always visible, so a fresh node is
 * indistinguishable from the two-slot node this replaced.
 */
const SLOTS = ['a', 'b', 'c', 'd'] as const

/** Slots always shown, however empty — the original A/B pair. */
const ALWAYS_SHOWN = 2

/** `lora_c` / `lora_c_url` / `scale_c` all map to slot 'c'. */
function slotOf(widgetName: string): string | null {
  const m = /^(?:lora_([a-d])(?:_url)?|scale_([a-d]))$/.exec(widgetName)
  return m ? (m[1] ?? m[2] ?? null) : null
}

function valueOf(name: string, values: any[], defs: any[]): unknown {
  const i = defs.findIndex(d => d?.name === name)
  return i >= 0 ? values[i] : undefined
}

/** A slot counts as filled by a real picker selection OR a url override. */
function slotFilled(slot: string, values: any[], defs: any[]): boolean {
  const pick = valueOf(`lora_${slot}`, values, defs)
  const url = valueOf(`lora_${slot}_url`, values, defs)
  const hasPick = typeof pick === 'string' && pick.trim() !== '' && pick.trim() !== '[None]'
  const hasUrl = typeof url === 'string' && url.trim() !== ''
  return hasPick || hasUrl
}

export function isLoraSlotWidgetVisible(widgetName: string, values: any[], defs: any[]): boolean {
  const slot = slotOf(widgetName)
  if (!slot) return true                       // not a slot widget → never our business

  const idx = SLOTS.indexOf(slot as typeof SLOTS[number])
  if (idx < ALWAYS_SHOWN) return true

  // Already carries a value — show it, or a saved workflow strands a value
  // that still gets submitted.
  if (slotFilled(slot, values, defs)) return true

  return SLOTS.slice(0, idx).every(s => slotFilled(s, values, defs))
}
