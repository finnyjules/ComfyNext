/**
 * Clerk → Sailor user sync (accounts spec §5.1). Svix-verified via
 * @clerk/backend's verifyWebhook (CLERK_WEBHOOK_SIGNING_SECRET env). The
 * signature is the auth — this path is in PUBLIC_API_PATHS, no session.
 * Hosted mode only: local mode has no Clerk and must not expose it.
 */
import { verifyWebhook } from '@clerk/backend/webhooks'
import { toWebRequest } from 'h3'
import { isHosted } from '~~/server/utils/deployMode'
import { handleClerkEvent } from '~~/server/utils/clerkEvents'
import { ensureUserWithBonus } from '~~/server/utils/userSync'
import { getLiveLedger } from '~~/server/utils/ledgerLive'

export default defineEventHandler(async (event) => {
  if (!isHosted()) throw createError({ statusCode: 404, message: 'Not found' })

  let evt: { type: string; data: any }
  try {
    const webRequest = toWebRequest(event)
    evt = await verifyWebhook(webRequest, {
      signingSecret: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
    }) as any
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid webhook signature' })
  }

  const result = await handleClerkEvent(evt, {
    sync: (userId, email) => ensureUserWithBonus(getLiveLedger(), userId, email),
  })
  return { ok: true, handled: result.handled }
})
