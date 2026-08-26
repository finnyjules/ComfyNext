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
 *
 *  The 2–4 count is NOT expressed as `minItems`/`maxItems` on `takes` — the
 *  structured-outputs API rejects `maxItems` outright and only accepts
 *  `minItems` values of 0 or 1
 *  (https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 *  — "Not supported" / "Restricted" JSON-schema keywords). The count lives in
 *  the array's `description` instead (the docs' own recommended pattern) and
 *  is enforced server-side on the way back in by `parseTakesResponse` — this
 *  schema is the model-facing half of that contract, not the only
 *  enforcement of it. Value clamping is NOT done here or there: it stays
 *  validatePatch's job client-side, same as the single-patch path today.
 *  See UNSUPPORTED_STRUCTURED_OUTPUT_KEYWORDS in
 *  tests/unit/structured-output-schema.unit.spec.ts for the guard that keeps
 *  this schema (and VIBE_SCHEMA) from regressing. */
export const TAKES_SCHEMA = {
  type: 'object',
  properties: {
    takes: {
      type: 'array',
      description: 'Return 2 to 4 genuinely different readings of the request, each differing from the others on a named dimension — not numeric jitter of one idea.',
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
          promise: {
            type: 'object',
            description: 'OPTIONAL, and only what a still picture can show. Two or three checkable claims about how this take will LOOK once rendered; omit the whole object, or any field, when unsure. Never a claim about motion, texture or mood.',
            properties: {
              colors: {
                type: 'array',
                description: 'The 1 to 3 colours that will dominate the picture, as common words: red, orange, yellow, green, teal, cyan, blue, purple, magenta, pink, white, black, grey.',
                items: { type: 'string' },
              },
              direction: {
                type: 'string',
                description: 'How the picture reads: "vertical" (top to bottom), "horizontal" (side to side), "radial" (out from the centre), or "none" (no dominant direction).',
                enum: ['vertical', 'horizontal', 'radial', 'none'],
              },
              tone: { type: 'string', description: 'Whether the picture is overall dark or light.', enum: ['dark', 'light'] },
            },
            required: [],
            additionalProperties: false,
          },
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

/** The directions a checker can measure off a still frame. */
export const PROMISE_DIRECTIONS = ['vertical', 'horizontal', 'radial', 'none'] as const
export type PromiseDirection = typeof PROMISE_DIRECTIONS[number]
export const PROMISE_TONES = ['dark', 'light'] as const
export type PromiseTone = typeof PROMISE_TONES[number]
/** Colour words the hue-bucket checker can name. Shared with the checker so the
 *  schema's prose and the measurement can never drift apart. */
export const PROMISE_COLORS = [
  'red', 'orange', 'yellow', 'green', 'teal', 'cyan', 'blue', 'purple', 'magenta', 'pink',
  'white', 'black', 'grey',
] as const
export type PromiseColor = typeof PROMISE_COLORS[number]

/**
 * What a take CLAIMS its picture will look like — checkable against the real
 * thumbnail, unlike the prose rationale beside it. Every field optional: the
 * model is told to omit a claim rather than guess one, because an unchecked
 * claim is worth more than a wrong one.
 */
export interface TakePromise {
  colors?: string[]
  direction?: PromiseDirection
  tone?: PromiseTone
}

export interface VibeTake { label: string, changes: VibeChange[], rationale: string, promise?: TakePromise }

/** The most colour claims a promise may carry — more than three "dominant"
 *  colours is not a claim about dominance any more. */
const MAX_PROMISE_COLORS = 3

/**
 * Salvage a promise the same way the rest of this function salvages a take:
 * keep every claim that is well-formed, drop the ones that are not, and return
 * `undefined` when nothing usable is left.
 *
 * The asymmetry is deliberate and load-bearing: a bad promise must never cost
 * the take. A take is a real proposal the user can look at and keep; the promise
 * is only our means of checking it. Dropping the take because its self-report
 * was malformed would throw away the thing of value to protect the audit of it.
 */
function salvagePromise(raw: unknown): TakePromise | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { colors, direction, tone } = raw as Record<string, unknown>
  const out: TakePromise = {}
  if (Array.isArray(colors)) {
    const clean = colors.filter((c): c is string => typeof c === 'string' && !!c.trim())
      .map(c => c.trim().toLowerCase())
      .slice(0, MAX_PROMISE_COLORS)
    if (clean.length) out.colors = clean
  }
  if (typeof direction === 'string' && (PROMISE_DIRECTIONS as readonly string[]).includes(direction)) {
    out.direction = direction as PromiseDirection
  }
  if (typeof tone === 'string' && (PROMISE_TONES as readonly string[]).includes(tone)) {
    out.tone = tone as PromiseTone
  }
  return Object.keys(out).length ? out : undefined
}

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

/** Marks the 502 /api/vibe raises when a takes response could not be
 *  salvaged into anything usable at all (see `parseTakesResponse`) — distinct
 *  from the generic single-tune "Malformed response from Claude" 502, so the
 *  network tab (and a future client branch) can tell "the model drifted but a
 *  real take, or a single-patch degrade, still came out of it" from "there
 *  was truly nothing here". */
export const TAKES_UNSALVAGEABLE = 'takes_unsalvageable'

const MAX_LABEL_CHARS = 24

/** Truncates an over-length label to MAX_LABEL_CHARS, ending "…". Splits on
 *  CODE POINTS (`[...label]`), not UTF-16 code units (`label.slice`) — an
 *  emoji or other astral character sitting right at the cut is two code
 *  units wide, and a plain `.slice` can land between them, leaving a lone
 *  unpaired surrogate in the label the client renders. */
function truncateLabel(label: string): string {
  const codepoints = [...label]
  return codepoints.length > MAX_LABEL_CHARS ? `${codepoints.slice(0, MAX_LABEL_CHARS - 1).join('')}…` : label
}

/** An unusable label (empty, whitespace, or never a string) is rebuilt from
 *  the take's OWN rationale — its first few words, so the label still reads
 *  as an angle rather than a placeholder — never from anything invented.
 *  Falls back to "take N" (1-based position among the takes considered) only
 *  when the rationale has nothing usable either. */
function synthesizeLabel(rationale: string, index: number): string {
  const words = rationale.trim().split(/\s+/).filter(Boolean).slice(0, 3).join(' ')
  return truncateLabel(words || `take ${index + 1}`)
}

export interface TakesSalvage {
  /** 0, 1, or 2–4 salvaged takes. The route decides the response shape from
   *  this count: 0 → a legitimate 502 (`reason` explains why); 1 → today's
   *  single-patch shape, which the client's existing degrade path already
   *  renders; 2–4 → the takes response shape. */
  takes: VibeTake[]
  /** Set only when `takes` is empty — why nothing survived, for the 502 body
   *  and the server console. */
  reason?: string
}

/**
 * Server-side salvage of a takes response — tolerant on purpose. TAKES_SCHEMA
 * cannot enforce the 2–4 count or the 24-char label bound on the wire
 * (structured outputs rejects `maxItems`/`maxLength`; see the comment on
 * TAKES_SCHEMA above), so a reply that drifts from the ask — five takes, an
 * empty label, one bad change entry mixed into an otherwise-good take — is
 * ROUTINE, not corruption. Refusing the whole response over one bad field
 * turned a cosmetic slip into a hard 502 for every live call; this salvages
 * what it can and only gives up (empty `takes`) when nothing in the reply was
 * usable:
 *
 * - More than 4 takes: the first 4 are considered, the rest dropped.
 * - A label over 24 chars: truncated to 24 with a trailing "…".
 * - A label that is empty, whitespace, or not a string: synthesized from the
 *   take's own rationale (see `synthesizeLabel` — never invents new words).
 * - A malformed `changes` ENTRY (missing key/value, wrong type): that entry
 *   is dropped, not the whole take. Every surviving entry's key/value pass
 *   through UNTOUCHED — salvage never invents or edits a change.
 * - A take whose `changes` FIELD itself isn't an array at all (not just one
 *   bad entry in it) can't be salvaged and is dropped outright.
 * - A take left with zero changes after entry-dropping is noise UNLESS at
 *   least one other take (among those considered) has real changes — then it
 *   rides along as a harmless "no change" option; if every take considered
 *   ends up empty, none of them are worth keeping.
 *
 * Never clamps or range-checks a value — that stays validatePatch's job on
 * the client, exactly as it is for the single-patch path today.
 */
export function parseTakesResponse(raw: unknown): TakesSalvage {
  if (!raw || typeof raw !== 'object') return { takes: [], reason: 'response body is not an object' }
  const rawTakes = (raw as any).takes
  if (!Array.isArray(rawTakes) || !rawTakes.length) return { takes: [], reason: '"takes" is missing, not an array, or empty' }

  const considered = rawTakes.slice(0, 4)
  const candidates: VibeTake[] = []
  considered.forEach((t: unknown, i: number) => {
    if (!t || typeof t !== 'object') return
    const { label: rawLabel, changes: rawChanges, rationale: rawRationale } = t as any
    if (!Array.isArray(rawChanges)) return // the field itself is broken — nothing to salvage
    const rationale = typeof rawRationale === 'string' ? rawRationale : ''
    const cleanChanges: VibeChange[] = []
    for (const c of rawChanges) {
      if (!c || typeof c !== 'object' || typeof c.key !== 'string') continue
      if (typeof c.value !== 'string' && typeof c.value !== 'number') continue
      cleanChanges.push({ key: c.key, value: c.value }) // pass-through — no synthesis
    }
    const trimmedLabel = typeof rawLabel === 'string' ? rawLabel.trim() : ''
    const label = trimmedLabel ? truncateLabel(trimmedLabel) : synthesizeLabel(rationale, i)
    const promise = salvagePromise((t as any).promise)
    candidates.push({ label, changes: cleanChanges, rationale, ...(promise ? { promise } : {}) })
  })

  if (!candidates.length) return { takes: [], reason: 'no take in the response had a usable shape' }
  if (!candidates.some(c => c.changes.length > 0)) return { takes: [], reason: 'every take had zero valid changes' }

  return { takes: candidates }
}

/** Multi-take instruction block, appended to the base prompt only when
 *  `variants` is requested — studio-agnostic (no studio-specific vocabulary),
 *  so it's shared verbatim by all five vibe studios. Names the honesty
 *  convention Texture's command-surface guidance already spells out
 *  (APPROXIMATION_HONESTY_GUIDANCE in lib/agent/studioTune.ts — approximate,
 *  then say so) rather than duplicating its full clause text here. */
function buildTakesBlock(variants: number): string {
  return `MULTIPLE TAKES (${variants}): propose ${variants} genuinely different readings of the request, not ${variants} nudges of one idea — each take must differ from the OTHERS on a named dimension (e.g. warmer vs cooler, tighter vs looser, bolder vs quieter), never numeric jitter of the same idea restated. Give each take a short angle-name label, ≤24 characters (e.g. "warmer", "high contrast") — a name, not a sentence. If a whole-look control is offered (one that sets the base STYLE rather than nudging a value), answer a request for a new look with takes that each pick a DIFFERENT one — nudging colours cannot change a base look. If the request names a look these controls can't fully reach, follow this agent's honesty convention: label the closest take "closest: <the requested look>", say in its rationale that it only approximates the request, and keep the remaining takes genuinely distinct from each other and from it.

PROMISE (optional): 2-3 claims about what the render will SHOW — dominant colours (1-3), direction (vertical/horizontal/radial/none), dark or light. Each is CHECKED against the real picture, so claim only what you are sure the pixels will show and omit anything you are unsure of.`
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
