/**
 * Minimal fal.ai queue runner for Nitro routes — the inference counterpart to
 * falStorage.ts (which only uploads). Mirrors the proven Python client in
 * comfy_api_nodes/fal_refs.py: POST to queue.fal.run/{app}, poll status (fal
 * returns 202 while IN_QUEUE/IN_PROGRESS, 200 when COMPLETED), then GET the
 * result. Prefer the status/response URLs fal returns in the submit body so
 * sub-endpoint apps (e.g. fal-ai/flux-pro/v1/fill) poll the correct base.
 *
 * The fal key is server-only: FAL_KEY (or NUXT_FAL_TOKEN), resolved by
 * getFalToken() from falStorage.ts.
 */
import { getFalToken } from './falStorage'
import { logSpend } from './spendLog'
import { preflightMeter } from './requestMeter'

const FAL_QUEUE_BASE = 'https://queue.fal.run'

export interface FalRunOptions {
  pollDeadlineMs?: number
  pollIntervalMs?: number
}

interface FalSubmit {
  request_id: string
  status_url?: string
  response_url?: string
}

export async function runFal<T = unknown>(
  app: string,
  input: Record<string, unknown>,
  opts: FalRunOptions = {},
): Promise<T> {
  const ticket = await preflightMeter(app)
  const token = getFalToken()
  if (!token) throw new Error('FAL_KEY is not set (add it to frontend/.env)')
  const headers = { Authorization: `Key ${token}`, 'Content-Type': 'application/json' }
  const appBase = `${FAL_QUEUE_BASE}/${app}`

  const submitRes = await fetch(appBase, {
    method: 'POST', headers, body: JSON.stringify(input),
  })
  if (!submitRes.ok) {
    const t = await submitRes.text().catch(() => '')
    throw new Error(`fal submit ${submitRes.status}: ${t || submitRes.statusText}`)
  }
  const submit = await submitRes.json() as FalSubmit
  const startedAt = Date.now()
  const rid = submit.request_id
  const statusUrl = submit.status_url || `${appBase}/requests/${rid}/status`
  const resultUrl = submit.response_url || `${appBase}/requests/${rid}`

  const deadline = Date.now() + (opts.pollDeadlineMs ?? 120_000)
  const interval = opts.pollIntervalMs ?? 1500
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval))
    const sRes = await fetch(statusUrl, { headers })
    if (sRes.status !== 200 && sRes.status !== 202) {
      // 4xx = unrecoverable (bad rid / revoked key); 5xx = transient, retry.
      if (sRes.status >= 400 && sRes.status < 500) {
        const t = await sRes.text().catch(() => '')
        throw new Error(`fal status ${sRes.status} (not retryable): ${t}`)
      }
      continue
    }
    const status = await sRes.json() as { status?: string }
    if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') continue
    if (status.status === 'COMPLETED') {
      logSpend({ provider: 'fal', model: app, ok: true, ms: Date.now() - startedAt })
      const rRes = await fetch(resultUrl, { headers })
      if (!rRes.ok) {
        const t = await rRes.text().catch(() => '')
        throw new Error(`fal result ${rRes.status}: ${t}`)
      }
      if (ticket) await ticket.settle('fal:' + rid)
      return await rRes.json() as T
    }
    logSpend({ provider: 'fal', model: app, ok: false, ms: Date.now() - startedAt })
    throw new Error(`fal request ${rid} ended in ${status.status}: ${JSON.stringify(status)}`)
  }
  throw new Error(`fal request timed out (id=${rid})`)
}

/** First image URL from an fal image result ({ images: [{ url }] }). */
export function firstFalImageUrl(result: unknown): string | null {
  const images = (result as { images?: Array<{ url?: string }> })?.images
  return Array.isArray(images) && images[0]?.url ? images[0].url : null
}
