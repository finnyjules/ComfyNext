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
import { deployMode } from '../utils/deployMode'
import { guardDecision } from '../utils/authGuard'
import { ensureUserWithBonus } from '../utils/userSync'
import { getLiveLedger } from '../utils/ledgerLive'
import type { H3Event } from 'h3'

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

export default defineEventHandler((event) => {
  const mode = deployMode()
  if (mode === 'local') return

  const path = event.path ?? ''
  const userId = resolveClerkUserId(event)
  const decision = guardDecision(path, mode, userId)

  if (decision.kind === 'reject') {
    throw createError({ statusCode: 401, message: 'Sign in required' })
  }
  if (decision.kind === 'attach') {
    event.context.userId = decision.userId
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
