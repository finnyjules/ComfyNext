/**
 * Shared request guards for the agent routes (agent-plan, agent-review, vibe,
 * copy-assist, …). Hand-rolled on purpose — the codebase validates manually and
 * these helpers keep the checks consistent without adding a schema dependency.
 * Errors are plain Error objects with statusCode so h3 renders them as HTTP
 * errors and unit tests don't need h3.
 */
import { isHosted } from '../utils/deployMode'

/** ~100k tokens of prompt text; the client-built canvas prompt includes the
 *  full surface snapshot, so this is generous but bounded. */
export const MAX_PROMPT_CHARS = 400_000
/** Base64 inflates 4/3; ~7M chars ≈ 5MB decoded, the Anthropic image cap. */
export const MAX_IMAGE_CHARS = 7_000_000
/** A user-typed request phrase. */
export const MAX_PHRASE_CHARS = 4_000
export const MAX_KEY_CHARS = 500

const AI_TIER_NAMES = ['patch', 'plan', 'campaign'] as const

export function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 })
}

export function requireString(v: unknown, name: string, max: number): string {
  if (typeof v !== 'string' || !v.trim()) throw badRequest(`${name} is required`)
  if (v.length > max) throw badRequest(`${name} too long (${v.length} chars, max ${max})`)
  return v
}

export function optionalString(v: unknown, name: string, max: number): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v === 'string' && !v.trim()) return undefined
  return requireString(v, name, max)
}

export function optionalApiKey(v: unknown): string | undefined {
  return optionalString(v, 'apiKey', MAX_KEY_CHARS)
}

/** Shared-key resolution: the client's own key (BYOK override) wins, else the
 *  server's env key. 503 (not 400) when neither — the request was fine, the
 *  deployment isn't. In hosted mode the BYOK override is ignored entirely:
 *  per-request plaintext keys must not ride through shared infrastructure,
 *  and the operator's server key is the only path. */
export function resolveAnthropicKey(serverKey: string | undefined, clientKey: string | undefined): string {
  const byok = isHosted() ? '' : (clientKey || '').trim()
  const key = byok || (serverKey || '').trim()
  if (!key) {
    throw Object.assign(
      new Error("AI assist isn't configured on this server. Set NUXT_ANTHROPIC_API_KEY when starting the app, or paste your own key in Settings → AI."),
      { statusCode: 503 },
    )
  }
  return key
}

/** Reject unknown tiers loudly — a typo would otherwise silently change model
 *  altitude (modelForTier defaults to 'plan'). */
export function optionalTier(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string' || !(AI_TIER_NAMES as readonly string[]).includes(v)) {
    throw badRequest(`unknown tier '${String(v)}'`)
  }
  return v
}
