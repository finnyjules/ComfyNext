# Space Type — Loft stroke width + fill distribution + filled caps (round 3a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three fill/stroke refinements to the Loft effect — spread multiple fills across the sweep with a Blend/Per-circle toggle, cap the cross-section so Fill produces solid discs, and give strokes a real adjustable width via ribbon geometry.

**Architecture:** All geometry lives in the pure `loftGeometry.ts` core. Item B rewrites `rampFromFill` to flatten the fills list into colour stops with a blend/steps mode. Item C adds centroid-fan cap emission to the fill path of both geometry builders. Item A adds an outline→ribbon expansion to the stroke path of both builders, rendered as a `Mesh` (not GL lines) with the existing gradient `ShaderMaterial`. The effect wires new `fillMode` + `strokeWidth` controls.

**Tech Stack:** Nuxt 4, Vue 3.5, TypeScript, three.js, Vitest (node env).

## Global Constraints

- **Frontend cwd:** `frontend/`. Test: `npx vitest run tests/unit/<file>.unit.spec.ts`.
- **`buildScene` stays synchronous**; per-scene state on `root.userData.tex`/`loftState`; the material is a `ShaderMaterial` with `side: DoubleSide` (cap/ribbon winding therefore doesn't affect visibility).
- **Contours are unit-space** built in [-1,1]², resampled to a shared `P`; per-station width/height scale + roll are applied at placement (`lx=v.x*width, ly=v.y*height`, then rotate by roll, then `pos + rx*normal + ry*binormal`). New geometry MUST reuse that exact placement.
- **Reuse the shared fill system:** `parseFills`/`fillPrimary` from `~/lib/spacetype/fills`. `hexToRgbTuple` already exists in `loftGeometry.ts` (added with the original `rampFromFill`).
- **Commit hygiene — HARDENED (parallel sessions share the git index AND working tree):** commit via PATHSPEC `git commit <explicit-paths> -m` (never `git add`+bare commit, never `-A`, never `stash`); `git add` a NEW test file first. After committing, verify `git show HEAD:<file> | grep -c <marker>`; re-commit via pathspec if swept.
- **Typecheck baseline** ~328; the pre-existing `SpaceTypeSurface.vue` `onVibeRevert` (~line 160) error is NOT yours.
- Control `group`s `Style`/`Color` are valid sections (verified in prior rounds).

## Shared signatures (define exactly; later tasks depend on these)

```ts
// loftGeometry.ts
export function rampFromFill(three: typeof THREE, fillsJson: string, size: number, mode?: 'blend' | 'steps'): Uint8ClampedArray
// buildLoftGeometry / buildSlicedLoftGeometry opts gain:
//   cap?: boolean          // fill mode: emit centroid-fan caps (default false)
//   strokeWidth?: number   // stroke mode: ribbon half-width source (default 0 → thin fallback lines off; use ribbons when > 0)
```

---

### Task 1: `rampFromFill` — spread all fills as stops + blend/steps mode + `fillMode` control (item B)

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (`rampFromFill`)
- Modify: `frontend/app/lib/spacetype/effects/loft.ts` (add `fillMode` control; pass mode)
- Test: `frontend/tests/unit/spacetype-loft-fill.unit.spec.ts` (new)

**Interfaces:**
- Produces: `rampFromFill(three, fillsJson, size, mode='blend')`. Flattens fills → colour stops (solid/pattern → 1 primary stop; gradient/ombre → 2 stops `a`,`b`), evenly spaced; `blend` interpolates, `steps` hard-bands (stop `j` owns `t∈[j/M,(j+1)/M)`).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-loft-fill.unit.spec.ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { rampFromFill } from '../../app/lib/spacetype/loftGeometry'

const rgbAt = (r: Uint8ClampedArray, i: number) => [r[i*4], r[i*4+1], r[i*4+2]]

describe('rampFromFill — multi-fill spread', () => {
  it('two solids blend: endpoints are the two colours, midpoint between', () => {
    const fills = JSON.stringify([{ type: 'solid', color: '#ff0000' }, { type: 'solid', color: '#0000ff' }])
    const r = rampFromFill(THREE as any, fills, 64, 'blend')
    expect(rgbAt(r, 0)[0]).toBeGreaterThan(200)          // start red
    expect(rgbAt(r, 63)[2]).toBeGreaterThan(200)         // end blue
    const mid = rgbAt(r, 32); expect(mid[0]).toBeGreaterThan(60); expect(mid[2]).toBeGreaterThan(60) // purple-ish
  })
  it('two solids steps: first half solid colour1, second half solid colour2 (hard boundary)', () => {
    const fills = JSON.stringify([{ type: 'solid', color: '#ff0000' }, { type: 'solid', color: '#0000ff' }])
    const r = rampFromFill(THREE as any, fills, 64, 'steps')
    expect(rgbAt(r, 10)).toEqual([255, 0, 0])            // first band pure red
    expect(rgbAt(r, 54)).toEqual([0, 0, 255])            // second band pure blue
    // no purple blend anywhere
    for (let i = 0; i < 64; i++) { const c = rgbAt(r, i); expect(c[0] === 255 || c[2] === 255).toBe(true) }
  })
  it('single ombre blend: a→b gradient (unchanged behaviour)', () => {
    const fills = JSON.stringify([{ type: 'ombre', a: '#000000', b: '#ffffff' }])
    const r = rampFromFill(THREE as any, fills, 64, 'blend')
    const s = rgbAt(r, 0).reduce((a,b)=>a+b,0), e = rgbAt(r, 63).reduce((a,b)=>a+b,0)
    expect(e).toBeGreaterThan(s + 200)
  })
  it('default mode is blend; malformed tolerant', () => {
    expect(rampFromFill(THREE as any, JSON.stringify([{type:'solid',color:'#fff'}]), 32).length).toBe(32*4)
    expect(rampFromFill(THREE as any, 'garbage', 16).length).toBe(16*4)
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/unit/spacetype-loft-fill.unit.spec.ts` → FAIL (steps mode not supported; multi-fill ignored).

- [ ] **Step 3: Rewrite `rampFromFill`** (replace the whole function body):

```ts
export function rampFromFill(three: typeof THREE, fillsJson: string, size: number, mode: 'blend' | 'steps' = 'blend'): Uint8ClampedArray {
  let fills: any[]
  try { fills = parseFills(fillsJson) } catch { fills = [] }
  const stops: [number, number, number][] = []
  for (const f of fills) {
    const type = String(f?.type)
    if ((type === 'gradient' || type === 'ombre') && f.a && f.b) {
      stops.push(hexToRgbTuple(f.a), hexToRgbTuple(f.b))
    } else {
      let c: [number, number, number]
      try { const col = fillPrimary(three, f); c = [Math.round(col.r * 255), Math.round(col.g * 255), Math.round(col.b * 255)] }
      catch { c = [136, 136, 136] }
      stops.push(c)
    }
  }
  if (stops.length === 0) stops.push([136, 136, 136])
  const M = stops.length
  const out = new Uint8ClampedArray(size * 4)
  for (let i = 0; i < size; i++) {
    const t = size > 1 ? i / (size - 1) : 0
    let rgb: [number, number, number]
    if (M === 1) rgb = stops[0]!
    else if (mode === 'steps') rgb = stops[Math.min(M - 1, Math.floor(t * M))]!
    else {
      const x = t * (M - 1), j0 = Math.min(M - 1, Math.floor(x)), j1 = Math.min(M - 1, j0 + 1), a = x - j0
      const c0 = stops[j0]!, c1 = stops[j1]!
      rgb = [c0[0] + (c1[0] - c0[0]) * a, c0[1] + (c1[1] - c0[1]) * a, c0[2] + (c1[2] - c0[2]) * a]
    }
    out[i * 4] = Math.round(rgb[0]); out[i * 4 + 1] = Math.round(rgb[1]); out[i * 4 + 2] = Math.round(rgb[2]); out[i * 4 + 3] = 255
  }
  return out
}
```
(`hexToRgbTuple`, `parseFills`, `fillPrimary` already imported/defined in this file from the original `rampFromFill`.)

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Add the `fillMode` control + pass the mode** in `loft.ts`.
  - After the `fills` control, add:
    ```ts
    { key: 'fillMode', label: 'Fill mode', kind: 'select', options: ['blend', 'steps'], default: 'blend', group: 'Color', showIf: { key: 'colorSource', equals: 'fill' } },
    ```
  - In `buildScene`, change the ramp line to pass the mode:
    ```ts
    const rampBytes = String(params.colorSource) === 'stops'
      ? buildRamp(stops, 256)
      : rampFromFill(three as any, String(params.fills ?? ''), 256, String(params.fillMode) === 'steps' ? 'steps' : 'blend')
    ```
    (Keep the existing `new Uint8Array(rampBytes)` → DataTexture wiring.)

- [ ] **Step 6: Verify + commit.** Run `npx vitest run tests/unit/spacetype-loft-fill.unit.spec.ts tests/unit/spacetype-loft-effect.unit.spec.ts` (green); typecheck `npx vue-tsc --noEmit 2>&1 | grep -E 'loft|rampFromFill|fillMode' || echo clean`.
  ```bash
  git add frontend/tests/unit/spacetype-loft-fill.unit.spec.ts
  git commit frontend/app/lib/spacetype/loftGeometry.ts frontend/app/lib/spacetype/effects/loft.ts frontend/tests/unit/spacetype-loft-fill.unit.spec.ts -m "feat(spacetype): loft — spread fills across sweep + blend/steps fill mode"
  ```
  Verify: `git show HEAD:frontend/app/lib/spacetype/effects/loft.ts | grep -c fillMode` (>0).

---

### Task 2: Filled cross-section caps (item C)

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (`buildLoftGeometry`, `buildSlicedLoftGeometry`)
- Modify: `frontend/app/lib/spacetype/effects/loft.ts` (pass `cap`)
- Test: `frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts` (append)

**Interfaces:**
- Both builders' opts gain `cap?: boolean` (default false). When `render==='fill' && cap`, emit centroid-fan caps. `buildLoftGeometry` (continuous): cap the first and last station (skip if `closed`). `buildSlicedLoftGeometry` (sliced): cap BOTH rings of every band. A cap = 1 appended centroid vertex (at the ring-centre = the station `pos`, `along = that ring's t`) + `P` fan triangles `(centroid, idx(...,p), idx(...,p+1))` per contour.

- [ ] **Step 1: Add failing tests** (append to `spacetype-loft-geometry.unit.spec.ts`):

```ts
describe('cross-section caps (fill)', () => {
  const P = 12
  const stopsFix = [
    { id:'a', x:0, y:0.5, z:0, width:1, height:1, roll:0, color:'#000000' },
    { id:'b', x:1, y:0.5, z:0, width:1, height:1, roll:0, color:'#ffffff' },
  ]
  const contour = shapeContour('oval', { rectRadius:0.5, polySides:5, starDepth:0.5 }, P)

  it('continuous fill caps: exactly 2 end caps → +2 centroid verts and +2*P cap triangles', () => {
    const K = 10
    const st = sampleSpine(stopsFix as any, false, K)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const base = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill' })
    const capped = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', cap:true })
    expect(capped.positions.length).toBe(base.positions.length + 2 * 1 * 3)      // +2 centroid verts (C=1)
    expect(capped.indices.length).toBe(base.indices.length + 2 * 1 * P * 3)      // +2 caps * P tris * 3
  })
  it('closed continuous fill: no caps (closed tube has no ends)', () => {
    const K = 12
    const st = sampleSpine(stopsFix as any, true, K)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const a = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:true, render:'fill' })
    const b = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:true, render:'fill', cap:true })
    expect(b.positions.length).toBe(a.positions.length)
    expect(b.indices.length).toBe(a.indices.length)
  })
  it('sliced fill caps: 2 caps per band → +2*E centroids and +2*E*P cap triangles', () => {
    const E = 5
    const st = sampleSpine(stopsFix as any, false, 200)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const base = buildSlicedLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', elements:E, spacing:0.4 })
    const capped = buildSlicedLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', elements:E, spacing:0.4, cap:true })
    expect(capped.positions.length).toBe(base.positions.length + 2 * E * 1 * 3)
    expect(capped.indices.length).toBe(base.indices.length + 2 * E * 1 * P * 3)
  })
  it('cap ignored in stroke mode', () => {
    const st = sampleSpine(stopsFix as any, false, 10)
    const props = st.map(() => ({ width:1, height:1, roll:0 }))
    const a = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'stroke' })
    const b = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'stroke', cap:true })
    expect(b.positions.length).toBe(a.positions.length)
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/unit/spacetype-loft-geometry.unit.spec.ts` → FAIL (cap not supported; sizes unchanged).

- [ ] **Step 3: Implement caps in `buildLoftGeometry`.** After the existing grid fill (positions/along/wall-indices built), before `return`, add cap emission. The current function allocates `positions`/`along` to the grid size; capping needs extra vertices, so build the cap vertices/indices into arrays and CONCATENATE. Change the return to merge:

```ts
  // ...existing wall `indices: number[]` built for fill...
  if (render === 'fill' && opts.cap && !closed) {
    const capStations = [0, K - 1]
    const extraPos: number[] = [], extraAlong: number[] = []
    let capVo = K * C * P                       // next vertex index after the grid
    for (const i of capStations) {
      const st = stations[i]!
      for (let c = 0; c < C; c++) {
        const cIdx = capVo++
        extraPos.push(st.pos.x, st.pos.y, st.pos.z); extraAlong.push(st.t)
        for (let p = 0; p < P; p++) { const np = (p + 1) % P; indices.push(cIdx, idx(i, c, p), idx(i, c, np)) }
      }
    }
    if (extraPos.length) {
      const mergedPos = new Float32Array(positions.length + extraPos.length)
      mergedPos.set(positions); mergedPos.set(extraPos, positions.length)
      const mergedAlong = new Float32Array(along.length + extraAlong.length)
      mergedAlong.set(along); mergedAlong.set(extraAlong, along.length)
      return { positions: mergedPos, along: mergedAlong, indices: new Uint32Array(indices) }
    }
  }
  return { positions, along, indices: new Uint32Array(indices) }
```
(If the function already returns `new Uint32Array(indices)` in a single tail statement, restructure so the cap block runs before that tail and can return the merged buffers. `idx` is the existing `(i,c,p) => ((i*C+c)*P+p)` helper; `K`,`C`,`P` already in scope.)

- [ ] **Step 4: Implement caps in `buildSlicedLoftGeometry`.** Each band has `ringsPerBand` rings; for `render==='fill' && opts.cap`, cap BOTH rings of each band. The ring's centroid = the interpolated station `pos` at that ring's `t` (the same `stationAt(t)` used to place the ring). Append centroid verts + fan indices, then merge:

```ts
  // ...existing band positions/along + wall indices...
  if (render === 'fill' && opts.cap) {
    const extraPos: number[] = [], extraAlong: number[] = []
    let capVo = nVerts                          // next index after the band grid
    for (let i = 0; i < E; i++) {
      const tc = (i + 0.5) / E
      const ts = [tc - half, tc + half]
      for (let ring = 0; ring < ringsPerBand; ring++) {
        const st = stationAt(ts[ring]!)         // interpolated station (same helper the rings use)
        for (let c = 0; c < C; c++) {
          const cIdx = capVo++
          extraPos.push(st.pos.x, st.pos.y, st.pos.z); extraAlong.push(tc)
          for (let p = 0; p < P; p++) { const np = (p + 1) % P; indices.push(cIdx, idx(i, ring, c, p), idx(i, ring, c, np)) }
        }
      }
    }
    if (extraPos.length) {
      const mp = new Float32Array(positions.length + extraPos.length); mp.set(positions); mp.set(extraPos, positions.length)
      const ma = new Float32Array(along.length + extraAlong.length); ma.set(along); ma.set(extraAlong, along.length)
      return { positions: mp, along: ma, indices: new Uint32Array(indices) }
    }
  }
  return { positions, along, indices: new Uint32Array(indices) }
```
(`ringsPerBand` is 2 in fill mode; `stationAt`/`half`/`E`/`nVerts`/`idx(band,ring,c,p)` are the existing locals — reuse them exactly, adapting names to whatever the committed function uses.)

- [ ] **Step 5: Run, verify pass** — `npx vitest run tests/unit/spacetype-loft-geometry.unit.spec.ts` (all green, including the topology guards from prior rounds).

- [ ] **Step 6: Pass `cap` from the effect.** In `loft.ts` `buildScene`, both fill geometry calls pass `cap: resolveShape(params) !== 'word'` (skip caps for word). E.g.:
  ```ts
  const cap = resolveShape(params) !== 'word'
  const geo = Number(params.spacing) > 0
    ? buildSlicedLoftGeometry({ stations, props, baseContours, closed, render, elements, spacing, cap })
    : buildLoftGeometry({ stations, props, baseContours, closed, render, cap })
  ```
  (`cap` is ignored when `render==='stroke'` inside the builders, so passing it always is fine.)

- [ ] **Step 7: Typecheck + commit.** `npx vue-tsc --noEmit 2>&1 | grep -E 'loft|buildLoftGeometry|buildSlicedLoftGeometry' || echo clean`.
  ```bash
  git commit frontend/app/lib/spacetype/loftGeometry.ts frontend/app/lib/spacetype/effects/loft.ts frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts -m "feat(spacetype): loft — cap cross-sections so Fill makes solid discs"
  ```
  Verify: `git show HEAD:frontend/app/lib/spacetype/loftGeometry.ts | grep -c "opts.cap"` (>0).

---

### Task 3: Stroke width via ribbons (item A)

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (ribbon helper + stroke path of both builders)
- Modify: `frontend/app/lib/spacetype/effects/loft.ts` (`strokeWidth` control; render stroke as `Mesh`)
- Test: `frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts` (append)

**Interfaces:**
- Both builders' opts gain `strokeWidth?: number` (default 0). When `render==='stroke'` and `strokeWidth > 0`, emit RIBBON mesh geometry (triangles) instead of line-segment indices: each contour point becomes an inner+outer pair offset by `±strokeWidth/2` along the in-plane outline normal, triangulated as a closed strip per contour loop. Vertex count = `2·(K or bands)·C·P`; `along` preserved per pair. When `strokeWidth === 0`, keep the existing line-segment output (back-compat).

- [ ] **Step 1: Add failing tests** (append):

```ts
describe('stroke ribbons (width)', () => {
  const P = 10
  const stopsFix = [
    { id:'a', x:0, y:0.5, z:0, width:1, height:1, roll:0, color:'#000000' },
    { id:'b', x:1, y:0.5, z:0, width:1, height:1, roll:0, color:'#ffffff' },
  ]
  const contour = shapeContour('oval', { rectRadius:0.5, polySides:5, starDepth:0.5 }, P)
  const st = sampleSpine(stopsFix as any, false, 8)
  const props = st.map(() => ({ width:1, height:1, roll:0 }))

  it('strokeWidth>0 emits a ribbon: 2x vertices and triangle indices (6 per contour edge)', () => {
    const g = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'stroke', strokeWidth:0.06 })
    expect(g.positions.length).toBe(8 * 1 * P * 2 * 3)        // 2x verts (inner+outer)
    expect(g.indices.length).toBe(8 * 1 * P * 6)              // 2 tris per edge * 3
  })
  it('inner and outer edges are offset apart (ribbon has width)', () => {
    const g = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'stroke', strokeWidth:0.1 })
    // vertex 0 (inner p0) vs vertex 1 (outer p0) should differ by ~strokeWidth
    const d = Math.hypot(g.positions[0]-g.positions[3], g.positions[1]-g.positions[4], g.positions[2]-g.positions[5])
    expect(d).toBeGreaterThan(0.05); expect(d).toBeLessThan(0.2)
  })
  it('strokeWidth 0 keeps line-segment output (back-compat)', () => {
    const g = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'stroke', strokeWidth:0 })
    expect(g.indices.length).toBe(8 * 1 * P * 2)             // line-segment pairs
  })
})
```
(Adapt the exact vertex-layout assertion — inner then outer per point — to how you implement it; the KEY invariants are 2× vertices, triangle index count `6·P` per ring, and non-zero inner/outer separation.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Add the ribbon helper** to `loftGeometry.ts`. Operate in the station's 2D plane (scaled+rolled contour coords), offset along the in-plane normal:

```ts
/** Expand a closed 2D contour (already width/height-scaled + rolled, in the station's
 *  normal/binormal plane) into inner/outer edge points offset by ±halfWidth along each
 *  point's in-plane normal (perpendicular to the local outline direction). Returns 2·P
 *  points as [inner0, outer0, inner1, outer1, …]. Corner artifacts at very sharp concave
 *  vertices are accepted for v1. */
function ribbonEdges(pts2d: Vec2[], halfWidth: number): Vec2[] {
  const P = pts2d.length, out: Vec2[] = []
  for (let k = 0; k < P; k++) {
    const prev = pts2d[(k - 1 + P) % P]!, next = pts2d[(k + 1) % P]!
    const dx = next.x - prev.x, dy = next.y - prev.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len, ny = dx / len                   // in-plane normal
    const p = pts2d[k]!
    out.push({ x: p.x - nx * halfWidth, y: p.y - ny * halfWidth })   // inner
    out.push({ x: p.x + nx * halfWidth, y: p.y + ny * halfWidth })   // outer
  }
  return out
}
```

- [ ] **Step 4: Wire ribbons into the stroke path** of `buildLoftGeometry` and `buildSlicedLoftGeometry`. When `render==='stroke' && (opts.strokeWidth ?? 0) > 0`: for each ring, compute the scaled+rolled 2D contour points (the same `lx/ly` + roll the fill path computes, BEFORE the `pos + normal/binormal` step), pass through `ribbonEdges(pts2d, strokeWidth/2)` → 2·P points, place EACH to 3D via the station frame, write `along` = the ring's t for every point. Index as a closed triangle strip: for edge `k`, quad `(inner_k, outer_k, outer_{k+1}, inner_{k+1})` → two triangles. Keep the `strokeWidth===0` branch emitting the existing line-segment indices unchanged. Factor the "2D contour point for (station, contour)" computation so fill/stroke/cap share it.

  Concretely, per ring the scaled+rolled 2D point for contour vertex `v` is:
  ```ts
  const cr = Math.cos(roll*Math.PI/180), sr = Math.sin(roll*Math.PI/180)
  const lx = v.x*width, ly = v.y*height
  const p2 = { x: lx*cr - ly*sr, y: lx*sr + ly*cr }   // rolled 2D
  ```
  and placement of a 2D point `q` to 3D is `pos + q.x*normal + q.y*binormal`.

- [ ] **Step 5: Run, verify pass** (all geometry tests green).

- [ ] **Step 6: Add `strokeWidth` control + render stroke as Mesh** in `loft.ts`.
  - Add control (near `strokeOpacity`):
    ```ts
    { key: 'strokeWidth', label: 'Stroke width', kind: 'slider', min: 0.005, max: 0.3, step: 0.005, default: 0.04, group: 'Style', showIf: { key: 'render', equals: 'stroke' } },
    ```
  - In `buildScene`, pass `strokeWidth: n(params, 'strokeWidth')` into both geometry-builder calls (harmless in fill mode).
  - Change the render-object line so stroke is now a `Mesh` (ribbon triangles), not `LineSegments`:
    ```ts
    const obj = new three.Mesh(g, mat)
    ```
    (Both modes are Mesh now. Remove the `render === 'stroke' ? LineSegments : Mesh` branch. `depthWrite` logic can stay keyed on opacity.)

- [ ] **Step 7: Typecheck + effect test + commit.** `npx vitest run tests/unit/spacetype-loft-effect.unit.spec.ts tests/unit/spacetype-loft-geometry.unit.spec.ts`; typecheck grep clean. Update the effect test that asserted stroke builds `LineSegments` (it now builds `Mesh`) — change the assertion to expect a Mesh in stroke mode.
  ```bash
  git commit frontend/app/lib/spacetype/loftGeometry.ts frontend/app/lib/spacetype/effects/loft.ts frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts frontend/tests/unit/spacetype-loft-effect.unit.spec.ts -m "feat(spacetype): loft — real stroke width via ribbon geometry"
  ```
  Verify: `git show HEAD:frontend/app/lib/spacetype/effects/loft.ts | grep -c "key: 'strokeWidth'"` (>0).

---

### Task 4: Full-suite green + runtime proof + docs

**Files:** none (verification) + `docs/STATE.md`.

- [ ] **Step 1: Full loft suite** — `npx vitest run tests/unit/spacetype-loft-*.unit.spec.ts` — note load avg + file/test totals; no NEW failures.
- [ ] **Step 2: Typecheck** — `npx vue-tsc --noEmit 2>&1 | grep -iE 'loft|ramp|stroke|cap|fillMode' || echo clean`.
- [ ] **Step 3: Runtime proof (controller drives the Browser pane).** Type/Expressive Studio → Loft: (a) **Fill** now shows **solid filled discs** (spaced = solid coins; continuous = closed tube) — the reported bug; (b) add a 2nd fill → colours **spread** across the sweep; toggle **Fill mode** Blend↔Steps (smooth gradient vs hard bands); (c) **Stroke** mode → move **Stroke width**; the outlines visibly thicken. Assert path (screenshots + no console errors). Broken-control check: set strokeWidth to max and confirm the ribbon obviously thickens.
- [ ] **Step 4: Update `docs/STATE.md`** — extend the Loft "Refined" entry with round 3a (stroke width, fill spread + blend/steps, filled-disc caps). Pathspec commit.

---

## Self-review

**Spec coverage:** A stroke width → Task 3 (ribbon helper + control). B fill distribution → Task 1 (`rampFromFill` stops + `fillMode`). C filled caps → Task 2 (cap emission + `cap` opt, word-skip). Runtime + docs → Task 4. ✓

**Placeholder scan:** the "adapt names to the committed function's locals" notes (Tasks 2/3) are real — the implementer must read the current `buildLoftGeometry`/`buildSlicedLoftGeometry` locals (`idx`, `stationAt`, `half`, `E`, `nVerts`, `ringsPerBand`) and reuse them. That's "match the existing code", not an unresolved design. Every code step shows the code.

**Type consistency:** `rampFromFill(three, fillsJson, size, mode)` — the 4th param is optional; Task 1 adds it, the effect passes it. `cap`/`strokeWidth` are optional opts added to both builders; the effect passes them in Task 2/3. `ribbonEdges`/`resolveShape`/`shapeContour`/`hexToRgbTuple` names match their definitions.

**Ordering guard:** Task 1 (ramp) is isolated. Task 2 (caps) is additive to fill (default `cap=false` → unchanged until the effect passes it, same commit). Task 3 (stroke ribbons) changes stroke rendering + the effect's render object; the `strokeWidth===0` branch preserves old line output so the geometry tests that predate this stay green until updated in-task. Each task ends green.
