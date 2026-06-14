# Space Type Ribbon v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebuild `effects/ribbon.ts` into STG's real ribbon — a snaking, two-sided (gradient front / solid back) swept ribbon — and bring STG's full control set across, with no change to the Space Type engine seam, bake, or timeline/export wiring.

**Architecture:** Same `SpaceTypeEffect` contract. New pure geometry-data generator + gradient/scroll math (unit-tested). A two-sided `onBeforeCompile` material keyed on `gl_FrontFacing`. Engine gains camera Rotate X/Y/Z + Scale. Surface gains a font dropdown (new `font` control kind), tracking/type-height/stroke, and gradient stops; it loads the chosen variable font before building/baking.

**Tech Stack:** Vue 3 + TS (Nuxt 4), Three.js ^0.171 (installed), Vitest (`tests/unit/*.unit.spec.ts`, `environment: node`), pnpm. Test cmd: `cd frontend && npm run test:unit -- <filter>`.

**Key existing pieces:**
- `frontend/app/lib/spacetype/effect.ts` — `SpaceTypeEffect`, `ControlSpec`, `Params`, `defaultsFromControls`.
- `frontend/app/lib/spacetype/textTexture.ts` — `makeTextTexture`, `axesToVariation`.
- `frontend/app/lib/spacetype/engine.ts` — `SpaceTypeEngine`, `renderFrame(index, params)` applies `camera.rotation.x = params.cameraTilt`.
- `frontend/app/lib/spacetype/effects/ribbon.ts` — v1 (stacked rows) to be REPLACED.
- `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — surface; `texOpts()` hardcodes Inter.
- `frontend/app/data/variable-fonts.ts` — `VARIABLE_FONTS: VariableFont[]` ({id,label,family,cssUrl,axes:FontAxis[]}).
- `frontend/app/composables/useTemplateFonts.ts` — `useGoogleFontPreview()` for loading Google font CSS.

---

## File Structure

**Create:**
- `frontend/app/lib/spacetype/ribbonGeometry.ts` — pure geometry-data + per-ribbon transform + scroll math.
- `frontend/app/lib/spacetype/gradient.ts` — pure gradient-stop resolution + ramp canvas builder.
- Tests: `tests/unit/spacetype-ribbon-geometry.unit.spec.ts`, `tests/unit/spacetype-gradient.unit.spec.ts`.

**Modify:**
- `frontend/app/lib/spacetype/effect.ts` — add `font` ControlSpec kind.
- `frontend/app/lib/spacetype/textTexture.ts` — type height, tracking, stroke.
- `frontend/app/lib/spacetype/engine.ts` — camera Rotate X/Y/Z + Scale.
- `frontend/app/lib/spacetype/effects/ribbon.ts` — full v2 rewrite.
- `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — font dropdown, font loading, new texOpts, gradient controls.
- Tests: extend `tests/unit/spacetype-effect.unit.spec.ts` (font kind + ribbon contract).

---

## Task 1: `font` ControlSpec kind

**Files:** Modify `frontend/app/lib/spacetype/effect.ts`; Test `tests/unit/spacetype-effect.unit.spec.ts`.

- [ ] **Step 1: Failing test** — append to `spacetype-effect.unit.spec.ts`:

```typescript
import { defaultsFromControls as dfc2 } from '../../app/lib/spacetype/effect'
describe('font control kind', () => {
  it('contributes its default like any control', () => {
    expect(dfc2([{ key: 'font', label: 'Font', kind: 'font', default: 'inter' }])).toEqual({ font: 'inter' })
  })
})
```

- [ ] **Step 2: Run** `cd frontend && npm run test:unit -- spacetype-effect` → FAIL (font kind not in union).

- [ ] **Step 3: Implement** — in `effect.ts`, add to the `ControlSpec` union:

```typescript
  | { key: string; label: string; kind: 'font'; default: string }
```

`defaultsFromControls` already iterates `c.default`, so no change there.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(spacetype): add 'font' ControlSpec kind`.

---

## Task 2: Pure ribbon geometry + transforms + scroll

**Files:** Create `frontend/app/lib/spacetype/ribbonGeometry.ts`; Test `tests/unit/spacetype-ribbon-geometry.unit.spec.ts`.

- [ ] **Step 1: Failing test**:

```typescript
import { describe, it, expect } from 'vitest'
import { snakePoint, buildRibbonGeometryData, ribbonInstance, scrollU, type RibbonGeoParams } from '../../app/lib/spacetype/ribbonGeometry'

const P: RibbonGeoParams = { segments: 8, length: 16, amplitude: 3, frequency: 1.5, height: 1, uRepeat: 6, phase: 0 }

describe('snakePoint', () => {
  it('centers x and applies the sine in y', () => {
    const a = snakePoint(0, P), b = snakePoint(1, P)
    expect(a.x).toBeCloseTo(-P.length / 2, 6)
    expect(b.x).toBeCloseTo(P.length / 2, 6)
    expect(snakePoint(0, P).y).toBeCloseTo(P.amplitude * Math.sin(0), 6)
  })
})

describe('buildRibbonGeometryData', () => {
  const g = buildRibbonGeometryData(P)
  it('emits two vertices per sample', () => {
    expect(g.positions.length).toBe((P.segments + 1) * 2 * 3) // xyz
    expect(g.uvs.length).toBe((P.segments + 1) * 2 * 2)
  })
  it('emits 6 indices per segment (two triangles)', () => {
    expect(g.indices.length).toBe(P.segments * 6)
  })
  it('U spans 0..uRepeat, V is 0 or 1', () => {
    let maxU = 0; const vs = new Set<number>()
    for (let i = 0; i < g.uvs.length; i += 2) { maxU = Math.max(maxU, g.uvs[i]); vs.add(Math.round(g.uvs[i + 1])) }
    expect(maxU).toBeCloseTo(P.uRepeat, 6)
    expect([...vs].sort()).toEqual([0, 1])
  })
})

describe('ribbonInstance', () => {
  it('alternate negates the snake direction on odd ribbons', () => {
    expect(ribbonInstance(0, { count: 3, spacing: 1, offset: 0.2, alternate: true }).dir).toBe(1)
    expect(ribbonInstance(1, { count: 3, spacing: 1, offset: 0.2, alternate: true }).dir).toBe(-1)
  })
  it('centers ribbons around 0 in y', () => {
    const mid = ribbonInstance(1, { count: 3, spacing: 2, offset: 0, alternate: false })
    expect(mid.y).toBeCloseTo(0, 6)
  })
})

describe('scrollU', () => {
  it('is seamless: wraps equal at t01=0 and t01=1', () => {
    const wrap = (x: number) => x - Math.floor(x)
    expect(wrap(scrollU(1, 2))).toBeCloseTo(wrap(scrollU(0, 2)), 6)
  })
})
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement** `ribbonGeometry.ts`:

```typescript
const TAU = Math.PI * 2

export interface RibbonGeoParams {
  segments: number   // path subdivisions (Segment Count)
  length: number     // ribbon length along X (Ribbon Stretch)
  amplitude: number  // snake Y amplitude
  frequency: number  // snake sine periods across the length
  height: number     // band width (Ribbon Height)
  uRepeat: number    // how many text tiles along the length
  phase: number      // snake phase (radians)
}

export interface RibbonGeoData {
  positions: Float32Array
  uvs: Float32Array
  indices: Uint32Array
}

/** Centerline point at t in [0,1]. z=0; band 'across' is world Z. */
export function snakePoint(t: number, p: RibbonGeoParams): { x: number; y: number; z: number } {
  return { x: (t - 0.5) * p.length, y: p.amplitude * Math.sin(TAU * p.frequency * t + p.phase), z: 0 }
}

/** Build a swept-band geometry: 2 verts per sample, band width along world Z. */
export function buildRibbonGeometryData(p: RibbonGeoParams): RibbonGeoData {
  const n = Math.max(1, Math.floor(p.segments))
  const verts = (n + 1) * 2
  const positions = new Float32Array(verts * 3)
  const uvs = new Float32Array(verts * 2)
  const half = p.height / 2
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const c = snakePoint(t, p)
    const a = i * 2, b = i * 2 + 1
    // top vertex (+z), bottom vertex (-z)
    positions[a * 3] = c.x; positions[a * 3 + 1] = c.y; positions[a * 3 + 2] = c.z + half
    positions[b * 3] = c.x; positions[b * 3 + 1] = c.y; positions[b * 3 + 2] = c.z - half
    const u = t * p.uRepeat
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
  return { positions, uvs, indices }
}

export interface RibbonInstanceParams { count: number; spacing: number; offset: number; alternate: boolean }
export interface RibbonInstance { y: number; phase: number; dir: 1 | -1 }

/** Per-ribbon transform: centered Y stack, phase offset, alternating direction. */
export function ribbonInstance(i: number, p: RibbonInstanceParams): RibbonInstance {
  const n = Math.max(1, Math.floor(p.count))
  const center = (n - 1) / 2
  const dir: 1 | -1 = p.alternate && i % 2 === 1 ? -1 : 1
  return { y: (i - center) * p.spacing, phase: i * p.offset * TAU, dir }
}

/** Seamless text scroll along U: integer cycles per loop ⇒ frame 0 == loop end. */
export function scrollU(t01: number, speed: number): number {
  return t01 * speed
}
```

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(spacetype): pure snaking-ribbon geometry + instance/scroll math`.

---

## Task 3: Gradient ramp

**Files:** Create `frontend/app/lib/spacetype/gradient.ts`; Test `tests/unit/spacetype-gradient.unit.spec.ts`.

- [ ] **Step 1: Failing test**:

```typescript
import { describe, it, expect } from 'vitest'
import { resolveStops, type GradientStop } from '../../app/lib/spacetype/gradient'

describe('resolveStops', () => {
  it('keeps only enabled stops, in order, with positions 0..1', () => {
    const stops: GradientStop[] = [
      { color: '#ff0000', on: true }, { color: '#00ff00', on: false }, { color: '#0000ff', on: true },
    ]
    const r = resolveStops(stops)
    expect(r.map(s => s.color)).toEqual(['#ff0000', '#0000ff'])
    expect(r[0].pos).toBeCloseTo(0, 6)
    expect(r[1].pos).toBeCloseTo(1, 6)
  })
  it('falls back to a single stop when only one is enabled', () => {
    const r = resolveStops([{ color: '#abcdef', on: true }, { color: '#000', on: false }])
    expect(r).toEqual([{ color: '#abcdef', pos: 0 }])
  })
  it('returns [] when none enabled', () => {
    expect(resolveStops([{ color: '#fff', on: false }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `gradient.ts`:

```typescript
import * as THREE from 'three'

export interface GradientStop { color: string; on: boolean }
export interface ResolvedStop { color: string; pos: number }

/** Enabled stops, evenly spaced 0..1 in declaration order. */
export function resolveStops(stops: GradientStop[]): ResolvedStop[] {
  const on = stops.filter(s => s.on)
  if (on.length === 0) return []
  if (on.length === 1) return [{ color: on[0].color, pos: 0 }]
  return on.map((s, i) => ({ color: s.color, pos: i / (on.length - 1) }))
}

/** A 256x1 horizontal gradient texture (sampled by U). Browser-only. */
export function makeGradientTexture(stops: GradientStop[], fallback: string): THREE.CanvasTexture {
  const resolved = resolveStops(stops)
  const canvas = document.createElement('canvas')
  canvas.width = 256; canvas.height = 1
  const ctx = canvas.getContext('2d')!
  if (resolved.length <= 1) {
    ctx.fillStyle = resolved[0]?.color ?? fallback
    ctx.fillRect(0, 0, 256, 1)
  } else {
    const g = ctx.createLinearGradient(0, 0, 256, 0)
    for (const s of resolved) g.addColorStop(s.pos, s.color)
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 1)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping; tex.needsUpdate = true
  return tex
}
```

- [ ] **Step 4: Run** → PASS (the pure `resolveStops`; `makeGradientTexture` is browser-only, not tested). **Step 5: Commit** `feat(spacetype): gradient stop resolution + ramp texture`.

---

## Task 4: Text texture — type height, tracking, stroke

**Files:** Modify `frontend/app/lib/spacetype/textTexture.ts`; Test extend `tests/unit/spacetype-ribbon-math.unit.spec.ts` (the `axesToVariation` home) only if a new pure helper is added; otherwise manual.

- [ ] **Step 1:** Extend `TextTextureOptions` with `tracking?: number` (px letter-spacing), `strokeColor?: string`, `strokeWidth?: number` (px). `fontSizePx` already exists (Type Height maps to it).

- [ ] **Step 2:** In `makeTextTexture`, after setting `ctx.font` (both measure and draw passes), set `ctx.letterSpacing = `${tracking||0}px`` (guarded by `'letterSpacing' in ctx`). When `strokeWidth > 0`, set `ctx.lineWidth = strokeWidth; ctx.strokeStyle = strokeColor; ctx.strokeText(label, 0, h/2)` before/after `fillText` (stroke first, then fill on top). Keep existing variation-settings handling.

- [ ] **Step 3:** Type-check: `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i textTexture || echo "no textTexture type errors"`. Run `npm run test:unit -- spacetype` (existing pass). **Commit** `feat(spacetype): text texture supports tracking + stroke`.

> No new unit test (canvas-bound). `axesToVariation` test still covers the pure part.

---

## Task 5: Engine camera Rotate X/Y/Z + Scale

**Files:** Modify `frontend/app/lib/spacetype/engine.ts`.

- [ ] **Step 1:** In `renderFrame(index, params)`, replace the single tilt line:

```typescript
    this.camera.rotation.x = Number(params.cameraTilt ?? 0)
```

with applying three-axis rotation to the scene root and scale via camera dolly:

```typescript
    this.scene.rotation.set(Number(params.rotateX ?? 0), Number(params.rotateY ?? 0), Number(params.rotateZ ?? 0))
    const scale = Number(params.scale ?? 1) || 1
    this.camera.position.z = 14 / scale   // larger scale ⇒ closer ⇒ bigger
```

(Keep `camera.position.x/y = 0`.) Rotating the scene root keeps the camera framing stable while the ribbon turns, matching STG's Rotate X/Y/Z.

- [ ] **Step 2:** Type-check engine (`grep -i spacetype/engine`), run `npm run test:unit -- spacetype` (green). **Commit** `feat(spacetype): engine camera rotate X/Y/Z + scale`.

> Manual: verified live in Task 8.

---

## Task 6: Ribbon v2 effect (geometry + two-sided gradient material)

**Files:** Rewrite `frontend/app/lib/spacetype/effects/ribbon.ts`; Test extend `tests/unit/spacetype-effect.unit.spec.ts` (contract).

- [ ] **Step 1: Update the contract test** — replace the v1 `ribbonEffect contract` `exposes the STG signature controls` key list with v2 keys:

```typescript
    for (const k of ['text', 'font', 'ribbonCount', 'segmentCount', 'speed', 'rotateX', 'gradientMode']) {
      expect(keys).toContain(k)
    }
```

(keep the id/label/unique-keys/defaults assertions).

- [ ] **Step 2: Run** `npm run test:unit -- spacetype-effect` → FAIL (keys missing).

- [ ] **Step 3: Implement v2** `effects/ribbon.ts`. Controls (declare all; the surface auto-builds them):

```typescript
const controls: ControlSpec[] = [
  { key: 'text', label: 'Text', kind: 'text', default: 'SPACE TYPE' },
  { key: 'font', label: 'Font', kind: 'font', default: 'inter' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 180 },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0 },
  { key: 'typeStroke', label: 'Type stroke', kind: 'slider', min: 0, max: 12, step: 0.5, default: 0 },
  { key: 'ribbonHeight', label: 'Ribbon height', kind: 'slider', min: 0.4, max: 3, step: 0.05, default: 1.1 },
  { key: 'ribbonStretch', label: 'Ribbon stretch', kind: 'slider', min: 8, max: 36, step: 0.5, default: 18 },
  { key: 'ribbonCount', label: 'Ribbon count', kind: 'slider', min: 1, max: 12, step: 1, default: 1 },
  { key: 'ribbonSpacing', label: 'Ribbon spacing', kind: 'slider', min: 0.6, max: 4, step: 0.05, default: 2 },
  { key: 'ribbonOffset', label: 'Ribbon offset', kind: 'slider', min: 0, max: 1, step: 0.01, default: 0.2 },
  { key: 'alternate', label: 'Alternate', kind: 'select', options: ['on', 'off'], default: 'on' },
  { key: 'segmentCount', label: 'Segment count', kind: 'slider', min: 16, max: 240, step: 2, default: 120 },
  { key: 'snakeAmplitude', label: 'Snake amount', kind: 'slider', min: 0, max: 6, step: 0.05, default: 2.4 },
  { key: 'snakeFrequency', label: 'Snake freq', kind: 'slider', min: 0.5, max: 5, step: 0.1, default: 1.5 },
  { key: 'speed', label: 'Speed', kind: 'slider', min: 0, max: 3, step: 0.05, default: 0.6 },
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1.2 },
  { key: 'rotateX', label: 'Rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: -0.5 },
  { key: 'rotateY', label: 'Rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0 },
  { key: 'rotateZ', label: 'Rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0 },
  { key: 'gradientMode', label: 'Gradient', kind: 'select', options: ['on', 'off'], default: 'on' },
  { key: 'typeColor', label: 'Type / A-side', kind: 'color', default: '#f5f5f7' },
  { key: 'bSideColor', label: 'B-side', kind: 'color', default: '#0a0a0c' },
]
```

`buildScene(three, params, textTexture)`:
- Read `gradientTexture` off `textTexture.userData.gradient` if the surface attached one (see Task 7), else null.
- For `i` in `ribbonCount`: build geometry via `buildRibbonGeometryData({ segments: segmentCount, length: ribbonStretch, amplitude: snakeAmplitude*inst.dir, frequency: snakeFrequency, height: ribbonHeight, uRepeat: <derived>, phase: inst.phase })` where `inst = ribbonInstance(i, {count, spacing, offset, alternate})`. Create a `BufferGeometry`, set `position` (3) + `uv` (2) attributes + index. Clone the text texture per ribbon (independent scroll offset). Material = `ribbonMaterial(tex, gradientTex, bSideColor, gradientMode, uniforms)`. Mesh at `position.y = inst.y`. Push `{ mesh, tex, uniforms }`.

`ribbonMaterial` — two-sided shader via `onBeforeCompile` (MeshBasicMaterial, `side: DoubleSide`):
- vertex: pass `vUv` (already available via `#include <uv_vertex>`); inject a `varying` if needed.
- fragment: after the base map sample, branch:
```glsl
// front (gl_FrontFacing): text * gradient (or flat A-side); back: solid B-side
```
Inject uniforms `uGradient` (sampler2D), `uUseGradient` (float), `uBSide` (vec3), `uAside` (vec3). Replace the fragment's color output so:
- if `!gl_FrontFacing` → `gl_FragColor = vec4(uBSide, 1.0)`.
- else → `vec3 a = uUseGradient > 0.5 ? texture2D(uGradient, vec2(vUv.x, 0.5)).rgb : uAside; gl_FragColor = vec4(a, texColor.a)` where `texColor` is the text map sample (its alpha masks the glyphs). (Adjust to the actual MeshBasicMaterial fragment include points: inject after `#include <map_fragment>` using `diffuseColor`.)

`update(t01, params)`:
- For each ribbon `i`: `inst = ribbonInstance(i, ...)`; set `tex.offset.x = -scrollU(t01, speed) * uRepeat * inst.dir`. Camera params (rotateX/Y/Z, scale) are read by the engine — nothing to do here for them.

Re-export `buildRibbonLabel`.

- [ ] **Step 4: Run** `npm run test:unit -- spacetype-effect` (contract passes) + type-check ribbon. **Step 5: Commit** `feat(spacetype): ribbon v2 — snaking two-sided gradient ribbon`.

> The shader injection points must match three r0.171 MeshBasicMaterial chunks (`map_fragment`, `dithering_fragment`). The implementer verifies the wave appears front/back correctly in Task 8 (manual). If `gl_FrontFacing` branching is awkward in MeshBasicMaterial, an acceptable alternative is two meshes sharing geometry (front `side: FrontSide` text+gradient, back `side: BackSide` solid) — note which approach was used.

---

## Task 7: Surface — font dropdown, font loading, new texOpts, gradient controls

**Files:** Modify `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`.

- [ ] **Step 1: Font dropdown.** In the control panel `v-for`, add a branch for `c.kind === 'font'` rendering a `<select v-model="params[c.key]" @change="onFontChange">` populated from `VARIABLE_FONTS` (`<option :value="f.id">{{ f.label }}</option>`). Import `VARIABLE_FONTS` from `~/data/variable-fonts`.

- [ ] **Step 2: Font loading.** Add `async function ensureFont(id)` that finds the `VARIABLE_FONTS` entry, injects its `cssUrl` as a `<link rel="stylesheet">` once (dedupe by id), and `await document.fonts.load(\`700 32px "\${family}"\`)`. Call it (await) before `rebuild()` in `onFontChange`, in `onMounted` (for the default font), and at the start of `addToTimeline`/`savePoster` so the bake uses a loaded font.

- [ ] **Step 3: texOpts from params.** Rewrite `texOpts()` to read the chosen font + new type controls:

```typescript
function texOpts() {
  const f = VARIABLE_FONTS.find(v => v.id === params.font) ?? VARIABLE_FONTS[0]
  return {
    label: buildRibbonLabel(String(params.text), 'upper'),
    fontFamily: f.family,
    fontWeight: 700,
    axes: { wght: 700 },
    typeColor: String(params.typeColor),
    fontSizePx: Number(params.typeHeight),
    tracking: Number(params.tracking),
    strokeColor: '#000000',
    strokeWidth: Number(params.typeStroke),
  }
}
```

- [ ] **Step 4: Gradient texture.** In `rebuild()`, build the gradient texture from the four stop controls and attach it to the text texture's `userData.gradient` so the effect can read it — OR pass it through a small surface→effect channel. Simplest: after `engine.build`, the effect already cloned the text texture; instead, build the gradient in the surface and stash on a module-scoped ref the effect reads via `textTexture.userData`. Concretely: extend `texOpts`/`makeTextTexture` to accept `gradientStops` and have `makeTextTexture` attach `tex.userData.gradient = makeGradientTexture(stops, typeColor)` when stops are provided. Add four `stopN`/`stopNOn` reactive controls in the panel (color + checkbox) and pass them.

- [ ] **Step 5: Watches.** `params.font`, `params.ribbonCount`, `params.segmentCount`, `params.ribbonStretch`, `params.ribbonHeight`, `params.snakeAmplitude`, `params.snakeFrequency`, `params.ribbonSpacing`, `params.ribbonOffset`, `params.alternate`, and the gradient stops are STRUCTURAL → `watch` them to call `rebuild()` (await `ensureFont` for the font one). Live-only params (speed, scale, rotateX/Y/Z, typeColor, bSideColor, gradientMode) need no rebuild (read each frame / cheap uniform updates — for color/gradient toggles that affect the material, a rebuild is acceptable for v2).

- [ ] **Step 6:** Type-check the SFC; `npm run test:unit -- spacetype` green. **Commit** `feat(spacetype): surface font picker + type/gradient controls for ribbon v2`.

> Manual-verified in Task 8. Keep edits coherent with the v1 surface structure (engine lifecycle, preview RAF, bake/poster handlers unchanged).

---

## Task 8: Manual verification + memory

- [ ] **Step 1:** Ensure `SPACE_TYPE_ENABLED` is `true` locally (it currently is, uncommitted). Run `cd frontend && npm run dev` (a server may already be on 3002) + ComfyUI.
- [ ] **Step 2:** Add → Space Type. Verify: a single ribbon snakes through space; the back face is the solid B-side color; the front shows text with the gradient; **Font** dropdown changes the typeface; Type height / Tracking / Stroke affect the text; Ribbon count/spacing/offset/alternate multiply and stagger ribbons; Rotate X/Y/Z + Scale move the camera; Speed scrolls the text; Gradient on/off works.
- [ ] **Step 3:** Add to timeline → export → confirm the ribbon renders in the video (external `motion_bake` path). Save poster. Toggle transparent → alpha composite.
- [ ] **Step 4:** Confirm the loop is seamless (no jump at wrap).
- [ ] **Step 5:** Run the full suite `cd frontend && npm run test:unit` → all green. Type-check spacetype files clean.
- [ ] **Step 6:** Update `project_space_type_ribbon` memory: ribbon is now the STG-faithful snaking two-sided gradient model; full control set; presets still pending; v1 stacked-rows replaced.
- [ ] **Step 7:** Tune defaults from what looks right in-app; commit any default tweaks.

---

## Self-Review Notes
- **Spec coverage:** font kind (T1), geometry (T2), gradient (T3), type controls (T4), camera (T5), v2 effect + two-sided material (T6), surface/font-loading/gradient UI (T7), verify+memory (T8). All spec sections map to a task.
- **Type consistency:** `RibbonGeoParams`/`RibbonInstanceParams` (T2) consumed in T6; `GradientStop` (T3) used by T6/T7; `TextTextureOptions` (T4) shape matches `texOpts()` (T7); `font` ControlSpec (T1) rendered by T7.
- **Unchanged contracts:** `SpaceTypeEffect`, engine bake, `sourceKey`, `bake.ts`, `default.vue` wiring — none modified (engine gains camera params only; renderFrame signature unchanged).
- **Soft spots flagged:** the `gl_FrontFacing` material injection (T6) and the gradient-texture surface→effect channel (T7) are the two integration risks; both have inline fallbacks and are manually verified in T8.
