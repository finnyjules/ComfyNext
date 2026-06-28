/**
 * Altitude → model tier map (foundation F2 of the agentic north star).
 * The client sends an altitude label; the server maps it to a model, so the
 * cost/model decision stays server-side (clients can't pick an arbitrary model).
 * Centralised so the vibe/pipeline/font routes can share one source of truth.
 */
export const AI_TIERS = {
  patch: 'claude-haiku-4-5', // Tune altitude — param nudges
  plan: 'claude-sonnet-4-6', // Build altitude — structural planning
  campaign: 'claude-opus-4-8', // Compose / Campaign altitude
} as const

export type AiTier = keyof typeof AI_TIERS

export function modelForTier(tier: string | undefined): string {
  return AI_TIERS[(tier as AiTier)] ?? AI_TIERS.plan
}
