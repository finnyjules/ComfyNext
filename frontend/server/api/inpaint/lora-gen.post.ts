/**
 * POST /api/inpaint/lora-gen   Body: { name, prompt, aspectRatio?, loraScale?, guidanceScale?, seed? }
 *
 * Generate from a trained LoRA's PRIVATE Replicate model (the one baked at train
 * time), used by the frame modal's "Generate Object" Style mode when a style is
 * picked. Reads models/loras/<base>.json for replicate_model + trigger +
 * aesthetic, composes the prompt, runs the model, and returns the image as a
 * base64 data URL (CORS-safe) — same response shape as /api/inpaint/text2img.
 *
 * Under /api/inpaint → already allowlisted by NITRO_API_PREFIXES.
 * Helpers (runReplicate/firstOutputUrl/fetchAsDataUrl/requireReplicateToken,
 * buildLoraPrompt, and buildLoraGenInput) are auto-imported from server/utils.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { assertRateLimit } from '../../lib/rateLimit'

function safeBase(name: string): string | null {
  const base = (name || '').replace(/\.safetensors$/i, '')
  return /^[a-zA-Z0-9_-]+$/.test(base) ? base : null
}

interface Body {
  name?: string
  prompt?: string
  aspectRatio?: string
  loraScale?: number
  guidanceScale?: number
  seed?: number
}

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'inpaint-lora-gen', 30)
  const token = requireReplicateToken()
  const body = await readBody<Body>(event)

  const base = safeBase(String(body?.name ?? ''))
  if (!base) throw createError({ statusCode: 400, message: 'Invalid LoRA name' })
  const userPrompt = (body?.prompt ?? '').trim()
  if (!userPrompt) throw createError({ statusCode: 400, message: 'prompt is required' })

  const lorasDir = path.resolve(process.cwd(), '..', 'models', 'loras')
  let meta: any = {}
  try {
    meta = JSON.parse(await fs.readFile(path.join(lorasDir, `${base}.json`), 'utf8'))
  } catch {
    throw createError({ statusCode: 404, message: 'No sidecar for that LoRA.' })
  }
  const modelRef = String(meta.replicate_model ?? '').split(':')[0] // <owner>/<model>
  if (!modelRef) throw createError({ statusCode: 400, message: 'This LoRA has no trained Replicate model to run.' })

  const prompt = buildLoraPrompt(
    String(meta.trigger ?? ''),
    promptAesthetic(meta),
    userPrompt,
  )

  const out = await runReplicate(modelRef, buildLoraGenInput({
    prompt,
    aspectRatio: body?.aspectRatio,
    loraScale: body?.loraScale,
    guidanceScale: body?.guidanceScale,
    seed: body?.seed,
  }), token, { timeoutMs: 120_000 })

  const url = firstOutputUrl(out)
  if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })
  return { images: [await fetchAsDataUrl(url)], model: modelRef }
})
