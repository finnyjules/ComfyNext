/**
 * The eye-pick: the model chooses four of our rendered candidates by looking at
 * them.
 *
 * The division of labour this feature is built on — the model has taste about
 * words and judgement about pictures, and no idea how our machinery works — puts
 * this at the end. Every candidate is already a real config we built and
 * rendered; nothing here can invent one. The model returns INDICES, and an index
 * we did not offer is dropped.
 */

export interface EyePick {
  index: number
  label?: string
  reason?: string
}

/** Schema: indices into the candidate list, in the order they should appear. */
export const EYE_PICK_SCHEMA = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      description: 'Exactly four picks, best first. Each is the NUMBER of a candidate image as labelled in the prompt.',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'The candidate number, as labelled in the prompt.' },
          label: { type: 'string', description: 'A short angle-name for this one, ≤24 characters.' },
          reason: { type: 'string', description: 'One short sentence: what you SAW that earned it a place.' },
        },
        required: ['index'],
        additionalProperties: false,
      },
    },
  },
  required: ['picks'],
  additionalProperties: false,
}

/**
 * The prompt carries NO candidate names. That is deliberate: the earlier version
 * listed each candidate's recipe name ("1. Molten Rust") beside its image, which
 * primed the model to echo the intended name instead of describing the render —
 * so a rust name sat over a blue/purple picture and the label lied. The model is
 * given only the count and told to judge the pixels; the label it returns is
 * therefore about what it SAW, not about a word we handed it.
 *
 * `candidateCount` (not a name list) also lets the prompt state the numbering
 * unambiguously: the current design is image one (reference only), so candidate
 * `k` is the (k+1)-th image, and `salvageEyePicks` subtracts the same one.
 */
export function buildEyePickPrompt(phrase: string, candidateCount: number): string {
  return `The user asked for: "${phrase}"

You are shown ${candidateCount + 1} images.
The FIRST image is the user's CURRENT design — reference only, NOT a candidate. Do not pick it.
The remaining ${candidateCount} images are the candidates, numbered 1 to ${candidateCount} in the order shown (candidate 1 is the image right after the current design).

You are given NO names and NO descriptions — judge ONLY what you SEE in each picture. Describe the pixels, not any idea of what they were meant to be.

Choose the best FOUR candidates. A good four:
- each reads as "${phrase}" to someone who just sees the picture
- are clearly different from EACH OTHER, not four shades of one idea
- are clearly different from the user's current design — there is no point offering them what they already have

Return four picks, best first, each with the candidate's number (1 to ${candidateCount}), a short name you give it from what you see, and one sentence naming what you SAW in it.`
}

/**
 * Exactly the picks we can honour, in order, deduplicated.
 *
 * An index outside the candidate list, a repeat, or a malformed entry is
 * dropped — never remapped to something nearby, which would be us inventing a
 * choice and attributing it to the model. Fewer than four survivors is the
 * caller's problem to fill, deterministically, from its own distinctness
 * ranking.
 */
export function salvageEyePicks(raw: unknown, candidateCount: number, want = 4): EyePick[] {
  const rows = (raw && typeof raw === 'object' && Array.isArray((raw as any).picks))
    ? (raw as any).picks as unknown[]
    : []
  const seen = new Set<number>()
  const out: EyePick[] = []
  for (const row of rows) {
    if (out.length >= want) break
    if (!row || typeof row !== 'object') continue
    const { index, label, reason } = row as Record<string, unknown>
    if (typeof index !== 'number' || !Number.isFinite(index)) continue
    const i = Math.round(index) - 1 // the prompt numbers from 1
    if (i < 0 || i >= candidateCount || seen.has(i)) continue
    seen.add(i)
    out.push({
      index: i,
      // Code points, not UTF-16 units — see `truncateLabel` in vibePrompt.ts.
      ...(typeof label === 'string' && label.trim() ? { label: [...label.trim()].slice(0, 24).join('') } : {}),
      ...(typeof reason === 'string' && reason.trim() ? { reason: reason.trim() } : {}),
    })
  }
  return out
}

/**
 * Fill the remaining slots ourselves, deterministically: the unpicked candidates
 * whose pictures sit farthest from everything already chosen.
 *
 * `distance(a, b)` is supplied by the caller (our pixel comparison), so this
 * stays pure and testable. A pair we cannot measure is treated as maximally
 * far — no evidence is not a reason to reject, the same posture the checkers
 * take everywhere else.
 */
export function fillPicks(
  picked: EyePick[],
  candidateCount: number,
  distance: (a: number, b: number) => number | null,
  want = 4,
): EyePick[] {
  const out = [...picked]
  const chosen = new Set(out.map(p => p.index))
  while (out.length < Math.min(want, candidateCount)) {
    let best: { i: number, d: number } | null = null
    for (let i = 0; i < candidateCount; i++) {
      if (chosen.has(i)) continue
      // How far this one sits from the nearest thing already chosen.
      let nearest = Number.POSITIVE_INFINITY
      for (const p of chosen) {
        const d = distance(i, p)
        if (d === null) continue
        nearest = Math.min(nearest, d)
      }
      const score = nearest === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : nearest
      if (!best || score > best.d) best = { i, d: score }
    }
    if (!best) break
    chosen.add(best.i)
    out.push({ index: best.i })
  }
  return out
}
