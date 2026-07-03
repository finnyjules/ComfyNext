/**
 * Spike stand-in for the Clerk session guard (spec §5.1) and the §7 comfy.org
 * credential rule. resolveSpikeUser reads a caller id from a header instead of
 * verifying a JWT — Phase 1 replaces it with the real Clerk middleware, keeping
 * the "route gets a userId or 401" contract. stripForeignComfyOrgCreds enforces
 * the hard rule: never forward a comfy.org credential this caller didn't supply.
 */
const COMFY_ORG_KEYS = ['auth_token_comfy_org', 'api_key_comfy_org'] as const

export function resolveSpikeUser(headers: Record<string, string | undefined>): string | null {
  const raw = headers['x-spike-user']
  const id = (raw ?? '').trim()
  return id || null
}

export function stripForeignComfyOrgCreds(
  extraData: Record<string, any> | undefined,
  callerSuppliedKey: string | null,
): Record<string, any> {
  const out: Record<string, any> = { ...(extraData ?? {}) }
  for (const k of COMFY_ORG_KEYS) {
    if (k in out && out[k] !== callerSuppliedKey) delete out[k]
  }
  return out
}
