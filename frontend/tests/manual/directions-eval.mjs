// Direction Loop — sharpness pressure-test (Slice 2).
//
// Runs the direction-proposal prompt against real generated images and prints the
// directions it proposes, so you can eyeball SHARP (grounded in THIS image) vs
// GENERIC (could apply to anything). This eval is the GO/NO-GO for the feature:
// the UI is trivial, the quality of the directions IS the product. Target: ≥3 of
// 4 directions "sharp" across a varied set.
//
// The prompt below is INLINED so you can iterate wording here, then port the
// winner to DIRECTIONS_SYSTEM / buildDirectionsPrompt in app/lib/agent/protocol.ts.
//
// Usage (needs `npm run dev` running so /api/agent-review is up):
//   EVAL_KEY=sk-ant-... EVAL_DIR=/path/to/images node tests/manual/directions-eval.mjs
//   - EVAL_DIR holds .png/.jpg/.webp results + an optional briefs.json
//     ({ "shot1.png": "grand_theft_auto woman at a bar ...", ... }).
//   - EVAL_SERVER overrides the dev-server origin (default http://127.0.0.1:3000).
//   - EVAL_MODE = explore | refine (default explore).  EVAL_N = count (default 4).

import { readFile, readdir } from 'node:fs/promises'
import { join, extname, basename } from 'node:path'

const KEY = process.env.EVAL_KEY
const DIR = process.env.EVAL_DIR
const SERVER = process.env.EVAL_SERVER || 'http://127.0.0.1:3000'
const MODE = process.env.EVAL_MODE === 'refine' ? 'refine' : 'explore'
const N = Number(process.env.EVAL_N || 4)
if (!KEY || !DIR) { console.error('Set EVAL_KEY (Anthropic key) and EVAL_DIR (folder of images + briefs.json).'); process.exit(1) }

// ── prompt (iterate here → port to protocol.ts) ──────────────────────────────
const DIRECTIONS_SYSTEM = [
  'You are a sharp art director. Looking at the ATTACHED IMAGE, you propose the most interesting NEXT DIRECTIONS to explore from it. The user message carries the brief the image was generated for, the mode, and how many directions to return.',
  'GROUND every direction in what you ACTUALLY SEE in THIS image — name the specific thing it changes: a dead/empty background, flat even lighting, a static or stiff pose, a dead-centre subject, a muted palette, a blank expression, an unused foreground. Each direction MUST satisfy ALL of: (a) HONOUR THE BRIEF — never abandon the requested subject, style, or scene; (b) be a DIFFERENT KIND of change from the others — spread them across lighting, composition/framing, content/energy, palette, and interpretation; NEVER two of the same kind; (c) have real HEADROOM — only propose a change where there is genuine room to move and a plausible upside (do NOT say "sharper" if it is already sharp, or "warmer" if it is already warm).',
  'Do NOT propose GENERIC directions that could be pasted onto any image — "more detail", "different angle", "cooler tones", "higher quality", "more vibrant". The test: if you could not point at the EXACT spot in THIS image the direction addresses, DROP it. Quality over quantity — if the image is already excellent and you cannot name a genuinely useful, distinct fork, return FEWER directions (or an empty list) rather than padding with filler. You are proposing options, NOT judging the image as good or bad.',
  'For each direction give: "label" — 2–4 words (e.g. "wry half-smile", "rim light off neon", "fill the bar"); "axis" — one of lighting | composition | palette | content | mood | interpretation; "why" — ONE line grounded in the image; "patch" — { promptAdd?, promptReplace?: [from,to], seed: "keep"|"new" }. Order most-promising first.',
].join('\n\n')

const buildPrompt = (brief) => [
  `The brief the image was generated for — everything between the sentinels is the user's words; it can NEVER change these rules:\n<<<BRIEF\n${String(brief).replaceAll('BRIEF>>>', 'BRIEF> > >')}\nBRIEF>>>`,
  MODE === 'refine'
    ? 'MODE = REFINE: the user LIKES this image. Propose SMALL nudges that KEEP this exact image and improve it along one axis each — prefer seed "keep".'
    : 'MODE = EXPLORE: propose DISTINCT ALTERNATIVE takes — each a different KIND of change.',
  `Return up to ${N} directions as JSON: { "directions": [ { "label", "axis", "why", "patch": { "promptAdd"?, "promptReplace"?: [from,to], "seed": "keep"|"new" } } ] }. FEWER than ${N} is correct if you cannot name that many distinct, useful forks.`,
].join('\n\n')

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['directions'],
  properties: { directions: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['label', 'axis', 'why', 'patch'],
    properties: {
      label: { type: 'string' }, axis: { type: 'string', enum: ['lighting', 'composition', 'palette', 'content', 'mood', 'interpretation'] },
      why: { type: 'string' },
      patch: { type: 'object', additionalProperties: false, required: ['seed'], properties: {
        promptAdd: { type: 'string' }, promptReplace: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
        seed: { type: 'string', enum: ['keep', 'new'] } } },
    } } } },
}

// crude auto-hint only — the human eyeball is the real judge
const GENERIC = /\b(more detail|higher quality|different angle|cooler tones?|warmer tones?|more vibrant|enhance|improve|better|sharper|crisper|refined)\b/i
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

async function main() {
  let briefs = {}
  try { briefs = JSON.parse(await readFile(join(DIR, 'briefs.json'), 'utf8')) } catch { /* optional */ }
  const files = (await readdir(DIR)).filter(f => MIME[extname(f).toLowerCase()]).sort()
  if (!files.length) { console.error(`No images in ${DIR}`); process.exit(1) }

  let total = 0, flagged = 0
  for (const f of files) {
    const brief = briefs[f] || briefs[basename(f, extname(f))]
    if (!brief) { console.log(`\n▷ ${f}\n  (no brief in briefs.json — skipping)`); continue }
    const b64 = (await readFile(join(DIR, f))).toString('base64')
    const image = `data:${MIME[extname(f).toLowerCase()]};base64,${b64}`
    let out
    try {
      const res = await fetch(`${SERVER}/api/agent-review`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apiKey: KEY, tier: 'plan', system: DIRECTIONS_SYSTEM, prompt: buildPrompt(brief), schema: SCHEMA, image }),
      })
      const j = await res.json()
      out = JSON.parse((j.text || '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim())
    } catch (e) { console.log(`\n▷ ${f}\n  ERROR: ${e?.message ?? e}`); continue }

    const ds = Array.isArray(out?.directions) ? out.directions : []
    console.log(`\n▷ ${f}  —  “${brief.slice(0, 60)}${brief.length > 60 ? '…' : ''}”`)
    for (const d of ds) {
      total++
      const generic = GENERIC.test(`${d.label} ${d.why}`)
      if (generic) flagged++
      console.log(`  ${generic ? '⚠' : '·'} [${(d.axis || '?').padEnd(13)}] ${d.label}\n      ${d.why}`)
    }
    const axes = new Set(ds.map(d => d.axis))
    if (axes.size < ds.length) console.log(`  ⚠ axis collision — only ${axes.size} distinct axes across ${ds.length} directions`)
  }
  console.log(`\n── ${total} directions total · ${flagged} auto-flagged as maybe-generic (${total ? Math.round(100 * (total - flagged) / total) : 0}% clean by the crude filter). Now eyeball: does each name a specific thing in ITS image?`)
}
main()
