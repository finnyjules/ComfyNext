/**
 * Thin error-observability wrapper around Sentry. Hosted-only by construction:
 * captureError forwards to Sentry's captureException ONLY when SENTRY_DSN is
 * set (the server plugin inits Sentry under the same condition), otherwise it
 * is a pure no-op — local mode never loads or touches Sentry. It NEVER throws
 * (a logging failure must not take a request down) and it STRIPS the
 * prompt-bearing context keys (prompt/text/positive/negative) before sending,
 * so user prompt text never leaves the box via error reporting.
 */
import * as SentryNode from '@sentry/node'

type SentryLike = { captureException: (err: unknown, hint?: unknown) => unknown }

let sentryOverride: SentryLike | null = null

// Test seam — inject a Sentry stub so the no-op / forward / scrub behaviour can
// be asserted without the real SDK.
export function __setSentryForTests(stub: SentryLike | null): void {
  sentryOverride = stub
}

const PROMPT_KEYS = ['prompt', 'text', 'positive', 'negative']

function scrub(context: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(context)) {
    if (PROMPT_KEYS.includes(k)) continue
    clean[k] = v
  }
  return clean
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  try {
    if (!process.env.SENTRY_DSN) return
    const sentry: SentryLike = sentryOverride ?? (SentryNode as unknown as SentryLike)
    const extra = context ? scrub(context) : undefined
    sentry.captureException(err, extra ? { extra } : undefined)
  } catch {
    // Never let observability failures escape into the request path.
  }
}
