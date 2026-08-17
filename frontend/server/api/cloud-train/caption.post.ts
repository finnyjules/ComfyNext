/**
 * POST /api/cloud-train/caption
 *
 * Body: { imageDataUrl: string, mode?: 'style' | 'character', trigger?: string }
 * Returns: { caption: string }
 *
 * Captions ONE training image via a vision model (Qwen2-VL) server-side, using
 * the Replicate token — the same reliable path as /aesthetic. This REPLACES the
 * old client-built ComfyUI graph, which posted a `ShowText|pysssss` node (not
 * installed) plus a stale `ClaudeNode` schema (wrong inputs + Comfy-Org auth),
 * so /prompt rejected the graph at validation and captioning never worked.
 *
 * The `mode` is the steering wheel for what the LoRA learns:
 *   'style'     (default) — describe the subject + look so content stays
 *                controllable; the trigger absorbs the shared aesthetic.
 *   'character' — describe ONLY setting/pose/clothing/lighting/framing and
 *                NEVER the face/body/identity, so the trigger word absorbs the
 *                identity. This is what makes a character LoRA hold a face.
 *
 * One-time, cheap (~$0.002, a few seconds per image). Lives under the
 * already-allowlisted /api/cloud-train prefix (server/middleware/comfyui-proxy).
 *
 * Paid: creates a real Replicate prediction on QWEN_MODEL. Gate before
 * dispatch, settle only once the prediction has confirmed success (mirrors
 * lora-cover.post.ts's synchronous create-then-poll-then-settle shape).
 */
import { preflightMeter } from '../../utils/requestMeter'

const QWEN_MODEL = 'lucataco/qwen2-vl-7b-instruct'

const STYLE_PROMPT = [
  'Write one concise, training-friendly caption for this image.',
  'Describe the subject, key visual attributes, style, and composition in one or two short sentences.',
  'Do not start with "an image of" or "a photo of". No quotes, no markdown. Just the caption text.',
].join(' ')

function characterPrompt(trigger: string): string {
  const token = (trigger || '').trim() || 'the subject'
  return [
    `This image belongs to a dataset for training a CHARACTER LoRA of one person, referred to as "${token}".`,
    `Write one concise caption that begins with "${token}".`,
    'Describe ONLY the setting, pose, clothing/outfit, lighting, camera framing, and background.',
    'Do NOT describe the face, hair, body, age, gender, ethnicity, or any identifying physical feature —',
    'those must be learned by the trigger word, not written into the caption.',
    'One or two short sentences. No quotes, no markdown. Just the caption text.',
  ].join(' ')
}

function cleanCaption(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim()
    .slice(0, 400)
}

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()

  const body = await readBody(event) as { imageDataUrl?: string, mode?: string, trigger?: string }
  const imageDataUrl = body?.imageDataUrl
  if (!imageDataUrl || !/^data:image\//.test(imageDataUrl)) {
    throw createError({ statusCode: 400, message: 'imageDataUrl (a data: image URI) is required' })
  }
  const prompt = body.mode === 'character'
    ? characterPrompt(body.trigger || '')
    : STYLE_PROMPT

  // Paid: gate on balance/price before creating the Replicate prediction.
  const ticket = await preflightMeter(QWEN_MODEL)
  try {

    // Resolve the model's latest version (community model → versioned predictions).
    const modelRes = await fetch(`https://api.replicate.com/v1/models/${QWEN_MODEL}`, {
      headers: { Authorization: `Token ${token}` },
    })
    if (!modelRes.ok) {
      throw createError({ statusCode: 502, message: `Could not look up ${QWEN_MODEL}: ${modelRes.statusText}` })
    }
    const version = ((await modelRes.json()) as { latest_version?: { id?: string } }).latest_version?.id
    if (!version) {
      throw createError({ statusCode: 502, message: `${QWEN_MODEL} has no latest version` })
    }

    const createRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        version,
        input: { media: imageDataUrl, prompt, max_new_tokens: 160 },
      }),
    })
    if (!createRes.ok) {
      const text = await createRes.text().catch(() => '')
      throw createError({ statusCode: createRes.status, message: text || createRes.statusText })
    }
    let pred = await createRes.json() as { id: string, status: string, output?: unknown, error?: unknown }

    // Poll until terminal (Qwen2-VL is fast — a handful of seconds).
    const deadline = Date.now() + 60_000
    while (pred.status !== 'succeeded' && pred.status !== 'failed' && pred.status !== 'canceled') {
      if (Date.now() > deadline) {
        throw createError({ statusCode: 504, message: 'Caption generation timed out' })
      }
      await new Promise((r) => setTimeout(r, 1200))
      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
        headers: { Authorization: `Token ${token}` },
      })
      if (!pollRes.ok) continue
      pred = await pollRes.json()
    }

    if (pred.status !== 'succeeded') {
      throw createError({ statusCode: 502, message: `Caption generation ${pred.status}: ${String(pred.error ?? '')}` })
    }
    await ticket?.settle('rep:' + pred.id)

    // Qwen returns the text as an array of token strings (or occasionally a string).
    const raw = Array.isArray(pred.output) ? pred.output.join('') : String(pred.output ?? '')
    const caption = cleanCaption(raw)
    if (!caption) {
      throw createError({ statusCode: 502, message: 'Caption generation returned empty text' })
    }

    return { caption }
  } catch (e) {
    // Any throw past the preflight means no output shipped — hand the
    // reservation back instead of letting it sit until holdSweep's TTL.
    // (Releasing an already-settled hold is an idempotent no-op.)
    await ticket?.release()
    throw e
  }
})
