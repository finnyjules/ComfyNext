# Space Type — Loft refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three refinements to the shipped Loft effect — a named Shape picker (Oval/Capsule/Rectangle/Polygon/Star/Word), colour via the shared fill control (solid/gradient/ombre) with a per-stop mode kept, and Spacing that breaks the sweep into discrete stacked rings.

**Architecture:** Extend the pure geometry core (`loftGeometry.ts`) with three additive functions (`shapeContour`, `rampFromFill`, `buildSlicedLoftGeometry`), all node-testable. Then rewire `effects/loft.ts` to consume them via new controls, keeping the existing spine/stops/word/motion machinery. Finally slim the stop model (drop the abstract per-stop Sides/Radius, now replaced by the global shape) and declutter the editor. Each geometry function lands first and additively, so the build stays green until the effect switches over.

**Tech Stack:** Nuxt 4, Vue 3.5, TypeScript, three.js, Vitest (node env).

## Global Constraints

- **Frontend cwd for all commands:** `frontend/`. Test: `npx vitest run tests/unit/<file>.unit.spec.ts`.
- **`buildScene` MUST stay synchronous.** Per-scene state on `root.userData`. `stripAlpha` before any `new THREE.Color(hex)` on alpha-bearing hex.
- **Contours are unit-space** (built in the box [-1,1]²); per-station width/height scale them, roll rotates them — that placement already lives in `buildLoftGeometry`. Every contour a shape returns MUST be resampled to the SAME `points` count (uniform-P invariant that `buildLoftGeometry`/`buildSlicedLoftGeometry` require).
- **Reuse the shared fill system:** `parseFills`/`fillPrimary` from `~/lib/spacetype/fills`, `defaultFillsFor` from `~/lib/spacetype/palette`, `Fill`/`FillType` types. Do not reinvent fill parsing.
- **Commit hygiene — HARDENED (parallel sessions share the git index AND working tree):** commit via PATHSPEC form `git commit <explicit-paths> -m "..."` (never `git add`+bare commit, never `-A`, never `stash`); for a NEW file, `git add <path>` then `git commit <path> -m`. After committing, VERIFY with `git show HEAD:<file> | grep -c <marker>`; if a marker is missing a parallel session swept it — re-commit via pathspec.
- **Typecheck baseline** ~328; a pre-existing `SpaceTypeSurface.vue` `onVibeRevert` error (~line 155-160) is NOT yours.

## Shared signatures (define exactly; later tasks depend on these)

```ts
// loftGeometry.ts — all additive
export type LoftShape = 'oval' | 'capsule' | 'rectangle' | 'polygon' | 'star'
export interface ShapeParams { rectRadius: number; polySides: number; starDepth: number }
export function shapeContour(shape: LoftShape, params: ShapeParams, points: number): Vec2[]
export function rampFromFill(three: typeof THREE, fillsJson: string, size: number): Uint8ClampedArray
export function buildSlicedLoftGeometry(opts: {
  stations: Station[]; props: StopProps[]; baseContours: Vec2[][]
  closed: boolean; render: 'stroke' | 'fill'; elements: number; spacing: number
}): LoftGeometry   // same shape as buildLoftGeometry's return
```

---

### Task 1: `shapeContour` — the five named shapes

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (append)
- Test: `frontend/tests/unit/spacetype-loft-shape.unit.spec.ts` (new)

**Interfaces:**
- Consumes: `Vec2`, `resampleContour` (existing in loftGeometry).
- Produces: `LoftShape`, `ShapeParams`, `shapeContour` (signatures above). Contours unit-space, resampled to `points`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-loft-shape.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { shapeContour } from '../../app/lib/spacetype/loftGeometry'

const P = 48
const params = { rectRadius: 0.5, polySides: 5, starDepth: 0.5 }

describe('shapeContour', () => {
  it('every shape returns exactly `points` vertices', () => {
    for (const s of ['oval','capsule','rectangle','polygon','star'] as const)
      expect(shapeContour(s, params, P).length).toBe(P)
  })
  it('oval is a unit circle (all radii ~1)', () => {
    for (const p of shapeContour('oval', params, P)) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 3)
  })
  it('rectangle reaches into the corners (max extent > oval)', () => {
    const maxR = (pts: {x:number;y:number}[]) => Math.max(...pts.map(p => Math.hypot(p.x, p.y)))
    expect(maxR(shapeContour('rectangle', { ...params, rectRadius: 0 }, P))).toBeGreaterThan(1.2)
  })
  it('star has alternating near/far vertices (inner pulled in by starDepth)', () => {
    const r = shapeContour('star', { ...params, polySides: 5, starDepth: 0.6 }, 200).map(p => Math.hypot(p.x, p.y))
    expect(Math.min(...r)).toBeLessThan(0.6)   // inner points pulled in
    expect(Math.max(...r)).toBeGreaterThan(0.9) // outer points near 1
  })
  it('polygon has no deep inner points (starDepth ignored)', () => {
    const r = shapeContour('polygon', { ...params, polySides: 6 }, 200).map(p => Math.hypot(p.x, p.y))
    expect(Math.min(...r)).toBeGreaterThan(0.7)  // polygon edges dip only to the apothem, not to center
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/unit/spacetype-loft-shape.unit.spec.ts`
Expected: FAIL — `shapeContour` not exported.

- [ ] **Step 3: Append implementation to `loftGeometry.ts`**

```ts
export type LoftShape = 'oval' | 'capsule' | 'rectangle' | 'polygon' | 'star'
export interface ShapeParams { rectRadius: number; polySides: number; starDepth: number }

/** Perimeter of a rounded rectangle in the box [-1,1]², radius `r` (0..1 of the half-extent). */
function roundedRectPath(r: number): Vec2[] {
  const rr = Math.min(1, Math.max(0, r))
  const out: Vec2[] = []
  const ARC = 8
  // corners: (+x+y), (-x+y), (-x-y), (+x-y); centre of each corner arc is inset by rr
  const corners = [
    { cx: 1 - rr, cy: 1 - rr, a0: 0 },
    { cx: -1 + rr, cy: 1 - rr, a0: Math.PI / 2 },
    { cx: -1 + rr, cy: -1 + rr, a0: Math.PI },
    { cx: 1 - rr, cy: -1 + rr, a0: (3 * Math.PI) / 2 },
  ]
  for (const c of corners) {
    for (let i = 0; i <= ARC; i++) {
      const a = c.a0 + (i / ARC) * (Math.PI / 2)
      out.push({ x: c.cx + Math.cos(a) * rr, y: c.cy + Math.sin(a) * rr })
    }
  }
  return out
}

export function shapeContour(shape: LoftShape, params: ShapeParams, points: number): Vec2[] {
  switch (shape) {
    case 'oval': {
      const out: Vec2[] = []
      for (let i = 0; i < points; i++) { const a = (i / points) * Math.PI * 2; out.push({ x: Math.cos(a), y: Math.sin(a) }) }
      return out
    }
    case 'capsule':   // stadium = rounded rect at full corner radius; stretches to a stadium once width/height scale it
      return resampleContour(roundedRectPath(1), points)
    case 'rectangle':
      return resampleContour(roundedRectPath(params.rectRadius), points)
    case 'polygon':
    case 'star': {
      const n = Math.max(3, Math.round(params.polySides))
      const isStar = shape === 'star'
      const verts = isStar ? n * 2 : n
      const inner = isStar ? Math.max(0.05, 1 - Math.min(0.9, Math.max(0, params.starDepth))) : 1
      const raw: Vec2[] = []
      for (let i = 0; i < verts; i++) {
        const a = (i / verts) * Math.PI * 2 - Math.PI / 2
        const rad = isStar && i % 2 === 1 ? inner : 1
        raw.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad })
      }
      return resampleContour(raw, points)
    }
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/unit/spacetype-loft-shape.unit.spec.ts`
Expected: PASS (5).

- [ ] **Step 5: Commit** (pathspec; new test file needs `git add` first)

```bash
git add frontend/tests/unit/spacetype-loft-shape.unit.spec.ts
git commit frontend/app/lib/spacetype/loftGeometry.ts frontend/tests/unit/spacetype-loft-shape.unit.spec.ts -m "feat(spacetype): loft shapeContour — oval/capsule/rectangle/polygon/star"
```
Verify: `git show HEAD:frontend/app/lib/spacetype/loftGeometry.ts | grep -c shapeContour` (>0).

---

### Task 2: `rampFromFill` — colour ramp from a shared fill

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (append)
- Test: `frontend/tests/unit/spacetype-loft-shape.unit.spec.ts` (append) OR a new `spacetype-loft-fillramp.unit.spec.ts`

**Interfaces:**
- Consumes: `parseFills`, `fillPrimary` from `~/lib/spacetype/fills`; the `Fill` type. NOTE: `fillPrimary(three, fill)` returns a `THREE.Color`. For gradient/ombre the fill object carries `.a`/`.b` hex strings (see `fills.ts` — gradient uses `fill.a`,`fill.b`).
- Produces: `rampFromFill(three, fillsJson, size): Uint8ClampedArray` (size*4 RGBA).

- [ ] **Step 1: Write the failing test**

```ts
// append to a loft geometry test file
import { rampFromFill } from '../../app/lib/spacetype/loftGeometry'
import * as THREE from 'three'
import { defaultFillsFor } from '../../app/lib/spacetype/palette'

describe('rampFromFill', () => {
  it('solid fill → flat ramp (endpoints equal)', () => {
    const fills = JSON.stringify([{ type: 'solid', color: '#ff0000' }])
    const r = rampFromFill(THREE as any, fills, 64)
    expect(r.length).toBe(64 * 4)
    expect([r[0], r[1], r[2]]).toEqual([r[63 * 4], r[63 * 4 + 1], r[63 * 4 + 2]])
    expect(r[0]).toBeGreaterThan(200)  // red channel high
  })
  it('gradient fill → endpoints differ (A vs B)', () => {
    const fills = JSON.stringify([{ type: 'gradient', a: '#000000', b: '#ffffff' }])
    const r = rampFromFill(THREE as any, fills, 64)
    const first = r[0]! + r[1]! + r[2]!, last = r[63*4]! + r[63*4+1]! + r[63*4+2]!
    expect(last).toBeGreaterThan(first + 200)   // dark → light along the ramp
  })
  it('malformed/empty → does not throw, returns size*4', () => {
    expect(rampFromFill(THREE as any, 'garbage', 32).length).toBe(32 * 4)
  })
})
```

- [ ] **Step 2: Run, verify fail.** Run the file; expect `rampFromFill` not exported.

- [ ] **Step 3: Append implementation**

```ts
import { parseFills, fillPrimary } from './fills'

function hexToRgbTuple(hex: string): [number, number, number] {
  const h = String(hex).replace('#', '').slice(0, 6).padEnd(6, '0')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

/** A 1-D colour ramp (size*4 RGBA) built from the FIRST fill in the shared fills list.
 *  solid → flat primary; gradient/ombre → a→b across the ramp; patterned (grid/noise/shader)
 *  → flat primary (surface patterns are a later follow-up). */
export function rampFromFill(three: typeof THREE, fillsJson: string, size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * 4)
  let fills: any[]
  try { fills = parseFills(fillsJson) } catch { fills = [] }
  const fill: any = fills[0] ?? { type: 'solid', color: '#888888' }
  const type = String(fill.type)
  const ab = (type === 'gradient' || type === 'ombre') && fill.a && fill.b
  const a = ab ? hexToRgbTuple(fill.a) : null
  const b = ab ? hexToRgbTuple(fill.b) : null
  let flat: [number, number, number]
  try { const c = fillPrimary(three, fill); flat = [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)] }
  catch { flat = [136, 136, 136] }
  for (let i = 0; i < size; i++) {
    const t = size > 1 ? i / (size - 1) : 0
    const [r, g, bl] = ab && a && b ? [a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t, a[2] + (b[2]-a[2])*t] : flat
    out[i*4] = Math.round(r); out[i*4+1] = Math.round(g); out[i*4+2] = Math.round(bl); out[i*4+3] = 255
  }
  return out
}
```
Note: confirm the gradient fill's field names against `fills.ts`/`fillTile.ts` (the grep in Task-context showed `fill.a`/`fill.b` for gradient/ombre). If the parsed shape differs, adapt `ab`/`a`/`b` accordingly — the test's `{type:'gradient',a,b}` must match what `parseFills` produces/accepts.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** (pathspec; `git add` any new test file first).
Verify marker `rampFromFill` in HEAD loftGeometry.ts.

---

### Task 3: `buildSlicedLoftGeometry` — discrete stacked rings

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (append)
- Test: `frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts` (append)

**Interfaces:**
- Consumes: `Station`, `StopProps`, `Vec2`, `LoftGeometry`, and the same per-vertex placement math used by `buildLoftGeometry` (position = `pos + rx*normal + ry*binormal`, roll rotation, width/height scale).
- Produces: `buildSlicedLoftGeometry(opts)` → `LoftGeometry` (`positions`, `along`, `indices`). Renders `elements` discrete bands; each band skins a short sub-span `(1-spacing)/elements` of the spine, leaving `spacing/elements` as gap. `along` per band vertex = the band centre `t`, so the ramp still maps across the stack.

- [ ] **Step 1: Add failing tests**

```ts
// append to spacetype-loft-geometry.unit.spec.ts
import { buildSlicedLoftGeometry } from '../../app/lib/spacetype/loftGeometry'

describe('buildSlicedLoftGeometry', () => {
  const P = 12, ELEMENTS = 5
  const stopsFix = [
    { id:'a', x:0, y:0.5, z:0, width:1, height:1, radius:0.5, sides:32, roll:0, color:'#000000' },
    { id:'b', x:1, y:0.5, z:0, width:1, height:1, radius:0.5, sides:32, roll:0, color:'#ffffff' },
  ]
  const stations = sampleSpine(stopsFix as any, false, 200)
  const props = stations.map(() => ({ width:1, height:1, radius:0.5, sides:32, roll:0 }))
  const contour = shapeContour('oval', { rectRadius:0.5, polySides:5, starDepth:0.5 }, P)

  it('fill: emits ELEMENTS separate bands (each 2 rings skinned) → vertex + index counts scale with ELEMENTS', () => {
    const g = buildSlicedLoftGeometry({ stations, props, baseContours: [contour], closed:false, render:'fill', elements: ELEMENTS, spacing: 0.4 })
    // each band = 2 rings of P verts
    expect(g.positions.length).toBe(ELEMENTS * 2 * P * 3)
    expect(g.indices.length).toBe(ELEMENTS * 1 * P * 6)   // (rings-1)=1 quad-row per band
  })
  it('bands do not touch: consecutive band centres are gapped', () => {
    const g = buildSlicedLoftGeometry({ stations, props, baseContours: [contour], closed:false, render:'fill', elements: ELEMENTS, spacing: 0.4 })
    // along holds each band's centre t; there should be ELEMENTS distinct values
    const along = new Set(Array.from(g.along).map(v => Math.round(v*1000)/1000))
    expect(along.size).toBe(ELEMENTS)
  })
  it('stroke: each band is one outline ring → ELEMENTS*P*2 line indices', () => {
    const g = buildSlicedLoftGeometry({ stations, props, baseContours: [contour], closed:false, render:'stroke', elements: ELEMENTS, spacing: 0.4 })
    expect(g.indices.length).toBe(ELEMENTS * 1 * P * 2)
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Append implementation** — reuse the placement helper. Factor the per-station vertex placement out of `buildLoftGeometry` into a shared `placeRing(station, props, contour, out, offset)` if convenient, or inline the same math. Each band = 2 rings (fill: a thin skinned tube) or 1 ring (stroke: an outline). Band `i` centre `t_i = (i + 0.5)/elements`; the two fill rings sit at `t_i ± halfThickness` where `halfThickness = 0.5*(1-spacing)/elements`, mapped to the nearest sampled stations. `along` for every vertex of band `i` = `t_i`.

```ts
export function buildSlicedLoftGeometry(opts: {
  stations: Station[]; props: StopProps[]; baseContours: Vec2[][]
  closed: boolean; render: 'stroke' | 'fill'; elements: number; spacing: number
}): LoftGeometry {
  const { stations, props, baseContours, render, elements, spacing } = opts
  const K = stations.length
  const C = baseContours.length
  const P = C > 0 ? baseContours[0]!.length : 0
  const E = Math.max(1, Math.round(elements))
  const gap = Math.min(0.95, Math.max(0, spacing))
  const half = 0.5 * (1 - gap) / E
  const ringsPerBand = render === 'fill' ? 2 : 1
  const nVerts = E * ringsPerBand * C * P
  const positions = new Float32Array(nVerts * 3)
  const along = new Float32Array(nVerts)
  const stationAt = (t: number) => stations[Math.min(K - 1, Math.max(0, Math.round(t * (K - 1))))]!
  const propsAt = (t: number) => props[Math.min(K - 1, Math.max(0, Math.round(t * (K - 1))))]!
  let vo = 0
  const bandRingT: number[][] = []
  for (let i = 0; i < E; i++) {
    const tc = (i + 0.5) / E
    const ts = render === 'fill' ? [tc - half, tc + half] : [tc]
    bandRingT.push(ts)
    for (const t of ts) {
      const st = stationAt(t), pr = propsAt(t)
      const cr = Math.cos((pr.roll*Math.PI)/180), sr = Math.sin((pr.roll*Math.PI)/180)
      for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
        const v = baseContours[c]![p]!
        const lx = v.x*pr.width, ly = v.y*pr.height
        const rx = lx*cr - ly*sr, ry = lx*sr + ly*cr
        positions[vo*3]   = st.pos.x + rx*st.normal.x + ry*st.binormal.x
        positions[vo*3+1] = st.pos.y + rx*st.normal.y + ry*st.binormal.y
        positions[vo*3+2] = st.pos.z + rx*st.normal.z + ry*st.binormal.z
        along[vo] = tc
        vo++
      }
    }
  }
  const indices: number[] = []
  const idx = (band: number, ring: number, c: number, p: number) => ((band*ringsPerBand + ring)*C + c)*P + p
  if (render === 'fill') {
    for (let i = 0; i < E; i++) for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
      const np = (p+1)%P
      const a = idx(i,0,c,p), b = idx(i,0,c,np), d = idx(i,1,c,p), e = idx(i,1,c,np)
      indices.push(a,b,e, a,e,d)
    }
  } else {
    for (let i = 0; i < E; i++) for (let c = 0; c < C; c++) for (let p = 0; p < P; p++) {
      const np = (p+1)%P
      indices.push(idx(i,0,c,p), idx(i,0,c,np))
    }
  }
  return { positions, along, indices: new Uint32Array(indices) }
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** (pathspec). Verify marker `buildSlicedLoftGeometry` in HEAD.

---

### Task 4: Rewire `loft.ts` — new controls + buildScene switchover

**Files:**
- Modify: `frontend/app/lib/spacetype/effects/loft.ts`
- Test: `frontend/tests/unit/spacetype-loft-effect.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: `shapeContour`, `rampFromFill`, `buildSlicedLoftGeometry`, `buildLoftGeometry`, `sampleSpine`, `interpStopProps`, `buildRamp` (existing), `parseStops`.
- Produces: `loftEffect` with the refined control set. Exports a pure `resolveShape(params): LoftShape` helper (migration) for testing.

- [ ] **Step 1: Write failing tests**

```ts
// append to spacetype-loft-effect.unit.spec.ts
import { resolveShape } from '../../app/lib/spacetype/effects/loft'
describe('loft refinements', () => {
  it('resolveShape migrates old profileKind', () => {
    expect(resolveShape({ shape: 'star' } as any)).toBe('star')
    expect(resolveShape({ profileKind: 'word' } as any)).toBe('word' as any)  // word handled separately; see note
    expect(resolveShape({ profileKind: 'shape' } as any)).toBe('oval')
    expect(resolveShape({} as any)).toBe('oval')
  })
  it('spacing>0 builds discrete sliced geometry (more/mesh objects than continuous is not required, but drawable)', () => {
    const p = defaultFromControls()
    p.spacing = 0.4; p.shape = 'oval'; p.colorSource = 'fill'
    const root = loftEffect.buildScene(THREE as any, p, new THREE.Texture(), { width: 800, height: 800 })
    let drawable = 0; root.traverse((o:any)=>{ if(o.isMesh||o.isLineSegments) drawable++ })
    expect(drawable).toBeGreaterThan(0)
  })
  it('colorSource fill vs stops both produce a ramp texture on userData.tex', () => {
    for (const cs of ['fill','stops']) {
      const p = defaultFromControls(); (p as any).colorSource = cs
      const root = loftEffect.buildScene(THREE as any, p, new THREE.Texture(), { width: 800, height: 800 })
      expect((root.userData.tex as any).isTexture).toBe(true)
    }
  })
})
// helper in-test: function defaultFromControls(){ return defaultsFromControls(loftEffect.controls) }
```
Note on `resolveShape` + word: `shape` now includes `'word'` as an option. `resolveShape` returns the raw `shape` if valid, else migrates `profileKind` (`'word'→'word'`, else `'oval'`). Word rendering still branches on `shape === 'word'` in buildScene (reusing `wordContours`). Adjust the test's word expectation to whatever the final `LoftShape`+word union is — keep it internally consistent.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Update the control list** in `loft.ts` (replace `profileKind`; add shape params, colour, spacing):

```ts
// Style group — shape picker replaces profileKind
{ key: 'shape', label: 'Shape', kind: 'select', options: ['oval','capsule','rectangle','polygon','star','word'], default: 'oval', group: 'Style' },
{ key: 'rectRadius', label: 'Corner radius', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0.4, group: 'Style', showIf: { key: 'shape', equals: 'rectangle' } },
{ key: 'polySides', label: 'Sides', kind: 'slider', min: 3, max: 16, step: 1, default: 5, group: 'Style', showIf: { key: 'shape', equals: 'polygon' } },
{ key: 'starSides', label: 'Points', kind: 'slider', min: 3, max: 16, step: 1, default: 5, group: 'Style', showIf: { key: 'shape', equals: 'star' } },
{ key: 'starDepth', label: 'Star depth', kind: 'slider', min: 0, max: 0.9, step: 0.02, default: 0.5, group: 'Style', showIf: { key: 'shape', equals: 'star' } },
{ key: 'text', label: 'Word', kind: 'text', default: 'LOFT', group: 'Style', showIf: { key: 'shape', equals: 'word' } },
{ key: 'font', label: 'Font', kind: 'font', default: 'google:Archivo Black@700', group: 'Style', showIf: { key: 'shape', equals: 'word' } },
// Colour group
{ key: 'colorSource', label: 'Colour source', kind: 'select', options: ['fill','stops'], default: 'fill', group: 'Color' },
{ key: 'fills', label: 'Fill', kind: 'fillList', default: defaultFillsFor(1, 'loft'), group: 'Color', showIf: { key: 'colorSource', equals: 'fill' } },
// Layout group — spacing
{ key: 'spacing', label: 'Spacing', kind: 'slider', min: 0, max: 0.9, step: 0.02, default: 0.35, group: 'Layout' },
{ key: 'elements', label: 'Elements', kind: 'slider', min: 4, max: 120, step: 1, default: 40, group: 'Layout', showIf: { key: 'spacing', notEquals: 0 } },
```
Keep `stops`, `spinePreset`, `closed`, `copies`, `render`, `strokeOpacity`, `fillOpacity`, `mode`, `flow`, `spin`, and the Transform controls. Remove the old `profileKind`. Add imports: `defaultFillsFor` from `../palette`; `shapeContour`, `rampFromFill`, `buildSlicedLoftGeometry`, type `LoftShape` from `../loftGeometry`.

- [ ] **Step 4: Add `resolveShape` + rewire `buildScene`.**

```ts
export function resolveShape(params: Params): LoftShape | 'word' {
  const s = String(params.shape ?? '')
  if (['oval','capsule','rectangle','polygon','star','word'].includes(s)) return s as any
  const pk = String(params.profileKind ?? '')   // migrate old docs
  return pk === 'word' ? 'word' : 'oval'
}
```
In `buildScene`, after `parseStops` + `sampleSpine` + `props`:
- Determine `shape = resolveShape(params)`.
- `baseContours`:
  - `shape === 'word'` → `wordContours(three, params, PROFILE_POINTS) ?? [shapeContour('oval', shapeParams, PROFILE_POINTS)]`.
  - else → `[shapeContour(shape, { rectRadius: n(params,'rectRadius'), polySides: shape==='star' ? n(params,'starSides') : n(params,'polySides'), starDepth: n(params,'starDepth') }, PROFILE_POINTS)]`.
- Geometry: if `Number(params.spacing) > 0` → `buildSlicedLoftGeometry({ ..., elements: n(params,'elements'), spacing: n(params,'spacing') })`; else → `buildLoftGeometry({...})` (as today).
- Ramp: `const rampBytes = String(params.colorSource) === 'stops' ? buildRamp(stops, 256) : rampFromFill(three, String(params.fills ?? ''), 256)`. Feed `new Uint8Array(rampBytes)` into the `DataTexture` exactly as today; store on `root.userData.tex`.
- Everything else (ShaderMaterial, LineSegments/Mesh, update, liveKeys, loopRates) unchanged. Add `fills`, `colorSource`, `shape`, `spacing`, `elements` — none are liveKeys (all structural), so they trigger rebuild automatically.

- [ ] **Step 5: Run tests, verify pass; typecheck** (`grep -E 'loft|resolveShape'`).
- [ ] **Step 6: Commit** (pathspec: loft.ts + the test). Verify markers `resolveShape`, `buildSlicedLoftGeometry`, `rampFromFill`, `shapeContour` all referenced in HEAD loft.ts.

---

### Task 5: Slim the stop model + declutter the editor

**Files:**
- Modify: `frontend/app/lib/spacetype/loftStops.ts` (drop `sides`/`radius`)
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (`StopProps`/`interpStopProps` drop sides/radius; retire `parametricProfileContour` or keep unused)
- Modify: `frontend/app/components/vue-canvas/ProfileStopsEditor.vue` (remove Sides/Radius rows)
- Test: update `spacetype-loft-stops.unit.spec.ts`, `spacetype-loft-geometry.unit.spec.ts` to drop sides/radius references.

Do this AFTER Task 4 (nothing consumes per-stop sides/radius once the effect uses `shapeContour`).

- [ ] **Step 1: Update `LoftStop` + `sanitizeStop`** — remove `sides` and `radius` fields; `sanitizeStop` stops emitting them; `presetStops` stops setting them. `parseStops` still tolerates old docs (extra keys ignored — they just aren't copied out).
- [ ] **Step 2: Update `StopProps`/`interpStopProps`** — remove `sides`/`radius`. Delete `parametricProfileContour` and its tests (its role is now `shapeContour('oval',…)`), OR keep it but unreferenced (prefer delete to avoid dead code — the reviewer will flag dead code). Update the geometry tests that constructed `{width,height,radius,sides,roll}` StopProps to `{width,height,roll}`.
- [ ] **Step 3: Editor** — in `ProfileStopsEditor.vue`, remove the two `<label>`…`Radius`…`</label>` and `Sides` slider rows from the selected-stop inspector. Keep Depth/Width/Height/Roll and the StudioColor. Update the `LoftStop` construction in `addStop` (drop radius/sides).
- [ ] **Step 4: Run the full loft suite** — `npx vitest run tests/unit/spacetype-loft-*.unit.spec.ts` — all green after the test updates. Typecheck: no new errors (the removed fields aren't referenced anywhere — grep `\.radius\|\.sides` under `spacetype` to confirm no stragglers, excluding `polySides`/`starSides`/`rectRadius`).
- [ ] **Step 5: Commit** (pathspec: the 3 source files + the 2 test files). Verify `git show HEAD:frontend/app/lib/spacetype/loftStops.ts | grep -c "sides"` is 0 (field gone).

---

### Task 6: Full-suite green + runtime proof + docs

**Files:** none (verification) + `docs/STATE.md`.

- [ ] **Step 1: Full loft suite + broad spacetype suite** — `npm run test:unit -- tests/unit/spacetype-loft-*` then a broad `spacetype-*` run; note load average, compare file/test totals to baseline. No NEW failures.
- [ ] **Step 2: Typecheck** — `npx vue-tsc --noEmit 2>&1 | grep -iE 'loft|shape|ramp|profileStops' || echo clean`.
- [ ] **Step 3: Runtime proof (controller drives the Browser pane).** On the shared dev server, Type Studio → Loft: (a) Shape picker switches oval→capsule→rectangle→polygon→star, each visibly changing the cross-section; (b) Colour source = fill with a gradient renders the gradient along the sweep; switch to per-stop shows the stop colours; (c) Spacing > 0 breaks the sweep into discrete stacked rings, Elements changes their count; (d) Word still renders (regression). Assert the path (screenshots + no console errors). Broken-control check: set `polySides` to 3 and confirm a triangle cross-section.
- [ ] **Step 4: Update `docs/STATE.md`** — extend the Loft entry with the refinements (shape picker, fill-control colour, spacing). Pathspec commit.

---

## Self-review

**Spec coverage:** Shape picker → Task 1 (geometry) + Task 4 (control/wiring). Fill control + per-stop → Task 2 + Task 4 (colorSource/ramp source). Spacing → Task 3 + Task 4. Stop-model slim + editor declutter → Task 5. Migration (`profileKind`→`shape`, drop sides/radius) → Task 4 `resolveShape` + Task 5 `parseStops`. Defaults (oval/fill+gradient/slight spacing) → Task 4 control defaults. ✓

**Placeholder scan:** Two "confirm against current code" points are called out with the exact grep: the gradient fill's `.a`/`.b` field names in `rampFromFill` (Task 2), and the `parseFills` output shape. These are verify-the-local-name steps, not unresolved design.

**Type consistency:** `LoftShape`, `ShapeParams`, `shapeContour`, `rampFromFill`, `buildSlicedLoftGeometry`, `resolveShape` are defined once and consumed with the same names in Task 4. `polySides`/`starSides`/`rectRadius`/`starDepth` control keys are distinct from the removed per-stop `sides`/`radius` (Task 5 greps to confirm no collision).

**Ordering guard:** Tasks 1-3 are additive (build stays green). Task 4 switches the effect onto them. Task 5 removes the now-dead per-stop fields ONLY after Task 4 stopped using them. This keeps every task independently green.
