# Compositor Motion Redesign — Design Spec

**Date:** 2026-07-22
**Status:** Approved direction; pending implementation plan
**Owner surface:** `CompositorModal.vue` (Frame/Compositor modal)

## Summary

Revive the compositor's hidden kinetic motion system behind a redesigned,
Jitter-inspired surface: a **Design | Motion** inspector toggle (3D Studio
idiom), a **docked band timeline** at the bottom of the stage, and a **preset
gallery picker with live animated thumbnails**. The existing pure-canvas motion
engine (`app/lib/motion/*`) is kept and extended; only its UI is rebuilt.

Out of scope for this milestone: custom property keyframing UI (picker ships
"Custom — coming soon"), bake/export rework, slate template gallery
(`KINETIC_ENABLED` stays `false` for slates only), wired-layer animation,
WebGL-dependent presets (3D Orbit, Radial Repeat Blur), animated color grading.

## Background

- The engine already supports: per-layer `LayerAnimation` (`offset`,
  optional window `duration`, `in`/`out`/`loop` specs with per-character
  `stagger` and GSAP-style eases), whole-layer keyframes, variable-font axis
  keyframes, and a bake-to-frames pipeline. All functional, gated off by
  `KINETIC_ENABLED = false` "pending a redesign".
- The 3D Studio recently shipped the target idiom: Build|Motion inspector
  tabs + a full-width docked timeline with per-object band rows
  (`Scene3DMotionTimeline.vue`, band math in `lib/scene3d/motion/timeline.ts`).
- Jitter (jitter.video) is the UX reference for presets: categorized gallery
  with animated example thumbnails, per-preset parameter knobs, and a custom
  property picker (their custom system = the future milestone).

## 1. Entry & layout: Design | Motion toggle

- A segmented **Design | Motion** strip at the top of the right inspector
  panel, styled like the 3D Studio's Build|Motion tabs (full-width pill,
  `bg-white/[0.04] p-1`, active segment `bg-white/15`). Visible in all
  inspector states except the Assistant takeover.
- **Motion active ⇔ motion mode**:
  - The docked timeline panel appears at the bottom of the stage, replacing
    the agent bar + toolbar cluster (same swap the 3D Studio does with its
    add-toolbar). Exiting Motion (switching back to Design) restores them.
  - The inspector shows Motion content (§3) instead of Design content.
  - The old toolbar Play button is **removed** — the toggle is the entry.
- Canvas editing stays live in Motion mode: selecting/moving layers works;
  scrub state re-renders via the existing preview path.
- The sticky Render footer stays visible in both tabs.
- The existing `LayerMotionPanel` section is removed from the Design
  inspector (its role moves into the Motion tab). `MotionTransport.vue`
  retires (absorbed by the docked panel).
- All `KINETIC_ENABLED` gates inside `CompositorModal.vue` are removed;
  the flag remains only on slate-gallery entry points elsewhere.

## 2. Docked timeline panel

Full-width panel docked inside the stage's bottom edge
(`absolute inset-x-* bottom-*`, above the canvas, `@pointerdown.stop`).

- **Transport row**: play/pause; `t / duration` readout (tabular nums);
  duration and fps number fields; the stale-aware **Bake** button with
  progress (logic unchanged from today's `MotionTransport`); bake error
  line; ✕ is unnecessary (the toggle exits).
- **Ruler + playhead**: a thin time ruler above the rows; a playhead line
  spans ruler + all rows; click/drag anywhere on the ruler scrubs.
- **Band rows**: one row per **local** layer, ordered as in the layer list
  (wired image slots render in preview but have no bands in v1; grouped
  layers appear as their individual rows).
  - Row = `[label | track]` grid like `Scene3DMotionTimeline`. Clicking a
    row or band selects the layer (canvas + list + inspector sync).
  - Band spans the layer's window `[offset, offset + (duration ?? frameEnd)]`.
  - Segments inside the band: amber **in**, emerald **loop**, amber **out**
    (colors and handle affordances match the 3D Studio timeline).
  - Drag interactions: band body → `offset`; in/out dividers → their
    `duration`s; **band right edge → the layer window `duration`**
    (new vs scene3d; drag past frame end or double-click the edge to reset
    to "to end"). All drags snap to 0, duration/2, frame end, and the
    current playhead (`epsSec` ≈ 0.08 like scene3d).
- Rows area scrolls vertically beyond ~32vh (same cap as 3D Studio).

### Band math module

`app/lib/motion/timelineBands.ts` — pure functions, compositor-owned,
mirroring `lib/scene3d/motion/timeline.ts` but typed to `LayerAnimation`
and window-duration aware:

- `bandSegments(anim, frameDur)` → fractions `{offset, in, loop, out, end}`
- `setClipOffset`, `resizeTransition('in'|'out')`, `setWindowDuration`,
  `snapSeconds` — all clamped so `in + out ≤ window ≤ frame`.

Developed TDD (vitest), no DOM.

## 3. Motion inspector tab

- **Layer selected** — the animation editor:
  - Three slot rows: **In / Loop / Out**. Each shows the assigned preset as
    a chip (label + micro-thumbnail) or "None"; clicking opens the preset
    gallery (§4) scoped to that slot; ✕ on the chip clears the slot.
  - Under each assigned slot: duration, stagger (text layers), and the
    preset's **param sliders** (§5).
  - Window controls: offset + duration numerics (mirror the band).
- **No selection** — frame motion settings: duration, fps, loop toggle
  (`FrameMotion`), plus Bake status/button mirror and a hint to select a
  layer.
- The Design tab keeps today's inspector content, minus the old
  `LayerMotionPanel`.

## 4. Preset gallery picker

A popover anchored to the slot row (teleported; note the memory gotcha —
re-read refs after opening when testing).

- **Categories** as vertical sections with headers, filtered to the slot
  kind (in-presets for In, etc.): Fade, Slide, Scale, Spin, Mask, Elastic,
  **Utility** (new), and for Loop: Wave/Float/Sway/…, Utility.
- **Cards**: live animated thumbnail + label, 2-per-row grid (Jitter-like).
  - Thumbnails render the **real** `evaluate()` math on a small canvas
    (~72px) with sample content (rounded-rect glyph card "Aa"), looping
    on a single shared RAF master clock; only visible thumbnails paint.
    No canned GIFs — previews are true to the engine.
  - The active preset's card is highlighted; clicking assigns
    (`patchSpec` semantics as today: keeps existing duration/stagger).
- **Custom card** at the end of every gallery: present but disabled with a
  "soon" tag — the visible entry point for the property-keyframe milestone.

## 5. Parameterized presets

Additive engine/catalog change enabling Jitter-style per-preset knobs:

- `LayerAnimSpec` gains optional `params?: Record<string, number>`.
- Catalog entries (`data/kinetic-presets.ts` or the eval tables) gain an
  optional param schema: `{ key, label, min, max, step, default }[]`.
- `evaluate.ts` eval fns receive resolved params (defaults merged).
- Picker/inspector render a slider per declared param. Absent params ⇒
  current behavior (all existing presets unchanged).

## 6. New presets (Utility)

All pure-canvas, feasibility verified against the painter:

| Preset | Slot | Params | Engine needs |
|---|---|---|---|
| Wiggle | loop | amplitude, frequency, seed | smooth seeded noise (value-noise helper) |
| Card Flip H / Card Flip V | in + out | overshoot | **scaleX/scaleY** on `UnitSample` (axis via separate entries — params stay numeric) |
| Inward Echoes | loop | copies, scaleStep, fade | **`copies[]`** multi-draw on `UnitSample` |
| Grid Scroll X | loop | tiles, speed, gap | `copies[]` (tiling) |
| Grid Scroll Y | loop | tiles, speed, gap | `copies[]` (tiling) |
| Noise Tile | loop | tileSize, randomness, speed | `copies[]` + seeded per-tile offsets |

Engine extensions (both additive):
1. `UnitSample` gains optional `scaleX`/`scaleY` (default = `scale`).
2. `UnitSample` gains optional `copies: UnitTransform[]` — the painter
   draws the unit once per copy (transform composed with the base sample);
   used for echoes and tiling. Painter clips copies to the layer's canvas
   region so tiled scrolls stay inside the frame.

## 7. Data flow & persistence

Unchanged: `animation` lives on layers inside `sailor_localLayers`;
`FrameMotion` on node properties; bake pipeline and staleness detection
as today. New `params` ride along inside `animation.{in,out,loop}` and are
plain JSON — no migration needed (absent = defaults).

## 8. Testing

- **Unit (TDD, vitest)**: `timelineBands.ts` (segments, clamps, snapping,
  window-duration edge cases incl. `duration: undefined`); evaluator
  params merging; `scaleX/scaleY` and `copies` sampling; each new preset's
  eval at t = 0 / mid / 1.
- **Browser (frame-lab)**: `/dev/frame-lab` gains fixture layers with
  animations; verify toggle behavior, docked panel interactions (drag
  offset/dividers/window edge with snap), picker galleries + live thumbs,
  param sliders, scrub/play, bake trigger. Use real pointer interactions
  (memory: dispatched events don't reach canvas pointer handlers; click
  by ref; `left_click_drag` can't drive pointermove marquees — timeline
  drags must be verified with stepwise pointer moves or unit-tested math
  + state assertions via the harness).
- Typecheck baseline awareness (~328 pre-existing errors; don't add new).

## Component/file inventory

| File | Change |
|---|---|
| `lib/motion/timelineBands.ts` | new — band math (TDD) |
| `lib/motion/types.ts` | `params` on `LayerAnimSpec` |
| `lib/motion/evaluate.ts` | param plumbing; scaleX/Y; copies; 6 new presets |
| `lib/motion/paint.ts` | scaleX/Y + copies drawing |
| `data/kinetic-presets.ts` | categories, param schemas, new entries |
| `compositor/CompositorMotionTimeline.vue` | new — docked panel |
| `compositor/MotionPresetPicker.vue` | new — gallery popover |
| `compositor/PresetThumb.vue` | new — live thumbnail canvas |
| `compositor/LayerMotionPanel.vue` | replaced by Motion-tab editor (new `MotionLayerEditor.vue`) |
| `compositor/MotionTransport.vue` | retired (absorbed) |
| `CompositorModal.vue` | Design/Motion toggle; docked panel mount; gate removal; Play button removal |
| `pages/dev/frame-lab.vue` | motion fixtures |
