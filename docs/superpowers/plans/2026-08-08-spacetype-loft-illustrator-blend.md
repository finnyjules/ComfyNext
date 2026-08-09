# Space Type — Loft Illustrator-style 2-D blend colour (round 3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make loft colour work like Illustrator's blend — each fill paints a whole circle's face (gradient across the circle), fills map first→last, circles between blend — by replacing the 1-D along-sweep ramp with a 2-D (across × along) colour texture.

**Architecture:** Pure geometry core adds a per-vertex `aAcross` coordinate (position across the cross-section along the fill's gradient angle) alongside the existing `aAlong`. A new `build2DFillRamp` builds a 2-D colour texture from the fills list (each along-row = the interpolated keyframe fill at that position, sampled across its gradient). The effect uploads it as a 2-D `DataTexture` and the shader samples `vec2(vAcross, vAlong)`.

**Tech Stack:** Nuxt 4, Vue 3.5, TypeScript, three.js, Vitest (node env).

## Global Constraints

- **Frontend cwd:** `frontend/`. Test: `npx vitest run tests/unit/<file>.unit.spec.ts`.
- **`buildScene` stays synchronous**; per-scene state on `root.userData.tex`; `ShaderMaterial`, `side: DoubleSide`.
- Reuse `parseFills`/`fillPrimary` from `~/lib/spacetype/fills`; `hexToRgbTuple` exists in `loftGeometry.ts`.
- **Angle convention:** gradient direction for angle θ° is `(cos θ, sin θ)`, so θ=90 → vertical (uses the contour point's y). `across = clamp01((v.x·cosθ + v.y·sinθ + 1)/2)` computed from the UNIT contour point `v` (before width/height scale and roll — the gradient is painted on the shape and follows it). Representative angle = the FIRST gradient/ombre fill's `angle`, else 90.
- **2-D texture layout:** row-major, `width = acrossSize`, `height = alongSize`; pixel `(ux, vy)` at byte `(vy*acrossSize + ux)*4`. Sampled `texture2D(uRamp, vec2(vAcross, vAlong))` (U=across=width, V=along=height). Use `acrossSize=64`, `alongSize=256`. Texture wrap = ClampToEdge (default) so `aAcross` slightly outside [0,1] at sharp corners clamps to the edge colour.
- **Commit hygiene — HARDENED (parallel sessions share git index + working tree):** commit via PATHSPEC `git commit <paths> -m`; `git add` new test files first; never `-A`/bare commit/stash. After: `git show HEAD:<file> | grep -c <marker>`.
- Typecheck baseline ~328; the pre-existing `SpaceTypeSurface.vue` `onVibeRevert` (~line 160) error is NOT yours.

## Shared signatures

```ts
// loftGeometry.ts
export function fillsAngle(fillsJson: string): number
export function build2DFillRamp(three: typeof THREE, fillsJson: string, mode: 'blend' | 'steps', acrossSize: number, alongSize: number): Uint8ClampedArray
export function stretchAcross(ramp1d: Uint8ClampedArray, acrossSize: number): Uint8ClampedArray   // 1-D along ramp → 2-D (flat across)
export interface LoftGeometry { positions: Float32Array; along: Float32Array; across: Float32Array; indices: Uint32Array }  // + across
// both builders' opts gain: gradientAngle?: number  (default 90)
```

---

### Task 1: `build2DFillRamp` + `fillsAngle` + `stretchAcross` (colour maths)

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (append)
- Test: `frontend/tests/unit/spacetype-loft-fill.unit.spec.ts` (append)

**Interfaces:** Produces `fillsAngle`, `build2DFillRamp`, `stretchAcross` (signatures above). `build2DFillRamp`: each fill → an across-sampler (solid/pattern → constant primary; gradient/ombre → `lerp(a,b,u)`); keyframes at along `v_i=i/(N-1)`; per along-row bracket (blend) or snap (steps); per across-col sample both bracketing fills and lerp.

- [ ] **Step 1: Add failing tests**

```ts
// append to spacetype-loft-fill.unit.spec.ts
import { build2DFillRamp, fillsAngle, stretchAcross } from '../../app/lib/spacetype/loftGeometry'
const px = (r: Uint8ClampedArray, ux: number, vy: number, aSize: number) => {
  const o = (vy*aSize + ux)*4; return [r[o], r[o+1], r[o+2]]
}
describe('build2DFillRamp — 2D across×along', () => {
  const A = 8, L = 16
  it('one gradient fill: uniform ALONG, gradient ACROSS (a→b)', () => {
    const fills = JSON.stringify([{ type: 'gradient', a: '#000000', b: '#ffffff' }])
    const r = build2DFillRamp(THREE as any, fills, 'blend', A, L)
    expect(r.length).toBe(A*L*4)
    // across: left dark, right light; along: same at every row
    expect(px(r, 0, 0, A)[0]).toBeLessThan(40)
    expect(px(r, A-1, 0, A)[0]).toBeGreaterThan(215)
    expect(px(r, A-1, 0, A)).toEqual(px(r, A-1, L-1, A))   // uniform along
  })
  it('[gradient blue→pink, solid white]: first row = gradient, last row = white, middle fades', () => {
    const fills = JSON.stringify([{ type: 'gradient', a: '#3b5bff', b: '#ff2ea6' }, { type: 'solid', a: '#ffffff' }])
    const r = build2DFillRamp(THREE as any, fills, 'blend', A, L)
    // last row all near white
    for (let ux = 0; ux < A; ux++) { const c = px(r, ux, L-1, A); expect(c[0]).toBeGreaterThan(230); expect(c[1]).toBeGreaterThan(230); expect(c[2]).toBeGreaterThan(230) }
    // first row varies across (gradient), not white
    expect(px(r, 0, 0, A)).not.toEqual(px(r, A-1, 0, A))
    // a middle row is lighter than the first row (fading toward white)
    const midSum = px(r, 0, Math.floor(L/2), A).reduce((a,b)=>a+b,0)
    const firstSum = px(r, 0, 0, A).reduce((a,b)=>a+b,0)
    expect(midSum).toBeGreaterThan(firstSum)
  })
  it('steps mode: hard along-band boundary (no fade between the two fills)', () => {
    const fills = JSON.stringify([{ type: 'solid', a: '#ff0000' }, { type: 'solid', a: '#0000ff' }])
    const r = build2DFillRamp(THREE as any, fills, 'steps', A, L)
    expect(px(r, 0, 2, A)).toEqual([255,0,0])       // first band red
    expect(px(r, 0, L-2, A)).toEqual([0,0,255])      // second band blue
  })
})
describe('fillsAngle / stretchAcross', () => {
  it('fillsAngle returns first gradient angle, else 90', () => {
    expect(fillsAngle(JSON.stringify([{type:'gradient',a:'#000',b:'#fff',angle:45}]))).toBe(45)
    expect(fillsAngle(JSON.stringify([{type:'solid',a:'#fff'}]))).toBe(90)
    expect(fillsAngle('garbage')).toBe(90)
  })
  it('stretchAcross replicates a 1-D along ramp across every column', () => {
    const along = new Uint8ClampedArray([10,20,30,255, 40,50,60,255])   // 2 along pixels
    const r = stretchAcross(along, 4)
    expect(r.length).toBe(4*2*4)
    // row 0 (along px0) every column = [10,20,30]
    for (let ux=0; ux<4; ux++) { const o=(0*4+ux)*4; expect([r[o],r[o+1],r[o+2]]).toEqual([10,20,30]) }
  })
})
```

- [ ] **Step 2: Run, verify fail** — `npx vitest run tests/unit/spacetype-loft-fill.unit.spec.ts` → FAIL (not exported).

- [ ] **Step 3: Implement in `loftGeometry.ts`**

```ts
type RGB = [number, number, number]
function fillAcrossSampler(three: typeof THREE, fill: any): (u: number) => RGB {
  const type = String(fill?.type)
  if ((type === 'gradient' || type === 'ombre') && fill.a && fill.b) {
    const a = hexToRgbTuple(fill.a), b = hexToRgbTuple(fill.b)
    return (u) => [a[0] + (b[0]-a[0])*u, a[1] + (b[1]-a[1])*u, a[2] + (b[2]-a[2])*u]
  }
  let c: RGB
  try { const col = fillPrimary(three, fill); c = [col.r*255, col.g*255, col.b*255] } catch { c = [136,136,136] }
  return () => c
}

export function fillsAngle(fillsJson: string): number {
  let fills: any[]; try { fills = parseFills(fillsJson) } catch { return 90 }
  const g = fills.find(f => { const t = String(f?.type); return t === 'gradient' || t === 'ombre' })
  const a = g ? Number(g.angle) : NaN
  return Number.isFinite(a) ? a : 90
}

export function build2DFillRamp(three: typeof THREE, fillsJson: string, mode: 'blend' | 'steps', acrossSize: number, alongSize: number): Uint8ClampedArray {
  let fills: any[]; try { fills = parseFills(fillsJson) } catch { fills = [] }
  if (!fills.length) fills = [{ type: 'solid' }]
  const samplers = fills.map(f => fillAcrossSampler(three, f))
  const N = samplers.length
  const out = new Uint8ClampedArray(acrossSize * alongSize * 4)
  for (let vy = 0; vy < alongSize; vy++) {
    const v = alongSize > 1 ? vy / (alongSize - 1) : 0
    let lo: number, hi: number, f: number
    if (N === 1) { lo = 0; hi = 0; f = 0 }
    else if (mode === 'steps') { lo = hi = Math.min(N-1, Math.floor(v * N)); f = 0 }
    else { const x = v*(N-1); lo = Math.min(N-1, Math.floor(x)); hi = Math.min(N-1, lo+1); f = x - lo }
    const sLo = samplers[lo]!, sHi = samplers[hi]!
    for (let ux = 0; ux < acrossSize; ux++) {
      const u = acrossSize > 1 ? ux / (acrossSize - 1) : 0
      const cLo = sLo(u), cHi = sHi(u)
      const o = (vy * acrossSize + ux) * 4
      out[o]   = Math.round(cLo[0] + (cHi[0]-cLo[0])*f)
      out[o+1] = Math.round(cLo[1] + (cHi[1]-cLo[1])*f)
      out[o+2] = Math.round(cLo[2] + (cHi[2]-cLo[2])*f)
      out[o+3] = 255
    }
  }
  return out
}

/** Turn a 1-D along ramp (alongSize*4 RGBA) into a 2-D texture (acrossSize×alongSize) with each
 *  along pixel replicated across every column — used by the per-stop colour source. */
export function stretchAcross(ramp1d: Uint8ClampedArray, acrossSize: number): Uint8ClampedArray {
  const alongSize = ramp1d.length / 4
  const out = new Uint8ClampedArray(acrossSize * alongSize * 4)
  for (let vy = 0; vy < alongSize; vy++) {
    const s = vy*4
    for (let ux = 0; ux < acrossSize; ux++) {
      const o = (vy*acrossSize + ux)*4
      out[o] = ramp1d[s]!; out[o+1] = ramp1d[s+1]!; out[o+2] = ramp1d[s+2]!; out[o+3] = 255
    }
  }
  return out
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** (pathspec; the test file already exists — no `git add` needed unless new).
  ```bash
  git commit frontend/app/lib/spacetype/loftGeometry.ts frontend/tests/unit/spacetype-loft-fill.unit.spec.ts -m "feat(spacetype): loft — 2D fill ramp (across x along) + fillsAngle + stretchAcross"
  ```
  Verify: `git show HEAD:frontend/app/lib/spacetype/loftGeometry.ts | grep -c build2DFillRamp` (>0).

---

### Task 2: `aAcross` per-vertex coordinate in both builders

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (`LoftGeometry`, both builders)
- Test: `frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts` (append)

**Interfaces:** `LoftGeometry` gains `across: Float32Array` (same length as `along`). Both builders' opts gain `gradientAngle?: number` (default 90). Every vertex write also writes `across[o] = acrossCoord(v, cosA, sinA)` where `v` is the UNIT contour point that produced it; cap centroids write `0.5`. Ribbon inner+outer for a contour point both get that point's across.

- [ ] **Step 1: Add failing tests** (append):

```ts
describe('aAcross coordinate', () => {
  const P = 12
  const stopsFix = [
    { id:'a', x:0, y:0.5, z:0, width:1, height:1, roll:0, color:'#000000' },
    { id:'b', x:1, y:0.5, z:0, width:1, height:1, roll:0, color:'#ffffff' },
  ]
  const contour = shapeContour('oval', { rectRadius:0.5, polySides:5, starDepth:0.5 }, P)
  const st = sampleSpine(stopsFix as any, false, 8)
  const props = st.map(() => ({ width:1, height:1, roll:0 }))

  it('across is present, same length as along, all in [0,1]', () => {
    const g = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', gradientAngle:90 })
    expect(g.across.length).toBe(g.along.length)
    for (const a of g.across) { expect(a).toBeGreaterThanOrEqual(0); expect(a).toBeLessThanOrEqual(1) }
  })
  it('angle 90 (vertical): the top contour point → ~1, bottom → ~0', () => {
    // oval point 0 is at angle 0 = (+1,0); the y-extremes are at p≈P/4 and p≈3P/4
    const g = buildLoftGeometry({ stations: st, props, baseContours:[contour], closed:false, render:'fill', gradientAngle:90 })
    // gather across for the first ring's P points
    const ring0 = Array.from(g.across.slice(0, P))
    expect(Math.max(...ring0)).toBeGreaterThan(0.9)   // top of oval → ~1
    expect(Math.min(...ring0)).toBeLessThan(0.1)      // bottom → ~0
  })
  it('sliced fill caps: centroid across = 0.5', () => {
    const s2 = sampleSpine(stopsFix as any, false, 200)
    const p2 = s2.map(() => ({ width:1, height:1, roll:0 }))
    const g = buildSlicedLoftGeometry({ stations: s2, props: p2, baseContours:[contour], closed:false, render:'fill', elements:4, spacing:0.4, cap:true, gradientAngle:90 })
    // the last 4*2 vertices are cap centroids (2 per band, 4 bands) — but count precisely:
    // grid = 4 bands * 2 rings * 1 contour * P; caps appended after → each centroid across = 0.5
    const gridVerts = 4 * 2 * 1 * P
    for (let i = gridVerts; i < g.across.length; i++) expect(g.across[i]).toBeCloseTo(0.5)
  })
})
```

- [ ] **Step 2: Run, verify fail** (`across` undefined / gradientAngle unused).

- [ ] **Step 3: Add the helper + `across` array.** In `loftGeometry.ts`, add:
```ts
function acrossCoord(v: Vec2, cosA: number, sinA: number): number {
  const p = (v.x * cosA + v.y * sinA + 1) / 2
  return p < 0 ? 0 : p > 1 ? 1 : p
}
```
In BOTH builders: read `const gradientAngle = opts.gradientAngle ?? 90; const aRad = gradientAngle*Math.PI/180; const cosA = Math.cos(aRad), sinA = Math.sin(aRad)`. Allocate `const across = new Float32Array(<same size as along>)`. At every site that writes `along[o] = …`, also write `across[o] = acrossCoord(v, cosA, sinA)` using the unit contour point `v = baseContours[c][p]` for that vertex (for the stroke ribbon's inner AND outer vertex of point `p`, use `baseContours[c][p]`). For cap centroids write `across[capIdx] = 0.5`. Merge `across` alongside `positions`/`along` in the cap-merge blocks (same `Float32Array` concat pattern). Return `across` in `LoftGeometry`.

- [ ] **Step 4: Run, verify pass** (all geometry tests, incl. prior counts/topology/cap/ribbon, still green — `across` is additive).

- [ ] **Step 5: Commit** (pathspec). Verify `git show HEAD:frontend/app/lib/spacetype/loftGeometry.ts | grep -c "across\[o\]"` (>0) and that `acrossCoord` is present.

---

### Task 3: Wire the 2-D texture + shader into the effect

**Files:**
- Modify: `frontend/app/lib/spacetype/effects/loft.ts`
- Test: `frontend/tests/unit/spacetype-loft-effect.unit.spec.ts` (extend)

**Interfaces:** Consumes `build2DFillRamp`, `fillsAngle`, `stretchAcross`, `buildRamp` (stops), and the builders' new `across` + `gradientAngle`.

- [ ] **Step 1: Add failing tests** (append):

```ts
describe('loft 2D colour texture', () => {
  it('buildScene uploads a 2-D DataTexture (width>1 && height>1) and geometry has aAcross', () => {
    const p = defaultFromControls()
    const root = loftEffect.buildScene(THREE as any, p, new THREE.Texture(), { width: 800, height: 800 })
    const tex = root.userData.tex as any
    expect(tex.image.width).toBeGreaterThan(1)
    expect(tex.image.height).toBeGreaterThan(1)
    let hasAcross = false
    root.traverse((o: any) => { if (o.geometry?.getAttribute?.('aAcross')) hasAcross = true })
    expect(hasAcross).toBe(true)
  })
  it('colorSource=stops still produces a 2-D texture', () => {
    const p = defaultFromControls(); (p as any).colorSource = 'stops'
    const root = loftEffect.buildScene(THREE as any, p, new THREE.Texture(), { width: 800, height: 800 })
    const tex = root.userData.tex as any
    expect(tex.image.width).toBeGreaterThan(1); expect(tex.image.height).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Update `loft.ts`.**
  - Import `build2DFillRamp, fillsAngle, stretchAcross` from `../loftGeometry`.
  - Add constants near `PROFILE_POINTS`: `const RAMP_ACROSS = 64, RAMP_ALONG = 256`.
  - In `buildScene`, compute the angle + pass into the geometry builders:
    ```ts
    const gradientAngle = String(params.colorSource) === 'fill' ? fillsAngle(String(params.fills ?? '')) : 90
    ```
    add `gradientAngle` to BOTH `buildSlicedLoftGeometry(...)` and `buildLoftGeometry(...)` opts.
  - Set the new attribute on the geometry (where `aAlong` is set):
    ```ts
    g.setAttribute('aAcross', new three.BufferAttribute(geo.across, 1))
    ```
  - Replace the ramp bytes + texture:
    ```ts
    const rampBytes = String(params.colorSource) === 'stops'
      ? stretchAcross(buildRamp(stops, RAMP_ALONG), RAMP_ACROSS)
      : build2DFillRamp(three as any, String(params.fills ?? ''), String(params.fillMode) === 'steps' ? 'steps' : 'blend', RAMP_ACROSS, RAMP_ALONG)
    const ramp = new three.DataTexture(new Uint8Array(rampBytes), RAMP_ACROSS, RAMP_ALONG, three.RGBAFormat)
    ramp.needsUpdate = true
    ```
    (keep storing `ramp` on `root.userData.tex` exactly as before; ClampToEdge is the DataTexture default.)
  - Update the shaders:
    ```ts
    const VERT = `
    attribute float aAlong;
    attribute float aAcross;
    varying float vAlong;
    varying float vAcross;
    void main() { vAlong = aAlong; vAcross = aAcross; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `
    const FRAG = `
    uniform sampler2D uRamp;
    uniform float uFlow;
    uniform float uOpacity;
    varying float vAlong;
    varying float vAcross;
    void main() {
      vec3 c = texture2D(uRamp, vec2(vAcross, fract(vAlong + uFlow))).rgb;
      gl_FragColor = vec4(c, uOpacity);
    }
    `
    ```

- [ ] **Step 4: Run tests + typecheck.** `npx vitest run tests/unit/spacetype-loft-effect.unit.spec.ts`; `npx vue-tsc --noEmit 2>&1 | grep -E 'effects/loft|loftGeometry' || echo clean`.

- [ ] **Step 5: Commit** (pathspec: loft.ts + the test). Verify `git show HEAD:frontend/app/lib/spacetype/effects/loft.ts | grep -c "build2DFillRamp"` (>0).

---

### Task 4: Full-suite green + runtime proof + docs

**Files:** none (verification) + `docs/STATE.md`.

- [ ] **Step 1: Full loft suite** — `npx vitest run tests/unit/spacetype-loft-*.unit.spec.ts` — no NEW failures.
- [ ] **Step 2: Typecheck** — `npx vue-tsc --noEmit 2>&1 | grep -iE 'effects/loft|loftGeometry|2DFill|aAcross' || echo clean`.
- [ ] **Step 3: Runtime proof (controller; needs this session's OWN dev server — the running one belongs to another chat).** `preview_start` this session's server (from `.claude/launch.json`, or create it), open Loft: with fills = [gradient blue→pink, solid white], the **first circle shows the gradient ACROSS its face, the last circle is white, the middles blend** (not a lengthwise ramp). Toggle `fillMode` steps → hard bands. Add a third fill → re-maps first→last. Screenshot + no console errors.
- [ ] **Step 4: Update `docs/STATE.md`** — extend the Loft entry with round 3c (2-D Illustrator-style blend colour: fills paint circle faces, blend along the sweep). Pathspec commit.

---

## Self-review

**Spec coverage:** A `aAcross` attribute → Task 2. B `build2DFillRamp` (+ stops 2-D via `stretchAcross`) → Task 1. C 2-D DataTexture + shader → Task 3. Runtime + docs → Task 4. Representative-angle (`fillsAngle`) → Task 1 + passed in Task 3. ✓

**Placeholder scan:** Task 2's "at every site that writes `along[o]`, also write `across[o]`" is a match-the-existing-code instruction (the builders have several vertex-write sites from prior rounds — fill grid, stroke ribbon inner/outer, cap centroids); the helper + rule + cap-centroid value (0.5) are all concrete. No TBDs.

**Type consistency:** `LoftGeometry.across` (Task 2) is read by Task 3's `geo.across`. `build2DFillRamp(three, fillsJson, mode, acrossSize, alongSize)`, `fillsAngle(fillsJson)`, `stretchAcross(ramp1d, acrossSize)` names/args match between Task 1 and Task 3. Texture layout (width=across, height=along) matches the FRAG `vec2(vAcross, vAlong)`.

**Ordering guard:** Task 1 is additive (new fns). Task 2 adds `across` to the return + a defaulted `gradientAngle` opt — existing count/topology tests unaffected (`across` is a new parallel array). Task 3 switches the effect onto the 2-D texture + attribute. Each task ends green.
