# Sketch Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drafting as a node — a "Sketch" preset in node search that spawns a schnell-configured GenerateImageNode with a dashed card skin, whose takes promote by spawning a full-quality generator beside it.

**Architecture:** Frontend-only. Sketch = GenerateImageNode + `widgetOverrides` + `propertyOverrides:{sketch:true}` via the existing addNode plumbing; a synthetic entry injected into useNodeSearch; card skin keyed off `data.properties.sketch` in the generic node card; promote-beside reuses the SpaceType spawn pattern (source-relative placement at VueNodeCanvas.vue ~2846).

**Tech Stack:** Vue 3 + TS (Nuxt 4), vitest in `frontend/tests/unit/`.

**Spec:** `docs/superpowers/specs/2026-07-08-sketch-node-design.md`

## Global Constraints

- Work on `main`, never branch; stage explicit paths, NEVER `git add -A` (parallel sessions keep WIP in the tree — isolate hunks like prior tasks).
- Sketch visual token: dashed + neutral (white/black) + PencilLine — NEVER pastel-gradient, NEVER purple.
- Promote-spawned node is placed focused, NEVER auto-run.
- No new node class_type, no Python changes.
- Full suite gate on every task: `cd frontend && npx vitest run` → exactly the same pre-existing failures as before your change, nothing new; `npx vue-tsc --noEmit` grep for your touched files → no new errors.

---

### Task 1: "Sketch" entry in node search

**Files:**
- Modify: `frontend/app/composables/useNodeSearch.ts`
- Test: `frontend/tests/unit/node-search-sketch.unit.spec.ts`

**Interfaces:**
- Produces: exported `SYNTHETIC_NODE_ENTRIES: SyntheticNodeEntry[]` where `SyntheticNodeEntry = { name: string; displayName: string; description: string; keywords: string[]; addAs: { nodeType: string; widgetOverrides?: Record<string, unknown>; propertyOverrides?: Record<string, unknown>; dataOverrides?: Record<string, unknown> } }`; `addNode` gains support for being called with a synthetic entry name (resolves via the table before dispatching).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/node-search-sketch.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { SYNTHETIC_NODE_ENTRIES } from '~/composables/useNodeSearch'

describe('synthetic node entries', () => {
  it('contains the Sketch preset mapping to a schnell GenerateImageNode', () => {
    const sketch = SYNTHETIC_NODE_ENTRIES.find(e => e.name === 'Sketch')
    expect(sketch).toBeTruthy()
    expect(sketch!.displayName).toBe('Sketch')
    expect(sketch!.keywords).toEqual(expect.arrayContaining(['draft', 'fast', 'cheap', 'sketch']))
    expect(sketch!.addAs.nodeType).toBe('GenerateImageNode')
    expect(sketch!.addAs.widgetOverrides).toMatchObject({ model: 'flux-schnell' })
    expect(JSON.parse(String(sketch!.addAs.widgetOverrides!.model_options))).toMatchObject({ megapixels: '0.5' })
    expect(sketch!.addAs.propertyOverrides).toEqual({ sketch: true })
  })
})
```

- [ ] **Step 2: Run to verify it fails** — `cd frontend && npx vitest run tests/unit/node-search-sketch.unit.spec.ts` → FAIL (no export)

- [ ] **Step 3: Implement**

In `useNodeSearch.ts`:

```ts
export interface SyntheticNodeEntry {
  name: string
  displayName: string
  description: string
  keywords: string[]
  addAs: { nodeType: string; widgetOverrides?: Record<string, unknown>; propertyOverrides?: Record<string, unknown>; dataOverrides?: Record<string, unknown> }
}

/** Frontend-only presets surfaced in node search alongside real node types. */
export const SYNTHETIC_NODE_ENTRIES: SyntheticNodeEntry[] = [
  {
    name: 'Sketch',
    displayName: 'Sketch',
    description: 'Fast, cheap draft images (~10× faster) — iterate here, promote the winner to full quality.',
    keywords: ['draft', 'fast', 'cheap', 'sketch', 'idea', 'schnell'],
    addAs: {
      nodeType: 'GenerateImageNode',
      widgetOverrides: { model: 'flux-schnell', model_options: '{"megapixels":"0.5"}' },
      propertyOverrides: { sketch: true },
      dataOverrides: { title: 'Sketch' },
    },
  },
]
```

Then wire it into the search results and the add path:
1. In `fetchNodeTypes()`, after `types.sort(...)`, prepend synthetic entries as `NodeType`-shaped items (`{ name: e.name, displayName: e.displayName, description: e.description, category: 'presets', source: 'essentials', inputs: [], outputs: [] }`).
2. Register their keywords so ranking finds them: merge `{ [e.name]: e.keywords }` into the keyword map passed to `searchNodes` (pass a merged object instead of the bare `NODE_KEYWORDS` import at the `filteredNodes` computed).
3. In `addNode(nodeType, opts)`, FIRST check `SYNTHETIC_NODE_ENTRIES.find(e => e.name === nodeType)`; when hit, dispatch `comfynext:addNode` with the entry's `addAs` fields merged with any caller opts (caller opts win), then `closeNodeSearch()` and return. (The Vue-canvas event handler already supports widget/property/dataOverrides — Task 8 of the previous epic added dataOverrides.)

Check how `addNode` currently builds the event detail and keep its LiteGraph fallback branch untouched (synthetic entries are Vue-canvas-only; in LiteGraph mode, fall back to adding the raw `GenerateImageNode` with widgetOverrides only).

- [ ] **Step 4: Run tests** — the new spec + `npx vitest run` full (unchanged failures) + `npx vue-tsc --noEmit 2>&1 | grep -i useNodeSearch || echo CLEAN`

- [ ] **Step 5: Commit** — `git add frontend/app/composables/useNodeSearch.ts frontend/tests/unit/node-search-sketch.unit.spec.ts && git commit -m "feat(sketch): Sketch preset entry in node search"`

---

### Task 2: Sketch card skin

**Files:**
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue` (the generic node card — verify GenerateImageNode renders through it; `data.properties` access pattern precedent at ~:599–609, seedLocks)

**Interfaces:**
- Consumes: `props.data.properties.sketch` (set by Task 1's propertyOverrides; persisted with the node like seedLocks).

- [ ] **Step 1: Confirm rendering path** — verify GenerateImageNode cards render via ComfyNode.vue (grep how node types map to card components in VueNodeCanvas). If a different card renders it, apply the same skin there and note it in the report.

- [ ] **Step 2: Implement the skin**

In the card component: a computed `const isSketch = computed(() => !!(props.data?.properties as any)?.sketch)`. Apply:
- Dashed ring on the card's root frame element: bind `:class="isSketch ? 'ring-1 ring-dashed-sketch' : ''"` — implement as `outline: 1.5px dashed rgba(255,255,255,0.45); outline-offset: 2px` via a scoped class (Tailwind has no dashed ring; use outline, which doesn't affect layout).
- A header chip after the title: `<span v-if="isSketch" class="ml-1.5 inline-flex items-center gap-1 rounded-[3px] border border-dashed border-white/50 bg-black/40 px-1 py-px text-[9px] text-white/70"><PencilLine class="size-2.5" /> sketch</span>` (add PencilLine to the card's lucide imports).

No pastel, no purple. Keep both hunks minimal — this file is shared.

- [ ] **Step 3: Gates** — full `npx vitest run` (unchanged) + `npx vue-tsc --noEmit 2>&1 | grep -i ComfyNode || echo CLEAN` (pre-existing hits only — list them).

- [ ] **Step 4: Commit** — `git add <the card file(s)> && git commit -m "feat(sketch): dashed card skin + header chip for sketch nodes"`

---

### Task 3: Promote spawns the final generator beside the sketch

**Files:**
- Create: `frontend/app/lib/draft/sketchPromote.ts`
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (`promoteTake` branches on sketch lineage)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (spawn-beside handler)
- Test: `frontend/tests/unit/sketch-promote.unit.spec.ts`

**Interfaces:**
- Produces: `sketchPromoteOverridesFor(take: Take): { widgetOverrides: Record<string, unknown>; propertyOverrides: Record<string, unknown> } | null` — from `take.params`: `prompt`, `seed`, `aspect_ratio` when present (NO `model` — schema default is the finisher); `propertyOverrides = { seedLocks: { seed: true } }` when a seed exists, `{}` otherwise. Null when params carry none of the three.
- Produces: window event `comfynext:spawnBeside` handled in VueNodeCanvas: `detail = { sourceNodeId: string; nodeType: string; widgetOverrides?; propertyOverrides?; dataOverrides? }` — creates the node at `source.position.x + width + 80` (copy the placement math from `handleSpaceTypeOutput`, VueNodeCanvas.vue ~2846–2852), pushes it, focuses it (reuse however addNode/fast-lane focuses — e.g. the frameNodes/fitView helper used elsewhere), NO edge, NO run.

- [ ] **Step 1: DISCOVERY (do this before writing code, record findings in your report)**

Trace where a GenerateImageNode run's takes actually land: read the two `appendTake` call sites in VueNodeCanvas.vue and determine which node(s) receive takes when a generator runs wired to an Image sink — the generator card, the sink, or both. Then:
- (a) If takes land on the **Image sink**: `promoteTake` in ArtifactImageNode must detect sketch lineage by walking edges upstream from `props.id` to the producing generator and checking its `data.properties.sketch`. Spawn-beside uses THAT generator as `sourceNodeId`.
- (b) If takes land on the **generator card itself** (and it renders a TakesStrip): put the sketch-promote branch where that strip's promote handler lives instead, `sourceNodeId = props.id`.
- (c) **Contingency check from the previous epic:** `tagTakeFromRunMeta` consults `draftMetaFor(nodeId)` with the take-bearing node's id, but draft marks are keyed by the OVERRIDDEN generator's id. If discovery shows takes land on sinks (different id), the draft badge from the mode toggle never fires — fix it in this task: at the sink's appendTake site, when `draftMetaFor(target.id)` misses, walk one step upstream to the producing generator and consult its id instead (both for draft meta and pending promote). Add this to the report explicitly (found/not-found, fixed/not-needed).

- [ ] **Step 2: Failing test for the pure builder**

```ts
// frontend/tests/unit/sketch-promote.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { sketchPromoteOverridesFor } from '~/lib/draft/sketchPromote'
import type { Take } from '~/composables/useTakes'

const take = (params: Record<string, any>): Take => ({ id: 't', createdAt: 0, promptId: null, params })

describe('sketchPromoteOverridesFor', () => {
  it('copies prompt/seed/aspect, locks the seed, never copies model', () => {
    const r = sketchPromoteOverridesFor(take({ prompt: 'a cat', seed: 42, aspect_ratio: '1:1', model: 'flux-schnell' }))
    expect(r!.widgetOverrides).toEqual({ prompt: 'a cat', seed: 42, aspect_ratio: '1:1' })
    expect(r!.propertyOverrides).toEqual({ seedLocks: { seed: true } })
  })
  it('omits seed lock when no seed; null when nothing usable', () => {
    expect(sketchPromoteOverridesFor(take({ prompt: 'x' }))!.propertyOverrides).toEqual({})
    expect(sketchPromoteOverridesFor(take({ model: 'flux-schnell' }))).toBeNull()
  })
})
```

- [ ] **Step 3: Implement** builder + `comfynext:spawnBeside` handler (placement math copied from handleSpaceTypeOutput; register/unregister with the other listeners at ~3650/3708) + the sketch branch in the promote handler per discovery:

```ts
function promoteTake(takeId: string) {
  const take = (props.data.takes ?? []).find((t: any) => t.id === takeId)
  if (!take) return
  const sketchSource = findUpstreamSketchGenerator() // per discovery (a)/(b); returns node id or null
  if (sketchSource) {
    const built = sketchPromoteOverridesFor(take)
    if (!built) return
    window.dispatchEvent(new CustomEvent('comfynext:spawnBeside', {
      detail: { sourceNodeId: sketchSource, nodeType: 'GenerateImageNode', ...built, dataOverrides: { title: undefined } },
    }))
    return
  }
  /* existing in-place promote path unchanged below */
}
```

(Adapt names to the real code; the existing in-place path must keep working for mode-created draft takes.)

- [ ] **Step 4: Gates** — new spec green; `npx vitest run` full (unchanged failures); `npx vue-tsc --noEmit` grep on touched files (pre-existing only). Isolate hunks from parallel WIP as prior tasks did.

- [ ] **Step 5: Browser sanity (no paid render needed):** dev server on 127.0.0.1 → Space → type "sketch" → entry appears → add → card lands with dashed outline + sketch chip + schnell model + megapixels 0.5 in model_options. Screenshot. (Promote round-trip needs a paid render — deferred to user sign-off like the previous epic.)

- [ ] **Step 6: Commit** — `git add frontend/app/lib/draft/sketchPromote.ts frontend/tests/unit/sketch-promote.unit.spec.ts frontend/app/components/vue-canvas/ArtifactImageNode.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue && git commit -m "feat(sketch): promote spawns full generator beside the sketch node"`

---

## Self-review notes

- Spec coverage: search entry (T1), card skin (T2), promote-beside + mode-toggle-untouched + never-auto-run (T3). Out-of-scope items respected.
- The discovery step in T3 is deliberate: take-bearing-node identity was never proven under a real generator run (paid-render verification deferred in the previous epic), and the answer changes both this task's wiring and possibly a latent keying bug from the mode work (contingency (c)).
- Type consistency: `SyntheticNodeEntry.addAs` mirrors the addNode event detail exactly; `sketchPromoteOverridesFor` returns the two override bags `comfynext:spawnBeside` forwards verbatim.
