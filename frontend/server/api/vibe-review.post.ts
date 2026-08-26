/**
 * The see-first loop's route: show the model the four pictures it just caused,
 * and let it fix or replace the bad ones before the user judges them.
 *
 * A SIBLING of /api/vibe rather than a mode of it, deliberately. That route's
 * request body is pinned byte-identical by a back-compat characterization test,
 * and its source text is scanned for the exact model id; folding a vision branch
 * with image payloads into it would put two request shapes and two schemas
 * behind one pinned contract, and would let this pass's failure modes (a
 * timeout, a 4xx on an image) reach the ask path. Here they cannot: the client
 * treats every failure as "no review happened".
 *
 * Model is hardcoded to Haiku for the same reason vibe.post.ts hardcodes it:
 * this tier has no thinking or latency knob, and passing one makes Haiku reject
 * the whole call. The aimodels source-scan spec checks this file for that knob's
 * name and fails if it appears ANYWHERE — which is why the name is not written
 * out here, in code or in prose. See that spec, and vibe.post.ts, for the full
 * story.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { assertRateLimit } from '../lib/rateLimit'
import { TAKE_REVIEW_SCHEMA, buildTakeReviewPrompt, parseTakeReview } from '~/lib/vibeReview'
import { MAX_PHRASE_CHARS, optionalApiKey, requireString, resolveAnthropicKey } from '../lib/agentRequest'
import { meterAssist } from '../utils/anthropicMeter'

/** Tile-resolution JPEG, a few KB each — but a hostile client should not be able
 *  to push megabytes through on our key. Five images at a generous ceiling. */
const MAX_IMAGE_CHARS = 400_000
const MAX_TAKES = 4

interface ReviewTake { label?: unknown, changes?: unknown, thumbnail?: unknown }

/** `data:image/jpeg;base64,…` (or bare base64) → the two parts Anthropic wants. */
function imageBlock(raw: string): { type: 'image', source: { type: 'base64', media_type: string, data: string } } {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(raw)
  return {
    type: 'image',
    source: { type: 'base64', media_type: m?.[1] ?? 'image/jpeg', data: m?.[2] ?? raw },
  }
}

/**
 * Pure request-body builder, exported for a plain-Node unit test — pins the
 * exact body Anthropic receives (model, schema, image ordering) without needing
 * h3 or fetch mocked, the same convention `buildVibeRequestBody` follows.
 */
export function buildTakeReviewRequestBody(prompt: string, images: string[]): Record<string, unknown> {
  return {
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    output_config: { format: { type: 'json_schema', schema: TAKE_REVIEW_SCHEMA } },
    messages: [{
      role: 'user',
      // Images FIRST, then the instruction that refers to them in order — the
      // prompt tells the model image 1 is "yours" and the rest follow the list.
      content: [...images.map(imageBlock), { type: 'text', text: prompt }],
    }],
  }
}

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'vibe-review', 60)
  const body = await readBody(event)
  const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(body?.apiKey))
  const phrase = requireString(body?.phrase, 'phrase', MAX_PHRASE_CHARS)

  const controls = body?.controls
  if (!Array.isArray(controls) || controls.length > 500) {
    throw createError({ statusCode: 400, statusMessage: 'controls (array, ≤500) is required' })
  }
  const rawTakes = body?.takes
  if (!Array.isArray(rawTakes) || !rawTakes.length || rawTakes.length > MAX_TAKES) {
    throw createError({ statusCode: 400, statusMessage: `takes (array of 1..${MAX_TAKES}) is required` })
  }
  const takes = (rawTakes as ReviewTake[]).map((t, i) => ({
    label: typeof t?.label === 'string' && t.label.trim() ? t.label : `take ${i + 1}`,
    changes: Array.isArray(t?.changes) ? (t.changes as { key: string, value: unknown }[]) : [],
    thumbnail: requireString(t?.thumbnail, `takes[${i}].thumbnail`, MAX_IMAGE_CHARS),
  }))
  const current = requireString(body?.current, 'current', MAX_IMAGE_CHARS)

  const prompt = buildTakeReviewPrompt(phrase, controls, takes)

  await meterAssist(event)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(buildTakeReviewRequestBody(prompt, [current, ...takes.map(t => t.thumbnail)])),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[vibe-review] Anthropic error:', res.status, errText)
      const errBody = (() => { try { return JSON.parse(errText) } catch { return {} } })()
      throw createError({ statusCode: res.status, message: errBody?.error?.message || `Anthropic API error: ${res.status}` })
    }
    const data: any = await res.json()
    const text = data?.content?.find((b: any) => b.type === 'text')?.text
    // No parse failure is fatal here: `parseTakeReview` turns anything it cannot
    // read into `keep`, which is the no-review outcome. A review must never be
    // able to cost the user the takes they already had.
    let parsed: unknown = null
    if (text) { try { parsed = JSON.parse(text) } catch { parsed = null } }
    return { reviews: parseTakeReview(parsed, takes.length) }
  }
  catch (err: any) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, message: err?.message || 'Failed to call Claude API' })
  }
})
