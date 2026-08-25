/**
 * A/B eval — canvas planner: old vs new `plan` tier model, AND capped vs
 * uncapped output_config.effort on the new model.
 *
 * This is NOT a normal unit test: it makes REAL, PAID Anthropic calls. It is
 * gated on NUXT_ANTHROPIC_API_KEY, so a plain `npx vitest run` skips the whole
 * body silently and the suite stays green + offline.
 *
 *   NUXT_ANTHROPIC_API_KEY=sk-... npx vitest run tests/unit/plan-model-ab.eval.unit.spec.ts
 *
 * Cost: 10 prompts × 3 arms = 30 short calls (~2–4k input, ≤2048 output each)
 * — still single-digit-to-low-double-digit cents in total.
 *
 * Why three arms, not two: the earlier version sent `effort: 'low'` on BOTH
 * models, which measures model-vs-model but NOT the effort cap itself — every
 * arm was already capped. Arm 3 reproduces the PRE-FIX production shape (no
 * `output_config.effort` at all → Sonnet 5 runs adaptive thinking uncapped),
 * so arm 2 vs arm 3 isolates the latency effect of the effort cap on the exact
 * same model, while arm 1 vs arm 2 isolates the model-upgrade effect at
 * matched effort. Read them as two separate comparisons, not one.
 *
 * Why it builds the prompt via the app's own modules rather than a fixture: the
 * thing under comparison is the PRODUCTION planner prompt (describeCanvas +
 * buildAgentPrompt + buildCommandSchema over a real capability catalog). An
 * approximation would measure a prompt we don't ship. See SYNTHETIC_CATALOG_NOTE
 * below for the one place this deviates from the live app (no /object_info).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { AGENT_CAPABILITIES, capabilityBoosts, capabilityKeywords, capabilityNodeTypes } from '~/lib/agent/capabilities'
import { buildAgentPrompt, buildCommandSchema, parseAgentResponse } from '~/lib/agent/protocol'
import { describeCanvas, type CanvasSnapshot } from '~/lib/agent/surfaces/canvas'
import { NODE_BOOST, NODE_KEYWORDS } from '~/lib/nodeKeywords'
import type { NodeTypeLite } from '~/lib/portIntent'
import { buildCatalog, type CatalogEntry } from '~/lib/portIntentCatalog'

const API_KEY = process.env.NUXT_ANTHROPIC_API_KEY

/** Three arms: [old model / new model at matched effort] × [new model capped
 *  vs uncapped]. `effort: undefined` on 'sonnet-5-uncapped' means the request
 *  omits output_config.effort entirely — the PRE-FIX shape, where Sonnet 5
 *  runs adaptive thinking with no cap. */
const ARMS = [
  { id: 'sonnet-4-6-low', model: 'claude-sonnet-4-6', effort: 'low', label: 'claude-sonnet-4-6 (effort low)' },
  { id: 'sonnet-5-low', model: 'claude-sonnet-5', effort: 'low', label: 'claude-sonnet-5 (effort low — POST-FIX shape)' },
  { id: 'sonnet-5-uncapped', model: 'claude-sonnet-5', effort: undefined, label: 'claude-sonnet-5 (no effort — PRE-FIX shape, adaptive/uncapped)' },
] as const satisfies readonly { id: string; model: string; effort: 'low' | undefined; label: string }[]
type Arm = (typeof ARMS)[number]
type ArmId = Arm['id']

const PROMPTS = [
  'a warm dreamy gradient background for a hero banner',
  'kinetic typography that says LAUNCH',
  'make me a seamless terrazzo pattern',
  'a glassy chrome 3D version of the word BLOOM',
  'give it that 35mm film look',
  'a 1970s italian film poster vibe',
  'moody berlin techno flyer background',
  'confetti burst around the product shot',
  'an underwater caustics effect on my logo',
  'something calm for a meditation app splash',
]

/**
 * What this synthetic catalog OMITS vs production (VueNodeCanvas.agentCatalog):
 *  1. RAW /object_info NODES. Production feeds buildCatalog every registered
 *     ComfyUI class; here only AGENT_CAPABILITIES exist. So the "Other low-level
 *     nodes" palette bucket is EMPTY — the addNode hint's "prefer a PREFERRED
 *     capability over a low-level node" hard rule is never actually stressed.
 *  2. WIDGETS. buildCatalog derives widget names/defaults/enum options from
 *     /object_info; with none, every entry has `widgets: []`. The model therefore
 *     cannot see (or set) widgetOverrides keys like `prompt` or `model`, and the
 *     palette lines print no widget list.
 *  3. TRAINED STYLES. `styles` (the user's LoRA library) is absent, so the
 *     "library" object and the personal-style routing rules are untested.
 *  4. SELECTION ANCHOR. Empty canvas → anchor portType '*' — identical to
 *     production's empty-canvas case, so this one is faithful, not omitted.
 * Everything else — the ranking (searchNodes over capabilityKeywords/Boosts +
 * NODE_KEYWORDS/NODE_BOOST), the caps, the pin, the capability tagging, the
 * preferred/raw split, and the whole prompt + schema — is the production path.
 */
const SYNTHETIC_CATALOG_NOTE = 'no raw /object_info nodes (empty "low-level" bucket), no widget defs/defaults/enums (widgets: [] on every entry), no trained-style library'

/** Capability registry as matchable node types — the shape buildCatalog wants. */
const CAP_NODE_TYPES: NodeTypeLite[] = AGENT_CAPABILITIES.map(c => ({
  name: c.nodeType,
  displayName: c.title,
  description: c.summary,
  category: c.kind,
  inputs: c.inputs,
  outputs: c.outputs,
}))

/** Mirrors VueNodeCanvas.agentCatalog(intent) for the empty-canvas case. */
function syntheticCatalog(intent: string): CatalogEntry[] {
  const keywords = { ...NODE_KEYWORDS, ...capabilityKeywords() }
  const boosts = { ...NODE_BOOST, ...capabilityBoosts() }
  const entries = buildCatalog(
    CAP_NODE_TYPES,
    {}, // no /object_info in a node env — see SYNTHETIC_CATALOG_NOTE
    { portType: '*', direction: 'output' },
    { intent, keywords, boosts, maxNodes: 60, maxEnum: 6, maxIntent: 24, alwaysInclude: ['GenerateImageNode'] },
  )
  const capSet = capabilityNodeTypes()
  return entries.map(e => (capSet.has(e.type) ? { ...e, capability: true } : e))
}

function emptyCanvasSnapshot(intent: string): CanvasSnapshot {
  return { nodes: [], edges: [], catalog: syntheticCatalog(intent) }
}

interface Outcome {
  /** First addNode's nodeType, or 'none' / 'MALFORMED' / 'TRUNCATED' / 'ERROR: …'. */
  firstAddNode: string
  /** A tuneNode later in the plan targeting that same added node. */
  tunedAfter: boolean
  reasoning: string
  opCount: number
  ops: string[]
  stopReason: string
  /** Wall-clock time of the SUCCESSFUL attempt's fetch only, ms. A 429/5xx
   *  retry's ~4s sleep is deliberately excluded — see `retried`. */
  ms: number
  /** True when a transient 429/5xx forced a retry before the successful
   *  attempt. This row's `ms` still excludes the retry's sleep+failed-fetch
   *  time, but flag it: a retried row hit a different network/server
   *  condition than a clean one, so treat its latency as less comparable. */
  retried: boolean
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Same request shape as server/api/agent-plan.post.ts (non-streaming,
 *  json_schema output_config, max_tokens 2048, first text block), with
 *  output_config.effort set per-arm (see ARMS above — omitted entirely for
 *  the uncapped arm). Retries once on 429/5xx; `ms` times ONLY the successful
 *  attempt's fetch call, started fresh each attempt, so a retry's ~4s sleep
 *  and the failed attempt's own round-trip never leak into the recorded
 *  latency. */
async function callModel(arm: Arm, prompt: string, schema: Record<string, unknown>): Promise<{ text: string; stopReason: string; ms: number; retried: boolean }> {
  let retried = false
  for (let attempt = 0; attempt < 2; attempt++) {
    const started = Date.now()
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: arm.model,
        max_tokens: 2048,
        output_config: { format: { type: 'json_schema', schema }, ...(arm.effort ? { effort: arm.effort } : {}) },
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500
      const detail = await res.text().catch(() => '')
      if (retryable && attempt === 0) { retried = true; await sleep(4000); continue }
      throw new Error(`${res.status} ${detail.slice(0, 200)}`)
    }
    const json = await res.json() as { content?: Array<{ text?: unknown }>; stop_reason?: string }
    const text = Array.isArray(json.content)
      ? (json.content.find(b => typeof b?.text === 'string' && b.text)?.text as string | undefined) ?? ''
      : ''
    return { text, stopReason: String(json.stop_reason ?? ''), ms: Date.now() - started, retried }
  }
  throw new Error('unreachable')
}

async function runOne(arm: Arm, phrase: string): Promise<Outcome> {
  const snapshot = describeCanvas(emptyCanvasSnapshot(phrase))
  const prompt = buildAgentPrompt(snapshot, phrase)
  const schema = buildCommandSchema(snapshot.commands)

  let text: string, stopReason: string, ms: number, retried: boolean
  try {
    ({ text, stopReason, ms, retried } = await callModel(arm, prompt, schema))
  } catch (e) {
    return { firstAddNode: `ERROR: ${(e as Error).message.slice(0, 60)}`, tunedAfter: false, reasoning: '', opCount: 0, ops: [], stopReason: 'error', ms: 0, retried: false }
  }

  const parsed = parseAgentResponse(text)
  if (parsed.parseFailed) {
    // A max_tokens cut mid-JSON is a truncation, not a model that can't emit JSON.
    const label = stopReason === 'max_tokens' ? 'TRUNCATED' : 'MALFORMED'
    return { firstAddNode: label, tunedAfter: false, reasoning: text.slice(0, 100), opCount: 0, ops: [], stopReason, ms, retried }
  }

  const ops = parsed.commands.map(c => c.op)
  const addIdx = parsed.commands.findIndex(c => c.op === 'addNode')
  const add = addIdx >= 0 ? parsed.commands[addIdx] : undefined
  const addedId = typeof add?.args?.id === 'string' ? add.args.id : undefined
  const tunedAfter = addIdx >= 0 && parsed.commands.slice(addIdx + 1).some(c =>
    c.op === 'tuneNode' && (addedId ? String(c.target) === addedId : true))

  return {
    firstAddNode: add ? String(add.args?.nodeType ?? 'none') : 'none',
    tunedAfter,
    reasoning: (parsed.reasoning || parsed.rationale || parsed.message || '').slice(0, 100),
    opCount: parsed.commands.length,
    ops,
    stopReason,
    ms,
    retried,
  }
}

const REPORT_PATH = fileURLToPath(new URL('../../../docs/superpowers/evals/2026-08-24-plan-model-ab.md', import.meta.url))

function esc(s: string): string { return s.replace(/\|/g, '\\|').replace(/\n/g, ' ') }

type Row = { prompt: string; results: Record<ArmId, Outcome> }

/** Average of successful-attempt ms, 0s (errors) excluded. Retried rows are
 *  INCLUDED — their ms already excludes the retry sleep, so they're still a
 *  fair sample of that arm's model latency; only the raw wall-clock-from-
 *  request-start would need excluding, and this ms is never that. */
function avgMs(rows: Row[], arm: ArmId): number {
  const vals = rows.map(r => r.results[arm].ms).filter(ms => ms > 0)
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0
}

function retriedCount(rows: Row[], arm: ArmId): number {
  return rows.filter(r => r.results[arm].retried).length
}

function buildReport(rows: Row[]): string {
  const [A46, A5LOW, A5UNCAPPED] = ARMS
  const agreeModel = rows.filter(r => r.results[A46.id].firstAddNode === r.results[A5LOW.id].firstAddNode).length
  const agreeEffort = rows.filter(r => r.results[A5LOW.id].firstAddNode === r.results[A5UNCAPPED.id].firstAddNode).length
  const armCell = (r: Row, arm: ArmId) => {
    const o = r.results[arm]
    return `| \`${esc(o.firstAddNode)}\` | ${o.tunedAfter ? 'yes' : 'no'} | ${o.ms} | ${o.retried ? 'yes' : ''} `
  }
  return [
    '# Canvas planner eval — model upgrade AND effort-cap latency, three arms',
    '',
    `Generated ${new Date().toISOString()} by \`frontend/tests/unit/plan-model-ab.eval.unit.spec.ts\`.`,
    '',
    '## How to run',
    '',
    '```bash',
    'cd frontend',
    'NUXT_ANTHROPIC_API_KEY=sk-... npx vitest run tests/unit/plan-model-ab.eval.unit.spec.ts',
    '```',
    '',
    'Without the key the spec skips silently (one always-green gate assertion runs) and',
    'this report is **not** rewritten. With the key it makes 10 prompts × 3 arms = **30**',
    'real Anthropic calls (~2–4k input tokens, ≤2048 output each).',
    '',
    '## What is being compared — THREE arms, two separate questions',
    '',
    'Same PRODUCTION planner request every time: `describeCanvas` → `buildAgentPrompt` +',
    '`buildCommandSchema` (app/lib/agent/…), posted to `/v1/messages` in the exact shape',
    '`server/api/agent-plan.post.ts` uses (non-streaming, `output_config.format` =',
    '`json_schema`, `max_tokens: 2048`, first text block). Only `output_config.effort`',
    'and `model` vary across arms:',
    '',
    `1. **${A46.label}**`,
    `2. **${A5LOW.label}** — what \`agent-plan.post.ts\` sends today (post-fix).`,
    `3. **${A5UNCAPPED.label}** — what it sent BEFORE this fix (no \`effort\` field at`,
    '   all → Sonnet 5 runs adaptive thinking with no cap).',
    '',
    '**Arm 1 vs arm 2** isolates the MODEL-UPGRADE effect at matched effort (both capped',
    '`low`) — this does NOT tell you anything about the effort cap itself, both arms have',
    'it. **Arm 2 vs arm 3** isolates the EFFORT-CAP effect on the identical model — this is',
    'the before/after for the latency fix. Read them separately; neither substitutes for',
    'the other.',
    '',
    "Snapshot: an EMPTY canvas — the first-prompt case — with a catalog assembled from the app's own",
    '`AGENT_CAPABILITIES` through the real `buildCatalog` ranking pipeline.',
    '',
    `**Synthetic-catalog caveat:** ${SYNTHETIC_CATALOG_NOTE}. Everything else (ranking,`,
    'caps, pins, preferred/raw split, prompt text, schema) is the shipped path.',
    '',
    '## Results',
    '',
    `First \`addNode\` agreement, arm 1 vs arm 2 (model upgrade, matched effort): **${agreeModel}/${rows.length}**.`,
    `First \`addNode\` agreement, arm 2 vs arm 3 (effort cap, same model): **${agreeEffort}/${rows.length}**.`,
    '',
    'Average wall-clock per call (successful attempt only; retry sleep excluded; 0-ms',
    'error rows excluded from the average):',
    '',
    ...ARMS.map(a => `- **${a.label}**: ${avgMs(rows, a.id)}ms avg (${retriedCount(rows, a.id)}/${rows.length} rows retried)`),
    '',
    `**Effort-cap latency delta (arm 3 − arm 2, same model claude-sonnet-5):** ${avgMs(rows, A5UNCAPPED.id) - avgMs(rows, A5LOW.id)}ms.`,
    '',
    '`retried` = yes means a transient 429/5xx forced a retry before the row\'s successful',
    'attempt — that attempt\'s own ms is still clean (timed fresh, per-attempt), but a',
    'retried row hit different network/server conditions than a clean one, so weight it',
    'less when eyeballing latency.',
    '',
    `| Prompt | ${A46.label} addNode | tune | ms | retried | ${A5LOW.label} addNode | tune | ms | retried | ${A5UNCAPPED.label} addNode | tune | ms | retried |`,
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map(r => `| ${esc(r.prompt)} ${armCell(r, A46.id)}${armCell(r, A5LOW.id)}${armCell(r, A5UNCAPPED.id)}|`),
    '',
    '## Reasoning (first ~100 chars) and full op sequence',
    '',
    ...rows.flatMap(r => [
      `### ${r.prompt}`,
      '',
      ...ARMS.map(a => `- **${a.label}** (${r.results[a.id].opCount} cmds: ${r.results[a.id].ops.join(' → ') || '—'}${r.results[a.id].stopReason ? `, stop_reason: ${r.results[a.id].stopReason}` : ''}, ${r.results[a.id].ms}ms${r.results[a.id].retried ? ', retried' : ''})  \n  ${esc(r.results[a.id].reasoning) || '—'}`),
      '',
    ]),
  ].join('\n')
}

describe('plan-tier A/B eval (env-gated)', () => {
  // Always-green: proves the gate exists and that the prompt builders still
  // compose without a key, so this file is never silently empty on skip.
  it('is gated on NUXT_ANTHROPIC_API_KEY and builds the production prompt offline', () => {
    const snapshot = describeCanvas(emptyCanvasSnapshot(PROMPTS[0]!))
    const prompt = buildAgentPrompt(snapshot, PROMPTS[0]!)
    const schema = buildCommandSchema(snapshot.commands) as { properties: { commands: { items: { properties: { op: { enum: string[] } } } } } }
    expect(prompt).toContain('PREFERRED capabilities')
    expect(prompt).toContain(PROMPTS[0]!)
    expect(schema.properties.commands.items.properties.op.enum).toContain('addNode')
    expect(schema.properties.commands.items.properties.op.enum).toContain('tuneNode')
    // The paid body below runs ONLY with the key present.
    expect(typeof API_KEY === 'string' || API_KEY === undefined).toBe(true)
  })

  describe.skipIf(!API_KEY)('paid comparison', () => {
    it('compares old-model, new-model-capped, and new-model-uncapped across 10 prompts', async () => {
      const rows: Row[] = []
      for (const phrase of PROMPTS) {
        const outcomes = await Promise.all(ARMS.map(a => runOne(a, phrase)))
        const results = Object.fromEntries(ARMS.map((a, i) => [a.id, outcomes[i]!])) as Record<ArmId, Outcome>
        rows.push({ prompt: phrase, results })
      }

      // eslint-disable-next-line no-console
      console.log(`\n  prompt${' '.repeat(44)}| ${ARMS.map(a => a.label).join(' | ')}`)
      for (const r of rows) {
        const cell = (a: Arm) => {
          const o = r.results[a.id]
          return `${o.firstAddNode}${o.tunedAfter ? ' +tune' : ''} (${o.ms}ms${o.retried ? ', retried' : ''})`
        }
        // eslint-disable-next-line no-console
        console.log(`  ${r.prompt.slice(0, 48).padEnd(48)}| ${ARMS.map(a => cell(a)).join(' | ')}`)
      }
      // eslint-disable-next-line no-console
      console.log(`\n  avg ms — ${ARMS.map(a => `${a.id}: ${avgMs(rows, a.id)}`).join(', ')}`)
      // eslint-disable-next-line no-console
      console.log(`  effort-cap delta (uncapped − capped, same model): ${avgMs(rows, 'sonnet-5-uncapped') - avgMs(rows, 'sonnet-5-low')}ms`)

      mkdirSync(dirname(REPORT_PATH), { recursive: true })
      writeFileSync(REPORT_PATH, buildReport(rows), 'utf8')
      // eslint-disable-next-line no-console
      console.log(`\n  report → ${REPORT_PATH}\n`)

      expect(rows).toHaveLength(PROMPTS.length)
      // Every arm must be reachable — an all-ERROR column means the harness,
      // not the model, is broken, and a silently empty report would hide that.
      for (const a of ARMS) {
        expect(rows.some(r => !r.results[a.id].firstAddNode.startsWith('ERROR')), `every call to ${a.label} failed`).toBe(true)
      }
    }, 20 * 60_000)
  })
})
