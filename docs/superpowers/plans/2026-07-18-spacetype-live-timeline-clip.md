# Space Type Live Timeline Clip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a Space Type effect directly on the timeline as a live procedural clip — scrubbable and editable without a render round trip — baking to PNG frames only at export.

**Architecture:** A new `spacetype` clip kind carries a full `SpaceTypeState` snapshot. One pooled `SpaceTypeEngine` serves the whole timeline (WebGL contexts are capped at ~8–16), with an LRU cache of built scene roots so switching between clips costs an `update()` + render rather than a `buildScene()`. A single shared `renderSpaceTypeClip()` is called by both the WebGL source and the Canvas2D fallback — following the `renderMotionClip` precedent, the one piece of render logic in this codebase that has not drifted. Export reuses `ensureSpaceTypeBake` and the already-reserved `MotionBake.external` flag, baking `k` seamless loops and tiling them in Python.

**Tech Stack:** Vue 3 / Nuxt 4, TypeScript, three.js, vitest (unit), Playwright (integration), Python + PyAV (export).

**Spec:** `docs/superpowers/specs/2026-07-18-spacetype-live-timeline-clip-design.md`

## Global Constraints

- Zero new npm dependencies.
- **Exactly one `SpaceTypeEngine` (one WebGL context) for the entire timeline, regardless of clip count.** Browsers cap contexts at ~8–16 and Space Type node cards already compete for them. This is a hard invariant with a test.
- `EditState` stays fully self-contained and JSON-serializable. Nothing in the render or export path may read outside it — the Python renderer receives JSON with no access to the node canvas.
- `clip.origin` is advisory only. No rendering or export code may read it. A missing node or stale key degrades silently to a plain snapshot.
- Effects must stay pure in `t01`. Never introduce frame-to-frame accumulated state — random access scrubbing depends on it.
- Back-compat is hard: an `EditState` with no `spacetype` clips must render byte-identically to today.
- Unit specs live in `frontend/tests/unit/*.unit.spec.ts` and import with **relative paths** (`'../../app/lib/...'`), not `~` aliases. vitest imports are explicit; no globals.
- Commit hygiene (parallel sessions share this tree): stage only your own files and hunks, never `git add -A`, never `git stash`. Commit to `main`.
- Gate for every task: `cd frontend && npx vitest run tests/unit/spacetype-*.unit.spec.ts tests/unit/motion-clip-*.unit.spec.ts tests/unit/timeline-types.unit.spec.ts tests/unit/renderer-resolve.unit.spec.ts` green, and `npx vue-tsc --noEmit | grep -iE 'spacetype|timeline'` empty. vitest must run from the `frontend/` cwd.

---

### Task 1: The `spacetype` clip kind

**Files:**
- Create: `frontend/shared/spacetype/state.ts` (the serialization-boundary types, moved out of app)
- Modify: `frontend/app/lib/spacetype/state.ts` (re-export `SpaceTypeState` from shared)
- Modify: `frontend/app/lib/spacetype/effect.ts` (re-export `Params` from shared)
- Modify: `frontend/app/lib/spacetype/post.ts` (re-export `PostSettings` from shared)
- Modify: `frontend/shared/timeline/types.ts` (add `SpaceTypeClip`, extend the `Clip` union)
- Create: `frontend/app/composables/timelineSpaceTypeClip.ts`
- Create: `frontend/tests/unit/spacetype-clip-types.unit.spec.ts`

**Interfaces:**
- Consumes: `BaseClip`, `MotionBake` from `shared/timeline/types.ts`; `defaultSpaceTypeState()` from `app/lib/spacetype/state.ts`; `spaceTypeSourceKey` from `app/lib/spacetype/sourceKey.ts`.

> **Why the type moves to `shared/` first.** `frontend/shared/` currently has **zero** imports from `app/` — verified by grep, the invariant holds across the whole directory. `SpaceTypeClip.state` crosses the serialization boundary (it is sent to the Python renderer as JSON), so its type belongs in `shared/`, not behind an `app → shared` back-edge. This matters concretely: the ledger records a pre-existing Nitro resolve failure in `shared/timeline/interpolate.ts`, and adding the first `shared → app` dependency edge into that file family is not a risk worth taking for a type alias.
>
> The move is clean because `SpaceTypeState`, `Params`, and `PostSettings` are all plain structural types — booleans, numbers, strings, and a small object array. **No three.js type crosses into `shared/`.** Verify this before and after: `grep -rn "three" frontend/shared/` must stay empty.
- Produces, relied on by every later task:
  - `interface SpaceTypeClip extends BaseClip` with `kind: 'spacetype'`, `state: SpaceTypeState`, `loop?: boolean`, `origin?: { node_id: string; state_key: string }`, `spacetype_bake?: MotionBake`
  - `Clip` union gains `| SpaceTypeClip`
  - `function createSpaceTypeClip(opts: { startFrame: number; state: SpaceTypeState; originNodeId?: string; length?: number }): SpaceTypeClip`
  - `function spaceTypeSourceFrameCount(clip: SpaceTypeClip): number`
  - `function spaceTypeClipIsStale(clip: SpaceTypeClip, nodeState: SpaceTypeState | null): boolean`

> **Note on why this is a new clip kind rather than a reuse of `MotionClip`.** `MotionBake.external` names Space Type in its doc comment, which suggests reusing `MotionClip` with a placeholder `layer`. The spec rejects that: a `MotionClip` whose `layer` is a lie would break `motionClipSourceKey`, the motion inspector, and `renderMotionClip`'s contract. We reuse the `MotionBake` *type* and the `external` flag; we do not reuse the clip kind.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-clip-types.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createSpaceTypeClip, spaceTypeSourceFrameCount, spaceTypeClipIsStale } from '../../app/composables/timelineSpaceTypeClip'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'
import { spaceTypeSourceKey } from '../../app/lib/spacetype/sourceKey'

describe('createSpaceTypeClip', () => {
  it('defaults clip length to exactly one loop of the source', () => {
    const state = defaultSpaceTypeState() // 30fps, 6s loop
    const clip = createSpaceTypeClip({ startFrame: 0, state })
    expect(clip.kind).toBe('spacetype')
    expect(clip.length).toBe(180)
    expect(clip.in_frame).toBe(0)
    expect(clip.loop).toBe(true)
  })

  it('honours an explicit length without changing source duration', () => {
    const state = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 12, state, length: 600 })
    expect(clip.length).toBe(600)
    expect(clip.start_frame).toBe(12)
    expect(spaceTypeSourceFrameCount(clip)).toBe(180) // source is still one 6s loop
  })

  it('snapshots the state by value, not by reference', () => {
    const state = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state })
    state.params.rows = 999
    expect(clip.state.params.rows).not.toBe(999)
  })

  it('records origin with the content hash when a node id is given', () => {
    const state = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state, originNodeId: 'node-7' })
    expect(clip.origin?.node_id).toBe('node-7')
    expect(clip.origin?.state_key).toBeTruthy()
  })

  it('omits origin entirely when no node id is given', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: defaultSpaceTypeState() })
    expect(clip.origin).toBeUndefined()
  })
})

describe('spaceTypeClipIsStale', () => {
  it('is false when the node state still hashes to the recorded key', () => {
    const state = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state, originNodeId: 'n1' })
    expect(spaceTypeClipIsStale(clip, state)).toBe(false)
  })

  it('is true when the node state has changed', () => {
    const state = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state, originNodeId: 'n1' })
    expect(spaceTypeClipIsStale(clip, { ...state, params: { ...state.params, rows: 3 } })).toBe(true)
  })

  it('is false with no origin and false with no node — never an error', () => {
    const state = defaultSpaceTypeState()
    const orphan = createSpaceTypeClip({ startFrame: 0, state })
    expect(spaceTypeClipIsStale(orphan, state)).toBe(false)
    const linked = createSpaceTypeClip({ startFrame: 0, state, originNodeId: 'n1' })
    expect(spaceTypeClipIsStale(linked, null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-clip-types.unit.spec.ts`
Expected: FAIL — `Failed to resolve import "../../app/composables/timelineSpaceTypeClip"`

- [ ] **Step 3: Move the boundary types into `shared/`**

Create `frontend/shared/spacetype/state.ts`:

```ts
// frontend/shared/spacetype/state.ts
/** Space Type types that cross the serialization boundary.
 *
 *  These live in shared/ (not app/) because SpaceTypeClip.state is part of
 *  EditState, which is sent to the Python renderer as JSON. shared/ must never
 *  import from app/ — that invariant holds across this whole directory and the
 *  Nitro build is already fragile here.
 *
 *  All three types are plain structural data. Nothing from three.js belongs in
 *  this file, ever. */

export type ParamValue = number | string | boolean
export type Params = Record<string, ParamValue>

export interface PostSettings {
  bloom: boolean; bloomStrength: number; bloomRadius: number; bloomThreshold: number
  color: boolean; exposure: number; contrast: number; saturation: number; hue: number
  chroma: boolean; chromaAmount: number
  blur: boolean; blurAmount: number
}

export interface SpaceTypeState {
  effectId: string
  params: Params
  gradientStops: { color: string; on: boolean }[]
  fps: number
  loopDuration: number
  dimsKey: string
  transparent: boolean
  bgColor: string
  post?: PostSettings
  projection?: 'perspective' | 'isometric'
  panX?: number
  panY?: number
}
```

Now delete the three declarations from their current homes and re-export instead, so every existing importer keeps working unchanged:

- `frontend/app/lib/spacetype/effect.ts` — delete the `ParamValue` and `Params` declarations (currently lines 3-4), add at the top:
  ```ts
  export type { ParamValue, Params } from '~~/shared/spacetype/state'
  ```
- `frontend/app/lib/spacetype/post.ts` — delete the `PostSettings` interface (currently lines 14-19), add at the top:
  ```ts
  export type { PostSettings } from '~~/shared/spacetype/state'
  ```
  `DEFAULT_POST` and `postEnabled` stay in `post.ts` — only the type moves.
- `frontend/app/lib/spacetype/state.ts` — delete the `SpaceTypeState` interface (currently lines 9-22), add beside the existing imports:
  ```ts
  export type { SpaceTypeState } from '~~/shared/spacetype/state'
  ```
  Everything else in `state.ts` (`DIMS`, `defaultSpaceTypeState`, `dimsFromKey`, `ensureSpaceTypeFont`, `texOptsFromState`) stays put — those are app-side and pull in `~/data/variable-fonts` and the ribbon effect.

Verify the boundary held:

```bash
cd frontend && grep -rn "three" shared/ ; grep -rn "\.\./\.\./app\|from '~/" shared/
```
Both must print nothing.

- [ ] **Step 4: Add the clip type**

In `frontend/shared/timeline/types.ts`, immediately after the `MotionClip` interface (currently ends at line 288):

```ts
/** A Space Type effect rendered live by the three.js engine. Carries a full
 *  snapshot of the studio state so EditState stays self-contained — the Python
 *  renderer sees this JSON with no access to the node canvas.
 *
 *  Time is scene-owned: the source is `state.loopDuration * state.fps` frames,
 *  and `in_frame`/`length`/`speed`/`reverse` window into it exactly as for video.
 *  With `loop` (default true) the source tiles past its end, since every effect
 *  is pure in normalized time. */
export interface SpaceTypeClip extends BaseClip {
  kind: 'spacetype'
  state: SpaceTypeState
  /** Tile the source past its end instead of holding the last frame. Default true. */
  loop?: boolean
  /** Advisory provenance for the "sync from node" affordance. NEVER read by
   *  rendering or export — a missing node or stale key degrades to a plain
   *  snapshot with no error. */
  origin?: {
    node_id: string
    state_key: string
  }
  /** Cached export bake (populated at render). Always `external: true`. */
  spacetype_bake?: MotionBake
}
```

Add the import at the top of `types.ts` — a `shared → shared` import, which is why Step 3 came first:

```ts
import type { SpaceTypeState } from '../spacetype/state'
```

Extend the union at `types.ts:290`:

```ts
export type Clip = VideoClip | ImageClip | AudioClip | TextClip | WorkflowClip | TitleClip | LowerThirdClip | CaptionClip | MotionClip | SpaceTypeClip
```

- [ ] **Step 5: Write the factory**

Create `frontend/app/composables/timelineSpaceTypeClip.ts`:

```ts
// frontend/app/composables/timelineSpaceTypeClip.ts
/** Factory and provenance helpers for Space Type timeline clips. The clip owns
 *  a deep copy of the studio state — see the "snapshot with explicit sync"
 *  decision in the design doc. */
import type { SpaceTypeClip } from '~~/shared/timeline/types'
import type { SpaceTypeState } from '~~/shared/spacetype/state'
import { spaceTypeSourceKey } from '~/lib/spacetype/sourceKey'
import { dimsFromKey } from '~/lib/spacetype/state'

let seq = 0
function id(prefix: string): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}`
}

/** The content hash for a state, used for both bake caching and staleness. */
export function spaceTypeStateKey(state: SpaceTypeState): string {
  const [W, H] = dimsFromKey(state.dimsKey)
  return spaceTypeSourceKey({
    effectId: state.effectId,
    params: state.params,
    fps: state.fps,
    loopDuration: state.loopDuration,
    W,
    H,
    alpha: state.transparent,
    bgColor: state.bgColor,
  })
}

/** Frames in one full loop of the clip's source. */
export function spaceTypeSourceFrameCount(clip: SpaceTypeClip): number {
  return Math.max(1, Math.round(clip.state.fps * clip.state.loopDuration))
}

export function createSpaceTypeClip(opts: {
  startFrame: number
  state: SpaceTypeState
  originNodeId?: string
  length?: number
}): SpaceTypeClip {
  const state: SpaceTypeState = JSON.parse(JSON.stringify(opts.state))
  const oneLoop = Math.max(1, Math.round(state.fps * state.loopDuration))
  const clip: SpaceTypeClip = {
    id: id('spacetype'),
    kind: 'spacetype',
    start_frame: opts.startFrame,
    in_frame: 0,
    length: opts.length ?? oneLoop,
    state,
    loop: true,
  }
  if (opts.originNodeId) {
    clip.origin = { node_id: opts.originNodeId, state_key: spaceTypeStateKey(state) }
  }
  return clip
}

/** True when the originating node's state has drifted from the clip's snapshot.
 *  Never throws: no origin, or no node, means "not stale" — the sync affordance
 *  simply does not appear. */
export function spaceTypeClipIsStale(clip: SpaceTypeClip, nodeState: SpaceTypeState | null): boolean {
  if (!clip.origin || !nodeState) return false
  return spaceTypeStateKey(nodeState) !== clip.origin.state_key
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-clip-types.unit.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 7: Verify no existing test regressed**

The type move in Step 3 touches every Space Type importer, so run the whole Space Type suite, not just the timeline specs:

Run: `cd frontend && npx vitest run tests/unit/spacetype-*.unit.spec.ts tests/unit/timeline-types.unit.spec.ts tests/unit/motion-clip-types.unit.spec.ts && npx vue-tsc --noEmit | grep -iE 'spacetype|timeline'`
Expected: all PASS; the grep prints nothing.

- [ ] **Step 8: Commit**

```bash
git add frontend/shared/spacetype/state.ts frontend/shared/timeline/types.ts frontend/app/lib/spacetype/state.ts frontend/app/lib/spacetype/effect.ts frontend/app/lib/spacetype/post.ts frontend/app/composables/timelineSpaceTypeClip.ts frontend/tests/unit/spacetype-clip-types.unit.spec.ts
git commit -m "feat(timeline): SpaceTypeClip kind + factory

Moves SpaceTypeState/Params/PostSettings to shared/, where the
serialization boundary lives — shared/ must never import from app/.
Scene-owned time, state snapshotted by value, advisory origin for the
sync-from-node affordance."
```

---

### Task 2: Keyed root cache in `SpaceTypeEngine`

**Files:**
- Modify: `frontend/app/lib/spacetype/engine.ts` (add `buildKeyed`, root cache, `clearRootCache`)
- Create: `frontend/tests/unit/spacetype-root-cache.unit.spec.ts`

**Interfaces:**
- Consumes: the existing `build(params, texOpts)`, `setEffect(effect)`, `disposeRoot()` internals of `SpaceTypeEngine`.
- Produces, relied on by Task 3:
  - `buildKeyed(key: string, effect: SpaceTypeEffect, params: Params, texOpts: TextTextureOptions): void` — makes the root for `key` current, building it only on a cache miss
  - `clearRootCache(): void`
  - `readonly cachedRootCount: number` (test-only observability)
  - `ROOT_CACHE_LIMIT = 8` exported

**Why this task exists:** `build()` disposes the previous root and installs a new one. With one pooled engine serving many clips, switching clips per frame would call `buildScene()` per frame and stall playback. The engine needs to hold several roots and swap which is active.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-root-cache.unit.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as THREE from 'three'

// The engine constructs a real WebGLRenderer; stub it so this runs headless.
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof THREE>('three')
  class FakeRenderer {
    domElement = { width: 0, height: 0 } as unknown as HTMLCanvasElement
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
    forceContextLoss() {}
    getContext() { return {} }
  }
  return { ...actual, WebGLRenderer: FakeRenderer }
})

import { SpaceTypeEngine, ROOT_CACHE_LIMIT } from '../../app/lib/spacetype/engine'
import type { SpaceTypeEffect } from '../../app/lib/spacetype/effect'

function fakeEffect(id: string, onBuild: () => void): SpaceTypeEffect {
  return {
    id,
    label: id,
    controls: [],
    buildScene: (three) => { onBuild(); return new three.Object3D() },
    update: () => {},
  }
}

function engine() {
  const canvas = { width: 64, height: 64, getContext: () => ({}) } as unknown as HTMLCanvasElement
  return new SpaceTypeEngine(canvas, {
    effect: fakeEffect('a', () => {}),
    width: 64, height: 64, fps: 30, loopDuration: 2,
    alpha: true, bgColor: '#000000',
  })
}

const TEX = {} as any

describe('SpaceTypeEngine root cache', () => {
  let builds: Record<string, number>
  beforeEach(() => { builds = {} })

  function eff(id: string) {
    return fakeEffect(id, () => { builds[id] = (builds[id] ?? 0) + 1 })
  }

  it('builds once per key and reuses on repeat', () => {
    const e = engine()
    e.buildKeyed('k1', eff('a'), {}, TEX)
    e.buildKeyed('k1', eff('a'), {}, TEX)
    e.buildKeyed('k1', eff('a'), {}, TEX)
    expect(builds.a).toBe(1)
  })

  it('does not rebuild when alternating between two cached keys', () => {
    const e = engine()
    e.buildKeyed('k1', eff('a'), {}, TEX)
    e.buildKeyed('k2', eff('b'), {}, TEX)
    e.buildKeyed('k1', eff('a'), {}, TEX)
    e.buildKeyed('k2', eff('b'), {}, TEX)
    expect(builds.a).toBe(1)
    expect(builds.b).toBe(1)
    expect(e.cachedRootCount).toBe(2)
  })

  it('evicts least-recently-used past the limit', () => {
    const e = engine()
    for (let i = 0; i < ROOT_CACHE_LIMIT + 1; i++) e.buildKeyed(`k${i}`, eff(`e${i}`), {}, TEX)
    expect(e.cachedRootCount).toBe(ROOT_CACHE_LIMIT)
    // k0 was evicted, so touching it rebuilds
    e.buildKeyed('k0', eff('e0'), {}, TEX)
    expect(builds.e0).toBe(2)
  })

  it('keeps the most recently used key resident under eviction pressure', () => {
    const e = engine()
    e.buildKeyed('hot', eff('hot'), {}, TEX)
    for (let i = 0; i < ROOT_CACHE_LIMIT - 1; i++) {
      e.buildKeyed(`k${i}`, eff(`e${i}`), {}, TEX)
      e.buildKeyed('hot', eff('hot'), {}, TEX) // keep touching it
    }
    e.buildKeyed('overflow', eff('of'), {}, TEX)
    e.buildKeyed('hot', eff('hot'), {}, TEX)
    expect(builds.hot).toBe(1)
  })

  it('clearRootCache drops everything', () => {
    const e = engine()
    e.buildKeyed('k1', eff('a'), {}, TEX)
    e.clearRootCache()
    expect(e.cachedRootCount).toBe(0)
    e.buildKeyed('k1', eff('a'), {}, TEX)
    expect(builds.a).toBe(2)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-root-cache.unit.spec.ts`
Expected: FAIL — `ROOT_CACHE_LIMIT` is not exported / `buildKeyed is not a function`.

- [ ] **Step 3: Implement the cache**

In `frontend/app/lib/spacetype/engine.ts`, add near the top-level constants (beside `ORTHO_HALF_H`):

```ts
/** Resident built scene roots. Bounds GPU memory when a timeline holds many
 *  distinct Space Type clips; a miss costs one buildScene(), not correctness. */
export const ROOT_CACHE_LIMIT = 8
```

Add these fields to the class, beside the existing `private root: THREE.Object3D | null = null`:

```ts
  /** key → built root. Insertion order is LRU order (re-inserted on hit). */
  private rootCache = new Map<string, THREE.Object3D>()
  private activeKey: string | null = null
```

Add these methods to the class, immediately after `build()` (which currently ends at the line before `get frameCount()`):

```ts
  /** Test/debug observability for the pooling invariant. */
  get cachedRootCount(): number { return this.rootCache.size }

  /** Make the root for `key` the active one, building it only on a miss.
   *  Unlike build(), previously built roots are retained and swapped in, so
   *  alternating between clips costs a scene-graph swap rather than a rebuild. */
  buildKeyed(key: string, effect: SpaceTypeEffect, params: Params, texOpts: TextTextureOptions): void {
    if (this.activeKey === key && this.rootCache.has(key)) {
      this.effect = effect
      return
    }

    // Detach whatever is currently mounted; it stays alive in the cache.
    if (this.root) this.scene.remove(this.root)

    const hit = this.rootCache.get(key)
    if (hit) {
      this.rootCache.delete(key)   // re-insert to move to MRU position
      this.rootCache.set(key, hit)
      this.effect = effect
      this.root = hit
      this.scene.add(hit)
      this.activeKey = key
      return
    }

    this.effect = effect
    this.root = null              // build() must not dispose a cached root
    this.build(params, texOpts)
    if (this.root) {
      this.rootCache.set(key, this.root)
      this.activeKey = key
      this.evictRoots()
    }
  }

  private evictRoots(): void {
    while (this.rootCache.size > ROOT_CACHE_LIMIT) {
      const oldest = this.rootCache.keys().next().value as string | undefined
      if (oldest === undefined) break
      const obj = this.rootCache.get(oldest)!
      this.rootCache.delete(oldest)
      if (obj === this.root) continue          // never evict the mounted root
      this.scene.remove(obj)
      disposeObject3D(obj)
    }
  }

  clearRootCache(): void {
    for (const [, obj] of this.rootCache) {
      if (obj === this.root) continue
      this.scene.remove(obj)
      disposeObject3D(obj)
    }
    this.rootCache.clear()
    this.activeKey = null
  }
```

Add this module-level helper at the bottom of `engine.ts` (the existing `disposeRoot()` disposes `this.root`; this generalizes the same traversal to any object — if `disposeRoot` already contains this logic, refactor it to call this helper rather than duplicating):

```ts
/** Release GPU resources for an object graph that is no longer cached. */
function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(mat)) mat.forEach(m => m.dispose())
    else if (mat) mat.dispose()
  })
}
```

Extend the existing `dispose()` to drop the cache first:

```ts
  dispose(): void {
    this.clearRootCache()
    this.disposeRoot()
    this.postChain?.dispose()
    this.renderer.forceContextLoss()
    this.renderer.dispose()
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-root-cache.unit.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Verify the studio still works**

Run: `cd frontend && npx vitest run tests/unit/spacetype-*.unit.spec.ts`
Expected: all PASS. `buildKeyed` is additive; `build()` is unchanged, so `SpaceTypeNode` and `SpaceTypeSurface` are unaffected.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/engine.ts frontend/tests/unit/spacetype-root-cache.unit.spec.ts
git commit -m "feat(spacetype): LRU root cache so one engine can serve many clips

buildKeyed() swaps between pre-built scene roots instead of rebuilding,
which is what makes a single pooled WebGL context viable for the timeline."
```

---

### Task 3: Pooled engine and the shared render function

**Files:**
- Create: `frontend/app/lib/engine/spaceTypeEnginePool.ts`
- Create: `frontend/app/lib/engine/spaceTypeClipRenderer.ts`
- Create: `frontend/tests/unit/spacetype-clip-render.unit.spec.ts`

**Interfaces:**
- Consumes: `SpaceTypeEngine`, `ROOT_CACHE_LIMIT`, `buildKeyed` (Task 2); `getEffect` from `app/lib/spacetype/effects/index.ts`; `texOptsFromState`, `dimsFromKey` from `app/lib/spacetype/state.ts`; `SpaceTypeClip`, `spaceTypeSourceFrameCount` (Task 1).
- Produces, relied on by Tasks 4, 5, 7:
  - `function acquireSpaceTypeEngine(W: number, H: number): SpaceTypeEngine | null` — null when WebGL2 is unavailable
  - `function releaseSpaceTypeEngine(): void`
  - `function spaceTypeEngineAvailable(): boolean`
  - `function structuralKey(state: SpaceTypeState): string`
  - `function renderSpaceTypeClipToCanvas(clip: SpaceTypeClip, localFrame: number, fps: number): HTMLCanvasElement | null`
  - `function drawSpaceTypeClip(ctx: CanvasRenderingContext2D, clip: SpaceTypeClip, localFrame: number, canvasW: number, canvasH: number, fps: number): void`

**Design note on `structuralKey`.** `SpaceTypeEffect.liveKeys` declares params that change without a rebuild. The cache key is the effect id plus every param *not* in `liveKeys`, plus the text-texture inputs. Params in `liveKeys` are excluded so that tweaking them reuses the built root.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-clip-render.unit.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { structuralKey } from '../../app/lib/engine/spaceTypeEnginePool'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'
import { createSpaceTypeClip } from '../../app/composables/timelineSpaceTypeClip'
import { sourceT01 } from '../../app/lib/engine/spaceTypeClipRenderer'

describe('structuralKey', () => {
  it('changes when the effect changes', () => {
    const a = defaultSpaceTypeState()
    const b = { ...a, effectId: 'tunnel' }
    expect(structuralKey(a)).not.toBe(structuralKey(b))
  })

  it('is stable for the same state', () => {
    const a = defaultSpaceTypeState()
    expect(structuralKey(a)).toBe(structuralKey(JSON.parse(JSON.stringify(a))))
  })

  it('ignores params the effect declares as live', () => {
    // ribbon declares at least one liveKey; changing it must not force a rebuild
    const a = defaultSpaceTypeState()
    const { getEffect } = require('../../app/lib/spacetype/effects/index')
    const live = getEffect(a.effectId).liveKeys?.[0]
    if (!live) return // effect has no live keys; nothing to assert
    const b = { ...a, params: { ...a.params, [live]: (a.params[live] as number) + 1 } }
    expect(structuralKey(a)).toBe(structuralKey(b))
  })
})

describe('sourceT01', () => {
  const state = defaultSpaceTypeState() // 30fps, 6s => 180 source frames

  it('maps clip-local frames onto normalized loop time', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state })
    expect(sourceT01(clip, 0)).toBeCloseTo(0)
    expect(sourceT01(clip, 90)).toBeCloseTo(0.5)
  })

  it('tiles past the source end when loop is true', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state, length: 600 })
    expect(sourceT01(clip, 180)).toBeCloseTo(sourceT01(clip, 0))
    expect(sourceT01(clip, 270)).toBeCloseTo(sourceT01(clip, 90))
  })

  it('holds the last frame when loop is false', () => {
    const clip = { ...createSpaceTypeClip({ startFrame: 0, state, length: 600 }), loop: false }
    const last = sourceT01(clip, 179)
    expect(sourceT01(clip, 400)).toBeCloseTo(last)
  })

  it('respects in_frame as an offset into the source', () => {
    const clip = { ...createSpaceTypeClip({ startFrame: 0, state }), in_frame: 90 }
    expect(sourceT01(clip, 0)).toBeCloseTo(0.5)
  })

  it('is pure — the same frame yields the same t01 regardless of call order', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state, length: 600 })
    const forward = [0, 50, 100, 200, 300].map(f => sourceT01(clip, f))
    const backward = [300, 200, 100, 50, 0].map(f => sourceT01(clip, f)).reverse()
    expect(forward).toEqual(backward)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-clip-render.unit.spec.ts`
Expected: FAIL — cannot resolve `spaceTypeEnginePool`.

- [ ] **Step 3: Write the pool**

Create `frontend/app/lib/engine/spaceTypeEnginePool.ts`:

```ts
// frontend/app/lib/engine/spaceTypeEnginePool.ts
/** ONE SpaceTypeEngine — one WebGL context — for the entire timeline.
 *
 *  Browsers cap live WebGL contexts at roughly 8–16, and Space Type node cards
 *  already compete for them. An engine per clip would exhaust the budget on a
 *  modest edit, so every Space Type clip renders through this singleton,
 *  sequentially. That is safe because FrameSource.getFrame's contract says the
 *  returned image is valid only until the next getFrame call, and the compositor
 *  uploads to a texture before advancing. */
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { getEffect } from '~/lib/spacetype/effects/index'
import type { SpaceTypeState } from '~/lib/spacetype/state'

let engine: SpaceTypeEngine | null = null
let canvas: HTMLCanvasElement | null = null
let refs = 0
let webglFailed = false

export function spaceTypeEngineAvailable(): boolean {
  if (webglFailed) return false
  if (typeof document === 'undefined') return false
  try {
    const probe = document.createElement('canvas')
    return !!probe.getContext('webgl2')
  } catch {
    return false
  }
}

/** Get the shared engine, sized to the timeline canvas. Returns null when WebGL2
 *  is unavailable — callers must degrade, never throw. */
export function acquireSpaceTypeEngine(W: number, H: number): SpaceTypeEngine | null {
  if (webglFailed) return null
  if (!engine) {
    if (!spaceTypeEngineAvailable()) { webglFailed = true; return null }
    try {
      canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      engine = new SpaceTypeEngine(canvas, {
        effect: getEffect('ribbon'),
        width: W, height: H, fps: 30, loopDuration: 6,
        alpha: true, bgColor: '#000000',
      })
    } catch (e) {
      console.warn('spaceTypeEnginePool: engine init failed — Space Type clips will not render', e)
      webglFailed = true
      engine = null
      return null
    }
  }
  refs += 1
  if (canvas && (canvas.width !== W || canvas.height !== H)) engine.setSize(W, H)
  return engine
}

export function releaseSpaceTypeEngine(): void {
  refs = Math.max(0, refs - 1)
  if (refs === 0 && engine) {
    engine.dispose()
    engine = null
    canvas = null
  }
}

/** Reset after a context loss so the next acquire re-initializes. */
export function resetSpaceTypeEnginePool(): void {
  if (engine) { try { engine.dispose() } catch { /* already lost */ } }
  engine = null
  canvas = null
  refs = 0
  webglFailed = false
}

/** Cache key for a built scene root: effect id plus every param the effect does
 *  NOT declare live, plus the text-texture inputs. Params in liveKeys are
 *  excluded so tweaking them reuses the root instead of rebuilding. */
export function structuralKey(state: SpaceTypeState): string {
  const effect = getEffect(state.effectId)
  const live = new Set(effect.liveKeys ?? [])
  const structural: Record<string, unknown> = {}
  for (const k of Object.keys(state.params).sort()) {
    if (!live.has(k)) structural[k] = state.params[k]
  }
  return JSON.stringify({
    e: effect.id,
    p: structural,
    g: state.gradientStops,
    d: state.dimsKey,
  })
}
```

- [ ] **Step 4: Write the shared renderer**

Create `frontend/app/lib/engine/spaceTypeClipRenderer.ts`:

```ts
// frontend/app/lib/engine/spaceTypeClipRenderer.ts
/** The single Space Type draw used by BOTH compositors — the WebGL source and
 *  the Canvas2D fallback — mirroring motionClipRenderer.ts. One implementation,
 *  two consumers: the reason renderMotionClip is the one render path in this
 *  codebase that has not drifted across surfaces. */
import type { SpaceTypeClip } from '~~/shared/timeline/types'
import { getEffect } from '~/lib/spacetype/effects/index'
import { texOptsFromState, dimsFromKey } from '~/lib/spacetype/state'
import { spaceTypeSourceFrameCount } from '~/composables/timelineSpaceTypeClip'
import { acquireSpaceTypeEngine, structuralKey } from './spaceTypeEnginePool'

/** Clip-local frame → normalized loop time, honouring in_frame and looping.
 *  Pure: the same frame always yields the same t01, which is what makes random
 *  access scrubbing correct. */
export function sourceT01(clip: SpaceTypeClip, localFrame: number): number {
  const total = spaceTypeSourceFrameCount(clip)
  const raw = (clip.in_frame ?? 0) + localFrame
  const loop = clip.loop !== false
  const f = loop
    ? ((raw % total) + total) % total
    : Math.min(Math.max(0, raw), total - 1)
  return f / total
}

/** Render the clip at a clip-local frame into the shared engine's canvas.
 *  Returns null when the engine is unavailable (no WebGL2) — callers draw
 *  nothing rather than failing. */
export function renderSpaceTypeClipToCanvas(
  clip: SpaceTypeClip,
  localFrame: number,
  _fps: number,
): HTMLCanvasElement | null {
  const [W, H] = dimsFromKey(clip.state.dimsKey)
  const engine = acquireSpaceTypeEngine(W, H)
  if (!engine) return null

  const effect = getEffect(clip.state.effectId)
  try {
    engine.setBackground(clip.state.transparent, clip.state.bgColor)
    engine.setLoopDuration(clip.state.loopDuration)
    engine.setFps(clip.state.fps)
    if (clip.state.projection) engine.setProjection(clip.state.projection)
    engine.setPan(clip.state.panX ?? 0, clip.state.panY ?? 0)
    engine.buildKeyed(structuralKey(clip.state), effect, clip.state.params, texOptsFromState(clip.state))
    engine.renderFrameAt(sourceT01(clip, localFrame), clip.state.params)
  } catch (e) {
    console.warn(`spaceTypeClipRenderer: render failed for clip ${clip.id}`, e)
    return null
  }
  return engine.renderer.domElement
}

/** Canvas2D-path draw: render, then blit the engine canvas aspect-fit into ctx.
 *  A WebGL canvas is a valid drawImage source, which is why one engine serves
 *  both compositors. */
export function drawSpaceTypeClip(
  ctx: CanvasRenderingContext2D,
  clip: SpaceTypeClip,
  localFrame: number,
  canvasW: number,
  canvasH: number,
  fps: number,
): void {
  const src = renderSpaceTypeClipToCanvas(clip, localFrame, fps)
  if (!src) return
  ctx.drawImage(src, 0, 0, canvasW, canvasH)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-clip-render.unit.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/engine/spaceTypeEnginePool.ts frontend/app/lib/engine/spaceTypeClipRenderer.ts frontend/tests/unit/spacetype-clip-render.unit.spec.ts
git commit -m "feat(timeline): pooled Space Type engine + shared clip renderer

One WebGL context for the whole timeline; one draw shared by the GL and
Canvas2D compositors, per the renderMotionClip precedent."
```

---

### Task 4: `SpaceTypeSource` and WebGL compositor wiring

**Files:**
- Create: `frontend/app/lib/engine/sources/spaceTypeSource.ts`
- Modify: `frontend/app/lib/engine/webglPreviewRenderer.ts:17-33` (`resolutionPlanFor`), `:111-135` (`loadSource`)
- Modify: `frontend/app/lib/engine/compositor.ts` (`RENDERABLE_KINDS`)
- Modify: `frontend/tests/unit/renderer-resolve.unit.spec.ts`

**Interfaces:**
- Consumes: `FrameSource` from `./frameSource`; `renderSpaceTypeClipToCanvas` (Task 3); `SpaceTypeClip` (Task 1).
- Produces, relied on by Task 9:
  - `class SpaceTypeSource implements FrameSource` with `static supports(clip: Clip): clip is SpaceTypeClip`
  - `ResolutionPlan` union gains `| { kind: 'spacetype' }`

- [ ] **Step 1: Write the failing test**

Add to `frontend/tests/unit/renderer-resolve.unit.spec.ts` (extend the existing import of `resolutionPlanFor` if present; otherwise add `import { resolutionPlanFor } from '../../app/lib/engine/webglPreviewRenderer'`):

```ts
import { createSpaceTypeClip } from '../../app/composables/timelineSpaceTypeClip'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'

describe('resolutionPlanFor — spacetype', () => {
  it('short-circuits to the spacetype plan with no preview', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: defaultSpaceTypeState() })
    expect(resolutionPlanFor(clip, null)).toEqual({ kind: 'spacetype' })
  })

  it('ignores any resolved preview for a spacetype clip', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: defaultSpaceTypeState() })
    const preview = { kind: 'image' as const, url: 'stale.png' }
    expect(resolutionPlanFor(clip, preview)).toEqual({ kind: 'spacetype' })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/renderer-resolve.unit.spec.ts`
Expected: FAIL — receives `{ kind: 'image', url: 'stale.png' }` for the second case and `null` for the first.

- [ ] **Step 3: Write the source**

Create `frontend/app/lib/engine/sources/spaceTypeSource.ts`:

```ts
// frontend/app/lib/engine/sources/spaceTypeSource.ts
/** Renders a Space Type clip per frame through the shared pooled engine and
 *  hands the WebGL canvas straight to GlRenderer.setSource — no pixel readback,
 *  since a WebGL canvas is a valid TexImageSource.
 *
 *  Safe to share one engine across every instance: getFrame's contract is that
 *  the returned image is valid only until the next getFrame call, and
 *  WebGLPreviewRenderer.renderFrame uploads to a texture before advancing. */
import type { Clip, SpaceTypeClip } from '~~/shared/timeline/types'
import { dimsFromKey } from '~/lib/spacetype/state'
import { renderSpaceTypeClipToCanvas } from '~/lib/engine/spaceTypeClipRenderer'
import { acquireSpaceTypeEngine, releaseSpaceTypeEngine, type SpaceTypeEngineHandle } from '~/lib/engine/spaceTypeEnginePool'
import type { FrameSource } from './frameSource'

export class SpaceTypeSource implements FrameSource {
  private w: number
  private h: number
  private fallback: HTMLCanvasElement | null = null
  private released = false
  private handle: SpaceTypeEngineHandle | null

  constructor(private clip: SpaceTypeClip, private fps: number) {
    const [W, H] = dimsFromKey(clip.state.dimsKey)
    this.w = W
    this.h = H
    // Acquire ONCE per source, at construction — never per frame. See the
    // ownership contract at the top of spaceTypeEnginePool.ts. Null means
    // WebGL2 is permanently unavailable; getFrame then emits transparent.
    this.handle = acquireSpaceTypeEngine()
  }

  static supports(clip: Clip): clip is SpaceTypeClip {
    return clip.kind === 'spacetype'
  }

  get width(): number { return this.w }
  get height(): number { return this.h }

  async getFrame(n: number): Promise<TexImageSource> {
    const canvas = this.handle && renderSpaceTypeClipToCanvas(this.handle, this.clip, n, this.fps)
    if (canvas) return canvas
    // No WebGL2, or a render error: emit a transparent frame so one bad clip
    // never fails the whole composite.
    if (!this.fallback) {
      this.fallback = document.createElement('canvas')
      this.fallback.width = this.w
      this.fallback.height = this.h
    }
    return this.fallback
  }

  dispose(): void {
    if (this.released) return
    this.released = true
    releaseSpaceTypeEngine(this.handle)
    this.handle = null
    if (this.fallback) {
      this.fallback.width = 0
      this.fallback.height = 0
      this.fallback = null
    }
  }
}
```

- [ ] **Step 4: Wire the compositor**

In `frontend/app/lib/engine/webglPreviewRenderer.ts`, add the import beside the `TextCanvasSource` import:

```ts
import { SpaceTypeSource } from './sources/spaceTypeSource'
```

Extend the `ResolutionPlan` union (currently `:17-22`):

```ts
export type ResolutionPlan =
  | { kind: 'image'; url: string }
  | { kind: 'video'; url: string }
  | { kind: 'sequence'; urls: string[] }
  | { kind: 'text' }
  | { kind: 'spacetype' }
  | null
```

Add the short-circuit as the **second** line of `resolutionPlanFor`, beside the existing text one:

```ts
export function resolutionPlanFor(clip: Clip, preview: ClipPreview | null): ResolutionPlan {
  if (TextCanvasSource.supports(clip)) return { kind: 'text' }
  if (SpaceTypeSource.supports(clip)) return { kind: 'spacetype' }
  if (!preview) return null
  ...
```

Add the case to `loadSource` (`:111-135`), beside `case 'text'`:

```ts
      case 'spacetype':
        return new SpaceTypeSource(clip as SpaceTypeClip, fps)
```

Add the `SpaceTypeClip` type import to the file's `shared/timeline/types` import list.

- [ ] **Step 5: Add the kind to the draw list**

In `frontend/app/lib/engine/compositor.ts`, add `'spacetype'` to `RENDERABLE_KINDS` (currently `{image, video, title, lower_third, motion}`). Without this the clip loads a source but produces no draw entry.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/renderer-resolve.unit.spec.ts tests/unit/spacetype-clip-render.unit.spec.ts`
Expected: PASS.

- [ ] **Step 7: Verify nothing else regressed**

Run: `cd frontend && npx vitest run tests/unit/ && npx vue-tsc --noEmit | grep -iE 'spacetype|timeline'`
Expected: all unit tests PASS; grep prints nothing.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/engine/sources/spaceTypeSource.ts frontend/app/lib/engine/webglPreviewRenderer.ts frontend/app/lib/engine/compositor.ts frontend/tests/unit/renderer-resolve.unit.spec.ts
git commit -m "feat(timeline): SpaceTypeSource — live three.js clips in the GL compositor

WebGL canvas uploads directly as a texture; no readback. A failed render
emits a transparent frame rather than failing the composite."
```

---

### Task 5: Canvas2D fallback branch

**Files:**
- Modify: `frontend/app/composables/usePlaybackEngine.ts:1-7` (imports), `:174` (new branch)
- Create: `frontend/tests/unit/spacetype-canvas2d-branch.unit.spec.ts`

**Interfaces:**
- Consumes: `drawSpaceTypeClip` (Task 3), `SpaceTypeClip` (Task 1).
- Produces: nothing new; this makes the existing fallback path render Space Type clips.

**Why this is not optional.** `TimelineEditor.vue:226-236` probes `webglPreviewSupported()` at runtime and silently drops to this Canvas2D engine when WebGL2 is absent. Skipping it means Space Type clips vanish for those users with only a `console.warn`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-canvas2d-branch.unit.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { drawSpaceTypeClip } from '../../app/lib/engine/spaceTypeClipRenderer'
import { createSpaceTypeClip } from '../../app/composables/timelineSpaceTypeClip'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'

vi.mock('../../app/lib/engine/spaceTypeEnginePool', () => ({
  acquireSpaceTypeEngine: () => ({ id: 1 }),
  getSpaceTypeEngine: () => null,          // simulate no engine for this frame
  releaseSpaceTypeEngine: () => {},
  structuralKey: () => 'k',
}))

describe('drawSpaceTypeClip when the engine is unavailable', () => {
  it('draws nothing and does not throw', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: defaultSpaceTypeState() })
    const drawImage = vi.fn()
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D
    expect(() => drawSpaceTypeClip({ id: 1 }, ctx, clip, 0, 1920, 1080, 30)).not.toThrow()
    expect(drawImage).not.toHaveBeenCalled()
  })

  it('draws nothing when the handle itself is null', () => {
    const clip = createSpaceTypeClip({ startFrame: 0, state: defaultSpaceTypeState() })
    const drawImage = vi.fn()
    const ctx = { drawImage } as unknown as CanvasRenderingContext2D
    expect(() => drawSpaceTypeClip(null, ctx, clip, 0, 1920, 1080, 30)).not.toThrow()
    expect(drawImage).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-canvas2d-branch.unit.spec.ts`
Expected: FAIL if `drawSpaceTypeClip` throws on a null engine; PASS if Task 3 was implemented correctly — in which case this test is a regression guard and you may proceed to Step 3.

- [ ] **Step 3: Add the branch**

In `frontend/app/composables/usePlaybackEngine.ts`, extend the type import at line 2 with `SpaceTypeClip` and add beside the `renderMotionClip` import at line 6:

```ts
import { drawSpaceTypeClip } from '~/lib/engine/spaceTypeClipRenderer'
```

Insert this block at line 174 — immediately after the `clip.kind === 'motion'` block closes and before `const entry = ensureMedia(clip)`:

```ts
        if (clip.kind === 'spacetype') {
          const localFrame = (currentSec - startSec) * fps
          ctx.save()
          ctx.globalCompositeOperation = CANVAS_BLEND[clip.blend ?? 'normal'] ?? 'source-over'
          ctx.globalAlpha = clip.opacity ?? 1
          drawSpaceTypeClip(spaceTypeHandle, ctx, clip as SpaceTypeClip, localFrame, cw, ch, fps)
          ctx.restore()
          continue
        }
```

This fits the existing synchronous shape: `renderFrameAt` is a synchronous three.js render, and `drawImage` of a WebGL canvas is synchronous, so the branch completes within one rAF tick like its neighbours.

**The handle.** Per the ownership contract at the top of `spaceTypeEnginePool.ts`, this composable acquires ONCE for its lifetime — never per frame. Add near the composable's other module-scope state:

```ts
let spaceTypeHandle: SpaceTypeEngineHandle | null = null
```

Acquire lazily the first time a `spacetype` clip is actually encountered (so a timeline with none never touches WebGL at all), and release in the composable's existing `onUnmounted`:

```ts
        if (clip.kind === 'spacetype') {
          if (!spaceTypeHandle) spaceTypeHandle = acquireSpaceTypeEngine()
          ...
```

```ts
  onUnmounted(() => {
    releaseSpaceTypeEngine(spaceTypeHandle)
    spaceTypeHandle = null
    // ...existing teardown
  })
```

Read the composable's existing `onUnmounted` before editing and add to it rather than declaring a second one.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/spacetype-canvas2d-branch.unit.spec.ts && npx vue-tsc --noEmit | grep -iE 'usePlaybackEngine'`
Expected: PASS; grep prints nothing.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/usePlaybackEngine.ts frontend/tests/unit/spacetype-canvas2d-branch.unit.spec.ts
git commit -m "feat(timeline): render Space Type clips in the Canvas2D fallback path

The fallback is live for users without WebGL2, so it must not silently
drop the clip kind."
```

---

### Task 6: Creating clips from the node, and the sync affordance

**Files:**
- Modify: `frontend/app/composables/useTimelineStore.ts:176-181` area (add `addSpaceTypeClip`), and the export list at `:428`
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue:4343` (`handleSpaceTypeOutput`)
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (add the "Send to timeline" action beside `generateVideo`)
- Create: `frontend/tests/unit/spacetype-clip-store.unit.spec.ts`

**Interfaces:**
- Consumes: `createSpaceTypeClip`, `spaceTypeClipIsStale`, `spaceTypeStateKey` (Task 1); `addClip` from `useTimelineStore`.
- Produces, relied on by Task 7:
  - `addSpaceTypeClip(trackId: string, startFrame: number, state: SpaceTypeState, originNodeId?: string): SpaceTypeClip`
  - `syncSpaceTypeClipFromNode(clipId: string, nodeState: SpaceTypeState): void`
  - `sailor:spaceTypeOutput` gains `nodeType: 'TimelineClip'`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-clip-store.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createSpaceTypeClip, spaceTypeClipIsStale, spaceTypeStateKey } from '../../app/composables/timelineSpaceTypeClip'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'

/** Mirrors the patch syncSpaceTypeClipFromNode dispatches, without mounting the store. */
function syncPatch(nodeState: ReturnType<typeof defaultSpaceTypeState>, nodeId: string) {
  return {
    state: JSON.parse(JSON.stringify(nodeState)),
    origin: { node_id: nodeId, state_key: spaceTypeStateKey(nodeState) },
  }
}

describe('sync from node', () => {
  it('clears staleness and adopts the new state', () => {
    const original = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state: original, originNodeId: 'n1' })
    const edited = { ...original, params: { ...original.params, rows: 3 } }
    expect(spaceTypeClipIsStale(clip, edited)).toBe(true)

    const synced = { ...clip, ...syncPatch(edited, 'n1') }
    expect(spaceTypeClipIsStale(synced as any, edited)).toBe(false)
    expect((synced as any).state.params.rows).toBe(3)
  })

  it('preserves clip placement and trim across a sync', () => {
    const original = defaultSpaceTypeState()
    const clip = { ...createSpaceTypeClip({ startFrame: 48, state: original, originNodeId: 'n1' }), length: 300, in_frame: 12, opacity: 0.5 }
    const edited = { ...original, effectId: 'tunnel' }
    const synced = { ...clip, ...syncPatch(edited, 'n1') }
    expect(synced.start_frame).toBe(48)
    expect(synced.length).toBe(300)
    expect(synced.in_frame).toBe(12)
    expect(synced.opacity).toBe(0.5)
  })

  it('invalidates a stale bake when the state changes', () => {
    const original = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state: original, originNodeId: 'n1' })
    clip.spacetype_bake = { source_key: spaceTypeStateKey(original), frames: ['a.png'], fps: 30, external: true }
    const edited = { ...original, params: { ...original.params, rows: 7 } }
    const synced = { ...clip, ...syncPatch(edited, 'n1') }
    expect(synced.spacetype_bake!.source_key).not.toBe(spaceTypeStateKey(edited))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-clip-store.unit.spec.ts`
Expected: PASS. This test exercises only Task 1's exports (`createSpaceTypeClip`, `spaceTypeClipIsStale`, `spaceTypeStateKey` — all three are exported by `timelineSpaceTypeClip.ts`), so it passes immediately and serves as the behavioural contract the store action must satisfy. If it fails with an import error, Task 1 is incomplete — go back and finish it.

- [ ] **Step 3: Add the store actions**

In `frontend/app/composables/useTimelineStore.ts`, add the import beside `createMotionClip` (line 7):

```ts
import { createSpaceTypeClip, spaceTypeStateKey } from '~/composables/timelineSpaceTypeClip'
import type { SpaceTypeState } from '~/lib/spacetype/state'
```

Add these functions immediately after `addMotionClip` (which ends at line 181):

```ts
  function addSpaceTypeClip(trackId: string, startFrame: number, state: SpaceTypeState, originNodeId?: string) {
    const clip = createSpaceTypeClip({ startFrame, state, originNodeId })
    addClip(trackId, clip)
    selectedClipId.value = clip.id
    return clip
  }

  /** Adopt the origin node's current state. Placement and trim are preserved —
   *  only the source content changes, which drops the bake by hash mismatch. */
  function syncSpaceTypeClipFromNode(clipId: string, nodeState: SpaceTypeState) {
    const clip = state.value.tracks.flatMap(t => t.clips).find(c => c.id === clipId) as SpaceTypeClip | undefined
    if (!clip || clip.kind !== 'spacetype' || !clip.origin) return
    updateClip(clipId, {
      state: JSON.parse(JSON.stringify(nodeState)),
      origin: { node_id: clip.origin.node_id, state_key: spaceTypeStateKey(nodeState) },
    } as Partial<Clip>)
  }
```

Add `SpaceTypeClip` to this file's type import from `~~/shared/timeline/types`.

Note that `spacetype_bake` is deliberately left untouched: the new `state` hashes differently, so `ensureSpaceTypeClipBake` sees a `source_key` mismatch and re-bakes on the next export. Clearing it here would be redundant, and clearing it *wrongly* (e.g. on a no-op sync) would throw away a valid bake.

Add both to the composable's return object at line 428, beside `addMotionClip`.

- [ ] **Step 4: Add the "Send to timeline" action**

In `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`, beside the existing `generateVideo()` handler (~line 961), add:

```ts
function sendToTimeline() {
  window.dispatchEvent(new CustomEvent('sailor:spaceTypeOutput', {
    detail: { nodeId: props.nodeId, nodeType: 'TimelineClip', state: JSON.parse(JSON.stringify(state.value)) },
  }))
}
```

Add a "Send to timeline" button beside the existing Generate Image / Generate Video buttons, calling `sendToTimeline`. Match the surrounding button markup and classes exactly — do not introduce new styles.

In `frontend/app/components/vue-canvas/VueNodeCanvas.vue`, extend `handleSpaceTypeOutput` (line 4343) with a branch before the existing Image/Video handling:

```ts
  if (detail.nodeType === 'TimelineClip') {
    const track = timelineStore.state.value.tracks.find(t => t.kind === 'video')
    if (!track) { console.warn('spaceTypeOutput: no video track to receive the clip'); return }
    const start = timelineStore.playhead?.value ?? 0
    timelineStore.addSpaceTypeClip(track.id, start, detail.state, detail.nodeId)
    return
  }
```

Adapt `timelineStore` and `playhead` to the actual names in scope at that call site — read the surrounding 40 lines before editing.

- [ ] **Step 5: Add the inspector sync affordance**

Create `frontend/app/components/vue-canvas/timeline/SpaceTypeClipInspector.vue` as a sibling of `MotionClipInspector.vue` (read that file first and match its prop shape, wrapper markup and Tailwind classes exactly — do not invent new styling):

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { SpaceTypeClip } from '~~/shared/timeline/types'
import type { SpaceTypeState } from '~/lib/spacetype/state'
import { spaceTypeClipIsStale } from '~/composables/timelineSpaceTypeClip'

const props = defineProps<{
  clip: SpaceTypeClip
  /** Current state of the originating node, or null when it is gone. */
  nodeState: SpaceTypeState | null
}>()

const emit = defineEmits<{ (e: 'sync', clipId: string): void }>()

/** Only offered when the origin node still exists AND has drifted. No origin,
 *  or a deleted node, renders nothing — that is a normal snapshot clip, not an
 *  error, and must never surface a warning. */
const canSync = computed(() => spaceTypeClipIsStale(props.clip, props.nodeState))
</script>

<template>
  <div>
    <button v-if="canSync" type="button" @click="emit('sync', clip.id)">
      Sync from node
    </button>
  </div>
</template>
```

Wire the `sync` event to `syncSpaceTypeClipFromNode(clipId, nodeState)` at the parent that already renders `MotionClipInspector`, and resolve `nodeState` by looking up `clip.origin?.node_id` in the node canvas — passing `null` when the id is absent or the node no longer exists.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/spacetype-clip-store.unit.spec.ts && npx vue-tsc --noEmit | grep -iE 'spacetype|timeline'`
Expected: PASS, 3 tests; grep prints nothing.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/composables/useTimelineStore.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/app/components/vue-canvas/timeline/SpaceTypeClipInspector.vue frontend/tests/unit/spacetype-clip-store.unit.spec.ts
git commit -m "feat(spacetype): send to timeline as a live clip + sync-from-node

Sync preserves placement and trim; only source content changes, which
invalidates the bake by hash mismatch."
```

---

### Task 7: Export bake with seamless tiling

**Files:**
- Create: `frontend/app/lib/engine/spaceTypeClipBake.ts`
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue:1076-1095` (the pre-export bake loop)
- Create: `frontend/tests/unit/spacetype-clip-bake.unit.spec.ts`

**Interfaces:**
- Consumes: `ensureSpaceTypeBake`, `SpaceTypeBake`, `BakeDeps` from `app/lib/spacetype/bake.ts`; `spaceTypeSourceKey`/`SourceKeyInput` from `app/lib/spacetype/sourceKey.ts`; `loopMultiplier` from `app/lib/spacetype/loop.ts`; `getEffect`; `renderSpaceTypeClipToCanvas` (Task 3).
- Produces, relied on by Task 8:
  - `function spaceTypeBakeFrameCount(clip: SpaceTypeClip): number` — `k` loops' worth of frames
  - `async function ensureSpaceTypeClipBake(clip: SpaceTypeClip, onProgress?: (done: number, total: number) => void): Promise<MotionBake>`
  - Payload contract: each `spacetype` clip carries `spacetype_frames: string[]` (flattened from `spacetype_bake.frames`) and `spacetype_loop: boolean`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-clip-bake.unit.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { spaceTypeBakeFrameCount } from '../../app/lib/engine/spaceTypeClipBake'
import { createSpaceTypeClip } from '../../app/composables/timelineSpaceTypeClip'
import { defaultSpaceTypeState } from '../../app/lib/spacetype/state'

describe('spaceTypeBakeFrameCount', () => {
  it('bakes one loop, not the clip length', () => {
    const state = defaultSpaceTypeState()          // 30fps * 6s = 180
    const clip = createSpaceTypeClip({ startFrame: 0, state, length: 1800 }) // 60s clip
    // ribbon's loopRates should resolve k=1; the bake must not be 1800 frames
    expect(spaceTypeBakeFrameCount(clip)).toBeLessThanOrEqual(180 * 60)
    expect(spaceTypeBakeFrameCount(clip)).toBeLessThan(1800)
  })

  it('is a whole multiple of one loop', () => {
    const state = defaultSpaceTypeState()
    const clip = createSpaceTypeClip({ startFrame: 0, state, length: 900 })
    expect(spaceTypeBakeFrameCount(clip) % 180).toBe(0)
  })

  it('does not depend on clip length, placement, opacity or trim', () => {
    const state = defaultSpaceTypeState()
    const a = createSpaceTypeClip({ startFrame: 0, state, length: 180 })
    const b = { ...createSpaceTypeClip({ startFrame: 500, state, length: 1800 }), opacity: 0.3, in_frame: 40 }
    expect(spaceTypeBakeFrameCount(a)).toBe(spaceTypeBakeFrameCount(b as any))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-clip-bake.unit.spec.ts`
Expected: FAIL — cannot resolve `spaceTypeClipBake`.

- [ ] **Step 3: Write the bake module**

Create `frontend/app/lib/engine/spaceTypeClipBake.ts`:

```ts
// frontend/app/lib/engine/spaceTypeClipBake.ts
/** Bake a Space Type clip to PNG frames for the Python export path, which
 *  cannot run three.js.
 *
 *  We bake ONE seamless cycle — k loops, where k comes from loopMultiplier so
 *  every motion rate completes whole cycles — and let the exporter tile it. A
 *  6s loop on a 60s clip is 180 frames, not 1800.
 *
 *  The cache key deliberately excludes clip placement, trim, opacity and
 *  keyframes: those composite at export time, so moving or fading a clip must
 *  not invalidate the bake. */
import type { SpaceTypeClip, MotionBake } from '~~/shared/timeline/types'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'
import { getEffect } from '~/lib/spacetype/effects/index'
import { loopMultiplier } from '~/lib/spacetype/loop'
import { dimsFromKey } from '~/lib/spacetype/state'
import { spaceTypeSourceFrameCount } from '~/composables/timelineSpaceTypeClip'
import { renderSpaceTypeClipToCanvas } from './spaceTypeClipRenderer'
import { acquireSpaceTypeEngine, releaseSpaceTypeEngine } from './spaceTypeEnginePool'

/** k, the number of loops needed for every motion rate to close cleanly. */
export function spaceTypeLoopMultiplier(clip: SpaceTypeClip): number {
  const effect = getEffect(clip.state.effectId)
  const rates = effect.loopRates?.(clip.state.params) ?? []
  return loopMultiplier(rates)
}

export function spaceTypeBakeFrameCount(clip: SpaceTypeClip): number {
  return spaceTypeSourceFrameCount(clip) * spaceTypeLoopMultiplier(clip)
}

/** MUST include post, projection and pan.
 *
 *  `spaceTypeSourceKey`'s own `SourceKeyInput` omits them, which is fine for
 *  the studio's mp4 button (it always re-bakes) but WRONG here: the bake is
 *  cached and skipped on a key match, so a user who changes bloom, exposure or
 *  pan would export stale frames showing the OLD post-processing, silently.
 *  Folding them into the hashed `params` bag is the cheapest correct fix — the
 *  key is opaque, so extra entries only ever cause a (correct) re-bake. */
function bakeCfg(clip: SpaceTypeClip) {
  const [W, H] = dimsFromKey(clip.state.dimsKey)
  const k = spaceTypeLoopMultiplier(clip)
  return {
    effectId: clip.state.effectId,
    params: {
      ...clip.state.params,
      __post: JSON.stringify(clip.state.post ?? null),
      __projection: clip.state.projection ?? 'perspective',
      __pan: `${clip.state.panX ?? 0},${clip.state.panY ?? 0}`,
      __gradient: JSON.stringify(clip.state.gradientStops ?? []),
    },
    fps: clip.state.fps,
    loopDuration: clip.state.loopDuration * k,   // k loops in one bake
    W,
    H,
    alpha: clip.state.transparent,
    bgColor: clip.state.bgColor,
  }
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('space type bake: toBlob returned null')), 'image/png')
  })
}

/** Bake if missing or stale. Returns a MotionBake with external: true, so the
 *  existing export-side skip at TimelineEditor.vue:1082 leaves it alone. */
export async function ensureSpaceTypeClipBake(
  clip: SpaceTypeClip,
  onProgress?: (done: number, total: number) => void,
): Promise<MotionBake> {
  const cfg = bakeCfg(clip)
  // Acquire ONCE for the whole bake, release in `finally` — never per frame.
  // See the ownership contract at the top of spaceTypeEnginePool.ts.
  const handle = acquireSpaceTypeEngine()
  if (!handle) throw new Error(`space type bake: no WebGL2 — cannot bake clip ${clip.id}`)
  try {
    const bake = await ensureSpaceTypeBake(cfg, clip.spacetype_bake, {
      renderFrame: async (index: number) => {
        const src = { ...clip, in_frame: 0, loop: true } as SpaceTypeClip
        const canvas = renderSpaceTypeClipToCanvas(handle, src, index, clip.state.fps)
        if (!canvas) throw new Error(`space type bake: engine unavailable at frame ${index} of clip ${clip.id}`)
        return await canvasToPngBlob(canvas)
      },
      onProgress,
    })
    return { ...bake, external: true }
  } finally {
    releaseSpaceTypeEngine(handle)
  }
}
```

**Why `renderFrame` passes a trim-free clip:** the bake walks `0 … k*sourceFrames-1`, and `sourceT01` applies `in_frame` and the loop modulo. A bake index is a *source* index, not a clip-local one, so the `{ ...clip, in_frame: 0, loop: true }` view above is required — baking through the clip's own trim would shift every frame by `in_frame` and desync the export from the live preview.

Add a test pinning this: a clip with `in_frame: 40` must bake the same frames as the same clip with `in_frame: 0`.

- [ ] **Step 4: Wire the pre-export loop**

In `frontend/app/components/vue-canvas/TimelineEditor.vue`, read lines 1076–1095 first — the motion-bake loop is the pattern. Add an adjacent loop over `spacetype` clips:

```ts
    const spaceTypeClips = state.value.tracks.flatMap(t => t.clips).filter(c => c.kind === 'spacetype') as SpaceTypeClip[]
    let bakedClips = 0
    for (const clip of spaceTypeClips) {
      renderStatus.value = `Baking Space Type ${bakedClips + 1}/${spaceTypeClips.length}…`
      clip.spacetype_bake = await ensureSpaceTypeClipBake(clip, (done, total) => {
        renderStatus.value = `Baking Space Type ${bakedClips + 1}/${spaceTypeClips.length} — frame ${done}/${total}`
      })
      bakedClips += 1
    }
```

Then flatten into the payload beside the existing `clip.motion_frames` flattening:

```ts
      if (clip.kind === 'spacetype' && clip.spacetype_bake) {
        (clip as any).spacetype_frames = clip.spacetype_bake.frames
        ;(clip as any).spacetype_loop = clip.loop !== false
      }
```

Bind `renderStatus` to the same UI element the existing NDJSON render progress uses. **This is a requirement, not polish** — a supersampled three.js bake is slow enough that a silent freeze reads as a hang.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/spacetype-clip-bake.unit.spec.ts && npx vue-tsc --noEmit | grep -iE 'spacetype'`
Expected: PASS, 3 tests; grep prints nothing.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/engine/spaceTypeClipBake.ts frontend/app/components/vue-canvas/TimelineEditor.vue frontend/tests/unit/spacetype-clip-bake.unit.spec.ts
git commit -m "feat(timeline): bake Space Type clips for export, k loops with tiling

Bakes one seamless cycle rather than the clip length, sets external:true,
and reports progress into the existing render status."
```

---

### Task 8: Python export branch

**Files:**
- Modify: `comfy_extras/nodes_timeline.py` (the clip-loading branch near `:1110-1124`, and the clip-kind dispatch in `render_frame_np`)
- Create: `tests/timeline_spacetype_test.py`

**Interfaces:**
- Consumes: `spacetype_frames: list[str]` and `spacetype_loop: bool` on each `spacetype` clip in the incoming JSON (Task 7).
- Produces: `spacetype` clips composite in `render_frame_np` exactly as `motion` clips do, with tiling.

- [ ] **Step 1: Write the failing test**

Create `tests/timeline_spacetype_test.py`:

```python
import pytest
from comfy_extras.nodes_timeline import spacetype_source_index


def test_tiles_past_the_baked_range():
    # 180 baked frames, clip-local frame 200 wraps to 20
    assert spacetype_source_index(200, 180, True) == 20
    assert spacetype_source_index(180, 180, True) == 0
    assert spacetype_source_index(0, 180, True) == 0


def test_holds_last_frame_when_loop_is_off():
    assert spacetype_source_index(200, 180, False) == 179
    assert spacetype_source_index(179, 180, False) == 179


def test_negative_and_zero_are_safe():
    assert spacetype_source_index(-5, 180, True) == 175
    assert spacetype_source_index(-5, 180, False) == 0
    assert spacetype_source_index(10, 0, True) == 0
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests/timeline_spacetype_test.py -v`
Expected: FAIL — `ImportError: cannot import name 'spacetype_source_index'`

- [ ] **Step 3: Implement the helper and the branch**

In `comfy_extras/nodes_timeline.py`, add near the other frame-mapping helpers:

```python
def spacetype_source_index(local_frame: int, baked_count: int, loop: bool) -> int:
    """Map a clip-local frame onto the baked Space Type cycle.

    The browser bakes one seamless cycle (k loops), not the whole clip, so a
    long clip tiles into a short bake. With loop off, hold the last frame.
    """
    if baked_count <= 0:
        return 0
    if loop:
        return local_frame % baked_count
    return max(0, min(local_frame, baked_count - 1))
```

In the clip-loading branch beside the `motion_frames` handling (`:1110-1124`), add:

```python
        elif kind == "spacetype":
            frames = clip.get("spacetype_frames") or []
            if not frames:
                raise ValueError(
                    f"timeline: spacetype clip {clip.get('id')} has no baked frames — "
                    "the browser must bake before export"
                )
            idx = spacetype_source_index(local_frame, len(frames), bool(clip.get("spacetype_loop", True)))
            img = load_input_image(frames[idx], preserve_alpha=True)
```

Match the exact variable names and image-loading helper used by the adjacent `motion` branch — read the surrounding 30 lines before editing. Add `"spacetype"` wherever `"motion"` appears in a renderable-kind list or dispatch table in this file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests/timeline_spacetype_test.py -v`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/nodes_timeline.py tests/timeline_spacetype_test.py
git commit -m "feat(timeline): composite baked Space Type clips on export

Tiles a k-loop bake across the clip length; errors clearly when the
browser did not bake."
```

---

### Task 9: Error handling, the purity guard, and golden parity

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue` (block export without WebGL2; surface the degraded state)
- Modify: `frontend/app/lib/engine/spaceTypeEnginePool.ts` (context-loss recovery)
- Modify: `frontend/tests/timeline-golden.spec.ts` (purity guard + baked/live parity)

**Interfaces:**
- Consumes: everything above.
- Produces: no new API. This task makes the failure modes match the spec's error table.

- [ ] **Step 1: Write the purity test as a real pixel comparison**

Purity in `t01` is the property the whole design rests on: timeline scrubbing is random-access, so an effect that accumulates state across `update()` calls would render differently forwards and backwards.

**This cannot be tested in vitest.** Asserting `update()` merely does not throw would be a test whose green light means nothing — `update()` mutates a scene graph that needs a real GL context to observe. So the purity guard lives in the Playwright golden suite, where a context exists.

Add to `frontend/tests/timeline-golden.spec.ts` (match the file's existing harness names — the shape below is illustrative of the assertion, not of its exact helpers):

```ts
test('spacetype: seeking backward renders identically to seeking forward', async ({ page }) => {
  const state = editState({
    canvas: { width: 960, height: 540, fps: 30, bg_color: '#000000' },
    tracks: [{ id: 'v1', kind: 'video', clips: [spaceTypeClipFixture({ startFrame: 0, length: 180 })] }],
  })

  const probe = [0, 45, 90, 135]
  const forward: Buffer[] = []
  for (const f of probe) forward.push(await renderWithGl(page, state, f))

  // Same frames, reverse order — a stateful effect diverges here.
  const backward: Buffer[] = []
  for (const f of [...probe].reverse()) backward.unshift(await renderWithGl(page, state, f))

  for (let i = 0; i < probe.length; i++) {
    expect(rmse(forward[i]!, backward[i]!), `frame ${probe[i]} differs by seek direction`).toBe(0)
  }
})
```

RMSE of exactly `0` is deliberate — this is the same effect at the same `t01` in the same context, so anything above zero is accumulated state, not tolerance.

- [ ] **Step 2: Run it**

Run: `cd frontend && npx playwright test tests/timeline-golden.spec.ts -g "seeking backward"`
Expected: PASS. A failure names the frame and means a real effect is stateful — fix the effect, never loosen the assertion to a tolerance.

- [ ] **Step 3: Add context-loss recovery**

In `frontend/app/lib/engine/spaceTypeEnginePool.ts`, register a loss handler inside `acquireSpaceTypeEngine` right after the engine is constructed:

```ts
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault()
        console.warn('spaceTypeEnginePool: WebGL context lost — resetting pool')
        engine = null
        canvas = null
        refs = 0
      }, { once: true })
```

`webglFailed` is deliberately NOT set here: a lost context should be retried once on the next acquire, unlike an outright unsupported browser.

- [ ] **Step 4: Block export without WebGL2**

In `frontend/app/components/vue-canvas/TimelineEditor.vue`, before the bake loop added in Task 7:

```ts
    if (spaceTypeClips.length && !spaceTypeEngineAvailable()) {
      renderError.value = 'This timeline contains Space Type clips, which need WebGL2 to render. Export is unavailable in this browser.'
      return
    }
```

Silently emitting transparent frames would ship a broken video with no signal. Bind `renderError` to the same surface existing render errors use.

- [ ] **Step 5: Extend the golden parity test**

Read `frontend/tests/timeline-golden.spec.ts` first and match its existing helper names and tolerance constant — the shape below is illustrative of the assertion, not of this file's exact harness:

```ts
test('spacetype clip: live GL render matches the baked server render', async ({ page }) => {
  const state = editState({
    canvas: { width: 960, height: 540, fps: 30, bg_color: '#000000' },
    tracks: [{
      id: 'v1', kind: 'video', clips: [
        spaceTypeClipFixture({ startFrame: 0, length: 360 }), // 2 loops of a 6s/30fps source
      ],
    }],
  })

  // A frame inside the first loop, and the same phase inside the second — the
  // pair that catches a drift between sourceT01 (browser) and
  // spacetype_source_index (python).
  for (const frame of [0, 45, 180, 225]) {
    const gl = await renderWithGl(page, state, frame)
    const server = await renderWithServer(page, state, frame)
    expect(rmse(gl, server)).toBeLessThan(GOLDEN_TOLERANCE)
  }
})
```

Frames 45 and 225 are one full loop apart, so they must be pixel-identical to each other as well as to the server render. That pairing is the actual point of the test: it fails if either side's tiling arithmetic drifts.

- [ ] **Step 6: Run the full gate**

Run:
```bash
cd frontend && npx vitest run tests/unit/ && npx vue-tsc --noEmit | grep -iE 'spacetype|timeline'
cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests/timeline_spacetype_test.py -v
```
Expected: all unit tests PASS; grep prints nothing; python tests PASS.

- [ ] **Step 7: Verify in the running app**

This is the step that proves the feature, not the tests. Start the dev servers (`./dev.sh`), then:
1. Add a Space Type node, pick an effect, click "Send to timeline".
2. Scrub the timeline — the effect animates live, with no bake and no render round trip.
3. Extend the clip past its 6s loop — the animation tiles seamlessly rather than freezing.
4. Change the effect on the node — the clip does NOT change (snapshot), and the inspector offers "Sync from node".
5. Add a second Space Type clip with a different effect, overlap them, scrub across the overlap — both render, and playback does not stutter.
6. Confirm exactly one WebGL context is created for the timeline: `performance.getEntriesByType` will not show this, so assert via the pool — in the console, `import('/app/lib/engine/spaceTypeEnginePool')` is not reachable, so instead add a temporary `console.count` in `acquireSpaceTypeEngine`'s construction branch and confirm it fires once. Remove it before committing.
7. Export the timeline — bake progress appears in the render status, and the output video shows the effect.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/engine/spaceTypeEnginePool.ts frontend/app/components/vue-canvas/TimelineEditor.vue frontend/tests/timeline-golden.spec.ts frontend/tests/timeline-golden.spec.ts
git commit -m "feat(timeline): Space Type error handling, purity guard, golden parity

Context-loss recovery, export blocked (not silently broken) without
WebGL2, and a test that pins effect purity in t01."
```

---

## Deferred (explicitly not in this plan)

Per the spec's Follow-ups, these are out of scope and must not be attempted here:

- **`TimelineModal.vue` and `TimelineNodePreview.vue`** show a poster frame (source frame 0) for `spacetype` clips. They carry their own hand-rolled compositors; wiring them live is part of the compositor-consolidation project, not this one. Do not add a third and fourth Space Type implementation to them.
- **Compositor consolidation** — the four diverged render surfaces.
- **Export architecture** — whether Python/PyAV or WebCodecs should own export.
- **3D Studio motion** and **KineticType/MotionClip convergence.**
