# Showcase layouts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Generalise the `ring` effect into **Showcase** — one effect that arranges tiles in a pluggable **layout** (Ring · Sphere Wall · Card Tunnel · Grid), all sharing the content/fill/tile engine.

**Architecture:** A `ShowcaseLayout` = a pure `place(i,n,params,t01)→TileTransform` + its own `ControlSpec[]` + `loopRates`. The Showcase effect (the renamed `ring` effect) owns the shared engine and dispatches placement to `getLayout(params.layout)`. Adding a layout = one module + one registry line.

**Tech Stack:** Nuxt/Vue/TS, three.js, Vitest. Spec: [2026-08-08-showcase-layouts-design.md](../specs/2026-08-08-showcase-layouts-design.md).

## Global Constraints

- **`effectId` stays `'ring'`** (saved docs store it — no migration); only the **`label` becomes `'Showcase'`**. Default `layout` is `'ring'` so every existing ring doc opens pixel-identical.
- **Ring parity is sacred:** at `layout='ring'` the render must equal today's ring exactly. The `ring` layout's `place` IS `ringTransform` (unchanged).
- **`bentOffset` and `ringTransform` stay in `ringLayout.ts`** (bend + ring math; other tests import them there). Layout modules import `ringTransform` from it.
- New controls' `group` must be a member of `SPACE_TYPE_SECTIONS` — use existing `'Ribbon'`/`'Transform'` (do NOT add a new section this pass).
- `layout` is **live** (in `liveKeys`) — switching is an `update()`-time placement swap, no rebuild. All v1 layouts share the same tile meshes; only `place` differs.
- Seam rule: every layout's motion completes whole cycles per loop (integer `round(speed)` turns/travels), so `t01=0` and `t01=1` coincide.
- Test cmd: `cd frontend && npx vitest run tests/unit/<file>`. Shared-tree: stage only each task's files; verify clean before commit; never `git add -A`/stash/reset.

---

## Task 1: `ShowcaseLayout` interface + registry + the `ring` layout

**Files:**
- Create `frontend/app/lib/spacetype/layouts/index.ts` (interface + registry + `getLayout`)
- Create `frontend/app/lib/spacetype/layouts/ring.ts` (the ring layout)
- Test `frontend/tests/unit/spacetype-layouts.unit.spec.ts`

**Interfaces produced:**
```ts
// layouts/index.ts
import type { ControlSpec, Params } from '../effect'
import type { TileTransform } from '../ringLayout'
export interface ShowcaseLayout {
  id: string
  label: string
  controls: ControlSpec[]
  place(i: number, n: number, p: Params, t01: number): TileTransform
  loopRates?(p: Params): number[]
}
export const SHOWCASE_LAYOUTS: ShowcaseLayout[]
export function getLayout(id: string): ShowcaseLayout   // case-insensitive; falls back to SHOWCASE_LAYOUTS[0] (ring)
```

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-layouts.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { getLayout, SHOWCASE_LAYOUTS } from '~/lib/spacetype/layouts/index'
import { ringTransform } from '~/lib/spacetype/ringLayout'

const P = { radius: 5, ringTilt: -0.28, cardSize: 1.4, speed: 1, direction: 'cw' }

describe('showcase layouts registry', () => {
  it('ring is the first (default/fallback) layout', () => {
    expect(SHOWCASE_LAYOUTS[0]!.id).toBe('ring')
    expect(getLayout('nope').id).toBe('ring')       // unknown → ring fallback
    expect(getLayout('RING').id).toBe('ring')        // case-insensitive
  })
  it('ring layout place() equals ringTransform (parity)', () => {
    const layout = getLayout('ring')
    for (const i of [0, 1, 3]) for (const t of [0, 0.25, 1]) {
      const a = layout.place(i, 5, P as any, t)
      const b = ringTransform(i, 5, { radius: 5, ringTilt: -0.28, cardSize: 1.4, speed: 1, direction: 1 }, t)
      expect(a.x).toBeCloseTo(b.x, 9); expect(a.z).toBeCloseTo(b.z, 9)
      expect(a.rotY).toBeCloseTo(b.rotY, 9); expect(a.scale).toBeCloseTo(b.scale, 9)
    }
  })
  it('ring layout declares its own controls (radius/ringTilt/ringOpening), showIf-gated', () => {
    const c = getLayout('ring').controls
    expect(c.map(x => x.key).sort()).toEqual(['radius', 'ringOpening', 'ringTilt'])
    expect(c.every(x => (x as any).showIf?.key === 'layout' && (x as any).showIf?.equals === 'ring')).toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (`~/lib/spacetype/layouts/index` missing). `cd frontend && npx vitest run tests/unit/spacetype-layouts.unit.spec.ts`

- [ ] **Step 3: Implement.**

`layouts/ring.ts`:
```ts
import type { ControlSpec, Params } from '../effect'
import { ringTransform, type TileTransform } from '../ringLayout'
import type { ShowcaseLayout } from './index'

const controls: ControlSpec[] = [
  { key: 'radius', label: 'Ring size', kind: 'slider', min: 2, max: 12, step: 0.1, default: 5, group: 'Ribbon', showIf: { key: 'layout', equals: 'ring' } },
  { key: 'ringTilt', label: 'Ring tilt', kind: 'slider', min: -1.2, max: 1.2, step: 0.01, default: -0.28, group: 'Transform', showIf: { key: 'layout', equals: 'ring' } },
  { key: 'ringOpening', label: 'Ring opening', kind: 'slider', min: -1, max: 1, step: 0.01, default: 0.55, group: 'Transform', showIf: { key: 'layout', equals: 'ring' } },
]

export const ringLayout: ShowcaseLayout = {
  id: 'ring',
  label: 'Ring',
  controls,
  place(i, n, p, t01): TileTransform {
    return ringTransform(i, n, {
      radius: Number(p.radius), ringTilt: Number(p.ringTilt), cardSize: Number(p.cardSize),
      speed: Number(p.speed), direction: String(p.direction) === 'ccw' ? -1 : 1,
    }, t01)
  },
  loopRates(p) { return [Math.max(1, Math.round(Number(p.speed) || 1))] },
}
```

`layouts/index.ts`:
```ts
import type { ControlSpec, Params } from '../effect'
import type { TileTransform } from '../ringLayout'
import { ringLayout } from './ring'

export interface ShowcaseLayout {
  id: string; label: string; controls: ControlSpec[]
  place(i: number, n: number, p: Params, t01: number): TileTransform
  loopRates?(p: Params): number[]
}
export const SHOWCASE_LAYOUTS: ShowcaseLayout[] = [ringLayout]
export function getLayout(id: string): ShowcaseLayout {
  const lc = String(id).toLowerCase()
  return SHOWCASE_LAYOUTS.find(l => l.id.toLowerCase() === lc) ?? SHOWCASE_LAYOUTS[0]!
}
```

- [ ] **Step 4: Run — expect PASS** (3 tests).
- [ ] **Step 5: Commit** `git add frontend/app/lib/spacetype/layouts/index.ts frontend/app/lib/spacetype/layouts/ring.ts frontend/tests/unit/spacetype-layouts.unit.spec.ts` → `feat(expressive): ShowcaseLayout interface + ring layout (extracted, parity)`

---

## Task 2: Wire the Showcase host (the renamed `ring` effect)

**Files:**
- Modify `frontend/app/lib/spacetype/effects/ring.ts`
- Test `frontend/tests/unit/spacetype-ring-effect.unit.spec.ts` (extend)

**Consumes:** `SHOWCASE_LAYOUTS`, `getLayout` (Task 1).

**Do (in `ring.ts`):**
1. Import `{ SHOWCASE_LAYOUTS, getLayout } from '../layouts/index'`.
2. Change the effect `label` from `'Ring'` to `'Showcase'` (keep `id: 'ring'` — add a comment: *"id stays 'ring' for saved-doc compat; the effect is Showcase, and 'ring' is now the default layout"*).
3. Add a `layout` select control at the top of the `controls` array:
   ```ts
   { key: 'layout', label: 'Layout', kind: 'select', options: SHOWCASE_LAYOUTS.map(l => l.id), default: 'ring', group: 'Ribbon' },
   ```
4. **Remove** the `radius`, `ringTilt`, `ringOpening` control declarations from `ring.ts`'s `controls` array (they now come from the ring layout). Append every layout's controls instead: after the shared controls, spread `...SHOWCASE_LAYOUTS.flatMap(l => l.controls)`.
5. `liveKeys`: add `'layout'` (keep the rest). `radius`/`ringTilt`/`ringOpening` stay valid keys (still read via `n(params, ...)` with `RING_DEFAULTS` backfill — but `RING_DEFAULTS = defaultsFromControls(controls)` now includes the layout controls' defaults since they're concatenated into `controls`, so keep `RING_DEFAULTS` computed AFTER the concat).
6. In `update()`, replace the direct `ringTransform(i, count, rp, t01)` call with:
   ```ts
   const layout = getLayout(String(params.layout ?? 'ring'))
   // ... per-quad:
   const tf = layout.place(i, count, params, t01)
   ```
   (Delete the local `rp: RingParams` construction — the layout builds its own from params.) The group-level `root.rotation.set(-ringOpening*OPEN_MAX, 0, ringTilt)` stays (it's the ring layout's viewing pose; for non-ring layouts `ringOpening`/`ringTilt` default via RING_DEFAULTS and still apply as a mild group rotation — acceptable for v1; a per-layout camera is a fast-follow).
7. `loopRates(params)`: delegate — `return getLayout(String(params.layout ?? 'ring')).loopRates?.(params) ?? [1]`.

**Ring parity:** at `layout='ring'`, `layout.place` === `ringTransform` (Task 1), so the render is identical. Assert it.

- [ ] **Step 1: Extend the test** — add to `spacetype-ring-effect.unit.spec.ts`:

```ts
it('effect label is Showcase, id stays ring, layout control defaults to ring', () => {
  expect(ringEffect.label).toBe('Showcase')
  expect(ringEffect.id).toBe('ring')
  const layoutCtl = ringEffect.controls.find(c => c.key === 'layout')
  expect(layoutCtl?.default).toBe('ring')
  expect((layoutCtl as any).options).toContain('ring')
})
it('builds + updates under layout=ring identical to before (image-only doc)', () => {
  const items = [{ id: 'i0', kind: 'card', fillKind: 'image', src: 'data:0' }]
  const params = { ...defaultsFromControls(ringEffect.controls), content: JSON.stringify(items) }
  const root = ringEffect.buildScene(THREE, params, new THREE.Texture(), { width: 960, height: 540, imageTextures: new Map() })
  expect(() => ringEffect.update!(0.25, params, root)).not.toThrow()
  expect((root as any).userData.ringState.quads).toHaveLength(1)
})
```

- [ ] **Step 2: Run — expect FAIL** (label is 'Ring', no `layout` control).
- [ ] **Step 3: Implement** per the 7 steps above.
- [ ] **Step 4: Run tests + `npx vue-tsc --noEmit 2>&1 | grep -i ring.ts` (no new errors); run the full ring test file — all green (ring parity holds).**
- [ ] **Step 5: Manual (deferred to user):** the effect gallery shows "Showcase"; a Layout dropdown appears; at Ring it looks exactly as before.
- [ ] **Step 6: Commit** ring.ts + test → `feat(expressive): Showcase host — layout picker + dispatch (ring parity)`

---

## Task 3: Sphere Wall layout

**Files:**
- Create `frontend/app/lib/spacetype/layouts/sphere.ts`
- Modify `frontend/app/lib/spacetype/layouts/index.ts` (register)
- Test `frontend/tests/unit/spacetype-layout-sphere.unit.spec.ts`

**Interfaces:** produces `sphereLayout: ShowcaseLayout` (id `'sphere'`, label `'Sphere Wall'`); consumes `ShowcaseLayout`.

**Placement:** Fibonacci sphere of radius `R = sphereRadius`, spinning `round(speed)` turns/loop about Y. For tile `i` of `n`: `y = 1 − 2·(i+0.5)/n`, `rad = √(max(0,1−y²))`, `θ = i·GA + spin` where `GA = π·(3−√5)`, `spin = dir·2π·round(speed)·t01`. Position `(cos θ·rad·R, y·R, sin θ·rad·R)`. `rotY = atan2(sinθ, cosθ)`-wrapped so cards face outward horizontally; `scale = cardSize`. Every point is at distance `R` from centre (test).

- [ ] **Step 1: Failing test**

```ts
// frontend/tests/unit/spacetype-layout-sphere.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { sphereLayout } from '~/lib/spacetype/layouts/sphere'
const P = { sphereRadius: 5, cardSize: 1, speed: 1, direction: 'cw' }
describe('sphere layout', () => {
  it('all tiles sit on the sphere radius', () => {
    for (let i = 0; i < 12; i++) {
      const t = sphereLayout.place(i, 12, P as any, 0)
      expect(Math.hypot(t.x, t.y, t.z)).toBeCloseTo(5, 4)
    }
  })
  it('seam: t01=0 equals t01=1', () => {
    for (let i = 0; i < 7; i++) {
      const a = sphereLayout.place(i, 7, P as any, 0), b = sphereLayout.place(i, 7, P as any, 1)
      expect(b.x).toBeCloseTo(a.x, 5); expect(b.y).toBeCloseTo(a.y, 5); expect(b.z).toBeCloseTo(a.z, 5)
    }
  })
  it('scale follows cardSize', () => {
    expect(sphereLayout.place(0, 4, { ...P, cardSize: 2 } as any, 0).scale).toBeCloseTo(2, 6)
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `sphere.ts`:

```ts
import type { ControlSpec } from '../effect'
import type { TileTransform } from '../ringLayout'
import type { ShowcaseLayout } from './index'
const GA = Math.PI * (3 - Math.sqrt(5))
const controls: ControlSpec[] = [
  { key: 'sphereRadius', label: 'Sphere size', kind: 'slider', min: 2, max: 12, step: 0.1, default: 5, group: 'Ribbon', showIf: { key: 'layout', equals: 'sphere' } },
]
export const sphereLayout: ShowcaseLayout = {
  id: 'sphere', label: 'Sphere Wall', controls,
  place(i, n, p, t01): TileTransform {
    const R = Number(p.sphereRadius), dir = String(p.direction) === 'ccw' ? -1 : 1
    const spin = dir * 2 * Math.PI * Math.round(Number(p.speed) || 0) * t01
    const y = 1 - 2 * (i + 0.5) / Math.max(1, n)
    const rad = Math.sqrt(Math.max(0, 1 - y * y))
    const th = i * GA + spin
    return { x: Math.cos(th) * rad * R, y: y * R, z: Math.sin(th) * rad * R, rotY: Math.atan2(Math.sin(th), Math.cos(th)), scale: Number(p.cardSize) }
  },
  loopRates(p) { return [Math.max(1, Math.round(Number(p.speed) || 1))] },
}
```
Register in `layouts/index.ts`: import `sphereLayout`, add to `SHOWCASE_LAYOUTS` (after `ringLayout`). The effect's `layout` options + control concat pick it up automatically (Task 2 derived them from the registry).

- [ ] **Step 4: Run — expect PASS.** Also re-run `spacetype-ring-effect` (layout options now include 'sphere').
- [ ] **Step 5: Manual (deferred):** pick Sphere Wall — cards scatter on a spinning sphere, content/fills intact.
- [ ] **Step 6: Commit** sphere.ts + index.ts + test → `feat(expressive): sphere wall layout`

---

## Task 4: Card Tunnel layout

**Files:** Create `frontend/app/lib/spacetype/layouts/tunnel.ts`; Modify `layouts/index.ts`; Test `frontend/tests/unit/spacetype-layout-tunnel.unit.spec.ts`.

**Placement:** tiles fly toward the camera down `−Z` and wrap. For tile `i`: `frac = ((i/n) − round(speed)·t01) mod 1` (JS-safe positive mod), `z = −frac·depth` (`tunnelDepth`); cross-section offset on a golden-angle spiral of radius `spread` (`tunnelSpread`): `x = cos(i·GA)·spread`, `y = sin(i·GA)·spread`; `rotY = 0` (face camera); `scale = cardSize`. Seam holds for integer `round(speed)`.

- [ ] **Step 1: Failing test**

```ts
// frontend/tests/unit/spacetype-layout-tunnel.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { tunnelLayout } from '~/lib/spacetype/layouts/tunnel'
const P = { tunnelDepth: 20, tunnelSpread: 1.5, cardSize: 1, speed: 1, direction: 'cw' }
describe('tunnel layout', () => {
  it('z stays within [-depth, 0]', () => {
    for (let i = 0; i < 10; i++) for (const t of [0, 0.3, 0.7]) {
      const z = tunnelLayout.place(i, 10, P as any, t).z
      expect(z).toBeLessThanOrEqual(1e-9); expect(z).toBeGreaterThanOrEqual(-20 - 1e-6)
    }
  })
  it('seam: t01=0 equals t01=1', () => {
    for (let i = 0; i < 6; i++) {
      const a = tunnelLayout.place(i, 6, P as any, 0), b = tunnelLayout.place(i, 6, P as any, 1)
      expect(b.z).toBeCloseTo(a.z, 5); expect(b.x).toBeCloseTo(a.x, 6)
    }
  })
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `tunnel.ts`:

```ts
import type { ControlSpec } from '../effect'
import type { TileTransform } from '../ringLayout'
import type { ShowcaseLayout } from './index'
const GA = Math.PI * (3 - Math.sqrt(5))
const pmod = (a: number, m: number) => ((a % m) + m) % m
const controls: ControlSpec[] = [
  { key: 'tunnelDepth', label: 'Tunnel depth', kind: 'slider', min: 5, max: 40, step: 0.5, default: 18, group: 'Ribbon', showIf: { key: 'layout', equals: 'tunnel' } },
  { key: 'tunnelSpread', label: 'Tunnel spread', kind: 'slider', min: 0, max: 4, step: 0.05, default: 1.5, group: 'Ribbon', showIf: { key: 'layout', equals: 'tunnel' } },
]
export const tunnelLayout: ShowcaseLayout = {
  id: 'tunnel', label: 'Card Tunnel', controls,
  place(i, n, p, t01): TileTransform {
    const depth = Number(p.tunnelDepth), spread = Number(p.tunnelSpread)
    const dir = String(p.direction) === 'ccw' ? -1 : 1
    const frac = pmod(i / Math.max(1, n) - dir * Math.round(Number(p.speed) || 0) * t01, 1)
    const a = i * GA
    return { x: Math.cos(a) * spread, y: Math.sin(a) * spread, z: -frac * depth, rotY: 0, scale: Number(p.cardSize) }
  },
  loopRates(p) { return [Math.max(1, Math.round(Number(p.speed) || 1))] },
}
```
Register in `layouts/index.ts`.

- [ ] **Step 4: Run — expect PASS.** Re-run ring-effect test.
- [ ] **Step 5: Manual (deferred):** Card Tunnel — cards fly toward camera, wrap, content/fills intact.
- [ ] **Step 6: Commit** → `feat(expressive): card tunnel layout`

---

## Task 5: Grid layout

**Files:** Create `frontend/app/lib/spacetype/layouts/grid.ts`; Modify `layouts/index.ts`; Test `frontend/tests/unit/spacetype-layout-grid.unit.spec.ts`.

**Placement:** `cols = round(gridCols)` columns × `ceil(n/cols)` rows, XY plane, centred, facing camera. `col = i % cols`, `row = floor(i/cols)`, `gap = cardSize·(1 + gridGap)`; `x = (col − (cols−1)/2)·gap`, `y = −(row − (rows−1)/2)·gap`, `z = 0`, `rotY = 0`, `scale = cardSize`. Static (no loop) → `loopRates` returns `[]`.

- [ ] **Step 1: Failing test**

```ts
// frontend/tests/unit/spacetype-layout-grid.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { gridLayout } from '~/lib/spacetype/layouts/grid'
const P = { gridCols: 3, gridGap: 0.2, cardSize: 1 }
describe('grid layout', () => {
  it('maps i to (col,row) and centres the grid', () => {
    // 6 tiles, 3 cols → 2 rows; gap = 1.2. cols centre at (0,1,2)-1 = -1,0,1 ×1.2
    const t0 = gridLayout.place(0, 6, P as any, 0)   // col0,row0 (top-left)
    const t4 = gridLayout.place(4, 6, P as any, 0)   // col1,row1 (centre-bottom)
    expect(t0.x).toBeCloseTo(-1.2, 6); expect(t0.y).toBeCloseTo(0.6, 6)   // rows centred: row0 at +gap/2
    expect(t4.x).toBeCloseTo(0, 6);   expect(t4.y).toBeCloseTo(-0.6, 6)
    expect(t0.z).toBe(0); expect(t0.rotY).toBe(0)
  })
  it('is static (no loop rates)', () => { expect(gridLayout.loopRates!(P as any)).toEqual([]) })
})
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `grid.ts`:

```ts
import type { ControlSpec } from '../effect'
import type { TileTransform } from '../ringLayout'
import type { ShowcaseLayout } from './index'
const controls: ControlSpec[] = [
  { key: 'gridCols', label: 'Columns', kind: 'slider', min: 1, max: 8, step: 1, default: 4, group: 'Ribbon', showIf: { key: 'layout', equals: 'grid' } },
  { key: 'gridGap', label: 'Grid gap', kind: 'slider', min: 0, max: 2, step: 0.05, default: 0.2, group: 'Ribbon', showIf: { key: 'layout', equals: 'grid' } },
]
export const gridLayout: ShowcaseLayout = {
  id: 'grid', label: 'Grid', controls,
  place(i, n, p, _t01): TileTransform {
    const cols = Math.max(1, Math.round(Number(p.gridCols) || 1))
    const rows = Math.max(1, Math.ceil(Math.max(1, n) / cols))
    const gap = Number(p.cardSize) * (1 + Number(p.gridGap))
    const col = i % cols, row = Math.floor(i / cols)
    return { x: (col - (cols - 1) / 2) * gap, y: -(row - (rows - 1) / 2) * gap, z: 0, rotY: 0, scale: Number(p.cardSize) }
  },
  loopRates() { return [] },
}
```
Register in `layouts/index.ts`.

- [ ] **Step 4: Run — expect PASS.** Re-run ring-effect test (options include 'grid').
- [ ] **Step 5: Manual (deferred):** Grid — cards in rows×cols facing camera; a static grid is fine.
- [ ] **Step 6: Commit** → `feat(expressive): grid layout`

---

## Self-review against the spec

- Layout host + pluggable `place`/controls/loopRates → Task 1 (interface) + Task 2 (dispatch). ✅
- Ring extracted, parity preserved → Task 1 (place ≡ ringTransform) + Task 2 (parity test). ✅
- Effect renamed Showcase, id 'ring' kept, `layout` picker, live → Task 2. ✅
- Control re-categorisation (ring controls → ring layout, showIf) → Task 1 (declares them) + Task 2 (removes from ring.ts, concats registry). ✅
- Sphere / Tunnel / Grid pure placements, unit-tested → Tasks 3/4/5. ✅
- Legacy doc → ring via default + RING_DEFAULTS backfill (now includes layout-control defaults) → Task 2 step 5. ✅
- Picker is the auto-rendered `select` (no new UI); presets/gallery deferred → Task 2 + spec. ✅

**Type consistency:** `ShowcaseLayout` (Task 1) used by Tasks 3/4/5; `getLayout`/`SHOWCASE_LAYOUTS` (Task 1) used by Task 2; every layout's `place(i,n,p,t01)→TileTransform` + `loopRates(p)` signatures match the interface; `TileTransform` is the existing `ringLayout.ts` type throughout.

**Open risk to watch:** Task 2 is the integration — the `RING_DEFAULTS = defaultsFromControls(controls)` must be computed AFTER the layout-control concat (else layout defaults are missing → NaN on non-ring layouts); and the group-level ring-opening/tilt still applies to non-ring layouts (acceptable v1, per-layout camera is a fast-follow). Both flagged for the final review.
