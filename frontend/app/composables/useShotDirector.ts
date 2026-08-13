/**
 * Reactive composable for the Shot Director studio.
 * Wraps hydrateShotSheet, compileShot, and reference management with Vue reactivity.
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { hydrateShotSheet, addRef, removeRef } from '~/lib/shotdirector/hydrate'
import { compileShot, type CompileResult } from '~/lib/shotdirector/compile'
import { getProfile, type ModelProfile } from '~/lib/shotdirector/profiles'
import type { RefKind, ShotSheet } from '~/lib/shotdirector/types'
import { materializeCast } from '~/lib/shotdirector/cast'
import type { ValidationIssue } from '~/lib/shotdirector/rules'

export interface UseShotDirectorReturn {
  sheet: Ref<ShotSheet>
  result: ComputedRef<CompileResult>
  profile: ModelProfile
  update: (mutator: (s: ShotSheet) => ShotSheet) => void
  addReference: (kind: RefKind, src: string, role: ShotSheet['references'][number]['role']) => void
  removeReference: (kind: RefKind, slot: number) => void
  rerollSeed: () => void
  addCastMember: (slug: string, name: string, via?: 'wire' | 'picker', stateId?: string | null) => void
  removeCastMember: (slug: string) => void
}

/**
 * Creates a reactive Shot Director sheet with compilation and persistence.
 * @param initial - Raw data to hydrate (e.g., node.data.properties.sailor_shotDirector)
 * @param persist - Callback to persist the sheet after mutations
 * @param resolveCast - Optional callback to resolve cast member { slug, stateId } picks to reference URLs, keyed by slug
 * @param castWarnings - Optional callback producing extra warning issues for the cast (e.g. a deleted variant that silently fell back to Default)
 */
export function useShotDirector(
  initial: unknown,
  persist: (sheet: ShotSheet) => void,
  resolveCast?: (picks: { slug: string; stateId: string | null }[]) => Record<string, string[]>,
  castWarnings?: (picks: { slug: string; name: string; stateId: string | null }[]) => ValidationIssue[],
): UseShotDirectorReturn {
  const sheet = ref<ShotSheet>(hydrateShotSheet(initial))
  const profile = getProfile('seedance-2.0')

  const result = computed(() => {
    const s = sheet.value
    if (!s.cast.length || !resolveCast) {
      return compileShot(s, profile)
    }
    const picks = s.cast.map(m => ({ slug: m.slug, name: m.name, stateId: m.stateId }))
    const resolved = resolveCast(picks)
    const warnings = castWarnings?.(picks) ?? []
    const { sheet: materialized, issues: castIssues } = materializeCast(s, resolved, profile)
    const compiled = compileShot(materialized, profile)
    return { ...compiled, issues: [...warnings, ...castIssues, ...compiled.issues] }
  })

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

  const addCastMember = (slug: string, name: string, via: 'wire' | 'picker' = 'picker', stateId: string | null = null) => {
    if (sheet.value.cast.some(m => m.slug === slug)) return
    update(s => ({ ...s, cast: [...s.cast, { slug, name, via, stateId }] }))
  }

  const removeCastMember = (slug: string) => {
    update(s => ({ ...s, cast: s.cast.filter(m => m.slug !== slug) }))
  }

  return {
    sheet,
    result,
    profile,
    update,
    addReference,
    removeReference,
    rerollSeed,
    addCastMember,
    removeCastMember,
  }
}
