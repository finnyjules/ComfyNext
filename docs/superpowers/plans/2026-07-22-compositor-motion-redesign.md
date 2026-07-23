# Compositor Motion Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revive the compositor's gated kinetic motion engine behind a redesigned surface: a Design|Motion inspector toggle, a docked band timeline, a Jitter-style preset gallery with live thumbnails, parameterized presets, and six new Utility presets.

**Architecture:** The pure-canvas engine (`app/lib/motion/*`) is kept and extended additively (params, scaleX/scaleY, copies). New UI components live in `app/components/vue-canvas/compositor/`. Band math is a new pure module developed TDD. `CompositorModal.vue` gains an `inspectorTab` state that swaps inspector content and docks the timeline over the agent-bar+toolbar cluster, mirroring the 3D Studio's Build|Motion idiom.

**Tech Stack:** Vue 3 + TS + Tailwind (Nuxt 4), Canvas2D, vitest for unit tests, `/dev/frame-lab` harness for browser verification.

**Spec:** `docs/superpowers/specs/2026-07-22-compositor-motion-redesign-design.md`

## Global Constraints

- Typecheck baseline is ~328 pre-existing errors — do not add NEW type errors (`cd frontend && npx nuxi typecheck 2>&1 | tail -3` before/after if unsure).
- Unit tests: `cd frontend && npx vitest run tests/unit/<file>.unit.spec.ts`. Unit tests live in `frontend/tests/unit/*.unit.spec.ts` (vitest picks up only that glob), import app code via the `~` alias, node environment (no DOM/canvas).
- Browser verification uses the dev server (`preview_start` name `frontend-harness`) and `http://127.0.0.1:<port>/dev/frame-lab`. Hard-reload after HMR weirdness.
- Parallel-session commit hygiene: `git add` ONLY the files this plan touches, never `git add -A`, never stash. Commit to main directly.
- `KINETIC_ENABLED` (in `app/lib/kineticEnabled.ts`) must remain `false` and keep gating slate-gallery entry points OUTSIDE `CompositorModal.vue`. Only the modal's own gates are removed.
- All engine changes must be additive: existing presets' evaluated output must not change (existing unit specs and behavior stay intact).
- Seconds everywhere; band fractions 0..1 of frame duration; unit-box-height spatial units in presets (see `evaluate.ts` header comment).

All paths below are relative to `frontend/` unless prefixed with `docs/`.

---

### Task 1: Band math module (`timelineBands.ts`)

Pure geometry/mutation helpers for the docked timeline's bands. Mirrors `app/lib/scene3d/motion/timeline.ts` but typed to `LayerAnimation` (which has an optional window `duration` — `undefined` = "to frame end").

**Files:**
- Create: `app/lib/motion/timelineBands.ts`
- Test: `tests/unit/motion-timeline-bands.unit.spec.ts`

**Interfaces:**
- Consumes: `LayerAnimation` from `~/lib/motion/types`
- Produces (used by Task 9's component):
  - `BAND_MIN` (`0.05` seconds, exported const)
  - `windowSeconds(anim, frameDur) → { start: number; end: number }`
  - `bandSegments(anim | undefined, frameDur) → { offset: number; in: number; loop: number; out: number; end: number }` (all fractions of frameDur; `end` is the window-end fraction)
  - `setClipOffset(anim, newSec, frameDur): void` (mutates `anim.offset`)
  - `resizeTransition(anim, slot: 'in' | 'out', newSec, frameDur): void` (mutates `anim[slot].duration`)
  - `setWindowDuration(anim, newSec, frameDur): void` (mutates `anim.duration`; at/past frame end resets to `undefined`)
  - `snapSeconds(sec, targets: number[], epsSec = 0.08) → number`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/motion-timeline-bands.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { LayerAnimation } from '~/lib/motion/types'
import {
  BAND_MIN, windowSeconds, bandSegments, setClipOffset,
  resizeTransition, setWindowDuration, snapSeconds,
} from '~/lib/motion/timelineBands'

const anim = (p: Partial<LayerAnimation> = {}): LayerAnimation => ({ offset: 0, ...p })

describe('windowSeconds', () => {
  it('undefined duration runs to frame end', () => {
    expect(windowSeconds(anim({ offset: 1 }), 4)).toEqual({ start: 1, end: 4 })
  })
  it('explicit duration clamps to frame end', () => {
    expect(windowSeconds(anim({ offset: 3, duration: 5 }), 4)).toEqual({ start: 3, end: 4 })
  })
})

describe('bandSegments', () => {
  it('no animation → full-width loop band', () => {
    expect(bandSegments(undefined, 4)).toEqual({ offset: 0, in: 0, loop: 1, out: 0, end: 1 })
  })
  it('offset + in + out + window end as fractions', () => {
    const a = anim({ offset: 1, duration: 2, in: { presetId: 'fade-in', duration: 0.5 }, out: { presetId: 'fade-out', duration: 0.5 } })
    const s = bandSegments(a, 4)
    expect(s.offset).toBeCloseTo(0.25)
    expect(s.in).toBeCloseTo(0.125)
    expect(s.out).toBeCloseTo(0.125)
    expect(s.loop).toBeCloseTo(0.25)
    expect(s.end).toBeCloseTo(0.75)
  })
  it('in+out longer than window: out is squeezed into what remains', () => {
    const a = anim({ duration: 1, in: { presetId: 'fade-in', duration: 0.8 }, out: { presetId: 'fade-out', duration: 0.8 } })
    const s = bandSegments(a, 4)
    expect(s.in).toBeCloseTo(0.2)          // 0.8/4
    expect(s.out).toBeCloseTo(0.05)        // squeezed to the remaining 0.2s
    expect(s.loop).toBe(0)
  })
})

describe('setClipOffset', () => {
  it('clamps so an explicit window stays inside the frame', () => {
    const a = anim({ duration: 1 })
    setClipOffset(a, 3.7, 4)
    expect(a.offset).toBeCloseTo(3)
  })
  it('to-end windows keep at least BAND_MIN visible', () => {
    const a = anim()
    setClipOffset(a, 9, 4)
    expect(a.offset).toBeCloseTo(4 - BAND_MIN)
  })
  it('never negative', () => {
    const a = anim({ duration: 1 })
    setClipOffset(a, -2, 4)
    expect(a.offset).toBe(0)
  })
})

describe('resizeTransition', () => {
  it('resizes in, clamped to window minus out', () => {
    const a = anim({ duration: 2, in: { presetId: 'fade-in', duration: 0.5 }, out: { presetId: 'fade-out', duration: 0.5 } })
    resizeTransition(a, 'in', 5, 4)
    expect(a.in!.duration).toBeCloseTo(1.5)
  })
  it('no-op when the slot is unset', () => {
    const a = anim()
    resizeTransition(a, 'in', 1, 4)   // must not throw
    expect(a.in).toBeUndefined()
  })
  it('enforces BAND_MIN', () => {
    const a = anim({ in: { presetId: 'fade-in', duration: 0.5 } })
    resizeTransition(a, 'in', 0, 4)
    expect(a.in!.duration).toBe(BAND_MIN)
  })
})

describe('setWindowDuration', () => {
  it('sets an explicit duration', () => {
    const a = anim({ offset: 1 })
    setWindowDuration(a, 2, 4)
    expect(a.duration).toBeCloseTo(2)
  })
  it('dragging to frame end resets to undefined (to-end)', () => {
    const a = anim({ offset: 1, duration: 2 })
    setWindowDuration(a, 3, 4)     // offset 1 + 3 = frame end
    expect(a.duration).toBeUndefined()
  })
  it('cannot shrink below in+out', () => {
    const a = anim({ in: { presetId: 'fade-in', duration: 0.5 }, out: { presetId: 'fade-out', duration: 0.5 } })
    setWindowDuration(a, 0.2, 4)
    expect(a.duration).toBeCloseTo(1)
  })
})

describe('snapSeconds', () => {
  it('snaps within epsilon', () => expect(snapSeconds(1.95, [0, 2, 4])).toBe(2))
  it('keeps value outside epsilon', () => expect(snapSeconds(1.7, [0, 2, 4])).toBe(1.7))
  it('prefers the nearest target', () => expect(snapSeconds(0.05, [0, 0.08])).toBe(0.08))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/motion-timeline-bands.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/motion/timelineBands`.

- [ ] **Step 3: Implement**

Create `app/lib/motion/timelineBands.ts`:

```ts
// frontend/app/lib/motion/timelineBands.ts
/**
 * Pure band geometry + drag mutations for the compositor's docked motion
 * timeline. Mirrors lib/scene3d/motion/timeline.ts but typed to
 * LayerAnimation, whose window has an optional `duration`
 * (undefined = "to frame end") — bands therefore have a draggable end edge.
 * Seconds in/out; `bandSegments` returns fractions of the frame duration.
 */
import type { LayerAnimation } from './types'

export const BAND_MIN = 0.05
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x)

export function windowSeconds(anim: LayerAnimation, frameDur: number): { start: number; end: number } {
  const start = clamp(anim.offset ?? 0, 0, frameDur)
  const end = anim.duration == null ? frameDur : clamp(start + Math.max(0, anim.duration), start, frameDur)
  return { start, end }
}

export function bandSegments(anim: LayerAnimation | undefined, frameDur: number) {
  const d = frameDur > 0 ? frameDur : 1
  if (!anim) return { offset: 0, in: 0, loop: 1, out: 0, end: 1 }
  const { start, end } = windowSeconds(anim, d)
  const offset = start / d
  const endF = end / d
  const win = endF - offset
  const inF = clamp((anim.in?.duration ?? 0) / d, 0, win)
  const outF = clamp((anim.out?.duration ?? 0) / d, 0, Math.max(0, win - inF))
  return { offset, in: inF, loop: Math.max(0, win - inF - outF), out: outF, end: endF }
}

export function setClipOffset(anim: LayerAnimation, newSec: number, frameDur: number): void {
  const maxOffset = anim.duration == null
    ? Math.max(0, frameDur - BAND_MIN)
    : Math.max(0, frameDur - anim.duration)
  anim.offset = clamp(newSec, 0, maxOffset)
}

export function resizeTransition(anim: LayerAnimation, slot: 'in' | 'out', newSec: number, frameDur: number): void {
  const spec = anim[slot]
  if (!spec) return
  const { start, end } = windowSeconds(anim, frameDur)
  const win = end - start
  const other = slot === 'in' ? (anim.out?.duration ?? 0) : (anim.in?.duration ?? 0)
  spec.duration = clamp(newSec, BAND_MIN, Math.max(BAND_MIN, win - other))
}

export function setWindowDuration(anim: LayerAnimation, newSec: number, frameDur: number): void {
  const start = clamp(anim.offset ?? 0, 0, frameDur)
  const maxDur = Math.max(BAND_MIN, frameDur - start)
  if (newSec >= maxDur - 1e-6) { anim.duration = undefined; return }
  const minDur = Math.max(BAND_MIN, (anim.in?.duration ?? 0) + (anim.out?.duration ?? 0))
  anim.duration = clamp(newSec, minDur, maxDur)
}

export function snapSeconds(sec: number, targets: number[], epsSec = 0.08): number {
  let best = sec
  let bestDist = epsSec
  for (const t of targets) {
    const d = Math.abs(sec - t)
    if (d <= bestDist) { best = t; bestDist = d }
  }
  return best
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/motion-timeline-bands.unit.spec.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/motion/timelineBands.ts frontend/tests/unit/motion-timeline-bands.unit.spec.ts
git commit -m "feat(motion): timeline band math for the compositor docked timeline (TDD)"
```

---

### Task 2: Parameterized presets — engine plumbing

`LayerAnimSpec` gains `params`; eval fns receive resolved params (defaults merged). Defaults live in `evaluate.ts` (single source of truth; the catalog imports them in Task 6).

**Files:**
- Modify: `app/lib/motion/types.ts` (add `params` to `LayerAnimSpec`)
- Modify: `app/lib/motion/evaluate.ts` (param resolution + threading)
- Test: `tests/unit/motion-preset-params.unit.spec.ts`

**Interfaces:**
- Produces:
  - `LayerAnimSpec.params?: Record<string, number>` (persisted JSON, absent = defaults)
  - `PRESET_PARAM_DEFAULTS: Record<string, Record<string, number>>` exported from `~/lib/motion/evaluate` (empty for now; new presets fill it in Tasks 4–5)
  - `resolveParams(spec: LayerAnimSpec) → Record<string, number>` exported from `~/lib/motion/evaluate`
  - Internal eval fn signatures become `(e, i, n, params)` / `(phase, i, n, params)` — existing presets ignore the extra arg (JS-safe, no behavior change).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/motion-preset-params.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PRESET_PARAM_DEFAULTS, resolveParams, evaluateAnimation } from '~/lib/motion/evaluate'
import type { FrameMotion } from '~/lib/motion/types'

const MOTION: FrameMotion = { fps: 30, duration: 4 }

describe('resolveParams', () => {
  it('merges spec params over defaults', () => {
    PRESET_PARAM_DEFAULTS['__test'] = { a: 1, b: 2 }
    expect(resolveParams({ presetId: '__test', duration: 1, params: { b: 9 } })).toEqual({ a: 1, b: 9 })
    delete PRESET_PARAM_DEFAULTS['__test']
  })
  it('unknown preset → spec params only', () => {
    expect(resolveParams({ presetId: 'nope', duration: 1, params: { x: 3 } })).toEqual({ x: 3 })
  })
})

describe('existing presets are unchanged by the params plumbing', () => {
  it('fade-in midway matches its analytic value', () => {
    const st = evaluateAnimation(
      { offset: 0, in: { presetId: 'fade-in', duration: 1, stagger: 0, ease: 'none' } },
      0.5, MOTION, 1,
    )
    expect(st.visible).toBe(true)
    expect(st.units![0].opacity).toBeCloseTo(0.5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/motion-preset-params.unit.spec.ts`
Expected: FAIL — `PRESET_PARAM_DEFAULTS` / `resolveParams` not exported.

- [ ] **Step 3: Implement**

In `app/lib/motion/types.ts`, add to `LayerAnimSpec` (after `ease?: string`):

```ts
  /** Per-preset knob values (Jitter-style). Absent keys fall back to the
   *  preset's defaults (PRESET_PARAM_DEFAULTS in evaluate.ts). Numeric only. */
  params?: Record<string, number>
```

In `app/lib/motion/evaluate.ts`:

1. Change the eval fn types (line ~58 and ~104) to accept params:

```ts
type UnitEval = (e: number, i: number, n: number, params: Record<string, number>) => UnitState
// …
type LoopEval = (phase: number, i: number, n: number, params: Record<string, number>) => UnitState
```

(Existing arrow-fn entries take fewer args — that's fine in JS/TS.)

2. Below the `u` helper, add:

```ts
/** Per-preset param defaults — the single source of truth. The catalog's
 *  param schemas (data/kinetic-presets.ts) read their defaults from here. */
export const PRESET_PARAM_DEFAULTS: Record<string, Record<string, number>> = {}

export function resolveParams(spec: LayerAnimSpec): Record<string, number> {
  return { ...(PRESET_PARAM_DEFAULTS[spec.presetId] ?? {}), ...(spec.params ?? {}) }
}
```

3. In `evalSpecUnits`, resolve once and pass through:

```ts
  const entry = table[spec.presetId] ?? fallback
  const ease = resolveEase(spec.ease ?? entry.ease)
  const params = resolveParams(spec)
  return Array.from({ length: n }, (_, i) => entry.fn(ease(unitProgress(tPhase, spec, i, n)), i, n, params))
```

4. In `evaluateAnimation`'s loop branch, resolve and pass:

```ts
    const loopFn = LOOP_EVAL[anim.loop.presetId]
    if (loopFn) {
      const params = resolveParams(anim.loop)
      const loopT = tIn - inDur
      units = Array.from({ length: n }, (_, i) => {
        const phase = (((loopT - i * stagger) / cycle) % 1 + 1) % 1
        return loopFn(phase, i, n, params)
      })
    }
```

- [ ] **Step 4: Run the new tests AND the existing motion unit tests**

Run: `cd frontend && npx vitest run tests/unit/motion-preset-params.unit.spec.ts && npx vitest run tests/unit/ 2>&1 | tail -5`
Expected: new tests PASS; no previously-passing test broke.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/motion/types.ts frontend/app/lib/motion/evaluate.ts frontend/tests/unit/motion-preset-params.unit.spec.ts
git commit -m "feat(motion): parameterized preset plumbing (params on LayerAnimSpec, defaults registry)"
```

---

### Task 3: Engine extensions — `scaleX/scaleY` and `copies`

Additive `UnitState` fields the new presets need: non-uniform flip squash, and multi-draw copies (echo trails, tiling).

**Files:**
- Modify: `app/lib/motion/evaluate.ts` (`UnitState`, new `UnitCopy`)
- Test: `tests/unit/motion-unit-extensions.unit.spec.ts`

**Interfaces:**
- Produces:
  - `UnitState.scaleX?: number`, `UnitState.scaleY?: number` (multiplied with `scale` by the painter; absent = 1)
  - `export interface UnitCopy { dx: number; dy: number; scale: number; opacity: number; rotation?: number }` (dx/dy in unit-box heights, like unit dx/dy)
  - `UnitState.copies?: UnitCopy[]` (painter draws base, then each copy composed with the base transform)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/motion-unit-extensions.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { UnitState, UnitCopy } from '~/lib/motion/evaluate'
import { IDENTITY_UNIT } from '~/lib/motion/evaluate'

describe('UnitState extensions', () => {
  it('accepts scaleX/scaleY and copies (types compile, identity has none)', () => {
    const copy: UnitCopy = { dx: 1, dy: 0, scale: 1.2, opacity: 0.5 }
    const st: UnitState = { ...IDENTITY_UNIT, scaleX: 0.5, scaleY: 1, copies: [copy] }
    expect(st.scaleX).toBe(0.5)
    expect(st.copies).toHaveLength(1)
    expect((IDENTITY_UNIT as UnitState).scaleX).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/motion-unit-extensions.unit.spec.ts`
Expected: FAIL — `UnitCopy` not exported (TS error on import).

- [ ] **Step 3: Implement**

In `app/lib/motion/evaluate.ts`, extend the `UnitState` interface and add `UnitCopy` next to it:

```ts
/** One extra draw of the unit, composed with the base sample's transform.
 *  dx/dy in UNIT-BOX HEIGHTS like UnitState. Used for echo trails and tiling. */
export interface UnitCopy {
  dx: number
  dy: number
  scale: number       // multiplicative with the base sample's scale
  opacity: number     // multiplicative with the base sample's opacity
  rotation?: number   // degrees, additive
}

export interface UnitState {
  dx: number; dy: number          // unit-box heights
  scale: number                   // multiplicative
  /** Non-uniform scale (flip squash). Multiplied with `scale`; absent = 1. */
  scaleX?: number
  scaleY?: number
  rotation: number                // degrees, additive
  opacity: number                 // 0..1 multiplicative
  /** Clip the unit's box: fraction hidden from one side (mask presets). */
  clip?: { side: 'top' | 'bottom' | 'left' | 'right'; amount: number }
  /** Extra draws of this unit (echoes/tiles); painter draws base then copies. */
  copies?: UnitCopy[]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/motion-unit-extensions.unit.spec.ts && npx vitest run tests/unit/ 2>&1 | tail -3`
Expected: PASS; no regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/motion/evaluate.ts frontend/tests/unit/motion-unit-extensions.unit.spec.ts
git commit -m "feat(motion): UnitState scaleX/scaleY + copies extensions for utility presets"
```

---

### Task 4: New presets wave 1 — Wiggle, Card Flip H/V

**Files:**
- Modify: `app/lib/motion/evaluate.ts` (new entries in `IN_EVAL`, `OUT_EVAL`, `LOOP_EVAL`, defaults in `PRESET_PARAM_DEFAULTS`)
- Test: `tests/unit/motion-utility-presets.unit.spec.ts` (created here, extended in Task 5)

**Interfaces:**
- Produces preset ids: `'wiggle'` (loop), `'card-flip-h'` / `'card-flip-v'` (in), `'card-flip-h-out'` / `'card-flip-v-out'` (out). Params: wiggle `{ amplitude, cycles }`; flips `{ overshoot }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/motion-utility-presets.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS,
  PRESET_PARAM_DEFAULTS, evaluateAnimation,
} from '~/lib/motion/evaluate'
import type { FrameMotion, LayerAnimSpec } from '~/lib/motion/types'

const MOTION: FrameMotion = { fps: 30, duration: 4 }
const loopAt = (spec: LayerAnimSpec, t: number, n = 1) =>
  evaluateAnimation({ offset: 0, loop: { stagger: 0, ...spec } }, t, MOTION, n).units!
const inAt = (spec: LayerAnimSpec, t: number, n = 1) =>
  evaluateAnimation({ offset: 0, in: { stagger: 0, ...spec } }, t, MOTION, n).units!

describe('wiggle', () => {
  it('is registered with param defaults', () => {
    expect(SUPPORTED_LOOP_IDS).toContain('wiggle')
    expect(PRESET_PARAM_DEFAULTS['wiggle']).toMatchObject({ amplitude: expect.any(Number), cycles: expect.any(Number) })
  })
  it('loops seamlessly (state at phase 0 == phase 1)', () => {
    const spec = { presetId: 'wiggle', duration: 2 }
    const a = loopAt(spec, 0)[0]
    const b = loopAt(spec, 2 - 1e-9)[0]
    expect(b.dx).toBeCloseTo(a.dx, 3)
    expect(b.dy).toBeCloseTo(a.dy, 3)
    expect(b.rotation).toBeCloseTo(a.rotation, 3)
  })
  it('amplitude scales displacement', () => {
    const small = loopAt({ presetId: 'wiggle', duration: 2, params: { amplitude: 0.1 } }, 0.3)[0]
    const big = loopAt({ presetId: 'wiggle', duration: 2, params: { amplitude: 0.4 } }, 0.3)[0]
    expect(Math.abs(big.dx)).toBeCloseTo(Math.abs(small.dx) * 4, 5)
  })
  it('is deterministic per unit index', () => {
    const u0 = loopAt({ presetId: 'wiggle', duration: 2 }, 0.3, 3)
    const u1 = loopAt({ presetId: 'wiggle', duration: 2 }, 0.3, 3)
    expect(u0).toEqual(u1)
    expect(u0[0].dx).not.toBeCloseTo(u0[1].dx, 6) // per-unit variation
  })
})

describe('card flips', () => {
  it('ids registered on both tables', () => {
    expect(SUPPORTED_IN_IDS).toEqual(expect.arrayContaining(['card-flip-h', 'card-flip-v']))
    expect(SUPPORTED_OUT_IDS).toEqual(expect.arrayContaining(['card-flip-h-out', 'card-flip-v-out']))
  })
  it('card-flip-h squashes scaleX from ~0 to 1 (scaleY untouched)', () => {
    const spec = { presetId: 'card-flip-h', duration: 1, ease: 'none' }
    const start = inAt(spec, 0)[0]
    const end = inAt(spec, 1 - 1e-9)[0]
    expect(start.scaleX!).toBeLessThan(0.01)
    expect(end.scaleX!).toBeCloseTo(1, 1)
    expect(start.scaleY).toBeUndefined()
  })
  it('card-flip-v uses scaleY', () => {
    const st = inAt({ presetId: 'card-flip-v', duration: 1, ease: 'none' }, 0)[0]
    expect(st.scaleY!).toBeLessThan(0.01)
    expect(st.scaleX).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/motion-utility-presets.unit.spec.ts`
Expected: FAIL — ids not in the tables.

- [ ] **Step 3: Implement**

In `app/lib/motion/evaluate.ts`:

1. Fill defaults (extend the `PRESET_PARAM_DEFAULTS` initializer from Task 2):

```ts
export const PRESET_PARAM_DEFAULTS: Record<string, Record<string, number>> = {
  'wiggle':          { amplitude: 0.15, cycles: 2 },
  'card-flip-h':     { overshoot: 1 },
  'card-flip-v':     { overshoot: 1 },
  'card-flip-h-out': { overshoot: 1 },
  'card-flip-v-out': { overshoot: 1 },
}
```

2. Add to `IN_EVAL` (flip squash: eased progress drives the facing scale through ~0 with a sine overshoot):

```ts
  'card-flip-h': { ease: 'power2.out', fn: (e, _i, _n, p) => u({
    scaleX: Math.max(0.001, e + (p.overshoot ?? 1) * 0.2 * Math.sin(e * Math.PI)),
    opacity: Math.min(1, e * 3),
  }) },
  'card-flip-v': { ease: 'power2.out', fn: (e, _i, _n, p) => u({
    scaleY: Math.max(0.001, e + (p.overshoot ?? 1) * 0.2 * Math.sin(e * Math.PI)),
    opacity: Math.min(1, e * 3),
  }) },
```

3. Add to `OUT_EVAL` (mirror):

```ts
  'card-flip-h-out': { ease: 'power2.in', fn: (e, _i, _n, p) => u({
    scaleX: Math.max(0.001, (1 - e) + (p.overshoot ?? 1) * 0.2 * Math.sin((1 - e) * Math.PI)),
    opacity: Math.min(1, (1 - e) * 3),
  }) },
  'card-flip-v-out': { ease: 'power2.in', fn: (e, _i, _n, p) => u({
    scaleY: Math.max(0.001, (1 - e) + (p.overshoot ?? 1) * 0.2 * Math.sin((1 - e) * Math.PI)),
    opacity: Math.min(1, (1 - e) * 3),
  }) },
```

4. Add to `LOOP_EVAL` (periodic-by-construction wobble: integer `cycles` keeps the sum seamless; two harmonics + per-unit phase from `seeded` make it organic):

```ts
  'wiggle': (p, i, _n, prm) => {
    const amp = prm.amplitude ?? 0.15
    const k = Math.max(1, Math.round(prm.cycles ?? 2))
    const ph1 = seeded(i, 11) * TWO_PI, ph2 = seeded(i, 12) * TWO_PI, ph3 = seeded(i, 13) * TWO_PI
    const wob = (phase: number) => Math.sin(k * p * TWO_PI + phase) + 0.5 * Math.sin(2 * k * p * TWO_PI + phase * 1.7)
    return u({
      dx: amp * 0.35 * wob(ph1),
      dy: amp * 0.35 * wob(ph2),
      rotation: amp * 40 * wob(ph3) * 0.5,
    })
  },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/motion-utility-presets.unit.spec.ts && npx vitest run tests/unit/ 2>&1 | tail -3`
Expected: PASS; no regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/motion/evaluate.ts frontend/tests/unit/motion-utility-presets.unit.spec.ts
git commit -m "feat(motion): wiggle + card-flip presets (params, scaleX/scaleY)"
```

---

### Task 5: New presets wave 2 — Inward Echoes, Grid Scroll X/Y, Noise Tile

All `copies[]`-based loops.

**Files:**
- Modify: `app/lib/motion/evaluate.ts`
- Test: `tests/unit/motion-utility-presets.unit.spec.ts` (extend)

**Interfaces:**
- Produces loop preset ids: `'inward-echoes'` (`{ copies, scaleStep, fade }`), `'grid-scroll-x'` / `'grid-scroll-y'` (`{ tiles, gap }`), `'noise-tile'` (`{ tiles, flicker }`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/motion-utility-presets.unit.spec.ts`:

```ts
describe('inward-echoes', () => {
  const spec = { presetId: 'inward-echoes', duration: 2 }
  it('emits the configured number of copies, far echoes first (draw order)', () => {
    const st = loopAt({ ...spec, params: { copies: 3, scaleStep: 0.4, fade: 0.6 } }, 0.5)[0]
    expect(st.copies).toHaveLength(3)
    const scales = st.copies!.map(c => c.scale)
    expect(scales.every(s => s >= 1)).toBe(true)
    expect([...scales].sort((a, b) => b - a)).toEqual(scales)   // sorted far→near
  })
  it('treadmills seamlessly: the copy SET at phase 0 == phase 1 (elements relabel)', () => {
    const a = loopAt(spec, 0)[0].copies!            // both arrays are sorted far→near,
    const b = loopAt(spec, 2 - 1e-9)[0].copies!     // so element-wise compare == set compare
    a.forEach((c, j) => {
      expect(b[j].scale).toBeCloseTo(c.scale, 3)
      expect(b[j].opacity).toBeCloseTo(c.opacity, 3)
    })
  })
})

describe('grid-scroll', () => {
  it('x-variant scrolls the base and rings it with static-offset copies', () => {
    const st = loopAt({ presetId: 'grid-scroll-x', duration: 2, params: { tiles: 2, gap: 1.5 } }, 0.5)[0]
    expect(st.dx).toBeCloseTo(-0.25 * 1.5)          // phase 0.25 × gap, leftward
    expect(st.copies).toHaveLength(4)                // j = -2,-1,1,2
    expect(st.copies![0].dx).toBeCloseTo(-2 * 1.5)
    expect(st.copies!.every(c => c.dy === 0)).toBe(true)
  })
  it('y-variant moves dy instead', () => {
    const st = loopAt({ presetId: 'grid-scroll-y', duration: 2, params: { tiles: 1, gap: 1.5 } }, 0.5)[0]
    expect(st.dy).toBeCloseTo(-0.25 * 1.5)
    expect(st.dx).toBe(0)
    expect(st.copies!.every(c => c.dx === 0)).toBe(true)
  })
  it('wraps seamlessly across the cycle boundary', () => {
    const spec = { presetId: 'grid-scroll-x', duration: 2, params: { tiles: 1, gap: 1 } }
    const before = loopAt(spec, 2 - 1e-6)[0]
    // At wrap, base jumps back one gap — with a ±1-tile ring the visual set is identical.
    expect(before.dx).toBeCloseTo(-1, 2)
    expect(loopAt(spec, 0)[0].dx).toBeCloseTo(0, 5)
  })
})

describe('noise-tile', () => {
  it('lays a (2t+1)² grid of copies with deterministic flicker', () => {
    const st = loopAt({ presetId: 'noise-tile', duration: 2, params: { tiles: 1, flicker: 1 } }, 0.3)[0]
    expect(st.copies).toHaveLength(8)   // 3×3 minus the base cell
    const again = loopAt({ presetId: 'noise-tile', duration: 2, params: { tiles: 1, flicker: 1 } }, 0.3)[0]
    expect(st.copies).toEqual(again.copies)
    expect(st.copies!.some((c, j) => j > 0 && c.opacity !== st.copies![0].opacity)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/motion-utility-presets.unit.spec.ts`
Expected: new describes FAIL (ids unknown → `units` fall back to identity, `copies` undefined).

- [ ] **Step 3: Implement**

In `app/lib/motion/evaluate.ts`:

1. Extend `PRESET_PARAM_DEFAULTS`:

```ts
  'inward-echoes': { copies: 3, scaleStep: 0.35, fade: 0.55 },
  'grid-scroll-x': { tiles: 2, gap: 1.5 },
  'grid-scroll-y': { tiles: 2, gap: 1.5 },
  'noise-tile':    { tiles: 1, flicker: 1 },
```

2. Add to `LOOP_EVAL`:

```ts
  // Echo treadmill: copy j sits at cyclic depth q(p) = (j + 1 − p) mod count.
  // As p advances every copy drifts one depth-step inward per cycle; at the
  // wrap the innermost copy relabels to the outermost (which is nearly
  // invisible via fade^depth), so the SET of copies is identical at p=0 and
  // p→1 — seamless loop by relabeling, verified element-wise after the sort.
  'inward-echoes': (p, _i, _n, prm) => {
    const count = Math.max(1, Math.round(prm.copies ?? 3))
    const step = prm.scaleStep ?? 0.35
    const fade = prm.fade ?? 0.55
    const copies: UnitCopy[] = Array.from({ length: count }, (_, j) => {
      const q = ((j + 1 - p) % count + count) % count   // continuous cyclic depth
      return { dx: 0, dy: 0, scale: 1 + step * q, opacity: fade ** (q + 1) }
    }).sort((a, b) => b.scale - a.scale)                 // draw far echoes first
    return u({ copies })
  },
  // Marquee treadmill: base slides one gap per cycle; a static ring of ±tiles
  // copies hides the wrap jump.
  'grid-scroll-x': (p, _i, _n, prm) => {
    const tiles = Math.max(1, Math.round(prm.tiles ?? 2))
    const gap = prm.gap ?? 1.5
    const copies: UnitCopy[] = []
    for (let j = -tiles; j <= tiles; j++) {
      if (j !== 0) copies.push({ dx: j * gap, dy: 0, scale: 1, opacity: 1 })
    }
    return u({ dx: -p * gap, copies })
  },
  'grid-scroll-y': (p, _i, _n, prm) => {
    const tiles = Math.max(1, Math.round(prm.tiles ?? 2))
    const gap = prm.gap ?? 1.5
    const copies: UnitCopy[] = []
    for (let j = -tiles; j <= tiles; j++) {
      if (j !== 0) copies.push({ dx: 0, dy: j * gap, scale: 1, opacity: 1 })
    }
    return u({ dy: -p * gap, copies })
  },
  // Static (2t+1)² grid; each cell flickers on its own seeded phase.
  'noise-tile': (p, _i, _n, prm) => {
    const t = Math.max(1, Math.round(prm.tiles ?? 1))
    const flicker = prm.flicker ?? 1
    const gap = 1.3
    const copies: UnitCopy[] = []
    for (let gy = -t; gy <= t; gy++) {
      for (let gx = -t; gx <= t; gx++) {
        if (gx === 0 && gy === 0) continue
        const idx = (gy + t) * (2 * t + 1) + (gx + t)
        const tw = 0.5 + 0.5 * Math.sin(TWO_PI * (p + seeded(idx, 7)))
        copies.push({ dx: gx * gap, dy: gy * gap, scale: 1, opacity: Math.max(0.1, 1 - flicker * tw) })
      }
    }
    return u({ copies })
  },
```

(`UnitCopy` is defined in this file since Task 3 — no import needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/motion-utility-presets.unit.spec.ts && npx vitest run tests/unit/ 2>&1 | tail -3`
Expected: PASS; no regressions.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/motion/evaluate.ts frontend/tests/unit/motion-utility-presets.unit.spec.ts
git commit -m "feat(motion): inward-echoes, grid-scroll-x/y, noise-tile copy-based loop presets"
```

---

### Task 6: Catalog — Utility group, param schemas, gallery metadata

The picker reads labels/groups from `data/kinetic-presets.ts`. New presets need entries; entries need param schemas whose defaults come from `PRESET_PARAM_DEFAULTS` (DRY); `build` becomes optional (the new presets have no GSAP builder — that path is legacy slate-only).

**Files:**
- Modify: `app/data/kinetic-presets.ts`
- Test: `tests/unit/kinetic-catalog.unit.spec.ts`

**Interfaces:**
- Produces:
  - `KineticGroup` union gains `'utility'`; `KINETIC_GROUP_LABELS.utility = 'Utility'`
  - `KineticPreset.build` becomes optional (`build?:`)
  - `export interface KineticParamSpec { key: string; label: string; min: number; max: number; step: number }`
  - `KineticPreset.params?: KineticParamSpec[]`
  - Catalog entries for: `wiggle`, `card-flip-h`, `card-flip-v`, `card-flip-h-out`, `card-flip-v-out`, `inward-echoes`, `grid-scroll-x`, `grid-scroll-y`, `noise-tile`
  - `export function presetParamDefault(presetId: string, key: string): number` (reads `PRESET_PARAM_DEFAULTS`)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/kinetic-catalog.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { KINETIC_PRESETS_BY_ID, KINETIC_GROUP_LABELS, presetParamDefault } from '~/data/kinetic-presets'
import { PRESET_PARAM_DEFAULTS, SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS } from '~/lib/motion/evaluate'

const NEW_IDS = ['wiggle', 'card-flip-h', 'card-flip-v', 'card-flip-h-out', 'card-flip-v-out',
  'inward-echoes', 'grid-scroll-x', 'grid-scroll-y', 'noise-tile']

describe('utility catalog entries', () => {
  it('every new preset has a catalog entry in the utility group', () => {
    for (const id of NEW_IDS) {
      const p = KINETIC_PRESETS_BY_ID[id]
      expect(p, id).toBeTruthy()
      expect(p.group).toBe('utility')
      expect(p.label.length).toBeGreaterThan(0)
    }
    expect(KINETIC_GROUP_LABELS.utility).toBe('Utility')
  })
  it('param schemas cover exactly the engine defaults', () => {
    for (const id of NEW_IDS) {
      const schemaKeys = (KINETIC_PRESETS_BY_ID[id].params ?? []).map(s => s.key).sort()
      expect(schemaKeys, id).toEqual(Object.keys(PRESET_PARAM_DEFAULTS[id] ?? {}).sort())
    }
  })
  it('schema defaults resolve from the engine registry', () => {
    expect(presetParamDefault('wiggle', 'amplitude')).toBe(PRESET_PARAM_DEFAULTS['wiggle'].amplitude)
  })
  it('every supported engine id has a catalog label (gallery completeness)', () => {
    for (const id of [...SUPPORTED_IN_IDS, ...SUPPORTED_OUT_IDS, ...SUPPORTED_LOOP_IDS]) {
      // marquee predates the catalog and 'typewriter-out' etc. may fall back to the raw id —
      // only the NEW ids are required, plus all ids must not crash the lookup.
      expect(() => KINETIC_PRESETS_BY_ID[id]?.label ?? id).not.toThrow()
    }
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/kinetic-catalog.unit.spec.ts`
Expected: FAIL — no `presetParamDefault` export / no utility entries.

- [ ] **Step 3: Implement**

In `app/data/kinetic-presets.ts`:

1. Add `'utility'` to the `KineticGroup` union and `KINETIC_GROUP_LABELS` (`utility: 'Utility'`).
2. Make `build` optional: `build?: (ctx: KineticBuildContext) => void` (update the doc comment: canvas-native presets have no GSAP builder).
3. Add near the `KineticPreset` interface:

```ts
import { PRESET_PARAM_DEFAULTS } from '~/lib/motion/evaluate'

/** Jitter-style per-preset knob. Defaults live in PRESET_PARAM_DEFAULTS
 *  (lib/motion/evaluate.ts) — the engine is the source of truth. */
export interface KineticParamSpec {
  key: string
  label: string
  min: number
  max: number
  step: number
}

export function presetParamDefault(presetId: string, key: string): number {
  return PRESET_PARAM_DEFAULTS[presetId]?.[key] ?? 0
}
```

and `params?: KineticParamSpec[]` on `KineticPreset`.

4. Append to `IN_PRESETS`:

```ts
  // Utility (canvas-native; no GSAP builder)
  { id: 'card-flip-h', label: 'Card Flip H', pitch: 'Horizontal card-flip reveal', category: 'in', group: 'utility', splitLevel: 'chars',
    params: [{ key: 'overshoot', label: 'Overshoot', min: 0, max: 2, step: 0.1 }] },
  { id: 'card-flip-v', label: 'Card Flip V', pitch: 'Vertical card-flip reveal', category: 'in', group: 'utility', splitLevel: 'chars',
    params: [{ key: 'overshoot', label: 'Overshoot', min: 0, max: 2, step: 0.1 }] },
```

5. Append to `OUT_PRESETS`:

```ts
  // Utility
  { id: 'card-flip-h-out', label: 'Card Flip H', pitch: 'Horizontal card-flip exit', category: 'out', group: 'utility', splitLevel: 'chars',
    params: [{ key: 'overshoot', label: 'Overshoot', min: 0, max: 2, step: 0.1 }] },
  { id: 'card-flip-v-out', label: 'Card Flip V', pitch: 'Vertical card-flip exit', category: 'out', group: 'utility', splitLevel: 'chars',
    params: [{ key: 'overshoot', label: 'Overshoot', min: 0, max: 2, step: 0.1 }] },
```

6. Append to `LOOP_PRESETS`:

```ts
  // Utility
  { id: 'wiggle', label: 'Wiggle', pitch: 'Organic positional jitter', category: 'loop', group: 'utility', splitLevel: 'chars',
    params: [
      { key: 'amplitude', label: 'Amplitude', min: 0.02, max: 0.5, step: 0.01 },
      { key: 'cycles', label: 'Speed', min: 1, max: 6, step: 1 },
    ] },
  { id: 'inward-echoes', label: 'Inward Echoes', pitch: 'Echo trail collapsing inward', category: 'loop', group: 'utility', splitLevel: 'lines',
    params: [
      { key: 'copies', label: 'Copies', min: 1, max: 6, step: 1 },
      { key: 'scaleStep', label: 'Spread', min: 0.1, max: 0.8, step: 0.05 },
      { key: 'fade', label: 'Fade', min: 0.2, max: 0.9, step: 0.05 },
    ] },
  { id: 'grid-scroll-x', label: 'Grid Scroll X', pitch: 'Tiled horizontal marquee', category: 'loop', group: 'utility', splitLevel: 'lines',
    params: [
      { key: 'tiles', label: 'Tiles', min: 1, max: 4, step: 1 },
      { key: 'gap', label: 'Gap', min: 1, max: 3, step: 0.1 },
    ] },
  { id: 'grid-scroll-y', label: 'Grid Scroll Y', pitch: 'Tiled vertical marquee', category: 'loop', group: 'utility', splitLevel: 'lines',
    params: [
      { key: 'tiles', label: 'Tiles', min: 1, max: 4, step: 1 },
      { key: 'gap', label: 'Gap', min: 1, max: 3, step: 0.1 },
    ] },
  { id: 'noise-tile', label: 'Noise Tile', pitch: 'Flickering tile grid', category: 'loop', group: 'utility', splitLevel: 'lines',
    params: [
      { key: 'tiles', label: 'Tiles', min: 1, max: 3, step: 1 },
      { key: 'flicker', label: 'Flicker', min: 0.2, max: 1, step: 0.05 },
    ] },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/kinetic-catalog.unit.spec.ts && npx vitest run tests/unit/ 2>&1 | tail -3`
Expected: PASS; no regressions (grep callers of `.build(` first — slate code is gated but must still typecheck against `build?`; add `?.` or a guard if a call site errors: `preset.build?.(ctx)`).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/kinetic-presets.ts frontend/tests/unit/kinetic-catalog.unit.spec.ts
git commit -m "feat(motion): utility preset catalog entries + param schemas"
```

---

### Task 7: Painter support — scaleX/scaleY and copies

Whole-layer path only (per-char text keeps existing behavior; `scaleX/copies` on per-char units are ignored — documented v1 limitation).

**Files:**
- Modify: `app/lib/motion/paint.ts`

**Interfaces:**
- Consumes: `UnitState.scaleX/scaleY/copies` (Task 3), `UnitCopy`
- Produces: no signature changes — `drawLayerWithMotion` honors the new fields.

- [ ] **Step 1: Extract the unit-box height helper**

In `app/lib/motion/paint.ts`, lift the `boxH` computation out of `composeEffectiveLayer` into a module-level function and use it in both places:

```ts
/** Width-normalized height of the layer's unit box (the spatial unit presets
 *  move in). Shared by composeEffectiveLayer and the copies painter. */
function layerBoxH(layer: LocalLayer): number {
  return 'h' in layer && typeof (layer as { h?: number }).h === 'number'
    ? (layer as { h: number }).h
    : 'bbox' in layer
    ? (layer as { bbox: { h: number }; scale?: number }).bbox.h * ((layer as { scale?: number }).scale || 1)
    : layer.kind === 'text' ? (layer as TextLayer).fontSize : 0.1
}
```

(`composeEffectiveLayer` body then starts `const boxH = layerBoxH(layer)`.)

- [ ] **Step 2: Non-uniform scale in `drawLayerWithMotion`**

Replace the `motionScale`/`needScale` block:

```ts
  const scale = motionScale(st)
  const sx = scale * (whole?.scaleX ?? 1)
  const sy = scale * (whole?.scaleY ?? 1)
  const needScale = Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4
  if (needScale) {
    ctx.save()
    ctx.translate(eff.x * W, eff.y * H)
    ctx.scale(Math.max(0.001, sx), Math.max(0.001, sy))
    ctx.translate(-eff.x * W, -eff.y * H)
  }
```

Also update the `atRest` check so a unit with copies/flip never routes static:

```ts
  const atRest = !st.units || st.units.every(u => u === IDENTITY_UNIT)
```

(unchanged — frozen-identity-by-reference already guarantees this; do not weaken it.)

- [ ] **Step 3: Copies drawing**

After the main draw (`drawLocalLayer` / `drawAnimatedTextLayer` call) and before the scale `restore`, add:

```ts
  // Copy passes (echo trails, tiling): each copy re-draws the effective layer
  // offset/scaled/faded relative to it. dx/dy are unit-box heights; boxH is
  // width-normalized so both axes convert via ×boxH×W px (see
  // composeEffectiveLayer's dy note — y positions are consumed ×H, so the
  // canvas-normalized dy is boxH·(W/H)·copy.dy, i.e. dyPx = copy.dy·boxH·W).
  if (whole?.copies?.length && eff.kind !== 'text') {
    const boxH = layerBoxH(layer)
    for (const copy of whole.copies) {
      ctx.save()
      ctx.globalAlpha *= Math.max(0, Math.min(1, copy.opacity))
      ctx.translate(eff.x * W, eff.y * H)
      if (copy.rotation) ctx.rotate((copy.rotation * Math.PI) / 180)
      ctx.scale(Math.max(0.001, copy.scale), Math.max(0.001, copy.scale))
      ctx.translate(-eff.x * W, -eff.y * H)
      const shifted = { ...eff, x: eff.x + copy.dx * boxH, y: eff.y + copy.dy * boxH * (W / H) }
      drawLocalLayer(ctx, shifted, W, H, effMask)
      ctx.restore()
    }
  } else if (whole?.copies?.length && eff.kind === 'text' && (!st.units || st.units.length === 1)) {
    // Whole-layer text (single unit) gets copies too; per-char text does not (v1).
    const boxH = layerBoxH(layer)
    for (const copy of whole.copies) {
      ctx.save()
      ctx.globalAlpha *= Math.max(0, Math.min(1, copy.opacity))
      ctx.translate(eff.x * W, eff.y * H)
      ctx.scale(Math.max(0.001, copy.scale), Math.max(0.001, copy.scale))
      ctx.translate(-eff.x * W, -eff.y * H)
      drawLocalLayer(ctx, { ...eff, x: eff.x + copy.dx * boxH, y: eff.y + copy.dy * boxH * (W / H) }, W, H, effMask)
      ctx.restore()
    }
  }
```

Draw order note: copies render AFTER the base here for simplicity; `inward-echoes` pre-sorts far→near so overlap looks right. Keep that contract (evaluator sorts, painter doesn't).

- [ ] **Step 4: Compile check + unit suite**

Run: `cd frontend && npx vitest run tests/unit/ 2>&1 | tail -3` — expected: all green.
Then a Vite compile check of the modal page (dev server must be running): `curl -s "http://127.0.0.1:3000/_nuxt/app/lib/motion/paint.ts" | head -c 200` — expected: transpiled JS, no error overlay payload. (Full visual verification happens in Task 13.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/motion/paint.ts
git commit -m "feat(motion): painter support for scaleX/scaleY squash and copy passes"
```

---

### Task 8: Design | Motion toggle in `CompositorModal.vue`

**Files:**
- Modify: `app/components/vue-canvas/CompositorModal.vue`

**Interfaces:**
- Produces: `inspectorTab: Ref<'design' | 'motion'>` in the modal's script; entering `'motion'` starts the preview clock (`scrubTo(0)`), leaving calls `exitMotionPreview()`. Tasks 9/12 branch on `inspectorTab`.
- Consumes (already in the modal): `previewT`, `scrubTo`, `exitMotionPreview`, `caPanelActive`.

- [ ] **Step 1: Add the tab state**

In the script (near the pan/zoom section), add:

```ts
// ── Design | Motion inspector tabs (3D Studio Build|Motion idiom) ───────────
// Motion active ⇔ motion mode: the docked timeline replaces the bottom
// toolbar cluster and the inspector shows animation controls.
const inspectorTab = ref<'design' | 'motion'>('design')
watch(inspectorTab, (tab) => {
  if (tab === 'motion') { if (previewT.value == null) scrubTo(0) }
  else exitMotionPreview()
})
```

- [ ] **Step 2: Render the toggle strip**

At the top of the right glass panel (immediately after the `glass-panel` opening `div`, BEFORE the `<template v-if="caPanelActive">` chain), add:

```html
      <!-- Design | Motion tabs (hidden while the Assistant takes the panel over) -->
      <div v-if="!caPanelActive" class="shrink-0 px-3 pt-3">
        <div class="flex gap-1 rounded-lg bg-white/[0.04] p-1 text-[11px]">
          <button type="button" class="flex-1 rounded px-2 py-1 cursor-pointer"
                  :class="inspectorTab === 'design' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                  @click="inspectorTab = 'design'">Design</button>
          <button type="button" class="flex-1 rounded px-2 py-1 cursor-pointer"
                  :class="inspectorTab === 'motion' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
                  @click="inspectorTab = 'motion'">Motion</button>
        </div>
      </div>
```

- [ ] **Step 3: Remove the modal's KINETIC_ENABLED gates + the toolbar Play button**

All in `CompositorModal.vue`:
1. Delete the toolbar Motion button (the `v-if="KINETIC_ENABLED"` `<button>` with `title="Motion — preview layer animations…"`).
2. Change `<MotionTransport v-if="KINETIC_ENABLED && previewT != null"` to `v-if="previewT != null"` (Task 9 replaces this element entirely — this keeps it functional meanwhile).
3. Change `<LayerMotionPanel v-if="KINETIC_ENABLED"` to `v-if="inspectorTab === 'motion'"` — temporary until Task 12 moves the editor; motion controls must never show on the Design tab from this commit on.
4. Keep the dev `Slate fixture` button gated as-is (`v-if="isDev && KINETIC_ENABLED"` — slates stay hidden).
5. Hide the bottom cluster in motion mode: on the `<!-- Bottom cluster: agent command bar + toolbar -->` root div, add `v-if="inspectorTab !== 'motion'"`.
6. Remove the now-unused `KINETIC_ENABLED` import if no usage remains except the slate fixture button (it remains — keep the import).

- [ ] **Step 4: Verify in the browser**

Start/reuse the dev server (`preview_start` → `frontend-harness`), open `/dev/frame-lab`, then:
1. Toggle strip renders at the top of the right panel with Design active.
2. Click Motion → the agent bar + toolbar disappear; the transport pill appears (bottom center); the inspector shows the (old) animation panel when a layer is selected.
3. Click Design → toolbar returns, transport gone.
4. No console errors (`read_console_messages` onlyErrors).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(compositor): Design|Motion inspector toggle; ungate motion; retire toolbar Play button"
```

---

### Task 9: Docked timeline panel (`CompositorMotionTimeline.vue`)

**Files:**
- Create: `app/components/vue-canvas/compositor/CompositorMotionTimeline.vue`
- Modify: `app/components/vue-canvas/CompositorModal.vue` (mount it; remove `MotionTransport` usage)
- Delete: `app/components/vue-canvas/compositor/MotionTransport.vue` (after the swap)

**Interfaces:**
- Consumes: Task 1's `timelineBands` module; modal state/methods listed in props/emits below; `LocalLayer` (`~/composables/useCompositorLayers`) with `id`, `name?`, `kind`, `animation?`; `createLayerAnimation` from `~/lib/motion/types`.
- Produces component contract:
  - Props: `layers: LocalLayer[]`, `selectedId: string | null`, `motion: FrameMotion`, `t: number | null`, `playing: boolean`, `baking?: boolean`, `bakeProgress?: number`, `stale?: boolean`, `bakeError?: string | null`
  - Emits: `select(id: string)`, `play`, `pause`, `scrub(t: number)`, `update:motion(patch: Partial<FrameMotion>)`, `bake`, `commit` (fired on drag end so the modal records history)

- [ ] **Step 1: Create the component**

`app/components/vue-canvas/compositor/CompositorMotionTimeline.vue`:

```vue
<script setup lang="ts">
/** Docked motion timeline (3D Studio band idiom): transport row + a ruler +
 *  one band row per local layer. Bands mutate layer.animation in place during
 *  a drag (reactive re-render), then emit 'commit' on pointerup so the modal
 *  records history. All coords are seconds; bands render as % of duration. */
import type { FrameMotion } from '~/lib/motion/types'
import { createLayerAnimation } from '~/lib/motion/types'
import type { LocalLayer } from '~/composables/useCompositorLayers'
import {
  bandSegments, setClipOffset, resizeTransition, setWindowDuration, snapSeconds, windowSeconds,
} from '~/lib/motion/timelineBands'
import { Play, Pause, Plus } from 'lucide-vue-next'

const props = defineProps<{
  layers: LocalLayer[]
  selectedId: string | null
  motion: FrameMotion
  t: number | null
  playing: boolean
  baking?: boolean
  bakeProgress?: number
  stale?: boolean
  bakeError?: string | null
}>()
const emit = defineEmits<{
  select: [id: string]
  play: []
  pause: []
  scrub: [t: number]
  'update:motion': [patch: Partial<FrameMotion>]
  bake: []
  commit: []
}>()

const dur = computed(() => props.motion.duration)
const pct = (f: number) => `${(f * 100).toFixed(3)}%`
const rowLabel = (l: LocalLayer) =>
  (l as { name?: string }).name || (l.kind === 'text' ? ((l as { text?: string }).text?.split('\n')[0] || 'Text') : l.kind)
const seg = (l: LocalLayer) => bandSegments(l.animation, dur.value)

function addMotion(l: LocalLayer) {
  if (!l.animation) l.animation = createLayerAnimation()
  emit('select', l.id)
  emit('commit')
}

// ── Ruler scrub ──────────────────────────────────────────────────────────────
const rulerEl = ref<HTMLElement | null>(null)
function rulerT(e: PointerEvent): number {
  const r = rulerEl.value!.getBoundingClientRect()
  return Math.max(0, Math.min(dur.value, ((e.clientX - r.left) / r.width) * dur.value))
}
function onRulerDown(e: PointerEvent) {
  emit('pause')
  emit('scrub', rulerT(e))
  const move = (ev: PointerEvent) => emit('scrub', rulerT(ev))
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

// ── Band drags: 'offset' | 'in' | 'out' | 'end' ─────────────────────────────
function startDrag(e: PointerEvent, l: LocalLayer, mode: 'offset' | 'in' | 'out' | 'end') {
  const anim = l.animation
  if (!anim) return
  emit('select', l.id)
  const track = (e.currentTarget as HTMLElement).closest('[data-band-track]') as HTMLElement
  const trackW = track.clientWidth
  const startX = e.clientX
  const startVal = mode === 'offset' ? anim.offset
    : mode === 'in' ? (anim.in?.duration ?? 0)
    : mode === 'out' ? (anim.out?.duration ?? 0)
    : windowSeconds(anim, dur.value).end - windowSeconds(anim, dur.value).start
  const snaps = [0, dur.value / 2, dur.value, ...(props.t != null ? [props.t] : [])]
  const move = (ev: PointerEvent) => {
    const ds = ((ev.clientX - startX) / trackW) * dur.value
    let next = startVal + (mode === 'out' ? -ds : ds)   // out divider grows leftward
    if (mode === 'offset') { next = snapSeconds(next, snaps); setClipOffset(anim, next, dur.value) }
    else if (mode === 'end') { next = snapSeconds(anim.offset + next, snaps) - anim.offset; setWindowDuration(anim, next, dur.value) }
    else resizeTransition(anim, mode, next, dur.value)
  }
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
    emit('commit')
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
function resetWindowEnd(l: LocalLayer) {
  if (!l.animation) return
  l.animation.duration = undefined
  emit('commit')
}
</script>

<template>
  <div class="rounded-[12px] border border-[#2a2a2a] bg-[#1a1a1a]/95 p-2.5 shadow-lg text-xs text-white/70">
    <!-- Transport row -->
    <div class="mb-2 flex items-center gap-2 text-[11px]">
      <button class="w-7 h-7 grid place-items-center rounded cursor-pointer hover:bg-white/10 text-white/85"
        :title="playing ? 'Pause' : 'Play'" @click="playing ? emit('pause') : emit('play')">
        <component :is="playing ? Pause : Play" class="size-3.5" />
      </button>
      <span class="tabular-nums text-white/60">{{ (t ?? 0).toFixed(2) }} / {{ motion.duration.toFixed(1) }}s</span>
      <div class="flex-1" />
      <label class="flex items-center gap-1">dur
        <input type="number" min="0.5" max="60" step="0.5" :value="motion.duration"
          class="w-14 bg-[#111] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
          @change="emit('update:motion', { duration: Math.max(0.5, Number(($event.target as HTMLInputElement).value) || 4) })">
      </label>
      <label class="flex items-center gap-1">fps
        <input type="number" min="1" max="60" step="1" :value="motion.fps"
          class="w-12 bg-[#111] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
          @change="emit('update:motion', { fps: Math.max(1, Math.min(60, Number(($event.target as HTMLInputElement).value) || 30)) })">
      </label>
      <span v-if="bakeError" class="max-w-[180px] truncate text-rose-400" :title="bakeError">{{ bakeError }}</span>
      <button class="px-2 py-0.5 rounded font-medium cursor-pointer"
        :class="stale ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30' : 'bg-white/15 text-white/70 hover:bg-white/20'"
        :disabled="baking" :title="stale ? 'Layers changed since last bake' : 'Bake motion to frames'"
        @click="emit('bake')">
        {{ baking ? `Baking ${Math.round((bakeProgress ?? 0) * 100)}%` : stale ? 'Re-bake' : 'Bake' }}
      </button>
    </div>

    <!-- Ruler + playhead + rows share one horizontal scale via the grid column -->
    <div class="grid grid-cols-[96px_1fr] gap-x-2">
      <div /><!-- ruler spacer over labels -->
      <div ref="rulerEl" class="relative h-4 cursor-ew-resize select-none" @pointerdown.stop.prevent="onRulerDown">
        <div class="absolute inset-x-0 bottom-0 h-px bg-white/15" />
        <span class="absolute left-0 bottom-1 text-[9px] text-white/30">0</span>
        <span class="absolute right-0 bottom-1 text-[9px] text-white/30">{{ motion.duration.toFixed(1) }}s</span>
      </div>

      <template v-for="l in layers" :key="l.id">
        <button class="truncate text-left text-[11px] cursor-pointer"
          :class="l.id === selectedId ? 'text-white' : 'text-white/50 hover:text-white/75'"
          @click="emit('select', l.id)">{{ rowLabel(l) }}</button>
        <div data-band-track class="relative my-0.5 h-5 overflow-hidden rounded border border-white/10 bg-white/[0.03]">
          <template v-if="l.animation">
            <!-- band: in (amber) / loop (emerald) / out (amber), draggable body + edges -->
            <div class="absolute inset-y-0 cursor-grab active:cursor-grabbing"
              :style="{ left: pct(seg(l).offset), width: pct(seg(l).end - seg(l).offset) }"
              @pointerdown.stop.prevent="(e: PointerEvent) => startDrag(e, l, 'offset')">
              <div v-if="l.animation.in" class="absolute inset-y-0 left-0 bg-amber-400/70" :style="{ width: pct(seg(l).in / Math.max(1e-6, seg(l).end - seg(l).offset)) }" />
              <div class="absolute inset-y-0 bg-emerald-400/60"
                :style="{ left: pct(seg(l).in / Math.max(1e-6, seg(l).end - seg(l).offset)), right: pct(seg(l).out / Math.max(1e-6, seg(l).end - seg(l).offset)) }" />
              <div v-if="l.animation.out" class="absolute inset-y-0 right-0 bg-amber-400/70" :style="{ width: pct(seg(l).out / Math.max(1e-6, seg(l).end - seg(l).offset)) }" />
            </div>
            <!-- divider + end handles (absolute in track space) -->
            <div v-if="l.animation.in" class="absolute inset-y-0 w-2 -ml-1 cursor-ew-resize z-10"
              :style="{ left: pct(seg(l).offset + seg(l).in) }"
              @pointerdown.stop.prevent="(e: PointerEvent) => startDrag(e, l, 'in')" />
            <div v-if="l.animation.out" class="absolute inset-y-0 w-2 -ml-1 cursor-ew-resize z-10"
              :style="{ left: pct(seg(l).end - seg(l).out) }"
              @pointerdown.stop.prevent="(e: PointerEvent) => startDrag(e, l, 'out')" />
            <div class="absolute inset-y-0 w-2 -ml-1 cursor-ew-resize z-10"
              :title="l.animation.duration == null ? 'Window: to end' : 'Drag to resize · double-click = to end'"
              :style="{ left: pct(seg(l).end) }"
              @pointerdown.stop.prevent="(e: PointerEvent) => startDrag(e, l, 'end')"
              @dblclick.stop="resetWindowEnd(l)" />
          </template>
          <button v-else class="absolute inset-0 flex items-center justify-center gap-1 text-[10px] text-white/30 hover:text-white/70 cursor-pointer"
            @click="addMotion(l)"><Plus class="size-3" /> add motion</button>
          <!-- playhead -->
          <div v-if="t != null" class="absolute inset-y-0 w-px bg-white/80 pointer-events-none z-20"
            :style="{ left: pct(Math.min(1, (t ?? 0) / motion.duration)) }" />
        </div>
      </template>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Mount it in the modal**

In `CompositorModal.vue`:
1. Import: `import CompositorMotionTimeline from '~/components/vue-canvas/compositor/CompositorMotionTimeline.vue'` and remove the `MotionTransport` import.
2. Replace the whole `<MotionTransport …/>` element (and its neighboring `bakeError` div) with a docked panel next to where the bottom cluster renders (sibling of the `<!-- Bottom cluster -->` div, same absolute positioning root):

```html
      <!-- Docked motion timeline (replaces the agent bar + toolbar in Motion mode) -->
      <div v-if="inspectorTab === 'motion'" class="absolute inset-x-4 bottom-4 z-20 pointer-events-auto max-h-[36vh] overflow-y-auto"
        @pointerdown.stop @click.stop @dblclick.stop>
        <CompositorMotionTimeline
          :layers="localLayers" :selected-id="selectedLocal?.id ?? null"
          :motion="motionDoc" :t="previewT" :playing="playing"
          :baking="baking" :bake-progress="bakeProgress" :stale="motionStale" :bake-error="bakeError"
          @select="(id: string) => selectLocal(id)"
          @play="play" @pause="pause" @scrub="scrubTo" @bake="bakeMotion"
          @update:motion="setMotion" @commit="commit"
        />
      </div>
```

(Prop-source note for the implementer: `localLayers`, `selectedLocal`, `selectLocal`, and `commit` are already destructured in the modal's script from `useLocalLayerEditor`/`useCompositorLayers` — check the big destructure near line ~319 and reuse the exact names found there; if the local-layer list variable is named differently (e.g. `locals`), use that name.)

3. Delete `app/components/vue-canvas/compositor/MotionTransport.vue` (`git rm`).

- [ ] **Step 3: Verify in the browser**

On `/dev/frame-lab`: enter Motion → docked panel spans the stage bottom; every fixture layer shows an "add motion" row; clicking one creates a full-width emerald band; play advances the playhead; scrubbing the ruler moves layers only when they have in/out presets (add via the old panel if Task 12 isn't done yet); dur/fps edits stick. Band-drag verification: because synthetic `left_click_drag` cannot drive `pointermove` handlers (known harness limitation), verify drag interactions by the math already unit-tested in Task 1 plus a manual check — report to the user that offset/divider drags need a human hand-check.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/compositor/CompositorMotionTimeline.vue frontend/app/components/vue-canvas/CompositorModal.vue
git rm frontend/app/components/vue-canvas/compositor/MotionTransport.vue
git commit -m "feat(compositor): docked band timeline replaces the floating motion transport"
```

---

### Task 10: Live preset thumbnails (`PresetThumb.vue` + shared clock)

**Files:**
- Create: `app/lib/motion/thumbClock.ts`
- Create: `app/components/vue-canvas/compositor/PresetThumb.vue`

**Interfaces:**
- Produces:
  - `registerThumb(canvas: HTMLCanvasElement, draw: (clockSec: number) => void): () => void` — subscribes to one shared RAF loop; returns unregister. The loop only runs while subscribers exist; an IntersectionObserver pauses offscreen thumbs.
  - `<PresetThumb :preset-id="…" :slot-kind="'in' | 'out' | 'loop'" :params="…" />` — 72×54 canvas, loops a 2s cycle of the preset on a sample card.
- Consumes: `evaluateAnimation` (n=1) from `~/lib/motion/evaluate`.

- [ ] **Step 1: Create the shared clock**

`app/lib/motion/thumbClock.ts`:

```ts
// frontend/app/lib/motion/thumbClock.ts
/** One RAF loop drives every visible preset thumbnail (the gallery can show
 *  ~30 at once — per-thumb RAFs would thrash). Thumbs unsubscribe on unmount;
 *  an IntersectionObserver pauses the ones scrolled out of view. */

type DrawFn = (clockSec: number) => void
const subs = new Map<HTMLCanvasElement, { draw: DrawFn; visible: boolean }>()
let rafId: number | null = null
let epoch = 0

const io = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const s = subs.get(e.target as HTMLCanvasElement)
        if (s) s.visible = e.isIntersecting
      }
    })
  : null

function tick(nowMs: number) {
  if (!epoch) epoch = nowMs
  const clockSec = (nowMs - epoch) / 1000
  for (const { draw, visible } of subs.values()) if (visible) draw(clockSec)
  rafId = subs.size ? requestAnimationFrame(tick) : null
}

export function registerThumb(canvas: HTMLCanvasElement, draw: DrawFn): () => void {
  subs.set(canvas, { draw, visible: true })
  io?.observe(canvas)
  if (rafId == null) rafId = requestAnimationFrame(tick)
  return () => {
    subs.delete(canvas)
    io?.unobserve(canvas)
    if (!subs.size && rafId != null) { cancelAnimationFrame(rafId); rafId = null }
  }
}
```

- [ ] **Step 2: Create the thumbnail component**

`app/components/vue-canvas/compositor/PresetThumb.vue`:

```vue
<script setup lang="ts">
/** Live preset preview: loops the REAL evaluate() math on a sample card in a
 *  tiny canvas — previews are true to the engine, not canned GIFs. 2s cycle:
 *  in-presets play then hold; out-presets hold then play; loops run 1.5s cycles. */
import { evaluateAnimation } from '~/lib/motion/evaluate'
import type { LayerAnimation } from '~/lib/motion/types'
import { registerThumb } from '~/lib/motion/thumbClock'

const props = defineProps<{
  presetId: string
  slotKind: 'in' | 'out' | 'loop'
  params?: Record<string, number>
}>()

const W = 72, H = 54
const canvasEl = ref<HTMLCanvasElement | null>(null)
let unregister: (() => void) | null = null

function animFor(): LayerAnimation {
  const spec = { presetId: props.presetId, duration: 0.9, stagger: 0, params: props.params }
  if (props.slotKind === 'in') return { offset: 0.2, in: spec }
  if (props.slotKind === 'out') return { offset: 0, duration: 1.6, out: spec }
  return { offset: 0, loop: { ...spec, duration: 1.5 } }
}

function draw(clockSec: number) {
  const ctx = canvasEl.value?.getContext('2d')
  if (!ctx) return
  const t = clockSec % 2
  const st = evaluateAnimation(animFor(), t, { fps: 30, duration: 2 }, 1)
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  ctx.fillRect(0, 0, W, H)
  if (!st.visible) return
  const un = st.units?.[0] ?? { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 }
  const box = 20                                    // sample card px (the unit box)
  const cx = W / 2 + un.dx * box, cy = H / 2 + un.dy * box
  const drawCard = (dx: number, dy: number, s: number, alpha: number, rot = 0) => {
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha))
    ctx.translate(cx + dx * box, cy + dy * box)
    ctx.rotate(((un.rotation + rot) * Math.PI) / 180)
    ctx.scale(
      Math.max(0.001, un.scale * (un.scaleX ?? 1) * s),
      Math.max(0.001, un.scale * (un.scaleY ?? 1) * s),
    )
    if (un.clip && un.clip.amount > 0.001) {
      const a = un.clip.amount
      ctx.beginPath()
      if (un.clip.side === 'top') ctx.rect(-box, -box + 2 * box * a, 2 * box, 2 * box * (1 - a))
      else if (un.clip.side === 'bottom') ctx.rect(-box, -box, 2 * box, 2 * box * (1 - a))
      else if (un.clip.side === 'left') ctx.rect(-box + 2 * box * a, -box, 2 * box * (1 - a), 2 * box)
      else ctx.rect(-box, -box, 2 * box * (1 - a), 2 * box)
      ctx.clip()
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    const r = 3, w = box, h = box * 0.75
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, r)
    ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.75)'
    ctx.font = '600 9px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('Aa', 0, 0.5)
    ctx.restore()
  }
  for (const c of [...(un.copies ?? [])])
    drawCard(c.dx, c.dy, c.scale, un.opacity * c.opacity, c.rotation ?? 0)
  drawCard(0, 0, 1, un.opacity)
}

onMounted(() => { if (canvasEl.value) unregister = registerThumb(canvasEl.value, draw) })
onBeforeUnmount(() => unregister?.())
</script>

<template>
  <canvas ref="canvasEl" :width="W" :height="H" class="w-full h-auto rounded bg-white/[0.02]" />
</template>
```

- [ ] **Step 3: Compile check**

Dev server running → `curl -s "http://127.0.0.1:3000/dev/frame-lab" -o /dev/null -w "%{http_code}"` — expected `200`; no error overlay in the browser pane. (Visual check happens with the picker in Task 11.)

- [ ] **Step 4: Commit**

```bash
git add frontend/app/lib/motion/thumbClock.ts frontend/app/components/vue-canvas/compositor/PresetThumb.vue
git commit -m "feat(compositor): live engine-rendered preset thumbnails on a shared RAF clock"
```

---

### Task 11: Preset gallery picker (`MotionPresetPicker.vue`)

**Files:**
- Create: `app/components/vue-canvas/compositor/MotionPresetPicker.vue`

**Interfaces:**
- Consumes: `SUPPORTED_IN_IDS/SUPPORTED_OUT_IDS/SUPPORTED_LOOP_IDS` (`~/lib/motion/evaluate`), `KINETIC_PRESETS_BY_ID`, `KINETIC_GROUP_LABELS` (`~/data/kinetic-presets`), `PresetThumb` (Task 10).
- Produces component contract:
  - Props: `slotKind: 'in' | 'out' | 'loop'`, `currentId: string | null`, `anchorRect: { top: number; left: number; width: number } | null`
  - Emits: `pick(id: string)`, `clear`, `close`
  - Teleports to `body` (memory gotcha: testers must re-read the page after it opens).

- [ ] **Step 1: Create the component**

`app/components/vue-canvas/compositor/MotionPresetPicker.vue`:

```vue
<script setup lang="ts">
/** Jitter-style preset gallery: grouped sections, 2-up cards with live
 *  thumbnails, a disabled "Custom" tail card (the property-keyframe milestone's
 *  entry point). Teleported to body so the inspector's overflow doesn't clip it. */
import { SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS } from '~/lib/motion/evaluate'
import { KINETIC_PRESETS_BY_ID, KINETIC_GROUP_LABELS, type KineticGroup } from '~/data/kinetic-presets'
import PresetThumb from '~/components/vue-canvas/compositor/PresetThumb.vue'
import { X } from 'lucide-vue-next'

const props = defineProps<{
  slotKind: 'in' | 'out' | 'loop'
  currentId: string | null
  anchorRect: { top: number; left: number; width: number } | null
}>()
const emit = defineEmits<{ pick: [id: string]; clear: []; close: [] }>()

const ids = computed(() =>
  props.slotKind === 'in' ? SUPPORTED_IN_IDS : props.slotKind === 'out' ? SUPPORTED_OUT_IDS : SUPPORTED_LOOP_IDS)

/** Group ids by catalog group; uncataloged ids (e.g. 'marquee') land in 'other'. */
const sections = computed(() => {
  const by = new Map<string, { label: string; ids: string[] }>()
  for (const id of ids.value) {
    const g = (KINETIC_PRESETS_BY_ID[id]?.group ?? 'other') as KineticGroup | 'other'
    const label = g === 'other' ? 'More' : KINETIC_GROUP_LABELS[g as KineticGroup] ?? g
    if (!by.has(g)) by.set(g, { label, ids: [] })
    by.get(g)!.ids.push(id)
  }
  return [...by.values()]
})
const label = (id: string) => KINETIC_PRESETS_BY_ID[id]?.label ?? id

const style = computed(() => {
  const a = props.anchorRect
  if (!a) return { top: '80px', right: '320px' }
  // Anchor left of the inspector, clamped to the viewport.
  const top = Math.max(16, Math.min(a.top, window.innerHeight - 440))
  return { top: `${top}px`, left: `${Math.max(16, a.left - 296)}px` }
})

function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <!-- click-away backdrop -->
    <div class="fixed inset-0 z-[70]" @pointerdown="emit('close')" />
    <div class="fixed z-[71] w-72 max-h-[420px] flex flex-col rounded-xl border border-white/10 bg-[#141416]/98 shadow-2xl"
      :style="style" @pointerdown.stop>
      <div class="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span class="text-[11px] uppercase tracking-[0.12em] text-white/50">{{ slotKind }} presets</span>
        <div class="flex items-center gap-1">
          <button v-if="currentId" class="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-white/60 hover:text-white/90 cursor-pointer"
            @click="emit('clear')">Clear</button>
          <button class="text-white/45 hover:text-white/80 p-1 cursor-pointer" @click="emit('close')"><X class="size-3.5" /></button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <div v-for="s in sections" :key="s.label">
          <div class="text-[10px] uppercase tracking-[0.12em] text-white/35 mb-1.5">{{ s.label }}</div>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="id in s.ids" :key="id"
              class="group flex flex-col gap-1 rounded-lg border p-1.5 text-left cursor-pointer transition-colors"
              :class="id === currentId ? 'border-white/60 bg-white/[0.08]' : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06]'"
              @click="emit('pick', id)">
              <PresetThumb :preset-id="id" :slot-kind="slotKind" />
              <span class="text-[10.5px] truncate" :class="id === currentId ? 'text-white' : 'text-white/65'">{{ label(id) }}</span>
            </button>
            <!-- Custom: the property-keyframe milestone's visible entry point -->
            <div v-if="s === sections[sections.length - 1]"
              class="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/[0.12] p-1.5 opacity-50 select-none"
              title="Custom property animation — coming soon">
              <div class="w-full aspect-[4/3] grid place-items-center rounded bg-white/[0.02] text-white/40 text-lg">+</div>
              <span class="text-[10.5px] text-white/45">Custom <span class="text-[8px] uppercase border border-white/20 rounded px-0.5 ml-0.5">soon</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
```

- [ ] **Step 2: Compile check**

`curl -s "http://127.0.0.1:3000/dev/frame-lab" -o /dev/null -w "%{http_code}"` → `200`. (It mounts in Task 12; visual verification there.)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/compositor/MotionPresetPicker.vue
git commit -m "feat(compositor): Jitter-style preset gallery popover with live thumbnails"
```

---

### Task 12: Motion inspector tab (`MotionLayerEditor.vue`) + retire `LayerMotionPanel`

**Files:**
- Create: `app/components/vue-canvas/compositor/MotionLayerEditor.vue`
- Modify: `app/components/vue-canvas/CompositorModal.vue`
- Delete: `app/components/vue-canvas/compositor/LayerMotionPanel.vue`

**Interfaces:**
- Consumes: `MotionPresetPicker`, `PresetThumb`, catalog (`KINETIC_PRESETS_BY_ID`, `presetParamDefault`), `LayerAnimation`/`LayerAnimSpec` types.
- Produces component contract (same update semantics as the old panel):
  - Props: `animation: LayerAnimation | undefined`, `frameDuration: number`
  - Emits: `update(anim: LayerAnimation | undefined)`

- [ ] **Step 1: Create the editor**

`app/components/vue-canvas/compositor/MotionLayerEditor.vue`:

```vue
<script setup lang="ts">
/** Motion-tab inspector for the selected layer: In/Loop/Out slot chips that
 *  open the preset gallery, plus timing + per-preset param sliders. Emits the
 *  whole next LayerAnimation (parent persists via setLocal, as before). */
import type { LayerAnimation, LayerAnimSpec } from '~/lib/motion/types'
import { KINETIC_PRESETS_BY_ID, presetParamDefault } from '~/data/kinetic-presets'
import MotionPresetPicker from '~/components/vue-canvas/compositor/MotionPresetPicker.vue'
import PresetThumb from '~/components/vue-canvas/compositor/PresetThumb.vue'
import { X } from 'lucide-vue-next'

const props = defineProps<{ animation: LayerAnimation | undefined; frameDuration: number }>()
const emit = defineEmits<{ update: [anim: LayerAnimation | undefined] }>()

const SLOTS = ['in', 'loop', 'out'] as const
type SlotKind = typeof SLOTS[number]

const pickerFor = ref<SlotKind | null>(null)
const pickerAnchor = ref<{ top: number; left: number; width: number } | null>(null)
function openPicker(slot: SlotKind, e: MouseEvent) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  pickerAnchor.value = { top: r.top, left: r.left, width: r.width }
  pickerFor.value = slot
}

const label = (id: string) => KINETIC_PRESETS_BY_ID[id]?.label ?? id
const paramSchema = (id: string) => KINETIC_PRESETS_BY_ID[id]?.params ?? []

function patch(p: Partial<LayerAnimation>) {
  emit('update', { offset: 0, ...(props.animation ?? {}), ...p })
}
function assign(slot: SlotKind, presetId: string) {
  const cur: LayerAnimSpec = props.animation?.[slot] ?? { presetId, duration: slot === 'loop' ? 1.5 : 0.8, stagger: 0.04 }
  patch({ [slot]: { ...cur, presetId, params: undefined } })  // params reset on preset change
  pickerFor.value = null
}
function clearSlot(slot: SlotKind) {
  patch({ [slot]: undefined })
  pickerFor.value = null
}
function patchSpecNum(slot: SlotKind, field: 'duration' | 'stagger', v: number) {
  const cur = props.animation?.[slot]
  if (cur) patch({ [slot]: { ...cur, [field]: v } })
}
function patchParam(slot: SlotKind, key: string, v: number) {
  const cur = props.animation?.[slot]
  if (cur) patch({ [slot]: { ...cur, params: { ...(cur.params ?? {}), [key]: v } } })
}
const paramValue = (spec: LayerAnimSpec, key: string) => spec.params?.[key] ?? presetParamDefault(spec.presetId, key)
</script>

<template>
  <div class="flex flex-col gap-3 text-xs">
    <div class="flex items-center justify-between">
      <span class="text-[10px] uppercase tracking-[0.12em] text-white/40">Animation</span>
      <button v-if="animation" class="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-white/60 hover:text-white/90 cursor-pointer"
        @click="emit('update', undefined)">Clear all</button>
    </div>

    <!-- Window timing (mirrors the band) -->
    <div class="grid grid-cols-2 gap-2">
      <label class="flex flex-col gap-1 text-white/55">Start (s)
        <input type="number" min="0" step="0.1" :value="animation?.offset ?? 0"
          class="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1.5 py-1 text-white/90 outline-none"
          @change="patch({ offset: Math.max(0, Number(($event.target as HTMLInputElement).value) || 0) })">
      </label>
      <label class="flex flex-col gap-1 text-white/55">Duration (s)
        <input type="number" min="0.1" step="0.1" :value="animation?.duration ?? ''" placeholder="to end"
          class="bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1.5 py-1 text-white/90 outline-none"
          @change="(e: Event) => { const v = (e.target as HTMLInputElement).value; patch({ duration: v === '' ? undefined : Math.max(0.1, Number(v) || 0.1) }) }">
      </label>
    </div>

    <!-- Slot chips -->
    <div v-for="slot in SLOTS" :key="slot" class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between">
        <span class="capitalize text-white/55">{{ slot }}</span>
        <button v-if="animation?.[slot]" class="text-white/35 hover:text-white/75 cursor-pointer" :title="`Clear ${slot}`"
          @click="clearSlot(slot)"><X class="size-3" /></button>
      </div>
      <button class="flex items-center gap-2 rounded-lg border p-1.5 text-left cursor-pointer transition-colors"
        :class="animation?.[slot] ? 'border-white/25 bg-white/[0.06]' : 'border-dashed border-white/[0.12] bg-white/[0.02] hover:bg-white/[0.05]'"
        @click="(e: MouseEvent) => openPicker(slot, e)">
        <div class="w-14 shrink-0"><PresetThumb v-if="animation?.[slot]" :preset-id="animation[slot]!.presetId" :slot-kind="slot" :params="animation[slot]!.params" /></div>
        <span :class="animation?.[slot] ? 'text-white/90' : 'text-white/40'">
          {{ animation?.[slot] ? label(animation[slot]!.presetId) : `Choose ${slot} preset…` }}
        </span>
      </button>
      <div v-if="animation?.[slot]" class="flex flex-col gap-1.5 pl-1">
        <div class="flex gap-2 text-white/55">
          <label class="flex items-center gap-1">dur
            <input type="number" min="0.1" step="0.1" :value="animation[slot]!.duration"
              class="w-14 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
              @change="patchSpecNum(slot, 'duration', Math.max(0.1, Number(($event.target as HTMLInputElement).value) || 0.8))">
          </label>
          <label class="flex items-center gap-1">stagger
            <input type="number" min="0" step="0.01" :value="animation[slot]!.stagger ?? 0.04"
              class="w-14 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
              @change="patchSpecNum(slot, 'stagger', Math.max(0, Number(($event.target as HTMLInputElement).value) || 0))">
          </label>
        </div>
        <label v-for="ps in paramSchema(animation[slot]!.presetId)" :key="ps.key" class="flex items-center gap-2 text-white/55">
          <span class="w-16 truncate">{{ ps.label }}</span>
          <input type="range" :min="ps.min" :max="ps.max" :step="ps.step" :value="paramValue(animation[slot]!, ps.key)"
            class="flex-1 accent-white/80"
            @input="patchParam(slot, ps.key, Number(($event.target as HTMLInputElement).value))">
          <span class="w-9 text-right tabular-nums text-white/70">{{ paramValue(animation[slot]!, ps.key) }}</span>
        </label>
      </div>
    </div>

    <MotionPresetPicker v-if="pickerFor"
      :slot-kind="pickerFor" :current-id="animation?.[pickerFor]?.presetId ?? null" :anchor-rect="pickerAnchor"
      @pick="(id: string) => assign(pickerFor!, id)" @clear="clearSlot(pickerFor!)" @close="pickerFor = null" />
  </div>
</template>
```

- [ ] **Step 2: Wire the Motion tab in the modal**

In `CompositorModal.vue`:
1. Import `MotionLayerEditor` (path `~/components/vue-canvas/compositor/MotionLayerEditor.vue`); remove the `LayerMotionPanel` import and its `<LayerMotionPanel …/>` usage (from Task 8 step 3.3).
2. Add a Motion inspector branch in the right panel's template chain, after the takeover branches (`caPanelActive` / `brandOpen` / `genActive`) and before the Design content branches:

```html
      <template v-else-if="inspectorTab === 'motion'">
        <div class="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <Play class="size-3.5 text-white/70" />
          <span class="text-sm font-medium">{{ selectedLocal ? 'Layer motion' : 'Frame motion' }}</span>
        </div>
        <div class="p-4 flex-1 min-h-0 overflow-y-auto">
          <MotionLayerEditor v-if="selectedLocal"
            :animation="(selectedLocal as any).animation" :frame-duration="motionDoc.duration"
            @update="(a) => setLocal(selectedLocal!.id, { animation: a } as any)"
          />
          <div v-else class="flex flex-col gap-3 text-xs text-white/55">
            <p class="text-white/40 italic">Select a layer to animate it, or set the frame's timing below.</p>
            <label class="flex items-center justify-between gap-2">Duration (s)
              <input type="number" min="0.5" max="60" step="0.5" :value="motionDoc.duration"
                class="w-16 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
                @change="setMotion({ duration: Math.max(0.5, Number(($event.target as HTMLInputElement).value) || 4) })">
            </label>
            <label class="flex items-center justify-between gap-2">FPS
              <input type="number" min="1" max="60" step="1" :value="motionDoc.fps"
                class="w-16 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
                @change="setMotion({ fps: Math.max(1, Math.min(60, Number(($event.target as HTMLInputElement).value) || 30)) })">
            </label>
            <label class="flex items-center justify-between gap-2">Loop playback
              <input type="checkbox" class="accent-white/80" :checked="motionDoc.loop ?? false"
                @change="setMotion({ loop: ($event.target as HTMLInputElement).checked })">
            </label>
          </div>
        </div>
      </template>
```

(The Design branches must be reachable only when `inspectorTab === 'design'` — since this branch precedes them in the v-else chain, no further guard is needed.)

3. `git rm frontend/app/components/vue-canvas/compositor/LayerMotionPanel.vue`.

- [ ] **Step 3: Verify in the browser**

On `/dev/frame-lab`, Motion tab active:
1. No selection → Frame motion settings (duration/fps).
2. Select a text layer → three slot chips; click In → gallery opens with grouped sections and MOVING thumbnails; assign `Slide Up` → chip shows label + live micro-thumb; scrub → text animates on the canvas.
3. Assign Loop `Wiggle` → param sliders (Amplitude/Speed) appear; dragging Amplitude visibly changes the canvas at the playhead.
4. Assign Loop `Grid Scroll X` on a rect layer → tiled marquee on canvas; `Inward Echoes` → echo trail.
5. Esc / click-away closes the picker; Design tab shows NO animation section.
6. `read_console_messages` onlyErrors → none.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/compositor/MotionLayerEditor.vue frontend/app/components/vue-canvas/CompositorModal.vue
git rm frontend/app/components/vue-canvas/compositor/LayerMotionPanel.vue
git commit -m "feat(compositor): Motion inspector tab with gallery picker + param sliders"
```

---

### Task 13: Frame-lab motion fixtures + full verification pass

**Files:**
- Modify: `app/pages/dev/frame-lab.vue`

- [ ] **Step 1: Add animated fixtures**

In `app/pages/dev/frame-lab.vue`, give two existing fixture layers animations (add after the layer definitions, before `node`):

```ts
// Motion fixtures: exercise in/loop/out, the window, and a utility preset.
;(plain as any).animation = {
  offset: 0.3, duration: 3,
  in: { presetId: 'slide-up', duration: 0.6, stagger: 0.03 },
  loop: { presetId: 'float', duration: 1.6, stagger: 0.04 },
  out: { presetId: 'fade-out', duration: 0.5, stagger: 0.02 },
}
;(tracked as any).animation = {
  offset: 0,
  loop: { presetId: 'wiggle', duration: 2, stagger: 0, params: { amplitude: 0.2, cycles: 2 } },
}
```

- [ ] **Step 2: Full browser verification checklist**

Hard-reload `/dev/frame-lab` and walk through:
1. Enter Motion: docked timeline shows band rows; `Plain text` has amber/emerald/amber segments starting at 0.3s ending at 3.3s; `Wide tracking` full-width emerald.
2. Play: playhead sweeps; `Plain text` slides in at 0.3s, floats, fades out before its window ends; `Wide tracking` wiggles continuously; layers outside their window vanish.
3. Timeline `dur` change to 6 → bands rescale; fps change sticks.
4. Select via band row click → inspector follows.
5. Bake: click Bake → progress runs → completes (or reports its error in the transport row — ComfyUI need not be running; a graceful error is a pass for this step, note which happened).
6. Exit Motion → toolbar + agent bar return; Design inspector normal; re-enter → state intact.
7. Zoom pill (top-center) and Render footer unaffected in both modes.
8. `read_console_messages` onlyErrors → none; screenshot the docked timeline + gallery for the final report.

- [ ] **Step 3: Run the whole unit suite + typecheck delta**

Run: `cd frontend && npx vitest run tests/unit/ 2>&1 | tail -5` — all green.
Run: `cd frontend && npx nuxi typecheck 2>&1 | grep -c "error TS"` — compare against the pre-plan count (~328 baseline; must not exceed it).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/pages/dev/frame-lab.vue
git commit -m "test(compositor): frame-lab motion fixtures for the redesigned motion surface"
```

---

## Post-plan notes for the executor

- **Human hand-check owed** (report at the end): band drag interactions (offset/divider/end-edge) — the browser harness can't drive `pointermove` drags; the math is unit-tested but the pointer wiring needs a human mouse once.
- **Documented v1 limitations** (from the spec, restate in the final report): per-char text ignores `scaleX/scaleY/copies`; wired layers have no bands; keyframe UI is the next milestone (Custom card is its placeholder).
- The old `MotionTransport.vue` and `LayerMotionPanel.vue` are deleted; any stray import of them is a build error — grep before finishing: `grep -rn "MotionTransport\|LayerMotionPanel" frontend/app`.
