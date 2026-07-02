/**
 * One-shot handoff into the LoRA trainer surface. A caller (e.g. the
 * Characters panel's "Train identity") `set()`s a seed just before opening
 * the 'train' tab; LoraTrainerSurface `consume()`s it on mount to prefill
 * the training kind, name, trigger, and dataset from a draft character's
 * reference photos. Module-level singleton (not component state) so it
 * survives the navigation from panel → fresh tab mount. `consume()` clears
 * it so a later manual visit to the trainer starts blank.
 *
 * `seedVersion` is a version signal that increments on each `set()` call,
 * allowing the trainer to detect a new seed even if the tab is already active
 * (avoiding the watch(activeTabId) same-value-assignment dead zone).
 */

import { ref, readonly } from 'vue'

export interface TrainerSeed {
  kind: 'character'
  name: string
  trigger?: string | null
  refViewUrls: string[]
}

let pending: TrainerSeed | null = null
const seedVersion = ref(0)

export function usePendingTrainerSeed() {
  function set(seed: TrainerSeed): void {
    pending = seed
    seedVersion.value++
  }

  function consume(): TrainerSeed | null {
    const seed = pending
    pending = null
    return seed
  }

  return { set, consume, seedVersion: readonly(seedVersion) }
}
