# Slice Glitch Type Effect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new pluggable Space Type effect, "Slice Glitch", that reproduces a kinetic color-slice glitch poster — a clean condensed headline stack that morphs into horizontally-displaced, vibrantly-colored slices with hand-drawn doodles, drivable as an animated reveal or a held still.

**Architecture:** A 2D flat-plane `SpaceTypeEffect` in the Elastic family. An offscreen 2D canvas is redrawn each frame (type stack → per-cell color blocks → masked type → horizontal strip displacement → doodles) and carried on a full-screen plane as a `CanvasTexture`; a tiny fragment shader does the optional RGB channel split. All layout/displacement/doodle math lives in pure, unit-tested modules; only the effect file touches the canvas/Three.js. A single `glitch ∈ [0,1]` driver controls width-morph, block opacity, displacement, and doodles — ramped+churned in `animate` mode, frozen in `hold` mode.

**Tech Stack:** TypeScript, Three.js, 2D Canvas, Vitest (unit), Playwright (screenshots). Existing patterns: `frontend/app/lib/spacetype/effects/elastic.ts` (template), `effect.ts` (seam), `fills.ts` (palette), `google-fonts.ts` (font resolution).

**Reference:** `docs/superpowers/specs/2026-06-18-slice-glitch-type-effect-design.md` and the user-supplied carousel (clean stacked type is the start state; sliced color glitch is the developed state).

---

## File Structure

- **Create** `frontend/app/lib/spacetype/rng.ts` — shared deterministic PRNG (`mulberry32`, `hashSeed`).
- **Create** `frontend/app/lib/spacetype/sliceGlitchLayout.ts` — pure layout/glitch math (bands, segments, scaleX, strip offsets, reveal curve, churn seed, type-color pick).
- **Create** `frontend/app/lib/spacetype/doodleField.ts` — pure seeded doodle placement + stroke-path generation.
- **Create** `frontend/app/lib/spacetype/effects/sliceGlitch.ts` — the effect (controls + buildScene + update; canvas drawing).
- **Modify** `frontend/app/lib/spacetype/effects/index.ts` — register `sliceGlitchEffect`.
- **Create** `frontend/tests/unit/spacetype-rng.unit.spec.ts`
- **Create** `frontend/tests/unit/spacetype-slice-glitch-layout.unit.spec.ts`
- **Create** `frontend/tests/unit/spacetype-doodle-field.unit.spec.ts`
- **Create** `frontend/tests/unit/spacetype-slice-glitch-effect.unit.spec.ts`
- **Create** `frontend/.playground/slice-glitch-harness.html` — standalone visual harness (gitignored `.playground/`; for the screenshot loop).

All commands run from `frontend/`. Unit test command: `npm run test:unit`. Run a single file with `npx vitest run tests/unit/<file>`.

---

## Task 1: Shared deterministic PRNG (`rng.ts`)

**Files:**
- Create: `frontend/app/lib/spacetype/rng.ts`
- Test: `frontend/tests/unit/spacetype-rng.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-rng.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { mulberry32, hashSeed } from '~/lib/spacetype/rng'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(123); const b = mulberry32(123)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })
  it('produces values in [0,1)', () => {
    const r = mulberry32(7)
    for (let i = 0; i < 100; i++) { const v = r(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
  })
  it('different seeds diverge', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe('hashSeed', () => {
  it('maps strings to stable 32-bit integers', () => {
    expect(hashSeed('THE')).toBe(hashSeed('THE'))
    expect(hashSeed('THE')).not.toBe(hashSeed('OF ALL'))
    expect(Number.isInteger(hashSeed('x'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/spacetype-rng.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/spacetype/rng`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/app/lib/spacetype/rng.ts

/** Deterministic seeded PRNG. Returns a function yielding floats in [0,1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a → 32-bit unsigned int, for deriving a numeric seed from a string. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/spacetype-rng.unit.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/rng.ts frontend/tests/unit/spacetype-rng.unit.spec.ts
git commit -m "feat(spacetype): seeded PRNG helper (mulberry32 + hashSeed)"
```

---

## Task 2: Pure layout & glitch math (`sliceGlitchLayout.ts`)

This module owns all deterministic geometry. No canvas, no Three.js. The effect file supplies measured glyph widths; this module supplies everything else.

**Files:**
- Create: `frontend/app/lib/spacetype/sliceGlitchLayout.ts`
- Test: `frontend/tests/unit/spacetype-slice-glitch-layout.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-slice-glitch-layout.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  revealGlitch, churnSeed, bandLayout, segmentRow, scaleXForGlitch,
  pickTypeColor, stripOffsets,
} from '~/lib/spacetype/sliceGlitchLayout'

describe('revealGlitch', () => {
  it('ramps 0→1 over the reveal fraction then holds at 1', () => {
    expect(revealGlitch(0, 0.4)).toBeCloseTo(0)
    expect(revealGlitch(0.2, 0.4)).toBeCloseTo(0.5)
    expect(revealGlitch(0.4, 0.4)).toBeCloseTo(1)
    expect(revealGlitch(0.8, 0.4)).toBeCloseTo(1)
  })
  it('reveal fraction 0 means always fully glitched', () => {
    expect(revealGlitch(0, 0)).toBeCloseTo(1)
  })
})

describe('churnSeed', () => {
  it('quantizes time into churnRate steps and mixes with base seed', () => {
    expect(churnSeed(0.00, 4, 9)).toBe(churnSeed(0.10, 4, 9)) // same quarter
    expect(churnSeed(0.00, 4, 9)).not.toBe(churnSeed(0.30, 4, 9)) // next quarter
  })
  it('churnRate 0 → static (base seed every frame)', () => {
    expect(churnSeed(0.7, 0, 9)).toBe(churnSeed(0.1, 0, 9))
  })
})

describe('bandLayout', () => {
  it('divides height into N contiguous bands covering [0,height]', () => {
    const bands = bandLayout(4, 1000)
    expect(bands).toHaveLength(4)
    expect(bands[0]!.y).toBe(0)
    expect(bands[3]!.y + bands[3]!.h).toBeCloseTo(1000)
    for (let i = 1; i < bands.length; i++) expect(bands[i]!.y).toBeCloseTo(bands[i - 1]!.y + bands[i - 1]!.h)
  })
})

describe('segmentRow', () => {
  it('partitions [0,width] into segments whose widths sum to width', () => {
    const segs = segmentRow(mulRng(1), 0, 900, 3, 6)
    const sum = segs.reduce((a, s) => a + s.w, 0)
    expect(sum).toBeCloseTo(900)
    expect(segs.every(s => s.colorIndex >= 0 && s.colorIndex < 6)).toBe(true)
  })
  it('is deterministic for the same seed', () => {
    expect(segmentRow(mulRng(5), 0, 900, 3, 6)).toEqual(segmentRow(mulRng(5), 0, 900, 3, 6))
  })
})

describe('scaleXForGlitch', () => {
  it('is 1 at glitch=0 and natW→targetW at glitch=1', () => {
    expect(scaleXForGlitch(100, 300, 0)).toBeCloseTo(1)
    expect(scaleXForGlitch(100, 300, 1)).toBeCloseTo(3)
    expect(scaleXForGlitch(100, 300, 0.5)).toBeCloseTo(2)
  })
})

describe('pickTypeColor', () => {
  it('white mode always returns -1 (= white)', () => {
    expect(pickTypeColor(mulRng(1), 'white', 6)).toBe(-1)
  })
  it('palette mode returns a valid palette index', () => {
    const idx = pickTypeColor(mulRng(1), 'palette', 6)
    expect(idx).toBeGreaterThanOrEqual(0); expect(idx).toBeLessThan(6)
  })
})

describe('stripOffsets', () => {
  const base = { height: 1000, sliceH: 10, glitch: 1, seed: 3, bandShift: 80, tearAmount: 30, tearFrequency: 24 }
  it('returns one offset per strip', () => {
    expect(stripOffsets(base)).toHaveLength(100)
  })
  it('all-zero at glitch=0', () => {
    expect(stripOffsets({ ...base, glitch: 0 }).every(o => o === 0)).toBe(true)
  })
  it('max magnitude scales with glitch', () => {
    const m = (g: number) => Math.max(...stripOffsets({ ...base, glitch: g }).map(Math.abs))
    expect(m(1)).toBeGreaterThan(m(0.5))
  })
  it('is deterministic for the same seed', () => {
    expect(stripOffsets(base)).toEqual(stripOffsets(base))
  })
})

// local helper: a fresh seeded rng for tests
import { mulberry32 } from '~/lib/spacetype/rng'
function mulRng(seed: number) { return mulberry32(seed) }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/spacetype-slice-glitch-layout.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/spacetype/sliceGlitchLayout`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/app/lib/spacetype/sliceGlitchLayout.ts
import { mulberry32 } from './rng'

export interface Band { y: number; h: number }
export interface Segment { x: number; w: number; colorIndex: number }
export type TypeColorMode = 'white' | 'palette' | 'mixed'

/** glitch amount from loop time: linear ramp over [0, revealFrac], then 1. */
export function revealGlitch(t01: number, revealFrac: number): number {
  if (revealFrac <= 0) return 1
  return Math.min(1, Math.max(0, t01) / revealFrac)
}

/** Quantize loop time into churnRate steps; mix with base seed for a flicker seed. */
export function churnSeed(t01: number, churnRate: number, baseSeed: number): number {
  const step = churnRate <= 0 ? 0 : Math.floor(t01 * churnRate)
  return ((baseSeed >>> 0) ^ Math.imul(step + 1, 0x9e3779b1)) >>> 0
}

/** Contiguous equal bands covering [0,height]. */
export function bandLayout(count: number, height: number): Band[] {
  const n = Math.max(1, Math.floor(count))
  const h = height / n
  return Array.from({ length: n }, (_, i) => ({ y: i * h, h }))
}

/** Partition [x0, x0+width] into ~density segments with random widths and palette indices. */
export function segmentRow(rng: () => number, x0: number, width: number, density: number, paletteLen: number): Segment[] {
  const n = Math.max(1, Math.round(density))
  const weights = Array.from({ length: n }, () => 0.5 + rng())
  const total = weights.reduce((a, b) => a + b, 0)
  const segs: Segment[] = []
  let x = x0
  for (let i = 0; i < n; i++) {
    const w = (weights[i]! / total) * width
    segs.push({ x, w, colorIndex: Math.floor(rng() * paletteLen) % paletteLen })
    x += w
  }
  // absorb float drift into the last segment so widths sum exactly to width
  const last = segs[segs.length - 1]!
  last.w = x0 + width - last.x
  return segs
}

/** scaleX lerps 1 → targetW/natW as glitch goes 0 → 1. */
export function scaleXForGlitch(natW: number, targetW: number, glitch: number): number {
  const target = natW > 0 ? targetW / natW : 1
  return 1 + (target - 1) * Math.min(1, Math.max(0, glitch))
}

/** -1 means white; otherwise a palette index. 'mixed' is white ~half the time. */
export function pickTypeColor(rng: () => number, mode: TypeColorMode, paletteLen: number): number {
  if (mode === 'white') return -1
  if (mode === 'mixed' && rng() < 0.5) return -1
  return Math.floor(rng() * paletteLen) % paletteLen
}

export interface StripOffsetsInput {
  height: number; sliceH: number; glitch: number; seed: number
  bandShift: number; tearAmount: number; tearFrequency: number
}

/**
 * One x-offset per horizontal strip. Two layers:
 *  - coarse band shift: a few wide bands share a large offset (chunky tears)
 *  - fine tear: per-strip jitter grouped by tearFrequency
 * Both scale with glitch.
 */
export function stripOffsets(inp: StripOffsetsInput): number[] {
  const { height, sliceH, glitch, seed, bandShift, tearAmount, tearFrequency } = inp
  const count = Math.max(1, Math.ceil(height / Math.max(1, sliceH)))
  const g = Math.min(1, Math.max(0, glitch))
  if (g === 0) return new Array(count).fill(0)

  const coarseRng = mulberry32(seed)
  const COARSE_BANDS = 6
  const coarse = Array.from({ length: COARSE_BANDS }, () => (coarseRng() * 2 - 1) * bandShift * g)

  const tearRng = mulberry32((seed >>> 0) ^ 0x85ebca6b)
  const groups = Math.max(1, Math.round(tearFrequency))
  const tear = Array.from({ length: groups }, () => (tearRng() * 2 - 1) * tearAmount * g)

  return Array.from({ length: count }, (_, i) => {
    const ci = Math.min(COARSE_BANDS - 1, Math.floor((i / count) * COARSE_BANDS))
    const ti = Math.min(groups - 1, Math.floor((i / count) * groups))
    return coarse[ci]! + tear[ti]!
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/spacetype-slice-glitch-layout.unit.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/sliceGlitchLayout.ts frontend/tests/unit/spacetype-slice-glitch-layout.unit.spec.ts
git commit -m "feat(spacetype): pure slice-glitch layout & displacement math"
```

---

## Task 3: Pure doodle field (`doodleField.ts`)

**Files:**
- Create: `frontend/app/lib/spacetype/doodleField.ts`
- Test: `frontend/tests/unit/spacetype-doodle-field.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-doodle-field.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { doodleField, DOODLE_KINDS } from '~/lib/spacetype/doodleField'
import { mulberry32 } from '~/lib/spacetype/rng'

describe('doodleField', () => {
  it('returns `count` doodles', () => {
    expect(doodleField(mulberry32(1), 5, 900, 1150, [40, 120])).toHaveLength(5)
  })
  it('is deterministic for the same seed', () => {
    expect(doodleField(mulberry32(2), 4, 900, 1150, [40, 120]))
      .toEqual(doodleField(mulberry32(2), 4, 900, 1150, [40, 120]))
  })
  it('places doodles within the canvas and gives each a known kind + non-empty path', () => {
    for (const d of doodleField(mulberry32(3), 8, 900, 1150, [40, 120])) {
      expect(d.x).toBeGreaterThanOrEqual(0); expect(d.x).toBeLessThanOrEqual(900)
      expect(d.y).toBeGreaterThanOrEqual(0); expect(d.y).toBeLessThanOrEqual(1150)
      expect(DOODLE_KINDS).toContain(d.kind)
      expect(d.points.length).toBeGreaterThan(1)
      expect(d.appearAt).toBeGreaterThanOrEqual(0); expect(d.appearAt).toBeLessThanOrEqual(1)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/spacetype-doodle-field.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/spacetype/doodleField`.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/app/lib/spacetype/doodleField.ts

export const DOODLE_KINDS = ['loop', 'spiral', 'zigzag', 'scribble', 'flick'] as const
export type DoodleKind = (typeof DOODLE_KINDS)[number]

export interface Doodle {
  kind: DoodleKind
  x: number; y: number          // center, canvas px
  scale: number                 // px
  rotation: number              // radians
  colorIndex: number            // into palette
  appearAt: number              // 0..1 reveal threshold (draw-on order)
  points: { x: number; y: number }[]  // local-space polyline, roughly within [-1,1]
}

/** Local-space stroke polyline for each doodle kind (centered at origin, ~unit radius). */
function strokePoints(kind: DoodleKind, rng: () => number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  const N = 48
  switch (kind) {
    case 'loop': {
      const loops = 1 + Math.floor(rng() * 2)
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * Math.PI * 2 * loops
        const r = 0.4 + 0.5 * (i / N)
        pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r * 0.7 })
      }
      break
    }
    case 'spiral': {
      const turns = 2 + rng() * 2
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * Math.PI * 2 * turns
        const r = (i / N)
        pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r })
      }
      break
    }
    case 'zigzag': {
      const teeth = 4 + Math.floor(rng() * 4)
      for (let i = 0; i <= teeth; i++) {
        pts.push({ x: -1 + (2 * i) / teeth, y: i % 2 === 0 ? -0.5 : 0.5 })
      }
      break
    }
    case 'scribble': {
      let x = -1, y = 0
      pts.push({ x, y })
      for (let i = 0; i < 12; i++) { x += -0.2 + rng() * 0.4 + 0.18; y = (rng() * 2 - 1) * 0.8; pts.push({ x, y }) }
      break
    }
    case 'flick': {
      // small music-note-ish hook
      pts.push({ x: -0.2, y: 1 }, { x: -0.2, y: -0.6 }, { x: 0.4, y: -1 }, { x: 0.6, y: -0.4 })
      break
    }
  }
  return pts
}

/** Seeded scatter of doodles across the canvas. Pure given the rng. */
export function doodleField(
  rng: () => number, count: number, width: number, height: number, sizeRange: [number, number],
): Doodle[] {
  const n = Math.max(0, Math.floor(count))
  const [smin, smax] = sizeRange
  const out: Doodle[] = []
  for (let i = 0; i < n; i++) {
    const kind = DOODLE_KINDS[Math.floor(rng() * DOODLE_KINDS.length) % DOODLE_KINDS.length]!
    out.push({
      kind,
      x: rng() * width,
      y: rng() * height,
      scale: smin + rng() * (smax - smin),
      rotation: (rng() * 2 - 1) * Math.PI,
      colorIndex: Math.floor(rng() * 1000),  // effect mods by palette length
      appearAt: rng(),
      points: strokePoints(kind, rng),
    })
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/spacetype-doodle-field.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/doodleField.ts frontend/tests/unit/spacetype-doodle-field.unit.spec.ts
git commit -m "feat(spacetype): pure seeded doodle field generator"
```

---

## Task 4: The effect (`sliceGlitch.ts`) + registration + contract test

This is the canvas/Three.js layer. It mirrors `elastic.ts`'s module-level `state` + per-frame redraw pattern. Three offscreen canvases are used: `typeCanvas` (rasterized type matte), `compCanvas` (blocks + masked type composited), and the visible `outCanvas` (strip-displaced composite + doodles) which backs the texture. A small shader applies the optional RGB split.

**Files:**
- Create: `frontend/app/lib/spacetype/effects/sliceGlitch.ts`
- Modify: `frontend/app/lib/spacetype/effects/index.ts`
- Test: `frontend/tests/unit/spacetype-slice-glitch-effect.unit.spec.ts`

- [ ] **Step 1: Write the failing contract test**

```ts
// frontend/tests/unit/spacetype-slice-glitch-effect.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { sliceGlitchEffect } from '~/lib/spacetype/effects/sliceGlitch'
import { getEffect, SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects'

describe('sliceGlitchEffect contract', () => {
  it('declares id, label, controls', () => {
    expect(sliceGlitchEffect.id).toBe('sliceglitch')
    expect(sliceGlitchEffect.label.length).toBeGreaterThan(0)
    expect(sliceGlitchEffect.controls.length).toBeGreaterThan(0)
  })
  it('every control has a default and a unique key', () => {
    const keys = sliceGlitchEffect.controls.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const c of sliceGlitchEffect.controls) expect(c.default).toBeDefined()
  })
  it('exposes the signature controls', () => {
    const keys = sliceGlitchEffect.controls.map(c => c.key)
    for (const k of ['text', 'font', 'palette', 'revealMode', 'glitchAmount', 'bandShift', 'doodlesOn', 'speed']) {
      expect(keys).toContain(k)
    }
  })
  it('is registered and resolvable by id', () => {
    expect(SPACE_TYPE_EFFECTS.map(e => e.id)).toContain('sliceglitch')
    expect(getEffect('sliceglitch')).toBe(sliceGlitchEffect)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/spacetype-slice-glitch-effect.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/spacetype/effects/sliceGlitch`.

- [ ] **Step 3: Write the effect implementation**

Create `frontend/app/lib/spacetype/effects/sliceGlitch.ts`. Use `elastic.ts` as the structural reference (module-level `state`, `n()` helper, `resolveFontFamily`/`fontHasWeightAxis`, font-load re-rasterize, plane sizing). Implement exactly this:

```ts
import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills } from '../fills'
import { resolveFontFamily, fontHasWeightAxis } from '~/data/google-fonts'
import { mulberry32, hashSeed } from '../rng'
import {
  revealGlitch, churnSeed, bandLayout, segmentRow, scaleXForGlitch, pickTypeColor, stripOffsets,
  type TypeColorMode,
} from '../sliceGlitchLayout'
import { doodleField } from '../doodleField'

/**
 * SLICE GLITCH — kinetic color-slice poster. A heavy condensed stack
 * (clean white-on-near-black) morphs into horizontally-displaced, vibrantly
 * colored slices with hand-drawn doodles. One `glitch` driver (0..1) controls
 * width-morph, color-block opacity, strip displacement and doodle presence;
 * `revealMode` switches between an animated ramp+churn and a held still.
 *
 * Pipeline (per frame, all on 2D canvas): type matte → per-band color blocks +
 * masked type → horizontal strip displacement → doodles. The visible canvas is
 * a CanvasTexture on a flat plane; a tiny shader does the optional RGB split.
 * Layout/displacement/doodle math is pure + unit-tested (../sliceGlitchLayout,
 * ../doodleField). Flat by design; works under either camera.
 */

const controls: ControlSpec[] = [
  // Type
  { key: 'text', label: 'Text', kind: 'textList', default: 'THE\nMEANING\nOF ALL\nMOTIONS\nSHAPES &\nSOUNDS', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Anton', group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 400, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 20, step: 1, default: -4, group: 'Type' },
  { key: 'lineTight', label: 'Line tightness', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0.85, group: 'Type' },
  { key: 'fitWidth', label: 'Stretch to width', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0.92, group: 'Type' },
  // Color
  { key: 'palette', label: 'Palette', kind: 'fillList', default: JSON.stringify([
      { type: 'solid', a: '#33dd33', b: '#000000', textColor: '#ffffff' },
      { type: 'solid', a: '#7a3cff', b: '#000000', textColor: '#ffffff' },
      { type: 'solid', a: '#ff5ad1', b: '#000000', textColor: '#ffffff' },
      { type: 'solid', a: '#ff5a1f', b: '#000000', textColor: '#ffffff' },
      { type: 'solid', a: '#eaff00', b: '#000000', textColor: '#ffffff' },
      { type: 'solid', a: '#3b5bff', b: '#000000', textColor: '#ffffff' },
    ]), group: 'Color' },
  { key: 'blockDensity', label: 'Blocks / band', kind: 'slider', min: 1, max: 8, step: 1, default: 3, group: 'Color' },
  { key: 'typeColorMode', label: 'Type color', kind: 'select', options: ['white', 'palette', 'mixed'], default: 'mixed', group: 'Color' },
  { key: 'bgColor', label: 'Background', kind: 'color', default: '#141414', group: 'Color' },
  // Glitch
  { key: 'revealMode', label: 'Reveal mode', kind: 'select', options: ['animate', 'hold'], default: 'animate', group: 'Glitch' },
  { key: 'glitchAmount', label: 'Glitch (hold)', kind: 'slider', min: 0, max: 1, step: 0.02, default: 1, group: 'Glitch' },
  { key: 'revealFrac', label: 'Reveal length', kind: 'slider', min: 0, max: 0.9, step: 0.02, default: 0.4, group: 'Glitch' },
  { key: 'bandShift', label: 'Band shift', kind: 'slider', min: 0, max: 200, step: 2, default: 70, group: 'Glitch' },
  { key: 'tearAmount', label: 'Tear', kind: 'slider', min: 0, max: 80, step: 1, default: 22, group: 'Glitch' },
  { key: 'tearFrequency', label: 'Tear frequency', kind: 'slider', min: 1, max: 60, step: 1, default: 24, group: 'Glitch' },
  { key: 'sliceH', label: 'Slice height', kind: 'slider', min: 2, max: 40, step: 1, default: 8, group: 'Glitch' },
  { key: 'rgbSplit', label: 'RGB split', kind: 'slider', min: 0, max: 0.02, step: 0.0005, default: 0.004, group: 'Glitch' },
  { key: 'churnRate', label: 'Churn rate', kind: 'slider', min: 0, max: 24, step: 1, default: 8, group: 'Glitch' },
  // Doodles
  { key: 'doodlesOn', label: 'Doodles', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Doodles' },
  { key: 'doodleCount', label: 'Doodle count', kind: 'slider', min: 0, max: 40, step: 1, default: 16, group: 'Doodles' },
  { key: 'doodleSize', label: 'Doodle size', kind: 'slider', min: 20, max: 160, step: 2, default: 60, group: 'Doodles' },
  { key: 'doodleColorMode', label: 'Doodle color', kind: 'select', options: ['palette', 'white'], default: 'palette', group: 'Doodles' },
  { key: 'doodleWidth', label: 'Doodle stroke', kind: 'slider', min: 1, max: 12, step: 0.5, default: 3, group: 'Doodles' },
  // Motion
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 4, step: 1, default: 1, group: 'Motion' },
]

// passthrough + RGB split shader on the output canvas texture
const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
const FRAG = [
  'precision highp float;',
  'uniform sampler2D uTex; uniform float uSplit;',
  'varying vec2 vUv;',
  'void main(){',
  '  float r = texture2D(uTex, vUv + vec2(uSplit, 0.0)).r;',
  '  vec4 g = texture2D(uTex, vUv);',
  '  float b = texture2D(uTex, vUv - vec2(uSplit, 0.0)).b;',
  '  gl_FragColor = vec4(r, g.g, b, 1.0);',
  '}',
].join('\n')

function n(p: Params, k: string): number { return Number(p[k]) }
function paletteColors(p: Params): string[] {
  const fills = parseFills(p.palette)
  const cols = fills.map(f => f.a)
  return cols.length ? cols : ['#ffffff']
}
function textLines(p: Params): string[] {
  const ls = String(p.text ?? '').split('\n').map(s => s.trim()).filter(Boolean).map(s => s.toUpperCase())
  return ls.length ? ls : [' ']
}

interface LineMetric { chars: string[]; widths: number[]; natW: number; fs: number }

/** Measure each line at a size that fits the block vertically. */
function measure(ctx: CanvasRenderingContext2D, W: number, H: number, p: Params): { lines: LineMetric[]; fs: number } {
  const ls = textLines(p)
  const family = resolveFontFamily(String(p.font))
  const weight = fontHasWeightAxis(family) ? n(p, 'typeWeight') : 400
  const tight = n(p, 'lineTight')
  const tracking = n(p, 'tracking')
  // line-height factor: tighter = rows kiss
  const lineFactor = 1.06 - 0.32 * tight
  let fs = (H / ls.length) / lineFactor
  // shrink so the natural-width widest line fits horizontally too
  ctx.font = `${weight} ${fs}px "${family}", Anton, Impact, "Arial Narrow", sans-serif`
  const measureLine = (line: string) => {
    const chars = [...line]
    const widths = chars.map(c => ctx.measureText(c).width + tracking)
    return { chars, widths, natW: widths.reduce((a, b) => a + b, 0), fs }
  }
  let lines = ls.map(measureLine)
  const maxNat = Math.max(1, ...lines.map(l => l.natW))
  if (maxNat > W * 0.98) { fs *= (W * 0.98) / maxNat; ctx.font = `${weight} ${fs}px "${family}", Anton, Impact, "Arial Narrow", sans-serif`; lines = ls.map(measureLine) }
  return { lines, fs }
}

interface State {
  typeCtx: CanvasRenderingContext2D
  compCtx: CanvasRenderingContext2D
  outCtx: CanvasRenderingContext2D
  tex: THREE.CanvasTexture
  uniforms: { uTex: { value: THREE.Texture }; uSplit: { value: number } }
  W: number; H: number
}
let state: State | null = null

function mkCanvas(W: number, H: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  return c.getContext('2d')!
}

/** Full per-frame draw into state.outCtx. glitch ∈ [0,1], seed integer. */
function draw(s: State, p: Params, glitch: number, seed: number): void {
  const { W, H } = s
  const pal = paletteColors(p)
  const bg = String(p.bgColor)

  // 1) measure + rasterize the type matte (white on transparent) into typeCtx
  const tctx = s.typeCtx
  tctx.clearRect(0, 0, W, H)
  tctx.fillStyle = '#ffffff'; tctx.textAlign = 'left'; tctx.textBaseline = 'middle'
  const family = resolveFontFamily(String(p.font))
  const weight = fontHasWeightAxis(family) ? n(p, 'typeWeight') : 400
  const { lines, fs } = measure(tctx, W, H, p)
  tctx.font = `${weight} ${fs}px "${family}", Anton, Impact, "Arial Narrow", sans-serif`
  const bands = bandLayout(lines.length, H)
  const targetW = W * n(p, 'fitWidth')
  // per-line scaleX (width morph) + draw
  const lineScale = lines.map(l => scaleXForGlitch(l.natW, targetW, glitch))
  lines.forEach((l, i) => {
    const band = bands[i]!; const sx = lineScale[i]!
    const total = l.natW * sx
    let x = (W - total) / 2
    const cy = band.y + band.h / 2
    tctx.save(); tctx.translate(0, 0)
    for (let c = 0; c < l.chars.length; c++) {
      tctx.save(); tctx.translate(x + (l.widths[c]! * sx) / 2, cy); tctx.scale(sx, 1)
      tctx.fillText(l.chars[c]!, -l.widths[c]! / 2, 0); tctx.restore()
      x += l.widths[c]! * sx
    }
    tctx.restore()
  })

  // 2) composite blocks + masked type into compCtx
  const cctx = s.compCtx
  cctx.clearRect(0, 0, W, H)
  cctx.fillStyle = bg; cctx.fillRect(0, 0, W, H)
  // color blocks behind type, fading in with glitch
  cctx.save(); cctx.globalAlpha = glitch
  const blockSeedRng = mulberry32((seed >>> 0) ^ 0xc2b2ae35)
  const density = n(p, 'blockDensity')
  bands.forEach(band => {
    for (const seg of segmentRow(blockSeedRng, 0, W, density, pal.length)) {
      // ~1 in 4 segments left as background for the black-gap look
      if (blockSeedRng() < 0.22) continue
      cctx.fillStyle = pal[seg.colorIndex]!
      cctx.fillRect(seg.x, band.y, seg.w, band.h)
    }
  })
  cctx.restore()
  // type layer: tint the matte per line, then stamp via source-over using matte alpha.
  // Simplest faithful approach: draw matte in white, then for palette/mixed lines
  // overlay a colored copy masked by the matte. v1: draw whole matte once, tinted.
  const typeMode = String(p.typeColorMode) as TypeColorMode
  const typeRng = mulberry32((seed >>> 0) ^ 0x27d4eb2f)
  // Build a tinted type layer on a scratch = typeCtx canvas reused via compositing:
  lines.forEach((_, i) => {
    const band = bands[i]!
    const ci = pickTypeColor(typeRng, typeMode, pal.length)
    const color = ci < 0 ? '#ffffff' : pal[ci]!
    // clip to this band, draw matte tinted: use the matte as mask via 'source-in' on a temp.
    cctx.save()
    cctx.beginPath(); cctx.rect(0, band.y, W, band.h); cctx.clip()
    cctx.globalCompositeOperation = 'source-over'
    cctx.fillStyle = color
    // draw matte alpha as a stencil: use drawImage of typeCtx canvas with destination masking
    cctx.globalCompositeOperation = 'source-over'
    // paint color where matte is opaque: draw matte canvas then recolor via 'source-in' on scratch
    cctx.drawImage(s.typeCtx.canvas, 0, 0)            // white glyphs in this band
    if (ci >= 0) {
      cctx.globalCompositeOperation = 'source-atop'    // recolor only the just-drawn glyphs
      cctx.fillStyle = color
      cctx.fillRect(0, band.y, W, band.h)
    }
    cctx.restore()
  })

  // 3) strip displacement comp → outCtx
  const octx = s.outCtx
  octx.clearRect(0, 0, W, H)
  octx.fillStyle = bg; octx.fillRect(0, 0, W, H)
  const sliceH = n(p, 'sliceH')
  const offs = stripOffsets({ height: H, sliceH, glitch, seed, bandShift: n(p, 'bandShift'), tearAmount: n(p, 'tearAmount'), tearFrequency: n(p, 'tearFrequency') })
  for (let i = 0; i < offs.length; i++) {
    const sy = i * sliceH; const h = Math.min(sliceH, H - sy)
    if (h <= 0) break
    octx.drawImage(s.compCtx.canvas, 0, sy, W, h, offs[i]!, sy, W, h)
  }

  // 4) doodles on top
  if (String(p.doodlesOn) === 'on') {
    const dRng = mulberry32((seed >>> 0) ^ 0x165667b1)
    const size = n(p, 'doodleSize')
    const field = doodleField(dRng, n(p, 'doodleCount'), W, H, [size * 0.6, size * 1.4])
    octx.lineCap = 'round'; octx.lineJoin = 'round'; octx.lineWidth = n(p, 'doodleWidth')
    const dmode = String(p.doodleColorMode)
    for (const d of field) {
      if (glitch < d.appearAt) continue
      octx.strokeStyle = dmode === 'white' ? '#ffffff' : pal[d.colorIndex % pal.length]!
      octx.save(); octx.translate(d.x, d.y); octx.rotate(d.rotation); octx.scale(d.scale, d.scale)
      octx.beginPath()
      d.points.forEach((pt, k) => { if (k === 0) octx.moveTo(pt.x, pt.y); else octx.lineTo(pt.x, pt.y) })
      octx.restore()  // restore transform BEFORE stroke so lineWidth stays in px
      octx.stroke()
    }
  }

  s.tex.needsUpdate = true
  s.uniforms.uSplit.value = n(p, 'rgbSplit') * glitch
}

export const sliceGlitchEffect: SpaceTypeEffect = {
  id: 'sliceglitch',
  label: 'Slice Glitch',
  controls,

  buildScene(three, params, _textTexture) {
    void _textTexture
    state = null
    const root = new three.Group()
    const W = 900, H = 1150
    const typeCtx = mkCanvas(W, H)
    const compCtx = mkCanvas(W, H)
    const outCtx = mkCanvas(W, H)

    const tex = new three.CanvasTexture(outCtx.canvas)
    tex.minFilter = three.LinearFilter; tex.magFilter = three.LinearFilter
    const uniforms = { uTex: { value: tex as THREE.Texture }, uSplit: { value: 0 } }
    const mat = new three.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, side: three.DoubleSide })

    const planeH = 11.6, planeW = planeH * (W / H)
    const mesh = new three.Mesh(new three.PlaneGeometry(planeW, planeH), mat)
    mesh.userData.tex = tex
    root.add(mesh)

    state = { typeCtx, compCtx, outCtx, tex, uniforms, W, H }
    // initial draw at clean state
    draw(state, params, 0, hashSeed(textLines(params).join('|')))

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts && typeof fonts.load === 'function') {
      const family = resolveFontFamily(String(params.font))
      fonts.load(`400 40px "${family}"`).then(() => {
        if (state && state.outCtx === outCtx) draw(state, params, currentGlitch(params, 0), currentSeed(params, 0))
      }).catch(() => {})
    }
    return root
  },

  update(t01, params) {
    if (!state) return
    draw(state, params, currentGlitch(params, t01), currentSeed(params, t01))
  },
}

/** glitch for the current frame given revealMode. */
function currentGlitch(p: Params, t01: number): number {
  if (String(p.revealMode) === 'hold') return n(p, 'glitchAmount')
  const cycles = Math.max(1, Math.round(n(p, 'speed')) || 1)
  const tt = (t01 * cycles) % 1
  return revealGlitch(tt, n(p, 'revealFrac'))
}

/** seed for the current frame: static in hold, churned in animate. */
function currentSeed(p: Params, t01: number): number {
  const base = hashSeed(textLines(p).join('|'))
  if (String(p.revealMode) === 'hold') return base
  return churnSeed(t01, n(p, 'churnRate'), base)
}
```

> **Note on the type-tinting block:** the `source-atop` recolor approach above is the v1 starting point. If, during the screenshot loop (Task 6), white-vs-colored glyphs don't read correctly, switch to a dedicated scratch canvas: draw the matte to a scratch ctx, set `globalCompositeOperation='source-in'`, fill with the color, then `drawImage` the scratch onto `compCtx`. Keep the change inside `draw()`; the pure modules and the public effect API do not change.

- [ ] **Step 4: Register the effect**

Modify `frontend/app/lib/spacetype/effects/index.ts`: add the import and append to the array.

```ts
import { sliceGlitchEffect } from './sliceGlitch'
// ...
export const SPACE_TYPE_EFFECTS: SpaceTypeEffect[] = [
  ribbonEffect, stripesEffect, cylinderEffect, fieldEffect, coilEffect,
  cascadeEffect, boostEffect, meltEffect, onionburstEffect, elasticEffect,
  stringEffect, blendEffect, echoEffect,
  sliceGlitchEffect,
]
```

- [ ] **Step 5: Run the contract test + full unit suite**

Run: `npx vitest run tests/unit/spacetype-slice-glitch-effect.unit.spec.ts`
Expected: PASS.
Run: `npm run test:unit`
Expected: PASS (no regressions in the existing spacetype tests).

- [ ] **Step 6: Typecheck**

Run: `npx vue-tsc --noEmit -p tsconfig.json` (or the project's typecheck script if one exists — check `package.json`; if `npm run typecheck` exists, use it).
Expected: no new type errors in the new files.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/spacetype/effects/sliceGlitch.ts frontend/app/lib/spacetype/effects/index.ts frontend/tests/unit/spacetype-slice-glitch-effect.unit.spec.ts
git commit -m "feat(spacetype): Slice Glitch effect (color-slice glitch poster)"
```

---

## Task 5: Standalone visual harness

A self-contained HTML page that imports the effect via the dev server and renders it to a canvas, with a glitch scrubber and a randomize button. This is the rig for the screenshot loop. `.playground/` is already untracked (see git status) — keep it there; do not commit it.

**Files:**
- Create: `frontend/.playground/slice-glitch-harness.html`

- [ ] **Step 1: Create the harness**

The harness must: create a `SpaceTypeEngine` (see `frontend/app/lib/spacetype/engine.ts` for its constructor/`build`/`renderFrame` API — read it first), build with `sliceGlitchEffect`'s defaults (`defaultsFromControls(sliceGlitchEffect.controls)`), and expose:
- a range input bound to loop time `t01` (0→1) that calls `engine.renderFrame`,
- a "hold" checkbox that flips `params.revealMode` and binds the slider to `glitchAmount`,
- a "randomize palette" button.

Because the engine and effect are ESM under Nuxt's alias (`~`), the simplest path is to run this **inside the Nuxt dev server** as a throwaway page or via a Vitest-browser/Playwright script rather than a bare file. Decision for this task: implement the harness as a **Playwright-driven page** that navigates to the running dev server's SpaceTypeSurface with the effect selected, OR a minimal Nuxt page at `frontend/app/pages/_playground/slice-glitch.vue` (delete before merge). Prefer the throwaway Nuxt page — it gets the `~` alias and Three for free.

- [ ] **Step 2: Verify it renders**

Run the dev server (`npm run dev`) and use the preview tooling (`preview_start`, `preview_screenshot`) to load the playground page. Confirm: at `t01=0` you see clean white stacked type on near-black; advancing the slider shows the color-slice glitch building.

- [ ] **Step 3: Commit (page only, not `.playground/`)**

If you used a throwaway Nuxt page, do **not** commit it (it's deleted before merge). If you must keep a harness, gate it behind a clear `_playground` route and note it for removal. No commit required for this task.

---

## Task 6: Tune defaults to the reference (screenshot loop)

Per the standing rule (`feedback_verify_visuals_with_screenshots`): never ship a WebGL/visual effect on unit tests alone. Iterate the **defaults** until a rendered frame closely matches the user's reference carousel.

- [ ] **Step 1: Capture the clean state** — render `t01=0` (or `revealMode=hold, glitchAmount=0`), screenshot. Compare to the reference's last image (centered, natural-width, tightly-leaded white stack). Adjust `lineTight`, `tracking`, `typeWeight`, default font if needed.

- [ ] **Step 2: Capture the full-glitch state** — `revealMode=hold, glitchAmount=1`, screenshot a few churn seeds. Compare to reference frames 1–4. Tune: `palette` colors, `blockDensity`, `bandShift`, `tearAmount`, `tearFrequency`, `sliceH`, `fitWidth`, `typeColorMode`, doodle count/size/width.

- [ ] **Step 3: Capture the reveal** — `revealMode=animate`, render `t01 ∈ {0, 0.2, 0.4, 0.7, 0.95}`, confirm a smooth clean→glitch→churn progression.

- [ ] **Step 4: Present screenshots to the user for look sign-off.** Do not proceed to "done" until the user confirms the look. If the type-tinting reads wrong, apply the `source-in` scratch-canvas fallback noted in Task 4.

- [ ] **Step 5: Commit any default-value tweaks**

```bash
git add frontend/app/lib/spacetype/effects/sliceGlitch.ts
git commit -m "feat(spacetype): tune Slice Glitch defaults to reference"
```

---

## Task 7: In-app verification & bake

- [ ] **Step 1:** In the running app, open a Space Type node → SpaceTypeSurface modal → pick "Slice Glitch" from the effect picker. Confirm controls render grouped (Type/Color/Glitch/Doodles/Motion) and drive the preview live.

- [ ] **Step 2:** Switch `revealMode` between `animate` and `hold`; confirm animate shows the reveal+churn and hold freezes a still.

- [ ] **Step 3:** Trigger the modal's Bake; confirm a PNG sequence exports and lands as a project asset (reuses existing `ensureSpaceTypeBake` rails — no new plumbing).

- [ ] **Step 4:** Report results to the user with screenshots; get final sign-off.

---

## Self-Review (completed during planning)

- **Spec coverage:** Approach A canvas pipeline (Tasks 4–6); single glitch driver + revealMode animate/hold (Task 4 `currentGlitch`); curated-editable palette via fillList (Task 4 control); width-fit morph driven by glitch (Task 4 `lineScale` via `scaleXForGlitch`, Task 2); color blocks + masked type (Task 4 `draw`); strip displacement coarse+fine + RGB split (Task 2 `stripOffsets`, Task 4 shader); doodles v1 (Task 3 + Task 4); pure modules + unit tests (Tasks 1–3); standalone-harness + screenshot sign-off + in-app verify (Tasks 5–7); export reuse (Task 7). All covered.
- **Placeholder scan:** no TBD/TODO; all code steps contain full code. The one "fallback" note (type tinting) is an explicit conditional with the alternative spelled out, not a placeholder.
- **Type consistency:** `mulberry32`/`hashSeed` (Task 1) used by Tasks 2–4; `TypeColorMode`, `stripOffsets`/`segmentRow`/`bandLayout`/`scaleXForGlitch`/`pickTypeColor`/`revealGlitch`/`churnSeed` signatures match between Task 2 definitions and Task 4 calls; `doodleField`/`DOODLE_KINDS`/`Doodle` (Task 3) match Task 4 usage; `sliceGlitchEffect` id/controls match the contract test (Task 4 Step 1).
```
