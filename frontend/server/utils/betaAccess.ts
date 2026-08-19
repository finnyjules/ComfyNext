/**
 * Private-beta access allowlist (Stage 8 spec, Component A). Pure logic —
 * this module NEVER reads env or constructs a Clerk client; callers pass
 * the raw allowlist string and an email-lookup function so it unit-tests
 * without a harness (the authGuard.ts pattern).
 *
 * Fail direction: CLOSED. An empty/unset list denies everyone; a failed or
 * empty email lookup denies. Same rationale as the spend guard — an
 * unknown access state is a money risk (each stray signup = 100 bonus
 * credits of real provider exposure).
 */

export function parseAllowlist(raw: string | null | undefined): Set<string> {
  if (!raw) return new Set()
  return new Set(raw.split(',').map(e => e.trim().toLowerCase()).filter(e => e.length > 0))
}

export function isEmailAllowed(allow: Set<string>, email: string | null | undefined): boolean {
  if (!email) return false
  return allow.has(email.trim().toLowerCase())
}

export interface BetaAccessDeps {
  allowlistRaw: string | undefined
  getEmail: (userId: string) => Promise<string | null>
}

// Per-process memo of SUCCESSFUL email resolutions only — a failed or null
// lookup must retry on a later request (transient Clerk blips shouldn't
// lock a beta user out for the process lifetime). The allowed/denied
// verdict is recomputed per call (a cheap Set lookup) so behavior tracks
// the env exactly; only the Clerk round-trip is memoized.
let emailMemo = new Map<string, string>()

export async function checkBetaAccess(
  userId: string,
  deps: BetaAccessDeps,
): Promise<{ allowed: boolean; email: string | null }> {
  let email = emailMemo.get(userId) ?? null
  if (email === null) {
    try {
      email = await deps.getEmail(userId)
    } catch {
      email = null
    }
    if (email) emailMemo.set(userId, email)
  }
  return { allowed: isEmailAllowed(parseAllowlist(deps.allowlistRaw), email), email }
}

export function __resetBetaAccessForTests(): void { emailMemo = new Map() }
