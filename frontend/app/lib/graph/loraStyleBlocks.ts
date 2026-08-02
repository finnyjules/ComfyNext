/**
 * FluxMultiLoRARemoteNode stacks up to four LoRAs (slots A-D). A LoRA's
 * *weights* come from its slot widgets and load independently of this module
 * — both/all adapters really do run. What this module fixes is the *text*
 * that steers them: before it existed, every slot's style gallery pick wrote
 * the same `properties.aesthetic` key, so picking a style into a second slot
 * silently overwrote the first. That LoRA's trigger word/prose never reached
 * the prompt, so it ran under-steered (worse the more the LoRA leans on a
 * distinctive rare token).
 *
 * The fix: each slot gets its own property (`aesthetic_a`..`aesthetic_d`),
 * plus the pre-existing node-level `aesthetic` (edited by NodeInspector,
 * doubling as the legacy key). composeLoraStyle concatenates all of them at
 * submit time.
 *
 * FluxLoRARemoteNode (the single-LoRA node) has one slot, `lora_name`, no
 * letter — it keeps using plain `properties.aesthetic` exactly as before, so
 * slotAestheticKey returns null for it and any other non-slot widget name.
 */

const SLOT_RE = /^lora_([a-d])$/

/** 'lora_a' → 'aesthetic_a', ... 'lora_d' → 'aesthetic_d'; anything else (incl. 'lora_name') → null. */
export function slotAestheticKey(targetWidget: string): string | null {
  const m = SLOT_RE.exec(targetWidget)
  return m ? `aesthetic_${m[1]}` : null
}

const SLOT_KEYS_IN_ORDER = ['aesthetic_a', 'aesthetic_b', 'aesthetic_c', 'aesthetic_d'] as const

/**
 * Full style text to prepend to the prompt at submit time. Order: the
 * node-level `aesthetic` (falling back to the legacy `tasteProfile` key)
 * first, then each slot's block in a-b-c-d order. Blank/missing entries are
 * skipped; survivors are trimmed and joined with a single space.
 */
export function composeLoraStyle(properties: Record<string, any> | null | undefined): string {
  if (!properties) return ''
  const nodeLevel = String(properties.aesthetic || properties.tasteProfile || '').trim()
  const blocks = nodeLevel ? [nodeLevel] : []
  for (const key of SLOT_KEYS_IN_ORDER) {
    const v = String(properties[key] || '').trim()
    if (v) blocks.push(v)
  }
  return blocks.join(' ')
}
