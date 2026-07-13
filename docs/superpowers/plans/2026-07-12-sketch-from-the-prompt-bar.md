# Sketch From The Prompt Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make sketching a *typed idea* on the canvas prompt bar — auto-detected intent fires a batched Flux-Schnell render whose 4 cheap options bloom in view, refresh in place, and let you keep a winner — and retire the user-facing Sketch node.

**Architecture:** The prompt-bar agent gains a client-intercepted `sketch` command (mirroring the existing `searchImages` interception). It calls a new `startSketch(prompt)` exposed by `VueNodeCanvas`. `startSketch` reuses the *proven* dispatch pipeline that today's Sketch node uses (Option B from the spec's discovery gate): it drives a **transient, hidden** `GenerateImageNode` (model `flux-schnell`, `num_outputs:4`) positioned at the nearest-clear viewport spot, runs it, and the existing `executed` WS handler materializes the 4 result cards — now via an **anchor-based** materializer decoupled from a persistent source node. Per-canvas `sketchPad` reactive state (anchor, card ids, seed) survives across re-sketches to drive in-place refresh; "keep" strips a card's sketch properties. Placement, the intent heuristic, and the grid planner are extracted as pure, unit-tested functions.

**Tech Stack:** Nuxt 4, Vue 3 (`<script setup>`), TypeScript, VueFlow (canvas), Vitest (`*.unit.spec.ts`), ComfyUI bridge / Replicate (`black-forest-labs/flux-schnell`) via direct WS execution.

## Global Constraints

- **Never auto-run a billable node.** Spawned finishers (Promote/Enhance) are placed focused, never executed automatically. (existing standing rule)
- **Paid-render verification is owed to the user.** Any step whose verification requires a real generation is a manual step the *user* runs; do not silently spend. Mark these steps clearly.
- **Batch stays.** `num_outputs:4` in one prediction is the dispatch; do NOT fan out to parallel predictions in v1.
- **Sketch tier = Flux Schnell at `megapixels:0.25`, `output_format:"webp"`.** No per-sketch model choice in v1.
- **Frontend only.** No Python/ComfyUI/backend file changes. The `flux-schnell` builder already reads `num_outputs` (`comfy_api_nodes/image_models.py:186`).
- **Draft-ness token is dashed + neutral, never pastel/purple** (pastel means AI-affordance). (existing house token)
- **Commit after every task.** Stage only the files that task touches (parallel-session commit hygiene — never `git add -A`).
- Run unit tests with `npx vitest run <file>` (single) or `npm run test:unit` (full). `npm test` is Playwright E2E — not for unit work.

---

## File Structure

**New files:**
- `app/lib/sketch/planSketchCardsAt.ts` — pure: 2×2 grid plan anchored at an explicit top-left point (not a source node). Sibling to the existing `planSketchCards.ts`.
- `app/lib/sketch/sketchIntent.ts` — pure: `looksLikeImageIdea(text, graphIsEmpty)` confidence heuristic for the fast-path.
- `app/lib/sketch/sketchPadPrompt.ts` — pure: build the `flux-schnell` widget/property override bundle for the transient pad node from a prompt + seed.
- `tests/unit/plan-sketch-cards-at.unit.spec.ts`
- `tests/unit/sketch-intent.unit.spec.ts`
- `tests/unit/sketch-pad-prompt.unit.spec.ts`
- `tests/unit/sketch-command-routing.unit.spec.ts`

**Modified files:**
- `app/lib/agent/surfaces/canvas.ts` — add the `sketch` `CommandSpec` + a `sketchRequests(commands)` extractor.
- `app/composables/useCanvasAgent.ts` — intercept `sketch`; add `opts.sketchIdea`.
- `app/components/agent/CanvasPromptBar.vue` — wire `sketchIdea` → `vueCanvas.startSketch`; render both correction chips; fast-path gate + speculative warm.
- `app/components/vue-canvas/VueNodeCanvas.vue` — `sketchPad` state; `startSketch`; `materializeSketchCardsAt`; anchor helper; `executed`-handler routing on `properties.sketchPad`; `keepSketchCard`; expose new methods; exclude pad node from full runs.
- `app/components/vue-canvas/ArtifactImageNode.vue` — loading/skeleton state; "Keep" button; Promote from card-local provenance.
- `app/lib/draft/sketchPromote.ts` — add `sketchPromoteOverridesFromProps(props)` (card-local provenance).
- `app/composables/useNodeSearch.ts` — remove the synthetic `Sketch` entry.
- `app/components/vue-canvas/ComfyNode.vue`, `ComfyNodeWidget.vue`, `widgets/WidgetModelPicker.vue` — remove the locked-Schnell rendering + prop chain + CSS.
- `tests/unit/node-search-sketch.unit.spec.ts` — delete (asserts the removed entry).

---

## Task 1: Pure anchor-based grid planner

**Files:**
- Create: `app/lib/sketch/planSketchCardsAt.ts`
- Test: `tests/unit/plan-sketch-cards-at.unit.spec.ts`

**Interfaces:**
- Produces: `planSketchCardsAt(anchor: { x: number, y: number }, images: string[], existingCardIds: string[]): SketchCardPlan[]` and `SKETCH_PAD_ID = 'sketch-pad'` and `sketchPadCardId(slot: number): string`. `SketchCardPlan` is re-exported from the existing `./planSketchCards` (`{ id, slot, position, image, reuse }`).
- Grid geometry matches `planSketchCards.ts` exactly (CARD_SIZE 200, GAP 24, MAX_CARDS 4) but the top-left of slot 0 sits **at `anchor`** (no source-width/gap offset).

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/plan-sketch-cards-at.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { planSketchCardsAt, sketchPadCardId } from '~/lib/sketch/planSketchCardsAt'

describe('planSketchCardsAt', () => {
  it('lays a 2x2 grid with slot 0 at the anchor', () => {
    const plans = planSketchCardsAt({ x: 100, y: 50 }, ['a', 'b', 'c', 'd'], [])
    expect(plans.map(p => p.position)).toEqual([
      { x: 100, y: 50 },        // slot 0
      { x: 324, y: 50 },        // slot 1: +224 (200+24)
      { x: 100, y: 274 },       // slot 2
      { x: 324, y: 274 },       // slot 3
    ])
    expect(plans.map(p => p.id)).toEqual([
      sketchPadCardId(0), sketchPadCardId(1), sketchPadCardId(2), sketchPadCardId(3),
    ])
    expect(plans.every(p => !p.reuse)).toBe(true)
  })

  it('reuses existing ids per slot and marks reuse', () => {
    const plans = planSketchCardsAt({ x: 0, y: 0 }, ['a', 'b'], ['keepme-0', 'keepme-1'])
    expect(plans[0].id).toBe('keepme-0')
    expect(plans[0].reuse).toBe(true)
    expect(plans[1].id).toBe('keepme-1')
  })

  it('caps at 4 images', () => {
    const plans = planSketchCardsAt({ x: 0, y: 0 }, ['a', 'b', 'c', 'd', 'e'], [])
    expect(plans).toHaveLength(4)
  })

  it('sketchPadCardId is stable per slot', () => {
    expect(sketchPadCardId(2)).toBe('sketch-out-sketch-pad-2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/plan-sketch-cards-at.unit.spec.ts`
Expected: FAIL — cannot find module `~/lib/sketch/planSketchCardsAt`.

- [ ] **Step 3: Write the implementation**

```ts
// app/lib/sketch/planSketchCardsAt.ts
/**
 * Anchor-based sketch grid — the prompt-bar sketch flow has NO source node, so
 * the 2×2 pad is placed at an explicit viewport-derived top-left instead of
 * "right of a node". Geometry mirrors planSketchCards.ts (same card size/gap) so
 * kept cards are indistinguishable from node-spawned ones. (spec:
 * 2026-07-12-sketch-from-the-prompt-bar-design.md §2)
 */
import type { SketchCardPlan } from './planSketchCards'

export type { SketchCardPlan } from './planSketchCards'

export const SKETCH_PAD_ID = 'sketch-pad'

const CARD_SIZE = 200
const GAP = 24
const MAX_CARDS = 4

/** Stable id for a pad slot — reused across re-sketches so refresh overwrites
 *  the same 4 cards instead of piling up. */
export function sketchPadCardId(slot: number): string {
  return `sketch-out-${SKETCH_PAD_ID}-${slot}`
}

export function planSketchCardsAt(
  anchor: { x: number, y: number },
  images: string[],
  existingCardIds: string[],
): SketchCardPlan[] {
  const step = CARD_SIZE + GAP
  return images.slice(0, MAX_CARDS).map((image, slot) => {
    const col = slot % 2
    const row = slot < 2 ? 0 : 1
    const position = { x: anchor.x + col * step, y: anchor.y + row * step }
    const existing = existingCardIds[slot]
    const reuse = !!existing
    const id = reuse ? existing : sketchPadCardId(slot)
    return { id, slot, position, image, reuse }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/plan-sketch-cards-at.unit.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/planSketchCardsAt.ts tests/unit/plan-sketch-cards-at.unit.spec.ts
git commit -m "feat(sketch): pure anchor-based grid planner for prompt-bar sketching"
```

---

## Task 2: Pure intent heuristic (fast-path gate)

**Files:**
- Create: `app/lib/sketch/sketchIntent.ts`
- Test: `tests/unit/sketch-intent.unit.spec.ts`

**Interfaces:**
- Produces: `looksLikeImageIdea(text: string, graphIsEmpty: boolean): boolean`. Returns `true` only for **high-confidence** image ideas (fire render before the classifier resolves). Ambiguous / instruction-shaped text returns `false` (wait for the classifier). Conservative: false negatives are fine (you just wait ~1s); false positives spend ~$0.01, so bias toward `false`.

Heuristic (documented, deterministic):
- Empty text → `false`.
- Starts with an imperative/edit verb referencing the graph (`add`, `remove`, `delete`, `change`, `make`, `set`, `connect`, `blur`, `move`, `turn`, `undo`, `fix`, `wire`, `rename`, `swap`, `replace`) → `false` (it's an edit).
- Ends with `?` or starts with a question word (`what`, `why`, `how`, `where`, `which`, `who`, `can`, `does`, `is`, `are`) → `false` (it's a question).
- Otherwise: descriptive phrase. `true` if `graphIsEmpty` (nothing to edit ⇒ almost certainly a sketch) OR the text is a short-ish noun phrase (≤ 12 words, no trailing imperative). Else `false`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-intent.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { looksLikeImageIdea } from '~/lib/sketch/sketchIntent'

describe('looksLikeImageIdea', () => {
  it('treats a descriptive noun phrase as an idea', () => {
    expect(looksLikeImageIdea('a lighthouse at dusk', false)).toBe(true)
    expect(looksLikeImageIdea('moody cyberpunk alley, neon rain', false)).toBe(true)
  })
  it('rejects graph-edit imperatives', () => {
    expect(looksLikeImageIdea('add a blur node', false)).toBe(false)
    expect(looksLikeImageIdea('make it warmer', false)).toBe(false)
    expect(looksLikeImageIdea('connect these two', false)).toBe(false)
  })
  it('rejects questions', () => {
    expect(looksLikeImageIdea('what does this node do?', false)).toBe(false)
    expect(looksLikeImageIdea('how do I export', false)).toBe(false)
  })
  it('leans toward sketch on an empty canvas', () => {
    expect(looksLikeImageIdea('the dog', true)).toBe(true)
  })
  it('rejects long instruction-like text when the graph is not empty', () => {
    expect(looksLikeImageIdea('go through every node and set the seed to a fixed value please', false)).toBe(false)
  })
  it('rejects empty input', () => {
    expect(looksLikeImageIdea('   ', false)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sketch-intent.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// app/lib/sketch/sketchIntent.ts
/**
 * Fast-path gate: is this prompt-bar text a high-confidence IMAGE IDEA we can
 * render immediately (before the LLM classifier resolves), vs. a graph edit or
 * a question we must let the classifier decide? Conservative on purpose — a
 * miss just costs a ~1s wait; a false positive spends ~$0.01. (spec §6 lever 2)
 */
const EDIT_VERBS = new Set([
  'add', 'remove', 'delete', 'change', 'make', 'set', 'connect', 'blur', 'move',
  'turn', 'undo', 'fix', 'wire', 'rename', 'swap', 'replace', 'increase', 'decrease',
  'crop', 'rotate', 'select', 'group', 'align', 'go',
])
const QUESTION_WORDS = new Set([
  'what', 'why', 'how', 'where', 'which', 'who', 'can', 'does', 'is', 'are', 'do', 'should',
])

export function looksLikeImageIdea(text: string, graphIsEmpty: boolean): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  if (t.endsWith('?')) return false
  const words = t.split(/\s+/)
  const first = words[0]!
  if (EDIT_VERBS.has(first)) return false
  if (QUESTION_WORDS.has(first)) return false
  if (graphIsEmpty) return true
  // Non-empty graph: only fire on a short, descriptive phrase.
  return words.length <= 12
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sketch-intent.unit.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/sketchIntent.ts tests/unit/sketch-intent.unit.spec.ts
git commit -m "feat(sketch): pure fast-path intent heuristic"
```

---

## Task 3: The `sketch` command op + client interception

**Files:**
- Modify: `app/lib/agent/surfaces/canvas.ts` (add `CommandSpec` after the `searchImages` entry ~line 73; add `sketchRequests` near `searchImageRequests` ~lines 178-186)
- Modify: `app/composables/useCanvasAgent.ts` (opts field ~54-56; early-return ~130; dispatch + empty-fall-through ~183-191)
- Test: `tests/unit/sketch-command-routing.unit.spec.ts`

**Interfaces:**
- Consumes: `Command { op, target?, args? }` (from `commandSurface.ts`), the existing `searchImageRequests` pattern.
- Produces: `sketchRequests(commands: Command[]): string[]` (extracts `args.prompt` from every `{op:'sketch'}`); `useCanvasAgent` opts gains `sketchIdea?: (prompt: string) => void`. The model may now emit `{ op: 'sketch', args: { prompt } }`, and it is intercepted (never a proposal card, never reaches `applyCanvasCommand`).

- [ ] **Step 1: Write the failing test** (pure extractor — the interception itself is verified in the browser step of Task 5)

```ts
// tests/unit/sketch-command-routing.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { sketchRequests } from '~/lib/agent/surfaces/canvas'

describe('sketchRequests', () => {
  it('extracts prompts from sketch commands only', () => {
    const cmds = [
      { op: 'sketch', args: { prompt: 'a lighthouse at dusk' } },
      { op: 'setWidget', target: 'n1', args: { name: 'seed', value: 5 } },
      { op: 'sketch', args: { prompt: 'a red door' } },
    ]
    expect(sketchRequests(cmds as any)).toEqual(['a lighthouse at dusk', 'a red door'])
  })
  it('ignores sketch commands without a prompt', () => {
    expect(sketchRequests([{ op: 'sketch', args: {} }] as any)).toEqual([])
  })
  it('returns empty when there are no sketch commands', () => {
    expect(sketchRequests([{ op: 'searchImages', args: { query: 'x' } }] as any)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sketch-command-routing.unit.spec.ts`
Expected: FAIL — `sketchRequests` is not exported.

- [ ] **Step 3: Add the `CommandSpec` and extractor to `canvas.ts`**

Add to the `CANVAS_COMMANDS` array (immediately after the `searchImages` entry at line 73):

```ts
    { op: 'sketch', hint: 'Create a NEW image from scratch that the user described (a subject, scene, or mood) — NOT an edit to existing nodes and NOT a question about the graph. args: { prompt: a clean image-generation prompt you distill from the request }. Use this when the user names something to see/draw/generate ("a lighthouse at dusk", "moody cyberpunk alley") rather than instructing a change. Emit ONE sketch and no generator/edit alongside it; the sketch pad renders 4 fast options.' },
```

Add the extractor next to `searchImageRequests` (~line 186):

```ts
/** Pull the image-idea prompts out of sketch commands (intercept-only, mirrors
 *  searchImageRequests). The sketch flow renders these; they never touch the graph. */
export function sketchRequests(commands: Command[]): string[] {
  return commands
    .filter(c => c.op === 'sketch')
    .map(c => (c.args?.prompt != null ? String(c.args.prompt).trim() : ''))
    .filter(Boolean)
}
```

(Ensure `Command` is already imported in `canvas.ts`; `searchImageRequests` uses it, so it is.)

- [ ] **Step 4: Intercept in `useCanvasAgent.ts`**

(a) Import the extractor — add `sketchRequests` to the existing import from the canvas surface (alongside `searchImageRequests`).

(b) Add the opts field (after line 56, next to `searchImages?`):

```ts
  /** Fire the sketch pad for a `sketch` command's image idea. Intercept-only —
   *  never becomes a proposal card, never touches the graph. */
  sketchIdea?: (prompt: string) => void
```

(c) Early-return in the proposal-build loop (right after the `searchImages` guard at line 130):

```ts
    if (cmd.op === 'sketch') return // intercepted below — fires the sketch pad, never a proposal card
```

(d) Dispatch + empty-fall-through. Where `searchQueries` is handled (~lines 184-190), add the parallel sketch handling:

```ts
      const sketchIdeas = sketchRequests(commands)
      if (sketchIdeas.length && opts.sketchIdea) opts.sketchIdea(sketchIdeas[0]!)
```

and extend the empty-built guard so a lone sketch isn't reported as "couldn't apply":

```ts
      const built = [...graphBuilt, ...tuneBuilt]
      if (!built.length) {
        if (searchQueries.length && opts.searchImages) { answer.value = tuneNotice || message; return }
        if (sketchIdeas.length && opts.sketchIdea) { answer.value = ''; return } // the pad is the response
        answer.value = tuneNotice || message || (commands.length ? 'I couldn’t apply those edits to this graph.' : 'No changes for that — try rephrasing.')
        return
      }
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/unit/sketch-command-routing.unit.spec.ts`
Expected: PASS (3 tests).
Run: `npx vue-tsc --noEmit -p . 2>&1 | tail -5` (typecheck baseline is ~328 errors — confirm no NEW errors in the touched files).

- [ ] **Step 6: Commit**

```bash
git add app/lib/agent/surfaces/canvas.ts app/composables/useCanvasAgent.ts tests/unit/sketch-command-routing.unit.spec.ts
git commit -m "feat(sketch): add intercept-only 'sketch' command to the canvas agent"
```

---

## Task 4: `startSketch` dispatch + anchor materializer + optimistic skeleton

This is the integration core. It reuses today's proven pipeline (a `sketch`-flagged `GenerateImageNode` whose batch result flows through the `executed` handler) but (a) decouples card placement from a persistent source node via `planSketchCardsAt`, (b) drives it from a **transient hidden pad node**, and (c) shows an instant skeleton.

**Files:**
- Create: `app/lib/sketch/sketchPadPrompt.ts` + `tests/unit/sketch-pad-prompt.unit.spec.ts`
- Modify: `app/components/vue-canvas/VueNodeCanvas.vue`
- Modify: `app/components/vue-canvas/ArtifactImageNode.vue` (skeleton state)

**Interfaces:**
- Consumes: `planSketchCardsAt`, `SKETCH_PAD_ID` (Task 1); `createNodeData(nodeType, position, widgetOverrides?, propertyOverrides?)` (`VueNodeCanvas.vue:1429`); `runVueWorkflow(targetIds?, opts?)` (`layouts/default.vue:587`, invoked via the existing `sailor:runFiltered` event or a direct expose); `annotatedImageValueFromViewUrl` (`app/lib/promoteTempImages.ts:47`); `project()` + `.vue-flow` bounds pattern (`VueNodeCanvas.vue:5456-5476`).
- Produces: `VueNodeCanvas.startSketch(prompt: string): Promise<void>` (exposed via `defineExpose`); module-local reactive `sketchPad = reactive({ anchor: null as {x,y}|null, cardIds: [] as string[], seed: 0, prompt: '' })`; `sketchPadPromptOverrides(prompt, seed)` bundle; `materializeSketchCardsAt(anchor, images, opts)`.

### 4a — Pure pad-prompt override bundle

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/sketch-pad-prompt.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { sketchPadPromptOverrides } from '~/lib/sketch/sketchPadPrompt'

describe('sketchPadPromptOverrides', () => {
  it('builds a schnell 4-up webp override bundle carrying the prompt + seed', () => {
    const b = sketchPadPromptOverrides('a lighthouse at dusk', 42)
    expect(b.widgetOverrides.model).toBe('flux-schnell')
    expect(b.widgetOverrides.prompt).toBe('a lighthouse at dusk')
    expect(b.widgetOverrides.seed).toBe(42)
    expect(JSON.parse(b.widgetOverrides.model_options as string)).toMatchObject({
      megapixels: '0.25', num_outputs: 4, output_format: 'webp',
    })
    // The transient node is a pad, not a user-facing sketch node.
    expect(b.propertyOverrides.sketchPad).toBe(true)
  })
})
```

- [ ] **Step 2: Run — fails** (`npx vitest run tests/unit/sketch-pad-prompt.unit.spec.ts`) — module not found.

- [ ] **Step 3: Implement**

```ts
// app/lib/sketch/sketchPadPrompt.ts
/**
 * Widget/property overrides for the TRANSIENT sketch-pad generator node. The pad
 * is invisible plumbing — the user enters via the prompt bar (the visible Sketch
 * node is retired). `sketchPad:true` (not `sketch:true`) marks it so the executed
 * handler routes its batch to the pad materializer and full runs skip it.
 * (spec §2, §6)
 */
export function sketchPadPromptOverrides(prompt: string, seed: number): {
  widgetOverrides: Record<string, unknown>
  propertyOverrides: Record<string, unknown>
} {
  return {
    widgetOverrides: {
      model: 'flux-schnell',
      prompt,
      seed,
      model_options: JSON.stringify({ megapixels: '0.25', num_outputs: 4, output_format: 'webp' }),
    },
    propertyOverrides: { sketchPad: true },
  }
}
```

- [ ] **Step 4: Run — passes.**

- [ ] **Step 5: Commit**

```bash
git add app/lib/sketch/sketchPadPrompt.ts tests/unit/sketch-pad-prompt.unit.spec.ts
git commit -m "feat(sketch): pure transient pad-node override bundle"
```

### 4b — `materializeSketchCardsAt`, skeleton, `startSketch` (VueNodeCanvas)

- [ ] **Step 6: Add per-canvas pad state + the anchor helper**

Near the other `useVueFlow` destructures (`project` is at `VueNodeCanvas.vue:975`), add module-scope reactive state and a helper:

```ts
// Sketch pad (prompt-bar sketching): one disposable 2×2 pad per canvas. Anchor
// + card ids persist across re-sketches so refresh overwrites the same slots.
const sketchPad = reactive<{ anchor: { x: number, y: number } | null, cardIds: string[], seed: number, prompt: string, promptId: string | null }>(
  { anchor: null, cardIds: [], seed: 0, prompt: '', promptId: null },
)

/** Viewport center in graph coords, nudged to the nearest clear spot so the pad
 *  never covers existing cards. Reuses the AABB-nudge from the agent apply path. */
function sketchPadAnchor(): { x: number, y: number } {
  const canvasEl = document.querySelector('.vue-flow') as HTMLElement | null
  const rect = canvasEl?.getBoundingClientRect()
  const centerScreen = rect
    ? { x: rect.width / 2, y: rect.height / 2 }
    : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const c = project(centerScreen)
  // 2×2 pad is ~424×424; offset so the grid is roughly centered on the viewport.
  let p = { x: c.x - 212, y: c.y - 212 }
  const PAD_W = 460, PAD_H = 460, NUDGE = 240
  const occupied = (q: { x: number, y: number }) => nodes.value.some((n: any) => {
    if (n?.data?.properties?.sketchPad) return false
    const nx = n.position?.x ?? 0, ny = n.position?.y ?? 0
    return Math.abs(nx - q.x) < PAD_W && Math.abs(ny - q.y) < PAD_H
  })
  let guard = 0
  while (occupied(p) && guard++ < 40) p = { x: p.x, y: p.y + NUDGE }
  return p
}
```

- [ ] **Step 7: Add `materializeSketchCardsAt`**

An anchor-based sibling of `materializeSketchCards` (`VueNodeCanvas.vue:3069`). It creates/reuses the 4 cards at an explicit anchor, stamps card-local provenance (`sketchPrompt`, `sketchSeed`) so Promote works without a source node, and supports a `loading` skeleton pass.

```ts
/** Place/refresh the 4 pad cards at `anchor`. `images` may be [] for the skeleton
 *  pass (loading shimmer). Reuses ids from sketchPad.cardIds so re-sketches
 *  overwrite the same slots. Returns the card ids in slot order. */
function materializeSketchCardsAt(
  anchor: { x: number, y: number },
  images: string[],
  opts: { loading?: boolean } = {},
): string[] {
  const slotImages = images.length ? images : ['', '', '', '']
  const plans = planSketchCardsAt(anchor, slotImages, sketchPad.cardIds)
  const ids: string[] = []
  for (const plan of plans) {
    ids[plan.slot] = plan.id
    const imageWidgetValue = plan.image ? annotatedImageValueFromViewUrl(plan.image) : null
    const existing = nodes.value.find((n: any) => n.id === plan.id)
    if (existing) {
      existing.data = {
        ...existing.data,
        images: plan.image ? [plan.image] : existing.data.images,
        properties: { ...existing.data.properties, sketchLoading: !!opts.loading },
      }
      if (imageWidgetValue) patchImageWidget(existing, imageWidgetValue) // same helper materializeSketchCards uses
      continue
    }
    const node = createNodeData('Image', plan.position, imageWidgetValue ? { image: imageWidgetValue } : undefined, {
      sketchOutput: true,
      sketchSourceId: SKETCH_PAD_ID,
      sketchSlot: plan.slot,
      sketchPrompt: sketchPad.prompt,
      sketchSeed: sketchPad.seed,
      sketchLoading: !!opts.loading,
    })
    node.id = plan.id
    node.data = { ...node.data, images: plan.image ? [plan.image] : [] }
    nodes.value.push(node)
  }
  sketchPad.cardIds = ids
  return ids
}
```

Note: reuse the exact image-widget patch logic already inside `materializeSketchCards` (lines ~3092-3101) — extract it to a small local `patchImageWidget(node, value)` and call it from both, to keep them DRY.

- [ ] **Step 8: Add `startSketch` + transient pad dispatch**

```ts
/** Prompt-bar entry: render 4 cheap Schnell options for `prompt` at the pad. */
async function startSketch(prompt: string): Promise<void> {
  const clean = prompt.trim()
  if (!clean) return
  sketchPad.prompt = clean
  sketchPad.seed = Math.floor(Math.random() * 2_147_483_647)
  if (!sketchPad.anchor) sketchPad.anchor = sketchPadAnchor()

  // Lever 1 — optimistic skeleton: 4 shimmer cards appear immediately.
  materializeSketchCardsAt(sketchPad.anchor, [], { loading: true })

  // Transient hidden pad node drives the proven dispatch pipeline.
  const { widgetOverrides, propertyOverrides } = sketchPadPromptOverrides(clean, sketchPad.seed)
  let pad = nodes.value.find((n: any) => n.id === SKETCH_PAD_ID) as any
  if (!pad) {
    pad = createNodeData('GenerateImageNode', sketchPad.anchor, widgetOverrides, propertyOverrides)
    pad.id = SKETCH_PAD_ID
    pad.hidden = true // VueFlow: kept out of the rendered graph
    nodes.value.push(pad)
  } else {
    applyWidgetOverrides(pad, widgetOverrides) // reuse the same helper handleAddNode uses
    pad.position = sketchPad.anchor
  }
  await nextTick()
  // Scoped run of just the pad node (never the whole graph). skipCostConfirm:
  // sketches are the cheap tier; the meter still bills normally.
  window.dispatchEvent(new CustomEvent('sailor:runFiltered', { detail: { targetIds: [SKETCH_PAD_ID], direction: 'self' } }))
}
```

Verify the exact scoped-run entry point while implementing: `CanvasPromptBar` already fires `sailor:runFiltered` (`CanvasPromptBar.vue:41`) and `runVueWorkflow` accepts `targetIds`. Confirm `direction:'self'` runs only the pad generator (it is unwired, so there is no downstream). If `runFiltered`'s cost-confirm prompts, thread `skipCostConfirm` through the event detail (add it to the `runFiltered` handler in `layouts/default.vue`).

- [ ] **Step 9: Route the `executed` handler to the pad materializer**

In `handleBridgeMessage`'s `executed` branch (`VueNodeCanvas.vue:2565-2590`), **before** the existing `properties.sketch` fan-out, add pad routing keyed on the pad node id:

```ts
      if (String(nodeId) === SKETCH_PAD_ID && tagged.images && tagged.images.length > 1 && sketchPad.anchor) {
        materializeSketchCardsAt(sketchPad.anchor, tagged.images) // real pass, replaces the skeleton
        return
      }
```

(Keep the existing `target.data.properties.sketch` branch for now; it becomes dead once Task 8 retires the node, and is removed there.)

- [ ] **Step 10: Exclude the pad node from full-graph runs**

Find where a full run collects nodes (the `getWorkflow`/`assembleTake` path in `layouts/default.vue`, or the workflow serialization in `VueNodeCanvas.getWorkflow`). Add a filter so `properties.sketchPad` nodes are only included when explicitly targeted:

```ts
// In getWorkflow (or the full-run node collection): a hidden sketch pad must not
// run on a whole-canvas Run — only via its own scoped startSketch dispatch.
nodes = nodes.filter((n: any) => !n?.data?.properties?.sketchPad)
```

Guard this so a targeted `runFiltered([SKETCH_PAD_ID])` still includes it (the filter applies to the full-graph path only).

- [ ] **Step 11: Add the skeleton/loading render to ArtifactImageNode**

In `ArtifactImageNode.vue`, add a shimmer overlay when `props.data.properties?.sketchLoading` is true (dashed neutral token, never pastel — matches the house draft token). Place it over the image area; remove it when real images land (the reuse pass clears `sketchLoading`).

```vue
<!-- near the image render -->
<div v-if="(data.properties as any)?.sketchLoading" class="sketch-skeleton" aria-label="Sketching…" />
```
```css
.sketch-skeleton {
  position: absolute; inset: 0; border: 1.5px dashed rgba(255,255,255,0.45);
  border-radius: inherit;
  background: linear-gradient(100deg, rgba(255,255,255,0.04) 30%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.04) 70%);
  background-size: 200% 100%; animation: sketch-shimmer 1.1s linear infinite;
}
@keyframes sketch-shimmer { from { background-position: 200% 0 } to { background-position: -200% 0 } }
```

- [ ] **Step 12: Expose `startSketch`**

Add `startSketch` to the `defineExpose` block (`VueNodeCanvas.vue:6390-6468`).

- [ ] **Step 13: Compile-check**

Run the Vite compile check (per repo convention) and typecheck the touched files; confirm no new errors above the ~328 baseline.
Run: `npx vue-tsc --noEmit -p . 2>&1 | tail -5`

- [ ] **Step 14: PAID browser verification (user-run — owed to the user)**

Ask the user to: focus the prompt bar, type "a lighthouse at dusk", submit. Expected: 4 shimmer skeletons appear at a clear viewport spot within ~100ms; ~3–5s later 4 Schnell images replace them; no visible generator node; console shows the pad's `executed` event with 4 images. Screenshot for proof.

- [ ] **Step 15: Commit**

```bash
git add app/components/vue-canvas/VueNodeCanvas.vue app/components/vue-canvas/ArtifactImageNode.vue
git commit -m "feat(sketch): startSketch — transient pad dispatch, anchor cards, optimistic skeleton"
```

---

## Task 5: Wire the prompt bar + refresh-in-place + keep

**Files:**
- Modify: `app/components/agent/CanvasPromptBar.vue` (wire `sketchIdea`)
- Modify: `app/components/vue-canvas/VueNodeCanvas.vue` (`keepSketchCard`, expose it; refresh reuse already handled by `sketchPad.cardIds`)
- Modify: `app/components/vue-canvas/ArtifactImageNode.vue` (Keep button)

**Interfaces:**
- Consumes: `startSketch` (Task 4), `sketchPad.cardIds`.
- Produces: `VueNodeCanvas.keepSketchCard(cardId: string): void` (exposed); a `sailor:keepSketchCard` event handler; a "Keep" button on sketch-output cards.

- [ ] **Step 1: Wire `sketchIdea` in CanvasPromptBar**

In the `useCanvasAgent({...})` options object (`CanvasPromptBar.vue:27-48`), add (next to `searchImages` at line 46-47):

```ts
  // A typed image idea → the model emits `sketch` and the pad renders 4 options.
  sketchIdea: (prompt: string) => { if (ready.value) props.vueCanvas.startSketch?.(prompt) },
```

Add `startSketch` to the `ready` computed (`CanvasPromptBar.vue:22`) if you want a hard guard, or rely on the optional-chain above.

- [ ] **Step 2: Implement `keepSketchCard` (refresh reuse is automatic)**

Because `materializeSketchCardsAt` reuses `sketchPad.cardIds`, a second `startSketch` already overwrites the same 4 slots — **refresh-in-place needs no new code**. "Keep" = remove a card from the reuse set and strip its sketch identity so the next refresh can't overwrite it:

```ts
/** Pin a pad card: it becomes an ordinary Image card and drops out of the pad's
 *  refresh set (its slot frees for the next sketch). */
function keepSketchCard(cardId: string): void {
  const card = nodes.value.find((n: any) => n.id === cardId) as any
  if (!card) return
  const p = { ...card.data.properties }
  delete p.sketchOutput; delete p.sketchSourceId; delete p.sketchSlot
  delete p.sketchLoading; delete p.sketchPrompt; delete p.sketchSeed
  card.data = { ...card.data, properties: p }
  // Give it a fresh, untracked id so a refresh's slot id can't collide with it.
  const freshId = `image-${cryptoRandomId()}` // reuse the repo's id helper
  reassignNodeId(card, freshId) // update nodes.value + any edges; reuse existing rename util if present
  sketchPad.cardIds = sketchPad.cardIds.filter(id => id !== cardId)
}
```

While implementing, check for an existing node-id / uuid helper (the codebase already generates node ids in `createNodeData`) and an existing id-reassign path; reuse them rather than hand-rolling. If none exists, mutate `card.id` directly and, since pad cards are unwired, no edge fix-up is needed.

- [ ] **Step 3: Expose + event bridge**

Add `keepSketchCard` to `defineExpose`, and add a `sailor:keepSketchCard` window listener (mirroring `sailor:promoteSketchOutput` at `VueNodeCanvas.vue:4036`-ish) that calls it, so the card component can fire it without a direct ref.

- [ ] **Step 4: Add the Keep button to ArtifactImageNode**

In the `v-if="isSketchOutput"` footer (`ArtifactImageNode.vue:1037-1052`), add a primary "Keep" action alongside Enhance/Promote:

```ts
function keep() { window.dispatchEvent(new CustomEvent('sailor:keepSketchCard', { detail: { cardId: props.id } })) }
```
```vue
<button class="sketch-action" @click.stop="keep">Keep</button>
```

- [ ] **Step 5: Compile-check** (Vite compile check + `npx vue-tsc --noEmit -p . 2>&1 | tail -5`).

- [ ] **Step 6: PAID browser verification (user-run)**

User: sketch an idea → 4 options; tweak the text, sketch again → the same 4 slots refresh in place (canvas does not accumulate); click **Keep** on one → its dashed affordance/buttons vanish (it's a plain Image card) and the next sketch refills only the freed slot. Screenshot.

- [ ] **Step 7: Commit**

```bash
git add app/components/agent/CanvasPromptBar.vue app/components/vue-canvas/VueNodeCanvas.vue app/components/vue-canvas/ArtifactImageNode.vue
git commit -m "feat(sketch): wire prompt bar, in-place refresh, and keep"
```

---

## Task 6: Misfire correction chips

**Files:**
- Modify: `app/components/agent/CanvasPromptBar.vue`

**Interfaces:**
- Consumes: `answer`, `changes`, `lastPhrase` behavior; `ask()` and the new `sketchIdea` path. Uses the `FixChip`-style inline affordance already imported in the composable, or a small local chip.
- Produces: after a sketch fires, a chip *"Sketched this · edit the canvas instead?"* that re-runs the phrase as a forced edit; after an edit proposal appears, a chip *"…or sketch it?"* that calls `startSketch(lastPhrase)`.

- [ ] **Step 1: Track the last routed intent + phrase in CanvasPromptBar**

Add local refs `lastSketchPhrase = ref('')` (set inside the `sketchIdea` handler) and reuse the composable's proposal state (`changes`) to know an edit was proposed. Keep the raw submitted text (the bar already holds the input value before `ask`).

- [ ] **Step 2: Render the two chips**

After a sketch (when `lastSketchPhrase.value` is set and no proposal is showing), render:

```vue
<button v-if="lastSketchPhrase && !changes.length" class="correction-chip" @click="forceEdit">
  Sketched this · edit the canvas instead?
</button>
```

After an edit proposal (`changes.length`), render:

```vue
<button v-if="changes.length && lastSubmitted" class="correction-chip" @click="sketchInstead">
  …or sketch it?
</button>
```

- [ ] **Step 3: Implement the handlers**

```ts
function forceEdit() {
  const phrase = lastSketchPhrase.value
  lastSketchPhrase.value = ''
  // Re-run through the agent with a directive that forbids the sketch route.
  ask(`Treat this strictly as a canvas EDIT instruction, not an image idea to sketch: ${phrase}`)
}
function sketchInstead() {
  if (ready.value && lastSubmitted.value) props.vueCanvas.startSketch?.(lastSubmitted.value)
  dismiss() // clear the proposal
}
```

`ask` and `dismiss` are already destructured from `useCanvasAgent` (`CanvasPromptBar.vue:25-26`). The directive prefix mirrors the `reroll` re-ask pattern (`useCanvasAgent.ts:211-212`). Confirm the classifier honors the "strictly … not an image idea" directive during the browser step; if it still routes to sketch, strengthen the prefix (e.g. prepend "Do NOT emit a sketch command.").

- [ ] **Step 4: Compile-check** (Vite + `vue-tsc` tail).

- [ ] **Step 5: PAID browser verification (user-run)**

User: type "add a warm glow" and if it sketches, the "edit instead" chip flips it to an edit proposal; type "a lighthouse" and if it proposes an edit, "…or sketch it?" fires the pad. Screenshot both.

- [ ] **Step 6: Commit**

```bash
git add app/components/agent/CanvasPromptBar.vue
git commit -m "feat(sketch): two-way misfire correction chips"
```

---

## Task 7: Fast-path + speculative warm

**Files:**
- Modify: `app/components/agent/CanvasPromptBar.vue`
- Modify: `app/components/vue-canvas/VueNodeCanvas.vue` (a `warmSketch()` expose)

**Interfaces:**
- Consumes: `looksLikeImageIdea` (Task 2), `startSketch` (Task 4), `props.vueCanvas.getNodes()` (to know if the graph is empty).
- Produces: submit handler fires `startSketch` immediately for a high-confidence idea (classifier still runs, only to arm the correction chip); `VueNodeCanvas.warmSketch()` fires a debounced, cooldown-gated single-output throwaway Schnell dispatch on bar focus.

- [ ] **Step 1: Fast-path on submit**

In the bar's submit handler (where it currently calls `ask(text)`):

```ts
const graphEmpty = (props.vueCanvas?.getNodes?.() ?? []).length === 0
if (looksLikeImageIdea(text, graphEmpty)) {
  lastSketchPhrase.value = text
  props.vueCanvas.startSketch?.(text)   // fire NOW — don't wait for the classifier
  ask(text)                             // classifier still runs; used only to arm the "edit instead?" chip
} else {
  ask(text)                             // ambiguous → let the classifier decide (it may still emit `sketch`)
}
```

Guard: if the classifier later emits a real graph edit for a fast-pathed idea, that's the misfire case the chip covers. When the classifier ALSO emits `sketch`, `sketchIdea` must not double-fire — dedupe by ignoring a `sketchIdea` whose prompt equals `lastSketchPhrase.value` set in this submit tick.

- [ ] **Step 2: Speculative warm on focus**

```ts
// VueNodeCanvas expose:
let lastWarm = 0
async function warmSketch(): Promise<void> {
  const now = performance.now()
  if (now - lastWarm < 180_000) return // cooldown: at most once per 3 min
  lastWarm = now
  // Fire a single-output throwaway Schnell dispatch; discard the result.
  // Reuse the transient-pad plumbing with num_outputs:1 and a `warm:true` flag so
  // the executed handler ignores it (no cards).
  // ... (build a 1-output pad prompt, queueSmart, ignore result) ...
}
```

In CanvasPromptBar, call `props.vueCanvas.warmSketch?.()` on the input's `@focus` (debounced). **This lever spends a small real amount (~$0.003/warm) and its ROI must be confirmed live** — if the flux-schnell public endpoint is already reliably warm in practice, gate `warmSketch` behind a local setting (default off) rather than firing unconditionally. Decide during the browser step.

- [ ] **Step 3: Compile-check** (Vite + `vue-tsc` tail). Unit: extend `tests/unit/sketch-intent.unit.spec.ts` only if new heuristic branches were added.

- [ ] **Step 4: PAID browser verification (user-run)**

User: with an empty canvas, type an idea and submit — the pad fires visibly before the agent "thinking" indicator would have resolved (fast-path). Focus the bar and confirm at most one warm dispatch per cooldown in the network log. Screenshot / network trace.

- [ ] **Step 5: Commit**

```bash
git add app/components/agent/CanvasPromptBar.vue app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(sketch): fast-path submit + speculative warm"
```

---

## Task 8: Retire the Sketch node

**Files:**
- Modify: `app/composables/useNodeSearch.ts` (remove the synthetic entry)
- Delete: `tests/unit/node-search-sketch.unit.spec.ts`
- Modify: `app/components/vue-canvas/ComfyNode.vue` (remove `isSketch` rendering)
- Modify: `app/components/vue-canvas/ComfyNodeWidget.vue` (remove `modelPickerLocked` prop pass-through)
- Modify: `app/components/vue-canvas/widgets/WidgetModelPicker.vue` (remove `locked` static-label branch)
- Modify: `app/components/vue-canvas/VueNodeCanvas.vue` (remove the now-dead `properties.sketch` branch in the `executed` handler + `materializeSketchCards`/`planSketchCards` if no longer used)

**Interfaces:** No new interfaces. Removes: `SYNTHETIC_NODE_ENTRIES`' `Sketch` entry; `ComfyNode`'s `isSketch` computed + sketch chip + `:model-picker-locked`/`:sketch` bindings + `.comfy-node--sketch` CSS; the `modelPickerLocked`/`locked` prop chain; the `executed`-handler `properties.sketch` fan-out.

- [ ] **Step 1: Remove the synthetic search entry**

In `useNodeSearch.ts:43-56`, delete the `Sketch` object from `SYNTHETIC_NODE_ENTRIES` (leave the array, now possibly empty — keep the export).

- [ ] **Step 2: Delete the obsolete test**

```bash
git rm tests/unit/node-search-sketch.unit.spec.ts
```

- [ ] **Step 3: Remove the ComfyNode sketch rendering**

Remove, in `ComfyNode.vue`: the `isSketch` computed (line 123), the sketch header chip (1334-1336), `:model-picker-locked="isSketch && ..."` (1485), the two `:sketch="isSketch && ..."` bindings (1843, 1856), the `promoteTake` sketch gating (236-245) if it only served the node, the `'comfy-node--sketch': isSketch` class (1287), and the `.comfy-node--sketch` CSS (2016-2021).

- [ ] **Step 4: Remove the lock prop chain**

`ComfyNodeWidget.vue`: remove `modelPickerLocked` prop (27) and `:locked="modelPickerLocked"` (429). `WidgetModelPicker.vue`: remove the `locked` prop (31) and the `v-if="locked"` static-label branch (93-97).

- [ ] **Step 5: Remove the dead `executed`-handler branch**

In `VueNodeCanvas.vue`, delete the `target.data?.properties?.sketch && ...` fan-out (2584-2586) and the old `materializeSketchCards` (3069) + its `planSketchCards` import **if** nothing else references them (the pad flow uses `materializeSketchCardsAt`/`planSketchCardsAt`). Grep first:

```bash
grep -rn "materializeSketchCards\b\|planSketchCards\b\|properties?.sketch\b\|'sketch'" app | grep -v sketchPad | grep -v SketchCardsAt
```

Remove only what is now unreferenced. Keep `sketchOutput`/`sketchSourceId` (still used by the pad cards).

- [ ] **Step 6: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS. No test references the deleted `Sketch` entry (Task 8 Step 2 removed the only one). `plan-sketch-cards.unit.spec.ts` and `sketch-promote.unit.spec.ts` still pass (their libs remain).

- [ ] **Step 7: Compile-check** (`npx vue-tsc --noEmit -p . 2>&1 | tail -5` — no new errors) + Vite compile check.

- [ ] **Step 8: Browser smoke (no paid render needed)**

User or dev: open node search (Space) and confirm **no "Sketch" entry**; open an existing generator and confirm its model picker is a normal live dropdown (no "locked on sketch" label). Screenshot.

- [ ] **Step 9: Commit**

```bash
git add app/composables/useNodeSearch.ts app/components/vue-canvas/ComfyNode.vue app/components/vue-canvas/ComfyNodeWidget.vue app/components/vue-canvas/widgets/WidgetModelPicker.vue app/components/vue-canvas/VueNodeCanvas.vue
git rm tests/unit/node-search-sketch.unit.spec.ts
git commit -m "refactor(sketch): retire the user-facing Sketch node (prompt bar supersedes it)"
```

---

## Task 9: Promote/Enhance from card-local provenance

The old Promote looked up the source node by `sketchSourceId` and resolved its active take (`handlePromoteSketchOutput`, `VueNodeCanvas.vue:3126-3143`). Pad cards have no persistent source, so Promote must build from the card's own `sketchPrompt`/`sketchSeed` (stamped in Task 4). Enhance already operates on the card's image and needs no change.

**Files:**
- Modify: `app/lib/draft/sketchPromote.ts` (add a props-based builder)
- Modify: `app/components/vue-canvas/VueNodeCanvas.vue` (`handlePromoteSketchOutput` uses card-local provenance)
- Test: extend `tests/unit/sketch-promote.unit.spec.ts`

**Interfaces:**
- Consumes: existing `sketchPromoteOverridesFor(take)` (`sketchPromote.ts:12`).
- Produces: `sketchPromoteOverridesFromProps(props: { sketchPrompt?: string, sketchSeed?: number, aspect_ratio?: string }): { widgetOverrides, propertyOverrides } | null` — same shape as `sketchPromoteOverridesFor` (copies prompt/seed, locks seed, never model).

- [ ] **Step 1: Write the failing test** (extend the existing spec)

```ts
// append to tests/unit/sketch-promote.unit.spec.ts
import { sketchPromoteOverridesFromProps } from '~/lib/draft/sketchPromote'

describe('sketchPromoteOverridesFromProps', () => {
  it('builds overrides from card-local provenance and locks the seed', () => {
    const o = sketchPromoteOverridesFromProps({ sketchPrompt: 'a red door', sketchSeed: 7 })
    expect(o?.widgetOverrides.prompt).toBe('a red door')
    expect(o?.widgetOverrides.seed).toBe(7)
    expect(o?.widgetOverrides.model).toBeUndefined()
    expect(o?.propertyOverrides.seedLocks).toEqual({ seed: true })
  })
  it('returns null with no prompt', () => {
    expect(sketchPromoteOverridesFromProps({})).toBeNull()
  })
})
```

- [ ] **Step 2: Run — fails** (`npx vitest run tests/unit/sketch-promote.unit.spec.ts`).

- [ ] **Step 3: Implement `sketchPromoteOverridesFromProps`**

```ts
// app/lib/draft/sketchPromote.ts — add alongside sketchPromoteOverridesFor
export function sketchPromoteOverridesFromProps(props: {
  sketchPrompt?: string
  sketchSeed?: number
  aspect_ratio?: string
}): { widgetOverrides: Record<string, unknown>, propertyOverrides: Record<string, unknown> } | null {
  const prompt = props.sketchPrompt?.trim()
  if (!prompt) return null
  const widgetOverrides: Record<string, unknown> = { prompt }
  if (props.aspect_ratio) widgetOverrides.aspect_ratio = props.aspect_ratio
  const propertyOverrides: Record<string, unknown> = {}
  if (typeof props.sketchSeed === 'number') {
    widgetOverrides.seed = props.sketchSeed
    propertyOverrides.seedLocks = { seed: true }
  }
  return { widgetOverrides, propertyOverrides }
}
```

- [ ] **Step 4: Point the promote handler at card-local provenance**

In `handlePromoteSketchOutput` (`VueNodeCanvas.vue:3126-3143`): when the event's card is a pad card (`sketchSourceId === SKETCH_PAD_ID` or the source node no longer exists), build overrides from the *card's* properties via `sketchPromoteOverridesFromProps(card.data.properties)` instead of resolving a source take, then dispatch `sailor:spawnBeside` with `nodeType:'GenerateImageNode'` as it does today. Change the event payload from `{ sketchSourceId }` to `{ cardId }` (emitted by `ArtifactImageNode.vue:450-454`) so the handler can read the clicked card directly.

- [ ] **Step 5: Run tests** (`npx vitest run tests/unit/sketch-promote.unit.spec.ts` → PASS) + compile-check.

- [ ] **Step 6: PAID browser verification (user-run)**

User: on a pad card, **Enhance** spawns a focused Clarity (`EnhanceDetailNode`) fed by that exact image (not auto-run); **Promote** spawns a focused full `GenerateImageNode` beside it with the sketch's prompt + locked seed (not auto-run). Screenshot both spawns.

- [ ] **Step 7: Commit**

```bash
git add app/lib/draft/sketchPromote.ts app/components/vue-canvas/VueNodeCanvas.vue app/components/vue-canvas/ArtifactImageNode.vue tests/unit/sketch-promote.unit.spec.ts
git commit -m "feat(sketch): promote/enhance pad cards from card-local provenance"
```

---

## Self-Review

**Spec coverage:**
- §1 auto-detect + interception → Task 3 (op + routing), Task 6 (misfire chips). ✓
- §1 fast-path (load-bearing) → Task 2 (heuristic) + Task 7 (wiring). ✓
- §2 sketch pad, viewport anchor, `planSketchCards` reuse, headless dispatch (discovery → Option B) → Task 1 + Task 4. ✓
- §3 refresh-in-place + keep → Task 5. ✓
- §4 Enhance/Promote → Task 9 (with the card-local-provenance change the transient-node choice forces). ✓
- §5 retire the Sketch node → Task 8. ✓
- §6 latency: batch stays (constraint), skeleton (Task 4), fast-path (Task 7), speculative warm (Task 7), WebP (Task 4a `output_format:webp`). ✓

**Placeholder scan:** Integration steps in Tasks 4–9 name exact files/lines/functions and give the novel code; a few steps say "reuse the existing helper X (confirm while implementing)" where the exact private helper (image-widget patch, id-reassign, widget-override apply) is an internal of a 6000-line component — these are pointers to real, named code the implementer will see, not vague instructions. No "TODO/TBD/add error handling" placeholders.

**Type consistency:** `SketchCardPlan` re-exported from `planSketchCards` and used by `planSketchCardsAt` (Task 1). `SKETCH_PAD_ID` defined in Task 1, consumed in Tasks 4/8/9. `sketchPad` shape defined in Task 4, consumed in Tasks 4/5/7. `sketchPadPromptOverrides` (Task 4a) returns the `{widgetOverrides, propertyOverrides}` shape `createNodeData` expects. Card provenance props (`sketchPrompt`, `sketchSeed`) stamped in Task 4, consumed in Task 9. `sketchPromoteOverridesFromProps` mirrors `sketchPromoteOverridesFor`'s return shape. ✓

**Known risk carried forward (validated at the paid steps):** the scoped `runFiltered([SKETCH_PAD_ID], 'self')` running an unwired generator, and `pad.hidden=true` being honored by this VueFlow version, are the two assumptions the Task 4 browser step proves. If `hidden` is not respected, fall back to positioning the pad off the visible area is NOT viable (cards derive from its position) — instead render the pad node with a zero-size/opacity style, or remove the pad node immediately after each dispatch and recreate per sketch (cardIds live in `sketchPad`, not on the node, so removal is safe). This fallback is pre-authorized by the plan.
