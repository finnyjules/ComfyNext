/**
 * Pure logic for LoraGalleryModal's tab strip.
 *
 * FluxMultiLoRARemoteNode has four LoRA slots (lora_a..lora_d). Slot A used to
 * hard-gate the gallery to characters only, and B/C/D to styles only — a user
 * who owned only styles could never fill slot A. The gallery now shows all
 * three libraries (Characters / Your Styles / House Library) from every slot,
 * with the picked slot only setting which tab starts active. This module
 * holds the three decisions that used to live inline in the component so they
 * can be unit-tested without a component-mount harness.
 */

export type LoraGalleryTab = 'characters' | 'yours' | 'house'

/**
 * Seed the initial tab from the slot's `kind` prop. Slot A (kind: 'character')
 * still opens on Characters by default — that's its framing, not a gate — and
 * every other slot opens on the user's own styles.
 */
export function initialLoraGalleryTab(kind: 'character' | 'style' | undefined): LoraGalleryTab {
  return kind === 'character' ? 'characters' : 'yours'
}

/**
 * Pick which item list backs `visibleItems` for the active tab. `characters`
 * and `styles` are both drawn from the same fetched-and-unfiltered local list
 * (the caller partitions it by `l.kind === 'character'`); `house` is the
 * separate published-style list.
 */
export function loraGallerySource<T>(
  characters: T[],
  styles: T[],
  houseItems: T[],
  tab: LoraGalleryTab,
): T[] {
  if (tab === 'characters') return characters
  if (tab === 'house') return houseItems
  return styles
}

/**
 * Trigger-routing predicate: does this PICKED ITEM behave like a character
 * (trigger goes into the prompt widget) or a style (trigger + aesthetic fold
 * into the node's aesthetic property)? This must branch on the item being
 * picked, not on the slot it was picked into — once every slot can browse
 * every library, a character picked into a style slot (or vice versa) still
 * needs to route correctly. House-style entries are always styles.
 */
export function isCharacterItem(item: { kind?: string; houseStyle?: unknown }): boolean {
  if (item.houseStyle) return false
  return item.kind === 'character'
}
