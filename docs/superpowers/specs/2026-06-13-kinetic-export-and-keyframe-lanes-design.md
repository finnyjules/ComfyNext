# Kinetic Type — Export via Bake + Keyframe Lanes

**Date:** 2026-06-13
**Status:** Design approved, pending spec review
**Scope:** "Slice B" of the kinetic timeline — make Motion clips export, and replace the from→to axis animation with a full keyframe-lane editor.
**Related:** `project-kinetic-timeline` (Slice A shipped 2026-06-11), `project-video-editor-phases`, `docs/superpowers/specs/2026-06-11-kinetic-timeline-design.md`

---

## Problem

Kinetic typography lives as a `Motion` clip kind on the video timeline. Slice A shipped authoring + live preview, but the feature is **not whole**:

1. **Motion clips vanish silently on export.** The Python Timeline node's `_adapt_edit_state` skips `workflow`/`audio`/`caption` explicitly; `motion` falls through with no `path`, then `_prepare_render_clips` has no handler for it, so the clip is dropped before `render_frame_np` ever runs. A carefully animated kinetic clip is simply absent from the exported video — no error, no pixels.
2. **Animation authoring is impoverished.** Variable-font axes can only animate linearly from→to (a 2-keyframe `axisKeyframes` array written by a checkbox in `MotionClipInspector.vue`). Transform properties (`x/y/scale/rotation/opacity`) have a keyframe data model (`BaseClip.keyframes`) but **no UI at all**.

This spec closes both: an automatic bake-on-export pipeline, and a unified bottom-dock keyframe-lane editor.

## Goals

- A Motion clip that previews correctly also **exports correctly**, with the same pixels, with alpha.
- One **keyframe-lane editor** that animates both font axes and transform, with multi-keyframe lanes, per-keyframe easing, and direct manipulation.
- Familiarity for After Effects and CapCut users.
- Zero new motion engine on the Python side — parity by construction.

## Non-goals (deferred)

- **Auto-key** (AE stopwatch-style). v1 is explicit diamond-toggle only. Auto-key is a post-v1 toggle.
- **Bezier value-graph editor.** v1 easing is 4 presets per keyframe.
- **Color/stroke keyframing.** Lane scope is axes + transform only.
- **Alpha-video bake artifact.** v1 bakes a PNG sequence; single-file alpha video is a future optimization.
- **Native Python motion render.** Explicitly rejected — would duplicate the variable-font motion engine.
- **Cloner / Frame-on-timeline** (Phase 2 / Phase 3 of the kinetic roadmap).

---

## Part 1 — Export via bake

### Approach: client-side bake → alpha PNG sequence → asset → light Python compositor

Baking runs the **same `motionClipRenderer`** that drives the preview, headless, once per frame. Because preview and export share the renderer, pixel parity is inherent and enforceable by the existing golden-frame gate.

### Artifact format

Alpha-preserving **PNG sequence**, one PNG per clip frame at canvas resolution and project fps. Rationale: `frontend/app/lib/motion/bake.ts::bakeMotionFrames()` already produces these (offscreen canvas, `clearRect` for transparency, `toBlob` → PNG); the Python compositor already alpha-composites RGBA via `_blend_np`. No encoder, lossless alpha. (Single-file alpha video deferred — it would require a client/server encoder and RGBA video-decode changes for marginal file-count savings.)

### Timing: automatic, on export, cached by source key

- On export, for each Motion clip compute `motionSourceKey()` (FNV-1a hash over the layer spec + animation/presets + **all lane keyframes**, including transform — extend the current hash inputs to cover the new keyframe data).
- If the hash differs from `clip.bake.source_key`, **(re)bake**. If it matches, **skip** — instant.
- The clip **stays a Motion clip** throughout. The bake is a cache referenced by `BakeRef`, never a clip-type swap, so editability is never lost.

### Bake → asset pipeline

1. `bakeMotionFrames()` renders frames → alpha PNG blobs.
2. Upload under a per-bake prefix (reuse `useKineticRenderer.uploadFrameBatch()` → `/upload/image`).
3. Register **one sequence asset** — a new asset `kind: 'sequence'` whose metadata holds `{ prefix, count, fps, width, height }`. Persisted in `user/timeline_assets.json` via the existing asset-import route.
4. Write `clip.bake = { asset_id, source_key }`.

### Export resolution + Python compositor

- In `TimelineEditor.vue` export prep, alongside the existing `asset_id → path` resolution for video/image/audio, resolve each Motion clip's `clip.bake.asset_id` → sequence info and attach it to the payload clip.
- New handler in `comfy_extras/nodes_timeline.py`:
  - `_adapt_edit_state`: stop letting `motion` fall through silently; carry the resolved bake/sequence info.
  - `_prepare_render_clips`: for `kind:'motion'` with a fresh bake, map clip-local frame → sequence frame index, load that PNG as **RGBA**.
  - `render_frame_np`: composite the RGBA frame via the existing `_blend_np` (already alpha-aware), honoring the clip's transform/opacity/blend like any other layer.
- If a Motion clip reaches the backend with no/stale bake (shouldn't happen given auto-bake, but defensively): skip it and **surface a warning** (not a silent drop) so the failure is legible.

### Parity / testing

- Add a golden fixture for a representative kinetic clip (static text + one animated axis + one transform keyframe). Because the baked PNGs come from the preview renderer, it should match within the locked WebGL tolerances (mean ≤2.5/255, pctOver(8/255) ≤6%).
- Note for fixtures: text rendering can be nondeterministic across environments — pin the font and tolerances as the existing harness does.

---

## Part 2 — Keyframe-lane editor

### Layout: bottom dock

A full-width dock under the timeline tracks. Its **time ruler and playhead align with the timeline** (one shared playhead/CTI). Opens when a Motion clip is selected (and via a keyframe affordance); takes vertical space only while open. This is the After Effects dope-sheet model — the highest-transfer choice for the 6–8 lanes that "axes + transform" implies.

### Groups and lanes

Twirl-down groups:
- **Transform** — Position, Scale, Rotation, Opacity.
- **Axes** — the selected font's variable axes (e.g. Weight, Width, Slant, Optical Size), gated to the font's actual axis set (reuse the existing `VARIABLE_FONTS` match in `MotionClipInspector.vue`).

An empty lane (no keyframes) means the property is static at its base value.

### Interaction model

- **Diamond toggle** per lane: filled = a keyframe exists at the playhead. Click to add a keyframe at the playhead with the current value; click again on a keyframe to remove it. Editing a value while the playhead is on a keyframe **updates** that keyframe.
- **Drag** keyframe diamonds along the lane to retime, with **frame-snapping** (snap to frame boundaries and to other keyframes).
- **Keyframe-navigator arrows** (◀ ◆ ▶) per lane: jump to previous / next keyframe; the center diamond doubles as the add/remove toggle. Familiar to AE users, makes the diamond's meaning obvious.
- **On-clip dots**: mirror keyframe positions as small diamonds on the kinetic clip in the main timeline (read-only indicator). The dock is the editing surface; the dots bridge CapCut users who expect keyframes on the clip.

### Easing

Per-keyframe easing, chosen from **4 presets** on the selected keyframe: Linear, Ease In, Ease Out, Ease In-Out. Stored in the existing `ease?` field on the keyframe. (Bezier value-graph deferred.)

### Presets coexistence

- The in/out/loop **presets (`MotionLayerAnimation`) remain** as one-click entrance/exit/loop moves.
- **"Convert preset → keyframes"** action bakes a preset's motion into editable lane keyframes, after which it is pure keyframes for that property.
- **Composition rule:** a lane is **authoritative** for any property it has keyframes on; presets apply only to properties with no lane keyframes. This prevents two systems fighting over the same property (e.g. opacity). Document this in the inspector copy so it's discoverable.

---

## Data model changes (`frontend/shared/timeline/types.ts`)

- **Unify keyframes into lanes.** Today: `BaseClip.keyframes` (transform snapshots, clip-local frame) + `MotionTextLayer.axisKeyframes` (normalized-t axis values). The editor must read/write both. Decide one canonical internal representation for the lane editor and adapt at the edges:
  - Option taken: keep both stores but drive them from a shared per-property lane abstraction in the editor. Transform lanes ↔ `BaseClip.keyframes`; axis lanes ↔ `axisKeyframes`. This avoids a migration and keeps the renderer interpolation paths (`interpolateClipAt`, `lib/motion/axes.ts::interpolateAxes`) intact.
  - Add per-keyframe `ease` where missing and ensure both interpolators honor it (axis interpolation currently linear-only — extend `interpolateAxes` to apply per-keyframe easing).
- **`bake` / `BakeRef`** already exist on `BaseClip` (`{asset_id, source_key}`); no schema change needed beyond populating them.
- **New asset kind `'sequence'`** with metadata `{prefix, count, fps, width, height}`.

## Key files / seams

- Data model: `frontend/shared/timeline/types.ts`
- Bake: `frontend/app/lib/motion/bake.ts` (extend `motionSourceKey` inputs), `frontend/app/composables/useKineticRenderer.ts` (`uploadFrameBatch`)
- Renderer (shared by preview + bake): `frontend/app/lib/engine/motionClipRenderer.ts`; axis interp `frontend/app/lib/motion/axes.ts`
- Preview dispatch (must stay in sync): `usePlaybackEngine.ts` (Canvas2D), `frontend/app/lib/engine/sources/textCanvasSource.ts` (WebGL), and **`compositor.ts::buildDrawList` `RENDERABLE_KINDS`** (known gotcha — a clip kind must be listed here or it renders blank in GL)
- Editor UI: new bottom-dock component(s) under `frontend/app/components/vue-canvas/timeline/`; `MotionClipInspector.vue` (presets + convert action); `TimelineEditor.vue` (export prep, dock host, on-clip dots)
- Export backend: `comfy_extras/nodes_timeline.py` (`_adapt_edit_state`, `_prepare_render_clips`, `render_frame_np`); asset import route; `user/timeline_assets.json`

## Testing

- Golden fixture for a kinetic clip (export parity vs preview renderer).
- Unit: `motionSourceKey` stability/staleness (same inputs → same key; any keyframe change → new key); clip-local↔sequence frame mapping; per-keyframe easing interpolation for both transform and axes.
- Browser acceptance: add keyframes via diamond, drag with snapping, nav arrows, on-clip dots, convert-preset, then export and confirm pixels land. (Note the known kinetic verification caveats: WebGL preview can't be screenshot-read; drive via unit tests + `javascript_tool`, confirm served module via `/_nuxt/@fs/...`.)

## Open questions

- Sequence-asset lifecycle: do stale bakes get garbage-collected, or accumulate in `input/`? (Lean: leave for a later cleanup pass; note it.)
- Dock open/close affordance: auto-open on Motion-clip select, or an explicit toggle? (Lean: auto-open on select, with a collapse control.)
- Whether on-clip dots should be editable later (drag on the clip itself) or stay read-only indicators (v1: read-only).
