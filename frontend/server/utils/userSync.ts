/**
 * Identity sync (accounts spec §5.1): Clerk user → users row + wallet +
 * one-time signup bonus. Called from BOTH the Clerk webhook (user.created)
 * and the auth middleware's lazy first-request fallback — webhooks can lag
 * or arrive twice, so the whole operation must be idempotent. It is: user
 * and wallet inserts are ON CONFLICT DO NOTHING (inside ledger.ensureUser),
 * and the bonus credit's idempotency key `signup:<userId>` makes the ledger
 * replay it as a no-op on any repeat.
 */
import type { LedgerDb } from './ledger'
import type { createLedger } from './ledger'

/** PROVISIONAL until the pricing call (roadmap gap 28) — $2 of credits. */
export const SIGNUP_BONUS_CREDITS = 200

export async function ensureUserWithBonus(
  ledger: ReturnType<typeof createLedger>,
  db: LedgerDb,
  userId: string,
  email?: string | null,
): Promise<void> {
  await ledger.ensureUser(userId)
  if (email) {
    await db.query(
      `UPDATE users SET email = $2 WHERE id = $1 AND (email IS NULL OR email <> $2)`,
      [userId, email])
  }
  await ledger.credit(userId, SIGNUP_BONUS_CREDITS, 'signup_bonus', `signup:${userId}`)
}
