# Artifact Generator Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six generator-backed escalator actions (Enhance Detail, Upscale, Relight, Lens · Reframe, Variations ×4, Animate) to the image artifact's Edit… menu, restructured into three sections with credit hints, plus a transient post-render chip strip.

**Architecture:** All splice actions reuse the existing `comfynext:applyEffect` → `spliceAfterNode()` rail in `VueNodeCanvas.vue`, extended with `run`/`focus` flags. Variations gets a new `'variation'` reroll scope (randomize upstream seeds, freeze upstream artifacts) plus a sequential-loop handler in `layouts/default.vue` mirroring the existing text-iterator. Animate creates a frontend-only `ShotDirector` node with a pre-seeded shot sheet and opens its editor. The chip strip is a per-artifact component coordinated by a tiny singleton composable so only the latest-rendered artifact shows it.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript / Tailwind, vitest (`cd frontend && npm run test:unit`), lucide-vue-next icons.

**Spec:** `docs/superpowers/specs/2026-07-02-artifact-generator-actions-design.md`

## Global Constraints

- Work directly on `main`; NO feature branches (user preference).
- `git add` only the exact files you touched; NEVER `git add -A` (user has parallel WIP).
- No purple/violet accents anywhere. Chip strip uses the dark idiom (bg-black/60, white/70 text); menu matches the existing dropdown styling.
- Spawned nodes must NOT auto-run except Upscale and Variations (user pays only after aiming).
- One deliberate spec deviation, agreed rationale: Shot Director has no IMAGE input (only 3 CHARACTER cast handles), so Animate seeds the image as a sheet *reference* instead of a wire, and opens the Shot Director editor (there is no ShotDirector preset gallery; `VueCanvasShotPresetGalleryModal` is a FilmShotNode affordance).
- `frontend/` typecheck has a pre-existing error baseline (~396); do not try to fix unrelated errors.

---

### Task 1: Pure helpers — credit hints + variation seed scope

**Files:**
- Create: `frontend/app/lib/artifact/nextSteps.ts`
- Test: `frontend/tests/unit/artifact-next-steps.unit.spec.ts`

**Interfaces:**
- Produces: `ACTION_HINTS: Record<ArtifactActionId, string | null>`, `ARTIFACT_ACTION_IDS: readonly ArtifactActionId[]`, `upstreamSeedScope(targetIds: string[], nodes: MinimalNode[], edges: MinimalEdge[]): Set<string>`
- Consumed by: Task 2 (`upstreamSeedScope` in `getFilteredWorkflow`), Task 4/5/6 (`ACTION_HINTS` in the menu and chip strip).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/artifact-next-steps.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { ACTION_HINTS, ARTIFACT_ACTION_IDS, upstreamSeedScope } from '~/lib/artifact/nextSteps'

describe('ACTION_HINTS', () => {
  it('covers every action id (null = deliberately no hint)', () => {
    for (const id of ARTIFACT_ACTION_IDS) {
      expect(ACTION_HINTS[id], `missing hint entry for ${id}`).not.toBeUndefined()
    }
  })
})

// Minimal graph shapes matching VueNodeCanvas nodes/edges arrays.
const img = (id: string, hasResult: boolean) => ({
  id,
  data: { nodeType: 'Image', images: hasResult ? ['/view?filename=x.png&type=output'] : [] },
})
const gen = (id: string) => ({ id, data: { nodeType: 'GenerateImageNode' } })
const edge = (source: string, target: string) => ({ source, target })

describe('upstreamSeedScope', () => {
  it('includes the target and its upstream producer', () => {
    // gen1 → artifact1 (target)
    const scope = upstreamSeedScope(['a1'], [gen('g1'), img('a1', true)], [edge('g1', 'a1')])
    expect(scope).toEqual(new Set(['a1', 'g1']))
  })

  it('stops at upstream artifacts that already hold a result', () => {
    // gen1 → artifact1(result) → gen2 → artifact2 (target):
    // artifact1 will be frozen by the run, so gen1 must NOT be rerolled.
    const nodes = [gen('g1'), img('a1', true), gen('g2'), img('a2', true)]
    const edges = [edge('g1', 'a1'), edge('a1', 'g2'), edge('g2', 'a2')]
    expect(upstreamSeedScope(['a2'], nodes, edges)).toEqual(new Set(['a2', 'g2']))
  })

  it('walks THROUGH artifacts without a result', () => {
    // gen1 → artifact1(empty) → gen2 → artifact2: nothing to freeze, so gen1 rerolls too.
    const nodes = [gen('g1'), img('a1', false), gen('g2'), img('a2', true)]
    const edges = [edge('g1', 'a1'), edge('a1', 'g2'), edge('g2', 'a2')]
    expect(upstreamSeedScope(['a2'], nodes, edges)).toEqual(new Set(['a2', 'g2', 'a1', 'g1']))
  })

  it('handles diamond graphs without infinite loops', () => {
    const nodes = [gen('g1'), gen('g2'), gen('g3'), img('a1', true)]
    const edges = [edge('g1', 'g2'), edge('g1', 'g3'), edge('g2', 'a1'), edge('g3', 'a1'), edge('a1', 'g1')]
    const scope = upstreamSeedScope(['a1'], nodes, edges)
    expect(scope.has('a1')).toBe(true)
    expect(scope.has('g2')).toBe(true)
    expect(scope.has('g3')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/artifact-next-steps.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/artifact/nextSteps`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/app/lib/artifact/nextSteps.ts
// Pure helpers for the artifact Edit-menu escalator actions and the
// post-render next-steps chip strip. Credit hints are static estimates from
// docs/superpowers/specs/2026-07-01-costs-and-pricing-model.md (1cr = $0.01);
// the billing spec's price_book replaces them when metering lands.

export const ARTIFACT_ACTION_IDS = [
  'remove-bg', 'inpaint', 'nano-banana', 'fix',
  'enhance', 'upscale', 'relight', 'lens',
  'variations', 'animate',
] as const
export type ArtifactActionId = typeof ARTIFACT_ACTION_IDS[number]

export const ACTION_HINTS: Record<ArtifactActionId, string | null> = {
  'remove-bg': null,
  'inpaint': null,
  'nano-banana': '~12cr',
  'fix': null,
  'enhance': '14–28cr',
  'upscale': '~14cr',
  'relight': '~12cr',
  'lens': '~12cr',
  'variations': '4 runs',
  'animate': 'from 160cr',
}

interface MinimalNode { id: string; data?: { nodeType?: string; images?: unknown[]; audios?: unknown[] } }
interface MinimalEdge { source: string; target: string }

/** True when this node is an artifact card already holding a loadable result —
 *  the same criteria getFilteredWorkflow's auto-freeze uses, so the seed scope
 *  and the freeze set stay in agreement. */
function isFrozenArtifact(n: MinimalNode | undefined): boolean {
  const nt = n?.data?.nodeType
  const ref = nt === 'Audio' ? n?.data?.audios?.[0] : n?.data?.images?.[0]
  return (nt === 'Image' || nt === 'Video' || nt === 'Audio')
    && typeof ref === 'string' && ref.includes('filename=')
}

/** Seed scope for a 'variation' re-run: the targets plus every transitive
 *  upstream node, stopping at (and excluding) artifacts that already hold a
 *  result — those get auto-frozen by the run, so rerolling above them would
 *  churn live seeds on nodes that won't execute. */
export function upstreamSeedScope(
  targetIds: string[],
  nodes: MinimalNode[],
  edges: MinimalEdge[],
): Set<string> {
  const byId = new Map(nodes.map(n => [String(n.id), n]))
  const scope = new Set(targetIds.map(String))
  const stack = [...scope]
  while (stack.length) {
    const id = stack.pop()!
    for (const e of edges) {
      if (String(e.target) !== id) continue
      const s = String(e.source)
      if (scope.has(s)) continue
      if (isFrozenArtifact(byId.get(s))) continue
      scope.add(s)
      stack.push(s)
    }
  }
  return scope
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/artifact-next-steps.unit.spec.ts`
Expected: PASS (5 tests). Also run the full suite once: `npm run test:unit` — no other suite may break.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/lib/artifact/nextSteps.ts frontend/tests/unit/artifact-next-steps.unit.spec.ts
git commit -m "feat(artifact-actions): action credit hints + variation seed-scope helper"
```

---

### Task 2: `'variation'` reroll scope + sequential Variations runner

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue:5112-5156` (`getFilteredWorkflow`)
- Modify: `frontend/app/layouts/default.vue` (~line 430 `runVueWorkflow` opts type, ~line 630 `handleRunFiltered` untouched, new `handleRunVariations`, listeners at ~line 861/873)

**Interfaces:**
- Consumes: `upstreamSeedScope` from Task 1.
- Produces: window event contract `comfynext:runVariations` with detail `{ nodeId: string, count?: number }` (Task 4's menu item and Task 6's chip dispatch this). `getFilteredWorkflow` opts widen to `{ rerollScope?: 'self' | 'variation', direction?: 'downstream' }`.

- [ ] **Step 1: Widen the reroll scope in `getFilteredWorkflow`**

In `VueNodeCanvas.vue`, add the import near the other `~/lib` imports (around line 54-60):

```ts
import { upstreamSeedScope } from '~/lib/artifact/nextSteps'
```

Change the signature and seed policy (currently lines 5112-5128):

```ts
function getFilteredWorkflow(
  targetIds: string[],
  opts: { rerollScope?: 'self' | 'variation'; direction?: 'downstream' } = {},
) {
  // Seed policy:
  //  • 'downstream' (run here → end) = randomize NOTHING. The point is to push
  //    this node's CURRENT result through the rest of the graph, so neither it
  //    nor anything else should regenerate.
  //  • 'self' (re-roll this node) = randomize only the target's seed; upstream
  //    stays cached.
  //  • 'variation' (Variations ×N) = randomize the target AND its upstream
  //    producers' seeds, stopping at artifacts that hold a result (those get
  //    auto-frozen below) — the producing generator re-runs with a fresh seed.
  //  • default (rebuild from start → here) = randomize every seed in the graph.
  const seedScope = opts.direction === 'downstream'
    ? new Set<string>()
    : opts.rerollScope === 'self'
      ? new Set(targetIds)
      : opts.rerollScope === 'variation'
        ? upstreamSeedScope(targetIds, nodes.value as any[], edges.value as any[])
        : undefined
```

And include `'variation'` in the auto-freeze condition (currently line 5141):

```ts
  const autoFreeze = (targetIds.length && (opts.rerollScope === 'self' || opts.rerollScope === 'variation' || opts.direction === 'downstream'))
    ? upstreamArtifactsWithResults(targetIds)
    : undefined
```

- [ ] **Step 2: Widen `runVueWorkflow`'s opts type in `default.vue`**

Line ~432, change the opts type only:

```ts
  opts: { rerollScope?: 'self' | 'variation', direction?: 'downstream', live?: boolean, skipCostConfirm?: boolean, costConfirmIterations?: number } = {},
```

- [ ] **Step 3: Add the sequential Variations handler in `default.vue`**

Place it directly below `handleRunTextIterator` (after line ~858). Same shape as the text iterator: `runVueWorkflow` snapshots live canvas state per call, so seeds re-randomize each iteration; the first run carries the ×N cost confirm.

```ts
// Variations ×N: re-run the artifact's producing generator N times with fresh
// seeds; each result lands as a Take on the artifact. Sequential like the text
// iterator — runVueWorkflow reads live canvas state (and rolls seeds) per call.
let variationsRunning = false
async function handleRunVariations(e: Event) {
  if (variationsRunning) {
    console.warn('[Variations] already running, ignoring re-entry')
    return
  }
  const detail = (e as CustomEvent).detail as { nodeId?: string; count?: number } | undefined
  const nodeId = detail?.nodeId
  const count = Math.min(Math.max(1, detail?.count ?? 4), 8)
  if (!nodeId) return
  variationsRunning = true
  try {
    for (let i = 0; i < count; i++) {
      const expanded = vueCanvasRef.value?.materializeAutoImageSinks?.([nodeId]) ?? [nodeId]
      const queued = await runVueWorkflow(expanded, i === 0
        ? { rerollScope: 'variation', costConfirmIterations: count }
        : { rerollScope: 'variation', skipCostConfirm: true })
      if (queued === false) break // user declined the cost confirm
      // Small breather so the bridge / queue settles before the next.
      await new Promise(r => setTimeout(r, 250))
    }
  } finally {
    variationsRunning = false
  }
}
```

Register/unregister next to the other listeners (lines ~864 and ~876):

```ts
  window.addEventListener('comfynext:runVariations', handleRunVariations)
```
```ts
  window.removeEventListener('comfynext:runVariations', handleRunVariations)
```

- [ ] **Step 4: Verify nothing regressed**

Run: `cd frontend && npm run test:unit`
Expected: all suites pass (this step has no unit coverage of its own — the scope math was tested in Task 1; the event loop is exercised in Task 7's manual pass).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/layouts/default.vue
git commit -m "feat(artifact-actions): 'variation' reroll scope + sequential runVariations handler"
```

---

### Task 3: `applyEffect` gains `run` + `focus`; Animate spawn handler

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue:1508-1536` (`spliceAfterNode`), `:1622-1626` (`handleApplyEffect`), imports ~line 54-60, listener registration (search `comfynext:applyEffect` — add the new listener beside it)

**Interfaces:**
- Consumes: `createNodeData` (VueNodeCanvas:1343), `hydrateShotSheet` (already imported line 55), `shotDirectorOpenForId` (line 2477), `fitView` (line 888).
- Produces: `comfynext:applyEffect` detail widens to `{ nodeId, nodeType, output?, widgetOverrides?, run?: boolean, focus?: boolean }`; new window event `comfynext:animateArtifact` with detail `{ nodeId: string }`. Task 4's menu items dispatch both.

- [ ] **Step 1: Make `spliceAfterNode` return the new node id and toast on unknown type**

Replace lines 1508-1513 (`toast` is already imported in VueNodeCanvas — verify with grep; if not, add `import { toast } from 'vue-sonner'`):

```ts
async function spliceAfterNode(nodeId: string, nodeType: string, outType = 'IMAGE', widgetOverrides?: Record<string, unknown>): Promise<string | null> {
  if (!objectInfo.value[nodeType]) await fetchObjectInfo()
  if (!objectInfo.value[nodeType]) {
    toast.error(`${nodeType} isn't available`, { description: 'Is the ComfyUI backend running with the latest nodes? Restart it and try again.' })
    return null
  }
  const src = (nodes.value as any[]).find(n => n.id === nodeId)
  if (!src) return null
  const pos = { x: (src.position?.x ?? 0) + 360, y: (src.position?.y ?? 0) }
  const node = createNodeData(nodeType, pos, widgetOverrides)
```

And change the two remaining early `return`s in the function body to `return node.id`, plus a final `return node.id` after `addEdges(newEdges)`:

```ts
  if (!srcOutHandle || !inHandle) return node.id
```
```ts
  addEdges(newEdges)
  return node.id
}
```

Note: `BackgroundRemove` / `LensReframe` are frontend-registered extra nodes that DO appear in `/object_info` (they're Python `comfy_extras` classes), so the unknown-type toast only fires when the backend genuinely lacks them.

- [ ] **Step 2: Extend `handleApplyEffect` with `run` and `focus`**

Replace lines 1622-1626:

```ts
async function handleApplyEffect(e: Event) {
  const { nodeId, nodeType, output, widgetOverrides, run, focus } = (e as CustomEvent).detail || {}
  if (!nodeId || !nodeType) return
  const newId = await spliceAfterNode(String(nodeId), String(nodeType), output || 'IMAGE', widgetOverrides)
  if (!newId) return
  if (focus) {
    // Bring the freshly spawned node into view so the user can aim it before running.
    fitView({ nodes: [newId], padding: 0.5, duration: 250 })
  }
  if (run) {
    // One-tap actions (Upscale): run the new node immediately; 'self' scope
    // freezes the upstream artifact so it feeds its image instead of re-running
    // (and re-billing) the chain that produced it.
    window.dispatchEvent(new CustomEvent('comfynext:runFiltered', {
      detail: { targetIds: [newId], rerollScope: 'self' },
    }))
  }
}
```

- [ ] **Step 3: Add the Animate handler**

Add imports at the top (line ~55 area): extend the existing `refUpload` import to `import { viewRefUrl, uploadRefFile } from '~/lib/shotdirector/refUpload'` and the hydrate import to `import { hydrateShotSheet, addRef } from '~/lib/shotdirector/hydrate'`.

Add near `handleOpenShotDirector` (line ~2478):

```ts
/** "Animate" from an image artifact: upload the image as a Shot Director
 *  reference (input-dir copy — Replicate can't fetch output-dir views), spawn a
 *  ShotDirector node beside the artifact with the ref pre-seeded, and open its
 *  editor so the user aims the shot before any paid run. */
async function handleAnimateArtifact(e: Event) {
  const detail = (e as CustomEvent).detail || {}
  const src = (nodes.value as any[]).find(n => n.id === String(detail.nodeId))
  const imgUrl = src?.data?.images?.[0]
  if (!src || typeof imgUrl !== 'string') return
  try {
    const blob = await (await fetch(imgUrl)).blob()
    const refUrl = await uploadRefFile(new File([blob], 'animate.png', { type: blob.type || 'image/png' }))
    // Reference mode + composition-lock: "this exact picture, brought to life".
    // (firstFrame mode exists on the sheet but has no compile/dispatch wiring yet.)
    const sheet = addRef(hydrateShotSheet(undefined), 'image', refUrl, 'composition-lock')
    const pos = { x: (src.position?.x ?? 0) + 360, y: (src.position?.y ?? 0) }
    const node = createNodeData('ShotDirector', pos, undefined, { comfynext_shotDirector: sheet })
    nodes.value.push(node)
    await nextTick()
    fitView({ nodes: [node.id], padding: 0.5, duration: 250 })
    shotDirectorOpenForId.value = String(node.id)
  } catch (err) {
    console.error('[Animate] spawn failed:', err)
    toast.error('Animate failed', { description: String((err as any)?.message || err).slice(0, 120) })
  }
}
```

Register it wherever `comfynext:applyEffect`'s listener is added/removed (grep `addEventListener('comfynext:applyEffect'` in VueNodeCanvas.vue and mirror both lines):

```ts
  window.addEventListener('comfynext:animateArtifact', handleAnimateArtifact)
```
```ts
  window.removeEventListener('comfynext:animateArtifact', handleAnimateArtifact)
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run test:unit`
Expected: all pass. (Behavioral verification is Task 7's manual pass — these are canvas-component changes without a unit harness.)

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(artifact-actions): applyEffect run/focus flags + animateArtifact spawn handler"
```

---

### Task 4: Regrouped Edit… menu with the six new actions

**Files:**
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` — script (~lines 242-290, action functions) and template (~lines 500-541, the dropdown)

**Interfaces:**
- Consumes: `ACTION_HINTS` (Task 1), event contracts from Tasks 2-3, existing `hasUpstream` computed (line 73), existing `runEdit(action)` closer (line 336).
- Produces: the complete 10-item menu; the action functions `spawnEnhanceDetail` / `spawnUpscale` / `spawnRelight` / `spawnLensReframe` / `runVariations` / `animateArtifact` (Task 6's chip strip reuses `spawnUpscale`, `runVariations`, `animateArtifact` — keep these names exact).

- [ ] **Step 1: Add imports and action functions**

Extend the lucide import (line 3) with: `Gem, ZoomIn, Lamp, Aperture, Shuffle, Clapperboard`.
Add: `import { ACTION_HINTS } from '~/lib/artifact/nextSteps'`.

Add below `editWithNanoBanana()` (~line 290):

```ts
// ── Escalator actions (ARPU levers 2+5) ─────────────────────────────────────
// Enhance/Relight/Lens spawn their generator pre-wired and focused but UN-RUN
// (the user aims first, then pays). Upscale is a true one-tap: spawn + run,
// upstream artifact frozen so only the upscaler bills.
function spliceEffect(nodeType: string, opts: { run?: boolean; focus?: boolean } = {}, widgetOverrides?: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('comfynext:applyEffect', {
    detail: { nodeId: props.id, nodeType, output: 'IMAGE', widgetOverrides, ...opts },
  }))
}
function spawnEnhanceDetail() { spliceEffect('EnhanceDetailNode', { focus: true }) }
function spawnUpscale() { spliceEffect('UpscaleImageNode', { run: true }) }
function spawnRelight() { spliceEffect('RelightNode', { focus: true }) }
function spawnLensReframe() { spliceEffect('LensReframe', { focus: true }) }

// Variations ×4: sequential re-runs of the producing generator with fresh
// seeds; results accumulate in the Takes strip. Needs something upstream to
// re-run, hence the hasUpstream gate (mirrored as a disabled menu row).
function runVariations() {
  window.dispatchEvent(new CustomEvent('comfynext:runVariations', { detail: { nodeId: props.id, count: 4 } }))
}

// Animate: spawn a Shot Director seeded with this image as reference.
function animateArtifact() {
  window.dispatchEvent(new CustomEvent('comfynext:animateArtifact', { detail: { nodeId: props.id } }))
}
```

- [ ] **Step 2: Restructure the dropdown template**

Replace the dropdown contents (lines 511-540, everything inside the `v-if="editMenuOpen"` div) with the sectioned version. Keep the outer div's classes but widen: `min-w-[136px]` → `min-w-[190px]`.

```html
          <div
            v-if="editMenuOpen"
            class="absolute top-full right-0 mt-1 min-w-[190px] rounded-md border border-white/10 bg-[#1a1a1a] shadow-lg py-1"
          >
            <div class="px-2.5 pt-1 pb-0.5 text-[9px] uppercase tracking-wider text-white/30 select-none">Retouch</div>
            <button class="edit-menu-item" @click.stop="runEdit(removeBackground)">
              <Eraser class="size-3 shrink-0" /> Remove BG
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(openInpaint)">
              <Brush class="size-3 shrink-0" /> Inpaint
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(editWithNanoBanana)">
              <Wand2 class="size-3 shrink-0" /> Edit (Nano Banana)
              <span class="edit-menu-hint">{{ ACTION_HINTS['nano-banana'] }}</span>
            </button>
            <button v-if="data.images?.length" class="edit-menu-item" @click.stop="runEdit(critiqueResult)">
              <Sparkles class="size-3 shrink-0" /> Fix
            </button>

            <div class="mt-1 border-t border-white/[0.06] px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-white/30 select-none">Enhance</div>
            <button class="edit-menu-item" @click.stop="runEdit(spawnEnhanceDetail)">
              <Gem class="size-3 shrink-0" /> Enhance Detail
              <span class="edit-menu-hint">{{ ACTION_HINTS.enhance }}</span>
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(spawnUpscale)">
              <ZoomIn class="size-3 shrink-0" /> Upscale
              <span class="edit-menu-hint">{{ ACTION_HINTS.upscale }}</span>
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(spawnRelight)">
              <Lamp class="size-3 shrink-0" /> Relight
              <span class="edit-menu-hint">{{ ACTION_HINTS.relight }}</span>
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(spawnLensReframe)">
              <Aperture class="size-3 shrink-0" /> Lens · Reframe
              <span class="edit-menu-hint">{{ ACTION_HINTS.lens }}</span>
            </button>

            <div class="mt-1 border-t border-white/[0.06] px-2.5 pt-1.5 pb-0.5 text-[9px] uppercase tracking-wider text-white/30 select-none">Create</div>
            <button
              class="edit-menu-item disabled:opacity-35 disabled:cursor-default"
              :disabled="!hasUpstream"
              :title="hasUpstream ? 'Re-run the generator 4× with fresh seeds' : 'Nothing upstream to re-run — this image was uploaded'"
              @click.stop="runEdit(runVariations)"
            >
              <Shuffle class="size-3 shrink-0" /> Variations ×4
              <span class="edit-menu-hint">{{ ACTION_HINTS.variations }}</span>
            </button>
            <button class="edit-menu-item" @click.stop="runEdit(animateArtifact)">
              <Clapperboard class="size-3 shrink-0" /> Animate
              <span class="edit-menu-hint">{{ ACTION_HINTS.animate }}</span>
            </button>
          </div>
```

Add the two shared classes in the component's `<style scoped>` block (create one if the component has none — check the end of the file):

```css
.edit-menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.625rem;
  font-size: 11px;
  color: rgb(255 255 255 / 0.75);
  cursor: pointer;
  transition: color 0.15s, background-color 0.15s;
}
.edit-menu-item:hover:not(:disabled) {
  color: #fff;
  background-color: rgb(255 255 255 / 0.08);
}
.edit-menu-hint {
  margin-left: auto;
  padding-left: 0.75rem;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: rgb(255 255 255 / 0.35);
}
```

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run test:unit`
Expected: all pass. Then a quick render sanity check in the dev preview (menu opens, three section headers, hints right-aligned, Variations greyed on an uploaded image) — full behavioral pass is Task 7.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/components/vue-canvas/ArtifactImageNode.vue
git commit -m "feat(artifact-actions): regrouped Edit menu — Retouch/Enhance/Create + credit hints"
```

---

### Task 5: Chip-strip coordination composable

**Files:**
- Create: `frontend/app/composables/useNextStepsStrip.ts`
- Test: `frontend/tests/unit/artifact-next-steps.unit.spec.ts` (append a describe block)

**Interfaces:**
- Produces: `useNextStepsStrip(): { active: Ref<{ nodeId: string; shownAt: number } | null>, announceFreshTake(nodeId: string): void, dismiss(): void }` — module-singleton state so exactly one artifact shows a strip. Task 6 consumes it.

- [ ] **Step 1: Write the failing test** (append to the Task 1 spec file)

```ts
import { useNextStepsStrip } from '~/composables/useNextStepsStrip'

describe('useNextStepsStrip', () => {
  it('is a singleton: a fresh take on B replaces the strip on A', () => {
    const a = useNextStepsStrip()
    const b = useNextStepsStrip()
    a.announceFreshTake('node-A')
    expect(a.active.value?.nodeId).toBe('node-A')
    b.announceFreshTake('node-B')
    expect(a.active.value?.nodeId).toBe('node-B') // same shared state
  })

  it('dismiss clears the strip', () => {
    const s = useNextStepsStrip()
    s.announceFreshTake('node-A')
    s.dismiss()
    expect(s.active.value).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/artifact-next-steps.unit.spec.ts`
Expected: FAIL — cannot resolve `~/composables/useNextStepsStrip`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/app/composables/useNextStepsStrip.ts
// Singleton coordination for the post-render "next steps" chip strip: exactly
// one artifact (the most recently rendered) shows it, and any new render or
// dismissal replaces/clears it. Module-scoped ref = shared across components.
import { ref } from 'vue'

const active = ref<{ nodeId: string; shownAt: number } | null>(null)

export function useNextStepsStrip() {
  function announceFreshTake(nodeId: string) {
    active.value = { nodeId, shownAt: Date.now() }
  }
  function dismiss() {
    active.value = null
  }
  return { active, announceFreshTake, dismiss }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/artifact-next-steps.unit.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/composables/useNextStepsStrip.ts frontend/tests/unit/artifact-next-steps.unit.spec.ts
git commit -m "feat(artifact-actions): singleton next-steps strip coordination composable"
```

---

### Task 6: NextStepsStrip component + artifact integration

**Files:**
- Create: `frontend/app/components/vue-canvas/NextStepsStrip.vue`
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (script: takes watcher; template: mount the strip between the image row and the footer, next to the existing `TakesStrip` mount ~line 641-650)

**Interfaces:**
- Consumes: `useNextStepsStrip` (Task 5), `ACTION_HINTS` (Task 1). Emits `variations`, `upscale`, `animate`, `more` — the parent maps them onto the Task 4 action functions.

- [ ] **Step 1: Create the component**

```vue
<!-- frontend/app/components/vue-canvas/NextStepsStrip.vue -->
<script setup lang="ts">
// Transient post-render escalator chips (ARPU lever 5 surface). Deliberately
// quiet — dark suggestion chips, not a pastel CTA — and self-dismissing: ~12s
// timer or any pointerdown outside the strip. The parent decides WHEN to show
// it (fresh take + singleton owner); this component only renders and dismisses.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Shuffle, ZoomIn, Clapperboard, MoreHorizontal } from 'lucide-vue-next'
import { ACTION_HINTS } from '~/lib/artifact/nextSteps'

const emit = defineEmits<{
  (e: 'variations' | 'upscale' | 'animate' | 'more' | 'dismiss'): void
}>()

const props = defineProps<{ canVary: boolean }>()

const rootRef = ref<HTMLElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

function onWindowPointerDown(ev: PointerEvent) {
  if (rootRef.value && !rootRef.value.contains(ev.target as Node)) emit('dismiss')
}
onMounted(() => {
  timer = setTimeout(() => emit('dismiss'), 12_000)
  window.addEventListener('pointerdown', onWindowPointerDown, true)
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
})

function pick(action: 'variations' | 'upscale' | 'animate' | 'more') {
  emit(action)
  if (action !== 'more') emit('dismiss')
}
</script>

<template>
  <div
    ref="rootRef"
    class="nopan nodrag next-steps-strip flex items-center gap-1 px-1.5 py-1 border-t border-white/5 bg-black/60"
  >
    <span class="text-[9px] text-white/30 pr-0.5 select-none">Next</span>
    <button v-if="canVary" class="ns-chip" title="Re-run the generator 4× with fresh seeds" @click.stop="pick('variations')">
      <Shuffle class="size-2.5" /> Variations
    </button>
    <button class="ns-chip" :title="`Upscale (${ACTION_HINTS.upscale})`" @click.stop="pick('upscale')">
      <ZoomIn class="size-2.5" /> Upscale <span class="ns-hint">{{ ACTION_HINTS.upscale }}</span>
    </button>
    <button class="ns-chip" title="Animate — direct a video shot from this image" @click.stop="pick('animate')">
      <Clapperboard class="size-2.5" /> Animate
    </button>
    <span class="flex-1" />
    <button class="ns-chip" title="All edit and enhance actions" @click.stop="pick('more')">
      <MoreHorizontal class="size-2.5" />
    </button>
  </div>
</template>

<style scoped>
.next-steps-strip {
  animation: ns-in 0.18s ease-out;
}
@keyframes ns-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}
.ns-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.25rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 10px;
  color: rgb(255 255 255 / 0.7);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.ns-chip:hover {
  color: #fff;
  background-color: rgb(255 255 255 / 0.1);
}
.ns-hint {
  font-size: 8px;
  font-variant-numeric: tabular-nums;
  color: rgb(255 255 255 / 0.35);
}
</style>
```

- [ ] **Step 2: Integrate in `ArtifactImageNode.vue`**

Script additions (below the Takes section, ~line 431):

```ts
// --- Post-render next-steps chip strip (ARPU lever 5) -----------------------
// Shows on THIS artifact only when a take lands while the canvas is open and
// this is the most recently rendered artifact (singleton). Baseline is taken
// at mount so restoring a saved canvas never pops strips.
import { useNextStepsStrip } from '~/composables/useNextStepsStrip'
import NextStepsStrip from '~/components/vue-canvas/NextStepsStrip.vue'
const nextSteps = useNextStepsStrip()
watch(() => props.data.takes?.length ?? 0, (now, before) => {
  if (now > (before ?? 0)) nextSteps.announceFreshTake(props.id)
})
const showNextSteps = computed(() => nextSteps.active.value?.nodeId === props.id)
function openEditMenuFromStrip() {
  nextSteps.dismiss()
  editMenuOpen.value = true
}
```

(Move the two imports up to the import block at the top of `<script setup>`; `watch`/`computed` are auto-imported in this codebase — match the file's existing convention.)

Template: insert directly ABOVE the footer row (the `<div class="flex items-center gap-1.5 px-2 py-1.5 border-t border-white/5">` at ~line 549):

```html
        <NextStepsStrip
          v-if="showNextSteps && displayedUrl"
          :can-vary="hasUpstream"
          @variations="runVariations"
          @upscale="spawnUpscale"
          @animate="animateArtifact"
          @more="openEditMenuFromStrip"
          @dismiss="nextSteps.dismiss()"
        />
```

- [ ] **Step 3: Verify**

Run: `cd frontend && npm run test:unit`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/components/vue-canvas/NextStepsStrip.vue frontend/app/components/vue-canvas/ArtifactImageNode.vue
git commit -m "feat(artifact-actions): post-render next-steps chip strip on image artifacts"
```

---

### Task 7: Live verification pass

**Files:** none (verification only). Needs the Nuxt dev server; free actions only — do NOT run paid generators to completion. Spawning nodes and opening editors is free; only queue runs for the free/local paths.

- [ ] **Step 1: Start the dev preview** (`preview_start` on the frontend dev server; ComfyUI backend should be running — if not, note which checks were skipped).

- [ ] **Step 2: Menu checks** on an artifact with a rendered image:
  - Edit… opens: 3 section headers, 10 rows, hints right-aligned.
  - Enhance Detail / Relight / Lens · Reframe: each spawns its node wired to the artifact, view pans to it, **nothing runs**.
  - Upscale: spawns `UpscaleImageNode` AND queues a run scoped to it (verify in the queue/network that only the upscaler + frozen feed executes — the upstream generator must NOT re-run).
  - Animate: spawns a ShotDirector card showing `1 img` ref, and its editor opens with the image visible in references.
  - On an UPLOADED image artifact: Variations row disabled with the explanatory tooltip.

- [ ] **Step 3: Variations check** (only with a cheap/free local generator upstream): Variations ×4 → 4 sequential runs queue, each with a different upstream seed (inspect two queued prompts' seed values), takes accumulate in the Takes strip.

- [ ] **Step 4: Chip strip checks**: after a render completes, the strip fades in under the image; it does NOT appear on canvas reload; a render on artifact B moves the strip off artifact A; clicking elsewhere dismisses; `More…` opens the Edit menu; after ~12s it auto-dismisses.

- [ ] **Step 5: Screenshot proof** of (a) the open grouped menu and (b) the chip strip, shared in the final report.

- [ ] **Step 6: Update memory + report.** Update the auto-memory index with a project memory for this feature (surface, events, gotchas found during verification). Report results honestly, including anything not verifiable without paid runs (e.g. Animate's actual video generation — out of scope; the aim surface is the deliverable).

## Self-review notes

- Spec coverage: menu regroup (T4), hints (T1+T4), mixed behavior (T3+T4), Variations mechanics + upstream-seed requirement (T1+T2), Animate spawn (T3+T4), uploaded-image edge case (T4), missing-node toast (T3), chip strip incl. transience + singleton + More… (T5+T6), tests (T1, T5), manual pass (T7). Spec's "wired + focused" for Animate deviates deliberately — recorded in Global Constraints.
- The spec's `'upstream-seed'` scope name became `'variation'` — clearer at the call sites; same semantics.
- Type consistency: `spawnUpscale`/`runVariations`/`animateArtifact` names shared by T4 menu and T6 strip; `spliceAfterNode` returns `Promise<string | null>` consumed only inside VueNodeCanvas.
