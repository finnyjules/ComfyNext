/**
 * POST /api/cloud-train/aesthetic
 *
 * Body: { imageDataUrl: string }   // a downscaled JPEG/PNG data URI — ideally a
 *                                   // montage of a few representative training
 *                                   // images so the model reads the SET's style.
 *
 * Runs a vision model (Qwen2-VL) to produce a reusable "aesthetic": a short
 * aesthetic description of the dataset's look — grain, lighting, palette, mood,
 * texture, composition. The training UI generates this once at train time and
 * threads it into /status, which writes it to the LoRA sidecar. The LoRA panel
 * then prepends it to the prompt alongside the trigger word, which markedly
 * improves how closely generations match the trained look (the trigger word is
 * a sparse signal; the profile densely conditions the base model toward the
 * same region the LoRA reinforces).
 *
 * One-time, cheap (~$0.002, a few seconds). Failure is non-fatal upstream — the
 * trainer just skips the profile and falls back to the trigger word alone.
 *
 * Must be allowlisted in server/middleware/comfyui-proxy.ts (NITRO_API_PATHS).
 */

import { parseAestheticOutput } from './aesthetic-parse'

const QWEN_MODEL = 'lucataco/qwen2-vl-7b-instruct'

const PROFILE_PROMPT = [
  'You are an art director writing a reusable STYLE / aesthetic for an image set.',
  'Describe ONLY the shared visual aesthetic: film grain, lighting, color palette,',
  'contrast, mood, texture, focus/blur, and composition treatment.',
  'Do NOT name or describe the specific subjects, people, animals, or objects —',
  'only the visual style and treatment, as if writing reusable gallery wall text.',
  'First write 2–4 sentences, about 60 words, as one flowing evocative paragraph.',
  'Then, on a new line, write "Keywords:" followed by 6–10 short style descriptors',
  '(palette, texture, lighting, and mood terms — never subjects), comma-separated.',
].join(' ')

export default defineEventHandler(async (event) => {
  const token = requireReplicateToken()

  const body = await readBody(event) as { imageDataUrl?: string }
  const imageDataUrl = body?.imageDataUrl
  if (!imageDataUrl || !/^data:image\//.test(imageDataUrl)) {
    throw createError({ statusCode: 400, message: 'imageDataUrl (a data: image URI) is required' })
  }

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

  // Create the prediction.
  const createRes = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version,
      input: { media: imageDataUrl, prompt: PROFILE_PROMPT, max_new_tokens: 220 },
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
      throw createError({ statusCode: 504, message: 'Aesthetic generation timed out' })
    }
    await new Promise((r) => setTimeout(r, 1500))
    const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
      headers: { Authorization: `Token ${token}` },
    })
    if (!pollRes.ok) continue
    pred = await pollRes.json()
  }

  if (pred.status !== 'succeeded') {
    throw createError({ statusCode: 502, message: `Aesthetic generation ${pred.status}: ${String(pred.error ?? '')}` })
  }

  // Qwen returns the text as an array of token strings (or occasionally a string).
  const raw = Array.isArray(pred.output) ? pred.output.join('') : String(pred.output ?? '')
  const { aesthetic, keywords } = parseAestheticOutput(raw)
  if (!aesthetic) {
    throw createError({ statusCode: 502, message: 'Aesthetic generation returned empty text' })
  }

  return { aesthetic, keywords }
})
