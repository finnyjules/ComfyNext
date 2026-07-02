/** Edges are one EDITOR of sheet.cast (via:'wire'); the picker is the other.
 *  Pure mapping so the canvas watcher stays a thin shell. */
import type { CastMember } from '~/lib/shotdirector/types'

export interface CastNodeLite { id: string, nodeType?: string, characterSlug?: string | null, characterName?: string | null }
export interface CastEdgeLite { source: string, target: string, targetHandle?: string | null }

export function wireCastFor(studioId: string, nodes: CastNodeLite[], edges: CastEdgeLite[]): CastMember[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  return edges
    .filter(e => e.target === studioId && (e.targetHandle ?? '').startsWith('input-'))
    .sort((a, b) => (a.targetHandle ?? '').localeCompare(b.targetHandle ?? ''))
    .map(e => byId.get(e.source))
    .filter((n): n is CastNodeLite => !!n && n.nodeType === 'Character' && !!n.characterSlug)
    .map(n => ({ slug: n.characterSlug!, name: n.characterName || n.characterSlug!, via: 'wire' as const }))
    .filter((m, i, arr) => arr.findIndex(x => x.slug === m.slug) === i) // dedupe by slug, keeping first occurrence (lowest input order)
}

export function syncCast(existing: CastMember[], wire: CastMember[]): CastMember[] | null {
  const picker = existing.filter(m => m.via === 'picker')
  const pickerSlugs = new Set(picker.map(m => m.slug))
  const next = [...picker, ...wire.filter(m => !pickerSlugs.has(m.slug))]
  const same = next.length === existing.length
    && next.every((m, i) => existing[i]!.slug === m.slug && existing[i]!.via === m.via)
  return same ? null : next
}
