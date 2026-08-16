# Curve-Following Gradient Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `curve` gradient layout to Gradient Studio — a fully parametric, AI-controllable bezier the ramp follows, with an Along (bent-axis) / Outward (glow) mode toggle.

**Architecture:** `curve` is a new simple-primitive `LayoutKind` (shader index 9). A pure function flattens the parametric curve (preset shape + endpoints + dials) to a ~40-point polyline with cumulative arc-length; the renderer uploads it as a per-layer RGBA32F `TEXTURE_2D_ARRAY` (mirroring the existing field texture); the shader does a per-pixel nearest-segment search yielding `s` (arc-length → Along) and `d` (distance → Outward), then feeds the shared `applyRepeat → falloff → quantize → sampleRamp` tail. Fully parametric so agent + motion + inspector derive from one `ControlSpec` list; an on-preview handle overlay writes back to the same dials.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, WebGL2 (raw GLSL string in `shaders.ts`, `texelFetch` on an RGBA32F sampler2DArray), Vitest units, Browser-pane differential probe.

## Global Constraints

- **`curve` is a simple primitive:** it joins `isSimple` (Repeat/Falloff apply) but NOT `isBanded` (no Shape/Relief/Margin) and NOT `usesCenter` (it has its own endpoints, not `canvas.center`).
- **New field defaults to nothing changing:** a config without `layer.curve` on a curve layout is backfilled with `CURVE_DEFAULTS`; non-curve layouts are never given a `curve` block. Pre-feature configs render byte-identical.
- **Shader branch:** curve = index 9. Inside the existing `if (u_layout > 5.5)` simple block, the trailing `else` (conic) becomes `else if (u_layout < 8.5)` conic + `else` curve. The curve sub-branch only SETS `t`; the shared tail (applyRepeat/clamp/hueDrift/quantize/sampleRamp) is unchanged. Do NOT touch the mesh/liquid/stripe ladder below.
- **Curve texture is RGBA32F, NEAREST filter, read with `texelFetch`** — 8-bit would stair-step the curve geometry. Separate texture unit (2) from fields (0) and ramps (1).
- **Constant loop bound:** the nearest-segment loop uses a compile-time `#define CURVE_MAX 40`; `u_curveN[i]` gates the real length.
- **Y flip once:** the editor stores points y=0 TOP (canvas convention); the shader's `v_texCoord` has y=1 visual TOP. `uploadCurve` flips `y → 1 - y` exactly once so stored points, overlay, and render agree.
- **Aspect:** the outward DISTANCE aspect-corrects (`dd.x *= u_aspect`); the along ARC-LENGTH param does not.
- Colour = action blue only for any action affordance ([[studio-button-is-the-button]]); this feature adds sliders/selects + a drag overlay, no buttons.
- Run units from `frontend/`: `cd frontend && npx vitest run <file> --no-coverage`. Pre-existing unrelated failure `gradientfx-mesh.unit.spec.ts` (`u_flowOffset`) is NOT ours — ignore it.

---

### Task 1: Types, label, and config defaults

**Files:**
- Modify: `frontend/app/lib/gradientfx/types.ts` (LayoutKind ~line 16; add types + CURVE_DEFAULTS; LAYOUT_LABELS ~the map; LAYOUTS ~line 300; ensureConfigDefaults backfill)
- Test: `frontend/tests/unit/gradientfx-curve-types.unit.spec.ts` (create)

**Interfaces:**
- Produces:
  - `LayoutKind` now includes `'curve'`
  - `type CurveShape = 'line'|'arc'|'s-curve'|'wave'|'loop'`, `type CurveMode = 'along'|'outward'`, `interface Vec2 { x:number; y:number }`
  - `interface CurveConfig { start:Vec2; end:Vec2; shape:CurveShape; curvature:number; bend:number; waves:number; phase:number; mode:CurveMode; width:number }`
  - `const CURVE_DEFAULTS: CurveConfig`
  - `LayerConfig.curve?: CurveConfig`
  - `LAYOUT_LABELS.curve === 'Curve'`; `LAYOUTS` contains `'curve'`
  - `ensureConfigDefaults` backfills `curve` on a curve-layout layer 0

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/gradientfx-curve-types.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { LAYOUT_LABELS, LAYOUTS, CURVE_DEFAULTS, ensureConfigDefaults, type GradientConfig, type LayoutKind } from '~/lib/gradientfx/types'
import { defaultConfig } from '~/lib/gradientfx/randomize'

describe('curve types', () => {
  it('curve is a LayoutKind with label "Curve" and in the randomize pool', () => {
    const keys: LayoutKind[] = ['ramp','radialRamp','conic','curve','linear','radial','orbit','stack','liquid','mesh']
    expect(Object.keys(LAYOUT_LABELS).sort()).toEqual([...keys].sort())
    expect(LAYOUT_LABELS.curve).toBe('Curve')
    expect(LAYOUTS).toContain('curve')
  })

  it('CURVE_DEFAULTS is a complete parametric curve', () => {
    expect(CURVE_DEFAULTS.mode).toBe('along')
    expect(CURVE_DEFAULTS.shape).toBe('arc')
    expect(CURVE_DEFAULTS.start).toEqual({ x: 0.2, y: 0.5 })
    expect(CURVE_DEFAULTS.end).toEqual({ x: 0.8, y: 0.5 })
    expect(typeof CURVE_DEFAULTS.width).toBe('number')
  })

  it('ensureConfigDefaults backfills curve on a curve layout, not elsewhere', () => {
    const c = defaultConfig('#curve01') as GradientConfig
    c.canvas.layout = 'curve'
    delete (c.layers[0] as any).curve
    ensureConfigDefaults(c)
    expect(c.layers[0]!.curve).toEqual(CURVE_DEFAULTS)

    const r = defaultConfig('#ramp01') as GradientConfig  // ramp layout
    ensureConfigDefaults(r)
    expect((r.layers[0] as any).curve).toBeUndefined()
  })

  it('leaves an explicit curve untouched', () => {
    const c = defaultConfig('#curve02') as GradientConfig
    c.canvas.layout = 'curve'
    c.layers[0]!.curve = { start:{x:0,y:0}, end:{x:1,y:1}, shape:'wave', curvature:0.7, bend:-1, waves:5, phase:0.25, mode:'outward', width:0.5 }
    ensureConfigDefaults(c)
    expect(c.layers[0]!.curve!.shape).toBe('wave')
    expect(c.layers[0]!.curve!.mode).toBe('outward')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-curve-types.unit.spec.ts --no-coverage`
Expected: FAIL — `CURVE_DEFAULTS` not exported, `curve` not in LayoutKind.

- [ ] **Step 3: Edit `types.ts`**

Extend the `LayoutKind` union (prepend `'curve'` after `'conic'`):

```ts
export type LayoutKind = 'ramp' | 'radialRamp' | 'conic' | 'curve' | 'linear' | 'radial' | 'orbit' | 'stack' | 'liquid' | 'mesh'
export type CurveShape = 'line' | 'arc' | 's-curve' | 'wave' | 'loop'
export type CurveMode = 'along' | 'outward'
export interface Vec2 { x: number; y: number }
```

Add the interface + defaults near `RampConfig`/`RAMP_DEFAULTS`:

```ts
/** Per-layer parametric curve for the `curve` layout. Optional for back-compat;
 *  a layer without it uses CURVE_DEFAULTS. Fully parametric — the polyline the
 *  renderer builds is derived, never stored. Coords normalized 0..1 (0,0 = top-left). */
export interface CurveConfig {
  start: Vec2; end: Vec2
  shape: CurveShape
  /** Bow amount, 0..1 (0 = straight chord). */
  curvature: number
  /** Bow side / rotation, -1..1. */
  bend: number
  /** Oscillation count (wave preset), 1..8. */
  waves: number
  /** Wave phase, 0..1. */
  phase: number
  mode: CurveMode
  /** Outward glow reach, frame fraction 0.02..1. */
  width: number
}

export const CURVE_DEFAULTS: CurveConfig = {
  start: { x: 0.2, y: 0.5 }, end: { x: 0.8, y: 0.5 },
  shape: 'arc', curvature: 0.4, bend: 1, waves: 3, phase: 0,
  mode: 'along', width: 0.35,
}
```

Add to `LayerConfig` (after `ramp?`):

```ts
  /** Parametric curve (only the `curve` layout). */
  curve?: CurveConfig
```

Add `curve: 'Curve'` to `LAYOUT_LABELS` and `'curve'` to the `LAYOUTS` array (place after `'conic'`):

```ts
export const LAYOUT_LABELS: Record<LayoutKind, string> = {
  ramp: 'Linear', radialRamp: 'Radial', conic: 'Conic', curve: 'Curve',
  linear: 'Linear stripes', radial: 'Radial stripes',
  orbit: 'Orbit', stack: 'Stack', liquid: 'Liquid', mesh: 'Mesh',
}
export const LAYOUTS: LayoutKind[] = ['ramp', 'radialRamp', 'conic', 'curve', 'linear', 'radial', 'orbit', 'stack', 'liquid', 'mesh']
```

In `ensureConfigDefaults`, extend the existing SIMPLE backfill block (which backfills `ramp`) to also backfill `curve` for the curve layout:

```ts
  const SIMPLE = cfg.canvas.layout === 'ramp' || cfg.canvas.layout === 'radialRamp' || cfg.canvas.layout === 'conic' || cfg.canvas.layout === 'curve'
  for (const L of cfg.layers) {
    if (!L) continue
    if (SIMPLE && cfg.canvas.layout !== 'curve' && !L.ramp) L.ramp = { ...RAMP_DEFAULTS }
    if (cfg.canvas.layout === 'curve' && !L.curve) L.curve = { ...CURVE_DEFAULTS, start: { ...CURVE_DEFAULTS.start }, end: { ...CURVE_DEFAULTS.end } }
    if (L.color) {
      if (L.color.repeat == null) L.color.repeat = 'once'
      if (L.color.repeatCount == null) L.color.repeatCount = 4
      if (L.color.falloff == null) L.color.falloff = 'linear'
    }
  }
```

(If the existing block differs slightly, adapt to it — the invariants are: curve layout backfills `curve`, ramp/radialRamp/conic backfill `ramp`, curve layout does NOT backfill `ramp`, non-simple layouts get neither. Use fresh spreads on nested `start`/`end` so layers don't share a mutable ref.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-curve-types.unit.spec.ts --no-coverage`
Expected: PASS (4 tests).

- [ ] **Step 5: Guard existing suites**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-simple-gradients-types.unit.spec.ts tests/unit/gradientfx-config-defaults.unit.spec.ts --no-coverage`
Expected: PASS — the LAYOUT_LABELS-completeness test there now expects 10 keys; if it hardcodes 9, update it to include `curve` (legitimate addition).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/gradientfx/types.ts frontend/tests/unit/gradientfx-curve-types.unit.spec.ts
git commit -m "feat(gradient): curve LayoutKind + CurveConfig + defaults"
```

---

### Task 2: buildCurvePolyline — the pure curve sampler

**Files:**
- Create: `frontend/app/lib/gradientfx/curvePath.ts`
- Test: `frontend/tests/unit/gradientfx-curve-path.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `CurveConfig`, `Vec2` from `./types` (Task 1)
- Produces:
  - `const CURVE_SAMPLES = 40`
  - `interface CurvePolyline { pts: Float32Array; len: Float32Array; n: number }` — `pts` = `[x0,y0,x1,y1,…]` normalized 0..1; `len` = cumulative arc-length normalized 0..1 (`len[0]=0`, `len[n-1]=1`); `n` = point count (= CURVE_SAMPLES)
  - `function buildCurvePolyline(c: CurveConfig): CurvePolyline`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/gradientfx-curve-path.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { buildCurvePolyline, CURVE_SAMPLES } from '~/lib/gradientfx/curvePath'
import { CURVE_DEFAULTS, type CurveConfig } from '~/lib/gradientfx/types'

const mk = (o: Partial<CurveConfig>): CurveConfig => ({ ...CURVE_DEFAULTS, ...o })
const pt = (p: { pts: Float32Array }, k: number) => ({ x: p.pts[k*2]!, y: p.pts[k*2+1]! })

describe('buildCurvePolyline', () => {
  it('hits both endpoints exactly', () => {
    const c = mk({ start: { x: 0.1, y: 0.2 }, end: { x: 0.9, y: 0.8 }, shape: 'arc' })
    const p = buildCurvePolyline(c)
    expect(p.n).toBe(CURVE_SAMPLES)
    expect(pt(p, 0).x).toBeCloseTo(0.1, 5); expect(pt(p, 0).y).toBeCloseTo(0.2, 5)
    expect(pt(p, p.n - 1).x).toBeCloseTo(0.9, 5); expect(pt(p, p.n - 1).y).toBeCloseTo(0.8, 5)
  })

  it('arc-length is monotonic non-decreasing, len[0]=0, len[last]=1', () => {
    const p = buildCurvePolyline(mk({ shape: 'wave', waves: 4, curvature: 0.6 }))
    expect(p.len[0]).toBeCloseTo(0, 6)
    expect(p.len[p.n - 1]).toBeCloseTo(1, 6)
    for (let k = 1; k < p.n; k++) expect(p.len[k]!).toBeGreaterThanOrEqual(p.len[k - 1]!)
  })

  it('line preset is collinear (cross-product ~0 for every point)', () => {
    const c = mk({ start: { x: 0.1, y: 0.3 }, end: { x: 0.9, y: 0.6 }, shape: 'line', curvature: 1 })
    const p = buildCurvePolyline(c)
    const ax = 0.9 - 0.1, ay = 0.6 - 0.3
    for (let k = 0; k < p.n; k++) {
      const cross = ax * (pt(p, k).y - 0.3) - ay * (pt(p, k).x - 0.1)
      expect(Math.abs(cross)).toBeLessThan(1e-4)
    }
  })

  it('curvature 0 collapses arc onto the straight chord', () => {
    const c = mk({ start: { x: 0.1, y: 0.5 }, end: { x: 0.9, y: 0.5 }, shape: 'arc', curvature: 0 })
    const p = buildCurvePolyline(c)
    for (let k = 0; k < p.n; k++) expect(pt(p, k).y).toBeCloseTo(0.5, 4)
  })

  it('wave with N waves crosses the chord axis ~N times (sign changes)', () => {
    const c = mk({ start: { x: 0.1, y: 0.5 }, end: { x: 0.9, y: 0.5 }, shape: 'wave', waves: 3, curvature: 0.5, phase: 0 })
    const p = buildCurvePolyline(c)
    let signChanges = 0, prev = 0
    for (let k = 0; k < p.n; k++) {
      const off = pt(p, k).y - 0.5
      const s = Math.sign(off)
      if (s !== 0 && prev !== 0 && s !== prev) signChanges++
      if (s !== 0) prev = s
    }
    expect(signChanges).toBeGreaterThanOrEqual(3)
    expect(signChanges).toBeLessThanOrEqual(7)
  })

  it('bend sign flips the bow side', () => {
    const base = { start: { x: 0.1, y: 0.5 }, end: { x: 0.9, y: 0.5 }, shape: 'arc' as const, curvature: 0.6 }
    const pos = buildCurvePolyline(mk({ ...base, bend: 1 }))
    const neg = buildCurvePolyline(mk({ ...base, bend: -1 }))
    const midPos = pos.pts[Math.floor(pos.n/2)*2 + 1]!  // mid y
    const midNeg = neg.pts[Math.floor(neg.n/2)*2 + 1]!
    expect(Math.sign(midPos - 0.5)).toBe(-Math.sign(midNeg - 0.5))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-curve-path.unit.spec.ts --no-coverage`
Expected: FAIL — module `curvePath.ts` does not exist.

- [ ] **Step 3: Create `curvePath.ts`**

```ts
// Curve Studio: turn a parametric CurveConfig into a flat polyline with cumulative
// arc-length. Pure + deterministic. The renderer uploads this into a per-layer
// RGBA32F texture the shader samples (see renderer.uploadCurve).
import type { CurveConfig, Vec2 } from './types'

export const CURVE_SAMPLES = 40
export interface CurvePolyline { pts: Float32Array; len: Float32Array; n: number }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Position on the parametric curve at u ∈ [0,1]. Chord from start→end, with a
 *  perpendicular offset that the shape preset shapes. */
function evalCurve(c: CurveConfig, u: number): Vec2 {
  const sx = c.start.x, sy = c.start.y, ex = c.end.x, ey = c.end.y
  // Base point on the straight chord.
  const bx = lerp(sx, ex, u), by = lerp(sy, ey, u)
  if (c.shape === 'line' || c.curvature <= 1e-6) return { x: bx, y: by }
  // Perpendicular unit of the chord (normalized).
  const dx = ex - sx, dy = ey - sy
  const L = Math.hypot(dx, dy) || 1e-6
  const px = -dy / L, py = dx / L
  const amp = c.curvature * c.bend * 0.5   // max offset = 0.5 frame at curvature 1
  let off = 0
  switch (c.shape) {
    case 'arc':      off = Math.sin(u * Math.PI); break                       // single bow
    case 's-curve':  off = Math.sin(u * Math.PI * 2); break                   // two opposing bows
    case 'wave':     off = Math.sin((u * Math.max(1, c.waves) + c.phase) * Math.PI * 2); break
    case 'loop':     off = Math.sin(u * Math.PI) * (1 - Math.cos(u * Math.PI * 2)); break
    default:         off = 0
  }
  return { x: bx + px * off * amp, y: by + py * off * amp }
}

export function buildCurvePolyline(c: CurveConfig): CurvePolyline {
  const n = CURVE_SAMPLES
  const pts = new Float32Array(n * 2)
  const len = new Float32Array(n)
  let prev = evalCurve(c, 0)
  pts[0] = prev.x; pts[1] = prev.y; len[0] = 0
  let acc = 0
  for (let k = 1; k < n; k++) {
    const u = k / (n - 1)
    const cur = evalCurve(c, u)
    acc += Math.hypot(cur.x - prev.x, cur.y - prev.y)
    pts[k * 2] = cur.x; pts[k * 2 + 1] = cur.y; len[k] = acc
    prev = cur
  }
  // Normalize arc-length to 0..1 (guard a zero-length degenerate curve).
  const total = acc > 1e-9 ? acc : 1
  for (let k = 0; k < n; k++) len[k] = len[k]! / total
  len[n - 1] = 1  // pin exact
  return { pts, len, n }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-curve-path.unit.spec.ts --no-coverage`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/gradientfx/curvePath.ts frontend/tests/unit/gradientfx-curve-path.unit.spec.ts
git commit -m "feat(gradient): buildCurvePolyline — parametric curve → arc-length polyline"
```

---

### Task 3: Controls — Curve section + curveHandles kind + isSimple

**Files:**
- Modify: `frontend/app/lib/spacetype/effect.ts` (ControlSpec union ~lines 49-79; add `curveHandles` kind)
- Modify: `frontend/app/lib/gradientfx/controls.ts` (isSimple ~line 41; GRADIENT_SECTIONS; new control rows)
- Test: `frontend/tests/unit/gradientfx-curve-controls.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `visibleGradientControls`, `LayoutKind` (Task 1)
- Produces: control keys `layer.curve.mode`, `layer.curve.shape`, `layer.curve.start.x`, `layer.curve.start.y`, `layer.curve.end.x`, `layer.curve.end.y`, `layer.curve.curvature`, `layer.curve.bend`, `layer.curve.waves`, `layer.curve.phase`, `layer.curve.width`, `layer.curve.handles` (kind `curveHandles`). New section `'Curve'`. `curve` added to `isSimple`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/gradientfx-curve-controls.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { visibleGradientControls, GRADIENT_SECTIONS } from '~/lib/gradientfx/controls'
import { defaultConfig } from '~/lib/gradientfx/randomize'
import { ensureConfigDefaults, type GradientConfig, type LayoutKind } from '~/lib/gradientfx/types'

function cfg(layout: LayoutKind): GradientConfig {
  const c = defaultConfig('#cc1') as GradientConfig
  c.canvas.layout = layout
  return ensureConfigDefaults(c)
}
const keys = (l: LayoutKind) => new Set(visibleGradientControls(cfg(l)).map(k => k.key))

describe('curve control gating', () => {
  it('adds a Curve section', () => { expect(GRADIENT_SECTIONS).toContain('Curve') })

  it('curve exposes the Curve group + Repeat/Falloff, NOT Shape/Relief/Center', () => {
    const k = keys('curve')
    for (const key of ['layer.curve.mode','layer.curve.shape','layer.curve.start.x','layer.curve.end.y','layer.curve.curvature','layer.curve.handles'])
      expect(k.has(key), key).toBe(true)
    expect(k.has('layer.color.repeat')).toBe(true)
    expect(k.has('layer.color.falloff')).toBe(true)
    expect(k.has('layer.shape.count')).toBe(false)
    expect(k.has('relief.relief')).toBe(false)
    expect(k.has('canvas.center.x')).toBe(false)
  })

  it('width shows only in outward mode; waves/phase only for the wave shape', () => {
    const outward = cfg('curve'); outward.layers[0]!.curve!.mode = 'outward'
    expect(new Set(visibleGradientControls(outward).map(x=>x.key)).has('layer.curve.width')).toBe(true)
    const along = cfg('curve'); along.layers[0]!.curve!.mode = 'along'
    expect(new Set(visibleGradientControls(along).map(x=>x.key)).has('layer.curve.width')).toBe(false)
    const wave = cfg('curve'); wave.layers[0]!.curve!.shape = 'wave'
    expect(new Set(visibleGradientControls(wave).map(x=>x.key)).has('layer.curve.waves')).toBe(true)
    const arc = cfg('curve'); arc.layers[0]!.curve!.shape = 'arc'
    expect(new Set(visibleGradientControls(arc).map(x=>x.key)).has('layer.curve.waves')).toBe(false)
  })

  it('non-curve simple layouts do NOT get the curve group', () => {
    expect(keys('ramp').has('layer.curve.mode')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-curve-controls.unit.spec.ts --no-coverage`
Expected: FAIL — no `'Curve'` section, no curve controls, and `curveHandles` kind unknown.

- [ ] **Step 3: Add the `curveHandles` kind to the ControlSpec union in `effect.ts`**

Find the `ControlSpec` union (near the `path`/`curve`/`profileStops` kinds). Add:

```ts
  // A parametric-curve handle overlay (Gradient curve layout). Renders CurveEditor.vue,
  // which drags start/end/curvature handles that write back to layer.curve.* dials.
  // Carries no value of its own — the curve lives in the numeric dials.
  | { key: string; label: string; kind: 'curveHandles'; default: string; group: string }
```

(`default: string` — an inert empty string; the kind is display-only, mirroring how `profileStops`/`path` are declared. Match the exact formatting of the neighbouring union members.)

- [ ] **Step 4: Edit `controls.ts` — isSimple, section, controls**

Extend `isSimple` (line ~41) to include curve:

```ts
const isSimple = (c: GradientConfig) =>
  c.canvas.layout === 'ramp' || c.canvas.layout === 'radialRamp' || c.canvas.layout === 'conic' || c.canvas.layout === 'curve'
const isCurve = (c: GradientConfig) => c.canvas.layout === 'curve'
```

Add `'Curve'` to `GRADIENT_SECTIONS` after `'Gradient'`:

```ts
export const GRADIENT_SECTIONS = [
  'Preset', 'Canvas', 'Gradient', 'Curve', 'Colours', 'Flow', 'Liquid', 'Mesh', 'Shape', 'Relief', 'Layer', 'Focus',
  ...POST_SECTIONS,
] as const
```

Add the Curve control block (place after the Gradient-section block):

```ts
  // --- Curve (curve layout: a gradient that follows a parametric bezier) -----
  { key: 'layer.curve.mode', label: 'Mode', kind: 'select', options: ['along', 'outward'], default: 'along', group: 'Curve', when: isCurve, hint: 'along = ramp runs down the curve; outward = ramp fades sideways off it' } as GradientControl,
  { key: 'layer.curve.shape', label: 'Shape', kind: 'select', options: ['line', 'arc', 's-curve', 'wave', 'loop'], default: 'arc', group: 'Curve', when: isCurve } as GradientControl,
  slider('layer.curve.start.x', 'Start X', 0, 1, 0.01, 'Curve', undefined, { when: isCurve }),
  slider('layer.curve.start.y', 'Start Y', 0, 1, 0.01, 'Curve', undefined, { when: isCurve }),
  slider('layer.curve.end.x', 'End X', 0, 1, 0.01, 'Curve', undefined, { when: isCurve }),
  slider('layer.curve.end.y', 'End Y', 0, 1, 0.01, 'Curve', undefined, { when: isCurve }),
  slider('layer.curve.curvature', 'Curvature', 0, 1, 0.01, 'Curve', 'How much the curve bows', { when: (c) => isCurve(c) && c.layers?.[0]?.curve?.shape !== 'line' }),
  slider('layer.curve.bend', 'Bend', -1, 1, 0.01, 'Curve', 'Which side it bows', { when: (c) => isCurve(c) && c.layers?.[0]?.curve?.shape !== 'line' }),
  slider('layer.curve.waves', 'Waves', 1, 8, 1, 'Curve', undefined, { when: (c) => isCurve(c) && c.layers?.[0]?.curve?.shape === 'wave' }),
  slider('layer.curve.phase', 'Phase', 0, 1, 0.01, 'Curve', undefined, { when: (c) => isCurve(c) && c.layers?.[0]?.curve?.shape === 'wave' }),
  slider('layer.curve.width', 'Width', 0.02, 1, 0.01, 'Curve', 'Outward glow reach', { when: (c) => isCurve(c) && c.layers?.[0]?.curve?.mode === 'outward' }),
  { key: 'layer.curve.handles', label: 'Curve handles', kind: 'curveHandles', default: '', group: 'Curve', when: isCurve } as GradientControl,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-curve-controls.unit.spec.ts --no-coverage`
Expected: PASS (4 tests).

- [ ] **Step 6: Reconcile the characterization suite**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-controls.unit.spec.ts --no-coverage`
Expected: This may fail on the `canvas.layout` select options (now including `curve`) — a legitimate addition from Task 1's LAYOUTS change. Update the snapshot to include `curve` in the layout options. It must NOT show any curve-group key on non-curve layouts. If the snapshot changed by more than "`curve` added to layout options", stop and report.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/spacetype/effect.ts frontend/app/lib/gradientfx/controls.ts frontend/tests/unit/gradientfx-curve-controls.unit.spec.ts frontend/tests/unit/gradientfx-controls.unit.spec.ts frontend/tests/unit/__snapshots__/gradientfx-controls.unit.spec.ts.snap
git commit -m "feat(gradient): Curve controls section + curveHandles ControlSpec kind + isSimple"
```

---

### Task 4: Shader + renderer — the curve renders

**Files:**
- Modify: `frontend/app/lib/gradientfx/shaders.ts` (uniform decls ~line 76; add `u_curves` sampler + `curveTexel` + `#define CURVE_MAX`; curve sub-branch in computeLayer ~line 309-315)
- Modify: `frontend/app/lib/gradientfx/renderer.ts` (curveArrayTex alloc ~line 88; uploadCurve; LAYOUT_IDX ~line 43; per-layer arrays + upload; texture bind ~line 318)
- Test: verified live (Task 6) — GL is mocked in Vitest

**Interfaces:**
- Consumes: `buildCurvePolyline`/`CURVE_SAMPLES` (Task 2), `CURVE_DEFAULTS` (Task 1)
- Produces: `curve` layout (index 9) renders; uniforms `u_curveN[]`, `u_curveMode[]`, `u_curveWidth[]`, sampler `u_curves`

- [ ] **Step 1: Shader — add the sampler, define, and helper (`shaders.ts`)**

With the other sampler decls (near `uniform sampler2DArray u_fields;` line 111) add:

```glsl
uniform sampler2DArray u_curves;   // per-layer curve polyline: RG=xy, B=cumLen
```

With the per-layer uniform arrays (near `u_rampSweep` line 76) add:

```glsl
uniform float u_curveN[LAYER_MAX];      // curve polyline point count
uniform float u_curveMode[LAYER_MAX];   // 0 along, 1 outward
uniform float u_curveWidth[LAYER_MAX];  // outward glow reach
```

Near the top of the fragment body (with `#define LAYER_MAX`), add:

```glsl
#define CURVE_MAX 40
```

Add a texel helper next to `sampleField` (~line 248):

```glsl
// Exact texel fetch of the curve polyline (RGBA32F, NEAREST). texel k of layer i.
vec4 curveTexel(int i, int k) { return texelFetch(u_curves, ivec3(k, 0, i), 0); }
```

- [ ] **Step 2: Shader — the curve sub-branch**

In `computeLayer`, change the conic `else` (line 309) to `else if (u_layout < 8.5)` and append the curve `else`. Replace lines 309-315:

```glsl
    } else if (u_layout < 8.5) {             // conic — angular sweep
      vec2 d = p - 0.5 - u_center; d.x *= u_aspect;
      float ang = fract(atan(d.y, d.x) / TAU + 0.5 - u_rampAngle[i] / 360.0);
      float sweep = clamp(u_rampSweep[i] / 360.0, 0.05, 1.0);
      t = ang / sweep;
      if (u_rampCloseLoop[i] > 0.5) t = 1.0 - abs(fract(t) * 2.0 - 1.0); // wrap seamless
    } else {                                 // curve (9) — gradient follows a bezier
      // p is v_texCoord (0..1); curve texels are in the SAME space (upload flips Y).
      int n = int(u_curveN[i] + 0.5);
      float bestD = 1e9; float bestS = 0.0;
      vec4 first = curveTexel(i, 0);
      vec2 prev = first.xy; float prevL = first.z;
      for (int k = 1; k < CURVE_MAX; k++) {
        if (k >= n) break;
        vec4 cur = curveTexel(i, k);
        vec2 a = prev, b = cur.xy;
        vec2 ab = b - a; vec2 ap = p - a;
        float u = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        vec2 proj = a + ab * u;
        vec2 dd = proj - p; dd.x *= u_aspect;          // aspect-correct the DISTANCE
        float dist = length(dd);
        if (dist < bestD) { bestD = dist; bestS = mix(prevL, cur.z, u); }
        prev = b; prevL = cur.z;
      }
      t = (u_curveMode[i] < 0.5)
        ? bestS                                        // along = arc-length param
        : clamp(bestD / max(u_curveWidth[i], 1e-3), 0.0, 1.0); // outward = distance
    }
```

(The shared tail at line 316+ — applyRepeat/clamp/hueDrift/quantize/sampleRamp/return — is UNCHANGED and now runs for curve too.)

- [ ] **Step 3: Renderer — allocate the curve texture (`renderer.ts`)**

Add a field next to `fieldArrayTex` (line 62):

```ts
  private curveArrayTex: WebGLTexture | null = null
```

In `ensure`, after `this.rampArrayTex = mk(g.RGBA8)` (line 89), add a NEAREST RGBA32F array (the `mk` helper uses LINEAR + 256 width; the curve needs NEAREST + CURVE_MAX width, so allocate it explicitly):

```ts
      const ct = g.createTexture()
      g.bindTexture(g.TEXTURE_2D_ARRAY, ct)
      g.texStorage3D(g.TEXTURE_2D_ARRAY, 1, g.RGBA32F, 40, 1, LAYER_MAX)  // 40 = CURVE_SAMPLES
      g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MIN_FILTER, g.NEAREST)
      g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_MAG_FILTER, g.NEAREST)
      g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE)
      g.texParameteri(g.TEXTURE_2D_ARRAY, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE)
      this.curveArrayTex = ct
```

Import at the top of `renderer.ts` (next to the buildRampLut import):

```ts
import { buildCurvePolyline, CURVE_SAMPLES } from './curvePath'
import { CURVE_DEFAULTS } from './types'
```

Free it in the dispose/loss path where `fieldArrayTex` is freed (line ~520):

```ts
    if (this.curveArrayTex) gl.deleteTexture(this.curveArrayTex)
    this.curveArrayTex = null
```

- [ ] **Step 4: Renderer — uploadCurve + LAYOUT_IDX + per-layer arrays + upload**

`LAYOUT_IDX` (line 43) gains curve:

```ts
const LAYOUT_IDX: Record<LayoutKind, number> = { ramp: 6, radialRamp: 7, conic: 8, curve: 9, linear: 0, radial: 1, orbit: 2, stack: 3, liquid: 4, mesh: 5 }
```

Add `uploadCurve` next to `uploadField` (line ~220). It packs pts+len into an RGBA32F row and **flips Y once** (`1 - y`):

```ts
  private uploadCurve(gl: WebGL2RenderingContext, layer: number, poly: { pts: Float32Array; len: Float32Array; n: number }) {
    const data = new Float32Array(CURVE_SAMPLES * 4)
    for (let k = 0; k < CURVE_SAMPLES; k++) {
      const src = Math.min(k, poly.n - 1)
      data[k * 4] = poly.pts[src * 2]!
      data[k * 4 + 1] = 1 - poly.pts[src * 2 + 1]!   // Y flip: editor y=0 top → shader texcoord y=1 top
      data[k * 4 + 2] = poly.len[src]!
      data[k * 4 + 3] = 1
    }
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.curveArrayTex!)
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, CURVE_SAMPLES, 1, 1, gl.RGBA, gl.FLOAT, data)
  }
```

Add per-layer collection arrays (with the ramp arrays, after line 275):

```ts
    const curveN: number[] = [], curveMode: number[] = [], curveWidth: number[] = []
```

In the per-layer loop (after the ramp pushes), build+upload the curve and push its scalars:

```ts
      const cv = L.curve ?? CURVE_DEFAULTS
      const poly = buildCurvePolyline(cv)
      this.uploadCurve(gl, i, poly)
      curveN.push(poly.n)
      curveMode.push(cv.mode === 'outward' ? 1 : 0)
      curveWidth.push(cv.width)
```

Bind the curve texture to unit 2 (after the ramp bind ~line 321):

```ts
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.curveArrayTex)
    gl.uniform1i(u('u_curves'), 2)
```

Upload the curve scalar uniforms (with the ramp uniform uploads):

```ts
    gl.uniform1fv(u('u_curveN'), arr(curveN))
    gl.uniform1fv(u('u_curveMode'), arr(curveMode))
    gl.uniform1fv(u('u_curveWidth'), arr(curveWidth))
```

- [ ] **Step 5: Compile-check**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "gradientfx/renderer\|gradientfx/shaders" || echo "clean"`
Expected: `clean` (baseline errors elsewhere are pre-existing).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/gradientfx/shaders.ts frontend/app/lib/gradientfx/renderer.ts
git commit -m "feat(gradient): render curve layout — RGBA32F polyline texture + nearest-segment shader"
```

---

### Task 5: On-preview editor — CurveEditor.vue + surface wiring

**Files:**
- Create: `frontend/app/components/vue-canvas/CurveEditor.vue`
- Modify: `frontend/app/components/vue-canvas/GradientStudioSurface.vue` (imports; `isCurve` computed; Curve `StudioSection`; mount CurveEditor over the preview; `onCurve` write helper; render the `curveHandles` control)
- Test: verified live (Task 6)

**Interfaces:**
- Consumes: `CurveConfig`, `CURVE_DEFAULTS` (Task 1); the `layer.curve.*` control keys (Task 3)
- Produces: a working Curve panel + draggable start/end/curvature handles that write `layer.curve.*`

- [ ] **Step 1: Create `CurveEditor.vue`**

Reuse the canvas-rect mapping from `StringPathEditor.vue`/`LoftSpineEditor.vue` (read one first for the exact overlay-root + canvas-rect pattern). The overlay root MUST be `pointer-events-none` with `pointer-events-auto` handles ([[canvas-overlay-pointer-events]]). Props: the current `CurveConfig` (`modelValue`) + the preview canvas rect source the sibling editors use. Three handles:
- start at `(curve.start.x, curve.start.y)`, end at `(curve.end.x, curve.end.y)` — drag writes those dials.
- curvature handle at the chord midpoint offset perpendicular by `curvature*bend*0.5`; dragging it projects the pointer offset onto the chord-perpendicular → magnitude writes `curvature` (clamp 0..1), sign writes `bend` (−1 or +1, or the normalized signed magnitude).

Emit each change as `update:field` events (or a single `update` with the mutated `CurveConfig`) that the surface maps to `onCurve(path, value)`. Coordinate convention: y=0 TOP (canvas pixels), same as `StringPathEditor` — the Y flip to shader space happens later at `uploadCurve`, NOT here. Keep the component focused: handle rendering + drag math only; no curve sampling (that's `buildCurvePolyline`, server of truth is the dials).

Model the drag math on `LoftSpineEditor`'s handle drag (canvas-rect → normalized). Full handle-drag reference (adapt element/rect names to the real sibling):

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { CurveConfig } from '~/lib/gradientfx/types'
const props = defineProps<{ modelValue: CurveConfig; rect: { left: number; top: number; width: number; height: number } }>()
const emit = defineEmits<{ (e: 'edit', path: string, value: number): void }>()

const toScreen = (x: number, y: number) => ({ left: props.rect.left + x * props.rect.width, top: props.rect.top + y * props.rect.height })
const start = computed(() => toScreen(props.modelValue.start.x, props.modelValue.start.y))
const end = computed(() => toScreen(props.modelValue.end.x, props.modelValue.end.y))
// curvature handle: chord midpoint + perpendicular * curvature*bend*0.5
const ctrl = computed(() => {
  const s = props.modelValue.start, e = props.modelValue.end
  const mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2
  const dx = e.x - s.x, dy = e.y - s.y, L = Math.hypot(dx, dy) || 1e-6
  const px = -dy / L, py = dx / L
  const off = props.modelValue.curvature * props.modelValue.bend * 0.5
  return toScreen(mx + px * off, my + py * off)
})

function dragEndpoint(which: 'start' | 'end', ev: PointerEvent) {
  const move = (e: PointerEvent) => {
    const nx = Math.max(0, Math.min(1, (e.clientX - props.rect.left) / props.rect.width))
    const ny = Math.max(0, Math.min(1, (e.clientY - props.rect.top) / props.rect.height))
    emit('edit', `layer.curve.${which}.x`, nx); emit('edit', `layer.curve.${which}.y`, ny)
  }
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); ev.preventDefault()
}
function dragCurvature(ev: PointerEvent) {
  const s = props.modelValue.start, e = props.modelValue.end
  const dx = e.x - s.x, dy = e.y - s.y, L = Math.hypot(dx, dy) || 1e-6
  const px = -dy / L, py = dx / L, mx = (s.x + e.x) / 2, my = (s.y + e.y) / 2
  const move = (mv: PointerEvent) => {
    const nx = (mv.clientX - props.rect.left) / props.rect.width
    const ny = (mv.clientY - props.rect.top) / props.rect.height
    const signed = ((nx - mx) * px + (ny - my) * py) / 0.5   // projection onto perpendicular, /maxOffset
    emit('edit', 'layer.curve.curvature', Math.min(1, Math.abs(signed)))
    emit('edit', 'layer.curve.bend', signed >= 0 ? 1 : -1)
  }
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); ev.preventDefault()
}
</script>

<template>
  <div class="pointer-events-none absolute inset-0">
    <svg class="absolute inset-0 h-full w-full overflow-visible">
      <line :x1="start.left" :y1="start.top" :x2="end.left" :y2="end.top" stroke="rgba(255,255,255,0.25)" stroke-dasharray="4 4" />
    </svg>
    <button class="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" :style="{ left: start.left + 'px', top: start.top + 'px' }" @pointerdown="dragEndpoint('start', $event)" />
    <button class="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" :style="{ left: end.left + 'px', top: end.top + 'px' }" @pointerdown="dragEndpoint('end', $event)" />
    <button class="pointer-events-auto absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent" :style="{ left: ctrl.left + 'px', top: ctrl.top + 'px' }" @pointerdown="dragCurvature($event)" />
  </div>
</template>
```

(The `rect` prop shape and how the surface computes the preview canvas rect must match what `StringPathEditor`/`LoftSpineEditor` are given — read the surface's existing overlay mount to supply the same rect source rather than inventing one.)

- [ ] **Step 2: Wire it into `GradientStudioSurface.vue`**

- Import `CurveEditor` and `CURVE_DEFAULTS`; add `isCurve` computed = `config.canvas.layout === 'curve'`.
- Add a Curve `StudioSection` (`v-show="onDesign && isCurve"`) with the mode + shape selects and the start/end/curvature/bend/waves/phase/width sliders, each writing via an `onCurve` helper (mirror the Task-6 `onRamp` helper from the prior feature — seed `CURVE_DEFAULTS` on first touch, write nested path, call `onEdit`). For nested paths use dotted keys `layer.curve.start.x` etc.:

```ts
function onCurve(path: string, value: number | string) {
  const L = config.value.layers[activeLayer.value] ?? config.value.layers[0]
  if (!L) return
  if (!L.curve) L.curve = { ...CURVE_DEFAULTS, start: { ...CURVE_DEFAULTS.start }, end: { ...CURVE_DEFAULTS.end } }
  // path is like 'layer.curve.start.x' or 'layer.curve.mode' — strip the 'layer.curve.' prefix
  const rest = path.replace(/^layer\.curve\./, '')
  if (rest === 'start.x') L.curve.start.x = value as number
  else if (rest === 'start.y') L.curve.start.y = value as number
  else if (rest === 'end.x') L.curve.end.x = value as number
  else if (rest === 'end.y') L.curve.end.y = value as number
  else (L.curve as any)[rest] = value
  onEdit(path, value as any)
}
```

- Mount `<CurveEditor v-if="isCurve" :model-value="config.layers[activeLayer].curve" :rect="previewRect" @edit="onCurve" />` over the preview, using the SAME preview-rect source the surface already computes for other overlays (grep the surface for how `StringPathEditor`/`LoftSpineEditor` or any existing overlay gets its rect; reuse it).

- [ ] **Step 3: Compile-check**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "CurveEditor\|GradientStudioSurface" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/CurveEditor.vue frontend/app/components/vue-canvas/GradientStudioSurface.vue
git commit -m "feat(gradient): CurveEditor overlay + Curve panel section (handles write parametric dials)"
```

---

### Task 6: Live differential verification

**Files:** none (verification only — produces evidence; code only if a defect is found)

Per [[graceful-fallback-hides-integration-failure]] and [[synthetic-pointer-events-prove-nothing]], prove it differentially and with real drags, not "it looks curved."

- [ ] **Step 1: Full unit sweep green**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-*.unit.spec.ts --no-coverage`
Expected: all pass EXCEPT the known pre-existing `gradientfx-mesh` `u_flowOffset` failure (confirm it's the only red, and predates this branch).

- [ ] **Step 2: Dev server + harness**

Check `ps` for a running nuxt server (parallel sessions — [[orphaned-dev-servers-from-parallel-sessions]]); reuse `127.0.0.1:3000` if present. Open `/dev/gradient-harness` in the Browser pane; hard-reload after HMR.

- [ ] **Step 3: Extend `__sailorLayoutProbe`** to accept a `curve` override object (like it accepts `ramp`), then assert differentially (add the probe support in the harness page — it is dev-only test infra, same as the ramp probe):
- [ ] **Step 4: Branch reached** — `curve` (default arc, along) render ≠ `ramp` render at the same palette.
- [ ] **Step 5: Along bends** — with `shape:'arc', curvature:0.6, mode:'along'`, the iso-`t` bands are curved: a mid-frame column's `t` profile differs from the straight-ramp's (assert the along render ≠ the `curvature:0` render). And `curvature:0` (or `shape:'line'`) ≈ the Linear ramp along the chord (broken-control check).
- [ ] **Step 6: Outward symmetric + collapses** — `mode:'outward'`: pixels mirrored across the curve share `t`; `width→0.05` pushes most of the frame to the last stop (mean shifts), `width→1` keeps more near stop 0.
- [ ] **Step 7: Endpoint move relocates** — moving `start` from left to right moves where stop 0 lands (edge means shift).
- [ ] **Step 8: Y-flip correctness** — set `start:{x:0.1,y:0.1}` (visual top-left in editor convention) with a black→white ramp, along mode; assert stop 0 (black) lands near the VISUAL top-left of the render, confirming the single Y flip is correct (not zero/double flipped).
- [ ] **Step 9: Handle drag is real** — in the actual studio (not the harness), drag the start handle and confirm the gradient moves + the Start X/Y sliders update (real pointer events, per [[synthetic-pointer-events-prove-nothing]]). If the full studio is hard to reach, at minimum confirm `onCurve` writes round-trip by driving the sliders.
- [ ] **Step 10: Screenshots** — capture along-arc, outward-glow, and a wave curve for the handoff.
- [ ] **Step 11: If any check fails**, diagnose against Task 4 (texture upload / Y-flip / branch order / aspect) — fix in the relevant task's files, re-run from Step 1.

- [ ] **Step 12: Commit** any harness probe extension (dev-only test infra) if made; no product commit unless a defect was fixed.

---

### Task 7: Docs — STATE.md + dashboard + memory

**Files:**
- Modify: `docs/STATE.md` (Gradient Studio row + a landed entry)
- Modify: the live ⛵ dashboard artifact ([[update-dashboard-on-every-commit]] — read the LIVE one first)
- Update: `[[gradient-simple-primitives-landed]]` memory (curve is a 4th simple primitive) or add a short new memory if a non-obvious gotcha surfaced (e.g. the RGBA32F/texelFetch curve-texture pattern, the Y-flip site)

- [ ] **Step 1: STATE.md landed entry** — curve as a 4th simple primitive; along/outward from one nearest-segment search; parametric (agent-legible) curve on a per-layer RGBA32F polyline texture (texelFetch); Y-flip once at upload; on-preview handles write dials. Cite spec + plan. Update the Gradient Studio row note.

- [ ] **Step 2: Dashboard** — read the live ⛵ artifact, add the curve line to the Gradient maturity note, redeploy to the same URL.

- [ ] **Step 3: Memory** — update `[[gradient-simple-primitives-landed]]` to mention curve + the RGBA32F polyline-texture + Y-flip gotchas, or a focused new memory. Update `MEMORY.md` index line if adding a file.

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md
git commit -m "docs: curve-following gradient — landed"
```

---

## Self-Review

**Spec coverage:**
- New `curve` layout + Along/Outward → Task 1 (types) + Task 4 (shader/renderer). ✓
- Parametric, agent-legible → Task 1 (CurveConfig) + Task 3 (ControlSpecs). ✓
- Motion for free → ControlSpec-derived (Task 3); no bespoke wiring. ✓
- On-preview handles → Task 5 (CurveEditor + curveHandles kind). ✓
- Repeat/Falloff apply → `isSimple` includes curve (Task 3) + shared shader tail (Task 4). ✓
- CPU polyline + per-layer texture + nearest-segment → Task 2 + Task 4. ✓
- Y-flip once at upload → Task 4 Step 4. ✓
- Aspect: distance corrects, arc-length doesn't → Task 4 Step 2. ✓
- Constant loop bound `CURVE_MAX` → Task 4 Step 1. ✓
- Testing (differential + broken-control + Y-flip) → Task 6. ✓

**Placeholder scan:** none. The "grep the surface for the preview-rect source" (Task 5) and "adapt to the real sibling editor" are concrete reuse instructions with a named pattern, not placeholders.

**Type consistency:** `CurveConfig`/`CURVE_DEFAULTS`/`Vec2`/`CurveShape`/`CurveMode` defined Task 1, consumed Tasks 2/3/4/5 with the same names. `buildCurvePolyline(c): CurvePolyline` + `CURVE_SAMPLES` defined Task 2, called Task 4. `curveHandles` kind defined Task 3, rendered Task 5. `LAYOUT_IDX` curve:9, shader index 9, `#define CURVE_MAX 40` = `CURVE_SAMPLES` — consistent. `u_curveN/Mode/Width` declared (Task 4 Step 1) and uploaded (Task 4 Step 4) with matching names.
