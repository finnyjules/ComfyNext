# Timeline CapCut-Comfort UX — Design

**Date:** 2026-07-16
**Status:** Approved design (Approach A: two lanes, vertical feature slices)
**Parent plan:** `docs/plans/2026-06-09-capcut-parity-video-editor-design.md` — this is
the UX-facing half of Phase 2, plus interaction polish that the parity plan assumed.

## Goal

A CapCut user opening the Timeline editor should find their muscle memory works
(drag between tracks, right-click, copy/paste, trim feedback) and the three most
visible missing features — transitions, speed/reverse, color adjust — exist and
render truthfully in preview and export.

## Scope decisions (made with Julien)

| Decision | Choice |
|---|---|
| Breadth | Interaction polish **and** surfacing the v2 schema features (transitions, speed/reverse, filters). |
| Preview engine for new render features | **WebGL + Python only.** The WebGL engine is promoted from opt-in flag to default-when-supported. Canvas2D remains as legacy fallback and does NOT get the new render features. |
| Structure | Two lanes. Lane 1 = pure-UI polish items, each independently landable. Lane 2 = vertical feature slices, each landing engine + Python + golden fixtures + UI together. |
| Lane 2 order | Engine promotion → speed/reverse → transitions → filters (risk-ascending; hardest slice lands on proven groundwork). |

## Current state (verified 2026-07-16)

- Live editor: `frontend/app/components/vue-canvas/TimelineEditor.vue` (opened from
  `VueNodeCanvas.vue`). `TimelineModal.vue` is the older surface, not in this scope.
- The v2 schema (`frontend/shared/timeline/types.ts`) and command layer
  (`frontend/shared/timeline/commands.ts`) already model transitions
  (add/update/remove commands, junction semantics), per-clip `speed`/`reverse`,
  and `ClipFilters` — **no UI dispatches any of them, and no render surface
  applies them.**
- `frontend/shared/timeline/sourceFrame.ts` implements the speed/reverse
  frame mapping in TS; the Python twin is explicitly deferred ("Phase 2" note in
  `comfy_extras/nodes_timeline.py:104`). Nothing imports sourceFrame.ts yet.
- Golden-frame harness exists: `scripts/timeline_golden.py`,
  `frontend/tests/timeline-golden.spec.ts`, `tests-unit/timeline_golden/`,
  `tests-unit/comfy_extras_test/timeline_golden_test.py`.
- WebGL engine (`usePlaybackEngineGL` + `frontend/app/lib/engine/…`) is opt-in via
  `localStorage 'sailor:Engine.WebGLPreview' = 'true'`, with Canvas2D fallback.

---

## Lane 1 — Interaction polish (UI-only)

All items live in `TimelineEditor.vue` (+ small store/command additions). No render
surface changes; no golden updates. Ordered roughly by CapCut-muscle-memory impact.

### 1.1 Cross-track clip drag
Dragging a clip vertically moves it to another track of the **same kind**
(video↔video, audio↔audio; captions tracks excluded).
- During a `move` drag, resolve the pointer's Y to a track lane. When it differs
  from the source track and kinds match and the target isn't locked, highlight the
  target lane and, on the fly, dispatch `move_clip` (command exists).
- Horizontal snapping continues to apply during vertical moves.
- Multi-select bulk drag stays horizontal-only (matches the common case; vertical
  bulk moves are rare even in CapCut).

### 1.2 Clip context menu (right-click)
A lightweight overlay menu (styled after `CanvasContextMenu.vue`, but local to the
editor since the editor is a fullscreen overlay outside the canvas iframe).

On a clip: **Split at playhead** (S, enabled only when playhead is inside the clip),
**Duplicate** (⌘D), **Copy** (⌘C), **Paste** (⌘V, enabled when clipboard non-empty),
**Delete** (⌫), **Ripple delete** (⌘⌫). Speed…/Adjust… entries are added by their
Lane 2 slices (they focus the relevant inspector section).

On empty track area: **Paste at pointer**, **Add video track**, **Add audio track**,
**Delete track** (disabled when it's the only track of its kind; confirm when the
track has clips).

On a track header: **Rename** (inline input), **Delete track** (same rules).

### 1.3 Copy / paste / duplicate
- Module-level clipboard in `useTimelineStore` holding deep-cloned clip payloads
  (multi-clip aware; survives clip deletion since it's a snapshot).
- **Copy** (⌘C): snapshot selected clips with their source-track kinds.
- **Paste** (⌘V): insert at playhead on the clips' original tracks when they still
  exist, else the first unlocked track of matching kind (create if none). Multi-clip
  paste preserves relative offsets; the earliest clip lands at the playhead. New
  UUIDs; single undo step (one `mutate`).
- **Duplicate** (⌘D): copy + paste immediately after the source clip on the same
  track (start = source end), no clipboard mutation.

### 1.4 Trim feedback + honest trimming
- While dragging a resize handle, show a floating bubble near the cursor:
  `2.5s · 75f` (new duration), plus the delta (e.g. `−0.5s`).
- **Left-edge trim shifts `in_frame`** by the same delta for video/audio clips
  (content stays anchored, CapCut behavior). Today it only changes
  start/length, silently re-timing the content. Clamp so `in_frame ≥ 0`.
- **Clamp trims to available source** where the asset duration is known
  (`asset.duration_sec × fps`, minus `in_frame`): the right edge stops at the last
  source frame and the clip edge flashes to signal the wall. Images/motion/workflow
  clips remain unbounded. (Once speed lands, the budget is
  `available_source / speed` — the slice updates this clamp.)

### 1.5 Seconds-first display
- Inspector Start / Length / In / Fade fields become seconds inputs (step 0.1,
  display `1.50s`) with the frame count as a small suffix label. Internal model
  stays frames; conversion at the edge, rounding to whole frames.
- Clip label's right-hand `{n}f` becomes duration in seconds (`2.5s`); frames stay
  in the tooltip.

### 1.6 Draggable fade handles
- Small corner handles at a clip's top-left/top-right (visible on hover/selection).
  Dragging horizontally sets `fade_in`/`fade_out`. A translucent triangle overlay
  renders the ramp (CapCut-style). Number inputs in the inspector remain.

### 1.7 Marquee selection + select-all
- Pointer-drag on empty track area draws a rubber-band; clips intersecting the rect
  are selected. Plain click on empty area clears the selection (new behavior — it
  replaces today's seek-on-click, which moves to the ruler).
- **Playhead scrubbing moves to the ruler**: pointer-down/drag on the ruler strip
  seeks (today the whole empty strip seeks — that conflicts with marquee). Clicking
  a clip still doesn't seek; Space/arrows unchanged.
- **⌘A** selects all clips on unlocked tracks.

### 1.8 Snap toggle
- Magnet icon in the transport bar toggles snapping (persisted via
  `useLocalSettings`). **Alt/Option while dragging temporarily inverts** the
  setting (CapCut/NLE convention).

### 1.9 Track header polish
- Audio tracks: mute toggle uses speaker icons (`Volume2`/`VolumeX`); video tracks
  keep the eye (visibility semantics are correct there).
- Rename via header context menu (1.2); double-click the name as a shortcut.
- Delete track via context menu (rules in 1.2). `remove_track` command exists.

### 1.10 Transport bar completeness
- Add **Split** (scissors, acts on selected clip at playhead) and **Delete** buttons
  beside the zoom cluster.
- Keyboard additions: **Home/End** → start/end of timeline. Shortcut hint strip
  gains the new entries (⌘C/⌘V/⌘D, ⌘A, Home/End, marquee, snap).

### 1.11 One undo step per gesture
Today every pointer-move tick during a drag dispatches a mutation, and every
dispatch pushes an undo snapshot — ⌘Z after a drag rewinds pixel by pixel.
- Add a gesture transaction to the store: `beginGesture()` snapshots once and
  suppresses per-dispatch `pushUndo`; `endGesture()` closes it (no-op if nothing
  changed). Wrap clip move/resize, keyframe drags, track resize/reorder, and the
  fade-handle drags (1.6) in it. Slider `@input` streams in the inspector get the
  same treatment via focus/blur or pointerdown/up.

Out of scope for Lane 1: J/K/L shuttle, ripple-trim mode, per-clip audio waveform
volume envelopes, magnetic (gapless) timeline mode.

---

## Lane 2 — Feature slices (engine + Python + goldens + UI together)

### Slice 0 — WebGL engine promotion (prereq)
- Default becomes **WebGL when `webglPreviewSupported()`**; localStorage key
  `'sailor:Engine.WebGLPreview'` flips from opt-in to opt-out
  (`'false'` forces Canvas2D). Canvas2D remains the automatic fallback.
- A settings row in the editor is not needed; the escape hatch is the localStorage
  key, documented in the code comment.
- Gate: run the existing engine-parity checks (`frontend/tests/engine-playback.spec.ts`,
  `gl-blend-conformance.spec.ts`, golden specs) and a manual dogfood pass per
  `docs/plans/2026-06-09-phase1-m3-dogfooding-checklist.md` before flipping.
  If the dogfood pass fails, the slice stops and the failures become the work.

### Slice 1 — Speed / reverse
**Semantics** (already specced in `types.ts`): `source_frame = in_frame +
floor((frame − start_frame) × speed)`; `reverse` flips the mapped range.

- **Shared TS:** route both preview engines' source-frame lookup through
  `sourceFrame.ts` (it becomes load-bearing; today nothing imports it). Only the
  WebGL engine is required to be exact; Canvas2D may ignore speed (legacy fallback).
- **Python twin:** implement the same mapping in `nodes_timeline.py`, used by both
  the TimelineNode composite path and `render_timeline_to_file` / ffmpeg export.
  The decode-budget math (`_needed_source_frames`) must account for speed
  (needed ≈ `length × speed`).
- **Audio:** export applies tempo change via ffmpeg `atempo` (chained for factors
  outside 0.5–2.0); pitch is not preserved (matches CapCut default). Preview: the
  WebGL engine's audio path uses `playbackRate` where the clip is backed by a media
  element; otherwise preview audio for retimed clips is muted. Reverse audio is
  export-only in v1 (preview mutes it).
- **UI:** inspector "Speed" section for video/audio clips — presets
  (0.5× 1× 1.5× 2×), free input 0.1×–5×, Reverse checkbox. **Changing speed
  rescales the clip's timeline length** (`length ×= old_speed/new_speed`, min 1,
  anchored at start) so the source coverage is preserved — the CapCut expectation.
  Implemented as a compound command at the UI layer (one undo step).
- **Goldens:** fixtures at 2×, 0.5×, reverse; mirrored TS/Python unit tests for the
  mapping (including rounding at non-integer speeds).

### Slice 2 — Transitions
**Model** (already in `types.ts`/`commands.ts`): one transition per junction of two
adjacent clips on a track, `duration` frames centered on the cut, overlap clamps to
available neighbor frames, cut never shifts.

- **UI:** at each junction where two clips on a track are exactly adjacent
  (`end == start`), render a small square chip straddling the cut (visible on
  hover; filled/labeled when a transition exists). Click → popover: kind
  (None / Crossfade / Wipe L / Wipe R / Slide ↑ / Slide ↓), duration in seconds
  (default 0.5s). Dispatches `add_transition` / `update_transition` /
  `remove_transition`. Moving/deleting either clip already removes the transition
  (command layer handles it).
- **WebGL:** during the overlap window the draw list emits both clips with a
  transition weight; fragment mixing per kind — crossfade = alpha mix, wipes =
  step on normalized x, slides = offset the incoming clip. The outgoing clip
  needs frames past its cut (its tail keeps playing through the overlap): source
  mapping extends through the overlap, clamped to the source's last frame.
- **Python:** same overlap math and per-kind mixing in the frame compositor used
  by export (numpy/torch), mirroring clamp behavior exactly.
- **Goldens:** one fixture per kind, sampled at overlap start / midpoint / end,
  plus a clamped-overlap case (short neighbor).

### Slice 3 — Filters (color adjust)
**Model** (`ClipFilters` in `types.ts`): brightness (additive −1..1), contrast
(× pivot 0.5), saturation (×), hue (deg), temperature (−1..1); applied in that
order, sRGB, clamped after each step.

- **UI:** inspector "Adjust" section (video/image/workflow clips): five sliders +
  per-slider reset + "Reset all". Values write via `update_clip` patch on
  `filters`; identity values are pruned so untouched clips stay clean.
- **WebGL:** uniform-driven color pass in the fragment shader implementing the
  documented order/clamps. Temperature = fixed warm/cool RGB gain pair (the exact
  coefficients live in ONE shared constants module and the Python twin mirrors it).
- **Python:** numpy implementation, same order/clamps/coefficients.
- **Goldens:** fixtures exercising each field alone and one combined case.

---

## Error handling & edge cases

- `move_clip` to a locked track: UI never offers it (lane highlight skips locked
  tracks); command layer is already a no-op safe path.
- Paste when the source track was deleted: falls back to first unlocked track of
  kind, creating one if needed (same routine `addFileToTimeline` uses).
- Trim clamp when asset metadata lacks duration: no clamp (status quo).
- Transition chip on junctions with a gap: not shown (model requires adjacency);
  snapping (existing) makes exact adjacency easy to hit.
- Speed on a clip with keyframes: keyframes are clip-local output frames, so they
  don't move when speed changes — document in the Speed section tooltip.
- WebGL promotion regressions: any user-visible break demotes via the localStorage
  escape hatch while the bug is fixed; Canvas2D path stays intact.

## Testing

- **Mirrored unit tests:** sourceFrame TS ↔ Python; transition overlap math TS ↔
  Python; filter pipeline TS(GLSL reference impl) ↔ Python.
- **Golden frames:** new fixtures per slice as listed; run in existing CI harness.
- **Command/store tests:** clipboard paste routing, duplicate placement,
  left-trim `in_frame` math, speed length-rescale compound.
- **Playwright:** context-menu smoke, marquee selection, cross-track drag
  (pointer simulation on the strip), transition chip add/remove.
- **Manual paid-render checklist:** one export exercising speed + transition +
  filter together, verified frame-accurate against preview.

## Sequencing

Lane 1 items land first (each is independently committable and immediately
user-visible). Lane 2 runs 0 → 1 → 2 → 3, each slice its own plan step with
goldens green before the next starts. Lanes may interleave if a Lane 2 slice
blocks on review.
