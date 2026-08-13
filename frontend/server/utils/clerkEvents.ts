/**
 * Clerk webhook event handling (accounts spec §5.1), separated from the
 * route so it unit-tests without Svix signatures. Only user.created is
 * acted on today; everything else is acknowledged (200) so Clerk does not
 * retry events we deliberately ignore.
 */
export interface ClerkEventDeps {
  sync: (userId: string, email: string | null) => Promise<void>
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
  await deps.sync(id, primary?.email_address ?? null)
  return { handled: true }
}
