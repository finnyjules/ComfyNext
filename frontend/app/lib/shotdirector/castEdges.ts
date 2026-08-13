/** Edges are one EDITOR of sheet.cast (via:'wire'); the picker is the other.
 *  Pure mapping so the canvas watcher stays a thin shell. */
import type { CastMember } from '~/lib/shotdirector/types'
import { normalizeStateId } from '#shared/characters/types'

export interface CastNodeLite {
  id: string
  nodeType?: string
  /** Single-property binding (properties.sailor_characterBinding); the canvas
   *  lite-mapper produces this from the binding with a read-time fallback to
   *  the three legacy sailor_character{Slug,Name,VariantId} props. */
  binding?: { slug: string; name: string; stateId: string | null } | null
}
export interface CastEdgeLite { source: string, target: string, targetHandle?: string | null }

export function wireCastFor(studioId: string, nodes: CastNodeLite[], edges: CastEdgeLite[]): CastMember[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  return edges
    .filter(e => e.target === studioId && (e.targetHandle ?? '').startsWith('input-'))
    .sort((a, b) => (a.targetHandle ?? '').localeCompare(b.targetHandle ?? ''))
    .map(e => byId.get(e.source))
    .filter((n): n is CastNodeLite => !!n && (n.nodeType === 'Character' || n.nodeType === 'CharacterSheet') && !!n.binding?.slug)
    .map(n => ({
      slug: n.binding!.slug,
      name: n.binding!.name || n.binding!.slug,
      via: 'wire' as const,
      stateId: normalizeStateId(n.binding!.stateId),
    }))
    .filter((m, i, arr) => arr.findIndex(x => x.slug === m.slug) === i) // dedupe by slug, keeping first occurrence (lowest input order)
}

export function syncCast(existing: CastMember[], wire: CastMember[]): CastMember[] | null {
  // Preserve EXISTING order (don't reshuffle [wireA, pickerB] to [pickerB, wireA]
  // on every edge change — cast order maps to [Image1]/[Image2]/… in the prompt,
  // so reordering silently reassigns references between takes). Keep every
  // existing member that still survives (picker members always; wire members
  // only if still present in the new wire list), then append genuinely new wire
  // members — ones not already represented — at the end. A wire member whose
  // stateId changed is updated in place (still a "kept" slot, new payload) —
  // not treated as a dupe/new entry.
  const wireBySlug = new Map(wire.map(m => [m.slug, m]))
  const kept = existing
    .filter(m => m.via === 'picker' || wireBySlug.has(m.slug))
    .map(m => (m.via === 'wire' ? wireBySlug.get(m.slug)! : m))
  const keptSlugs = new Set(kept.map(m => m.slug))
  const next = [...kept, ...wire.filter(m => !keptSlugs.has(m.slug))]
  const same = next.length === existing.length
    && next.every((m, i) =>
      existing[i]!.slug === m.slug && existing[i]!.via === m.via && existing[i]!.stateId === m.stateId)
  return same ? null : next
}
