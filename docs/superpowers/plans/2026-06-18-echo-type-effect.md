# Echo Type Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new Type Studio effect (`id: 'echo'`) that duplicates one string into a configurable, occlusion-stacked "pile of papers," with a base→end look ramp and optional drift motion.

**Architecture:** A standard `SpaceTypeEffect` module (`echo.ts`) built on Three.js, exactly like `melt.ts`/`cascade.ts`. Each echo is a `THREE.Group` holding an opaque **card** quad (the occluder) plus a **text** mesh that samples the shared text-texture's alpha and is tinted by a per-copy ink material. Positioning, the look ramp, and drift are driven by a pure, unit-tested math module (`echoMath.ts`). Occlusion is real Three.js depth + render-order. No backend changes.

**Tech Stack:** TypeScript, Three.js (r0.171), Vitest (unit), existing Space Type engine/surface/export rails.

**Spec:** `docs/superpowers/specs/2026-06-18-echo-type-effect-design.md`

**Key design decisions locked during planning (deviations from the spec, all intentional):**
- **Ink via alpha-only material** (the `melt.ts` pattern): the shared text texture supplies only the glyph **alpha**; per-copy RGB comes from a `uColor` uniform. This means we do **not** declare `typeColor` (texture RGB is irrelevant, exactly like `melt`).
- **Stroke/outline is shader-derived** from the alpha field (screen-space derivative), so per-copy outline works from one texture without a second outline texture. `baseStroke`/`endStroke` blend fill↔outline.
- **Drift uses integer "slots-per-loop"** (`driftSpeed`, integer) for seamless looping; the single `driftSpeed` slider replaces the spec's `driftSpeed`+`driftAmount` pair (amount is redundant in slot units).
- **`count`** = number of echo copies *in addition to* the static base. Total meshes = `count + 1`.
- **Occlusion requires opaque cards.** With a transparent export background, opaque cards are visible rectangles — inherent to "pile of papers." Default `cardColor` is `#000000`; user lowers `cardOpacity` or matches it to their bg if needed.

---

## File Structure

- **Create** `frontend/app/lib/spacetype/echoMath.ts` — pure math: spacing easing, scalar ramp, drift slot wrap, wrap-fade envelope, perspective scale. No Three.js, no DOM.
- **Create** `frontend/tests/unit/echo-math.unit.spec.ts` — Vitest unit tests for `echoMath.ts`.
- **Create** `frontend/app/lib/spacetype/effects/echo.ts` — the `echoEffect: SpaceTypeEffect` module (controls + `buildScene` + `update`).
- **Modify** `frontend/app/lib/spacetype/effects/index.ts` — register `echoEffect`.
- **Modify** `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — add `driftSpeed` to the live-param signature so dragging it doesn't force a rebuild.

---

## Task 1: Pure math module (`echoMath.ts`) — TDD

**Files:**
- Create: `frontend/app/lib/spacetype/echoMath.ts`
- Test: `frontend/tests/unit/echo-math.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/echo-math.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { easeSpacing, rampScalar, driftQ, wrapFade, perspScale } from '../../app/lib/spacetype/echoMath'

describe('easeSpacing', () => {
  it('is identity at the endpoints regardless of curve', () => {
    for (const c of [-1, -0.5, 0, 0.5, 1]) {
      expect(easeSpacing(0, c)).toBeCloseTo(0, 6)
      expect(easeSpacing(1, c)).toBeCloseTo(1, 6)
    }
  })
  it('curve 0 is linear', () => {
    expect(easeSpacing(0.5, 0)).toBeCloseTo(0.5, 6)
    expect(easeSpacing(0.25, 0)).toBeCloseTo(0.25, 6)
  })
  it('ease-out (curve>0) starts slow: mid value below linear', () => {
    expect(easeSpacing(0.5, 1)).toBeLessThan(0.5)
  })
  it('ease-in (curve<0) starts fast: mid value above linear', () => {
    expect(easeSpacing(0.5, -1)).toBeGreaterThan(0.5)
  })
  it('clamps the curve and the input', () => {
    expect(easeSpacing(2, 5)).toBeCloseTo(1, 6)
    expect(easeSpacing(-1, -5)).toBeCloseTo(0, 6)
  })
})

describe('rampScalar', () => {
  it('returns base at t=0 and end at t=1', () => {
    expect(rampScalar(2, 10, 0)).toBe(2)
    expect(rampScalar(2, 10, 1)).toBe(10)
  })
  it('interpolates linearly and clamps t', () => {
    expect(rampScalar(0, 8, 0.25)).toBe(2)
    expect(rampScalar(0, 8, 2)).toBe(8)
    expect(rampScalar(0, 8, -1)).toBe(0)
  })
})

describe('driftQ', () => {
  it('at frac 0 echo j sits at slot j+1', () => {
    expect(driftQ(0, 0, 6)).toBeCloseTo(1, 6)
    expect(driftQ(5, 0, 6)).toBeCloseTo(6, 6)
  })
  it('advances by frac and wraps within (0, count]', () => {
    expect(driftQ(5, 0.5, 6)).toBeCloseTo(6.5 - 6 + 0, 6) // 6 + 0.5 wraps -> 0.5
  })
  it('is periodic: frac=count returns to the start arrangement', () => {
    expect(driftQ(2, 6, 6)).toBeCloseTo(driftQ(2, 0, 6), 6)
  })
  it('result is always in (0, count]', () => {
    for (let f = 0; f < 1; f += 0.13) {
      for (let j = 0; j < 6; j++) {
        const q = driftQ(j, f, 6)
        expect(q).toBeGreaterThan(0)
        expect(q).toBeLessThanOrEqual(6)
      }
    }
  })
})

describe('wrapFade', () => {
  it('is 1 in the middle and 0 at the very edges', () => {
    expect(wrapFade(0.5, 0.2)).toBeCloseTo(1, 6)
    expect(wrapFade(0, 0.2)).toBeCloseTo(0, 6)
    expect(wrapFade(1, 0.2)).toBeCloseTo(0, 6)
  })
  it('zone 0 disables fading', () => {
    expect(wrapFade(0, 0)).toBe(1)
  })
})

describe('perspScale', () => {
  it('is 1 at z=0 for any perspective', () => {
    expect(perspScale(0, 0)).toBeCloseTo(1, 6)
    expect(perspScale(0, 1)).toBeCloseTo(1, 6)
  })
  it('perspective=1 leaves world size unchanged (natural perspective from the camera)', () => {
    expect(perspScale(3, 1)).toBeCloseTo(1, 6)
  })
  it('perspective=0 shrinks copies pushed toward the camera (cancels apparent growth)', () => {
    expect(perspScale(3, 0, 14)).toBeCloseTo((14 - 3) / 14, 6)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- echo-math`
Expected: FAIL — `Cannot find module '../../app/lib/spacetype/echoMath'`.

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/spacetype/echoMath.ts`:

```ts
/**
 * Pure math for the Echo effect — spacing distribution, the base→end look ramp,
 * drift slot wrapping, the wrap-fade envelope, and perspective compensation.
 * No Three.js / DOM so it unit-tests in the node env.
 */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

/**
 * Map a normalized stack position u∈[0,1] through a spacing curve c∈[-1,1].
 * c = 0 → linear; c > 0 (ease-out) → gaps start tight then grow; c < 0
 * (ease-in) → gaps start wide then crowd. Endpoints are always 0 and 1, so
 * the far echo lands in the same place regardless of curve.
 */
export function easeSpacing(u: number, c: number): number {
  const cc = Math.max(-1, Math.min(1, c))
  const x = clamp01(u)
  if (cc === 0) return x
  const p = Math.pow(2, cc * 2) // c=1 → p=4 (slow start), c=-1 → p=0.25 (fast start)
  return Math.pow(x, p)
}

/** Linear interpolate base→end across t∈[0,1] (t clamped). */
export function rampScalar(base: number, end: number, t: number): number {
  return base + (end - base) * clamp01(t)
}

/**
 * Continuous slot of echo j (0-based) at drift fraction `frac`∈[0,1), with
 * `count` echoes. At frac 0, echo j sits at slot j+1 (slots 1..count). As frac
 * advances the slot increases and wraps within (0, count], so a copy that
 * reaches the far end re-emerges near the base. Periodic in frac with period 1.
 */
export function driftQ(j: number, frac: number, count: number): number {
  const span = Math.max(1, count)
  const raw = (((j + frac) % span) + span) % span // [0, count)
  return raw + 1 > span ? raw + 1 - span : raw + 1 // shift to slots 1..count, wrapping within (0, count]
}

/**
 * Fade envelope for drift: 1 in the middle of the stack, ramping to 0 within
 * `zone` of either end (n=0 near base, n=1 at the far end) so wrapping copies
 * fade in/out instead of popping. zone <= 0 disables fading (returns 1).
 */
export function wrapFade(n: number, zone: number): number {
  if (zone <= 0) return 1
  const a = Math.min(1, n / zone)
  const b = Math.min(1, (1 - n) / zone)
  return Math.max(0, Math.min(a, b))
}

/**
 * World-size scale for a copy at world `z` blending between flat (persp=0,
 * apparent size held constant by cancelling the camera's foreshortening) and
 * natural perspective (persp=1, no compensation). Camera sits at `camZ`.
 */
export function perspScale(z: number, persp: number, camZ = 14): number {
  const dist = Math.max(0.001, camZ - z)
  const comp = dist / camZ
  return comp + (1 - comp) * clamp01(persp)
}
```

Trace `driftQ` against its tests: `driftQ(0,0,6)` → raw=0 → 1 ✓; `driftQ(5,0,6)` → raw=5 → 6 ✓; `driftQ(5,0.5,6)` → raw=5.5 → 6.5>6 → 0.5 ✓; `driftQ(2,6,6)` → raw=(2+6)%6=2 → 3 == `driftQ(2,0,6)`=3 ✓; range always (0,6] ✓.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- echo-math`
Expected: PASS — all `echoMath` describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/echoMath.ts frontend/tests/unit/echo-math.unit.spec.ts
git commit -m "feat(spacetype): echo math (spacing/ramp/drift/perspective) + unit tests"
```

---

## Task 2: Effect scaffold — static pile of papers (`echo.ts` + registry)

This task gets a **static** echo stack rendering on the canvas: N opaque cards + alpha-tinted text, positioned by the eased offset, occluding via depth/render-order. Look ramp and drift come in Tasks 3–4. Verification is **visual** (the project rule: never ship a visual effect on unit logic alone — see `docs/.../specs/...` and memory `feedback_verify_visuals_with_screenshots`).

**Files:**
- Create: `frontend/app/lib/spacetype/effects/echo.ts`
- Modify: `frontend/app/lib/spacetype/effects/index.ts`

- [ ] **Step 1: Create `echo.ts` with controls + a static `buildScene` + a no-op `update`**

Create `frontend/app/lib/spacetype/effects/echo.ts`:

```ts
import * as THREE from 'three'
import type { ControlSpec, Params, SpaceTypeEffect } from '../effect'
import { easeSpacing, rampScalar, driftQ, wrapFade, perspScale } from '../echoMath'

/**
 * ECHO — one string duplicated into a stack of copies ("a pile of papers").
 * Each echo is a Group: an opaque CARD quad (the occluder, sized to the text box
 * + padding) plus a TEXT mesh that samples the shared text texture's ALPHA and is
 * tinted per-copy (melt-style alpha-only ink, so RGB comes from a uColor uniform).
 * Copies are offset by a cumulative, spacing-eased X/Y/Z vector; the perspective
 * camera + a per-copy perspScale give controllable depth. Occlusion is real depth
 * + renderOrder by zOrder. The base (copy 0) is static; echoes can DRIFT and loop.
 */

const controls: ControlSpec[] = [
  // Type — note: NO typeColor (we use the texture's alpha only and tint per copy).
  { key: 'text', label: 'Text', kind: 'text', default: 'ECHO', group: 'Type' },
  { key: 'font', label: 'Font', kind: 'font', default: 'Anton', group: 'Type' },
  { key: 'typeHeight', label: 'Type height', kind: 'slider', min: 40, max: 320, step: 2, default: 200, group: 'Type' },
  { key: 'tracking', label: 'Tracking', kind: 'slider', min: -20, max: 80, step: 1, default: 0, group: 'Type' },
  // Stack — count is the number of echoes IN ADDITION to the static base.
  { key: 'count', label: 'Echoes', kind: 'slider', min: 1, max: 40, step: 1, default: 8, group: 'Stack' },
  { key: 'offsetX', label: 'Offset X', kind: 'slider', min: -3, max: 3, step: 0.02, default: 0, group: 'Stack' },
  { key: 'offsetY', label: 'Offset Y', kind: 'slider', min: -3, max: 3, step: 0.02, default: -0.6, group: 'Stack' },
  { key: 'offsetZ', label: 'Depth (Z)', kind: 'slider', min: -1.5, max: 1.5, step: 0.02, default: 0, group: 'Stack' },
  { key: 'perspective', label: 'Perspective', kind: 'slider', min: 0, max: 1, step: 0.01, default: 1, group: 'Stack' },
  { key: 'spacingCurve', label: 'Spacing curve', kind: 'slider', min: -1, max: 1, step: 0.02, default: 0, group: 'Stack' },
  { key: 'layout', label: 'Spread', kind: 'select', options: ['directional', 'bidirectional', 'mirror'], default: 'directional', group: 'Stack' },
  // Occlusion — the "pile of papers". Cards are opaque by default so they occlude.
  { key: 'cardPadX', label: 'Card pad X', kind: 'slider', min: 0, max: 4, step: 0.05, default: 0.4, group: 'Occlusion' },
  { key: 'cardPadY', label: 'Card pad Y', kind: 'slider', min: 0, max: 4, step: 0.05, default: 0.15, group: 'Occlusion' },
  { key: 'cardColor', label: 'Card color', kind: 'color', default: '#000000', group: 'Occlusion' },
  { key: 'cardOpacity', label: 'Card opacity', kind: 'slider', min: 0, max: 1, step: 0.02, default: 1, group: 'Occlusion' },
  { key: 'zOrder', label: 'On top', kind: 'select', options: ['base', 'last'], default: 'base', group: 'Occlusion' },
  // Look — base → end ramp (color / opacity / fill↔outline / scale).
  { key: 'baseColor', label: 'Base color', kind: 'color', default: '#ffffff', group: 'Look' },
  { key: 'endColor', label: 'End color', kind: 'color', default: '#ffffff', group: 'Look' },
  { key: 'baseOpacity', label: 'Base opacity', kind: 'slider', min: 0, max: 1, step: 0.02, default: 1, group: 'Look' },
  { key: 'endOpacity', label: 'End opacity', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0.18, group: 'Look' },
  { key: 'baseStroke', label: 'Base outline', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0, group: 'Look' },
  { key: 'endStroke', label: 'End outline', kind: 'slider', min: 0, max: 1, step: 0.02, default: 0, group: 'Look' },
  { key: 'baseScale', label: 'Base scale', kind: 'slider', min: 0.2, max: 2, step: 0.02, default: 1, group: 'Look' },
  { key: 'endScale', label: 'End scale', kind: 'slider', min: 0.2, max: 2, step: 0.02, default: 1, group: 'Look' },
  // Motion — drift only (integer slots per loop; 0 = static).
  { key: 'driftSpeed', label: 'Drift', kind: 'slider', min: 0, max: 6, step: 1, default: 0, group: 'Motion' },
  // Transform — global scene framing, read by the engine.
  { key: 'scale', label: 'Scale', kind: 'slider', min: 0.4, max: 2.5, step: 0.05, default: 1, group: 'Transform' },
  { key: 'rotateX', label: 'Scene rotate X', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateY', label: 'Scene rotate Y', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
  { key: 'rotateZ', label: 'Scene rotate Z', kind: 'slider', min: -1.8, max: 1.8, step: 0.01, default: 0, group: 'Transform' },
]

const n = (p: Params, k: string): number => Number(p[k])
const CAM_Z = 14            // matches engine.ts perspective camera position
const PLANE_H = 5           // world height of one text plane before per-copy scale
const Z_BIAS = 0.012        // per-slot depth stagger to force a deterministic order

interface CopyHandle {
  group: THREE.Group
  card: THREE.Mesh
  text: THREE.Mesh
  uColor: { value: THREE.Color }
  uOpacity: { value: number }
  uStroke: { value: number }
  cardMat: THREE.MeshBasicMaterial
}

interface EchoState {
  copies: CopyHandle[]   // index 0 = base (static), 1..count = echoes
  planeW: number
  planeH: number
}

let state: EchoState | null = null

/** Alpha-only ink material: glyph alpha from the texture, RGB from uColor, and a
 *  fill↔outline blend (uStroke) using the screen-space derivative of the alpha. */
function makeInk(three: typeof THREE, tex: THREE.Texture) {
  const uColor = { value: new three.Color('#ffffff') }
  const uOpacity = { value: 1 }
  const uStroke = { value: 0 }
  const mat = new three.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: three.DoubleSide })
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uColor = uColor
    sh.uniforms.uOpacity = uOpacity
    sh.uniforms.uStroke = uStroke
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEchoUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvEchoUv = uv;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uColor; uniform float uOpacity; uniform float uStroke; varying vec2 vEchoUv;')
      .replace('#include <map_fragment>', [
        'float aFill = texture2D(map, vEchoUv).a;',
        'float edge = length(vec2(dFdx(aFill), dFdy(aFill)));',
        'float aOut = clamp(edge * 6.0, 0.0, 1.0);',
        'float a = mix(aFill, aOut, uStroke);',
        'diffuseColor = vec4(uColor, a * uOpacity);',
      ].join('\n'))
  }
  return { mat, uColor, uOpacity, uStroke }
}

export const echoEffect: SpaceTypeEffect = {
  id: 'echo',
  label: 'Echo',
  controls,

  buildScene(three, params, textTexture) {
    const root = new three.Group()
    state = null

    // The shared texture ships RepeatWrapping (for tiling effects); clamp so the
    // plane edges don't wrap the glyph.
    textTexture.wrapS = textTexture.wrapT = three.ClampToEdgeWrapping
    textTexture.needsUpdate = true

    const img = textTexture.image as { width?: number; height?: number } | undefined
    const aspect = img && img.width && img.height ? img.width / img.height : 4
    const planeH = PLANE_H
    const planeW = Math.max(0.5, planeH * aspect)

    const count = Math.max(1, Math.round(n(params, 'count')))
    const total = count + 1
    const copies: CopyHandle[] = []

    for (let i = 0; i < total; i++) {
      const grp = new three.Group()

      const cardMat = new three.MeshBasicMaterial({ color: new three.Color(String(params.cardColor)), side: three.DoubleSide })
      const card = new three.Mesh(new three.PlaneGeometry(1, 1), cardMat)

      const ink = makeInk(three, textTexture)
      const text = new three.Mesh(new three.PlaneGeometry(planeW, planeH), ink.mat)
      text.userData.tex = textTexture

      grp.add(card)
      grp.add(text)
      root.add(grp)

      copies.push({ group: grp, card, text, uColor: ink.uColor, uOpacity: ink.uOpacity, uStroke: ink.uStroke, cardMat })
    }

    state = { copies, planeW, planeH }
    echoEffect.update(0, params)
    return root
  },

  update(t01, params) {
    const s = state
    if (!s) return
    const { copies, planeW, planeH } = s
    const count = copies.length - 1
    if (count < 1) return

    const ox = n(params, 'offsetX'), oy = n(params, 'offsetY'), oz = n(params, 'offsetZ')
    const persp = n(params, 'perspective')
    const curve = n(params, 'spacingCurve')
    const layout = String(params.layout)
    const padX = n(params, 'cardPadX'), padY = n(params, 'cardPadY')
    const cardColor = new THREE.Color(String(params.cardColor))
    const cardOpacity = n(params, 'cardOpacity')
    const baseOnTop = String(params.zOrder) === 'base'
    const drift = Math.max(0, Math.round(n(params, 'driftSpeed')))
    const frac = drift > 0 ? (t01 * drift) % 1 : 0

    const baseColor = new THREE.Color(String(params.baseColor))
    const endColor = new THREE.Color(String(params.endColor))
    const baseOp = n(params, 'baseOpacity'), endOp = n(params, 'endOpacity')
    const baseStroke = n(params, 'baseStroke'), endStroke = n(params, 'endStroke')
    const baseScale = n(params, 'baseScale'), endScale = n(params, 'endScale')

    // ── Base (copy 0): static, full base look, slot 0. ──
    placeCopy(copies[0]!, 0, /*tRamp*/0, /*env*/1)

    // ── Echoes 1..count. ──
    for (let j = 0; j < count; j++) {
      const handle = copies[j + 1]!
      const q = drift > 0 ? driftQ(j, frac, count) : (j + 1) // slot in (0, count]
      const tRamp = q / count                                 // 0 at base → 1 at far end
      const env = drift > 0 ? wrapFade(tRamp, 0.18) : 1
      placeCopy(handle, q, tRamp, env)
    }

    function placeCopy(h: CopyHandle, q: number, tRamp: number, env: number) {
      // Eased cumulative offset: linear cumulative = perStep * q; easing redistributes
      // but keeps the far point (q=count) identical to linear.
      const eased = easeSpacing(q / count, curve) * count
      let dirSign = 1
      let flip = false
      if (layout === 'bidirectional') {
        // alternate echoes to +/- sides; base stays centred
        dirSign = (Math.round(q) % 2 === 0) ? 1 : -1
      } else if (layout === 'mirror') {
        dirSign = (Math.round(q) % 2 === 0) ? 1 : -1
        flip = dirSign < 0
      }
      const px = ox * eased * dirSign
      const py = oy * eased * dirSign
      const pz = oz * eased * dirSign

      // Deterministic depth stagger so order is stable even when oz == 0.
      const orderSign = baseOnTop ? -1 : 1
      const zBias = orderSign * Z_BIAS * q
      h.group.position.set(px, py, pz + zBias)
      h.group.renderOrder = baseOnTop ? -q : q

      // Per-copy perspective compensation (scale held flat at persp=0).
      const ps = perspScale(pz + zBias, persp, CAM_Z)
      const lookScale = rampScalar(baseScale, endScale, tRamp) * ps
      h.group.scale.set(lookScale, lookScale * (flip ? -1 : 1), lookScale)

      // Card: text box + padding, behind the text by a sliver.
      h.card.scale.set(planeW + padX * 2, planeH + padY * 2, 1)
      h.card.position.set(0, 0, -Z_BIAS * 0.4)
      h.cardMat.color.copy(cardColor)
      h.cardMat.opacity = cardOpacity
      h.cardMat.transparent = cardOpacity < 1
      h.cardMat.depthWrite = cardOpacity >= 1 // opaque cards occlude via the depth buffer

      // Text: in front of its own card; ramped ink.
      h.text.position.set(0, 0, Z_BIAS * 0.4)
      h.uColor.value.copy(baseColor).lerp(endColor, tRamp)
      h.uOpacity.value = rampScalar(baseOp, endOp, tRamp) * env
      h.uStroke.value = rampScalar(baseStroke, endStroke, tRamp)
    }
  },
}
```

- [ ] **Step 2: Register the effect**

Modify `frontend/app/lib/spacetype/effects/index.ts`:

Add the import after the `blendEffect` import line:

```ts
import { echoEffect } from './echo'
```

Add `echoEffect,` to the `SPACE_TYPE_EFFECTS` array (end is fine):

```ts
export const SPACE_TYPE_EFFECTS: SpaceTypeEffect[] = [
  ribbonEffect,
  stripesEffect,
  cylinderEffect,
  fieldEffect,
  coilEffect,
  cascadeEffect,
  boostEffect,
  meltEffect,
  onionburstEffect,
  elasticEffect,
  stringEffect,
  blendEffect,
  echoEffect,
]
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i echo || echo "no echo type errors"`
Expected: `no echo type errors` (or a clean full type-check).

- [ ] **Step 4: Visual verification — static stack renders & occludes**

Start the dev server and open Type Studio with the Echo effect (use the preview_* tools, not Bash/manual):
1. `preview_start` the frontend dev server (`cd frontend && npm run dev`), navigate to the canvas, add/open a Space Type node, pick **Echo**.
2. `preview_screenshot` the canvas. Confirm: a base "ECHO" plus copies stacked downward (default offsetY −0.6), each copy's opaque card covering the one behind so you see the "peeking sliver" / pile-of-papers look.
3. Toggle **On top** base↔last and screenshot each — the occlusion order should visibly flip.
4. `preview_console_logs` — no Three.js shader-compile errors.

If occlusion looks wrong (z-fighting or wrong layer in front), adjust `Z_BIAS` and the `orderSign`/`renderOrder` mapping, then re-screenshot. Do not proceed until the static stack reads correctly.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/spacetype/effects/echo.ts frontend/app/lib/spacetype/effects/index.ts
git commit -m "feat(spacetype): echo effect — static occlusion-stacked echoes"
```

---

## Task 3: Look ramp + spread modes — visual verification & tuning

The ramp, perspective, and layout code already shipped in Task 2's `update()`. This task **verifies and tunes** them against the reference, and fixes the alpha-edge outline constant if needed.

**Files:**
- Modify (tune only, if needed): `frontend/app/lib/spacetype/effects/echo.ts`

- [ ] **Step 1: Verify the base→end ramp**

In the live preview: set **End opacity** low, **End color** to a tint, drag **Spacing curve** across its range, screenshot at a few values. Confirm color/opacity interpolate base→far and that the spacing curve visibly bunches/spreads copies (ease-in ↔ ease-out) while the far copy stays put.

- [ ] **Step 2: Verify outline (fill↔outline) blend**

Set **End outline** = 1, **Base outline** = 0. Screenshot. Far copies should render as hollow outlines, base solid. If the outline is too thin/thick or absent, tune the `edge * 6.0` multiplier in `makeInk` (higher = thicker outline), re-screenshot.

- [ ] **Step 3: Verify spread modes**

Cycle **Spread**: `directional` (all one way), `bidirectional` (copies alternate to both sides of the base), `mirror` (alternating sides + vertically flipped). Screenshot each. Confirm bidirectional centers the base with copies both ways, and mirror flips alternate copies.

- [ ] **Step 4: Verify perspective + depth**

Set **Depth (Z)** to a non-zero value and drag **Perspective** 0→1. At 1 the copies should foreshorten naturally (converge/recede); at 0 they should hold constant screen size (flat parallax). Screenshot both ends.

- [ ] **Step 5: Recreate the reference & get look sign-off**

Configure text "THE 1795", a downward offsetY, several echoes, base solid → far faded, opaque black cards on a black background. Screenshot and compare to the user's reference. Tune defaults if the out-of-the-box look is far off. **Share the screenshot with the user for sign-off before continuing.**

- [ ] **Step 6: Commit any tuning**

```bash
git add frontend/app/lib/spacetype/effects/echo.ts
git commit -m "fix(spacetype): tune echo ramp/outline/spread defaults to reference"
```

(If no changes were needed, skip the commit.)

---

## Task 4: Drift motion + live-param wiring

Make `driftSpeed` animate without forcing a rebuild on every drag, and verify the loop is seamless.

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue:345-365`

- [ ] **Step 1: Add `driftSpeed` to the live-param signature**

In `SpaceTypeSurface.vue`, the `watch(() => JSON.stringify({ ...params, <live keys zeroed> }))` block (around lines 345–365) zeroes out params that are read live in `update()` so they don't trigger a rebuild. Add `driftSpeed` to that zeroed list. Insert this line alongside the other effect live-params (e.g. right after the `// boost live params` block):

```ts
    // echo live params (drift advances per-frame in update)
    driftSpeed: 0,
```

- [ ] **Step 2: Verify drift animates without a rebuild**

In the live preview, set **Drift** to 2 with several echoes. Watch the preview: copies should flow continuously along the offset axis while the **base stays static**. Dragging the Drift slider should NOT cause a flicker/rebuild (a rebuild visibly resets the preview to frame 0). Screenshot mid-animation.

- [ ] **Step 3: Verify the loop is seamless**

Because `driftSpeed` is an integer (slots per loop) and `frac = (t01 * drift) % 1`, the arrangement at t01=1 equals t01=0. Let the preview loop run and confirm there's no visible jump at the loop boundary. If copies pop at the wrap, increase the `wrapFade` zone (the `0.18` in `update()`), re-verify.

- [ ] **Step 4: Verify export (image + video) works**

Trigger **Generate image** and **Generate video** from the Type Studio surface. Confirm: the image is a clean still of the stack, and the baked video drifts and loops seamlessly (the existing `bake.ts` → `/sailor/spacetype_encode` rails need no changes). Check `preview_network`/`preview_logs` for a successful encode.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(spacetype): echo drift as a live param (no rebuild on drag)"
```

---

## Task 5: Final verification & polish

- [ ] **Step 1: Run the full unit suite**

Run: `cd frontend && npm run test:unit`
Expected: PASS, including `echo-math`.

- [ ] **Step 2: Type-check the whole frontend**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json`
Expected: no new errors attributable to echo.

- [ ] **Step 3: Edge-case sweep in the preview**

Screenshot each: **Echoes = 1** (just base + 1), **Echoes = 40** (perf/occlusion still sane), **Card opacity = 0.4** (lower copies glow through; note semi-transparent cards rely on render-order, not depth), transparent background on (cards visible — expected, documented constraint).

- [ ] **Step 4: Confirm effect-switch carry-over works**

Switch from another effect to Echo and back. Per `CARRY_ON_SWITCH` only `text`/`font` carry over; confirm Echo loads its own defaults cleanly and reopening a saved Echo node restores its config (`loadConfig`/`saveConfig` already cover arbitrary params).

- [ ] **Step 5: Final look sign-off**

Share a final screenshot reproducing the reference with the user. Address any feedback before declaring done.

---

## Self-Review (completed during planning)

**Spec coverage:**
- Duplication & spread (count / X / Y / Z / perspective / spacingCurve / layout) → Task 2 controls + `update()`; verified Task 3.
- Occlusion pile-of-papers (resizable card, opaque-by-default, cardOpacity, cardColor, zOrder, real depth) → Task 2 `buildScene`/`update`; verified Task 2 Step 4.
- Look base→end ramp (color/opacity/stroke-as-outline/scale) → Task 2 `update()` + `echoMath.rampScalar`; verified Task 3.
- Motion drift (base static, copies flow, seamless loop) → Task 4 + `echoMath.driftQ`/`wrapFade`.
- Export rails reuse → Task 4 Step 4 (no backend changes).
- Verification by screenshots, not unit-only → Tasks 2–5 visual steps (honors `feedback_verify_visuals_with_screenshots`).

**Deviations from spec (intentional, documented in the header):** alpha-only ink (no `typeColor`); shader-derived outline for per-copy stroke; single integer `driftSpeed` instead of speed+amount; opaque-card occlusion constraint on transparent backgrounds.

**Type consistency:** `count` = echoes excluding base everywhere (`total = count + 1`). `CopyHandle`/`EchoState` shapes used consistently in `buildScene` and `update`. `echoMath` exports (`easeSpacing`, `rampScalar`, `driftQ`, `wrapFade`, `perspScale`) match imports in `echo.ts` and the test file.

**Placeholder scan:** Task 1 intentionally walks through a messy-then-clean `driftQ` (TDD red→green) and ends on the verified clean form — no placeholders ship.
