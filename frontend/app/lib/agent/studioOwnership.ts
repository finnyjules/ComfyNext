/**
 * "Does a STUDIO own this phrase?" — a cheap, local, deterministic gate in
 * front of the sketch fast-path.
 *
 * The prompt bar fires the 4-up sketch pad immediately for anything that looks
 * like an image idea, without waiting for the planner. On an EMPTY canvas that
 * verdict is almost unconditional, so studio requests ("a warm dreamy gradient
 * background for a hero banner") got drafted as photos before the planner could
 * route them to GradientStudio. This gate makes the fast-path DEFER: if a studio
 * decisively owns the words, the planner decides.
 *
 * It reuses the same SCORER and the same capability VOCABULARY that the routing
 * corpus pins (tests/unit/agent-capability-routing.unit.spec.ts):
 * searchNodes/scoreNode over AGENT_CAPABILITIES with capabilityKeywords() +
 * capabilityBoosts(). It is NOT the full production routing path — that adds
 * catalog assembly on top (raw /object_info nodes in the pool, type-hop buckets,
 * widget defs, pinned flagships, then the model's pick). So this is a
 * same-vocabulary approximation of "would a studio surface for these words",
 * not a prediction of what the planner will choose.
 *
 * Which is fine, because the bias only has to run one way: a false YES here
 * costs a ~1s wait for the planner (which then routes properly, and the
 * "…or sketch it?" chip is the crossover), while a false NO costs a wrong
 * render. Being roughly right and cheap beats being exact and slow — no model
 * call, no async, no parallel keyword list to drift; pure arithmetic over ~70
 * entries, since the fast-path exists precisely to skip a round trip.
 */
import { AGENT_CAPABILITIES, capabilityBoosts, capabilityKeywords, type CapabilityKind } from '~/lib/agent/capabilities'
import { scoreNode, searchNodes, tokenize } from '~/lib/nodeMatch'

/**
 * Per-token score a studio must reach to claim a phrase.
 *
 * Derived from real data (see .superpowers/sdd/sketch-gate-report.md): scored
 * over the 10 planner-eval prompts plus 20 genuine image ideas, every phrase a
 * studio owns lands at 19.3+ per token, while the highest-scoring genuine image
 * idea reaches 14.6 and the eval prompts the planner routes elsewhere top out at
 * 10.2. 17 sits mid-gap with headroom on both sides.
 *
 * The scale is meaningful, not arbitrary: nodeMatch scores a whole-word keyword
 * hit at 8 × the 2.5 keyword weight = 20 per token, so ~17 means "most of the
 * words in this phrase are words this studio's own intent vocabulary claims".
 */
export const STUDIO_OWNERSHIP_THRESHOLD = 17

interface CapNode { name: string, displayName: string, description: string, category: string, kind: CapabilityKind }

// Lazy + cached: a top-level const reading another module's top-level const is
// import-order sensitive (see MEMORY: "eager module const + init order").
let cached: { nodes: CapNode[], keywords: Record<string, string[]>, boosts: Record<string, number> } | null = null
function machinery() {
  if (!cached) {
    cached = {
      nodes: AGENT_CAPABILITIES.map(c => ({
        name: c.nodeType, displayName: c.title, description: c.summary, category: c.kind, kind: c.kind,
      })),
      keywords: capabilityKeywords(),
      boosts: capabilityBoosts(),
    }
  }
  return cached
}

export interface StudioMatch {
  /** The top-ranked capability's nodeType (a studio). */
  nodeType: string
  /** Per-token score — comparable across phrase lengths. */
  score: number
}

/**
 * The top-ranked capability for `text`, IF it is a studio. Returns null when the
 * phrase ranks a generator/effect first (or matches nothing) — i.e. when no
 * studio is even in the running — and, unless `ignoreThreshold`, when the studio
 * that did rank first isn't decisive enough to override the fast-path.
 *
 * `ignoreThreshold` is for calibration/tests: it reports the score of a
 * first-ranked studio without applying the cutoff.
 */
export function studioMatch(text: string, opts: { ignoreThreshold?: boolean } = {}): StudioMatch | null {
  const tokens = tokenize(text)
  if (!tokens.length) return null
  const { nodes, keywords, boosts } = machinery()
  // Same ranking call the routing corpus makes — the #1 the agent palette would
  // surface for this phrasing.
  const top = searchNodes(nodes, text, { keywords, boosts, limit: 1 })[0]
  if (!top || top.kind !== 'studio') return null
  const raw = scoreNode(top, tokens, keywords[top.name] ?? []) + (boosts[top.name] ?? 0)
  const score = raw / tokens.length
  if (!opts.ignoreThreshold && score <= STUDIO_OWNERSHIP_THRESHOLD) return null
  return { nodeType: top.name, score }
}

/** True when a studio decisively owns this phrase — let the planner route it. */
export function studioOwnsPhrase(text: string): boolean {
  return studioMatch(text) !== null
}
