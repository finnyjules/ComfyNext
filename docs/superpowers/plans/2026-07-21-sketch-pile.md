# Sketch Pile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sketch results land as one messy-pile deck node (like Smart Layout's BatchGrid) instead of 4 loose cards; clicking the pile expands it into a canvas overlay stack where each image can be Developed (img2img finisher) or Kept, with a Re-roll-all footer.

**Architecture:** A new frontend-only `SketchPileNode` holds the batch in `properties.sailor_sketch`. The pile visual is extracted from `BatchGridNode` into a shared `PileStack` component. The stack overlay is canvas-owned (BatchGrid convention) and FLIP-morphs items from the pile's screen rect. Both sketch flows (prompt-bar pad + Sketch node) write the same payload; re-roll patches a fresh seed onto the payload's `sourceNodeId` and re-dispatches the scoped run.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript / Tailwind, Vue Flow canvas, vitest unit tests.

**Spec:** `docs/superpowers/specs/2026-07-21-sketch-pile-design.md` — read it first.

## Global Constraints

- Sketch chrome uses the **dashed neutral** draft token — never pastel, never purple; emerald is reserved for Run/spend.
- All created canvas nodes keep the **numeric id** minted by `createNodeData` — a forced string id serializes to `NaN` in `convertToLiteGraph` and silently drops the node from runs.
- Modals/overlays over the canvas are **owned by `VueNodeCanvas`** (node-local modal state doesn't survive Vue Flow re-renders) and opened via `window` CustomEvents.
- Spawned generators are **never auto-run** — the user aims, then pays.
- Commit hygiene (parallel sessions): `git add` **named files only** — never `git add -A`/`-u`, never stash. The working tree contains other sessions' edits.
- Test suite baseline: 2 pre-existing `spacetype-palette` failures are known — everything else must pass. Typecheck has ~400 pre-existing errors; only NEW errors mentioning your touched files/symbols matter (`npx vue-tsc --noEmit 2>&1 | grep -i <symbol>` → expect no output).
- All commands run from `/Users/julien/Documents/GitHub/Sailor/frontend` unless stated otherwise.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `sketchPile.ts` pure payload lib

**Files:**
- Create: `frontend/app/lib/sketch/sketchPile.ts`
- Test: `frontend/tests/unit/sketch-pile.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (later tasks import these exact names from `~/lib/sketch/sketchPile`):
  - `SKETCH_PROP = 'sailor_sketch'` (const string)
  - `interface SketchPileItem { image: string }`
  - `interface SketchPilePayload { prompt: string; seed: number; sourceNodeId: string; items: SketchPileItem[]; loading?: boolean; keptCount: number }`
  - `buildSketchPilePayload(args: { prompt: string; seed: number; sourceNodeId: string; images?: string[]; loading?: boolean }): SketchPilePayload`
  - `refreshSketchPile(payload: SketchPilePayload, args: { images: string[]; prompt?: string; seed?: number; loading?: boolean }): SketchPilePayload`
  - `stackItemWidth(pileScreenWidth: number): number`
  - `keptCardPosition(pile: { x: number; y: number }, keptIndex: number): { x: number; y: number }`
  - Consts: `MAX_SKETCH_ITEMS = 4`, `STACK_ITEM_MIN_W = 120`, `STACK_ITEM_MAX_W = 320`, `KEEP_CARD_SIZE = 200`, `KEEP_GAP = 24`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/sketch-pile.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  buildSketchPilePayload, refreshSketchPile, stackItemWidth, keptCardPosition,
  SKETCH_PROP, MAX_SKETCH_ITEMS, STACK_ITEM_MIN_W, STACK_ITEM_MAX_W, KEEP_CARD_SIZE, KEEP_GAP,
} from '~/lib/sketch/sketchPile'

describe('buildSketchPilePayload', () => {
  it('builds a payload with items from images, capped at 4', () => {
    const p = buildSketchPilePayload({
      prompt: 'a dog', seed: 7, sourceNodeId: '12',
      images: ['a', 'b', 'c', 'd', 'e'],
    })
    expect(p.prompt).toBe('a dog')
    expect(p.seed).toBe(7)
    expect(p.sourceNodeId).toBe('12')
    expect(p.items).toEqual([{ image: 'a' }, { image: 'b' }, { image: 'c' }, { image: 'd' }])
    expect(p.keptCount).toBe(0)
    expect(p.loading).toBeUndefined()
  })

  it('supports the empty skeleton (loading) form', () => {
    const p = buildSketchPilePayload({ prompt: 'x', seed: 1, sourceNodeId: '3', loading: true })
    expect(p.items).toEqual([])
    expect(p.loading).toBe(true)
  })
})

describe('refreshSketchPile', () => {
  const base = buildSketchPilePayload({ prompt: 'old', seed: 1, sourceNodeId: '3', images: ['x'] })

  it('replaces items, clears loading, preserves sourceNodeId/keptCount', () => {
    const withKept = { ...base, keptCount: 2, loading: true }
    const next = refreshSketchPile(withKept, { images: ['a', 'b'] })
    expect(next.items).toEqual([{ image: 'a' }, { image: 'b' }])
    expect(next.loading).toBe(false)
    expect(next.keptCount).toBe(2)
    expect(next.sourceNodeId).toBe('3')
    expect(next.prompt).toBe('old') // untouched when not passed
  })

  it('updates prompt/seed when passed and caps at MAX_SKETCH_ITEMS', () => {
    const next = refreshSketchPile(base, { images: ['a', 'b', 'c', 'd', 'e'], prompt: 'new', seed: 9 })
    expect(next.items).toHaveLength(MAX_SKETCH_ITEMS)
    expect(next.prompt).toBe('new')
    expect(next.seed).toBe(9)
  })

  it('can enter the loading state keeping stale items for the shimmer swap', () => {
    const next = refreshSketchPile(base, { images: [], loading: true })
    expect(next.loading).toBe(true)
    expect(next.items).toEqual([]) // re-roll passes [] — overlay shows 4 shimmer slots
  })

  it('does not mutate the input payload', () => {
    refreshSketchPile(base, { images: ['z'] })
    expect(base.items).toEqual([{ image: 'x' }])
  })
})

describe('stackItemWidth', () => {
  it('passes through in-range widths and clamps outside', () => {
    expect(stackItemWidth(200)).toBe(200)
    expect(stackItemWidth(40)).toBe(STACK_ITEM_MIN_W)
    expect(stackItemWidth(900)).toBe(STACK_ITEM_MAX_W)
  })
})

describe('keptCardPosition', () => {
  it('marches a keeper column down the left of the pile', () => {
    const pile = { x: 1000, y: 500 }
    expect(keptCardPosition(pile, 0)).toEqual({ x: 1000 - (KEEP_CARD_SIZE + KEEP_GAP + 40), y: 500 })
    expect(keptCardPosition(pile, 2)).toEqual({ x: 1000 - (KEEP_CARD_SIZE + KEEP_GAP + 40), y: 500 + 2 * (KEEP_CARD_SIZE + KEEP_GAP) })
  })
})

describe('SKETCH_PROP', () => {
  it('is the documented property key', () => {
    expect(SKETCH_PROP).toBe('sailor_sketch')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/sketch-pile.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/sketch/sketchPile`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/app/lib/sketch/sketchPile.ts
/**
 * Sketch pile payload — pure logic for the SketchPile deck node (spec:
 * 2026-07-21-sketch-pile-design.md). One frontend-only node holds a sketch
 * batch in `properties[SKETCH_PROP]`; both sketch flows (the hidden prompt-bar
 * pad and a visible Sketch node) write this same shape. All items share the
 * payload-level prompt/seed — a batch of 4 is ONE prediction, one seed.
 */

export const SKETCH_PROP = 'sailor_sketch'
export const MAX_SKETCH_ITEMS = 4

/** Overlay stack: each image renders at the pile's on-screen size (pure
 *  translate morph), clamped so extreme zooms stay usable. */
export const STACK_ITEM_MIN_W = 120
export const STACK_ITEM_MAX_W = 320

/** Keeper column: kept/developed cards land left of the pile, marching down.
 *  Mirrors the retired pad-card grid footprint so keepers read as cards. */
export const KEEP_CARD_SIZE = 200
export const KEEP_GAP = 24

export interface SketchPileItem { image: string }

export interface SketchPilePayload {
  prompt: string
  seed: number
  /** The generator to re-run on re-roll — the hidden pad node (prompt-bar
   *  flow) or the Sketch node itself. Always a String(node.id). */
  sourceNodeId: string
  items: SketchPileItem[]
  loading?: boolean
  keptCount: number
}

export function buildSketchPilePayload(args: {
  prompt: string
  seed: number
  sourceNodeId: string
  images?: string[]
  loading?: boolean
}): SketchPilePayload {
  const payload: SketchPilePayload = {
    prompt: args.prompt,
    seed: args.seed,
    sourceNodeId: args.sourceNodeId,
    items: (args.images ?? []).slice(0, MAX_SKETCH_ITEMS).map(image => ({ image })),
    keptCount: 0,
  }
  if (args.loading) payload.loading = true
  return payload
}

/** Immutable refresh for a re-sketch/re-roll: replaces items (capped), clears
 *  loading unless explicitly kept on, preserves keptCount/sourceNodeId. */
export function refreshSketchPile(payload: SketchPilePayload, args: {
  images: string[]
  prompt?: string
  seed?: number
  loading?: boolean
}): SketchPilePayload {
  return {
    ...payload,
    prompt: args.prompt ?? payload.prompt,
    seed: args.seed ?? payload.seed,
    items: args.images.slice(0, MAX_SKETCH_ITEMS).map(image => ({ image })),
    loading: !!args.loading,
  }
}

export function stackItemWidth(pileScreenWidth: number): number {
  return Math.min(STACK_ITEM_MAX_W, Math.max(STACK_ITEM_MIN_W, pileScreenWidth))
}

export function keptCardPosition(pile: { x: number, y: number }, keptIndex: number): { x: number, y: number } {
  return {
    x: pile.x - (KEEP_CARD_SIZE + KEEP_GAP + 40),
    y: pile.y + keptIndex * (KEEP_CARD_SIZE + KEEP_GAP),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/sketch-pile.unit.spec.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/sketch/sketchPile.ts frontend/tests/unit/sketch-pile.unit.spec.ts
git commit -m "feat(sketch): sketch-pile payload lib (build/refresh/stack-clamp/keeper-column)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Extract `PileStack.vue`; refactor `BatchGridNode` onto it

**Files:**
- Create: `frontend/app/components/vue-canvas/PileStack.vue`
- Modify: `frontend/app/components/vue-canvas/BatchGridNode.vue`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `PileStack.vue` with props `{ images: string[]; seedKey: string; selected?: boolean; dashed?: boolean; loading?: boolean }` and a `#rail` slot rendered under the count badge (top-right). Task 3 mounts it.

- [ ] **Step 1: Create the shared pile visual**

The cover/peeks/tilt/badge markup is lifted verbatim from `BatchGridNode.vue` (lines ~20–92) with two additions: a `dashed` cover ring and a `loading` shimmer skeleton (both used only by the sketch pile).

```vue
<!-- frontend/app/components/vue-canvas/PileStack.vue -->
<script setup lang="ts">
// Shared messy-pile visual — cover (never cropped) + up to two id-seeded
// tilted peek cards + count badge — extracted from BatchGridNode so the
// BatchGrid and SketchPile decks cannot drift. Purely presentational:
// actions live in the caller via the #rail slot (under the badge, top-right).
const props = defineProps<{
  images: string[]      // full-size URLs, [0] = cover
  seedKey: string       // node id — seeds deterministic per-node tilt
  selected?: boolean
  dashed?: boolean      // sketch identity: dashed neutral ring on the cover
  loading?: boolean     // skeleton pile (dashed shimmer) while a batch is in flight
}>()

// Deterministic per node (id-seeded) so the pile doesn't reshuffle on every
// re-render, but different nodes lean differently.
const seed = computed(() => [...String(props.seedKey)].reduce((a, ch) => a + ch.charCodeAt(0), 0))
const tilt = (i: number) => {
  const base = [-6, 5, -2][i % 3]!
  return base + ((seed.value >> (i * 2)) % 3) - 1
}
const peeks = computed(() => props.images.slice(1, 3))
</script>

<template>
  <div class="relative flex justify-center w-full">
    <div class="relative inline-block max-w-full">
      <template v-if="!loading && images[0]">
        <!-- peek cards — real outputs poking out at odd angles (cropped to the
             cover's box; they're decorative backdrop) -->
        <img
          v-for="(peek, i) in peeks"
          :key="peek"
          :src="peek"
          class="absolute inset-0 w-full h-full object-cover rounded-lg border border-white/15 shadow-lg"
          :style="{ transform: `rotate(${tilt(i + 1)}deg) translate(${(i + 1) * 4}px, ${(i + 1) * 3}px)` }"
          draggable="false"
        >
        <!-- cover — never cropped -->
        <img
          :src="images[0]"
          :class="['relative block max-w-full max-h-[190px] w-auto h-auto rounded-lg border shadow-xl',
                   dashed ? 'border-dashed' : '',
                   selected ? 'border-action ring-2 ring-action/40' : (dashed ? 'border-white/30' : 'border-white/20')]"
          :style="{ transform: `rotate(${tilt(0) / 3}deg)` }"
          draggable="false"
        >
      </template>
      <div
        v-else-if="loading"
        class="pile-skeleton relative w-[190px] h-[150px] rounded-lg"
        aria-label="Sketching…"
      />
      <div v-else class="relative w-[190px] h-[150px] rounded-lg bg-white/[0.05] border border-dashed border-white/15 flex items-center justify-center text-white/30 text-xs">
        no outputs
      </div>
      <!-- top-right rail: count badge with the caller's actions stacked under it -->
      <div class="absolute -top-2 -right-2 flex flex-col items-center gap-1.5 nopan nodrag">
        <span
          v-if="images.length"
          class="min-w-6 h-6 px-1.5 rounded-full bg-action text-white text-[11px] font-semibold flex items-center justify-center shadow-md"
        >
          {{ images.length }}
        </span>
        <slot name="rail" />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Dashed NEUTRAL shimmer — the house draft token (never pastel/purple).
   Mirrors the retired ArtifactImageNode sketch-skeleton treatment. */
.pile-skeleton {
  border: 1.5px dashed rgba(255, 255, 255, 0.25);
  background: linear-gradient(100deg, rgba(255,255,255,.04) 40%, rgba(255,255,255,.10) 50%, rgba(255,255,255,.04) 60%);
  background-size: 200% 100%;
  animation: pile-shimmer 1.1s linear infinite;
}
@keyframes pile-shimmer { to { background-position: -200% 0; } }
</style>
```

- [ ] **Step 2: Refactor `BatchGridNode.vue` onto it**

Replace the pile markup (the whole `<div class="relative flex justify-center w-full">…</div>` block) and delete the now-unused `seed`/`tilt`/`peeks` script code. Behavior must be pixel-identical for the batch pile (no `dashed`, no `loading`).

```vue
<!-- BatchGridNode.vue template becomes: -->
<template>
  <div class="w-[220px] select-none">
    <!-- The pile: clicking selects the node, dragging moves it (no handlers
         here on purpose). -->
    <PileStack :images="items.map(i => i.url)" :seed-key="String(props.id)" :selected="selected">
      <template #rail>
        <button :class="btnCls" title="Expand" @click.stop="openGallery">
          <Maximize2 class="size-3.5" />
        </button>
        <button :class="btnCls" title="Download all (ZIP)" :disabled="zipping" @click.stop="downloadZip">
          <Loader2 v-if="zipping" class="size-3.5 animate-spin" />
          <Download v-else class="size-3.5" />
        </button>
      </template>
    </PileStack>
  </div>
</template>
```

In the script block: add `import PileStack from './PileStack.vue'`, remove the `seed`, `tilt`, `peeks` definitions (now inside PileStack). Keep `payload`/`items`/`count`… note `count` becomes unused (the badge moved into PileStack) — remove it too.

- [ ] **Step 3: Verify — suite + compile check**

Run: `npx vitest run tests/unit`
Expected: pass (minus the 2 known spacetype-palette failures).

Compile check (needs a running dev server — Julien's own runs at `127.0.0.1:3000`, else start one via preview tools):
`curl -s http://127.0.0.1:3000/_nuxt/components/vue-canvas/PileStack.vue | head -5` → expect transformed JS (HTTP 200, no error overlay payload). Same for `BatchGridNode.vue`.

Visual check if a preview slot is available: open the app, a canvas with a Smart Layout batch pile should look unchanged. If none is handy this can ride Task 8's smoke.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/PileStack.vue frontend/app/components/vue-canvas/BatchGridNode.vue
git commit -m "refactor(canvas): extract shared PileStack deck visual from BatchGridNode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `SketchPileNode.vue` + node-type registration

**Files:**
- Create: `frontend/app/components/vue-canvas/SketchPileNode.vue`
- Modify: `frontend/app/composables/useVueNodes.ts` (the `getVueFlowType` map, next to the `BatchGrid: 'batch-grid'` entry ~line 216)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (import + `nodeTypes` map ~line 244–259)

**Interfaces:**
- Consumes: `SKETCH_PROP`, `SketchPilePayload` from Task 1; `PileStack.vue` from Task 2.
- Produces: node type `'SketchPile'` creatable via `createNodeData('SketchPile', pos, undefined, { [SKETCH_PROP]: payload })`; clicking the pile (or its expand button) dispatches `window` CustomEvent **`sailor:openSketchStack`** with `detail: { nodeId: string }`. Task 6 listens for it.

- [ ] **Step 1: Create the node component**

```vue
<!-- frontend/app/components/vue-canvas/SketchPileNode.vue -->
<script setup lang="ts">
// Frontend-only sketch results deck (spec 2026-07-21-sketch-pile-design.md):
// one pile node holding the batch of cheap options in properties.sailor_sketch.
// Click (a true click, not a drag) or the expand rail button opens the
// canvas-owned stack overlay — the choose-one moment. Wears the dashed sketch
// token; shimmers while a (re-)sketch is in flight.
import { Maximize2 } from 'lucide-vue-next'
import { SKETCH_PROP, type SketchPilePayload } from '~/lib/sketch/sketchPile'
import PileStack from './PileStack.vue'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()

const payload = computed<SketchPilePayload | null>(
  () => props.data?.properties?.[SKETCH_PROP] ?? null)
const images = computed(() => (payload.value?.items ?? []).map(i => i.image))
const loading = computed(() => !!payload.value?.loading)

function openStack() {
  window.dispatchEvent(new CustomEvent('sailor:openSketchStack', { detail: { nodeId: props.id } }))
}

// Click-vs-drag: Vue Flow drags start on pointerdown; only open the stack for
// a true click (pointer travelled < 5px), so moving the pile doesn't pop it.
let downAt: { x: number, y: number } | null = null
function onPointerDown(e: PointerEvent) { downAt = { x: e.clientX, y: e.clientY } }
function onClick(e: MouseEvent) {
  if (loading.value && !images.value.length) return // nothing to expand yet
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) >= 5) return
  openStack()
}

const btnCls = 'size-7 rounded-md bg-black/55 hover:bg-black/75 backdrop-blur-sm border border-white/15 '
  + 'flex items-center justify-center text-white/75 hover:text-white transition-colors cursor-pointer shadow-md'
</script>

<template>
  <div class="w-[220px] select-none" @pointerdown="onPointerDown" @click="onClick">
    <PileStack
      :images="images"
      :seed-key="String(props.id)"
      :selected="selected"
      dashed
      :loading="loading"
    >
      <template #rail>
        <button v-if="images.length" :class="btnCls" title="Expand" @click.stop="openStack">
          <Maximize2 class="size-3.5" />
        </button>
      </template>
    </PileStack>
  </div>
</template>
```

- [ ] **Step 2: Register the type**

`frontend/app/composables/useVueNodes.ts` — in the map right after the `BatchGrid: 'batch-grid',` entry:

```ts
  // SketchPile: frontend-only sketch results deck — no backend class_type;
  // holds the batch's /view URLs + provenance in properties.sailor_sketch.
  SketchPile: 'sketch-pile',
```

`frontend/app/components/vue-canvas/VueNodeCanvas.vue` — next to the BatchGridNode import (~line 87):

```ts
import SketchPileNode from './SketchPileNode.vue'
```

and in `nodeTypes` (~line 259):

```ts
  'sketch-pile': markRaw(SketchPileNode),
```

- [ ] **Step 3: Verify — suite + browser smoke via `sailor:addNode`**

Run: `npx vitest run tests/unit` → pass (known failures only).

Browser smoke (dev server + blank project; close the z-[100] start modal first). In the devtools console:

```js
window.dispatchEvent(new CustomEvent('sailor:addNode', { detail: {
  nodeType: 'SketchPile',
  propertyOverrides: { sailor_sketch: {
    prompt: 'a dog', seed: 1, sourceNodeId: '0', keptCount: 0,
    items: [
      { image: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="tomato"/></svg>' },
      { image: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="teal"/></svg>' },
      { image: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="gold"/></svg>' },
    ],
  } },
} }))
```

Expected: a messy pile with dashed cover ring, 2 peeks, a "3" badge, an expand button. Also add one with `propertyOverrides: { sailor_sketch: { prompt: 'x', seed: 1, sourceNodeId: '0', keptCount: 0, items: [], loading: true } }` → dashed shimmer skeleton, no badge. (The `sailor:openSketchStack` event fires on click but nothing listens yet — that's Task 6.)

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/SketchPileNode.vue frontend/app/composables/useVueNodes.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(sketch): SketchPile deck node (frontend-only) + registration

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Cut the prompt-bar pad flow over to the pile (and delete the card machinery it replaces)

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — the `sketchPad` reactive (~line 1019), `sketchPadAnchor()` (~1025), the executed-handler pad branch (~2765), `materializeSketchCardsAt`/`startSketch` (~3360–3460), `handlePromoteSketchOutput` (~3505), `keepSketchCard` (~3530), and their event-listener registrations (search `sailor:keepSketchCard` and the event name `handlePromoteSketchOutput` is registered under — grep `addEventListener('sailor:` to find both).

**Interfaces:**
- Consumes: Task 1 lib, Task 3 node type.
- Produces: `materializeSketchPileAt(anchor, images, opts?: { loading?: boolean }): void` and `sketchPad.pileNodeId` (used by Task 6's re-roll); the executed pad branch now writes the pile.

- [ ] **Step 1: Rewire state + materializer**

Imports: add `import { SKETCH_PROP, buildSketchPilePayload, refreshSketchPile, type SketchPilePayload } from '~/lib/sketch/sketchPile'`; drop the `planSketchCardsAt` import line (`planSketchCardsAt, SKETCH_PAD_ID, CARD_SIZE as SKETCH_CARD_SIZE, GAP as SKETCH_CARD_GAP`).

Replace the `sketchPad` reactive:

```ts
const sketchPad = reactive<{ anchor: { x: number, y: number } | null, seed: number, prompt: string, promptId: string | null, padNodeId: string | number | null, pileNodeId: string | number | null }>(
  { anchor: null, seed: 0, prompt: '', promptId: null, padNodeId: null, pileNodeId: null },
)
```

In `sketchPadAnchor()`: the pile's footprint replaces the 4-card stack. Replace the geometry lines (`const step = …` through `let p = …` and the `PAD_W/PAD_H` consts) with:

```ts
  const PILE_W = 220, PILE_H = 190
  // Center the pile on the viewport centre.
  let p = { x: c.x - PILE_W / 2, y: c.y - PILE_H / 2 }
  const PAD_W = PILE_W + 80, PAD_H = PILE_H + 80
```

and in the `occupied` skip-check add the pile itself: `if (pr?.sketchPad || pr?.sketchWarm || pr?.sketchSink || pr?.[SKETCH_PROP]) return false`. In the nudge loop replace `p = { x: p.x + step, y: p.y }` with `p = { x: p.x + PILE_W + 40, y: p.y }` (the comment about tall stacks no longer applies — trim it).

Replace `materializeSketchCardsAt` entirely with:

```ts
/** Create-or-refresh the prompt-bar sketch pile at `anchor`. `images` may be []
 *  for the skeleton pass (loading shimmer). One node, one payload — replaces
 *  the retired 4-card slot machinery. */
function materializeSketchPileAt(
  anchor: { x: number, y: number },
  images: string[],
  opts: { loading?: boolean } = {},
): void {
  const existing = sketchPad.pileNodeId != null
    ? (nodes.value as any[]).find((n: any) => n.id === sketchPad.pileNodeId)
    : null
  if (existing) {
    const prev = existing.data?.properties?.[SKETCH_PROP] as SketchPilePayload | undefined
    const next = prev
      ? refreshSketchPile(prev, { images, prompt: sketchPad.prompt, seed: sketchPad.seed, loading: opts.loading })
      : buildSketchPilePayload({ prompt: sketchPad.prompt, seed: sketchPad.seed, sourceNodeId: String(sketchPad.padNodeId ?? ''), images, loading: opts.loading })
    existing.data = { ...existing.data, properties: { ...existing.data.properties, [SKETCH_PROP]: next } }
    return
  }
  const node = createNodeData('SketchPile', anchor, undefined, {
    [SKETCH_PROP]: buildSketchPilePayload({
      prompt: sketchPad.prompt,
      seed: sketchPad.seed,
      sourceNodeId: String(sketchPad.padNodeId ?? ''),
      images,
      loading: opts.loading,
    }),
  })
  // Keep createNodeData's numeric id (string ids serialize to NaN and drop).
  ;(nodes.value as any[]).push(node)
  sketchPad.pileNodeId = node.id
}
```

- [ ] **Step 2: Reorder `startSketch` (pad node before skeleton — the payload needs `sourceNodeId`)**

In `startSketch`, move the skeleton call BELOW the pad create/reuse block and switch it to the pile, so the order is: compute overrides → create-or-reuse pad node (unchanged code) → `materializeSketchPileAt(sketchPad.anchor, [], { loading: true })` → `await nextTick()` → `sailor:runFiltered` dispatch (unchanged). Also delete the `sketchPad.keptCount = 0` line in the anchor-init branch (field is gone).

- [ ] **Step 3: Executed-handler pad branch writes the pile**

Replace the body of the pad branch (~line 2768):

```ts
          if (target?.data?.properties?.sketchPad === true && tagged.images && tagged.images.length > 1 && sketchPad.anchor) {
            materializeSketchPileAt(sketchPad.anchor, tagged.images) // real pass, replaces the skeleton pile
            return
          }
```

(Update the comment above it: the batch now lands in the ONE pile node, not 4 anchor cards.)

- [ ] **Step 4: Delete the dead card machinery in this file**

- `handlePromoteSketchOutput` + its `sketchPromoteOverridesFromProps` import + its `addEventListener`/`removeEventListener` pair (grep for the event name it's registered under).
- `keepSketchCard` + its `sailor:keepSketchCard` listener pair + the `stripSketchProperties`/`vacateSketchSlot` import.
- Any other reference to `sketchPad.cardIds`/`keptCount`/`SKETCH_PAD_ID` (grep the file; `patchImageWidget` stays if still used elsewhere — check callers, it was shared).

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/unit` → the two old card specs (`plan-sketch-cards-at`, `keep-sketch-card`) still pass (their libs still exist until Task 7); everything else green.
Typecheck delta: `npx vue-tsc --noEmit 2>&1 | grep -iE "sketchPile|sketchPad|materializeSketch"` → no output.
Browser (free): blank project → type a sketch prompt in the prompt bar with ComfyUI **stopped** → a single shimmering pile appears at viewport center (no 4 skeleton cards); the run itself fails (backend down) — that's fine for this check. (Full paid pass is Task 8/user checklist.)

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(sketch): prompt-bar sketches land as ONE pile node (retire pad-card slot machinery)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Sketch-node flow — batch also materializes a pile beside the node

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — executed handler (directly after the pad branch from Task 4 Step 3).

**Interfaces:**
- Consumes: Task 1 lib, Task 4's imports.
- Produces: `materializeSketchPileBeside(source, images, params): void` (Task 6's re-roll reaches the source via the payload, not this function).

- [ ] **Step 1: Add the materializer**

Place next to `materializeSketchPileAt`:

```ts
/** Sketch NODE flow: a visible sketch generator's multi-image batch presents
 *  as a pile to its right (the choose-one surface). The node's own take/
 *  filmstrip append stays untouched — provenance and Light Table keep working.
 *  Re-runs refresh the same pile (found by payload.sourceNodeId). */
function materializeSketchPileBeside(source: any, images: string[], params: Record<string, unknown> = {}): void {
  const prompt = typeof params.prompt === 'string' ? params.prompt : ''
  const seed = typeof params.seed === 'number' ? params.seed : 0
  const existing = (nodes.value as any[]).find(
    (n: any) => n?.data?.properties?.[SKETCH_PROP]?.sourceNodeId === String(source.id))
  if (existing) {
    const prev = existing.data.properties[SKETCH_PROP] as SketchPilePayload
    existing.data = {
      ...existing.data,
      properties: { ...existing.data.properties, [SKETCH_PROP]: refreshSketchPile(prev, { images, prompt, seed }) },
    }
    return
  }
  const pos = {
    x: (source.position?.x ?? 0) + (source.data?.size?.[0] ?? 240) + 80,
    y: source.position?.y ?? 0,
  }
  const node = createNodeData('SketchPile', pos, undefined, {
    [SKETCH_PROP]: buildSketchPilePayload({ prompt, seed, sourceNodeId: String(source.id), images }),
  })
  ;(nodes.value as any[]).push(node)
}
```

- [ ] **Step 2: Route the batch**

Directly AFTER the pad branch (which `return`s), add:

```ts
          // Sketch NODE (properties.sketch — the node-search preset): its
          // batch also presents as a pile beside the node. The take was
          // already appended above; this only adds the choose-one surface.
          if (target?.data?.properties?.sketch === true && tagged.images && tagged.images.length > 1) {
            materializeSketchPileBeside(target, tagged.images, take.params ?? {})
          }
```

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/unit` → green (known failures only).
Typecheck delta: `npx vue-tsc --noEmit 2>&1 | grep -i "materializeSketchPileBeside"` → no output.
(Runtime proof needs a paid Sketch-node run — deferred to the user's paid checklist, Task 8 notes it.)

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(sketch): Sketch-node batches materialize a pile beside the node

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `SketchStackOverlay.vue` + canvas wiring (develop / keep / re-roll)

**Files:**
- Create: `frontend/app/components/vue-canvas/SketchStackOverlay.vue`
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — overlay state + handlers next to the batch-gallery block (~line 4260), listener registration next to `sailor:openBatchGallery` (~4517/4580), template mount next to the BatchGrid modal (~7548).

**Interfaces:**
- Consumes: `SKETCH_PROP`, `SketchPilePayload`, `stackItemWidth`, `keptCardPosition` (Task 1); `annotatedImageValueFromViewUrl` from `~/lib/promoteTempImages` (already imported in VueNodeCanvas); `applyWidgetOverridesTo` (existing, ~line 3353); the `sailor:applyEffect` + `sailor:runFiltered` events (existing handlers).
- Produces: the working overlay; event `sailor:openSketchStack` handled.

- [ ] **Step 1: Create the overlay component**

```vue
<!-- frontend/app/components/vue-canvas/SketchStackOverlay.vue -->
<script setup lang="ts">
// The sketch pile's choose-one moment (spec 2026-07-21-sketch-pile-design.md
// §2): canvas dims, the pile's images FLIP-morph from the pile's screen rect
// into a vertical stack at their ON-CANVAS size (pure translate morph, clamped
// 120–320px), and each option offers Develop (img2img finisher) or Keep as
// image. Footer re-rolls the whole batch; while it's in flight the items are
// shimmer placeholders (the payload prop is reactive — items swap in place).
import { RefreshCw, X } from 'lucide-vue-next'
import { stackItemWidth, MAX_SKETCH_ITEMS, type SketchPilePayload } from '~/lib/sketch/sketchPile'

const props = defineProps<{
  payload: SketchPilePayload
  /** The pile cover's screen rect at open time (the morph origin). */
  origin: { x: number, y: number, width: number, height: number }
}>()
const emit = defineEmits<{ develop: [index: number], keep: [index: number], reroll: [], close: [] }>()

const loading = computed(() => !!props.payload.loading)
// While re-rolling show MAX_SKETCH_ITEMS shimmer slots; otherwise the items.
const slots = computed(() =>
  loading.value ? Array.from({ length: MAX_SKETCH_ITEMS }, () => null) : props.payload.items)
const itemW = computed(() => stackItemWidth(props.origin.width))

// FLIP morph: items mount in their final stack slots, get an initial transform
// putting them at the pile's rect, then release to identity with a stagger.
const itemEls = ref<HTMLElement[]>([])
const closing = ref(false)

function toOrigin(el: HTMLElement): string {
  const r = el.getBoundingClientRect()
  const s = r.width ? props.origin.width / r.width : 1
  return `translate(${props.origin.x - r.left}px, ${props.origin.y - r.top}px) scale(${s})`
}

onMounted(async () => {
  await nextTick()
  const els = itemEls.value.filter(Boolean)
  for (const el of els) {
    el.style.transform = toOrigin(el)
    el.style.opacity = '0.5'
  }
  void document.body.offsetHeight // commit start states before transitioning
  els.forEach((el, i) => {
    el.style.transition = `transform 220ms cubic-bezier(.2,.8,.2,1) ${i * 40}ms, opacity 180ms ease ${i * 40}ms`
    el.style.transform = ''
    el.style.opacity = '1'
  })
})

function requestClose() {
  if (closing.value) return
  closing.value = true
  const els = itemEls.value.filter(Boolean)
  els.forEach((el, i) => {
    el.style.transition = `transform 200ms cubic-bezier(.4,0,.8,.4) ${(els.length - 1 - i) * 30}ms, opacity 180ms ease ${(els.length - 1 - i) * 30}ms`
    el.style.transform = toOrigin(el)
    el.style.opacity = '0'
  })
  window.setTimeout(() => emit('close'), 200 + els.length * 30)
}

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') requestClose() }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="fixed inset-0 z-[95] bg-black/70 overflow-y-auto" @click.self="requestClose">
    <div class="min-h-full flex flex-col items-center justify-center gap-3 py-10" @click.self="requestClose">
      <div
        v-for="(item, i) in slots"
        :key="i"
        :ref="el => { if (el) itemEls[i] = el as HTMLElement }"
        class="group relative shrink-0"
        :style="{ width: itemW + 'px' }"
      >
        <template v-if="item">
          <img :src="item.image" class="block w-full rounded-lg border border-white/20 shadow-xl" draggable="false">
          <!-- hover actions — mirrors the retired card footer: Keep outline,
               Develop solid-white primary (never emerald: no spend here) -->
          <div class="absolute inset-x-0 bottom-0 p-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/60 to-transparent rounded-b-lg">
            <button
              class="flex-1 h-7 rounded text-[11px] font-semibold text-white/80 hover:text-white border border-white/25 hover:border-white/40 bg-black/30 transition-colors cursor-pointer"
              title="Keep this option — it lands beside the pile as a regular Image card"
              @click.stop="emit('keep', i)"
            >
              Keep as image
            </button>
            <button
              class="flex-[1.4] h-7 px-2 rounded text-[11px] font-semibold text-neutral-900 bg-white/90 hover:bg-white transition-colors cursor-pointer"
              title="Turn this rough into a finished, detailed image — keeps the composition"
              @click.stop="emit('develop', i)"
            >
              Develop
            </button>
          </div>
        </template>
        <div v-else class="stack-skeleton w-full rounded-lg" :style="{ height: Math.round(itemW * 0.75) + 'px' }" aria-label="Sketching…" />
      </div>

      <div class="shrink-0 flex items-center gap-2 mt-2 nopan">
        <button
          class="flex items-center gap-1.5 h-8 px-3 rounded-md bg-white/10 hover:bg-white/15 border border-white/15 text-xs text-white/85 transition-colors cursor-pointer disabled:opacity-50"
          :disabled="loading"
          title="Re-roll all 4 — same idea, fresh seed"
          @click.stop="emit('reroll')"
        >
          <RefreshCw class="size-3.5" :class="loading ? 'animate-spin' : ''" />
          Re-roll all 4
        </button>
        <button
          class="size-8 rounded-md hover:bg-white/10 flex items-center justify-center text-white/60 cursor-pointer"
          title="Close"
          @click.stop="requestClose"
        >
          <X class="size-4" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Same dashed neutral shimmer as the pile skeleton (house draft token). */
.stack-skeleton {
  border: 1.5px dashed rgba(255, 255, 255, 0.25);
  background: linear-gradient(100deg, rgba(255,255,255,.04) 40%, rgba(255,255,255,.10) 50%, rgba(255,255,255,.04) 60%);
  background-size: 200% 100%;
  animation: stack-shimmer 1.1s linear infinite;
}
@keyframes stack-shimmer { to { background-position: -200% 0; } }
</style>
```

- [ ] **Step 2: Wire it in `VueNodeCanvas.vue`**

Next to the batch-gallery block (~line 4260), add state + handlers:

```ts
// Sketch stack overlay — canvas-owned (same convention as the BatchGrid
// gallery). Opened by sailor:openSketchStack from the pile node; the payload
// computed stays live off the node so a re-roll's items swap in place.
const sketchStackForId = ref<string | null>(null)
const sketchStackOrigin = ref<{ x: number, y: number, width: number, height: number } | null>(null)

function handleOpenSketchStack(e: Event) {
  const detail = (e as CustomEvent<{ nodeId?: string }>).detail
  if (!detail?.nodeId) return
  // Morph origin: the pile COVER's rendered rect (includes canvas zoom — the
  // stack items render at this same width, so the morph is translate-only).
  const el = document.querySelector(
    `.vue-flow__node[data-id="${detail.nodeId}"] img, .vue-flow__node[data-id="${detail.nodeId}"] .pile-skeleton`,
  ) as HTMLElement | null
  const r = el?.getBoundingClientRect()
  sketchStackOrigin.value = r
    ? { x: r.left, y: r.top, width: r.width, height: r.height }
    : { x: window.innerWidth / 2 - 100, y: window.innerHeight / 2 - 75, width: 200, height: 150 }
  sketchStackForId.value = String(detail.nodeId)
}

function sketchStackPile(): any | null {
  if (!sketchStackForId.value) return null
  return (nodes.value as any[]).find((n: any) => String(n.id) === sketchStackForId.value) ?? null
}
const sketchStackPayload = computed<SketchPilePayload | null>(() => {
  if (!sketchStackForId.value) return null
  const n = (nodes.value as any[]).find((x: any) => String(x.id) === sketchStackForId.value)
  return n?.data?.properties?.[SKETCH_PROP] ?? null
})

/** Keep item `index` as an ordinary Image card in the keeper column left of
 *  the pile. Returns the created card (Develop wires its finisher from it). */
function keepSketchStackItem(index: number): any | null {
  const pile = sketchStackPile()
  const payload = pile?.data?.properties?.[SKETCH_PROP] as SketchPilePayload | undefined
  const item = payload?.items?.[index]
  if (!pile || !payload || !item) return null
  const imageWidgetValue = annotatedImageValueFromViewUrl(item.image)
  const card = createNodeData('Image', keptCardPosition(pile.position, payload.keptCount),
    imageWidgetValue ? { image: imageWidgetValue } : undefined)
  card.data = { ...card.data, images: [item.image] }
  ;(nodes.value as any[]).push(card)
  pile.data = {
    ...pile.data,
    properties: { ...pile.data.properties, [SKETCH_PROP]: { ...payload, keptCount: payload.keptCount + 1 } },
  }
  return card
}

/** Develop = today's card "Refine…" verbatim: the picked image lands as a
 *  keeper card, then an EditImageNode (Nano Banana 2) is spliced from it —
 *  focused, branched, NEVER auto-run. Closes the overlay. */
function developSketchStackItem(index: number) {
  const card = keepSketchStackItem(index)
  if (!card) return
  sketchStackForId.value = null
  window.dispatchEvent(new CustomEvent('sailor:applyEffect', {
    detail: {
      nodeId: card.id,
      nodeType: 'EditImageNode',
      output: 'IMAGE',
      branch: true,
      focus: true,
      widgetOverrides: {
        model: 'Nano Banana 2',
        prompt: 'Turn this rough into a polished, finished, highly detailed image — keep the same composition and subject.',
      },
    },
  }))
}

/** Re-roll the whole batch: fresh seed onto the payload's source generator +
 *  the same scoped run both flows already use. The executed handler routes the
 *  new batch back into this pile (pad branch or sketch-node branch). */
function rerollSketchStack() {
  const pile = sketchStackPile()
  const payload = pile?.data?.properties?.[SKETCH_PROP] as SketchPilePayload | undefined
  if (!pile || !payload) return
  const src = (nodes.value as any[]).find((n: any) => String(n.id) === payload.sourceNodeId)
  if (!src) return
  const seed = Math.floor(Math.random() * 2_147_483_647)
  applyWidgetOverridesTo(src, { seed })
  if (src.data?.properties?.sketchPad === true) sketchPad.seed = seed // keep pad bookkeeping coherent
  pile.data = {
    ...pile.data,
    properties: { ...pile.data.properties, [SKETCH_PROP]: { ...payload, seed, loading: true } },
  }
  window.dispatchEvent(new CustomEvent('sailor:runFiltered', {
    detail: { targetIds: [src.id], direction: 'self', skipCostConfirm: true },
  }))
}
```

Register the listener where `sailor:openBatchGallery` is registered (~4517) and removed (~4580):

```ts
  window.addEventListener('sailor:openSketchStack', handleOpenSketchStack)
  // …
  window.removeEventListener('sailor:openSketchStack', handleOpenSketchStack)
```

Mount in the template next to the BatchGrid modal (~7548):

```vue
    <!-- Sketch stack overlay (canvas-owned; opened by sailor:openSketchStack) -->
    <VueCanvasSketchStackOverlay
      v-if="sketchStackPayload && sketchStackOrigin"
      :payload="sketchStackPayload"
      :origin="sketchStackOrigin"
      @develop="developSketchStackItem"
      @keep="keepSketchStackItem"
      @reroll="rerollSketchStack"
      @close="sketchStackForId = null"
    />
```

(Note: the BatchGrid modal mounts as `VueCanvasBatchGridModal` — Nuxt auto-import naming. `SketchStackOverlay.vue` in the same directory is `VueCanvasSketchStackOverlay`. Add `import { keptCardPosition } from '~/lib/sketch/sketchPile'` to the existing sketchPile import line.)

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/unit` → green (known failures only).
Typecheck delta: `npx vue-tsc --noEmit 2>&1 | grep -iE "SketchStack|sketchStack"` → no output.

Browser smoke (free, no backend): inject a pile via the Task 3 Step 3 console snippet, then click it. Expected: canvas dims, the 3 tomato/teal/gold images morph out of the pile into a vertical stack at the pile's on-screen width, staggered; hover shows Keep-as-image / Develop; Escape morphs them back and closes. Click "Keep as image" → a plain Image card appears left of the pile, overlay stays open, badge/keeper column march works on a second keep. Click "Develop" → keeper card + an EditImageNode spawns wired from it, focused, NOT running (backend down is fine — the node must simply appear un-run). Re-roll with backend down: items swap to 4 shimmer slots and the button spins (the run fails silently — acceptable for the free check).

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/SketchStackOverlay.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(sketch): expanding stack overlay — develop / keep-as-image / re-roll

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Retire the card-era code

**Files:**
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` — delete `isSketchOutput`/`spawnDevelop`/`keepSketchCard` (script ~lines 464–484), the sketch footer block (template ~1183–1203), the sketch-skeleton div (template ~877–885) and its CSS (~1257–1270).
- Modify: `frontend/app/lib/draft/sketchPromote.ts` — delete `sketchPromoteOverridesFromProps` only (`sketchPromoteOverridesFor` STAYS — the take-based Sketch-node Promote uses it).
- Delete: `frontend/app/lib/sketch/planSketchCards.ts`, `frontend/app/lib/sketch/planSketchCardsAt.ts`, `frontend/app/lib/draft/keepSketchCard.ts`
- Delete: `frontend/tests/unit/plan-sketch-cards.unit.spec.ts`, `frontend/tests/unit/plan-sketch-cards-at.unit.spec.ts`, `frontend/tests/unit/keep-sketch-card.unit.spec.ts`
- Check/Modify: any test covering `sketchPromoteOverridesFromProps` (grep `frontend/tests` for it — delete those cases only, keep `sketchPromoteOverridesFor` coverage).

- [ ] **Step 1: Confirm nothing still imports the doomed symbols**

Run: `grep -rn "planSketchCards\|keepSketchCard\|stripSketchProperties\|vacateSketchSlot\|sketchPromoteOverridesFromProps\|SKETCH_PAD_ID\|sketchOutput\|sketchLoading" frontend/app | grep -v "lib/sketch/planSketchCards" | grep -v "lib/draft/keepSketchCard"`

Expected: only the `ArtifactImageNode.vue` and `sketchPromote.ts` hits this task deletes. If VueNodeCanvas still references any (missed in Task 4), fix there first.

- [ ] **Step 2: Make the deletions**

In `ArtifactImageNode.vue` also remove the now-dead comment block above `isSketchOutput` ("Sketch-output card actions") and check `spliceEffect` is still used by the other escalators (it is — Enhance/Relight/etc. — do NOT delete it). Old saved canvases with `sketchOutput` properties now render as plain Image cards — that's the specced graceful degradation, no migration needed.

```bash
cd /Users/julien/Documents/GitHub/Sailor
rm frontend/app/lib/sketch/planSketchCards.ts frontend/app/lib/sketch/planSketchCardsAt.ts frontend/app/lib/draft/keepSketchCard.ts
rm frontend/tests/unit/plan-sketch-cards.unit.spec.ts frontend/tests/unit/plan-sketch-cards-at.unit.spec.ts frontend/tests/unit/keep-sketch-card.unit.spec.ts
```

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/unit` → green (known failures only), the three deleted specs gone from the run.
Typecheck delta: `npx vue-tsc --noEmit 2>&1 | grep -iE "planSketchCards|keepSketchCard|sketchPromoteOverridesFromProps|sketchOutput"` → no output.
Compile check: `curl -s http://127.0.0.1:3000/_nuxt/components/vue-canvas/ArtifactImageNode.vue | head -3` → transformed JS, no overlay error.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add -A frontend/app/lib/sketch/planSketchCards.ts frontend/app/lib/sketch/planSketchCardsAt.ts frontend/app/lib/draft/keepSketchCard.ts frontend/tests/unit/plan-sketch-cards.unit.spec.ts frontend/tests/unit/plan-sketch-cards-at.unit.spec.ts frontend/tests/unit/keep-sketch-card.unit.spec.ts frontend/app/components/vue-canvas/ArtifactImageNode.vue frontend/app/lib/draft/sketchPromote.ts
git commit -m "refactor(sketch): retire card-era machinery (slot planners, keep/strip, card footer)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(`git add -A <paths>` with explicit paths stages the deletions of exactly those files — still never bare `-A`.)

---

### Task 8: Final verification

- [ ] **Step 1: Full suite + typecheck delta**

Run: `npx vitest run` → everything green except the 2 known `spacetype-palette` failures.
Run: `npx vue-tsc --noEmit 2>&1 | grep -iE "sketch|PileStack" ` → no NEW errors in touched files (pre-existing unrelated hits are fine — compare against `git show HEAD~N:<file>` if unsure).

- [ ] **Step 2: Free browser pass (no backend)**

Repeat the Task 6 Step 3 smoke end-to-end on a fresh blank project and additionally confirm: the BatchGrid pile (inject via a Smart Layout batch if available, else at minimum confirm `BatchGridNode` renders via the Task 2 compile check) still looks right after the PileStack extraction; pile drag moves the node WITHOUT opening the overlay; pile click opens it.

- [ ] **Step 3: Report the paid checklist as OWED**

Do NOT run paid renders autonomously. Report to the user that the following runtime checks are owed on their end (standing convention):
1. Prompt-bar sketch → shimmer pile → real batch fills the pile (4 images, badge "4").
2. Pile click → stack → **Develop** → keeper card + Nano Banana editor spawns wired + focused, un-run; running it produces the polished image.
3. **Re-roll all 4** with the overlay open → 4 shimmer slots → fresh batch swaps in; pile cover updates.
4. Add a **Sketch** node (Space search) → run → pile materializes to its right; re-run refreshes the same pile; the node's takes strip/Light Table unaffected.
5. Reload the project → the pile rehydrates with its images (payload persistence).

- [ ] **Step 4: Update memory + close out**

Follow superpowers:finishing-a-development-branch (work is on `main` per house convention — no branch dance needed; do not push unless asked).
