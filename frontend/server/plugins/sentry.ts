/**
 * Server-side Sentry init (Stage 7, Task 6). Hosted-only by construction:
 * Sentry.init runs ONLY when SENTRY_DSN is present, so local boot (no DSN)
 * never initialises Sentry and stays byte-identical. A globalThis singleton
 * guards against Nitro HMR re-running init in dev — the holdSweep.ts pattern.
 *
 * captureError (server/utils/observe.ts) forwards to this same @sentry/node
 * instance under the same DSN gate; the client is wired separately via the
 * @sentry/nuxt module in nuxt.config.ts.
 */
import * as Sentry from '@sentry/node'

const g = globalThis as unknown as { __sailorSentryInited?: boolean }

export default defineNitroPlugin(() => {
  if (g.__sailorSentryInited) return
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return // local mode — no DSN, no init
  Sentry.init({ dsn })
  g.__sailorSentryInited = true
})
