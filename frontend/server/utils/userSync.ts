/**
 * Identity sync (accounts spec §5.1): Clerk user → users row + wallet +
 * one-time signup bonus. Called from BOTH the Clerk webhook (user.created)
 * and the auth middleware's lazy first-request fallback — webhooks can lag
 * or arrive twice, so the whole operation must be idempotent. It is: user
 * and wallet inserts are ON CONFLICT DO NOTHING, and the email write is
 * inside the SAME mutex-serialized transaction (all inside
 * ledger.ensureUser), and the bonus credit's idempotency key
 * `signup:<userId>` makes the ledger replay it as a no-op on any repeat.
 */
import type { createLedger } from './ledger'

/** PROVISIONAL until the pricing call (roadmap gap 28) — $2 of credits. */
export const SIGNUP_BONUS_CREDITS = 200

export async function ensureUserWithBonus(
  ledger: ReturnType<typeof createLedger>,
  userId: string,
  email?: string | null,
): Promise<void> {
  await ledger.ensureUser(userId, email)
  await ledger.credit(userId, SIGNUP_BONUS_CREDITS, 'signup_bonus', `signup:${userId}`)
}
