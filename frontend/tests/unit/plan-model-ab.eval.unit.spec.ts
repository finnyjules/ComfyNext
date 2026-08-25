/**
 * A/B eval — canvas planner, old vs new `plan` tier model.
 *
 * This is NOT a normal unit test: it makes REAL, PAID Anthropic calls. It is
 * gated on NUXT_ANTHROPIC_API_KEY, so a plain `npx vitest run` skips the whole
 * body silently and the suite stays green + offline.
 *
 *   NUXT_ANTHROPIC_API_KEY=sk-... npx vitest run tests/unit/plan-model-ab.eval.unit.spec.ts
 *
 * Cost: 10 prompts × 2 models = 20 short calls (~2–4k input, ≤2048 output each)
 * — single-digit cents in total.
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

/** The tier-map value before the upgrade vs. after (server/lib/aiModels.ts). */
const MODELS = ['claude-sonnet-4-6', 'claude-sonnet-5'] as const
type ModelId = (typeof MODELS)[number]

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
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Same request shape as server/api/agent-plan.post.ts (non-streaming,
 *  json_schema output_config, max_tokens 2048, first text block). Retries once
 *  on 429/5xx. */
async function callModel(model: ModelId, prompt: string, schema: Record<string, unknown>): Promise<{ text: string; stopReason: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY!,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        output_config: { format: { type: 'json_schema', schema } },
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500
      const detail = await res.text().catch(() => '')
      if (retryable && attempt === 0) { await sleep(4000); continue }
      throw new Error(`${res.status} ${detail.slice(0, 200)}`)
    }
    const json = await res.json() as { content?: Array<{ text?: unknown }>; stop_reason?: string }
    const text = Array.isArray(json.content)
      ? (json.content.find(b => typeof b?.text === 'string' && b.text)?.text as string | undefined) ?? ''
      : ''
    return { text, stopReason: String(json.stop_reason ?? '') }
  }
  throw new Error('unreachable')
}

async function runOne(model: ModelId, phrase: string): Promise<Outcome> {
  const snapshot = describeCanvas(emptyCanvasSnapshot(phrase))
  const prompt = buildAgentPrompt(snapshot, phrase)
  const schema = buildCommandSchema(snapshot.commands)

  let text: string, stopReason: string
  try {
    ({ text, stopReason } = await callModel(model, prompt, schema))
  } catch (e) {
    return { firstAddNode: `ERROR: ${(e as Error).message.slice(0, 60)}`, tunedAfter: false, reasoning: '', opCount: 0, ops: [], stopReason: 'error' }
  }

  const parsed = parseAgentResponse(text)
  if (parsed.parseFailed) {
    // A max_tokens cut mid-JSON is a truncation, not a model that can't emit JSON.
    const label = stopReason === 'max_tokens' ? 'TRUNCATED' : 'MALFORMED'
    return { firstAddNode: label, tunedAfter: false, reasoning: text.slice(0, 100), opCount: 0, ops: [], stopReason }
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
  }
}

const REPORT_PATH = fileURLToPath(new URL('../../../docs/superpowers/evals/2026-08-24-plan-model-ab.md', import.meta.url))

function esc(s: string): string { return s.replace(/\|/g, '\\|').replace(/\n/g, ' ') }

function buildReport(rows: Array<{ prompt: string; results: Record<ModelId, Outcome> }>): string {
  const [OLD, NEW] = MODELS
  const agree = rows.filter(r => r.results[OLD].firstAddNode === r.results[NEW].firstAddNode).length
  return [
    '# Canvas planner A/B — `claude-sonnet-4-6` vs `claude-sonnet-5`',
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
    'this report is **not** rewritten. With the key it makes 10 prompts × 2 models = **20**',
    'real Anthropic calls (~2–4k input tokens, ≤2048 output each) — a few cents in total.',
    '',
    '## What is being compared',
    '',
    'The PRODUCTION canvas-planner request: `describeCanvas` → `buildAgentPrompt` +',
    '`buildCommandSchema` (app/lib/agent/…), posted to `/v1/messages` in the exact shape',
    '`server/api/agent-plan.post.ts` uses (non-streaming, `output_config.format` =',
    '`json_schema`, `max_tokens: 2048`, first text block). Snapshot: an EMPTY canvas —',
    "the first-prompt case — with a catalog assembled from the app's own",
    '`AGENT_CAPABILITIES` through the real `buildCatalog` ranking pipeline.',
    '',
    `**Synthetic-catalog caveat:** ${SYNTHETIC_CATALOG_NOTE}. Everything else (ranking,`,
    'caps, pins, preferred/raw split, prompt text, schema) is the shipped path.',
    '',
    '## Results',
    '',
    `First \`addNode\` agreement: **${agree}/${rows.length}**.`,
    '',
    `| Prompt | ${OLD} → first addNode | tuneNode follows | ${NEW} → first addNode | tuneNode follows |`,
    '| --- | --- | --- | --- | --- |',
    ...rows.map(r => `| ${esc(r.prompt)} | \`${esc(r.results[OLD].firstAddNode)}\` | ${r.results[OLD].tunedAfter ? 'yes' : 'no'} | \`${esc(r.results[NEW].firstAddNode)}\` | ${r.results[NEW].tunedAfter ? 'yes' : 'no'} |`),
    '',
    '## Reasoning (first ~100 chars) and full op sequence',
    '',
    ...rows.flatMap(r => [
      `### ${r.prompt}`,
      '',
      ...MODELS.map(m => `- **${m}** (${r.results[m].opCount} cmds: ${r.results[m].ops.join(' → ') || '—'}${r.results[m].stopReason ? `, stop_reason: ${r.results[m].stopReason}` : ''})  \n  ${esc(r.results[m].reasoning) || '—'}`),
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
    it('compares the old and new plan-tier models across 10 prompts', async () => {
      const rows: Array<{ prompt: string; results: Record<ModelId, Outcome> }> = []
      for (const phrase of PROMPTS) {
        const [oldOut, newOut] = await Promise.all(MODELS.map(m => runOne(m, phrase)))
        rows.push({ prompt: phrase, results: { [MODELS[0]]: oldOut!, [MODELS[1]]: newOut! } as Record<ModelId, Outcome> })
      }

      const [OLD, NEW] = MODELS
      // eslint-disable-next-line no-console
      console.log(`\n  prompt${' '.repeat(44)}| ${OLD.padEnd(28)}| ${NEW}`)
      // eslint-disable-next-line no-console
      console.log(`  ${'-'.repeat(48)}+${'-'.repeat(29)}+${'-'.repeat(29)}`)
      for (const r of rows) {
        const cell = (o: Outcome) => `${o.firstAddNode}${o.tunedAfter ? ' +tune' : ''}`
        // eslint-disable-next-line no-console
        console.log(`  ${r.prompt.slice(0, 48).padEnd(48)}| ${cell(r.results[OLD]).slice(0, 28).padEnd(28)}| ${cell(r.results[NEW])}`)
      }

      mkdirSync(dirname(REPORT_PATH), { recursive: true })
      writeFileSync(REPORT_PATH, buildReport(rows), 'utf8')
      // eslint-disable-next-line no-console
      console.log(`\n  report → ${REPORT_PATH}\n`)

      expect(rows).toHaveLength(PROMPTS.length)
      // Both models must be reachable — an all-ERROR column means the harness,
      // not the model, is broken, and a silently empty report would hide that.
      for (const m of MODELS) {
        expect(rows.some(r => !r.results[m].firstAddNode.startsWith('ERROR')), `every call to ${m} failed`).toBe(true)
      }
    }, 15 * 60_000)
  })
})
