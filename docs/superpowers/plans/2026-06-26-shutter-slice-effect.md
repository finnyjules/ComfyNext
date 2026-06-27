# Shutter Slice Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Type Studio effect `shutter` that slices baked text into horizontal bands and shears slice-groups sideways (with optional vertical gaps), driven by one master `progress` knob that supports static and animated modes.

**Architecture:** 2D-matte → fragment-shader displacement, cloned from the `tear.ts` pattern. A flat `PlaneGeometry` carries a `ShaderMaterial` that samples the pre-baked alpha text atlas (`uText`); the shader computes a per-band horizontal shift (from a selectable pattern) and an optional per-band vertical gap, then colors the matte with `uTextColor` over `uBg`. No geometry per slice — bands are computed in-shader, so slice count is a live uniform.

**Tech Stack:** TypeScript, Three.js (`ShaderMaterial` GLSL), Vitest for unit tests. Frontend at `frontend/`.

## Global Constraints

- Effect `id` MUST match `/^[a-z0-9]+$/` (lowercase letters + digits only) — the backend rejects other ids, breaking thumbnail/default saves. Use `shutter`.
- Every control's `group` MUST be a member of `SPACE_TYPE_SECTIONS` (`frontend/app/lib/spacetype/sections.ts`) or the control is silently hidden. A unit test guards this.
- No purple/violet accents anywhere (project rule). N/A to this effect's shader (black/white default) but keep any defaults neutral.
- Visual effects MUST be verified with rendered screenshots before being called done — never ship on unit tests alone (project rule).
- `update(t01, params)` must be pure in `t01`. The engine applies `scale`/`rotateX/Y/Z` globally from params (`engine.ts:204-205`) — the effect must NOT also apply them.

---

### Task 1: Add the `Slice` control section

**Files:**
- Modify: `frontend/app/lib/spacetype/sections.ts:9-13`
- Test: `frontend/tests/unit/spacetype-sections.unit.spec.ts` (add one assertion)

**Interfaces:**
- Consumes: nothing.
- Produces: `'Slice'` as a renderable section name, used by Task 2's controls.

- [ ] **Step 1: Write the failing test**

Add this `it` block to `frontend/tests/unit/spacetype-sections.unit.spec.ts` (after the existing `'SPACE_TYPE_SECTIONS has no duplicates'` test, inside the same `describe`):

```typescript
  it('includes the Slice section (used by the shutter effect)', () => {
    expect(allowed.has('Slice')).toBe(true)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-sections.unit.spec.ts -t "Slice section"`
Expected: FAIL — `expected false to be true` (the section isn't added yet).

- [ ] **Step 3: Add the section**

In `frontend/app/lib/spacetype/sections.ts`, add `'Slice'` to the `SPACE_TYPE_SECTIONS` array. Place it next to the other geometry-ish groups; the final array becomes:

```typescript
export const SPACE_TYPE_SECTIONS = [
  'Path', 'Type', 'Stack', 'Occlusion', 'Look', 'Blend', 'Style', 'Layout', 'Stretch', 'Skew',
  'Warp', 'Ribbon', 'Spiral', 'Slice', 'Layers', 'Color', 'Stroke', 'Glitch', 'Doodles', 'Shadow',
  'Wave', 'Motion', 'Transform', 'Output',
] as const
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-sections.unit.spec.ts`
Expected: PASS (all section tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/sections.ts frontend/tests/unit/spacetype-sections.unit.spec.ts
git commit -m "feat(spacetype): add Slice control section"
```

---

### Task 2: Implement and register the `shutter` effect

**Files:**
- Create: `frontend/app/lib/spacetype/effects/shutter.ts`
- Modify: `frontend/app/lib/spacetype/effects/index.ts:24` (import) and `:50` (register in `SPACE_TYPE_EFFECTS`)
- Test: `frontend/tests/unit/spacetype-shutter.unit.spec.ts`

**Interfaces:**
- Consumes: `SpaceTypeEffect`, `ControlSpec`, `Params` from `../effect`; the `'Slice'` section from Task 1; `getEffect` from `../effects` index.
- Produces:
  - `export const shutterEffect: SpaceTypeEffect` with `id: 'shutter'`.
  - `export function effectiveProgress(anim: string, progress: number, t01: number): number` — pure helper mapping the animation mode to a 0..1 displacement amount. `static` → `progress`; `sweepin` → `progress * t01`; `loop` → `progress * (1 - Math.abs(2*t01 - 1))` (ping-pong, seamless). Clamps `progress` to `[0,1]` and the result to `[0,1]`.
  - `shutterEffect.loopRates()` returns `[1]`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-shutter.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { effectiveProgress, shutterEffect } from '../../app/lib/spacetype/effects/shutter'
import { getEffect, SPACE_TYPE_EFFECTS } from '../../app/lib/spacetype/effects'
import { defaultsFromControls } from '../../app/lib/spacetype/effect'

describe('shutter effect', () => {
  it('is registered and resolvable by id', () => {
    expect(SPACE_TYPE_EFFECTS).toContain(shutterEffect)
    expect(getEffect('shutter')).toBe(shutterEffect)
    expect(getEffect('SHUTTER')).toBe(shutterEffect) // case-insensitive
  })

  it('has a backend-valid id and a Progress control', () => {
    expect(/^[a-z0-9]+$/.test(shutterEffect.id)).toBe(true)
    const keys = shutterEffect.controls.map(c => c.key)
    expect(keys).toContain('progress')
    expect(keys).toContain('pattern')
    expect(keys).toContain('gap')
  })

  it('defaults build without throwing and progress defaults to a full 1', () => {
    const d = defaultsFromControls(shutterEffect.controls)
    expect(d.progress).toBe(1)
  })

  it('loopRates is a single seamless cycle', () => {
    expect(shutterEffect.loopRates?.(defaultsFromControls(shutterEffect.controls))).toEqual([1])
  })

  describe('effectiveProgress', () => {
    it('static ignores time', () => {
      expect(effectiveProgress('static', 0.7, 0)).toBeCloseTo(0.7)
      expect(effectiveProgress('static', 0.7, 0.5)).toBeCloseTo(0.7)
      expect(effectiveProgress('static', 0.7, 0.99)).toBeCloseTo(0.7)
    })
    it('sweepin ramps 0 -> progress across the loop', () => {
      expect(effectiveProgress('sweepin', 1, 0)).toBeCloseTo(0)
      expect(effectiveProgress('sweepin', 1, 0.5)).toBeCloseTo(0.5)
      expect(effectiveProgress('sweepin', 0.8, 1)).toBeCloseTo(0.8)
    })
    it('loop ping-pongs 0 -> progress -> 0 (seamless endpoints)', () => {
      expect(effectiveProgress('loop', 1, 0)).toBeCloseTo(0)
      expect(effectiveProgress('loop', 1, 0.5)).toBeCloseTo(1)
      expect(effectiveProgress('loop', 1, 1)).toBeCloseTo(0)
    })
    it('clamps progress and result into [0,1]', () => {
      expect(effectiveProgress('static', 2, 0)).toBeCloseTo(1)
      expect(effectiveProgress('static', -1, 0)).toBeCloseTo(0)
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-shutter.unit.spec.ts`
Expected: FAIL — cannot resolve module `./shutter` / `shutterEffect` undefined.

- [ ] **Step 3: Create the effect module**

Create `frontend/app/lib/spacetype/effects/shutter.ts` with this exact content:

```typescript
import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'

/**
 * Shutter — a sliced / shuttered halftone-line treatment.
 *
 * The baked text matte is cut into `slices` horizontal bands. Bands are grouped (`groupSize` each)
 * and each group is sheared horizontally by an amount from the selected `pattern` (diagonal lean /
 * seeded random / sine / alternating), scaled by `offset` and the master `progress`. Within each
 * band the bottom `gap * progress` fraction is clipped transparent, opening thin venetian-blind
 * lines without squishing the glyphs. `progress` (0 = intact text, 1 = fully sliced) is either
 * parked (Animation = static) or driven by loop time (sweep-in, or seamless in/out loop).
 */
const controls: ControlSpec[] = [
  // TYPE.
  { key: 'text', label: 'Text', kind: 'textList', default: 'NO\nWANT\nZERO\nDAYS', group: 'Type' },
  { key: 'textCase', label: 'Case', kind: 'select', options: ['upper', 'asis'], default: 'upper', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Archivo Black', group: 'Type' },
  { key: 'typeYScale', label: 'Type size', kind: 'slider', min: 40, max: 320, step: 2, default: 220, group: 'Type' },
  { key: 'typeWeight', label: 'Type weight', kind: 'slider', min: 100, max: 900, step: 10, default: 800, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // SLICE — the shutter field.
  { key: 'slices', label: 'Slices', kind: 'slider', min: 4, max: 160, step: 1, default: 48, group: 'Slice' },
  { key: 'groupSize', label: 'Group size', kind: 'slider', min: 1, max: 16, step: 1, default: 4, group: 'Slice' },
  { key: 'pattern', label: 'Pattern', kind: 'select', options: ['diagonal', 'random', 'sine', 'alternating'], default: 'diagonal', group: 'Slice' },
  { key: 'offset', label: 'Offset amount', kind: 'slider', min: 0, max: 0.7, step: 0.005, default: 0.22, group: 'Slice' },
  { key: 'gap', label: 'Gap', kind: 'slider', min: 0, max: 0.6, step: 0.01, default: 0.08, group: 'Slice' },
  { key: 'seed', label: 'Seed', kind: 'slider', min: 1, max: 60, step: 1, default: 1, group: 'Slice' },
  { key: 'progress', label: 'Progress', kind: 'slider', min: 0, max: 1, step: 0.01, default: 1, group: 'Slice' },
  // MOTION.
  { key: 'anim', label: 'Animation', kind: 'select', options: ['static', 'sweepin', 'loop'], default: 'static', group: 'Motion' },
  // TRANSFORM (applied by the engine from these param keys).
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateZ', label: 'Rotate', kind: 'slider', min: -3.14, max: 3.14, step: 0.01, default: 0, group: 'Transform' },
  // COLOR.
  { key: 'textColor', label: 'Text', kind: 'color', default: '#000000', group: 'Color' },
  { key: 'bgColor', label: 'Background', kind: 'color', default: '#ffffff', group: 'Color' },
]

interface ShutterState { material: THREE.ShaderMaterial }
let state: ShutterState | null = null

function n(p: Params, k: string): number { return Number(p[k]) }
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Map the animation mode to a 0..1 displacement amount for loop time t01. Pure in t01. */
export function effectiveProgress(anim: string, progress: number, t01: number): number {
  const p = clamp01(progress)
  if (anim === 'sweepin') return clamp01(p * t01)
  if (anim === 'loop') return clamp01(p * (1 - Math.abs(2 * t01 - 1)))
  return p // static
}

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

const FRAG = [
  'precision highp float;',
  'varying vec2 vUv;',
  'uniform sampler2D uText; uniform vec3 uTextColor; uniform vec3 uBg;',
  'uniform float uWf; uniform float uVMid; uniform float uVH;',        // glyph placement in the tile
  'uniform float uSlices; uniform float uGroup; uniform float uPattern;',
  'uniform float uOffset; uniform float uGap; uniform float uSeed; uniform float uProgress;',
  'float hash(float n){ return fract(sin(n * 12.9898) * 43758.5453); }',
  // Centre the glyph in the plane with a margin so sheared slices can travel into transparent space.
  'float inkA(vec2 p){',
  '  float tx = (p.x - 0.5) * uWf * 1.6 + uWf * 0.5;',
  '  float ty = uVMid + (p.y - 0.5) * uVH * 1.6;',
  '  float a = texture2D(uText, vec2(clamp(tx, 0.0, 1.0), clamp(ty, 0.0, 1.0))).a;',
  '  return a * step(0.0, tx) * step(tx, uWf) * step(0.0, ty) * step(ty, 1.0);',
  '}',
  'void main(){',
  '  float band = floor(vUv.y * uSlices);',                            // which horizontal slice
  '  float gsize = max(1.0, uGroup);',
  '  float group = floor(band / gsize);',
  '  float groups = max(1.0, ceil(uSlices / gsize));',
  '  float off;',                                                       // signed -1..1 per group
  '  if (uPattern < 0.5) off = ((group + 0.5) / groups - 0.5) * 2.0;',  // diagonal lean
  '  else if (uPattern < 1.5) off = hash(group + uSeed) * 2.0 - 1.0;',  // seeded random
  '  else if (uPattern < 2.5) off = sin(group * 0.9);',                 // sine ripple
  '  else off = (mod(group, 2.0) < 1.0) ? 1.0 : -1.0;',                 // alternating
  '  float shift = off * uOffset * uProgress;',
  // Vertical gap: clip the bottom (uGap*progress) fraction of each band to transparent.
  '  float bandPos = fract(vUv.y * uSlices);',
  '  float gapAmt = uGap * uProgress;',
  '  float vis = 1.0;',
  '  if (gapAmt > 0.001) vis = smoothstep(gapAmt - 0.012, gapAmt + 0.012, bandPos);',
  '  vec2 puv = vUv; puv.x -= shift;',
  '  float a = inkA(puv) * vis;',
  '  vec3 col = mix(uBg, uTextColor, a);',
  '  gl_FragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(0.4545)), 1.0);',
  '}',
].join('\n')

const PATTERN_INDEX: Record<string, number> = { diagonal: 0, random: 1, sine: 2, alternating: 3 }

export const shutterEffect: SpaceTypeEffect = {
  id: 'shutter',
  label: 'Shutter',
  controls,
  liveKeys: ['slices', 'groupSize', 'pattern', 'offset', 'gap', 'seed', 'progress', 'anim', 'scale', 'rotateZ', 'textColor', 'bgColor'],

  loopRates() { return [1] },

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    const tex = textTexture.clone()
    tex.wrapS = tex.wrapT = three.ClampToEdgeWrapping
    tex.needsUpdate = true

    const ud = textTexture.userData ?? {}
    const img = textTexture.image as { width?: number; height?: number } | undefined
    const texAspect = Math.max(0.1, (img?.width ?? 1) / (img?.height ?? 1))
    const wf = Number((ud.wordInkFracs as number[] | undefined)?.[0] ?? 1) || 1
    const inkVH = Math.max(0.05, Number(ud.inkHeightFrac ?? 0.6))
    const inkVMid = Number(ud.inkVMid ?? 0.5)
    const inkAspect = Math.max(0.05, (wf * texAspect) / inkVH)
    const BOX = 9
    const planeW = inkAspect >= 1 ? BOX : BOX * inkAspect
    const planeH = inkAspect >= 1 ? BOX / inkAspect : BOX

    const material = new three.ShaderMaterial({
      side: three.DoubleSide,
      uniforms: {
        uText: { value: tex },
        uTextColor: { value: new three.Color(String(params.textColor)) },
        uBg: { value: new three.Color(String(params.bgColor)) },
        uWf: { value: wf }, uVMid: { value: inkVMid }, uVH: { value: inkVH },
        uSlices: { value: 48 }, uGroup: { value: 4 }, uPattern: { value: 0 },
        uOffset: { value: 0.22 }, uGap: { value: 0.08 }, uSeed: { value: 1 }, uProgress: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })
    const mesh = new three.Mesh(new three.PlaneGeometry(planeW, planeH), material)
    mesh.userData.tex = tex
    root.add(mesh)

    state = { material }
    shutterEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    const u = s.material.uniforms
    u.uSlices!.value = Math.max(1, Math.round(n(params, 'slices')))
    u.uGroup!.value = Math.max(1, Math.round(n(params, 'groupSize')))
    u.uPattern!.value = PATTERN_INDEX[String(params.pattern)] ?? 0
    u.uOffset!.value = Math.max(0, n(params, 'offset'))
    u.uGap!.value = Math.max(0, n(params, 'gap'))
    u.uSeed!.value = Math.max(1, Math.round(n(params, 'seed')))
    u.uProgress!.value = effectiveProgress(String(params.anim), n(params, 'progress'), t01)
    ;(u.uTextColor!.value as THREE.Color).set(String(params.textColor))
    ;(u.uBg!.value as THREE.Color).set(String(params.bgColor))
  },
}
```

- [ ] **Step 4: Register the effect**

In `frontend/app/lib/spacetype/effects/index.ts`, add the import after the `cornerPin` import (line 24):

```typescript
import { shutterEffect } from './shutter'
```

And add `shutterEffect` to the end of the `SPACE_TYPE_EFFECTS` array (after `cornerPinEffect,` on line 50):

```typescript
  cornerPinEffect,
  shutterEffect,
]
```

- [ ] **Step 5: Run the unit tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/spacetype-shutter.unit.spec.ts tests/unit/spacetype-sections.unit.spec.ts`
Expected: PASS — all shutter tests pass, and the sections guard test (which iterates every registered effect, now including `shutter`) confirms every `shutter` control group is renderable.

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i shutter || echo "no shutter type errors"`
Expected: `no shutter type errors` (or a clean run).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/spacetype/effects/shutter.ts frontend/app/lib/spacetype/effects/index.ts frontend/tests/unit/spacetype-shutter.unit.spec.ts
git commit -m "feat(spacetype): add Shutter sliced-text effect"
```

---

### Task 3: Visual verification and default tuning

**Files:**
- Possibly modify: `frontend/app/lib/spacetype/effects/shutter.ts` (tune control defaults only).

**Interfaces:**
- Consumes: the running app (`cd frontend && npm run dev`) + the ComfyUI backend per `CLAUDE.md`.
- Produces: confirmed screenshots; no API changes.

This task cannot be unit-tested — per the project rule, a visual/WebGL effect must be verified with rendered screenshots before it's called done.

- [ ] **Step 1: Run the app and open Type Studio**

Start the dev server, open a Type Studio node, and select the **Shutter** effect from the effect picker. (Use the preview tooling / browser to drive it.)

- [ ] **Step 2: Verify the static look at progress extremes**

Set `Animation = static`. Screenshot at `progress = 0` (should read as intact, solid text), `progress = 0.5`, and `progress = 1` (fully sheared with thin gaps). Confirm bands shear sideways and the bottom of each band opens a thin transparent line.

- [ ] **Step 3: Verify each pattern**

With `progress = 1`, cycle `Pattern` through diagonal / random / sine / alternating and screenshot each. Confirm: diagonal leans the column into a quantized parallelogram; random scatters per group; sine ripples; alternating corrugates. Re-roll `seed` in random mode and confirm the offsets change.

- [ ] **Step 4: Verify the animated loop is seamless**

Set `Animation = loop`, scrub/play. Confirm it returns to intact text at the loop boundary (no jump). Optionally export a seamless loop and confirm `loopRates [1]` produces a clean cycle.

- [ ] **Step 5: Tune defaults if needed**

If the default `slices` / `groupSize` / `offset` / `gap` don't read like the reference (bold caps, group-of-4 stepped shear, thin white lines), adjust the `default` values in `shutter.ts` controls and re-screenshot. Keep `groupSize` default at 4 (the reference's "every 4 slices").

- [ ] **Step 6: Get look sign-off**

Share the screenshots with the user and get explicit sign-off on the look before considering the effect done (project rule: get look sign-off first).

- [ ] **Step 7: Commit any tuning**

```bash
git add frontend/app/lib/spacetype/effects/shutter.ts
git commit -m "feat(spacetype): tune Shutter defaults to match reference"
```

---

## Self-Review

**Spec coverage:**
- Render approach (2D-matte → shader, tear pattern) → Task 2 module. ✓
- Band/group/offset/gap shader logic → Task 2 FRAG. ✓
- Offset patterns (diagonal default + random/sine/alternating) → Task 2 controls + FRAG. ✓
- `'Slice'` section + guard → Task 1. ✓
- Master progress + static/sweep/loop animation → `effectiveProgress` (Task 2), tested. ✓
- `loopRates [1]` + `liveKeys` → Task 2. ✓
- Visual verification rule → Task 3. ✓
- Spec said "reuse shared fillList for fills" — **intentionally dropped**: the sibling template (`tear.ts`) uses plain `textColor`/`bgColor` on an alpha matte, which matches the black-on-white reference and avoids scope creep. Documented in the handoff.

**Placeholder scan:** No TBD/TODO; all code blocks complete; all commands have expected output. ✓

**Type consistency:** `effectiveProgress(anim, progress, t01)` signature matches its call in `update`; `PATTERN_INDEX` keys match the `pattern` control `options`; uniform names in `FRAG` match those set in `buildScene`/`update` (`uSlices`, `uGroup`, `uPattern`, `uOffset`, `uGap`, `uSeed`, `uProgress`, `uTextColor`, `uBg`, `uWf`, `uVMid`, `uVH`). ✓
