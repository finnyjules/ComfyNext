/**
 * POST /api/cloud-train/character-shot
 *
 * Body: { referenceImageDataUrl: string, prompt: string, aspectRatio?: string, seed?: number }
 * Returns: { imageDataUrl: string }
 *
 * Generates ONE new image of the same character from a single reference, via
 * ideogram-ai/ideogram-character on Replicate. The "Build character dataset"
 * flow loops this over a varied prompt list to bootstrap a training set from one
 * photo: identity is preserved from the reference image; the prompt drives the
 * pose/scene/lighting variety that teaches a character LoRA to bind identity to
 * the trigger rather than to one look.
 *
 * The result is downloaded server-side and returned as a data URL so the browser
 * can drop it straight into the training set (no CORS dance on the CDN url).
 * ~$0.08 per shot. Lives under the already-allowlisted /api/cloud-train prefix.
 *
 * Paid: creates a real Replicate prediction on MODEL. Gate before dispatch,
 * settle only once the prediction has confirmed success (mirrors
 * lora-cover.post.ts's synchronous create-then-poll-then-settle shape).
 */
import { preflightMeter } from '../../utils/requestMeter'

const MODEL = 'ideogram-ai/ideogram-character'
const VALID_AR = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '16:10', '10:16'])

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()

  const body = await readBody(event) as {
    referenceImageDataUrl?: string
    prompt?: string
    aspectRatio?: string
    seed?: number
  }
  const ref = body?.referenceImageDataUrl
  const prompt = (body?.prompt || '').trim()
  if (!ref || !/^data:image\//.test(ref)) {
    throw createError({ statusCode: 400, message: 'referenceImageDataUrl (a data: image URI) is required' })
  }
  if (!prompt) {
    throw createError({ statusCode: 400, message: 'prompt is required' })
  }
  const aspect_ratio = VALID_AR.has(body?.aspectRatio || '') ? body!.aspectRatio : '1:1'

  // Paid: gate on balance/price before creating the Replicate prediction.
  const ticket = await preflightMeter(MODEL)
  try {

    const input: Record<string, any> = {
      prompt,
      character_reference_image: ref,
      aspect_ratio,
    }
    if (body?.seed && body.seed > 0) input.seed = body.seed

    const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json' }

    // Official models accept the model-aliased predictions endpoint (no version).
    let createRes = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
      method: 'POST', headers, body: JSON.stringify({ input }),
    })
    if (createRes.status === 404) {
      // Fallback: resolve latest_version and POST to /predictions.
      const m = await fetch(`https://api.replicate.com/v1/models/${MODEL}`, { headers })
      const version = ((await m.json()) as { latest_version?: { id?: string } })?.latest_version?.id
      if (!version) throw createError({ statusCode: 502, message: `${MODEL} has no version` })
      createRes = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST', headers, body: JSON.stringify({ version, input }),
      })
    }
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '')
      throw createError({ statusCode: createRes.status, message: text || createRes.statusText })
    }
    let pred = await createRes.json() as { id: string, status: string, output?: unknown, error?: unknown }

    // Poll until terminal (Ideogram is ~10–25s).
    const deadline = Date.now() + 120_000
    while (pred.status !== 'succeeded' && pred.status !== 'failed' && pred.status !== 'canceled') {
      if (Date.now() > deadline) {
        throw createError({ statusCode: 504, message: 'Character shot timed out' })
      }
      await new Promise((r) => setTimeout(r, 1500))
      const p = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, { headers })
      if (!p.ok) continue
      pred = await p.json()
    }
    if (pred.status !== 'succeeded') {
      throw createError({ statusCode: 502, message: `Character shot ${pred.status}: ${String(pred.error ?? '')}` })
    }
    await ticket?.settle('rep:' + pred.id)

    const url = Array.isArray(pred.output) ? pred.output[0] : pred.output
    if (typeof url !== 'string' || !url) {
      throw createError({ statusCode: 502, message: 'No image returned' })
    }

    // Download server-side → data URL (the browser ingests it without CORS).
    const dl = await fetch(url)
    if (!dl.ok) throw createError({ statusCode: 502, message: `Could not fetch result image (${dl.status})` })
    const buf = Buffer.from(await dl.arrayBuffer())
    const contentType = dl.headers.get('content-type') || 'image/png'
    const imageDataUrl = `data:${contentType};base64,${buf.toString('base64')}`

    return { imageDataUrl }
  } catch (e) {
    // Any throw past the preflight means no output shipped — hand the
    // reservation back instead of letting it sit until holdSweep's TTL.
    // (Releasing an already-settled hold is an idempotent no-op.)
    await ticket?.release()
    throw e
  }
})
