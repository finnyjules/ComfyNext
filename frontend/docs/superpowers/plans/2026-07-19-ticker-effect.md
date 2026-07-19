# Ticker effect + transparent colors — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `ticker` Space Type effect — flat 2D rows of text marqueeing along an optionally wavy path with undistorted glyphs — and extend Type Studio color pickers to carry alpha.

**Architecture:** A new `tickerGeometry.ts` builds a band in the XY plane, swept along the in-plane normal, with arc-length-parameterized UVs so glyphs are not stretched through bends. A new `effects/ticker.ts` implements the existing `SpaceTypeEffect` plugin contract and is registered in `effects/index.ts` — no engine or surface changes are needed for the effect itself. Alpha is added as an 8-digit hex extension in `lib/color/convert.ts`, surfaced in `StudioColor.vue`, and honored by `fills.ts` for Ticker's band.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Three.js, Vitest.

**Spec:** `frontend/docs/superpowers/specs/2026-07-18-ticker-effect-design.md`

## Global Constraints

- All paths below are relative to `frontend/`. The repo root is `/Users/julien/Documents/GitHub/Sailor`.
- Run tests with `npx vitest run <path>` from `frontend/`.
- **Parallel sessions are active.** Many files are already modified by other sessions. Stage only the exact files listed in each task's commit step — never `git add -A`, never `git stash`.
- Commits go direct to `main`, matching this repo's convention.
- Every `ControlSpec.group` MUST be a member of `SPACE_TYPE_SECTIONS` (`app/lib/spacetype/sections.ts:9`) or the control is silently dropped from the UI with no error.
- 6-digit hex remains valid everywhere and means fully opaque. Never emit 8-digit hex when alpha is 1.
- `app/lib/spacetype/ribbonGeometry.ts` and `app/lib/spacetype/effects/ribbon.ts` are NOT modified by this plan.

---

### Task 1: Alpha-aware hex primitives

Pure functions only. No Vue, no THREE. This is the foundation both `StudioColor` and `fills` build on.

**Files:**
- Modify: `app/lib/color/convert.ts` (append; do not alter existing exports)
- Test: `tests/unit/color-alpha.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `clampHex` from `app/lib/color/convert.ts:5`
- Produces:
  - `isHexA(s: string): boolean`
  - `parseHexA(hex: string): { hex: string; alpha: number }` — `hex` is always 6-digit `#rrggbb`, `alpha` is 0–1
  - `withAlpha(hex: string, alpha: number): string` — returns `#rrggbb` when alpha >= 1, else `#rrggbbaa`
  - `stripAlpha(hex: string): string` — 6-digit `#rrggbb`, for handing to `THREE.Color`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/color-alpha.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isHexA, parseHexA, withAlpha, stripAlpha } from '~/lib/color/convert'

describe('isHexA', () => {
  it('accepts 8-digit hex', () => {
    expect(isHexA('#ff000080')).toBe(true)
    expect(isHexA('ff000080')).toBe(true)
  })
  it('rejects 6-digit and garbage', () => {
    expect(isHexA('#ff0000')).toBe(false)
    expect(isHexA('#ff00008')).toBe(false)
    expect(isHexA('nope')).toBe(false)
  })
})

describe('parseHexA', () => {
  it('treats 6-digit as fully opaque', () => {
    expect(parseHexA('#3366ff')).toEqual({ hex: '#3366ff', alpha: 1 })
  })
  it('splits 8-digit into rgb and alpha', () => {
    const r = parseHexA('#3366ff00')
    expect(r.hex).toBe('#3366ff')
    expect(r.alpha).toBe(0)
  })
  it('parses ff alpha as exactly 1', () => {
    expect(parseHexA('#3366ffff').alpha).toBe(1)
  })
  it('parses 80 alpha as approximately half', () => {
    expect(parseHexA('#3366ff80').alpha).toBeCloseTo(0.502, 3)
  })
  it('falls back to opaque black on garbage', () => {
    expect(parseHexA('nope')).toEqual({ hex: '#000000', alpha: 1 })
  })
})

describe('withAlpha', () => {
  it('emits 6-digit when fully opaque', () => {
    expect(withAlpha('#3366ff', 1)).toBe('#3366ff')
  })
  it('emits 8-digit when translucent', () => {
    expect(withAlpha('#3366ff', 0)).toBe('#3366ff00')
    expect(withAlpha('#3366ff', 0.502)).toBe('#3366ff80')
  })
  it('clamps out-of-range alpha', () => {
    expect(withAlpha('#3366ff', 2)).toBe('#3366ff')
    expect(withAlpha('#3366ff', -1)).toBe('#3366ff00')
  })
  it('round-trips through parseHexA', () => {
    const out = withAlpha('#12ab34', 0.25)
    const back = parseHexA(out)
    expect(back.hex).toBe('#12ab34')
    expect(back.alpha).toBeCloseTo(0.25, 2)
  })
  it('ignores alpha already present on the input', () => {
    expect(withAlpha('#3366ff00', 1)).toBe('#3366ff')
  })
})

describe('stripAlpha', () => {
  it('drops the alpha pair', () => {
    expect(stripAlpha('#3366ff80')).toBe('#3366ff')
  })
  it('passes 6-digit through', () => {
    expect(stripAlpha('#3366ff')).toBe('#3366ff')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/color-alpha.unit.spec.ts`
Expected: FAIL — `isHexA is not a function` (or an import resolution error naming the missing exports).

- [ ] **Step 3: Write the implementation**

Append to `app/lib/color/convert.ts`:

```ts
/** True when `s` is a complete 8-digit hex colour with alpha (`#` optional). */
export function isHexA(s: string): boolean {
  return /^#?[0-9a-fA-F]{8}$/.test(String(s).trim())
}

/** Split any hex form into an opaque 6-digit hex plus a 0–1 alpha.
 *  6-digit input is fully opaque; garbage falls back to opaque black. */
export function parseHexA(hex: string): { hex: string; alpha: number } {
  const x = String(hex).trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{8}$/.test(x)) {
    return { hex: '#' + x.slice(0, 6).toLowerCase(), alpha: parseInt(x.slice(6, 8), 16) / 255 }
  }
  return { hex: clampHex(x), alpha: 1 }
}

/** Attach alpha to a hex colour. Emits 6-digit when fully opaque so saved scenes
 *  stay in the legacy form and diffs stay small. Any alpha already on `hex` is replaced. */
export function withAlpha(hex: string, alpha: number): string {
  const base = parseHexA(hex).hex
  const a = Math.max(0, Math.min(1, Number(alpha)))
  if (a >= 1) return base
  return base + Math.round(a * 255).toString(16).padStart(2, '0')
}

/** Drop any alpha — THREE.Color cannot parse 8-digit hex and silently renders black. */
export function stripAlpha(hex: string): string {
  return parseHexA(hex).hex
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/color-alpha.unit.spec.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/color/convert.ts frontend/tests/unit/color-alpha.unit.spec.ts
git commit -m "feat(color): add alpha-aware hex primitives"
```

---

### Task 2: Ticker geometry

The core of the feature. Pure math, no THREE import — testable in isolation.

**Files:**
- Create: `app/lib/spacetype/tickerGeometry.ts`
- Test: `tests/unit/ticker-geometry.unit.spec.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface TickerGeoParams { segments: number; length: number; amplitude: number; frequency: number; phase: number; height: number; uRepeat: number }`
  - `tickerPoint(t: number, p: TickerGeoParams): { x: number; y: number }`
  - `maxAmplitude(frequency: number, length: number, height: number): number`
  - `buildTickerGeometryData(p: TickerGeoParams): TickerGeoData` where
    `interface TickerGeoData { positions: Float32Array; uvs: Float32Array; indices: Uint32Array; arcLength: number; uRepeatEffective: number }`

Note on `phase`: the caller bakes the travelling-wave term in (`phase = rowPhase + waveSpeed * t01 * TAU`). This module is time-agnostic.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ticker-geometry.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tickerPoint, maxAmplitude, buildTickerGeometryData, type TickerGeoParams } from '~/lib/spacetype/tickerGeometry'

const base: TickerGeoParams = {
  segments: 240, length: 100, amplitude: 0, frequency: 2, phase: 0, height: 10, uRepeat: 4,
}

describe('tickerPoint', () => {
  it('spans length centered on the origin', () => {
    expect(tickerPoint(0, base).x).toBeCloseTo(-50, 6)
    expect(tickerPoint(1, base).x).toBeCloseTo(50, 6)
  })
  it('is flat when amplitude is zero', () => {
    expect(tickerPoint(0.37, base).y).toBe(0)
  })
  it('waves with amplitude and frequency', () => {
    const p = { ...base, amplitude: 5, frequency: 1 }
    expect(tickerPoint(0.25, p).y).toBeCloseTo(5, 6)
    expect(tickerPoint(0.75, p).y).toBeCloseTo(-5, 6)
  })
  it('shifts with phase', () => {
    const p = { ...base, amplitude: 5, frequency: 1, phase: Math.PI / 2 }
    expect(tickerPoint(0, p).y).toBeCloseTo(5, 6)
  })
})

describe('maxAmplitude', () => {
  it('shrinks as frequency rises', () => {
    expect(maxAmplitude(4, 100, 10)).toBeLessThan(maxAmplitude(1, 100, 10))
  })
  it('shrinks as the band gets taller', () => {
    expect(maxAmplitude(2, 100, 40)).toBeLessThan(maxAmplitude(2, 100, 10))
  })
  it('is positive for sane inputs', () => {
    expect(maxAmplitude(2, 100, 10)).toBeGreaterThan(0)
  })
})

describe('buildTickerGeometryData', () => {
  it('emits two verts per sample and six indices per segment', () => {
    const g = buildTickerGeometryData({ ...base, segments: 10 })
    expect(g.positions.length).toBe(11 * 2 * 3)
    expect(g.uvs.length).toBe(11 * 2 * 2)
    expect(g.indices.length).toBe(10 * 6)
  })

  it('is flat in Z — the band lives in the XY plane', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6 })
    for (let i = 2; i < g.positions.length; i += 3) expect(g.positions[i]).toBe(0)
  })

  it('arc length equals straight length when flat', () => {
    const g = buildTickerGeometryData(base)
    expect(g.arcLength).toBeCloseTo(100, 4)
  })

  it('arc length exceeds straight length when wavy', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6 })
    expect(g.arcLength).toBeGreaterThan(100)
  })

  it('scales uRepeat by the arc-length ratio and keeps it fractional', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6 })
    expect(g.uRepeatEffective).toBeCloseTo(4 * (g.arcLength / 100), 6)
    expect(Number.isInteger(g.uRepeatEffective)).toBe(false)
  })

  it('holds band width constant around bends', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6, segments: 400 })
    const n = g.positions.length / 3
    for (let i = 0; i < n; i += 2) {
      const dx = g.positions[i * 3] - g.positions[(i + 1) * 3]
      const dy = g.positions[i * 3 + 1] - g.positions[(i + 1) * 3 + 1]
      expect(Math.hypot(dx, dy)).toBeCloseTo(10, 3)
    }
  })

  it('emits monotonically increasing u', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6 })
    for (let i = 2; i < g.uvs.length; i += 4) expect(g.uvs[i]).toBeGreaterThan(g.uvs[i - 4])
  })

  it('spaces u uniformly in ARC LENGTH, not in t — the anti-distortion property', () => {
    const g = buildTickerGeometryData({ ...base, amplitude: 6, segments: 600 })
    const n = g.positions.length / 3
    let minR = Infinity, maxR = -Infinity
    for (let i = 0; i < n - 2; i += 2) {
      const dx = g.positions[(i + 2) * 3] - g.positions[i * 3]
      const dy = g.positions[(i + 2) * 3 + 1] - g.positions[i * 3 + 1]
      const seg = Math.hypot(dx, dy)
      const du = g.uvs[(i + 2) * 2] - g.uvs[i * 2]
      const ratio = du / seg
      if (ratio < minR) minR = ratio
      if (ratio > maxR) maxR = ratio
    }
    expect(maxR / minR).toBeLessThan(1.01)
  })

  it('runs v across the band', () => {
    const g = buildTickerGeometryData(base)
    expect(g.uvs[1]).toBe(1)
    expect(g.uvs[3]).toBe(0)
  })

  it('clamps amplitude past the self-intersection limit', () => {
    const wild = { ...base, amplitude: 1e6, segments: 400 }
    const g = buildTickerGeometryData(wild)
    const capped = buildTickerGeometryData({ ...wild, amplitude: maxAmplitude(wild.frequency, wild.length, wild.height) })
    expect(g.arcLength).toBeCloseTo(capped.arcLength, 6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ticker-geometry.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/spacetype/tickerGeometry`.

- [ ] **Step 3: Write the implementation**

Create `app/lib/spacetype/tickerGeometry.ts`:

```ts
const TAU = Math.PI * 2

/**
 * Geometry for the Ticker effect: a flat band in the XY plane whose centreline is a sine,
 * swept along the IN-PLANE normal, with UVs parameterised by ARC LENGTH.
 *
 * Deliberately NOT ribbonGeometry.ts. Ribbon sweeps its band along world Z (edge-on in depth)
 * and maps u uniformly in the curve parameter t, so glyphs stretch through bends and bunch on
 * straights. Ticker fixes both: the band faces camera, and equal arc length gets equal u, so a
 * glyph occupies the same physical run of band on a curve as on a straight.
 */
export interface TickerGeoParams {
  segments: number
  length: number
  amplitude: number
  frequency: number
  /** Caller bakes the travelling-wave term in: rowPhase + waveSpeed * t01 * TAU. */
  phase: number
  height: number
  /** Repeats across the STRAIGHT length. Scaled up by the arc-length ratio in the output. */
  uRepeat: number
}

export interface TickerGeoData {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  arcLength: number
  /** uRepeat * (arcLength / length). Deliberately fractional — see the spec: the remainder
   *  truncates at the band's END, where glyphs already scroll out of view. */
  uRepeatEffective: number
}

/** Centreline point at t in [0,1]. z is always 0 — this is a 2D path by construction. */
export function tickerPoint(t: number, p: TickerGeoParams): { x: number; y: number } {
  return {
    x: (t - 0.5) * p.length,
    y: p.amplitude * Math.sin(TAU * p.frequency * t + p.phase),
  }
}

/**
 * Largest amplitude before the band self-intersects on a bend.
 *
 * For y = A·sin(kx) the peak curvature is A·k², so the centre of curvature sits 1/(A·k²) away.
 * The inner edge folds through itself once that radius drops below the band's half-height, so
 * the limit is A < 2/(k²·h). Clamping is deliberate: a miter-joint solver is out of scope.
 */
export function maxAmplitude(frequency: number, length: number, height: number): number {
  const k = (TAU * frequency) / Math.max(1e-6, length)
  return 2 / Math.max(1e-9, k * k * Math.max(1e-6, height))
}

export function buildTickerGeometryData(p: TickerGeoParams): TickerGeoData {
  const n = Math.max(1, Math.floor(p.segments))
  const amp = Math.min(Math.abs(p.amplitude), maxAmplitude(p.frequency, p.length, p.height))
  const q: TickerGeoParams = { ...p, amplitude: Math.sign(p.amplitude || 1) * amp }

  const pts: { x: number; y: number }[] = []
  const cum = new Float64Array(n + 1)
  for (let i = 0; i <= n; i++) {
    const c = tickerPoint(i / n, q)
    pts.push(c)
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(c.x - pts[i - 1]!.x, c.y - pts[i - 1]!.y)
  }
  const arcLength = cum[n]!
  const uRepeatEffective = p.uRepeat * (arcLength / Math.max(1e-6, p.length))

  const verts = (n + 1) * 2
  const positions = new Float32Array(verts * 3)
  const uvs = new Float32Array(verts * 2)
  const half = p.height / 2

  for (let i = 0; i <= n; i++) {
    // Central difference for the tangent so interior normals don't lag half a segment.
    const prev = pts[Math.max(0, i - 1)]!
    const next = pts[Math.min(n, i + 1)]!
    const tx = next.x - prev.x
    const ty = next.y - prev.y
    const len = Math.hypot(tx, ty) || 1
    // In-plane normal — this is what keeps band width constant around bends.
    const nx = -(ty / len) * half
    const ny = (tx / len) * half

    const c = pts[i]!
    const a = i * 2, b = i * 2 + 1
    positions[a * 3] = c.x + nx; positions[a * 3 + 1] = c.y + ny; positions[a * 3 + 2] = 0
    positions[b * 3] = c.x - nx; positions[b * 3 + 1] = c.y - ny; positions[b * 3 + 2] = 0

    const u = (cum[i]! / Math.max(1e-9, arcLength)) * uRepeatEffective
    uvs[a * 2] = u; uvs[a * 2 + 1] = 1
    uvs[b * 2] = u; uvs[b * 2 + 1] = 0
  }

  const indices = new Uint32Array(n * 6)
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1
    const o = i * 6
    indices[o] = a; indices[o + 1] = b; indices[o + 2] = c
    indices[o + 3] = c; indices[o + 4] = b; indices[o + 5] = d
  }

  return { positions, uvs, indices, arcLength, uRepeatEffective }
}

/** Per-row placement: centred Y stack, phase offset, alternating scroll direction.
 *  Mirrors ribbonInstance's contract so the two effects behave predictably alike. */
export interface TickerRowParams { count: number; spacing: number; offset: number; alternate: boolean }
export interface TickerRow { y: number; phase: number; dir: 1 | -1 }

export function tickerRow(i: number, p: TickerRowParams): TickerRow {
  const n = Math.max(1, Math.floor(p.count))
  const center = (n - 1) / 2
  return {
    y: (i - center) * p.spacing,
    phase: i * p.offset * TAU,
    dir: p.alternate && i % 2 === 1 ? -1 : 1,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/ticker-geometry.unit.spec.ts`
Expected: PASS, 15 tests.

If the arc-length-uniformity test fails with a ratio just above 1.01, raise `segments` in that test rather than loosening the bound — the property is exact in the limit and the tolerance is measuring discretization.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/tickerGeometry.ts frontend/tests/unit/ticker-geometry.unit.spec.ts
git commit -m "feat(spacetype): add ticker geometry with arc-length UVs"
```

---

### Task 3: Alpha-aware fills

`THREE.Color` cannot parse 8-digit hex — it renders black. Every fill path that hands a raw hex to THREE or to a 2D canvas must strip alpha first, and the alpha must be recoverable separately.

**Files:**
- Modify: `app/lib/spacetype/fillTile.ts` (`hexBytes`)
- Modify: `app/lib/spacetype/fills.ts` (`fillPrimary`, add `fillAlpha`)
- Test: `tests/unit/fill-alpha.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `parseHexA`, `stripAlpha` from Task 1.
- Produces: `fillAlpha(fill: Fill): number` exported from `app/lib/spacetype/fills.ts`.

- [ ] **Step 1: Read the current implementations**

Read `app/lib/spacetype/fillTile.ts` and locate `hexBytes`. Read `app/lib/spacetype/fills.ts:16-18` (`fillPrimary`). Confirm the exact current bodies before editing — do not assume.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/fill-alpha.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { fillPrimary, fillAlpha } from '~/lib/spacetype/fills'
import { hexBytes, DEFAULT_FILL, type Fill } from '~/lib/spacetype/fillTile'

const solid = (a: string): Fill => ({ ...DEFAULT_FILL, type: 'solid', a })

describe('fillAlpha', () => {
  it('is 1 for a legacy 6-digit fill', () => {
    expect(fillAlpha(solid('#ff0000'))).toBe(1)
  })
  it('reads alpha from an 8-digit fill', () => {
    expect(fillAlpha(solid('#ff000000'))).toBe(0)
    expect(fillAlpha(solid('#ff000080'))).toBeCloseTo(0.502, 3)
  })
})

describe('fillPrimary', () => {
  it('ignores alpha and returns the rgb — THREE.Color renders 8-digit hex as black', () => {
    const withA = fillPrimary(THREE, solid('#ff000080'))
    const without = fillPrimary(THREE, solid('#ff0000'))
    expect(withA.getHex()).toBe(without.getHex())
    expect(withA.getHex()).toBe(0xff0000)
  })
})

describe('hexBytes', () => {
  it('returns rgb bytes for 8-digit input rather than falling back to black', () => {
    expect(Array.from(hexBytes('#ff000080')).slice(0, 3)).toEqual([255, 0, 0])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/unit/fill-alpha.unit.spec.ts`
Expected: FAIL — `fillAlpha` is not exported, and the `fillPrimary` assertion returns `0x000000`.

- [ ] **Step 4: Implement**

In `app/lib/spacetype/fills.ts`, add the import and replace `fillPrimary`:

```ts
import { parseHexA, stripAlpha } from '~/lib/color/convert'

/** The fill's primary colour — used for solid fills and for cross-row gradient-mode lerps.
 *  Alpha is stripped: THREE.Color has no alpha channel and silently renders 8-digit hex black.
 *  Read the alpha separately with fillAlpha(). */
export function fillPrimary(three: typeof THREE, fill: Fill): THREE.Color {
  return new three.Color(stripAlpha(fill.a))
}

/** The fill's alpha, 0–1. Legacy 6-digit fills are fully opaque. */
export function fillAlpha(fill: Fill): number {
  return parseHexA(fill.a).alpha
}
```

In `app/lib/spacetype/fillTile.ts`, make `hexBytes` tolerate 8-digit input by stripping the alpha pair before parsing. Keep its existing return shape and its existing fallback behavior for genuinely invalid input — only the 8-digit case changes.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/unit/fill-alpha.unit.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the surrounding suites for regressions**

Run: `npx vitest run tests/unit/color-alpha.unit.spec.ts tests/unit/fill-alpha.unit.spec.ts tests/unit/spacetype-sections.unit.spec.ts`
Then: `npx vitest run tests/unit --silent 2>&1 | tail -20`
Expected: no NEW failures versus the pre-existing baseline. This repo has a known non-zero baseline — compare, don't assume green.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/spacetype/fills.ts frontend/app/lib/spacetype/fillTile.ts frontend/tests/unit/fill-alpha.unit.spec.ts
git commit -m "feat(spacetype): make fills alpha-aware"
```

---

### Task 4: The Ticker effect

**Files:**
- Create: `app/lib/spacetype/effects/ticker.ts`
- Modify: `app/lib/spacetype/effects/index.ts` (import + array entry)
- Test: `tests/unit/ticker-effect.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `buildTickerGeometryData`, `tickerRow`, `TickerGeoParams` (Task 2); `fillAlpha` (Task 3); `scrollOffset` from `app/lib/spacetype/ribbonGeometry.ts:97` (imported, not modified); `parseFills`, `fillShaderTexture`, `fillTiling` from `fills.ts`; `defaultFillsFor` from `palette.ts`; `textVariantForBand` from `ribbonGeometry.ts`.
- Produces: `tickerEffect: SpaceTypeEffect` with `id: 'ticker'`.

**Reference implementation:** `app/lib/spacetype/effects/stripes.ts` is the closest existing analogue (flat quads, per-row scroll, fill shader). Read it in full before writing this task. Follow its material and update structure; substitute Ticker's geometry.

**Control list** — every `group` below is already in `SPACE_TYPE_SECTIONS`:

```ts
const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'textList', default: 'Sailor', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Inter', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 180, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  { key: 'textRepeat', label: 'Text repeat', kind: 'slider', min: 1, max: 16, step: 1, default: 4, group: 'Type' },
  { key: 'bandHeight', label: 'Band height', kind: 'slider', min: 0.3, max: 3, step: 0.05, default: 1, group: 'Ribbon' },
  { key: 'bandLength', label: 'Band length', kind: 'slider', min: 8, max: 36, step: 0.5, default: 20, group: 'Ribbon' },
  { key: 'rowCount', label: 'Rows', kind: 'slider', min: 1, max: 12, step: 1, default: 3, group: 'Ribbon' },
  { key: 'rowSpacing', label: 'Row spacing', kind: 'slider', min: 0.4, max: 4, step: 0.05, default: 1.4, group: 'Ribbon' },
  { key: 'rowPhase', label: 'Row phase', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0, group: 'Ribbon' },
  { key: 'alternate', label: 'Alternate', kind: 'select', options: ['on', 'off'], default: 'on', group: 'Ribbon' },
  { key: 'segments', label: 'Segments', kind: 'slider', min: 16, max: 400, step: 2, default: 160, group: 'Wave' },
  { key: 'waveAmplitude', label: 'Wave amount', kind: 'slider', min: 0, max: 6, step: 0.05, default: 0, group: 'Wave' },
  { key: 'waveFrequency', label: 'Wave freq', kind: 'slider', min: 0.5, max: 5, step: 0.1, default: 1.5, group: 'Wave' },
  { key: 'waveSpeed', label: 'Wave speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0, group: 'Wave' },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.6, group: 'Motion' },
  { key: 'fills', label: 'Fills', kind: 'fillList', default: defaultFillsFor(1, 'ribbon'), group: 'Color' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]
```

Defaults are deliberately flat and face-on (`waveAmplitude: 0`, `rotateX: 0`, `rowCount: 3`) — this is the 2D reading that ribbon's defaults bury.

**Behavioral requirements:**

- Module-level row state follows the existing house pattern (`let rows = []`, populated in `buildScene`, read in `update`) — matching `ribbon.ts:48` and `stripes.ts:44`. The single-active-engine caveat documented at `ribbon.ts:45-47` applies equally; carry the same comment.
- `liveKeys: ['waveSpeed', 'rotateX', 'rotateY', 'rotateZ']` — `waveSpeed` only shifts the phase uniform, so it must not force a rebuild. `waveAmplitude` and `waveFrequency` DO change geometry, so they stay structural.
- Because `waveSpeed` deforms geometry per-frame, `update()` must rebuild each row's position attribute when `waveSpeed !== 0` and skip that work entirely when it is 0. Do not rebuild geometry every frame unconditionally.
- Band material uses `transparent: true` and `opacity` set from `fillAlpha(fill)`, with `depthWrite` set to `false` when alpha < 1 so translucent rows don't occlude each other. At alpha 0 the band vanishes and only glyphs remain — this is the text-only mode from the spec.
- `loopRates(params)` returns the per-row scroll rates via `loopTiles(speed, uRepeatEffective)`, plus `waveSpeed` when non-zero, so seamless export covers both motions.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/ticker-effect.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tickerEffect } from '~/lib/spacetype/effects/ticker'
import { getEffect, SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects'
import { SPACE_TYPE_SECTIONS } from '~/lib/spacetype/sections'
import { defaultsFromControls } from '~/lib/spacetype/effect'

describe('ticker registration', () => {
  it('is registered and resolvable by id', () => {
    expect(getEffect('ticker').id).toBe('ticker')
    expect(SPACE_TYPE_EFFECTS).toContain(tickerEffect)
  })
  it('is not hidden', () => {
    expect(tickerEffect.hidden).toBeFalsy()
  })
  it('resolves case-insensitively', () => {
    expect(getEffect('Ticker').id).toBe('ticker')
  })
})

describe('ticker controls', () => {
  it('only uses groups the panel can render', () => {
    for (const c of tickerEffect.controls) {
      expect(SPACE_TYPE_SECTIONS).toContain(c.group)
    }
  })
  it('defaults to a flat face-on ticker', () => {
    const d = defaultsFromControls(tickerEffect.controls)
    expect(d.waveAmplitude).toBe(0)
    expect(d.rotateX).toBe(0)
    expect(d.rowCount).toBe(3)
  })
  it('declares waveSpeed live but wave shape structural', () => {
    expect(tickerEffect.liveKeys).toContain('waveSpeed')
    expect(tickerEffect.liveKeys).not.toContain('waveAmplitude')
    expect(tickerEffect.liveKeys).not.toContain('waveFrequency')
  })
})

describe('ticker loopRates', () => {
  it('reports whole-cycle rates for the scroll', () => {
    const d = defaultsFromControls(tickerEffect.controls)
    const rates = tickerEffect.loopRates!(d)
    expect(rates.length).toBeGreaterThan(0)
    for (const r of rates) expect(Number.isFinite(r)).toBe(true)
  })
  it('includes the wave rate once waveSpeed is non-zero', () => {
    const d = defaultsFromControls(tickerEffect.controls)
    const still = tickerEffect.loopRates!({ ...d, waveSpeed: 0 })
    const moving = tickerEffect.loopRates!({ ...d, waveSpeed: 2 })
    expect(moving).toContain(2)
    expect(still).not.toContain(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ticker-effect.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/spacetype/effects/ticker`.

- [ ] **Step 3: Implement the effect**

Create `app/lib/spacetype/effects/ticker.ts` following `stripes.ts`'s structure with the control list above and the behavioral requirements above. Then register it in `app/lib/spacetype/effects/index.ts` — add `import { tickerEffect } from './ticker'` alongside the other imports, and add `tickerEffect,` to the `SPACE_TYPE_EFFECTS` array immediately after `stripesEffect` (grouping it with the other band-based effects rather than appending to the end).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/ticker-effect.unit.spec.ts tests/unit/spacetype-sections.unit.spec.ts`
Expected: PASS. The sections test must stay green — it iterates every registered effect, so Ticker is now covered by it automatically.

- [ ] **Step 5: Typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | tail -5`
Expected: error count at or below the known baseline of ~328. If it rose, the new files introduced errors — fix them.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/effects/ticker.ts frontend/app/lib/spacetype/effects/index.ts frontend/tests/unit/ticker-effect.unit.spec.ts
git commit -m "feat(spacetype): add Ticker effect"
```

---

### Task 5: Alpha in the color picker

**Files:**
- Modify: `app/components/vue-canvas/StudioColor.vue`
- Test: manual, in the running app (this is a Vue SFC with no existing unit coverage; do not scaffold a new component-test harness for it)

**Interfaces:**
- Consumes: `parseHexA`, `withAlpha`, `isHexA` from Task 1, imported via the existing `./color` re-export (`app/components/vue-canvas/studio/color.ts`), NOT directly from `~/lib/color/convert` — keep the established import boundary.

- [ ] **Step 1: Read the component**

Read `app/components/vue-canvas/studio/StudioColor.vue` in full (190 lines). Identify how the current value flows in and out, and where the swatch is rendered.

- [ ] **Step 2: Add the alpha control**

Extend the component so that:
- The incoming `modelValue` is split with `parseHexA` — existing 6-digit values behave exactly as today.
- An alpha slider (0–100) sits below the existing controls, emitting `withAlpha(hex, alpha / 100)`.
- The swatch renders over a CSS checkerboard so translucency is visible.
- A "Transparent" button sets alpha to 0 in one click.
- Typed hex input accepts 8-digit as well as 6-digit — the existing `isHex` guard must be widened to `isHex(s) || isHexA(s)` so a half-typed 8-digit value is rejected rather than clamped to black.

Keep every existing behavior intact: when alpha is 1 the component must emit plain 6-digit hex, byte-identical to what it emits today.

- [ ] **Step 3: Verify in the running app**

Start the dev server and drive it — do not assert this works from reading the diff.

Per the project's dev notes, use `127.0.0.1`, not `localhost`.

1. Open Type Studio, select the Ticker effect.
2. Confirm the panel shows the Type / Ribbon / Wave / Motion / Color / Transform sections and that `Rows`, `Wave amount`, and `Wave speed` all appear. A missing control means its `group` is not in `SPACE_TYPE_SECTIONS`.
3. With `Wave amount` at 0, confirm a flat multi-row ticker with alternating scroll direction.
4. Raise `Wave amount`. Confirm glyphs ride the curve at constant size and are NOT stretched through the bends. This is the whole point of the feature — look closely at the steepest part of the curve.
5. Raise `Wave speed`. Confirm the curve travels while text scrolls.
6. In the Color section, drop the band fill's alpha to 0. Confirm the band disappears and only glyphs remain.
7. Reload the page. Confirm the alpha survives the round-trip.

Capture a screenshot of step 4 and step 6.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/studio/StudioColor.vue
git commit -m "feat(studio): add alpha to the color picker"
```

---

## Known limitations carried forward

These are deliberate and documented in the spec. Do not "fix" them in this plan.

- **Node-card preview ignores `loopRates`.** `app/components/vue-canvas/SpaceTypeNode.vue:101` renders a single loop with no `k` factor, so a Ticker with a non-zero `waveSpeed` may stutter on the node card while looping correctly in the Type Studio modal and the timeline.
- **`SpaceTypeNode.bakeOutput` skips post/projection/pan.** `SpaceTypeNode.vue:157-160` omits `setPost`/`setProjection`/`setPan`, so a cascade bake silently drops bloom and isometric projection. Pre-existing, affects all effects.
- **Alpha renders only where converted.** The picker will show a live alpha slider on every `color` control across all 24 effects, but only Ticker's band fill and other converted materials actually render it. Elsewhere alpha is stored, round-trips through save/load, and renders opaque.
- **Module-level effect state.** `ticker.ts` follows the existing single-active-engine pattern. Two concurrent engines rendering Ticker (a node-card preview plus an open modal) will clash, exactly as ribbon and stripes already do.

## Self-review notes

- Spec coverage: geometry (Task 2), rows and motion (Task 4), controls and sections guard (Task 4), fractional `uRepeat` (Task 2, asserted non-integer), alpha format and picker (Tasks 1, 3, 5), band-fill alpha (Tasks 3, 4). All spec sections map to a task.
- Type consistency: `TickerGeoParams` / `TickerGeoData` / `tickerRow` names are used identically in Tasks 2 and 4. `fillAlpha` is defined in Task 3 and consumed in Task 4. `parseHexA` / `withAlpha` / `stripAlpha` / `isHexA` are defined in Task 1 and consumed in Tasks 3 and 5.
- Task 5 has no unit test by design — it is a Vue SFC with no existing component-test harness, so it is gated on driving the real app instead.
