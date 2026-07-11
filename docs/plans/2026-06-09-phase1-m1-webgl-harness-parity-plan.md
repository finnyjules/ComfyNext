# Phase 1 / M1: WebGL Harness Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic WebGL2 renderer (`WebGLPreviewRenderer`) that passes the Phase-0 golden spec on all three fixtures behind the existing `PreviewRenderer` seam — milestone M1 of `docs/plans/2026-06-09-phase1-webgl-engine-design.md`.

**Architecture:** A TS reference implementation of the timeline blend math (`shared/timeline/blendModes.ts`, mirroring Python `_blend_np` exactly) anchors a three-way chain: Python ↔ TS via embedded-value unit tests, TS ↔ GLSL via a Playwright conformance spec that drives the real production shader. A pure `buildDrawList(state, frame)` replicates the Python export renderer's clip selection, integer quantization, fades, and paint order; a ping-pong-FBO layer pass executes it (one fullscreen pass per layer: sample accumulated base + inverse-transformed source, blend, mix by alpha). The golden Playwright spec parametrizes over `server` and `webgl` renderers; the WebGL gate gets its own calibrated tolerance (mean + fraction-over-threshold — GPU sampling is not bit-identical to PIL BILINEAR).

**Tech Stack:** WebGL2 (raw, no library), TypeScript, Vitest (pure math), Playwright (GL conformance + goldens). No clock, no audio, no video decode, no editor changes in M1 (those are M2/M3).

**Scope guard (YAGNI):** Image clips only — exactly what the goldens exercise. `SequenceSource` is included (trivial, needed first thing in M2) but video/text/canvas sources, WebCodecs, and `usePlaybackEngineGL` are NOT in this plan. Unknown clip kinds are skipped with a single `console.warn`.

**Conventions:** pnpm for frontend (`cd frontend && pnpm run test:unit`); Playwright runs against live dev servers (frontend :3002, ComfyUI :8188 — see `frontend/playwright.config.ts` header). Working tree may contain Julien's unrelated WIP — `git add` only the files each task names. Commits in `Area: description` style.

**Two facts the implementer must not "fix":**
1. The blend formulas mirror `comfy_extras/nodes_timeline.py::_blend_np` (the golden source). Its `soft_light` is the pegtop variant `(1−2b)·a² + 2·b·a` — deliberately NOT the W3C soft-light used by the Compositor feature. Do not substitute the W3C formula.
2. The Python renderer quantizes layer sizes to integers (`round`) and anchors pastes at integer top-left corners — the draw-list replicates the size/center math exactly, but PIL's top-left anchoring makes odd-sized layers sit 0.5 px off vs a centered GL quad. This residual (plus PIL-vs-GPU resampling on rotated edges) is WHY the WebGL golden gate uses calibrated tolerances instead of 2/255.

---

## Task 1: TS blend reference (`blendModes.ts`)

The single TS source of the 10 blend formulas. Unit-tested against hand-computed values from `_blend_np`.

**Files:**
- Create: `frontend/shared/timeline/blendModes.ts`
- Test: `frontend/tests/unit/blend-modes.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/blend-modes.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { blendChannel, BLEND_MODE_INDEX } from '../../shared/timeline/blendModes'
import type { BlendMode } from '../../shared/timeline/types'

// Expected values computed by hand from comfy_extras/nodes_timeline.py::_blend_np
// (the golden source). soft_light is the pegtop variant (1-2b)a²+2ba — NOT W3C.
// Triples: [a (base), b (top), expected]
const CASES: Record<BlendMode, [number, number, number][]> = {
  normal: [[0.25, 0.5, 0.5], [0.8, 0.7, 0.7]],
  multiply: [[0.25, 0.5, 0.125], [0.8, 0.7, 0.56]],
  screen: [[0.25, 0.5, 0.625], [0.8, 0.7, 0.94]],
  // a < 0.5 → 2ab ; a ≥ 0.5 → 1-2(1-a)(1-b). Boundary a=0.5 takes the high branch.
  overlay: [[0.25, 0.5, 0.25], [0.8, 0.7, 0.88], [0.5, 0.25, 0.25]],
  soft_light: [[0.25, 0.5, 0.25], [0.8, 0.7, 0.864], [0.5, 0.25, 0.375]],
  // b < 0.5 → 2ab ; b ≥ 0.5 → 1-2(1-a)(1-b). Boundary b=0.5 takes the high branch.
  hard_light: [[0.5, 0.25, 0.25], [0.8, 0.7, 0.88], [0.25, 0.5, 0.25]],
  difference: [[0.25, 0.5, 0.25], [0.8, 0.7, 0.1]],
  lighten: [[0.25, 0.5, 0.5], [0.8, 0.7, 0.8]],
  darken: [[0.25, 0.5, 0.25], [0.8, 0.7, 0.7]],
  add: [[0.25, 0.5, 0.75], [0.8, 0.7, 1.0]],
}

describe('blendChannel mirrors _blend_np', () => {
  for (const [mode, cases] of Object.entries(CASES) as [BlendMode, [number, number, number][]][]) {
    it(mode, () => {
      for (const [a, b, want] of cases) {
        expect(blendChannel(a, b, mode), `${mode}(${a}, ${b})`).toBeCloseTo(want, 10)
      }
    })
  }

  it('boundary semantics: branch switches AT 0.5, high branch wins at exactly 0.5', () => {
    // overlay at a=0.5: 1-2(0.5)(1-b) — with b=0.9 → 1-2*0.5*0.1 = 0.9
    expect(blendChannel(0.5, 0.9, 'overlay')).toBeCloseTo(0.9, 10)
    // hard_light at b=0.5: high branch → 1-2(1-a)(0.5) = a (with a=0.3 → 0.3)
    expect(blendChannel(0.3, 0.5, 'hard_light')).toBeCloseTo(0.3, 10)
  })

  it('BLEND_MODE_INDEX covers all 10 modes with stable indices', () => {
    expect(BLEND_MODE_INDEX).toEqual({
      normal: 0, multiply: 1, screen: 2, overlay: 3, soft_light: 4,
      hard_light: 5, difference: 6, lighten: 7, darken: 8, add: 9,
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && pnpm run test:unit`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `frontend/shared/timeline/blendModes.ts`**

```ts
import type { BlendMode } from './types'

// TS reference of the timeline blend math — a 1:1 mirror of
// comfy_extras/nodes_timeline.py::_blend_np, the formula set the committed
// goldens were rendered with. The GLSL shader (engine/gl/shaders.ts) must
// match THIS, verified by tests/gl-blend-conformance.spec.ts.
//
// NOTE: soft_light is the pegtop variant (1-2b)a² + 2ba. The Compositor
// feature uses W3C soft-light — that is a DIFFERENT product surface with
// different goldens. Do not "unify" them.
//
// Branch boundaries: overlay switches on a < 0.5, hard_light on b < 0.5;
// at exactly 0.5 the high branch applies (numpy `where(x < 0.5, lo, hi)`).

export function blendChannel(a: number, b: number, mode: BlendMode): number {
  switch (mode) {
    case 'normal': return b
    case 'multiply': return a * b
    case 'screen': return 1 - (1 - a) * (1 - b)
    case 'overlay': return a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)
    case 'soft_light': return (1 - 2 * b) * a * a + 2 * b * a
    case 'hard_light': return b < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)
    case 'difference': return Math.abs(a - b)
    case 'lighten': return Math.max(a, b)
    case 'darken': return Math.min(a, b)
    case 'add': return Math.min(1, a + b)
  }
}

/** Stable mode → int mapping shared with the GLSL shader's `u_mode` uniform. */
export const BLEND_MODE_INDEX: Record<BlendMode, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, soft_light: 4,
  hard_light: 5, difference: 6, lighten: 7, darken: 8, add: 9,
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && pnpm run test:unit` — all green.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/timeline/blendModes.ts frontend/tests/unit/blend-modes.unit.spec.ts
git commit -m "Engine: TS blend reference mirroring _blend_np (pegtop soft_light), the golden formula set"
```

---

## Task 2: Compositor draw list (`compositor.ts`)

Pure derivation `(EditState, frame, canvas, source dims) → DrawEntry[]` replicating the Python export renderer's clip selection, integer quantization, fade math, and paint order. This file is the TS↔Python agreement point; every formula is imported from `shared/timeline` or transcribed with a comment naming its Python line.

**Files:**
- Create: `frontend/app/lib/engine/compositor.ts`
- Test: `frontend/tests/unit/compositor.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/compositor.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildDrawList, hexToRgb } from '../../app/lib/engine/compositor'
import { migrateEditState } from '../../shared/timeline/types'

const fixturesDir = fileURLToPath(new URL('../../../tests-unit/timeline_fixtures', import.meta.url))

function loadFixture(name: string) {
  const state = migrateEditState(JSON.parse(readFileSync(`${fixturesDir}/${name}`, 'utf-8')))!
  // All fixture assets are 320×180 (see tests-unit/timeline_fixtures/generate_assets.py).
  const dims = new Map<string, { w: number; h: number }>()
  for (const track of state.tracks) for (const clip of track.clips) {
    if ('path' in clip && clip.path) dims.set(clip.id, { w: 320, h: 180 })
  }
  return { state, dims }
}

describe('hexToRgb', () => {
  it('parses #rrggbb to floats', () => {
    expect(hexToRgb('#336699')).toEqual([0x33 / 255, 0x66 / 255, 0x99 / 255])
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
    expect(hexToRgb('garbage')).toEqual([0, 0, 0]) // fallback, mirrors _hex_rgb_safe
  })
})

describe('buildDrawList — fixture 03 (fades, stacking, muted)', () => {
  const { state, dims } = loadFixture('03-fades-stack.json')

  it('frame 3: only f1, mid fade-in (fade 3/6 = 0.5)', () => {
    const list = buildDrawList(state, 3, dims)
    expect(list.map(e => e.clipId)).toEqual(['f1'])
    expect(list[0]!.alpha).toBeCloseTo(0.5, 10)
  })

  it('frame 6: f1 fully faded in; f2 mid fade-in → alpha 0.5 * opacity 0.9 = 0.45', () => {
    const list = buildDrawList(state, 6, dims)
    expect(list.map(e => e.clipId)).toEqual(['f1', 'f2'])
    expect(list[0]!.alpha).toBeCloseTo(1.0, 10)
    expect(list[1]!.alpha).toBeCloseTo(0.45, 10)
  })

  it('frame 8: f2 past its fade-in window (local 4, fade_in 4 → no fade) → alpha 0.9', () => {
    const list = buildDrawList(state, 8, dims)
    expect(list[1]!.alpha).toBeCloseTo(0.9, 10)
  })

  it('frame 21: f1 fading out ((24-21)/6 = 0.5); f2 ended; f3 active; muted f4 NEVER appears', () => {
    const list = buildDrawList(state, 21, dims)
    expect(list.map(e => e.clipId)).toEqual(['f1', 'f3'])
    expect(list[0]!.alpha).toBeCloseTo(0.5, 10)
    expect(list[1]!.alpha).toBeCloseTo(1.0, 10)
  })

  it('quantizes size/center exactly like the Python renderer (f2: 16:9 source on 16:9 canvas)', () => {
    // gradient_b 320×180 on 640×360: same aspect → fit 640×360; scale 0.55 →
    // round(640*0.55)=352, round(360*0.55)=198; center 320+round(0.1*640)=384,
    // 180+round(0.1*360)=216 (mirrors _transform_and_alpha + paste math).
    const e = buildDrawList(state, 8, dims).find(x => x.clipId === 'f2')!
    expect(e.widthPx).toBe(352)
    expect(e.heightPx).toBe(198)
    expect(e.centerX).toBe(384)
    expect(e.centerY).toBe(216)
    expect(e.rotationDeg).toBe(0)
  })
})

describe('buildDrawList — fixture 02 (keyframed transforms)', () => {
  const { state, dims } = loadFixture('02-keyframes.json')

  it('frame 12: k1 keyframe hit exactly (x 0, y 0, rot 180, scale 0.6, opacity 1)', () => {
    const e = buildDrawList(state, 12, dims).find(x => x.clipId === 'k1')!
    expect(e.rotationDeg).toBeCloseTo(180, 10)
    expect(e.alpha).toBeCloseTo(1.0, 10)
    expect(e.widthPx).toBe(Math.round(640 * 0.6))
    expect(e.centerX).toBe(320)
  })

  it('frame 0: k1 first keyframe (opacity 0.2, scale 0.3, x -0.3 → center 320-192=128)', () => {
    const e = buildDrawList(state, 0, dims).find(x => x.clipId === 'k1')!
    expect(e.alpha).toBeCloseTo(0.2, 10)
    expect(e.widthPx).toBe(Math.round(640 * 0.3))
    expect(e.centerX).toBe(128)
  })
})

describe('buildDrawList — fixture 01 (blends, time window)', () => {
  const { state, dims } = loadFixture('01-static-blends.json')

  it('frame 0: c6 (add, starts frame 6) absent; order = track clip order', () => {
    expect(buildDrawList(state, 0, dims).map(e => e.clipId)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
  })

  it('frame 12: all six, blend modes carried through', () => {
    const list = buildDrawList(state, 12, dims)
    expect(list.map(e => e.blend)).toEqual(['normal', 'multiply', 'screen', 'overlay', 'difference', 'add'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && pnpm run test:unit` — FAIL, compositor module missing.

- [ ] **Step 3: Create `frontend/app/lib/engine/compositor.ts`**

```ts
import type { EditState, Clip, BlendMode } from '~~/shared/timeline/types'
import { interpolateClipAt } from '~~/shared/timeline/interpolate'

// Pure draw-list derivation for the WebGL engine — the TS twin of the per-frame
// logic in comfy_extras/nodes_timeline.py::render_frame_np + _transform_and_alpha.
// Every quantization here exists to match the Python renderer's integer math;
// change them only together with the Python side (the golden gate enforces it).
//
// Known residual divergence (accepted, covered by the calibrated WebGL golden
// tolerance): PIL pastes at integer top-left corners, so odd-sized layers sit
// 0.5 px off a true center; PIL BILINEAR resampling ≠ GPU linear filtering on
// rotated/scaled edges.

export interface DrawEntry {
  clipId: string
  /** Fetchable source URL (the clip's `path` as provided in the state). */
  url: string
  /** Layer size in px after aspect-fit + scale, pre-rotation (Python dw/dh). */
  widthPx: number
  heightPx: number
  /** Layer center in canvas px (Python W//2 + round(x*W), H//2 + round(y*H)). */
  centerX: number
  centerY: number
  rotationDeg: number
  /** opacity × fade, clamped [0,1] (Python: tf.opacity * fade). */
  alpha: number
  blend: BlendMode
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? '')
  if (!m) return [0, 0, 0]
  const v = parseInt(m[1]!, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/** Mirror of render_frame_np's fade math (nodes_timeline.py — fade_in: local/fi
 *  while local < fi; fade_out: (length-local)/fo while local > length-fo). */
function fadeAt(localF: number, length: number, fadeIn: number, fadeOut: number): number {
  let fade = 1
  if (fadeIn > 0 && localF < fadeIn) fade *= localF / fadeIn
  if (fadeOut > 0 && localF > length - fadeOut) fade *= (length - localF) / fadeOut
  return Math.max(0, Math.min(1, fade))
}

/** Mirror of _transform_and_alpha's aspect-fit + scale quantization. */
function fittedSize(srcW: number, srcH: number, W: number, H: number, scale: number): [number, number] {
  const cAspect = W / H
  const sAspect = srcW / srcH
  let fitW: number, fitH: number
  if (sAspect > cAspect) {
    fitW = W
    fitH = Math.max(1, Math.round(W / sAspect))
  } else {
    fitH = H
    fitW = Math.max(1, Math.round(H * sAspect))
  }
  const s = Math.max(0.01, scale)
  if (s === 1) return [fitW, fitH]
  return [Math.max(1, Math.round(fitW * s)), Math.max(1, Math.round(fitH * s))]
}

/**
 * Visible image layers at `frame`, in paint order (track order, clip order
 * within track — later entries on top), with all scalar math resolved.
 * `srcDims` maps clip id → natural source pixel size (known after load()).
 * Non-image clips and clips without a path/dims are skipped (M1 scope).
 */
export function buildDrawList(
  state: EditState,
  frame: number,
  srcDims: Map<string, { w: number; h: number }>,
): DrawEntry[] {
  const W = Math.max(1, Math.trunc(state.canvas.width))
  const H = Math.max(1, Math.trunc(state.canvas.height))
  const out: DrawEntry[] = []

  for (const track of state.tracks) {
    if (track.muted || track.kind === 'audio') continue
    for (const clip of track.clips as Clip[]) {
      if (clip.kind !== 'image') continue // M1: images only (matches golden fixtures)
      const url = clip.path
      const dims = srcDims.get(clip.id)
      if (!url || !dims) continue

      const length = Math.max(1, clip.length)
      const start = clip.start_frame
      if (frame < start || frame >= start + length) continue
      const localF = frame - start

      const tf = interpolateClipAt(clip, localF)
      const fade = fadeAt(localF, length, clip.fade_in ?? 0, clip.fade_out ?? 0)
      const [dw, dh] = fittedSize(dims.w, dims.h, W, H, tf.scale)

      out.push({
        clipId: clip.id,
        url,
        widthPx: dw,
        heightPx: dh,
        centerX: Math.floor(W / 2) + Math.round(tf.x * W),
        centerY: Math.floor(H / 2) + Math.round(tf.y * H),
        rotationDeg: tf.rotation,
        alpha: Math.max(0, Math.min(1, tf.opacity * fade)),
        blend: clip.blend ?? 'normal',
      })
    }
  }
  return out
}
```

Note for the implementer: vitest resolves `~~/` only if the alias is configured. The Phase-0 `vitest.config.ts` has no aliases (tests use relative imports). Add the alias now — in `frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '~~': fileURLToPath(new URL('.', import.meta.url)),
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.unit.spec.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && pnpm run test:unit` — all green (existing suites included).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/engine/compositor.ts frontend/tests/unit/compositor.unit.spec.ts frontend/vitest.config.ts
git commit -m "Engine: pure draw-list compositor mirroring render_frame_np quantization, fades, paint order"
```

---

## Task 3: GL plumbing (`gl/` — context, shaders, layer pass)

Raw WebGL2: an internal canvas, ping-pong framebuffers, one program. Per layer: fullscreen pass sampling the accumulated base + the inverse-transformed source, blending per `_blend_np`, mixing by alpha. No test of its own — Task 4's conformance spec and Task 7's goldens are its tests; this task must typecheck and the dev server must compile it.

**Files:**
- Create: `frontend/app/lib/engine/gl/shaders.ts`
- Create: `frontend/app/lib/engine/gl/glRenderer.ts`

- [ ] **Step 1: Create `frontend/app/lib/engine/gl/shaders.ts`**

```ts
// GLSL for the timeline layer pass. The blend block is a 1:1 port of
// shared/timeline/blendModes.ts (itself a mirror of Python _blend_np — the
// golden formula set). tests/gl-blend-conformance.spec.ts holds this shader to
// the TS reference; change them together.

export const VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 a_pos;   // fullscreen triangle, clip space
out vec2 v_uv;                         // 0..1, y-down image space
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

export const FRAGMENT_SRC = `#version 300 es
precision highp float;

uniform sampler2D u_base;   // accumulated canvas so far (full canvas)
uniform sampler2D u_src;    // source image
uniform vec2  u_canvas;     // canvas size, px
uniform vec2  u_center;     // layer center, px
uniform vec2  u_size;       // layer size (pre-rotation), px
uniform float u_rotation;   // radians; sign verified against goldens (Task 7)
uniform float u_alpha;      // opacity * fade
uniform int   u_mode;       // BLEND_MODE_INDEX

in vec2 v_uv;
out vec4 outColor;

vec3 blendMode(vec3 a, vec3 b, int m) {
  if (m == 0) return b;                                       // normal
  if (m == 1) return a * b;                                   // multiply
  if (m == 2) return 1.0 - (1.0 - a) * (1.0 - b);             // screen
  if (m == 3) {                                               // overlay (switch on base)
    vec3 lo = 2.0 * a * b;
    vec3 hi = 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
    return mix(hi, lo, vec3(lessThan(a, vec3(0.5))));
  }
  if (m == 4) return (1.0 - 2.0 * b) * a * a + 2.0 * b * a;   // soft_light (pegtop — matches _blend_np, NOT W3C)
  if (m == 5) {                                               // hard_light (switch on top)
    vec3 lo = 2.0 * a * b;
    vec3 hi = 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
    return mix(hi, lo, vec3(lessThan(b, vec3(0.5))));
  }
  if (m == 6) return abs(a - b);                              // difference
  if (m == 7) return max(a, b);                               // lighten
  if (m == 8) return min(a, b);                               // darken
  if (m == 9) return clamp(a + b, 0.0, 1.0);                  // add
  return b;
}

void main() {
  vec3 base = texture(u_base, v_uv).rgb;

  // Inverse-map this canvas pixel into the layer's local UV.
  vec2 p = v_uv * u_canvas;
  vec2 d = p - u_center;
  float c = cos(u_rotation);
  float s = sin(u_rotation);
  vec2 local = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
  vec2 uv = local / u_size + 0.5;

  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec3 src = texture(u_src, clamp(uv, 0.0, 1.0)).rgb;

  // Python: result = base*(1-a) + blend(base, src)*a   (a = 0 outside the layer)
  float a = u_alpha * inside;
  outColor = vec4(mix(base, blendMode(base, src, u_mode), a), 1.0);
}
`
```

- [ ] **Step 2: Create `frontend/app/lib/engine/gl/glRenderer.ts`**

```ts
import { VERTEX_SRC, FRAGMENT_SRC } from './shaders'
import { BLEND_MODE_INDEX } from '~~/shared/timeline/blendModes'
import type { DrawEntry } from '../compositor'

// Minimal WebGL2 executor for the timeline layer pass. One internal canvas,
// two ping-pong RGBA8 framebuffers, one program. render() leaves the result
// on the internal canvas; callers blit it wherever they need (2d drawImage —
// reading a WebGL canvas in the same task as the draw is spec-guaranteed).
//
// All textures are uploaded un-flipped and un-premultiplied; v_uv is y-down
// image space throughout, and the final present pass flips once. If goldens
// come out vertically mirrored, the bug is in exactly one place: PRESENT_FLIP.

const PRESENT_FLIP = true // flip Y once when drawing the final FBO to the canvas

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`shader compile failed: ${gl.getShaderInfoLog(sh)}`)
  }
  return sh
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const prog = gl.createProgram()!
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs))
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`program link failed: ${gl.getProgramInfoLog(prog)}`)
  }
  return prog
}

// Present pass: draw a texture to the default framebuffer (the canvas).
const PRESENT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_tex;
uniform float u_flipY;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec2 uv = vec2(v_uv.x, mix(v_uv.y, 1.0 - v_uv.y, u_flipY));
  outColor = vec4(texture(u_tex, uv).rgb, 1.0);
}
`

interface Target { tex: WebGLTexture; fbo: WebGLFramebuffer }

export class GlRenderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private layerProg: WebGLProgram
  private presentProg: WebGLProgram
  private targets: [Target, Target]
  private srcTextures = new Map<string, WebGLTexture>()
  private width = 0
  private height = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false })
    if (!gl) throw new Error('WebGL2 unavailable')
    this.gl = gl

    // Fullscreen triangle.
    const buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    this.layerProg = link(gl, VERTEX_SRC, FRAGMENT_SRC)
    this.presentProg = link(gl, VERTEX_SRC, PRESENT_FS)
    this.targets = [this.makeTarget(1, 1), this.makeTarget(1, 1)]
  }

  private makeTarget(w: number, h: number): Target {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { tex, fbo }
  }

  resize(w: number, h: number): void {
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.canvas.width = w
    this.canvas.height = h
    const gl = this.gl
    for (const t of this.targets) {
      gl.deleteTexture(t.tex)
      gl.deleteFramebuffer(t.fbo)
    }
    this.targets = [this.makeTarget(w, h), this.makeTarget(w, h)]
  }

  /** Upload (or fetch cached) source texture for a draw entry. LINEAR filtering
   *  — the GPU analogue of the Python renderer's BILINEAR resampling. */
  uploadSource(key: string, image: TexImageSource): void {
    const gl = this.gl
    if (this.srcTextures.has(key)) return
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.srcTextures.set(key, tex)
  }

  /** Render the draw list over bg color; result lands on this.canvas. */
  render(entries: DrawEntry[], bg: [number, number, number], w: number, h: number): void {
    const gl = this.gl
    this.resize(w, h)
    gl.viewport(0, 0, w, h)
    gl.disable(gl.BLEND)
    gl.disable(gl.DEPTH_TEST)

    // Seed ping with the background color.
    let read = 0
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[read]!.fbo)
    gl.clearColor(bg[0], bg[1], bg[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT)

    gl.useProgram(this.layerProg)
    const u = (name: string) => gl.getUniformLocation(this.layerProg, name)

    for (const e of entries) {
      const srcTex = this.srcTextures.get(e.clipId)
      if (!srcTex) continue
      const write = 1 - read
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[write]!.fbo)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, this.targets[read]!.tex)
      gl.uniform1i(u('u_base'), 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, srcTex)
      gl.uniform1i(u('u_src'), 1)

      gl.uniform2f(u('u_canvas'), w, h)
      gl.uniform2f(u('u_center'), e.centerX, e.centerY)
      gl.uniform2f(u('u_size'), e.widthPx, e.heightPx)
      gl.uniform1f(u('u_rotation'), (e.rotationDeg * Math.PI) / 180)
      gl.uniform1f(u('u_alpha'), e.alpha)
      gl.uniform1i(u('u_mode'), BLEND_MODE_INDEX[e.blend])

      gl.drawArrays(gl.TRIANGLES, 0, 3)
      read = write
    }

    // Present to the internal canvas (default framebuffer).
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.useProgram(this.presentProg)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.targets[read]!.tex)
    gl.uniform1i(gl.getUniformLocation(this.presentProg, 'u_tex'), 0)
    gl.uniform1f(gl.getUniformLocation(this.presentProg, 'u_flipY'), PRESENT_FLIP ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  clearSources(): void {
    for (const tex of this.srcTextures.values()) this.gl.deleteTexture(tex)
    this.srcTextures.clear()
  }

  dispose(): void {
    this.clearSources()
    const gl = this.gl
    for (const t of this.targets) {
      gl.deleteTexture(t.tex)
      gl.deleteFramebuffer(t.fbo)
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -E "engine/" | head -10`
Expected: no errors in `app/lib/engine/` (pre-existing errors elsewhere are not yours).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/lib/engine/gl/shaders.ts frontend/app/lib/engine/gl/glRenderer.ts
git commit -m "Engine: WebGL2 layer pass — ping-pong FBOs, _blend_np-ported blend shader, present flip"
```

---

## Task 4: GLSL blend conformance (page + Playwright spec)

Holds the production shader to the TS reference across the full 8-bit value grid — through the REAL `GlRenderer` path, not a copy of the shader.

**Files:**
- Create: `frontend/app/pages/gl-conformance.vue`
- Test: `frontend/tests/gl-blend-conformance.spec.ts`

- [ ] **Step 1: Create `frontend/app/pages/gl-conformance.vue`**

```vue
<script setup lang="ts">
// Dev/test-only: Playwright drives window.__glConformance to render the full
// (base, top) value grid through the REAL GlRenderer layer pass for one blend
// mode and read pixels back. Base = horizontal ramp seeded as the background…
// except the background is a flat color, so instead both ramps are textures:
// the base ramp is drawn first as a 'normal' full-canvas layer (alpha 1 over
// black — normal blend = replace), then the top ramp with the mode under test.
import { onMounted, onBeforeUnmount } from 'vue'
import { GlRenderer } from '~/lib/engine/gl/glRenderer'
import type { DrawEntry } from '~/lib/engine/compositor'
import type { BlendMode } from '~~/shared/timeline/types'

const SIZE = 256
let renderer: GlRenderer | null = null

function rampBitmap(horizontal: boolean): ImageData {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = horizontal ? x : y
      const i = (y * SIZE + x) * 4
      data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255
    }
  }
  return new ImageData(data, SIZE, SIZE)
}

onMounted(async () => {
  renderer = new GlRenderer()
  const base = await createImageBitmap(rampBitmap(true))   // value = x
  const top = await createImageBitmap(rampBitmap(false))   // value = y
  renderer.uploadSource('base-ramp', base)
  renderer.uploadSource('top-ramp', top)

  ;(window as any).__glConformance = {
    run(mode: BlendMode): string {
      if (!renderer) throw new Error('renderer gone')
      const full = {
        url: '', widthPx: SIZE, heightPx: SIZE,
        centerX: SIZE / 2, centerY: SIZE / 2, rotationDeg: 0, alpha: 1,
      }
      const entries: DrawEntry[] = [
        { ...full, clipId: 'base-ramp', blend: 'normal' },
        { ...full, clipId: 'top-ramp', blend: mode },
      ]
      renderer.render(entries, [0, 0, 0], SIZE, SIZE)
      const out = document.createElement('canvas')
      out.width = SIZE; out.height = SIZE
      out.getContext('2d')!.drawImage(renderer.canvas, 0, 0)
      return out.toDataURL('image/png')
    },
  }
})

onBeforeUnmount(() => {
  renderer?.dispose()
  renderer = null
  delete (window as any).__glConformance
})
</script>

<template>
  <div class="p-4 text-sm text-neutral-400">gl-conformance harness (Playwright-driven)</div>
</template>
```

NOTE: textures use LINEAR filtering, but the ramps render 1:1 texel-to-pixel (256×256 layer on a 256×256 canvas, no rotation), so sampling lands on texel centers and filtering is a no-op. If results are off by large amounts, check the present flip / UV orientation first — a vertical flip turns the top ramp into `255 - y` and every non-symmetric mode fails loudly. That is the intended canary.

- [ ] **Step 2: Write the spec** — `frontend/tests/gl-blend-conformance.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { PNG } from 'pngjs'
import { blendChannel } from '../shared/timeline/blendModes'
import type { BlendMode } from '../shared/timeline/types'

// GLSL ↔ TS blend conformance over the full 8-bit (base, top) grid, through
// the REAL GlRenderer layer pass. The TS reference itself mirrors Python
// _blend_np (vitest: blend-modes.unit.spec.ts) — together: Python ↔ TS ↔ GLSL.

const MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'soft_light',
  'hard_light', 'difference', 'lighten', 'darken', 'add',
]
const SIZE = 256
// 8-bit quantization happens twice (FBO write after base pass, final write):
// allow 2 LSB. Anything beyond that is a real formula/orientation bug.
const TOL = 2 / 255

test('GLSL blend modes match the TS reference grid', async ({ page }) => {
  await page.goto('/gl-conformance')
  await page.waitForFunction(() => !!(window as any).__glConformance, { timeout: 10_000 })

  for (const mode of MODES) {
    const dataUrl: string = await page.evaluate((m) => (window as any).__glConformance.run(m), mode)
    const png = PNG.sync.read(Buffer.from(dataUrl.split(',')[1]!, 'base64'))
    expect(png.width).toBe(SIZE)

    let worst = 0
    let worstAt = ''
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const a = x / 255
        const b = y / 255
        const want = blendChannel(a, b, mode)
        const got = png.data[(y * SIZE + x) * 4]! / 255 // gray ramps: R==G==B
        const d = Math.abs(got - want)
        if (d > worst) {
          worst = d
          worstAt = `a=${x}/255 b=${y}/255 got=${got.toFixed(4)} want=${want.toFixed(4)}`
        }
      }
    }
    expect(worst, `${mode} worst ${worstAt}`).toBeLessThanOrEqual(TOL)
  }
})
```

- [ ] **Step 3: Run it** (dev servers up; the new page may need a moment to compile on first hit)

Run: `cd frontend && npx playwright test tests/gl-blend-conformance.spec.ts --reporter=line`
Expected: 1 PASS (10 modes × 65,536 pairs). If a mode fails at ~`1 - expected`, the present flip or ramp orientation is inverted — fix `PRESENT_FLIP` in glRenderer.ts (one documented site), not the formulas.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/gl-conformance.vue frontend/tests/gl-blend-conformance.spec.ts
git commit -m "Engine: GLSL blend conformance — full 8-bit grid through the real layer pass vs TS reference"
```

---

## Task 5: Frame sources (`sources/`)

The source abstraction the M2 decode work will extend. M1 ships the interface + image + sequence.

**Files:**
- Create: `frontend/app/lib/engine/sources/frameSource.ts`
- Create: `frontend/app/lib/engine/sources/imageSource.ts`
- Create: `frontend/app/lib/engine/sources/sequenceSource.ts`
- Test: `frontend/tests/unit/sequence-source.unit.spec.ts`

- [ ] **Step 1: Write the failing test** — `frontend/tests/unit/sequence-source.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { sequenceIndex } from '../../app/lib/engine/sources/sequenceSource'

describe('sequenceIndex', () => {
  it('wraps modulo the sequence length with in_frame offset', () => {
    expect(sequenceIndex(0, 0, 10)).toBe(0)
    expect(sequenceIndex(3, 0, 10)).toBe(3)
    expect(sequenceIndex(12, 0, 10)).toBe(2)
    expect(sequenceIndex(3, 4, 10)).toBe(7)
    expect(sequenceIndex(9, 4, 10)).toBe(3)   // (9+4) % 10
  })
  it('clamps degenerate lengths', () => {
    expect(sequenceIndex(5, 0, 0)).toBe(0)
    expect(sequenceIndex(5, 0, 1)).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `cd frontend && pnpm run test:unit` → FAIL.

- [ ] **Step 3: Create the three source files**

`frontend/app/lib/engine/sources/frameSource.ts`:

```ts
// Frame acquisition contract for the engine. The compositor/GL layer never
// know which implementation produced a texture. M2 adds WebCodecsSource and
// VideoElementSource behind this same interface (see the Phase-1 design doc).
export interface FrameSource {
  /** Natural pixel size of the source (drives aspect-fit quantization). */
  readonly width: number
  readonly height: number
  /** The image for clip-local source frame `n`. Static sources ignore `n`. */
  getFrame(n: number): Promise<TexImageSource>
  dispose(): void
}
```

`frontend/app/lib/engine/sources/imageSource.ts`:

```ts
import type { FrameSource } from './frameSource'

/** A still image fetched from a URL, decoded once. */
export class ImageSource implements FrameSource {
  private constructor(private bitmap: ImageBitmap) {}

  static async load(url: string): Promise<ImageSource> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`ImageSource: ${res.status} fetching ${url}`)
    return new ImageSource(await createImageBitmap(await res.blob()))
  }

  get width(): number { return this.bitmap.width }
  get height(): number { return this.bitmap.height }

  async getFrame(): Promise<TexImageSource> {
    return this.bitmap
  }

  dispose(): void {
    this.bitmap.close()
  }
}
```

`frontend/app/lib/engine/sources/sequenceSource.ts`:

```ts
import type { FrameSource } from './frameSource'
import { ImageSource } from './imageSource'

/** Pure index math, mirrors the existing preview's frame-sequence addressing
 *  (clip-local frame + in_frame, wrapped modulo sequence length). */
export function sequenceIndex(localFrame: number, inFrame: number, length: number): number {
  if (length <= 1) return 0
  return ((localFrame + inFrame) % length + length) % length
}

/** A baked frame sequence (e.g. kinetic-title PNGs), preloaded like today's
 *  Canvas2D preview does. */
export class SequenceSource implements FrameSource {
  private constructor(private frames: ImageSource[], private inFrame: number) {}

  static async load(urls: string[], inFrame = 0): Promise<SequenceSource> {
    const frames = await Promise.all(urls.map(u => ImageSource.load(u)))
    if (!frames.length) throw new Error('SequenceSource: empty url list')
    return new SequenceSource(frames, inFrame)
  }

  get width(): number { return this.frames[0]!.width }
  get height(): number { return this.frames[0]!.height }

  getFrame(n: number): Promise<TexImageSource> {
    return this.frames[sequenceIndex(n, this.inFrame, this.frames.length)]!.getFrame()
  }

  dispose(): void {
    for (const f of this.frames) f.dispose()
  }
}
```

- [ ] **Step 4: Run to verify pass** — `cd frontend && pnpm run test:unit` → green.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/engine/sources
git commit -m "Engine: FrameSource contract + image and baked-sequence sources"
```

---

## Task 6: `WebGLPreviewRenderer` + harness `kind` param

The deterministic renderer behind the Phase-0 `PreviewRenderer` seam, and the harness page honoring `kind: 'server' | 'webgl'`.

**Files:**
- Create: `frontend/app/lib/engine/webglPreviewRenderer.ts`
- Modify: `frontend/app/pages/timeline-harness.vue`

- [ ] **Step 1: Create `frontend/app/lib/engine/webglPreviewRenderer.ts`**

```ts
import type { EditState } from '~~/shared/timeline/types'
import type { PreviewRenderer } from '~~/shared/timeline/previewRenderer'
import { buildDrawList, hexToRgb } from './compositor'
import { GlRenderer } from './gl/glRenderer'
import { ImageSource } from './sources/imageSource'
import type { FrameSource } from './sources/frameSource'

// Deterministic WebGL implementation of the PreviewRenderer seam: load()
// fetches every image clip's source (clip.path must be a fetchable URL in
// this context — the golden spec rewrites fixture paths to routed URLs),
// renderFrame() composites exactly frame n. No clock, no audio (M2).
export class WebGLPreviewRenderer implements PreviewRenderer {
  private state: EditState | null = null
  private gl: GlRenderer | null = null
  private sources = new Map<string, FrameSource>()

  async load(state: EditState): Promise<void> {
    this.disposeSources()
    this.gl ??= new GlRenderer()
    this.state = state

    const loads: Promise<void>[] = []
    for (const track of state.tracks) {
      if (track.kind === 'audio') continue
      for (const clip of track.clips) {
        if (clip.kind !== 'image' || !clip.path) {
          if (clip.kind !== 'image') console.warn(`WebGLPreviewRenderer: skipping unsupported clip kind '${clip.kind}' (M1)`)
          continue
        }
        const url = clip.path
        loads.push(ImageSource.load(url).then(src => {
          this.sources.set(clip.id, src)
        }))
      }
    }
    await Promise.all(loads)
  }

  async renderFrame(frame: number, target: HTMLCanvasElement): Promise<void> {
    if (!this.state || !this.gl) throw new Error('WebGLPreviewRenderer: load() first')
    const W = this.state.canvas.width
    const H = this.state.canvas.height

    const dims = new Map<string, { w: number; h: number }>()
    for (const [id, src] of this.sources) dims.set(id, { w: src.width, h: src.height })
    const entries = buildDrawList(this.state, frame, dims)

    for (const e of entries) {
      const frameImg = await this.sources.get(e.clipId)!.getFrame(0)
      this.gl.uploadSource(e.clipId, frameImg) // no-op when already uploaded
    }
    this.gl.render(entries, hexToRgb(this.state.canvas.bg_color), W, H)

    target.width = W
    target.height = H
    target.getContext('2d')!.drawImage(this.gl.canvas, 0, 0)
  }

  private disposeSources(): void {
    for (const s of this.sources.values()) s.dispose()
    this.sources.clear()
    this.gl?.clearSources()
  }

  dispose(): void {
    this.disposeSources()
    this.gl?.dispose()
    this.gl = null
    this.state = null
  }
}
```

- [ ] **Step 2: Honor `kind` in `frontend/app/pages/timeline-harness.vue`**

Replace the `load` function body (currently always `new ServerFrameRenderer()`):

```ts
    async load(stateJson: string, kind: 'server' | 'webgl' = 'server'): Promise<void> {
      const state = migrateEditState(JSON.parse(stateJson))
      if (!state) throw new Error('invalid edit state')
      renderer?.dispose()
      renderer = kind === 'webgl' ? new WebGLPreviewRenderer() : new ServerFrameRenderer()
      await renderer.load(state)
      status.value = `loaded (${kind})`
    },
```

And add the import next to the ServerFrameRenderer import:

```ts
import { WebGLPreviewRenderer } from '~/lib/engine/webglPreviewRenderer'
```

- [ ] **Step 3: Manual smoke** (dev servers up). Open `http://127.0.0.1:3002/timeline-harness` in the preview browser and run in the console:

```js
const s = { version: 2, canvas: { width: 320, height: 180, fps: 30, bg_color: '#336699' }, transitions: [], total_frames: 10, tracks: [] }
await window.__timelineHarness.load(JSON.stringify(s), 'webgl')
await window.__timelineHarness.renderFrame(0)   // → data URL of a solid #336699 frame
```

Expected: status shows `frame 0`, canvas is solid blue-gray. (Background-only exercises clear + present without sources.)

- [ ] **Step 4: Commit**

```bash
git add frontend/app/lib/engine/webglPreviewRenderer.ts frontend/app/pages/timeline-harness.vue
git commit -m "Engine: WebGLPreviewRenderer behind the PreviewRenderer seam; harness honors renderer kind"
```

---

## Task 7: Dual-renderer golden spec + tolerance calibration

The M1 acceptance gate. Parametrize the golden spec over both renderers; the WebGL run serves fixture assets via Playwright request interception and uses its own calibrated metrics (mean + fraction-over-threshold — max-diff alone is meaningless on resampled edges, where a 1-px shift on a hard edge legitimately produces a ~1.0 single-pixel diff).

**Files:**
- Modify: `frontend/tests/timeline-golden.spec.ts` (full replacement below)

- [ ] **Step 1: Replace `frontend/tests/timeline-golden.spec.ts`**

```ts
import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as path from 'node:path'
import { PNG } from 'pngjs'

// Golden-frame parity, both renderers:
//  - server: Python ground truth via /sailor/timeline/render_frame.
//    Bit-near-exact (same math, PNG quantization only) → tight tolerance.
//  - webgl: the Phase-1 engine. GPU linear sampling ≠ PIL BILINEAR and GL quads
//    are center-anchored vs PIL's integer top-left paste, so edges of
//    scaled/rotated layers differ by design. Gate = mean error + fraction of
//    channel samples above a perceptibility threshold, calibrated in M1.
//
// Requires both dev servers (see playwright.config.ts header).
// Recalibrate: WEBGL_CALIBRATE=1 npx playwright test tests/timeline-golden.spec.ts
// → prints per-frame stats instead of asserting; copy worst-case × safety
// margin into WEBGL_TOL below and record the measured values in the comment.

const thisDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(thisDir, '../..')
const fixturesDir = path.join(repoRoot, 'tests-unit', 'timeline_fixtures')
const goldenDir = path.join(repoRoot, 'tests-unit', 'timeline_golden')

const SERVER_TOL = { max: 2 / 255, mean: 0.5 / 255 }

// Perceptibility threshold for "this channel sample differs": 8/255.
// CALIBRATION (Task 7 Step 3): values below are placeholders that MUST be
// replaced with measured worst-case × 1.5. Record measurements here:
//   measured (machine, date): mean=…, pctOver=… per fixture — fill in.
const WEBGL_PCT_THRESHOLD = 8 / 255
const WEBGL_TOL = { mean: 1.5 / 255, pctOver: 0.01 }

const CALIBRATE = !!process.env.WEBGL_CALIBRATE

function decodeDataUrl(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.split(',')[1]!, 'base64'))
}

function diffStats(a: PNG, b: PNG): { max: number; mean: number; pctOver: number } {
  if (a.width !== b.width || a.height !== b.height) return { max: 1, mean: 1, pctOver: 1 }
  let max = 0
  let sum = 0
  let over = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c]! - b.data[i + c]!) / 255
      if (d > max) max = d
      if (d > WEBGL_PCT_THRESHOLD) over++
      sum += d
      n++
    }
  }
  return { max, mean: sum / n, pctOver: over / n }
}

const fixtures = readdirSync(fixturesDir).filter(f => f.endsWith('.json'))
const RENDERERS = ['server', 'webgl'] as const

for (const renderer of RENDERERS) {
  for (const fixtureFile of fixtures) {
    test(`golden parity [${renderer}]: ${fixtureFile}`, async ({ page }) => {
      const raw = JSON.parse(readFileSync(path.join(fixturesDir, fixtureFile), 'utf-8'))
      const frames: number[] = raw._golden.frames

      if (renderer === 'server') {
        // Python endpoint reads the filesystem directly — absolutize.
        for (const track of raw.tracks) for (const clip of track.clips) {
          if (clip.path && !path.isAbsolute(clip.path)) clip.path = path.join(fixturesDir, clip.path)
        }
      } else {
        // Browser fetches sources — rewrite to routed URLs served from disk.
        await page.route('**/__fixture_assets/*', (route) => {
          const name = route.request().url().split('/__fixture_assets/')[1]!
          const file = path.join(fixturesDir, 'assets', decodeURIComponent(name))
          if (!existsSync(file)) return route.fulfill({ status: 404 })
          return route.fulfill({ body: readFileSync(file), contentType: 'image/png' })
        })
        for (const track of raw.tracks) for (const clip of track.clips) {
          if (clip.path) clip.path = `/__fixture_assets/${path.basename(clip.path)}`
        }
      }

      await page.goto('/timeline-harness')
      await page.getByTestId('harness-status').waitFor()
      await page.waitForFunction(() => !!(window as any).__timelineHarness, { timeout: 10_000 })
      await page.evaluate(
        ([stateJson, kind]) => (window as any).__timelineHarness.load(stateJson, kind),
        [JSON.stringify(raw), renderer] as const,
      )

      const stem = fixtureFile.replace(/\.json$/, '')
      for (const frame of frames) {
        const goldenPath = path.join(goldenDir, stem, `f${String(frame).padStart(3, '0')}.png`)
        expect(existsSync(goldenPath), `missing golden ${goldenPath}`).toBe(true)

        const dataUrl: string = await page.evaluate(
          (f) => (window as any).__timelineHarness.renderFrame(f),
          frame,
        )
        const rendered = decodeDataUrl(dataUrl)
        const golden = PNG.sync.read(readFileSync(goldenPath))
        const { max, mean, pctOver } = diffStats(rendered, golden)

        if (renderer === 'server') {
          expect(max, `${stem} f${frame} max diff`).toBeLessThanOrEqual(SERVER_TOL.max)
          expect(mean, `${stem} f${frame} mean diff`).toBeLessThanOrEqual(SERVER_TOL.mean)
        } else if (CALIBRATE) {
          console.log(`[calibrate] ${stem} f${frame}: max=${max.toFixed(4)} mean=${(mean * 255).toFixed(3)}/255 pctOver=${(pctOver * 100).toFixed(3)}%`)
        } else {
          expect(mean, `${stem} f${frame} mean diff`).toBeLessThanOrEqual(WEBGL_TOL.mean)
          expect(pctOver, `${stem} f${frame} pctOver(${WEBGL_PCT_THRESHOLD * 255}/255)`).toBeLessThanOrEqual(WEBGL_TOL.pctOver)
        }
      }
    })
  }
}
```

- [ ] **Step 2: Orientation/sign shakedown.** Run ONLY the webgl fixture-03 test first in calibrate mode (fixture 03 frame 8 has the vertical magenta→green gradient — a y-flip or rotation-sign error is unmissable there):

```bash
cd frontend && WEBGL_CALIBRATE=1 npx playwright test tests/timeline-golden.spec.ts --grep "webgl.*03" --reporter=line
```

Read the printed stats. If mean > ~20/255, something is structurally wrong: check `PRESENT_FLIP` in glRenderer.ts (vertical mirror) and the rotation sign (compare a rendered fixture-01 webgl frame against `tests-unit/timeline_golden/01-static-blends/f012.png` — the checker patch tilts one way). Both knobs are single documented sites; flip, re-run, repeat until stats are in the small-number regime (mean well under 2/255, pctOver under a few percent).

- [ ] **Step 3: Calibrate.** Run the full webgl set in calibrate mode:

```bash
WEBGL_CALIBRATE=1 npx playwright test tests/timeline-golden.spec.ts --grep webgl --reporter=line
```

Collect the per-frame stats. Set `WEBGL_TOL.mean` and `WEBGL_TOL.pctOver` to **worst observed × 1.5**, and replace the placeholder comment with the actual measured numbers, machine, and date. Sanity expectation: fixture 01/03 frames with rotated patches will dominate pctOver; full-canvas unrotated frames (03 f000/f003) should be near-zero. If any frame's mean exceeds ~3/255 after the shakedown, STOP and investigate (likely quantization mismatch in `fittedSize` or fade math) rather than widening tolerances — the unit tests in Task 2 pin those formulas; cross-check against them.

- [ ] **Step 4: Run the full gate, both renderers**

```bash
npx playwright test tests/timeline-golden.spec.ts --reporter=line
```
Expected: 6 PASS (3 fixtures × 2 renderers).

- [ ] **Step 5: Negative sensitivity for the webgl path.** Temporarily multiply one golden by 0.9 (same procedure the Phase-0 review used: back up `tests-unit/timeline_golden/01-static-blends/f012.png`, darken via PIL, re-run `--grep webgl`): the 01 webgl test MUST FAIL on mean. Restore the golden (`git status` clean), re-run, 6 PASS again. This proves the calibrated tolerances still detect real drift.

- [ ] **Step 6: Commit**

```bash
git add frontend/tests/timeline-golden.spec.ts
git commit -m "Engine: golden gate runs both renderers — calibrated mean+pctOver tolerance for WebGL (values recorded)"
```

---

## Task 8: Verification sweep + design-doc status

- [ ] **Step 1: All suites**

```bash
cd frontend && pnpm run test:unit                                   # all green
cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/ | tail -2   # all green (untouched)
cd frontend && npx playwright test tests/timeline.spec.ts tests/timeline-golden.spec.ts tests/gl-blend-conformance.spec.ts --reporter=line
```
Expected: everything passes (timeline e2e unaffected; golden 6/6; conformance 1/1).

- [ ] **Step 2: Mark M1 done in the design doc.** In `docs/plans/2026-06-09-phase1-webgl-engine-design.md`, under Rollout milestones, change the M1 line to start with `1. **M1 — Harness parity** ✅ (completed — see docs/plans/2026-06-09-phase1-m1-webgl-harness-parity-plan.md; calibrated WebGL tolerances recorded in frontend/tests/timeline-golden.spec.ts)`.

- [ ] **Step 3: Commit**

```bash
git add docs/plans/2026-06-09-phase1-webgl-engine-design.md
git commit -m "Engine: M1 harness parity complete — design doc status updated"
```

---

## Out of scope (M1) — do not build

Playback clock, audio, WebCodecs/video sources, `usePlaybackEngineGL`, editor flag, Safari verification, context-loss recovery beyond throwing, text/canvas sources, video golden fixtures. All M2/M3 (see the Phase-1 design doc).
