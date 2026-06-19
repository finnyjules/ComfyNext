# Streamer Type Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Streamer" Space Type effect — a faithful port of STG's ribbon generator (Streamers preset): flat per-character tiles arranged around a racetrack/oval loop, stacked into N ribbons, gradient-colored along the text, scrolling around the loop and looping seamlessly.

**Architecture:** A pure layout module (`streamerLayout.ts`) ports STG's 4-phase racetrack math + gradient banding. The effect (`streamer.ts`) builds a glyph-atlas `CanvasTexture` (chosen font, alpha matte) and one `InstancedMesh` of unit planes (count×runLength instances) with per-instance matrix/cellUV/color/side and a custom `ShaderMaterial` compositing tile face + glyph. `update(t01)` scrolls the text around the loop.

**Tech Stack:** TypeScript, Three.js (InstancedMesh + InstancedBufferAttribute + ShaderMaterial), 2D Canvas (glyph atlas), Vitest. Reference: STG `sketch_ribbon.js` (read into the spec). Patterns: `effects/sliceGlitch.ts` (module-state effect, canvas atlas, font load), `effects/ribbon.ts` (scene rotate/scale params, fills/bSide).

**Spec:** `docs/superpowers/specs/2026-06-19-streamer-type-effect-design.md`.

All commands run from `frontend/`. Unit tests: `npm run test:unit`; single file: `npx vitest run tests/unit/<file>`.

---

## File Structure

- **Create** `frontend/app/lib/spacetype/streamerLayout.ts` — pure racetrack + gradient math.
- **Create** `frontend/app/lib/spacetype/effects/streamer.ts` — the effect (atlas + instancing + shader).
- **Modify** `frontend/app/lib/spacetype/effects/index.ts` — register `streamerEffect`.
- **Create** `frontend/tests/unit/spacetype-streamer-layout.unit.spec.ts`
- **Create** `frontend/tests/unit/spacetype-streamer-effect.unit.spec.ts`

---

## Task 1: Racetrack + gradient math (`streamerLayout.ts`)

**Files:**
- Create: `frontend/app/lib/spacetype/streamerLayout.ts`
- Test: `frontend/tests/unit/spacetype-streamer-layout.unit.spec.ts`

Existing spacetype tests import via relative `../../app/lib/...` (not the `~` alias). Match that.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/spacetype-streamer-layout.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { streamerRadius, streamerCycle, tilePose, gradientColorAt } from '../../app/lib/spacetype/streamerLayout'

describe('streamerRadius / streamerCycle', () => {
  it('radius = segmentCount*segmentSpace/PI', () => {
    expect(streamerRadius(22, 23)).toBeCloseTo((22 * 23) / Math.PI)
  })
  it('cycle = 2*segmentCount*(1+middleStretch), rounded', () => {
    expect(streamerCycle(22, 0)).toBe(44)
    expect(streamerCycle(10, 1)).toBe(40)
  })
})

describe('tilePose (middleStretch 0 = oval)', () => {
  const sc = 20, ss = 10, ms = 0
  it('phase 1/2 (top + right arc) are side +1, phase 3/4 are side -1', () => {
    expect(tilePose(0, sc, ss, ms).side).toBe(1)
    expect(tilePose(sc, sc, ss, ms).side).toBe(1)          // end of arc up
    expect(tilePose(sc + 1, sc, ss, ms).side).toBe(-1)     // into return arc
  })
  it('top arc rotates 0→~PI across segmentCount steps', () => {
    expect(tilePose(0, sc, ss, ms).rot).toBeCloseTo(0)
    expect(tilePose(sc, sc, ss, ms).rot).toBeCloseTo(Math.PI)
  })
  it('return run sits a diameter (2*radius) below in y', () => {
    const r = streamerRadius(sc, ss)
    expect(tilePose(sc + 5, sc, ss, ms).y).toBeCloseTo(2 * r)
  })
  it('jumper increments once per full cycle (text longer than one loop)', () => {
    const cyc = streamerCycle(sc, ms)
    expect(tilePose(0, sc, ss, ms).jumper).toBe(0)
    expect(tilePose(cyc, sc, ss, ms).jumper).toBe(1)
  })
  it('is periodic in i modulo the cycle (same pose shape each loop)', () => {
    const cyc = streamerCycle(sc, ms)
    const a = tilePose(3, sc, ss, ms), b = tilePose(3 + cyc, sc, ss, ms)
    expect(b.x).toBeCloseTo(a.x); expect(b.rot).toBeCloseTo(a.rot); expect(b.side).toBe(a.side)
  })
})

describe('tilePose (middleStretch > 0 = racetrack straights)', () => {
  it('top straight advances x by segmentSpace per step, rot 0', () => {
    const p = tilePose(2, 10, 10, 1) // ms=1 → straightTop = 10 slots
    expect(p.rot).toBe(0); expect(p.x).toBeCloseTo(2 * 10); expect(p.side).toBe(1)
  })
})

describe('gradientColorAt', () => {
  it('single stop → that color everywhere', () => {
    expect(gradientColorAt(5, 10, ['#ff0000'])).toEqual({ r: 1, g: 0, b: 0 })
  })
  it('endpoints hit the first and last stop', () => {
    expect(gradientColorAt(0, 10, ['#000000', '#ffffff'])).toEqual({ r: 0, g: 0, b: 0 })
    const end = gradientColorAt(10, 10, ['#000000', '#ffffff'])
    expect(end.r).toBeCloseTo(1); expect(end.g).toBeCloseTo(1); expect(end.b).toBeCloseTo(1)
  })
  it('two stops lerp linearly at the midpoint', () => {
    const mid = gradientColorAt(5, 10, ['#000000', '#ffffff'])
    expect(mid.r).toBeCloseTo(0.5)
  })
  it('three stops band the run into halves', () => {
    // slot 5/10 = band boundary between stop0->1 and stop1->2 → ~stop1 (green)
    const mid = gradientColorAt(5, 10, ['#ff0000', '#00ff00', '#0000ff'])
    expect(mid.g).toBeGreaterThan(0.9)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/unit/spacetype-streamer-layout.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/spacetype/streamerLayout.ts

export interface TilePose { x: number; y: number; rot: number; side: number; textDir: number; jumper: number }
export interface Rgb { r: number; g: number; b: number }

export function streamerRadius(segmentCount: number, segmentSpace: number): number {
  return (segmentCount * segmentSpace) / Math.PI
}

/** Character slots in one full loop. */
export function streamerCycle(segmentCount: number, middleStretch: number): number {
  return Math.round(2 * segmentCount + 2 * segmentCount * middleStretch)
}

/**
 * STG ribbon 4-phase racetrack pose for character index `i` (loop-local space, before the
 * per-tile translate(0,-radius)+rotateX and ribbon offsets the effect applies). Ported verbatim
 * from sketch_ribbon.js: top straight → right semicircle → bottom straight → left semicircle.
 */
export function tilePose(i: number, segmentCount: number, segmentSpace: number, middleStretch: number): TilePose {
  const cycle = 2 * segmentCount + 2 * segmentCount * middleStretch
  const radius = streamerRadius(segmentCount, segmentSpace)
  const segmentLength = segmentCount * segmentSpace
  const sinStep = Math.PI / segmentCount
  const m = ((i % cycle) + cycle) % cycle
  const jumper = Math.floor(i / cycle)
  const straightTop = segmentCount * middleStretch
  let x: number, y: number, rot: number, side: number, textDir: number
  if (m <= straightTop) {
    x = m * segmentSpace; y = jumper * radius * 4; rot = 0; side = 1; textDir = -1
  } else if (m <= segmentCount + segmentCount * middleStretch) {
    const step = m - straightTop
    x = segmentLength * middleStretch; y = jumper * radius * 4; rot = step * sinStep; side = 1; textDir = -1
  } else if (m <= segmentCount + 2 * segmentCount * middleStretch) {
    const step = m - (straightTop + segmentCount)
    x = segmentLength * middleStretch - step * segmentSpace; y = radius * 2 + jumper * radius * 4; rot = 0; side = -1; textDir = 1
  } else {
    const step = m - (straightTop + segmentCount)
    x = 0; y = radius * 2 + jumper * radius * 4; rot = -step * sinStep + Math.PI * middleStretch; side = -1; textDir = 1
  }
  return { x, y, rot, side, textDir, jumper }
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const n = parseInt(s, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t }

/**
 * Gradient color for window slot `slot` of `runLength`, banded across `stops` (STG setGradient):
 * the run is split into stops.length-1 equal bands and lerped within each. Returns rgb in 0..1.
 */
export function gradientColorAt(slot: number, runLength: number, stops: string[]): Rgb {
  if (stops.length <= 1) return hexToRgb(stops[0] ?? '#ffffff')
  const bands = stops.length - 1
  const f = Math.min(1, Math.max(0, runLength > 0 ? slot / runLength : 0)) * bands
  const idx = Math.min(bands - 1, Math.floor(f))
  const local = f - idx
  const a = hexToRgb(stops[idx]!), b = hexToRgb(stops[idx + 1]!)
  return { r: lerp(a.r, b.r, local), g: lerp(a.g, b.g, local), b: lerp(a.b, b.b, local) }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/unit/spacetype-streamer-layout.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/streamerLayout.ts frontend/tests/unit/spacetype-streamer-layout.unit.spec.ts
git commit -m "feat(spacetype): pure Streamer racetrack + gradient math"
```

---

## Task 2: The Streamer effect (`streamer.ts`) + registration + contract test

**Files:**
- Create: `frontend/app/lib/spacetype/effects/streamer.ts`
- Modify: `frontend/app/lib/spacetype/effects/index.ts`
- Test: `frontend/tests/unit/spacetype-streamer-effect.unit.spec.ts`

### Context / patterns to follow (READ FIRST)
- `effects/sliceGlitch.ts` — module-level `state`, `n(p,k)` helper, `resolveFontFamily`/`fontHasWeightAxis` from `~/data/google-fonts`, `document.fonts.load(...).then` re-build, `mesh.userData.tex` for disposal, returning a `THREE.Group`.
- `effects/ribbon.ts` — uses `scale`, `rotateX/rotateY/rotateZ` control keys; the engine (`engine.ts:171-184`) reads `params.scale` + `params.rotateX/Y/Z` and applies them to the scene/camera. So just declare those controls.
- `fills.ts` — `parseFills(raw)` → `Fill[]` (each has `.a` hex). Reuse a `fillList` control for the gradient stops (read each `.a`).
- The Surface (`SpaceTypeSurface.vue`) only renders control groups in its `SECTION_ORDER` whitelist. Use ONLY these group names: `Type`, `Ribbon`, `Color`, `Motion`, `Transform` (all already whitelisted).

### Step 1: Write the failing contract test

```ts
// frontend/tests/unit/spacetype-streamer-effect.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { streamerEffect } from '../../app/lib/spacetype/effects/streamer'
import { getEffect, SPACE_TYPE_EFFECTS } from '../../app/lib/spacetype/effects'

describe('streamerEffect contract', () => {
  it('declares id, label, controls', () => {
    expect(streamerEffect.id).toBe('streamer')
    expect(streamerEffect.label.length).toBeGreaterThan(0)
    expect(streamerEffect.controls.length).toBeGreaterThan(0)
  })
  it('every control has a default and a unique key', () => {
    const keys = streamerEffect.controls.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const c of streamerEffect.controls) expect(c.default).toBeDefined()
  })
  it('exposes the signature controls', () => {
    const keys = streamerEffect.controls.map(c => c.key)
    for (const k of ['text', 'font', 'segmentSpace', 'segmentCount', 'ribbonHeight', 'ribbonStretch', 'ribbonCount', 'speed', 'fills', 'scale', 'rotateX']) {
      expect(keys).toContain(k)
    }
  })
  it('is registered and resolvable by id', () => {
    expect(SPACE_TYPE_EFFECTS.map(e => e.id)).toContain('streamer')
    expect(getEffect('streamer')).toBe(streamerEffect)
  })
})
```

### Step 2: Run to verify it fails

Run: `npx vitest run tests/unit/spacetype-streamer-effect.unit.spec.ts`
Expected: FAIL — module not found.

### Step 3: Create `frontend/app/lib/spacetype/effects/streamer.ts`

```ts
import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { parseFills } from '../fills'
import { resolveFontFamily } from '~/data/google-fonts'
import { tilePose, streamerCycle, streamerRadius, gradientColorAt } from '../streamerLayout'

/**
 * STREAMER — faithful port of spacetypegenerator.com/ribbon (Streamers preset). Flat per-character
 * tiles arranged around a racetrack/oval loop (ribbonStretch = straight-run length; 0 = oval),
 * stacked into `ribbonCount` ribbons, gradient-colored along the text run, scrolling around the
 * loop and looping seamlessly. Instanced: one InstancedMesh of unit planes; a glyph-atlas texture
 * supplies the letters; a custom shader composites tile face (gradient front / B-side back) + glyph
 * (text color). Layout/gradient math is pure + unit-tested (../streamerLayout).
 */

const controls: ControlSpec[] = [
  // Type
  { key: 'text', label: 'Text', kind: 'textList', default: 'THE SEA IS A DESERT OF WAVES, A WILDERNESS OF WATER. ', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'IBM Plex Mono', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 0, max: 100, step: 1, default: 25, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: 0, max: 100, step: 1, default: 40, group: 'Type' },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 6, step: 0.5, default: 2, group: 'Type' },
  // Ribbon
  { key: 'segmentSpace', label: 'Segment space', kind: 'slider', min: 4, max: 60, step: 1, default: 23, group: 'Ribbon' },
  { key: 'segmentCount', label: 'Segment count', kind: 'slider', min: 3, max: 50, step: 1, default: 22, group: 'Ribbon' },
  { key: 'ribbonHeight', label: 'Ribbon height', kind: 'slider', min: 8, max: 200, step: 1, default: 56, group: 'Ribbon' },
  { key: 'ribbonStretch', label: 'Ribbon stretch', kind: 'slider', min: 0, max: 6, step: 0.1, default: 0, group: 'Ribbon' },
  { key: 'ribbonCount', label: 'Ribbon count', kind: 'slider', min: 1, max: 10, step: 1, default: 4, group: 'Ribbon' },
  { key: 'ribbonSpacing', label: 'Ribbon spacing', kind: 'slider', min: 1, max: 3, step: 0.01, default: 1.62, group: 'Ribbon' },
  { key: 'ribbonOffset', label: 'Ribbon offset', kind: 'slider', min: 0, max: 2, step: 0.01, default: 1.3, group: 'Ribbon' },
  { key: 'alternate', label: 'Alternate', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Ribbon' },
  // Color
  { key: 'fills', label: 'Gradient stops', kind: 'fillList', default: JSON.stringify([
      { type: 'solid', a: '#FFFC79', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#FF2F92', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#011993', b: '#000', textColor: '#fff' },
      { type: 'solid', a: '#0096FF', b: '#000', textColor: '#fff' },
    ]), group: 'Color' },
  { key: 'textColor', label: 'Text color', kind: 'color', default: '#ffffff', group: 'Color' },
  { key: 'bSideColor', label: 'B-side', kind: 'color', default: '#212121', group: 'Color' },
  { key: 'noStripes', label: 'No stripes', kind: 'select', options: ['off', 'on'], default: 'off', group: 'Color' },
  // Motion
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.4, group: 'Motion' },
  // Transform (consumed by the engine)
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.01, default: 1.04, group: 'Transform' },
  { key: 'rotateX', label: 'Rotate X', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: -1.91, group: 'Transform' },
  { key: 'rotateY', label: 'Rotate Y', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0.56, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate Z', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: -0.53, group: 'Transform' },
]

const VERT = [
  'attribute vec4 aCellUV;', 'attribute vec3 aColor;', 'attribute float aSide;',
  'varying vec2 vUv; varying vec4 vCell; varying vec3 vColor; varying float vSide;',
  'void main(){',
  '  vUv = uv; vCell = aCellUV; vColor = aColor; vSide = aSide;',
  '  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);',
  '}',
].join('\n')

const FRAG = [
  'precision highp float;',
  'uniform sampler2D uAtlas; uniform vec3 uTextColor; uniform vec3 uBSide; uniform float uNoStripes;',
  'varying vec2 vUv; varying vec4 vCell; varying vec3 vColor; varying float vSide;',
  'void main(){',
  '  float a = texture2D(uAtlas, vCell.xy + vUv * vCell.zw).a;',
  '  if (uNoStripes > 0.5) {',          // glyph only, transparent tile
  '    if (a < 0.02) discard;',
  '    gl_FragColor = vec4(uTextColor, a); return;',
  '  }',
  '  vec3 face = vSide >= 0.0 ? vColor : uBSide;',
  '  gl_FragColor = vec4(mix(face, uTextColor, a), 1.0);',
  '}',
].join('\n')

function n(p: Params, k: string): number { return Number(p[k]) }
function gradientStops(p: Params): string[] {
  const fills = parseFills(p.fills)
  const cols = fills.map(f => f.a)
  return cols.length ? cols : ['#ffffff']
}
function streamerText(p: Params): string {
  // one continuous run; trailing space keeps the loop seam clean. Preserve as-typed case.
  const t = String(p.text ?? '').replace(/\n+/g, ' ')
  return t.length ? t : ' '
}

const MAX_INSTANCES = 2400   // bound: ribbonCount * runLength

interface AtlasCell { u: number; v: number; du: number; dv: number }
interface Atlas { tex: THREE.CanvasTexture; cells: Map<string, AtlasCell> }

/** White-on-transparent glyph atlas for the unique chars, in the chosen font. */
function buildAtlas(three: typeof THREE, p: Params): Atlas {
  const family = resolveFontFamily(String(p.font))
  const chars = Array.from(new Set(streamerText(p).split('')))
  const CELL = 96
  const cols = Math.ceil(Math.sqrt(chars.length))
  const rows = Math.ceil(chars.length / cols)
  const canvas = document.createElement('canvas')
  canvas.width = cols * CELL; canvas.height = rows * CELL
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const fontPx = CELL * 0.62
  ctx.font = `${fontPx}px "${family}", "IBM Plex Mono", monospace`
  const stroke = n(p, 'typeStroke')
  // typeHeight nudges the glyph vertically within the cell (STG typeY); tracking nudges x.
  const dy = (n(p, 'typeHeight') / 100) * CELL * 0.25
  const dx = (n(p, 'tracking') / 100 - 0.4) * CELL * 0.15
  const cells = new Map<string, AtlasCell>()
  chars.forEach((ch, i) => {
    const cx = (i % cols) * CELL, cy = Math.floor(i / cols) * CELL
    const gx = cx + CELL / 2 + dx, gy = cy + CELL / 2 + dy
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff'
    if (stroke > 0) { ctx.lineWidth = stroke * 2; ctx.lineJoin = 'round'; ctx.strokeText(ch, gx, gy) }
    else { ctx.fillText(ch, gx, gy) }
    cells.set(ch, { u: cx / canvas.width, v: 1 - (cy + CELL) / canvas.height, du: CELL / canvas.width, dv: CELL / canvas.height })
  })
  const tex = new three.CanvasTexture(canvas)
  tex.minFilter = three.LinearFilter; tex.magFilter = three.LinearFilter
  return { tex, cells }
}

interface State {
  three: typeof THREE
  mesh: THREE.InstancedMesh
  aCellUV: THREE.InstancedBufferAttribute
  aColor: THREE.InstancedBufferAttribute
  aSide: THREE.InstancedBufferAttribute
  atlas: Atlas
  dummy: THREE.Object3D
  W: number   // canvas/output reference
}
let state: State | null = null

/** Position every instance for loop time t01 (text scrolls around the loop). */
function layout(s: State, p: Params, t01: number): void {
  const segmentCount = Math.max(1, Math.round(n(p, 'segmentCount')))
  const segmentSpace = n(p, 'segmentSpace')
  const ms = n(p, 'ribbonStretch')
  const depth = n(p, 'ribbonHeight')
  const radius = streamerRadius(segmentCount, segmentSpace)
  const cycle = streamerCycle(segmentCount, ms)
  const count = Math.max(1, Math.round(n(p, 'ribbonCount')))
  const spacing = n(p, 'ribbonSpacing')
  const offset = n(p, 'ribbonOffset')
  const alt = String(p.alternate) === 'on'
  const txt = streamerText(p)
  const runLength = Math.min(txt.length, Math.floor(MAX_INSTANCES / count))
  // seamless scroll: whole cycles per loop, scaled by speed
  const loops = Math.max(0, Math.round(n(p, 'speed') * 4))
  const scroll = t01 * loops * cycle
  const stops = gradientStops(p)

  const dummy = s.dummy
  let inst = 0
  const total = count * runLength
  for (let j = 0; j < count; j++) {
    const ribY = alt ? (j % 2) * radius * 2 : j * offset * radius * 2
    const ribZ = j * depth * spacing
    for (let k = 0; k < runLength; k++) {
      const i = scroll + k
      const pose = tilePose(i, segmentCount, segmentSpace, ms)
      // STG per-tile: translate(x, y+ribY, ribZ) -> rotateZ(rot) -> translate(0,-radius) -> rotateX(PI/2)
      dummy.position.set(pose.x, pose.y + ribY, ribZ)
      dummy.rotation.set(0, 0, 0)
      dummy.rotateZ(pose.rot); dummy.translateY(-radius); dummy.rotateX(Math.PI / 2)
      dummy.scale.set(segmentSpace, depth, 1)
      dummy.updateMatrix()
      s.mesh.setMatrixAt(inst, dummy.matrix)
      // glyph: text scrolls so slot k shows char (runLength-1-k) shifted by scroll
      const ti = ((Math.round(i) % txt.length) + txt.length) % txt.length
      const cell = s.atlas.cells.get(txt[ti]!) ?? s.atlas.cells.values().next().value
      s.aCellUV.setXYZW(inst, cell!.u, cell!.v, cell!.du, cell!.dv)
      const col = gradientColorAt(k, runLength, stops)
      s.aColor.setXYZ(inst, col.r, col.g, col.b)
      s.aSide.setX(inst, pose.side)
      inst++
    }
  }
  s.mesh.count = total
  s.mesh.instanceMatrix.needsUpdate = true
  s.aCellUV.needsUpdate = true; s.aColor.needsUpdate = true; s.aSide.needsUpdate = true
  // center the loop in view: shift the whole mesh up by ~half a loop height
  s.mesh.position.set(-segmentSpace * segmentCount * ms / 2, -radius, 0)
}

export const streamerEffect: SpaceTypeEffect = {
  id: 'streamer',
  label: 'Streamer',
  controls,

  buildScene(three, params, _textTexture) {
    void _textTexture
    state = null
    const root = new three.Group()

    const atlas = buildAtlas(three, params)
    const geo = new three.PlaneGeometry(1, 1)
    const aCellUV = new three.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 4), 4)
    const aColor = new three.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3)
    const aSide = new three.InstancedBufferAttribute(new Float32Array(MAX_INSTANCES), 1)
    geo.setAttribute('aCellUV', aCellUV)
    geo.setAttribute('aColor', aColor)
    geo.setAttribute('aSide', aSide)

    const uniforms = {
      uAtlas: { value: atlas.tex as THREE.Texture },
      uTextColor: { value: new three.Color(String(params.textColor)) },
      uBSide: { value: new three.Color(String(params.bSideColor)) },
      uNoStripes: { value: String(params.noStripes) === 'on' ? 1 : 0 },
    }
    const mat = new three.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, side: three.DoubleSide, transparent: true })
    const mesh = new three.InstancedMesh(geo, mat, MAX_INSTANCES)
    mesh.frustumCulled = false
    mesh.userData.tex = atlas.tex
    root.add(mesh)

    state = { three, mesh, aCellUV, aColor, aSide, atlas, dummy: new three.Object3D(), W: 1500 }
    layout(state, params, 0)

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    if (fonts && typeof fonts.load === 'function') {
      const family = resolveFontFamily(String(params.font))
      fonts.load(`40px "${family}"`).then(() => {
        if (state && state.mesh === mesh) {
          const next = buildAtlas(three, params)
          state.atlas.tex.dispose()
          state.atlas = next
          ;(mesh.material as THREE.ShaderMaterial).uniforms.uAtlas.value = next.tex
          mesh.userData.tex = next.tex
          layout(state, params, 0)
        }
      }).catch(() => {})
    }
    return root
  },

  update(t01, params) {
    if (!state) return
    const mat = state.mesh.material as THREE.ShaderMaterial
    mat.uniforms.uTextColor.value.set(String(params.textColor))
    mat.uniforms.uBSide.value.set(String(params.bSideColor))
    mat.uniforms.uNoStripes.value = String(params.noStripes) === 'on' ? 1 : 0
    layout(state, params, t01)
  },
}
```

### Step 4: Register in `effects/index.ts`

Add `import { streamerEffect } from './streamer'` near the other effect imports and append `streamerEffect` as the LAST element of `SPACE_TYPE_EFFECTS`. Do not reorder existing entries.

### Step 5: Run contract test + full suite

- `npx vitest run tests/unit/spacetype-streamer-effect.unit.spec.ts` → PASS
- `npm run test:unit` → PASS (no regressions). Note: `buildScene`/`update` aren't exercised by unit tests (need WebGL); only the contract + the pure layout are.

### Step 6: Typecheck

Run `npx tsc --noEmit --skipLibCheck` (no `typecheck` script exists). Ensure no NEW errors in the new files; ignore pre-existing unrelated errors.

### Step 7: Commit

```bash
git add frontend/app/lib/spacetype/effects/streamer.ts frontend/app/lib/spacetype/effects/index.ts frontend/tests/unit/spacetype-streamer-effect.unit.spec.ts
git commit -m "feat(spacetype): Streamer effect (STG ribbon racetrack, instanced tiles)"
```

### Implementation notes (the screenshot loop will refine these)
- The `instanceMatrix` attribute is auto-provided by three for `InstancedMesh` + `ShaderMaterial` (USE_INSTANCING) — the vertex shader uses it directly.
- The centering shift in `layout` (`mesh.position`) is a first guess; tune it (and `scale`) in the screenshot loop so the loop frames like STG.
- If glyphs render mirrored/upside-down on the back face, that's `side`/`rotateX` orientation — adjust in the screenshot loop; the math is in `layout`, not the pure module.

---

## Task 3: Visual tuning (screenshot loop)

Per the standing rule (`feedback_verify_visuals_with_screenshots`): never ship a WebGL effect on unit tests alone.

- [ ] **Step 1:** Add `streamer` to the dev harness. Reuse `frontend/app/pages/sgtest.vue` (or add a tiny `streamertest.vue` mirroring it) that builds a `SpaceTypeEngine` with `streamerEffect` and exposes a `t01` scrubber + `__sg.set(params)`. Start the dev server (`frontend-sg` launch config) and load it via the preview tools.
- [ ] **Step 2:** Render the Streamer-preset defaults; screenshot at a few `t01` values. Compare to the STG Streamers look (4 stacked ovals, gradient yellow→pink→blue→cyan along the text, dark bg, ~3D tilt). Tune: centering/scale, `rotateX/Y/Z`, ribbon spacing/offset, glyph size (typeHeight) and atlas `fontPx`, B-side visibility.
- [ ] **Step 3:** Verify it animates (text scrolls around the loop) and **loops seamlessly** (compare `t01=0` vs `t01≈1` — sub-pixel delta).
- [ ] **Step 4:** Present screenshots for look sign-off. Fix orientation/centering bugs found here (in `layout`/`buildAtlas`, not the pure module).
- [ ] **Step 5:** Commit any default-value/centering tweaks.

```bash
git add frontend/app/lib/spacetype/effects/streamer.ts
git commit -m "feat(spacetype): tune Streamer defaults/centering to the STG reference"
```

---

## Task 4: In-app verification

- [ ] **Step 1:** In the running app, open a Space Type node → SpaceTypeSurface → pick "Streamer". Confirm controls render grouped (Type/Ribbon/Color/Motion/Transform) and drive the preview live.
- [ ] **Step 2:** Confirm animate scrolls + loops; adjust ribbon count/stretch to confirm racetrack vs oval; toggle No stripes / B-side.
- [ ] **Step 3:** Trigger Bake; confirm a PNG sequence exports (reuses existing motion-bake rails).
- [ ] **Step 4:** Report with screenshots; get final sign-off.

---

## Self-Review (completed during planning)

- **Spec coverage:** racetrack 4-phase math (Task 1 `tilePose`); radius/cycle (Task 1); gradient banding (Task 1 `gradientColorAt`); instanced flat tiles + glyph atlas + shader (Task 2); front=gradient/back=bSide/glyph=textColor + noStripes (Task 2 FRAG); ribbon count/spacing/offset/alternate (Task 2 `layout`); scroll + seamless loop (Task 2 `layout` whole-cycle scroll); font picker + font-load rebuild (Task 2 `buildAtlas`); scene rotate/scale via engine params (Task 2 controls); Streamer preset defaults (Task 2 controls); verification (Tasks 3-4). All covered.
- **Placeholder scan:** no TBD/TODO; all code present. The Task 2 "implementation notes" flag things the screenshot loop refines (orientation/centering) — these are tuning, not missing code.
- **Type consistency:** `tilePose`/`streamerRadius`/`streamerCycle`/`gradientColorAt` signatures match between Task 1 definitions and Task 2 calls; `streamerEffect` id/controls match the contract test; `AtlasCell`/`Atlas`/`State` used consistently within Task 2.
