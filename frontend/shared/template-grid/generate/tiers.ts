import type { TextLevel, TierId, Tiers, TierSpec } from '../types'

/** Most → least important. */
export const TIER_ORDER: TierId[] = ['hero', 'anchor', 'support', 'fineprint']

/** Default type-scale level per tier. hero is the biggest; fineprint the smallest.
 *  Only 3 distinct levels (display, headline, caption) — support shares
 *  fineprint's size. "Few sizes, big jumps": hero and anchor already carry
 *  explicit fontSize overrides from the drama system (heroScale × canvas,
 *  0.45 × hero), so their shared `level` here is cosmetic; support and
 *  fineprint have no such override, so their level IS the rendered size —
 *  keeping SWISS_LIMITS.maxTypeSizes (3) satisfied by construction. */
export const DEFAULT_TIER_LEVELS: Record<TierId, TextLevel> = {
  hero: 'display',
  anchor: 'headline',
  support: 'caption',
  fineprint: 'caption',
}

/** Normalize the stored `Tiers` shape (single `TierSpec` OR `TierSpec[]` per
 *  tier — round-1 templates stored a single spec) into an all-arrays shape.
 *  Absent tiers and empty arrays are dropped so callers can rely on
 *  presence == at least one item. */
export function normalizeTiers(t: Tiers | undefined): Partial<Record<TierId, TierSpec[]>> {
  const out: Partial<Record<TierId, TierSpec[]>> = {}
  if (!t) return out
  for (const id of TIER_ORDER) {
    const v = t[id]
    if (!v) continue
    const items = Array.isArray(v) ? v : [v]
    if (items.length === 0) continue
    out[id] = items
  }
  return out
}

/** Enabled, non-empty-content items across every tier, in importance order.
 *  A tier is omitted entirely when none of its items survive the filter
 *  (absent, explicitly disabled, or empty content). */
export function tierEntries(tiers: Tiers): Array<{ id: TierId; items: TierSpec[] }> {
  const out: Array<{ id: TierId; items: TierSpec[] }> = []
  const normalized = normalizeTiers(tiers)
  for (const id of TIER_ORDER) {
    const items = (normalized[id] ?? []).filter(spec => spec.enabled !== false && !!spec.content && !!spec.content.trim())
    if (items.length === 0) continue
    out.push({ id, items })
  }
  return out
}

/** Map wired text sockets (text_layer_1..4) onto tiers by importance order.
 *  Each socket seeds a single-item list (item 0 of tier N-1). */
export function autopopulateTiers(props: Record<string, string>): Partial<Record<TierId, TierSpec[]>> {
  const tiers: Partial<Record<TierId, TierSpec[]>> = {}
  TIER_ORDER.forEach((id, i) => {
    const v = props[`text_layer_${i + 1}`]
    if (v && v.trim()) tiers[id] = [{ content: v }]
  })
  return tiers
}

/** Non-mutating append: normalizes `tiers`, then pushes `item` onto the
 *  named tier's list (creating it if absent). Returns a new object — the
 *  input (and any array/object it holds) is left untouched. */
export function appendTierItem(tiers: Tiers, id: TierId, item: TierSpec): Partial<Record<TierId, TierSpec[]>> {
  const normalized = normalizeTiers(tiers)
  return { ...normalized, [id]: [...(normalized[id] ?? []), item] }
}

/** Remove props already rendered by a tier, mirroring autopopulateTiers's
 *  exact mapping (text_layer_N <-> TIER_ORDER[N-1]). Tier elements render
 *  LITERAL content with ids like `tier_hero` — not a `{{ props.text_layer_1
 *  }}` binding — so autopopulateV2's refsSocket() can't see them as
 *  referenced. Without this, autopopulateV2 appends a duplicate freeform
 *  element for a socket a tier already owns (dupe hero text on reopen).
 *  Consumed = tier key present with >= 1 item (post-normalization). */
export function omitConsumedProps(props: Record<string, string>, tiers: Tiers): Record<string, string> {
  const normalized = normalizeTiers(tiers)
  const consumed = new Set<string>()
  TIER_ORDER.forEach((id, i) => {
    if ((normalized[id]?.length ?? 0) > 0) consumed.add(`text_layer_${i + 1}`)
  })
  return Object.fromEntries(Object.entries(props).filter(([key]) => !consumed.has(key)))
}
