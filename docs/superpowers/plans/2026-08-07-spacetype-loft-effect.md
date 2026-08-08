# Space Type — Loft Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Space Type effect, **Loft**, that sweeps a keyframed cross-section (a parametric shape OR a word's glyph outlines) along an editable 3D bezier "spine" defined by a list of rich "stops", rendered as either stroked outlines or a solid skinned surface with a gradient running along the sweep.

**Architecture:** A pure, node-testable geometry core (`loftStops.ts` + `loftGeometry.ts`) does all the maths — spine sampling, per-stop property interpolation, cross-section contour generation, and the vertex/index/`aAlong` buffers. A thin effect module (`effects/loft.ts`) wraps that core in THREE objects (a `ShaderMaterial` that samples a stop-colour ramp by an `aAlong` attribute offset by a `uFlow` uniform), following the `blend.ts` template exactly (per-scene state on `root.userData`, synchronous `buildScene`, `update`/`liveKeys`/`loopRates`). A new `profileStops` `ControlSpec` kind plus a `ProfileStopsEditor.vue` component provides the editing UI, modelled on the `CurveEditor` `modelValue: string` (JSON) contract. Word mode reuses `scene3d/outlines.ts::textOutline`, with the host pre-warming the font cache (the `imageTextures` prefetch pattern) so `buildScene` can read it synchronously via `fontCacheGet`.

**Tech Stack:** Nuxt 4, Vue 3.5, TypeScript, three.js, Vitest (`environment: 'node'`, `happy-dom` opt-in per file).

## Global Constraints

- **Frontend cwd for all commands:** `frontend/`. Unit test command: `npm run test:unit` (= `vitest run`); single file: `npx vitest run tests/unit/<file>.unit.spec.ts`.
- **Unit tests are node-env and network-free.** Geometry/maths run in plain node (no DOM). Font-outline tests load the checked-in fixture `frontend/tests/fixtures/inter-subset-var.ttf` — never the network. Files needing `document`/canvas add the top pragma `// @vitest-environment happy-dom`.
- **`buildScene` MUST be synchronous** — no `await` anywhere in it (the engine's `withShaderFillContext` re-entrancy guard at `engine.ts:243-248` throws on overlap). Async work (font loading) happens in the host before the build.
- **Per-scene state lives on `root.userData`, never module-level vars** (concurrent engines + cached roots — see `blend.ts:53-59`).
- **`stripAlpha(hex)` before every `new THREE.Color(hex)`** where the hex may carry alpha. 8-digit hex silently renders **white** (`color/convert.ts:176`). `StudioColor` emits 8-digit `#rrggbbaa` once its alpha track is touched.
- **Effect id is `loft`** (must not collide with the existing `blend` at `effects/blend.ts:106`; `getEffect` is case-insensitive).
- **A control's `group` must be a section name in `frontend/app/lib/spacetype/sections.ts:11-24`** or it is silently dropped (a unit test guards this). Confirm the exact names in that file before writing controls; this plan assumes `'Layout'`, `'Style'`, `'Color'`, `'Motion'`, `'Transform'` exist (as used by `blend.ts`/`ring.ts`) and uses only those.
- **Stops are addressed by their stable `id`, never by positional index** (reorder/removal re-points indices silently).
- **Typecheck baseline:** the repo has a known pre-existing `vue-tsc` error count (~328). A task only regresses typecheck if it *introduces* an error naming a type this feature added. Run `npx vue-tsc --noEmit` sparingly; judge against the baseline, not zero.

---

## File structure

**Create:**
- `frontend/app/lib/spacetype/loftStops.ts` — `LoftStop` type, JSON (de)serialization, `presetStops`, `DEFAULT_STOPS`. Pure.
- `frontend/app/lib/spacetype/loftGeometry.ts` — spine sampling, property interpolation, cross-section contours, `buildLoftGeometry`, `buildRamp`. Pure.
- `frontend/app/lib/spacetype/effects/loft.ts` — the `SpaceTypeEffect`. THREE glue only.
- `frontend/app/components/vue-canvas/ProfileStopsEditor.vue` — the stops editor UI.
- `frontend/tests/unit/spacetype-loft-stops.unit.spec.ts`
- `frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts`
- `frontend/tests/unit/spacetype-loft-effect.unit.spec.ts`
- `frontend/tests/unit/spacetype-loft-word.unit.spec.ts`

**Modify:**
- `frontend/app/lib/spacetype/effect.ts:49-84` — add the `profileStops` union member.
- `frontend/app/lib/spacetype/effects/index.ts:2-27,30-57` — import + register `loftEffect`.
- `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — import + render `ProfileStopsEditor` (~line 36 import, ~line 1776 render branch); word-mode font prefetch + rebuild.
- Whatever module defines `controlKindToVariableType` (search; likely `frontend/app/composables/useStudioVarBindings.ts` or `useStudioVarMenu.ts`) — return `null` for `'profileStops'`.
- `frontend/app/lib/spacetype/controlDescriptor.ts` — mark `profileStops` non-AI-editable (or omit from the AI union) so the copilot doesn't try to patch a JSON blob.

---

## Shared type signatures (used across tasks)

These are the exact names/types later tasks rely on. Define them in Task 1/2 verbatim.

```ts
// loftStops.ts
export type SpinePreset = 'custom' | 'helix' | 'wave' | 'arch' | 's-curve' | 'loop'
export interface LoftStop {
  id: string
  x: number; y: number; z: number          // x,y in 0..1 (curve-editor canvas); z in -1..1 (depth)
  width: number; height: number             // profile scale, >0
  radius: number                            // corner radius 0..1
  sides: number                             // 3..64 (high → ellipse/capsule)
  roll: number                              // degrees
  color: string                             // 6-digit hex (alpha stripped on parse)
}
export function serializeStops(stops: LoftStop[]): string
export function parseStops(json: unknown): LoftStop[]        // tolerant; sanitizes; stripAlpha on color
export function presetStops(preset: SpinePreset): LoftStop[]
export const DEFAULT_STOPS: LoftStop[]
export const DEFAULT_STOPS_JSON: string                     // serializeStops(DEFAULT_STOPS)

// loftGeometry.ts
export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Station { pos: Vec3; normal: Vec3; binormal: Vec3; t: number }
export interface StopProps { width: number; height: number; radius: number; sides: number; roll: number }
export function sampleSpine(stops: LoftStop[], closed: boolean, count: number): Station[]
export function interpStopProps(stops: LoftStop[], t: number): StopProps
export function interpStopColor(stops: LoftStop[], t: number): [number, number, number]  // 0..1 rgb
export function parametricProfileContour(p: StopProps, points: number): Vec2[]            // unit-space, |pt|<=1
export function resampleContour(pts: Vec2[], points: number): Vec2[]
export function buildRamp(stops: LoftStop[], size: number): Uint8ClampedArray             // size*4 RGBA
export interface LoftGeometry { positions: Float32Array; along: Float32Array; indices: Uint32Array }
export function buildLoftGeometry(opts: {
  stations: Station[]
  props: StopProps[]           // one per station (already interpolated)
  baseContours: Vec2[][]       // constant across stations; each already resampled to P points
  closed: boolean
  render: 'stroke' | 'fill'
}): LoftGeometry
```

---

### Task 1: Stops data model, serialization, presets

**Files:**
- Create: `frontend/app/lib/spacetype/loftStops.ts`
- Test: `frontend/tests/unit/spacetype-loft-stops.unit.spec.ts`

**Interfaces:**
- Produces: `LoftStop`, `SpinePreset`, `serializeStops`, `parseStops`, `presetStops`, `DEFAULT_STOPS`, `DEFAULT_STOPS_JSON` (signatures above).
- Consumes: `stripAlpha` from `~/lib/color/convert` (`stripAlpha(hex: string): string`).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-loft-stops.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { parseStops, serializeStops, presetStops, DEFAULT_STOPS, type LoftStop } from '../../app/lib/spacetype/loftStops'

describe('parseStops', () => {
  it('round-trips serialize→parse', () => {
    const s = serializeStops(DEFAULT_STOPS)
    expect(parseStops(s)).toEqual(DEFAULT_STOPS)
  })
  it('strips alpha from stop colours', () => {
    const [s] = parseStops('[{"id":"a","x":0.5,"y":0.5,"z":0,"width":1,"height":1,"radius":0.5,"sides":32,"roll":0,"color":"#ff000080"}]')
    expect(s!.color).toBe('#ff0000')
  })
  it('is tolerant of garbage → falls back to defaults', () => {
    expect(parseStops('not json')).toEqual(DEFAULT_STOPS)
    expect(parseStops('[]')).toEqual(DEFAULT_STOPS)   // never zero stops
  })
  it('assigns a stable id when missing', () => {
    const [s] = parseStops('[{"x":0.2,"y":0.2,"z":0,"width":1,"height":1,"radius":0.5,"sides":32,"roll":0,"color":"#fff"}]')
    expect(typeof s!.id).toBe('string'); expect(s!.id.length).toBeGreaterThan(0)
  })
})

describe('presetStops', () => {
  it('helix returns ≥4 stops spanning depth', () => {
    const stops = presetStops('helix')
    expect(stops.length).toBeGreaterThanOrEqual(4)
    const zs = stops.map(s => s.z)
    expect(Math.max(...zs) - Math.min(...zs)).toBeGreaterThan(0.5)
  })
  it('every preset yields valid, unique-id stops', () => {
    for (const p of ['helix','wave','arch','s-curve','loop'] as const) {
      const stops = presetStops(p)
      expect(stops.length).toBeGreaterThanOrEqual(3)
      expect(new Set(stops.map(s => s.id)).size).toBe(stops.length)
      for (const s of stops) { expect(s.width).toBeGreaterThan(0); expect(s.color).toMatch(/^#[0-9a-f]{6}$/i) }
    }
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/unit/spacetype-loft-stops.unit.spec.ts`
Expected: FAIL — cannot resolve `../../app/lib/spacetype/loftStops`.

- [ ] **Step 3: Implement `loftStops.ts`**

```ts
// frontend/app/lib/spacetype/loftStops.ts
import { stripAlpha } from '~/lib/color/convert'

export type SpinePreset = 'custom' | 'helix' | 'wave' | 'arch' | 's-curve' | 'loop'

export interface LoftStop {
  id: string
  x: number; y: number; z: number
  width: number; height: number
  radius: number; sides: number; roll: number
  color: string
}

let _idSeq = 0
// No Date.now()/Math.random() (banned in some contexts and non-deterministic for tests): a
// monotonic counter is enough for local uniqueness within one editing session.
function newId(): string { _idSeq += 1; return `s${_idSeq.toString(36)}` }

function num(v: unknown, fallback: number): number {
  const n = Number(v); return Number.isFinite(n) ? n : fallback
}
function clamp(n: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, n)) }
function hex6(v: unknown): string {
  const s = typeof v === 'string' ? stripAlpha(v) : '#ffffff'
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '#ffffff'
}

function sanitizeStop(raw: any): LoftStop {
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : newId(),
    x: clamp(num(raw?.x, 0.5), 0, 1),
    y: clamp(num(raw?.y, 0.5), 0, 1),
    z: clamp(num(raw?.z, 0), -1, 1),
    width: clamp(num(raw?.width, 1), 0.01, 8),
    height: clamp(num(raw?.height, 1), 0.01, 8),
    radius: clamp(num(raw?.radius, 0.5), 0, 1),
    sides: Math.round(clamp(num(raw?.sides, 32), 3, 64)),
    roll: num(raw?.roll, 0),
    color: hex6(raw?.color),
  }
}

export const DEFAULT_STOPS: LoftStop[] = presetStops('helix')
export const DEFAULT_STOPS_JSON: string = serializeStops(DEFAULT_STOPS)

export function serializeStops(stops: LoftStop[]): string { return JSON.stringify(stops) }

export function parseStops(json: unknown): LoftStop[] {
  let arr: any
  try { arr = typeof json === 'string' ? JSON.parse(json) : json } catch { return DEFAULT_STOPS }
  if (!Array.isArray(arr) || arr.length === 0) return DEFAULT_STOPS
  return arr.map(sanitizeStop)
}

const RAINBOW = ['#3b5bff', '#ff2ea6', '#ff5a1f', '#ffd23f', '#2ec7a0', '#8a5bff']

export function presetStops(preset: SpinePreset): LoftStop[] {
  const N = 6
  const at = (i: number) => i / (N - 1)
  const mk = (i: number, x: number, y: number, z: number, roll = 0): LoftStop => ({
    id: newId(), x, y, z, width: 1, height: 1, radius: 0.5, sides: 32, roll,
    color: RAINBOW[i % RAINBOW.length]!,
  })
  const stops: LoftStop[] = []
  for (let i = 0; i < N; i++) {
    const t = at(i)
    switch (preset) {
      case 'helix':   stops.push(mk(i, 0.5 + 0.32 * Math.cos(t * Math.PI * 3), 0.15 + 0.7 * t, Math.sin(t * Math.PI * 3), t * 360)); break
      case 'wave':    stops.push(mk(i, 0.1 + 0.8 * t, 0.5 + 0.28 * Math.sin(t * Math.PI * 2), 0)); break
      case 'arch':    stops.push(mk(i, 0.1 + 0.8 * t, 0.8 - 0.6 * Math.sin(t * Math.PI), 0)); break
      case 's-curve': stops.push(mk(i, 0.5 + 0.35 * Math.sin(t * Math.PI * 2), 0.1 + 0.8 * t, 0)); break
      case 'loop':    stops.push(mk(i, 0.5 + 0.32 * Math.cos(t * Math.PI * 2), 0.5 + 0.32 * Math.sin(t * Math.PI * 2), 0.2 * Math.sin(t * Math.PI * 2))); break
      case 'custom':  stops.push(mk(i, 0.2 + 0.6 * t, 0.5, 0)); break
    }
  }
  return stops
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/unit/spacetype-loft-stops.unit.spec.ts`
Expected: PASS (all 6).

Note: the two `export const` before their function declarations rely on JS function hoisting (`presetStops`/`serializeStops` are function declarations, hoisted) — this is intentional and works. If the linter complains about use-before-define, move the two `export const` lines to the end of the file.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/loftStops.ts frontend/tests/unit/spacetype-loft-stops.unit.spec.ts
git commit -m "feat(spacetype): loft stops model — parse/serialize/presets"
```

---

### Task 2: Spine sampling + per-stop property/colour interpolation

**Files:**
- Create: `frontend/app/lib/spacetype/loftGeometry.ts` (spine + interpolation half)
- Test: `frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts` (spine + interp cases)

**Interfaces:**
- Consumes: `LoftStop` from `./loftStops`.
- Produces: `Vec2`, `Vec3`, `Station`, `StopProps`, `sampleSpine`, `interpStopProps`, `interpStopColor`, `buildRamp`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { sampleSpine, interpStopProps, interpStopColor, buildRamp } from '../../app/lib/spacetype/loftGeometry'
import type { LoftStop } from '../../app/lib/spacetype/loftStops'

const stops: LoftStop[] = [
  { id: 'a', x: 0, y: 0.5, z: 0, width: 1, height: 1, radius: 0.5, sides: 32, roll: 0, color: '#000000' },
  { id: 'b', x: 1, y: 0.5, z: 0, width: 3, height: 1, radius: 0.5, sides: 32, roll: 90, color: '#ffffff' },
]

describe('sampleSpine', () => {
  it('returns exactly `count` stations with orthonormal frames', () => {
    const st = sampleSpine(stops, false, 20)
    expect(st.length).toBe(20)
    for (const s of st) {
      const dot = s.normal.x * s.binormal.x + s.normal.y * s.binormal.y + s.normal.z * s.binormal.z
      expect(Math.abs(dot)).toBeLessThan(1e-3)                     // normal ⟂ binormal
      const nlen = Math.hypot(s.normal.x, s.normal.y, s.normal.z)
      expect(nlen).toBeCloseTo(1, 3)                               // unit length
    }
    expect(st[0]!.t).toBeCloseTo(0); expect(st[19]!.t).toBeCloseTo(1)
  })
  it('closed spine wraps (last station near first position)', () => {
    const st = sampleSpine(stops, true, 24)
    const d = Math.hypot(st[0]!.pos.x - st[st.length - 1]!.pos.x, st[0]!.pos.y - st[st.length - 1]!.pos.y)
    expect(d).toBeLessThan(0.6)   // closed loop returns toward start
  })
})

describe('interpStopProps', () => {
  it('interpolates width monotonically end to end', () => {
    expect(interpStopProps(stops, 0).width).toBeCloseTo(1)
    expect(interpStopProps(stops, 1).width).toBeCloseTo(3)
    expect(interpStopProps(stops, 0.5).width).toBeGreaterThan(1)
    expect(interpStopProps(stops, 0.5).width).toBeLessThan(3)
  })
})

describe('interpStopColor / buildRamp', () => {
  it('endpoints match stop colours', () => {
    expect(interpStopColor(stops, 0)).toEqual([0, 0, 0])
    expect(interpStopColor(stops, 1)).toEqual([1, 1, 1])
  })
  it('ramp is size*4 RGBA and matches endpoints', () => {
    const ramp = buildRamp(stops, 256)
    expect(ramp.length).toBe(256 * 4)
    expect([ramp[0], ramp[1], ramp[2], ramp[3]]).toEqual([0, 0, 0, 255])
    expect([ramp[255 * 4], ramp[255 * 4 + 1], ramp[255 * 4 + 2]]).toEqual([255, 255, 255])
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/unit/spacetype-loft-geometry.unit.spec.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Implement the spine/interp half of `loftGeometry.ts`**

```ts
// frontend/app/lib/spacetype/loftGeometry.ts
import type { LoftStop } from './loftStops'

export interface Vec2 { x: number; y: number }
export interface Vec3 { x: number; y: number; z: number }
export interface Station { pos: Vec3; normal: Vec3; binormal: Vec3; t: number }
export interface StopProps { width: number; height: number; radius: number; sides: number; roll: number }

// Map an editor-space stop (x,y in 0..1, z in -1..1) into a centred world point. The engine's
// camera frames roughly ±5 units, so scale to that. y is flipped: canvas y-down → world y-up.
function stopToWorld(s: LoftStop): Vec3 {
  return { x: (s.x - 0.5) * 8, y: (0.5 - s.y) * 8, z: s.z * 4 }
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

function sampleCurve(pts: Vec3[], closed: boolean, u: number): Vec3 {
  // u in [0,1] over the whole polyline of control points
  const n = pts.length
  const seg = closed ? n : n - 1
  const f = u * seg
  let i = Math.floor(f)
  const local = f - i
  const idx = (k: number) => closed ? ((k % n) + n) % n : Math.min(Math.max(k, 0), n - 1)
  const P0 = pts[idx(i - 1)]!, P1 = pts[idx(i)]!, P2 = pts[idx(i + 1)]!, P3 = pts[idx(i + 2)]!
  return {
    x: catmullRom(P0.x, P1.x, P2.x, P3.x, local),
    y: catmullRom(P0.y, P1.y, P2.y, P3.y, local),
    z: catmullRom(P0.z, P1.z, P2.z, P3.z, local),
  }
}

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z } }
function cross(a: Vec3, b: Vec3): Vec3 { return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x } }
function norm(a: Vec3): Vec3 { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l } }

export function sampleSpine(stops: LoftStop[], closed: boolean, count: number): Station[] {
  const pts = stops.map(stopToWorld)
  if (pts.length === 1) pts.push({ ...pts[0]!, x: pts[0]!.x + 0.001 })
  const stations: Station[] = []
  // Parallel-transport frame: seed a reference "up", rotate it minimally along the curve so the
  // profile doesn't spin wildly at inflections (a plain Frenet frame flips at zero curvature).
  let ref: Vec3 = { x: 0, y: 1, z: 0 }
  const denom = count > 1 ? count - 1 : 1
  for (let i = 0; i < count; i++) {
    const t = i / denom
    const pos = sampleCurve(pts, closed, closed ? (i / count) : t)
    const ahead = sampleCurve(pts, closed, (closed ? (i / count) : t) + 0.001)
    const tangent = norm(sub(ahead, pos))
    // project ref perpendicular to tangent
    const dot = ref.x * tangent.x + ref.y * tangent.y + ref.z * tangent.z
    let normal = norm({ x: ref.x - tangent.x * dot, y: ref.y - tangent.y * dot, z: ref.z - tangent.z * dot })
    if (!Number.isFinite(normal.x)) normal = { x: 1, y: 0, z: 0 }
    const binormal = norm(cross(tangent, normal))
    ref = normal   // carry forward for minimal twist
    stations.push({ pos, normal, binormal, t })
  }
  return stations
}

// Locate t within the stop list and lerp field `k`.
function bracket(stops: LoftStop[], t: number): { a: LoftStop; b: LoftStop; f: number } {
  const n = stops.length
  if (n === 1) return { a: stops[0]!, b: stops[0]!, f: 0 }
  const x = Math.min(1, Math.max(0, t)) * (n - 1)
  const i = Math.min(Math.floor(x), n - 2)
  return { a: stops[i]!, b: stops[i + 1]!, f: x - i }
}

export function interpStopProps(stops: LoftStop[], t: number): StopProps {
  const { a, b, f } = bracket(stops, t)
  const l = (p: keyof StopProps) => (a[p as keyof LoftStop] as number) + ((b[p as keyof LoftStop] as number) - (a[p as keyof LoftStop] as number)) * f
  return { width: l('width'), height: l('height'), radius: l('radius'), sides: l('sides'), roll: l('roll') }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]
}

export function interpStopColor(stops: LoftStop[], t: number): [number, number, number] {
  const { a, b, f } = bracket(stops, t)
  const ca = hexToRgb(a.color), cb = hexToRgb(b.color)
  return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f]
}

export function buildRamp(stops: LoftStop[], size: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * 4)
  for (let i = 0; i < size; i++) {
    const [r, g, b] = interpStopColor(stops, size > 1 ? i / (size - 1) : 0)
    out[i * 4] = Math.round(r * 255); out[i * 4 + 1] = Math.round(g * 255); out[i * 4 + 2] = Math.round(b * 255); out[i * 4 + 3] = 255
  }
  return out
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/unit/spacetype-loft-geometry.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/loftGeometry.ts frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts
git commit -m "feat(spacetype): loft spine sampling + stop interpolation + colour ramp"
```

---

### Task 3: Parametric profile contour + resampling

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (append)
- Test: `frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts` (append cases)

**Interfaces:**
- Produces: `parametricProfileContour(p: StopProps, points: number): Vec2[]`, `resampleContour(pts: Vec2[], points: number): Vec2[]`. Contours are unit-space (max extent 1 before per-station width/height scaling).

- [ ] **Step 1: Add failing tests**

```ts
// append to spacetype-loft-geometry.unit.spec.ts
import { parametricProfileContour, resampleContour } from '../../app/lib/spacetype/loftGeometry'

describe('parametricProfileContour', () => {
  it('returns `points` vertices bounded to the unit box', () => {
    const c = parametricProfileContour({ width: 1, height: 1, radius: 0.5, sides: 32, roll: 0 }, 64)
    expect(c.length).toBe(64)
    for (const p of c) { expect(Math.abs(p.x)).toBeLessThanOrEqual(1.001); expect(Math.abs(p.y)).toBeLessThanOrEqual(1.001) }
  })
  it('high sides + full radius ≈ ellipse (all radii ~1)', () => {
    const c = parametricProfileContour({ width: 1, height: 1, radius: 1, sides: 64, roll: 0 }, 64)
    for (const p of c) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 1)
  })
})

describe('resampleContour', () => {
  it('resamples to the requested count, closed', () => {
    const src = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }]
    expect(resampleContour(src, 40).length).toBe(40)
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/unit/spacetype-loft-geometry.unit.spec.ts`
Expected: FAIL — `parametricProfileContour` / `resampleContour` not exported.

- [ ] **Step 3: Append implementation to `loftGeometry.ts`**

```ts
// A superellipse-ish rounded profile in unit space. `sides` chooses the corner sharpness
// exponent (low → polygonal, high → smooth ellipse); `radius` blends between a rect (0) and the
// rounded form (1). width/height are applied later per-station, so this is unit-normalised.
export function parametricProfileContour(p: StopProps, points: number): Vec2[] {
  const sides = Math.max(3, Math.round(p.sides))
  const n = Math.pow(2, 1 + (sides / 64) * 5)   // exponent 2..~64 → superellipse sharpness
  const out: Vec2[] = []
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2
    const ca = Math.cos(a), sa = Math.sin(a)
    // superellipse: |x|^n + |y|^n = 1
    const ex = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / n)
    const ey = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / n)
    // radius blends the sharp unit box (cos/sin scaled to box) with the superellipse
    const bx = ca / Math.max(Math.abs(ca), Math.abs(sa) || 1e-6)
    const by = sa / Math.max(Math.abs(ca), Math.abs(sa) || 1e-6)
    out.push({ x: bx + (ex - bx) * p.radius, y: by + (ey - by) * p.radius })
  }
  return out
}

export function resampleContour(pts: Vec2[], points: number): Vec2[] {
  if (pts.length === 0) return []
  // cumulative arc length around the closed loop
  const cum: number[] = [0]
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1]!, b = pts[i % pts.length]!
    cum.push(cum[i - 1]! + Math.hypot(b.x - a.x, b.y - a.y))
  }
  const total = cum[cum.length - 1]! || 1
  const out: Vec2[] = []
  for (let i = 0; i < points; i++) {
    const target = (i / points) * total
    let seg = 1
    while (seg < cum.length && cum[seg]! < target) seg++
    const a = pts[(seg - 1) % pts.length]!, b = pts[seg % pts.length]!
    const segLen = (cum[seg]! - cum[seg - 1]!) || 1
    const f = (target - cum[seg - 1]!) / segLen
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
  }
  return out
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/unit/spacetype-loft-geometry.unit.spec.ts`
Expected: PASS (all, including Task 2 cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/loftGeometry.ts frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts
git commit -m "feat(spacetype): parametric profile contour + arc-length resample"
```

---

### Task 4: `buildLoftGeometry` — vertex/index/`aAlong` buffers

**Files:**
- Modify: `frontend/app/lib/spacetype/loftGeometry.ts` (append)
- Test: `frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts` (append)

**Interfaces:**
- Produces: `LoftGeometry { positions: Float32Array; along: Float32Array; indices: Uint32Array }`, `buildLoftGeometry(opts)` (signature in shared block). Vertex grid is `K*C*P`; `positions`/`along` are that grid; `indices` are line-segment pairs (stroke) or skinned triangles (fill).

- [ ] **Step 1: Add failing tests**

```ts
// append to spacetype-loft-geometry.unit.spec.ts
import { buildLoftGeometry } from '../../app/lib/spacetype/loftGeometry'

function fixtureStations(K: number) {
  return sampleSpine([
    { id: 'a', x: 0, y: 0.5, z: 0, width: 1, height: 1, radius: 0.5, sides: 32, roll: 0, color: '#000' },
    { id: 'b', x: 1, y: 0.5, z: 0, width: 1, height: 1, radius: 0.5, sides: 32, roll: 0, color: '#fff' },
  ], false, K)
}

describe('buildLoftGeometry', () => {
  const K = 10, P = 16
  const stations = fixtureStations(K)
  const props = stations.map(() => ({ width: 1, height: 1, radius: 0.5, sides: 32, roll: 0 }))
  const contour = parametricProfileContour({ width: 1, height: 1, radius: 0.5, sides: 32, roll: 0 }, P)

  it('fill: K*C*P verts and (K-1)*C*P*6 indices (open)', () => {
    const g = buildLoftGeometry({ stations, props, baseContours: [contour], closed: false, render: 'fill' })
    expect(g.positions.length).toBe(K * 1 * P * 3)
    expect(g.along.length).toBe(K * 1 * P)
    expect(g.indices.length).toBe((K - 1) * 1 * P * 6)
  })
  it('fill closed: K*C*P*6 indices', () => {
    const g = buildLoftGeometry({ stations, props, baseContours: [contour], closed: true, render: 'fill' })
    expect(g.indices.length).toBe(K * 1 * P * 6)
  })
  it('stroke: K*C*P*2 line indices', () => {
    const g = buildLoftGeometry({ stations, props, baseContours: [contour], closed: false, render: 'stroke' })
    expect(g.indices.length).toBe(K * 1 * P * 2)
  })
  it('along runs 0→1 across stations', () => {
    const g = buildLoftGeometry({ stations, props, baseContours: [contour], closed: false, render: 'stroke' })
    expect(g.along[0]).toBeCloseTo(0)
    expect(g.along[g.along.length - 1]).toBeCloseTo(1)
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/unit/spacetype-loft-geometry.unit.spec.ts`
Expected: FAIL — `buildLoftGeometry` not exported.

- [ ] **Step 3: Append implementation**

```ts
export interface LoftGeometry { positions: Float32Array; along: Float32Array; indices: Uint32Array }

export function buildLoftGeometry(opts: {
  stations: Station[]
  props: StopProps[]
  baseContours: Vec2[][]
  closed: boolean
  render: 'stroke' | 'fill'
}): LoftGeometry {
  const { stations, props, baseContours, closed, render } = opts
  const K = stations.length
  const C = baseContours.length
  const P = C > 0 ? baseContours[0]!.length : 0
  const positions = new Float32Array(K * C * P * 3)
  const along = new Float32Array(K * C * P)
  const idx = (i: number, c: number, p: number) => (i * C + c) * P + p

  for (let i = 0; i < K; i++) {
    const st = stations[i]!, pr = props[i]!
    const cr = Math.cos((pr.roll * Math.PI) / 180), sr = Math.sin((pr.roll * Math.PI) / 180)
    for (let c = 0; c < C; c++) {
      const contour = baseContours[c]!
      for (let p = 0; p < P; p++) {
        const v = contour[p]!
        let lx = v.x * pr.width, ly = v.y * pr.height
        const rx = lx * cr - ly * sr, ry = lx * sr + ly * cr        // roll about tangent
        const wx = st.pos.x + rx * st.normal.x + ry * st.binormal.x
        const wy = st.pos.y + rx * st.normal.y + ry * st.binormal.y
        const wz = st.pos.z + rx * st.normal.z + ry * st.binormal.z
        const o = idx(i, c, p)
        positions[o * 3] = wx; positions[o * 3 + 1] = wy; positions[o * 3 + 2] = wz
        along[o] = st.t
      }
    }
  }

  let indices: number[] = []
  if (render === 'fill') {
    const lastRing = closed ? K : K - 1
    for (let i = 0; i < lastRing; i++) {
      const ni = (i + 1) % K
      for (let c = 0; c < C; c++) {
        for (let p = 0; p < P; p++) {
          const np = (p + 1) % P
          const a = idx(i, c, p), b = idx(i, c, np), d = idx(ni, c, p), e = idx(ni, c, np)
          indices.push(a, b, e, a, e, d)          // two triangles per quad
        }
      }
    }
  } else {
    // stroke: close each station's contour loop with line segments
    for (let i = 0; i < K; i++) {
      for (let c = 0; c < C; c++) {
        for (let p = 0; p < P; p++) {
          const np = (p + 1) % P
          indices.push(idx(i, c, p), idx(i, c, np))
        }
      }
    }
  }
  return { positions, along, indices: new Uint32Array(indices) }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run tests/unit/spacetype-loft-geometry.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/loftGeometry.ts frontend/tests/unit/spacetype-loft-geometry.unit.spec.ts
git commit -m "feat(spacetype): buildLoftGeometry — skinned/stroke buffers with aAlong"
```

---

### Task 5: The `loft` effect (parametric/shape kind) + registration

**Files:**
- Modify: `frontend/app/lib/spacetype/effect.ts:49-84` — add `profileStops` union member.
- Create: `frontend/app/lib/spacetype/effects/loft.ts`
- Modify: `frontend/app/lib/spacetype/effects/index.ts` — import + register.
- Test: `frontend/tests/unit/spacetype-loft-effect.unit.spec.ts`

**Interfaces:**
- Consumes: `sampleSpine`, `interpStopProps`, `parametricProfileContour`, `buildLoftGeometry`, `buildRamp` (Task 2-4); `parseStops`, `DEFAULT_STOPS_JSON` (Task 1); `SpaceTypeEffect`, `ControlSpec`, `Params` from `../effect`.
- Produces: `loftEffect: SpaceTypeEffect` (id `'loft'`); exported pure helper `loftContours(params): Vec2[][]` for testing.

- [ ] **Step 1: Add the union member (compile enabler)**

In `frontend/app/lib/spacetype/effect.ts`, inside the `ControlSpec` union (after the `contentList` member, ~line 83), add:

```ts
  // A rich list of loft "stops" (position + profile params + colour), stored as one JSON string
  // (ParamValue is scalar). The surface renders ProfileStopsEditor; loft.ts parses it with parseStops.
  | { key: string; label: string; kind: 'profileStops'; default: string; group: string }
```

- [ ] **Step 2: Write the failing test**

```ts
// frontend/tests/unit/spacetype-loft-effect.unit.spec.ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { loftEffect } from '../../app/lib/spacetype/effects/loft'
import { defaultsFromControls } from '../../app/lib/spacetype/effect'

describe('loftEffect', () => {
  it('registers with id "loft" and required section groups', () => {
    expect(loftEffect.id).toBe('loft')
    for (const c of loftEffect.controls) expect(typeof c.group).toBe('string')
  })
  it('buildScene returns a root with drawable geometry (shape kind, fill)', () => {
    const params = defaultsFromControls(loftEffect.controls)
    params.render = 'fill'; params.profileKind = 'shape'
    const dummyTex = new THREE.Texture()
    const root = loftEffect.buildScene(THREE as any, params, dummyTex, { width: 800, height: 800 })
    let drawable = 0
    root.traverse(o => { if ((o as any).isMesh || (o as any).isLineSegments) drawable++ })
    expect(drawable).toBeGreaterThan(0)
    expect(root.userData.loftState).toBeTruthy()
  })
  it('stroke kind builds LineSegments', () => {
    const params = defaultsFromControls(loftEffect.controls)
    params.render = 'stroke'
    const root = loftEffect.buildScene(THREE as any, params, new THREE.Texture(), { width: 800, height: 800 })
    let lines = 0
    root.traverse(o => { if ((o as any).isLineSegments) lines++ })
    expect(lines).toBeGreaterThan(0)
  })
  it('update(spin>0) rotates without throwing', () => {
    const params = defaultsFromControls(loftEffect.controls)
    params.spin = 2
    const root = loftEffect.buildScene(THREE as any, params, new THREE.Texture(), { width: 800, height: 800 })
    expect(() => loftEffect.update(0.5, params, root)).not.toThrow()
    expect(root.rotation.y).not.toBe(0)
  })
})
```

- [ ] **Step 3: Run, verify fail**

Run: `npx vitest run tests/unit/spacetype-loft-effect.unit.spec.ts`
Expected: FAIL — cannot resolve `effects/loft`.

- [ ] **Step 4: Implement `effects/loft.ts`**

```ts
import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseStops, DEFAULT_STOPS_JSON, type LoftStop } from '../loftStops'
import {
  sampleSpine, interpStopProps, parametricProfileContour, resampleContour,
  buildLoftGeometry, buildRamp, type Vec2,
} from '../loftGeometry'

/**
 * LOFT — sweep a keyframed cross-section (a parametric shape or, in word mode, a word's glyph
 * outlines) along an editable 3D bezier spine defined by a list of "stops". Renders as dense
 * stroked outlines or a solid skinned surface, with a colour gradient (a ramp texture) running
 * along the sweep, offset live by `flow`. Ignores the baked text texture; word mode builds real
 * outline contours from the font cache instead. Reference set: iridescent spirals, gradient
 * ribbons, lofted tubes.
 */

const PROFILE_POINTS = 48   // vertices resampled per contour

const controls: ControlSpec[] = [
  { key: 'stops', label: 'Stops', kind: 'profileStops', default: DEFAULT_STOPS_JSON, group: 'Layout' },
  { key: 'spinePreset', label: 'Spine preset', kind: 'select', options: ['custom', 'helix', 'wave', 'arch', 's-curve', 'loop'], default: 'helix', group: 'Layout' },
  { key: 'closed', label: 'Closed loop', kind: 'switch', default: false, group: 'Layout' },
  { key: 'copies', label: 'Copies', kind: 'slider', min: 6, max: 400, step: 1, default: 120, group: 'Layout' },
  { key: 'profileKind', label: 'Profile', kind: 'select', options: ['shape', 'word'], default: 'shape', group: 'Style' },
  // word-mode fields (revealed via showIf on profileKind)
  { key: 'text', label: 'Word', kind: 'text', default: 'LOFT', group: 'Style', showIf: { key: 'profileKind', equals: 'word' } },
  { key: 'font', label: 'Font', kind: 'font', default: 'google:Archivo Black@700', group: 'Style', showIf: { key: 'profileKind', equals: 'word' } },
  { key: 'render', label: 'Render', kind: 'select', options: ['stroke', 'fill'], default: 'fill', group: 'Style' },
  { key: 'strokeOpacity', label: 'Stroke opacity', kind: 'slider', min: 0.02, max: 1, step: 0.02, default: 0.4, group: 'Style', showIf: { key: 'render', equals: 'stroke' } },
  { key: 'fillOpacity', label: 'Fill opacity', kind: 'slider', min: 0.05, max: 1, step: 0.05, default: 1, group: 'Style', showIf: { key: 'render', equals: 'fill' } },
  { key: 'mode', label: 'Space', kind: 'select', options: ['3d', 'flat'], default: '3d', group: 'Style' },
  { key: 'flow', label: 'Flow', kind: 'slider', min: 0, max: 4, step: 1, default: 0, group: 'Motion' },
  { key: 'spin', label: 'Spin', kind: 'slider', min: 0, max: 4, step: 1, default: 0, group: 'Motion' },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0.2, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0.4, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]

interface LoftState { mat: THREE.ShaderMaterial }

function n(p: Params, k: string): number { return Number(p[k]) }

const VERT = `
attribute float aAlong;
varying float vAlong;
void main() { vAlong = aAlong; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
const FRAG = `
uniform sampler2D uRamp;
uniform float uFlow;
uniform float uOpacity;
varying float vAlong;
void main() {
  float u = fract(vAlong + uFlow);
  vec3 c = texture2D(uRamp, vec2(u, 0.5)).rgb;
  gl_FragColor = vec4(c, uOpacity);
}
`

/** Build the cross-section contours for these params. Shape kind only here; word mode overrides
 *  `baseContours` in buildScene. Exported for unit tests. */
export function loftContours(params: Params, stops: LoftStop[]): Vec2[][] {
  const props = interpStopProps(stops, 0)
  return [resampleContour(parametricProfileContour(props, PROFILE_POINTS), PROFILE_POINTS)]
}

export const loftEffect: SpaceTypeEffect = {
  id: 'loft',
  label: 'Loft',
  controls,
  liveKeys: ['flow', 'spin'],

  buildScene(three, params, _textTexture, env) {
    void _textTexture; void env
    const root = new three.Group()
    const stops = parseStops(params.stops)
    const closed = Boolean(params.closed)
    const flat = String(params.mode) === 'flat'
    const flatStops = flat ? stops.map(s => ({ ...s, z: 0 })) : stops

    const K = Math.max(2, Math.floor(n(params, 'copies')))
    const stations = sampleSpine(flatStops, closed, K)
    const props = stations.map(st => interpStopProps(flatStops, st.t))
    const baseContours = loftContours(params, flatStops)          // word mode replaces this in Task 8

    const render = String(params.render) === 'stroke' ? 'stroke' : 'fill'
    const geo = buildLoftGeometry({ stations, props, baseContours, closed, render })

    const g = new three.BufferGeometry()
    g.setAttribute('position', new three.BufferAttribute(geo.positions, 3))
    g.setAttribute('aAlong', new three.BufferAttribute(geo.along, 1))
    g.setIndex(new three.BufferAttribute(geo.indices, 1))

    const ramp = new three.DataTexture(buildRamp(stops, 256), 256, 1, three.RGBAFormat)
    ramp.needsUpdate = true
    const opacity = render === 'stroke' ? n(params, 'strokeOpacity') : n(params, 'fillOpacity')
    const mat = new three.ShaderMaterial({
      uniforms: { uRamp: { value: ramp }, uFlow: { value: 0 }, uOpacity: { value: opacity } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: render === 'fill' && opacity >= 1,
      side: three.DoubleSide,
    })

    const obj = render === 'stroke' ? new three.LineSegments(g, mat) : new three.Mesh(g, mat)
    obj.frustumCulled = false
    root.add(obj)
    root.userData.loftGeo = g
    root.userData.loftRamp = ramp
    root.userData.loftState = { mat } satisfies LoftState
    return root
  },

  update(t01, params, root) {
    const s = root?.userData?.loftState as LoftState | undefined
    if (!s) return
    const flow = n(params, 'flow') || 0
    const spin = n(params, 'spin') || 0
    s.mat.uniforms.uFlow!.value = flow > 0 ? t01 * flow : 0
    if (root) root.rotation.y = spin > 0 ? t01 * spin * 2 * Math.PI : 0
  },

  loopRates(params) {
    const r: number[] = []
    const flow = Math.round(n(params, 'flow') || 0); if (flow > 0) r.push(flow)
    const spin = Math.round(n(params, 'spin') || 0); if (spin > 0) r.push(spin)
    return r
  },
}
```

- [ ] **Step 5: Register in `effects/index.ts`**

Add the import next to the others (after `import { ringEffect } from './ring'`):

```ts
import { loftEffect } from './loft'
```

Add to the `SPACE_TYPE_EFFECTS` array (after `ringEffect,`):

```ts
  loftEffect,
```

- [ ] **Step 6: Run, verify pass**

Run: `npx vitest run tests/unit/spacetype-loft-effect.unit.spec.ts`
Expected: PASS (4). If `DataTexture`/`ShaderMaterial` construction complains under node, it should not — those are plain object constructors with no GL calls until render.

- [ ] **Step 7: Typecheck the touched files**

Run: `npx vue-tsc --noEmit 2>&1 | grep -E 'loft|effect\.ts|profileStops' || echo 'no new loft errors'`
Expected: `no new loft errors` (the `profileStops` union member resolves; the effect matches `SpaceTypeEffect`).

- [ ] **Step 8: Commit**

```bash
git add frontend/app/lib/spacetype/effect.ts frontend/app/lib/spacetype/effects/loft.ts frontend/app/lib/spacetype/effects/index.ts frontend/tests/unit/spacetype-loft-effect.unit.spec.ts
git commit -m "feat(spacetype): loft effect (parametric shape kind) + register"
```

---

### Task 6: `ProfileStopsEditor.vue` + surface wiring

**Files:**
- Create: `frontend/app/components/vue-canvas/ProfileStopsEditor.vue`
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (~line 36 import; ~line 1776 render branch)
- Modify: the `controlKindToVariableType` definition (search) — return `null` for `'profileStops'`.
- Modify: `frontend/app/lib/spacetype/controlDescriptor.ts` — exclude `profileStops` from AI-editable kinds.

**Interfaces:**
- Consumes: `parseStops`, `serializeStops`, `presetStops`, `type LoftStop`, `type SpinePreset` from `~/lib/spacetype/loftStops`; `StudioColor` from `./studio/StudioColor.vue`.
- Contract: props `{ modelValue: string }` (JSON stops), emit `update:modelValue` (JSON string) — mirrors `CurveEditor`.

- [ ] **Step 1: Confirm `controlKindToVariableType` and add the null case**

Run: `grep -rn "controlKindToVariableType" frontend/app`
Then in its definition add a branch so `'profileStops'` returns `null` (like other non-scalar kinds `curve`/`fillList`/`contentList` already do). Confirm those return `null` there and match the pattern.

- [ ] **Step 2: Write `ProfileStopsEditor.vue`**

```vue
<!-- frontend/app/components/vue-canvas/ProfileStopsEditor.vue -->
<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { parseStops, serializeStops, presetStops, type LoftStop } from '~/lib/spacetype/loftStops'
import StudioColor from './studio/StudioColor.vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const stops = reactive<LoftStop[]>(parseStops(props.modelValue))
const selectedId = reactive({ v: stops[0]?.id ?? '' })

// Re-hydrate if an external change (preset select, var binding) rewrites the JSON.
watch(() => props.modelValue, (json) => {
  const next = parseStops(json)
  if (serializeStops(next) === serializeStops(stops)) return
  stops.splice(0, stops.length, ...next)
  if (!stops.find(s => s.id === selectedId.v)) selectedId.v = stops[0]?.id ?? ''
})

function commit() { emit('update:modelValue', serializeStops(stops)) }

const selected = computed(() => stops.find(s => s.id === selectedId.v) ?? stops[0])

function addStop() {
  const last = stops[stops.length - 1]!
  stops.push({ ...last, id: `s${Date.now().toString(36)}${stops.length}`, x: Math.min(1, last.x + 0.05) })
  selectedId.v = stops[stops.length - 1]!.id
  commit()
}
function removeStop(id: string) {
  if (stops.length <= 2) return
  const i = stops.findIndex(s => s.id === id); if (i < 0) return
  stops.splice(i, 1)
  if (selectedId.v === id) selectedId.v = stops[0]!.id
  commit()
}
function set<K extends keyof LoftStop>(k: K, v: LoftStop[K]) {
  const s = selected.value; if (!s) return
  ;(s[k] as LoftStop[K]) = v
  commit()
}

// Canvas drag: map click/drag to the selected stop's x,y (0..1).
const W = 220, H = 120
function nodeStyle(s: LoftStop) { return { left: `${s.x * W}px`, top: `${s.y * H}px` } }
function onCanvasPointer(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
  const s = selected.value; if (!s) return
  s.x = x; s.y = y; commit()
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- spine canvas: draggable XY nodes -->
    <div class="relative rounded border border-white/10 bg-black/30"
         :style="{ width: W + 'px', height: H + 'px' }"
         @pointerdown="(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); onCanvasPointer(e) }"
         @pointermove="(e) => { if (e.buttons) onCanvasPointer(e) }">
      <button v-for="s in stops" :key="s.id" type="button"
              class="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border"
              :class="s.id === selectedId.v ? 'border-white bg-blue-500' : 'border-white/40 bg-white/20'"
              :style="nodeStyle(s)"
              @pointerdown.stop="selectedId.v = s.id" />
    </div>

    <div class="flex items-center gap-1">
      <button type="button" class="rounded bg-white/10 px-2 py-1 text-[10px]" @click="addStop">+ stop</button>
      <button type="button" class="rounded bg-white/10 px-2 py-1 text-[10px]"
              :disabled="stops.length <= 2" @click="removeStop(selectedId.v)">– stop</button>
      <span class="ml-auto text-[10px] text-white/40">{{ stops.length }} stops</span>
    </div>

    <!-- selected-stop inspector -->
    <div v-if="selected" class="flex flex-col gap-1 rounded border border-white/10 p-2">
      <label class="flex items-center justify-between text-[10px] text-white/50">Depth
        <input type="range" min="-1" max="1" step="0.01" :value="selected.z"
               @input="(e) => set('z', Number((e.target as HTMLInputElement).value))" /></label>
      <label class="flex items-center justify-between text-[10px] text-white/50">Width
        <input type="range" min="0.05" max="6" step="0.05" :value="selected.width"
               @input="(e) => set('width', Number((e.target as HTMLInputElement).value))" /></label>
      <label class="flex items-center justify-between text-[10px] text-white/50">Height
        <input type="range" min="0.05" max="6" step="0.05" :value="selected.height"
               @input="(e) => set('height', Number((e.target as HTMLInputElement).value))" /></label>
      <label class="flex items-center justify-between text-[10px] text-white/50">Radius
        <input type="range" min="0" max="1" step="0.02" :value="selected.radius"
               @input="(e) => set('radius', Number((e.target as HTMLInputElement).value))" /></label>
      <label class="flex items-center justify-between text-[10px] text-white/50">Sides
        <input type="range" min="3" max="64" step="1" :value="selected.sides"
               @input="(e) => set('sides', Number((e.target as HTMLInputElement).value))" /></label>
      <label class="flex items-center justify-between text-[10px] text-white/50">Roll
        <input type="range" min="-180" max="180" step="1" :value="selected.roll"
               @input="(e) => set('roll', Number((e.target as HTMLInputElement).value))" /></label>
      <StudioColor :model-value="selected.color" @update:model-value="(v: string) => set('color', v)" />
    </div>
  </div>
</template>
```

- [ ] **Step 3: Wire it into `SpaceTypeSurface.vue`**

Add the import near line 36 (next to `CurveEditor`):

```ts
import ProfileStopsEditor from './ProfileStopsEditor.vue'
```

Add a render branch next to the `curve` branch (~line 1776). Because `stops` is structural (not a `liveKey`), assigning `params[c.key]` alone triggers the `structuralSignature` rebuild — mirror the `curve` branch exactly:

```vue
<ProfileStopsEditor v-else-if="c.kind === 'profileStops'" :model-value="String(params[c.key])"
                    @update:model-value="(val: string) => { params[c.key] = val }" />
```

- [ ] **Step 4: Exclude from AI-editable kinds**

In `frontend/app/lib/spacetype/controlDescriptor.ts`, find the kind union / `describeControls` switch (line ~9 per the map) and ensure `profileStops` is either omitted or produces no AI patch surface (treat like `contentList`/`fillList` if those are already excluded). Grep first: `grep -n "contentList\|fillList\|curve" frontend/app/lib/spacetype/controlDescriptor.ts` and follow the same handling.

- [ ] **Step 5: Verify in the browser (real runtime — synthetic events prove nothing here)**

Start the dev server and drive the effect. (Sailor: use `127.0.0.1`, not `localhost`.)

1. `preview_start` the frontend dev server (or the `./dev.sh` launcher).
2. Open the Space Type surface, pick the **Loft** effect.
3. Confirm the Stops editor renders; drag a node on the canvas and confirm the preview curve changes; move the Width/Roll/Depth sliders on the selected stop and confirm the swept form responds.
4. Change the selected stop's colour and confirm the gradient ramp updates.
5. `read_console_messages` — no errors; `computer {action:"screenshot"}` for proof.

**Broken-control check (prove the path runs):** temporarily hard-code `PROFILE_POINTS = 3` in `loft.ts`, reload, confirm the profile visibly becomes a triangle tube, then revert. If nothing changes, the editor edits aren't reaching the geometry — debug before proceeding.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/ProfileStopsEditor.vue frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/app/lib/spacetype/controlDescriptor.ts frontend/app/composables/useStudioVarBindings.ts
git commit -m "feat(spacetype): ProfileStopsEditor + loft control wiring"
```
(Adjust the last path to wherever `controlKindToVariableType` actually lives.)

---

### Task 7: Spine presets stamp stops

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — watch `spinePreset` → replace `stops`.
- Test: covered by Task 1's `presetStops` unit tests + a manual runtime check.

**Interfaces:**
- Consumes: `presetStops`, `serializeStops` from `~/lib/spacetype/loftStops`.

- [ ] **Step 1: Add the preset→stops watcher**

The `select` control writes `params.spinePreset`. When the effect is `loft` and the preset changes to a non-`custom` value, regenerate `params.stops`. Add near the other `watch`es in `SpaceTypeSurface.vue` (after the params setup, ~line 440):

```ts
import { presetStops, serializeStops } from '~/lib/spacetype/loftStops'
// ...
watch(() => params.spinePreset, (preset) => {
  if (effect.value.id !== 'loft') return
  if (!preset || preset === 'custom') return
  // Confirm before overwriting hand-edited stops.
  const hasEdits = String(params.stops || '').length > 2
  if (hasEdits && !window.confirm('Replace the current stops with the ' + preset + ' preset?')) return
  params.stops = serializeStops(presetStops(preset as any))
})
```

Note: assigning `params.stops` triggers the structural rebuild AND the `ProfileStopsEditor` `watch(modelValue)` re-hydrates its working array (Task 6 handles that). After stamping, set `params.spinePreset` back to `'custom'` is optional — leaving it lets re-selecting the same preset re-stamp (the `confirm` guards accidental loss).

- [ ] **Step 2: Runtime verify**

Reload, pick **Loft**, switch the Spine preset select through helix/wave/arch/s-curve/loop; each should visibly restamp the spine. Editing a node afterward and re-selecting a preset should prompt before overwriting. `computer {action:"screenshot"}` of two different presets.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(spacetype): spine presets stamp loft stops"
```

---

### Task 8: Word mode — glyph outlines as the swept cross-section

**Files:**
- Modify: `frontend/app/lib/spacetype/effects/loft.ts` — word branch in `buildScene` + `wordContours` helper.
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — pre-warm the font cache and rebuild when it arrives.
- Test: `frontend/tests/unit/spacetype-loft-word.unit.spec.ts`

**Interfaces:**
- Consumes: `textOutline`, `fontCacheGet`, `loadFont`, `fontSourceUrl` from `~/lib/scene3d/outlines`.
- Produces: `wordContours(three, params, points): Vec2[][] | null` in `loft.ts` (null when the font isn't cached yet).

- [ ] **Step 1: Write the failing test (uses the checked-in font fixture, no network)**

```ts
// frontend/tests/unit/spacetype-loft-word.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { wordContoursFromShapes } from '../../app/lib/spacetype/effects/loft'
import { textOutline } from '../../app/lib/scene3d/outlines'

// Reuse the repo's approach for loading opentype in node (see scene3d outline tests). If
// scene3d/outlines exposes a fixture loader in its own tests, mirror it here. Otherwise parse the
// fixture with opentype directly:
import opentype from 'three/examples/jsm/libs/opentype.module.js'

const fixture = fileURLToPath(new URL('../fixtures/inter-subset-var.ttf', import.meta.url))

describe('word mode contours', () => {
  it("resolves 'oo' into ≥2 outer contours plus counters", () => {
    const buf = readFileSync(fixture)
    const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)) as any
    const shapes = textOutline('oo', font, { size: 1, letterSpacing: 0 })   // THREE.Shape[]
    const contours = wordContoursFromShapes(THREE as any, shapes, 32)
    // each 'o' = 1 outer + 1 hole → contours flattened ≥ 4
    expect(contours.length).toBeGreaterThanOrEqual(2)
    for (const c of contours) expect(c.length).toBe(32)
  })
})
```

Note: if the fixture glyph set does not contain `o`, use a letter it does contain (inspect with a quick `font.charToGlyph` check) — the assertion is "≥1 contour, each resampled to 32 points", adjust the letter accordingly.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run tests/unit/spacetype-loft-word.unit.spec.ts`
Expected: FAIL — `wordContoursFromShapes` not exported.

- [ ] **Step 3: Add word contour helpers + buildScene branch in `loft.ts`**

Add imports at the top of `loft.ts`:

```ts
import { textOutline, fontCacheGet, fontSourceUrl, type Font } from '~/lib/scene3d/outlines'
```

Add the pure shape→contours converter (exported for the test) and the params-driven resolver:

```ts
/** Flatten THREE.Shape[] (outer + holes) into resampled unit-space contours centred on origin. */
export function wordContoursFromShapes(three: typeof THREE, shapes: THREE.Shape[], points: number): Vec2[][] {
  const raw: Vec2[][] = []
  for (const shape of shapes) {
    raw.push(shape.getPoints(points).map(p => ({ x: p.x, y: p.y })))
    for (const hole of shape.holes) raw.push(hole.getPoints(points).map(p => ({ x: p.x, y: p.y })))
  }
  // normalise to unit box (max extent → 1), centred
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of raw) for (const p of c) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y) }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const scale = 2 / Math.max(maxX - minX, maxY - minY, 1e-6)
  return raw.map(c => resampleContour(c.map(p => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale })), points))
}

/** Word cross-section for the current params, or null when the font isn't cached yet (async). */
export function wordContours(three: typeof THREE, params: Params, points: number): Vec2[][] | null {
  const value = String(params.font || '')
  const font = fontCacheGet(fontSourceUrl(value)) as Font | null
  if (!font) return null
  const shapes = textOutline(String(params.text || ' '), font, { size: 1, letterSpacing: 0 })
  if (!shapes.length) return null
  return wordContoursFromShapes(three, shapes, points)
}
```

In `buildScene`, replace the `baseContours` line with a branch (font falls back to the parametric shape until the cache is warm):

```ts
    const isWord = String(params.profileKind) === 'word'
    const baseContours = isWord
      ? (wordContours(three as any, params, PROFILE_POINTS) ?? loftContours(params, flatStops))
      : loftContours(params, flatStops)
```

Word mode is 3D-primary; in flat mode a perpendicular word degenerates to a line. Minimal handling: when `flat && isWord`, skip the perpendicular framing — orient contours facing camera. Simplest v1: leave the framing as-is but note it; the trailing-copies refinement is a fast-follow. Add a code comment recording this.

- [ ] **Step 4: Run the word unit test, verify pass**

Run: `npx vitest run tests/unit/spacetype-loft-word.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Host font prefetch + rebuild in `SpaceTypeSurface.vue`**

`buildScene` reads the font synchronously from the cache; nothing warms it. Add a watcher that loads the font when word mode is active, then nudges a rebuild (mirror how Scene3D warms its font — grep `loadFont` in `frontend/app/lib/scene3d` / its node for the exact rebuild trigger):

```ts
import { loadFont, fontSourceUrl, fontCacheGet } from '~/lib/scene3d/outlines'
// ...
watch(() => [effect.value.id, params.profileKind, params.font, params.text], async () => {
  if (effect.value.id !== 'loft' || params.profileKind !== 'word') return
  const url = fontSourceUrl(String(params.font || ''))
  if (fontCacheGet(url)) return          // already warm; buildScene will read it
  await loadFont(url)                     // async; safe here (NOT inside buildScene)
  scheduleRebuild()                       // re-run build now that the cache is warm
}, { immediate: true })
```

Confirm `scheduleRebuild` is the in-scope rebuild scheduler (the `structuralSignature` watcher calls it — see the control-UI map). If it is not exported into this scope, call the same function that watcher uses.

- [ ] **Step 6: Runtime verify word mode**

Reload, pick **Loft**, set Profile → **word**, type a word, pick a font. First frame may show the parametric fallback for a beat, then the word-shaped loft appears once the font loads. Toggle stroke↔fill. `computer {action:"screenshot"}`. Broken-control check: set text to a single wide letter and confirm the swept form matches its silhouette.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/spacetype/effects/loft.ts frontend/app/components/vue-canvas/SpaceTypeSurface.vue frontend/tests/unit/spacetype-loft-word.unit.spec.ts
git commit -m "feat(spacetype): loft word mode — glyph outlines as swept cross-section"
```

---

### Task 9: Seamless-loop verification + motion polish

**Files:**
- Modify: `frontend/app/lib/spacetype/effects/loft.ts` (only if `loopRates` needs adjustment).
- Test: extend `spacetype-loft-effect.unit.spec.ts`.

**Interfaces:** no new exports; verifies `loopRates`/`liveKeys`/`update` behave.

- [ ] **Step 1: Add loopRates/liveKeys assertions**

```ts
// append to spacetype-loft-effect.unit.spec.ts
import { defaultsFromControls as dfc } from '../../app/lib/spacetype/effect'
describe('loft motion contract', () => {
  it('liveKeys are flow+spin (no rebuild on motion edits)', () => {
    expect(loftEffect.liveKeys).toEqual(expect.arrayContaining(['flow', 'spin']))
  })
  it('loopRates reflects active motions', () => {
    const p = dfc(loftEffect.controls); p.flow = 2; p.spin = 3
    expect(loftEffect.loopRates!(p).sort()).toEqual([2, 3])
    const p0 = dfc(loftEffect.controls)
    expect(loftEffect.loopRates!(p0)).toEqual([])   // static poster
  })
  it('flow offsets the ramp uniform continuously and returns home at t=1', () => {
    const p = dfc(loftEffect.controls); p.flow = 1
    const root = loftEffect.buildScene(THREE as any, p, new THREE.Texture(), { width: 800, height: 800 })
    loftEffect.update(0, p, root); const u0 = (root.userData.loftState.mat.uniforms.uFlow.value)
    loftEffect.update(0.999, p, root); const u1 = (root.userData.loftState.mat.uniforms.uFlow.value)
    expect(u0).toBeCloseTo(0); expect(u1).toBeCloseTo(0.999)
  })
})
```

- [ ] **Step 2: Run, verify pass** (adjust `loopRates` if the ordering assertion fails — sort in the test, not the impl)

Run: `npx vitest run tests/unit/spacetype-loft-effect.unit.spec.ts`
Expected: PASS.

- [ ] **Step 3: Runtime — seamless export**

In the surface, enable Seamless loop, set Flow=1 and Spin=1, and export/preview the loop. Confirm no visible jump at the wrap (the ramp sampling uses `fract`, so flow wraps cleanly; spin completes whole turns via `loopRates`). `preview_logs` for any bake errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/tests/unit/spacetype-loft-effect.unit.spec.ts frontend/app/lib/spacetype/effects/loft.ts
git commit -m "test(spacetype): loft motion + seamless-loop contract"
```

---

### Task 10: Full-suite green + end-to-end runtime proof

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite**

Run: `npm run test:unit`
Expected: no NEW failures vs. baseline. Note the collected-file total and compare (test counts here can vary run-to-run under load — check `uptime`/total files, not just a raw number). If a spacetype section test complains that `loft`'s `group` isn't a known section, fix the group name to match `sections.ts` and re-run.

- [ ] **Step 2: Typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | tail -5`
Expected: error count at or below the ~328 baseline; none naming loft/`profileStops` types.

- [ ] **Step 3: End-to-end runtime pass (the real proof)**

With the dev server up (`127.0.0.1`), walk the whole feature and capture screenshots:
1. Loft effect renders on load (helix default, fill, shape).
2. Drag stops; add/remove; change per-stop width/roll/depth/colour — form responds live.
3. Toggle stroke↔fill; adjust opacity; confirm the img-1 dense line-field look at high Copies + stroke + low opacity.
4. Switch spine presets.
5. Word mode: type a word, pick a font, confirm the word-shaped loft; toggle stroke↔fill.
6. Flat vs 3d mode.
7. Motion: Flow + Spin; Seamless export.
`read_console_messages` clean throughout. Save screenshots of: a helix ribbon (fill), a dense stroke spiral, and a word loft.

- [ ] **Step 4: Update the build dashboard**

Per the standing rule, read the LIVE ⛵ "State of the Build" artifact first (other sessions publish to it), then add the Loft effect to it and to `docs/STATE.md` if applicable.

- [ ] **Step 5: Final commit**

```bash
git add -A frontend/tests docs
git commit -m "docs(spacetype): loft effect landed — dashboard + state"
```
(Stage only loft-related files; leave other sessions' untracked work alone — `git add` specific paths, not `-A` on the whole tree.)

---

## Self-review

**Spec coverage:**
- 3D-native + flat subset → Task 5 (`mode`), Task 8 (flat+word note). ✓
- Stroke + fill toggle → Task 4/5 (`render`). ✓
- Parametric profile (width/height/radius/sides keyframed) → Tasks 3, 4, 6. ✓
- Spine = stops, preset generators → Tasks 1 (`presetStops`), 6 (editor), 7 (stamping). ✓
- `profileStops` full editor (Option B) → Task 6. ✓
- Word-as-swept-shape (global toggle, per-stop scale/roll/colour) → Task 8. ✓
- Gradient from per-stop colours → Task 2 (`buildRamp`) + Task 5 (ramp texture + shader). ✓
- Motion (flow/spin) + seamless loop → Tasks 5, 9. ✓
- Gotchas: id `loft` (T5), `stripAlpha` (T1), sync `buildScene` (T5/T8 host prefetch), `root.userData` (T5), stable ids (T1/T6), group∈sections (T5/T10). ✓

**Placeholder scan:** the two spots that require an in-repo lookup during execution are called out explicitly with the grep to run (`controlKindToVariableType` location in T6; `controlDescriptor.ts` handling in T6; the exact `scheduleRebuild` symbol in T8). These are "confirm the local name" steps, not unresolved design — acceptable, but the implementer must run the greps.

**Type consistency:** `LoftStop`, `Station`, `StopProps`, `LoftGeometry`, and the `buildLoftGeometry` options object are defined once (shared block, Tasks 1/2/4) and consumed with the same names in Tasks 5/8. `wordContoursFromShapes` / `wordContours` / `loftContours` are the exact names used in both `loft.ts` and its tests. `profileStops` kind string is identical in `effect.ts`, `SpaceTypeSurface.vue`, `controlDescriptor.ts`, and `controlKindToVariableType`.

**Known risks flagged for execution:**
- The superellipse `parametricProfileContour` is an approximation of "width/height/radius/sides"; if the visual doesn't match the references, tune the exponent mapping — the unit test only checks bounds, not exact shape.
- Fill-mode word geometry skins each contour (including holes) as its own tube wall; holes become inner walls, not capped solids. Acceptable v1; note if the user wants capped ends.
- Font prefetch (T8) assumes `scene3d/outlines` static cuts cover the chosen family. Variable-only families would need the `svgPath.pathToShapes` bridge (out of scope for v1).
