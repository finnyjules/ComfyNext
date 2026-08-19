/**
 * Sentry client init (Stage 7, Task 6). Loaded by the @sentry/nuxt module,
 * which is registered in nuxt.config.ts ONLY when NUXT_PUBLIC_SENTRY_DSN is
 * set. So in local mode this file is never bundled or run. The extra dsn guard
 * is belt-and-suspenders: init is skipped if the DSN is somehow empty.
 */
import * as Sentry from '@sentry/nuxt'

const publicConfig = useRuntimeConfig().public as { sentry?: { dsn?: string } }
const dsn = publicConfig.sentry?.dsn

if (dsn) {
  Sentry.init({ dsn })
}
