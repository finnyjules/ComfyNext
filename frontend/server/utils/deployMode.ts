/**
 * The deployment switch (accounts spec §10 Phase 1): no Clerk keys in env ⇒
 * local mode — no login, no metering, exactly the pre-accounts behavior.
 * Hosted mode activates ONLY when a Clerk secret key is configured.
 *
 * Read from process.env (not runtimeConfig) so it works in unit tests and
 * outside request context. Evaluated per call — never cache at module level.
 */
export type DeployMode = 'local' | 'hosted'

export function deployMode(): DeployMode {
  const key = process.env.NUXT_CLERK_SECRET_KEY
  return typeof key === 'string' && key.trim().length > 0 ? 'hosted' : 'local'
}

export function isHosted(): boolean {
  return deployMode() === 'hosted'
}
