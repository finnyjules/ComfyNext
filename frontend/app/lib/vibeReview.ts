/**
 * The see-first loop — the model looks at its own four takes before the user
 * judges them.
 *
 * Until this existed, the pixel checkers in `lib/agent/takes.ts` were an
 * after-the-fact court: they measured what came back and labelled what was
 * wrong, but the model never saw its own work. Here the rendered thumbnails go
 * BACK, with their labels and the design the user already had, and the model
 * says of each: keep it, fix it, or replace it. The checkers still run
 * afterwards as a backstop, so nothing that used to be caught stops being
 * caught — they have simply stopped being the only reader.
 *
 * Everything in this file is written around one rule: **a review may improve a
 * take or leave it alone, and nothing else.** Every malformed shape degrades to
 * `keep`, which is exactly today's behaviour, and today's behaviour is the floor
 * this feature must never fall below.
 */
import type { DescribedControl } from '~/lib/spacetype/controlDescriptor'

export type TakeVerdict = 'keep' | 'fix' | 'replace'
const VERDICTS: readonly TakeVerdict[] = ['keep', 'fix', 'replace']

export interface TakeReviewChange { key: string, value: string | number }

export interface TakeReviewEntry {
  verdict: TakeVerdict
  /** Present for `fix` / `replace` — the corrected values, from the offered
   *  vocabulary only. A verdict that asks for a change but carries none is
   *  downgraded to `keep`: there would be nothing to apply. */
  changes?: TakeReviewChange[]
  label?: string
  reason?: string
}

/**
 * Structured-output schema for a review pass. Same constraints as
 * `TAKES_SCHEMA`: strict objects everywhere, and no count/length keywords — the
 * structured-outputs API rejects them outright, and it only shows up on a live
 * call. Counts live in prose; the shape is enforced coming back in by
 * `parseTakeReview`.
 */
export const TAKE_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    reviews: {
      type: 'array',
      description: 'One entry per take, in the SAME ORDER the takes were shown. Return exactly as many entries as there were takes.',
      items: {
        type: 'object',
        properties: {
          verdict: {
            type: 'string',
            description: '"keep" if the picture already answers the request; "fix" to correct this take with better values; "replace" to propose a different reading in its place.',
            enum: ['keep', 'fix', 'replace'],
          },
          changes: {
            type: 'array',
            description: 'Required for "fix" and "replace": the FULL set of control changes this take should carry. Use ONLY keys from the offered list.',
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
          label: { type: 'string', description: 'A new short angle-name for a fixed or replaced take. Omit to keep the existing one.' },
          reason: { type: 'string', description: 'One short sentence: what you saw in the picture that made this verdict.' },
        },
        required: ['verdict'],
        additionalProperties: false,
      },
    },
  },
  required: ['reviews'],
  additionalProperties: false,
}

/**
 * The instruction. Deliberately asks the PICTURE question — "looking at this,
 * would a person say it is what was asked for?" — because the model has already
 * had its turn at the config question and this pass exists to catch what only
 * looking can catch.
 */
export function buildTakeReviewPrompt(
  phrase: string,
  described: DescribedControl[],
  takes: { label: string, changes: { key: string, value: unknown }[] }[],
): string {
  const controls = described.map((c) => {
    const range = c.kind === 'slider' ? ` ${c.min}..${c.max}` : ''
    const opts = c.kind === 'select' ? ` [${c.options!.join(', ')}]` : ''
    return `${c.path} (${c.kind}${range}${opts})`
  }).join(', ')

  const list = takes.map((t, i) => `${i + 1}. "${t.label}" — ${t.changes.map(c => `${c.key}=${JSON.stringify(c.value)}`).join(', ') || 'no changes'}`).join('\n')

  return `The user asked for: "${phrase}"

You proposed ${takes.length} takes. The images are, in order: the user's CURRENT design (labelled "yours", for reference only — do not review it), then one picture per take in the order listed below.

${list}

Look at each take's PICTURE and answer one question about it: would a person seeing this say it is "${phrase}"? Judge what is actually there — its colours, its direction, its contrast — not what the values were meant to do.

- "keep" if the picture already answers the request.
- "fix" if this take has the right idea but the picture misses — return the FULL corrected change list.
- "replace" if the picture is not a useful reading at all — return a different take's full change list.

Use ONLY these control keys; do not invent any: ${controls}

Give one short reason naming what you SAW. Keep a take unless the picture genuinely falls short — a take that is merely different from your intent is still a valid reading.`
}

/** One usable change, or null. Never invents or coerces. */
function cleanChange(raw: unknown): TakeReviewChange | null {
  if (!raw || typeof raw !== 'object') return null
  const { key, value } = raw as Record<string, unknown>
  if (typeof key !== 'string' || !key) return null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  return { key, value }
}

const text = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined

/**
 * Exactly `count` verdicts, whatever came back.
 *
 * Every degradation lands on `keep`, and that asymmetry is the whole safety
 * argument: a review that is missing, truncated, over-long, or nonsense leaves
 * the takes exactly as the user would have got them without this feature. A
 * `fix` or `replace` carrying nothing applicable is also `keep` — a verdict that
 * asks for a change and supplies none is not an improvement, it is a no-op with
 * an opinion.
 */
export function parseTakeReview(raw: unknown, count: number): TakeReviewEntry[] {
  const rows = (raw && typeof raw === 'object' && Array.isArray((raw as any).reviews))
    ? (raw as any).reviews as unknown[]
    : []
  const out: TakeReviewEntry[] = []
  for (let i = 0; i < count; i++) {
    const row = rows[i]
    if (!row || typeof row !== 'object') { out.push({ verdict: 'keep' }); continue }
    const { verdict, changes, label, reason } = row as Record<string, unknown>
    if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) {
      out.push({ verdict: 'keep' }); continue
    }
    if (verdict === 'keep') { out.push({ verdict: 'keep', ...(text(reason) ? { reason: text(reason) } : {}) }); continue }
    const clean = (Array.isArray(changes) ? changes : []).map(cleanChange).filter((c): c is TakeReviewChange => !!c)
    if (!clean.length) { out.push({ verdict: 'keep' }); continue } // nothing to apply
    out.push({
      verdict: verdict as TakeVerdict,
      changes: clean,
      ...(text(label) ? { label: text(label) } : {}),
      ...(text(reason) ? { reason: text(reason) } : {}),
    })
  }
  return out
}
