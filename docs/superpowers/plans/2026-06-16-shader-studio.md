# Shader Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a frontend-only "Shader Studio" node that takes an input image and applies a stacked shader pipeline (stylized effect → duotone → adjustments → lens blur → chromatic), with a live preview, a full-screen editor, and still/video export.

**Architecture:** Mirrors Gradient Studio exactly — a frontend-only config node (no backend `class_type`, never executes), config persisted at `node.data.properties.sailor_shaderStudio`, a preview card + a full-screen surface that bakes outputs via the Space Type rails. The whole pipeline composes into one `ShaderPass[]` fed to the **existing** `shaderFx` singleton renderer (`app/lib/shaderfx/renderer.ts`), which already supports an arbitrary pass list over a base image. The only new rendering code is four GLSL fragments.

**Tech Stack:** Nuxt 4 (Vue 3 + TypeScript + Tailwind), WebGL2 (existing `shaderFx` renderer), Vitest (`npm run test:unit`), the existing `shaderfx` catalog/params and Space Type bake rails (`uploadFrameBatch`, `ensureSpaceTypeBake`, `/sailor/spacetype_encode`).

**Reference files to read before starting:**
- Spec: `docs/superpowers/specs/2026-06-16-shader-studio-design.md`
- `frontend/app/lib/gradientfx/` (types.ts, motion.ts, renderer.ts) — the studio engine pattern this mirrors
- `frontend/app/lib/shaderfx/` (renderer.ts, params.ts, catalog.ts, types.ts, chain.ts) — the effect engine being reused
- `frontend/app/components/vue-canvas/GradientStudioNode.vue`, `GradientStudioSurface.vue`, `ShaderEffectNode.vue`, `StudioModalShell.vue`, `StudioSection.vue`
- Wiring sites in `frontend/app/components/vue-canvas/VueNodeCanvas.vue` and `frontend/app/composables/useVueNodes.ts` and `frontend/app/layouts/default.vue`

**Conventions:**
- All paths are relative to repo root `/Users/julien/Documents/GitHub/Sailor`. Frontend code is under `frontend/`.
- Run unit tests from `frontend/`: `npm run test:unit -- <file>`.
- Per the user's standing preference: **no purple/violet accents** — use neutral white-opacity + emerald-for-run only.
- Commit after each task.

---

## Prerequisite: Isolated branch

The working tree is on `feat/gradient-studio` and other agents may share this checkout. Before starting, create an isolated worktree/branch off `main` (use the `superpowers:using-git-worktrees` skill). Branch name: `feat/shader-studio`. All tasks below run inside that worktree.

---

## File structure

**Create (engine — `frontend/app/lib/shaderstudio/`):**
- `types.ts` — `ShaderStudioConfig` + sub-interfaces, `defaultConfig`, `cloneConfig`, `outputDims`
- `presets.ts` — duotone color presets + adjustment presets (pure data)
- `motion.ts` — `MotionTrack` evaluation, `ANIMATABLE` path list, `applyMotion`, `getByPath`/`setByPath`
- `glsl.ts` — four GLSL ES 3.00 fragment sources: `DUOTONE_FS`, `ADJUST_FS`, `LENS_BLUR_FS`, `CHROMATIC_FS`
- `passes.ts` — `composePasses(config, effectDef, t, tex?)` → `ShaderPass[]`
- `source.ts` — `resolveWiredInput(nodeId, nodes, edges)`, `loadImage(url)`

**Create (UI — `frontend/app/components/vue-canvas/`):**
- `ShaderStudioNode.vue` — preview card + input/output handles
- `ShaderStudioSurface.vue` — full-screen editor

**Create (tests — `frontend/tests/unit/`):**
- `shaderstudio-types.unit.spec.ts`, `shaderstudio-motion.unit.spec.ts`, `shaderstudio-passes.unit.spec.ts`, `shaderstudio-presets.unit.spec.ts`, `shaderstudio-source.unit.spec.ts`, `shaderstudio-glsl.unit.spec.ts`

**Modify (wiring):**
- `frontend/app/composables/useVueNodes.ts` — register `ShaderStudio` in `ARTIFACT_NODE_COMPONENTS`
- `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — node-types map, `createNodeData` input/output special-case, open handler + state ref, surface mount, event listeners
- `frontend/app/layouts/default.vue` — Add menu entry

---

## Task 1: Config types

**Files:**
- Create: `frontend/app/lib/shaderstudio/types.ts`
- Test: `frontend/tests/unit/shaderstudio-types.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/shaderstudio-types.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { cloneConfig, defaultConfig, outputDims } from '~/lib/shaderstudio/types'

describe('shaderstudio types', () => {
  it('defaultConfig is a passthrough (no effect, all passes disabled)', () => {
    const c = defaultConfig()
    expect(c.effect.id).toBe('')
    expect(c.duotone.enabled).toBe(false)
    expect(c.adjust.enabled).toBe(false)
    expect(c.post.blur.enabled).toBe(false)
    expect(c.post.chromatic.enabled).toBe(false)
    expect(c.motion.tracks).toEqual([])
    expect(c.resolution).toBeGreaterThan(0)
  })

  it('cloneConfig is a deep copy', () => {
    const a = defaultConfig()
    const b = cloneConfig(a)
    b.adjust.exposure = 1.5
    b.effect.params.foo = 2
    expect(a.adjust.exposure).toBe(0)
    expect(a.effect.params.foo).toBeUndefined()
  })

  it('outputDims caps the long edge and preserves aspect', () => {
    // landscape 1000x500, cap 512 → 512x256
    expect(outputDims(1000, 500, 512)).toEqual({ w: 512, h: 256 })
    // portrait 500x1000, cap 512 → 256x512
    expect(outputDims(500, 1000, 512)).toEqual({ w: 256, h: 512 })
    // smaller than cap → unchanged (even dims)
    expect(outputDims(300, 200, 4096)).toEqual({ w: 300, h: 200 })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm run test:unit -- shaderstudio-types`
Expected: FAIL — cannot resolve `~/lib/shaderstudio/types`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/app/lib/shaderstudio/types.ts
// Config for the Shader Studio node — a frontend-only, input-driven studio that
// stacks shader passes over an input image. Persisted at
// node.data.properties.sailor_shaderStudio.

export type EasingKind = 'linear' | 'pingpong' | 'easeinout'

export interface StudioSource {
  kind: 'none' | 'upload' | 'asset'
  /** data: URL for an uploaded image. */
  dataUrl?: string
  /** Asset filename (served via /view) when picked from project Assets. */
  asset?: string
}

export interface StudioEffect {
  /** shaderfx catalog effect id, or '' for none. */
  id: string
  /** non-default uniform overrides for the effect. */
  params: Record<string, number>
  enabled: boolean
}

export interface StudioDuotone {
  enabled: boolean
  ink: string   // dark color (hex)
  paper: string // light color (hex)
}

export interface StudioAdjust {
  enabled: boolean
  exposure: number     // [-2,2] stops
  brightness: number   // [-1,1]
  contrast: number     // [-1,1]
  saturation: number   // [-1,1]
  hue: number          // [-180,180] degrees
  temperature: number  // [-1,1]
  tint: number         // [-1,1]
}

export interface StudioBlur {
  enabled: boolean
  focusX: number   // [0,1]
  focusY: number   // [0,1]
  range: number    // [0,1] sharp radius (uv distance)
  aperture: number // [0,1] falloff softness
  maxBlur: number  // px at full blur
}

export interface StudioChromatic {
  enabled: boolean
  amount: number // [0,1]
}

export interface StudioPost {
  blur: StudioBlur
  chromatic: StudioChromatic
}

export interface MotionTrack {
  /** dotted config path to a numeric leaf, e.g. 'adjust.exposure', 'effect.params.u_size'. */
  path: string
  from: number
  to: number
  easing: EasingKind
  loops: number
  delay: number
  hold: number
  cycleOffset: number
}

export interface StudioMotion {
  duration: number // seconds
  fps: number
  tracks: MotionTrack[]
}

export interface ShaderStudioConfig {
  version: number
  source: StudioSource
  /** long-edge cap (px) for preview/export sizing. */
  resolution: number
  effect: StudioEffect
  duotone: StudioDuotone
  adjust: StudioAdjust
  post: StudioPost
  motion: StudioMotion
}

export function defaultConfig(): ShaderStudioConfig {
  return {
    version: 1,
    source: { kind: 'none' },
    resolution: 1536,
    effect: { id: '', params: {}, enabled: true },
    duotone: { enabled: false, ink: '#1a1a2e', paper: '#f5f5f5' },
    adjust: {
      enabled: false, exposure: 0, brightness: 0, contrast: 0,
      saturation: 0, hue: 0, temperature: 0, tint: 0,
    },
    post: {
      blur: { enabled: false, focusX: 0.5, focusY: 0.5, range: 0.2, aperture: 0.25, maxBlur: 8 },
      chromatic: { enabled: false, amount: 0.3 },
    },
    motion: { duration: 4, fps: 30, tracks: [] },
  }
}

export function cloneConfig(c: ShaderStudioConfig): ShaderStudioConfig {
  return JSON.parse(JSON.stringify(c))
}

/** Fit (w,h) inside a long-edge cap, preserving aspect, returning even integers. */
export function outputDims(srcW: number, srcH: number, cap: number): { w: number; h: number } {
  const long = Math.max(srcW, srcH)
  const scale = long > cap ? cap / long : 1
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return { w: even(srcW * scale), h: even(srcH * scale) }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npm run test:unit -- shaderstudio-types`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shaderstudio/types.ts frontend/tests/unit/shaderstudio-types.unit.spec.ts
git commit -m "feat(shader-studio): config types + default/clone/outputDims"
```

---

## Task 2: Presets

**Files:**
- Create: `frontend/app/lib/shaderstudio/presets.ts`
- Test: `frontend/tests/unit/shaderstudio-presets.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/shaderstudio-presets.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { ADJUST_PRESETS, DUOTONE_PRESETS, applyAdjustPreset } from '~/lib/shaderstudio/presets'
import { defaultConfig } from '~/lib/shaderstudio/types'

describe('shaderstudio presets', () => {
  it('duotone presets are hex pairs', () => {
    expect(DUOTONE_PRESETS.length).toBeGreaterThanOrEqual(6)
    for (const p of DUOTONE_PRESETS) {
      expect(p.ink).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(p.paper).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it('applyAdjustPreset writes the preset values into adjust', () => {
    const c = defaultConfig()
    const punchy = ADJUST_PRESETS.find(p => p.name === 'Punchy')!
    applyAdjustPreset(c.adjust, punchy)
    expect(c.adjust.contrast).toBe(punchy.values.contrast)
    expect(c.adjust.saturation).toBe(punchy.values.saturation)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm run test:unit -- shaderstudio-presets`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/app/lib/shaderstudio/presets.ts
import type { StudioAdjust } from './types'

export interface DuotonePreset { name: string; ink: string; paper: string }
export interface AdjustPreset { name: string; values: Partial<Omit<StudioAdjust, 'enabled'>> }

export const DUOTONE_PRESETS: DuotonePreset[] = [
  { name: 'Mono', ink: '#000000', paper: '#ffffff' },
  { name: 'Indigo', ink: '#1a1a2e', paper: '#e8e8f5' },
  { name: 'Blood', ink: '#3a0a0a', paper: '#f3d9c0' },
  { name: 'Forest', ink: '#0c2a1f', paper: '#dff0e2' },
  { name: 'Sepia', ink: '#2b1a08', paper: '#f0e2c8' },
  { name: 'Ocean', ink: '#06283d', paper: '#dff6ff' },
  { name: 'Berry', ink: '#2d0a2e', paper: '#ffd9f0' },
  { name: 'Ember', ink: '#1a1206', paper: '#ffb347' },
]

export const ADJUST_PRESETS: AdjustPreset[] = [
  { name: 'Neutral', values: { exposure: 0, brightness: 0, contrast: 0, saturation: 0, hue: 0, temperature: 0, tint: 0 } },
  { name: 'Punchy', values: { exposure: -0.15, contrast: 0.25, saturation: 0.2 } },
  { name: 'Faded', values: { contrast: -0.2, saturation: -0.25, brightness: 0.08 } },
  { name: 'Warm', values: { temperature: 0.3, saturation: 0.1 } },
  { name: 'Cool', values: { temperature: -0.3, tint: -0.1 } },
  { name: 'B&W', values: { saturation: -1, contrast: 0.15 } },
]

/** Reset to neutral, then apply the preset's overrides. Keeps `enabled` as-is. */
export function applyAdjustPreset(adjust: StudioAdjust, preset: AdjustPreset): void {
  const neutral = ADJUST_PRESETS[0]!.values
  Object.assign(adjust, neutral, preset.values)
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npm run test:unit -- shaderstudio-presets`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shaderstudio/presets.ts frontend/tests/unit/shaderstudio-presets.unit.spec.ts
git commit -m "feat(shader-studio): duotone + adjustment presets"
```

---

## Task 3: Motion (track evaluation + path targeting)

**Files:**
- Create: `frontend/app/lib/shaderstudio/motion.ts`
- Test: `frontend/tests/unit/shaderstudio-motion.unit.spec.ts`

Reuse the proven `trackValue` math from `app/lib/gradientfx/motion.ts`, but target a **dotted path** into the config instead of a per-layer shape key.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/shaderstudio-motion.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { ANIMATABLE, applyMotion, getByPath, setByPath, trackValue } from '~/lib/shaderstudio/motion'
import { defaultConfig, type MotionTrack } from '~/lib/shaderstudio/types'

const track = (over: Partial<MotionTrack> = {}): MotionTrack => ({
  path: 'adjust.exposure', from: 0, to: 1, easing: 'linear', loops: 1, delay: 0, hold: 0, cycleOffset: 0, ...over,
})

describe('shaderstudio motion', () => {
  it('get/set by dotted path', () => {
    const c = defaultConfig()
    setByPath(c, 'post.blur.maxBlur', 12)
    expect(getByPath(c, 'post.blur.maxBlur')).toBe(12)
    setByPath(c, 'effect.params.u_size', 3)
    expect(c.effect.params.u_size).toBe(3)
  })

  it('trackValue interpolates linearly and holds at end for a single play', () => {
    const t = track({ from: 0, to: 10 })
    expect(trackValue(t, 0, 4)).toBeCloseTo(0)
    expect(trackValue(t, 2, 4)).toBeCloseTo(5)
    expect(trackValue(t, 4, 4)).toBeCloseTo(10)
  })

  it('pingpong is seamless: value at t=0 equals value at t=duration', () => {
    const t = track({ from: 0, to: 10, easing: 'pingpong' })
    expect(trackValue(t, 0, 4)).toBeCloseTo(trackValue(t, 4, 4))
  })

  it('applyMotion writes the evaluated value at the path without mutating the source', () => {
    const c = defaultConfig()
    c.motion.tracks = [track({ path: 'adjust.exposure', from: 0, to: 2 })]
    const out = applyMotion(c, 2) // half-way
    expect(out.adjust.exposure).toBeCloseTo(1)
    expect(c.adjust.exposure).toBe(0) // original untouched
  })

  it('ANIMATABLE lists fixed-section paths with labels and ranges', () => {
    const exp = ANIMATABLE.find(a => a.path === 'adjust.exposure')!
    expect(exp.label).toBeTruthy()
    expect(exp.min).toBeLessThan(exp.max)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm run test:unit -- shaderstudio-motion`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/app/lib/shaderstudio/motion.ts
// Evaluate animation tracks at time t (seconds) and produce a frame-specific
// config. Preview and bake share this path, so they always match. The track math
// mirrors gradientfx/motion.ts; the difference is path-based targeting so any
// numeric leaf (adjustment, focus point, effect param) can animate.

import { cloneConfig, type EasingKind, type MotionTrack, type ShaderStudioConfig } from './types'

/** Fixed-section animatable paths. Effect params are appended dynamically in the UI. */
export const ANIMATABLE: { path: string; label: string; min: number; max: number }[] = [
  { path: 'adjust.exposure', label: 'Exposure', min: -2, max: 2 },
  { path: 'adjust.brightness', label: 'Brightness', min: -1, max: 1 },
  { path: 'adjust.contrast', label: 'Contrast', min: -1, max: 1 },
  { path: 'adjust.saturation', label: 'Saturation', min: -1, max: 1 },
  { path: 'adjust.hue', label: 'Hue', min: -180, max: 180 },
  { path: 'adjust.temperature', label: 'Temperature', min: -1, max: 1 },
  { path: 'post.blur.focusX', label: 'Focus X', min: 0, max: 1 },
  { path: 'post.blur.focusY', label: 'Focus Y', min: 0, max: 1 },
  { path: 'post.blur.maxBlur', label: 'Max blur', min: 0, max: 40 },
  { path: 'post.chromatic.amount', label: 'Chromatic', min: 0, max: 1 },
]

export function getByPath(obj: any, path: string): number {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}

export function setByPath(obj: any, path: string, value: number): void {
  const keys = path.split('.')
  let o = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!
    if (o[k] == null || typeof o[k] !== 'object') o[k] = {}
    o = o[k]
  }
  o[keys[keys.length - 1]!] = value
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v }

function ease(p: number, kind: EasingKind): number {
  const t = clamp01(p)
  switch (kind) {
    case 'pingpong': return 1 - Math.abs(1 - 2 * t)
    case 'easeinout': return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    default: return t
  }
}

export function trackValue(track: MotionTrack, t: number, duration: number): number {
  const d = Math.max(0.001, duration)
  const local = (t - (track.delay || 0)) / d
  if (local < 0) return track.from
  const loops = Math.max(1, track.loops || 1)
  const phase = local * loops + (track.cycleOffset || 0)
  let cyc: number
  if (loops <= 1 && track.easing !== 'pingpong') {
    cyc = clamp01(phase)
  } else {
    cyc = phase % 1
    if (cyc < 0) cyc += 1
  }
  const hold = clamp01(track.hold || 0)
  if (hold > 0) {
    const active = 1 - 2 * hold
    cyc = active <= 0 ? 0 : clamp01((cyc - hold) / active)
  }
  return track.from + (track.to - track.from) * ease(cyc, track.easing)
}

/** Clone `cfg` and apply each track's value at its path for time `t` (seconds). */
export function applyMotion(cfg: ShaderStudioConfig, t: number): ShaderStudioConfig {
  if (!cfg.motion?.tracks?.length) return cfg
  const out = cloneConfig(cfg)
  for (const track of cfg.motion.tracks) {
    setByPath(out, track.path, trackValue(track, t, cfg.motion.duration))
  }
  return out
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npm run test:unit -- shaderstudio-motion`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shaderstudio/motion.ts frontend/tests/unit/shaderstudio-motion.unit.spec.ts
git commit -m "feat(shader-studio): path-targeted motion tracks"
```

---

## Task 4: GLSL fragment sources

**Files:**
- Create: `frontend/app/lib/shaderstudio/glsl.ts`
- Test: `frontend/tests/unit/shaderstudio-glsl.unit.spec.ts`

The unit test is a **guard** against the known backtick-in-comment bug (a backtick inside a shader string silently terminates the JS template literal) and against missing the renderer contract tokens. GPU correctness is verified in-app (Task 11).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/shaderstudio-glsl.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { ADJUST_FS, CHROMATIC_FS, DUOTONE_FS, LENS_BLUR_FS } from '~/lib/shaderstudio/glsl'

const ALL = { DUOTONE_FS, ADJUST_FS, LENS_BLUR_FS, CHROMATIC_FS }

describe('shaderstudio glsl', () => {
  for (const [name, src] of Object.entries(ALL)) {
    it(`${name} satisfies the renderer contract and has no stray backtick`, () => {
      expect(src).toContain('#version 300 es')
      expect(src).toContain('uniform sampler2D u_image0;')
      expect(src).toContain('fragColor0')
      expect(src).toContain('void main')
      expect(src).not.toContain('`') // backtick would have broken the literal
    })
  }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm run test:unit -- shaderstudio-glsl`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

Note: the existing renderer (`shaderfx/renderer.ts`) auto-binds `u_image0` (unit 0 = previous pass), `u_source` (unit 1 = original input) and sets `u_resolution`; it sets all other uniforms via `uniform1f`. So colors are passed as separate `_r/_g/_b` floats.

```ts
// frontend/app/lib/shaderstudio/glsl.ts
// Studio-level pipeline passes, expressed as ShaderFx-compatible fragment shaders.
// Contract (matches app/lib/shaderfx/renderer.ts): sampler u_image0 = previous pass,
// vec2 u_resolution, in vec2 v_texCoord, out vec4 fragColor0. All scalar uniforms set
// via uniform1f, so vec3 colors arrive as _r/_g/_b floats.

const HEAD = `#version 300 es
precision highp float;
uniform sampler2D u_image0;
uniform vec2 u_resolution;
in vec2 v_texCoord;
layout(location = 0) out vec4 fragColor0;
`

export const DUOTONE_FS = HEAD + `
uniform float u_ink_r, u_ink_g, u_ink_b;
uniform float u_paper_r, u_paper_g, u_paper_b;
void main() {
  vec4 src = texture(u_image0, v_texCoord);
  float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  vec3 ink = vec3(u_ink_r, u_ink_g, u_ink_b);
  vec3 paper = vec3(u_paper_r, u_paper_g, u_paper_b);
  fragColor0 = vec4(mix(ink, paper, lum), src.a);
}
`

export const ADJUST_FS = HEAD + `
uniform float u_exposure, u_brightness, u_contrast, u_saturation, u_hue, u_temperature, u_tint;
vec3 hueRotate(vec3 c, float deg) {
  float a = radians(deg);
  float s = sin(a), co = cos(a);
  mat3 m = mat3(
    0.299 + 0.701*co + 0.168*s, 0.587 - 0.587*co + 0.330*s, 0.114 - 0.114*co - 0.497*s,
    0.299 - 0.299*co - 0.328*s, 0.587 + 0.413*co + 0.035*s, 0.114 - 0.114*co + 0.292*s,
    0.299 - 0.300*co + 1.250*s, 0.587 - 0.588*co - 1.050*s, 0.114 + 0.886*co - 0.203*s
  );
  return clamp(m * c, 0.0, 1.0);
}
void main() {
  vec4 src = texture(u_image0, v_texCoord);
  vec3 c = src.rgb;
  c *= pow(2.0, u_exposure);                       // exposure (stops)
  c += u_brightness;                               // brightness
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;        // contrast around mid-grey
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, 1.0 + u_saturation);       // saturation
  if (u_hue != 0.0) c = hueRotate(c, u_hue);       // hue
  c.r += u_temperature * 0.1; c.b -= u_temperature * 0.1;  // temperature
  c.g += u_tint * 0.1;                              // tint
  fragColor0 = vec4(clamp(c, 0.0, 1.0), src.a);
}
`

export const LENS_BLUR_FS = HEAD + `
uniform float u_focusX, u_focusY, u_range, u_aperture, u_maxBlur;
void main() {
  vec2 focus = vec2(u_focusX, u_focusY);
  float d = distance(v_texCoord, focus);
  float blurPx = u_maxBlur * smoothstep(u_range, u_range + max(u_aperture, 0.001), d);
  if (blurPx < 0.5) { fragColor0 = texture(u_image0, v_texCoord); return; }
  vec2 px = blurPx / u_resolution;
  // 16-tap sunflower disc
  vec4 sum = vec4(0.0);
  const int N = 16;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + 0.5) / float(N);
    float ang = float(i) * 2.39996323;            // golden angle
    vec2 off = vec2(cos(ang), sin(ang)) * sqrt(t) * px;
    sum += texture(u_image0, v_texCoord + off);
  }
  fragColor0 = sum / float(N);
}
`

export const CHROMATIC_FS = HEAD + `
uniform float u_amount;
void main() {
  vec2 dir = v_texCoord - 0.5;
  vec2 off = dir * u_amount * 0.03;
  float r = texture(u_image0, v_texCoord + off).r;
  vec4 g = texture(u_image0, v_texCoord);
  float b = texture(u_image0, v_texCoord - off).b;
  fragColor0 = vec4(r, g.g, b, g.a);
}
`
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npm run test:unit -- shaderstudio-glsl`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shaderstudio/glsl.ts frontend/tests/unit/shaderstudio-glsl.unit.spec.ts
git commit -m "feat(shader-studio): duotone/adjust/lens-blur/chromatic GLSL"
```

---

## Task 5: Compose passes

**Files:**
- Create: `frontend/app/lib/shaderstudio/passes.ts`
- Test: `frontend/tests/unit/shaderstudio-passes.unit.spec.ts`

`composePasses` turns a config + the selected effect's `EffectDef` into the flat `ShaderPass[]` the renderer consumes. It reuses `resolveUniforms` and `expandPasses` from `shaderfx`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/shaderstudio-passes.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { composePasses } from '~/lib/shaderstudio/passes'
import { defaultConfig } from '~/lib/shaderstudio/types'
import type { EffectDef } from '~/lib/shaderfx/types'

const fakeEffect: EffectDef = {
  id: 'halftone', name: 'Halftone', category: 'stylize', animated: false, passes: 1,
  centerParam: null, textures: [],
  params: [{ uniform: 'u_size', label: 'Size', type: 'float', min: 1, max: 10, default: 4, step: 1 }],
  source: 'EFFECT_SRC',
}

describe('composePasses', () => {
  it('returns [] when nothing is enabled and no effect picked', () => {
    const c = defaultConfig() // effect.id '' , all passes disabled
    expect(composePasses(c, null, 0)).toEqual([])
  })

  it('includes the effect pass with resolved uniforms when enabled', () => {
    const c = defaultConfig()
    c.effect = { id: 'halftone', params: { u_size: 6 }, enabled: true }
    const passes = composePasses(c, fakeEffect, 0.5)
    expect(passes).toHaveLength(1)
    expect(passes[0]!.id).toBe('halftone')
    expect(passes[0]!.uniforms.u_size).toBe(6)
    expect(passes[0]!.uniforms.u_time).toBe(0.5)
    expect(passes[0]!.uniforms.u_hasInput).toBe(1)
  })

  it('appends duotone/adjust/blur/chromatic in order, splitting colors to _r/_g/_b', () => {
    const c = defaultConfig()
    c.duotone = { enabled: true, ink: '#000000', paper: '#ffffff' }
    c.adjust.enabled = true
    c.post.blur.enabled = true
    c.post.chromatic.enabled = true
    const passes = composePasses(c, null, 0) // no effect
    expect(passes.map(p => p.id)).toEqual(['studio:duotone', 'studio:adjust', 'studio:blur', 'studio:chromatic'])
    const duo = passes[0]!
    expect(duo.uniforms.u_ink_r).toBe(0)
    expect(duo.uniforms.u_paper_r).toBe(1)
  })

  it('expands a multi-pass effect into N passes', () => {
    const c = defaultConfig()
    c.effect = { id: 'bloom', params: {}, enabled: true }
    const bloom: EffectDef = { ...fakeEffect, id: 'bloom', passes: 3, params: [] }
    const passes = composePasses(c, bloom, 0)
    expect(passes).toHaveLength(3)
    expect(passes.every(p => p.id === 'bloom')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm run test:unit -- shaderstudio-passes`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/app/lib/shaderstudio/passes.ts
// Compose a ShaderStudioConfig + the selected effect's EffectDef into the flat
// ShaderPass[] consumed by the shaderFx singleton renderer. Order mirrors the
// Morflax panel: effect → duotone → adjust → lens blur → chromatic.

import { resolveUniforms } from '~/lib/shaderfx/params'
import { expandPasses, type ShaderPass, type Uniforms } from '~/lib/shaderfx/renderer'
import type { EffectDef } from '~/lib/shaderfx/types'
import { ADJUST_FS, CHROMATIC_FS, DUOTONE_FS, LENS_BLUR_FS } from './glsl'
import type { ShaderStudioConfig } from './types'

/** Hex (#rrggbb) → {r,g,b} in 0..1. */
function hexRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

export interface EffectTextureBundle {
  sources: Record<string, TexImageSource>
  uniforms: Record<string, number>
}

/**
 * @param cfg     studio config (already motion-applied for the frame, if animating)
 * @param effect  EffectDef for cfg.effect.id, or null if none / not loaded
 * @param t       time in seconds (drives u_time for animated effects)
 * @param tex     resolved effect textures + extra uniforms (browser-side; {} in tests)
 */
export function composePasses(
  cfg: ShaderStudioConfig,
  effect: EffectDef | null,
  t: number,
  tex: EffectTextureBundle = { sources: {}, uniforms: {} },
): ShaderPass[] {
  const out: ShaderPass[] = []

  // 1. Stylized effect (reuse shaderfx; expand multi-pass)
  if (cfg.effect.enabled && cfg.effect.id && effect) {
    const uniforms: Uniforms = {
      ...resolveUniforms(effect, cfg.effect.params),
      u_time: t, u_seed: 42, u_hasInput: 1, ...tex.uniforms,
    }
    out.push(...expandPasses(effect.id, effect.source, uniforms, tex.sources, effect.passes ?? 1))
  }

  // 2. Duotone
  if (cfg.duotone.enabled) {
    const ink = hexRgb(cfg.duotone.ink), paper = hexRgb(cfg.duotone.paper)
    out.push({ id: 'studio:duotone', source: DUOTONE_FS, uniforms: {
      u_ink_r: ink.r, u_ink_g: ink.g, u_ink_b: ink.b,
      u_paper_r: paper.r, u_paper_g: paper.g, u_paper_b: paper.b,
    } })
  }

  // 3. Adjustments
  if (cfg.adjust.enabled) {
    const a = cfg.adjust
    out.push({ id: 'studio:adjust', source: ADJUST_FS, uniforms: {
      u_exposure: a.exposure, u_brightness: a.brightness, u_contrast: a.contrast,
      u_saturation: a.saturation, u_hue: a.hue, u_temperature: a.temperature, u_tint: a.tint,
    } })
  }

  // 4. Lens blur
  if (cfg.post.blur.enabled) {
    const b = cfg.post.blur
    out.push({ id: 'studio:blur', source: LENS_BLUR_FS, uniforms: {
      u_focusX: b.focusX, u_focusY: b.focusY, u_range: b.range, u_aperture: b.aperture, u_maxBlur: b.maxBlur,
    } })
  }

  // 5. Chromatic aberration
  if (cfg.post.chromatic.enabled) {
    out.push({ id: 'studio:chromatic', source: CHROMATIC_FS, uniforms: { u_amount: cfg.post.chromatic.amount } })
  }

  return out
}
```

Note: `Uniforms` is exported from `app/lib/shaderfx/renderer.ts` (`export type Uniforms = Record<string, number>`). Confirm the import resolves; if the renderer doesn't export `Uniforms`, use `Record<string, number>` directly.

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npm run test:unit -- shaderstudio-passes`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shaderstudio/passes.ts frontend/tests/unit/shaderstudio-passes.unit.spec.ts
git commit -m "feat(shader-studio): composePasses pipeline builder"
```

---

## Task 6: Wired-input resolution

**Files:**
- Create: `frontend/app/lib/shaderstudio/source.ts`
- Test: `frontend/tests/unit/shaderstudio-source.unit.spec.ts`

`resolveWiredInput` finds the image feeding the node's `input-0` handle (mirrors `chain.ts`'s `resolveSrcUrl`). `loadImage` is a thin browser helper (not unit-tested).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/shaderstudio-source.unit.spec.ts
import { describe, expect, it } from 'vitest'
import { resolveWiredInput } from '~/lib/shaderstudio/source'

describe('resolveWiredInput', () => {
  const studio = { id: 's1', data: {} }

  it('returns null when nothing is wired to input-0', () => {
    expect(resolveWiredInput('s1', [studio], [])).toBeNull()
  })

  it('returns the upstream node images[0] when present', () => {
    const up = { id: 'a', data: { images: ['/view?filename=x.png&type=output'] } }
    const edges = [{ source: 'a', target: 's1', targetHandle: 'input-0' }]
    expect(resolveWiredInput('s1', [studio, up], edges)).toBe('/view?filename=x.png&type=output')
  })

  it('builds a /view URL for an upstream LoadImage widget', () => {
    const up = { id: 'a', data: { nodeType: 'LoadImage', widgetsValues: ['photo.jpg'] } }
    const edges = [{ source: 'a', target: 's1', targetHandle: 'input-0' }]
    const url = resolveWiredInput('s1', [studio, up], edges)
    expect(url).toContain('filename=photo.jpg')
    expect(url).toContain('type=input')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npm run test:unit -- shaderstudio-source`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/app/lib/shaderstudio/source.ts
// Resolve the image feeding a Shader Studio node's input-0 handle. Mirrors the
// resolveSrcUrl logic in app/lib/shaderfx/chain.ts (kept local so the studio engine
// is self-contained).

function resolveSrcUrl(src: any): string | null {
  if (src?.data?.images?.length) return src.data.images[0]
  if (src?.data?.nodeType === 'LoadImage' && src?.data?.widgetsValues?.[0]) {
    return `/view?${new URLSearchParams({ filename: src.data.widgetsValues[0], type: 'input' })}`
  }
  return null
}

export function resolveWiredInput(nodeId: string, nodes: any[], edges: any[]): string | null {
  const e = edges.find((e: any) => e.target === nodeId && e.targetHandle === 'input-0')
  if (!e) return null
  const src = nodes.find((n: any) => n.id === e.source)
  return src ? resolveSrcUrl(src) : null
}

/** Load an image URL into an HTMLImageElement (CORS-enabled for /view assets). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd frontend && npm run test:unit -- shaderstudio-source`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/shaderstudio/source.ts frontend/tests/unit/shaderstudio-source.unit.spec.ts
git commit -m "feat(shader-studio): wired-input resolution + loadImage"
```

---

## Task 7: Node card (`ShaderStudioNode.vue`)

**Files:**
- Create: `frontend/app/components/vue-canvas/ShaderStudioNode.vue`

Mirrors `GradientStudioNode.vue` but: (a) resolves the input image (wired via injected edges/nodes, else `config.source.dataUrl`), (b) renders the composed pipeline via `shaderFx`, (c) has an **input handle** plus the output handle. No unit test (Vue components are verified in-app per the codebase convention); verified in Task 11.

- [ ] **Step 1: Write the component**

```vue
<!-- frontend/app/components/vue-canvas/ShaderStudioNode.vue -->
<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Pencil, Sparkles } from 'lucide-vue-next'
import { fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { shaderFx } from '~/lib/shaderfx/renderer'
import type { ShaderFxCatalog, EffectDef } from '~/lib/shaderfx/types'
import { composePasses } from '~/lib/shaderstudio/passes'
import { applyMotion } from '~/lib/shaderstudio/motion'
import { loadImage, resolveWiredInput } from '~/lib/shaderstudio/source'
import { cloneConfig, defaultConfig, outputDims, type ShaderStudioConfig } from '~/lib/shaderstudio/types'

const props = defineProps<{
  id: string
  data: { nodeType: string; title?: string; mode?: number; properties?: Record<string, any> }
}>()

const PREVIEW_W = 220
const injectedEdges = inject<any>('vueFlowEdges', null)
const injectedNodes = inject<any>('vueFlowNodes', null)

const config = computed<ShaderStudioConfig>(
  () => (props.data?.properties?.sailor_shaderStudio as ShaderStudioConfig) ?? defaultConfig(),
)
const animated = computed(() => (config.value.motion?.tracks?.length ?? 0) > 0)

const canvasEl = ref<HTMLCanvasElement | null>(null)
const glError = ref<string | null>(null)
const catalog = ref<ShaderFxCatalog | null>(null)
const baseImage = ref<HTMLImageElement | null>(null)

const wiredUrl = computed(() =>
  resolveWiredInput(props.id, injectedNodes?.value ?? [], injectedEdges?.value ?? []))
const sourceUrl = computed(() => wiredUrl.value ?? config.value.source.dataUrl
  ?? (config.value.source.asset ? `/view?${new URLSearchParams({ filename: config.value.source.asset, type: 'input' })}` : null))

watch(sourceUrl, async (url) => {
  baseImage.value = null
  if (!url) { renderFrame(0); return }
  try { baseImage.value = await loadImage(url); renderFrame(0) } catch { baseImage.value = null }
}, { immediate: true })

function effectDef(id: string): EffectDef | null {
  return catalog.value?.effects.find(e => e.id === id) ?? null
}

function renderFrame(t: number) {
  const el = canvasEl.value
  if (!el) return
  const base = baseImage.value
  if (!base) { el.width = PREVIEW_W; el.height = Math.round(PREVIEW_W * 9 / 16); el.getContext('2d')!.clearRect(0, 0, el.width, el.height); return }
  const { w, h } = outputDims(base.naturalWidth, base.naturalHeight, PREVIEW_W)
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
  try {
    const cfg = animated.value ? applyMotion(config.value, t) : config.value
    const passes = composePasses(cfg, effectDef(cfg.effect.id), t)
    el.getContext('2d')!.drawImage(shaderFx.render(passes, base, w, h), 0, 0)
    glError.value = null
  } catch (e: any) { glError.value = String(e?.message ?? e) }
}

let raf = 0, start = 0
function loop(ts: number) {
  if (!start) start = ts
  const dur = Math.max(0.1, config.value.motion?.duration ?? 4)
  renderFrame(((ts - start) / 1000) % dur)
  raf = requestAnimationFrame(loop)
}
function startLoop() {
  cancelAnimationFrame(raf); start = 0
  if (animated.value) raf = requestAnimationFrame(loop)
  else renderFrame(0)
}

onMounted(async () => {
  catalog.value = await fetchShaderFxCatalog().catch(() => null)
  startLoop()
})
onBeforeUnmount(() => cancelAnimationFrame(raf))

let timer: ReturnType<typeof setTimeout> | null = null
watch(config, () => { if (timer) clearTimeout(timer); timer = setTimeout(startLoop, 60) }, { deep: true })
watch(animated, startLoop)

function openEditor() {
  window.dispatchEvent(new CustomEvent('sailor:openShaderStudio', { detail: { nodeId: props.id } }))
}
</script>

<template>
  <div
    class="relative w-[220px] overflow-hidden rounded-xl border border-white/10 bg-neutral-900 text-white shadow-lg"
    @dblclick.stop="openEditor"
  >
    <!-- Input handle (image in) -->
    <Handle id="input-0" type="target" :position="Position.Left"
      class="!h-3 !w-3 !rounded-full !border-2 !border-white/40 !bg-[#1a1a1a]" :style="{ top: '50%' }" />
    <!-- Output handle (provenance to generated Image/Video) -->
    <Handle id="output-0" type="source" :position="Position.Right"
      class="!h-3 !w-3 !rounded-full !border-2 !border-emerald-400 !bg-[#1a1a1a]" :style="{ top: '50%' }" />

    <div class="flex items-center gap-2 border-b border-white/10 px-3 py-2">
      <Sparkles class="h-3.5 w-3.5 text-emerald-400" />
      <span class="text-xs font-medium text-white/80">Shader Studio</span>
      <span class="ml-auto truncate text-[10px] uppercase tracking-wide text-white/40">{{ config.effect.id || 'no effect' }}</span>
    </div>

    <div class="flex items-center justify-center bg-neutral-950 aspect-video">
      <canvas ref="canvasEl" class="block max-h-full max-w-full" />
      <span v-if="!baseImage" class="absolute text-[10px] text-white/30">Connect or add an image</span>
    </div>
    <div v-if="glError" class="px-3 py-1 text-[10px] text-red-300/90 truncate" :title="glError">{{ glError }}</div>

    <div class="border-t border-white/10 p-2">
      <button
        class="flex w-full items-center justify-center gap-1.5 rounded bg-white/10 px-2 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20"
        @click.stop="openEditor"
      >
        <Pencil class="h-3 w-3" /> Edit
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Type-check the component compiles**

The component is mounted by the wiring in Task 9; for now verify imports resolve by running the unit suite (which imports the same lib modules) and ensure no syntax error:

Run: `cd frontend && npm run test:unit -- shaderstudio`
Expected: PASS (all shaderstudio specs). This confirms the lib imports the component uses are valid.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/ShaderStudioNode.vue
git commit -m "feat(shader-studio): node card with input/output handles + live preview"
```

---

## Task 8: Surface editor (`ShaderStudioSurface.vue`)

**Files:**
- Create: `frontend/app/components/vue-canvas/ShaderStudioSurface.vue`

Mirrors `GradientStudioSurface.vue`'s structure (StudioModalShell, preview loop, generateImage/generateVideo via the Space Type rails, config load/save) but with the Shader Studio sections. Receives the resolved wired URL as a prop (resolved by VueNodeCanvas in Task 9).

- [ ] **Step 1: Write the component**

```vue
<!-- frontend/app/components/vue-canvas/ShaderStudioSurface.vue -->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ChevronRight, Plus, Trash2 } from 'lucide-vue-next'
import CatalogModal from '~/components/CatalogModal.vue'
import StudioModalShell from '~/components/vue-canvas/StudioModalShell.vue'
import StudioSection from '~/components/vue-canvas/StudioSection.vue'
import { assetUrl, fetchShaderFxCatalog } from '~/lib/shaderfx/catalog'
import { resolveUniforms } from '~/lib/shaderfx/params'
import { shaderFx } from '~/lib/shaderfx/renderer'
import type { EffectDef, ShaderFxCatalog } from '~/lib/shaderfx/types'
import { composePasses, type EffectTextureBundle } from '~/lib/shaderstudio/passes'
import { ANIMATABLE, applyMotion } from '~/lib/shaderstudio/motion'
import { ADJUST_PRESETS, DUOTONE_PRESETS, applyAdjustPreset } from '~/lib/shaderstudio/presets'
import { loadImage } from '~/lib/shaderstudio/source'
import { cloneConfig, defaultConfig, outputDims, type MotionTrack, type ShaderStudioConfig } from '~/lib/shaderstudio/types'
import { ensureSpaceTypeBake } from '~/lib/spacetype/bake'

const props = defineProps<{ nodeId: string; nodes: any[]; wiredUrl?: string | null }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const { recordAsset } = useProjectGenerations()
const { activeTab } = useTabs()
function currentNode() { return props.nodes.find((n: any) => n.id === props.nodeId) }

const config = ref<ShaderStudioConfig>(defaultConfig())
const catalog = ref<ShaderFxCatalog | null>(null)
const baseImage = ref<HTMLImageElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const glError = ref<string | null>(null)
const baking = ref(false)
const bakeMsg = ref('')
const PREVIEW_MAX_W = 880

const effectDef = computed<EffectDef | null>(
  () => catalog.value?.effects.find(e => e.id === config.value.effect.id) ?? null)
const effectUniforms = computed(() =>
  effectDef.value ? resolveUniforms(effectDef.value, config.value.effect.params) : {})

// ── effect textures (mirror ShaderEffectNode) ───────────────────────────────
const textureImages = new Map<string, HTMLImageElement>()
function texBundle(def: EffectDef | null): EffectTextureBundle {
  const sources: Record<string, TexImageSource> = {}
  const uniforms: Record<string, number> = {}
  if (!def) return { sources, uniforms }
  for (const t of def.textures) {
    const img = textureImages.get(t.file)
    if (img?.complete) sources[t.uniform] = img
    else if (!img) { const el = new Image(); el.onload = () => renderFrame(0); el.src = assetUrl(t.file); textureImages.set(t.file, el) }
    for (const [k, v] of Object.entries(t.extraUniforms ?? {})) uniforms[k] = v
  }
  return { sources, uniforms }
}

// ── preview ──────────────────────────────────────────────────────────────────
const animated = computed(() => (config.value.motion?.tracks?.length ?? 0) > 0)
function renderFrame(t: number) {
  const el = canvas.value
  if (!el) return
  const base = baseImage.value
  if (!base) return
  const { w, h } = outputDims(base.naturalWidth, base.naturalHeight, PREVIEW_MAX_W)
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
  try {
    const cfg = animated.value ? applyMotion(config.value, t) : config.value
    const passes = composePasses(cfg, effectDef.value, t, texBundle(effectDef.value))
    el.getContext('2d')!.drawImage(shaderFx.render(passes, base, w, h), 0, 0)
    glError.value = null
  } catch (e: any) { glError.value = String(e?.message ?? e) }
}

let raf = 0, start = 0
function loop(ts: number) {
  if (!start) start = ts
  renderFrame(((ts - start) / 1000) % Math.max(0.1, config.value.motion.duration))
  raf = requestAnimationFrame(loop)
}
function startPreview() { cancelAnimationFrame(raf); start = 0; if (animated.value) raf = requestAnimationFrame(loop); else renderFrame(0) }
function stopPreview() { cancelAnimationFrame(raf); raf = 0 }
watch(config, () => { if (!animated.value) renderFrame(0) }, { deep: true })
watch(animated, startPreview)

// ── source loading ────────────────────────────────────────────────────────────
const sourceUrl = computed(() => props.wiredUrl ?? config.value.source.dataUrl
  ?? (config.value.source.asset ? `/view?${new URLSearchParams({ filename: config.value.source.asset, type: 'input' })}` : null))
watch(sourceUrl, async (url) => {
  baseImage.value = null
  if (!url) return
  try { baseImage.value = await loadImage(url); startPreview() } catch { glError.value = 'Could not load source image' }
}, { immediate: true })

function onUpload(ev: Event) {
  const file = (ev.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => { config.value.source = { kind: 'upload', dataUrl: String(reader.result) } }
  reader.readAsDataURL(file)
}

// ── effect picker (CatalogModal) ───────────────────────────────────────────────
const pickerOpen = ref(false)
const pickerSearch = ref('')
const pickerFilter = ref('all')
const thumbs = ref<Record<string, string>>({})
const thumbCache: Record<string, string> = ((globalThis as any).__shaderStudioThumbs ??= {})
function titleCase(s: string): string { return s.replace(/(^|[_\s])(\w)/g, (_, sep, c) => (sep ? ' ' : '') + c.toUpperCase()).trim() }
const placeholder = (() => { const c = document.createElement('canvas'); c.width = 192; c.height = 108; const g = c.getContext('2d')!; const lg = g.createLinearGradient(0, 0, 192, 108); lg.addColorStop(0, '#444'); lg.addColorStop(1, '#999'); g.fillStyle = lg; g.fillRect(0, 0, 192, 108); return c })()
const pickerFilters = computed(() => {
  const counts = new Map<string, number>()
  for (const e of catalog.value?.effects ?? []) if (!e.generative) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
  const total = (catalog.value?.effects ?? []).filter(e => !e.generative).length
  return [{ id: 'all', label: 'All', count: total }, ...[...counts].map(([id, count]) => ({ id, label: titleCase(id), count }))]
})
const pickerItems = computed<EffectDef[]>(() => {
  const q = pickerSearch.value.trim().toLowerCase()
  return (catalog.value?.effects ?? []).filter(e => !e.generative
    && (pickerFilter.value === 'all' || e.category === pickerFilter.value)
    && (!q || e.name.toLowerCase().includes(q) || e.category.toLowerCase().includes(q)))
})
function renderThumb(def: EffectDef): string {
  const b = texBundle(def)
  if (def.textures.length && Object.keys(b.sources).length < def.textures.length) return ''
  try {
    const out = shaderFx.render([{ id: def.id, source: def.source, uniforms: { ...resolveUniforms(def, {}), u_time: 1.2, u_seed: 42, u_hasInput: 1, ...b.uniforms }, textures: b.sources }], placeholder, 192, 108)
    return out.toDataURL('image/jpeg', 0.82)
  } catch { return '' }
}
function ensureThumb(def: EffectDef | null | undefined) { if (!def || thumbCache[def.id]) return; const t = renderThumb(def); if (t) { thumbCache[def.id] = t; thumbs.value = { ...thumbCache } } }
function openPicker() { pickerSearch.value = ''; pickerFilter.value = 'all'; pickerOpen.value = true; for (const def of catalog.value?.effects ?? []) if (!def.generative) ensureThumb(def) }
function pickEffect(id: string) { config.value.effect = { id, params: {}, enabled: true }; pickerOpen.value = false; renderFrame(0) }
const currentThumb = computed(() => (effectDef.value ? thumbs.value[effectDef.value.id] ?? '' : ''))

// ── duotone / adjust presets ────────────────────────────────────────────────
function pickDuotone(p: { ink: string; paper: string }) { config.value.duotone.ink = p.ink; config.value.duotone.paper = p.paper; config.value.duotone.enabled = true }
function pickAdjustPreset(name: string) { const p = ADJUST_PRESETS.find(x => x.name === name); if (p) { applyAdjustPreset(config.value.adjust, p); config.value.adjust.enabled = true } }

// ── focus-point drag pad ────────────────────────────────────────────────────
let draggingFocus = false
function onFocusDown(ev: PointerEvent) { draggingFocus = true; (ev.target as HTMLElement).setPointerCapture(ev.pointerId); onFocusMove(ev) }
function onFocusMove(ev: PointerEvent) {
  if (!draggingFocus || !canvas.value) return
  const r = canvas.value.getBoundingClientRect()
  config.value.post.blur.focusX = Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1)
  config.value.post.blur.focusY = Math.min(Math.max((ev.clientY - r.top) / r.height, 0), 1)
}
function onFocusUp() { draggingFocus = false }

// ── motion tracks ────────────────────────────────────────────────────────────
const animatablePaths = computed(() => [
  ...ANIMATABLE,
  ...(effectDef.value?.params ?? []).map(p => ({ path: `effect.params.${p.uniform}`, label: `Effect · ${p.label}`, min: p.min, max: p.max })),
])
function addTrack() {
  const a = animatablePaths.value[0]!
  config.value.motion.tracks.push({ path: a.path, from: a.min, to: a.max, easing: 'pingpong', loops: 1, delay: 0, hold: 0, cycleOffset: 0 } as MotionTrack)
}
function removeTrack(i: number) { config.value.motion.tracks.splice(i, 1) }

// ── persistence ────────────────────────────────────────────────────────────────
function loadConfig() { const c = currentNode()?.data?.properties?.sailor_shaderStudio; if (c && typeof c === 'object') config.value = cloneConfig(c) }
function saveConfig() { const n = currentNode(); if (!n) return; n.data ||= {}; n.data.properties ||= {}; n.data.properties.sailor_shaderStudio = cloneConfig(config.value) }
function closeEditor() { try { saveConfig() } catch (e) { console.error('[shader-studio] saveConfig failed', e) } emit('close') }

// ── outputs (mirror Gradient Studio) ───────────────────────────────────────────
async function renderBlob(t: number): Promise<Blob> {
  const base = baseImage.value!
  const { w, h } = outputDims(base.naturalWidth, base.naturalHeight, config.value.resolution)
  const cfg = animated.value ? applyMotion(config.value, t) : config.value
  shaderFx.render(composePasses(cfg, effectDef.value, t, texBundle(effectDef.value)), base, w, h)
  return await new Promise<Blob>((res, rej) => (shaderFx as any).render && (document as any) && canvasToBlob(w, h, res, rej))
}
// shaderFx.render returns the shared canvas; grab it for toBlob.
function canvasToBlob(_w: number, _h: number, resolve: (b: Blob) => void, reject: (e: any) => void) {
  const c = (shaderFx as any).canvas as HTMLCanvasElement
  c.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png', 0.95)
}

async function generateImage() {
  if (!baseImage.value) { bakeMsg.value = 'Add a source first'; return }
  baking.value = true; bakeMsg.value = 'Rendering…'; stopPreview()
  try {
    const blob = await renderBlob(0)
    const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')
    const [filename] = await uploadFrameBatch([blob], 'shader_img')
    if (filename) {
      saveConfig()
      await recordAsset(activeTab.value?.projectUuid, 'image', filename)
      window.dispatchEvent(new CustomEvent('sailor:shaderStudioOutput', { detail: { sourceNodeId: props.nodeId, nodeType: 'Image', widgetOverrides: { image: filename } } }))
      closeEditor()
    }
  } catch (e) { console.error('[shader-studio] image failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

async function generateVideo() {
  if (!baseImage.value) { bakeMsg.value = 'Add a source first'; return }
  baking.value = true; stopPreview()
  try {
    const base = baseImage.value
    const m = config.value.motion
    const { w, h } = outputDims(base.naturalWidth, base.naturalHeight, config.value.resolution)
    const total = Math.max(1, Math.round(m.fps * m.duration))
    const bakeCfg = { fps: m.fps, loopDuration: m.duration, W: w, H: h, seed: 'shader', sig: JSON.stringify(config.value) }
    const bake = await ensureSpaceTypeBake(bakeCfg as any, undefined, {
      renderFrame: async (i) => { bakeMsg.value = `Baking ${i + 1}/${total}`; return await renderBlob(i / m.fps) },
    })
    bakeMsg.value = 'Encoding…'
    const res = await fetch('/sailor/spacetype_encode', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ frames: bake.frames, fps: m.fps, width: w, height: h }) })
    const data = await res.json().catch(() => ({}))
    if (data.filename) {
      await recordAsset(activeTab.value?.projectUuid, 'video', data.filename)
      window.dispatchEvent(new CustomEvent('sailor:shaderStudioOutput', { detail: { sourceNodeId: props.nodeId, nodeType: 'Video', widgetOverrides: { file: data.filename } } }))
      closeEditor()
    } else { bakeMsg.value = 'Encode failed — restart ComfyUI to load the encoder.'; console.error('[shader-studio] encode failed', data) }
  } catch (e) { console.error('[shader-studio] video failed', e); bakeMsg.value = 'Failed — see console.' }
  finally { baking.value = false; startPreview() }
}

const RESOLUTIONS = [1024, 1536, 2048, 4096]

onMounted(async () => { loadConfig(); catalog.value = await fetchShaderFxCatalog().catch(() => null); startPreview() })
onBeforeUnmount(() => { saveConfig(); stopPreview() })

function setParam(uniform: string, value: number) { config.value.effect.params = { ...config.value.effect.params, [uniform]: value } }
</script>

<template>
  <StudioModalShell>
    <template #preview>
      <div class="relative flex h-full w-full items-center justify-center">
        <canvas ref="canvas" class="max-h-full max-w-full rounded-lg shadow-2xl" />
        <!-- Focus point overlay when lens blur is on -->
        <div v-if="config.post.blur.enabled"
          class="nopan nodrag absolute size-3 -ml-1.5 -mt-1.5 cursor-move rounded-full border-2 border-white bg-black/30"
          :style="{ left: `${config.post.blur.focusX * 100}%`, top: `${config.post.blur.focusY * 100}%` }"
          @pointerdown="onFocusDown" @pointermove="onFocusMove" @pointerup="onFocusUp" />
        <span v-if="!baseImage" class="absolute text-xs text-white/40">Add a source image to begin</span>
      </div>
    </template>

    <template #actions>
      <button class="rounded-lg bg-blue-600 px-3 py-1.5 text-sm hover:bg-blue-500" :disabled="baking" @click="generateImage">{{ baking ? (bakeMsg || 'Working…') : 'Generate as image' }}</button>
      <button class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500" :disabled="baking" @click="generateVideo">{{ baking ? (bakeMsg || 'Working…') : 'Generate as video' }}</button>
      <span v-if="glError" class="ml-2 truncate text-xs text-red-300/80">{{ glError }}</span>
      <button class="ml-auto rounded-lg bg-white/5 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10" @click="closeEditor">Close</button>
    </template>

    <template #controls>
      <!-- Source -->
      <StudioSection title="Source">
        <p v-if="wiredUrl" class="mb-2 text-[11px] text-emerald-300/80">Using wired input</p>
        <label class="mb-1 block cursor-pointer rounded bg-white/10 px-2 py-1.5 text-center text-[11px] text-white/80 hover:bg-white/20">
          Upload image<input type="file" accept="image/*" class="hidden" @change="onUpload" />
        </label>
      </StudioSection>

      <!-- Stylized Effects -->
      <StudioSection title="Stylized Effects">
        <template #badge><input v-model="config.effect.enabled" type="checkbox" class="accent-emerald-500" @click.stop /></template>
        <button class="mb-2 flex w-full items-center gap-2 rounded border border-white/10 bg-white/[0.04] px-2 py-1.5 text-left hover:bg-white/[0.08]" @click="openPicker">
          <span class="size-5 overflow-hidden rounded bg-white/[0.06]"><img v-if="currentThumb" :src="currentThumb" class="h-full w-full object-cover" /></span>
          <span class="min-w-0 flex-1 truncate text-[11px] text-white/90">{{ effectDef?.name ?? 'Pick an effect' }}</span>
          <ChevronRight class="size-3.5 shrink-0 text-white/30" />
        </button>
        <div v-for="p in effectDef?.params ?? []" :key="p.uniform">
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>{{ p.label }}</span><span class="text-white/40">{{ (effectUniforms[p.uniform] ?? 0).toFixed(2) }}</span></label>
          <input type="range" class="mb-2 w-full accent-white" :min="p.min" :max="p.max" :step="p.step" :value="effectUniforms[p.uniform]" @input="setParam(p.uniform, Number(($event.target as HTMLInputElement).value))" />
        </div>
      </StudioSection>

      <!-- Duotone -->
      <StudioSection title="Duotone" :open="false">
        <template #badge><input v-model="config.duotone.enabled" type="checkbox" class="accent-emerald-500" @click.stop /></template>
        <div class="mb-2 flex items-center gap-2">
          <label class="text-[11px] text-white/60">Ink</label><input v-model="config.duotone.ink" type="color" class="h-7 w-10 rounded" />
          <label class="text-[11px] text-white/60">Paper</label><input v-model="config.duotone.paper" type="color" class="h-7 w-10 rounded" />
        </div>
        <div class="grid grid-cols-4 gap-1">
          <button v-for="p in DUOTONE_PRESETS" :key="p.name" class="h-7 overflow-hidden rounded border border-white/10" :title="p.name" @click="pickDuotone(p)">
            <span class="flex h-full w-full"><span class="h-full w-1/2" :style="{ background: p.ink }" /><span class="h-full w-1/2" :style="{ background: p.paper }" /></span>
          </button>
        </div>
      </StudioSection>

      <!-- Adjustments -->
      <StudioSection title="Adjustments" :open="false">
        <template #badge><input v-model="config.adjust.enabled" type="checkbox" class="accent-emerald-500" @click.stop /></template>
        <select class="mb-2 w-full rounded bg-white/10 px-2 py-1 text-xs" @change="pickAdjustPreset(($event.target as HTMLSelectElement).value)">
          <option v-for="p in ADJUST_PRESETS" :key="p.name" :value="p.name">{{ p.name }}</option>
        </select>
        <template v-for="f in ([['exposure','Exposure',-2,2],['brightness','Brightness',-1,1],['contrast','Contrast',-1,1],['saturation','Saturation',-1,1],['hue','Hue',-180,180],['temperature','Temperature',-1,1],['tint','Tint',-1,1]] as const)" :key="f[0]">
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>{{ f[1] }}</span><span class="text-white/40">{{ (config.adjust as any)[f[0]].toFixed(2) }}</span></label>
          <input v-model.number="(config.adjust as any)[f[0]]" type="range" :min="f[2]" :max="f[3]" step="0.01" class="mb-2 w-full" />
        </template>
      </StudioSection>

      <!-- Post-processing -->
      <StudioSection title="Post-processing" :open="false">
        <div class="mb-1 flex items-center justify-between"><span class="text-xs text-white/70">Lens Blur</span><input v-model="config.post.blur.enabled" type="checkbox" class="accent-emerald-500" /></div>
        <template v-if="config.post.blur.enabled">
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Focus range</span><span class="text-white/40">{{ config.post.blur.range.toFixed(2) }}</span></label>
          <input v-model.number="config.post.blur.range" type="range" min="0" max="1" step="0.01" class="mb-2 w-full" />
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Aperture</span><span class="text-white/40">{{ config.post.blur.aperture.toFixed(2) }}</span></label>
          <input v-model.number="config.post.blur.aperture" type="range" min="0" max="1" step="0.01" class="mb-2 w-full" />
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Max blur</span><span class="text-white/40">{{ config.post.blur.maxBlur.toFixed(0) }}</span></label>
          <input v-model.number="config.post.blur.maxBlur" type="range" min="0" max="40" step="1" class="mb-2 w-full" />
        </template>
        <div class="mb-1 mt-2 flex items-center justify-between"><span class="text-xs text-white/70">Chromatic</span><input v-model="config.post.chromatic.enabled" type="checkbox" class="accent-emerald-500" /></div>
        <template v-if="config.post.chromatic.enabled">
          <label class="mb-0.5 flex justify-between text-[11px] text-white/60"><span>Amount</span><span class="text-white/40">{{ config.post.chromatic.amount.toFixed(2) }}</span></label>
          <input v-model.number="config.post.chromatic.amount" type="range" min="0" max="1" step="0.01" class="w-full" />
        </template>
      </StudioSection>

      <!-- Canvas / Motion -->
      <StudioSection title="Output" :open="false">
        <label class="mb-1 block text-xs text-white/60">Resolution (long edge)</label>
        <select v-model.number="config.resolution" class="mb-2 w-full rounded bg-white/10 px-2 py-1 text-xs">
          <option v-for="r in RESOLUTIONS" :key="r" :value="r">{{ r }}px</option>
        </select>
      </StudioSection>

      <StudioSection title="Motion" :open="false">
        <template #badge><button class="flex items-center gap-1 normal-case text-white/40 hover:text-white" @click.stop="addTrack"><Plus class="h-3 w-3" /> Track</button></template>
        <p v-if="!config.motion.tracks.length" class="text-[11px] text-white/30">Add a track to animate a parameter and export video.</p>
        <div v-for="(tk, i) in config.motion.tracks" :key="i" class="mb-2 rounded border border-white/10 p-2">
          <div class="mb-1 flex items-center gap-1">
            <select v-model="tk.path" class="min-w-0 flex-1 rounded bg-white/10 px-1 py-0.5 text-[11px]"><option v-for="a in animatablePaths" :key="a.path" :value="a.path">{{ a.label }}</option></select>
            <button class="text-white/30 hover:text-white/70" @click="removeTrack(i)"><Trash2 class="h-3 w-3" /></button>
          </div>
          <div class="flex items-center gap-1 text-[11px] text-white/50">
            <span>from</span><input v-model.number="tk.from" type="number" step="0.05" class="w-14 rounded bg-white/10 px-1 py-0.5" />
            <span>to</span><input v-model.number="tk.to" type="number" step="0.05" class="w-14 rounded bg-white/10 px-1 py-0.5" />
            <select v-model="tk.easing" class="rounded bg-white/10 px-1 py-0.5"><option value="linear">Linear</option><option value="pingpong">Ping-pong</option><option value="easeinout">Ease</option></select>
          </div>
        </div>
        <div class="mt-2 grid grid-cols-2 gap-2">
          <div><label class="mb-1 flex justify-between text-[11px] text-white/60"><span>Duration</span><span class="text-white/40">{{ config.motion.duration }}s</span></label><input v-model.number="config.motion.duration" type="range" min="1" max="12" step="0.5" class="w-full" /></div>
          <div><label class="mb-1 block text-[11px] text-white/60">FPS</label><select v-model.number="config.motion.fps" class="w-full rounded bg-white/10 px-1 py-0.5 text-[11px]"><option :value="24">24</option><option :value="30">30</option><option :value="60">60</option></select></div>
        </div>
      </StudioSection>
    </template>
  </StudioModalShell>

  <CatalogModal :open="pickerOpen" title="Shader Effects" subtitle="Pick an effect to apply"
    :items="pickerItems" :selected-id="config.effect.id" :filters="pickerFilters" :active-filter-id="pickerFilter" :search-query="pickerSearch"
    search-placeholder="Search effects…" confirm-label="Use effect" empty-message="No effects match your search."
    @close="pickerOpen = false" @confirm="pickEffect(($event as EffectDef).id)" @update:active-filter-id="pickerFilter = $event" @update:search-query="pickerSearch = $event">
    <template #card="{ item }">
      <div class="aspect-video overflow-hidden bg-black/20"><img v-if="thumbs[(item as EffectDef).id]" :src="thumbs[(item as EffectDef).id]" class="h-full w-full object-cover" /></div>
      <div class="px-2 py-1.5"><div class="truncate text-[11px] text-white/85">{{ (item as EffectDef).name }}</div><div class="text-[10px] capitalize text-white/35">{{ (item as EffectDef).category }}</div></div>
    </template>
  </CatalogModal>
</template>
```

**Important — `renderBlob`/`canvasToBlob` rely on `shaderFx.canvas`.** The renderer's `canvas` field is `private`. During implementation, add a public accessor to `app/lib/shaderfx/renderer.ts`:

```ts
// add inside class ShaderFxRenderer
get outputCanvas(): HTMLCanvasElement | null { return this.canvas }
```

Then in the surface use `(shaderFx.outputCanvas)!.toBlob(...)` instead of the `(shaderFx as any).canvas` hack. Update `renderBlob` to:

```ts
async function renderBlob(t: number): Promise<Blob> {
  const base = baseImage.value!
  const { w, h } = outputDims(base.naturalWidth, base.naturalHeight, config.value.resolution)
  const cfg = animated.value ? applyMotion(config.value, t) : config.value
  shaderFx.render(composePasses(cfg, effectDef.value, t, texBundle(effectDef.value)), base, w, h)
  const c = shaderFx.outputCanvas!
  return await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png', 0.95))
}
```

and delete the `canvasToBlob` helper. (Do this in Step 1 — the code above shows the hack only to flag the dependency; ship the clean accessor version.)

- [ ] **Step 2: Verify lib imports still pass**

Run: `cd frontend && npm run test:unit -- shaderstudio`
Expected: PASS (all shaderstudio specs).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/ShaderStudioSurface.vue frontend/app/lib/shaderfx/renderer.ts
git commit -m "feat(shader-studio): full-screen surface editor + outputCanvas accessor"
```

---

## Task 9: Wiring

**Files:**
- Modify: `frontend/app/composables/useVueNodes.ts:152-173` (ARTIFACT_NODE_COMPONENTS)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (imports, node-types map ~line 4258, createNodeData special-case ~line 654, open handler ~line 1679 + state ref, surface mount ~line 4496, listeners ~line 2135/2167)
- Modify: `frontend/app/layouts/default.vue:116` (Add menu)

- [ ] **Step 1: Register the artifact component**

In `frontend/app/composables/useVueNodes.ts`, find the `ARTIFACT_NODE_COMPONENTS` object (contains `GradientStudio: 'gradient-studio',`) and add below it:

```ts
  ShaderStudio: 'shader-studio',
```

- [ ] **Step 2: Import + register the node-types component**

In `frontend/app/components/vue-canvas/VueNodeCanvas.vue`, near the other studio imports (`import GradientStudioNode from ...`) add:

```ts
import ShaderStudioNode from '~/components/vue-canvas/ShaderStudioNode.vue'
```

In the `<VueFlow ... :node-types="{ ... }">` map (the long line containing `'gradient-studio': markRaw(GradientStudioNode),`), add:

```ts
'shader-studio': markRaw(ShaderStudioNode),
```

- [ ] **Step 3: Give the frontend-only node an input + output**

In `createNodeData`, find the special-case:

```ts
  if ((nodeType === 'SpaceType' || nodeType === 'GradientStudio') && (!data.data.outputs || data.data.outputs.length === 0)) {
    data.data.outputs = [{ name: 'output', type: '*', links: null }]
  }
```

Replace it with (adds ShaderStudio, and gives ShaderStudio an image input):

```ts
  if ((nodeType === 'SpaceType' || nodeType === 'GradientStudio' || nodeType === 'ShaderStudio') && (!data.data.outputs || data.data.outputs.length === 0)) {
    data.data.outputs = [{ name: 'output', type: '*', links: null }]
  }
  // Shader Studio consumes an image — give it one input handle (input-0).
  if (nodeType === 'ShaderStudio' && (!data.data.inputs || data.data.inputs.length === 0)) {
    data.data.inputs = [{ name: 'image', type: 'IMAGE', link: null }]
  }
```

- [ ] **Step 4: Add the open handler + state ref**

Near `const gradientStudioOpenForId = ref<...>` (search for `gradientStudioOpenForId`), add a sibling ref:

```ts
const shaderStudioOpenForId = ref<string | null>(null)
const shaderStudioWiredUrl = ref<string | null>(null)
```

Near `handleOpenGradientStudio`, add (resolve the wired input at open time):

```ts
function handleOpenShaderStudio(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!detail?.nodeId) return
  shaderStudioOpenForId.value = String(detail.nodeId)
  // Resolve the wired image (input-0) now, from the canvas source of truth.
  const { resolveWiredInput } = require('~/lib/shaderstudio/source')
  shaderStudioWiredUrl.value = resolveWiredInput(String(detail.nodeId), nodes.value as any[], edges.value as any[])
}
```

If `require` isn't available in this module (ESM), import at top instead:

```ts
import { resolveWiredInput } from '~/lib/shaderstudio/source'
```

and use it directly in the handler (drop the `require` line).

- [ ] **Step 5: Register/unregister the listeners**

Find the block that does `window.addEventListener('sailor:openGradientStudio', handleOpenGradientStudio)` and `window.addEventListener('sailor:gradientStudioOutput', handleSpaceTypeOutput)` and add beside them:

```ts
  window.addEventListener('sailor:openShaderStudio', handleOpenShaderStudio)
  window.addEventListener('sailor:shaderStudioOutput', handleSpaceTypeOutput)
```

Find the matching `removeEventListener` block and add:

```ts
  window.removeEventListener('sailor:openShaderStudio', handleOpenShaderStudio)
  window.removeEventListener('sailor:shaderStudioOutput', handleSpaceTypeOutput)
```

- [ ] **Step 6: Mount the surface**

After the Gradient Studio surface `<Teleport>` block (search `VueCanvasGradientStudioSurface`), add:

```vue
    <!-- Shader Studio editor modal (frontend-only config node) -->
    <Teleport to="body">
      <VueCanvasShaderStudioSurface
        v-if="shaderStudioOpenForId"
        :node-id="shaderStudioOpenForId"
        :nodes="nodes as any[]"
        :wired-url="shaderStudioWiredUrl"
        @close="shaderStudioOpenForId = null"
      />
    </Teleport>
```

(The `VueCanvas` prefix maps to `components/vue-canvas/` auto-import; confirm `VueCanvasGradientStudioSurface` resolves the same way — if Gradient uses an explicit import, import `ShaderStudioSurface` the same way and use `<ShaderStudioSurface .../>`.)

- [ ] **Step 7: Add the Add-menu entry**

In `frontend/app/layouts/default.vue`, find:

```ts
  { label: 'Gradient', icon: Sparkles, nodeType: 'GradientStudio' },
```

Add below it:

```ts
  { label: 'Shader', icon: Sparkles, nodeType: 'ShaderStudio' },
```

- [ ] **Step 8: Verify the build compiles**

Run: `cd frontend && npm run test:unit -- shaderstudio`
Expected: PASS. Then start the dev server (Task 11) to confirm no runtime/compile errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/app/composables/useVueNodes.ts frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/layouts/default.vue
git commit -m "feat(shader-studio): wire node into canvas, menu, open/output events"
```

---

## Task 10: Full unit suite green

- [ ] **Step 1: Run all shaderstudio specs together**

Run: `cd frontend && npm run test:unit -- shaderstudio`
Expected: PASS — types (3), presets (2), motion (5), glsl (4), passes (4), source (3).

- [ ] **Step 2: Run the whole unit suite to confirm no regressions**

Run: `cd frontend && npm run test:unit`
Expected: PASS — all pre-existing specs still green (no shared files were changed except `renderer.ts`, which only gained a getter).

- [ ] **Step 3: Commit (if any fixes were needed)**

```bash
git add -A && git commit -m "test(shader-studio): full unit suite green"
```

---

## Task 11: In-app verification

This step is manual (the WebGL preview is GPU-gated, like the sibling studios). Start both servers per `CLAUDE.md`:
- Frontend: `cd frontend && npm run dev`
- ComfyUI: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python main.py --listen 127.0.0.1 --port 8188`

- [ ] **Step 1: Add the node** — Add menu → "Shader". Confirm the card mounts with an input handle (left) and output handle (right), showing "Connect or add an image".
- [ ] **Step 2: In-studio source** — Edit → Source → Upload an image. Confirm the preview shows it.
- [ ] **Step 3: Stylized effect** — pick an effect (e.g. Halftone), adjust params; confirm live preview updates.
- [ ] **Step 4: Duotone** — enable, pick a preset; confirm ink/paper mapping.
- [ ] **Step 5: Adjustments** — enable, try the "Punchy" preset + sliders; confirm grade.
- [ ] **Step 6: Post** — enable Lens Blur; drag the focus point on the preview; enable Chromatic; confirm both.
- [ ] **Step 7: Wired input** — wire a LoadImage/upstream image into the node's input; reopen the editor; confirm "Using wired input" and the wired image renders (wired wins over upload).
- [ ] **Step 8: Generate as image** — confirm a new Image artifact node appears wired from the studio, the file shows, and it lands in the Assets panel.
- [ ] **Step 9: Motion + video** — add a track (e.g. Chromatic amount, ping-pong), set duration/fps, Generate as video; confirm a seamless-loop Video artifact + Asset.
- [ ] **Step 10: Note results** — record any issues; fix source files and re-verify from the relevant step.

---

## Task 12: Finish the branch

- [ ] **Step 1:** Use the `superpowers:finishing-a-development-branch` skill to choose merge / PR / cleanup.
- [ ] **Step 2:** Update memory: add a `project_shader_studio.md` memory (mirror the gradient-studio entry) and an index line in `MEMORY.md`.

---

## Spec coverage self-check

- Input "Both" → Task 6 (wired resolution) + Task 8 (upload/asset) + Task 9 (input handle, wired-url prop). ✓
- Full stack (effect/duotone/adjust/post) → Tasks 4 (GLSL) + 5 (compose) + 8 (UI). ✓
- Duotone as studio-level pass → Tasks 4/5/8. ✓
- Time-driven loop motion → Tasks 3 + 8 (tracks, bake). ✓
- Frontend-only node mirroring Gradient Studio → Tasks 7/8/9. ✓
- Output via Space Type rails (still + video + asset) → Task 8. ✓
- No backend changes → confirmed (only `/sailor/spacetype_encode`, reused). ✓
- No-purple preference → emerald/white-opacity only in components. ✓
- Generative effects hidden from picker → Task 8 (`!e.generative` filter). ✓

**Non-goals (not implemented, by design):** keyframe lanes, depth-based DoF, per-effect color schema, multi-effect stacking.
