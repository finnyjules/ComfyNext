import type { DescribedControl } from '~/lib/spacetype/controlDescriptor'

/** Structured-output schema. Patch is a fixed-shape array (not a dynamic-key
 *  object) because strict json_schema forbids open objects. */
export const VIBE_SCHEMA = {
  type: 'object',
  properties: {
    changes: {
      type: 'array',
      description: 'Only the controls you want to change. Empty if nothing fits.',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Exact control key from the list' },
          value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
        },
        required: ['key', 'value'],
        additionalProperties: false,
      },
    },
    rationale: { type: 'string', description: 'One short sentence explaining the changes' },
  },
  required: ['changes', 'rationale'],
  additionalProperties: false,
}

/** Structured-output schema for a multi-take call: `variants` (2–4) genuinely
 *  different readings instead of one guess. Same fixed-shape `changes` array
 *  per take (strict json_schema forbids open objects, same reason as above).
 *  The server validates count/shape on the way back in (`parseTakesResponse`)
 *  — this schema is the model-facing half of that contract, not the only
 *  enforcement of it. Value clamping is NOT done here or there: it stays
 *  validatePatch's job client-side, same as the single-patch path today. */
export const TAKES_SCHEMA = {
  type: 'object',
  properties: {
    takes: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      description: 'Genuinely different readings of the request, each differing from the others on a named dimension — not numeric jitter of one idea.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'A short angle name, ≤24 characters (e.g. "warmer", "high contrast") — not a description or a sentence. Use "closest: <look>" only for the take standing in for an out-of-vocabulary request.' },
          changes: {
            type: 'array',
            description: 'Only the controls this take changes. Empty if this take is the current config itself.',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', description: 'Exact control key from the list' },
                value: { anyOf: [{ type: 'string' }, { type: 'number' }] },
              },
              required: ['key', 'value'],
              additionalProperties: false,
            },
          },
          rationale: { type: 'string', description: 'One short sentence explaining this take' },
        },
        required: ['label', 'changes', 'rationale'],
        additionalProperties: false,
      },
    },
  },
  required: ['takes'],
  additionalProperties: false,
}

export interface VibeChange { key: string, value: string | number }
export interface VibeTake { label: string, changes: VibeChange[], rationale: string }

/**
 * The marker on the 400 this route raises for ITS OWN `variants` field
 * validation — and on nothing else.
 *
 * It matters because `/api/vibe` forwards Anthropic's HTTP status verbatim, so
 * a 400 coming back from a takes ask is ambiguous: "this server won't do takes"
 * and "the model call was itself a bad request" look identical. Only the first
 * may be quietly re-asked the single-patch way; the second is a real bug and
 * must surface, not be paid for twice (each call is metered).
 *
 * Shared by both ends on purpose: one string, no drift.
 */
export const VARIANTS_UNSUPPORTED = 'variants_unsupported'

/** Server-side count/shape guard for a takes response — belt-and-suspenders
 *  alongside TAKES_SCHEMA's own minItems/maxItems/label-is-just-a-string
 *  declaration, since a model can still return prose that merely parses as
 *  JSON. Returns null (never throws) on anything malformed; the route turns
 *  that into its existing 502. Does NOT clamp or validate control keys/values
 *  — that stays validatePatch's job on the client, exactly as it is today for
 *  the single-patch path. */
export function parseTakesResponse(raw: unknown): VibeTake[] | null {
  if (!raw || typeof raw !== 'object') return null
  const takes = (raw as any).takes
  if (!Array.isArray(takes) || takes.length < 2 || takes.length > 4) return null
  const out: VibeTake[] = []
  for (const t of takes) {
    if (!t || typeof t !== 'object') return null
    const { label, changes, rationale } = t as any
    if (typeof label !== 'string' || !label.length || label.length > 24) return null
    if (typeof rationale !== 'string') return null
    if (!Array.isArray(changes)) return null
    const cleanChanges: VibeChange[] = []
    for (const c of changes) {
      if (!c || typeof c !== 'object' || typeof c.key !== 'string') return null
      if (typeof c.value !== 'string' && typeof c.value !== 'number') return null
      cleanChanges.push({ key: c.key, value: c.value })
    }
    out.push({ label, changes: cleanChanges, rationale })
  }
  return out
}

/** Multi-take instruction block, appended to the base prompt only when
 *  `variants` is requested — studio-agnostic (no studio-specific vocabulary),
 *  so it's shared verbatim by all five vibe studios. Names the honesty
 *  convention Texture's command-surface guidance already spells out
 *  (APPROXIMATION_HONESTY_GUIDANCE in lib/agent/studioTune.ts — approximate,
 *  then say so) rather than duplicating its full clause text here. */
function buildTakesBlock(variants: number): string {
  return `MULTIPLE TAKES (${variants}): propose ${variants} genuinely different readings of the request, not ${variants} nudges of one idea — each take must differ from the OTHERS on a named dimension (e.g. warmer vs cooler, tighter vs looser, bolder vs quieter), never numeric jitter of the same idea restated. Give each take a short angle-name label, ≤24 characters (e.g. "warmer", "high contrast") — a name, not a sentence. If the request names a look these controls can't fully reach, follow this agent's honesty convention: label the closest take "closest: <the requested look>", say in its rationale that it only approximates the request, and keep the remaining takes genuinely distinct from each other and from it.`
}

/** Build the user prompt: the effect, its AI-editable controls (with ranges,
 *  options, hints, and current values), and the user's phrase. `variants`
 *  (2–4) appends the multi-take instruction block; omitted, the prompt is
 *  byte-identical to the single-patch prompt this always was. */
export function buildVibePrompt(described: DescribedControl[], phrase: string, effectLabel: string, guidance?: string, variants?: number): string {
  const lines = described.map((c) => {
    const range = c.kind === 'slider' ? ` range ${c.min}..${c.max} step ${c.step}` : ''
    const opts = c.kind === 'select' ? ` options [${c.options!.join(', ')}]` : ''
    const hint = c.hint ? ` — ${c.hint}` : ''
    return `- ${c.path} ("${c.label}", ${c.kind})${range}${opts}; current ${JSON.stringify(c.current)}${hint}`
  }).join('\n')

  const guide = guidance ? `\n${guidance}\n` : ''

  const base = `You are a visual-design copilot for a visual effect called "${effectLabel}".
The user describes a vibe and you propose parameter changes that achieve it.
${guide}
CONTROLS YOU MAY CHANGE (you may ONLY use these keys):
${lines}

USER REQUEST: "${phrase}"

Rules:
- Return only the controls that should change to achieve the request — leave everything else alone.
- Slider values must be numbers within the stated range. Select values must be one of the listed options. Color values must be 6-digit hex like "#RRGGBB".
- Do not invent keys — only use keys from the list above.
- "rationale" is one short sentence the user will read.`

  if (!variants) return base

  return `${base}

${buildTakesBlock(variants)}`
}
