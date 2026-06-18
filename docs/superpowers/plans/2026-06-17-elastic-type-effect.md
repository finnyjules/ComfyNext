# Elastic Type Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Space Type effect `elastic` that warps stacked full-bleed type like a stretchy material, with a 5-mode dropdown (Wave/Spring/Taffy/Pinch/Jelly), static text/line skew + stagger, working in both orthographic and perspective cameras.

**Architecture:** A new effect module implementing the existing `SpaceTypeEffect` seam — one subdivided `PlaneGeometry` per line, vertex-shader displacement injected via `material.onBeforeCompile`, advanced per frame by `t01`-driven uniforms. Mirrors `field.ts`. The displacement and layout math is extracted into two **pure** modules (`elasticMath.ts`, `elasticLayout.ts`) that are unit-tested in node; the GLSL is a 1:1 mirror of `elasticMath.ts`. No engine/seam changes; one tiny surface tweak so the effect takes raw (un-padded) words.

**Tech Stack:** TypeScript, Three.js (vertex/fragment shader injection via `onBeforeCompile`), Vitest (node-env unit tests at `tests/unit/*.unit.spec.ts`), Nuxt 4 frontend.

---

## Background the engineer needs

- **The seam** (`frontend/app/lib/spacetype/effect.ts`): an effect is an object `{ id, label, controls, buildScene(three, params, textTexture), update(t01, params) }`. `controls` is a list of `ControlSpec` (slider/text/textList/fillList/color/select/font) — the surface auto-builds the UI from it. `buildScene` returns a `THREE.Object3D`; `update(t01)` must be **pure in `t01`** (same `t01` → same state) so the loop bakes seamlessly.
- **Closest sibling** to copy patterns from: `frontend/app/lib/spacetype/effects/field.ts` — subdivided plane, `onBeforeCompile` vertex displacement, module-level uniforms updated in `update`, fill compositing + optional shadow rig.
- **Text atlas** (`frontend/app/lib/spacetype/textTexture.ts`): when an effect declares a `textList` control, the surface builds an **N-row atlas** (`textTexture.userData.numTexts = N`), one row per line; row `k` is sampled at `v ∈ [k/N, (k+1)/N]`. `textTexture.userData.wordFracs[k]` = that line's pixel width ÷ the widest line's width (0..1). Each row is **left-aligned**, so a word occupies `u ∈ [0, wordFracs[k]]`. Stretching plane-`u ∈ [0,1]` onto `[0, wordFracs[k]]` makes each word fill its plane → the "V.STRETCH" full-bleed look.
- **Fill compositing** (`frontend/app/lib/spacetype/fills.ts`): `parseFills(params.fills)` → `Fill[]`; `fillShaderTexture(three, fill)` → a `THREE.Texture`; `fillTiling(fill)` → number. The fragment mixes `fill` with `textColor` using the atlas alpha (the drawn glyph color is irrelevant — only `.a` is used).
- **Unit tests** run in **node** (no WebGL/DOM). So only the **pure** math/layout modules are unit-tested directly; the effect module is covered by a **contract test** (import the object, assert its `controls`/`id`/`label`) plus in-app manual verification. Do **not** call `buildScene` from a unit test (it needs Three textures/canvas).

---

## File Structure

- **Create** `frontend/app/lib/spacetype/elasticLayout.ts` — pure layout helpers: `splitLines`, `stackPositions`, `lineStaggerOffsets`.
- **Create** `frontend/app/lib/spacetype/elasticMath.ts` — pure displacement reference: `ElasticMode`, `ELASTIC_MODES`, `ElasticParams`, `TAU`, `elasticOffset`. The GLSL in the effect mirrors this exactly.
- **Create** `frontend/app/lib/spacetype/effects/elastic.ts` — the `elasticEffect: SpaceTypeEffect` (controls + buildScene + update; GLSL mirror of `elasticMath`).
- **Modify** `frontend/app/lib/spacetype/effects/index.ts` — import + register `elasticEffect`.
- **Modify** `frontend/app/components/vue-canvas/SpaceTypeSurface.vue:192` — add `'elastic'` to the raw-words set so labels aren't padded with a trailing gap.
- **Create** `frontend/tests/unit/elastic-layout.unit.spec.ts` — tests for layout helpers.
- **Create** `frontend/tests/unit/elastic-math.unit.spec.ts` — tests for displacement math (incl. loop seamlessness, intensity scaling).
- **Create** `frontend/tests/unit/elastic-effect.unit.spec.ts` — contract + registration test.

All commands below run from `frontend/`.

---

### Task 1: Pure layout helpers

**Files:**
- Create: `frontend/app/lib/spacetype/elasticLayout.ts`
- Test: `frontend/tests/unit/elastic-layout.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/elastic-layout.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { splitLines, stackPositions, lineStaggerOffsets } from '../../app/lib/spacetype/elasticLayout'

describe('splitLines', () => {
  it('splits on newlines, trims, drops empties', () => {
    expect(splitLines('OLD\nWORLD\n NEW \nSCHOOL')).toEqual(['OLD', 'WORLD', 'NEW', 'SCHOOL'])
  })
  it('handles trailing newline and blank rows', () => {
    expect(splitLines('A\n\nB\n')).toEqual(['A', 'B'])
  })
  it('empty / nullish → empty array', () => {
    expect(splitLines('')).toEqual([])
    expect(splitLines(null)).toEqual([])
    expect(splitLines(undefined)).toEqual([])
  })
})

describe('stackPositions', () => {
  it('returns one y per line, top→bottom, centered on origin', () => {
    const ys = stackPositions(4, 2, 0) // step = 2, total = 8, centered
    expect(ys).toEqual([3, 1, -1, -3])
  })
  it('respects leading as extra gap between lines', () => {
    const ys = stackPositions(2, 2, 1) // step = 3
    expect(ys).toEqual([1.5, -1.5])
  })
  it('single line sits at origin', () => {
    expect(stackPositions(1, 2, 0)).toEqual([0])
  })
})

describe('lineStaggerOffsets', () => {
  it('centers the stagger so the stack stays balanced (sum ≈ 0)', () => {
    const xs = lineStaggerOffsets(4, 2) // mid = 1.5 → (i-1.5)*2
    expect(xs).toEqual([-3, -1, 1, 3])
    expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 10)
  })
  it('zero stagger → all zero', () => {
    expect(lineStaggerOffsets(3, 0)).toEqual([0, 0, 0])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/elastic-layout.unit.spec.ts`
Expected: FAIL — cannot resolve module `elasticLayout` (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/spacetype/elasticLayout.ts`:

```ts
/**
 * Pure layout helpers for the Elastic effect. No Three.js — unit-tested in node.
 * The effect's buildScene consumes these to position one plane per text line.
 */

/** Split a textList param (newline-separated) into trimmed, non-empty lines. */
export function splitLines(raw: unknown): string[] {
  return String(raw ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0)
}

/**
 * Y center of each line, ordered top→bottom, centered on the origin.
 * lineHeight = per-line world height; leading = extra gap added between lines.
 */
export function stackPositions(count: number, lineHeight: number, leading: number): number[] {
  const step = lineHeight + leading
  const total = step * count
  const top = total / 2 - step / 2
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(top - i * step)
  return out
}

/** Per-line horizontal offset for the stagger control, centered so the stack stays balanced. */
export function lineStaggerOffsets(count: number, stagger: number): number[] {
  const mid = (count - 1) / 2
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push((i - mid) * stagger)
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/elastic-layout.unit.spec.ts`
Expected: PASS — all 8 assertions green.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/elasticLayout.ts frontend/tests/unit/elastic-layout.unit.spec.ts
git commit -m "feat(elastic): pure layout helpers (splitLines, stackPositions, lineStaggerOffsets)"
```

---

### Task 2: Pure displacement math (the 5 modes)

**Files:**
- Create: `frontend/app/lib/spacetype/elasticMath.ts`
- Test: `frontend/tests/unit/elastic-math.unit.spec.ts`

The GLSL in Task 3 mirrors this file 1:1. The two key correctness properties — **seamless loop** (offset at `uTime=0` equals offset at `uTime=TAU` for every mode) and **linear intensity scaling** — are enforced here as tests.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/elastic-math.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { elasticOffset, ELASTIC_MODES, TAU, type ElasticMode, type ElasticParams } from '../../app/lib/spacetype/elasticMath'

const P: ElasticParams = { intensity: 1, stretch: 0.4, shear: 0.6, waveLength: 2 }
// A spread of sample points (px, py, lineT) covering the plane + stack.
const SAMPLES: [number, number, number][] = [
  [-1, 0.8, 0], [0.5, -0.5, 0.5], [1, 0.2, 1], [-0.3, -0.9, 0.25], [0.7, 0.6, 0.75],
]

describe('ELASTIC_MODES', () => {
  it('lists the five modes in picker order', () => {
    expect(ELASTIC_MODES).toEqual(['Wave', 'Spring', 'Taffy', 'Pinch', 'Jelly'])
  })
})

describe('elasticOffset — seamless loop', () => {
  it('offset at uTime=0 equals offset at uTime=TAU for every mode + sample', () => {
    for (let mode = 0 as ElasticMode; mode < 5; mode = (mode + 1) as ElasticMode) {
      for (const [px, py, lt] of SAMPLES) {
        const a = elasticOffset(mode, px, py, lt, 0, P)
        const b = elasticOffset(mode, px, py, lt, TAU, P)
        expect(b.dx).toBeCloseTo(a.dx, 6)
        expect(b.dy).toBeCloseTo(a.dy, 6)
      }
    }
  })
})

describe('elasticOffset — intensity', () => {
  it('scales linearly with intensity', () => {
    const half = elasticOffset(0, 0.5, 0.5, 0.3, 1.0, { ...P, intensity: 1 })
    const full = elasticOffset(0, 0.5, 0.5, 0.3, 1.0, { ...P, intensity: 2 })
    expect(full.dx).toBeCloseTo(half.dx * 2, 10)
    expect(full.dy).toBeCloseTo(half.dy * 2, 10)
  })
  it('intensity 0 → no displacement for every mode', () => {
    for (let mode = 0 as ElasticMode; mode < 5; mode = (mode + 1) as ElasticMode) {
      const o = elasticOffset(mode, 0.5, 0.5, 0.3, 1.0, { ...P, intensity: 0 })
      expect(o.dx).toBe(0)
      expect(o.dy).toBe(0)
    }
  })
})

describe('elasticOffset — actually moves', () => {
  it('each mode produces a non-zero offset somewhere mid-loop', () => {
    for (let mode = 0 as ElasticMode; mode < 5; mode = (mode + 1) as ElasticMode) {
      const moved = SAMPLES.some(([px, py, lt]) => {
        const o = elasticOffset(mode, px, py, lt, 1.3, P)
        return Math.abs(o.dx) > 1e-6 || Math.abs(o.dy) > 1e-6
      })
      expect(moved).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/elastic-math.unit.spec.ts`
Expected: FAIL — cannot resolve module `elasticMath`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/app/lib/spacetype/elasticMath.ts`:

```ts
/**
 * Pure reference for the Elastic vertex displacement. The GLSL in
 * effects/elastic.ts mirrors this 1:1 — keep them in sync. No Three.js, so it
 * unit-tests in node and documents the loop-seamlessness contract.
 *
 * Seamlessness: every mode's offset at uTime=0 must equal its offset at
 * uTime=TAU, so the baked loop's first and last frames match. This is why all
 * time multipliers are integers (or are gated by a sin(uTime) factor that is 0
 * at both endpoints) — fractional, ungated multipliers would break the loop.
 */

export type ElasticMode = 0 | 1 | 2 | 3 | 4 // Wave, Spring, Taffy, Pinch, Jelly

export const ELASTIC_MODES = ['Wave', 'Spring', 'Taffy', 'Pinch', 'Jelly'] as const

export const TAU = Math.PI * 2

export interface ElasticParams {
  intensity: number
  stretch: number
  shear: number
  waveLength: number
}

/**
 * Displacement for one vertex.
 *  px, py : plane-local position (centered; ~[-w/2,w/2] x [-h/2,h/2]).
 *  lineT  : this line's normalized index in the stack, 0..1.
 *  uTime  : loop phase (caller passes t01 * cycles * TAU).
 * Returns world-space dx, dy already scaled by intensity.
 */
export function elasticOffset(
  mode: ElasticMode, px: number, py: number, lineT: number, uTime: number, p: ElasticParams,
): { dx: number; dy: number } {
  let dx = 0
  let dy = 0
  switch (mode) {
    case 0: { // Wave — traveling shear + vertical stretch flowing down the stack
      const phase = px * p.waveLength + lineT * TAU + uTime
      dx = Math.sin(phase) * p.shear
      dy = Math.cos(phase) * p.stretch * py
      break
    }
    case 1: { // Spring — global squash/stretch, periodic damped-overshoot shape
      const env = Math.sin(uTime) * Math.cos(uTime * 0.5) // 0 at uTime=0 and uTime=TAU
      dx = px * env * p.shear * 0.5
      dy = py * env * p.stretch
      break
    }
    case 2: { // Taffy — low-freq high-drag horizontal smear, heavier toward the bottom
      const drag = 0.5 + lineT
      dx = Math.sin(uTime + py * p.waveLength * 0.3) * p.shear * 2 * drag
      dy = Math.sin(uTime * 0.5) * p.stretch * 0.25 * py
      break
    }
    case 3: { // Pinch — radial bulge/pinch from a center sliding along x
      const cx = Math.sin(uTime) * 0.5
      const ex = px - cx
      const ey = py
      const dist = Math.sqrt(ex * ex + ey * ey) + 1e-3
      const w = (Math.sin(dist * p.waveLength - uTime) * p.stretch) / (1 + dist)
      dx = (ex / dist) * w
      dy = (ey / dist) * w
      break
    }
    default: { // 4: Jelly — summed multi-axis ripple (integer time multipliers → loops)
      dx = (Math.sin(uTime + py * p.waveLength) + Math.sin(2 * uTime + py * p.waveLength * 2) * 0.5) * p.shear
      dy = (Math.cos(uTime + px * p.waveLength) + Math.cos(2 * uTime + px * p.waveLength * 2) * 0.5) * p.stretch
      break
    }
  }
  return { dx: dx * p.intensity, dy: dy * p.intensity }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/elastic-math.unit.spec.ts`
Expected: PASS — seamlessness, intensity, and movement checks all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/elasticMath.ts frontend/tests/unit/elastic-math.unit.spec.ts
git commit -m "feat(elastic): pure 5-mode displacement math with loop-seamlessness tests"
```

---

### Task 3: The Elastic effect module

**Files:**
- Create: `frontend/app/lib/spacetype/effects/elastic.ts`
- Test: `frontend/tests/unit/elastic-effect.unit.spec.ts`

The unit test is a **contract test** (node-safe: it imports the effect object and inspects `controls`; it does not call `buildScene`). The GLSL in `buildScene` mirrors `elasticMath.ts`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/elastic-effect.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { elasticEffect } from '../../app/lib/spacetype/effects/elastic'
import { defaultsFromControls } from '../../app/lib/spacetype/effect'
import { ELASTIC_MODES } from '../../app/lib/spacetype/elasticMath'

describe('elasticEffect contract', () => {
  it('has id, label, and a textList + a fillList control', () => {
    expect(elasticEffect.id).toBe('elastic')
    expect(elasticEffect.label).toBe('Elastic')
    expect(elasticEffect.controls.some(c => c.kind === 'textList')).toBe(true)
    expect(elasticEffect.controls.some(c => c.kind === 'fillList')).toBe(true)
  })

  it('exposes a mode select listing all five modes', () => {
    const mode = elasticEffect.controls.find(c => c.key === 'mode')
    expect(mode?.kind).toBe('select')
    expect(mode && 'options' in mode ? mode.options : []).toEqual([...ELASTIC_MODES])
  })

  it('declares the skew + motion controls', () => {
    const keys = elasticEffect.controls.map(c => c.key)
    for (const k of ['textSkew', 'lineSkew', 'lineStagger', 'intensity', 'stretch', 'shear', 'waveLength', 'speed']) {
      expect(keys).toContain(k)
    }
  })

  it('defaultsFromControls round-trips (mode defaults to Wave)', () => {
    const d = defaultsFromControls(elasticEffect.controls)
    expect(d.mode).toBe('Wave')
    expect(typeof d.intensity).toBe('number')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/elastic-effect.unit.spec.ts`
Expected: FAIL — cannot resolve module `effects/elastic`.

- [ ] **Step 3: Write the effect module**

Create `frontend/app/lib/spacetype/effects/elastic.ts`. The vertex `if/else` block is the GLSL mirror of `elasticMath.elasticOffset`; the fragment stretches each word to fill its plane via `uWordFrac`, applies UV-shear text skew, and composites the fill like `field.ts`.

```ts
import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills, fillShaderTexture, fillTiling } from '../fills'
import { ELASTIC_MODES, TAU } from '../elasticMath'
import { stackPositions, lineStaggerOffsets } from '../elasticLayout'

/**
 * ELASTIC — stacked full-bleed type warped like a stretchy material
 * (kielm STG V.STRETCH ref). One subdivided plane per text line; a vertex
 * shader displaces it per the selected Mode. The five modes mirror
 * elasticMath.elasticOffset 1:1 (keep in sync). Each word is stretched to fill
 * its plane width via the atlas wordFrac, giving the full-bleed look. Works in
 * both ortho and perspective (displacement is camera-agnostic; stack centered
 * on the origin).
 */

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'textList', default: 'OLD\nWORLD\nNEW\nSCHOOL', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 200, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'textSkew', label: 'Text skew', kind: 'slider', min: -40, max: 40, step: 1, default: 0, group: 'Type' },
  { key: 'lineSkew', label: 'Line skew', kind: 'slider', min: -40, max: 40, step: 1, default: 0, group: 'Layout' },
  { key: 'lineStagger', label: 'Line stagger', kind: 'slider', min: -4, max: 4, step: 0.05, default: 0, group: 'Layout' },
  { key: 'leading', label: 'Leading', kind: 'slider', min: -1, max: 3, step: 0.05, default: 0.2, group: 'Layout' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'mode', label: 'Mode', kind: 'select', options: [...ELASTIC_MODES], default: 'Wave', group: 'Motion' },
  { key: 'intensity', label: 'Intensity', kind: 'slider', min: 0, max: 3, step: 0.05, default: 1, group: 'Motion' },
  { key: 'stretch', label: 'Stretch', kind: 'slider', min: 0, max: 1.5, step: 0.02, default: 0.4, group: 'Motion' },
  { key: 'shear', label: 'Shear', kind: 'slider', min: 0, max: 1.5, step: 0.02, default: 0.6, group: 'Motion' },
  { key: 'waveLength', label: 'Wavelength', kind: 'slider', min: 0.2, max: 8, step: 0.1, default: 2, group: 'Motion' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 4, step: 0.05, default: 1, group: 'Motion' },
  { key: 'fills', label: 'Fills', kind: 'fillList', default: '[{"type":"solid","a":"#ffffff","b":"#000000","textColor":"#000000"}]', group: 'Color' },
]

interface PlaneUniforms {
  uMode: { value: number }
  uTime: { value: number }
  uIntensity: { value: number }
  uStretch: { value: number }
  uShear: { value: number }
  uWaveLen: { value: number }
  uLineT: { value: number }
  uLineSkew: { value: number }
}

let planeUniforms: PlaneUniforms[] = []

function n(p: Params, k: string): number { return Number(p[k]) }

function modeIndex(p: Params): number {
  const i = (ELASTIC_MODES as readonly string[]).indexOf(String(p.mode))
  return i < 0 ? 0 : i
}

function frontMaterial(
  three: typeof THREE,
  map: THREE.Texture,
  fillTex: THREE.Texture,
  tiling: number,
  textColor: THREE.Color,
  textRow: number,
  textCount: number,
  wordFrac: number,
  textSkewSlope: number,
  u: PlaneUniforms,
): THREE.MeshLambertMaterial {
  const mat = new three.MeshLambertMaterial({ map, side: three.DoubleSide, transparent: true })
  const uFillTex = { value: fillTex }
  const uFillTiling = { value: tiling }
  const uTextColor = { value: textColor }
  const uTextRow = { value: textRow }
  const uTextCount = { value: Math.max(1, textCount) }
  const uWordFrac = { value: Math.max(0.0001, wordFrac) }
  const uTextSkew = { value: textSkewSlope }
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMode = u.uMode
    shader.uniforms.uTime = u.uTime
    shader.uniforms.uIntensity = u.uIntensity
    shader.uniforms.uStretch = u.uStretch
    shader.uniforms.uShear = u.uShear
    shader.uniforms.uWaveLen = u.uWaveLen
    shader.uniforms.uLineT = u.uLineT
    shader.uniforms.uLineSkew = u.uLineSkew
    shader.uniforms.uFillTex = uFillTex
    shader.uniforms.uFillTiling = uFillTiling
    shader.uniforms.uTextColor = uTextColor
    shader.uniforms.uTextRow = uTextRow
    shader.uniforms.uTextCount = uTextCount
    shader.uniforms.uWordFrac = uWordFrac
    shader.uniforms.uTextSkew = uTextSkew

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec2 vRawUv;',
        'uniform float uMode; uniform float uTime; uniform float uIntensity;',
        'uniform float uStretch; uniform float uShear; uniform float uWaveLen;',
        'uniform float uLineT; uniform float uLineSkew;',
      ].join('\n'))
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRawUv = uv;')
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'float px = position.x;',
        'float py = position.y;',
        'float md = uMode;',
        'float tau = 6.28318530718;',
        // Line skew: parallelogram shear of the whole plane (static).
        'transformed.x += position.y * uLineSkew;',
        'float dx = 0.0; float dy = 0.0;',
        'if (md < 0.5) {',
        '  float phase = px * uWaveLen + uLineT * tau + uTime;',
        '  dx = sin(phase) * uShear;',
        '  dy = cos(phase) * uStretch * py;',
        '} else if (md < 1.5) {',
        '  float env = sin(uTime) * cos(uTime * 0.5);',
        '  dx = px * env * uShear * 0.5;',
        '  dy = py * env * uStretch;',
        '} else if (md < 2.5) {',
        '  float drag = 0.5 + uLineT;',
        '  dx = sin(uTime + py * uWaveLen * 0.3) * uShear * 2.0 * drag;',
        '  dy = sin(uTime * 0.5) * uStretch * 0.25 * py;',
        '} else if (md < 3.5) {',
        '  float cx = sin(uTime) * 0.5;',
        '  float ex = px - cx; float ey = py;',
        '  float dist = sqrt(ex*ex + ey*ey) + 1e-3;',
        '  float w = sin(dist * uWaveLen - uTime) * uStretch / (1.0 + dist);',
        '  dx = (ex / dist) * w;',
        '  dy = (ey / dist) * w;',
        '} else {',
        '  dx = (sin(uTime + py * uWaveLen) + sin(2.0*uTime + py * uWaveLen * 2.0) * 0.5) * uShear;',
        '  dy = (cos(uTime + px * uWaveLen) + cos(2.0*uTime + px * uWaveLen * 2.0) * 0.5) * uStretch;',
        '}',
        'transformed.x += dx * uIntensity;',
        'transformed.y += dy * uIntensity;',
      ].join('\n'))

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform sampler2D uFillTex; uniform float uFillTiling;',
        'uniform vec3 uTextColor; uniform float uTextRow; uniform float uTextCount;',
        'uniform float uWordFrac; uniform float uTextSkew;',
        'varying vec2 vRawUv;',
      ].join('\n'))
      // Sample this line's atlas row, stretching the word to fill the plane width
      // (uWordFrac) and slanting glyphs via UV-shear (uTextSkew). Composite the
      // fill against the glyph alpha, exactly like field.ts.
      .replace('#include <map_fragment>', [
        'float us = (vRawUv.x + (vRawUv.y - 0.5) * uTextSkew) * uWordFrac;',
        'us = clamp(us, 0.0, 1.0);',
        'float vv = (uTextRow + clamp(vRawUv.y, 0.0, 1.0)) / uTextCount;',
        'vec4 tTex = texture2D(map, vec2(us, vv));',
        'vec3 fill = texture2D(uFillTex, vRawUv * uFillTiling).rgb;',
        'diffuseColor = vec4(mix(fill, uTextColor, tTex.a), tTex.a < 0.001 ? 1.0 : 1.0);',
      ].join('\n'))
  }
  return mat
}

export const elasticEffect: SpaceTypeEffect = {
  id: 'elastic',
  label: 'Elastic',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    planeUniforms = []

    const textCount = Math.max(1, Math.floor(Number(textTexture.userData?.numTexts ?? 1)))
    const wordFracs: number[] = (textTexture.userData?.wordFracs as number[] | undefined) ?? new Array(textCount).fill(1)

    const fills = parseFills(params.fills)
    const fill = fills[0]!
    const textColor = new three.Color(fill.textColor)

    const scale = n(params, 'scale')
    const baseW = 12 * scale                              // shared full-bleed plane width
    const lineH = (n(params, 'typeHeight') / 180) * 2.0 * scale
    const leading = n(params, 'leading') * scale
    const segX = 120                                      // horizontal subdivisions → smooth warp

    const ys = stackPositions(textCount, lineH, leading)
    const xs = lineStaggerOffsets(textCount, n(params, 'lineStagger') * scale)
    const lineSkewSlope = Math.tan((n(params, 'lineSkew') * Math.PI) / 180)
    const textSkewSlope = Math.tan((n(params, 'textSkew') * Math.PI) / 180)
    const mode = modeIndex(params)

    for (let i = 0; i < textCount; i++) {
      const geo = new three.PlaneGeometry(baseW, lineH, segX, 2)
      const tex = textTexture.clone()
      tex.needsUpdate = true

      const u: PlaneUniforms = {
        uMode: { value: mode },
        uTime: { value: 0 },
        uIntensity: { value: n(params, 'intensity') },
        uStretch: { value: n(params, 'stretch') },
        uShear: { value: n(params, 'shear') },
        uWaveLen: { value: n(params, 'waveLength') },
        uLineT: { value: textCount > 1 ? i / (textCount - 1) : 0 },
        uLineSkew: { value: lineSkewSlope },
      }

      const mat = frontMaterial(
        three, tex, fillShaderTexture(three, fill), fillTiling(fill), textColor,
        i, textCount, wordFracs[i] ?? 1, textSkewSlope, u,
      )
      const mesh = new three.Mesh(geo, mat)
      mesh.position.set(xs[i] ?? 0, ys[i] ?? 0, 0)
      mesh.userData.tex = tex
      root.add(mesh)
      planeUniforms.push(u)
    }

    return root
  },

  update(t01, params) {
    if (!planeUniforms.length) return
    const cycles = Math.max(1, Math.round(n(params, 'speed')))
    const time = t01 * cycles * TAU
    const mode = modeIndex(params)
    for (const u of planeUniforms) {
      u.uTime.value = time
      u.uMode.value = mode
      u.uIntensity.value = n(params, 'intensity')
      u.uStretch.value = n(params, 'stretch')
      u.uShear.value = n(params, 'shear')
      u.uWaveLen.value = n(params, 'waveLength')
      u.uLineSkew.value = Math.tan((n(params, 'lineSkew') * Math.PI) / 180)
    }
  },
}
```

> Note: the `diffuseColor` alpha expression is written verbosely to keep the glyph compositing opaque where the fill shows and to leave room for a future transparency toggle; it currently always yields `1.0`. Keep it as-is for v1 (matches `field`'s opaque output).

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `npx vitest run tests/unit/elastic-effect.unit.spec.ts`
Expected: PASS — all four contract assertions green.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/effects/elastic.ts frontend/tests/unit/elastic-effect.unit.spec.ts
git commit -m "feat(elastic): Elastic effect module (5-mode warp, per-line full-bleed planes)"
```

---

### Task 4: Register the effect + surface raw-words tweak

**Files:**
- Modify: `frontend/app/lib/spacetype/effects/index.ts`
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue:192`
- Test: extend `frontend/tests/unit/elastic-effect.unit.spec.ts`

- [ ] **Step 1: Add the failing registration assertion**

Append to `frontend/tests/unit/elastic-effect.unit.spec.ts`:

```ts
import { SPACE_TYPE_EFFECTS, getEffect } from '../../app/lib/spacetype/effects/index'

describe('elastic registration', () => {
  it('is registered in the picker and resolvable by id', () => {
    expect(SPACE_TYPE_EFFECTS.some(e => e.id === 'elastic')).toBe(true)
    expect(getEffect('elastic').label).toBe('Elastic')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/elastic-effect.unit.spec.ts`
Expected: FAIL — `SPACE_TYPE_EFFECTS` does not contain an effect with id `elastic`.

- [ ] **Step 3: Register the effect**

In `frontend/app/lib/spacetype/effects/index.ts`, add the import alongside the others:

```ts
import { elasticEffect } from './elastic'
```

and append `elasticEffect` to the `SPACE_TYPE_EFFECTS` array (after `onionburstEffect`):

```ts
export const SPACE_TYPE_EFFECTS: SpaceTypeEffect[] = [
  ribbonEffect,
  stripesEffect,
  cylinderEffect,
  fieldEffect,
  coilEffect,
  cascadeEffect,
  boostEffect,
  meltEffect,
  onionburstEffect,
  elasticEffect,
]
```

- [ ] **Step 4: Take raw words in the surface**

In `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`, line 192 currently reads:

```ts
  const rawWords = effectId.value === 'coil'
```

Change it to include elastic (each line fills its own plane, so it must not carry a trailing tiling gap):

```ts
  const rawWords = effectId.value === 'coil' || effectId.value === 'elastic'
```

- [ ] **Step 5: Run the full unit suite to verify it passes**

Run: `npm run test:unit`
Expected: PASS — including the new registration test and all prior elastic tests; no regressions in existing specs.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effects/index.ts frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/tests/unit/elastic-effect.unit.spec.ts
git commit -m "feat(elastic): register Elastic effect + take raw words in the surface"
```

---

### Task 5: In-app verification

No automated test (the preview is WebGL + behind a gated browser). Verify manually, then record the result.

- [ ] **Step 1: Start the stack**

Per `CLAUDE.md`: ComfyUI (`.venv/bin/python main.py --listen 127.0.0.1 --port 8188`) and the frontend (`cd frontend && npm run dev`). Bridge changes aren't involved here (pure frontend), so a ComfyUI restart isn't required — but the canvas must be reachable.

- [ ] **Step 2: Open Type Studio → Elastic and check each item**

- [ ] The picker lists **Elastic**; selecting it renders the default `OLD / WORLD / NEW / SCHOOL` stacked full-bleed, black on white.
- [ ] Each word fills the full plane width regardless of length (3-letter `OLD` and 6-letter `SCHOOL` both span the frame).
- [ ] Cycle **Mode** through Wave / Spring / Taffy / Pinch / Jelly — each gives a visibly different elastic deformation.
- [ ] **Text skew** slants the glyphs (faux-italic); **Line skew** leans the line blocks into parallelograms; **Line stagger** offsets lines horizontally.
- [ ] **Intensity / Stretch / Shear / Wavelength / Speed** all visibly affect the motion; Intensity 0 freezes it to a clean stack.
- [ ] Toggle the studio projection: it reads correctly in **both** orthographic/isometric (flat poster) and **perspective** (stack leans/recedes) and stays framed.
- [ ] Change **Fills** (e.g. a gradient) — the type recolors via the fill system.

- [ ] **Step 3: Export and confirm a seamless loop**

- [ ] Export the loop; scrub the baked frames and confirm the **last frame matches the first** (no pop), and that re-exporting with unchanged params reuses the cached bake.

- [ ] **Step 4: Record the outcome**

Note pass/fail per item in the PR description (or back to the user). If anything fails, debug with `superpowers:systematic-debugging` before claiming completion.

---

## Self-Review (completed during planning)

- **Spec coverage:** 5 modes (Task 2/3 ✓), Mode dropdown not 5 picker entries (controls `mode` select ✓), stacked full-bleed lines via per-line planes + wordFrac stretch (Task 3 ✓), text skew (UV-shear ✓) + line skew (geometry shear ✓) + line stagger (Task 1/3 ✓), both cameras (camera-agnostic displacement, centered stack — Task 5 verify ✓), fills default black-on-white (controls ✓), loop seamlessness (Task 2 test + Task 5 export check ✓), registration (Task 4 ✓). The spec's "no surface changes" is corrected to one justified one-line tweak (raw words) documented in Task 4.
- **Placeholder scan:** none — every code/test/command step is concrete.
- **Type consistency:** `ElasticMode`/`ElasticParams`/`elasticOffset`/`ELASTIC_MODES`/`TAU` used identically across `elasticMath.ts`, its test, and `elastic.ts`; `PlaneUniforms` fields match between `buildScene`, `frontMaterial`, and `update`; control keys (`mode`, `textSkew`, `lineSkew`, `lineStagger`, `intensity`, `stretch`, `shear`, `waveLength`, `speed`, `leading`, `scale`, `fills`, `text`, `font`, `typeHeight`, `tracking`) match between the controls list, the contract test, and the `n(params, ...)` reads.
