# Gradient Studio — Liquid Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a domain-warped "liquid flow" gradient family to Gradient Studio — a global coordinate-warp that distorts every existing layout, plus a new `'liquid'` base layout that produces the neato.fun marble look.

**Architecture:** A new global `flow` config domain-warps the sample coordinate once in the fragment shader's `main()`, *before* `computeLayer` maps it — so the warp melts all geometric layouts. A new `u_layout == 4` ("liquid") branch samples the color ramp along the warped angle-gradient and shades it with a flow-derived fold relief (Depth & Light). At `intensity == 0` the warp is a no-op, so every existing gradient renders byte-identical. Still image only in v1 (`time = 0`).

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, WebGL2 GLSL ES 3.00 fragment shader, Vitest unit tests, the existing `gradientfx` engine under `frontend/app/lib/gradientfx/`.

## Global Constraints

- Work directly on `main`. Do NOT create a feature branch.
- Back-compat is mandatory: persisted node blobs lack `flow`; they must render exactly as today. The single migration seam is `ensureConfigDefaults` in `types.ts`.
- `flow.intensity == 0` MUST be a true no-op (existing gradients pixel-identical).
- No purple/violet accent colors anywhere in UI.
- All commands run from `frontend/`: `cd frontend` first.
- Unit tests run with `npm run test:unit` (Vitest). A WebGL shader cannot be exercised in jsdom — GLSL correctness is verified visually (project rule: never ship a WebGL effect on unit tests alone).
- `flow` is an **optional** field on `GradientConfig` (`flow?: FlowConfig`), read everywhere through the `flowConfig(cfg)` accessor — mirroring how `canvas.center?` and `relief.light?` are handled. This keeps existing config-constructing code compiling untouched.

---

### Task 1: FlowConfig type + back-compat backfill + `'liquid'` layout

**Files:**
- Modify: `frontend/app/lib/gradientfx/types.ts`
- Test: `frontend/tests/unit/gradientfx-engine.unit.spec.ts`

**Interfaces:**
- Produces:
  - `interface FlowConfig { angle, noiseScale, intensity, distortion, detail, depth, highlights, shadows, foldScale: number }`
  - `const DEFAULT_FLOW: FlowConfig` (intensity 0)
  - `function flowConfig(cfg: GradientConfig): FlowConfig`
  - `'liquid'` added to `LayoutKind` and `LAYOUTS`
  - `GradientConfig.flow?: FlowConfig`
  - `ensureConfigDefaults` backfills `cfg.flow`

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/unit/gradientfx-engine.unit.spec.ts` (add the imports `DEFAULT_FLOW, ensureConfigDefaults, flowConfig, LAYOUTS` to the existing `~/lib/gradientfx/types` import line):

```ts
import { DEFAULT_FLOW, ensureConfigDefaults, flowConfig, LAYOUTS } from '~/lib/gradientfx/types'

describe('gradientfx flow config', () => {
  it('LAYOUTS includes liquid', () => {
    expect(LAYOUTS).toContain('liquid')
  })
  it('DEFAULT_FLOW has zero intensity (no-op for existing gradients)', () => {
    expect(DEFAULT_FLOW.intensity).toBe(0)
  })
  it('ensureConfigDefaults backfills flow on a config that lacks it', () => {
    const c = defaultConfig('#bc') as any
    delete c.flow
    ensureConfigDefaults(c)
    expect(c.flow).toBeDefined()
    expect(c.flow.intensity).toBe(0)
  })
  it('flowConfig returns DEFAULT_FLOW when the config omits flow', () => {
    const c = defaultConfig('#bc2') as any
    delete c.flow
    expect(flowConfig(c)).toEqual(DEFAULT_FLOW)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test:unit -- gradientfx-engine`
Expected: FAIL — `DEFAULT_FLOW`/`flowConfig`/`ensureConfigDefaults` not exported, `LAYOUTS` lacks `'liquid'`.

- [ ] **Step 3: Add the type + layout + accessor + backfill**

In `frontend/app/lib/gradientfx/types.ts`:

Change the `LayoutKind` line (line 6):
```ts
export type LayoutKind = 'linear' | 'radial' | 'orbit' | 'stack' | 'liquid'
```

Change the `LAYOUTS` const (line 162):
```ts
export const LAYOUTS: LayoutKind[] = ['linear', 'radial', 'orbit', 'stack', 'liquid']
```

Add a `FlowConfig` interface after `ReliefConfig` (after line 117):
```ts
export interface FlowConfig {
  /** Base gradient direction (liquid) + warp bias, degrees 0..360. */
  angle: number
  /** Warp noise frequency, ~0.5..8. */
  noiseScale: number
  /** Displacement amount, 0..100. 0 = off (no distortion). */
  intensity: number
  /** Iterative curl / "Curve Distortion", 0..100. */
  distortion: number
  /** fbm octaves, 1..6. */
  detail: number
  /** Liquid fold-shading emboss amplitude, 0..100. */
  depth: number
  /** Liquid fold-shading bright-side gain, 0..100. */
  highlights: number
  /** Liquid fold-shading dark-side gain, 0..100. */
  shadows: number
  /** Liquid fold frequency, 0..100. */
  foldScale: number
}
```

Add `flow` to `GradientConfig` (after the `relief: ReliefConfig` line, line 151):
```ts
  /** Domain-warp / liquid flow (optional for back-compat; defaults to DEFAULT_FLOW). */
  flow?: FlowConfig
```

Add the default + accessor near `DEFAULT_LIGHT` (after line 177):
```ts
/** Default flow: no distortion (intensity 0) so existing gradients are unchanged. */
export const DEFAULT_FLOW: FlowConfig = {
  angle: 45, noiseScale: 3.5, intensity: 0, distortion: 50, detail: 2,
  depth: 60, highlights: 50, shadows: 55, foldScale: 60,
}

/** Flow block with the default applied when a config omits it. */
export function flowConfig(cfg: GradientConfig): FlowConfig {
  return cfg.flow ?? DEFAULT_FLOW
}
```

Extend `ensureConfigDefaults` (inside the function body, before `return cfg`, line 207-208):
```ts
  if (!cfg.flow) cfg.flow = { ...DEFAULT_FLOW }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm run test:unit -- gradientfx-engine`
Expected: PASS (all flow-config tests green, existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/gradientfx/types.ts frontend/tests/unit/gradientfx-engine.unit.spec.ts
git commit -m "feat(gradient-studio): FlowConfig type + liquid layout + back-compat backfill"
```

---

### Task 2: Randomize — flow params, liquid preset, flow lock

**Files:**
- Modify: `frontend/app/lib/gradientfx/randomize.ts`
- Test: `frontend/tests/unit/gradientfx-engine.unit.spec.ts`

**Interfaces:**
- Consumes (from Task 1): `FlowConfig`, `DEFAULT_FLOW`, `flowConfig`, `'liquid'` layout.
- Produces:
  - `function liquidConfig(seed?: string): GradientConfig`
  - `defaultConfig`/`buildConfig` set `flow`
  - `reroll` rolls `flow` under the `structure` scope and respects the `'flow'` lock key

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/unit/gradientfx-engine.unit.spec.ts` (add `liquidConfig` to the `~/lib/gradientfx/randomize` import):

```ts
import { buildConfig, defaultConfig, liquidConfig, reroll } from '~/lib/gradientfx/randomize'

describe('gradientfx liquid randomize', () => {
  it('liquidConfig produces a liquid layout with visible warp', () => {
    const c = liquidConfig('#lq')
    expect(c.canvas.layout).toBe('liquid')
    expect(c.flow!.intensity).toBeGreaterThan(0)
  })
  it('defaultConfig carries a no-op flow block', () => {
    expect(defaultConfig('#d').flow!.intensity).toBe(0)
  })
  it('reroll structure rolls flow; the flow lock pins it', () => {
    const base = buildConfig('#fl')
    const rolled = reroll(base, 'structure', '#fl2')
    expect(rolled.flow).not.toEqual(base.flow)

    const locked = { ...buildConfig('#fl3'), locks: { flow: true } }
    const r = reroll(locked, 'all', '#fl4')
    expect(r.flow).toEqual(locked.flow)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test:unit -- gradientfx-engine`
Expected: FAIL — `liquidConfig` not exported; `flow` undefined on configs.

- [ ] **Step 3: Implement flow randomization + preset**

In `frontend/app/lib/gradientfx/randomize.ts`:

Add `DEFAULT_FLOW`, `LayoutKind`, and `FlowConfig` to the existing `./types` import block (lines 6-10).

Add a `randFlow` helper after `randLight` (after line 110):
```ts
/** Random flow/warp params. Liquid layouts get a strong warp; geometric layouts get a subtle one (often none). */
function randFlow(rng: Rng, layout: LayoutKind): FlowConfig {
  const liquid = layout === 'liquid'
  return {
    angle: rng.range(0, 360),
    noiseScale: rng.range(1.5, 5),
    intensity: liquid ? rng.range(45, 85) : (rng.chance(0.4) ? rng.range(10, 45) : 0),
    distortion: rng.range(40, 90),
    detail: rng.int(1, 3),
    depth: rng.range(40, 75),
    highlights: rng.range(35, 65),
    shadows: rng.range(40, 70),
    foldScale: rng.range(40, 80),
  }
}
```

Add the preset after `stackConfig` (after line 177):
```ts
/**
 * The "Liquid" preset — a domain-warped marble flow (neato.fun look): the ramp smeared
 * through fbm noise, warm orange→peach→pink melting into deep indigo, with fold shading.
 */
export function liquidConfig(seed = randomSeed()): GradientConfig {
  return {
    seed,
    canvas: { aspect: '1:1', layout: 'liquid', margin: 0, innerRadius: 0, background: '#0e0a1e', center: { ...DEFAULT_CENTER } },
    relief: { grain: 0.18, relief: 0, light: { ...DEFAULT_LIGHT } },
    flow: { angle: 45, noiseScale: 3.5, intensity: 72, distortion: 80, detail: 2, depth: 60, highlights: 50, shadows: 55, foldScale: 60 },
    layers: [
      {
        blend: 'normal', opacity: 1,
        // Shape is unused by the liquid layout but kept so the layer schema stays complete.
        shape: { type: 'bands', count: 12, minDepth: 0, curveExp: 1, jitter: 0, peaks: 3, phase: 0, detail: 4, sweep: 360, scrub: 0, gap: 0, rounding: 0, direction: 'up', mirror: 'none', valley: 0.5 },
        color: { stops: [{ color: '#ff7a3d', pos: 0 }, { color: '#f6c39b', pos: 0.25 }, { color: '#f5a6cd', pos: 0.5 }, { color: '#2b3a55', pos: 0.75 }, { color: '#171327', pos: 1 }], gradientDir: 'vertical', mapping: 'field', steps: 0, hueDrift: 0, hueRotate: 0 },
      },
    ],
    motion: { tracks: [], duration: 4, fps: 30, size: 1080 },
    locks: {},
  }
}
```

In `defaultConfig`, add a flow line inside the returned object (after the `relief:` line, line 184):
```ts
    flow: { ...DEFAULT_FLOW },
```

In `buildConfig`, add a flow line inside the returned object (after the `relief:` line, line 214). Note `layout` is set on the `canvas` object just above, so read it back:
```ts
    flow: randFlow(rng, rng.chance(0.18) ? 'liquid' : 'linear'),
```
Then, so the picked layout and the flow agree, also bias the canvas layout pick: change the `layout:` line in `buildConfig`'s canvas (line 208) to compute it once above the return. Replace lines 204-208 region: before `return {`, add:
```ts
  const layout = rng.pick(LAYOUTS)
```
and change the canvas `layout` line to `layout,` and the flow line to:
```ts
    flow: randFlow(rng, layout),
```

In `reroll`:
- After the existing relief/center backfill block (after line 246), add flow rolling + the lock + backfill:
```ts
  if (doStructure && !locks.flow) next.flow = randFlow(makeRng(seed, 'flow'), next.canvas.layout)
  if (!next.flow) next.flow = { ...DEFAULT_FLOW }
```
(`reroll('all', …)` already re-picks `next.canvas.layout` from `LAYOUTS` at line 234, which now includes `'liquid'`, so liquid appears in full rolls automatically.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm run test:unit -- gradientfx-engine`
Expected: PASS (liquid randomize tests green; the existing "reroll color keeps structure" / "locks pin fields" tests still green).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/gradientfx/randomize.ts frontend/tests/unit/gradientfx-engine.unit.spec.ts
git commit -m "feat(gradient-studio): liquid preset + flow randomization + flow lock"
```

---

### Task 3: Shader warp + liquid branch + renderer uniforms

**Files:**
- Modify: `frontend/app/lib/gradientfx/shaders.ts`
- Modify: `frontend/app/lib/gradientfx/renderer.ts`
- Test: `frontend/tests/unit/gradientfx-engine.unit.spec.ts` (string-presence guard only)

**Interfaces:**
- Consumes (from Task 1): `flowConfig`, `'liquid'` layout.
- Produces: GLSL `applyFlow(vec2)` / `flowHeight(vec2)` / liquid `u_layout > 3.5` branch; `u_flow*` uniforms uploaded by the renderer; `LAYOUT_IDX.liquid = 4`.

- [ ] **Step 1: Write the failing guard test**

Add to `frontend/tests/unit/gradientfx-engine.unit.spec.ts`:

```ts
import { GRADIENT_FS } from '~/lib/gradientfx/shaders'

describe('gradientfx shader has flow stage', () => {
  it('declares the flow uniforms and warp function', () => {
    expect(GRADIENT_FS).toContain('u_flowIntensity')
    expect(GRADIENT_FS).toContain('vec2 applyFlow')
    expect(GRADIENT_FS).toContain('u_layout > 3.5')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- gradientfx-engine`
Expected: FAIL — shader source has none of these strings yet.

- [ ] **Step 3: Add the warp uniforms + noise + functions to the fragment shader**

In `frontend/app/lib/gradientfx/shaders.ts`, after the per-layer uniform block (after line 55, the `u_ringShape` line), add the flow uniforms:
```glsl
uniform float u_flowAngle;       // degrees — liquid base gradient dir
uniform float u_flowScale;       // warp noise frequency
uniform float u_flowIntensity;   // displacement (0 = no warp); pre-scaled in JS
uniform float u_flowDistortion;  // iterative curl strength; pre-scaled in JS
uniform float u_flowDetail;      // fbm octaves 1..6
uniform float u_flowDepth;       // liquid fold emboss amount 0..1
uniform float u_flowHighlights;  // liquid bright-side gain 0..1
uniform float u_flowShadows;     // liquid dark-side gain 0..1
uniform float u_flowFoldScale;   // liquid fold frequency
```

After the `hashGrain` function (after line 72), add value-noise + fbm + warp helpers:
```glsl
// Value noise + fbm for the domain warp (liquid flow). Independent of the grain hash.
float vhash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = vhash(i), b = vhash(i + vec2(1.0, 0.0)), c = vhash(i + vec2(0.0, 1.0)), d = vhash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, float oct) {
  float sum = 0.0, amp = 0.5, tot = 0.0;
  for (int k = 0; k < 6; k++) {
    if (float(k) >= oct) break;
    sum += amp * vnoise(p); tot += amp; p *= 2.0; amp *= 0.5;
  }
  return tot > 0.0 ? sum / tot : 0.0;
}
// Domain-warp the sample coord (Inigo-Quilez fbm-of-fbm). No-op when intensity is 0.
vec2 applyFlow(vec2 p) {
  if (u_flowIntensity <= 0.0) return p;
  vec2 sp = p * u_flowScale; sp.x *= u_aspect;
  vec2 q = vec2(fbm(sp, u_flowDetail), fbm(sp + vec2(5.2, 1.3), u_flowDetail));
  vec2 r = vec2(fbm(sp + u_flowDistortion * q + vec2(1.7, 9.2), u_flowDetail),
                fbm(sp + u_flowDistortion * q + vec2(8.3, 2.8), u_flowDetail));
  vec2 disp = (r - 0.5) * u_flowIntensity;
  disp.x /= u_aspect;
  return p + disp;
}
// Scalar fold height for the liquid Depth & Light shading.
float flowHeight(vec2 p) {
  vec2 sp = p * u_flowFoldScale; sp.x *= u_aspect;
  return fbm(sp, u_flowDetail);
}
```

Add the liquid branch at the very top of `computeLayer` (right after its local-var declarations, before the `if (u_layout > 2.5)` stack block — i.e. before line 139):
```glsl
  // ---- Liquid: no bars; sample the ramp along the (already-warped) angle gradient.
  if (u_layout > 3.5) {
    float a = u_flowAngle * PI / 180.0;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 pc = p - 0.5; pc.x *= u_aspect;
    float t = clamp(dot(pc, dir) + 0.5, 0.0, 1.0);
    t = quantize(t, u_steps[i]);
    return vec4(rotateHue(sampleRamp(i, t), u_hueRotate[i]), 1.0);
  }
```

In `main()`, warp the coord once and feed it to `computeLayer`, then add liquid fold-shading. Replace the current lines 344-372 region. The new `main()` head (warp + layers) and shading:

Change line 347 from `vec4 l0 = computeLayer(0, p);` to use a warped coordinate declared just after `vec2 p = v_texCoord;`:
```glsl
  vec2 p = v_texCoord;
  vec2 pw = applyFlow(p);              // domain-warped coord (identity when intensity 0)
  vec3 col = u_bg;

  vec4 l0 = computeLayer(0, pw);
  col = mix(col, l0.rgb, l0.a);
  float cover = l0.a;

  if (u_layerCount > 1.5) {
    vec4 l1 = computeLayer(1, pw);
    vec3 blended = blendLayers(col, l1.rgb, u_blend[1]);
    float a = l1.a * u_opacity[1];
    col = mix(col, blended, a);
    cover = max(cover, a);
  }
```

Gate the existing relief block so it does NOT run for liquid (liquid uses its own fold shading). Change the relief condition (line 362) from `if (u_relief > 0.001) {` to:
```glsl
  if (u_relief > 0.001 && u_layout < 3.5) {
```

Immediately after that relief block's closing brace (after line 372), add the liquid fold shading:
```glsl
  // Liquid Depth & Light: emboss from the flow fold field (its own light, not u_light).
  if (u_layout > 3.5 && u_flowDepth > 0.001) {
    float e = 1.5 / u_resolution.y;
    float h  = flowHeight(p);
    float hx = flowHeight(p + vec2(e, 0.0));
    float hy = flowHeight(p + vec2(0.0, e));
    vec3 n = normalize(vec3(-(hx - h) / e, -(hy - h) / e, 1.0 / max(u_flowDepth, 0.05)));
    float d = clamp(dot(n, normalize(vec3(0.4, 0.5, 0.8))), 0.0, 1.0);
    float gain = d > 0.5 ? u_flowHighlights : u_flowShadows;
    float shade = 1.0 + (d - 0.5) * 2.0 * gain;
    col *= clamp(shade, 0.0, 2.0);
  }
```

- [ ] **Step 4: Upload the flow uniforms in the renderer**

In `frontend/app/lib/gradientfx/renderer.ts`:

Add `flowConfig` to the `./types` import (line 11-14 block):
```ts
import { aspectRatio, canvasCenter, flowConfig, lightVector, reliefLight,
  type BlendKind, type Direction, type GradientConfig,
  type LayoutKind, type MappingKind } from './types'
```

Add `liquid: 4` to `LAYOUT_IDX` (line 19):
```ts
const LAYOUT_IDX: Record<LayoutKind, number> = { linear: 0, radial: 1, orbit: 2, stack: 3, liquid: 4 }
```

After the `u_layerCount` uniform upload (after line 150), add the flow uniforms (normalize 0..100 → shader ranges here, the same way `sweep` is pre-scaled in this file):
```ts
    const fl = flowConfig(c)
    gl.uniform1f(u('u_flowAngle'), fl.angle)
    gl.uniform1f(u('u_flowScale'), Math.max(0.2, fl.noiseScale))
    gl.uniform1f(u('u_flowIntensity'), (fl.intensity / 100) * 0.6)   // 0..0.6 displacement
    gl.uniform1f(u('u_flowDistortion'), (fl.distortion / 100) * 3.0) // 0..3 iterative curl
    gl.uniform1f(u('u_flowDetail'), Math.max(1, Math.min(6, Math.round(fl.detail))))
    gl.uniform1f(u('u_flowDepth'), fl.depth / 100)
    gl.uniform1f(u('u_flowHighlights'), fl.highlights / 100)
    gl.uniform1f(u('u_flowShadows'), fl.shadows / 100)
    gl.uniform1f(u('u_flowFoldScale'), 1.0 + (fl.foldScale / 100) * 6.0) // freq 1..7
```

- [ ] **Step 5: Run the guard test + typecheck**

Run: `cd frontend && npm run test:unit -- gradientfx-engine`
Expected: PASS (the shader string-presence test is green; all prior tests still green).

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json` (or the project's typecheck script if different)
Expected: no new type errors in `gradientfx`.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/gradientfx/shaders.ts frontend/app/lib/gradientfx/renderer.ts frontend/tests/unit/gradientfx-engine.unit.spec.ts
git commit -m "feat(gradient-studio): domain-warp flow stage + liquid layout in the shader"
```

---

### Task 4: Surface UI — Flow + Depth & Light sections, liquid gating, preset

**Files:**
- Modify: `frontend/app/components/vue-canvas/GradientStudioSurface.vue`

**Interfaces:**
- Consumes (from Tasks 1-2): `'liquid'` in `LAYOUTS`, `liquidConfig`, `flowConfig`.

- [ ] **Step 1: Add an `isLiquid` computed**

Near the existing `isRadial`/`isStack` computeds (lines 31-32), add:
```ts
const isLiquid = computed(() => config.value.canvas.layout === 'liquid')
```

- [ ] **Step 2: Widen the layout button grid to fit 5 layouts**

The Layout button grid (line 372) is `grid-cols-4`; with `'liquid'` added there are 5. Change that single class:
```html
        <div class="mb-2 grid grid-cols-5 gap-1">
```

- [ ] **Step 3: Add the FLOW section (global warp) after the Canvas section**

Immediately after the Canvas `</StudioSection>` (after line 389), insert a new section. `config.flow` is guaranteed present because the surface runs `ensureConfigDefaults` on load, but guard with `?.`/defaults so a stale in-memory config can't throw:
```html
      <!-- Flow (domain warp — distorts every layout; the heart of the liquid look) -->
      <StudioSection title="Flow" badge="all layouts" :open="isLiquid">
        <p class="mb-2 text-[11px] leading-snug text-white/40">Warps the gradient into liquid swirls. At 0 intensity the gradient is undistorted.</p>
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Angle</span><span class="text-white/40">{{ Math.round(config.flow!.angle) }}°</span></label>
        <input v-model.number="config.flow!.angle" type="range" min="0" max="360" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Noise scale</span><span class="text-white/40">{{ config.flow!.noiseScale.toFixed(1) }}</span></label>
        <input v-model.number="config.flow!.noiseScale" type="range" min="0.5" max="8" step="0.1" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Noise intensity</span><span class="text-white/40">{{ Math.round(config.flow!.intensity) }}</span></label>
        <input v-model.number="config.flow!.intensity" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Curve distortion</span><span class="text-white/40">{{ Math.round(config.flow!.distortion) }}</span></label>
        <input v-model.number="config.flow!.distortion" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Detail</span><span class="text-white/40">{{ Math.round(config.flow!.detail) }}</span></label>
        <input v-model.number="config.flow!.detail" type="range" min="1" max="6" step="1" v-studio-reset class="studio-range w-full" />
      </StudioSection>

      <!-- Depth & Light (liquid fold shading only) -->
      <StudioSection v-if="isLiquid" title="Depth & light" badge="liquid">
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Depth</span><span class="text-white/40">{{ Math.round(config.flow!.depth) }}</span></label>
        <input v-model.number="config.flow!.depth" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Highlights</span><span class="text-white/40">{{ Math.round(config.flow!.highlights) }}</span></label>
        <input v-model.number="config.flow!.highlights" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Shadows</span><span class="text-white/40">{{ Math.round(config.flow!.shadows) }}</span></label>
        <input v-model.number="config.flow!.shadows" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range mb-2 w-full" />
        <label class="mb-1 flex justify-between text-xs text-white/60"><span>Fold scale</span><span class="text-white/40">{{ Math.round(config.flow!.foldScale) }}</span></label>
        <input v-model.number="config.flow!.foldScale" type="range" min="0" max="100" step="1" v-studio-reset class="studio-range w-full" />
      </StudioSection>
```

- [ ] **Step 4: Hide the geometric Shape section when liquid**

The liquid layout ignores bars/count/gap/etc. Hide the whole Shape section under liquid by adding `v-if="!isLiquid"` to its `<StudioSection title="Shape" …>` opening tag (line 423):
```html
      <StudioSection v-if="!isLiquid" title="Shape" :badge="`Layer ${activeLayer + 1}`">
```

- [ ] **Step 5: Add a "Liquid" preset button**

Find where the `Ripple`/`Stack` presets are wired (search the file for `rippleConfig` / `stackConfig` — both the `<script>` import and the toolbar `<button>`s). Add `liquidConfig` to that import, and add a matching toolbar button next to the others, calling the same handler pattern they use (e.g. `applyPreset(liquidConfig())` or whatever the existing buttons call — mirror the exact handler the Stack button uses). Concretely, wherever the existing preset button is:
```html
        <button class="<existing preset button classes>" @click="<sameHandler>(liquidConfig(config.seed))">Liquid</button>
```
Use `config.seed` so the preset is reproducible, matching how the existing preset buttons pass the seed (if they pass none, omit it).

- [ ] **Step 6: Verify in the preview (no unit test for Vue here)**

Start the dev server and open Gradient Studio. (See Task 5 for the full visual protocol.) Quick checks:
- The Layout row shows 5 buttons incl. **Liquid**; clicking it hides the Shape section and reveals **Depth & light**.
- Dragging **Noise intensity** up on a *linear* gradient melts it into liquid swirls; back to 0 restores the crisp gradient.
- The **Liquid** preset button renders the warm marble look.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/GradientStudioSurface.vue
git commit -m "feat(gradient-studio): Flow + Depth&Light control sections + Liquid preset"
```

---

### Task 5: Visual verification & sign-off

**Files:** none (verification only). Per project rule, a WebGL effect is never shipped on unit tests alone.

- [ ] **Step 1: Run the full unit suite**

Run: `cd frontend && npm run test:unit -- gradientfx`
Expected: PASS (engine + relief specs).

- [ ] **Step 2: Launch the app and open Gradient Studio**

Use the project's run flow (`/run` skill or `cd frontend && npm run dev`) and the preview tooling to open a Gradient Studio node → Edit.

- [ ] **Step 3: Capture the liquid look**

- Click the **Liquid** preset. Screenshot. Compare against the neato.fun reference (warm orange/peach/pink melting into deep indigo, silky marble swirls, fine grain). Iterate `intensity`/`distortion`/`noiseScale`/`detail` and the preset defaults in `randomize.ts` until the look is faithful.
- Toggle **Depth & light** (Depth/Highlights/Shadows/Fold scale) and confirm it adds believable 3D folds.

- [ ] **Step 4: Verify warp-distorts-geometric**

- On a **linear** preset, raise **Noise intensity** → the bands should smear into liquid ribbons. Repeat on **radial** and **stack**. Screenshot one as proof.

- [ ] **Step 5: Verify back-compat (no-op at intensity 0)**

- Load/keep an existing non-liquid gradient with **Noise intensity = 0** and confirm it looks identical to before this feature (no warp, original relief intact). This validates the Global Constraint.

- [ ] **Step 6: Get look sign-off**

Share the screenshots with the user and get explicit "looks right" before considering the feature done. Record any tuning the user requests and fold it back into the preset/randomize defaults.

- [ ] **Step 7: Final commit (if tuning changed any defaults)**

```bash
git add -A
git commit -m "fix(gradient-studio): tune liquid flow defaults from visual review"
```

---

## Self-Review

**Spec coverage:**
- Warp-as-global-stage → Task 3 (`applyFlow` in `main()`, fed to all layouts). ✓
- New `'liquid'` layout + base → Task 1 (type/LAYOUTS) + Task 3 (shader branch) + Task 4 (UI). ✓
- Warp distorts geometric layouts → Task 3 (`pw` feeds `computeLayer`) + Task 5 step 4 verify. ✓
- Depth & Light liquid-only → Task 3 (gated `u_layout > 3.5`) + Task 4 (`v-if="isLiquid"`). ✓
- Reuse colors/grain/aspect/export/node → untouched; confirmed by leaving those paths alone. ✓
- Randomize + locks + preset → Task 2. ✓
- Back-compat (`flow?` + `ensureConfigDefaults` + intensity-0 no-op) → Task 1 + Task 5 step 5. ✓
- Still image only (`time = 0`) → no motion wiring added; animation explicitly deferred. ✓
- Visual verification required → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The only non-literal step is Task 4 Step 5 (preset button), which is explicit about mirroring the existing Ripple/Stack handler — unavoidable since that handler's exact name lives in the file; the implementer reads it there. ✓

**Type consistency:** `FlowConfig` fields (`angle, noiseScale, intensity, distortion, detail, depth, highlights, shadows, foldScale`) are used identically in `randFlowConfig`/`liquidConfig` (Task 2), the renderer uniform upload (Task 3), and the UI bindings (Task 4). `flowConfig()` accessor name consistent across Tasks 1/3. `LAYOUT_IDX.liquid = 4` matches the shader's `u_layout > 3.5` branch. ✓
