# Timeline Slice 1 — Speed / Reverse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-clip playback speed (0.1×–5×) and reverse render identically in the WebGL preview and the Python export, with an inspector UI that matches CapCut's "speed changes clip length" expectation.

**Architecture:** The TS side is ALREADY DONE — `buildDrawList` (frontend/app/lib/engine/compositor.ts:125) routes every clip's source lookup through `sourceFrameAt` (frontend/shared/timeline/sourceFrame.ts), so the WebGL engine plays speed/reverse today. This slice adds the Python twin at the three Python pixel sites, audio tempo in the export mux, the inspector UI, the speed-aware trim clamp, and a golden fixture (using the frame-indexed `counter_30f.mp4`) that gates both renderers.

**Spec:** `docs/superpowers/specs/2026-07-16-timeline-capcut-ux-design.md` (Slice 1)

## Global Constraints

- Mapping formula (pinned in types.ts, mirrored exactly):
  `eff = reverse ? max(0, max(1,length)-1-local) : local; src = in_frame + floor(max(0,eff) * speed)`
- Existing golden PNGs must NOT change — only a new fixture directory may appear.
- Commit to main; stage only owned files.
- Tests: `cd frontend && npx vitest run …`; Python: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/<file> -q`; goldens: `.venv/bin/python scripts/timeline_golden.py` then `npx playwright test tests/timeline-golden.spec.ts`.

---

### Task 1: Python source-frame twin + all three pixel paths

**Files:**
- Modify: `comfy_extras/nodes_timeline.py`
- Test: `tests-unit/comfy_extras_test/timeline_source_frame_test.py` (create)

**Interfaces:**
- Produces: `_source_frame_at(clip: dict, local_f: int) -> int` in nodes_timeline.py — later tasks and the transitions slice reuse it.

- [ ] Write `timeline_source_frame_test.py` mirroring every case in `frontend/tests/unit/source-frame.unit.spec.ts` (identity, 0.5× holds, 2× skips, reverse, reverse-after-speed, defaults/never-negative). Run → fails (function missing).
- [ ] Implement `_source_frame_at` next to `_needed_source_frames`:

```python
def _source_frame_at(clip: dict, local_f: int) -> int:
    """Timeline→source frame mapping — Python twin of shared/timeline/sourceFrame.ts.
    src = in_frame + floor(max(0, eff) * speed); reverse mirrors the local frame."""
    speed = float(clip.get("speed") or 1.0)
    in_frame = int(clip.get("in_frame", 0) or 0)
    length = max(1, int(clip.get("length", 1) or 1))
    eff = max(0, length - 1 - local_f) if clip.get("reverse") else local_f
    return in_frame + int(max(0.0, float(eff)) * speed)
```

- [ ] Wire the three pixel sites:
  1. **Graph path** (TimelineNode.execute): layer dict gains `"speed"/"reverse"`; `ct = (local_t + L["in_frame"]) % src_T` → `ct = _source_frame_at(L, local_t) % src_T` (L carries in_frame/length/speed/reverse).
  2. **Export path** (`render_frame_np` video branch): `local_sec = (local_f + in_frame)/fps` → `src_sec = _source_frame_at(L, local_f) / fps`, keeping the existing `% clip_dur` wrap.
  3. **Flatteners**: `_adapt_edit_state` and `_prepare_render_clips` copy `speed` (float, default 1) and `reverse` (bool) through. `render_frame_np`'s L dict uses the same keys `_source_frame_at` reads (`in_frame`, `length`, `speed`, `reverse`).
- [ ] `_needed_source_frames`: `needed = in + floor((length-1)*speed) + 1` (same bound for reverse). Update the stale "ignores speed/reverse" comments at :104 and sourceFrame.ts's "Phase 2 adds the Python twin".
- [ ] Run the Python test + existing `timeline_golden_test.py` (goldens unchanged at speed 1 — mapping is identity). Commit.

### Task 2: Audio speed in the export mux

**Files:**
- Modify: `comfy_extras/nodes_timeline.py` (`_adapt_edit_state`, mux block in `render_timeline_to_file`)

- [ ] `_adapt_edit_state`: when capturing the first audio clip, also record `audio_speed` (float) and `audio_reverse` (bool) into the flat state.
- [ ] In the mux: when `audio_speed != 1` or `audio_reverse`, build an `av.filter.Graph`: `abuffer → [areverse] → atempo(...chained to keep each factor in 0.5–2.0) → abuffersink`, push decoded frames through it, encode the filtered frames. On any filter error, fall back to the unfiltered mux with a warning (never fail the render for audio).
- [ ] Length clamp still applies post-filter (target_dur unchanged — video duration rules).
- [ ] Manual check deferred to the slice-end export verification. Commit.

### Task 3: Inspector Speed UI + speed-aware trim clamp

**Files:**
- Modify: `frontend/app/components/vue-canvas/TimelineEditor.vue`
- Modify: `frontend/shared/timeline/trim.ts` + `frontend/tests/unit/timeline-trim.unit.spec.ts`

- [ ] `clampLengthToSource(length, inFrame, sourceFrames, speed = 1)`: cap = `max(1, floor((sourceFrames - inFrame) / speed))`. Update tests (2× halves the cap, 0.5× doubles it) + resize-right call site passes `clip.speed ?? 1`.
- [ ] Inspector "Speed" section (video/audio clips only), above Fades:
  - Preset chips 0.5× 1× 1.5× 2× + number input (min 0.1, max 5, step 0.1) + "Reverse" checkbox.
  - Speed change is ONE `update_clip` dispatch patching `{ speed, length: max(1, round(length * old/new)) }` — CapCut behavior, single undo step.
  - Reverse toggles `{ reverse }` alone (no length change).
  - Tooltip: "Keyframes are timed to the clip's output frames — they don't move when speed changes."
- [ ] Vite compile-check + vitest trim suite. Commit.

### Task 4: Golden fixture + full gate

**Files:**
- Create: `tests-unit/timeline_fixtures/04-speed-reverse.json`
- Generated: `tests-unit/timeline_golden/04-speed-reverse/f*.png`

- [ ] Fixture: 640×360 @30fps, 30 total frames, three `counter_30f.mp4` video clips side by side (scale ~0.45; positions x −0.3 / 0 / +0.3):
  - 2× speed, length 15 (covers source 0..29)
  - 0.5× speed, length 30 (covers source 0..14, each held twice)
  - reverse @1×, length 30 (plays 29→0)
  `_golden.frames`: [0, 7, 14] — distinct gray values per clip per frame prove the mapping (e.g. f7: 2× clip shows source 14 ⇒ gray 120; 0.5× shows 3 ⇒ 32; reverse shows 22 ⇒ 184).
- [ ] Regenerate goldens (`scripts/timeline_golden.py`); confirm ONLY `04-speed-reverse/` is new (`git status` on timeline_golden), eyeball the PNGs.
- [ ] Gates: Python golden test, `timeline-golden.spec.ts` (server + webgl on the new fixture), vitest source-frame + trim, engine-playback spec. Commit fixture + goldens.
- [ ] End-to-end: dev-server export of a small timeline with a 2× clip; verify duration & motion (and audio pitch-shift if an audio clip present).
