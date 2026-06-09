# Phase 0: Timeline Foundation (Data Model v2 + Command Layer + Golden-Frame Harness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation for the CapCut-parity video editor (spec: `docs/plans/2026-06-09-capcut-parity-video-editor-design.md`): extend the timeline data model to v2 (transitions, speed/reverse, filters, captions, mattes, bake refs), formalize every timeline mutation as a serializable typed command, and build the golden-frame parity harness that will keep the Python exporter and the Phase-1 WebGL engine pixel-identical.

**Architecture:** `frontend/shared/timeline/types.ts` stays the single source of truth, bumped to `version: 2` with a migration that accepts v1. A new `commands.ts` holds a pure `applyCommand(state, cmd)` the store dispatches through (undo/redo unchanged; commands become the text-to-edit tool surface later). On the Python side, the per-frame composite inside `render_timeline_to_file` is extracted into `render_frame_np()` — the single source of export-path pixel math — used by the export loop, a new `/comfynext/timeline/render_frame` PNG endpoint, and a golden-frame CLI. Committed fixture timelines + golden PNGs + a pytest diff gate Python regressions; a Playwright harness page proves the browser-side comparison pipeline end-to-end so the Phase-1 WebGL renderer plugs straight in.

**Tech Stack:** TypeScript (Nuxt 4 / Vue 3), Vitest (new, unit tests for shared logic), Playwright (existing, against live servers on :3002/:8188), Python (pytest in `tests-unit/`, numpy/PIL/PyAV in `.venv`).

**Phase 0 scope guard (YAGNI):** v2 fields are *schema only* — nothing renders transitions, speed, filters, or captions yet (that's Phases 2–3). Phase 0 ships: both sides accept v2 without breaking, commands exist and are tested, and the parity harness is live. Golden fixtures use image clips only — no text (font rendering is platform-dependent) and no video (PyAV seek determinism varies); video fixtures join in Phase 1 with the engine.

**Conventions:** Commit messages follow the repo's `Area: description` style. Frontend commands run from `frontend/`; Python commands from the repo root with `.venv/bin/python`.

---

## Task 1: Vitest unit-test infrastructure

The frontend has only Playwright. Shared timeline logic (types, interpolate, commands) needs fast headless unit tests. Playwright's `testDir` is `./tests` and would pick up anything matching `*.spec.ts` there, so unit tests live under `tests/unit/` and Playwright ignores that folder.

**Files:**
- Modify: `frontend/package.json` (add vitest devDependency + script)
- Create: `frontend/vitest.config.ts`
- Modify: `frontend/playwright.config.ts` (ignore `tests/unit/`)
- Test: `frontend/tests/unit/interpolate.unit.spec.ts`

- [ ] **Step 1: Install vitest**

```bash
cd frontend && npm install -D vitest
```

- [ ] **Step 2: Add the unit-test script**

In `frontend/package.json` scripts, after `"test": "playwright test",` add:

```json
    "test:unit": "vitest run",
```

- [ ] **Step 3: Create `frontend/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

// Unit tests for shared timeline logic (types, interpolate, commands) — pure
// TS, no Vue/Nuxt runtime needed. E2E stays in Playwright (tests/*.spec.ts);
// this only picks up tests/unit/**.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.unit.spec.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4: Exclude unit tests from Playwright**

In `frontend/playwright.config.ts`, after `testDir: './tests',` add:

```ts
  testIgnore: ['**/unit/**'],
```

- [ ] **Step 5: Write smoke tests for the existing interpolation (failing-first not applicable — this also establishes the mirrored-math TS coverage referenced by the spec)**

Create `frontend/tests/unit/interpolate.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { interpolateClipAt } from '../../shared/timeline/interpolate'

describe('interpolateClipAt', () => {
  it('returns static scalars when no keyframes', () => {
    const tf = interpolateClipAt({ x: 0.2, scale: 1.5 }, 10)
    expect(tf).toEqual({ x: 0.2, y: 0, rotation: 0, scale: 1.5, opacity: 1 })
  })

  it('lerps linearly between bracketing keyframes', () => {
    const clip = {
      keyframes: [
        { frame: 0, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 },
        { frame: 10, x: 1, y: -1, rotation: 90, scale: 2, opacity: 0 },
      ],
    }
    const tf = interpolateClipAt(clip, 5)
    expect(tf.x).toBeCloseTo(0.5, 10)
    expect(tf.y).toBeCloseTo(-0.5, 10)
    expect(tf.rotation).toBeCloseTo(45, 10)
    expect(tf.scale).toBeCloseTo(1.5, 10)
    expect(tf.opacity).toBeCloseTo(0.5, 10)
  })

  it('applies smoothstep for easeInOut (t=0.25 → 0.15625)', () => {
    const clip = {
      keyframes: [
        { frame: 0, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1, ease: 'easeInOut' as const },
        { frame: 10, x: 1, y: 0, rotation: 0, scale: 1, opacity: 1 },
      ],
    }
    expect(interpolateClipAt(clip, 2.5).x).toBeCloseTo(0.15625, 10)
  })

  it('clamps before the first and after the last keyframe', () => {
    const clip = {
      keyframes: [
        { frame: 5, x: 0.3, y: 0, rotation: 0, scale: 1, opacity: 1 },
        { frame: 10, x: 0.9, y: 0, rotation: 0, scale: 1, opacity: 1 },
      ],
    }
    expect(interpolateClipAt(clip, 0).x).toBeCloseTo(0.3, 10)
    expect(interpolateClipAt(clip, 99).x).toBeCloseTo(0.9, 10)
  })
})
```

- [ ] **Step 6: Run and verify**

Run: `cd frontend && npm run test:unit`
Expected: 4 tests PASS.

Also run: `cd frontend && npx playwright test --list | head -20`
Expected: lists only `tests/*.spec.ts` files, nothing under `tests/unit/`.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vitest.config.ts frontend/playwright.config.ts frontend/tests/unit/interpolate.unit.spec.ts
git commit -m "Timeline: vitest unit-test infra + mirrored-math coverage for interpolateClipAt"
```

---

## Task 2: EditState v2 — types + migration (TS)

**Files:**
- Modify: `frontend/shared/timeline/types.ts`
- Test: `frontend/tests/unit/timeline-types.unit.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/timeline-types.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  migrateEditState, createDefaultEditState, EDIT_STATE_VERSION,
} from '../../shared/timeline/types'

describe('migrateEditState', () => {
  it('upgrades a v1 state to v2 with empty transitions', () => {
    const v1 = {
      version: 1,
      canvas: { width: 1280, height: 720, fps: 30, bg_color: '#000000' },
      tracks: [{ id: 't1', kind: 'video', name: 'Video 1', muted: false, locked: false, clips: [] }],
      total_frames: 0,
    }
    const out = migrateEditState(v1)
    expect(out).not.toBeNull()
    expect(out!.version).toBe(EDIT_STATE_VERSION)
    expect(out!.transitions).toEqual([])
    expect(out!.tracks).toHaveLength(1)
  })

  it('passes a v2 state through, preserving transitions', () => {
    const v2 = {
      ...createDefaultEditState(),
      transitions: [{
        id: 'tr1', track_id: 't1', from_clip_id: 'a', to_clip_id: 'b',
        kind: 'crossfade', duration: 12,
      }],
    }
    const out = migrateEditState(JSON.parse(JSON.stringify(v2)))
    expect(out!.transitions).toHaveLength(1)
    expect(out!.transitions[0]!.kind).toBe('crossfade')
  })

  it('rejects garbage', () => {
    expect(migrateEditState(null)).toBeNull()
    expect(migrateEditState('nope')).toBeNull()
    expect(migrateEditState({ version: 99, tracks: [] })).toBeNull()
    expect(migrateEditState({ version: 2 })).toBeNull() // no tracks array
  })

  it('createDefaultEditState is a valid v2 state', () => {
    const s = createDefaultEditState()
    expect(s.version).toBe(EDIT_STATE_VERSION)
    expect(s.transitions).toEqual([])
    expect(migrateEditState(JSON.parse(JSON.stringify(s)))).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test:unit`
Expected: FAIL — `migrateEditState` / `EDIT_STATE_VERSION` not exported.

- [ ] **Step 3: Extend `frontend/shared/timeline/types.ts`**

3a. Replace the `EditState` interface:

```ts
export const EDIT_STATE_VERSION = 2

export interface EditState {
  version: typeof EDIT_STATE_VERSION
  canvas: {
    width: number
    height: number
    fps: number
    bg_color: string
  }
  tracks: Track[]
  /** Transitions attached to clip junctions (v2+). Always present after migration. */
  transitions: Transition[]
  total_frames: number
}
```

3b. Replace `Track`'s kind line (`kind: 'video' | 'audio'`) with:

```ts
  kind: 'video' | 'audio' | 'captions'
```

3c. After the `BlendMode` type, add the v2 vocabulary:

```ts
// ── v2 additions: transitions, filters, captions, mattes, bakes ─────────────

/** Built-in junction transitions. Phase-5 generative kinds extend this union. */
export type TransitionKind = 'crossfade' | 'wipe_left' | 'wipe_right' | 'slide_up' | 'slide_down'

/** A transition lives on the junction between two adjacent clips on one track,
 *  overlapping `duration` frames centered on the cut. */
export interface Transition {
  id: string
  track_id: string
  from_clip_id: string
  to_clip_id: string
  kind: TransitionKind
  duration: number
  params?: Record<string, number | string>
}

/** Per-clip color adjustments. Identity when a field is absent:
 *  brightness 0 (additive −1..1), contrast 1 (×, pivot 0.5), saturation 1 (×),
 *  hue 0 (degrees −180..180), temperature 0 (warm/cool −1..1). */
export interface ClipFilters {
  brightness?: number
  contrast?: number
  saturation?: number
  hue?: number
  temperature?: number
}

/** Link to an AI-generated derivative asset (matte, interpolated transition,
 *  reframe). `source_key` hashes the inputs that produced it — mismatch ⇒
 *  stale, re-bake. */
export interface BakeRef {
  asset_id: string
  source_key: string
}

/** Word timing is clip-local frames, like Keyframe.frame. */
export interface CaptionWord {
  text: string
  start_frame: number
  end_frame: number
}

export interface CaptionSpec {
  words: CaptionWord[]
  preset: string
  font_family: string
  font_size: number        // normalized to canvas height (0..1)
  color: string
  highlight_color: string
  y: number                // vertical anchor 0..1 from top (default 0.85)
}
```

3d. In `BaseClip`, after the `keyframes?` field, add:

```ts
  /** Playback rate (v2). 1 = normal; source advances local_frame × speed. */
  speed?: number
  /** Play the source backwards (v2). */
  reverse?: boolean
  /** Per-clip color adjustments (v2). Absent ⇒ identity. */
  filters?: ClipFilters
  /** AI matte asset composited as this clip's alpha (v2). */
  matte_asset_id?: string
  /** Cached AI-generated derivative backing this clip (v2). */
  bake?: BakeRef
```

3e. Add `path?: string` to the three media clips — this documents the field the
export path already reads (`clip.get("path")` in `nodes_timeline.py`); the
frontend inlines it at submit:

```ts
export interface VideoClip extends BaseClip {
  kind: 'video'
  asset_id: string
  /** Absolute or input-relative file path, inlined for the export/render path. */
  path?: string
}

export interface ImageClip extends BaseClip {
  kind: 'image'
  asset_id: string
  path?: string
}

export interface AudioClip extends BaseClip {
  kind: 'audio'
  asset_id: string
  path?: string
}
```

3f. After `LowerThirdClip`, add the caption clip and extend the union:

```ts
export interface CaptionClip extends BaseClip {
  kind: 'caption'
  caption: CaptionSpec
}
```

```ts
export type Clip = VideoClip | ImageClip | AudioClip | TextClip | WorkflowClip | TitleClip | LowerThirdClip | CaptionClip
```

3g. Update `createDefaultEditState` (version + transitions):

```ts
export function createDefaultEditState(): EditState {
  return {
    version: EDIT_STATE_VERSION,
    canvas: { width: 1280, height: 720, fps: 30, bg_color: '#000000' },
    tracks: [
      { id: crypto.randomUUID(), kind: 'video', name: 'Video 1', muted: false, locked: false, clips: [] },
      { id: crypto.randomUUID(), kind: 'audio', name: 'Audio 1', muted: false, locked: false, clips: [] },
    ],
    transitions: [],
    total_frames: 0,
  }
}
```

3h. After `createDefaultEditState`, add the migration:

```ts
/** Accept any supported stored EditState (v1 widgets/autosaves included) and
 *  normalize it to the current version in place. Returns null when `raw` is
 *  not an edit state — callers fall back to createDefaultEditState(). */
export function migrateEditState(raw: unknown): EditState | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, any>
  if (s.version !== 1 && s.version !== EDIT_STATE_VERSION) return null
  if (!Array.isArray(s.tracks)) return null
  s.version = EDIT_STATE_VERSION
  if (!Array.isArray(s.transitions)) s.transitions = []
  return s as EditState
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm run test:unit`
Expected: all PASS (Task 1's tests too).

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/timeline/types.ts frontend/tests/unit/timeline-types.unit.spec.ts
git commit -m "Timeline: EditState v2 — transitions, speed/reverse, filters, captions, mattes, bake refs + v1 migration"
```

---

## Task 3: Typed command layer (TS)

Pure, serializable commands with no playhead and no RNG inside — explicit frames and ids make a command log deterministic and replayable (tests now, text-to-edit in Phase 6). Logic is extracted from `useTimelineStore.ts`, with two deliberate fixes over the store versions:
- **split** rebases keyframes onto the correct halves (the store copied them wholesale to both, double-playing animations) and remaps end-junction transitions to the new right clip;
- **remove/ripple-delete/remove-track** drop transitions that reference deleted clips/tracks.

**Frame conventions** (documented in the code): `add_keyframe.frame` and `set_clip_transform.frame` are timeline-global (what the playhead reports); `remove_keyframe` / `move_keyframe` / `set_keyframe_ease` use clip-local frames (they address existing `Keyframe.frame` values).

**Files:**
- Create: `frontend/shared/timeline/commands.ts`
- Test: `frontend/tests/unit/commands.unit.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/commands.unit.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { applyCommand } from '../../shared/timeline/commands'
import { createDefaultEditState, type EditState, type ImageClip, type Transition } from '../../shared/timeline/types'

function img(id: string, start: number, length: number): ImageClip {
  return { id, kind: 'image', asset_id: `asset-${id}`, start_frame: start, in_frame: 0, length }
}

function tr(id: string, trackId: string, from: string, to: string): Transition {
  return { id, track_id: trackId, from_clip_id: from, to_clip_id: to, kind: 'crossfade', duration: 10 }
}

describe('applyCommand', () => {
  let s: EditState
  let videoTrackId: string

  beforeEach(() => {
    s = createDefaultEditState()
    videoTrackId = s.tracks[0]!.id
  })

  it('add_clip / remove_clip round-trips; remove drops referencing transitions', () => {
    expect(applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('a', 0, 30) })).toBe(true)
    expect(applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('b', 30, 30) })).toBe(true)
    expect(applyCommand(s, { type: 'add_transition', transition: tr('t1', videoTrackId, 'a', 'b') })).toBe(true)
    expect(s.transitions).toHaveLength(1)
    expect(applyCommand(s, { type: 'remove_clip', clip_id: 'a' })).toBe(true)
    expect(s.tracks[0]!.clips.map(c => c.id)).toEqual(['b'])
    expect(s.transitions).toEqual([])
  })

  it('returns false (and leaves state untouched) for unknown targets', () => {
    const before = JSON.stringify(s)
    expect(applyCommand(s, { type: 'remove_clip', clip_id: 'ghost' })).toBe(false)
    expect(applyCommand(s, { type: 'move_clip', clip_id: 'ghost', to_track_id: videoTrackId, start_frame: 0 })).toBe(false)
    expect(JSON.stringify(s)).toBe(before)
  })

  it('split_clip splits length/in_frame and rebases keyframes onto the halves', () => {
    const clip = img('a', 10, 20)
    clip.keyframes = [
      { frame: 0, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 },
      { frame: 15, x: 1, y: 0, rotation: 0, scale: 1, opacity: 1 },
    ]
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip })
    expect(applyCommand(s, { type: 'split_clip', clip_id: 'a', frame: 18, new_clip_id: 'a2' })).toBe(true)

    const [left, right] = s.tracks[0]!.clips
    expect(left!.id).toBe('a')
    expect(left!.length).toBe(8)
    expect(left!.keyframes).toEqual([{ frame: 0, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 }])
    expect(right!.id).toBe('a2')
    expect(right!.start_frame).toBe(18)
    expect(right!.in_frame).toBe(8)
    expect(right!.length).toBe(12)
    expect(right!.keyframes).toEqual([{ frame: 7, x: 1, y: 0, rotation: 0, scale: 1, opacity: 1 }])
  })

  it('split_clip rejects cuts outside the clip body', () => {
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('a', 10, 20) })
    expect(applyCommand(s, { type: 'split_clip', clip_id: 'a', frame: 10, new_clip_id: 'x' })).toBe(false)
    expect(applyCommand(s, { type: 'split_clip', clip_id: 'a', frame: 30, new_clip_id: 'x' })).toBe(false)
  })

  it('split_clip remaps an end-junction transition to the new right half', () => {
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('a', 0, 30) })
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('b', 30, 30) })
    applyCommand(s, { type: 'add_transition', transition: tr('t1', videoTrackId, 'a', 'b') })
    applyCommand(s, { type: 'split_clip', clip_id: 'a', frame: 15, new_clip_id: 'a2' })
    expect(s.transitions[0]!.from_clip_id).toBe('a2')
    expect(s.transitions[0]!.to_clip_id).toBe('b')
  })

  it('ripple_delete closes the gap on that track only', () => {
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('a', 0, 30) })
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('b', 30, 30) })
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('c', 60, 30) })
    expect(applyCommand(s, { type: 'ripple_delete', clip_id: 'b' })).toBe(true)
    const ids = s.tracks[0]!.clips.map(c => [c.id, c.start_frame])
    expect(ids).toEqual([['a', 0], ['c', 30]])
  })

  it('add_keyframe captures the interpolated transform at a global frame', () => {
    const clip = img('a', 10, 20)
    clip.x = 0.4
    clip.scale = 2
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip })
    expect(applyCommand(s, { type: 'add_keyframe', clip_id: 'a', frame: 15 })).toBe(true)
    expect(clip.keyframes).toEqual([
      { frame: 5, x: 0.4, y: 0, rotation: 0, scale: 2, opacity: 1, ease: 'linear' },
    ])
  })

  it('set_clip_transform writes scalars when unkeyed, keyframe at frame when keyed', () => {
    const clip = img('a', 0, 30)
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip })
    applyCommand(s, { type: 'set_clip_transform', clip_id: 'a', frame: 5, patch: { x: 0.25 } })
    expect(clip.x).toBe(0.25)
    expect(clip.keyframes).toBeUndefined()

    applyCommand(s, { type: 'add_keyframe', clip_id: 'a', frame: 0 })
    applyCommand(s, { type: 'set_clip_transform', clip_id: 'a', frame: 10, patch: { x: 0.9 } })
    expect(clip.keyframes).toHaveLength(2)
    expect(clip.keyframes![1]).toMatchObject({ frame: 10, x: 0.9 })
  })

  it('add_transition requires both clips and replaces the same junction', () => {
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('a', 0, 30) })
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('b', 30, 30) })
    expect(applyCommand(s, { type: 'add_transition', transition: tr('t1', videoTrackId, 'a', 'ghost') })).toBe(false)
    applyCommand(s, { type: 'add_transition', transition: tr('t1', videoTrackId, 'a', 'b') })
    applyCommand(s, { type: 'add_transition', transition: { ...tr('t2', videoTrackId, 'a', 'b'), kind: 'wipe_left' } })
    expect(s.transitions).toHaveLength(1)
    expect(s.transitions[0]!.id).toBe('t2')
    expect(applyCommand(s, { type: 'update_transition', transition_id: 't2', patch: { duration: 4 } })).toBe(true)
    expect(s.transitions[0]!.duration).toBe(4)
    expect(applyCommand(s, { type: 'remove_transition', transition_id: 't2' })).toBe(true)
    expect(s.transitions).toEqual([])
  })

  it('remove_track drops its transitions', () => {
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('a', 0, 30) })
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip: img('b', 30, 30) })
    applyCommand(s, { type: 'add_transition', transition: tr('t1', videoTrackId, 'a', 'b') })
    expect(applyCommand(s, { type: 'remove_track', track_id: videoTrackId })).toBe(true)
    expect(s.transitions).toEqual([])
  })

  it('keyframe maintenance: remove / move / ease (clip-local frames)', () => {
    const clip = img('a', 0, 30)
    clip.keyframes = [
      { frame: 0, x: 0, y: 0, rotation: 0, scale: 1, opacity: 1 },
      { frame: 20, x: 1, y: 0, rotation: 0, scale: 1, opacity: 1 },
    ]
    applyCommand(s, { type: 'add_clip', track_id: videoTrackId, clip })
    expect(applyCommand(s, { type: 'move_keyframe', clip_id: 'a', from_frame: 20, to_frame: 10 })).toBe(true)
    expect(clip.keyframes![1]!.frame).toBe(10)
    expect(applyCommand(s, { type: 'set_keyframe_ease', clip_id: 'a', frame: 10, ease: 'easeInOut' })).toBe(true)
    expect(clip.keyframes![1]!.ease).toBe('easeInOut')
    expect(applyCommand(s, { type: 'remove_keyframe', clip_id: 'a', frame: 10 })).toBe(true)
    expect(applyCommand(s, { type: 'remove_keyframe', clip_id: 'a', frame: 0 })).toBe(true)
    expect(clip.keyframes).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npm run test:unit`
Expected: FAIL — `commands.ts` does not exist.

- [ ] **Step 3: Create `frontend/shared/timeline/commands.ts`**

```ts
import type { EditState, Track, Clip, Keyframe, Transition } from './types'
import { interpolateClipAt, type ClipTransform } from './interpolate'

// Every timeline mutation is a serializable command applied by `applyCommand`.
// The store dispatches these (wrapping them in undo snapshots); headless
// surfaces — unit tests, the golden harness, the future text-to-edit
// assistant — build the same objects directly. Commands carry explicit frames
// and ids (no playhead, no RNG) so a command log replays deterministically.
//
// Frame conventions:
//   add_keyframe.frame / set_clip_transform.frame — timeline-global frames.
//   remove_keyframe / move_keyframe / set_keyframe_ease — clip-local frames
//   (they address existing Keyframe.frame values).

export type TimelineCommand =
  | { type: 'add_track'; track_id: string; kind: Track['kind']; name: string }
  | { type: 'remove_track'; track_id: string }
  | { type: 'add_clip'; track_id: string; clip: Clip }
  | { type: 'remove_clip'; clip_id: string }
  | { type: 'update_clip'; clip_id: string; patch: Partial<Clip> }
  | { type: 'move_clip'; clip_id: string; to_track_id: string; start_frame: number }
  | { type: 'split_clip'; clip_id: string; frame: number; new_clip_id: string }
  | { type: 'ripple_delete'; clip_id: string }
  | { type: 'set_canvas'; patch: Partial<EditState['canvas']> }
  | { type: 'add_keyframe'; clip_id: string; frame: number }
  | { type: 'remove_keyframe'; clip_id: string; frame: number }
  | { type: 'move_keyframe'; clip_id: string; from_frame: number; to_frame: number }
  | { type: 'set_keyframe_ease'; clip_id: string; frame: number; ease: Keyframe['ease'] }
  | { type: 'set_clip_transform'; clip_id: string; frame: number; patch: Partial<ClipTransform> }
  | { type: 'add_transition'; transition: Transition }
  | { type: 'update_transition'; transition_id: string; patch: Partial<Omit<Transition, 'id'>> }
  | { type: 'remove_transition'; transition_id: string }

function findTrack(s: EditState, trackId: string): Track | null {
  return s.tracks.find(t => t.id === trackId) ?? null
}

function findClip(s: EditState, clipId: string): { track: Track; clip: Clip; index: number } | null {
  for (const track of s.tracks) {
    const index = track.clips.findIndex(c => c.id === clipId)
    if (index >= 0) return { track, clip: track.clips[index]!, index }
  }
  return null
}

function clampLocal(clip: Clip, frame: number): number {
  return Math.max(0, Math.min(Math.round(frame), Math.max(0, clip.length - 1)))
}

/** Snapshot keyframe at clip-local `lf`, capturing the current transform. */
function keyframeAt(clip: Clip, lf: number): Keyframe {
  return { frame: lf, ...interpolateClipAt(clip, lf), ease: 'linear' }
}

/** Apply `cmd` to `s` in place. Returns false (state untouched) when the
 *  command can't apply — unknown ids, out-of-range cuts. */
export function applyCommand(s: EditState, cmd: TimelineCommand): boolean {
  switch (cmd.type) {
    case 'add_track': {
      s.tracks.push({ id: cmd.track_id, kind: cmd.kind, name: cmd.name, muted: false, locked: false, clips: [] })
      return true
    }

    case 'remove_track': {
      if (!findTrack(s, cmd.track_id)) return false
      s.transitions = s.transitions.filter(t => t.track_id !== cmd.track_id)
      s.tracks = s.tracks.filter(t => t.id !== cmd.track_id)
      return true
    }

    case 'add_clip': {
      const track = findTrack(s, cmd.track_id)
      if (!track) return false
      track.clips.push(cmd.clip)
      return true
    }

    case 'remove_clip': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      s.transitions = s.transitions.filter(t => t.from_clip_id !== cmd.clip_id && t.to_clip_id !== cmd.clip_id)
      hit.track.clips.splice(hit.index, 1)
      return true
    }

    case 'update_clip': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      Object.assign(hit.clip, cmd.patch)
      return true
    }

    case 'move_clip': {
      const hit = findClip(s, cmd.clip_id)
      const target = findTrack(s, cmd.to_track_id)
      if (!hit || !target) return false
      hit.track.clips.splice(hit.index, 1)
      hit.clip.start_frame = Math.max(0, Math.round(cmd.start_frame))
      target.clips.push(hit.clip)
      return true
    }

    case 'split_clip': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      const { track, clip, index } = hit
      if (cmd.frame <= clip.start_frame || cmd.frame >= clip.start_frame + clip.length) return false

      const splitPoint = cmd.frame - clip.start_frame
      const right: Clip = {
        ...JSON.parse(JSON.stringify(clip)),
        id: cmd.new_clip_id,
        start_frame: cmd.frame,
        in_frame: (clip.in_frame ?? 0) + splitPoint,
        length: clip.length - splitPoint,
      }

      // Keyframes are clip-local: the left half keeps those before the cut,
      // the right half keeps those after, rebased to its new local origin.
      if (clip.keyframes?.length) {
        const leftKfs = clip.keyframes.filter(k => k.frame < splitPoint)
        const rightKfs = clip.keyframes
          .filter(k => k.frame >= splitPoint)
          .map(k => ({ ...k, frame: k.frame - splitPoint }))
        if (leftKfs.length) clip.keyframes = leftKfs
        else delete clip.keyframes
        if (rightKfs.length) right.keyframes = rightKfs
        else delete right.keyframes
      }

      clip.length = splitPoint
      // The end junction now belongs to the right half.
      for (const t of s.transitions) {
        if (t.from_clip_id === cmd.clip_id) t.from_clip_id = cmd.new_clip_id
      }
      track.clips.splice(index + 1, 0, right)
      return true
    }

    case 'ripple_delete': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      const { track, clip, index } = hit
      const gap = clip.length
      const after = clip.start_frame
      s.transitions = s.transitions.filter(t => t.from_clip_id !== cmd.clip_id && t.to_clip_id !== cmd.clip_id)
      track.clips.splice(index, 1)
      for (const c of track.clips) {
        if (c.start_frame > after) c.start_frame -= gap
      }
      return true
    }

    case 'set_canvas': {
      Object.assign(s.canvas, cmd.patch)
      return true
    }

    case 'add_keyframe': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      const clip = hit.clip
      const lf = clampLocal(clip, cmd.frame - clip.start_frame)
      const kf = keyframeAt(clip, lf)
      if (!clip.keyframes) clip.keyframes = []
      const i = clip.keyframes.findIndex(k => k.frame === lf)
      if (i >= 0) clip.keyframes[i] = { ...clip.keyframes[i], ...kf }
      else clip.keyframes.push(kf)
      clip.keyframes.sort((a, b) => a.frame - b.frame)
      return true
    }

    case 'remove_keyframe': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit?.clip.keyframes) return false
      const before = hit.clip.keyframes.length
      hit.clip.keyframes = hit.clip.keyframes.filter(k => k.frame !== cmd.frame)
      if (!hit.clip.keyframes.length) delete hit.clip.keyframes
      return hit.clip.keyframes?.length !== before
    }

    case 'move_keyframe': {
      const hit = findClip(s, cmd.clip_id)
      const k = hit?.clip.keyframes?.find(kf => kf.frame === cmd.from_frame)
      if (!hit || !k) return false
      k.frame = clampLocal(hit.clip, cmd.to_frame)
      hit.clip.keyframes!.sort((a, b) => a.frame - b.frame)
      return true
    }

    case 'set_keyframe_ease': {
      const hit = findClip(s, cmd.clip_id)
      const k = hit?.clip.keyframes?.find(kf => kf.frame === cmd.frame)
      if (!k) return false
      k.ease = cmd.ease
      return true
    }

    case 'set_clip_transform': {
      const hit = findClip(s, cmd.clip_id)
      if (!hit) return false
      const clip = hit.clip
      if (clip.keyframes && clip.keyframes.length) {
        const lf = clampLocal(clip, cmd.frame - clip.start_frame)
        let k = clip.keyframes.find(kf => kf.frame === lf)
        if (!k) {
          k = keyframeAt(clip, lf)
          clip.keyframes.push(k)
          clip.keyframes.sort((a, b) => a.frame - b.frame)
        }
        Object.assign(k, cmd.patch)
      } else {
        Object.assign(clip, cmd.patch)
      }
      return true
    }

    case 'add_transition': {
      const t = cmd.transition
      if (!findClip(s, t.from_clip_id) || !findClip(s, t.to_clip_id)) return false
      // One transition per junction: replace any existing one on the same pair.
      s.transitions = s.transitions.filter(x => !(x.from_clip_id === t.from_clip_id && x.to_clip_id === t.to_clip_id))
      s.transitions.push(t)
      return true
    }

    case 'update_transition': {
      const t = s.transitions.find(x => x.id === cmd.transition_id)
      if (!t) return false
      Object.assign(t, cmd.patch)
      return true
    }

    case 'remove_transition': {
      const before = s.transitions.length
      s.transitions = s.transitions.filter(x => x.id !== cmd.transition_id)
      return s.transitions.length !== before
    }
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && npm run test:unit`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/shared/timeline/commands.ts frontend/tests/unit/commands.unit.spec.ts
git commit -m "Timeline: typed command layer — serializable mutations with deterministic replay (fixes split keyframe rebase)"
```

---

## Task 4: Store dispatches commands; bind() migrates

`useTimelineStore` keeps its public API (components don't change) but every mutation routes through `applyCommand`. Undo improves slightly: a no-op command no longer pollutes the undo stack.

**Files:**
- Modify: `frontend/app/composables/useTimelineStore.ts`

- [ ] **Step 1: Update imports** (top of file)

```ts
import { ref, computed, watch } from 'vue'
import type { EditState, Track, Clip, Asset, Keyframe } from '~~/shared/timeline/types'
import { createDefaultEditState, computeTotalFrames, migrateEditState } from '~~/shared/timeline/types'
import { interpolateClipAt, type ClipTransform } from '~~/shared/timeline/interpolate'
import { applyCommand, type TimelineCommand } from '~~/shared/timeline/commands'
```

- [ ] **Step 2: Migrate in `bind()`**

Replace the `if (raw) { ... }` block body:

```ts
    const raw = getValue('edit_state')
    if (raw) {
      try {
        const parsed = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw))
        const migrated = migrateEditState(parsed)
        if (migrated) {
          state.value = migrated
          syncToWidget()   // persist the migrated (v2) shape back
          return
        }
      } catch {}
    }
```

- [ ] **Step 3: Add `dispatch` and reimplement mutations through it**

After the `mutate` function, add:

```ts
  // Single entry point for state mutations: snapshot → apply → sync. A command
  // that can't apply (unknown id, invalid cut) leaves state AND undo untouched.
  function dispatch(cmd: TimelineCommand) {
    pushUndo()
    if (!applyCommand(state.value, cmd)) {
      undoStack.value.pop()
      return
    }
    syncToWidget()
  }
```

Replace the bodies of the existing mutation functions (signatures unchanged):

```ts
  function addTrack(kind: 'video' | 'audio', name?: string) {
    const count = state.value.tracks.filter(t => t.kind === kind).length
    dispatch({
      type: 'add_track',
      track_id: crypto.randomUUID(),
      kind,
      name: name ?? `${kind === 'video' ? 'Video' : 'Audio'} ${count + 1}`,
    })
  }

  function removeTrack(trackId: string) {
    dispatch({ type: 'remove_track', track_id: trackId })
  }

  function addClip(trackId: string, clip: Clip) {
    dispatch({ type: 'add_clip', track_id: trackId, clip })
  }

  function removeClip(clipId: string) {
    dispatch({ type: 'remove_clip', clip_id: clipId })
    if (selectedClipId.value === clipId) selectedClipId.value = null
  }

  function updateClip(clipId: string, patch: Partial<Clip>) {
    dispatch({ type: 'update_clip', clip_id: clipId, patch })
  }

  function moveClip(clipId: string, toTrackId: string, newStartFrame: number) {
    dispatch({ type: 'move_clip', clip_id: clipId, to_track_id: toTrackId, start_frame: newStartFrame })
  }

  function splitAtPlayhead(clipId: string) {
    dispatch({ type: 'split_clip', clip_id: clipId, frame: playheadFrame.value, new_clip_id: crypto.randomUUID() })
  }

  function rippleDelete(clipId: string) {
    dispatch({ type: 'ripple_delete', clip_id: clipId })
    if (selectedClipId.value === clipId) selectedClipId.value = null
  }

  function setCanvas(patch: Partial<EditState['canvas']>) {
    dispatch({ type: 'set_canvas', patch })
  }
```

And the keyframe section (keep `clipLocalFrame` — components use it):

```ts
  function addKeyframe(clipId: string) {
    dispatch({ type: 'add_keyframe', clip_id: clipId, frame: playheadFrame.value })
  }

  function removeKeyframeAt(clipId: string, frame: number) {
    dispatch({ type: 'remove_keyframe', clip_id: clipId, frame })
  }

  function moveKeyframe(clipId: string, fromFrame: number, toFrame: number) {
    dispatch({ type: 'move_keyframe', clip_id: clipId, from_frame: fromFrame, to_frame: toFrame })
  }

  function setKeyframeEase(clipId: string, frame: number, ease: Keyframe['ease']) {
    dispatch({ type: 'set_keyframe_ease', clip_id: clipId, frame, ease })
  }

  function updateClipTransform(clipId: string, patch: Partial<ClipTransform>) {
    dispatch({ type: 'set_clip_transform', clip_id: clipId, frame: playheadFrame.value, patch })
  }
```

- [ ] **Step 4: Export `dispatch`**

In the returned object, after `mutate,` add:

```ts
    dispatch,
```

- [ ] **Step 5: Typecheck + unit tests**

Run: `cd frontend && npx nuxt typecheck 2>&1 | tail -20` (if the project has no typecheck setup, `npx vue-tsc --noEmit -p .` — and if neither works cleanly on pre-existing code, confirm no NEW errors mention `useTimelineStore`, `commands`, or `types`)
Run: `cd frontend && npm run test:unit`
Expected: PASS.

- [ ] **Step 6: E2E regression — timeline editor still works** (needs both dev servers running; see `frontend/playwright.config.ts` header: `npm run dev -- --port 3002` in `frontend/`, and `.venv/bin/python main.py --listen 127.0.0.1 --port 8188` at root)

Run: `cd frontend && npx playwright test tests/timeline.spec.ts`
Expected: PASS (same result as on `main` — if a test was already red on `main`, note it, don't chase it here).

- [ ] **Step 7: Commit**

```bash
git add frontend/app/composables/useTimelineStore.ts
git commit -m "Timeline: store mutations dispatch through the command layer; bind() migrates v1 states"
```

---

## Task 5: Python accepts v1 + v2 states

Four call sites gate on `version == 1` (`comfy_extras/nodes_timeline.py:229`, `:534`, `:822`, `:882`). A v2 state from the migrated editor would silently fall through to the legacy path (node run) or render empty (export). Replace the gates with a shared helper, and prove caption clips / captions tracks are skipped gracefully.

Mirrored-math note: this task also adds the Python twin of Task 1's interpolation tests, continuing the TS↔Python conformance pattern of `tests-unit/comfy_extras_test/test_compositor_blend_conformance.py`.

**Files:**
- Modify: `comfy_extras/nodes_timeline.py`
- Test: `tests-unit/comfy_extras_test/timeline_state_test.py`

- [ ] **Step 1: Write the failing tests**

Create `tests-unit/comfy_extras_test/timeline_state_test.py`:

```python
"""EditState version acceptance + v2 graceful handling for the timeline
renderer, plus the Python mirror of the TS interpolation unit tests
(frontend/tests/unit/interpolate.unit.spec.ts) — same inputs, same expected
numbers, continuing the mirrored-math conformance pattern."""
import importlib.util
import os
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _load_nodes_timeline():
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    spec = importlib.util.spec_from_file_location(
        "nodes_timeline_under_test",
        os.path.join(REPO_ROOT, "comfy_extras", "nodes_timeline.py"),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


NT = _load_nodes_timeline()


def _v2_state():
    return {
        "version": 2,
        "canvas": {"width": 640, "height": 360, "fps": 30, "bg_color": "#000000"},
        "total_frames": 24,
        "transitions": [
            {"id": "tr1", "track_id": "t1", "from_clip_id": "a", "to_clip_id": "b",
             "kind": "crossfade", "duration": 10},
        ],
        "tracks": [
            {"id": "t1", "kind": "video", "name": "Video 1", "muted": False, "locked": False,
             "clips": [
                 {"id": "a", "kind": "image", "asset_id": "x", "path": "/nonexistent/a.png",
                  "start_frame": 0, "in_frame": 0, "length": 12, "speed": 1.0, "reverse": False,
                  "filters": {"saturation": 1.2}},
             ]},
            {"id": "t2", "kind": "captions", "name": "Captions", "muted": False, "locked": False,
             "clips": [
                 {"id": "cap1", "kind": "caption", "start_frame": 0, "in_frame": 0, "length": 24,
                  "caption": {"words": [{"text": "hi", "start_frame": 0, "end_frame": 10}],
                              "preset": "clean", "font_family": "Inter", "font_size": 0.05,
                              "color": "#ffffff", "highlight_color": "#ffe14d", "y": 0.85}},
             ]},
        ],
    }


def test_is_edit_state_accepts_v1_and_v2():
    assert NT._is_edit_state({"version": 1, "tracks": []})
    assert NT._is_edit_state(_v2_state())


def test_is_edit_state_rejects_garbage():
    assert not NT._is_edit_state(None)
    assert not NT._is_edit_state("nope")
    assert not NT._is_edit_state({"version": 3, "tracks": []})
    assert not NT._is_edit_state({"version": 2})          # no tracks
    assert not NT._is_edit_state({"version": 2, "tracks": "x"})


def test_adapt_edit_state_flattens_v2_and_skips_captions():
    flat = NT._adapt_edit_state(_v2_state())
    assert flat["fps"] == 30
    assert flat["canvas_width"] == 640
    # The image clip survives; the caption clip (no pixels to draw yet) does not.
    kinds = [c["kind"] for c in flat["clips"]]
    assert kinds == ["image"]


def test_adapt_edit_state_passthrough_for_non_edit_state():
    legacy = {"fps": 30, "clips": []}
    assert NT._adapt_edit_state(legacy) is legacy


def test_interp_transform_mirrors_ts():
    # Same cases/numbers as frontend/tests/unit/interpolate.unit.spec.ts.
    static = {"x": 0.2, "y": 0.0, "rotation": 0.0, "scale": 1.5, "opacity": 1.0}
    assert NT._interp_transform(static, None, 10) == static

    kfs = [
        {"frame": 0, "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1},
        {"frame": 10, "x": 1, "y": -1, "rotation": 90, "scale": 2, "opacity": 0},
    ]
    tf = NT._interp_transform(static, kfs, 5)
    assert abs(tf["x"] - 0.5) < 1e-9
    assert abs(tf["rotation"] - 45.0) < 1e-9
    assert abs(tf["opacity"] - 0.5) < 1e-9

    eased = [
        {"frame": 0, "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1, "ease": "easeInOut"},
        {"frame": 10, "x": 1, "y": 0, "rotation": 0, "scale": 1, "opacity": 1},
    ]
    assert abs(NT._interp_transform(static, eased, 2.5)["x"] - 0.15625) < 1e-9

    clamped = [
        {"frame": 5, "x": 0.3, "y": 0, "rotation": 0, "scale": 1, "opacity": 1},
        {"frame": 10, "x": 0.9, "y": 0, "rotation": 0, "scale": 1, "opacity": 1},
    ]
    assert abs(NT._interp_transform(static, clamped, 0)["x"] - 0.3) < 1e-9
    assert abs(NT._interp_transform(static, clamped, 99)["x"] - 0.9) < 1e-9
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_state_test.py -v`
Expected: FAIL — `_is_edit_state` does not exist. (If the module import itself fails on missing comfy deps, mirror whatever `test_compositor_blend_conformance.py` does to import — it loads a sibling module from the same package successfully.)

- [ ] **Step 3: Add `_is_edit_state` to `comfy_extras/nodes_timeline.py`**

Directly above `_adapt_edit_state` (line ~525), add:

```python
_EDIT_STATE_VERSIONS = (1, 2)


def _is_edit_state(state) -> bool:
    """True when `state` is the editor's EditState (shared/timeline/types.ts),
    any supported version. v2 adds transitions[], per-clip speed/reverse/filters,
    captions, mattes — fields this renderer doesn't draw yet (Phase 2+); it must
    still accept v2 and render the parts it knows."""
    return (
        isinstance(state, dict)
        and state.get("version") in _EDIT_STATE_VERSIONS
        and isinstance(state.get("tracks"), list)
    )
```

- [ ] **Step 4: Replace the four version gates**

1. `TimelineNode.execute` (line ~229): replace
   `if isinstance(state, dict) and state.get("version") == 1:` with
   `if _is_edit_state(state):`
2. `_adapt_edit_state` (line ~534): replace
   `if state.get("version") != 1:` with
   `if not _is_edit_state(state):`
3. `/comfynext/render_timeline_stream` route (line ~822): replace
   `if state.get("version") == 1:` with
   `if _is_edit_state(state):`
4. `/comfynext/render_timeline` route (line ~882): replace
   `if state.get("version") == 1:` with
   `if _is_edit_state(state):`

Also update the two docstrings that say "version: 1" (`_execute_edit_state`, `_adapt_edit_state`) to say "any supported version (see `_is_edit_state`)".

- [ ] **Step 4b: Skip caption clips in `_adapt_edit_state`**

Without this, a v2 caption clip lands in the flat clip list with no `path` — harmless today (the prepare loop drops pathless clips) but it would count as a renderable clip and trip future logic. Make the skip explicit. In `_adapt_edit_state`'s clip loop, after the `if kind == "audio":` block, add:

```python
            if kind == "caption":
                # v2 captions have no export rendering yet (Phase 3 adds it).
                continue
```

(The node-run path `_execute_edit_state` already skips unknown kinds naturally — `src` stays `None`.)

- [ ] **Step 5: Run to verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_state_test.py -v`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/nodes_timeline.py tests-unit/comfy_extras_test/timeline_state_test.py
git commit -m "Timeline: accept EditState v2 across node run + render routes; mirror TS interpolation tests in Python"
```

---

## Task 6: Extract `render_frame_np` from the export loop

The per-frame composite buried in `render_timeline_to_file` (lines ~707–750) becomes a reusable function — the single source of export-path pixel math for the export loop, the golden CLI (Task 8), and the frame endpoint (Task 9).

**Files:**
- Modify: `comfy_extras/nodes_timeline.py`
- Test: `tests-unit/comfy_extras_test/timeline_render_frame_test.py`

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/timeline_render_frame_test.py`:

```python
"""Unit tests for render_frame_np — the single-frame composite the FFmpeg
export, the golden harness, and /comfynext/timeline/render_frame all share."""
import importlib.util
import os
import sys

import numpy as np
from PIL import Image

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _load_nodes_timeline():
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    spec = importlib.util.spec_from_file_location(
        "nodes_timeline_under_test",
        os.path.join(REPO_ROOT, "comfy_extras", "nodes_timeline.py"),
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


NT = _load_nodes_timeline()


def _solid_png(tmp_path, name, rgb, size=(64, 36)):
    p = os.path.join(str(tmp_path), name)
    Image.new("RGB", size, rgb).save(p)
    return p


def _flat_state(clips, w=64, h=36, total=10, bg="#000000"):
    return {
        "fps": 30, "total_frames": total,
        "canvas_width": w, "canvas_height": h, "bg_color": bg,
        "clips": clips,
    }


def test_background_only(tmp_path):
    state = _flat_state([], bg="#336699")
    clips = NT._prepare_render_clips(state)
    try:
        arr = NT.render_frame_np(state, clips, 0)
    finally:
        NT._close_render_clips(clips)
    assert arr.shape == (36, 64, 3)
    assert np.allclose(arr[18, 32], [0x33 / 255, 0x66 / 255, 0x99 / 255], atol=1e-6)


def test_image_clip_covers_canvas_inside_its_range(tmp_path):
    path = _solid_png(tmp_path, "red.png", (255, 0, 0))
    state = _flat_state([{
        "kind": "image", "path": path, "start_frame": 2, "length": 5,
        "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1,
        "blend": "normal", "fade_in": 0, "fade_out": 0,
    }])
    clips = NT._prepare_render_clips(state)
    try:
        before = NT.render_frame_np(state, clips, 1)   # before the clip → bg
        inside = NT.render_frame_np(state, clips, 4)   # inside → red
        after = NT.render_frame_np(state, clips, 8)    # after → bg
    finally:
        NT._close_render_clips(clips)
    assert np.allclose(before[18, 32], [0, 0, 0], atol=1e-6)
    assert np.allclose(inside[18, 32], [1, 0, 0], atol=2 / 255)
    assert np.allclose(after[18, 32], [0, 0, 0], atol=1e-6)


def test_opacity_blends_toward_background(tmp_path):
    path = _solid_png(tmp_path, "white.png", (255, 255, 255))
    state = _flat_state([{
        "kind": "image", "path": path, "start_frame": 0, "length": 10,
        "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 0.5,
        "blend": "normal", "fade_in": 0, "fade_out": 0,
    }])
    clips = NT._prepare_render_clips(state)
    try:
        arr = NT.render_frame_np(state, clips, 5)
    finally:
        NT._close_render_clips(clips)
    assert np.allclose(arr[18, 32], [0.5, 0.5, 0.5], atol=2 / 255)


def test_keyframed_opacity_interpolates(tmp_path):
    path = _solid_png(tmp_path, "white.png", (255, 255, 255))
    state = _flat_state([{
        "kind": "image", "path": path, "start_frame": 0, "length": 11,
        "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1,
        "blend": "normal", "fade_in": 0, "fade_out": 0,
        "keyframes": [
            {"frame": 0, "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 0},
            {"frame": 10, "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1},
        ],
    }], total=11)
    clips = NT._prepare_render_clips(state)
    try:
        arr = NT.render_frame_np(state, clips, 5)
    finally:
        NT._close_render_clips(clips)
    assert np.allclose(arr[18, 32], [0.5, 0.5, 0.5], atol=2 / 255)
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_render_frame_test.py -v`
Expected: FAIL — `_prepare_render_clips` not defined.

- [ ] **Step 3: Refactor `render_timeline_to_file`**

In `comfy_extras/nodes_timeline.py`, directly above `render_timeline_to_file`, add the three functions. `_prepare_render_clips` is the existing clip-opening loop moved verbatim (lines ~628–678); `render_frame_np` is the existing per-frame composite moved verbatim (lines ~708–750):

```python
def _prepare_render_clips(state: dict) -> list[dict]:
    """Open per-clip decoders / pre-load images / pre-render text for
    render_frame_np. The caller owns the returned containers — close with
    _close_render_clips()."""
    import av

    W = int(state.get("canvas_width", 1280))
    H = int(state.get("canvas_height", 720))
    clips: list[dict] = []
    for c in state.get("clips", []):
        # ... body of the existing loop from render_timeline_to_file,
        #     moved verbatim (text pre-render, image open, av.open) ...
    return clips


def _close_render_clips(clips: list[dict]) -> None:
    for L in clips:
        if "container" in L:
            try:
                L["container"].close()
            except Exception:
                pass


def render_frame_np(state: dict, clips: list[dict], f: int) -> np.ndarray:
    """Composite output frame `f` of the flat timeline `state` (the
    render_timeline_to_file shape) over its bg color. Returns float32 [H,W,3]
    in [0,1]. Single source of export-path pixel math: the FFmpeg export loop,
    the golden-frame harness, and /comfynext/timeline/render_frame all call
    this — divergence between them is impossible by construction."""
    fps = int(state.get("fps", 30))
    W = int(state.get("canvas_width", 1280))
    H = int(state.get("canvas_height", 720))
    bg_rgb = _hex_rgb_safe(state.get("bg_color"), (0.0, 0.0, 0.0))
    bg = np.array(bg_rgb, dtype=np.float32).reshape(1, 1, 3)
    canvas = np.broadcast_to(bg, (H, W, 3)).copy()

    for L in clips:
        # ... body of the existing per-clip composite from the export loop,
        #     moved verbatim (fade math, _decoded_frame_at, _interp_transform,
        #     _transform_and_alpha, _blend_np) ...

    return np.clip(canvas, 0.0, 1.0)
```

Then shrink `render_timeline_to_file` to use them — the clip-opening loop becomes:

```python
    clips = _prepare_render_clips(state)
```

the frame loop body becomes:

```python
    for f in range(total_frames):
        out_frame_arr = (render_frame_np(state, clips, f) * 255.0).astype(np.uint8)
        av_frame = av.VideoFrame.from_ndarray(out_frame_arr, format="rgb24")
        for packet in out_stream.encode(av_frame):
            out.mux(packet)

        if progress is not None:
            try:
                progress(f + 1, total_frames)
            except Exception:
                pass
```

and the input-closing loop at the end becomes:

```python
    _close_render_clips(clips)
```

**Move, don't rewrite:** the loop bodies transplant unchanged. The only edits are indentation and replacing the loop-local names (`f`, `canvas`) consistently. `_prepare_render_clips` keeps the same skip behavior (missing path → clip dropped). `render_frame_np` reads `fps` for video-clip seeking (`local_sec = (local_f + in_frame) / fps`) — keep that line intact.

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_render_frame_test.py tests-unit/comfy_extras_test/timeline_state_test.py -v`
Expected: all PASS.

- [ ] **Step 5: Export-path characterization — full render still produces a video**

Add to `tests-unit/comfy_extras_test/timeline_render_frame_test.py`:

```python
def test_render_timeline_to_file_still_works(tmp_path):
    path = _solid_png(tmp_path, "red.png", (255, 0, 0))
    state = _flat_state([{
        "kind": "image", "path": path, "start_frame": 0, "length": 10,
        "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1,
        "blend": "normal", "fade_in": 0, "fade_out": 0,
    }])
    meta = NT.render_timeline_to_file(state, str(tmp_path))
    out = os.path.join(str(tmp_path), meta["filename"])
    assert os.path.exists(out)
    assert meta["frames"] == 10
    assert meta["size_bytes"] > 0
```

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_render_frame_test.py -v`
Expected: all PASS (this test needs PyAV, present in `.venv` since exports work).

- [ ] **Step 6: Commit**

```bash
git add comfy_extras/nodes_timeline.py tests-unit/comfy_extras_test/timeline_render_frame_test.py
git commit -m "Timeline: extract render_frame_np/_prepare_render_clips from the export loop (single source of frame math)"
```

---

## Task 7: Golden fixtures — synthetic assets + fixture timelines

Deterministic, committed inputs for the parity harness. Pure-numpy gradients only: no fonts, no video decode, no randomness — byte-stable across machines. Fixtures are real `EditState` v2 JSON (so TS can validate them too) with a `_golden` extension key naming the frames to sample. Image clips carry fixture-relative `path`s; tooling absolutizes them.

**Files:**
- Create: `tests-unit/timeline_fixtures/generate_assets.py`
- Create: `tests-unit/timeline_fixtures/assets/` (4 generated PNGs, committed)
- Create: `tests-unit/timeline_fixtures/01-static-blends.json`
- Create: `tests-unit/timeline_fixtures/02-keyframes.json`
- Create: `tests-unit/timeline_fixtures/03-fades-stack.json`
- Test: `frontend/tests/unit/fixtures.unit.spec.ts`

- [ ] **Step 1: Create the asset generator**

Create `tests-unit/timeline_fixtures/generate_assets.py`:

```python
"""Deterministic synthetic media for the timeline golden fixtures.

Regenerate with:  .venv/bin/python tests-unit/timeline_fixtures/generate_assets.py
Outputs are committed; regeneration must stay byte-stable — pure numpy ramps,
no text/fonts, no randomness, no timestamps.
"""
import os

import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
W, H = 320, 180


def _save(name: str, arr: np.ndarray) -> None:
    Image.fromarray(arr.astype(np.uint8)).save(os.path.join(OUT, name), optimize=False)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    x = np.linspace(0.0, 255.0, W)[None, :].repeat(H, 0)
    y = np.linspace(0.0, 255.0, H)[:, None].repeat(W, 1)
    zeros = np.zeros((H, W))

    _save("gradient_a.png", np.stack([x, zeros, 255.0 - x], axis=-1))          # red → blue, horizontal
    _save("gradient_b.png", np.stack([255.0 - y, y, 255.0 - y], axis=-1))      # magenta → green, vertical
    cell = (np.add.outer(np.arange(H) // 24, np.arange(W) // 24) % 2) * 255.0
    _save("checker.png", np.stack([cell, cell, cell], axis=-1))
    _save("solid_orange.png", np.broadcast_to(np.array([255.0, 140.0, 0.0]), (H, W, 3)).copy())


if __name__ == "__main__":
    main()
```

Run: `.venv/bin/python tests-unit/timeline_fixtures/generate_assets.py`
Expected: 4 PNGs in `tests-unit/timeline_fixtures/assets/`.
Run it twice and `git status` / `md5 tests-unit/timeline_fixtures/assets/*` to confirm byte-stability.

- [ ] **Step 2: Create fixture 01 — static transforms + every blend mode**

`x`/`y` are normalized fractions of canvas size offset from center (see `_transform_and_alpha`: `cx = W//2 + round(x*W) - fw//2`). Canvas 640×360, 24 frames, sampled at `[0, 12, 23]`.

Create `tests-unit/timeline_fixtures/01-static-blends.json`:

```json
{
  "version": 2,
  "_golden": { "frames": [0, 12, 23] },
  "canvas": { "width": 640, "height": 360, "fps": 30, "bg_color": "#202020" },
  "total_frames": 24,
  "transitions": [],
  "tracks": [
    {
      "id": "t1", "kind": "video", "name": "Video 1", "muted": false, "locked": false,
      "clips": [
        { "id": "c1", "kind": "image", "asset_id": "gradient_a", "path": "assets/gradient_a.png",
          "start_frame": 0, "in_frame": 0, "length": 24,
          "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1, "blend": "normal" },
        { "id": "c2", "kind": "image", "asset_id": "checker", "path": "assets/checker.png",
          "start_frame": 0, "in_frame": 0, "length": 24,
          "x": -0.18, "y": -0.12, "rotation": 15, "scale": 0.5, "opacity": 1, "blend": "multiply" },
        { "id": "c3", "kind": "image", "asset_id": "gradient_b", "path": "assets/gradient_b.png",
          "start_frame": 0, "in_frame": 0, "length": 24,
          "x": 0.18, "y": -0.12, "rotation": -10, "scale": 0.5, "opacity": 0.85, "blend": "screen" },
        { "id": "c4", "kind": "image", "asset_id": "solid_orange", "path": "assets/solid_orange.png",
          "start_frame": 0, "in_frame": 0, "length": 24,
          "x": -0.18, "y": 0.14, "rotation": 0, "scale": 0.4, "opacity": 1, "blend": "overlay" },
        { "id": "c5", "kind": "image", "asset_id": "gradient_a", "path": "assets/gradient_a.png",
          "start_frame": 0, "in_frame": 0, "length": 24,
          "x": 0.18, "y": 0.14, "rotation": 30, "scale": 0.4, "opacity": 0.7, "blend": "difference" },
        { "id": "c6", "kind": "image", "asset_id": "gradient_b", "path": "assets/gradient_b.png",
          "start_frame": 6, "in_frame": 0, "length": 12,
          "x": 0, "y": 0.25, "rotation": 0, "scale": 0.3, "opacity": 1, "blend": "add" }
      ]
    }
  ]
}
```

- [ ] **Step 3: Create fixture 02 — keyframed motion with both easings**

Create `tests-unit/timeline_fixtures/02-keyframes.json`:

```json
{
  "version": 2,
  "_golden": { "frames": [0, 6, 12, 18, 23] },
  "canvas": { "width": 640, "height": 360, "fps": 30, "bg_color": "#101018" },
  "total_frames": 24,
  "transitions": [],
  "tracks": [
    {
      "id": "t1", "kind": "video", "name": "Video 1", "muted": false, "locked": false,
      "clips": [
        { "id": "k1", "kind": "image", "asset_id": "solid_orange", "path": "assets/solid_orange.png",
          "start_frame": 0, "in_frame": 0, "length": 24, "blend": "normal",
          "keyframes": [
            { "frame": 0,  "x": -0.3, "y": -0.2, "rotation": 0,   "scale": 0.3, "opacity": 0.2, "ease": "linear" },
            { "frame": 12, "x": 0.0,  "y": 0.0,  "rotation": 180, "scale": 0.6, "opacity": 1.0, "ease": "easeInOut" },
            { "frame": 23, "x": 0.3,  "y": 0.2,  "rotation": 360, "scale": 0.3, "opacity": 0.4 }
          ] },
        { "id": "k2", "kind": "image", "asset_id": "checker", "path": "assets/checker.png",
          "start_frame": 4, "in_frame": 0, "length": 16, "blend": "screen",
          "keyframes": [
            { "frame": 0,  "x": 0.25,  "y": 0.0, "rotation": 0,  "scale": 0.5, "opacity": 1.0, "ease": "easeInOut" },
            { "frame": 15, "x": -0.25, "y": 0.0, "rotation": 45, "scale": 0.25, "opacity": 0.5 }
          ] }
      ]
    }
  ]
}
```

- [ ] **Step 4: Create fixture 03 — fades, paint order, in_frame offsets**

Create `tests-unit/timeline_fixtures/03-fades-stack.json`:

```json
{
  "version": 2,
  "_golden": { "frames": [0, 3, 8, 15, 21, 23] },
  "canvas": { "width": 640, "height": 360, "fps": 30, "bg_color": "#000000" },
  "total_frames": 24,
  "transitions": [],
  "tracks": [
    {
      "id": "t1", "kind": "video", "name": "Back", "muted": false, "locked": false,
      "clips": [
        { "id": "f1", "kind": "image", "asset_id": "gradient_a", "path": "assets/gradient_a.png",
          "start_frame": 0, "in_frame": 0, "length": 24,
          "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1, "blend": "normal",
          "fade_in": 6, "fade_out": 6 }
      ]
    },
    {
      "id": "t2", "kind": "video", "name": "Front", "muted": false, "locked": false,
      "clips": [
        { "id": "f2", "kind": "image", "asset_id": "gradient_b", "path": "assets/gradient_b.png",
          "start_frame": 4, "in_frame": 3, "length": 14,
          "x": 0.1, "y": 0.1, "rotation": 0, "scale": 0.55, "opacity": 0.9, "blend": "normal",
          "fade_in": 4, "fade_out": 5 },
        { "id": "f3", "kind": "image", "asset_id": "checker", "path": "assets/checker.png",
          "start_frame": 16, "in_frame": 0, "length": 8,
          "x": -0.15, "y": -0.1, "rotation": 5, "scale": 0.4, "opacity": 1, "blend": "normal",
          "fade_in": 2, "fade_out": 0 }
      ]
    },
    {
      "id": "t3", "kind": "video", "name": "Muted", "muted": true, "locked": false,
      "clips": [
        { "id": "f4", "kind": "image", "asset_id": "solid_orange", "path": "assets/solid_orange.png",
          "start_frame": 0, "in_frame": 0, "length": 24,
          "x": 0, "y": 0, "rotation": 0, "scale": 1, "opacity": 1, "blend": "normal" }
      ]
    }
  ]
}
```

Note the muted track: it must NOT appear in renders (`_adapt_edit_state` skips muted tracks) — that's part of what the goldens lock in.

- [ ] **Step 5: TS-side fixture validation (failing first)**

Create `frontend/tests/unit/fixtures.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { migrateEditState } from '../../shared/timeline/types'

// The golden fixtures are real EditState JSON — if the type vocabulary drifts
// (a renamed field, a new required key), this catches it from the TS side.
const fixturesDir = fileURLToPath(new URL('../../../tests-unit/timeline_fixtures', import.meta.url))

describe('golden fixtures are valid EditStates', () => {
  const files = readdirSync(fixturesDir).filter(f => f.endsWith('.json'))

  it('found the fixture files', () => {
    expect(files.length).toBeGreaterThanOrEqual(3)
  })

  for (const f of files) {
    it(`${f} migrates cleanly and declares golden frames`, () => {
      const raw = JSON.parse(readFileSync(`${fixturesDir}/${f}`, 'utf-8'))
      expect(Array.isArray(raw._golden?.frames)).toBe(true)
      expect(raw._golden.frames.length).toBeGreaterThan(0)
      const state = migrateEditState(raw)
      expect(state).not.toBeNull()
      expect(state!.total_frames).toBeGreaterThan(0)
      for (const frame of raw._golden.frames) {
        expect(frame).toBeLessThan(state!.total_frames)
      }
    })
  }
})
```

Run: `cd frontend && npm run test:unit`
Expected: PASS (fixtures exist from steps 2–4; if you wrote this test first it failed on the missing directory — either order is fine, just confirm it goes green against the real fixtures).

- [ ] **Step 6: Commit**

```bash
git add tests-unit/timeline_fixtures frontend/tests/unit/fixtures.unit.spec.ts
git commit -m "Timeline: deterministic golden fixtures — synthetic assets + 3 EditState v2 fixture timelines"
```

---

## Task 8: Golden renderer CLI + committed goldens + pytest gate

`scripts/timeline_golden.py` regenerates goldens; the pytest re-renders and diffs against the committed PNGs. A negative control proves the gate actually catches divergence. Note: `scripts/` exists but is untracked (only `start_workers.sh`) — this task makes it real.

**Files:**
- Create: `scripts/timeline_golden.py`
- Create: `tests-unit/timeline_golden/` (committed golden PNGs)
- Test: `tests-unit/comfy_extras_test/timeline_golden_test.py`

- [ ] **Step 1: Create `scripts/timeline_golden.py`**

```python
"""Timeline golden-frame tooling.

Regenerate goldens:   .venv/bin/python scripts/timeline_golden.py
Goldens live in tests-unit/timeline_golden/<fixture-stem>/f<NNN>.png and are
committed. tests-unit/comfy_extras_test/timeline_golden_test.py re-renders the
fixtures and diffs against them — the gate that keeps the Python exporter
(and, from Phase 1, the WebGL preview engine) pixel-stable.

Only regenerate when a pixel-math change is INTENDED, and eyeball the new
frames before committing.
"""
import importlib.util
import json
import os
import sys

import numpy as np
from PIL import Image

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
FIXTURES_DIR = os.path.join(REPO_ROOT, "tests-unit", "timeline_fixtures")
GOLDEN_DIR = os.path.join(REPO_ROOT, "tests-unit", "timeline_golden")

# Anything beyond quantisation rounding is a visible drift.
TOL_MAX = 2.0 / 255.0
TOL_MEAN = 0.5 / 255.0


_NT = None


def load_nodes_timeline():
    """Import comfy_extras/nodes_timeline.py once and cache it — re-executing
    the module per call is slow and would re-register server routes when a
    PromptServer exists."""
    global _NT
    if _NT is not None:
        return _NT
    if REPO_ROOT not in sys.path:
        sys.path.insert(0, REPO_ROOT)
    spec = importlib.util.spec_from_file_location(
        "nodes_timeline_golden", os.path.join(REPO_ROOT, "comfy_extras", "nodes_timeline.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    _NT = module
    return _NT


def fixture_paths() -> list[str]:
    return sorted(
        os.path.join(FIXTURES_DIR, f)
        for f in os.listdir(FIXTURES_DIR)
        if f.endswith(".json")
    )


def load_fixture(path: str) -> tuple[dict, list[int]]:
    """Read a fixture EditState, absolutize clip paths, flatten for the export
    renderer. Returns (flat_state, golden_frames)."""
    with open(path) as fh:
        raw = json.load(fh)
    frames = list(raw.get("_golden", {}).get("frames", []))
    for track in raw.get("tracks", []):
        for clip in track.get("clips", []):
            p = clip.get("path")
            if p and not os.path.isabs(p):
                clip["path"] = os.path.join(FIXTURES_DIR, p)
    nt = load_nodes_timeline()
    return nt._adapt_edit_state(raw), frames


def render_fixture_frames(path: str) -> dict[int, np.ndarray]:
    """Render every golden-sampled frame of one fixture. {frame: float32 HxWx3}."""
    nt = load_nodes_timeline()
    state, frames = load_fixture(path)
    clips = nt._prepare_render_clips(state)
    try:
        return {f: nt.render_frame_np(state, clips, f) for f in frames}
    finally:
        nt._close_render_clips(clips)


def golden_path(fixture_path: str, frame: int) -> str:
    stem = os.path.splitext(os.path.basename(fixture_path))[0]
    return os.path.join(GOLDEN_DIR, stem, f"f{frame:03d}.png")


def main() -> None:
    for fp in fixture_paths():
        rendered = render_fixture_frames(fp)
        for frame, arr in rendered.items():
            out = golden_path(fp, frame)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            Image.fromarray((arr * 255.0).round().astype(np.uint8)).save(out, optimize=False)
            print(f"wrote {os.path.relpath(out, REPO_ROOT)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Generate and inspect the goldens**

Run: `.venv/bin/python scripts/timeline_golden.py`
Expected: 14 PNGs printed (3 + 5 + 6 frames across the three fixtures).

**Eyeball them** (Read tool or `open tests-unit/timeline_golden/`): fixture 01 shows a gradient background with 5 rotated/scaled patches in distinct blend looks (the `add` patch appears only in f012); fixture 02 shows the orange square mid-flight at different positions/rotations per frame; fixture 03 shows fades ramping (f000 nearly black, f008 fully lit) and NO solid-orange full-canvas wash (muted track). If anything looks degenerate (blank frames, clip off-canvas), fix the fixture values, regenerate, re-eyeball.

- [ ] **Step 3: Write the pytest gate (failing first — write before generating? No: the goldens must exist for the happy path, so this test goes red only via the negative control. Write it now and run it.)**

Create `tests-unit/comfy_extras_test/timeline_golden_test.py`:

```python
"""Golden-frame gate: re-render every fixture frame and diff against the
committed goldens. This is the parity contract the Phase-1 WebGL engine will
also be held to (via the Playwright harness). Regenerate goldens ONLY for
intended pixel-math changes: .venv/bin/python scripts/timeline_golden.py
"""
import importlib.util
import os
import sys

import numpy as np
import pytest
from PIL import Image

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _load_golden_tools():
    spec = importlib.util.spec_from_file_location(
        "timeline_golden", os.path.join(REPO_ROOT, "scripts", "timeline_golden.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


G = _load_golden_tools()


def _load_png(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255.0


@pytest.mark.parametrize("fixture_path", G.fixture_paths(), ids=os.path.basename)
def test_render_matches_committed_goldens(fixture_path):
    rendered = G.render_fixture_frames(fixture_path)
    assert rendered, f"fixture {fixture_path} declares no golden frames"
    for frame, arr in rendered.items():
        gp = G.golden_path(fixture_path, frame)
        assert os.path.exists(gp), f"missing golden {gp} — run scripts/timeline_golden.py"
        golden = _load_png(gp)
        assert golden.shape == arr.shape
        diff = np.abs(arr - golden)
        assert diff.max() <= G.TOL_MAX, (
            f"{os.path.basename(fixture_path)} frame {frame}: max diff "
            f"{diff.max():.5f} > {G.TOL_MAX:.5f}")
        assert diff.mean() <= G.TOL_MEAN, (
            f"{os.path.basename(fixture_path)} frame {frame}: mean diff "
            f"{diff.mean():.5f} > {G.TOL_MEAN:.5f}")


def test_gate_catches_divergence():
    """Negative control: a perturbed render MUST fail the tolerance — proves
    the harness can actually catch preview/export drift."""
    fp = G.fixture_paths()[0]
    state, frames = G.load_fixture(fp)
    # Halve the first clip's opacity — a typical "math drifted" bug.
    state["clips"][0]["opacity"] = state["clips"][0].get("opacity", 1.0) * 0.5
    nt = G.load_nodes_timeline()
    clips = nt._prepare_render_clips(state)
    try:
        arr = nt.render_frame_np(state, clips, frames[0])
    finally:
        nt._close_render_clips(clips)
    golden = _load_png(G.golden_path(fp, frames[0]))
    assert np.abs(arr - golden).max() > G.TOL_MAX
```

- [ ] **Step 4: Run the gate**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/timeline_golden_test.py -v`
Expected: 4 PASS (3 fixture comparisons + negative control).

Determinism double-check: run it a second time — still green (PIL resize/rotate are deterministic on one machine; if CI later runs a different PIL build and drifts beyond tolerance, the tolerance constants in `scripts/timeline_golden.py` are the single knob).

- [ ] **Step 5: Commit**

```bash
git add scripts/timeline_golden.py tests-unit/timeline_golden tests-unit/comfy_extras_test/timeline_golden_test.py
git commit -m "Timeline: golden-frame harness — CLI, committed goldens, pytest gate with negative control"
```

---

## Task 9: `PreviewRenderer` interface + server frame endpoint + harness page

The seam the Phase-1 WebGL engine slots into. `ServerFrameRenderer` is the ground-truth implementation (asks Python for each frame); the harness page exposes a tiny `window.__timelineHarness` API for Playwright.

**Files:**
- Create: `frontend/shared/timeline/previewRenderer.ts`
- Create: `frontend/app/lib/serverFrameRenderer.ts`
- Create: `frontend/app/pages/timeline-harness.vue`
- Modify: `comfy_extras/nodes_timeline.py` (new route)

- [ ] **Step 1: Create `frontend/shared/timeline/previewRenderer.ts`**

```ts
import type { EditState } from './types'

// Contract every timeline preview backend implements. The editor and the
// Playwright golden harness talk only to this — the server-frame renderer
// (ground truth, slow) and the Phase-1 WebGL engine (fast) are interchangeable
// behind it. renderFrame() must draw the exact requested frame: no
// "close enough" seeking, that's the whole point.
export interface PreviewRenderer {
  /** Prepare sources for `state`. Call again whenever the state changes. */
  load(state: EditState): Promise<void>
  /** Draw output frame `frame` into `target` at state.canvas resolution. */
  renderFrame(frame: number, target: HTMLCanvasElement): Promise<void>
  dispose(): void
}
```

- [ ] **Step 2: Add the frame endpoint to `comfy_extras/nodes_timeline.py`**

Inside the existing `try: from server import PromptServer ...` block, after the `/comfynext/render_timeline` route, add:

```python
    @PromptServer.instance.routes.post("/comfynext/timeline/render_frame")
    async def _render_frame_route(request):
        """Render one composited frame of an edit state to PNG. Harness/debug
        surface: the browser golden harness compares PreviewRenderer output
        against this — the same render_frame_np the export uses."""
        try:
            body = await request.json()
        except Exception:
            return web.json_response({"error": "invalid json"}, status=400)
        state = body.get("state")
        frame = int(body.get("frame", 0))
        if _is_edit_state(state):
            state = _adapt_edit_state(state)
        if not isinstance(state, dict) or not isinstance(state.get("clips"), list):
            return web.json_response({"error": "not an edit state"}, status=400)

        def _render() -> bytes:
            from io import BytesIO
            clips = _prepare_render_clips(state)
            try:
                arr = render_frame_np(state, clips, frame)
            finally:
                _close_render_clips(clips)
            buf = BytesIO()
            PILImage.fromarray((arr * 255.0).round().astype(np.uint8)).save(buf, format="PNG")
            return buf.getvalue()

        data = await asyncio.get_event_loop().run_in_executor(None, _render)
        return web.Response(body=data, content_type="image/png")
```

(Confirm `PILImage`/`np` are the module-level import names used elsewhere in the file — they are at the top of `nodes_timeline.py`; `asyncio` is imported inside the PromptServer block.)

- [ ] **Step 3: Create `frontend/app/lib/serverFrameRenderer.ts`**

```ts
import type { EditState } from '~~/shared/timeline/types'
import type { PreviewRenderer } from '~~/shared/timeline/previewRenderer'

// PreviewRenderer that asks the Python exporter for each frame
// (/comfynext/timeline/render_frame → render_frame_np). Slow by design — it
// exists as ground truth: it validates the harness pipeline in Phase 0 and is
// the reference the WebGL engine gets diffed against during Phase-1 bring-up.
export class ServerFrameRenderer implements PreviewRenderer {
  private state: EditState | null = null

  async load(state: EditState): Promise<void> {
    this.state = state
  }

  async renderFrame(frame: number, target: HTMLCanvasElement): Promise<void> {
    if (!this.state) throw new Error('ServerFrameRenderer: load() first')
    const res = await fetch('/comfynext/timeline/render_frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: this.state, frame }),
    })
    if (!res.ok) throw new Error(`render_frame failed: ${res.status}`)
    const bmp = await createImageBitmap(await res.blob())
    target.width = bmp.width
    target.height = bmp.height
    target.getContext('2d')!.drawImage(bmp, 0, 0)
    bmp.close()
  }

  dispose(): void {
    this.state = null
  }
}
```

(The relative `/comfynext/...` fetch matches the existing convention, e.g. `useAssetLibrary.ts` — the Nuxt dev server proxies it to :8188.)

- [ ] **Step 4: Create `frontend/app/pages/timeline-harness.vue`**

```vue
<script setup lang="ts">
// Dev/test-only surface: Playwright drives window.__timelineHarness to render
// fixture frames through a PreviewRenderer and read pixels back. Not linked
// from anywhere in the app UI. Phase 1 registers 'webgl' as a second renderer
// kind here — the golden spec then runs against both.
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { migrateEditState } from '~~/shared/timeline/types'
import type { PreviewRenderer } from '~~/shared/timeline/previewRenderer'
import { ServerFrameRenderer } from '~/lib/serverFrameRenderer'

const canvas = ref<HTMLCanvasElement | null>(null)
const status = ref('idle')
let renderer: PreviewRenderer | null = null

onMounted(() => {
  ;(window as any).__timelineHarness = {
    async load(stateJson: string, kind: 'server' = 'server'): Promise<void> {
      const state = migrateEditState(JSON.parse(stateJson))
      if (!state) throw new Error('invalid edit state')
      renderer?.dispose()
      renderer = new ServerFrameRenderer()
      await renderer.load(state)
      status.value = `loaded (${kind})`
    },
    async renderFrame(frame: number): Promise<string> {
      if (!renderer || !canvas.value) throw new Error('load() first')
      await renderer.renderFrame(frame, canvas.value)
      status.value = `frame ${frame}`
      return canvas.value.toDataURL('image/png')
    },
  }
})

onBeforeUnmount(() => {
  renderer?.dispose()
  delete (window as any).__timelineHarness
})
</script>

<template>
  <div class="p-4 text-sm text-neutral-400">
    <div data-testid="harness-status">{{ status }}</div>
    <canvas ref="canvas" class="mt-2 border border-neutral-700" />
  </div>
</template>
```

- [ ] **Step 5: Manual smoke test** (both dev servers running; **restart the Python server first** — it must pick up the new route from Tasks 5/6/9's `nodes_timeline.py` changes. Per project practice: kill it, don't trust hot reload.)

Open `http://127.0.0.1:3002/timeline-harness` in a browser (or via the preview tools), then in the console:

```js
const r = await fetch('/comfynext/timeline/render_frame', {
  method: 'POST', headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({ state: { fps: 30, total_frames: 5, canvas_width: 64, canvas_height: 36, bg_color: '#336699', clips: [] }, frame: 0 }),
})
console.log(r.status, r.headers.get('content-type'))  // 200 'image/png'
```

Expected: `200 image/png`.

- [ ] **Step 6: Commit**

```bash
git add frontend/shared/timeline/previewRenderer.ts frontend/app/lib/serverFrameRenderer.ts frontend/app/pages/timeline-harness.vue comfy_extras/nodes_timeline.py
git commit -m "Timeline: PreviewRenderer seam + server ground-truth renderer + harness page + /timeline/render_frame route"
```

---

## Task 10: Playwright golden spec — browser pipeline vs committed goldens

Closes the loop: fixture → harness page → PreviewRenderer → canvas → pixel diff vs the committed golden PNGs. With `ServerFrameRenderer` this compares Python with Python — its value in Phase 0 is proving every link of the browser comparison pipeline (state injection, canvas draw, dataURL decode, diff math) so the Phase-1 WebGL renderer drops into a harness that already works.

**Files:**
- Modify: `frontend/package.json` (add `pngjs`)
- Test: `frontend/tests/timeline-golden.spec.ts`

- [ ] **Step 1: Install pngjs**

```bash
cd frontend && npm install -D pngjs @types/pngjs
```

- [ ] **Step 2: Write the spec**

Create `frontend/tests/timeline-golden.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import * as path from 'node:path'
import { PNG } from 'pngjs'

// Golden-frame parity: render fixture frames through the harness page's
// PreviewRenderer and diff against the committed Python goldens
// (tests-unit/timeline_golden). Phase 0 runs the ServerFrameRenderer (ground
// truth — validates the pipeline); Phase 1 points the same spec at the WebGL
// engine and this becomes the real parity gate.
//
// Requires both dev servers (see playwright.config.ts header) and a Python
// server new enough to have /comfynext/timeline/render_frame.

const repoRoot = path.resolve(__dirname, '../..')
const fixturesDir = path.join(repoRoot, 'tests-unit', 'timeline_fixtures')
const goldenDir = path.join(repoRoot, 'tests-unit', 'timeline_golden')

const TOL_MAX = 2 / 255
const TOL_MEAN = 0.5 / 255

function decodeDataUrl(dataUrl: string): PNG {
  return PNG.sync.read(Buffer.from(dataUrl.split(',')[1]!, 'base64'))
}

function diffStats(a: PNG, b: PNG): { max: number; mean: number } {
  if (a.width !== b.width || a.height !== b.height) return { max: 1, mean: 1 }
  let max = 0
  let sum = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[i + c]! - b.data[i + c]!) / 255
      if (d > max) max = d
      sum += d
      n++
    }
  }
  return { max, mean: sum / n }
}

const fixtures = readdirSync(fixturesDir).filter(f => f.endsWith('.json'))

for (const fixtureFile of fixtures) {
  test(`golden parity via harness: ${fixtureFile}`, async ({ page }) => {
    const raw = JSON.parse(readFileSync(path.join(fixturesDir, fixtureFile), 'utf-8'))
    const frames: number[] = raw._golden.frames
    // The Python endpoint runs on this machine — absolutize fixture paths.
    for (const track of raw.tracks) {
      for (const clip of track.clips) {
        if (clip.path && !path.isAbsolute(clip.path)) {
          clip.path = path.join(fixturesDir, clip.path)
        }
      }
    }

    await page.goto('/timeline-harness')
    await page.getByTestId('harness-status').waitFor()
    await page.evaluate(
      (stateJson) => (window as any).__timelineHarness.load(stateJson),
      JSON.stringify(raw),
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
      const { max, mean } = diffStats(rendered, golden)
      expect(max, `${stem} f${frame} max diff`).toBeLessThanOrEqual(TOL_MAX)
      expect(mean, `${stem} f${frame} mean diff`).toBeLessThanOrEqual(TOL_MEAN)
    }
  })
}
```

- [ ] **Step 3: Run it** (both servers running, Python server restarted with the new route)

Run: `cd frontend && npx playwright test tests/timeline-golden.spec.ts`
Expected: 3 PASS (one per fixture, 14 frame comparisons total).

If it fails on `harness-status` not appearing: check the route exists (`/timeline-harness` in the browser). If it fails on diff: confirm the Python server was restarted (stale server = no route = thrown fetch error, not a diff failure — a diff failure here would mean canvas PNG round-tripping isn't lossless, which it is for opaque pixels; investigate before touching tolerances).

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tests/timeline-golden.spec.ts
git commit -m "Timeline: Playwright golden spec — browser harness pipeline diffs PreviewRenderer output against committed goldens"
```

---

## Task 11: Full verification sweep

- [ ] **Step 1: Frontend unit tests**

Run: `cd frontend && npm run test:unit`
Expected: all PASS (interpolate, types, commands, fixtures).

- [ ] **Step 2: Python suites**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/ -v`
Expected: all PASS — including the pre-existing compositor conformance tests (proves the `nodes_timeline.py` edits broke nothing adjacent).

- [ ] **Step 3: E2E** (servers running, Python restarted)

Run: `cd frontend && npx playwright test tests/timeline.spec.ts tests/timeline-golden.spec.ts`
Expected: all PASS.

- [ ] **Step 4: Reconcile with the spec**

Re-read the Phase-0 row of `docs/plans/2026-06-09-capcut-parity-video-editor-design.md`. Confirm delivered: data-model extensions ✓ (Task 2), typed command layer ✓ (Tasks 3–4), golden-frame parity harness ✓ (Tasks 7–10), both renderers accept v2 ✓ (Tasks 4–5). Explicitly NOT delivered (by design): rendering of transitions/speed/filters/captions (Phase 2+), WebGL renderer (Phase 1), video-decode fixtures (Phase 1).

- [ ] **Step 5: Final commit (if any stragglers) and report**

```bash
git status --short
```

Expected: clean (except pre-existing unrelated modifications that were already dirty before this plan started — do NOT commit those).
