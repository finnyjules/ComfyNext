# Simple Gradients (Linear / Radial / Conic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three plain gradient primitives — Linear (angled ramp), Radial (centre-out), Conic (angular sweep) — as new Gradient Studio layouts, rename the existing stripe layouts at the display layer only, and add universal Repeat + Falloff controls.

**Architecture:** The three primitives are new `LayoutKind` values (`ramp`/`radialRamp`/`conic`, shader indices 6/7/8) tested in a branch *above* the existing shader ladder so nothing below changes. They inherit the whole studio (layers, ramp editor, Flow, post, motion, agent, export) for free. Repeat is a shared GLSL+TS `t`-transform; Falloff reshapes the LUT in `buildRampLut` (no shader cost). The rename is a `LAYOUT_LABELS` display map — keys are never touched, so zero migration.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, WebGL2 (raw GLSL string in `shaders.ts`), Vitest for units, Browser-pane for differential render proof.

## Global Constraints

- **No key renames.** `LayoutKind` string keys `'linear'`/`'radial'` keep meaning the stripe fields. Renaming is display-only via `LAYOUT_LABELS`. Saved docs, the 8 authored presets, `LAYOUT_IDX`, `randomize.ts`, and embeds all depend on the keys.
- **Byte-identical defaults.** Every new field defaults to today's behaviour (`repeat:'once'`, `falloff:'linear'`, `RAMP_DEFAULTS`). A config saved before this feature must render unchanged — asserted by a golden LUT parity test.
- **New shader branch MUST sit above `if (u_layout > 4.5)`** in `shaders.ts` `computeLayer`, or indices 6–8 render as mesh.
- **`isBanded` flips from exclusion to inclusion** — otherwise Shape/Relief/Margin leak onto flat ramps.
- **Per-layer uniforms are `[LAYER_MAX]` arrays** (`u_x[i]`), never scalar — stacked layers each carry their own ramp axis.
- **Colour = action blue only** for any new action affordance; amber stays on taste chrome ([[studio-button-is-the-button]]). This feature adds no buttons, only sliders/selects/switch.
- Run units from `frontend/`: `npx vitest run tests/unit/<file> --no-coverage`.

---

### Task 1: Types, labels, and config defaults

**Files:**
- Modify: `frontend/app/lib/gradientfx/types.ts` (LayoutKind ~line 16; add types + LAYOUT_LABELS + RAMP_DEFAULTS; ensureConfigDefaults ~the function body; LAYOUTS export ~line 272)
- Test: `frontend/tests/unit/gradientfx-simple-gradients-types.unit.spec.ts` (create)

**Interfaces:**
- Produces:
  - `type LayoutKind` now includes `'ramp' | 'radialRamp' | 'conic'`
  - `type RampShape = 'circle' | 'ellipse'`, `type RepeatKind = 'once' | 'mirror' | 'tile'`, `type FalloffKind = 'linear' | 'ease' | 'smooth'`
  - `interface RampConfig { angle:number; radius:number; shape:RampShape; sweep:number; closeLoop:boolean }`
  - `const RAMP_DEFAULTS: RampConfig`
  - `const LAYOUT_LABELS: Record<LayoutKind, string>`
  - `LayerConfig.ramp?: RampConfig`
  - `ColorConfig.repeat?: RepeatKind`, `ColorConfig.repeatCount?: number`, `ColorConfig.falloff?: FalloffKind`
  - `ensureConfigDefaults` backfills `ramp` on simple-layout layer 0 and `repeat`/`repeatCount`/`falloff` on every layer's colour

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/gradientfx-simple-gradients-types.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  LAYOUT_LABELS, LAYOUTS, RAMP_DEFAULTS, ensureConfigDefaults,
  type GradientConfig, type LayoutKind,
} from '~/lib/gradientfx/types'
import { defaultConfig } from '~/lib/gradientfx/randomize'

describe('simple-gradient types', () => {
  it('LAYOUT_LABELS has exactly one label per LayoutKind', () => {
    const keys: LayoutKind[] = ['ramp','radialRamp','conic','linear','radial','orbit','stack','liquid','mesh']
    for (const k of keys) expect(LAYOUT_LABELS[k], `label for ${k}`).toBeTruthy()
    expect(Object.keys(LAYOUT_LABELS).sort()).toEqual([...keys].sort())
  })

  it('renames stripe layouts but keeps the plain names for the new primitives', () => {
    expect(LAYOUT_LABELS.linear).toBe('Linear stripes')
    expect(LAYOUT_LABELS.radial).toBe('Radial stripes')
    expect(LAYOUT_LABELS.ramp).toBe('Linear')
    expect(LAYOUT_LABELS.radialRamp).toBe('Radial')
    expect(LAYOUT_LABELS.conic).toBe('Conic')
  })

  it('LAYOUTS randomize pool includes the three new keys', () => {
    for (const k of ['ramp','radialRamp','conic'] as const) expect(LAYOUTS).toContain(k)
  })

  it('ensureConfigDefaults backfills ramp on a simple layout and repeat/falloff on every layer', () => {
    const c = defaultConfig('#seed0001') as GradientConfig
    c.canvas.layout = 'ramp'
    delete (c.layers[0] as any).ramp
    delete (c.layers[0]!.color as any).repeat
    delete (c.layers[0]!.color as any).falloff
    ensureConfigDefaults(c)
    expect(c.layers[0]!.ramp).toEqual(RAMP_DEFAULTS)
    expect(c.layers[0]!.color.repeat).toBe('once')
    expect(c.layers[0]!.color.falloff).toBe('linear')
  })

  it('ensureConfigDefaults leaves an explicit ramp/repeat/falloff untouched', () => {
    const c = defaultConfig('#seed0002') as GradientConfig
    c.canvas.layout = 'conic'
    c.layers[0]!.ramp = { angle: 33, radius: 0.5, shape: 'ellipse', sweep: 180, closeLoop: true }
    c.layers[0]!.color.repeat = 'tile'; c.layers[0]!.color.repeatCount = 4; c.layers[0]!.color.falloff = 'smooth'
    ensureConfigDefaults(c)
    expect(c.layers[0]!.ramp).toEqual({ angle: 33, radius: 0.5, shape: 'ellipse', sweep: 180, closeLoop: true })
    expect(c.layers[0]!.color.repeat).toBe('tile')
    expect(c.layers[0]!.color.falloff).toBe('smooth')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-simple-gradients-types.unit.spec.ts --no-coverage`
Expected: FAIL — `LAYOUT_LABELS`/`RAMP_DEFAULTS` not exported.

- [ ] **Step 3: Edit `types.ts`**

Change the `LayoutKind` union (currently line 16):

```ts
export type LayoutKind = 'ramp' | 'radialRamp' | 'conic' | 'linear' | 'radial' | 'orbit' | 'stack' | 'liquid' | 'mesh'
export type RampShape = 'circle' | 'ellipse'
export type RepeatKind = 'once' | 'mirror' | 'tile'
export type FalloffKind = 'linear' | 'ease' | 'smooth'
```

Add near the other interfaces (after `ShapeConfig` is fine):

```ts
/** Per-layer axis for the simple primitives (ramp / radialRamp / conic).
 *  Optional for back-compat; a layer without it uses RAMP_DEFAULTS. Per-layer,
 *  not per-canvas, so stacked layers can each carry their own angle. */
export interface RampConfig {
  /** Linear ramp direction / conic start rotation, degrees 0..360. */
  angle: number
  /** Radial ramp size, 0.05..2 (1 ≈ touches frame edge). */
  radius: number
  /** Radial contour: circle (aspect-corrected) or ellipse (frame-stretched). */
  shape: RampShape
  /** Conic arc, degrees 20..360. */
  sweep: number
  /** Conic: wrap the ramp so first==last colour meet seamlessly. */
  closeLoop: boolean
}

export const RAMP_DEFAULTS: RampConfig = { angle: 90, radius: 1, shape: 'circle', sweep: 360, closeLoop: false }
```

Add the three optional fields to `ColorConfig` (right after `hueRotate`):

```ts
  /** Ramp repetition across the axis: once (default) / mirror (reflect) / tile ×N. */
  repeat?: RepeatKind
  /** Tile count when repeat === 'tile', 2..16. */
  repeatCount?: number
  /** LUT interpolation curve: linear (default) / ease / smooth. */
  falloff?: FalloffKind
```

Add the optional field to `LayerConfig` (after `mesh?`):

```ts
  /** Simple-primitive axis (only ramp/radialRamp/conic layouts). */
  ramp?: RampConfig
```

Add `LAYOUT_LABELS` next to the `LAYOUTS` export (line ~272):

```ts
export const LAYOUT_LABELS: Record<LayoutKind, string> = {
  ramp: 'Linear', radialRamp: 'Radial', conic: 'Conic',
  linear: 'Linear stripes', radial: 'Radial stripes',
  orbit: 'Orbit', stack: 'Stack', liquid: 'Liquid', mesh: 'Mesh',
}
```

Extend the `LAYOUTS` array to include the three new keys (simple-first is fine; this array feeds randomize, not the picker order):

```ts
export const LAYOUTS: LayoutKind[] = ['ramp', 'radialRamp', 'conic', 'linear', 'radial', 'orbit', 'stack', 'liquid', 'mesh']
```

In `ensureConfigDefaults`, right before `migrateMotionTracks(cfg)` at the end, add the backfill:

```ts
  // Backfill simple-primitive axis + universal repeat/falloff. Defaults reproduce
  // pre-feature behaviour so legacy blobs render byte-identical.
  const SIMPLE = cfg.canvas.layout === 'ramp' || cfg.canvas.layout === 'radialRamp' || cfg.canvas.layout === 'conic'
  for (const L of cfg.layers) {
    if (!L) continue
    if (SIMPLE && !L.ramp) L.ramp = { ...RAMP_DEFAULTS }
    if (L.color) {
      if (L.color.repeat == null) L.color.repeat = 'once'
      if (L.color.repeatCount == null) L.color.repeatCount = 4
      if (L.color.falloff == null) L.color.falloff = 'linear'
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-simple-gradients-types.unit.spec.ts --no-coverage`
Expected: PASS (5 tests).

- [ ] **Step 5: Guard against regressions in existing config-defaults + label tests**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-config-defaults.unit.spec.ts tests/unit/gradientfx-layer-label.unit.spec.ts --no-coverage`
Expected: PASS (existing suites still green — the new optional fields don't disturb them).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/gradientfx/types.ts frontend/tests/unit/gradientfx-simple-gradients-types.unit.spec.ts
git commit -m "feat(gradient): types + LAYOUT_LABELS + ramp/repeat/falloff config defaults"
```

---

### Task 2: Falloff — LUT interpolation curve

**Files:**
- Modify: `frontend/app/lib/gradientfx/ramp.ts` (`buildRampLut` at line 58)
- Test: `frontend/tests/unit/gradientfx-falloff.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `FalloffKind` from `./types` (Task 1)
- Produces: `buildRampLut(stops: ColorStop[], falloff?: FalloffKind): Uint8Array` — new optional 2nd arg, defaults `'linear'`. Existing single-arg callers unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/gradientfx-falloff.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { buildRampLut } from '~/lib/gradientfx/ramp'
import type { ColorStop } from '~/lib/gradientfx/types'

const BW: ColorStop[] = [{ color: '#000000', pos: 0 }, { color: '#ffffff', pos: 1 }]

describe('buildRampLut falloff', () => {
  it('default (linear) is byte-identical to the no-arg call — golden parity', () => {
    const a = buildRampLut(BW)
    const b = buildRampLut(BW, 'linear')
    expect(Buffer.from(b)).toEqual(Buffer.from(a))
  })

  it('linear ramp is ~linear at the midpoint (127±1)', () => {
    const lut = buildRampLut(BW, 'linear')
    expect(lut[128 * 4]).toBeGreaterThanOrEqual(126)
    expect(lut[128 * 4]).toBeLessThanOrEqual(129)
  })

  it('ease/smooth pin the endpoints and stay monotonic', () => {
    for (const f of ['ease', 'smooth'] as const) {
      const lut = buildRampLut(BW, f)
      expect(lut[0]).toBe(0)
      expect(lut[255 * 4]).toBe(255)
      let prev = -1
      for (let i = 0; i < 256; i++) { const v = lut[i * 4]!; expect(v).toBeGreaterThanOrEqual(prev); prev = v }
    }
  })

  it('smooth pushes the midpoint toward the linear value but flattens the shoulders', () => {
    const lin = buildRampLut(BW, 'linear')
    const sm = buildRampLut(BW, 'smooth')
    // near the low shoulder (t≈0.25), smootherstep sits BELOW linear
    expect(sm[64 * 4]!).toBeLessThan(lin[64 * 4]!)
    // near the high shoulder (t≈0.75), it sits ABOVE linear
    expect(sm[192 * 4]!).toBeGreaterThan(lin[192 * 4]!)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-falloff.unit.spec.ts --no-coverage`
Expected: FAIL — `buildRampLut` ignores the 2nd arg (ease/smooth identical to linear).

- [ ] **Step 3: Edit `ramp.ts`**

Add the import and helper above `buildRampLut`:

```ts
import type { ColorStop, FalloffKind } from './types'

function shapeF(f: number, falloff: FalloffKind): number {
  if (falloff === 'ease')   return f * f * (3 - 2 * f)                 // smoothstep
  if (falloff === 'smooth') return f * f * f * (f * (f * 6 - 15) + 10) // smootherstep
  return f                                                            // linear (default)
}
```

Change the signature and apply the curve to `f` before it blends the two stops:

```ts
export function buildRampLut(stops: ColorStop[], falloff: FalloffKind = 'linear'): Uint8Array {
```

Inside the loop, after `const f = span > 1e-6 ? (t - a.pos) / span : 0`, insert:

```ts
    const fc = shapeF(f, falloff)
```

and replace the three `* f` uses in the interpolation with `* fc`:

```ts
    out[o] = ca.r + (cb.r - ca.r) * fc
    out[o + 1] = ca.g + (cb.g - ca.g) * fc
    out[o + 2] = ca.b + (cb.b - ca.b) * fc
```

(If `ramp.ts` currently imports only `ColorStop`, extend that import rather than adding a second line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-falloff.unit.spec.ts --no-coverage`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/gradientfx/ramp.ts frontend/tests/unit/gradientfx-falloff.unit.spec.ts
git commit -m "feat(gradient): falloff (ease/smooth) LUT interpolation curve"
```

---

### Task 3: Repeat — pure TS `t`-transform (twin of the GLSL)

**Files:**
- Create: `frontend/app/lib/gradientfx/repeat.ts`
- Test: `frontend/tests/unit/gradientfx-repeat.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `RepeatKind` from `./types` (Task 1)
- Produces: `REPEAT_IDX: Record<RepeatKind, number>` (`once:0, mirror:1, tile:2`), and `applyRepeat(t: number, mode: number, count: number): number` — the exact TS twin of the GLSL helper in Task 4, unit-testable without GL.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/gradientfx-repeat.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { applyRepeat, REPEAT_IDX } from '~/lib/gradientfx/repeat'

const O = REPEAT_IDX.once, M = REPEAT_IDX.mirror, T = REPEAT_IDX.tile

describe('applyRepeat', () => {
  it('once is identity', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(applyRepeat(t, O, 4)).toBeCloseTo(t, 6)
  })

  it('tile ×3 produces 3 cycles (t=1/3 → 1.0 boundary → 0)', () => {
    expect(applyRepeat(0, T, 3)).toBeCloseTo(0, 6)
    expect(applyRepeat(1 / 6, T, 3)).toBeCloseTo(0.5, 6)
    expect(applyRepeat(1 / 3, T, 3)).toBeCloseTo(0, 6) // fract(1)=0
  })

  it('mirror ×2 reflects — symmetric about t=0.5', () => {
    for (const t of [0.1, 0.2, 0.35]) {
      expect(applyRepeat(t, M, 2)).toBeCloseTo(applyRepeat(1 - t, M, 2), 6)
    }
    expect(applyRepeat(0.5, M, 2)).toBeCloseTo(1, 6)  // peak at centre
    expect(applyRepeat(0, M, 2)).toBeCloseTo(0, 6)
  })

  it('count clamps to >= 1', () => {
    expect(applyRepeat(0.5, T, 0)).toBeCloseTo(0.5, 6) // n=max(1,0)=1 → fract(0.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-repeat.unit.spec.ts --no-coverage`
Expected: FAIL — module `repeat.ts` does not exist.

- [ ] **Step 3: Create `repeat.ts`**

```ts
// Repeat transform for the gradient ramp coordinate `t`. Kept as a standalone
// pure function so it is unit-testable without a GL context AND is the exact
// twin of the GLSL `applyRepeat` in shaders.ts — the two MUST stay identical.
import type { RepeatKind } from './types'

export const REPEAT_IDX: Record<RepeatKind, number> = { once: 0, mirror: 1, tile: 2 }

/** mode: 0 once, 1 mirror, 2 tile. Matches the GLSL twin verbatim. */
export function applyRepeat(t: number, mode: number, count: number): number {
  if (mode < 0.5) return t
  const n = Math.max(1, count)
  const fract = (x: number) => x - Math.floor(x)
  if (mode < 1.5) return Math.abs(fract(t * n * 0.5) * 2 - 1) // mirror (reflect)
  return fract(t * n)                                          // tile
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-repeat.unit.spec.ts --no-coverage`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/gradientfx/repeat.ts frontend/tests/unit/gradientfx-repeat.unit.spec.ts
git commit -m "feat(gradient): applyRepeat pure-TS twin of the GLSL repeat transform"
```

---

### Task 4: Controls — gating inversion + new ControlSpecs + Gradient section

**Files:**
- Modify: `frontend/app/lib/gradientfx/controls.ts` (predicates lines 38-41; GRADIENT_SECTIONS lines 33-36; the Canvas center/innerRadius rows lines 62-64; new control rows)
- Test: `frontend/tests/unit/gradientfx-simple-gradients-controls.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `visibleGradientControls(cfg)` (existing), `LayoutKind` (Task 1)
- Produces: control keys `layer.ramp.angle`, `layer.ramp.radius`, `layer.ramp.shape`, `layer.ramp.sweep`, `layer.ramp.closeLoop`, `layer.color.repeat`, `layer.color.repeatCount`, `layer.color.falloff`, all discoverable via `visibleGradientControls`. New section `'Gradient'` in `GRADIENT_SECTIONS`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/gradientfx-simple-gradients-controls.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { visibleGradientControls, GRADIENT_SECTIONS } from '~/lib/gradientfx/controls'
import { defaultConfig } from '~/lib/gradientfx/randomize'
import { ensureConfigDefaults, type GradientConfig, type LayoutKind } from '~/lib/gradientfx/types'

function cfg(layout: LayoutKind): GradientConfig {
  const c = defaultConfig('#c0ntrol1') as GradientConfig
  c.canvas.layout = layout
  return ensureConfigDefaults(c)
}
const keys = (layout: LayoutKind) => new Set(visibleGradientControls(cfg(layout)).map(k => k.key))

describe('simple-gradient control gating', () => {
  it('adds a Gradient section', () => {
    expect(GRADIENT_SECTIONS).toContain('Gradient')
  })

  it('ramp layout exposes angle but not radius/sweep, and NOT Shape/Relief', () => {
    const k = keys('ramp')
    expect(k.has('layer.ramp.angle')).toBe(true)
    expect(k.has('layer.ramp.radius')).toBe(false)
    expect(k.has('layer.ramp.sweep')).toBe(false)
    expect(k.has('layer.shape.count')).toBe(false)
    expect(k.has('relief.relief')).toBe(false)
  })

  it('radialRamp exposes radius + shape + center, not angle/sweep', () => {
    const k = keys('radialRamp')
    expect(k.has('layer.ramp.radius')).toBe(true)
    expect(k.has('layer.ramp.shape')).toBe(true)
    expect(k.has('canvas.center.x')).toBe(true)
    expect(k.has('layer.ramp.angle')).toBe(false)
  })

  it('conic exposes angle + sweep + closeLoop + center', () => {
    const k = keys('conic')
    expect(k.has('layer.ramp.angle')).toBe(true)
    expect(k.has('layer.ramp.sweep')).toBe(true)
    expect(k.has('layer.ramp.closeLoop')).toBe(true)
    expect(k.has('canvas.center.x')).toBe(true)
  })

  it('repeat/falloff are universal; repeatCount only when tile', () => {
    for (const l of ['ramp','linear','liquid','mesh'] as LayoutKind[]) {
      const k = keys(l)
      expect(k.has('layer.color.repeat'), `repeat on ${l}`).toBe(true)
      expect(k.has('layer.color.falloff'), `falloff on ${l}`).toBe(true)
    }
    const c = cfg('ramp'); c.layers[0]!.color.repeat = 'tile'
    expect(new Set(visibleGradientControls(c).map(x => x.key)).has('layer.color.repeatCount')).toBe(true)
    const c2 = cfg('ramp'); c2.layers[0]!.color.repeat = 'once'
    expect(new Set(visibleGradientControls(c2).map(x => x.key)).has('layer.color.repeatCount')).toBe(false)
  })

  it('stripe layouts still expose Shape and NOT the ramp axis', () => {
    const k = keys('linear')
    expect(k.has('layer.shape.count')).toBe(true)
    expect(k.has('layer.ramp.angle')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-simple-gradients-controls.unit.spec.ts --no-coverage`
Expected: FAIL — no `'Gradient'` section, no ramp controls; and `ramp` layout currently inherits Shape (isBanded is exclusion-based).

- [ ] **Step 3: Edit predicates (lines 38-41)**

```ts
const isRadial = (c: GradientConfig) => c.canvas.layout === 'radial' || c.canvas.layout === 'orbit'
const isLiquid = (c: GradientConfig) => c.canvas.layout === 'liquid'
const isMesh = (c: GradientConfig) => c.canvas.layout === 'mesh'
const isSimple = (c: GradientConfig) =>
  c.canvas.layout === 'ramp' || c.canvas.layout === 'radialRamp' || c.canvas.layout === 'conic'
// Banded = the stripe/ring family only. Was `!isLiquid && !isMesh` (exclusion),
// which would leak Shape/Relief/Margin onto the flat simple primitives.
const isBanded = (c: GradientConfig) =>
  c.canvas.layout === 'linear' || c.canvas.layout === 'radial' || c.canvas.layout === 'orbit' || c.canvas.layout === 'stack'
// Center offset is used by the stripe polar layouts AND the simple radial/conic.
const usesCenter = (c: GradientConfig) => isRadial(c) || c.canvas.layout === 'radialRamp' || c.canvas.layout === 'conic'
const isRampLinear = (c: GradientConfig) => c.canvas.layout === 'ramp' || c.canvas.layout === 'conic'
```

- [ ] **Step 4: Add `'Gradient'` to GRADIENT_SECTIONS (lines 33-36)**

```ts
export const GRADIENT_SECTIONS = [
  'Preset', 'Canvas', 'Gradient', 'Colours', 'Flow', 'Liquid', 'Mesh', 'Shape', 'Relief', 'Layer', 'Focus',
  ...POST_SECTIONS,
] as const
```

- [ ] **Step 5: Widen the center rows + add the ramp axis + repeat/falloff controls**

Change the two center rows and innerRadius (lines 62-64) from `when: isRadial` to `when: usesCenter`:

```ts
  slider('canvas.innerRadius', 'Inner radius', 0, 0.9, 0.01, 'Canvas', undefined, { when: usesCenter }),
  slider('canvas.center.x', 'Center X', -0.5, 0.5, 0.01, 'Canvas', undefined, { when: usesCenter }),
  slider('canvas.center.y', 'Center Y', -0.5, 0.5, 0.01, 'Canvas', undefined, { when: usesCenter }),
```

Add a Gradient-section block (place it right after the Canvas block, before the Colours comment at line 66):

```ts
  // --- Gradient axis (simple primitives: ramp / radialRamp / conic) ---------
  slider('layer.ramp.angle', 'Angle', 0, 360, 1, 'Gradient', 'Direction of the ramp (linear) / start rotation (conic)', { when: isRampLinear }),
  slider('layer.ramp.radius', 'Radius', 0.05, 2, 0.01, 'Gradient', 'Radial ramp size; 1 ≈ touches the frame edge', { when: (c) => c.canvas.layout === 'radialRamp' }),
  { key: 'layer.ramp.shape', label: 'Radial shape', kind: 'select', options: ['circle', 'ellipse'], default: 'circle', group: 'Gradient', when: (c) => c.canvas.layout === 'radialRamp', hint: 'circle = aspect-corrected round; ellipse = stretched to the frame' } as GradientControl,
  slider('layer.ramp.sweep', 'Sweep', 20, 360, 1, 'Gradient', 'Conic arc in degrees', { when: (c) => c.canvas.layout === 'conic' }),
  { key: 'layer.ramp.closeLoop', label: 'Close loop', kind: 'switch', default: false, group: 'Gradient', when: (c) => c.canvas.layout === 'conic', hint: 'Wrap the ramp so the first and last colour meet seamlessly' } as GradientControl,

  // --- Repeat / Falloff (every layout) --------------------------------------
  { key: 'layer.color.repeat', label: 'Repeat', kind: 'select', options: ['once', 'mirror', 'tile'], default: 'once', group: 'Layer', hint: 'Repeat the ramp: once / mirror (reflect) / tile ×N' } as GradientControl,
  slider('layer.color.repeatCount', 'Repeat count', 2, 16, 1, 'Layer', undefined, { when: (c) => (c.layers?.[0]?.color?.repeat ?? 'once') === 'tile' }),
  { key: 'layer.color.falloff', label: 'Falloff', kind: 'select', options: ['linear', 'ease', 'smooth'], default: 'linear', group: 'Layer', hint: 'Ramp interpolation curve — smooth kills banding on long ramps' } as GradientControl,
```

NOTE: the `slider(...)` helper hardcodes `default: 0` (see its doc comment) — that's inert for these because the real defaults live in `RAMP_DEFAULTS`/`ensureConfigDefaults`; matches how every other Gradient slider already works.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-simple-gradients-controls.unit.spec.ts --no-coverage`
Expected: PASS (6 tests).

- [ ] **Step 7: Run the existing controls characterization suite**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-controls.unit.spec.ts --no-coverage`
Expected: This suite CHARACTERIZES the agent vocabulary. New controls change the snapshot for the default (`ramp`) layout. If it fails on added keys, update the snapshot to include the new keys **only where legitimately added** (the ramp axis + repeat/falloff); do NOT let Shape/Relief keys appear on simple layouts. If it fails because the default layout changed from `linear` to `ramp`, that's Task 7's change — at THIS task the default is still `linear`, so the only diffs should be the universally-added `layer.color.repeat`/`falloff` keys. Update expected arrays accordingly and note it in the commit.

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/gradientfx/controls.ts frontend/tests/unit/gradientfx-simple-gradients-controls.unit.spec.ts frontend/tests/unit/gradientfx-controls.unit.spec.ts
git commit -m "feat(gradient): invert isBanded, add Gradient section + ramp/repeat/falloff controls"
```

---

### Task 5: Shader branch + renderer uniform upload (the layouts actually render)

**Files:**
- Modify: `frontend/app/lib/gradientfx/shaders.ts` (uniform decls ~lines 50-71; add GLSL `applyRepeat` helper; new branch at the TOP of `computeLayer` at line 270)
- Modify: `frontend/app/lib/gradientfx/renderer.ts` (`LAYOUT_IDX` line 43; per-layer arrays lines 271-275; collection loop lines 276-304; `buildRampLut` call line 281; uniform upload block lines 410-431)
- Test: verified live (Task 9) — GL cannot run under Vitest (every three.js/GL test in this repo mocks the context)

**Interfaces:**
- Consumes: `applyRepeat`/`REPEAT_IDX` (Task 3), `buildRampLut(stops, falloff)` (Task 2), `RAMP_DEFAULTS` (Task 1)
- Produces: layouts `ramp`/`radialRamp`/`conic` render a parametric ramp; uniforms `u_rampAngle[]`, `u_rampRadius[]`, `u_rampShape[]`, `u_rampSweep[]`, `u_rampCloseLoop[]`, `u_repeat[]`, `u_repeatCount[]`

- [ ] **Step 1: Add uniform declarations in `shaders.ts`** (with the other per-layer `[LAYER_MAX]` uniforms, ~line 71):

```glsl
uniform float u_rampAngle[LAYER_MAX];     // simple ramp/conic angle, degrees
uniform float u_rampRadius[LAYER_MAX];    // simple radial size
uniform float u_rampShape[LAYER_MAX];     // radial: 1 circle (aspect-corrected), 0 ellipse
uniform float u_rampSweep[LAYER_MAX];     // conic arc, degrees
uniform float u_rampCloseLoop[LAYER_MAX]; // conic: 1 wrap seamless
uniform float u_repeat[LAYER_MAX];        // 0 once, 1 mirror, 2 tile
uniform float u_repeatCount[LAYER_MAX];   // tile/mirror count
```

- [ ] **Step 2: Add the GLSL `applyRepeat` helper** (near the top of the fragment body, before `computeLayer` at line 270; it must be the verbatim twin of `repeat.ts`):

```glsl
float applyRepeat(float t, float mode, float count) {
  if (mode < 0.5) return t;                                   // once
  float n = max(1.0, count);
  if (mode < 1.5) return abs(fract(t * n * 0.5) * 2.0 - 1.0); // mirror (reflect)
  return fract(t * n);                                        // tile
}
```

- [ ] **Step 3: Add the simple-primitive branch at the TOP of `computeLayer`** (immediately after the local var block, BEFORE the `if (u_layout > 4.5)` mesh branch at line 281):

```glsl
  // ---- Simple primitives (ramp 6 / radialRamp 7 / conic 8): a clean parametric
  // t → LUT. Tested ABOVE the existing ladder so indices 6-8 never fall into mesh.
  if (u_layout > 5.5) {
    float t;
    if (u_layout < 6.5) {                    // ramp — angled linear
      float a = u_rampAngle[i] * PI / 180.0;
      vec2 dir = vec2(cos(a), sin(a));
      vec2 pc = p - 0.5; pc.x *= u_aspect;
      t = dot(pc, dir) + 0.5;
    } else if (u_layout < 7.5) {             // radialRamp — centre-out
      vec2 d = p - 0.5 - u_center;
      if (u_rampShape[i] > 0.5) d.x *= u_aspect;   // circle: aspect-correct
      float r = length(d) * 2.0 / max(u_rampRadius[i], 0.001);
      t = (r - u_innerRadius) / max(1.0 - u_innerRadius, 0.001);
    } else {                                 // conic — angular sweep
      vec2 d = p - 0.5 - u_center; d.x *= u_aspect;
      float ang = fract(atan(d.y, d.x) / TAU + 0.5 - u_rampAngle[i] / 360.0);
      float sweep = clamp(u_rampSweep[i] / 360.0, 0.05, 1.0);
      t = ang / sweep;
      if (u_rampCloseLoop[i] > 0.5) t = 1.0 - abs(fract(t) * 2.0 - 1.0); // wrap seamless
    }
    t = applyRepeat(t, u_repeat[i], u_repeatCount[i]);
    t = clamp(t, 0.0, 1.0);
    t += u_hueDrift[i] / 360.0 * (t - 0.5);  // parity with other branches' drift use
    t = quantize(t, u_steps[i]);
    vec3 col = rotateHue(sampleRamp(i, t), u_hueRotate[i]);
    return vec4(col, 1.0);
  }
```

(If `quantize`, `sampleRamp`, `rotateHue`, `TAU`, `PI` are defined below `computeLayer`, they are still in scope — GLSL hoists top-level function/const declarations. Confirm they exist earlier in the file; they are used by the mesh branch just below, so they are in scope.)

- [ ] **Step 4: Wire `LAYOUT_IDX` in `renderer.ts` (line 43)**

```ts
const LAYOUT_IDX: Record<LayoutKind, number> = { ramp: 6, radialRamp: 7, conic: 8, linear: 0, radial: 1, orbit: 2, stack: 3, liquid: 4, mesh: 5 }
```

- [ ] **Step 5: Add per-layer collection arrays (after line 275)**

```ts
    const rampAngle: number[] = [], rampRadius: number[] = [], rampShape: number[] = [], rampSweep: number[] = [], rampCloseLoop: number[] = []
    const repeat: number[] = [], repeatCount: number[] = []
```

Import the repeat index at the top of `renderer.ts` (next to the `buildRampLut` import at line 8):

```ts
import { REPEAT_IDX } from './repeat'
import { RAMP_DEFAULTS } from './types'
```

- [ ] **Step 6: Populate them in the layer loop + pass falloff to buildRampLut (lines 281, 300-303)**

Change line 281:

```ts
      this.uploadRamp(gl, i, buildRampLut(col.stops, col.falloff ?? 'linear'))
```

Add inside the loop (after the `ringShape.push(...)` at line 303):

```ts
      const rp = L.ramp ?? RAMP_DEFAULTS
      rampAngle.push(rp.angle)
      rampRadius.push(rp.radius)
      rampShape.push(rp.shape === 'ellipse' ? 0 : 1)
      rampSweep.push(rp.sweep)
      rampCloseLoop.push(rp.closeLoop ? 1 : 0)
      repeat.push(REPEAT_IDX[col.repeat ?? 'once'] ?? 0)
      repeatCount.push(col.repeatCount ?? 4)
```

- [ ] **Step 7: Upload the uniforms (after the `u_fieldW` upload at line 431)**

```ts
    gl.uniform1fv(u('u_rampAngle'), arr(rampAngle))
    gl.uniform1fv(u('u_rampRadius'), arr(rampRadius))
    gl.uniform1fv(u('u_rampShape'), arr(rampShape))
    gl.uniform1fv(u('u_rampSweep'), arr(rampSweep))
    gl.uniform1fv(u('u_rampCloseLoop'), arr(rampCloseLoop))
    gl.uniform1fv(u('u_repeat'), arr(repeat))
    gl.uniform1fv(u('u_repeatCount'), arr(repeatCount))
```

- [ ] **Step 8: Compile-check (no GL execution, just that the bundle builds and the shader string has no obvious syntax error)**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "gradientfx/renderer\|gradientfx/shaders" || echo "no new type errors in renderer/shaders"`
Expected: `no new type errors in renderer/shaders` (baseline typecheck errors elsewhere are pre-existing — see [[typecheck-baseline-anchoring]]; only NEW errors naming renderer.ts/shaders.ts matter).

- [ ] **Step 9: Commit**

```bash
git add frontend/app/lib/gradientfx/shaders.ts frontend/app/lib/gradientfx/renderer.ts
git commit -m "feat(gradient): render ramp/radialRamp/conic — shader branch + uniform upload"
```

---

### Task 6: Surface UI — labels, Gradient axis block, repeat/falloff rows

**Files:**
- Modify: `frontend/app/components/vue-canvas/GradientStudioSurface.vue` (imports line 41-42; picker markup lines 903-910; add a Gradient axis block after the Canvas block; add repeat/falloff rows in the Layer section)
- Test: verified live (Task 9)

**Interfaces:**
- Consumes: `LAYOUT_LABELS` (Task 1), the new control keys (Task 4)
- Produces: the picker shows renamed labels + the three new layouts; simple layouts show the axis sliders; repeat/falloff visible everywhere

- [ ] **Step 1: Import `LAYOUT_LABELS`** — add to the existing `~/lib/gradientfx/types` import block (line 41-42):

```ts
  ASPECTS, BLEND_MODES, DEFAULT_FOCUS, DIRECTIONS, GRADIENT_DIRS, LAYER_MAX, LAYOUTS, LAYOUT_LABELS, MAPPINGS, MIRROR_KINDS, RING_SHAPES, SHAPE_KINDS,
```

- [ ] **Step 2: Add computed predicates** near `isRadial` (line 59):

```ts
const isSimpleRamp = computed(() => ['ramp','radialRamp','conic'].includes(config.value.canvas.layout))
const isRampAngle = computed(() => config.value.canvas.layout === 'ramp' || config.value.canvas.layout === 'conic')
const isRampRadial = computed(() => config.value.canvas.layout === 'radialRamp')
const isConic = computed(() => config.value.canvas.layout === 'conic')
const LAYOUT_ORDER: LayoutKind[] = ['ramp','radialRamp','conic','linear','radial','orbit','stack','liquid','mesh']
```

- [ ] **Step 3: Render labels + ordering in the picker (lines 907-910)**

```vue
        <div class="mb-2 grid grid-cols-3 gap-1">
          <button v-for="l in LAYOUT_ORDER" :key="l" class="rounded px-1 py-1 text-[11px] transition"
                  :class="config.canvas.layout === l ? 'bg-white/20 text-white' : 'bg-white/[0.04] text-white/55 hover:bg-white/10'"
                  @click="setLayout(l)">{{ LAYOUT_LABELS[l] }}</button>
        </div>
```

(Dropped the `capitalize` class — labels are already cased.)

- [ ] **Step 4: Add the Gradient axis block** — place it right after the Canvas `<template v-if="isRadial">…</template>` block (near line 938, before the Flow section). Mirror the existing slider markup exactly (plain `<input type="range">` bound to `config`, with `onEdit`); use `BindableRow` like neighbouring rows so promote/bind works:

```vue
      <!-- Gradient axis — the simple primitives (Linear / Radial / Conic). -->
      <StudioSection v-show="onDesign && isSimpleRamp" title="Gradient" :open="true">
        <template v-if="isRampAngle">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Angle</span><span class="text-white/40">{{ Math.round(config.layers[activeLayer].ramp?.angle ?? 90) }}°</span></label>
          <input :value="config.layers[activeLayer].ramp?.angle ?? 90" type="range" min="0" max="360" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onRamp('angle', ($event.target as HTMLInputElement).valueAsNumber)" />
        </template>
        <template v-if="isRampRadial">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Radius</span><span class="text-white/40">{{ (config.layers[activeLayer].ramp?.radius ?? 1).toFixed(2) }}</span></label>
          <input :value="config.layers[activeLayer].ramp?.radius ?? 1" type="range" min="0.05" max="2" step="0.01" v-studio-reset class="studio-range mb-2 w-full" @input="onRamp('radius', ($event.target as HTMLInputElement).valueAsNumber)" />
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Shape</span></label>
          <select :value="config.layers[activeLayer].ramp?.shape ?? 'circle'" class="studio-select mb-2 w-full" @change="onRamp('shape', ($event.target as HTMLSelectElement).value)">
            <option value="circle">Circle</option><option value="ellipse">Ellipse</option>
          </select>
        </template>
        <template v-if="isConic">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Sweep</span><span class="text-white/40">{{ Math.round(config.layers[activeLayer].ramp?.sweep ?? 360) }}°</span></label>
          <input :value="config.layers[activeLayer].ramp?.sweep ?? 360" type="range" min="20" max="360" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onRamp('sweep', ($event.target as HTMLInputElement).valueAsNumber)" />
          <label class="flex items-center gap-2 text-xs text-white/60">
            <input type="checkbox" :checked="config.layers[activeLayer].ramp?.closeLoop ?? false" @change="onRamp('closeLoop', ($event.target as HTMLInputElement).checked)" />
            <span>Close loop</span>
          </label>
        </template>
      </StudioSection>
```

- [ ] **Step 5: Add the `onRamp` helper + a `activeLayer` reference.** Near `setLayout` (line 794). Check whether the component already has an active-layer index (grep for `activeLayer`); if it does, reuse it — otherwise use `0`. The helper writes through `config` and calls the existing edit path:

```ts
function onRamp(key: 'angle'|'radius'|'shape'|'sweep'|'closeLoop', value: number | string | boolean) {
  const L = config.value.layers[activeLayer.value] ?? config.value.layers[0]
  if (!L) return
  if (!L.ramp) L.ramp = { ...RAMP_DEFAULTS }
  ;(L.ramp as any)[key] = value
  onEdit(`layer.ramp.${key}`, value as any)
}
```

Import `RAMP_DEFAULTS` in the same types import (Step 1 line). If there is no `activeLayer` ref, add `const activeLayer = ref(0)` or reuse the existing selected-layer state — grep first: `grep -n "activeLayer\|selectedLayer\|layerIndex" GradientStudioSurface.vue`.

- [ ] **Step 6: Add Repeat / Falloff rows** in the Layer section (grep for where `layer.color.steps`/`Posterize` renders — around the hueDrift/hueRotate rows). Add:

```vue
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Repeat</span></label>
        <select :value="config.layers[activeLayer].color.repeat ?? 'once'" class="studio-select mb-2 w-full" @change="onColor('repeat', ($event.target as HTMLSelectElement).value)">
          <option value="once">Once</option><option value="mirror">Mirror</option><option value="tile">Tile</option>
        </select>
        <template v-if="(config.layers[activeLayer].color.repeat ?? 'once') === 'tile'">
          <label class="mb-1 flex justify-between text-xs text-white/60"><span>Repeat count</span><span class="text-white/40">{{ config.layers[activeLayer].color.repeatCount ?? 4 }}</span></label>
          <input :value="config.layers[activeLayer].color.repeatCount ?? 4" type="range" min="2" max="16" step="1" v-studio-reset class="studio-range mb-2 w-full" @input="onColor('repeatCount', ($event.target as HTMLInputElement).valueAsNumber)" />
        </template>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Falloff</span></label>
        <select :value="config.layers[activeLayer].color.falloff ?? 'linear'" class="studio-select mb-2 w-full" @change="onColor('falloff', ($event.target as HTMLSelectElement).value)">
          <option value="linear">Linear</option><option value="ease">Ease</option><option value="smooth">Smooth</option>
        </select>
```

with a sibling helper:

```ts
function onColor(key: 'repeat'|'repeatCount'|'falloff', value: number | string) {
  const L = config.value.layers[activeLayer.value] ?? config.value.layers[0]
  if (!L) return
  ;(L.color as any)[key] = value
  onEdit(`layer.color.${key}`, value as any)
}
```

- [ ] **Step 7: Compile-check the component**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "GradientStudioSurface" || echo "no new type errors in GradientStudioSurface"`
Expected: `no new type errors in GradientStudioSurface` (pre-existing baseline errors elsewhere ignored).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/components/vue-canvas/GradientStudioSurface.vue
git commit -m "feat(gradient): surface — renamed labels, Gradient axis block, repeat/falloff rows"
```

---

### Task 7: Default layout + randomize pool + preset repoint

**Files:**
- Modify: `frontend/app/lib/gradientfx/randomize.ts` (`defaultConfig`; `randFlow` line 115; `stripeConfig` new)
- Modify: `frontend/app/lib/gradientfx/presets.ts` (BUILDERS `linear` line 34)
- Test: `frontend/tests/unit/gradientfx-simple-gradients-defaults.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `RAMP_DEFAULTS` (Task 1), `buildGradientPreset` (existing)
- Produces: `defaultConfig()` returns `layout:'ramp'` with a 3-stop palette + `ramp`; `stripeConfig(seed)` returns the old stripe default (`layout:'linear'`); `buildGradientPreset('linear')` still yields `layout:'linear'`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/gradientfx-simple-gradients-defaults.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { defaultConfig, stripeConfig } from '~/lib/gradientfx/randomize'
import { buildGradientPreset } from '~/lib/gradientfx/presets'

describe('simple-gradient defaults', () => {
  it('a fresh document opens on the simple Linear ramp', () => {
    const c = defaultConfig('#fresh001')
    expect(c.canvas.layout).toBe('ramp')
    expect(c.layers[0]!.ramp).toBeTruthy()
    expect(c.layers[0]!.color.stops.length).toBeGreaterThanOrEqual(2)
  })

  it('stripeConfig still produces the stripe archetype', () => {
    expect(stripeConfig('#stripe01').canvas.layout).toBe('linear')
  })

  it('the linear PRESET still yields a stripe layout (repointed, not the new default)', () => {
    expect(buildGradientPreset('linear', '#p1')!.canvas.layout).toBe('linear')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-simple-gradients-defaults.unit.spec.ts --no-coverage`
Expected: FAIL — `defaultConfig` returns `linear`; `stripeConfig` undefined.

- [ ] **Step 3: In `randomize.ts`, rename the old default to `stripeConfig` and add the new `defaultConfig`**

Find the current `export function defaultConfig(seed…)`. Rename it to `stripeConfig` (keep its exact body), then add a new `defaultConfig` above/below it:

```ts
/** The stripe archetype — the historical default (staggered full-height bands).
 *  Kept as its own builder because the `linear` PRESET points here. */
export function stripeConfig(seed: string = randomSeed()): GradientConfig {
  // ... EXACT former body of defaultConfig ...
}

/** New-document default: a plain two/three-stop Linear ramp. */
export function defaultConfig(seed: string = randomSeed()): GradientConfig {
  const c = stripeConfig(seed)
  c.canvas.layout = 'ramp'
  c.canvas.margin = 0
  c.layers = [c.layers[0]!]
  c.layers[0]!.ramp = { ...RAMP_DEFAULTS, angle: 90 }
  c.layers[0]!.color.stops = [
    { color: '#5b8def', pos: 0 },
    { color: '#a06bf0', pos: 0.5 },
    { color: '#ef6ba0', pos: 1 },
  ]
  c.layers[0]!.color.mapping = 'across'
  return ensureConfigDefaults(c)
}
```

Ensure `RAMP_DEFAULTS` and `ensureConfigDefaults` are imported at the top of `randomize.ts` (grep; `ensureConfigDefaults` likely already is).

- [ ] **Step 4: Repoint the `linear` preset builder in `presets.ts` (line 34)**

```ts
  linear: s => stripeConfig(s),
```

and update the import on line 13 to include `stripeConfig`:

```ts
import { defaultConfig, liquidConfig, liquidPresetConfig, meshConfig, rippleConfig, stackConfig, stripeConfig } from './randomize'
```

- [ ] **Step 5: `randFlow` treats the simple layouts as geometric (line 115)** — they should get the same subtle/no warp as stripe layouts, which is already the default `else` branch (only `liquid`/`mesh` are special-cased), so **no change needed** unless a test shows otherwise. Confirm by reading `randFlow`; if it special-cases anything by name that would misfire on `ramp`/`radialRamp`/`conic`, guard it. (Expected: no edit.)

- [ ] **Step 6: Run the new test + the characterization suite (default layout changed now)**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-simple-gradients-defaults.unit.spec.ts tests/unit/gradientfx-controls.unit.spec.ts --no-coverage`
Expected: new test PASS. The characterization suite's default-config snapshot now reflects `ramp` — update its expected arrays to the ramp layout's visible controls (angle + repeat/falloff, no Shape/Relief). This is the legitimate, intended vocabulary move; note it in the commit message.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/gradientfx/randomize.ts frontend/app/lib/gradientfx/presets.ts frontend/tests/unit/gradientfx-simple-gradients-defaults.unit.spec.ts frontend/tests/unit/gradientfx-controls.unit.spec.ts
git commit -m "feat(gradient): default new docs to simple Linear ramp; repoint linear preset to stripes"
```

---

### Task 8: Authored style presets (dawn / halo / spectrum)

**Files:**
- Modify: `frontend/app/lib/gradientfx/presetConfigs.ts` (add to `AUTHORED_PRESETS`)
- Modify: `frontend/app/lib/gradientfx/presets.ts` (`GradientPresetName` union line 18-20; BUILDERS if giving them algorithmic fallbacks)
- Test: `frontend/tests/unit/gradientfx-simple-gradients-presets.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `buildGradientPreset` (existing), `AUTHORED_PRESETS` (existing)
- Produces: presets `dawn` (ramp), `halo` (radialRamp), `spectrum` (conic, closeLoop) resolvable via `buildGradientPreset` and present in `GRADIENT_PRESET_NAMES`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/gradientfx-simple-gradients-presets.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { buildGradientPreset, GRADIENT_PRESET_NAMES } from '~/lib/gradientfx/presets'

describe('simple-gradient authored presets', () => {
  it('dawn / halo / spectrum are offered and resolve to the right layouts', () => {
    for (const n of ['dawn','halo','spectrum']) expect(GRADIENT_PRESET_NAMES).toContain(n)
    expect(buildGradientPreset('dawn', '#a')!.canvas.layout).toBe('ramp')
    expect(buildGradientPreset('halo', '#b')!.canvas.layout).toBe('radialRamp')
    const spectrum = buildGradientPreset('spectrum', '#c')!
    expect(spectrum.canvas.layout).toBe('conic')
    expect(spectrum.layers[0]!.ramp?.closeLoop).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-simple-gradients-presets.unit.spec.ts --no-coverage`
Expected: FAIL — presets not defined.

- [ ] **Step 3: Add the three authored presets to `presetConfigs.ts`**

Add these entries to `AUTHORED_PRESETS` (full configs, matching the shape of the existing entries — `seed`, `post:{...DEFAULT_POST}`, `canvas`, `relief`, `flow`, `layers` with `ramp`, `motion`, `locks`, `focus`). Use the DEFAULT_FLOW-equivalent low-warp values already visible in the `sunset` entry as a template. Concretely:

```ts
  // Simple Linear — soft dawn sky ramp, top→bottom.
  dawn: {"seed":"#dawn0001","post":{...DEFAULT_POST},"canvas":{"aspect":"16:9","layout":"ramp","margin":0,"innerRadius":0,"background":"#000000","center":{"x":0,"y":0}},"relief":{"grain":0,"relief":0,"light":{"azimuth":135,"elevation":45}},"flow":{"angle":90,"noiseScale":3,"intensity":0,"distortion":0,"detail":3,"depth":0,"highlights":0,"shadows":0,"foldScale":50,"speed":0,"gloss":0,"veins":0,"veinScale":25,"ripple":0,"refract":0,"viscosity":50,"swirl":0},"layers":[{"blend":"normal","opacity":1,"shape":{"type":"bands","count":12,"minDepth":0,"curveExp":1,"jitter":0,"peaks":3,"phase":0,"detail":4,"sweep":360,"scrub":0,"gap":0,"rounding":0,"direction":"up","mirror":"none","valley":0.5},"color":{"stops":[{"color":"#ffd9a8","pos":0},{"color":"#ff9ec4","pos":0.45},{"color":"#7c6cf0","pos":1}],"gradientDir":"vertical","mapping":"across","steps":0,"hueDrift":0,"hueRotate":0,"repeat":"once","repeatCount":4,"falloff":"smooth"},"ramp":{"angle":90,"radius":1,"shape":"circle","sweep":360,"closeLoop":false}}],"motion":{"tracks":[],"duration":6,"fps":30,"size":1080},"locks":{},"focus":{"blur":0,"shape":"off","x":0,"y":0,"radius":0.25,"softness":40,"angle":0}},

  // Simple Radial — warm halo glow from centre.
  halo: {"seed":"#halo0001","post":{...DEFAULT_POST},"canvas":{"aspect":"1:1","layout":"radialRamp","margin":0,"innerRadius":0,"background":"#0a0a16","center":{"x":0,"y":0}},"relief":{"grain":0,"relief":0,"light":{"azimuth":135,"elevation":45}},"flow":{"angle":90,"noiseScale":3,"intensity":0,"distortion":0,"detail":3,"depth":0,"highlights":0,"shadows":0,"foldScale":50,"speed":0,"gloss":0,"veins":0,"veinScale":25,"ripple":0,"refract":0,"viscosity":50,"swirl":0},"layers":[{"blend":"normal","opacity":1,"shape":{"type":"bands","count":12,"minDepth":0,"curveExp":1,"jitter":0,"peaks":3,"phase":0,"detail":4,"sweep":360,"scrub":0,"gap":0,"rounding":0,"direction":"up","mirror":"none","valley":0.5},"color":{"stops":[{"color":"#fff3c4","pos":0},{"color":"#ff8a5c","pos":0.5},{"color":"#3b1060","pos":1}],"gradientDir":"vertical","mapping":"across","steps":0,"hueDrift":0,"hueRotate":0,"repeat":"once","repeatCount":4,"falloff":"smooth"},"ramp":{"angle":90,"radius":1.1,"shape":"circle","sweep":360,"closeLoop":false}}],"motion":{"tracks":[],"duration":6,"fps":30,"size":1080},"locks":{},"focus":{"blur":0,"shape":"off","x":0,"y":0,"radius":0.25,"softness":40,"angle":0}},

  // Simple Conic — seamless spectrum wheel.
  spectrum: {"seed":"#spec0001","post":{...DEFAULT_POST},"canvas":{"aspect":"1:1","layout":"conic","margin":0,"innerRadius":0,"background":"#000000","center":{"x":0,"y":0}},"relief":{"grain":0,"relief":0,"light":{"azimuth":135,"elevation":45}},"flow":{"angle":90,"noiseScale":3,"intensity":0,"distortion":0,"detail":3,"depth":0,"highlights":0,"shadows":0,"foldScale":50,"speed":0,"gloss":0,"veins":0,"veinScale":25,"ripple":0,"refract":0,"viscosity":50,"swirl":0},"layers":[{"blend":"normal","opacity":1,"shape":{"type":"bands","count":12,"minDepth":0,"curveExp":1,"jitter":0,"peaks":3,"phase":0,"detail":4,"sweep":360,"scrub":0,"gap":0,"rounding":0,"direction":"up","mirror":"none","valley":0.5},"color":{"stops":[{"color":"#ff4d4d","pos":0},{"color":"#ffe14d","pos":0.2},{"color":"#4dff88","pos":0.4},{"color":"#4dd2ff","pos":0.6},{"color":"#a04dff","pos":0.8},{"color":"#ff4d4d","pos":1}],"gradientDir":"vertical","mapping":"across","steps":0,"hueDrift":0,"hueRotate":0,"repeat":"once","repeatCount":4,"falloff":"linear"},"ramp":{"angle":0,"radius":1,"shape":"circle","sweep":360,"closeLoop":true}}],"motion":{"tracks":[],"duration":6,"fps":30,"size":1080},"locks":{},"focus":{"blur":0,"shape":"off","x":0,"y":0,"radius":0.25,"softness":40,"angle":0}},
```

- [ ] **Step 4: Add the names to the `GradientPresetName` union in `presets.ts` (lines 18-20)**

```ts
export type GradientPresetName =
  | 'marble' | 'oil' | 'ink' | 'lava' | 'satin'
  | 'liquid' | 'ripple' | 'stack' | 'mesh' | 'linear'
  | 'dawn' | 'halo' | 'spectrum'   // simple-primitive authored presets
```

They resolve through `AUTHORED_PRESETS` (which `GRADIENT_PRESET_NAMES` unions in), so no BUILDERS entry is required. If TypeScript complains that `BUILDERS` must cover the union (it's typed `Record<GradientPresetName, …>`), add algorithmic fallbacks:

```ts
  dawn: s => defaultConfig(s),
  halo: s => { const c = defaultConfig(s); c.canvas.layout = 'radialRamp'; return c },
  spectrum: s => { const c = defaultConfig(s); c.canvas.layout = 'conic'; c.layers[0]!.ramp = { angle:0, radius:1, shape:'circle', sweep:360, closeLoop:true }; return c },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-simple-gradients-presets.unit.spec.ts --no-coverage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/gradientfx/presetConfigs.ts frontend/app/lib/gradientfx/presets.ts frontend/tests/unit/gradientfx-simple-gradients-presets.unit.spec.ts
git commit -m "feat(gradient): authored presets — dawn / halo / spectrum"
```

---

### Task 9: Live differential verification (the layouts really render, and the controls really steer)

**Files:** none (verification only — produces evidence, no code unless a defect is found)

This is the task the spec's testing strategy hinges on: unit tests prove the pure
functions; only a live render proves the shader branch is reached and the uniforms
are wired. Per [[graceful-fallback-hides-integration-failure]] and
[[synthetic-pointer-events-prove-nothing]], "it looks like a gradient" is NOT proof
— assert the branch ran by diffing pixels across a control change.

- [ ] **Step 1: Full unit sweep is green**

Run: `cd frontend && npx vitest run tests/unit/gradientfx-*.unit.spec.ts --no-coverage`
Expected: all gradientfx unit suites PASS (new + existing). Note the collected-file count and `uptime` — a low count means a silent collection failure, not a pass ([[vitest-counts-lie-under-load]]).

- [ ] **Step 2: Start the dev server via the project launcher**

Check for an existing server first (`ps aux | grep -i nuxt`) to avoid the parallel-session lock ([[orphaned-dev-servers-from-parallel-sessions]]). Use `./dev.sh` if free, or preview_start `{name}` from `.claude/launch.json`. Base URL is `127.0.0.1:3000` (NOT localhost — [[sailor-dev-server-localhost-426]]).

- [ ] **Step 3: Open Gradient Studio and drive it headlessly**

Use the Browser pane. Add a Gradient Studio node (`sailor:addNode` recipe — [[sailor-dev-environment]]) or open an existing gradient. Hard-reload before debugging to avoid HMR-stale pages ([[3d-studio-text-extrude-planned]]).

For each check, render the config and read the framebuffer bytes via the studio's existing headless bake / canvas readback (grep the surface for the debug hook, or use `sailor:` bridge). Assert **differentially**:

- [ ] **Step 4: Branch-reached proof** — render `layout:'ramp'` and `layout:'linear'` at the SAME 3-stop palette; assert the two RGBA buffers are NOT equal (if equal, the branch fell through to a stripe/mesh path).
- [ ] **Step 5: Linear angle steers** — render `ramp` at `ramp.angle=0` vs `90`; assert the dominant gradient axis rotates (row-mean variance vs col-mean variance swap dominance).
- [ ] **Step 6: Radial collapses** — render `radialRamp` at `radius=2` vs `radius=0.05`; assert mean-colour distribution changes (tiny radius → mostly the last stop).
- [ ] **Step 7: Conic sweep + close-loop** — render `conic` sweep 360 with `closeLoop=false` vs `true` on a non-matching first/last stop; assert the left-edge vs right-edge seam delta drops toward 0 with the loop closed.
- [ ] **Step 8: Repeat tiles** — render `ramp` `repeat:'tile'` count 3; assert 3 detectable ramp cycles across the axis (count local minima of a channel along the axis).
- [ ] **Step 9: Presets load** — apply `dawn`, `halo`, `spectrum`; screenshot each; confirm the intended look (linear sky / radial glow / seamless wheel).
- [ ] **Step 10: Capture screenshots** for the handoff summary (one per new layout + one showing repeat tiling).

- [ ] **Step 11: If any check fails**, diagnose against the shader branch / uniform upload (Task 5) — the usual culprits: branch below the mesh `>4.5` test (renders as mesh), scalar instead of `[i]` uniform (all layers share one angle), or `LAYOUT_IDX` mismatch. Fix in the relevant task's files, re-run from Step 1.

- [ ] **Step 12: No commit** unless a fix was made. Record the evidence (screenshots + which differential assertions passed) for the final summary.

---

### Task 10: Docs — STATE.md + build dashboard + memory

**Files:**
- Modify: `docs/STATE.md` (the Gradient Studio row line 20; add a landed entry)
- Modify: the live ⛵ build dashboard artifact ([[sailor-build-dashboard]], [[update-dashboard-on-every-commit]] — read the LIVE one first)
- Create: a memory file if a non-obvious gotcha surfaced (per the memory rules)

- [ ] **Step 1: Add a STATE.md landed entry** summarising: three simple primitives (ramp/radialRamp/conic) as new layouts tested above the shader ladder; labels-only rename (zero migration); universal Repeat (GLSL+TS twin) + Falloff (LUT curve); default doc now Linear ramp; dawn/halo/spectrum presets. Cite the spec + plan paths. Update the Gradient Studio capability row.

- [ ] **Step 2: Update the ⛵ dashboard artifact** — read the live one, add the simple-gradients line, redeploy to the same URL.

- [ ] **Step 3: Write a memory** only if Task 9 surfaced something non-obvious (e.g. a headless-readback quirk, a uniform-array gotcha). Otherwise skip — the spec/plan/STATE already record the design.

- [ ] **Step 4: Commit**

```bash
git add docs/STATE.md
git commit -m "docs: simple linear/radial/conic gradients + repeat/falloff — landed"
```

---

## Self-Review

**Spec coverage:**
- Rename (labels-only) → Task 1 (LAYOUT_LABELS) + Task 6 (picker). ✓
- Three primitives → Task 1 (types) + Task 5 (shader/renderer) + Task 6 (UI). ✓
- Simple Linear default → Task 7. ✓
- Repeat + Falloff universal → Task 2 (falloff LUT) + Task 3 (repeat TS) + Task 5 (GLSL/upload) + Task 4 (controls) + Task 6 (UI). ✓
- Close-loop toggle → Task 4 (control) + Task 5 (shader) + Task 6 (switch). ✓
- Authored presets → Task 8. ✓
- Center/innerRadius reuse → Task 4 (usesCenter widening). ✓
- Flow stays available → inherited (no gating added against simple layouts in Flow section); confirmed by isBanded only gating Shape/Relief/Margin. ✓
- Gating inversion (isBanded) → Task 4. ✓
- Testing strategy (differential + broken-control) → Task 9. ✓
- Risks (branch order, isBanded, preset collision, per-layer arrays) → covered in Tasks 5/4/7/9. ✓

**Placeholder scan:** No TBD/TODO. The two spots that say "grep first" (activeLayer ref in Task 6, randFlow in Task 7 Step 5) are conditional-reuse instructions with a concrete fallback given, not placeholders.

**Type consistency:** `RampConfig`/`RAMP_DEFAULTS`/`LAYOUT_LABELS`/`RepeatKind`/`FalloffKind` defined in Task 1, consumed with the same names in Tasks 2–8. `applyRepeat(t,mode,count)` signature identical in Task 3 (TS) and Task 5 (GLSL). `buildRampLut(stops, falloff?)` defined Task 2, called Task 5. `REPEAT_IDX` defined Task 3, used Task 5. `stripeConfig`/`defaultConfig` defined Task 7, `stripeConfig` used by Task 8 fallbacks. Consistent. ✓
