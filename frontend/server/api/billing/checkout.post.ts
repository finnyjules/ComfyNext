/**
 * Creates a Stripe Checkout Session for a decided pack (spec §5.3). The
 * session carries {userId, packId} metadata; the WEBHOOK grants credits —
 * the success redirect grants nothing, ever.
 */
import { isHosted } from '~~/server/utils/deployMode'
import { getStripe } from '~~/server/utils/stripeClient'
import { packById } from '~~/server/utils/packs'
import { ensureStripeCustomer } from '~~/server/utils/stripeCustomers'
import { getSharedLedgerDb } from '~~/server/utils/ledgerDb'

export default defineEventHandler(async (event) => {
  if (!isHosted()) throw createError({ statusCode: 404, message: 'Not found' })
  const userId = event.context.userId
  if (!userId) throw createError({ statusCode: 401, message: 'Sign in required' })

  const body = await readBody(event)
  const pack = packById(String(body?.packId ?? ''))
  if (!pack) throw createError({ statusCode: 400, message: 'Unknown pack' })

  const stripe = getStripe()
  const customerId = await ensureStripeCustomer(getSharedLedgerDb(), stripe, userId)

  const origin = getRequestHeader(event, 'origin') ?? `http://${getRequestHeader(event, 'host') ?? '127.0.0.1:3000'}`
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: pack.usd * 100,
        product_data: {
          name: `Sailor — ${pack.label} pack`,
          description: `${pack.credits.toLocaleString('en-US')} credits${pack.bonusCredits ? ` (includes ${pack.bonusCredits.toLocaleString('en-US')} bonus credits)` : ''}`,
        },
      },
    }],
    metadata: { userId, packId: pack.id, credits: String(pack.credits) },
    success_url: `${origin}/account?purchase=success`,
    cancel_url: `${origin}/account?purchase=cancelled`,
  })

  if (!session.url) throw createError({ statusCode: 502, message: 'Stripe did not return a checkout URL' })
  return { url: session.url }
})
