# Kinetic Keyframe Foundation — Implementation Plan (Part 2a of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the data/logic foundation the keyframe-lane editor (Part 2b) needs — per-keyframe easing with the 4 UI presets across BOTH transform and variable-font-axis keyframes, and the missing axis-keyframe commands — all unit-tested, no UI.

**Architecture:** Easing is additive: the 4 presets are `linear` / `power2.in` / `power2.out` / `easeInOut`, of which `linear` and `easeInOut` (smoothstep) already exist and are already mirrored in Python; we add only `power2.in`/`power2.out` on both the TS (`shared/timeline/interpolate.ts`) and Python (`comfy_extras/nodes_timeline.py`) sides so transform-keyframe export parity (the golden gate) holds. Axis interpolation (`app/lib/motion/axes.ts`) is extended to honor per-keyframe ease using that same shared helper. Axis keyframes gain a command set mirroring the transform commands, keyed on normalized `t` (no data migration).

**Tech Stack:** TypeScript (shared + app), Vitest, Python + Pillow + NumPy, Pytest.

**Spec:** `docs/superpowers/specs/2026-06-13-kinetic-export-and-keyframe-lanes-design.md` (Part 2 — Keyframe-lane editor). This plan is the foundation; Part 2b is the dock UI built on it.

**Why split from 2b:** the dock editor is a large browser-verified UI; this foundation is pure logic that's fully unit-testable. Landing it first de-risks 2b.

---

## Background facts (verified against current code)

- `shared/timeline/interpolate.ts`: private `applyEase(t, ease)` supports only `'linear'`/`'easeInOut'` (smoothstep `t*t*(3-2t)`). `interpolateClipAt` uses it. This file is **mirrored 1:1 in Python** and must not import from `app/`.
- `comfy_extras/nodes_timeline.py:196` `_ease(t, ease)`: smoothstep for `easeInOut`, else linear. Used by `_interp_transform` (the export-path transform interpolation).
- `app/lib/motion/axes.ts` `interpolateAxes(keyframes, t, staticAxes)`: **linear only** — the per-keyframe `ease` field is currently ignored (comment says "reserved for future"). `AxisKeyframe.ease?: string`.
- `shared/timeline/types.ts`: `Keyframe.ease?: 'linear' | 'easeInOut'` (transform); `MotionAxisKeyframe.ease?: string` (axes).
- `shared/timeline/commands.ts`: transform keyframe commands exist (`add_keyframe`, `remove_keyframe`, `move_keyframe`, `set_keyframe_ease`, `set_clip_transform`). **No axis-keyframe commands exist** — `MotionTextLayer.axisKeyframes` is only mutated via a raw `update_clip` patch today. Helpers: `findClip`, `clampLocal`, `clonePayload`, `keyframeAt`.
- Tests to mirror: `frontend/tests/unit/interpolate.unit.spec.ts`, `frontend/tests/unit/motion-axes.unit.spec.ts`, `frontend/tests/unit/commands.unit.spec.ts`; Python `tests-unit/comfy_extras_test/timeline_state_test.py`.

---

## File Structure

- **Modify** `frontend/shared/timeline/interpolate.ts` — make `applyEase` exported, add `power2.in`/`power2.out`. One responsibility: shared keyframe math.
- **Modify** `frontend/shared/timeline/types.ts` — widen `Keyframe['ease']` to the 4-preset union.
- **Modify** `frontend/app/lib/motion/axes.ts` — honor per-keyframe ease via the shared `applyEase`.
- **Modify** `frontend/shared/timeline/commands.ts` — add 5 axis-keyframe commands.
- **Modify** `comfy_extras/nodes_timeline.py` — mirror `power2.in`/`power2.out` in `_ease`.
- **Test (modify)** `frontend/tests/unit/interpolate.unit.spec.ts`, `frontend/tests/unit/motion-axes.unit.spec.ts`, `frontend/tests/unit/commands.unit.spec.ts`.

---

### Task 1: Easing — add `power2.in`/`power2.out`, export `applyEase`

**Files:**
- Modify: `frontend/shared/timeline/types.ts` (the `Keyframe` interface, ~line 98)
- Modify: `frontend/shared/timeline/interpolate.ts:37-40` (`applyEase`)
- Test: `frontend/tests/unit/interpolate.unit.spec.ts`

- [ ] **Step 1: Widen the `Keyframe.ease` type**

In `types.ts`, change the `Keyframe` interface's `ease` line from:

```ts
  ease?: 'linear' | 'easeInOut'
```

to:

```ts
  /** Per-keyframe easing for the segment FROM this keyframe to the next.
   *  The 4 lane-editor presets: linear / power2.in / power2.out / easeInOut
   *  (easeInOut = legacy smoothstep, kept for back-compat + golden parity). */
  ease?: 'linear' | 'easeInOut' | 'power2.in' | 'power2.out'
```

- [ ] **Step 2: Write the failing test**

Append to `frontend/tests/unit/interpolate.unit.spec.ts`:

```ts
import { applyEase } from '../../shared/timeline/interpolate'

describe('applyEase (4 lane presets)', () => {
  it('linear is identity', () => {
    expect(applyEase(0.25, 'linear')).toBeCloseTo(0.25, 6)
    expect(applyEase(0.25, undefined)).toBeCloseTo(0.25, 6)
  })
  it('power2.in is quadratic-in (t*t)', () => {
    expect(applyEase(0.5, 'power2.in')).toBeCloseTo(0.25, 6)
  })
  it('power2.out is quadratic-out (1-(1-t)^2)', () => {
    expect(applyEase(0.5, 'power2.out')).toBeCloseTo(0.75, 6)
  })
  it('easeInOut is unchanged smoothstep (golden parity)', () => {
    expect(applyEase(0.5, 'easeInOut')).toBeCloseTo(0.5, 6)   // 0.5^2*(3-2*0.5)=0.5
    expect(applyEase(0.25, 'easeInOut')).toBeCloseTo(0.15625, 6) // 0.0625*2.5
  })
  it('endpoints are fixed for every preset', () => {
    for (const e of ['linear', 'power2.in', 'power2.out', 'easeInOut'] as const) {
      expect(applyEase(0, e)).toBeCloseTo(0, 6)
      expect(applyEase(1, e)).toBeCloseTo(1, 6)
    }
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/interpolate.unit.spec.ts`
Expected: FAIL — `applyEase` is not exported (import resolves to undefined) / `power2.*` not handled.

- [ ] **Step 4: Implement**

In `interpolate.ts`, replace the private `applyEase` (lines 37-40):

```ts
function applyEase(t: number, ease?: Keyframe['ease']): number {
  // smoothstep for easeInOut; linear otherwise.
  return ease === 'easeInOut' ? t * t * (3 - 2 * t) : t
}
```

with an exported version supporting the 4 presets:

```ts
/** Canonical keyframe easing for the timeline — used by BOTH transform
 *  (interpolateClipAt) and variable-font axes (app/lib/motion/axes.ts), so the
 *  two animate identically. Additive set: 'linear' (default) and 'easeInOut'
 *  (legacy smoothstep) are unchanged for back-compat + golden parity; 'power2.in'
 *  and 'power2.out' are the new presets. MIRRORED in Python `_ease`
 *  (comfy_extras/nodes_timeline.py) for transform export parity. ease is typed
 *  loosely (string) so axis keyframes (MotionAxisKeyframe.ease: string) share it. */
export function applyEase(t: number, ease?: string): number {
  switch (ease) {
    case 'power2.in':  return t * t
    case 'power2.out': return 1 - (1 - t) * (1 - t)
    case 'easeInOut':  return t * t * (3 - 2 * t)  // smoothstep (legacy)
    default:           return t                     // linear / unknown
  }
}
```

(The call site in `interpolateClipAt` at line 56 already calls `applyEase(...)` — no change needed there. The `Keyframe` import at line 1 stays.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/interpolate.unit.spec.ts`
Expected: PASS (existing tests + the new 5).

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/timeline/interpolate.ts frontend/shared/timeline/types.ts frontend/tests/unit/interpolate.unit.spec.ts
git commit -m "feat(timeline): export applyEase + power2.in/out keyframe presets"
```

---

### Task 2: Python `_ease` mirror + golden parity

**Files:**
- Modify: `comfy_extras/nodes_timeline.py:196-199` (`_ease`)
- Test: `tests-unit/comfy_extras_test/timeline_state_test.py`

- [ ] **Step 1: Write the failing test**

Append to `tests-unit/comfy_extras_test/timeline_state_test.py` (it already imports the module — reuse its loader; if it exposes the module as `NT`, use that; otherwise mirror the `_load_nodes_timeline()` pattern from `timeline_render_frame_test.py`). Use this self-contained version:

```python
def test_ease_presets_match_ts():
    import importlib.util, os, sys
    repo = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    if repo not in sys.path:
        sys.path.insert(0, repo)
    spec = importlib.util.spec_from_file_location(
        "nt_ease", os.path.join(repo, "comfy_extras", "nodes_timeline.py"))
    nt = importlib.util.module_from_spec(spec); spec.loader.exec_module(nt)
    assert abs(nt._ease(0.5, "linear") - 0.5) < 1e-6
    assert abs(nt._ease(0.5, None) - 0.5) < 1e-6
    assert abs(nt._ease(0.5, "power2.in") - 0.25) < 1e-6
    assert abs(nt._ease(0.5, "power2.out") - 0.75) < 1e-6
    assert abs(nt._ease(0.5, "easeInOut") - 0.5) < 1e-6           # smoothstep unchanged
    assert abs(nt._ease(0.25, "easeInOut") - 0.15625) < 1e-6
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_state_test.py::test_ease_presets_match_ts -v`
Expected: FAIL — `power2.in` returns `0.5` (linear fallback), not `0.25`.

- [ ] **Step 3: Implement**

Replace `_ease` (lines 196-199) with:

```python
def _ease(t: float, ease) -> float:
    # Mirror of shared/timeline/interpolate.ts applyEase. Additive: linear and
    # easeInOut (smoothstep) unchanged; power2.in/out added for the lane presets.
    if ease == "power2.in":
        return t * t
    if ease == "power2.out":
        return 1.0 - (1.0 - t) * (1.0 - t)
    if ease == "easeInOut":
        return t * t * (3.0 - 2.0 * t)  # smoothstep (legacy)
    return t  # linear / unknown
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_state_test.py::test_ease_presets_match_ts -v`
Expected: PASS.

- [ ] **Step 5: Confirm golden parity is untouched (linear/easeInOut unchanged)**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_golden_test.py tests-unit/comfy_extras_test/timeline_render_frame_test.py -q`
Expected: all PASS (no golden regen needed — only `power2.*` are new; existing fixtures use linear/easeInOut which are byte-identical).

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/nodes_timeline.py tests-unit/comfy_extras_test/timeline_state_test.py
git commit -m "feat(timeline): mirror power2.in/out easing in Python _ease"
```

---

### Task 3: Axis interpolation honors per-keyframe ease

**Files:**
- Modify: `frontend/app/lib/motion/axes.ts:24-69` (`interpolateAxes`)
- Test: `frontend/tests/unit/motion-axes.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/unit/motion-axes.unit.spec.ts`:

```ts
import { interpolateAxes } from '../../app/lib/motion/axes'

describe('interpolateAxes per-keyframe ease', () => {
  const kfs = [
    { t: 0, axes: { wght: 0 }, ease: 'power2.in' },
    { t: 1, axes: { wght: 100 } },
  ]
  it('applies the FROM-keyframe ease to the segment (power2.in at mid)', () => {
    // linear would give 50 at t=0.5; power2.in (t^2) gives 25.
    expect(interpolateAxes(kfs, 0.5, {}).wght).toBeCloseTo(25, 4)
  })
  it('still linear when no ease set', () => {
    const lin = [{ t: 0, axes: { wght: 0 } }, { t: 1, axes: { wght: 100 } }]
    expect(interpolateAxes(lin, 0.5, {}).wght).toBeCloseTo(50, 4)
  })
  it('endpoints unaffected by ease', () => {
    expect(interpolateAxes(kfs, 0, {}).wght).toBeCloseTo(0, 4)
    expect(interpolateAxes(kfs, 1, {}).wght).toBeCloseTo(100, 4)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/motion-axes.unit.spec.ts`
Expected: FAIL — mid value is `50` (linear), not `25`.

- [ ] **Step 3: Implement**

In `axes.ts`, add the import at the top (after the file's existing imports / comment block, before `export interface AxisKeyframe`):

```ts
import { applyEase } from '~~/shared/timeline/interpolate'
```

Then in `interpolateAxes`, change the fraction line (currently line 54):

```ts
      const frac = span > 0 ? (ct - a.t) / span : 0
```

to:

```ts
      // Per-keyframe ease: the FROM-keyframe's ease shapes the segment to the next
      // (same convention + math as transform keyframes via shared applyEase).
      const frac = span > 0 ? applyEase((ct - a.t) / span, a.ease) : 0
```

Also update the stale comment in the function's JSDoc (lines 21-22) — change "the per-keyframe `ease` field is reserved for future segment easing and is not yet applied" to "the per-keyframe `ease` field shapes the segment from that keyframe to the next (shared applyEase)."

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/motion-axes.unit.spec.ts`
Expected: PASS (existing tests + the new 3).

- [ ] **Step 5: Confirm the import path resolves under vitest**

Run: `cd frontend && npx vitest run tests/unit/motion-axes.unit.spec.ts tests/unit/motion-clip-render.unit.spec.ts`
Expected: PASS — `motionClipRenderer` (which imports `axes.ts`) still loads in the node env. If the `~~/shared` alias fails to resolve in this unit context, use the relative import `'../../shared/timeline/interpolate'` instead (match whatever sibling specs use to reach `shared/`), then re-run.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/motion/axes.ts frontend/tests/unit/motion-axes.unit.spec.ts
git commit -m "feat(timeline): interpolateAxes honors per-keyframe ease"
```

---

### Task 4: Axis-keyframe commands

**Files:**
- Modify: `frontend/shared/timeline/commands.ts` (union ~line 29; handlers after `set_clip_transform`, ~line 226)
- Test: `frontend/tests/unit/commands.unit.spec.ts`

Axis keyframes live on `MotionClip.layer.axisKeyframes` (`MotionAxisKeyframe[]`, normalized `t`). Commands are keyed on `t` (matching storage), with a small epsilon for float matching. They no-op (return false) for non-motion clips.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/commands.unit.spec.ts` (mirror how the file builds state — if it has a helper like `makeState()`, use it; otherwise this self-contained block works):

```ts
import { applyCommand } from '../../shared/timeline/commands'
import type { EditState, Track, MotionClip } from '../../shared/timeline/types'

function motionState(): { state: EditState; clip: MotionClip } {
  const clip: MotionClip = {
    id: 'm1', kind: 'motion', start_frame: 0, in_frame: 0, length: 90,
    x: 0, y: 0, rotation: 0, scale: 1, opacity: 1,
    layer: { id: 'l', kind: 'text', text: 'AB', fontFamily: 'Inter', fontSize: 0.1, color: '#fff', align: 'center' },
  }
  const track: Track = { id: 't1', kind: 'video', name: 'V1', muted: false, locked: false, clips: [clip] }
  const state: EditState = {
    version: 2, canvas: { width: 1280, height: 720, fps: 30, bg_color: '#000' },
    tracks: [track], transitions: [], total_frames: 90,
  }
  return { state, clip: state.tracks[0]!.clips[0] as MotionClip }
}

describe('axis keyframe commands', () => {
  it('add_axis_keyframe creates the array and inserts sorted', () => {
    const { state } = motionState()
    expect(applyCommand(state, { type: 'add_axis_keyframe', clip_id: 'm1', t: 1, axes: { wght: 900 } })).toBe(true)
    expect(applyCommand(state, { type: 'add_axis_keyframe', clip_id: 'm1', t: 0, axes: { wght: 100 } })).toBe(true)
    const kfs = (state.tracks[0]!.clips[0] as MotionClip).layer.axisKeyframes!
    expect(kfs.map(k => k.t)).toEqual([0, 1])
    expect(kfs[0]!.axes).toEqual({ wght: 100 })
  })
  it('add_axis_keyframe at an existing t merges axes', () => {
    const { state } = motionState()
    applyCommand(state, { type: 'add_axis_keyframe', clip_id: 'm1', t: 0, axes: { wght: 100 } })
    applyCommand(state, { type: 'add_axis_keyframe', clip_id: 'm1', t: 0, axes: { wdth: 75 } })
    const kfs = (state.tracks[0]!.clips[0] as MotionClip).layer.axisKeyframes!
    expect(kfs).toHaveLength(1)
    expect(kfs[0]!.axes).toEqual({ wght: 100, wdth: 75 })
  })
  it('set_axis_keyframe_axes patches an existing keyframe', () => {
    const { state } = motionState()
    applyCommand(state, { type: 'add_axis_keyframe', clip_id: 'm1', t: 0.5, axes: { wght: 400 } })
    expect(applyCommand(state, { type: 'set_axis_keyframe_axes', clip_id: 'm1', t: 0.5, axes: { wght: 700 } })).toBe(true)
    expect((state.tracks[0]!.clips[0] as MotionClip).layer.axisKeyframes![0]!.axes.wght).toBe(700)
  })
  it('set_axis_keyframe_ease sets ease', () => {
    const { state } = motionState()
    applyCommand(state, { type: 'add_axis_keyframe', clip_id: 'm1', t: 0, axes: { wght: 100 } })
    expect(applyCommand(state, { type: 'set_axis_keyframe_ease', clip_id: 'm1', t: 0, ease: 'power2.out' })).toBe(true)
    expect((state.tracks[0]!.clips[0] as MotionClip).layer.axisKeyframes![0]!.ease).toBe('power2.out')
  })
  it('move_axis_keyframe re-times and re-sorts', () => {
    const { state } = motionState()
    applyCommand(state, { type: 'add_axis_keyframe', clip_id: 'm1', t: 0, axes: { wght: 100 } })
    applyCommand(state, { type: 'add_axis_keyframe', clip_id: 'm1', t: 1, axes: { wght: 900 } })
    expect(applyCommand(state, { type: 'move_axis_keyframe', clip_id: 'm1', from_t: 0, to_t: 0.5 })).toBe(true)
    const kfs = (state.tracks[0]!.clips[0] as MotionClip).layer.axisKeyframes!
    expect(kfs.map(k => k.t)).toEqual([0.5, 1])
  })
  it('remove_axis_keyframe deletes; empties to undefined', () => {
    const { state } = motionState()
    applyCommand(state, { type: 'add_axis_keyframe', clip_id: 'm1', t: 0, axes: { wght: 100 } })
    expect(applyCommand(state, { type: 'remove_axis_keyframe', clip_id: 'm1', t: 0 })).toBe(true)
    expect((state.tracks[0]!.clips[0] as MotionClip).layer.axisKeyframes).toBeUndefined()
  })
  it('no-ops (false) on a non-motion clip', () => {
    const { state } = motionState()
    state.tracks[0]!.clips[0]!.kind = 'video' as any
    expect(applyCommand(state, { type: 'add_axis_keyframe', clip_id: 'm1', t: 0, axes: { wght: 1 } })).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/commands.unit.spec.ts`
Expected: FAIL — these command types don't exist (TS error / `applyCommand` returns false / `undefined`).

- [ ] **Step 3: Add the command types to the union**

In `commands.ts`, add to the `TimelineCommand` union (after the `set_clip_transform` line, ~line 29):

```ts
  | { type: 'add_axis_keyframe'; clip_id: string; t: number; axes: Record<string, number> }
  | { type: 'remove_axis_keyframe'; clip_id: string; t: number }
  | { type: 'move_axis_keyframe'; clip_id: string; from_t: number; to_t: number }
  | { type: 'set_axis_keyframe_ease'; clip_id: string; t: number; ease: string }
  | { type: 'set_axis_keyframe_axes'; clip_id: string; t: number; axes: Record<string, number> }
```

- [ ] **Step 4: Add a motion-layer helper**

In `commands.ts`, after the `keyframeAt` helper (~line 60), add:

```ts
const T_EPS = 1e-4

/** Resolve a clip id to its MotionClip layer, or null if it isn't a motion clip. */
function findMotionLayer(s: EditState, clipId: string): import('./types').MotionTextLayer | null {
  const hit = findClip(s, clipId)
  if (!hit || hit.clip.kind !== 'motion') return null
  return (hit.clip as import('./types').MotionClip).layer
}

/** Index of the axis keyframe at normalized `t` (epsilon match), or -1. */
function axisKfIndex(layer: import('./types').MotionTextLayer, t: number): number {
  const ks = layer.axisKeyframes
  if (!ks) return -1
  return ks.findIndex(k => Math.abs(k.t - t) < T_EPS)
}
```

- [ ] **Step 5: Add the handlers**

In `applyCommand`, add these cases before the final closing of the `switch` (after the `remove_transition` case, ~line 253):

```ts
    case 'add_axis_keyframe': {
      const layer = findMotionLayer(s, cmd.clip_id)
      if (!layer) return false
      const t = Math.max(0, Math.min(1, cmd.t))
      if (!layer.axisKeyframes) layer.axisKeyframes = []
      const i = axisKfIndex(layer, t)
      if (i >= 0) layer.axisKeyframes[i] = { ...layer.axisKeyframes[i], axes: { ...layer.axisKeyframes[i]!.axes, ...clonePayload(cmd.axes) } }
      else layer.axisKeyframes.push({ t, axes: clonePayload(cmd.axes), ease: 'linear' })
      layer.axisKeyframes.sort((a, b) => a.t - b.t)
      return true
    }

    case 'remove_axis_keyframe': {
      const layer = findMotionLayer(s, cmd.clip_id)
      const i = layer ? axisKfIndex(layer, cmd.t) : -1
      if (!layer || i < 0) return false
      layer.axisKeyframes!.splice(i, 1)
      if (!layer.axisKeyframes!.length) delete layer.axisKeyframes
      return true
    }

    case 'move_axis_keyframe': {
      const layer = findMotionLayer(s, cmd.clip_id)
      const i = layer ? axisKfIndex(layer, cmd.from_t) : -1
      if (!layer || i < 0) return false
      layer.axisKeyframes![i]!.t = Math.max(0, Math.min(1, cmd.to_t))
      layer.axisKeyframes!.sort((a, b) => a.t - b.t)
      return true
    }

    case 'set_axis_keyframe_ease': {
      const layer = findMotionLayer(s, cmd.clip_id)
      const i = layer ? axisKfIndex(layer, cmd.t) : -1
      if (!layer || i < 0) return false
      layer.axisKeyframes![i]!.ease = cmd.ease
      return true
    }

    case 'set_axis_keyframe_axes': {
      const layer = findMotionLayer(s, cmd.clip_id)
      const i = layer ? axisKfIndex(layer, cmd.t) : -1
      if (!layer || i < 0) return false
      layer.axisKeyframes![i] = { ...layer.axisKeyframes![i], axes: { ...layer.axisKeyframes![i]!.axes, ...clonePayload(cmd.axes) } }
      return true
    }
```

(`MotionClip`/`MotionTextLayer` are referenced via inline `import('./types')` in the helpers to avoid touching the top import list; alternatively add them to the line-1 import — either is fine, pick one and be consistent.)

- [ ] **Step 6: Run to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/commands.unit.spec.ts`
Expected: PASS (existing tests + the new 7).

- [ ] **Step 7: Full unit sweep (no regressions)**

Run: `cd frontend && npx vitest run tests/unit/interpolate.unit.spec.ts tests/unit/motion-axes.unit.spec.ts tests/unit/commands.unit.spec.ts tests/unit/motion-clip-render.unit.spec.ts tests/unit/motion-clip-bake.unit.spec.ts`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/shared/timeline/commands.ts frontend/tests/unit/commands.unit.spec.ts
git commit -m "feat(timeline): axis-keyframe commands (add/remove/move/set-ease/set-axes)"
```

---

## Self-Review

**Spec coverage (Part 2 foundation):**
- "Per-keyframe easing, 4 presets" → Task 1 (TS) + Task 2 (Python mirror, transform export parity) + Task 3 (axes honor ease). The 4 presets = `linear`/`power2.in`/`power2.out`/`easeInOut`. ✓
- "Editor animates axes + transform; axis keyframes need a command path (today only raw update_clip)" → Task 4 adds the 5 axis commands mirroring transform. ✓
- "Transform keyframes already have commands" → unchanged, reused. ✓
- Golden parity preserved (only additive easing) → Task 2 Step 5. ✓
- UI (dock, lanes, diamond-toggle, drag/snap, nav arrows, on-clip dots, convert-preset) → **deliberately out of scope here; Part 2b.** Noted so it isn't mistaken for dropped.

**Placeholder scan:** none — every step has concrete code/commands and expected output. The two "match the sibling pattern" notes (Task 2 loader, Task 3 import alias, Task 4 state helper) are concrete fallbacks against existing files, not placeholders.

**Type consistency:** `applyEase(t, ease?: string)` defined in Task 1, imported in Task 3. `Keyframe.ease` widened in Task 1 to the 4-name union; `set_keyframe_ease` (existing) keeps `ease: Keyframe['ease']` → auto-widened. Axis commands use `t` (normalized) consistently; `findMotionLayer`/`axisKfIndex` defined in Task 4 Step 4 and used in Step 5. Python `_ease` names (`power2.in`/`power2.out`/`easeInOut`) match the TS strings exactly.

---

## Notes for Part 2b (the dock UI)

- 2b dispatches these commands; add thin `useTimelineStore` wrappers there if desired (mirror `addKeyframe`).
- Frame↔t conversion lives in the UI: for a MotionClip of `length` L, a lane drawn in clip-local frames maps `t = frame / L` (and `frame = t * L`). Transform keyframes are already in clip-local frames; axis keyframes in `t` — the dock converts axis `t`→frame for display and frame→`t` when dispatching axis commands.
- The 4 ease presets the chooser emits: `'linear'`, `'power2.in'`, `'power2.out'`, `'easeInOut'` (labels Linear / Ease In / Ease Out / Ease In-Out).
- Reuse `framesToPx`/`pxToFrames`/`ticks` from `TimelineEditor.vue` for the dock ruler; mount the dock between the track lanes and the keyboard-hint strip.
