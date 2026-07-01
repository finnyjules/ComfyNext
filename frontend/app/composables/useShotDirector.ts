/**
 * Reactive composable for the Shot Director studio.
 * Wraps hydrateShotSheet, compileShot, and reference management with Vue reactivity.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { hydrateShotSheet, addRef, removeRef } from '~/lib/shotdirector/hydrate'
import { compileShot, type CompileResult } from '~/lib/shotdirector/compile'
import { getProfile, type ModelProfile } from '~/lib/shotdirector/profiles'
import type { RefKind, ShotSheet } from '~/lib/shotdirector/types'

export interface UseShotDirectorReturn {
  sheet: Ref<ShotSheet>
  result: ComputedRef<CompileResult>
  profile: ModelProfile
  update: (mutator: (s: ShotSheet) => ShotSheet) => void
  addReference: (kind: RefKind, src: string, role: ShotSheet['references'][number]['role']) => void
  removeReference: (kind: RefKind, slot: number) => void
  rerollSeed: () => void
}

/**
 * Creates a reactive Shot Director sheet with compilation and persistence.
 * @param initial - Raw data to hydrate (e.g., node.data.properties.comfynext_shotDirector)
 * @param persist - Callback to persist the sheet after mutations
 */
export function useShotDirector(
  initial: unknown,
  persist: (sheet: ShotSheet) => void,
): UseShotDirectorReturn {
  const sheet = ref<ShotSheet>(hydrateShotSheet(initial))
  const profile = getProfile('seedance-2.0')

  const result = computed(() => compileShot(sheet.value, profile))

  const update = (mutator: (s: ShotSheet) => ShotSheet) => {
    sheet.value = mutator(sheet.value)
    persist(sheet.value)
  }

  const addReference = (kind: RefKind, src: string, role: ShotSheet['references'][number]['role']) => {
    update(s => addRef(s, kind, src, role))
  }

  const removeReference = (kind: RefKind, slot: number) => {
    update(s => removeRef(s, kind, slot))
  }

  /** New take: a fresh visible seed so the same sheet renders a new variant. */
  const rerollSeed = () => {
    update(s => ({ ...s, format: { ...s.format, seed: Math.floor(Math.random() * 2_147_483_646) + 1 } }))
  }

  return {
    sheet,
    result,
    profile,
    update,
    addReference,
    removeReference,
    rerollSeed,
  }
}
