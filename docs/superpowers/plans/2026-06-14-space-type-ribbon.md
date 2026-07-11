# Space Type Ribbon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Three.js "Space Type" authoring surface whose first effect is a 3D ribbon — stacked, twisting, waving type — that bakes to a looping timeline clip, a poster still, and alpha-capable PNGs.

**Architecture:** A deterministic `SpaceTypeEngine` (Three.js) drives one pluggable `SpaceTypeEffect`. The ribbon effect's geometry is textured by a canvas painted with text (reusing the existing font/text approach), so variable-font axes drive ribbon weight. Output rides the existing kinetic bake → `motion_frames` → `nodes_timeline.py` pipeline, so the Python side is unchanged. Everything is frame-index-driven (no `Date.now()`/`Math.random()`) so renders are reproducible, cacheable, and seamlessly loopable.

**Tech Stack:** Vue 3 + TypeScript (Nuxt 4), Three.js `^0.171.0` (already installed), Vitest (`tests/unit/*.unit.spec.ts`), pnpm. Backend: ComfyUI Python (untouched).

**Conventions confirmed from the codebase:**
- Feature flag pattern: `frontend/app/lib/kineticEnabled.ts` → mirror as `spaceTypeEnabled.ts`.
- Bake/hash/upload pattern: `frontend/app/lib/engine/motionClipBake.ts` + `uploadFrameBatch` in `frontend/app/composables/useKineticRenderer.ts` (POST `/upload/image`, returns `string[]` of `input/` filenames).
- Clip insertion: `createMotionClip` in `frontend/app/composables/timelineMotionClip.ts`; store action `addClip(trackId, clip)` / `addMotionClip(...)` in `frontend/app/composables/useTimelineStore.ts`.
- Types: `MotionClip`, `MotionBake`, `MotionTextLayer` in `frontend/shared/timeline/types.ts`.
- Modal pattern + Add menu: `frontend/app/layouts/default.vue` (`slateGalleryOpen` ref, `loadOptions`, `onLoadOption`, conditional `<VueCanvasSlateGalleryModal v-if="KINETIC_ENABLED && slateGalleryOpen">`).
- Test command: `cd frontend && npm run test:unit` (Vitest). Test files: `frontend/tests/unit/<name>.unit.spec.ts`.

---

## File Structure

**Create:**
- `frontend/app/lib/spaceTypeEnabled.ts` — `SPACE_TYPE_ENABLED` flag.
- `frontend/app/lib/spacetype/effect.ts` — `SpaceTypeEffect` + `ControlSpec` types, `defaultsFromControls()`.
- `frontend/app/lib/spacetype/sourceKey.ts` — `spaceTypeSourceKey()` FNV-1a hash.
- `frontend/app/lib/spacetype/ribbonMath.ts` — pure deterministic ribbon motion (`ribbonRowState`, `wrap01`, `buildRibbonLabel`, `tileCount`).
- `frontend/app/lib/spacetype/effects/ribbon.ts` — the ribbon `SpaceTypeEffect` (controls, defaults, `buildScene`, `update`).
- `frontend/app/lib/spacetype/textTexture.ts` — paints the repeating line to a canvas → `THREE.CanvasTexture`.
- `frontend/app/lib/spacetype/engine.ts` — `SpaceTypeEngine` (renderer, camera, `renderFrame`, `frameToBlob`, `dispose`).
- `frontend/app/lib/spacetype/bake.ts` — `ensureSpaceTypeBake()` (cache + upload, injected renderer).
- `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — modal surface (live preview, auto control panel, export buttons).
- Tests under `frontend/tests/unit/`: `spacetype-effect.unit.spec.ts`, `spacetype-sourcekey.unit.spec.ts`, `spacetype-ribbon-math.unit.spec.ts`, `spacetype-bake.unit.spec.ts`.

**Modify:**
- `frontend/app/layouts/default.vue` — Add-menu "Space Type" tile, modal mount, create/export handlers.

**Note on the text-texture bridge:** Task 5 paints text with a self-contained Canvas2D routine in `textTexture.ts` (font + variable-font axes via `ctx.font` / `fontVariationSettings`). It deliberately does NOT import the full `lib/motion` per-char animator — the ribbon's motion is geometric (in the vertex domain), not per-char. The reuse is the *font/axis* handling and the curated catalog (`frontend/app/data/variable-fonts.ts`), not the 2D animation evaluator.

---

## Task 1: Feature flag + effect interface & defaults

**Files:**
- Create: `frontend/app/lib/spaceTypeEnabled.ts`
- Create: `frontend/app/lib/spacetype/effect.ts`
- Test: `frontend/tests/unit/spacetype-effect.unit.spec.ts`

- [ ] **Step 1: Write the feature flag**

Create `frontend/app/lib/spaceTypeEnabled.ts`:

```typescript
/**
 * Space Type (the Three.js 3D-typography surface + its effect suite, starting
 * with the ribbon) is gated so it can merge hidden and be refined in place,
 * mirroring `lib/kineticEnabled`. Flip to `true` to expose the Add → Space Type
 * tile and the surface modal.
 *
 * Typed `boolean` (not the literal `false`) so the always-off branches don't
 * read as unreachable dead code to the type checker.
 */
export const SPACE_TYPE_ENABLED: boolean = false
```

- [ ] **Step 2: Write the failing test for the effect interface defaults**

Create `frontend/tests/unit/spacetype-effect.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { defaultsFromControls, type ControlSpec } from '../../app/lib/spacetype/effect'

const controls: ControlSpec[] = [
  { key: 'rows', label: 'Rows', kind: 'slider', min: 3, max: 24, step: 1, default: 11 },
  { key: 'text', label: 'Text', kind: 'text', default: 'VESSEL' },
  { key: 'typeColor', label: 'Type color', kind: 'color', default: '#f5f5f7' },
  { key: 'case', label: 'Case', kind: 'select', options: ['as-typed', 'upper'], default: 'upper' },
]

describe('defaultsFromControls', () => {
  it('extracts one default per control keyed by control key', () => {
    expect(defaultsFromControls(controls)).toEqual({
      rows: 11, text: 'VESSEL', typeColor: '#f5f5f7', case: 'upper',
    })
  })
  it('returns an empty object for no controls', () => {
    expect(defaultsFromControls([])).toEqual({})
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- spacetype-effect`
Expected: FAIL — cannot find module `../../app/lib/spacetype/effect`.

- [ ] **Step 4: Implement the effect interface + defaults**

Create `frontend/app/lib/spacetype/effect.ts`:

```typescript
import type * as THREE from 'three'

export type ParamValue = number | string | boolean
export type Params = Record<string, ParamValue>

export type ControlSpec =
  | { key: string; label: string; kind: 'slider'; min: number; max: number; step: number; default: number }
  | { key: string; label: string; kind: 'text'; default: string }
  | { key: string; label: string; kind: 'color'; default: string }
  | { key: string; label: string; kind: 'select'; options: string[]; default: string }

/** Build the param object from a control list's declared defaults. */
export function defaultsFromControls(controls: ControlSpec[]): Params {
  const out: Params = {}
  for (const c of controls) out[c.key] = c.default
  return out
}

/**
 * The pluggable seam of the Space Type suite. Each effect declares its own
 * controls (so the surface auto-builds its UI), builds a Three.js scene graph
 * from a text texture + params, and advances that graph by normalized loop
 * time `t01 ∈ [0,1)`. Adding cylinder/field later = a new module implementing
 * this — no engine or surface changes.
 */
export interface SpaceTypeEffect {
  id: string
  label: string
  controls: ControlSpec[]
  /** Build the scene root. Called when the effect or any structural param changes. */
  buildScene(three: typeof THREE, params: Params, textTexture: THREE.Texture): THREE.Object3D
  /** Advance the existing scene to normalized loop time t01. Pure in t01. */
  update(t01: number, params: Params): void
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- spacetype-effect`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spaceTypeEnabled.ts frontend/app/lib/spacetype/effect.ts frontend/tests/unit/spacetype-effect.unit.spec.ts
git commit -m "feat(spacetype): SPACE_TYPE_ENABLED flag + SpaceTypeEffect interface"
```

---

## Task 2: Deterministic source-key hash

**Files:**
- Create: `frontend/app/lib/spacetype/sourceKey.ts`
- Test: `frontend/tests/unit/spacetype-sourcekey.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-sourcekey.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { spaceTypeSourceKey } from '../../app/lib/spacetype/sourceKey'

const base = { effectId: 'ribbon', params: { rows: 11, text: 'VESSEL' }, fps: 30, loopDuration: 4, W: 1280, H: 720 }

describe('spaceTypeSourceKey', () => {
  it('is stable for the same input', () => {
    expect(spaceTypeSourceKey(base)).toBe(spaceTypeSourceKey({ ...base }))
  })
  it('changes when any param changes', () => {
    expect(spaceTypeSourceKey(base)).not.toBe(spaceTypeSourceKey({ ...base, params: { rows: 12, text: 'VESSEL' } }))
  })
  it('changes when dims or fps change', () => {
    expect(spaceTypeSourceKey(base)).not.toBe(spaceTypeSourceKey({ ...base, W: 1920 }))
    expect(spaceTypeSourceKey(base)).not.toBe(spaceTypeSourceKey({ ...base, fps: 24 }))
  })
  it('is param-order independent', () => {
    const a = spaceTypeSourceKey({ ...base, params: { rows: 11, text: 'VESSEL' } })
    const b = spaceTypeSourceKey({ ...base, params: { text: 'VESSEL', rows: 11 } })
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- spacetype-sourcekey`
Expected: FAIL — cannot find module `sourceKey`.

- [ ] **Step 3: Implement the hash**

Create `frontend/app/lib/spacetype/sourceKey.ts`:

```typescript
import type { Params } from './effect'

export interface SourceKeyInput {
  effectId: string
  params: Params
  fps: number
  loopDuration: number
  W: number
  H: number
}

/** Sort object keys so serialization is order-independent. */
function stable(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(o).sort()) out[k] = stable(o[k])
    return out
  }
  return value
}

/** FNV-1a over a stable serialization — mirrors lib/engine/motionClipBake's key. */
export function spaceTypeSourceKey(input: SourceKeyInput): string {
  const s = JSON.stringify(stable(input))
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- spacetype-sourcekey`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/sourceKey.ts frontend/tests/unit/spacetype-sourcekey.unit.spec.ts
git commit -m "feat(spacetype): deterministic FNV-1a source key for bake caching"
```

---

## Task 3: Pure ribbon motion math

This is the deterministic, GPU-free core. The effect's `update()` is a thin wrapper over these functions; the engine feeds `t01 = frameIndex / frameCount`.

**Files:**
- Create: `frontend/app/lib/spacetype/ribbonMath.ts`
- Test: `frontend/tests/unit/spacetype-ribbon-math.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-ribbon-math.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { wrap01, buildRibbonLabel, tileCount, ribbonRowState, type RibbonParams } from '../../app/lib/spacetype/ribbonMath'

const P: RibbonParams = {
  rows: 5, rowSpacing: 1, zRotation: 0.3, waveAmplitude: 0.4, waveFrequency: 2,
  rowPhase: 0.5, scrollSpeed: 1, scrollCycles: 1, waveCycles: 1,
}

describe('wrap01', () => {
  it('wraps into [0,1)', () => {
    expect(wrap01(0)).toBeCloseTo(0, 10)
    expect(wrap01(1)).toBeCloseTo(0, 10)
    expect(wrap01(1.25)).toBeCloseTo(0.25, 10)
    expect(wrap01(-0.25)).toBeCloseTo(0.75, 10)
  })
})

describe('buildRibbonLabel', () => {
  it('uppercases and pads with a trailing gap when case=upper', () => {
    expect(buildRibbonLabel('Vessel', 'upper')).toBe('VESSEL   ')
  })
  it('leaves case alone when as-typed', () => {
    expect(buildRibbonLabel('Vessel', 'as-typed')).toBe('Vessel   ')
  })
})

describe('tileCount', () => {
  it('covers the width with at least 2 extra tiles', () => {
    expect(tileCount(1000, 250)).toBe(6)
  })
  it('never returns less than 2', () => {
    expect(tileCount(10, 1000)).toBe(2)
  })
})

describe('ribbonRowState', () => {
  it('is deterministic for the same inputs', () => {
    expect(ribbonRowState(0.3, 2, P)).toEqual(ribbonRowState(0.3, 2, P))
  })
  it('centers rows around y=0', () => {
    const mid = ribbonRowState(0, 2, P) // middle of 5 rows (index 2)
    expect(mid.y).toBeCloseTo(0, 10)
    const top = ribbonRowState(0, 0, P)
    const bot = ribbonRowState(0, 4, P)
    expect(top.y).toBeCloseTo(-bot.y, 10)
  })
  it('applies progressive per-row z-rotation', () => {
    const r0 = ribbonRowState(0, 0, P)
    const r4 = ribbonRowState(0, 4, P)
    expect(r4.zRotation).toBeCloseTo(-r0.zRotation, 10)
    expect(r0.zRotation).not.toBe(0)
  })
  it('loops seamlessly: scroll and wave phase match at t01=0 and t01->1', () => {
    const a = ribbonRowState(0, 3, P)
    const b = ribbonRowState(0.999999, 3, P)
    expect(wrap01(b.scrollOffset)).toBeCloseTo(wrap01(a.scrollOffset), 4)
    expect(wrap01(b.wavePhase / (Math.PI * 2))).toBeCloseTo(wrap01(a.wavePhase / (Math.PI * 2)), 4)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- spacetype-ribbon-math`
Expected: FAIL — cannot find module `ribbonMath`.

- [ ] **Step 3: Implement the ribbon math**

Create `frontend/app/lib/spacetype/ribbonMath.ts`:

```typescript
const TAU = Math.PI * 2

export interface RibbonParams {
  rows: number
  rowSpacing: number
  zRotation: number      // max per-row twist (radians) at the outermost rows
  waveAmplitude: number  // world units of vertical undulation
  waveFrequency: number  // sine periods across one tile
  rowPhase: number       // wave phase shift between adjacent rows (0..1 of TAU)
  scrollSpeed: number    // relative scroll rate
  scrollCycles: number   // whole tiles scrolled per loop (integer ⇒ seamless)
  waveCycles: number     // whole wave cycles per loop (integer ⇒ seamless)
}

export interface RibbonRowState {
  y: number              // world Y of the row, centered on 0
  zRotation: number      // row twist in radians
  wavePhase: number      // radians, fed to the per-vertex sine in the shader/geometry
  scrollOffset: number   // 0..1 of one tile, applied to the texture U / geometry
}

/** Wrap any real into [0,1). */
export function wrap01(x: number): number {
  return x - Math.floor(x)
}

/** Repeat unit: uppercased (optional) text + a 3-space gap so tiles read apart. */
export function buildRibbonLabel(text: string, mode: 'upper' | 'as-typed'): string {
  const t = mode === 'upper' ? text.toUpperCase() : text
  return `${t}   `
}

/** How many label tiles cover `widthPx` given one tile is `tilePx` wide (min 2, +2 margin). */
export function tileCount(widthPx: number, tilePx: number): number {
  if (tilePx <= 0) return 2
  return Math.max(2, Math.ceil(widthPx / tilePx) + 2)
}

/**
 * Per-row state at normalized loop time t01. Pure: depends only on (t01, row,
 * params). Seamlessness comes from scroll/wave advancing by INTEGER cycles over
 * t01 ∈ [0,1], so t01=0 and t01=1 land on the same phase.
 */
export function ribbonRowState(t01: number, row: number, p: RibbonParams): RibbonRowState {
  const n = Math.max(1, Math.floor(p.rows))
  const center = (n - 1) / 2
  const u = n === 1 ? 0 : (row - center) / center  // -1..1, 0 at the middle row

  const y = (row - center) * p.rowSpacing
  const zRotation = u * p.zRotation
  const rowPhaseRad = u * p.rowPhase * TAU
  const wavePhase = t01 * p.waveCycles * TAU + rowPhaseRad
  const scrollOffset = wrap01(t01 * p.scrollSpeed * p.scrollCycles)

  return { y, zRotation, wavePhase, scrollOffset }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- spacetype-ribbon-math`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/ribbonMath.ts frontend/tests/unit/spacetype-ribbon-math.unit.spec.ts
git commit -m "feat(spacetype): pure deterministic ribbon motion math + seamless-loop guarantee"
```

---

## Task 4: Text texture

Paints the repeating line onto a canvas and wraps it as a Three.js texture. Variable-font axes are applied via `ctx.fontVariationSettings`. Manual-verify task (canvas rendering); a tiny pure helper for the variation string is unit-tested.

**Files:**
- Create: `frontend/app/lib/spacetype/textTexture.ts`
- Test: add to `frontend/tests/unit/spacetype-ribbon-math.unit.spec.ts` (reuse the suite) — see Step 1.

- [ ] **Step 1: Write the failing test for the variation-settings helper**

Append to `frontend/tests/unit/spacetype-ribbon-math.unit.spec.ts`:

```typescript
import { axesToVariation } from '../../app/lib/spacetype/textTexture'

describe('axesToVariation', () => {
  it('formats axes as a font-variation-settings string', () => {
    expect(axesToVariation({ wght: 700, wdth: 120 })).toBe('"wght" 700, "wdth" 120')
  })
  it('returns empty string for no axes', () => {
    expect(axesToVariation({})).toBe('')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- spacetype-ribbon-math`
Expected: FAIL — cannot find module `textTexture`.

- [ ] **Step 3: Implement the text texture**

Create `frontend/app/lib/spacetype/textTexture.ts`:

```typescript
import * as THREE from 'three'

export interface TextTextureOptions {
  label: string                 // already includes the trailing gap (buildRibbonLabel)
  fontFamily: string
  fontWeight: number
  axes: Record<string, number>  // variable-font axes, e.g. { wght: 700 }
  typeColor: string
  /** Texture pixel height; width is derived to fit ONE tile of the label. */
  heightPx?: number
  fontSizePx?: number
}

/** Format axes as a CSS font-variation-settings value. Pure + unit-tested. */
export function axesToVariation(axes: Record<string, number>): string {
  const parts = Object.entries(axes).map(([tag, v]) => `"${tag}" ${v}`)
  return parts.join(', ')
}

/**
 * Render ONE tile of the label to a transparent canvas and return a repeating
 * THREE.CanvasTexture. The ribbon geometry repeats this texture along its
 * length; scrolling is done by offsetting texture.offset.x in the effect.
 */
export function makeTextTexture(opts: TextTextureOptions): THREE.CanvasTexture {
  const h = opts.heightPx ?? 256
  const fontPx = opts.fontSizePx ?? Math.round(h * 0.7)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const font = `${opts.fontWeight} ${fontPx}px "${opts.fontFamily}", sans-serif`

  // Measure with a temporary context state.
  ctx.font = font
  const variation = axesToVariation(opts.axes)
  if (variation && 'fontVariationSettings' in ctx) {
    ;(ctx as CanvasRenderingContext2D & { fontVariationSettings: string }).fontVariationSettings = variation
  }
  const w = Math.max(2, Math.ceil(ctx.measureText(opts.label).width))

  canvas.width = w
  canvas.height = h
  ctx.clearRect(0, 0, w, h)
  ctx.font = font
  if (variation && 'fontVariationSettings' in ctx) {
    ;(ctx as CanvasRenderingContext2D & { fontVariationSettings: string }).fontVariationSettings = variation
  }
  ctx.fillStyle = opts.typeColor
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(opts.label, 0, h / 2)

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.anisotropy = 4
  tex.needsUpdate = true
  return tex
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- spacetype-ribbon-math`
Expected: PASS (including the new `axesToVariation` block).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/textTexture.ts frontend/tests/unit/spacetype-ribbon-math.unit.spec.ts
git commit -m "feat(spacetype): text-to-texture bridge with variable-font axes"
```

---

## Task 5: Ribbon effect module

Wires `ribbonMath` + `textTexture` into a Three.js scene implementing `SpaceTypeEffect`. Each row is a subdivided plane; `update()` applies per-row Y/rotation/scroll and a vertex wave via a small `onBeforeCompile` shader injection (so the wave is per-vertex, not a flat mesh deform). Integration code — verified live in Task 8, but a structural unit test asserts the contract.

**Files:**
- Create: `frontend/app/lib/spacetype/effects/ribbon.ts`
- Test: `frontend/tests/unit/spacetype-effect.unit.spec.ts` (extend)

- [ ] **Step 1: Write the failing contract test**

Append to `frontend/tests/unit/spacetype-effect.unit.spec.ts`:

```typescript
import { ribbonEffect } from '../../app/lib/spacetype/effects/ribbon'

describe('ribbonEffect contract', () => {
  it('declares an id, label, and controls', () => {
    expect(ribbonEffect.id).toBe('ribbon')
    expect(ribbonEffect.label.length).toBeGreaterThan(0)
    expect(ribbonEffect.controls.length).toBeGreaterThan(0)
  })
  it('every control has a default and a unique key', () => {
    const keys = ribbonEffect.controls.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const c of ribbonEffect.controls) expect(c.default).toBeDefined()
  })
  it('exposes the STG signature controls', () => {
    const keys = ribbonEffect.controls.map(c => c.key)
    for (const k of ['text', 'rows', 'zRotation', 'waveAmplitude', 'scrollSpeed']) {
      expect(keys).toContain(k)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- spacetype-effect`
Expected: FAIL — cannot find module `effects/ribbon`.

- [ ] **Step 3: Implement the ribbon effect**

Create `frontend/app/lib/spacetype/effects/ribbon.ts`:

```typescript
import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { ribbonRowState, buildRibbonLabel, type RibbonParams } from '../ribbonMath'
import { makeTextTexture } from '../textTexture'

const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'text', default: 'VESSEL' },
  { key: 'case', label: 'Case', kind: 'select', options: ['upper', 'as-typed'], default: 'upper' },
  { key: 'rows', label: 'Rows', kind: 'slider', min: 3, max: 24, step: 1, default: 11 },
  { key: 'rowSpacing', label: 'Row spacing', kind: 'slider', min: 0.4, max: 2, step: 0.05, default: 0.9 },
  { key: 'zRotation', label: 'Twist', kind: 'slider', min: 0, max: 1.2, step: 0.01, default: 0.35 },
  { key: 'waveAmplitude', label: 'Wave', kind: 'slider', min: 0, max: 1.5, step: 0.01, default: 0.5 },
  { key: 'waveFrequency', label: 'Wave freq', kind: 'slider', min: 0.5, max: 6, step: 0.1, default: 2 },
  { key: 'rowPhase', label: 'Row phase', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.15 },
  { key: 'scrollSpeed', label: 'Scroll', kind: 'slider', min: 0, max: 3, step: 0.05, default: 1 },
  { key: 'cameraTilt', label: 'Camera tilt', kind: 'slider', min: -0.6, max: 0.6, step: 0.01, default: 0.15 },
  { key: 'typeColor', label: 'Type color', kind: 'color', default: '#f5f5f7' },
]

interface Row {
  mesh: THREE.Mesh
  uniforms: { uWavePhase: { value: number }; uWaveAmp: { value: number }; uWaveFreq: { value: number } }
}

const RIBBON_LEN = 16   // world units along X (the ribbon's length)
const RIBBON_W = 1.0    // world height of a single ribbon band

let rows: Row[] = []
let texture: THREE.Texture | null = null

function n(params: Params, key: string): number { return Number(params[key]) }

/** Build a wave-capable material from a repeating text texture. */
function ribbonMaterial(tex: THREE.Texture, uniforms: Row['uniforms']): THREE.Material {
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide })
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWavePhase = uniforms.uWavePhase
    shader.uniforms.uWaveAmp = uniforms.uWaveAmp
    shader.uniforms.uWaveFreq = uniforms.uWaveFreq
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWavePhase;\nuniform float uWaveAmp;\nuniform float uWaveFreq;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\ntransformed.z += sin(position.x * uWaveFreq + uWavePhase) * uWaveAmp;',
      )
  }
  return mat
}

export const ribbonEffect: SpaceTypeEffect = {
  id: 'ribbon',
  label: 'Ribbon',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    texture = textTexture
    rows = []
    const count = Math.max(1, Math.floor(n(params, 'rows')))
    for (let i = 0; i < count; i++) {
      const geo = new three.PlaneGeometry(RIBBON_LEN, RIBBON_W, 200, 1)
      const uniforms = { uWavePhase: { value: 0 }, uWaveAmp: { value: n(params, 'waveAmplitude') }, uWaveFreq: { value: n(params, 'waveFrequency') } }
      const tex = textTexture.clone()
      tex.needsUpdate = true
      tex.repeat.set(RIBBON_LEN / RIBBON_W, 1)
      const mesh = new three.Mesh(geo, ribbonMaterial(tex, uniforms))
      mesh.userData.tex = tex
      root.add(mesh)
      rows.push({ mesh, uniforms })
    }
    return root
  },

  update(t01, params) {
    const rp: RibbonParams = {
      rows: n(params, 'rows'), rowSpacing: n(params, 'rowSpacing'), zRotation: n(params, 'zRotation'),
      waveAmplitude: n(params, 'waveAmplitude'), waveFrequency: n(params, 'waveFrequency'),
      rowPhase: n(params, 'rowPhase'), scrollSpeed: n(params, 'scrollSpeed'), scrollCycles: 1, waveCycles: 1,
    }
    for (let i = 0; i < rows.length; i++) {
      const s = ribbonRowState(t01, i, rp)
      const r = rows[i]
      r.mesh.position.y = s.y
      r.mesh.rotation.z = s.zRotation
      r.uniforms.uWavePhase.value = s.wavePhase
      r.uniforms.uWaveAmp.value = rp.waveAmplitude
      r.uniforms.uWaveFreq.value = rp.waveFrequency
      const tex = r.mesh.userData.tex as THREE.Texture
      tex.offset.x = -s.scrollOffset * (RIBBON_LEN / RIBBON_W)
    }
  },
}

/** Re-exported so the surface can compose the label the same way the texture does. */
export { buildRibbonLabel }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- spacetype-effect`
Expected: PASS (interface defaults + ribbon contract blocks).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/effects/ribbon.ts frontend/tests/unit/spacetype-effect.unit.spec.ts
git commit -m "feat(spacetype): ribbon effect — stacked twisting waving 3D type"
```

---

## Task 6: Space Type engine

Owns the `WebGLRenderer`, perspective camera, and scene; renders a specific frame index deterministically and extracts a PNG blob. WebGL is unavailable under Vitest, so this task has no unit test — it is exercised live in Task 8 and verified manually. Keep it dependency-injectable (the effect and dims are constructor args) so it stays small.

**Files:**
- Create: `frontend/app/lib/spacetype/engine.ts`

- [ ] **Step 1: Implement the engine**

Create `frontend/app/lib/spacetype/engine.ts`:

```typescript
import * as THREE from 'three'
import type { Params, SpaceTypeEffect } from './effect'
import type { TextTextureOptions } from './textTexture'
import { makeTextTexture } from './textTexture'

export interface EngineOptions {
  effect: SpaceTypeEffect
  width: number
  height: number
  fps: number
  loopDuration: number
  alpha: boolean
  bgColor: string
}

export class SpaceTypeEngine {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  private effect: SpaceTypeEffect
  private root: THREE.Object3D | null = null
  private opts: EngineOptions

  constructor(canvas: HTMLCanvasElement, opts: EngineOptions) {
    this.opts = opts
    this.effect = opts.effect
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: opts.alpha, antialias: true, preserveDrawingBuffer: true })
    this.renderer.setSize(opts.width, opts.height, false)
    this.scene = new THREE.Scene()
    if (!opts.alpha) this.scene.background = new THREE.Color(opts.bgColor)
    this.camera = new THREE.PerspectiveCamera(45, opts.width / opts.height, 0.1, 100)
    this.camera.position.set(0, 0, 14)
  }

  /** (Re)build the scene from params; call when structural params change. */
  build(params: Params, texOpts: TextTextureOptions): void {
    if (this.root) { this.scene.remove(this.root); this.root = null }
    const tex = makeTextTexture(texOpts)
    this.root = this.effect.buildScene(THREE, params, tex)
    this.scene.add(this.root)
  }

  /** Total frames in one loop. */
  get frameCount(): number { return Math.max(1, Math.round(this.opts.fps * this.opts.loopDuration)) }

  /** Render the scene at integer frame index. t01 = index / frameCount (no wall clock). */
  renderFrame(index: number, params: Params): void {
    const t01 = (index % this.frameCount) / this.frameCount
    this.camera.rotation.x = Number(params.cameraTilt ?? 0)
    this.effect.update(t01, params)
    this.renderer.render(this.scene, this.camera)
  }

  /** Read the current canvas back as a PNG blob (after renderFrame). */
  async frameToBlob(): Promise<Blob> {
    const canvas = this.renderer.domElement
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error('space type: frame produced no blob')
    return blob
  }

  dispose(): void {
    if (this.root) this.scene.remove(this.root)
    this.renderer.dispose()
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i spacetype || echo "no spacetype type errors"`
Expected: `no spacetype type errors`.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/lib/spacetype/engine.ts
git commit -m "feat(spacetype): deterministic Three.js engine (frame-index render + PNG readback)"
```

---

## Task 7: Bake orchestration with cache

Caches via `spaceTypeSourceKey` and uploads via the existing `uploadFrameBatch`. The pixel-producing step is injected (`renderFrame: (i) => Promise<Blob>`), so this is fully unit-testable without WebGL.

**Files:**
- Create: `frontend/app/lib/spacetype/bake.ts`
- Test: `frontend/tests/unit/spacetype-bake.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-bake.unit.spec.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ensureSpaceTypeBake, type SpaceTypeBake } from '../../app/lib/spacetype/bake'

const cfg = { effectId: 'ribbon', params: { rows: 11 }, fps: 30, loopDuration: 2, W: 640, H: 360 }

function deps() {
  const renderFrame = vi.fn(async (_i: number) => new Blob(['x'], { type: 'image/png' }))
  const upload = vi.fn(async (blobs: Blob[]) => blobs.map((_, i) => `st_${i}.png`))
  return { renderFrame, upload }
}

describe('ensureSpaceTypeBake', () => {
  it('renders frameCount frames and returns frames + source_key', async () => {
    const { renderFrame, upload } = deps()
    const bake = await ensureSpaceTypeBake(cfg, undefined, { renderFrame, upload })
    expect(renderFrame).toHaveBeenCalledTimes(60) // 30fps * 2s
    expect(bake.frames.length).toBe(60)
    expect(bake.fps).toBe(30)
    expect(bake.source_key).toBeTruthy()
  })

  it('returns the cached bake without re-rendering when source_key matches', async () => {
    const { renderFrame, upload } = deps()
    const first = await ensureSpaceTypeBake(cfg, undefined, { renderFrame, upload })
    renderFrame.mockClear(); upload.mockClear()
    const second = await ensureSpaceTypeBake(cfg, first, { renderFrame, upload })
    expect(renderFrame).not.toHaveBeenCalled()
    expect(second).toBe(first)
  })

  it('re-bakes when a param changes', async () => {
    const { renderFrame, upload } = deps()
    const first = await ensureSpaceTypeBake(cfg, undefined, { renderFrame, upload })
    renderFrame.mockClear()
    const changed = { ...cfg, params: { rows: 12 } }
    const second = await ensureSpaceTypeBake(changed, first, { renderFrame, upload })
    expect(renderFrame).toHaveBeenCalledTimes(60)
    expect(second.source_key).not.toBe(first.source_key)
  })

  it('throws if upload returns fewer frames than rendered', async () => {
    const renderFrame = vi.fn(async () => new Blob(['x']))
    const upload = vi.fn(async (b: Blob[]) => b.slice(1).map((_, i) => `st_${i}.png`))
    await expect(ensureSpaceTypeBake(cfg, undefined, { renderFrame, upload })).rejects.toThrow(/uploaded/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- spacetype-bake`
Expected: FAIL — cannot find module `bake`.

- [ ] **Step 3: Implement the bake orchestration**

Create `frontend/app/lib/spacetype/bake.ts`:

```typescript
import { spaceTypeSourceKey, type SourceKeyInput } from './sourceKey'

export interface SpaceTypeBake {
  source_key: string
  frames: string[]   // input/ filenames, frame order
  fps: number
}

export interface BakeDeps {
  /** Render frame i and return its PNG blob. */
  renderFrame: (index: number) => Promise<Blob>
  /** Upload blobs, returning input/ filenames in order. Defaults to uploadFrameBatch. */
  upload?: (blobs: Blob[]) => Promise<string[]>
  onProgress?: (done: number, total: number) => void
}

/**
 * Produce (or reuse) a baked PNG sequence for a Space Type config. Mirrors
 * lib/engine/motionClipBake's contract: same source_key + same frame count ⇒
 * return the cached bake untouched.
 */
export async function ensureSpaceTypeBake(
  cfg: SourceKeyInput,
  cached: SpaceTypeBake | undefined,
  deps: BakeDeps,
): Promise<SpaceTypeBake> {
  const key = spaceTypeSourceKey(cfg)
  const total = Math.max(1, Math.round(cfg.fps * cfg.loopDuration))
  if (cached && cached.source_key === key && cached.frames.length === total) return cached

  const blobs: Blob[] = []
  for (let i = 0; i < total; i++) {
    blobs.push(await deps.renderFrame(i))
    deps.onProgress?.(i + 1, total)
  }

  const upload = deps.upload ?? (async (b: Blob[]) => {
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    return uploadFrameBatch(b, 'spacetype')
  })
  const frames = await upload(blobs)
  if (frames.length !== blobs.length) {
    throw new Error(`space type bake: uploaded ${frames.length}/${blobs.length} frames — retry`)
  }
  return { source_key: key, frames, fps: cfg.fps }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- spacetype-bake`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full unit suite to confirm no regressions**

Run: `cd frontend && npm run test:unit -- spacetype`
Expected: PASS across all spacetype specs.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/bake.ts frontend/tests/unit/spacetype-bake.unit.spec.ts
git commit -m "feat(spacetype): bake orchestration with source-key cache + frame upload"
```

---

## Task 8: Space Type surface (modal)

The live authoring UI: a Three.js preview canvas driven by `requestAnimationFrame` (preview only — bake uses frame indices), an auto-built control panel from `effect.controls`, and export buttons. Integration/visual — verified manually. A light component test asserts the control panel renders one field per control.

**Files:**
- Create: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`
- Test: `frontend/tests/unit/spacetype-surface.unit.spec.ts`

- [ ] **Step 1: Write the failing component test**

Create `frontend/tests/unit/spacetype-surface.unit.spec.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SpaceTypeSurface from '../../app/components/vue-canvas/SpaceTypeSurface.vue'

// jsdom has no WebGL; stub the engine so the component mounts.
vi.mock('../../app/lib/spacetype/engine', () => ({
  SpaceTypeEngine: class {
    build() {} renderFrame() {} async frameToBlob() { return new Blob() } dispose() {}
    get frameCount() { return 1 }
  },
}))

describe('SpaceTypeSurface control panel', () => {
  it('renders one control field per ribbon control', () => {
    const wrapper = mount(SpaceTypeSurface, { props: { open: true } })
    const fields = wrapper.findAll('[data-control]')
    expect(fields.length).toBeGreaterThanOrEqual(11)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- spacetype-surface`
Expected: FAIL — cannot find the component.

- [ ] **Step 3: Implement the surface**

Create `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`:

```vue
<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed } from 'vue'
import { ribbonEffect, buildRibbonLabel } from '~/lib/spacetype/effects/ribbon'
import { defaultsFromControls, type Params } from '~/lib/spacetype/effect'
import { SpaceTypeEngine } from '~/lib/spacetype/engine'
import { ensureSpaceTypeBake, type SpaceTypeBake } from '~/lib/spacetype/bake'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'add-clip', bake: SpaceTypeBake): void; (e: 'save-poster', blob: Blob): void }>()

const W = 960, H = 540, FPS = 30
const effect = ribbonEffect
const params = reactive<Params>(defaultsFromControls(effect.controls))
const loopDuration = ref(4)
const transparent = ref(false)
const bgColor = ref('#0e0e10')

const canvas = ref<HTMLCanvasElement | null>(null)
let engine: SpaceTypeEngine | null = null
let raf = 0
let previewFrame = 0
const baking = ref(false)

function texOpts() {
  return {
    label: buildRibbonLabel(String(params.text), params.case === 'upper' ? 'upper' as const : 'as-typed' as const),
    fontFamily: 'Inter', fontWeight: 700, axes: { wght: 700 }, typeColor: String(params.typeColor),
  }
}

function rebuild() {
  engine?.build(params, texOpts())
}

onMounted(() => {
  if (!canvas.value) return
  engine = new SpaceTypeEngine(canvas.value, {
    effect, width: W, height: H, fps: FPS, loopDuration: loopDuration.value,
    alpha: transparent.value, bgColor: bgColor.value,
  })
  rebuild()
  const tick = () => {
    previewFrame = (previewFrame + 1) % Math.max(1, Math.round(FPS * loopDuration.value))
    engine?.renderFrame(previewFrame, params)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => { cancelAnimationFrame(raf); engine?.dispose() })

const cfg = computed(() => ({
  effectId: effect.id, params: { ...params }, fps: FPS, loopDuration: loopDuration.value, W, H,
}))

async function addToTimeline() {
  if (!engine) return
  baking.value = true
  try {
    rebuild()
    const bake = await ensureSpaceTypeBake(cfg.value, undefined, {
      renderFrame: async (i) => { engine!.renderFrame(i, params); return engine!.frameToBlob() },
    })
    emit('add-clip', bake)
  } finally { baking.value = false }
}

async function savePoster() {
  if (!engine) return
  engine.renderFrame(0, params)
  emit('save-poster', await engine.frameToBlob())
}
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <div class="flex max-h-[90vh] w-[1100px] max-w-[95vw] gap-4 rounded-xl bg-neutral-900 p-4 text-white">
      <div class="flex-1">
        <canvas ref="canvas" :width="W" :height="H" class="w-full rounded-lg" style="background:#0e0e10" />
        <div class="mt-3 flex gap-2">
          <button class="rounded bg-emerald-600 px-3 py-1.5 text-sm" :disabled="baking" @click="addToTimeline">
            {{ baking ? 'Baking…' : 'Add to timeline' }}
          </button>
          <button class="rounded bg-white/10 px-3 py-1.5 text-sm" @click="savePoster">Save poster</button>
          <button class="ml-auto rounded bg-white/10 px-3 py-1.5 text-sm" @click="emit('close')">Close</button>
        </div>
      </div>
      <div class="w-72 shrink-0 space-y-3 overflow-y-auto pr-1">
        <div v-for="c in effect.controls" :key="c.key" data-control class="text-xs">
          <label class="mb-1 block text-white/60">{{ c.label }}</label>
          <input v-if="c.kind === 'slider'" type="range" :min="c.min" :max="c.max" :step="c.step"
                 v-model.number="params[c.key]" class="w-full" />
          <input v-else-if="c.kind === 'text'" type="text" v-model="params[c.key]"
                 class="w-full rounded bg-white/10 px-2 py-1" @input="rebuild" />
          <input v-else-if="c.kind === 'color'" type="color" v-model="params[c.key]" @input="rebuild" />
          <select v-else-if="c.kind === 'select'" v-model="params[c.key]"
                  class="w-full rounded bg-white/10 px-2 py-1" @change="rebuild">
            <option v-for="o in c.options" :key="o" :value="o">{{ o }}</option>
          </select>
        </div>
        <div data-control class="text-xs">
          <label class="mb-1 block text-white/60">Loop seconds</label>
          <input type="range" min="1" max="10" step="0.5" v-model.number="loopDuration" class="w-full" />
        </div>
        <label data-control class="flex items-center gap-2 text-xs text-white/60">
          <input type="checkbox" v-model="transparent" /> Transparent background
        </label>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- spacetype-surface`
Expected: PASS (control panel renders ≥ 11 fields).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/tests/unit/spacetype-surface.unit.spec.ts
git commit -m "feat(spacetype): live authoring surface with auto-built control panel"
```

---

## Task 9: Wire into the Add menu + timeline/poster output

Mounts the surface from `default.vue`, gated by `SPACE_TYPE_ENABLED`, and handles its events: `add-clip` inserts a motion clip carrying the baked frames; `save-poster` uploads the still as a `type: output`-style asset. Manual-verify task.

**Files:**
- Modify: `frontend/app/layouts/default.vue` (Add-menu `loadOptions`, `onLoadOption`, modal mount, handlers)

- [ ] **Step 1: Add the imports**

In `frontend/app/layouts/default.vue` `<script setup>`, near the existing `KINETIC_ENABLED` import, add:

```typescript
import { SPACE_TYPE_ENABLED } from '~/lib/spaceTypeEnabled'
import SpaceTypeSurface from '~/components/vue-canvas/SpaceTypeSurface.vue'
import type { SpaceTypeBake } from '~/lib/spacetype/bake'
import { createMotionClip } from '~/composables/timelineMotionClip'
import { useTimelineStore } from '~/composables/useTimelineStore'
```

- [ ] **Step 2: Add the open-state ref + Add-menu tile**

Near the existing `const slateGalleryOpen = ref(false)`:

```typescript
const spaceTypeOpen = ref(false)
```

In the `loadOptions` array, after the Kinetic Slate entry, add (mirrors the gated-tile pattern):

```typescript
...(SPACE_TYPE_ENABLED ? [{ label: 'Space Type', icon: Clapperboard, special: 'space-type' }] : []),
```

In `onLoadOption`, add a branch before the `nodeType` handling:

```typescript
if (opt.special === 'space-type') { spaceTypeOpen.value = true; return }
```

- [ ] **Step 3: Mount the modal + handlers in the template**

Next to the `<VueCanvasSlateGalleryModal>` block, add:

```vue
<SpaceTypeSurface
  v-if="SPACE_TYPE_ENABLED && spaceTypeOpen"
  :open="spaceTypeOpen"
  @close="spaceTypeOpen = false"
  @add-clip="onSpaceTypeAddClip"
  @save-poster="onSpaceTypeSavePoster"
/>
```

- [ ] **Step 4: Implement the handlers**

In `<script setup>`:

```typescript
const timeline = useTimelineStore()

function onSpaceTypeAddClip(bake: SpaceTypeBake) {
  spaceTypeOpen.value = false
  // Reuse the motion-clip carrier; attach the Space Type bake as its motion_bake
  // so the existing motion_frames export path composites it unchanged.
  const playhead = timeline.playheadFrame?.value ?? 0
  const clip = createMotionClip({ startFrame: playhead, length: bake.frames.length })
  clip.layer.text = '' // visual comes entirely from the baked frames, not the 2D text layer
  clip.motion_bake = { source_key: bake.source_key, frames: bake.frames, fps: bake.fps }
  const trackId = timeline.firstVideoTrackId?.value
  if (trackId) timeline.addClip(trackId, clip)
}

async function onSpaceTypeSavePoster(blob: Blob) {
  spaceTypeOpen.value = false
  const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
  await uploadFrameBatch([blob], 'spacetype_poster')
  // Surfaced in Assets via the standard output-file path; the upload lands in
  // input/ and is promoted to a saved generation by the existing save flow.
}
```

> **Implementer note:** verify the exact store accessor names against `useTimelineStore.ts` — the task report shows `addClip(trackId, clip)` exists. If `playheadFrame` / `firstVideoTrackId` differ, use the store's actual playhead + first-video-track getters (grep `useTimelineStore.ts` for `playhead` and `track`). If a poster-to-Assets helper exists (grep `useProjectGenerations.ts` / `lib/generations.ts` for a save helper), prefer it over the raw upload.

- [ ] **Step 5: Type-check + run full unit suite**

Run: `cd frontend && npm run test:unit`
Expected: PASS (all suites, including non-spacetype).

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -iE 'spacetype|default\.vue' || echo "no relevant type errors"`
Expected: `no relevant type errors`.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/layouts/default.vue
git commit -m "feat(spacetype): Add-menu entry + timeline clip + poster output wiring"
```

---

## Task 10: Manual verification + flag flip decision

No code beyond flipping a flag for local testing. This is the "does it actually look like STG and export cleanly" gate.

- [ ] **Step 1: Temporarily enable the flag for local testing**

Edit `frontend/app/lib/spaceTypeEnabled.ts` → `export const SPACE_TYPE_ENABLED: boolean = true`. (Do NOT commit this change yet — it's for local verification.)

- [ ] **Step 2: Run the app and the surface**

```bash
cd frontend && npm run dev
```
In another shell, start ComfyUI per CLAUDE.md:
```bash
cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python main.py --listen 127.0.0.1 --port 8188
```
Open the app, click Add → Space Type. Verify:
- The ribbon preview animates: stacked rows, twist, wave, scroll.
- Dragging Rows / Twist / Wave / Scroll updates the preview live.
- Changing Text rebuilds the texture.

- [ ] **Step 3: Verify export to timeline**

Click "Add to timeline". Confirm a clip lands on the timeline at the playhead, scrub it, and confirm the baked ribbon frames play back. Export the timeline and confirm the ribbon appears in the rendered video (the `motion_frames` path in `nodes_timeline.py`).

- [ ] **Step 4: Verify poster + alpha**

Click "Save poster"; confirm a still appears in Assets. Toggle "Transparent background", re-add to timeline, and confirm the ribbon composites over an underlying clip with real transparency.

- [ ] **Step 5: Seamless-loop eyeball**

Loop-play the baked clip and confirm there's no visible jump at the wrap (the integer scroll/wave cycles should make it seamless).

- [ ] **Step 6: Revert the flag and decide**

Set `SPACE_TYPE_ENABLED` back to `false` (merge hidden, per the spec default), unless the user wants it shipped visible. Do not commit the `true` value.

- [ ] **Step 7: Update the memory index**

Append a one-line pointer to `/Users/julien/.claude/projects/-Users-julien-Documents-GitHub-Sailor/memory/MEMORY.md` and write a `project_space_type_ribbon.md` memory capturing: the suite architecture (pluggable `SpaceTypeEffect`), ribbon as slice 1, gated behind `SPACE_TYPE_ENABLED`, output via the `motion_frames` pipeline, and that cylinder/field/stripes are future slices.

- [ ] **Step 8: Final commit (if memory or docs changed in-repo)**

```bash
git add -A && git commit -m "docs(spacetype): mark ribbon slice 1 complete; flag stays hidden"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** flag (T1), effect seam (T1/T5), source-key cache (T2/T7), ribbon controls incl. STG signature (T5), seamless loop (T3), text-as-texture + variable fonts (T4), engine determinism (T6), three outputs — loop/poster/alpha (T8/T9), Add-menu entry (T9), tests (T1–T8), manual pixel verification (T10). All spec sections map to a task.
- **Type consistency:** `Params`, `ControlSpec`, `SpaceTypeEffect` (T1) are reused unchanged in T5/T6/T8; `SpaceTypeBake` (T7) is the shape emitted to T9; `SourceKeyInput` (T2) is the `cfg` built in T8 and consumed in T7. `ensureSpaceTypeBake(cfg, cached, deps)` signature is identical in T7 definition and T8 call site.
- **Known soft spots flagged inline:** T9's exact `useTimelineStore` accessor names and the poster-to-Assets helper are marked for the implementer to confirm against the live store (the explore pass confirmed `addClip` and the upload endpoint; the playhead/first-track getters and any dedicated poster-save helper should be grep-verified before relying on the names used here).
