// Shared ranked node matcher for the canvas search surfaces (NodeSearchDialog,
// PortIntentPopover) and the AI catalog. Pure — no Vue/Nuxt imports, so it's
// unit-testable. Dependency-free: tokenized scoring with exact/prefix/
// subsequence tiers, not fuzzy typo-tolerance. The failure mode we fix is
// recall (whole-query substring matching missed multi-word intents), not typos.

// Common English filler that carries no node-search signal. Kept small on
// purpose — over-aggressive stopword lists hurt more than they help.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'with',
  'his', 'her', 'its', 'their', 'my', 'your', 'it', 'this', 'that', 'is',
])

/** Lowercase, split on non-alphanumerics, drop stopwords and empties. */
export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0 && !STOPWORDS.has(t))
}

// Does `needle` appear in `haystack` as an in-order subsequence? Cheap
// fuzziness — tolerates dropped/extra letters without a full edit-distance.
function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return false
  let i = 0
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++
  }
  return i === needle.length
}

// Score one token against one text field. Word-boundary exact > prefix >
// plain substring > subsequence. Returns 0 if absent.
function tokenInText(token: string, text: string): number {
  if (!text) return 0
  const t = text.toLowerCase()
  if (!t.includes(token)) {
    return isSubsequence(token, t) ? 1 : 0
  }
  // Word-level checks for the strongest tiers.
  const words = t.split(/[^a-z0-9]+/)
  if (words.includes(token)) return 8 // exact whole-word hit
  if (words.some(w => w.startsWith(token))) return 5 // prefix of a word
  return 3 // substring somewhere
}

// Per-field weight multipliers. A name match matters more than a description
// match; keywords sit between (curated intent vocabulary).
const W_NAME = 3
const W_KEYWORD = 2.5
const W_DESC = 1
const W_CATEGORY = 0.5

interface MatchableNode {
  name: string
  displayName: string
  description: string
  category: string
}

/** Weighted token score for one node. Every query token contributes its best
 *  field hit; a token matching nothing across all fields contributes 0. The
 *  node scores 0 unless at least one token matched something. */
export function scoreNode(node: MatchableNode, tokens: string[], keywords: string[]): number {
  if (!tokens.length) return 0
  const keywordBlob = keywords.join(' ')
  let total = 0
  let matchedTokens = 0
  for (const token of tokens) {
    const best = Math.max(
      W_NAME * tokenInText(token, node.displayName),
      W_NAME * tokenInText(token, node.name),
      W_KEYWORD * tokenInText(token, keywordBlob),
      W_DESC * tokenInText(token, node.description),
      W_CATEGORY * tokenInText(token, node.category),
    )
    if (best > 0) matchedTokens++
    total += best
  }
  if (matchedTokens === 0) return 0
  // Reward nodes that match more of the query's tokens.
  return total * (1 + 0.25 * (matchedTokens - 1))
}

export interface SearchOpts {
  /** Map of node class name → intent keywords/aliases. */
  keywords?: Record<string, string[]>
  /** Map of node class name → score bonus, added only when the node already
   *  matches (score > 0). Breaks ties among equally-named nodes to prefer a
   *  canonical one (e.g. the cheap API background remover over the local one).
   *  Keep values small (~1-3) so a boost can't leapfrog a genuinely stronger
   *  match. */
  boosts?: Record<string, number>
  /** Max results returned. */
  limit?: number
}

/** Rank `nodes` against a free-text query. Empty query returns the input
 *  unchanged (callers rely on this to show the full, pre-filtered list). */
export function searchNodes<T extends MatchableNode>(
  nodes: T[],
  query: string,
  opts: SearchOpts = {},
): T[] {
  const tokens = tokenize(query)
  if (!tokens.length) {
    return opts.limit != null ? nodes.slice(0, opts.limit) : nodes
  }
  const keywords = opts.keywords ?? {}
  const boosts = opts.boosts ?? {}
  const scored: { node: T; score: number; index: number }[] = []
  nodes.forEach((node, index) => {
    const base = scoreNode(node, tokens, keywords[node.name] ?? [])
    if (base <= 0) return
    scored.push({ node, score: base + (boosts[node.name] ?? 0), index })
  })
  // Descending score; original order as a stable tiebreak.
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  const ranked = scored.map(s => s.node)
  return opts.limit != null ? ranked.slice(0, opts.limit) : ranked
}

// Conjunctions that signal a multi-step intent — short-circuiting on these would
// drop the rest of the request, so defer to the LLM path instead.
const MULTI_STEP_RE = /\b(and|then|plus|also|after)\b/i

/** A curated "canonical" node for the intent, or null. Fires only when the
 *  top-ranked match is a boosted node AND the intent fully expresses one of its
 *  multi-word keyword phrases AND the intent is a single action — i.e. an
 *  unambiguous "when I ask X, give me Y". Used to short-circuit the AI path
 *  deterministically (the LLM only reorders; it can't be bound). */
export function canonicalNodeForIntent<T extends MatchableNode>(
  nodes: T[],
  intent: string,
  opts: { keywords?: Record<string, string[]>, boosts?: Record<string, number> } = {},
): T | null {
  if (MULTI_STEP_RE.test(intent)) return null
  const top = searchNodes(nodes, intent, { keywords: opts.keywords, boosts: opts.boosts, limit: 1 })[0]
  if (!top || !opts.boosts?.[top.name]) return null
  const intentTokens = new Set(tokenize(intent))
  const phrases = opts.keywords?.[top.name] ?? []
  const hasFullPhrase = phrases.some((p) => {
    const pt = tokenize(p)
    return pt.length >= 2 && pt.every(t => intentTokens.has(t))
  })
  return hasFullPhrase ? top : null
}
