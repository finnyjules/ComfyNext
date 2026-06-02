/**
 * POST /api/krea/rewrite
 *
 * Body: { name?: string, aesthetic?: string, keywords?: string[] }
 *
 * Turns an imported Krea moodboard into an ORIGINAL derivative: a fresh style
 * name and a reworded aesthetic that keep the same aesthetic direction but
 * are not a copy. Cheap text LLM (meta/meta-llama-3-8b-instruct, ~$0.0001,
 * <1s). Non-fatal: returns nulls on failure so the caller falls back to the
 * originals.
 *
 * Allowlisted in server/middleware/comfyui-proxy.ts via '/api/krea'.
 */

const MODEL = 'meta/meta-llama-3-8b-instruct'

const INSTRUCTIONS = [
  'You paraphrase a moodboard style profile to give it original wording while staying FAITHFUL to the reference.',
  'Given the reference below, produce:',
  '1. a new style NAME (2-4 words) — different words from the reference name but evoking the SAME aesthetic.',
  '2. a reworded aesthetic paragraph (~55 words) that PRESERVES the reference\'s specific visual elements:',
  '   the same techniques, era/art-movement references, color treatment, textures, grain, and composition.',
  'Reword closely (paraphrase) — do NOT reinterpret. Keep every concrete visual descriptor from the reference,',
  'just in fresh phrasing. Do NOT add themes, concepts, moods, or references that are not in the original.',
  'Respond with ONLY valid JSON, no preamble or markdown: {"name":"...","aesthetic":"..."}',
].join('\n')

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const token = (config as any).replicateToken
  if (!token) throw createError({ statusCode: 500, message: 'Replicate token not configured.' })

  const body = await readBody(event) as { name?: string, aesthetic?: string, keywords?: string[] }
  const name = (body?.name ?? '').trim()
  const aesthetic = (body?.aesthetic ?? '').trim()
  if (!name && !aesthetic) {
    throw createError({ statusCode: 400, message: 'Nothing to rewrite — name and aesthetic are both empty.' })
  }
  const keywords = Array.isArray(body?.keywords) ? body!.keywords!.join(', ') : ''

  const prompt = `${INSTRUCTIONS}\n\nReference name: ${name}\nReference aesthetic: ${aesthetic}\nReference keywords: ${keywords}`

  const headers = { Authorization: `Token ${token}`, 'Content-Type': 'application/json', Prefer: 'wait' }
  const createRes = await fetch(`https://api.replicate.com/v1/models/${MODEL}/predictions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input: { prompt, max_tokens: 400, temperature: 0.5 } }),
  })
  if (!createRes.ok) {
    throw createError({ statusCode: createRes.status, message: `Rewrite model error: ${await createRes.text().catch(() => createRes.statusText)}` })
  }
  let pred = await createRes.json() as { id: string, status: string, output?: unknown }

  // Prefer: wait usually returns terminal, but poll briefly just in case.
  const deadline = Date.now() + 30_000
  while (pred.status !== 'succeeded' && pred.status !== 'failed' && pred.status !== 'canceled') {
    if (Date.now() > deadline) break
    await new Promise((r) => setTimeout(r, 1000))
    const p = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, { headers: { Authorization: `Token ${token}` } })
    if (p.ok) pred = await p.json()
  }
  if (pred.status !== 'succeeded') {
    return { name: null, aesthetic: null } // non-fatal
  }

  const text = Array.isArray(pred.output) ? pred.output.join('') : String(pred.output ?? '')
  const m = text.match(/\{[\s\S]*\}/)
  let parsed: any = {}
  if (m) { try { parsed = JSON.parse(m[0]) } catch { /* leave empty */ } }

  const newName = typeof parsed.name === 'string' ? parsed.name.trim().replace(/^["']|["']$/g, '') : ''
  const newProfile = typeof parsed.aesthetic === 'string' ? parsed.aesthetic.trim() : ''

  return {
    name: newName || null,
    aesthetic: newProfile || null,
  }
})
