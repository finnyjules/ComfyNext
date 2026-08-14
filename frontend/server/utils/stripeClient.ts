/**
 * Hosted-mode Stripe client. Lazy singleton — never constructed in local
 * mode (no STRIPE_SECRET_KEY there), mirroring the Clerk client in
 * server/middleware/auth.ts and getSharedLedgerDb's env discipline.
 */
import Stripe from 'stripe'

let stripe: Stripe | null = null

export function getStripe(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('stripeClient: STRIPE_SECRET_KEY is not set (hosted mode requires it)')
    stripe = new Stripe(key)
  }
  return stripe
}

/** Test seam (mirrors __setClerkClientForTests in auth.ts). */
export function __setStripeForTests(client: Stripe | null): void {
  stripe = client
}
