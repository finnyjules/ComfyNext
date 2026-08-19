/**
 * Hosted-mode session guard (accounts spec §5.1). Runs BEFORE
 * comfyui-proxy.ts (filename order) so every proxied engine path is guarded
 * too. Local mode: guardDecision passes everything — zero behavior change.
 *
 * On the first authenticated request a process sees for a user, lazily
 * ensure the user row + wallet + signup bonus exist (covers Clerk-webhook
 * lag; ensureUserWithBonus is idempotent so webhook + lazy racing is safe).
 * The lazy sync must never block or fail the request — sync errors are
 * logged and retried on a later request.
 */
import { createClerkClient } from '@clerk/backend'
import { getRequestURL, getRequestHeaders } from 'h3'
import { deployMode } from '../utils/deployMode'
import { guardDecision } from '../utils/authGuard'
import { ensureUserWithBonus } from '../utils/userSync'
import { getLiveLedger } from '../utils/ledgerLive'
import { bindMeterContext, clearMeterContext } from '../utils/requestMeter'
import { checkBetaAccess } from '../utils/betaAccess'
import type { H3Event } from 'h3'

/**
 * context.auth is set by Clerk's module middleware, which Nitro runs AFTER
 * scanned middleware (this file) — so it is always undefined here. Do not
 * use this in this file's handler; see resolveHostedUserId, which verifies
 * the session directly via @clerk/backend instead of reading context.auth.
 * Kept exported: its unit tests stand and it documents the context shape
 * Clerk sets for downstream (module-middleware-ordered) handlers.
 */
export function resolveClerkUserId(event: H3Event): string | null {
  const auth = (event.context as any).auth
  if (typeof auth !== 'function') return null
  try {
    const a = auth()
    return a?.userId ?? null
  } catch {
    return null
  }
}

type ClerkClientLike = {
  authenticateRequest: (req: Request) => Promise<{ toAuth: () => { userId: string | null } | null }>
  users?: { getUser: (userId: string) => Promise<any> }
}

// Lazily-created hosted Clerk client (never constructed in local mode).
let clerkClient: ClerkClientLike | null = null
function getClerkClient(): ClerkClientLike {
  if (!clerkClient) {
    clerkClient = createClerkClient({
      secretKey: process.env.NUXT_CLERK_SECRET_KEY!,
      publishableKey: process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    })
  }
  return clerkClient
}

// Test-only injection point — bypasses the real Clerk client construction
// (and its secretKey env requirement) so tests can substitute a stub.
export function __setClerkClientForTests(client: ClerkClientLike | null): void {
  clerkClient = client
}

/** Hosted-mode session resolution. Runs BEFORE Clerk's own module middleware
 * (Nitro: scanned middleware precede module handlers), so we cannot read
 * event.context.auth here — we verify the session token ourselves.
 *
 * CRITICAL: session auth needs only URL + headers (cookies / Authorization).
 * Passing the real request (toWebRequest) wraps the BODY stream, and any
 * downstream route calling readBody/readRawBody then deadlocks forever —
 * this froze the checkout button live (and would freeze every guarded POST).
 * We hand Clerk a synthetic body-less Request instead. */
export async function resolveHostedUserId(event: H3Event): Promise<string | null> {
  try {
    // Defensive extraction: a malformed event must fail auth, not crash —
    // and unit tests exercise this with minimal fake events.
    let url = 'http://127.0.0.1/'
    try { url = getRequestURL(event).toString() } catch { /* fall through */ }
    const headers = new Headers()
    try {
      for (const [k, v] of Object.entries(getRequestHeaders(event))) {
        if (typeof v === 'string') headers.set(k, v)
      }
    } catch { /* no headers — auth will simply fail */ }
    const bodylessRequest = new Request(url, { method: 'GET', headers })
    const state = await getClerkClient().authenticateRequest(bodylessRequest)
    const auth = state.toAuth()
    return auth?.userId ?? null
  } catch {
    return null
  }
}

/** Primary email for a Clerk user — the beta-allowlist identity. Returns
 * null on any failure so checkBetaAccess fails CLOSED (deny, retry later). */
export async function fetchPrimaryEmail(userId: string): Promise<string | null> {
  try {
    const u: any = await getClerkClient().users!.getUser(userId)
    const emails: Array<{ id?: string; emailAddress?: string }> = u?.emailAddresses ?? []
    const primary = emails.find(e => e.id === u?.primaryEmailAddressId) ?? emails[0]
    return primary?.emailAddress ?? null
  } catch {
    return null
  }
}

// Per-process memo so the lazy sync runs once per user, not per request.
// Misses are cheap (ensureUserWithBonus is idempotent); a process restart
// simply re-runs one no-op sync per user.
let lazySynced = new Set<string>()
export function shouldLazySync(userId: string): boolean {
  if (lazySynced.has(userId)) return false
  lazySynced.add(userId)
  return true
}
export function __resetLazySyncForTests(): void { lazySynced = new Set() }

// GUARD: this must remain a plain-function defineEventHandler (no
// await-before-body wrapper), and clearMeterContext() below must stay the
// first statement on the hosted path — before any await (the local-mode
// check above it is synchronous, so it doesn't break this). The
// request-meter box's propagation to downstream middleware/route handlers
// depends on clearMeterContext's enterWith running in this handler's
// synchronous prefix; see requestMeter.ts's module doc for why moving it
// after an await (or wrapping this handler) breaks context delivery.
export default defineEventHandler(async (event) => {
  const mode = deployMode()
  if (mode === 'local') return

  // Clear-then-bind on EVERY hosted request (review escalation 2026-08-14):
  // als.enterWith is not call-scoped, so a stale context left by a previous
  // request on the same async chain could bill the wrong user under HTTP
  // pipelining/multiplexing. Clearing FIRST — before the public-path
  // short-circuit below — means every hosted request starts context-less;
  // only the attach branch below re-binds a freshly resolved user.
  clearMeterContext()

  const path = event.path ?? ''
  // Public and unguarded paths short-circuit BEFORE any session resolution:
  // authenticateRequest's toWebRequest(event) wraps the request body stream,
  // and webhook routes (Svix/Stripe signature verification) must read the
  // RAW body themselves — touching it here deadlocks their readRawBody.
  if (guardDecision(path, mode, null).kind === 'pass') return

  const userId = await resolveHostedUserId(event)
  const decision = guardDecision(path, mode, userId)

  if (decision.kind === 'reject') {
    throw createError({ statusCode: 401, message: 'Sign in required' })
  }
  if (decision.kind === 'attach') {
    // Private-beta allowlist (Stage 8): deny BEFORE attaching identity,
    // binding the meter, or lazily provisioning the wallet+bonus — a
    // non-invited signup must never acquire a spendable wallet. Fails
    // CLOSED (unset list or failed email lookup ⇒ deny).
    const beta = await checkBetaAccess(decision.userId, {
      allowlistRaw: process.env.SAILOR_BETA_ALLOWLIST,
      getEmail: fetchPrimaryEmail,
    })
    if (!beta.allowed) {
      throw createError({ statusCode: 403, message: 'Sailor is in private beta', data: { code: 'beta_not_invited' } })
    }
    event.context.userId = decision.userId
    bindMeterContext({ userId: decision.userId })
    if (shouldLazySync(decision.userId)) {
      void ensureUserWithBonus(getLiveLedger(), decision.userId)
        .catch((e) => {
          console.error('[auth] lazy user sync failed for', decision.userId, e)
          lazySynced.delete(decision.userId) // retry on a later request
        })
    }
  }
})

declare module 'h3' {
  interface H3EventContext {
    userId?: string
  }
}
