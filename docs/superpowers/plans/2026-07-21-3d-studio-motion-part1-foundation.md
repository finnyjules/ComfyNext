# 3D Studio Motion — Part 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, unit-tested motion library for 3D Studio — the data model, easing reconciliation, per-slot preset evaluation, and the `home ∘ motion(t)` scene compose with seamless loop-close — with no UI or engine wiring yet.

**Architecture:** A new `frontend/app/lib/scene3d/motion/` module. Motion is evaluated as pure math into a `MotionSample` (additive position/rotation deltas, multiplicative scale, absolute opacity) that composes onto each object's Build "home" transform. Easing unifies two existing systems: cubic-bézier tuples (`spacetype/motion.ts` `bezierEase`) for the curve family and named procedural eases (`lib/motion/easing.ts` `resolveEase`) for bounce/elastic/spring. Motion fields are added to `SceneDoc`/`SceneObject`/camera via the existing tolerant `parseDoc`.

**Tech Stack:** TypeScript, Vitest 4 (`happy-dom`), Three.js types (Vec3 tuples only — no live GL in this part). Reuses `bezierEase`/`parseEase` (`~/lib/spacetype/motion`), `resolveEase`/`backOut` (`~/lib/motion/easing`), `loopMultiplier` (`~/lib/spacetype/loop`).

## Global Constraints

- **Test runner:** Vitest, run **from `frontend/`** cwd. Unit tests live in `frontend/tests/unit/<name>.unit.spec.ts`. Import alias `~` → `frontend/app` (`vitest.config.ts`).
- **Per-task gate:** `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts` green, AND `npx vue-tsc --noEmit | grep -iE 'scene3d' ` prints nothing.
- **TDD, no exceptions:** every task = write failing test → run to confirm FAIL → implement → run to confirm PASS → commit. `git add` only the named files.
- **`parseDoc` takes a STRING.** Always round-trip via `parseDoc(serializeDoc(doc))` in tests — never `parseDoc(object)`.
- **No new dependencies.** Reuse the easing/loop helpers named above.
- **DRY / YAGNI:** only the presets in this plan. No keyframes, no per-property curves — ever (design guardrail).
- **Angles are radians, XYZ euler** (matches `SceneObjectBase.rotation`). `Vec3 = [number, number, number]`.

---

## File Structure

All new files under `frontend/app/lib/scene3d/motion/`:

- `types.ts` — all motion types (`ObjectMotion`, `TransitionSpec`, `LoopSpec`, `CameraMotion`, `SceneMotion`, `EaseRef`) + `MotionSample` + `IDENTITY_SAMPLE`.
- `ease.ts` — `resolveEaseRef(ease): (t:number)=>number` bridging bézier + named.
- `presets.ts` — defaults + `directionVector`, `evaluateLoop`, `evaluateTransition`.
- `evaluate.ts` — `evaluateObjectMotion`, `evaluateCameraMotion` (region logic, offset, combine).
- `apply.ts` — `sceneLoopCycles`, `applyMotionToDoc` (`home ∘ motion(t)` → `{ doc, opacities }`), `applyCameraMotion`.
- `defaults.ts` — `animateSceneDefaults`, `SCENE_TEMPLATES` (the one-click "Animate" + templates as pure doc-stamping).

Modified:
- `frontend/app/lib/scene3d/config.ts` — add `SceneMotion` to `SceneDoc`, `motion?` to objects & camera, parse them tolerantly.

Test (single growing file):
- `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Deferred to Part 2 (separate plan):** `motion/frameSource.ts` + headless `SceneEngine` registration on the node, engine opacity application in `renderFrameAt`, the Motion-tab UI (band-timeline drag, `CurveEditor` wiring, transport, templates gallery), and the direct Export-video button.

---

## Task 1: Motion types + tolerant config parse

**Files:**
- Create: `frontend/app/lib/scene3d/motion/types.ts`
- Modify: `frontend/app/lib/scene3d/config.ts` (add fields + parse)
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Produces: the motion types below; `SceneDoc.motion: SceneMotion`; `SceneObjectBase.motion?: ObjectMotion`; `SceneCamera.motion?: CameraMotion`. `parseDoc(serializeDoc(doc))` preserves all motion fields; a doc with no motion parses to `motion: DEFAULT_SCENE_MOTION` and objects with `motion: undefined`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/scene3d-motion.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { parseDoc, serializeDoc, defaultDoc, createPrimitive } from '~/lib/scene3d/config'
import type { ObjectMotion } from '~/lib/scene3d/motion/types'
import { DEFAULT_SCENE_MOTION } from '~/lib/scene3d/motion/types'

describe('scene3d motion — config parse', () => {
  it('defaults scene motion when absent', () => {
    const doc = parseDoc(serializeDoc(defaultDoc()))
    expect(doc.motion).toEqual(DEFAULT_SCENE_MOTION)
  })

  it('round-trips object + camera motion', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box')
    const motion: ObjectMotion = {
      loop: { kind: 'spin', speed: 2, amount: 1 },
      in: { preset: 'move', duration: 0.6, direction: 'left', ease: { kind: 'bezier', cps: [0, 0, 0.58, 1] } },
      offset: 0.2,
    }
    obj.motion = motion
    doc.objects.push(obj)
    doc.motion = { duration: 5, fps: 24, loop: true }
    doc.camera.motion = { preset: 'orbit', speed: 1, amount: 1 }

    const round = parseDoc(serializeDoc(doc))
    expect(round.motion).toEqual({ duration: 5, fps: 24, loop: true })
    expect(round.objects[0]!.motion).toEqual(motion)
    expect(round.camera.motion).toEqual({ preset: 'orbit', speed: 1, amount: 1 })
  })

  it('drops malformed object motion to undefined', () => {
    const doc = defaultDoc()
    const obj = createPrimitive('box')
    doc.objects.push(obj)
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].motion = { loop: { kind: 'not-a-kind', speed: 'x' } }
    const round = parseDoc(JSON.stringify(raw))
    expect(round.objects[0]!.motion).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/scene3d/motion/types` / `DEFAULT_SCENE_MOTION`.

- [ ] **Step 3: Write the types**

```ts
// frontend/app/lib/scene3d/motion/types.ts
import type { Vec3 } from '~/lib/scene3d/config'

export type LoopKind = 'none' | 'spin' | 'bob' | 'pulse' | 'orbit' | 'sway' | 'tumble'
export type TransitionPreset = 'move' | 'rise' | 'scale' | 'fade' | 'pop'
export type Direction = 'left' | 'right' | 'top' | 'bottom'
export type ProceduralEase = 'bounce' | 'elastic' | 'spring'

export type EaseRef =
  | { kind: 'bezier'; cps: [number, number, number, number] }
  | { kind: 'named'; name: ProceduralEase }

export interface LoopSpec { kind: LoopKind; speed: number; amount: number; phase?: number }
export interface TransitionSpec {
  preset: TransitionPreset
  duration: number
  direction?: Direction
  ease: EaseRef
}
export interface ObjectMotion {
  loop?: LoopSpec
  in?: TransitionSpec
  out?: TransitionSpec
  offset?: number   // seconds; delays the `in` and seeds stagger
}
export interface CameraMotion {
  preset: 'none' | 'orbit' | 'push' | 'sway'
  speed: number
  amount: number
}
export interface SceneMotion { duration: number; fps: number; loop: boolean; template?: string }

export const DEFAULT_SCENE_MOTION: SceneMotion = { duration: 4, fps: 30, loop: true }

/** Delta to compose onto an object's home transform.
 *  position/rotation are ADDITIVE (world units / radians),
 *  scaleMul is MULTIPLICATIVE, opacity is ABSOLUTE in [0,1] (1 = fully visible). */
export interface MotionSample {
  dPosition: Vec3
  dRotation: Vec3
  scaleMul: Vec3
  opacity: number
}
export const IDENTITY_SAMPLE: MotionSample = {
  dPosition: [0, 0, 0], dRotation: [0, 0, 0], scaleMul: [1, 1, 1], opacity: 1,
}
```

- [ ] **Step 4: Add parse logic to `config.ts`**

At the top of `config.ts`, add the import:

```ts
import type { ObjectMotion, CameraMotion, SceneMotion, LoopKind, TransitionPreset, Direction, EaseRef } from '~/lib/scene3d/motion/types'
import { DEFAULT_SCENE_MOTION } from '~/lib/scene3d/motion/types'
```

Add these validators near the existing `vec3/str/num` helpers:

```ts
const LOOP_KINDS: LoopKind[] = ['none', 'spin', 'bob', 'pulse', 'orbit', 'sway', 'tumble']
const TRANSITION_PRESETS: TransitionPreset[] = ['move', 'rise', 'scale', 'fade', 'pop']
const DIRECTIONS: Direction[] = ['left', 'right', 'top', 'bottom']
const CAMERA_PRESETS: CameraMotion['preset'][] = ['none', 'orbit', 'push', 'sway']

function parseEaseRef(raw: any): EaseRef {
  if (raw && raw.kind === 'named' && (raw.name === 'bounce' || raw.name === 'elastic' || raw.name === 'spring')) {
    return { kind: 'named', name: raw.name }
  }
  const c = raw?.cps
  if (raw?.kind === 'bezier' && Array.isArray(c) && c.length === 4 && c.every((n: unknown) => typeof n === 'number')) {
    return { kind: 'bezier', cps: [c[0], c[1], c[2], c[3]] }
  }
  return { kind: 'bezier', cps: [0.42, 0, 0.58, 1] }
}

function parseTransition(raw: any): TransitionSpecOrNull {
  if (!raw || !TRANSITION_PRESETS.includes(raw.preset)) return undefined
  const spec: any = { preset: raw.preset, duration: num(raw.duration, 0.6), ease: parseEaseRef(raw.ease) }
  if (DIRECTIONS.includes(raw.direction)) spec.direction = raw.direction
  return spec
}
type TransitionSpecOrNull = import('~/lib/scene3d/motion/types').TransitionSpec | undefined

function parseObjectMotion(raw: any): ObjectMotion | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const m: ObjectMotion = {}
  if (raw.loop && LOOP_KINDS.includes(raw.loop.kind)) {
    m.loop = { kind: raw.loop.kind, speed: num(raw.loop.speed, 1), amount: num(raw.loop.amount, 1) }
    if (typeof raw.loop.phase === 'number') m.loop.phase = raw.loop.phase
  }
  const mIn = parseTransition(raw.in); if (mIn) m.in = mIn
  const mOut = parseTransition(raw.out); if (mOut) m.out = mOut
  if (typeof raw.offset === 'number') m.offset = raw.offset
  return Object.keys(m).length ? m : undefined
}

function parseSceneMotion(raw: any): SceneMotion {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SCENE_MOTION }
  const m: SceneMotion = {
    duration: num(raw.duration, DEFAULT_SCENE_MOTION.duration),
    fps: num(raw.fps, DEFAULT_SCENE_MOTION.fps),
    loop: raw.loop !== false,
  }
  if (typeof raw.template === 'string') m.template = raw.template
  return m
}

function parseCameraMotion(raw: any): CameraMotion | undefined {
  if (!raw || !CAMERA_PRESETS.includes(raw.preset)) return undefined
  return { preset: raw.preset, speed: num(raw.speed, 1), amount: num(raw.amount, 1) }
}
```

In the `SceneObjectBase`/object union type declarations, add the optional field to `SceneObjectBase`:

```ts
export interface SceneObjectBase {
  id: string
  name: string
  visible: boolean
  position: Vec3
  rotation: Vec3
  scale: Vec3
  material: SceneMaterial
  motion?: ObjectMotion   // ← add
}
```

In `SceneDoc`, add `motion`:

```ts
export interface SceneDoc {
  version: 1
  objects: SceneObject[]
  camera: SceneCamera
  lighting: SceneLighting
  background: string
  output: { width: number; height: number }
  motion: SceneMotion     // ← add
}
```

Add `motion?: CameraMotion` to the `SceneCamera` interface.

In `defaultDoc()`, add `motion: { ...DEFAULT_SCENE_MOTION }` to the returned object.

In `parseDoc`, after the objects are built and camera parsed, thread motion:
- set `doc.motion = parseSceneMotion(raw.motion)`,
- in the object-building `common` block add `...(parseObjectMotion(o.motion) ? { motion: parseObjectMotion(o.motion) } : {})` (compute once into a local to avoid double-parse),
- after camera is assembled, `const cm = parseCameraMotion(raw.camera?.motion); if (cm) doc.camera.motion = cm`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts`
Expected: PASS (3 tests). Then `npx vue-tsc --noEmit | grep -iE 'scene3d'` → empty.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/scene3d/motion/types.ts frontend/app/lib/scene3d/config.ts frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): motion types + tolerant config parse"
```

---

## Task 2: `resolveEaseRef` — reconcile the two easing vocabularies

**Files:**
- Create: `frontend/app/lib/scene3d/motion/ease.ts`
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Consumes: `bezierEase` from `~/lib/spacetype/motion`; `bounceOut`, `elasticOut` from `~/lib/motion/easing`; `EaseRef` from `./types`.
- Produces: `resolveEaseRef(ease: EaseRef): (t: number) => number`. Bézier → `bezierEase(t, cps)`; named → the matching procedural fn (`spring` maps to `elasticOut`). `f(0) === 0`, `f(1) === 1` for all.

- [ ] **Step 1: Write the failing test**

```ts
// append to scene3d-motion.unit.spec.ts
import { resolveEaseRef } from '~/lib/scene3d/motion/ease'

describe('scene3d motion — resolveEaseRef', () => {
  it('bezier endpoints anchored', () => {
    const f = resolveEaseRef({ kind: 'bezier', cps: [0.34, 1.56, 0.64, 1] })
    expect(f(0)).toBeCloseTo(0, 6)
    expect(f(1)).toBeCloseTo(1, 6)
    expect(f(0.5)).toBeGreaterThan(0.5) // ease-out-ish region
  })
  it('bezier overshoot exceeds 1 mid-curve', () => {
    const f = resolveEaseRef({ kind: 'bezier', cps: [0.34, 1.56, 0.64, 1] })
    const peak = Math.max(...Array.from({ length: 19 }, (_, i) => f((i + 1) / 20)))
    expect(peak).toBeGreaterThan(1)
  })
  it('named procedural resolves and anchors', () => {
    for (const name of ['bounce', 'elastic', 'spring'] as const) {
      const f = resolveEaseRef({ kind: 'named', name })
      expect(f(0)).toBeCloseTo(0, 4)
      expect(f(1)).toBeCloseTo(1, 4)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t resolveEaseRef`
Expected: FAIL — cannot resolve `~/lib/scene3d/motion/ease`.

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/scene3d/motion/ease.ts
import { bezierEase } from '~/lib/spacetype/motion'
import { bounceOut, elasticOut } from '~/lib/motion/easing'
import type { EaseRef } from './types'

/** One resolver for both ease families:
 *  - bezier tuple  → spacetype bezierEase (curve family, CurveEditor)
 *  - named         → procedural fns (bounce/elastic; spring≈elastic) */
export function resolveEaseRef(ease: EaseRef): (t: number) => number {
  if (ease.kind === 'named') {
    if (ease.name === 'bounce') return bounceOut
    return elasticOut // elastic + spring
  }
  const cps = ease.cps
  return (t: number) => bezierEase(t, cps)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t resolveEaseRef`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/motion/ease.ts frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): unify bezier + procedural easing via resolveEaseRef"
```

---

## Task 3: Preset evaluators — loop + transition

**Files:**
- Create: `frontend/app/lib/scene3d/motion/presets.ts`
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Consumes: `MotionSample`, `IDENTITY_SAMPLE`, `LoopSpec`, `TransitionPreset`, `Direction` from `./types`; `backOut` from `~/lib/motion/easing`.
- Produces:
  - `MOVE_DIST = 2`, `RISE_DIST = 2` (world-unit travel constants).
  - `directionVector(dir: Direction, dist: number): Vec3`.
  - `evaluateLoop(loop: LoopSpec, t01: number): MotionSample` — `t01∈[0,1]` scene-normalized; **closes**: `evaluateLoop(l, 0)` deep-equals `evaluateLoop(l, 1)` for every kind (rotation wraps mod 2π; positions/scale return to identity).
  - `evaluateTransition(preset, dir, p, mode): Partial<MotionSample>` — `mode: 'in'|'out'`, `p∈[0,1]` already-eased progress (in: 0=offscreen,1=home; out: 0=home,1=gone). `pop` forces its own overshoot via `backOut`, ignoring caller ease.

- [ ] **Step 1: Write the failing test**

```ts
// append
import { evaluateLoop, evaluateTransition, directionVector, MOVE_DIST } from '~/lib/scene3d/motion/presets'

describe('scene3d motion — loop presets close seamlessly', () => {
  const kinds = ['spin', 'bob', 'pulse', 'orbit', 'sway', 'tumble'] as const
  for (const kind of kinds) {
    it(`${kind} identity-equivalent at t=0 and t=1`, () => {
      const a = evaluateLoop({ kind, speed: 2, amount: 1 }, 0)
      const b = evaluateLoop({ kind, speed: 2, amount: 1 }, 1)
      // positions & scale return exactly; rotations return mod 2π
      expect(a.dPosition.map(v => +v.toFixed(6))).toEqual(b.dPosition.map(v => +v.toFixed(6)))
      expect(a.scaleMul.map(v => +v.toFixed(6))).toEqual(b.scaleMul.map(v => +v.toFixed(6)))
      const wrap = (r: number) => +(((r % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toFixed(5)
      expect(a.dRotation.map(wrap)).toEqual(b.dRotation.map(wrap))
    })
  }
  it('none is identity', () => {
    expect(evaluateLoop({ kind: 'none', speed: 1, amount: 1 }, 0.37).dPosition).toEqual([0, 0, 0])
  })
})

describe('scene3d motion — transitions', () => {
  it('move-in travels from offset to home', () => {
    const start = evaluateTransition('move', 'left', 0, 'in')
    const end = evaluateTransition('move', 'left', 1, 'in')
    expect(start.dPosition![0]).toBeCloseTo(-MOVE_DIST, 6)
    expect(end.dPosition![0]).toBeCloseTo(0, 6)
  })
  it('fade-in ramps opacity 0→1; fade-out 1→0', () => {
    expect(evaluateTransition('fade', undefined, 0, 'in').opacity).toBeCloseTo(0, 6)
    expect(evaluateTransition('fade', undefined, 1, 'in').opacity).toBeCloseTo(1, 6)
    expect(evaluateTransition('fade', undefined, 1, 'out').opacity).toBeCloseTo(0, 6)
  })
  it('pop overshoots scale above 1 mid-progress', () => {
    const mid = evaluateTransition('pop', undefined, 0.7, 'in')
    expect(mid.scaleMul![0]).toBeGreaterThan(1)
  })
  it('directionVector maps axes', () => {
    expect(directionVector('right', 3)).toEqual([3, 0, 0])
    expect(directionVector('top', 3)).toEqual([0, 3, 0])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "loop presets|transitions"`
Expected: FAIL — cannot resolve `~/lib/scene3d/motion/presets`.

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/scene3d/motion/presets.ts
import type { Vec3 } from '~/lib/scene3d/config'
import type { LoopSpec, TransitionPreset, Direction, MotionSample } from './types'
import { backOut } from '~/lib/motion/easing'

export const MOVE_DIST = 2
export const RISE_DIST = 2
const TAU = Math.PI * 2
const SCALE_EPS = 0.001

/** integer cycles per scene loop so motion closes at t01=1 (>=1). */
function cycles(speed: number): number { return Math.max(1, Math.round(Math.abs(speed))) }

export function directionVector(dir: Direction, dist: number): Vec3 {
  switch (dir) {
    case 'left': return [-dist, 0, 0]
    case 'right': return [dist, 0, 0]
    case 'top': return [0, dist, 0]
    case 'bottom': return [0, -dist, 0]
  }
}

export function evaluateLoop(loop: LoopSpec, t01: number): MotionSample {
  const s: MotionSample = { dPosition: [0, 0, 0], dRotation: [0, 0, 0], scaleMul: [1, 1, 1], opacity: 1 }
  const a = loop.amount
  const th = t01 * TAU * cycles(loop.speed)
  const phase = (loop.phase ?? 0) * TAU
  const p = th + phase
  switch (loop.kind) {
    case 'spin': s.dRotation = [0, th, 0]; break                       // wraps to 0 at t01=1
    case 'bob': s.dPosition = [0, Math.sin(p) - Math.sin(phase), 0].map(v => v * a) as Vec3; break
    case 'pulse': { const k = 1 + (Math.sin(p) - Math.sin(phase)) * 0.15 * a; s.scaleMul = [k, k, k]; break }
    case 'orbit': s.dPosition = [Math.sin(th) * a, 0, (1 - Math.cos(th)) * a]; break // 0 at both ends
    case 'sway': s.dRotation = [0, 0, (Math.sin(p) - Math.sin(phase)) * 0.25 * a]; break
    case 'tumble': s.dRotation = [th, th, 0]; break                    // both wrap
    case 'none': break
  }
  return s
}

/** in: p 0→1 offscreen→home. out: p 0→1 home→gone. `pop` ignores caller ease (own overshoot). */
export function evaluateTransition(
  preset: TransitionPreset, dir: Direction | undefined, p: number, mode: 'in' | 'out',
): Partial<MotionSample> {
  const away = mode === 'in' ? 1 - p : p   // fraction "away from home"
  switch (preset) {
    case 'move': {
      const v = directionVector(dir ?? (mode === 'in' ? 'left' : 'right'), MOVE_DIST)
      return { dPosition: [v[0] * away, v[1] * away, v[2] * away] }
    }
    case 'rise': {
      const v = directionVector(dir ?? (mode === 'in' ? 'bottom' : 'top'), RISE_DIST)
      return { dPosition: [v[0] * away, v[1] * away, v[2] * away] }
    }
    case 'scale': { const k = 1 - away * (1 - SCALE_EPS); return { scaleMul: [k, k, k] } }
    case 'fade': return { opacity: mode === 'in' ? p : 1 - p }
    case 'pop': {
      // in: overshoot up to home; out: quick scale down (no overshoot)
      const k = mode === 'in' ? Math.max(SCALE_EPS, backOut()(p)) : Math.max(SCALE_EPS, 1 - p)
      return { scaleMul: [k, k, k] }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "loop presets|transitions"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/motion/presets.ts frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): loop + transition preset evaluators (seamless-closing loops)"
```

---

## Task 4: `evaluateObjectMotion` — regions, offset, combine

**Files:**
- Create: `frontend/app/lib/scene3d/motion/evaluate.ts`
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Consumes: `evaluateLoop`, `evaluateTransition` (`./presets`); `resolveEaseRef` (`./ease`); `ObjectMotion`, `CameraMotion`, `MotionSample`, `IDENTITY_SAMPLE` (`./types`).
- Produces:
  - `evaluateObjectMotion(motion: ObjectMotion | undefined, tSec: number, duration: number): MotionSample`. `tSec` = absolute seconds in `[0, duration]`. Loop uses `t01 = tSec/duration`. In region: `[offset, offset+in.duration]` (eased). Out region: `[duration-out.duration, duration]`. Before `offset` with an `in`: held at in-start (`p=0`). Combine: position/rotation additive (loop + transition), scale multiplicative, opacity from transition only.
  - `evaluateCameraMotion(cam: CameraMotion | undefined, t01: number): { dPosition: Vec3; dTargetYaw: number }` — additive camera position delta + a yaw (radians) applied around target. `orbit` yaw = `t01*TAU*cycles`; `push` moves camera toward target by `amount` fraction over an ease-in-out then back (closes); `sway` small yaw sine.

- [ ] **Step 1: Write the failing test**

```ts
// append
import { evaluateObjectMotion, evaluateCameraMotion } from '~/lib/scene3d/motion/evaluate'
import type { ObjectMotion } from '~/lib/scene3d/motion/types'

describe('scene3d motion — evaluateObjectMotion', () => {
  const D = 4
  it('undefined motion = identity', () => {
    const s = evaluateObjectMotion(undefined, 1.3, D)
    expect(s.dPosition).toEqual([0, 0, 0]); expect(s.scaleMul).toEqual([1, 1, 1]); expect(s.opacity).toBe(1)
  })
  it('pure loop only closes: sample(0) ~= sample(D)', () => {
    const m: ObjectMotion = { loop: { kind: 'bob', speed: 1, amount: 1 } }
    const a = evaluateObjectMotion(m, 0, D), b = evaluateObjectMotion(m, D, D)
    expect(a.dPosition[1]).toBeCloseTo(b.dPosition[1], 6)
  })
  it('fade-in: opacity 0 at t=0, 1 after in.duration', () => {
    const m: ObjectMotion = { in: { preset: 'fade', duration: 1, ease: { kind: 'bezier', cps: [0, 0, 1, 1] } } }
    expect(evaluateObjectMotion(m, 0, D).opacity).toBeCloseTo(0, 5)
    expect(evaluateObjectMotion(m, 1, D).opacity).toBeCloseTo(1, 5)
    expect(evaluateObjectMotion(m, 2.5, D).opacity).toBeCloseTo(1, 5)
  })
  it('offset holds the in-start until offset time', () => {
    const m: ObjectMotion = { in: { preset: 'fade', duration: 1, ease: { kind: 'bezier', cps: [0, 0, 1, 1] } }, offset: 1 }
    expect(evaluateObjectMotion(m, 0.5, D).opacity).toBeCloseTo(0, 5) // still pre-roll
    expect(evaluateObjectMotion(m, 2, D).opacity).toBeCloseTo(1, 5)   // finished by offset+dur
  })
  it('fade-out: opacity 1 mid, 0 at end', () => {
    const m: ObjectMotion = { out: { preset: 'fade', duration: 1, ease: { kind: 'bezier', cps: [0, 0, 1, 1] } } }
    expect(evaluateObjectMotion(m, 2, D).opacity).toBeCloseTo(1, 5)
    expect(evaluateObjectMotion(m, D, D).opacity).toBeCloseTo(0, 5)
  })
})

describe('scene3d motion — evaluateCameraMotion', () => {
  it('orbit yaw closes', () => {
    expect(evaluateCameraMotion({ preset: 'orbit', speed: 1, amount: 1 }, 0).dTargetYaw).toBeCloseTo(0, 6)
    const end = evaluateCameraMotion({ preset: 'orbit', speed: 1, amount: 1 }, 1).dTargetYaw
    expect(((end % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toBeCloseTo(0, 5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "evaluateObjectMotion|evaluateCameraMotion"`
Expected: FAIL — cannot resolve `~/lib/scene3d/motion/evaluate`.

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/scene3d/motion/evaluate.ts
import type { Vec3 } from '~/lib/scene3d/config'
import type { ObjectMotion, CameraMotion, MotionSample } from './types'
import { evaluateLoop, evaluateTransition } from './presets'
import { resolveEaseRef } from './ease'

const TAU = Math.PI * 2
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export function evaluateObjectMotion(
  motion: ObjectMotion | undefined, tSec: number, duration: number,
): MotionSample {
  const s: MotionSample = { dPosition: [0, 0, 0], dRotation: [0, 0, 0], scaleMul: [1, 1, 1], opacity: 1 }
  if (!motion || duration <= 0) return s

  if (motion.loop) {
    const l = evaluateLoop(motion.loop, tSec / duration)
    s.dPosition = [l.dPosition[0], l.dPosition[1], l.dPosition[2]]
    s.dRotation = [l.dRotation[0], l.dRotation[1], l.dRotation[2]]
    s.scaleMul = [l.scaleMul[0], l.scaleMul[1], l.scaleMul[2]]
  }

  const offset = motion.offset ?? 0
  let trans: Partial<MotionSample> | undefined
  if (motion.in) {
    const inEnd = offset + motion.in.duration
    if (tSec <= inEnd) {
      const p = motion.in.duration > 0 ? clamp01((tSec - offset) / motion.in.duration) : 1
      trans = evaluateTransition(motion.in.preset, motion.in.direction, resolveEaseRef(motion.in.ease)(p), 'in')
    }
  }
  if (!trans && motion.out) {
    const outStart = duration - motion.out.duration
    if (tSec >= outStart) {
      const p = motion.out.duration > 0 ? clamp01((tSec - outStart) / motion.out.duration) : 1
      trans = evaluateTransition(motion.out.preset, motion.out.direction, resolveEaseRef(motion.out.ease)(p), 'out')
    }
  }
  if (trans) {
    if (trans.dPosition) s.dPosition = add(s.dPosition, trans.dPosition)
    if (trans.dRotation) s.dRotation = add(s.dRotation, trans.dRotation)
    if (trans.scaleMul) s.scaleMul = mul(s.scaleMul, trans.scaleMul)
    if (trans.opacity !== undefined) s.opacity = trans.opacity
  }
  return s
}

export function evaluateCameraMotion(
  cam: CameraMotion | undefined, t01: number,
): { dPosition: Vec3; dTargetYaw: number } {
  if (!cam || cam.preset === 'none') return { dPosition: [0, 0, 0], dTargetYaw: 0 }
  const cyc = Math.max(1, Math.round(cam.speed))
  if (cam.preset === 'orbit') return { dPosition: [0, 0, 0], dTargetYaw: t01 * TAU * cyc }
  if (cam.preset === 'sway') return { dPosition: [0, 0, 0], dTargetYaw: Math.sin(t01 * TAU * cyc) * 0.08 * cam.amount }
  // push: ease in then out along a closed sine envelope (0 at ends)
  const k = Math.sin(t01 * Math.PI) * 0.15 * cam.amount
  return { dPosition: [0, 0, -k], dTargetYaw: 0 }
}

function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function mul(a: Vec3, b: Vec3): Vec3 { return [a[0] * b[0], a[1] * b[1], a[2] * b[2]] }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t "evaluateObjectMotion|evaluateCameraMotion"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/motion/evaluate.ts frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): evaluateObjectMotion + evaluateCameraMotion (regions, offset, combine)"
```

---

## Task 5: `applyMotionToDoc` — `home ∘ motion(t)` + loop-close

**Files:**
- Create: `frontend/app/lib/scene3d/motion/apply.ts`
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Consumes: `evaluateObjectMotion`, `evaluateCameraMotion` (`./evaluate`); `SceneDoc`, `serializeDoc`, `parseDoc` (`~/lib/scene3d/config`); `loopMultiplier` (`~/lib/spacetype/loop`).
- Produces:
  - `sceneLoopCycles(doc): number[]` — the per-object/camera loop rates (integer cycles) used to compute the seamless multiplier (currently all integers, so multiplier is 1; helper exists for Part 2 fps math).
  - `applyMotionToDoc(doc: SceneDoc, t01: number): { doc: SceneDoc; opacities: Record<string, number> }`. Returns a **deep-cloned** doc (never mutates input) with each object's `position/rotation/scale = home ∘ sample`, camera position/target rotated by yaw + pushed, and an `opacities` map (id → 0..1, omitted when 1). `t01∈[0,1]` maps to `tSec = t01*duration`.

- [ ] **Step 1: Write the failing test**

```ts
// append
import { applyMotionToDoc } from '~/lib/scene3d/motion/apply'
import { defaultDoc, createPrimitive } from '~/lib/scene3d/config'

describe('scene3d motion — applyMotionToDoc', () => {
  it('no motion → doc transforms unchanged and input not mutated', () => {
    const doc = defaultDoc()
    const box = createPrimitive('box'); box.position = [1, 2, 3]; doc.objects.push(box)
    const before = JSON.stringify(doc)
    const { doc: out, opacities } = applyMotionToDoc(doc, 0.5)
    expect(out.objects[0]!.position).toEqual([1, 2, 3])
    expect(opacities).toEqual({})
    expect(JSON.stringify(doc)).toBe(before) // input untouched
  })
  it('composes loop delta onto home position', () => {
    const doc = defaultDoc()
    const box = createPrimitive('box'); box.position = [0, 5, 0]
    box.motion = { loop: { kind: 'bob', speed: 1, amount: 2 } }; doc.objects.push(box)
    doc.motion = { duration: 4, fps: 30, loop: true }
    const quarter = applyMotionToDoc(doc, 0.25).doc.objects[0]!.position
    expect(quarter[1]).toBeGreaterThan(5) // bob peak above home mid-cycle
    const zero = applyMotionToDoc(doc, 0).doc.objects[0]!.position
    expect(zero[1]).toBeCloseTo(5, 6) // returns home at loop start
  })
  it('pure-loop scene: frame 0 == frame 1 (seamless)', () => {
    const doc = defaultDoc()
    const box = createPrimitive('box')
    box.motion = { loop: { kind: 'orbit', speed: 2, amount: 1 } }; doc.objects.push(box)
    doc.motion = { duration: 4, fps: 30, loop: true }
    const a = applyMotionToDoc(doc, 0).doc.objects[0]!.position.map(v => +v.toFixed(6))
    const b = applyMotionToDoc(doc, 1).doc.objects[0]!.position.map(v => +v.toFixed(6))
    expect(a).toEqual(b)
  })
  it('reports opacity for fading object', () => {
    const doc = defaultDoc()
    const box = createPrimitive('box')
    box.motion = { in: { preset: 'fade', duration: 1, ease: { kind: 'bezier', cps: [0, 0, 1, 1] } } }
    doc.objects.push(box); doc.motion = { duration: 4, fps: 30, loop: true }
    expect(applyMotionToDoc(doc, 0).opacities[box.id]).toBeCloseTo(0, 5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t applyMotionToDoc`
Expected: FAIL — cannot resolve `~/lib/scene3d/motion/apply`.

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/scene3d/motion/apply.ts
import type { SceneDoc, Vec3 } from '~/lib/scene3d/config'
import { serializeDoc, parseDoc } from '~/lib/scene3d/config'
import { evaluateObjectMotion, evaluateCameraMotion } from './evaluate'

export function sceneLoopCycles(doc: SceneDoc): number[] {
  const rates: number[] = []
  for (const o of doc.objects) if (o.motion?.loop && o.motion.loop.kind !== 'none') {
    rates.push(Math.max(1, Math.round(Math.abs(o.motion.loop.speed))))
  }
  if (doc.camera.motion && doc.camera.motion.preset !== 'none') {
    rates.push(Math.max(1, Math.round(doc.camera.motion.speed)))
  }
  return rates.length ? rates : [1]
}

export function applyMotionToDoc(
  doc: SceneDoc, t01: number,
): { doc: SceneDoc; opacities: Record<string, number> } {
  const out = parseDoc(serializeDoc(doc)) // deep clone via tolerant round-trip
  const duration = out.motion.duration
  const tSec = t01 * duration
  const opacities: Record<string, number> = {}

  for (const obj of out.objects) {
    const s = evaluateObjectMotion(obj.motion, tSec, duration)
    obj.position = [obj.position[0] + s.dPosition[0], obj.position[1] + s.dPosition[1], obj.position[2] + s.dPosition[2]]
    obj.rotation = [obj.rotation[0] + s.dRotation[0], obj.rotation[1] + s.dRotation[1], obj.rotation[2] + s.dRotation[2]]
    obj.scale = [obj.scale[0] * s.scaleMul[0], obj.scale[1] * s.scaleMul[1], obj.scale[2] * s.scaleMul[2]]
    if (s.opacity < 1) opacities[obj.id] = s.opacity
  }

  const cam = evaluateCameraMotion(out.camera.motion, t01)
  if (cam.dTargetYaw !== 0 || cam.dPosition[0] || cam.dPosition[1] || cam.dPosition[2]) {
    out.camera.position = orbitAround(out.camera.position, out.camera.target, cam.dTargetYaw, cam.dPosition)
  }
  return { doc: out, opacities }
}

/** rotate `pos` around `target` about world-Y by `yaw`, then add a local push delta. */
function orbitAround(pos: Vec3, target: Vec3, yaw: number, push: Vec3): Vec3 {
  const dx = pos[0] - target[0], dz = pos[2] - target[2]
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const rx = dx * c - dz * s, rz = dx * s + dz * c
  return [target[0] + rx + push[0], pos[1] + push[1], target[2] + rz + push[2]]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t applyMotionToDoc`
Expected: PASS. Then `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts` → all green; `npx vue-tsc --noEmit | grep -iE 'scene3d'` → empty.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/motion/apply.ts frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): applyMotionToDoc composes home∘motion(t) with seamless loop-close"
```

---

## Task 6: Scene defaults + templates (`Animate` one-click)

**Files:**
- Create: `frontend/app/lib/scene3d/motion/defaults.ts`
- Test: `frontend/tests/unit/scene3d-motion.unit.spec.ts`

**Interfaces:**
- Consumes: `SceneDoc` (`~/lib/scene3d/config`); motion types (`./types`).
- Produces:
  - `SCENE_TEMPLATES: Record<'showcase'|'reveal'|'loop', (doc: SceneDoc) => void>` — mutate the passed doc in place, stamping per-object + camera + scene motion.
  - `animateSceneDefaults(doc: SceneDoc): void` — alias to `SCENE_TEMPLATES.showcase`. Assigns: staggered `offset` in object order (`i * 0.12`), a drifting loop (varied `phase = i * 0.15`), a fade+rise `in`, and a camera preset. Objects of `kind:'light'` are skipped (lights don't animate in v1).

- [ ] **Step 1: Write the failing test**

```ts
// append
import { animateSceneDefaults, SCENE_TEMPLATES } from '~/lib/scene3d/motion/defaults'

describe('scene3d motion — defaults/templates', () => {
  function scene(n: number) {
    const doc = defaultDoc()
    for (let i = 0; i < n; i++) { const b = createPrimitive('box'); doc.objects.push(b) }
    return doc
  }
  it('animateSceneDefaults staggers offsets and drifts phases', () => {
    const doc = scene(3); animateSceneDefaults(doc)
    const offs = doc.objects.map(o => o.motion?.offset ?? 0)
    expect(offs[0]!).toBeLessThan(offs[1]!)
    expect(offs[1]!).toBeLessThan(offs[2]!)
    const phases = doc.objects.map(o => o.motion?.loop?.phase ?? 0)
    expect(new Set(phases).size).toBeGreaterThan(1) // not all identical
    expect(doc.camera.motion?.preset).toBeDefined()
  })
  it('loop template gives no in/out (seamless)', () => {
    const doc = scene(2); SCENE_TEMPLATES.loop(doc)
    expect(doc.objects[0]!.motion?.in).toBeUndefined()
    expect(doc.objects[0]!.motion?.loop).toBeDefined()
  })
  it('skips lights', () => {
    const doc = defaultDoc()
    const box = createPrimitive('box'); doc.objects.push(box)
    // simulate a light object shape
    doc.objects.push({ ...box, id: 'L1', kind: 'light', light: 'point', color: '#fff', intensity: 1 } as any)
    animateSceneDefaults(doc)
    expect(doc.objects[1]!.motion).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t defaults`
Expected: FAIL — cannot resolve `~/lib/scene3d/motion/defaults`.

- [ ] **Step 3: Implement**

```ts
// frontend/app/lib/scene3d/motion/defaults.ts
import type { SceneDoc } from '~/lib/scene3d/config'
import type { ObjectMotion } from './types'

const EASE_OUT = { kind: 'bezier' as const, cps: [0, 0, 0.58, 1] as [number, number, number, number] }

function animatable(doc: SceneDoc) { return doc.objects.filter(o => o.kind !== 'light') }

export const SCENE_TEMPLATES: Record<'showcase' | 'reveal' | 'loop', (doc: SceneDoc) => void> = {
  showcase(doc) {
    doc.motion = { duration: 4, fps: 30, loop: true, template: 'showcase' }
    animatable(doc).forEach((o, i) => {
      o.motion = {
        loop: { kind: 'bob', speed: 1, amount: 0.5, phase: i * 0.15 },
        in: { preset: 'rise', duration: 0.6, direction: 'bottom', ease: EASE_OUT },
        offset: i * 0.12,
      } satisfies ObjectMotion
    })
    doc.camera.motion = { preset: 'orbit', speed: 1, amount: 1 }
  },
  reveal(doc) {
    doc.motion = { duration: 4, fps: 30, loop: true, template: 'reveal' }
    animatable(doc).forEach((o, i) => {
      o.motion = {
        loop: { kind: 'none', speed: 1, amount: 1, phase: i * 0.15 },
        in: { preset: 'fade', duration: 0.7, ease: EASE_OUT },
        offset: i * 0.15,
      } satisfies ObjectMotion
    })
    doc.camera.motion = { preset: 'push', speed: 1, amount: 1 }
  },
  loop(doc) {
    doc.motion = { duration: 4, fps: 30, loop: true, template: 'loop' }
    animatable(doc).forEach((o, i) => {
      o.motion = { loop: { kind: 'spin', speed: 1, amount: 1, phase: i * 0.2 } } satisfies ObjectMotion
    })
    doc.camera.motion = { preset: 'none', speed: 1, amount: 1 }
  },
}

export function animateSceneDefaults(doc: SceneDoc): void { SCENE_TEMPLATES.showcase(doc) }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts -t defaults`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/motion/defaults.ts frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "feat(scene3d): scene motion templates + one-click animate defaults"
```

---

## Task 7: Full-suite green + typecheck gate

**Files:** none (verification checkpoint).

- [ ] **Step 1: Run the whole motion suite**

Run: `cd frontend && npx vitest run tests/unit/scene3d-motion.unit.spec.ts`
Expected: PASS — all describe blocks (config parse, resolveEaseRef, loop presets, transitions, evaluateObjectMotion, evaluateCameraMotion, applyMotionToDoc, defaults).

- [ ] **Step 2: Confirm no regressions in the existing scene3d suite**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts`
Expected: PASS (motion fields are additive; `parseDoc` round-trips unchanged for motion-less docs).

- [ ] **Step 3: Typecheck gate**

Run: `cd frontend && npx vue-tsc --noEmit | grep -iE 'scene3d/motion|scene3d/config'`
Expected: no output.

- [ ] **Step 4: Commit (if anything was touched to fix regressions; otherwise skip)**

```bash
git add -A frontend/app/lib/scene3d frontend/tests/unit/scene3d-motion.unit.spec.ts
git commit -m "test(scene3d): motion foundation suite green + typecheck clean"
```

---

## Self-Review

**Spec coverage (design §):**
- §2 model (`home ∘ motion(t)`, deltas, tolerant parse) → Tasks 1, 5. ✅
- §3 preset catalog (Loop/Enter/Exit/Camera + direction) → Tasks 3, 4. ✅ (`stagger`/per-glyph text = deferred, §6 design — Part 2/Phase 2.)
- §4 orchestration (one clock two rules, Animate, templates) → Tasks 4 (phase drift), 6. ✅
- §7 easing (unified `EaseRef`, bézier + procedural) → Tasks 1 (`EaseRef` parse), 2 (`resolveEaseRef`). ✅
- §8 export loop-close math → Task 5 (`sceneLoopCycles`, seamless frame0==frame1). ✅ (Frame-source registration/render/export = Part 2.)
- §5 Motion-tab UI, §6 kinetic `stagger`, §8 `StudioFrameSource` registration + direct export → **Part 2** (explicitly out of this plan).

**Placeholder scan:** none — every step has full test + impl code and exact commands.

**Type consistency:** `MotionSample`/`ObjectMotion`/`EaseRef`/`SceneMotion` defined in Task 1 `types.ts`, consumed unchanged in Tasks 2–6. `applyMotionToDoc` return `{ doc, opacities }` used consistently. `evaluateTransition(preset, dir, p, mode)` signature matches its call in Task 4. `resolveEaseRef` returns `(t)=>number`, applied to `p` before `evaluateTransition` in Task 4 (Task 4 passes an already-eased `p`, and `evaluateTransition` does not re-ease — consistent).

**One deliberate design note for the implementer:** `evaluateTransition` receives an **already-eased** progress from `evaluateObjectMotion` (which applies `resolveEaseRef`). `pop` overrides with its own `backOut` regardless, by design (§7). Do not double-apply easing.

---

## Part 2 (next plan — not built here)

`2026-07-21-3d-studio-motion-part2-integration.md` will cover: `motion/frameSource.ts` (mirror `spacetype/frameSource.ts`) + a headless `SceneEngine` on `Scene3DStudioNode.vue` registering via `registerStudioFrameSource`; engine `renderFrameAt(t01)` applying `applyMotionToDoc` transforms + `opacities` (material `transparent`/`opacity`) then `render()`; the Motion `StudioSection` UI (enable, duration/fps, per-object preset selects, Templates + Animate) driving the RAF at time `t`; wiring `CurveEditor.vue` for custom bézier + the draggable band-timeline; and the direct **Export video** button reusing the `bake → /sailor/spacetype_encode → Assets` pipeline. Guardrail unchanged: band timeline is the ceiling — no per-property keyframes.
