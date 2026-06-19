/**
 * Pure grounding of LLM-suggested font names against the real Google catalog.
 * The model names plausible families that may not exist or may be spelled
 * differently; we map each to a real catalog entry (canonical spelling + the
 * catalog's category) and drop anything we can't match. No network, no Vue —
 * unit-tested in tests/unit/font-match.unit.spec.ts.
 */
export interface RawSuggestion { family: string; reason: string }
export interface CatalogEntry { family: string; category: string }
export interface GroundedSuggestion { family: string; reason: string; category: string }

export function normalizeFamily(s: string): string {
  return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

export function groundSuggestions(
  raw: RawSuggestion[],
  catalog: CatalogEntry[],
): GroundedSuggestion[] {
  // Exact-normalized lookup for the common case.
  const byNorm = new Map<string, CatalogEntry>()
  for (const c of catalog) byNorm.set(normalizeFamily(c.family), c)

  const out: GroundedSuggestion[] = []
  const seen = new Set<string>()

  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || typeof r.family !== 'string') continue
    const norm = normalizeFamily(r.family)
    if (!norm) continue

    let match = byNorm.get(norm)

    // Prefix match either direction (e.g. "DM Serif" -> "DM Serif Display").
    if (!match) {
      const cands = catalog.filter(c => {
        const cn = normalizeFamily(c.family)
        return cn.startsWith(norm) || norm.startsWith(cn)
      })
      match = shortest(cands)
    }

    // Token-subset fallback: every word of the suggestion appears in the family.
    // Require ≥2 tokens — a single vague word ("Sans", "Neue") would otherwise
    // ground to an unrelated family instead of being correctly dropped.
    if (!match) {
      const tokens = norm.split(' ')
      if (tokens.length >= 2) {
        const cands = catalog.filter(c => {
          const cn = normalizeFamily(c.family)
          return tokens.every(t => cn.includes(t))
        })
        match = shortest(cands)
      }
    }

    if (!match) {
      console.warn('[font-suggest] dropped ungrounded family:', r.family)
      continue
    }
    if (seen.has(match.family)) continue
    seen.add(match.family)
    out.push({ family: match.family, reason: String(r.reason ?? ''), category: match.category })
  }

  return out
}

function shortest(cands: CatalogEntry[]): CatalogEntry | undefined {
  if (!cands.length) return undefined
  return cands.reduce((a, b) => (b.family.length < a.family.length ? b : a))
}
