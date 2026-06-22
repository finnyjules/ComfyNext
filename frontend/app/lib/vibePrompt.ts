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

/** Build the user prompt: the effect, its AI-editable controls (with ranges,
 *  options, hints, and current values), and the user's phrase. */
export function buildVibePrompt(described: DescribedControl[], phrase: string, effectLabel: string): string {
  const lines = described.map((c) => {
    const range = c.kind === 'slider' ? ` range ${c.min}..${c.max} step ${c.step}` : ''
    const opts = c.kind === 'select' ? ` options [${c.options!.join(', ')}]` : ''
    const hint = c.hint ? ` — ${c.hint}` : ''
    return `- ${c.path} ("${c.label}", ${c.kind})${range}${opts}; current ${JSON.stringify(c.current)}${hint}`
  }).join('\n')

  return `You are a visual-design copilot for a typography effect called "${effectLabel}".
The user describes a vibe and you propose parameter changes that achieve it.

CONTROLS YOU MAY CHANGE (you may ONLY use these keys):
${lines}

USER REQUEST: "${phrase}"

Rules:
- Return only the controls that should change to achieve the request — leave everything else alone.
- Slider values must be numbers within the stated range. Select values must be one of the listed options. Color values must be 6-digit hex like "#RRGGBB".
- Do not invent keys. Do not change the text content.
- "rationale" is one short sentence the user will read.`
}
