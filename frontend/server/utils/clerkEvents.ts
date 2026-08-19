/**
 * Clerk webhook event handling (accounts spec §5.1), separated from the
 * route so it unit-tests without Svix signatures. Only user.created is
 * acted on today; everything else is acknowledged (200) so Clerk does not
 * retry events we deliberately ignore.
 */
export interface ClerkEventDeps {
  sync: (userId: string, email: string | null) => Promise<void>
  /** Beta allowlist check (Stage 8) — a non-listed or missing email skips
   * provisioning entirely. Injected so this module stays env-free. */
  emailAllowed: (email: string | null) => boolean
}

export async function handleClerkEvent(
  evt: { type: string; data: any },
  deps: ClerkEventDeps,
): Promise<{ handled: boolean }> {
  if (evt.type !== 'user.created') return { handled: false }
  const id = evt.data?.id
  if (typeof id !== 'string' || !id) throw new Error('clerk webhook: user.created without a user id')
  const emails: Array<{ id?: string; email_address?: string }> = evt.data?.email_addresses ?? []
  const primary = emails.find(e => e.id === evt.data?.primary_email_address_id) ?? emails[0]
  const email = primary?.email_address ?? null
  // Private beta (Stage 8): never provision a non-invited signup from the
  // webhook path — the middleware guards the lazy path, this guards the
  // eager one. Both must hold or the wallet+bonus leaks. Fail closed on a
  // missing email. Acknowledged (200 upstream) so Clerk does not retry.
  if (!email || !deps.emailAllowed(email)) return { handled: false }
  await deps.sync(id, email)
  return { handled: true }
}
