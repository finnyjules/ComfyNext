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

// FluxMultiLoRARemoteNode's slots (lora_a..lora_d) each carry a `lora_<letter>_url`
// override sibling and a `scale_<letter>` sibling. Derive both from the slot
// letter so every slot behaves alike — hardcoding just 'lora_a'/'lora_b' left
// lora_c/lora_d silently writing to the single-LoRA node's 'lora_url', which
// this node doesn't have. Anything that isn't a lora_<letter> slot (e.g. the
// single-LoRA node's 'lora_name') keeps today's 'lora_url' fallback and no
// scale sibling (the single-LoRA node's scale is 'lora_scale', not derived
// from this letter scheme — see loraSlotResetPlan below).
export function loraSlotSiblings(target: string): { url: string; scale: string | null } {
  const m = SLOT_RE.exec(target)
  return m ? { url: `lora_${m[1]}_url`, scale: `scale_${m[1]}` } : { url: 'lora_url', scale: null }
}

/**
 * Everything a "clear this slot" action needs to reset: the picker widget
 * itself, its URL-override sibling, its scale sibling, and its style-block
 * property key. Built on loraSlotSiblings + slotAestheticKey rather than a
 * third regex; the only extra rule is the single-LoRA node's scale sibling
 * ('lora_scale'), which loraSlotSiblings deliberately leaves null since it
 * isn't derived from the lora_<letter> naming scheme.
 */
export function loraSlotResetPlan(pickerWidgetName: string): {
  picker: string; url: string; scale: string; aestheticKey: string | null
} {
  const siblings = loraSlotSiblings(pickerWidgetName)
  return {
    picker: pickerWidgetName,
    url: siblings.url,
    scale: siblings.scale ?? 'lora_scale',
    aestheticKey: slotAestheticKey(pickerWidgetName),
  }
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
