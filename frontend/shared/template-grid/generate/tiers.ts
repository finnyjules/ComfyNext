import type { TextLevel, TierId, Tiers, TierSpec } from '../types'

/** Most → least important. */
export const TIER_ORDER: TierId[] = ['hero', 'anchor', 'support', 'fineprint']

/** Default type-scale level per tier. hero is the biggest; fineprint the smallest. */
export const DEFAULT_TIER_LEVELS: Record<TierId, TextLevel> = {
  hero: 'display',
  anchor: 'headline',
  support: 'subhead',
  fineprint: 'caption',
}

/** Enabled tiers with content, in importance order. A tier is skipped when
 *  absent, explicitly disabled, or has empty content. */
export function tierEntries(tiers: Tiers): Array<{ id: TierId; spec: TierSpec }> {
  const out: Array<{ id: TierId; spec: TierSpec }> = []
  for (const id of TIER_ORDER) {
    const spec = tiers[id]
    if (!spec || spec.enabled === false) continue
    if (!spec.content || !spec.content.trim()) continue
    out.push({ id, spec })
  }
  return out
}

/** Map wired text sockets (text_layer_1..4) onto tiers by importance order. */
export function autopopulateTiers(props: Record<string, string>): Tiers {
  const tiers: Tiers = {}
  TIER_ORDER.forEach((id, i) => {
    const v = props[`text_layer_${i + 1}`]
    if (v && v.trim()) tiers[id] = { content: v }
  })
  return tiers
}

/** Remove props already rendered by a tier, mirroring autopopulateTiers's
 *  exact mapping (text_layer_N <-> TIER_ORDER[N-1]). Tier elements render
 *  LITERAL content with ids like `tier_hero` — not a `{{ props.text_layer_1
 *  }}` binding — so autopopulateV2's refsSocket() can't see them as
 *  referenced. Without this, autopopulateV2 appends a duplicate freeform
 *  element for a socket a tier already owns (dupe hero text on reopen). */
export function omitConsumedProps(props: Record<string, string>, tiers: Tiers): Record<string, string> {
  const consumed = new Set<string>()
  TIER_ORDER.forEach((id, i) => {
    if (tiers[id]) consumed.add(`text_layer_${i + 1}`)
  })
  return Object.fromEntries(Object.entries(props).filter(([key]) => !consumed.has(key)))
}
