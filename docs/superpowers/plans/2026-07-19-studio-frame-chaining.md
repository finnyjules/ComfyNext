# Studio Frame Chaining Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a studio node (Space Type, Gradient Studio) be wired directly into Shader Studio, so the shader stack runs over the upstream studio's live animated output — giving motion without any video codec.

**Architecture:** Studios are time-parameterized renderers, not files. A new cross-studio registry lets a studio publish a `(t01, w, h) → TexImageSource` puller. Shader Studio resolves its input to a uniform `ResolvedSource` — backed either by a live upstream studio or by the existing artifact-file path — and both its preview loops and its export read the clock from that source.

**Tech Stack:** Vue 3 + TypeScript (Nuxt 4), WebGL via the existing `shaderFx` singleton, Vitest for unit tests (`tests/unit/**/*.unit.spec.ts`), Playwright for E2E (`tests/*.spec.ts`).

## Global Constraints

- Unit tests live at `frontend/tests/unit/<name>.unit.spec.ts` and must match the glob `tests/unit/**/*.unit.spec.ts`. Run with `cd frontend && npm run test:unit`.
- Unit tests run in `environment: 'node'` — **no DOM**. Pure logic only; anything touching `HTMLCanvasElement`, WebGL, or Vue components is verified manually in the app, not in Vitest.
- Import inside `frontend/app` using the `~` alias (e.g. `~/lib/studio/frameSource`), matching every existing module.
- Existing behaviour must not regress: the Space Type → Image artifact → Shader Studio 3-node chain, and Shader Studio with an uploaded/pasted still, both keep working exactly as today.
- The artifact-file resolution path in `frontend/app/lib/shaderstudio/source.ts` is **not** removed or rewritten — it becomes one branch behind a new resolver.
- Do not add a shader UI section to any other studio's modal. Shader Studio remains the single shader implementation.
- Commit after each task with the exact `git add` paths listed — other sessions work in this repo concurrently, so never use `git add -A` or `git add .`.

---

## File Structure

**Create:**
- `frontend/app/lib/studio/frameSource.ts` — the cross-studio frame-puller registry. Lives beside `cascade.ts` because it is cross-studio infrastructure, not Shader-Studio-specific.
- `frontend/app/lib/shaderstudio/resolve.ts` — resolves a Shader Studio node's input to a uniform `ResolvedSource`, hiding whether it came from a live studio or a file.
- `frontend/app/lib/gradientfx/frameSource.ts` — Gradient Studio's adapter (pure, testable; the Vue component only calls it).
- `frontend/app/lib/spacetype/frameSource.ts` — Space Type's adapter.
- `frontend/tests/unit/studio-frame-source.unit.spec.ts`
- `frontend/tests/unit/shaderstudio-resolve.unit.spec.ts`
- `frontend/tests/unit/gradientfx-frame-source.unit.spec.ts`

**Modify:**
- `frontend/app/components/vue-canvas/GradientStudioNode.vue` — register/unregister its frame source.
- `frontend/app/components/vue-canvas/SpaceTypeNode.vue` — same.
- `frontend/app/components/vue-canvas/ShaderStudioNode.vue:32-108` — hold a `ResolvedSource`, async render loop, animate when the source animates.
- `frontend/app/components/vue-canvas/ShaderStudioSurface.vue:232-266,429-451` — same for the modal, plus export clock.
- `frontend/app/components/vue-canvas/VueNodeCanvas.vue:3696` — allow studio nodes as publish targets.

---

### Task 1: Frame-source registry

**Files:**
- Create: `frontend/app/lib/studio/frameSource.ts`
- Test: `frontend/tests/unit/studio-frame-source.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `StudioFrameSource` (interface with `getFrame`, `duration`, `fps`, `width`, `height`), `registerStudioFrameSource(id: string, src: StudioFrameSource): void`, `unregisterStudioFrameSource(id: string): void`, `getStudioFrameSource(id: string): StudioFrameSource | undefined`, `isAnimatedSource(src: StudioFrameSource | undefined | null): boolean`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/studio-frame-source.unit.spec.ts`:

```ts
// frontend/tests/unit/studio-frame-source.unit.spec.ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  getStudioFrameSource,
  isAnimatedSource,
  registerStudioFrameSource,
  unregisterStudioFrameSource,
  type StudioFrameSource,
} from '~/lib/studio/frameSource'

const stub = (over: Partial<StudioFrameSource> = {}): StudioFrameSource => ({
  getFrame: async () => ({} as any),
  duration: 4,
  fps: 30,
  width: 1920,
  height: 1080,
  ...over,
})

describe('studio frame-source registry', () => {
  beforeEach(() => {
    unregisterStudioFrameSource('a')
    unregisterStudioFrameSource('b')
  })

  it('returns undefined for an unregistered id', () => {
    expect(getStudioFrameSource('a')).toBeUndefined()
  })

  it('returns the registered source', () => {
    const s = stub()
    registerStudioFrameSource('a', s)
    expect(getStudioFrameSource('a')).toBe(s)
  })

  it('keeps ids independent', () => {
    const a = stub({ duration: 2 }), b = stub({ duration: 9 })
    registerStudioFrameSource('a', a)
    registerStudioFrameSource('b', b)
    expect(getStudioFrameSource('a')?.duration).toBe(2)
    expect(getStudioFrameSource('b')?.duration).toBe(9)
  })

  it('unregister removes only that id', () => {
    registerStudioFrameSource('a', stub())
    registerStudioFrameSource('b', stub())
    unregisterStudioFrameSource('a')
    expect(getStudioFrameSource('a')).toBeUndefined()
    expect(getStudioFrameSource('b')).toBeDefined()
  })

  it('re-registering the same id replaces the previous source', () => {
    const first = stub({ duration: 1 }), second = stub({ duration: 7 })
    registerStudioFrameSource('a', first)
    registerStudioFrameSource('a', second)
    expect(getStudioFrameSource('a')).toBe(second)
  })

  // duration <= 0 means "this is a still" — the spec's rule for a studio with
  // no motion tracks and zero flow speed.
  it('treats duration > 0 as animated', () => {
    expect(isAnimatedSource(stub({ duration: 4 }))).toBe(true)
  })

  it('treats zero and negative duration as a still', () => {
    expect(isAnimatedSource(stub({ duration: 0 }))).toBe(false)
    expect(isAnimatedSource(stub({ duration: -1 }))).toBe(false)
  })

  it('treats a missing source as a still', () => {
    expect(isAnimatedSource(undefined)).toBe(false)
    expect(isAnimatedSource(null)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/studio-frame-source.unit.spec.ts`
Expected: FAIL — `Failed to resolve import "~/lib/studio/frameSource"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/studio/frameSource.ts`:

```ts
// frontend/app/lib/studio/frameSource.ts
// Cross-studio frame-puller registry. Studios are time-parameterized renderers,
// so a downstream consumer (Shader Studio) can pull any frame at any size rather
// than waiting for a baked file. Sibling of cascade.ts's StudioBaker registry,
// which stays as-is for the single-still bake path.

/**
 * A studio's live frame puller.
 *
 * `getFrame` renders at normalized loop time `t01` (0..1) at the requested pixel
 * size and returns a texture-uploadable surface — usually the studio's own
 * canvas. The returned surface is only valid until the next `getFrame` call on
 * the same source (renderers reuse one canvas), so consumers must upload it to a
 * texture before pulling again.
 *
 * `duration` is the source's natural clock in seconds; `<= 0` means "still".
 */
export interface StudioFrameSource {
  getFrame: (t01: number, w: number, h: number) => Promise<TexImageSource>
  duration: number
  fps: number
  width: number
  height: number
}

const _frameSources = new Map<string, StudioFrameSource>()

export function registerStudioFrameSource(id: string, src: StudioFrameSource): void {
  _frameSources.set(id, src)
}

export function unregisterStudioFrameSource(id: string): void {
  _frameSources.delete(id)
}

export function getStudioFrameSource(id: string): StudioFrameSource | undefined {
  return _frameSources.get(id)
}

/** True when a source has a real clock — drives whether consumers run a preview loop. */
export function isAnimatedSource(src: StudioFrameSource | undefined | null): boolean {
  return !!src && src.duration > 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/studio-frame-source.unit.spec.ts`
Expected: PASS — 8 passed

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/studio/frameSource.ts frontend/tests/unit/studio-frame-source.unit.spec.ts
git commit -m "feat(studio): add cross-studio frame-source registry"
```

---

### Task 2: Uniform source resolution for Shader Studio

**Files:**
- Create: `frontend/app/lib/shaderstudio/resolve.ts`
- Test: `frontend/tests/unit/shaderstudio-resolve.unit.spec.ts`

**Interfaces:**
- Consumes: `getStudioFrameSource`, `isAnimatedSource`, `StudioFrameSource` from Task 1; existing `resolveWiredInput` from `~/lib/shaderstudio/source`.
- Produces:
  - `ResolvedSource` — `{ getFrame(t01: number, w: number, h: number): Promise<TexImageSource>; width: number; height: number; duration: number; fps: number; isLive: boolean }`
  - `resolveSourceKind(nodeId: string, nodes: any[], edges: any[]): { kind: 'live'; source: StudioFrameSource } | { kind: 'url'; url: string } | null`
  - `makeImageSource(img: { naturalWidth: number; naturalHeight: number }): ResolvedSource`
  - `makeLiveSource(src: StudioFrameSource): ResolvedSource`
  - `exportClock(resolved: ResolvedSource | null, ownDuration: number, ownFps: number): { duration: number; fps: number }`
  - `motionConfigFor<T extends { motion: { duration: number } }>(cfg: T, duration: number): T`

`resolveSourceKind` returns the *descriptor*; the caller loads an image for the `url` case (needs DOM) and then calls `makeImageSource`. This split is what keeps the resolution logic unit-testable in a node environment.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/shaderstudio-resolve.unit.spec.ts`:

```ts
// frontend/tests/unit/shaderstudio-resolve.unit.spec.ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  registerStudioFrameSource,
  unregisterStudioFrameSource,
  type StudioFrameSource,
} from '~/lib/studio/frameSource'
import {
  exportClock,
  makeImageSource,
  makeLiveSource,
  motionConfigFor,
  resolveSourceKind,
} from '~/lib/shaderstudio/resolve'

const frames = (over: Partial<StudioFrameSource> = {}): StudioFrameSource => ({
  getFrame: async () => ({ tag: 'frame' } as any),
  duration: 6,
  fps: 24,
  width: 800,
  height: 600,
  ...over,
})

const shader = { id: 's1', data: {} }
const edgeInto = (from: string) => [{ source: from, target: 's1', targetHandle: 'input-0' }]

describe('resolveSourceKind', () => {
  beforeEach(() => { unregisterStudioFrameSource('up') })

  it('returns null with nothing wired', () => {
    expect(resolveSourceKind('s1', [shader], [])).toBeNull()
  })

  it('prefers a live upstream frame source over the artifact file', () => {
    // The upstream node ALSO has an artifact image — live must still win.
    const up = { id: 'up', data: { images: ['/view?filename=stale.png'] } }
    const src = frames()
    registerStudioFrameSource('up', src)
    const got = resolveSourceKind('s1', [shader, up], edgeInto('up'))
    expect(got).toEqual({ kind: 'live', source: src })
  })

  it('falls back to the artifact url when the upstream has no frame source', () => {
    const up = { id: 'up', data: { images: ['/view?filename=x.png'] } }
    const got = resolveSourceKind('s1', [shader, up], edgeInto('up'))
    expect(got).toEqual({ kind: 'url', url: '/view?filename=x.png' })
  })

  // An unmounted / never-opened studio registers nothing. Resolution must fall
  // through rather than fail — same tolerance runStudioCascade has for bakers.
  it('falls through when an upstream studio is unmounted and has no artifact', () => {
    const up = { id: 'up', type: 'space-type', data: {} }
    expect(resolveSourceKind('s1', [shader, up], edgeInto('up'))).toBeNull()
  })

  it('ignores a frame source registered under a node that is not wired in', () => {
    registerStudioFrameSource('other', frames())
    const up = { id: 'up', data: { images: ['/view?filename=x.png'] } }
    const got = resolveSourceKind('s1', [shader, up], edgeInto('up'))
    expect(got).toEqual({ kind: 'url', url: '/view?filename=x.png' })
    unregisterStudioFrameSource('other')
  })

  // Spec: "each Shader Studio node reads its DIRECT upstream only... the nearest
  // animated ancestor wins". In A -> B -> s1, s1 must see B, never A.
  it('reads only the direct upstream in a chain', () => {
    const a = frames({ duration: 99 }), b = frames({ duration: 2 })
    registerStudioFrameSource('A', a)
    registerStudioFrameSource('B', b)
    const nodes = [shader, { id: 'A', data: {} }, { id: 'B', data: {} }]
    const edges = [
      { source: 'A', target: 'B', targetHandle: 'input-0' },
      { source: 'B', target: 's1', targetHandle: 'input-0' },
    ]
    expect(resolveSourceKind('s1', nodes, edges)).toEqual({ kind: 'live', source: b })
    unregisterStudioFrameSource('A')
    unregisterStudioFrameSource('B')
  })

  // Only input-0 feeds the shader stack; the VARS input must never be mistaken
  // for an image source.
  it('ignores edges into handles other than input-0', () => {
    const src = frames()
    registerStudioFrameSource('up', src)
    const up = { id: 'up', data: {} }
    const edges = [{ source: 'up', target: 's1', targetHandle: 'input-1' }]
    expect(resolveSourceKind('s1', [shader, up], edges)).toBeNull()
  })
})

describe('makeLiveSource', () => {
  it('carries the upstream clock and dimensions through', () => {
    const r = makeLiveSource(frames({ duration: 3, fps: 60, width: 100, height: 50 }))
    expect(r.duration).toBe(3)
    expect(r.fps).toBe(60)
    expect(r.width).toBe(100)
    expect(r.height).toBe(50)
    expect(r.isLive).toBe(true)
  })

  it('delegates getFrame with the requested time and size', async () => {
    const calls: Array<[number, number, number]> = []
    const r = makeLiveSource(frames({
      getFrame: async (t, w, h) => { calls.push([t, w, h]); return {} as any },
    }))
    await r.getFrame(0.25, 640, 480)
    expect(calls).toEqual([[0.25, 640, 480]])
  })
})

describe('makeImageSource', () => {
  it('is a still with the image natural dimensions', () => {
    const r = makeImageSource({ naturalWidth: 1200, naturalHeight: 900 })
    expect(r.width).toBe(1200)
    expect(r.height).toBe(900)
    expect(r.duration).toBe(0)
    expect(r.isLive).toBe(false)
  })

  it('returns the same image regardless of requested time or size', async () => {
    const img = { naturalWidth: 10, naturalHeight: 10 }
    const r = makeImageSource(img)
    expect(await r.getFrame(0.9, 999, 999)).toBe(img)
  })
})

describe('exportClock', () => {
  it('uses the live upstream clock when the source is animated', () => {
    const r = makeLiveSource(frames({ duration: 6, fps: 24 }))
    expect(exportClock(r, 4, 30)).toEqual({ duration: 6, fps: 24 })
  })

  it('falls back to own settings for a still source', () => {
    const r = makeImageSource({ naturalWidth: 4, naturalHeight: 4 })
    expect(exportClock(r, 4, 30)).toEqual({ duration: 4, fps: 30 })
  })

  it('falls back to own settings with no source at all', () => {
    expect(exportClock(null, 2, 12)).toEqual({ duration: 2, fps: 12 })
  })

  // A live source with duration <= 0 is a still by the spec's rule, so the
  // consumer's own clock governs — NOT a zero-length export.
  it('falls back to own settings for a live source with zero duration', () => {
    const r = makeLiveSource(frames({ duration: 0, fps: 24 }))
    expect(exportClock(r, 5, 30)).toEqual({ duration: 5, fps: 30 })
  })
})

// The spec's rule: motion tracks "stretch to span the upstream duration, so a
// from->to ramp runs exactly once across the clip". applyMotion divides by
// cfg.motion.duration internally (motion.ts:72), so feeding it absolute seconds
// from a DIFFERENT clock silently runs tracks at the wrong rate — 1.5 loops for a
// 6s source against a 4s config. This helper is what prevents that.
describe('motionConfigFor', () => {
  const cfg = { motion: { duration: 4, fps: 30, tracks: [{ path: 'adjust.hue' }] }, resolution: 1536 }

  it('overrides motion.duration with the supplied clock', () => {
    expect(motionConfigFor(cfg, 6).motion.duration).toBe(6)
  })

  it('preserves every other motion field', () => {
    const out = motionConfigFor(cfg, 6)
    expect(out.motion.fps).toBe(30)
    expect(out.motion.tracks).toEqual([{ path: 'adjust.hue' }])
  })

  it('preserves non-motion config', () => {
    expect(motionConfigFor(cfg, 6).resolution).toBe(1536)
  })

  it('does not mutate the input config', () => {
    motionConfigFor(cfg, 99)
    expect(cfg.motion.duration).toBe(4)
  })

  it('is identity-equivalent when the clock already matches', () => {
    expect(motionConfigFor(cfg, 4).motion.duration).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/shaderstudio-resolve.unit.spec.ts`
Expected: FAIL — `Failed to resolve import "~/lib/shaderstudio/resolve"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/shaderstudio/resolve.ts`:

```ts
// frontend/app/lib/shaderstudio/resolve.ts
// Resolve a Shader Studio node's input to ONE uniform shape, so the node card and
// the modal share identical source semantics instead of each re-deriving them
// (these two surfaces have drifted before).
//
// Priority: live upstream studio → artifact file → the node's own config source.
// The artifact path is unchanged; it is now one branch rather than the only one.

import { resolveWiredInput } from '~/lib/shaderstudio/source'
import { getStudioFrameSource, type StudioFrameSource } from '~/lib/studio/frameSource'

/** A source normalized so callers never branch on where the pixels came from. */
export interface ResolvedSource {
  getFrame: (t01: number, w: number, h: number) => Promise<TexImageSource>
  width: number
  height: number
  /** Natural clock in seconds; 0 means still. */
  duration: number
  fps: number
  /** True when backed by a live upstream studio rather than a loaded file. */
  isLive: boolean
}

export type SourceKind =
  | { kind: 'live'; source: StudioFrameSource }
  | { kind: 'url'; url: string }

/**
 * Descriptor for whatever is wired into `nodeId`'s input-0, or null.
 *
 * Returns a descriptor rather than a ResolvedSource because the `url` case needs
 * to load an image (DOM), while this resolution logic must stay pure so it can be
 * unit-tested in a node environment.
 */
export function resolveSourceKind(nodeId: string, nodes: any[], edges: any[]): SourceKind | null {
  const edge = edges.find((e: any) => String(e.target) === String(nodeId) && e.targetHandle === 'input-0')
  if (edge) {
    // A live upstream studio wins: it renders at any size and any time, so it is
    // strictly better than that studio's last baked file.
    const live = getStudioFrameSource(String(edge.source))
    if (live) return { kind: 'live', source: live }
  }
  // No live source (unmounted studio, or a plain artifact node) — fall through to
  // the existing file resolution, which also handles LoadImage / Image artifacts.
  const url = resolveWiredInput(nodeId, nodes, edges)
  return url ? { kind: 'url', url } : null
}

export function makeLiveSource(src: StudioFrameSource): ResolvedSource {
  return {
    getFrame: (t01, w, h) => src.getFrame(t01, w, h),
    width: src.width,
    height: src.height,
    duration: src.duration,
    fps: src.fps,
    isLive: true,
  }
}

/** Wrap an already-loaded image as a zero-duration source. */
export function makeImageSource(img: { naturalWidth: number; naturalHeight: number }): ResolvedSource {
  return {
    getFrame: async () => img as unknown as TexImageSource,
    width: img.naturalWidth,
    height: img.naturalHeight,
    duration: 0,
    fps: 0,
    isLive: false,
  }
}

/**
 * Whoever supplies the frames owns the clock. An animated source overrides the
 * consumer's own motion settings; a still source leaves them in charge.
 */
export function exportClock(
  resolved: ResolvedSource | null,
  ownDuration: number,
  ownFps: number,
): { duration: number; fps: number } {
  // Same `duration > 0` rule as isAnimatedSource, applied to the resolved shape.
  if (resolved && resolved.duration > 0) {
    return { duration: resolved.duration, fps: resolved.fps }
  }
  return { duration: ownDuration, fps: ownFps }
}

/**
 * Return `cfg` with `motion.duration` replaced by the governing clock.
 *
 * `applyMotion` divides by `cfg.motion.duration` internally
 * (`frontend/app/lib/shaderstudio/motion.ts:72`). Feeding it absolute seconds
 * derived from a DIFFERENT clock — an upstream source's — would run every track
 * at the wrong rate: a 6s upstream against a 4s config completes 1.5 ramps
 * instead of the one the spec requires. Always route config through this before
 * calling applyMotion with an upstream-derived time.
 */
export function motionConfigFor<T extends { motion: { duration: number } }>(cfg: T, duration: number): T {
  return { ...cfg, motion: { ...cfg.motion, duration } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/shaderstudio-resolve.unit.spec.ts`
Expected: PASS — 19 passed

- [ ] **Step 5: Run the existing source tests to confirm no regression**

Run: `cd frontend && npx vitest run tests/unit/shaderstudio-source.unit.spec.ts`
Expected: PASS — 4 passed (unchanged)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/shaderstudio/resolve.ts frontend/tests/unit/shaderstudio-resolve.unit.spec.ts
git commit -m "feat(shader-studio): resolve input to a uniform ResolvedSource"
```

---

### Task 3: Gradient Studio frame-source adapter

**Files:**
- Create: `frontend/app/lib/gradientfx/frameSource.ts`
- Test: `frontend/tests/unit/gradientfx-frame-source.unit.spec.ts`
- Modify: `frontend/app/components/vue-canvas/GradientStudioNode.vue`

**Interfaces:**
- Consumes: `StudioFrameSource` from Task 1.
- Produces: `makeGradientFrameSource(deps: GradientFrameDeps): StudioFrameSource`, where
  `GradientFrameDeps = { getConfig: () => GradientConfig; render: (cfg: GradientConfig, w: number, h: number, time: number) => TexImageSource }`.

`render` is injected rather than imported so the adapter is testable without WebGL. The Vue component passes `gradientFx.render`.

**Why Gradient Studio first:** `gradientFx.render(cfg, width, height, time)` already returns an `HTMLCanvasElement` (`frontend/app/lib/gradientfx/renderer.ts:142`), so this adapter is a parameter reorder — the cheapest possible proof the registry seam works. It also has no modal-mount dependency, unlike Space Type (Task 4).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/gradientfx-frame-source.unit.spec.ts`:

```ts
// frontend/tests/unit/gradientfx-frame-source.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { makeGradientFrameSource } from '~/lib/gradientfx/frameSource'

const cfg = (over: any = {}) => ({
  motion: { tracks: [], duration: 6, fps: 30, size: 1080 },
  flow: { speed: 0 },
  canvas: { aspect: '16:9' },
  ...over,
})

describe('makeGradientFrameSource', () => {
  it('reports the config duration and fps as its clock when flow speed drives motion', () => {
    const src = makeGradientFrameSource({
      getConfig: () => cfg({ flow: { speed: 50 } }),
      render: () => ({} as any),
    })
    expect(src.duration).toBe(6)
    expect(src.fps).toBe(30)
  })

  it('reports duration 0 when there are no tracks and no flow speed', () => {
    const src = makeGradientFrameSource({ getConfig: () => cfg(), render: () => ({} as any) })
    expect(src.duration).toBe(0)
  })

  it('reports the config duration when motion tracks exist even with zero flow speed', () => {
    const src = makeGradientFrameSource({
      getConfig: () => cfg({ motion: { tracks: [{ path: 'flow.angle' }], duration: 3, fps: 25 } }),
      render: () => ({} as any),
    })
    expect(src.duration).toBe(3)
    expect(src.fps).toBe(25)
  })

  // The renderer takes ABSOLUTE seconds; the registry contract is NORMALIZED
  // 0..1. Getting this conversion wrong is the most likely silent bug, because
  // it still animates — just at the wrong rate.
  it('converts normalized t01 to absolute seconds for the renderer', async () => {
    const calls: number[] = []
    const src = makeGradientFrameSource({
      getConfig: () => cfg({ flow: { speed: 50 } }),
      render: (_c, _w, _h, time) => { calls.push(time); return {} as any },
    })
    await src.getFrame(0, 10, 10)
    await src.getFrame(0.5, 10, 10)
    await src.getFrame(1, 10, 10)
    expect(calls).toEqual([0, 3, 6])   // duration 6
  })

  it('passes the requested size straight through to the renderer', async () => {
    const sizes: Array<[number, number]> = []
    const src = makeGradientFrameSource({
      getConfig: () => cfg(),
      render: (_c, w, h) => { sizes.push([w, h]); return {} as any },
    })
    await src.getFrame(0, 640, 360)
    expect(sizes).toEqual([[640, 360]])
  })

  it('reads config lazily so later edits are picked up', async () => {
    let speed = 0
    const src = makeGradientFrameSource({
      getConfig: () => cfg({ flow: { speed } }),
      render: () => ({} as any),
    })
    expect(src.duration).toBe(0)
    speed = 70
    expect(src.duration).toBe(6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-frame-source.unit.spec.ts`
Expected: FAIL — `Failed to resolve import "~/lib/gradientfx/frameSource"`

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/gradientfx/frameSource.ts`:

```ts
// frontend/app/lib/gradientfx/frameSource.ts
// Adapt Gradient Studio's renderer to the cross-studio StudioFrameSource contract.
// gradientFx.render(cfg, w, h, time) already returns a canvas, so this is mostly a
// parameter reorder plus the normalized-time conversion.
//
// `render` is injected so this stays unit-testable with no WebGL context.

import type { StudioFrameSource } from '~/lib/studio/frameSource'
import { aspectRatio } from '~/lib/gradientfx/types'

export interface GradientFrameDeps {
  getConfig: () => any
  render: (cfg: any, w: number, h: number, time: number) => TexImageSource
}

/**
 * Gradient Studio animates two independent ways, and either one makes it a real
 * clock: motion tracks, and flow.speed (a domain-warp churn that loops seamlessly
 * over motion.duration — see renderer.ts:234-245). With neither, it is a still and
 * reports duration 0 per the registry's `duration <= 0` rule.
 */
export function makeGradientFrameSource(deps: GradientFrameDeps): StudioFrameSource {
  const clock = () => {
    const cfg = deps.getConfig()
    const m = cfg?.motion ?? {}
    const hasTracks = (m.tracks?.length ?? 0) > 0
    const hasFlow = (cfg?.flow?.speed ?? 0) > 0
    if (!hasTracks && !hasFlow) return { duration: 0, fps: m.fps ?? 30 }
    return { duration: m.duration ?? 4, fps: m.fps ?? 30 }
  }

  return {
    // Getters, not captured values: the studio's config is edited live, so a
    // snapshot taken at registration time would go stale immediately.
    get duration() { return clock().duration },
    get fps() { return clock().fps },
    get width() { return deps.getConfig()?.motion?.size ?? 1080 },
    // aspectRatio() takes a string and calls .split on it — cfg.canvas may be
    // partial/absent on a fresh or migrating config, so guard the argument
    // (not just the result) before it ever reaches that call. Deriving height
    // from motion.size alone would force a square and squash a 16:9 gradient;
    // this mirrors GradientStudioNode.vue's own preview (:34) and bake (:80).
    get height() {
      const size = deps.getConfig()?.motion?.size ?? 1080
      const ar = aspectRatio(deps.getConfig()?.canvas?.aspect ?? '1:1') || 1
      return Math.max(1, Math.round(size / ar))
    },
    getFrame: async (t01, w, h) => {
      const cfg = deps.getConfig()
      // The registry speaks normalized 0..1; the renderer takes absolute seconds.
      const { duration } = clock()
      return deps.render(cfg, w, h, t01 * (duration || 0))
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-frame-source.unit.spec.ts`
Expected: PASS — 6 passed

- [ ] **Step 5: Register the source from the Gradient Studio node**

In `frontend/app/components/vue-canvas/GradientStudioNode.vue`, add to the existing imports:

```ts
import { registerStudioFrameSource, unregisterStudioFrameSource } from '~/lib/studio/frameSource'
import { makeGradientFrameSource } from '~/lib/gradientfx/frameSource'
import { gradientFx } from '~/lib/gradientfx/renderer'
```

Then register alongside the existing `registerStudioBaker` call in `onMounted`, and unregister in `onBeforeUnmount`. Find the existing `registerStudioBaker(props.id, ...)` line and add immediately after it:

```ts
  registerStudioFrameSource(props.id, makeGradientFrameSource({
    getConfig: () => config.value,
    render: (cfg, w, h, time) => gradientFx.render(cfg, w, h, time),
  }))
```

And in the existing `onBeforeUnmount`, alongside `unregisterStudioBaker(props.id)`:

```ts
  unregisterStudioFrameSource(props.id)
```

If the local reactive config ref is not named `config`, use whatever the file already calls it — do not rename anything.

- [ ] **Step 6: Verify the app still compiles**

Run: `cd frontend && npx nuxi typecheck 2>&1 | tail -20`
Expected: No NEW errors mentioning `GradientStudioNode.vue`, `frameSource.ts`, or `resolve.ts`. This repo has a pre-existing error baseline of roughly 328 — compare against `git stash list`-free baseline by checking that no error line references the files you touched.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/gradientfx/frameSource.ts \
        frontend/tests/unit/gradientfx-frame-source.unit.spec.ts \
        frontend/app/components/vue-canvas/GradientStudioNode.vue
git commit -m "feat(gradient-studio): publish a live frame source"
```

---

### Task 4: Space Type frame-source adapter

**Files:**
- Create: `frontend/app/lib/spacetype/frameSource.ts`
- Modify: `frontend/app/components/vue-canvas/SpaceTypeNode.vue`

**Interfaces:**
- Consumes: `StudioFrameSource` from Task 1.
- Produces: `makeSpaceTypeFrameSource(deps: SpaceTypeFrameDeps): StudioFrameSource`, where
  `SpaceTypeFrameDeps = { getClock: () => { duration: number; fps: number; width: number; height: number }; renderAt: (t01: number, w: number, h: number) => TexImageSource | null }`.

Space Type's engine draws into a *bound* canvas rather than returning one, so unlike Gradient its adapter must render and then hand back the engine's canvas. `renderAt` returning `null` (engine not ready) is handled by the consumer skipping that frame.

- [ ] **Step 1: Write the implementation**

There is no pure unit test for this task: the meaningful behaviour is "the engine's canvas comes back after rendering," which needs a live `SpaceTypeEngine` and therefore a DOM. The normalized-time and clock logic it shares with Gradient is already covered by Task 3. Verification here is manual, in Step 3.

Create `frontend/app/lib/spacetype/frameSource.ts`:

```ts
// frontend/app/lib/spacetype/frameSource.ts
// Adapt Space Type's engine to the cross-studio StudioFrameSource contract.
//
// Unlike Gradient Studio, SpaceTypeEngine.renderFrameAt(t01, params) draws into a
// canvas it already owns rather than returning one — so this renders first, then
// hands back that canvas.

import type { StudioFrameSource } from '~/lib/studio/frameSource'

export interface SpaceTypeFrameDeps {
  getClock: () => { duration: number; fps: number; width: number; height: number }
  /** Render into the engine's canvas and return it, or null if the engine is not ready. */
  renderAt: (t01: number, w: number, h: number) => TexImageSource | null
}

export function makeSpaceTypeFrameSource(deps: SpaceTypeFrameDeps): StudioFrameSource {
  return {
    get duration() { return deps.getClock().duration },
    get fps() { return deps.getClock().fps },
    get width() { return deps.getClock().width },
    get height() { return deps.getClock().height },
    getFrame: async (t01, w, h) => {
      const surface = deps.renderAt(t01, w, h)
      // A not-yet-mounted engine would otherwise surface as an opaque WebGL
      // "invalid texture source" error several frames later.
      if (!surface) throw new Error('space-type frame source: engine not ready')
      return surface
    },
  }
}
```

- [ ] **Step 2: Register the source from the Space Type node**

In `frontend/app/components/vue-canvas/SpaceTypeNode.vue`, add imports:

```ts
import { registerStudioFrameSource, unregisterStudioFrameSource } from '~/lib/studio/frameSource'
import { makeSpaceTypeFrameSource } from '~/lib/spacetype/frameSource'
```

`SpaceTypeNode.vue` registers its baker at line ~137 with the headless bake implemented at ~151-170. The node itself does not own a live `SpaceTypeEngine` — only `SpaceTypeSurface.vue` does (`SpaceTypeSurface.vue:686`). So register the frame source from **`SpaceTypeSurface.vue`**, where the engine exists, using the same `props.nodeId`:

In `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`, inside the existing `onMounted` after `engine = new SpaceTypeEngine(canvas.value, {...})` (line ~686):

```ts
  registerStudioFrameSource(props.nodeId, makeSpaceTypeFrameSource({
    getClock: () => ({
      duration: loopDuration.value,
      fps: fps.value,
      width: canvas.value?.width ?? 1080,
      height: canvas.value?.height ?? 1080,
    }),
    renderAt: (t01) => {
      if (!engine || !canvas.value) return null
      // The engine draws into the canvas it was constructed with; it returns
      // nothing, so hand that canvas back as the texture source.
      engine.renderFrameAt(t01, params)
      return canvas.value
    },
  }))
```

and in the existing `onBeforeUnmount`:

```ts
  unregisterStudioFrameSource(props.nodeId)
```

These identifiers are verified against the file: `engine` (`:229`), `params` (`:82`), `canvas` (the ref passed to the engine constructor, `:686`), `fps` and `loopDuration` (refs used by the preview loop at `:594`).

**Known limitation to accept, not fix here — multi-loop seaming.** Space Type's own preview computes `previewT01 = frame / base`, which runs `0..k` where `k = loopMultiplier(...)` (`:592-597`). That extra range exists so effects with fractional spin/wave rates seam at the wrap. The `StudioFrameSource` contract is normalized `0..1` — a single loop — so a chained Shader Studio gets one loop and does not benefit from the `k`-loop seam handling. For effects with integral rates this is identical; for fractional rates a chained export may show a seam that Space Type's own export would not. Record it, ship it, revisit if it shows up in practice.

**Second known limitation.** Because the engine lives in the modal, a Space Type node whose modal has never been opened publishes no frame source, and a downstream Shader Studio falls through to the artifact path. That is the designed fallback (spec: "Unmounted upstream studios"). Gradient Studio does not have this limitation, which is why Task 3 comes first and is the primary proof of the seam.

**Known limitation to accept, not fix here:** because the engine lives in the modal, a Space Type node whose modal has never been opened publishes no frame source, and a downstream Shader Studio falls through to the artifact path. That is the designed fallback (spec: "Unmounted upstream studios"). Gradient Studio does not have this limitation, which is why Task 3 comes first.

- [ ] **Step 3: Verify manually in the app**

Start the dev server via the preview tooling (`.claude/launch.json` → `frontend-harness`), then:
1. Add a Space Type node, open its modal, confirm the preview animates as before.
2. Close the modal. Confirm no console errors.
3. Confirm Space Type's own image and video exports still work from the modal.

Expected: identical behaviour to before this task — this task only *publishes* a source; nothing consumes it until Task 5.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/lib/spacetype/frameSource.ts \
        frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(spacetype): publish a live frame source from the studio surface"
```

---

### Task 5: Shader Studio node card consumes ResolvedSource

**Files:**
- Modify: `frontend/app/components/vue-canvas/ShaderStudioNode.vue:32-108`

**Interfaces:**
- Consumes: `resolveSourceKind`, `makeLiveSource`, `makeImageSource`, `ResolvedSource` from Task 2; `loadImage` from `~/lib/shaderstudio/source` (unchanged).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Replace the source state and resolution**

In `ShaderStudioNode.vue`, replace the `baseImage` ref (line 32) and the `wiredUrl`/`sourceUrl`/`watch` block (lines 34-43) with:

```ts
const resolved = ref<ResolvedSource | null>(null)

// Descriptor first (pure), then load if it is a file. Recomputes when the graph
// changes, so rewiring the input updates the card without a manual refresh.
const sourceKind = computed(() =>
  resolveSourceKind(props.id, injectedNodes?.value ?? [], injectedEdges?.value ?? []))

const ownSourceUrl = computed(() => config.value.source.dataUrl
  ?? (config.value.source.asset
    ? `/view?${new URLSearchParams({ filename: config.value.source.asset, type: 'input' })}`
    : null))

watch([sourceKind, ownSourceUrl], async ([kind, ownUrl]) => {
  resolved.value = null
  if (kind?.kind === 'live') { resolved.value = makeLiveSource(kind.source); startLoop(); return }
  const url = kind?.kind === 'url' ? kind.url : ownUrl
  if (!url) { renderFrame(0); return }
  try {
    resolved.value = makeImageSource(await loadImage(url))
    startLoop()
  } catch { resolved.value = null }
}, { immediate: true })
```

Add to the imports at the top of the `<script setup>` block:

```ts
import { makeImageSource, makeLiveSource, motionConfigFor, resolveSourceKind, type ResolvedSource } from '~/lib/shaderstudio/resolve'
```

and remove the now-unused `resolveWiredInput` import if nothing else in the file uses it. Keep the `loadImage` import — the file path still needs it.

- [ ] **Step 2: Make renderFrame async and source-driven**

Replace `renderFrame` (lines 49-62) with:

```ts
async function renderFrame(t01: number) {
  const el = canvasEl.value
  if (!el) return
  const src = resolved.value
  if (!src) {
    el.width = PREVIEW_W; el.height = Math.round(PREVIEW_W * 9 / 16)
    el.getContext('2d')!.clearRect(0, 0, el.width, el.height)
    return
  }
  const { w, h } = outputDims(src.width, src.height, PREVIEW_W)
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
  try {
    const base = await src.getFrame(t01, w, h)
    // The clock is normalized, but motion tracks and u_time are in seconds.
    const dur = clockDuration()
    const t = t01 * dur
    // motionConfigFor is REQUIRED, not cosmetic: applyMotion divides by
    // cfg.motion.duration, so passing upstream-derived seconds against our own
    // (different) duration would run every track at the wrong rate.
    const cfg = animated.value ? applyMotion(motionConfigFor(config.value, dur), t) : config.value
    // REBASE (2026-07-19): Shader Studio moved from a single `config.effect` to
    // an `effects[]` stack, and composePasses' 2nd arg is now a RESOLVER function
    // `(id) => EffectDef | null`, not a resolved def. Pass `effectDef` (the fn)
    // directly and never reference `cfg.effect.id`. This line is unchanged from
    // the current committed file — do not "fix" it back to the old shape.
    const passes = composePasses(cfg, effectDef, t)
    el.getContext('2d')!.drawImage(shaderFx.render(passes, base, w, h), 0, 0)
    glError.value = null
  } catch (e: any) { glError.value = String(e?.message ?? e) }
}
```

- [ ] **Step 3: Drive the loop from the source clock, with overlap protection**

Replace the loop block (lines 64-75) with:

```ts
/** Seconds per loop — the upstream source's clock when it has one, else our own. */
function clockDuration(): number {
  const src = resolved.value
  if (src && src.duration > 0) return src.duration
  return Math.max(0.1, config.value.motion?.duration ?? 4)
}

/** Animate when EITHER our own tracks run or the source itself moves. */
const sourceAnimated = computed(() => (resolved.value?.duration ?? 0) > 0)
const shouldLoop = computed(() => animated.value || sourceAnimated.value)

let raf = 0, start = 0, inFlight = false
function loop(ts: number) {
  if (!start) start = ts
  // getFrame is async; skip a tick rather than queueing, so a slow upstream
  // degrades to a lower frame rate instead of unbounded lag.
  if (!inFlight) {
    inFlight = true
    const dur = clockDuration()
    void renderFrame((((ts - start) / 1000) % dur) / dur).finally(() => { inFlight = false })
  }
  raf = requestAnimationFrame(loop)
}
function startLoop() {
  cancelAnimationFrame(raf); start = 0; inFlight = false
  if (shouldLoop.value) raf = requestAnimationFrame(loop)
  else void renderFrame(0)
}
```

Change the existing `watch(animated, startLoop)` (line 108) to:

```ts
watch(shouldLoop, startLoop)
```

- [ ] **Step 4: Update the headless bake to use the resolved source**

Replace `bakeOutput` (lines 80-97) with:

```ts
async function bakeOutput(): Promise<Blob | null> {
  let src = resolved.value
  // Re-resolve so a cascade picks up an upstream studio's just-published output;
  // fall back to the already-resolved source so the bake never no-ops.
  const kind = sourceKind.value
  if (kind?.kind === 'live') src = makeLiveSource(kind.source)
  else {
    const url = kind?.kind === 'url' ? kind.url : ownSourceUrl.value
    if (url) { try { src = makeImageSource(await loadImage(url)) } catch { /* keep previous */ } }
  }
  if (!src) { console.warn('[shader-studio] bake: no input for', props.id); return null }
  cancelAnimationFrame(raf)   // pause preview so it can't overwrite the shared output canvas
  try {
    const { w, h } = outputDims(src.width, src.height, config.value.resolution || 1536, { upscale: true })
    const base = await src.getFrame(0, w, h)
    // REBASE (2026-07-19): resolver-fn form, effects[] stack — see the renderFrame note.
    const out = shaderFx.render(composePasses(config.value, effectDef, 0), base, w, h)
    return await new Promise<Blob | null>(res => out.toBlob(b => res(b), 'image/png'))
  } finally {
    startLoop()
  }
}
```

Note the `0.95` quality argument is dropped — it is silently ignored for `image/png` (spec, "bugs found in passing").

- [ ] **Step 5: Verify manually in the app**

Start the dev server, then check in order — each must pass before moving on:

1. **Regression:** an Image artifact → Shader Studio still previews correctly on the card.
2. **Regression:** a Shader Studio with its own uploaded image still previews.
3. **Regression:** a Shader Studio with motion tracks still animates on the card.
4. **New:** Gradient Studio (with `flow.speed` above 0) → Shader Studio, wired directly. The card preview shows the gradient with shader effects applied, animating.
5. **New:** set Gradient Studio's flow speed to 0 and remove its tracks — the Shader Studio card shows a static shaded gradient and stops looping.
6. Console shows no repeated errors during any of the above.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/ShaderStudioNode.vue
git commit -m "feat(shader-studio): pull frames from a live upstream studio on the node card"
```

---

### Task 6: Shader Studio modal preview and export clock

**Files:**
- Modify: `frontend/app/components/vue-canvas/ShaderStudioSurface.vue:232-266,372-379,429-451`

**Interfaces:**
- Consumes: `resolveSourceKind`, `makeLiveSource`, `makeImageSource`, `exportClock`, `ResolvedSource` from Task 2.
- Produces: nothing consumed by later tasks.

The modal already receives `nodes` and `edges` as props (`ShaderStudioSurface.vue:38`), so it resolves its own source rather than relying on the pre-resolved `wiredUrl`. Leave the `wiredUrl` prop in place — `VueNodeCanvas.vue` still passes it and other call sites may rely on it — but stop using it for resolution.

- [ ] **Step 1: Replace source state and resolution**

Replace the `sourceUrl` computed and its watcher (lines 260-266) with:

```ts
const sourceKind = computed(() =>
  resolveSourceKind(props.nodeId, props.nodes ?? [], props.edges ?? []))

const ownSourceUrl = computed(() => config.value.source.dataUrl
  ?? (config.value.source.asset
    ? `/view?${new URLSearchParams({ filename: config.value.source.asset, type: 'input' })}`
    : null))

watch([sourceKind, ownSourceUrl], async ([kind, ownUrl]) => {
  resolved.value = null
  if (kind?.kind === 'live') { resolved.value = makeLiveSource(kind.source); startPreview(); return }
  const url = kind?.kind === 'url' ? kind.url : ownUrl
  if (!url) return
  try { resolved.value = makeImageSource(await loadImage(url)); startPreview() }
  catch { glError.value = 'Could not load source image' }
}, { immediate: true })
```

Replace the `baseImage` ref declaration with `const resolved = ref<ResolvedSource | null>(null)`, and add imports:

```ts
import { exportClock, makeImageSource, makeLiveSource, motionConfigFor, resolveSourceKind, type ResolvedSource } from '~/lib/shaderstudio/resolve'
```

- [ ] **Step 2: Make the preview async and source-driven**

Replace `renderFrame` and the loop (lines 233-257) with:

```ts
const animated = computed(() => (config.value.motion?.tracks?.length ?? 0) > 0)
const sourceAnimated = computed(() => (resolved.value?.duration ?? 0) > 0)
const shouldLoop = computed(() => animated.value || sourceAnimated.value)

function clockDuration(): number {
  const src = resolved.value
  if (src && src.duration > 0) return src.duration
  return Math.max(0.1, config.value.motion.duration)
}

async function renderFrame(t01: number) {
  const el = canvas.value
  if (!el) return
  const src = resolved.value
  if (!src) return
  const { w, h } = outputDims(src.width, src.height, PREVIEW_MAX_W)
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
  try {
    const base = await src.getFrame(t01, w, h)
    const dur = clockDuration()
    const t = t01 * dur
    // See Task 5: applyMotion divides by cfg.motion.duration, so the config must
    // carry the governing clock or tracks run at the wrong rate.
    const cfg = animated.value ? applyMotion(motionConfigFor(config.value, dur), t) : config.value
    // REBASE (2026-07-19): effects[] stack — 2nd arg is a resolver fn, 4th is a
    // per-layer texFor. Match the current committed call exactly; only `cfg` and
    // `t` change here relative to the pre-frame-chaining file.
    const passes = composePasses(cfg, id => catalog.value?.effects.find(e => e.id === id) ?? null, t, (def, layer) => texBundle(def, layer))
    el.getContext('2d')!.drawImage(shaderFx.render(passes, base, w, h), 0, 0)
    glError.value = null
  } catch (e: any) { glError.value = String(e?.message ?? e) }
}

let raf = 0, start = 0, inFlight = false
function loop(ts: number) {
  if (!start) start = ts
  if (!inFlight) {
    inFlight = true
    const dur = clockDuration()
    void renderFrame((((ts - start) / 1000) % dur) / dur).finally(() => { inFlight = false })
  }
  raf = requestAnimationFrame(loop)
}
function startPreview() {
  cancelAnimationFrame(raf); start = 0; inFlight = false
  if (shouldLoop.value) raf = requestAnimationFrame(loop)
  else void renderFrame(0)
}
function stopPreview() { cancelAnimationFrame(raf); raf = 0; inFlight = false }
watch(config, () => { if (!shouldLoop.value) void renderFrame(0) }, { deep: true })
watch(shouldLoop, startPreview)
```

- [ ] **Step 3: Make renderBlob source-driven**

Replace `renderBlob` (lines 372-379) with:

```ts
async function renderBlob(t01: number): Promise<Blob> {
  const src = resolved.value!
  const { w, h } = outputDims(src.width, src.height, config.value.resolution, { upscale: true })
  const dur = clockDuration()
  const t = t01 * dur
  const cfg = animated.value ? applyMotion(motionConfigFor(config.value, dur), t) : config.value
  const base = await src.getFrame(t01, w, h)
  shaderFx.render(composePasses(cfg, id => catalog.value?.effects.find(e => e.id === id) ?? null, t, (def, layer) => texBundle(def, layer)), base, w, h)
  const c = shaderFx.outputCanvas!
  return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))
}
```

`renderBlob` now takes **normalized** time. Its other caller, `renderBlobWithOverrides` (line 394), already passes `0`, which is correct in both schemes and needs no change.

- [ ] **Step 4: Read the export clock from the source**

In `generateImage` (line 412) and `generateVideo` (line 429), change the guard `if (!baseImage.value)` to `if (!resolved.value)`.

Then in `generateVideo`, replace the sizing and frame-count block (lines 433-440) with:

```ts
    const src = resolved.value!
    const clock = exportClock(src, config.value.motion.duration, config.value.motion.fps)
    const { w, h } = outputDims(src.width, src.height, config.value.resolution, { upscale: true })
    const total = Math.max(1, Math.round(clock.fps * clock.duration))
    const bakeCfg = { fps: clock.fps, loopDuration: clock.duration, W: w, H: h, seed: 'shader', sig: JSON.stringify(config.value) }
    const bake = await ensureSpaceTypeBake(bakeCfg as any, undefined, {
      renderFrame: async (i) => { bakeMsg.value = `Baking ${i + 1}/${total}`; return await renderBlob(i / total) },
    })
```

Note `renderBlob(i / total)` — normalized, so the last frame lands just before the loop point rather than duplicating frame 0. This is what keeps a `flow.speed` gradient seamless.

Then update the encode call on line 442 to use `clock.fps` instead of `m.fps`, and delete the now-unused `const m = config.value.motion` on line 434.

- [ ] **Step 5: Show the derived clock in the UI**

Where the modal renders the motion duration/fps controls, disable them and show the source clock when `sourceAnimated.value` is true. Add near the existing `outputSizeLabel` computed (line 457):

```ts
const clockLabel = computed(() => {
  const src = resolved.value
  if (!src || src.duration <= 0) return null
  const frames = Math.max(1, Math.round(src.fps * src.duration))
  return `${src.duration.toFixed(1)}s · ${frames} frames — from upstream`
})
```

Render `clockLabel` beside the motion controls, and bind `:disabled="sourceAnimated"` on the duration and fps inputs. Match the existing markup patterns in the file for label and disabled styling rather than introducing new classes.

- [ ] **Step 6: Verify manually in the app**

1. **Regression:** open Shader Studio on an Image artifact — preview renders, Generate Image produces a correct still.
2. **Regression:** Shader Studio with its own motion tracks and a still image — preview animates, Generate Video produces a clip of the configured duration.
3. **New:** Gradient Studio (`flow.speed` > 0, duration 6s) → Shader Studio. Open the modal: preview animates, duration/fps controls are disabled, and the label reads `6.0s · 180 frames — from upstream`.
4. **New:** Generate Video from that chained node. The resulting MP4 is ~6s, not Shader Studio's own 4s default.
5. **New — the seam test:** play the exported clip on a loop. The wrap from last frame to first must be seamless. A visible jump means the normalized-time conversion is off by one frame.
6. **New:** Generate Image from the chained node produces a single correct shaded frame.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/ShaderStudioSurface.vue
git commit -m "feat(shader-studio): drive modal preview and export from the source clock"
```

---

### Task 7: Let the cascade publish into studio nodes

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue:3692-3701`

**Interfaces:**
- Consumes: `isStudioNode` from `~/lib/studio/cascade` (already exported, `cascade.ts:64`).
- Produces: nothing consumed by later tasks.

**Why:** `planStudioCascade` already collects a directly-wired Shader Studio into `studioOrder` (`cascade.ts:106`). But `publishStudioOutput` filters its targets to `nodeType === 'Image' || type.startsWith('artifact-')` (`:3696`), so a studio target does not match, `targets` is empty, and the fallback at `:3699` spawns a stray Image node — undoing the direct wire the user drew.

- [ ] **Step 1: Widen the target filter**

Add `isStudioNode` and `isArtifactNode` to the existing `~/lib/studio/cascade` import in `VueNodeCanvas.vue`, then replace the filter on line 3696:

```ts
    .filter((n): n is any => !!n && (
      n.data?.nodeType === 'Image' || String(n.type).startsWith('artifact-') || isStudioNode(n)
    ))
```

- [ ] **Step 2: Skip the file stamp for studio targets**

A studio node has no `images` array or `image` widget to stamp — it re-resolves its own input reactively from the graph. Writing `data.images` onto it would be meaningless at best. Replace the stamping loop (lines 3702-3708) with:

```ts
  for (const art of targets) {
    // A downstream studio re-resolves its own input from the graph (live frame
    // source, or this artifact's file) — there is nothing to stamp on it, and it
    // must still count as a target so the fallback does not spawn a stray node.
    // NOT artifact-frame: isStudioNode is also true for Frames (they bake
    // client-side), but a Frame is data.images-driven and DOES need the stamp.
    if (isStudioNode(art) && !isArtifactNode(art)) continue
    if (!art.data) art.data = {}
    art.data.images = [url]
    // Also stamp the `image` widget so a card with an upstream link still shows the new file.
    const wi = art.data.widgetDefs?.findIndex((w: any) => w.name === 'image') ?? -1
    if (wi >= 0) { if (!Array.isArray(art.data.widgetsValues)) art.data.widgetsValues = []; art.data.widgetsValues[wi] = filename }
  }
```

- [ ] **Step 3: Verify manually in the app**

1. **Regression — the highest-risk check:** Space Type → (no downstream node). Press Render on it. Confirm it still creates a new Image artifact node wired to its output, exactly as before.
2. **Regression:** Space Type → existing Image artifact. Press Render. The existing artifact updates in place; no second artifact appears.
3. **New:** Gradient Studio → Shader Studio, wired directly. Press Render on the Gradient Studio. Confirm **no stray Image node is created**, and the Shader Studio card reflects the gradient.
4. **Regression:** Gradient Studio → Image artifact → Shader Studio (the 3-node chain). Press Render on the Gradient Studio. Both downstream nodes update; no stray node.

- [ ] **Step 4: Run the full unit suite**

Run: `cd frontend && npm run test:unit`
Expected: PASS. Compare the pass/fail count against the pre-change baseline — capture it first with `git stash`-free reasoning by running the suite on `main` before this task if unsure. No test that passed before may fail now.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "fix(studio-cascade): publish into directly-wired downstream studios"
```

---

### Task 8: Space Type node registers a live frame source (modal-independent)

**Added 2026-07-19 after the whole-feature review.** Space Type only registered its
frame source from the modal surface (Task 4), so a direct Space Type → Shader wire went
blank whenever the Space Type editor was closed — its live source vanished and the direct
wire has no artifact to fall back to. This task lets the always-mounted **node** publish a
live frame source.

**Key fact discovered in review:** `SpaceTypeNode.vue` already owns a live `SpaceTypeEngine`
(`:58,:130`) driving the card preview, plus a headless `bakeOutput` (`:151`). So the node is
NOT engine-less. But the frame source must NOT reuse the card's preview engine: the card's
own rAF loop and a downstream consumer's pulls would both drive one canvas at different
frames, ghosting the card. The frame source gets its **own** engine, created **lazily** on
first pull so the extra WebGL context only exists for Space Type nodes actually feeding a
live consumer.

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeNode.vue`

**Interfaces:**
- Consumes: `registerStudioFrameSource` / `unregisterStudioFrameSource` (`~/lib/studio/frameSource`), `makeSpaceTypeFrameSource` (`~/lib/spacetype/frameSource`, from Task 4), `SpaceTypeEngine`, `getEffect`, `dimsFromKey`, `texOptsFromState`, `ensureSpaceTypeFont` (all already imported or trivially importable in this file).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add a lazily-created headless engine + a state-change flag**

Near the existing `let engine` declaration, add a second, independent engine handle and its
offscreen canvas, plus a dirty flag so the headless engine only rebuilds geometry when the
config actually changed (not every pulled frame):

```ts
// A SECOND engine, separate from the card-preview `engine`, dedicated to the
// cross-studio frame source. Lazily created on first pull (ensureHeadless), so a
// Space Type node with no live downstream consumer never pays the extra WebGL
// context. Its own offscreen canvas — never the card's — so the two never fight.
let headlessEngine: SpaceTypeEngine | null = null
let headlessCanvas: HTMLCanvasElement | null = null
let headlessDirty = true   // config changed since the last headless build

function ensureHeadless(): SpaceTypeEngine | null {
  if (!detectWebGL()) return null
  if (!headlessEngine) {
    headlessCanvas = document.createElement('canvas')
    const s = state.value
    headlessEngine = new SpaceTypeEngine(headlessCanvas, {
      effect: getEffect(s.effectId), width: PREVIEW_W, height: previewH.value,
      fps: s.fps, loopDuration: s.loopDuration, alpha: s.transparent, bgColor: s.bgColor,
      projection: s.projection ?? 'perspective',
    })
    headlessDirty = true
  }
  if (headlessDirty) {
    const s = state.value
    headlessEngine.setBackground(s.transparent, s.bgColor)
    headlessEngine.setProjection(s.projection ?? 'perspective')
    headlessEngine.setPost({ ...(s.post ?? DEFAULT_POST) })
    headlessEngine.setPan(s.panX ?? 0, s.panY ?? 0)
    headlessEngine.setFps(s.fps)
    headlessEngine.setLoopDuration(s.loopDuration)
    headlessEngine.setEffect(getEffect(s.effectId))
    headlessEngine.build(s.params, texOptsFromState(s))
    headlessDirty = false
  }
  return headlessEngine
}
```

- [ ] **Step 2: Register the frame source in `onMounted`, alongside `registerStudioBaker`**

Reuse the Task 4 adapter. `renderAt` honors the requested `w`/`h` (unlike the modal path),
so a chained Space Type exports at full resolution:

```ts
  registerStudioFrameSource(props.id, makeSpaceTypeFrameSource({
    getClock: () => {
      const s = state.value
      const [cw, ch] = dimsFromKey(s.dimsKey)
      return { duration: s.loopDuration, fps: s.fps, width: cw, height: ch }
    },
    renderAt: (t01, w, h) => {
      const eng = ensureHeadless()
      if (!eng || !headlessCanvas) return null
      const s = state.value
      eng.setSize(w, h)
      const total = Math.max(1, Math.round(s.fps * s.loopDuration))
      const frame = ((Math.round(t01 * total) % total) + total) % total
      eng.renderFrame(frame, s.params)
      return headlessCanvas
    },
  }))
```

Add the imports at the top of `<script setup>`:

```ts
import { registerStudioFrameSource, unregisterStudioFrameSource } from '~/lib/studio/frameSource'
import { makeSpaceTypeFrameSource } from '~/lib/spacetype/frameSource'
```

- [ ] **Step 3: Mark the headless engine dirty when the config changes**

In the existing deep `watch(state, ...)` debounced handler (the one that rebuilds the card
preview), also flip the flag so the next pull rebuilds the headless engine:

```ts
    headlessDirty = true
```

Do NOT rebuild the headless engine eagerly here — it may not exist yet (no consumer), and a
config burst shouldn't rebuild an offscreen engine per keystroke. The flag defers the rebuild
to the next actual `renderAt`.

- [ ] **Step 4: Dispose the headless engine in `onBeforeUnmount`**

Alongside `unregisterStudioFrameSource(props.id)` and the existing `engine?.dispose()`:

```ts
  unregisterStudioFrameSource(props.id)
  headlessEngine?.dispose()
  headlessEngine = null
  headlessCanvas = null
```

- [ ] **Step 5: Compile-check**

Run: `curl -s "http://127.0.0.1:58689/_nuxt/@fs/Users/julien/Documents/GitHub/Sailor/frontend/app/components/vue-canvas/SpaceTypeNode.vue" -o /dev/null -w "%{http_code}\n"`
Expected: `200`.

- [ ] **Step 6: Verify manually in the app**

1. **The headline fix:** Space Type → Shader Studio, wired directly, **Space Type editor never opened**. The Shader card must render the Space Type output (animating). Before this task it showed "Connect or add an image".
2. **No card ghosting:** while the above is live, the Space Type card's OWN preview must animate smoothly — no doubled/jittering frames from the two engines fighting (they don't share a canvas, so this should be clean).
3. **Full-res export:** Generate Video from the chained Shader at 2048/4096 — the Space Type content must be sharp, not upscaled from preview size (renderAt honors w/h).
4. **No-consumer cost:** a lone Space Type node (nothing wired to it) must never create the headless engine — confirm via a `console.count` in `ensureHeadless` during dev, or reason from the code that `ensureHeadless` is only called from `renderAt`.
5. **Regression:** Space Type's own card preview, Edit modal, and Render-to-artifact all still work.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeNode.vue
git commit -m "feat(spacetype): register a modal-independent live frame source from the node"
```

Note: `SpaceTypeNode.vue` may carry a parallel session's uncommitted template migration —
if so, stage only the script hunks (hand-built patch + `git apply --cached`), as with the
other consumer tasks.

---

## Verification (whole feature)

After Task 7, run the full checklist from the spec's Testing section in one pass — regressions first, because they are the real risk:

- [ ] Space Type → Image artifact → Shader Studio (3-node chain) works unchanged.
- [ ] Shader Studio with an uploaded still works unchanged.
- [ ] Shader Studio's own motion tracks still animate and export.
- [ ] Space Type's and Gradient Studio's own bake/export paths are unaffected.
- [ ] Gradient Studio → Shader Studio direct wire: card and modal both animate.
- [ ] Export from a chained node matches the upstream duration, and loops seamlessly.
- [ ] **Track rate:** set the upstream Gradient Studio to 6s, add ONE Shader Studio motion
      track (e.g. `adjust.hue` from min to max, easing `pingpong`, loops 1) while Shader
      Studio's own `motion.duration` still reads 4s. Export and watch the hue: it must
      complete exactly one ramp across the clip. One-and-a-half ramps means
      `motionConfigFor` was skipped somewhere — the failure still animates, so only
      counting the ramp catches it.
- [ ] Gradient Studio with no tracks and zero flow speed → still image, no loop started.
- [ ] Space Type → Shader Studio direct wire, with the Space Type modal opened at least once, animates. Without ever opening it, it falls back to the artifact path rather than erroring.
- [ ] `cd frontend && npm run test:unit` — no new failures.

## Out of scope (do not implement here)

Per the spec's Non-goals, and the bugs it recorded but deliberately did not schedule:

- External video files as a frame source (the third producer, deferred).
- Streaming the bake / JPEG frame format — only matters past ~300 frames.
- Fixing `uploadFrameBatch`'s silent frame drops (`useKineticRenderer.ts:421`).
- `SpaceTypeNode.vue`'s raw `<Handle>` lacking port type metadata.
- Any shader UI inside another studio's modal.
