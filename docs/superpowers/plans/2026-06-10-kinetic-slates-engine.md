# Kinetic Slates Engine (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Frame/Compositor unified layer stack a time dimension — animation data on layers, a pure evaluator, time-aware painting, play/scrub preview, client-side bake to a PNG sequence, and a VIDEO output on the Compositor backend node.

**Architecture:** New pure modules under `frontend/app/lib/motion/` (types, easing, evaluate, text layout/draw, paint wrapper, bake). `paintLayerStack()` in `useCompositorLayers.ts` gains an optional time argument; with it undefined nothing changes. The CompositorModal gets a transport bar + per-layer animation panel. Bake reuses the KineticType pattern: PNG frames uploaded via `/upload/image`, filenames written into a new `motion_params` widget on the Compositor node, which loads them as an IMAGE batch and emits VIDEO.

**Tech Stack:** Vue 3 + TypeScript (Nuxt 4), Canvas2D, vitest (`npm run test:unit` in `frontend/`), ComfyUI Python node API (`comfy_api.latest.IO`).

**Spec:** `docs/superpowers/specs/2026-06-10-kinetic-slates-design.md`

**Conventions that bind every task:**
- All geometry normalized as in `useCompositorLayers.ts`: x/y = center 0..1 of canvas W/H, sizes normalized to canvas WIDTH.
- Determinism: no `Date.now()`/`Math.random()` anywhere in evaluation — glitch jitter uses the seeded hash in Task 3.
- Unit tests live in `frontend/tests/unit/*.unit.spec.ts`, run with `cd frontend && npx vitest run tests/unit/<file>`.
- Dev servers: Nuxt and ComfyUI are supervised — to reload the Python server, **kill** it (`pkill -f "main.py --listen"`); the supervisor restarts it. Bridge JS is not touched by this plan.
- Commit after every task (messages given per task).

---

### Task 1: Motion data model

**Files:**
- Create: `frontend/app/lib/motion/types.ts`
- Modify: `frontend/app/composables/useCompositorLayers.ts` (LayerCommon, ~line 79)

- [ ] **Step 1: Create the types module**

```ts
// frontend/app/lib/motion/types.ts
/**
 * Motion data for the Frame/Compositor unified layer stack.
 *
 * A layer's `animation` describes WHEN it is on screen (offset/duration within
 * the frame's motion timeline) and HOW it enters/exits/loops (preset ids from
 * the kinetic catalog, evaluated in pure canvas math — see evaluate.ts).
 * Offsets/durations are SECONDS. Spatial deltas produced by evaluation are in
 * UNIT-BOX units (1 = the animated unit's own box height) so they scale with
 * the layer; the painter converts to px.
 */

export interface LayerAnimSpec {
  presetId: string      // kinetic preset id (subset supported; see evaluate.ts)
  duration: number      // seconds the in/out phase takes (loop: cycle length)
  stagger?: number      // seconds between units (chars); default 0.04
  ease?: string         // GSAP-style ease name; preset default when absent
}

/** Transform/opacity keyframe, seconds relative to the layer's offset.
 *  Mirrors shared/timeline/types.ts Keyframe semantics (full snapshot,
 *  ease into the NEXT keyframe), but in seconds and with optional fields
 *  treated as "inherit identity". */
export interface LayerKeyframe {
  t: number
  dx?: number           // normalized canvas-width offset (additive)
  dy?: number           // normalized canvas-HEIGHT offset (additive)
  scale?: number        // multiplicative, 1 = none
  rotation?: number     // degrees, additive
  opacity?: number      // multiplicative, 1 = none
  ease?: 'linear' | 'easeInOut'
}

export interface LayerAnimation {
  offset: number        // seconds from frame start when the layer enters
  duration?: number     // seconds on screen; undefined = to end of frame
  in?: LayerAnimSpec
  out?: LayerAnimSpec   // anchored to the END of the layer's window
  loop?: LayerAnimSpec  // active between in-end and out-start
  keyframes?: LayerKeyframe[]
}

export interface FrameMotion {
  fps: number
  duration: number      // seconds
  loop?: boolean
}

export const DEFAULT_FRAME_MOTION: FrameMotion = { fps: 30, duration: 4 }

export function createLayerAnimation(partial: Partial<LayerAnimation> = {}): LayerAnimation {
  return { offset: 0, ...partial }
}
```

- [ ] **Step 2: Add the optional field to LayerCommon**

In `frontend/app/composables/useCompositorLayers.ts`, add to the `LayerCommon` interface (after `maskedById?: string`):

```ts
  /** Motion (Kinetic Slates): timing + presets evaluated by app/lib/motion.
   *  Absent ⇒ the layer is static and always visible. */
  animation?: import('~/lib/motion/types').LayerAnimation
```

(Type-only import keeps the composable free of runtime motion deps.)

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx nuxt typecheck 2>&1 | tail -5` (or `npx vue-tsc --noEmit` if typecheck isn't configured — whichever the repo supports; if neither runs cleanly today, `npx vitest run tests/unit` as a compile smoke).
Expected: no NEW errors mentioning `motion/types` or `LayerCommon`.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/lib/motion/types.ts frontend/app/composables/useCompositorLayers.ts
git commit -m "Motion engine: layer animation data model"
```

---

### Task 2: Shared easing module

**Files:**
- Create: `frontend/app/lib/motion/easing.ts`
- Modify: `frontend/app/composables/useAnimatedTextRenderer.ts:16-46` (import instead of redefining)
- Test: `frontend/tests/unit/motion-easing.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/motion-easing.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  linear, powerOut, powerIn, easeInOutQuad, sineInOut,
  backOut, backIn, elasticOut, bounceOut, steps, resolveEase,
} from '../../app/lib/motion/easing'

const ALL = [linear, powerOut(2), powerOut(3), powerIn(2), easeInOutQuad,
  sineInOut, backOut(), backIn(), elasticOut, bounceOut, steps(6)]

describe('easing primitives', () => {
  it('all eases hit 0 at t=0 and 1 at t=1', () => {
    for (const fn of ALL) {
      expect(fn(0)).toBeCloseTo(0, 6)
      expect(fn(1)).toBeCloseTo(1, 6)
    }
  })
  it('powerOut(2) is the standard quad-out', () => {
    expect(powerOut(2)(0.5)).toBeCloseTo(0.75, 6)
  })
  it('backOut overshoots past 1 mid-curve', () => {
    const peak = Math.max(...Array.from({ length: 99 }, (_, i) => backOut()((i + 1) / 100)))
    expect(peak).toBeGreaterThan(1.05)
  })
  it('steps(6) quantizes', () => {
    expect(steps(6)(0.49)).toBeCloseTo(steps(6)(0.4), 6)
  })
})

describe('resolveEase (GSAP-style names)', () => {
  it('maps the names used by kinetic presets', () => {
    expect(resolveEase('power2.out')(0.5)).toBeCloseTo(powerOut(2)(0.5), 6)
    expect(resolveEase('power3.in')(0.5)).toBeCloseTo(powerIn(3)(0.5), 6)
    expect(resolveEase('back.out(1.7)')(1)).toBeCloseTo(1, 6)
    expect(resolveEase('elastic.out(1, 0.3)')(1)).toBeCloseTo(1, 6)
    expect(resolveEase('sine.inOut')(0.5)).toBeCloseTo(0.5, 6)
    expect(resolveEase('steps(6)')(0.99)).toBeCloseTo(1, 6)
    expect(resolveEase('none')(0.3)).toBeCloseTo(0.3, 6)
    expect(resolveEase(undefined)(0.5)).toBeCloseTo(powerOut(2)(0.5), 6) // default
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/motion-easing.unit.spec.ts`
Expected: FAIL — cannot resolve `../../app/lib/motion/easing`.

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/motion/easing.ts
/** Pure easing math (GSAP-compatible subset). Every fn maps [0,1]→~[0,1]
 *  with f(0)=0, f(1)=1 (back/elastic overshoot in between by design). */

export type EaseFn = (t: number) => number

export const linear: EaseFn = t => t
export function powerOut(p: number): EaseFn { return t => 1 - Math.pow(1 - t, p) }
export function powerIn(p: number): EaseFn { return t => Math.pow(t, p) }
export const easeInOutQuad: EaseFn = t =>
  t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
export const sineInOut: EaseFn = t => -(Math.cos(Math.PI * t) - 1) / 2

export function backOut(s = 1.70158): EaseFn {
  return (t) => { const u = t - 1; return 1 + (s + 1) * u * u * u + s * u * u }
}
export function backIn(s = 1.70158): EaseFn {
  return t => (s + 1) * t * t * t - s * t * t
}

export const elasticOut: EaseFn = (t) => {
  if (t === 0 || t === 1) return t
  return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1
}

export const bounceOut: EaseFn = (t) => {
  if (t < 1 / 2.75) return 7.5625 * t * t
  if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75
  if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375
  return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375
}

export function steps(n: number): EaseFn {
  return t => (t >= 1 ? 1 : Math.floor(t * n) / Math.max(1, n - 1))
}

/** GSAP-style name → EaseFn. Handles the names appearing in kinetic-presets.ts:
 *  powerN.out / powerN.in, back.out(s) / back.in(s), elastic.out(...),
 *  bounce.out, sine.inOut, steps(n), none/linear. Unknown → power2.out. */
export function resolveEase(name: string | undefined): EaseFn {
  if (!name || name === 'power2.out') return powerOut(2)
  if (name === 'none' || name === 'linear') return linear
  const power = /^power(\d)\.(out|in|inOut)$/.exec(name)
  if (power) {
    const p = Number(power[1])
    if (power[2] === 'out') return powerOut(p)
    if (power[2] === 'in') return powerIn(p)
    return easeInOutQuad
  }
  const back = /^back\.(out|in)(?:\(([\d.]+)\))?$/.exec(name)
  if (back) {
    const s = back[2] ? parseFloat(back[2]) : 1.70158
    return back[1] === 'out' ? backOut(s) : backIn(s)
  }
  if (name.startsWith('elastic')) return elasticOut
  if (name.startsWith('bounce')) return bounceOut
  if (name === 'sine.inOut') return sineInOut
  const st = /^steps\((\d+)\)$/.exec(name)
  if (st) return steps(Number(st[1]))
  if (name.includes('InOut') || name.includes('inOut')) return easeInOutQuad
  return powerOut(2)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/motion-easing.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Refactor useAnimatedTextRenderer to import the primitives**

In `frontend/app/composables/useAnimatedTextRenderer.ts`, delete the local `easeOut`, `easeInOut`, `elasticOut`, `bounceOut` function definitions (lines ~18-38) and replace with:

```ts
import { powerOut, easeInOutQuad as easeInOut, elasticOut, bounceOut } from '~/lib/motion/easing'

function easeOut(t: number, power = 2): number {
  return powerOut(power)(t)
}
```

Keep its local `resolveEase` untouched (its defaulting behavior is part of title-clip rendering).

- [ ] **Step 6: Full unit suite + commit**

Run: `cd frontend && npx vitest run tests/unit`
Expected: all pass.

```bash
git add frontend/app/lib/motion/easing.ts frontend/tests/unit/motion-easing.unit.spec.ts frontend/app/composables/useAnimatedTextRenderer.ts
git commit -m "Motion engine: shared pure easing module"
```

---

### Task 3: Evaluator — windows, keyframes, preset tables

**Files:**
- Create: `frontend/app/lib/motion/evaluate.ts`
- Test: `frontend/tests/unit/motion-evaluate.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/motion-evaluate.unit.spec.ts
import { describe, it, expect } from 'vitest'
import {
  layerWindow, evaluateAnimation, evaluateKeyframes, IDENTITY_UNIT,
  SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS,
} from '../../app/lib/motion/evaluate'
import type { LayerAnimation } from '../../app/lib/motion/types'

const MOTION = { fps: 30, duration: 4 }

describe('layerWindow', () => {
  it('defaults to offset→frame end', () => {
    expect(layerWindow({ offset: 1 }, MOTION)).toEqual({ start: 1, end: 4 })
  })
  it('honors explicit duration and clamps to frame end', () => {
    expect(layerWindow({ offset: 1, duration: 2 }, MOTION)).toEqual({ start: 1, end: 3 })
    expect(layerWindow({ offset: 3, duration: 9 }, MOTION)).toEqual({ start: 3, end: 4 })
  })
})

describe('evaluateAnimation — phases', () => {
  const anim: LayerAnimation = {
    offset: 1,
    in: { presetId: 'fade-in', duration: 0.5, stagger: 0 },
    out: { presetId: 'fade-out', duration: 0.5, stagger: 0 },
  }
  it('invisible before its window', () => {
    expect(evaluateAnimation(anim, 0.5, MOTION, 1).visible).toBe(false)
  })
  it('mid-in: partially faded', () => {
    const st = evaluateAnimation(anim, 1.25, MOTION, 1) // halfway through fade-in
    expect(st.visible).toBe(true)
    expect(st.units![0].opacity).toBeGreaterThan(0.4)
    expect(st.units![0].opacity).toBeLessThan(1)
  })
  it('hold: identity', () => {
    const st = evaluateAnimation(anim, 2.5, MOTION, 1)
    expect(st.units![0]).toEqual(IDENTITY_UNIT)
  })
  it('out is anchored to the window end (fully gone at end)', () => {
    const st = evaluateAnimation(anim, 3.999, MOTION, 1)
    expect(st.units![0].opacity).toBeLessThan(0.05)
  })
})

describe('evaluateAnimation — stagger', () => {
  const anim: LayerAnimation = {
    offset: 0,
    in: { presetId: 'slide-up', duration: 1.0, stagger: 0.3 },
  }
  it('later units lag earlier ones', () => {
    const st = evaluateAnimation(anim, 0.35, MOTION, 3)
    expect(st.units![0].opacity).toBeGreaterThan(st.units![2].opacity)
    expect(st.units![0].dy).toBeLessThan(st.units![2].dy) // unit 0 closer to rest (dy→0)
  })
})

describe('evaluateAnimation — determinism', () => {
  it('glitch-in produces identical output for identical input', () => {
    const anim: LayerAnimation = { offset: 0, in: { presetId: 'glitch-in', duration: 1 } }
    const a = evaluateAnimation(anim, 0.2, MOTION, 5)
    const b = evaluateAnimation(anim, 0.2, MOTION, 5)
    expect(a).toEqual(b)
  })
})

describe('evaluateAnimation — loop', () => {
  it('wave oscillates and is periodic', () => {
    const anim: LayerAnimation = { offset: 0, loop: { presetId: 'wave', duration: 1, stagger: 0 } }
    const a = evaluateAnimation(anim, 0.25, MOTION, 1)
    const b = evaluateAnimation(anim, 1.25, MOTION, 1)
    expect(a.units![0].dy).toBeCloseTo(b.units![0].dy, 6)
    expect(Math.abs(a.units![0].dy)).toBeGreaterThan(0.01)
  })
})

describe('evaluateKeyframes', () => {
  const kfs = [
    { t: 0, dx: 0, opacity: 1 },
    { t: 1, dx: 0.5, opacity: 0.5, ease: 'linear' as const },
  ]
  it('interpolates between keyframes', () => {
    const st = evaluateKeyframes(kfs, 0.5)
    expect(st.dx).toBeCloseTo(0.25, 6)
    expect(st.opacity).toBeCloseTo(0.75, 6)
  })
  it('clamps outside the range', () => {
    expect(evaluateKeyframes(kfs, 5).dx).toBeCloseTo(0.5, 6)
    expect(evaluateKeyframes(kfs, -1).dx).toBeCloseTo(0, 6)
  })
})

describe('supported preset id lists', () => {
  it('cover the core LIV vocabulary', () => {
    expect(SUPPORTED_IN_IDS).toContain('slide-up')
    expect(SUPPORTED_IN_IDS).toContain('mask-up')
    expect(SUPPORTED_OUT_IDS).toContain('fade-out')
    expect(SUPPORTED_LOOP_IDS).toContain('wave')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/motion-evaluate.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the evaluator**

```ts
// frontend/app/lib/motion/evaluate.ts
/**
 * Pure time-evaluation of layer animations. No DOM, no GSAP, no randomness —
 * same (animation, t) in, same state out, which is what makes preview, bake,
 * and golden tests agree.
 *
 * Spatial units: UnitState dx/dy are in UNIT-BOX HEIGHTS (1 = the height of
 * the animated unit's own box — a char cell for text units, the layer bbox
 * for whole-layer animation). The painter multiplies into px. This keeps
 * preset "distances" proportional at any canvas size, mirroring how the GSAP
 * presets' px offsets relate to their preview font size.
 */
import type { LayerAnimation, LayerAnimSpec, LayerKeyframe, FrameMotion } from './types'
import { resolveEase, easeInOutQuad, linear, elasticOut, backOut, steps as stepsEase } from './easing'

export interface UnitState {
  dx: number; dy: number          // unit-box heights
  scale: number                   // multiplicative
  rotation: number                // degrees, additive
  opacity: number                 // 0..1 multiplicative
  /** Clip the unit's box: fraction hidden from one side (mask presets). */
  clip?: { side: 'top' | 'bottom' | 'left' | 'right'; amount: number }
}

export interface LayerMotionState {
  visible: boolean
  /** Whole-layer transform from keyframes (canvas-normalized dx, dy). */
  layer: UnitState
  /** Per-unit states (chars for text; single entry for other kinds). */
  units?: UnitState[]
}

export const IDENTITY_UNIT: UnitState = { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 }
const HIDDEN: LayerMotionState = { visible: false, layer: IDENTITY_UNIT }

// Deterministic per-unit pseudo-random in [0,1) (replaces Math.random()).
function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

export function layerWindow(
  anim: Pick<LayerAnimation, 'offset' | 'duration'>,
  motion: FrameMotion,
): { start: number; end: number } {
  const start = Math.max(0, anim.offset)
  const end = anim.duration == null
    ? motion.duration
    : Math.min(motion.duration, start + Math.max(0, anim.duration))
  return { start, end }
}

// ── Per-preset unit evaluation ───────────────────────────────────────────────
// IN: e is the eased progress 0→1 (0 = fully out, 1 = at rest).
// OUT: e is the eased progress 0→1 (0 = at rest, 1 = fully gone).
// LOOP: f(phase, i) with phase = (tLoop / duration) mod 1, per-unit delay applied
// by the caller via the stagger window like in/out.

type UnitEval = (e: number, i: number, n: number) => UnitState
const u = (p: Partial<UnitState>): UnitState => ({ ...IDENTITY_UNIT, ...p })

const IN_EVAL: Record<string, { fn: UnitEval; ease: string }> = {
  'appear':       { ease: 'none',            fn: e => u({ opacity: e > 0 ? 1 : 0 }) },
  'fade-in':      { ease: 'power2.out',      fn: e => u({ opacity: e }) },
  'slide-up':     { ease: 'power2.out',      fn: e => u({ dy: (1 - e) * 0.5, opacity: e }) },
  'slide-down':   { ease: 'power2.out',      fn: e => u({ dy: -(1 - e) * 0.5, opacity: e }) },
  'slide-left':   { ease: 'power2.out',      fn: e => u({ dx: (1 - e) * 0.5, opacity: e }) },
  'slide-right':  { ease: 'power2.out',      fn: e => u({ dx: -(1 - e) * 0.5, opacity: e }) },
  'mask-up':      { ease: 'power3.out',      fn: e => u({ dy: (1 - e) * 0.25, clip: { side: 'top', amount: 1 - e } }) },
  'mask-down':    { ease: 'power3.out',      fn: e => u({ dy: -(1 - e) * 0.25, clip: { side: 'bottom', amount: 1 - e } }) },
  'grow-in':      { ease: 'back.out(1.7)',   fn: e => u({ scale: Math.max(0.001, e), opacity: Math.min(1, e * 2) }) },
  'shrink-in':    { ease: 'power3.out',      fn: e => u({ scale: 2.5 - 1.5 * e, opacity: e }) },
  'spin-in':      { ease: 'back.out(1.4)',   fn: e => u({ rotation: (1 - e) * 180, scale: Math.max(0.001, e), opacity: e }) },
  'elastic-drop': { ease: 'elastic.out(1, 0.3)', fn: e => u({ dy: -(1 - e) * 1.0, opacity: 1 }) },
  'typewriter':   { ease: 'none',            fn: e => u({ opacity: e > 0.01 ? 1 : 0 }) },
  'glitch-in':    { ease: 'steps(6)',        fn: (e, i) => u({
    dx: (seeded(i, 1) - 0.5) * 0.75 * (1 - e),
    dy: (seeded(i, 2) - 0.5) * 0.4 * (1 - e),
    opacity: e > 0 ? 1 : 0,
  }) },
}

const OUT_EVAL: Record<string, { fn: UnitEval; ease: string }> = {
  'disappear':       { ease: 'none',          fn: e => u({ opacity: e > 0 ? 0 : 1 }) },
  'fade-out':        { ease: 'power2.in',     fn: e => u({ opacity: 1 - e }) },
  'slide-out-up':    { ease: 'power2.in',     fn: e => u({ dy: -e * 0.5, opacity: 1 - e }) },
  'slide-out-down':  { ease: 'power2.in',     fn: e => u({ dy: e * 0.5, opacity: 1 - e }) },
  'slide-out-left':  { ease: 'power2.in',     fn: e => u({ dx: -e * 0.5, opacity: 1 - e }) },
  'slide-out-right': { ease: 'power2.in',     fn: e => u({ dx: e * 0.5, opacity: 1 - e }) },
  'mask-out-up':     { ease: 'power3.in',     fn: e => u({ dy: -e * 0.25, clip: { side: 'bottom', amount: e } }) },
  'mask-out-down':   { ease: 'power3.in',     fn: e => u({ dy: e * 0.25, clip: { side: 'top', amount: e } }) },
  'shrink-out':      { ease: 'back.in(1.7)',  fn: e => u({ scale: Math.max(0.001, 1 - e), opacity: 1 - e }) },
  'grow-out':        { ease: 'power3.in',     fn: e => u({ scale: 1 + 1.5 * e, opacity: 1 - e }) },
  'spin-out':        { ease: 'power3.in',     fn: e => u({ rotation: e * 180, scale: Math.max(0.001, 1 - e), opacity: 1 - e }) },
  'elastic-launch':  { ease: 'back.in(2)',    fn: e => u({ dy: -e * 1.0, opacity: 1 - e }) },
  'typewriter-out':  { ease: 'none',          fn: (e, i, n) => u({ opacity: e > 0.01 ? 0 : 1 }) },
  'glitch-out':      { ease: 'steps(6)',      fn: (e, i) => u({
    dx: (seeded(i, 3) - 0.5) * 0.75 * e,
    dy: (seeded(i, 4) - 0.5) * 0.4 * e,
    opacity: 1 - e,
  }) },
}

// Loop: fn(phase 0..1, i) — periodic by construction (sin/cos of 2π·phase).
type LoopEval = (phase: number, i: number, n: number) => UnitState
const TWO_PI = Math.PI * 2
const LOOP_EVAL: Record<string, LoopEval> = {
  'wave':      (p) => u({ dy: -0.25 * Math.sin(p * TWO_PI) }),
  'float':     (p) => u({ dy: -0.1 * Math.sin(p * TWO_PI), dx: 0.04 * Math.sin(p * TWO_PI + 1) }),
  'sway':      (p) => u({ rotation: 8 * Math.sin(p * TWO_PI) }),
  'breathe':   (p) => u({ scale: 1 + 0.06 * Math.sin(p * TWO_PI) }),
  'throb':     (p) => u({ scale: 1 + 0.2 * Math.max(0, Math.sin(p * TWO_PI)) }),
  'spin-loop': (p) => u({ rotation: p * 360 }),
  'rock':      (p) => u({ rotation: 12 * Math.sin(p * TWO_PI) }),
  'glitch-loop': (p, i) => {
    const tick = Math.floor(p * 12)
    return u({ dx: (seeded(i + tick, 5) - 0.5) * 0.12, dy: (seeded(i + tick, 6) - 0.5) * 0.06 })
  },
  'marquee':   (p) => u({ dx: (1 - 2 * p) * 2 }), // +2 → −2 unit-box sweep, painter scales by layer width
}

export const SUPPORTED_IN_IDS = Object.keys(IN_EVAL)
export const SUPPORTED_OUT_IDS = Object.keys(OUT_EVAL)
export const SUPPORTED_LOOP_IDS = Object.keys(LOOP_EVAL)

// ── Stagger window: unit i animates inside [i·stagger, i·stagger + unitDur] ──
function unitProgress(tPhase: number, spec: LayerAnimSpec, i: number, n: number): number {
  const stagger = spec.stagger ?? 0.04
  const span = Math.max(0, (n - 1) * stagger)
  const unitDur = Math.max(0.05, spec.duration - span)
  const start = i * stagger
  return Math.max(0, Math.min(1, (tPhase - start) / unitDur))
}

function evalSpecUnits(
  spec: LayerAnimSpec,
  tPhase: number,
  n: number,
  table: Record<string, { fn: UnitEval; ease: string }>,
  fallback: { fn: UnitEval; ease: string },
): UnitState[] {
  const entry = table[spec.presetId] ?? fallback
  const ease = resolveEase(spec.ease ?? entry.ease)
  return Array.from({ length: n }, (_, i) => entry.fn(ease(unitProgress(tPhase, spec, i, n)), i, n))
}

export function evaluateKeyframes(kfs: LayerKeyframe[], t: number): UnitState {
  if (!kfs.length) return IDENTITY_UNIT
  const sorted = [...kfs].sort((a, b) => a.t - b.t)
  const fill = (k: LayerKeyframe): Required<Omit<LayerKeyframe, 'ease'>> => ({
    t: k.t, dx: k.dx ?? 0, dy: k.dy ?? 0, scale: k.scale ?? 1,
    rotation: k.rotation ?? 0, opacity: k.opacity ?? 1,
  })
  if (t <= sorted[0].t) { const k = fill(sorted[0]); return u({ dx: k.dx, dy: k.dy, scale: k.scale, rotation: k.rotation, opacity: k.opacity }) }
  const last = sorted[sorted.length - 1]
  if (t >= last.t) { const k = fill(last); return u({ dx: k.dx, dy: k.dy, scale: k.scale, rotation: k.rotation, opacity: k.opacity }) }
  let lo = sorted[0], hi = sorted[1]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].t >= t) { lo = sorted[i - 1]; hi = sorted[i]; break }
  }
  const a = fill(lo), b = fill(hi)
  const span = Math.max(1e-6, b.t - a.t)
  const easeFn = (lo.ease ?? 'easeInOut') === 'linear' ? linear : easeInOutQuad
  const p = easeFn((t - a.t) / span)
  const lerp = (x: number, y: number) => x + (y - x) * p
  return u({
    dx: lerp(a.dx, b.dx), dy: lerp(a.dy, b.dy), scale: lerp(a.scale, b.scale),
    rotation: lerp(a.rotation, b.rotation), opacity: lerp(a.opacity, b.opacity),
  })
}

/**
 * Evaluate a layer's animation at absolute frame-time `t` (seconds).
 * `n` = number of animatable units (char count for text; 1 otherwise).
 */
export function evaluateAnimation(
  anim: LayerAnimation,
  t: number,
  motion: FrameMotion,
  n: number,
): LayerMotionState {
  const { start, end } = layerWindow(anim, motion)
  if (t < start || t >= end) return HIDDEN
  const tIn = t - start
  const layer = anim.keyframes?.length ? evaluateKeyframes(anim.keyframes, tIn) : IDENTITY_UNIT

  const inDur = anim.in ? Math.max(0.01, anim.in.duration) : 0
  const outDur = anim.out ? Math.max(0.01, anim.out.duration) : 0
  const outStart = (end - start) - outDur

  let units: UnitState[] | undefined
  if (anim.in && tIn < inDur) {
    units = evalSpecUnits(anim.in, tIn, n, IN_EVAL, IN_EVAL['fade-in'])
  } else if (anim.out && tIn >= outStart) {
    units = evalSpecUnits(anim.out, tIn - outStart, n, OUT_EVAL, OUT_EVAL['fade-out'])
  } else if (anim.loop) {
    const cycle = Math.max(0.1, anim.loop.duration)
    const stagger = anim.loop.stagger ?? 0.04
    const loopFn = LOOP_EVAL[anim.loop.presetId]
    if (loopFn) {
      units = Array.from({ length: n }, (_, i) => {
        const phase = (((tIn - i * stagger) / cycle) % 1 + 1) % 1
        return loopFn(phase, i, n)
      })
    }
  }
  if (!units) units = Array.from({ length: n }, () => IDENTITY_UNIT)
  return { visible: true, layer, units }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/motion-evaluate.unit.spec.ts`
Expected: PASS. (If the `mid-in` assertion fails on the exact value, check the stagger-window math, not the test: with stagger 0 and duration 0.5, t=1.25 ⇒ p=0.5 ⇒ power2.out(0.5)=0.75.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/motion/evaluate.ts frontend/tests/unit/motion-evaluate.unit.spec.ts
git commit -m "Motion engine: pure animation evaluator (windows, presets, keyframes)"
```

---

### Task 4: Text unit layout + animated text drawing

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` — export `wrappedTextLines` and `applyFont` (currently private, ~lines 403 and 423)
- Create: `frontend/app/lib/motion/animatedText.ts`
- Test: `frontend/tests/unit/motion-text-layout.unit.spec.ts`

- [ ] **Step 1: Export the two text helpers**

In `useCompositorLayers.ts` change `function wrappedTextLines(` → `export function wrappedTextLines(` and `function applyFont(` → `export function applyFont(`. No behavior change.

- [ ] **Step 2: Write the failing layout test (uses a stub 2D context)**

```ts
// frontend/tests/unit/motion-text-layout.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { layoutTextUnits } from '../../app/lib/motion/animatedText'
import { createTextLayer } from '../../app/composables/useCompositorLayers'

// Minimal measureText stub: every char is 10px wide at any font.
function stubCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (s: string) => ({ width: s.length * 10 }),
  } as unknown as CanvasRenderingContext2D
}

describe('layoutTextUnits', () => {
  it('lays out one cell per char with monotonic x and line-based y', () => {
    const layer = createTextLayer({ text: 'AB\nC', x: 0.5, y: 0.5, fontSize: 0.1, lineHeight: 1.2, align: 'left' })
    const cells = layoutTextUnits(stubCtx(), layer, 1000, 1000)
    expect(cells.length).toBe(3) // whitespace-only chars get no cell; newline splits lines
    expect(cells[0].char).toBe('A')
    expect(cells[1].x).toBeGreaterThan(cells[0].x)
    expect(cells[2].y).toBeGreaterThan(cells[0].y) // second line lower
    // Cell height = fontSize px; cells carry the em box for unit-relative deltas
    expect(cells[0].h).toBeCloseTo(100, 3)
  })
  it('is deterministic', () => {
    const layer = createTextLayer({ text: 'HELLO' })
    const a = layoutTextUnits(stubCtx(), layer, 800, 600)
    const b = layoutTextUnits(stubCtx(), layer, 800, 600)
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/motion-text-layout.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement animatedText.ts**

```ts
// frontend/app/lib/motion/animatedText.ts
/**
 * Per-character layout + animated drawing for TextLayers. Layout mirrors
 * drawText() in useCompositorLayers (same wrap, align, lineHeight math) but
 * exposes one cell per visible character so the evaluator's per-unit states
 * can transform them individually.
 */
import type { TextLayer } from '~/composables/useCompositorLayers'
import { wrappedTextLines, applyFont } from '~/composables/useCompositorLayers'
import type { UnitState } from './evaluate'

export interface CharCell {
  char: string
  x: number   // px center, in the layer's local (unrotated) frame
  y: number
  w: number   // px advance width
  h: number   // px em box (fontSize px) — the unit box for dy deltas
}

/** One cell per non-whitespace char. Local frame: origin = layer center,
 *  same convention as drawText (caller applies layer translate/rotate). */
export function layoutTextUnits(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  W: number,
  H: number,
): CharCell[] {
  const lines = wrappedTextLines(ctx, layer, W)
  const fontPx = layer.fontSize * W
  const lineH = fontPx * layer.lineHeight
  applyFont(ctx, layer, W)
  let blockW = 0
  if ((layer.boxW ?? 0) > 0) blockW = layer.boxW! * W
  else for (const ln of lines) blockW = Math.max(blockW, ctx.measureText(ln || ' ').width)

  const totalH = lines.length * lineH
  const cells: CharCell[] = []
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const lineW = ctx.measureText(line || '').width
    // Line start X matches drawText's anchor math for each alignment.
    let x = layer.align === 'left' ? -blockW / 2
      : layer.align === 'right' ? blockW / 2 - lineW
      : -lineW / 2
    const y = -totalH / 2 + lineH / 2 + li * lineH
    for (const char of [...line]) {
      const w = ctx.measureText(char).width
      if (char.trim()) cells.push({ char, x: x + w / 2, y, w, h: fontPx })
      x += w
    }
  }
  return cells
}

/**
 * Draw a text layer with per-unit motion states. The context must already be
 * in canvas space (NOT pre-translated): this function applies the layer's own
 * translate/rotate exactly like paintLayer's fast path, then draws each char
 * cell with its UnitState transform. `units.length` must equal the cell count
 * (evaluator is called with that n); extra/missing entries fall back to rest.
 */
export function drawAnimatedTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  W: number,
  H: number,
  units: UnitState[],
): void {
  const cells = layoutTextUnits(ctx, layer, W, H)
  ctx.save()
  ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity))
  ctx.translate(layer.x * W, layer.y * H)
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180)
  applyFont(ctx, layer, W)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const strokeOn = !!layer.strokeColor && layer.strokeColor !== 'none' && layer.strokeWidth > 0
  if (strokeOn) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = layer.strokeWidth * W
    ctx.strokeStyle = layer.strokeColor
  }
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    const st = units[i] ?? { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 }
    if (st.opacity <= 0.001) continue
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity * st.opacity))
    if (st.clip && st.clip.amount > 0.001) {
      // Clip the cell box BEFORE the unit transform so the reveal edge stays
      // fixed while the glyph slides under it (mask-reveal look). Pad x by the
      // em box to survive glyph overhang.
      const a = Math.max(0, Math.min(1, st.clip.amount))
      let cx = cell.x - cell.w, cy = cell.y - cell.h / 2, cw = cell.w * 2, ch = cell.h
      if (st.clip.side === 'top') { cy += ch * a; ch *= (1 - a) }
      else if (st.clip.side === 'bottom') { ch *= (1 - a) }
      else if (st.clip.side === 'left') { cx += cw * a; cw *= (1 - a) }
      else { cw *= (1 - a) }
      ctx.beginPath()
      ctx.rect(cx, cy, Math.max(0, cw), Math.max(0, ch))
      ctx.clip()
    }
    ctx.translate(cell.x + st.dx * cell.h, cell.y + st.dy * cell.h)
    if (st.rotation) ctx.rotate((st.rotation * Math.PI) / 180)
    if (st.scale !== 1) ctx.scale(Math.max(0.001, st.scale), Math.max(0.001, st.scale))
    ctx.fillStyle = layer.color
    if (strokeOn) ctx.strokeText(cell.char, 0, 0)
    ctx.fillText(cell.char, 0, 0)
    ctx.restore()
  }
  ctx.restore()
}
```

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run tests/unit/motion-text-layout.unit.spec.ts tests/unit`
Expected: PASS (all suites).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/motion/animatedText.ts frontend/tests/unit/motion-text-layout.unit.spec.ts frontend/app/composables/useCompositorLayers.ts
git commit -m "Motion engine: per-char text layout and animated drawing"
```

---

### Task 5: Time-aware stack painting

**Files:**
- Create: `frontend/app/lib/motion/paint.ts`
- Modify: `frontend/app/composables/useCompositorLayers.ts` — `paintLayerStack` (~line 796)
- Test: `frontend/tests/unit/motion-paint.unit.spec.ts` (pure composition helper only)

- [ ] **Step 1: Write the failing test for the effective-layer composition helper**

```ts
// frontend/tests/unit/motion-paint.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { composeEffectiveLayer } from '../../app/lib/motion/paint'
import { createRectLayer } from '../../app/composables/useCompositorLayers'
import { IDENTITY_UNIT } from '../../app/lib/motion/evaluate'

describe('composeEffectiveLayer', () => {
  const base = createRectLayer({ x: 0.5, y: 0.5, rotation: 10, opacity: 0.8, w: 0.2, h: 0.1 })
  it('identity state returns equivalent transform values', () => {
    const eff = composeEffectiveLayer(base, { visible: true, layer: IDENTITY_UNIT, units: [IDENTITY_UNIT] })
    expect(eff.x).toBeCloseTo(0.5, 6)
    expect(eff.opacity).toBeCloseTo(0.8, 6)
    expect(eff.rotation).toBeCloseTo(10, 6)
  })
  it('keyframe layer state offsets x/y in canvas units and multiplies opacity', () => {
    const eff = composeEffectiveLayer(base, {
      visible: true,
      layer: { ...IDENTITY_UNIT, dx: 0.1, dy: -0.2, opacity: 0.5, rotation: 5 },
      units: [IDENTITY_UNIT],
    })
    expect(eff.x).toBeCloseTo(0.6, 6)
    expect(eff.y).toBeCloseTo(0.3, 6)
    expect(eff.opacity).toBeCloseTo(0.4, 6)
    expect(eff.rotation).toBeCloseTo(15, 6)
  })
  it('whole-layer unit state (non-text) folds into the clone too', () => {
    const eff = composeEffectiveLayer(base, {
      visible: true,
      layer: IDENTITY_UNIT,
      units: [{ ...IDENTITY_UNIT, dy: 0.5, opacity: 0.5 }],
    })
    // dy is in unit-box heights; for non-text the box is the layer's own h (0.1 of W)
    // composeEffectiveLayer converts via the provided box height fraction.
    expect(eff.opacity).toBeCloseTo(0.4, 6)
    expect(eff.y).toBeGreaterThan(0.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/motion-paint.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement paint.ts**

```ts
// frontend/app/lib/motion/paint.ts
/**
 * Bridges the pure evaluator to the Canvas2D layer renderer. Whole-layer
 * motion folds into a transformed CLONE of the layer (so drawLocalLayer's
 * own translate/rotate/effects pipeline applies unchanged); per-char text
 * motion routes to drawAnimatedTextLayer. Scale applies as a ctx transform
 * around the effective center because LocalLayers have no uniform scale field.
 */
import type { LocalLayer, TextLayer } from '~/composables/useCompositorLayers'
import { drawLocalLayer } from '~/composables/useCompositorLayers'
import type { FrameMotion } from './types'
import type { LayerMotionState } from './evaluate'
import { evaluateAnimation } from './evaluate'
import { drawAnimatedTextLayer } from './animatedText'

/** Evaluate a layer at t. Layers without animation are static and visible. */
export function motionStateFor(
  ctx: CanvasRenderingContext2D | null,
  layer: LocalLayer,
  t: number,
  motion: FrameMotion,
): LayerMotionState | null {
  if (!layer.animation) return null
  const n = layer.kind === 'text'
    ? Math.max(1, [...(layer as TextLayer).text].filter(c => c.trim()).length)
    : 1
  return evaluateAnimation(layer.animation, t, motion, n)
}

/** Fold whole-layer motion into a layer clone (transform + opacity).
 *  Per-unit dy/dx for NON-text layers use the layer's own box height as the
 *  unit box, converted to canvas-normalized offsets. */
export function composeEffectiveLayer(layer: LocalLayer, st: LayerMotionState): LocalLayer {
  // Unit box height as a fraction of canvas H ≈ box.h/W · (W/H); we fold with
  // the conservative width-normalized form (box heights are width-normalized
  // everywhere in this file's geometry).
  const whole = st.units && st.units.length === 1 ? st.units[0] : null
  const boxH = 'h' in layer && typeof (layer as { h?: number }).h === 'number'
    ? (layer as { h: number }).h
    : 'bbox' in layer ? (layer as { bbox: { h: number } }).bbox.h
    : layer.kind === 'text' ? (layer as TextLayer).fontSize : 0.1
  const k = st.layer
  const dx = k.dx + (whole ? whole.dx * boxH : 0)
  const dy = k.dy + (whole ? whole.dy * boxH : 0)
  return {
    ...layer,
    x: layer.x + dx,
    y: layer.y + dy,
    rotation: layer.rotation + k.rotation + (whole?.rotation ?? 0),
    opacity: layer.opacity * k.opacity * (whole?.opacity ?? 1),
  }
}

function motionScale(st: LayerMotionState): number {
  const whole = st.units && st.units.length === 1 ? st.units[0] : null
  return st.layer.scale * (whole?.scale ?? 1)
}

/** Draw one local layer at motion state `st` (already evaluated, visible). */
export function drawLayerWithMotion(
  ctx: CanvasRenderingContext2D,
  layer: LocalLayer,
  W: number,
  H: number,
  maskLayer: LocalLayer | null,
  st: LayerMotionState,
  maskState: LayerMotionState | null,
): void {
  const eff = composeEffectiveLayer(layer, st)
  const effMask = maskLayer
    ? (maskState ? composeEffectiveLayer(maskLayer, maskState) : maskLayer)
    : null
  const scale = motionScale(st)
  const needScale = Math.abs(scale - 1) > 1e-4
  if (needScale) {
    ctx.save()
    ctx.translate(eff.x * W, eff.y * H)
    ctx.scale(Math.max(0.001, scale), Math.max(0.001, scale))
    ctx.translate(-eff.x * W, -eff.y * H)
  }
  if (eff.kind === 'text' && st.units && st.units.length > 1) {
    // Per-char path. Layer masks (maskedById) on per-char animated text are
    // not composited per-unit in v1 — the mask applies as a whole via clip of
    // drawLocalLayer; here we draw unmasked (documented limitation).
    drawAnimatedTextLayer(ctx, eff as TextLayer, W, H, st.units)
  } else {
    drawLocalLayer(ctx, eff, W, H, effMask)
  }
  if (needScale) ctx.restore()
}
```

- [ ] **Step 4: Thread time through paintLayerStack**

In `useCompositorLayers.ts`, change `paintLayerStack`'s signature and local-layer branch:

```ts
export function paintLayerStack(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  items: StackItem[],
  localLayers: LocalLayer[],
  skip?: (layer: LocalLayer) => boolean,
  /** Motion time in seconds. Undefined ⇒ static render, exactly as before. */
  t?: number,
  motion?: { fps: number; duration: number },
) {
```

and replace the final two lines of the local-layer branch (`const maskLayer = ...` / `drawLocalLayer(...)`) with:

```ts
    const maskLayer = layer.maskedById ? localLayers.find(l => l.id === layer.maskedById) ?? null : null
    if (t !== undefined && motion && layer.animation) {
      // Lazy import keeps the static path dependency-free; motion module
      // imports THIS file, so a static import here would be a cycle.
      const { motionStateFor, drawLayerWithMotion } = _motionPainter()
      const st = motionStateFor(ctx, layer, t, motion)
      if (st && !st.visible) continue
      if (st) {
        const maskState = maskLayer?.animation ? motionStateFor(ctx, maskLayer, t, motion) : null
        if (maskState && !maskState.visible) { drawLayerWithMotion(ctx, layer, W, H, null, st, null); continue }
        drawLayerWithMotion(ctx, layer, W, H, maskLayer, st, maskState)
        continue
      }
    }
    drawLocalLayer(ctx, layer, W, H, maskLayer)
```

And add near the top of the file (after imports):

```ts
// Motion painter indirection — set by app/lib/motion/paint.ts on first import
// to break the import cycle (paint.ts imports drawLocalLayer from here).
let _motionPainterImpl: any = null
export function _registerMotionPainter(impl: {
  motionStateFor: Function
  drawLayerWithMotion: Function
}) { _motionPainterImpl = impl }
function _motionPainter() {
  if (!_motionPainterImpl) throw new Error('motion painter not registered — import ~/lib/motion/paint first')
  return _motionPainterImpl
}
```

and at the BOTTOM of `frontend/app/lib/motion/paint.ts`:

```ts
import { _registerMotionPainter } from '~/composables/useCompositorLayers'
_registerMotionPainter({ motionStateFor, drawLayerWithMotion })
```

(Callers that pass `t` — the modal and the bake — import `~/lib/motion/paint` themselves, so registration is guaranteed before use.)

- [ ] **Step 5: Run the full unit suite**

Run: `cd frontend && npx vitest run tests/unit`
Expected: PASS — including the new motion-paint spec and all pre-existing suites (static `paintLayerStack` callers are unaffected: new params are optional and trailing).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/motion/paint.ts frontend/tests/unit/motion-paint.unit.spec.ts frontend/app/composables/useCompositorLayers.ts
git commit -m "Motion engine: time-aware paintLayerStack via motion painter"
```

---

### Task 6: Compositor preview UI — transport + per-layer animation panel

**Files:**
- Create: `frontend/app/components/vue-canvas/compositor/MotionTransport.vue`
- Create: `frontend/app/components/vue-canvas/compositor/LayerMotionPanel.vue`
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (renderStack ~line 809; property panel template; toolbar area)

This task is UI integration — no vitest; verification is in-browser with the preview tools.

- [ ] **Step 1: Motion doc storage in the modal**

In `CompositorModal.vue` `<script setup>` (near the other property helpers around `outWidth`, ~line 855), add:

```ts
import { DEFAULT_FRAME_MOTION, type FrameMotion } from '~/lib/motion/types'
import '~/lib/motion/paint' // registers the motion painter for paintLayerStack(t)

const motionDoc = computed<FrameMotion>(() => {
  const props_ = compositor.value?.data?.properties as Record<string, any> | undefined
  return { ...DEFAULT_FRAME_MOTION, ...(props_?.sailor_motion ?? {}) }
})
function setMotion(patch: Partial<FrameMotion>) {
  const node = compositor.value
  if (!node) return
  const p = (node.data.properties ||= {})
  p.sailor_motion = { ...motionDoc.value, ...patch }
}
```

Persistence: `sailor_motion` rides `node.data.properties` exactly like `sailor_localLayers` / `sailor_hiddenWired`. Confirm by checking how `toggleWiredFlag` (CompositorModal.vue, search for `sailor_hiddenWired`) marks the graph dirty — if it calls a helper after mutation (e.g. a `persist()`/`touch()` emit), call the same helper in `setMotion`.

- [ ] **Step 2: Transport state + rAF loop + renderStack(t)**

Add below the motion helpers:

```ts
// ── Motion preview transport ─────────────────────────────────────────────────
const previewT = ref<number | null>(null)   // null = static editing view
const playing = ref(false)
let rafId = 0
let playStartWall = 0
let playStartT = 0

function tickPlayback(now: number) {
  if (!playing.value) return
  const t = (playStartT + (now - playStartWall) / 1000) % motionDoc.value.duration
  previewT.value = t
  renderStack()
  rafId = requestAnimationFrame(tickPlayback)
}
function play() {
  playing.value = true
  playStartT = previewT.value ?? 0
  playStartWall = performance.now()
  rafId = requestAnimationFrame(tickPlayback)
}
function pause() {
  playing.value = false
  cancelAnimationFrame(rafId)
}
function scrubTo(t: number) {
  pause()
  previewT.value = Math.max(0, Math.min(motionDoc.value.duration, t))
  renderStack()
}
function exitMotionPreview() {
  pause()
  previewT.value = null
  renderStack()
}
onUnmounted(pause)
```

Then change the `paintLayerStack(...)` call inside `renderStack()` (~line 829) to:

```ts
  paintLayerStack(ctx, W, H, items, localLayers.value as LocalLayer[], l =>
    l.id === editingId.value || (nodeEdit.active.value && l.id === nodeEdit.layerId.value),
    previewT.value ?? undefined, previewT.value != null ? motionDoc.value : undefined)
```

- [ ] **Step 3: MotionTransport.vue**

```vue
<!-- frontend/app/components/vue-canvas/compositor/MotionTransport.vue -->
<script setup lang="ts">
import type { FrameMotion } from '~/lib/motion/types'

const props = defineProps<{
  motion: FrameMotion
  t: number | null
  playing: boolean
}>()
const emit = defineEmits<{
  play: []
  pause: []
  scrub: [t: number]
  exit: []
  'update:motion': [patch: Partial<FrameMotion>]
}>()

function fmt(s: number) { return s.toFixed(2) + 's' }
</script>

<template>
  <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900/90 border border-neutral-800 text-xs text-neutral-300">
    <button
      class="w-7 h-7 grid place-items-center rounded hover:bg-neutral-800"
      :title="playing ? 'Pause' : 'Play'"
      @click="playing ? emit('pause') : emit('play')"
    >
      <span v-if="playing">❚❚</span><span v-else>▶</span>
    </button>
    <input
      type="range" class="w-48 accent-lime-400" min="0" :max="motion.duration" step="0.01"
      :value="t ?? 0"
      @input="emit('scrub', Number(($event.target as HTMLInputElement).value))"
    >
    <span class="tabular-nums w-14">{{ fmt(t ?? 0) }}</span>
    <label class="flex items-center gap-1">dur
      <input
        type="number" min="0.5" max="60" step="0.5" :value="motion.duration"
        class="w-14 bg-neutral-800 rounded px-1 py-0.5"
        @change="emit('update:motion', { duration: Math.max(0.5, Number(($event.target as HTMLInputElement).value) || 4) })"
      >
    </label>
    <label class="flex items-center gap-1">fps
      <input
        type="number" min="1" max="60" step="1" :value="motion.fps"
        class="w-12 bg-neutral-800 rounded px-1 py-0.5"
        @change="emit('update:motion', { fps: Math.max(1, Math.min(60, Number(($event.target as HTMLInputElement).value) || 30)) })"
      >
    </label>
    <button class="ml-1 px-2 py-0.5 rounded hover:bg-neutral-800" title="Exit motion preview" @click="emit('exit')">✕</button>
  </div>
</template>
```

Mount it in the modal template floating above the canvas (inside the canvas container div that holds `overlayCanvas` — search the template for `overlayCanvas`):

```vue
<MotionTransport
  v-if="previewT != null"
  class="absolute bottom-3 left-1/2 -translate-x-1/2 z-20"
  :motion="motionDoc" :t="previewT" :playing="playing"
  @play="play" @pause="pause" @scrub="scrubTo" @exit="exitMotionPreview"
  @update:motion="setMotion"
/>
```

Plus a toolbar entry to ENTER motion preview (next to the pen/select tool buttons — search template for `togglePen`):

```vue
<button class="..." title="Motion preview" @click="previewT == null ? scrubTo(0) : exitMotionPreview()">
  Motion
</button>
```

(Copy the exact button classes from the neighboring tool buttons so it matches.)

- [ ] **Step 4: LayerMotionPanel.vue**

```vue
<!-- frontend/app/components/vue-canvas/compositor/LayerMotionPanel.vue -->
<script setup lang="ts">
import { SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS } from '~/lib/motion/evaluate'
import { KINETIC_PRESETS_BY_ID } from '~/data/kinetic-presets'
import type { LayerAnimation, LayerAnimSpec } from '~/lib/motion/types'

const props = defineProps<{ animation: LayerAnimation | undefined }>()
const emit = defineEmits<{ update: [anim: LayerAnimation | undefined] }>()

const label = (id: string) => KINETIC_PRESETS_BY_ID[id]?.label ?? id

function patch(p: Partial<LayerAnimation>) {
  emit('update', { offset: 0, ...(props.animation ?? {}), ...p })
}
function patchSpec(key: 'in' | 'out' | 'loop', presetId: string) {
  if (!presetId) return patch({ [key]: undefined })
  const cur: LayerAnimSpec = props.animation?.[key] ?? { presetId, duration: key === 'loop' ? 1.5 : 0.8, stagger: 0.04 }
  patch({ [key]: { ...cur, presetId } })
}
function patchSpecNum(key: 'in' | 'out' | 'loop', field: 'duration' | 'stagger', v: number) {
  const cur = props.animation?.[key]
  if (!cur) return
  patch({ [key]: { ...cur, [field]: v } })
}
</script>

<template>
  <div class="space-y-2 text-xs">
    <div class="flex items-center justify-between">
      <span class="font-medium text-neutral-300">Animation</span>
      <button v-if="animation" class="text-neutral-500 hover:text-neutral-300" @click="emit('update', undefined)">Clear</button>
    </div>
    <label class="flex items-center justify-between gap-2">Start (s)
      <input
        type="number" min="0" step="0.1" :value="animation?.offset ?? 0"
        class="w-16 bg-neutral-800 rounded px-1 py-0.5"
        @change="patch({ offset: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })"
      >
    </label>
    <label class="flex items-center justify-between gap-2">Duration (s, blank = to end)
      <input
        type="number" min="0.1" step="0.1" :value="animation?.duration ?? ''"
        class="w-16 bg-neutral-800 rounded px-1 py-0.5"
        @change="(e: Event) => { const v = (e.target as HTMLInputElement).value; patch({ duration: v === '' ? undefined : Math.max(0.1, Number(v)) }) }"
      >
    </label>
    <div v-for="key in (['in', 'out', 'loop'] as const)" :key="key" class="space-y-1">
      <label class="flex items-center justify-between gap-2 capitalize">{{ key }}
        <select
          class="w-32 bg-neutral-800 rounded px-1 py-0.5"
          :value="animation?.[key]?.presetId ?? ''"
          @change="patchSpec(key, ($event.target as HTMLSelectElement).value)"
        >
          <option value="">none</option>
          <option
            v-for="id in (key === 'in' ? SUPPORTED_IN_IDS : key === 'out' ? SUPPORTED_OUT_IDS : SUPPORTED_LOOP_IDS)"
            :key="id" :value="id"
          >{{ label(id) }}</option>
        </select>
      </label>
      <div v-if="animation?.[key]" class="flex gap-2 pl-2">
        <label class="flex items-center gap-1">dur
          <input
            type="number" min="0.1" step="0.1" :value="animation[key]!.duration"
            class="w-14 bg-neutral-800 rounded px-1 py-0.5"
            @change="patchSpecNum(key, 'duration', Math.max(0.1, Number(($event.target as HTMLInputElement).value) || 0.8))"
          >
        </label>
        <label class="flex items-center gap-1">stagger
          <input
            type="number" min="0" step="0.01" :value="animation[key]!.stagger ?? 0.04"
            class="w-14 bg-neutral-800 rounded px-1 py-0.5"
            @change="patchSpecNum(key, 'stagger', Math.max(0, Number(($event.target as HTMLInputElement).value) || 0))"
          >
        </label>
      </div>
    </div>
  </div>
</template>
```

Mount in the modal's local-layer property panel (the section that shows when a local layer is selected — anchor: the drop-shadow controls that call `toggleLocalShadow`), below effects:

```vue
<LayerMotionPanel
  v-if="selectedLocal"
  :animation="(selectedLocal as any).animation"
  @update="(a) => setLocal(selectedLocal!.id, { animation: a } as any)"
/>
```

(`selectedLocal` / `setLocal` are the modal's existing selected-local-layer ref and patch fn from `useLocalLayerEditor` — match the exact names used by the shadow controls in that section.)

- [ ] **Step 5: Verify in the browser**

1. `cd frontend && npm run dev` (or use the running supervised instance).
2. Open the app with the preview tools, open a Frame/Compositor with a text layer + a rect layer.
3. Select the text layer → Animation panel → In: Slide Up, stagger 0.04.
4. Select the rect → In: Grow In, Start 0.3s.
5. Click Motion → transport appears → Play: text staggers up per-char, rect pops in later; scrub works; ✕ returns to static editing.
6. Confirm no console errors (preview_console_logs) and that closing/reopening the modal persists the animation (it lives on the layer JSON).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/compositor/MotionTransport.vue frontend/app/components/vue-canvas/compositor/LayerMotionPanel.vue frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "Compositor: motion preview transport + per-layer animation panel"
```

---### Task 7: Bake to PNG sequence + motion_params

**Files:**
- Create: `frontend/app/lib/motion/bake.ts`
- Modify: `frontend/app/components/vue-canvas/compositor/MotionTransport.vue` (Bake button)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (bake wiring)
- Test: `frontend/tests/unit/motion-bake-key.unit.spec.ts`

- [ ] **Step 1: Write the failing source-key test**

```ts
// frontend/tests/unit/motion-bake-key.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { motionSourceKey } from '../../app/lib/motion/bake'
import { createTextLayer } from '../../app/composables/useCompositorLayers'

describe('motionSourceKey', () => {
  const layers = [createTextLayer({ text: 'HELLO' })]
  const motion = { fps: 30, duration: 4 }
  it('is deterministic', () => {
    expect(motionSourceKey(layers, motion, 1280, 720)).toBe(motionSourceKey(layers, motion, 1280, 720))
  })
  it('changes when anything that affects pixels changes', () => {
    const base = motionSourceKey(layers, motion, 1280, 720)
    expect(motionSourceKey([{ ...layers[0], text: 'WORLD' }], motion, 1280, 720)).not.toBe(base)
    expect(motionSourceKey(layers, { fps: 24, duration: 4 }, 1280, 720)).not.toBe(base)
    expect(motionSourceKey(layers, motion, 1920, 1080)).not.toBe(base)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/motion-bake-key.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement bake.ts**

```ts
// frontend/app/lib/motion/bake.ts
/**
 * Client-side motion bake: render the full layer stack at every frame time to
 * an offscreen canvas, collect PNG blobs (alpha preserved), upload via the
 * existing /upload/image batch helper, and produce the motion_params payload
 * the Compositor backend node consumes.
 */
import type { LocalLayer, StackItem } from '~/composables/useCompositorLayers'
import {
  paintLayerStack, ensureLayerFonts, ensureLayerImages,
} from '~/composables/useCompositorLayers'
import './paint' // ensure the motion painter is registered
import { uploadFrameBatch } from '~/composables/useKineticRenderer'
import type { FrameMotion } from './types'

/** FNV-1a over the JSON of everything that affects baked pixels. */
export function motionSourceKey(
  localLayers: LocalLayer[],
  motion: FrameMotion,
  W: number,
  H: number,
): string {
  const s = JSON.stringify({ localLayers, motion, W, H })
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export interface MotionParams {
  fps: number
  duration: number
  rendered: string[]   // uploaded input/ filenames, frame order
  source_key: string
}

export async function bakeMotionFrames(
  buildItems: () => StackItem[],
  localLayers: LocalLayer[],
  W: number,
  H: number,
  motion: FrameMotion,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob[]> {
  await ensureLayerFonts(localLayers, W)
  await ensureLayerImages(localLayers)
  const total = Math.max(1, Math.round(motion.duration * motion.fps))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(W))
  canvas.height = Math.max(1, Math.round(H))
  const ctx = canvas.getContext('2d')!
  const blobs: Blob[] = []
  for (let i = 0; i < total; i++) {
    const t = i / motion.fps
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height) // transparent background
    paintLayerStack(ctx, canvas.width, canvas.height, buildItems(), localLayers, undefined, t, motion)
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) throw new Error(`motion bake: frame ${i} produced no blob`)
    blobs.push(blob)
    onProgress?.(i + 1, total)
  }
  return blobs
}

export async function bakeAndUpload(
  buildItems: () => StackItem[],
  localLayers: LocalLayer[],
  W: number,
  H: number,
  motion: FrameMotion,
  onProgress?: (done: number, total: number) => void,
): Promise<MotionParams> {
  const blobs = await bakeMotionFrames(buildItems, localLayers, W, H, motion, onProgress)
  const rendered = await uploadFrameBatch(blobs, 'slate')
  if (rendered.length !== blobs.length) {
    throw new Error(`motion bake: uploaded ${rendered.length}/${blobs.length} frames — retry`)
  }
  return {
    fps: motion.fps,
    duration: motion.duration,
    rendered,
    source_key: motionSourceKey(localLayers, motion, W, H),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/motion-bake-key.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire a Bake button**

In `MotionTransport.vue`, add to props `{ baking?: boolean; bakeProgress?: number; stale?: boolean }`, to emits `bake: []`, and in the template (before the ✕ button):

```vue
    <button
      class="px-2 py-0.5 rounded font-medium"
      :class="stale ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-lime-500/20 text-lime-300 hover:bg-lime-500/30'"
      :disabled="baking"
      :title="stale ? 'Layers changed since last bake' : 'Bake motion to frames'"
      @click="emit('bake')"
    >
      {{ baking ? `Baking ${Math.round((bakeProgress ?? 0) * 100)}%` : stale ? 'Re-bake' : 'Bake' }}
    </button>
```

In `CompositorModal.vue`:

```ts
import { bakeAndUpload, motionSourceKey } from '~/lib/motion/bake'
import { setNamedWidget } from '~/composables/useFilteredPrompt'

const baking = ref(false)
const bakeProgress = ref(0)

// Output resolution: explicit artboard size when set, else editor canvas.
function bakeSize(): { W: number; H: number } {
  const W = outWidth.value
  const H = Math.round(W * (canvasDisplay.h / canvasDisplay.w))
  return { W, H }
}

const bakedSourceKey = computed<string | null>(() => {
  const node = compositor.value
  const raw = node ? getNamedWidget(node, props.objectInfo, 'motion_params') : null
  try { return raw ? (JSON.parse(String(raw)).source_key ?? null) : null } catch { return null }
})
const motionStale = computed(() => {
  if (!bakedSourceKey.value) return false
  const { W, H } = bakeSize()
  return bakedSourceKey.value !== motionSourceKey(localLayers.value as LocalLayer[], motionDoc.value, W, H)
})

async function bakeMotion() {
  const node = compositor.value
  if (!node || baking.value) return
  baking.value = true
  try {
    const { W, H } = bakeSize()
    const params = await bakeAndUpload(
      () => buildBakeItems(), localLayers.value as LocalLayer[], W, H, motionDoc.value,
      (done, total) => { bakeProgress.value = done / total },
    )
    setNamedWidget(node, props.objectInfo, 'motion_params', JSON.stringify(params))
  } finally {
    baking.value = false
  }
}
```

Notes for the implementer (verify against the actual code, these are the seams):
- `getNamedWidget`/`setNamedWidget` live in `useFilteredPrompt.ts:605-640`; follow the call shapes in `tests/unit/set-named-widget.unit.spec.ts` exactly (they take the node + objectInfo map + widget name). If the modal doesn't already receive `objectInfo` as a prop, obtain it the same way the modal's submit path does (grep `objectInfo` in `CompositorModal.vue` / its parent).
- `buildBakeItems()`: reuse the same item construction as `renderStack()` (the `stackKeys.value.map(...)` block) — extract that mapping into a function `buildStackItems(): StackItem[]` used by both, so the bake renders exactly what the preview shows (including wired layers).
- Pass `:baking="baking" :bake-progress="bakeProgress" :stale="motionStale" @bake="bakeMotion"` on the `<MotionTransport>` mount.

- [ ] **Step 6: Verify in browser**

Animate two layers, click Bake, watch progress complete. Then in DevTools network tab (or `preview_network`): N `/upload/image` POSTs (N = duration×fps). Confirm the node's `motion_params` widget value contains `rendered` with N filenames (inspect via the graph's widget state). Edit a layer → button shows "Re-bake".

- [ ] **Step 7: Commit**

```bash
git add frontend/app/lib/motion/bake.ts frontend/tests/unit/motion-bake-key.unit.spec.ts frontend/app/components/vue-canvas/compositor/MotionTransport.vue frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "Motion engine: client-side bake to PNG sequence + motion_params"
```

---

### Task 8: Backend — Compositor motion_params input + VIDEO output

**Files:**
- Modify: `comfy_extras/nodes_compositor.py` (schema ~line 202, execute ~line 268)

- [ ] **Step 1: Extend the schema**

In `define_schema`, append AFTER the `layer{i}_protect` loop (the file's convention: new widgets append last so saved workflows realign):

```python
        # Motion (Kinetic Slates): when the Frame has been animated and baked
        # client-side, this JSON carries {fps, duration, rendered: [...input
        # filenames...], source_key}. When rendered is non-empty the node
        # returns the baked frame batch + a real video instead of the static
        # server-side composite (the bake IS the composition, like `overlay`
        # but over time).
        inputs.append(IO.String.Input("motion_params", optional=True, default="",
                                      multiline=True,
                                      tooltip="Baked motion frames (managed by the Frame editor)."))
```

and change `outputs=[...]` to:

```python
            outputs=[
                IO.Image.Output(display_name="image"),
                IO.Mask.Output(display_name="protect_mask"),
                # 1-frame video of the static composite normally; the baked
                # animation at its fps when motion_params has rendered frames.
                IO.Video.Output(display_name="video"),
            ],
```

- [ ] **Step 2: Add the frame loader + motion branch to execute**

At the top of the file, mirror the imports used by `comfy_extras/nodes_video.py` for video construction (copy the exact import lines from that file — `InputImpl` and `Types` style) plus:

```python
import json
from fractions import Fraction

import numpy as np
from PIL import Image as PILImage, ImageOps
```

Add a module-level helper (adapted from `nodes_kinetic_type._load_frame`):

```python
def _load_motion_frame(filename: str):
    """Uploaded PNG → (IMAGE [H,W,3] float 0..1, alpha [H,W] float 0..1)."""
    path = folder_paths.get_annotated_filepath(filename)
    img = PILImage.open(path)
    img = ImageOps.exif_transpose(img)
    if "A" in img.getbands():
        alpha = torch.from_numpy(np.array(img.getchannel("A")).astype(np.float32) / 255.0)
    else:
        alpha = torch.ones(img.height, img.width, dtype=torch.float32)
    rgb = torch.from_numpy(np.array(img.convert("RGB")).astype(np.float32) / 255.0)
    return rgb, alpha
```

In `execute`, FIRST (before the existing layer gathering):

```python
        # Baked motion takes over the whole composite when present.
        try:
            motion = json.loads(kwargs.get("motion_params") or "{}")
        except json.JSONDecodeError:
            motion = {}
        rendered = motion.get("rendered") or []
        if isinstance(rendered, list) and rendered:
            frames, alphas = [], []
            for name in rendered:
                try:
                    rgb, a = _load_motion_frame(str(name))
                    frames.append(rgb)
                    alphas.append(a)
                except Exception:  # noqa: BLE001 — skip broken frames, keep the batch usable
                    continue
            if frames:
                batch = torch.stack(frames, dim=0)
                fps = max(1, int(motion.get("fps", 30)))
                video = InputImpl.VideoFromComponents(
                    Types.VideoComponents(images=batch, audio=None, frame_rate=Fraction(fps))
                )
                # protect_mask: union of baked alpha across frames (where the
                # slate ever draws), canvas-space like the static path.
                protect = torch.clamp(torch.stack(alphas, dim=0).max(dim=0).values, 0.0, 1.0).unsqueeze(0)
                return IO.NodeOutput(batch, protect, video)
```

THEN, at the existing return of the static path, wrap the composite into a 1-frame video so the output is always populated. Find the current `return IO.NodeOutput(...)` at the end of `execute` and extend it with a third value:

```python
        static_video = InputImpl.VideoFromComponents(
            Types.VideoComponents(images=<existing image tensor variable>, audio=None, frame_rate=Fraction(1))
        )
```

(`<existing image tensor variable>` = whatever name the current code returns as the first output — read the end of `execute` and use that variable; do not rename anything.)

- [ ] **Step 3: Reload + verify the schema**

Run: `pkill -f "main.py --listen" ; sleep 8 ; curl -s http://127.0.0.1:8188/object_info | python3 -c "import json,sys; d=json.load(sys.stdin)['Compositor']; print(d['output_name']); print('motion_params' in d['input'].get('optional', {}))"`
Expected: `['image', 'protect_mask', 'video']` and `True`.

- [ ] **Step 4: Check the frontend port catalog**

Run: `cd frontend && grep -rn "Compositor" app/ tests/unit/port-intent-catalog.unit.spec.ts | grep -i "port\|intent" | head`
If the port-intent catalog enumerates Compositor outputs explicitly, add the `video` output there following the existing entries' shape (and update `port-intent-catalog.unit.spec.ts` expectations); if ports are derived from `/object_info`, nothing to do.

Run: `cd frontend && npx vitest run tests/unit` — expected: PASS.

- [ ] **Step 5: End-to-end smoke**

In the app: Frame node with an animated text layer → Bake → wire the Frame's new `video` output into a Timeline node (or a SaveVideo node) → run the graph. Expected: the run succeeds and the downstream node receives the N-frame animation at the baked fps.

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/nodes_compositor.py
git commit -m "Compositor node: motion_params input + VIDEO output for baked slates"
```

---

### Task 9: Acceptance fixture — a hand-built LIV-style slate

**Files:**
- Create: `frontend/app/data/dev-slate-fixture.ts` (dev-only helper, also the seed for Phase 2 templates)

- [ ] **Step 1: Add the fixture doc**

```ts
// frontend/app/data/dev-slate-fixture.ts
/**
 * Dev fixture: a minimal LIV-style event slate used to acceptance-test the
 * motion engine end-to-end. Phase 2's template system will supersede this —
 * keep the choreography (offsets/presets) as the reference rhythm.
 */
import { createTextLayer, createRectLayer, type LocalLayer } from '~/composables/useCompositorLayers'
import type { FrameMotion } from '~/lib/motion/types'

export const SLATE_FIXTURE_MOTION: FrameMotion = { fps: 30, duration: 4 }

export function createSlateFixtureLayers(): LocalLayer[] {
  const bar = createRectLayer({
    x: 0.5, y: 0.532, w: 0.46, h: 0.085, radius: 0,
    fill: { type: 'linear', angle: 0, stops: [
      { offset: 0, color: '#2dd4bf' }, { offset: 1, color: '#a3e635' },
    ] },
    animation: { offset: 0.25, in: { presetId: 'slide-right', duration: 0.5, stagger: 0 }, out: { presetId: 'fade-out', duration: 0.4, stagger: 0 } },
  })
  const city = createTextLayer({
    text: 'ADELAIDE', x: 0.5, y: 0.42, fontSize: 0.11, fontWeight: 900,
    fontFamily: 'Archivo Black', color: '#ffffff', align: 'center',
    animation: { offset: 0, in: { presetId: 'mask-up', duration: 0.7, stagger: 0.035 }, out: { presetId: 'slide-out-up', duration: 0.45, stagger: 0.02 } },
  })
  const date = createTextLayer({
    text: '14–16 FEB', x: 0.5, y: 0.535, fontSize: 0.055, fontWeight: 800,
    fontFamily: 'Archivo Black', color: '#0a0a0a', align: 'center',
    animation: { offset: 0.45, in: { presetId: 'slide-up', duration: 0.5, stagger: 0.03 }, out: { presetId: 'fade-out', duration: 0.35, stagger: 0.02 } },
  })
  const venue = createTextLayer({
    text: 'THE GRANGE GOLF CLUB', x: 0.5, y: 0.63, fontSize: 0.034, fontWeight: 700,
    fontFamily: 'Inter', color: '#d9f99d', align: 'center',
    animation: { offset: 0.65, in: { presetId: 'fade-in', duration: 0.5, stagger: 0.015 }, out: { presetId: 'fade-out', duration: 0.35, stagger: 0 } },
  })
  const micro = createTextLayer({
    text: 'WATCH LIVE — 2025', x: 0.5, y: 0.92, fontSize: 0.018, fontWeight: 600,
    fontFamily: 'Inter', color: '#65a30d', align: 'center',
    animation: { offset: 0.9, in: { presetId: 'typewriter', duration: 0.6, stagger: 0.02 }, loop: { presetId: 'glitch-loop', duration: 1.2, stagger: 0.01 } },
  })
  // "In-type" mask: a gradient panel clipped to a giant numeral's silhouette
  // (the LIV photo-in-type look, with a gradient standing in for the photo —
  // swap the rect for an ImageLayer to mask real media). The text layer is the
  // mask (maskedById) so it never paints itself; the panel animates inside it.
  const year = createTextLayer({
    text: '25', x: 0.84, y: 0.78, fontSize: 0.28, fontWeight: 900,
    fontFamily: 'Archivo Black', color: '#ffffff', align: 'center',
  })
  const inType = createRectLayer({
    x: 0.84, y: 0.78, w: 0.4, h: 0.4, radius: 0,
    fill: { type: 'linear', angle: 45, stops: [
      { offset: 0, color: '#22d3ee' }, { offset: 1, color: '#a3e635' },
    ] },
    maskedById: year.id,
    animation: { offset: 0.5, in: { presetId: 'grow-in', duration: 0.6, stagger: 0 }, out: { presetId: 'fade-out', duration: 0.4, stagger: 0 } },
  })
  return [bar, city, date, venue, micro, year, inType]
}
```

- [ ] **Step 2: Temporary loader for manual testing**

Add a dev-only button in `CompositorModal.vue` next to the Motion toolbar button (remove or gate behind `import.meta.dev` before merge):

```ts
import { createSlateFixtureLayers, SLATE_FIXTURE_MOTION } from '~/data/dev-slate-fixture'
function loadSlateFixture() {
  for (const l of createSlateFixtureLayers()) addLocal(l)   // addLocal = the modal's existing add-layer fn (same one the toolbar "add text" uses)
  setMotion(SLATE_FIXTURE_MOTION)
  scrubTo(0)
}
```

```vue
<button v-if="$dev" class="..." @click="loadSlateFixture">Slate fixture</button>
```

(Use the modal's actual add-layer function name — grep for where `createTextLayer(` is called on the "add text" toolbar action.)

- [ ] **Step 3: Acceptance run (the spec's Phase 1 gate)**

1. Load fixture into an empty Frame → Play: city mask-reveals per-char, gradient bar sweeps in at 0.25s, date staggers up onto the bar, venue fades, microtype types on and jitters, and the gradient panel grows inside the "25" numeral silhouette (the in-type mask gate from the spec). The choreography should read as one beat, not seven independent layers.
2. Bake → run graph → Frame `video` output plays the same animation.
3. Wire the video into a Timeline node alongside a Film a Shot output (or any video) and confirm the slate composites over it in the timeline preview.
4. Capture a screenshot of the playing preview and the timeline composite as proof.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/data/dev-slate-fixture.ts frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "Motion engine: LIV-style slate acceptance fixture"
```

---

## Out of scope for this plan (per spec)

- Slate template system, brand kit, gallery (Phase 2 — next plan).
- Keyframe editing UI (engine supports `keyframes`; no UI).
- Video-typed wired inputs / video-in-type sampling.
- Golden-frame Playwright harness for motion (lands with Phase 2 when frames are stable artifacts; the evaluator is already deterministic + unit-tested).
- Python-side animation evaluation.

## Risks the implementer should watch

- **Import cycle (Task 5):** paint.ts ↔ useCompositorLayers.ts is broken via the `_registerMotionPainter` indirection. Don't "simplify" it into a static import — Nuxt will accept it until it deadlocks tree-shaken chunks.
- **Stagger semantics:** `unitProgress` reserves `(n-1)·stagger` out of the spec duration; with many chars and a big stagger the per-unit window floors at 0.05s. That's intended (GSAP behaves similarly when staggers exceed duration).
- **Upload volume:** 4s × 30fps = 120 PNG POSTs. Sequential is fine for v1 (matches `uploadFrameBatch`); don't parallelize blindly — ComfyUI's upload endpoint is not concurrency-hardened.
- **Modal anchors:** CompositorModal.vue is 123KB; template anchors in Tasks 6/7/9 are given by identifier (`overlayCanvas`, `togglePen`, `toggleLocalShadow`) — locate with grep, don't trust line numbers.
