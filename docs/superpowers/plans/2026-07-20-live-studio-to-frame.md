# Live Studio → Frame Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire animated studios (Gradient/Shader/Space Type) into a Frame's slots, pulling live frames per slot and compositing on a Frame-owned master clock.

**Architecture:** One shared studio-aware slot resolver replaces the Frame's four drifted input resolvers and generalizes the shader's `resolveSourceKind`. A pure master-clock module derives the Frame's timeline from its animated slots (with override) and maps master time → each slot's native-speed loop phase. The Frame preview and export then pull `getFrame` per animated slot and composite the existing layer stack.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, WebGL/2D canvas compositing, Vitest (`tests/unit/**/*.unit.spec.ts`), dev/browser verification for GL/UI.

## Global Constraints

- Unit tests live at `frontend/tests/unit/<name>.unit.spec.ts`, glob `tests/unit/**/*.unit.spec.ts`, `environment: 'node'` (no DOM). Run: `cd frontend && npx vitest run <file>`.
- Imports inside `frontend/app` use the `~` alias.
- **Back-compat is an acceptance test:** an Image-artifact → Frame slot must render byte-identically after the resolver unification; a still-only Frame previews and exports exactly as today.
- **PARALLEL-SESSION HAZARD:** `ArtifactFrameNode.vue`, `CompositorModal.vue`, and `VueNodeCanvas.vue` are under active edit by another session (17 and 26 uncommitted hunks at plan time). Every task touching them MUST stage line-precisely (hand-built patch + `git apply --cached`), never `git add -A`/`.`, never `git stash`/`restore`/`checkout --`. Re-read the file immediately before editing — line numbers below are approximate and will have shifted.
- Commit directly to main; stage only the files listed per task.
- Typecheck baseline ~328 pre-existing errors; ~6 pre-existing failing unit files. "No new" means the counts don't rise.

## Execution phases

- **Phase A (Tasks 1–2): pure foundation, NEW files only — conflict-free, safe to run unattended.**
- **Phase B (Tasks 3–7): integration into the churning parallel `.vue` files — run only with a human present to coordinate line-precise staging with the other session.**

## File Structure

**Create:**
- `frontend/app/lib/studio/frameResolve.ts` — the shared studio-aware wired-source resolver (`resolveWiredSourceKind`), generalizing `resolveSourceKind` to any target handle + multi-output index + the Frame's URL cases.
- `frontend/app/lib/compositor/masterClock.ts` — pure master-clock derivation + per-slot phase mapping.
- `frontend/tests/unit/studio-frame-resolve.unit.spec.ts`
- `frontend/tests/unit/compositor-master-clock.unit.spec.ts`

**Modify (Phase B — parallel files):**
- `frontend/app/lib/shaderstudio/resolve.ts` — re-point `resolveSourceKind` at the shared resolver (clean file).
- `frontend/app/components/vue-canvas/ArtifactFrameNode.vue` — slot resolution → live/URL; live preview loop; per-frame bake.
- `frontend/app/components/vue-canvas/CompositorModal.vue` — modal resolver → shared.
- `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — preview + submit resolvers → shared; `publishStudioOutput` Frame carve-out (clobber fix).

---

### Task 1: Shared studio-aware wired-source resolver

**Files:**
- Create: `frontend/app/lib/studio/frameResolve.ts`
- Test: `frontend/tests/unit/studio-frame-resolve.unit.spec.ts`

**Interfaces:**
- Consumes: `getStudioFrameSource`, `StudioFrameSource` from `~/lib/studio/frameSource`.
- Produces:
  - `WiredSourceKind = { kind: 'live'; source: StudioFrameSource } | { kind: 'url'; url: string } | null`
  - `resolveWiredSourceKind(target: string, handle: string, nodes: any[], edges: any[]): WiredSourceKind`

This is the single resolver every consumer will call. It folds in the Frame's richer URL logic (multi-output `output-N` index, `LoadImage`, `Image` widget) so it can replace `resolveSrcUrl` too. The live-source branch keys on the *edge source node id*.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/studio-frame-resolve.unit.spec.ts`:

```ts
// frontend/tests/unit/studio-frame-resolve.unit.spec.ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  registerStudioFrameSource,
  unregisterStudioFrameSource,
  type StudioFrameSource,
} from '~/lib/studio/frameSource'
import { resolveWiredSourceKind } from '~/lib/studio/frameResolve'

const frames = (over: Partial<StudioFrameSource> = {}): StudioFrameSource => ({
  getFrame: async () => ({} as any), duration: 5, fps: 24, width: 800, height: 600, ...over,
})
const edge = (source: string, target: string, handle: string, sourceHandle?: string) =>
  ({ source, target, targetHandle: handle, sourceHandle })

describe('resolveWiredSourceKind', () => {
  beforeEach(() => { unregisterStudioFrameSource('up') })

  it('returns null when nothing is wired to the handle', () => {
    expect(resolveWiredSourceKind('f1', 'input-3', [{ id: 'f1', data: {} }], [])).toBeNull()
  })

  it('prefers a live upstream frame source over the artifact file', () => {
    const src = frames()
    registerStudioFrameSource('up', src)
    const nodes = [{ id: 'f1', data: {} }, { id: 'up', data: { images: ['/view?stale.png'] } }]
    const got = resolveWiredSourceKind('f1', 'input-3', nodes, [edge('up', 'f1', 'input-3')])
    expect(got).toEqual({ kind: 'live', source: src })
  })

  it('falls back to images[0] when no live source', () => {
    const nodes = [{ id: 'f1', data: {} }, { id: 'up', data: { images: ['/view?a.png'] } }]
    const got = resolveWiredSourceKind('f1', 'input-0', nodes, [edge('up', 'f1', 'input-0')])
    expect(got).toEqual({ kind: 'url', url: '/view?a.png' })
  })

  it('honors the multi-output source handle index', () => {
    const nodes = [{ id: 'f1', data: {} }, { id: 'up', data: { images: ['/view?bg.png', '/view?fg.png'] } }]
    const got = resolveWiredSourceKind('f1', 'input-2', nodes, [edge('up', 'f1', 'input-2', 'output-1')])
    expect(got).toEqual({ kind: 'url', url: '/view?fg.png' })
  })

  it('builds a /view URL for a LoadImage source', () => {
    const nodes = [{ id: 'f1', data: {} }, { id: 'up', data: { nodeType: 'LoadImage', widgetsValues: ['p.jpg'] } }]
    const got = resolveWiredSourceKind('f1', 'input-1', nodes, [edge('up', 'f1', 'input-1')])
    expect(got?.kind).toBe('url')
    expect((got as any).url).toContain('filename=p.jpg')
  })

  it('builds a /view URL for an Image artifact widget (name lookup)', () => {
    const nodes = [
      { id: 'f1', data: {} },
      { id: 'up', data: { nodeType: 'Image', widgetDefs: [{ name: 'x' }, { name: 'image' }], widgetsValues: ['n', 'pasted.png'] } },
    ]
    const got = resolveWiredSourceKind('f1', 'input-1', nodes, [edge('up', 'f1', 'input-1')])
    expect((got as any).url).toContain('filename=pasted.png')
  })

  it('matches only the requested handle, not other slots', () => {
    const nodes = [{ id: 'f1', data: {} }, { id: 'up', data: { images: ['/view?a.png'] } }]
    const edges = [edge('up', 'f1', 'input-5')]
    expect(resolveWiredSourceKind('f1', 'input-2', nodes, edges)).toBeNull()
    expect(resolveWiredSourceKind('f1', 'input-5', nodes, edges)).toEqual({ kind: 'url', url: '/view?a.png' })
  })

  it('coerces numeric ids (litegraph) when matching', () => {
    const src = frames()
    registerStudioFrameSource('up', src)
    const nodes = [{ id: 1, data: {} }, { id: 'up', data: {} }]
    const got = resolveWiredSourceKind('1', 'input-0', nodes, [{ source: 'up', target: 1, targetHandle: 'input-0' }])
    expect(got).toEqual({ kind: 'live', source: src })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/studio-frame-resolve.unit.spec.ts`
Expected: FAIL — `Failed to resolve import "~/lib/studio/frameResolve"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/studio/frameResolve.ts`:

```ts
// frontend/app/lib/studio/frameResolve.ts
// The single studio-aware resolver for a wired input. Given a target node + handle,
// returns a live studio frame source (preferred) or a baked image URL — folding in
// the Frame's multi-output/LoadImage/Image cases so it can replace resolveSrcUrl,
// getUpstreamImageUrl, getNodeImageUrl AND the shader's resolveSourceKind.

import { getStudioFrameSource, type StudioFrameSource } from '~/lib/studio/frameSource'

export type WiredSourceKind =
  | { kind: 'live'; source: StudioFrameSource }
  | { kind: 'url'; url: string }
  | null

/** Read an upstream node's widget value by name (widgetDefs[i] ↔ widgetsValues[i]). */
function widgetVal(src: any, name: string): string | null {
  const defs = src?.data?.widgetDefs
  const vals = src?.data?.widgetsValues
  if (!Array.isArray(defs) || !Array.isArray(vals)) return null
  const i = defs.findIndex((w: any) => w?.name === name)
  return i >= 0 ? (vals[i] || null) : null
}

/** Multi-output sources mirror images in output-slot order; the wire picks which. */
function outputIndex(edge: any): number {
  const m = /^output-(\d+)$/.exec(edge?.sourceHandle ?? '')
  return m ? Number(m[1]) : 0
}

function urlFor(src: any, edge: any): string | null {
  if (src?.data?.images?.length) {
    const i = outputIndex(edge)
    return src.data.images[i] ?? src.data.images[0]
  }
  if (src?.data?.nodeType === 'LoadImage' && src?.data?.widgetsValues?.[0]) {
    return `/view?${new URLSearchParams({ filename: src.data.widgetsValues[0], type: 'input' })}`
  }
  if (src?.data?.nodeType === 'Image') {
    const file = widgetVal(src, 'image')
    if (file) return `/view?${new URLSearchParams({ filename: file, type: 'input' })}`
  }
  return null
}

/**
 * Resolve whatever is wired into `target`'s `handle`. Live upstream studio wins
 * (renders at any size/time); else a baked URL; else null. Ids are coerced to
 * strings so numeric litegraph ids and string vue-flow ids both match.
 */
export function resolveWiredSourceKind(
  target: string, handle: string, nodes: any[], edges: any[],
): WiredSourceKind {
  const edge = edges.find((e: any) => String(e.target) === String(target) && e.targetHandle === handle)
  if (!edge) return null
  const live = getStudioFrameSource(String(edge.source))
  if (live) return { kind: 'live', source: live }
  const src = nodes.find((n: any) => String(n.id) === String(edge.source))
  const url = src ? urlFor(src, edge) : null
  return url ? { kind: 'url', url } : null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/studio-frame-resolve.unit.spec.ts`
Expected: PASS — 8 passed

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/studio/frameResolve.ts frontend/tests/unit/studio-frame-resolve.unit.spec.ts
git commit -m "feat(studio): shared studio-aware wired-source resolver"
```

---

### Task 2: Master clock derivation + per-slot phase

**Files:**
- Create: `frontend/app/lib/compositor/masterClock.ts`
- Test: `frontend/tests/unit/compositor-master-clock.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `SlotClock = { duration: number; fps: number }` (a slot's native clock; `duration <= 0` = still)
  - `MasterClock = { duration: number; fps: number } | null`
  - `deriveMasterClock(slots: SlotClock[], override?: { duration: number; fps: number } | null): MasterClock`
  - `slotPhase01(masterTimeSec: number, slotDuration: number): number` — native-speed loop phase in [0,1)

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/compositor-master-clock.unit.spec.ts`:

```ts
// frontend/tests/unit/compositor-master-clock.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { deriveMasterClock, slotPhase01 } from '~/lib/compositor/masterClock'

describe('deriveMasterClock', () => {
  it('is null with no animated slots and no override', () => {
    expect(deriveMasterClock([{ duration: 0, fps: 0 }, { duration: 0, fps: 30 }])).toBeNull()
  })

  it('derives max duration and max fps across animated slots', () => {
    expect(deriveMasterClock([{ duration: 4, fps: 30 }, { duration: 6, fps: 24 }, { duration: 0, fps: 60 }]))
      .toEqual({ duration: 6, fps: 30 })
  })

  it('ignores still slots (duration <= 0) in the derivation', () => {
    expect(deriveMasterClock([{ duration: 0, fps: 999 }, { duration: 3, fps: 25 }]))
      .toEqual({ duration: 3, fps: 25 })
  })

  it('override wins over the derived clock', () => {
    expect(deriveMasterClock([{ duration: 6, fps: 24 }], { duration: 10, fps: 60 }))
      .toEqual({ duration: 10, fps: 60 })
  })

  it('override applies even with no animated slots', () => {
    expect(deriveMasterClock([{ duration: 0, fps: 0 }], { duration: 8, fps: 30 }))
      .toEqual({ duration: 8, fps: 30 })
  })

  it('ignores a null override', () => {
    expect(deriveMasterClock([{ duration: 5, fps: 30 }], null)).toEqual({ duration: 5, fps: 30 })
  })
})

describe('slotPhase01', () => {
  it('maps native-speed loop: master time modulo slot duration, normalized', () => {
    expect(slotPhase01(0, 4)).toBeCloseTo(0)
    expect(slotPhase01(1, 4)).toBeCloseTo(0.25)
    expect(slotPhase01(4, 4)).toBeCloseTo(0)      // wraps at its own duration
    expect(slotPhase01(5, 4)).toBeCloseTo(0.25)   // second loop
  })

  it('a slot longer than master has not yet wrapped', () => {
    expect(slotPhase01(3, 8)).toBeCloseTo(0.375)
  })

  it('guards a zero/negative slot duration as phase 0', () => {
    expect(slotPhase01(2, 0)).toBe(0)
    expect(slotPhase01(2, -1)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/compositor-master-clock.unit.spec.ts`
Expected: FAIL — `Failed to resolve import "~/lib/compositor/masterClock"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/compositor/masterClock.ts`:

```ts
// frontend/app/lib/compositor/masterClock.ts
// The Frame owns one master timeline. It cannot defer to any single upstream (up to
// 16 slots), so it derives its clock from the longest animated slot (max fps),
// unless a manual override is set. Animated slots play at native speed and loop
// within the master timeline (slotPhase01); still slots (duration <= 0) are constant.

export interface SlotClock { duration: number; fps: number }
export type MasterClock = { duration: number; fps: number } | null

/**
 * Master clock from the animated slots. Override wins when present. Null when there
 * is nothing animated and no override — the Frame is static (no loop, one-frame bake),
 * exactly today's behaviour. The derived branch never needs a fallback constant
 * because it only runs when at least one animated slot exists.
 */
export function deriveMasterClock(
  slots: SlotClock[], override?: { duration: number; fps: number } | null,
): MasterClock {
  if (override) return { duration: override.duration, fps: override.fps }
  const animated = slots.filter(s => s.duration > 0)
  if (!animated.length) return null
  return {
    duration: Math.max(...animated.map(s => s.duration)),
    fps: Math.max(...animated.map(s => s.fps)),
  }
}

/** Native-speed loop phase in [0,1): where this slot is at `masterTimeSec`. */
export function slotPhase01(masterTimeSec: number, slotDuration: number): number {
  if (slotDuration <= 0) return 0
  const t = ((masterTimeSec % slotDuration) + slotDuration) % slotDuration
  return t / slotDuration
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/compositor-master-clock.unit.spec.ts`
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/compositor/masterClock.ts frontend/tests/unit/compositor-master-clock.unit.spec.ts
git commit -m "feat(compositor): master-clock derivation + per-slot loop phase"
```

---

## Phase B — integration (human-supervised; parallel files)

> These tasks edit `ArtifactFrameNode.vue`, `CompositorModal.vue`, `VueNodeCanvas.vue`, and `resolve.ts`. The first three are under active parallel edit — re-read each file immediately before editing, stage line-precisely, and expect the line numbers below to have shifted. Do NOT run these unattended.

### Task 3: Re-point the shader resolver at the shared one (clean file, low risk)

**Files:** Modify `frontend/app/lib/shaderstudio/resolve.ts` (currently clean).

**Interfaces:** Consumes `resolveWiredSourceKind` (Task 1).

- [ ] **Step 1:** In `resolve.ts`, replace `resolveSourceKind`'s body so it delegates, preserving its exact `SourceKind | null` return shape and `input-0` handle:

```ts
import { resolveWiredSourceKind } from '~/lib/studio/frameResolve'
// …
export function resolveSourceKind(nodeId: string, nodes: any[], edges: any[]): SourceKind | null {
  return resolveWiredSourceKind(nodeId, 'input-0', nodes, edges)
}
```

Remove the now-unused `resolveWiredInput`/`getStudioFrameSource` imports if nothing else in the file uses them (check first).

- [ ] **Step 2:** Run the existing shader resolver tests — they must still pass unchanged:

Run: `cd frontend && npx vitest run tests/unit/shaderstudio-resolve.unit.spec.ts tests/unit/shaderstudio-source.unit.spec.ts`
Expected: PASS, same counts as before.

- [ ] **Step 3:** Verify the shader still resolves a live Gradient upstream in the browser (card + modal light up). Then commit `git add frontend/app/lib/shaderstudio/resolve.ts` — `fix(shader-studio): route resolveSourceKind through the shared resolver`.

### Task 4: `publishStudioOutput` Frame carve-out (clobber-bug fix)

**Files:** Modify `VueNodeCanvas.vue` around `publishStudioOutput` (~`:3693-3718`, will have moved).

**Why:** A studio wired to a Frame currently overwrites the Frame's own `data.images[0]`. A Frame must never be a `data.images` stamp target — it should receive the studio's output on a *slot* (which Task 5's resolver handles live), not have its composite clobbered.

- [ ] **Step 1:** Re-read the current `publishStudioOutput`. In its target-stamp loop, change the skip-guard so `artifact-frame` is excluded from the `data.images` stamp. The current guard is `if (isStudioNode(art) && !isArtifactNode(art)) continue`. A Frame is an artifact node, so it falls through and gets stamped. Add a Frame exclusion:

```ts
// A Frame composites its wired slots itself — never stamp its data.images (that is
// its OWN composite output). Its slot reads the studio live via the shared resolver.
if (isStudioNode(art) && !isArtifactNode(art)) continue
if (String(art.type) === 'artifact-frame') continue
```

- [ ] **Step 2:** Verify in the browser: wire a Gradient Studio directly into a Frame slot, press Render on the studio — the Frame's existing composite must NOT be replaced by the raw gradient file (before the fix it was). Commit `VueNodeCanvas.vue` line-precisely — `fix(compositor): don't clobber a Frame's composite when an upstream studio bakes`.

### Task 5: Frame slot resolution → live/URL + reactive re-resolve

**Files:** Modify `ArtifactFrameNode.vue` (`resolveSrcUrl` ~`:170`, `wiredLayers` ~`:199`, and the image-decode watch ~`:218`).

**Interfaces:** Consumes `resolveWiredSourceKind` (Task 1), `frameSourceEpoch` (`~/lib/studio/frameSource`), `slotPhase01`/`deriveMasterClock` (Task 2).

- [ ] **Step 1:** Re-read the file. Extend `WiredLayer` to carry the resolved kind, and change `wiredLayers` to use the shared resolver and depend on `frameSourceEpoch`:

```ts
import { resolveWiredSourceKind, type WiredSourceKind } from '~/lib/studio/frameResolve'
import { frameSourceEpoch } from '~/lib/studio/frameSource'
// WiredLayer gains: kind: WiredSourceKind  (and keep url?: string for the still path)
const wiredLayers = computed<WiredLayer[]>(() => {
  frameSourceEpoch.value  // re-resolve when a studio (un)registers
  const edges = injectedEdges?.value ?? [], nodes = injectedNodes?.value ?? []
  const out: WiredLayer[] = []
  for (let s = 0; s < 16; s++) {
    if (!slotConnected(s)) continue
    const kind = resolveWiredSourceKind(String(props.id), `input-${s}`, nodes, edges)
    if (!kind) continue
    out.push({ slot: s, kind, url: kind.kind === 'url' ? kind.url : undefined,
      x: layerTf(s,'x'), y: layerTf(s,'y'), rotation: layerTf(s,'rotation'),
      scale: layerTf(s,'scale'), opacity: wiredOpacity(s), blend: blendOf(s), cloner: wiredCloner(s) })
  }
  return out
})
```

The still-image decode path (`wiredImages`/`wiredDims`, keyed by url) stays for `kind:'url'` layers. Live layers (`kind:'live'`) don't pre-decode — they pull per frame in Task 6.

- [ ] **Step 2:** Because `wiredLayers` keys change, verify the existing still path (Image artifact → slot) still decodes and paints byte-identically. Compile-check + browser: an Image-fed Frame renders as before.

- [ ] **Step 3:** Commit `ArtifactFrameNode.vue` line-precisely — `feat(compositor): resolve Frame slots through the shared studio-aware resolver`.

### Task 6: Live preview loop + per-frame composite

**Files:** Modify `ArtifactFrameNode.vue` (the paint path `paintLayerStack`/`exportCompositeCanvas` ~`:514`, and add a rAF loop).

**Interfaces:** Consumes `deriveMasterClock`, `slotPhase01` (Task 2).

- [ ] **Step 1:** Add a master-clock computed from the live slots:

```ts
const masterClock = computed(() => deriveMasterClock(
  wiredLayers.value.map(l => l.kind?.kind === 'live'
    ? { duration: l.kind.source.duration, fps: l.kind.source.fps } : { duration: 0, fps: 0 }),
  (props.data.properties as any)?.sailor_frame?.clock ?? null))
const hasLiveSlot = computed(() => wiredLayers.value.some(l => l.kind?.kind === 'live'))
```

- [ ] **Step 2:** In the composite paint, for a live slot at master time `t`, draw `l.kind.source.getFrame(slotPhase01(t, l.kind.source.duration), w, h)` instead of a pre-decoded image. Apply the same transform/opacity/blend. Await all live `getFrame`s for the frame before compositing (they return promises).

- [ ] **Step 3:** Add a rAF loop that runs only when `hasLiveSlot`: each tick compute `t` from elapsed vs `masterClock.duration`, repaint. Guard with an `inFlight` flag (skip a tick rather than queue). Apply a soft cap (const `MAX_LIVE_SLOTS = 8`): live slots beyond the cap fall back to their still frame (`getFrame(0,…)` cached once) with a one-time `console.warn`. Stop the loop on unmount and when `hasLiveSlot` goes false.

- [ ] **Step 4:** Browser verify: Gradient (flow speed > 0) → Frame slot animates live; two animated studios composite each at native speed; a still slot beside a live one stays constant; the card stays smooth (no overlap corruption). Commit line-precisely — `feat(compositor): live per-slot frame pull + master-clock preview loop`.

### Task 7: Export over the master clock

**Files:** Modify `ArtifactFrameNode.vue` (`exportCompositeCanvas`/`bakeOutput` ~`:514-549`).

- [ ] **Step 1:** Give `exportCompositeCanvas` a per-frame form: when `masterClock` is non-null, render `N = round(fps*duration)` frames, compositing all slots at each master time (live slots via `getFrame`, stills constant), and feed the existing video encode path the studios use (`/sailor/spacetype_encode`) or the Compositor `video` output. When `masterClock` is null, render one frame — today's behaviour, unchanged.

- [ ] **Step 2:** Browser verify: a Frame with an animated slot exports a video of the master length; still slots stay constant across it; a still-only Frame still exports a single image. Commit line-precisely — `feat(compositor): export the Frame over its master clock`.

### Task 8: Unify the remaining Frame resolver copies (preview, submit, modal)

**Files:** Modify `VueNodeCanvas.vue` (`getUpstreamImageUrl` ~`:4594`, `collectCompositorLayers` ~`:4606`, the submit-path walk ~`:4934-4946`) and `CompositorModal.vue` (`getNodeImageUrl` ~`:104`).

**Why:** These are the other three drifted copies of the Frame's input resolver. Left unchanged, a studio→Frame slot renders in the node card (Task 5) but not in the canvas-level preview, the modal, or a submitted graph. `collectCompositorLayers` also only loops slots 1–4 — a latent bug the unification fixes.

**Interfaces:** Consumes `resolveWiredSourceKind` (Task 1).

- [ ] **Step 1:** Re-read each site. Replace each resolver's per-source URL derivation with `resolveWiredSourceKind(String(frameId), 'input-' + slotIndex, nodes, edges)`, taking the `kind:'url'` URL for the still/preview/submit paths (these are baked-image consumers — a live slot resolves to its still `getFrame(0)` only inside the node/export paints, so for preview/submit a live studio still needs its baked URL; if `kind:'live'` and no URL, fall back to the upstream studio's baked `data.images` if present, else skip). Fix `collectCompositorLayers` to loop `for (let s = 0; s < 16; s++)` (was 1–4).

- [ ] **Step 2:** Browser verify all four surfaces agree: an Image-fed Frame renders identically in the node, the canvas preview, and the modal; a submitted graph composites the same slots. Regression is the whole point here — check the still path first.

- [ ] **Step 3:** Commit `VueNodeCanvas.vue` and `CompositorModal.vue` line-precisely — `refactor(compositor): route all Frame input resolvers through the shared one`.

---

## Verification (whole feature)

- [ ] Image artifact → Frame slot renders byte-identically (all resolver paths: node, preview, modal, submit).
- [ ] Still-only Frame previews + exports unchanged; local layers unaffected.
- [ ] Gradient/Shader/Space Type → Frame slot animates live in the preview.
- [ ] Two animated slots composite, each at native speed.
- [ ] Master clock = longest animated slot; override changes export length.
- [ ] Export length matches the master clock; stills constant, animated slots loop.
- [ ] Clobber bug gone — studio→Frame feeds a slot, composite intact.
- [ ] Soft cap: >8 animated slots fall back to stills with a console note, no crash.
- [ ] `cd frontend && npm run test:unit` — no new failures.

## Out of scope

- Per-slot independent clocks in the UI; Compositor local-layer editor changes; new blend/transform features; backend Compositor changes beyond existing video export.
