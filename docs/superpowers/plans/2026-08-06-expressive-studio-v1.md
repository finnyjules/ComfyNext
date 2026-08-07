# Expressive Studio v1 — the tile seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that photos and words can ride one Space Type arrangement, by adding a tile-native `ring` layout fed by a content list — without touching any existing effect.

**Architecture:** A new `ring` effect consumes a `content` param (JSON list of words + images) instead of the shared text. A pure `expandContent()` turns that list into an ordered tile sequence; the effect realizes each entry into an upright quad on a circle using existing `layoutChars` (words) and preloaded image textures (photos). Image textures are loaded async by the caller and handed to the sync build via a new `engine.setImageTextures()` + `BuildEnv.imageTextures`. All 25 existing effects are untouched.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, three.js, Vitest (happy-dom), the existing Space Type engine (`frontend/app/lib/spacetype/`).

## Global Constraints

- **Do not modify any existing effect** in `frontend/app/lib/spacetype/effects/` (all 25 must render unchanged). New code only.
- **`buildScene` must stay synchronous** — no `await` inside any build path (`engine.ts:224` — `withShaderFillContext` cannot survive an await). All async work (image loading) happens *before* build.
- **`shared/` never imports from `app/`** (`shared/spacetype/state.ts` header). Tile/three.js code lives in `app/`, never `shared/`.
- **Per-scene state on `root.userData`, never module vars** — concurrent engines (card preview + headless frame source) share effect modules (`effect.ts` `update()` doc).
- **`ParamValue` is scalar** (`number | string | boolean`) — the content list serializes as a JSON string param, exactly like `fillList`/`path`/`curve`.
- Test command: `cd frontend && npx vitest run tests/unit/<file>`.
- Commit after each task. Stage only the files this plan creates/edits (parallel sessions share this tree).

**Supersedes spec §"Document state":** the spec proposed a top-level `content: ContentItem[]` field on `SpaceTypeState`. Grounding shows `buildScene` only receives `params`, so v1 stores the list as a `content` **JSON-string param** instead. Behavior is identical; the storage location differs.

---

## File structure

- Create `frontend/app/lib/spacetype/tile.ts` — `ContentItem`, `ExpandedTile`, `expandContent()` (pure).
- Create `frontend/app/lib/spacetype/ringLayout.ts` — `ringTransform()` pure placement math.
- Create `frontend/app/lib/spacetype/effects/ring.ts` — the `ring` `SpaceTypeEffect`.
- Modify `frontend/app/lib/spacetype/effects/index.ts` — register `ringEffect`.
- Modify `frontend/app/lib/spacetype/effect.ts` — add `contentList` control kind; add `imageTextures` to `BuildEnv`.
- Modify `frontend/app/lib/spacetype/engine.ts` — `setImageTextures()`; pass through in `build`/`buildKeyed`.
- Modify `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — render the `contentList` editor; preload image textures.
- Modify `frontend/app/lib/spacetype/frameSource.ts` — preload image textures before headless build.
- Create tests under `frontend/tests/unit/`.

---

## Task 1: Tile types + `expandContent` (pure)

**Files:**
- Create: `frontend/app/lib/spacetype/tile.ts`
- Test: `frontend/tests/unit/spacetype-expand-content.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ContentItem = { id: string; kind: 'word'; text: string; resolution: 'whole' | 'letters' } | { id: string; kind: 'image'; src: string; aspect?: number }`
  - `type ExpandedTile = { kind: 'image'; sourceId: string; src: string; aspect: number } | { kind: 'word'; sourceId: string; text: string } | { kind: 'letter'; sourceId: string; text: string; letterIndex: number }`
  - `function expandContent(items: ContentItem[]): ExpandedTile[]`
  - `function parseContent(json: string): ContentItem[]` (safe parse → `[]` on any error)

**Behavior of `expandContent`:** preserve item order. An image → one `image` tile (`aspect` defaults to `1` when absent). A `whole` word → one `word` tile. A `letters` word → one `letter` tile per **non-space** character, in order, each carrying its zero-based index among that word's non-space characters (`letterIndex`). An empty/whitespace-only word contributes nothing.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-expand-content.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { expandContent, parseContent, type ContentItem } from '~/lib/spacetype/tile'

describe('expandContent', () => {
  it('image → one image tile, aspect defaults to 1', () => {
    const out = expandContent([{ id: 'a', kind: 'image', src: 'data:x' }])
    expect(out).toEqual([{ kind: 'image', sourceId: 'a', src: 'data:x', aspect: 1 }])
  })

  it('whole word → one word tile', () => {
    const out = expandContent([{ id: 'w', kind: 'word', text: 'NATURAL', resolution: 'whole' }])
    expect(out).toEqual([{ kind: 'word', sourceId: 'w', text: 'NATURAL' }])
  })

  it('letters word → one letter tile per non-space char, indexed', () => {
    const out = expandContent([{ id: 'w', kind: 'word', text: 'FRESH', resolution: 'letters' }])
    expect(out).toHaveLength(5)
    expect(out.map(t => (t as any).letterIndex)).toEqual([0, 1, 2, 3, 4])
    expect(out.every(t => t.kind === 'letter' && t.sourceId === 'w' && t.text === 'FRESH')).toBe(true)
  })

  it('letters word skips spaces but keeps order', () => {
    const out = expandContent([{ id: 'w', kind: 'word', text: 'A B', resolution: 'letters' }])
    expect(out).toHaveLength(2)
    expect(out.map(t => (t as any).letterIndex)).toEqual([0, 1])
  })

  it('mixed list preserves order and total count', () => {
    const items: ContentItem[] = [
      { id: 'i1', kind: 'image', src: 'data:1', aspect: 1.5 },
      { id: 'w1', kind: 'word', text: 'HI', resolution: 'letters' },
      { id: 'i2', kind: 'image', src: 'data:2' },
    ]
    const out = expandContent(items)
    expect(out.map(t => t.kind)).toEqual(['image', 'letter', 'letter', 'image'])
    expect(out.map(t => t.sourceId)).toEqual(['i1', 'w1', 'w1', 'i2'])
  })

  it('empty / whitespace word contributes nothing', () => {
    expect(expandContent([{ id: 'e', kind: 'word', text: '   ', resolution: 'letters' }])).toEqual([])
    expect(expandContent([{ id: 'e', kind: 'word', text: '', resolution: 'whole' }])).toEqual([])
  })

  it('parseContent returns [] on garbage', () => {
    expect(parseContent('not json')).toEqual([])
    expect(parseContent('{}')).toEqual([])
    expect(parseContent('[{"id":"a","kind":"image","src":"x"}]')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-expand-content.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/spacetype/tile`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/app/lib/spacetype/tile.ts
/**
 * The atomic unit the Expressive/ring layout arranges. A tile is a glyph, a whole
 * word, or an image — the arrangement never learns which. `expandContent` is the
 * pure `content → tiles` seam; texture realization happens in the ring effect
 * (canvas-dependent, so it stays out of this pure module for unit-testability).
 */

export type ContentItem =
  | { id: string; kind: 'word'; text: string; resolution: 'whole' | 'letters' }
  | { id: string; kind: 'image'; src: string; aspect?: number }

export type ExpandedTile =
  | { kind: 'image'; sourceId: string; src: string; aspect: number }
  | { kind: 'word'; sourceId: string; text: string }
  | { kind: 'letter'; sourceId: string; text: string; letterIndex: number }

/** Ordered content list → ordered tile sequence. Pure; no canvas, no three.js. */
export function expandContent(items: ContentItem[]): ExpandedTile[] {
  const out: ExpandedTile[] = []
  for (const item of items) {
    if (item.kind === 'image') {
      out.push({ kind: 'image', sourceId: item.id, src: item.src, aspect: item.aspect ?? 1 })
      continue
    }
    const text = String(item.text ?? '')
    if (item.resolution === 'whole') {
      if (text.trim().length > 0) out.push({ kind: 'word', sourceId: item.id, text })
      continue
    }
    // letters: one tile per non-space character, indexed among non-space chars
    let idx = 0
    for (const ch of text) {
      if (ch.trim().length === 0) continue
      out.push({ kind: 'letter', sourceId: item.id, text, letterIndex: idx })
      idx++
    }
  }
  return out
}

/** Parse the `content` JSON param safely; any malformed value → empty list. */
export function parseContent(json: string): ContentItem[] {
  try {
    const v = JSON.parse(json)
    if (!Array.isArray(v)) return []
    return v.filter(x => x && typeof x === 'object' && (x.kind === 'word' || x.kind === 'image'))
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-expand-content.unit.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/tile.ts frontend/tests/unit/spacetype-expand-content.unit.spec.ts
git commit -m "feat(expressive): content→tiles seam — expandContent (pure)"
```

---

## Task 2: `ringTransform` placement math (pure)

**Files:**
- Create: `frontend/app/lib/spacetype/ringLayout.ts`
- Test: `frontend/tests/unit/spacetype-ring-layout.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (plain math; takes numbers, returns numbers).
- Produces:
  - `interface RingParams { radius: number; ringTilt: number; cardSize: number; speed: number; direction: 1 | -1 }`
  - `interface TileTransform { x: number; y: number; z: number; rotY: number; scale: number }`
  - `function ringTransform(i: number, n: number, p: RingParams, t01: number): TileTransform`

**Behavior:** place tile `i` of `n` evenly around a circle in the XZ plane (radius `p.radius`), facing radially outward (`rotY` points the quad's normal away from centre). The whole ring spins by `direction * 2π * t01` over the loop, so `t01 = 0` and `t01 = 1` produce identical transforms (seamless). `ringTilt` rotates the ring plane about X (returned as a constant the effect applies to the ring group; `ringTransform` bakes tilt into y/z). `scale = p.cardSize`. `n <= 0` is undefined behavior (callers guard).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-ring-layout.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { ringTransform, type RingParams } from '~/lib/spacetype/ringLayout'

const P: RingParams = { radius: 5, ringTilt: 0, cardSize: 1, speed: 1, direction: 1 }

describe('ringTransform', () => {
  it('places n tiles evenly around the circle', () => {
    const n = 4
    const angles = Array.from({ length: n }, (_, i) => {
      const t = ringTransform(i, n, P, 0)
      return Math.atan2(t.z, t.x)
    })
    // consecutive angular gaps are equal (2π/n), within fp tolerance
    const gap = (2 * Math.PI) / n
    for (let i = 1; i < n; i++) {
      let d = angles[i]! - angles[i - 1]!
      d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
      expect(Math.abs(d - gap)).toBeLessThan(1e-6)
    }
  })

  it('tiles sit on the radius', () => {
    const t = ringTransform(0, 6, P, 0)
    expect(Math.hypot(t.x, t.z)).toBeCloseTo(5, 6)
  })

  it('loop is seamless: t01=0 equals t01=1', () => {
    for (let i = 0; i < 5; i++) {
      const a = ringTransform(i, 5, P, 0)
      const b = ringTransform(i, 5, P, 1)
      expect(b.x).toBeCloseTo(a.x, 6)
      expect(b.z).toBeCloseTo(a.z, 6)
      expect(b.rotY).toBeCloseTo(a.rotY, 6)
    }
  })

  it('scale follows cardSize', () => {
    expect(ringTransform(0, 3, { ...P, cardSize: 2.5 }, 0).scale).toBeCloseTo(2.5, 6)
  })

  it('direction reverses spin', () => {
    const fwd = ringTransform(1, 4, { ...P, direction: 1 }, 0.25)
    const rev = ringTransform(1, 4, { ...P, direction: -1 }, 0.25)
    expect(Math.atan2(fwd.z, fwd.x)).not.toBeCloseTo(Math.atan2(rev.z, rev.x), 4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-ring-layout.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/spacetype/ringLayout`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/app/lib/spacetype/ringLayout.ts
/**
 * Pure placement math for the ring layout: tile i of n → a transform, at loop
 * time t01. The whole ring spins one whole turn per loop (× speed as integer
 * turns handled by the effect's loopRates), so t01=0 and t01=1 coincide — the
 * loop is seamless by construction. No three.js here; the effect applies these
 * numbers to meshes.
 */

export interface RingParams {
  radius: number
  ringTilt: number     // radians, ring-plane tilt about X (applied by the effect to the group)
  cardSize: number
  speed: number        // whole turns per loop (integer keeps the loop seamless)
  direction: 1 | -1
}

export interface TileTransform {
  x: number; y: number; z: number
  rotY: number         // radians; quad normal faces radially outward
  scale: number
}

export function ringTransform(i: number, n: number, p: RingParams, t01: number): TileTransform {
  const base = (2 * Math.PI * i) / Math.max(1, n)
  const spin = p.direction * 2 * Math.PI * Math.round(p.speed) * t01
  const ang = base + spin
  const x = Math.cos(ang) * p.radius
  const z = Math.sin(ang) * p.radius
  // face radially outward: a quad whose default normal is +Z is turned by -ang
  // (plus a quarter turn so its face, not its edge, points out).
  const rotY = -ang + Math.PI / 2
  return { x, y: 0, z, rotY, scale: p.cardSize }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-ring-layout.unit.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/ringLayout.ts frontend/tests/unit/spacetype-ring-layout.unit.spec.ts
git commit -m "feat(expressive): ring placement math (pure)"
```

---

## Task 3: Engine seam — `imageTextures` through `BuildEnv`

**Files:**
- Modify: `frontend/app/lib/spacetype/effect.ts` (add `contentList` control kind + `BuildEnv.imageTextures`)
- Modify: `frontend/app/lib/spacetype/engine.ts` (`setImageTextures` + pass through)
- Test: `frontend/tests/unit/spacetype-content-control.unit.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `ControlSpec` gains `| { key: string; label: string; kind: 'contentList'; default: string; group: string }` (a JSON-string param, non-agent, non-animatable by nature).
  - `BuildEnv` gains `imageTextures?: Map<string, import('three').Texture>`.
  - `SpaceTypeEngine.setImageTextures(map: Map<string, THREE.Texture>): void`.

**Details:**

In `effect.ts`, add the `contentList` variant to the `ControlSpec` union (beside `fillList`/`path`), with a doc line: *"An ordered content list (words + images) for the ring layout. Stored as one JSON string (`ContentItem[]`); the surface renders the content editor; the ring effect parses it with `parseContent`."* Add to `BuildEnv`:

```ts
export interface BuildEnv {
  width: number; height: number; axes?: Record<string, number>
  /** Preloaded image textures keyed by ContentItem.src, for tile layouts. The
   *  build path is synchronous (withShaderFillContext), so images MUST be loaded
   *  by the caller (setImageTextures) before build; the effect only reads here. */
  imageTextures?: Map<string, import('three').Texture>
}
```

In `engine.ts`: add a private field `private imageTextures: Map<string, THREE.Texture> = new Map()`, a setter `setImageTextures(map: Map<string, THREE.Texture>): void { this.imageTextures = map }`, and include it in the env object built at the `buildScene` call site (currently `{ width: this.opts.width, height: this.opts.height, axes: texOpts.axes }`) — add `imageTextures: this.imageTextures`. Do this in **both** `build` and `buildKeyed` (grep the file for the `buildScene(` call sites; there is one shared code path around line 230 — confirm whether `buildKeyed` routes through it or has its own call, and cover both).

The unit test verifies the control kind is accepted by `defaultsFromControls` and that the default round-trips (no three.js needed):

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-content-control.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { defaultsFromControls, type ControlSpec } from '~/lib/spacetype/effect'

describe('contentList control kind', () => {
  it('carries a JSON-string default through defaultsFromControls', () => {
    const controls: ControlSpec[] = [
      { key: 'content', label: 'Content', kind: 'contentList', default: '[]', group: 'Type' },
    ]
    const params = defaultsFromControls(controls)
    expect(params.content).toBe('[]')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-content-control.unit.spec.ts`
Expected: FAIL — TypeScript rejects `kind: 'contentList'` (not in the union).

- [ ] **Step 3: Implement** — add the `contentList` variant to `ControlSpec` in `effect.ts`; add `imageTextures` to `BuildEnv`; add `setImageTextures` + env pass-through in `engine.ts` (both build sites).

- [ ] **Step 4: Run test + typecheck**

Run: `cd frontend && npx vitest run tests/unit/spacetype-content-control.unit.spec.ts`
Expected: PASS.
Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c "error TS"` — confirm the count did not rise above the ~328 baseline (see memory *typecheck-baseline-anchoring*; if an error names `contentList`/`imageTextures`/`setImageTextures`, it is yours — fix it).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/effect.ts frontend/app/lib/spacetype/engine.ts frontend/tests/unit/spacetype-content-control.unit.spec.ts
git commit -m "feat(expressive): engine seam — contentList kind + imageTextures in BuildEnv"
```

---

## Task 4: The `ring` effect

**Files:**
- Create: `frontend/app/lib/spacetype/effects/ring.ts`
- Modify: `frontend/app/lib/spacetype/effects/index.ts` (import + register `ringEffect`)
- Test: `frontend/tests/unit/spacetype-ring-effect.unit.spec.ts`

**Interfaces:**
- Consumes: `expandContent`, `parseContent` (Task 1); `ringTransform`, `RingParams` (Task 2); `layoutChars` (`charLayout.ts`); `BuildEnv.imageTextures` (Task 3); the `SpaceTypeEffect` contract (`effect.ts`).
- Produces: `export const ringEffect: SpaceTypeEffect`.

**Details — the effect:**

- **`controls`** (declared once; scalar controls derive their UI automatically):
  - `{ key: 'content', label: 'Content', kind: 'contentList', default: '<demo>', group: 'Type' }` where `<demo>` is a JSON string with 2–3 words so a fresh node shows something (e.g. `[{"id":"d1","kind":"word","text":"NATURAL","resolution":"whole"},{"id":"d2","kind":"word","text":"FRESH","resolution":"letters"}]`).
  - `radius` slider 2..12 step 0.1 default 5, group `'Ribbon'`.
  - `ringTilt` slider -1.2..1.2 step 0.01 default -0.28, group `'Transform'`.
  - `cardSize` slider 0.3..3 step 0.05 default 1.4, group `'Ribbon'`.
  - `perspective` slider 0..1 step 0.01 default 0.4, group `'Transform'` (maps to camera FOV/dolly in `update`).
  - `speed` slider 0..6 step 1 default 1, group `'Motion'` (whole turns per loop).
  - `direction` select `['cw','ccw']` default `'cw'`, group `'Motion'`.
- **`liveKeys`**: `['radius','ringTilt','cardSize','perspective','speed','direction']` — every param except `content` is applied live in `update()`, so only editing content triggers a structural rebuild. `content` is therefore the sole structural key.
- **`loopRates(params)`**: return `[Math.max(1, Math.round(Number(params.speed) || 1))]` so the seamless export renders whole spins.
- **`buildScene(THREE, params, _tex, env)`** (synchronous):
  1. `const items = parseContent(String(params.content ?? '[]'))`, `const tiles = expandContent(items)`.
  2. Build a `THREE.Group` (the ring root). Stash mutable per-scene state on `root.userData.ringState = { quads: [], transforms: [] }` (per the module-var prohibition).
  3. For each expanded tile, create a `THREE.Mesh(new THREE.PlaneGeometry(1,1), material)` and add to the group:
     - **image**: `const t = env?.imageTextures?.get(tile.src)`; material = `new THREE.MeshBasicMaterial({ map: t ?? null, side: THREE.DoubleSide, transparent: true })`. Quad width = `tile.aspect`, height = 1.
     - **word** / **letter**: call `layoutChars({ text: tile.text, ... font opts from params defaults ... })` **once per sourceId** (memoize in a local `Map<sourceId, CharLayout>` for the build) → `CharLayout`. For a `word` tile use UV `[0,1]×[0,1]` and quad aspect from `layout.texture.image.width/height`. For a `letter` tile use `layout.glyphs[tile.letterIndex]` for `u0/u1` and `aspect`; set the plane's UVs to that glyph's sub-rect. Material = `new THREE.MeshBasicMaterial({ map: layout.texture, side: THREE.DoubleSide, transparent: true })`.
     - Push the mesh to `ringState.quads`.
  4. Apply `ringTilt` by rotating the whole group about X (`group.rotation.x = Number(params.ringTilt)`).
  5. Return the group.
- **`update(t01, params, root)`**:
  1. `const st = root?.userData?.ringState; if (!st) return`.
  2. Build `RingParams` from `params` (`direction: params.direction === 'ccw' ? -1 : 1`).
  3. `const n = st.quads.length`; for each `i`, `const tf = ringTransform(i, n, rp, t01)`; set `quad.position.set(tf.x, tf.y, tf.z)`, `quad.rotation.set(0, tf.rotY, 0)`, base scale × `tf.scale` (preserve each quad's aspect: `quad.scale.set(aspect * tf.scale, tf.scale, 1)` — store `aspect` on `quad.userData.aspect` at build).
  4. Apply `ringTilt` live: `root.rotation.x = Number(params.ringTilt)`.
  5. `perspective` may nudge camera — for v1, apply it as a group Z push (`root.position.z = -Number(params.perspective) * 3`) to read as depth without touching the shared camera.

**The unit test** avoids canvas by using an **image-only** content list (image tiles don't call `layoutChars`), asserting build produces the right mesh count and that `update` positions them on the ring. Use a fake `imageTextures` map of `null` maps (MeshBasicMaterial accepts `map: null`).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-ring-effect.unit.spec.ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { ringEffect } from '~/lib/spacetype/effects/ring'
import { defaultsFromControls } from '~/lib/spacetype/effect'

function imageParams(n: number) {
  const items = Array.from({ length: n }, (_, i) => ({ id: `i${i}`, kind: 'image', src: `data:${i}` }))
  return { ...defaultsFromControls(ringEffect.controls), content: JSON.stringify(items) }
}

describe('ringEffect', () => {
  it('builds one quad per image tile', () => {
    const params = imageParams(6)
    const env = { width: 960, height: 540, imageTextures: new Map() }
    const root = ringEffect.buildScene(THREE, params, new THREE.Texture(), env)
    const st = (root as any).userData.ringState
    expect(st.quads).toHaveLength(6)
  })

  it('update places quads on the ring radius', () => {
    const params = imageParams(4)
    const root = ringEffect.buildScene(THREE, params, new THREE.Texture(), { width: 960, height: 540, imageTextures: new Map() })
    ringEffect.update!(0, params, root)
    const st = (root as any).userData.ringState
    const r = Number(params.radius)
    for (const q of st.quads) {
      expect(Math.hypot(q.position.x, q.position.z)).toBeCloseTo(r, 4)
    }
  })

  it('loopRates reflects speed as whole turns', () => {
    expect(ringEffect.loopRates!({ ...defaultsFromControls(ringEffect.controls), speed: 3 })).toEqual([3])
  })

  it('is registered in the effect list', async () => {
    const { SPACE_TYPE_EFFECTS } = await import('~/lib/spacetype/effects/index')
    expect(SPACE_TYPE_EFFECTS.some(e => e.id === 'ring')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-ring-effect.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/spacetype/effects/ring`.

- [ ] **Step 3: Implement** `ring.ts` per the details above and register it in `effects/index.ts` (import `ringEffect`, **append it to the END of the `SPACE_TYPE_EFFECTS` array**). Do NOT place it first: `getEffect()` returns `SPACE_TYPE_EFFECTS[0]` as the fallback for an unresolved id, so making `ring` index 0 would change the fallback default from `ribbon` to `ring` — a violation of the "existing docs render unchanged" constraint. Append-at-end preserves the fallback.

- [ ] **Step 4: Run tests + typecheck**

Run: `cd frontend && npx vitest run tests/unit/spacetype-ring-effect.unit.spec.ts`
Expected: PASS (4 tests).
Run the full spacetype unit set to confirm no regression: `cd frontend && npx vitest run tests/unit/ -t spacetype` (or run the whole `tests/unit/` dir). Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/effects/ring.ts frontend/app/lib/spacetype/effects/index.ts frontend/tests/unit/spacetype-ring-effect.unit.spec.ts
git commit -m "feat(expressive): ring layout effect — tiles on a spinning circle"
```

---

## Task 5: Surface — the content editor + image upload

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`
- (No new unit test — this is Vue/DOM UI; covered by the manual/E2E in Task 6. Keep the change small and localized.)

**Interfaces:**
- Consumes: the `contentList` control kind (Task 3); `ContentItem` (Task 1); `fitWithin` (`~/lib/lora/datasetImages`) for downscaling uploads.
- Produces: reads/writes the `content` param as a JSON string of `ContentItem[]`.

**Details:**

Find where `SpaceTypeSurface.vue` renders control rows by `kind` (it already special-cases `fillList`, `path`, `curve`, `gradientStops`, `textList`, `font`). Add a `contentList` branch that renders a `ContentListEditor` inline (keep it in-file for v1 to avoid a new component contract, unless the file already extracts control editors — follow the local pattern):

- Parse the current value with `parseContent`. Render one row per item:
  - **word row**: a text input bound to `text`, plus a two-option segmented control bound to `resolution` (`whole` | `letters`).
  - **image row**: a thumbnail (the `src`) + a remove button.
- A footer with **+ Add text** (pushes `{ id: <rand-ish stable id>, kind:'word', text:'TEXT', resolution:'whole' }`) and **+ Add image** (a hidden `<input type="file" accept="image/*">`).
- On file pick: draw the image to an offscreen canvas downscaled via `fitWithin(naturalW, naturalH, 1024)`, `canvas.toDataURL('image/jpeg', 0.9)` → `src`, and read `aspect = naturalW / naturalH`. Push `{ id, kind:'image', src, aspect }`.
- Drag to reorder (reuse whatever list-reorder affordance the surface already uses for `textList`/`fillList` rows; if none, a simple up/down button pair is acceptable for v1).
- On any change, write `JSON.stringify(items)` back into the `content` param through the same param-update path every other control uses (so autosave + motion + agent schema all see it).
- **Stable ids:** generate ids without `Date.now()`/`Math.random()` collisions mattering — a monotonic counter seeded from the current max id, or `crypto.randomUUID()` if available in the surface context, is fine. Ids must be stable across edits (memory *list-addressing-stable-ids*): never re-key by array index.

Gate the editor so it only shows for the `ring` effect (its `content` control's presence already does this, since the editor renders per-control — no extra gating needed).

- [ ] **Step 1: Implement** the `contentList` branch + add/upload/reorder handlers as above.

- [ ] **Step 2: Compile-check** the surface (memory *sailor-dev-environment* Vite curl, or): `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -iE "SpaceTypeSurface|contentList" ` — expect no new errors naming this file/kind.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(expressive): content editor — word rows + image upload (data URL)"
```

---

## Task 6: Preload textures in preview + headless; prove the money shot

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (preload before preview build)
- Modify: `frontend/app/lib/spacetype/frameSource.ts` (preload before headless build)

**Interfaces:**
- Consumes: `parseContent` (Task 1); `engine.setImageTextures` (Task 3).
- Produces: a shared helper `loadImageTextures(items: ContentItem[]): Promise<Map<string, THREE.Texture>>` (place in `tile.ts`? no — it uses three.js/DOM; put it in a new `app/lib/spacetype/imageTextures.ts` so `tile.ts` stays pure).

**Details:**

Create `app/lib/spacetype/imageTextures.ts`:

```ts
import * as THREE from 'three'
import type { ContentItem } from './tile'

/** Load every image ContentItem's src into a THREE.Texture, keyed by src.
 *  Async on purpose — call BEFORE engine.build (which is synchronous). */
export async function loadImageTextures(items: ContentItem[]): Promise<Map<string, THREE.Texture>> {
  const srcs = Array.from(new Set(items.filter(i => i.kind === 'image').map(i => (i as any).src)))
  const loader = new THREE.TextureLoader()
  const entries = await Promise.all(srcs.map(src => new Promise<[string, THREE.Texture] | null>(res => {
    loader.load(src, tex => { tex.colorSpace = THREE.SRGBColorSpace; res([src, tex]) }, undefined, () => res(null))
  })))
  const map = new Map<string, THREE.Texture>()
  for (const e of entries) if (e) map.set(e[0], e[1])
  return map
}
```

**Preview (`SpaceTypeSurface.vue`):** wherever the surface (re)builds the engine for the active effect, when `effectId === 'ring'`, first `await loadImageTextures(parseContent(params.content))`, then `engine.setImageTextures(map)`, then trigger the existing build. Because the build is debounced/watched, do the load in the watcher before calling build. Cache by `src` set so re-renders don't reload unchanged images (compare the sorted src list; skip reload if unchanged).

**Headless (`frameSource.ts`):** before the engine is built/mounted for export, do the same preload + `setImageTextures`. The frame source's `getFrame` runs after mount; ensure the preload happens in whatever sets the engine up (mount/build), not per-frame.

**This is the proof task.** After wiring:

- [ ] **Step 1: Implement** `imageTextures.ts` + preload in both the surface watcher and the frame source setup.

- [ ] **Step 2: Compile-check** — `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -c "error TS"` at/under baseline.

- [ ] **Step 3: Manual E2E — the money shot.** Start the dev server (`127.0.0.1`, per memory *sailor-dev-server-localhost*), open the canvas, add a Space Type node, pick the **ring** effect. Add 6 images (upload) + 2 words; set one word to `letters`. Confirm in the live preview: photos and words orbit together in one ring; toggling a word's `whole`/`letters` dial re-spaces the ring. Screenshot it.

- [ ] **Step 4: Prove the loop + export path.** Hit Render/Export (the headless frame source path). Confirm the exported loop contains the photos (proves `setImageTextures` reached the frame source) and is seamless (start frame ≈ end frame).

- [ ] **Step 5: Regression — existing docs unchanged.** Switch the effect to `ribbon` (or open any pre-existing Space Type node) and confirm it renders exactly as before (no console errors, visual unchanged). The guarantee is structural (no existing effect was touched), so this is a spot-check, not an exhaustive sweep.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/imageTextures.ts frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/app/lib/spacetype/frameSource.ts
git commit -m "feat(expressive): preload image textures in preview + export — ring money shot"
```

---

## Self-review against the spec

- **Merge / tile seam** → Tasks 1 (expandContent) + 4 (ring consumes tiles). ✅
- **Photo = whole tile; word = whole OR per-letter dial** → Task 1 (`resolution`), Task 5 (the dial UI). ✅
- **Content drives the count; layout re-fits** → Task 2/4 (`ringTransform` uses `n = tiles.length`). ✅
- **Uploads only (wire deferred)** → Task 5 (upload as data URL); no wire input. ✅
- **Fast-delight (it just loops); preset layer + touch-to-detach deferred** → ring loops via `loopRates`; no preset layer. ✅
- **Layout = one declared `ControlSpec`; only bespoke UI is the content editor** → Task 4 controls + Task 3 `contentList` kind. ✅
- **Existing effects untouched; old docs render unchanged** → Global Constraint + Task 6 Step 5. ✅
- **buildScene stays sync; images preloaded** → Task 3 (`setImageTextures`) + Task 6 (`loadImageTextures`). ✅
- **Success criteria 1–4** → Task 6 Steps 3–5 (money shot, dial, export loop, regression) + Task 4 (single declaration). ✅

**Type consistency check:** `ContentItem`/`ExpandedTile` (Task 1) used identically in Tasks 4/5/6; `RingParams`/`TileTransform`/`ringTransform` (Task 2) used in Task 4; `setImageTextures`/`BuildEnv.imageTextures` (Task 3) used in Task 6; `parseContent` (Task 1) used in Tasks 4/5/6. Names consistent throughout.

**Open risk to watch during execution:** whether `layoutChars` runs correctly at build time in the live browser (it needs canvas 2D — fine in the browser, untested in unit env by design). If glyph tiles render blank, that's the first thing to check (Task 6 Step 3).
