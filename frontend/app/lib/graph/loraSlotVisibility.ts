/**
 * Progressive disclosure for FluxMultiLoRARemoteNode's four LoRA slots.
 *
 * The node has slots A–D, but showing four empty pickers at rest would make a
 * two-LoRA job look like a four-LoRA chore. A slot unlocks when the one before
 * it is filled. A and B are always visible, so a fresh node is indistinguishable
 * from the two-slot node this replaced. This rule exists because slot A only
 * browses the Characters gallery, so a style-only user must be able to chain
 * B → C → D without ever filling A.
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

/**
 * A slot counts as filled by a real picker selection OR a url override OR a
 * moodboard reference. A moodboard pick is weightless (moodboards plan
 * 2026-08-06, Task A7): the picker stays '[None]' and the url stays blank —
 * its only trace is `properties.sailor_moodboard_<slot>`, so without the
 * `properties` argument a moodboard in B would never reveal C.
 */
export function slotFilled(
  slot: string,
  values: any[],
  defs: any[],
  properties?: Record<string, any> | null,
): boolean {
  const pick = valueOf(`lora_${slot}`, values, defs)
  const url = valueOf(`lora_${slot}_url`, values, defs)
  const hasPick = typeof pick === 'string' && pick.trim() !== '' && pick.trim() !== '[None]'
  const hasUrl = typeof url === 'string' && url.trim() !== ''
  const board = properties?.[`sailor_moodboard_${slot}`]
  const hasBoard = typeof board === 'string' && board.trim() !== ''
  return hasPick || hasUrl || hasBoard
}

export function isLoraSlotWidgetVisible(
  widgetName: string,
  values: any[],
  defs: any[],
  properties?: Record<string, any> | null,
): boolean {
  const slot = slotOf(widgetName)
  if (!slot) return true                       // not a slot widget → never our business

  const idx = SLOTS.indexOf(slot as typeof SLOTS[number])
  if (idx < ALWAYS_SHOWN) return true

  // Already carries a value — show it, or a saved workflow strands a value
  // that still gets submitted.
  if (slotFilled(slot, values, defs, properties)) return true

  const prevSlot = SLOTS[idx - 1]
  return prevSlot ? slotFilled(prevSlot, values, defs, properties) : false
}
