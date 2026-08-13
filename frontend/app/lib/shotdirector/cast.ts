/**
 * Cast materialization: turn `sheet.cast` (live registry links) into concrete
 * identity-lock image references, cast-first so [Image1] is always cast
 * member #1. Pure — the caller resolves slugs → ref URLs (useCharacters).
 * Cast-injected refs carry `castSlug`; re-materializing replaces them, so the
 * operation is idempotent and manual refs are preserved and renumbered.
 */
import type { ModelProfile } from '~/lib/shotdirector/profiles'
import type { Ref, ShotSheet } from '~/lib/shotdirector/types'
import type { ValidationIssue } from '~/lib/shotdirector/rules'

export const CAST_MAX = 3
// Identity references sent per cast member = their COVER photo only. Seedance-class
// reference-to-video maps each face image to a distinct person, so sending several
// photos of ONE character spawns duplicate people (the "three bodies from one
// character" bug). One cover per distinct member = one person per member.
export const CAST_REF_CAP = 1

export function materializeCast(
  sheet: ShotSheet,
  resolved: Record<string, string[]>,
  profile: ModelProfile,
): { sheet: ShotSheet, issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  const manual = sheet.references.filter(r => !r.castSlug)
  if (!sheet.cast.length) {
    return { sheet: { ...sheet, references: renumber(manual) }, issues }
  }

  const seen = new Set<string>()
  for (const m of sheet.cast) {
    if (seen.has(m.slug)) issues.push({ level: 'error', code: 'cast-duplicate', message: `${m.name} is cast twice.` })
    seen.add(m.slug)
  }
  if (sheet.cast.length > CAST_MAX) {
    issues.push({ level: 'error', code: 'cast-too-many', message: `At most ${CAST_MAX} characters per shot.` })
  }

  const members = sheet.cast.filter((m, i) => sheet.cast.findIndex(x => x.slug === m.slug) === i)
  const manualImages = manual.filter(r => r.kind === 'image').length
  // One cover per member (CAST_REF_CAP). Only warn when the manual refs + one
  // cover each genuinely can't fit the image budget — compile then errors on the
  // overflow. (No per-member "squeeze" anymore: each member always gets exactly
  // their cover, never a reduced share.)
  if (manualImages + members.length > profile.maxRefImages) {
    issues.push({
      level: 'warning', code: 'cast-refs-squeezed',
      message: `Manual references leave no room in the ${profile.maxRefImages}-image budget for all ${members.length} cast members — remove some manual references.`,
    })
  }

  const castRefs: Ref[] = []
  for (const m of members) {
    // resolved[slug] is cover-first (see useCharacters.resolveVariantRefs and the
    // generate-time resolver), so slice(0, CAST_REF_CAP) is the cover.
    const srcs = (resolved[m.slug] ?? []).slice(0, CAST_REF_CAP)
    if (!srcs.length) {
      const message = m.stateId
        ? `${m.name} has no reference photos in the selected variant — add some to their character sheet.`
        : `${m.name} has no reference photos — add some to their character sheet.`
      issues.push({ level: 'error', code: 'cast-member-no-refs', message })
      continue
    }
    for (const src of srcs) {
      castRefs.push({ kind: 'image', slot: 0, src, role: 'identity-lock', castSlug: m.slug })
    }
  }
  return { sheet: { ...sheet, references: renumber([...castRefs, ...manual]) }, issues }
}

/** Reassign 1-based slots per kind, preserving array order. */
function renumber(refs: Ref[]): Ref[] {
  const counters: Record<string, number> = {}
  return refs.map((r) => {
    counters[r.kind] = (counters[r.kind] ?? 0) + 1
    return { ...r, slot: counters[r.kind]! }
  })
}

/** "Characters: Reva @Image1 @Image2; Marcus @Image3." from cast-tagged refs. */
export function castClause(sheet: ShotSheet, profile: ModelProfile): string {
  const bySlug = new Map<string, string[]>()
  for (const r of sheet.references) {
    if (r.kind !== 'image' || !r.castSlug) continue
    const tags = bySlug.get(r.castSlug) ?? []
    tags.push(profile.refTag('image', r.slot))
    bySlug.set(r.castSlug, tags)
  }
  if (!bySlug.size) return ''
  // Deliberately follow sheet.cast order (identity source of truth), not reference slot order.
  const parts = sheet.cast
    .filter(m => bySlug.has(m.slug))
    .map(m => `${m.name} ${bySlug.get(m.slug)!.join(' ')}`)
  return `Characters: ${parts.join('; ')}.`
}
