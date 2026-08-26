/**
 * The recipe call: the model composes readings of the ask from menus we wrote,
 * and never touches a control key.
 *
 * Text only — the pictures do not exist yet at this point in the flow; our code
 * builds and renders every recipe, and a second, seeing call picks between them.
 *
 * Model hardcoded to Haiku for the reason vibe.post.ts documents: this tier has
 * no thinking or latency knob, and passing one makes it reject the whole call.
 * The aimodels source-scan spec checks this file for that knob's name and fails
 * if it appears anywhere, in code or in prose.
 */
import { createError, defineEventHandler, readBody } from 'h3'
import { assertRateLimit } from '../lib/rateLimit'
import { RECIPES_SCHEMA, buildRecipesPrompt, salvageRecipes } from '~/lib/gradientfx/recipes'
import { MAX_PHRASE_CHARS, optionalApiKey, requireString, resolveAnthropicKey } from '../lib/agentRequest'
import { meterAssist } from '../utils/anthropicMeter'

export function buildRecipesRequestBody(prompt: string): Record<string, unknown> {
  return {
    model: 'claude-haiku-4-5',
    max_tokens: 2048,
    output_config: { format: { type: 'json_schema', schema: RECIPES_SCHEMA } },
    messages: [{ role: 'user', content: prompt }],
  }
}

export default defineEventHandler(async (event) => {
  assertRateLimit(event, 'vibe-recipes', 60)
  const body = await readBody(event)
  const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(body?.apiKey))
  const phrase = requireString(body?.phrase, 'phrase', MAX_PHRASE_CHARS)
  const yours = body?.yours
  if (!yours || typeof yours !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'yours (object) is required' })
  }

  const prompt = buildRecipesPrompt(phrase, {
    base: typeof yours.base === 'string' ? yours.base : 'unknown',
    palette: Array.isArray(yours.palette) ? yours.palette.filter((c: unknown) => typeof c === 'string') : [],
  })

  await meterAssist(event)

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(buildRecipesRequestBody(prompt)),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[vibe-recipes] Anthropic error:', res.status, errText)
      const errBody = (() => { try { return JSON.parse(errText) } catch { return {} } })()
      throw createError({ statusCode: res.status, message: errBody?.error?.message || `Anthropic API error: ${res.status}` })
    }
    const data: any = await res.json()
    const text = data?.content?.find((b: any) => b.type === 'text')?.text
    let parsed: unknown = null
    if (text) { try { parsed = JSON.parse(text) } catch { parsed = null } }
    const recipes = salvageRecipes(parsed)
    if (!recipes.length) {
      // Name it in the SERVER log, like the raw-text logging on the error path
      // above: a parse-level rejection is just as fatal to the flow as a 4xx,
      // and the dev terminal should say which one happened without anyone
      // having to ask for a browser console.
      console.error('[vibe-recipes] no usable recipes in reply:', String(text ?? '').slice(0, 500))
    }
    // Nothing usable is a real failure here — unlike the review pass, there is no
    // "leave it as it was" to fall back to inside this route. The CLIENT degrades
    // to the old blind-generation path on any error, which is the honest place
    // for that decision.
    if (!recipes.length) throw createError({ statusCode: 502, message: 'No usable recipes came back' })
    return { recipes }
  }
  catch (err: any) {
    if (err.statusCode) throw err
    throw createError({ statusCode: 500, message: err?.message || 'Failed to call Claude API' })
  }
})
