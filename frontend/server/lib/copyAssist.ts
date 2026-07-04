// Prompt + schema builders for the Copy assistant (/api/copy-assist).
// Pure, unit-tested; the route (copy-assist.post.ts) mirrors vibe.post.ts's
// raw-fetch/structured-output pattern and calls into these builders.

export type CopyAssistMode = 'variations' | 'brief' | 'translate'

export interface CopyAssistContext {
  brandTone?: string
  otherTexts?: string[]
}

export interface CopyAssistRequest {
  apiKey: string
  mode: CopyAssistMode
  text: string
  brief?: string
  languages?: string[]
  count?: number
  context?: CopyAssistContext
}

const MIN_COUNT = 1
const MAX_COUNT = 8
const DEFAULT_COUNT = 5

/** Default 5, clamp 1-8; translate mode: languages.length wins (still clamped). */
export function clampCount(req: CopyAssistRequest): number {
  if (req.mode === 'translate' && Array.isArray(req.languages) && req.languages.length > 0) {
    return Math.min(MAX_COUNT, Math.max(MIN_COUNT, req.languages.length))
  }
  const raw = typeof req.count === 'number' && Number.isFinite(req.count) ? req.count : DEFAULT_COUNT
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(raw)))
}

const ALWAYS_RULES = [
  'Each option should be approximately the same length as the original (±20%) — this is ad-copy for a fixed layout slot, not free-form writing.',
  'Write in an ad-copy register: punchy, confident, no filler.',
  'Return only the copy text itself — no surrounding quotes, no numbering, no labels like "Option 1:".',
].join('\n')

function contextLines(context?: CopyAssistContext): string {
  if (!context) return ''
  const lines: string[] = []
  if (context.brandTone) lines.push(`Brand tone: ${context.brandTone}`)
  if (context.otherTexts && context.otherTexts.length > 0) {
    lines.push(`Other copy already on this layout (match its voice for campaign coherence):\n${context.otherTexts.map(t => `- ${t}`).join('\n')}`)
  }
  return lines.length ? `\n${lines.join('\n')}\n` : ''
}

export function buildCopyAssistPrompt(req: CopyAssistRequest): string {
  const count = clampCount(req)

  if (req.mode === 'brief') {
    const brief = req.brief || ''
    return `You are a copywriter generating ad copy for a design layout slot.

Brief: "${brief}"
${contextLines(req.context)}
Write ${count} distinct copy options for this slot based on the brief.

Rules:
${ALWAYS_RULES}
- Vary the angle/hook across options while staying true to the brief.`
  }

  if (req.mode === 'translate') {
    const languages = req.languages && req.languages.length > 0 ? req.languages : []
    return `You are a marketing localization expert adapting ad copy for different markets.

Original copy: "${req.text}"

Produce one localized option for EACH of these languages: ${languages.join(', ')}.
This is marketing localization, not literal translation — adapt idioms, tone, and hooks so the copy feels native and persuasive in each target market, while preserving the original's intent and call to action.

Rules:
${ALWAYS_RULES}
- Produce exactly one option per language, tagged with its language code.
- Do not literally translate word-for-word; localize for impact.`
  }

  // variations (default)
  return `You are a copywriter generating ad copy variations for a design layout slot.

Original copy: "${req.text}"
${contextLines(req.context)}
Write ${count} variations of this copy.

Rules:
${ALWAYS_RULES}
- Preserve the original's intent and tone, but vary the hook/angle across options.`
}

/** Structured-output JSON schema. `language` is required per-option only in
 *  translate mode (strict json_schema forbids conditional required, so we
 *  branch the schema itself rather than using oneOf/if-then). */
export function copyAssistSchema(mode: CopyAssistMode): object {
  const isTranslate = mode === 'translate'
  return {
    type: 'object',
    properties: {
      options: {
        type: 'array',
        description: isTranslate
          ? 'One localized option per requested language.'
          : 'The generated copy options.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The copy option text, no quotes or numbering' },
            language: { type: 'string', description: 'Language code/name this option is localized for' },
          },
          required: isTranslate ? ['text', 'language'] : ['text'],
          additionalProperties: false,
        },
      },
    },
    required: ['options'],
    additionalProperties: false,
  }
}
