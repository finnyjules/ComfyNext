/**
 * POST /api/inpaint/lora-gen   Body: { name, prompt, aspectRatio?, loraScale?, guidanceScale? }
 *
 * Generate from a trained LoRA's PRIVATE Replicate model (the one baked at train
 * time), used by the frame modal's "Generate Object" Style mode when a style is
 * picked. Reads models/loras/<base>.json for replicate_model + trigger +
 * aesthetic, composes the prompt, runs the model, and returns the image as a
 * base64 data URL (CORS-safe) — same response shape as /api/inpaint/text2img.
 *
 * Under /api/inpaint → already allowlisted by NITRO_API_PREFIXES.
 * Helpers (runReplicate/firstOutputUrl/fetchAsDataUrl/requireReplicateToken and
 * buildLoraPrompt) are auto-imported from server/utils.
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'

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
}

export default defineEventHandler(async (event) => {
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

  const out = await runReplicate(modelRef, {
    prompt,
    aspect_ratio: body?.aspectRatio || '1:1',
    megapixels: '1',
    num_inference_steps: 22,
    guidance_scale: Number.isFinite(body?.guidanceScale) ? body!.guidanceScale : 3.5,
    num_outputs: 1,
    output_format: 'png',
    lora_scale: Number.isFinite(body?.loraScale) ? body!.loraScale : 1,
  }, token, { timeoutMs: 120_000 })

  const url = firstOutputUrl(out)
  if (!url) throw createError({ statusCode: 502, message: 'Replicate returned no image' })
  return { images: [await fetchAsDataUrl(url)], model: modelRef }
})
