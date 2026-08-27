/**
 * The eye-pick: every candidate we built and rendered goes to the model as a
 * picture, and it chooses the best four.
 *
 * Shares the image-block shape and the metering posture of vibe-review — it is
 * the same kind of call (Haiku, vision, strict schema, salvaged not refused) —
 * but a separate route because it is a different question with a different
 * schema, and because keeping one question per route is what has kept vibe's own
 * contract stable through this whole feature.
 *
 * Model hardcoded to Haiku, and the source-scan spec checks this file for the
 * latency knob's name and fails if it appears anywhere, in code or in prose.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { assertRateLimit } from '../lib/rateLimit'
import { EYE_PICK_SCHEMA, buildEyePickPrompt, salvageEyePicks } from '~/lib/gradientfx/eyePick'
import { MAX_PHRASE_CHARS, optionalApiKey, requireString, resolveAnthropicKey } from '../lib/agentRequest'
import { meterAssist } from '../utils/anthropicMeter'

const MAX_IMAGE_CHARS = 400_000
const MAX_CANDIDATES = 12

function imageBlock(raw: string): { type: 'image', source: { type: 'base64', media_type: string, data: string } } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(raw)
  return { type: 'image', source: { type: 'base64', media_type: m?.[1] ?? 'image/jpeg', data: m?.[2] ?? raw } }
}

export function buildEyePickRequestBody(prompt: string, images: string[]): Record<string, unknown> {
  return {
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    output_config: { format: { type: 'json_schema', schema: EYE_PICK_SCHEMA } },
    messages: [{
      role: 'user',
      content: [...images.map(imageBlock), { type: 'text', text: prompt }],
    }],
  }
}

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'vibe-pick', 60)
  const body = await readBody(event)
  const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(body?.apiKey))
  const phrase = requireString(body?.phrase, 'phrase', MAX_PHRASE_CHARS)
  const raw = body?.candidates
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_CANDIDATES) {
    throw createError({ statusCode: 400, statusMessage: `candidates (array of 1..${MAX_CANDIDATES}) is required` })
  }
  const candidates = raw.map((c: any, i: number) => ({
    name: typeof c?.name === 'string' && c.name.trim() ? c.name : `candidate ${i + 1}`,
    thumbnail: requireString(c?.thumbnail, `candidates[${i}].thumbnail`, MAX_IMAGE_CHARS),
  }))
  const current = requireString(body?.current, 'current', MAX_IMAGE_CHARS)

  // No names reach the model — only the count. The candidate `name` fields are
  // still accepted on the wire (the client's fallback label uses the recipe
  // name), but they are deliberately kept OUT of the vision prompt so the model
  // describes what it sees rather than echoing a name that may not match.
  const prompt = buildEyePickPrompt(phrase, candidates.length)

  await meterAssist(event)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(buildEyePickRequestBody(prompt, [current, ...candidates.map(c => c.thumbnail)])),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[vibe-pick] Anthropic error:', res.status, errText)
      const errBody = (() => { try { return JSON.parse(errText) } catch { return {} } })()
      throw createError({ statusCode: res.status, message: errBody?.error?.message || `Anthropic API error: ${res.status}` })
    }
    const data: any = await res.json()
    const text = data?.content?.find((b: any) => b.type === 'text')?.text
    let parsed: unknown = null
    if (text) { try { parsed = JSON.parse(text) } catch { parsed = null } }
    // Salvaged, not refused: fewer than four survivors is normal and the client
    // fills the rest from its own distinctness ranking, which is deterministic
    // and ours. An empty list is a legitimate answer here — it means "we could
    // not read any of that", and the client knows what to do about it.
    const picks = salvageEyePicks(parsed, candidates.length)
    if (!picks.length) {
      // Not fatal here — the client fills every slot from its own ranking — but
      // still worth naming, because "the eye-pick never works" is otherwise
      // indistinguishable from "the eye-pick was never called".
      console.error('[vibe-pick] no usable picks in reply:', String(text ?? '').slice(0, 500))
    }
    return { picks }
  }
  catch (err: any) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, message: err?.message || 'Failed to call Claude API' })
  }
})
