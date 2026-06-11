# Kinetic Timeline: Motion Clips, Variable Fonts & Cloning

**Date:** 2026-06-11
**Status:** Approved direction, pending spec review
**Supersedes the approach in:** docs/superpowers/specs/2026-06-10-kinetic-slates-design.md
(the Frame-based kinetic surface, now hidden behind `KINETIC_ENABLED`). The
motion *engine* built there (`frontend/app/lib/motion/`) is reused, not
discarded — it becomes the shared core both surfaces draw on.

## Principle

**Frame = static composition. Timeline = movement.** Kinetic typography belongs
in the video timeline, not the Frame. The Frame stays the surface where you
compose a still layout; the timeline is where you bring it to life. They stop
competing and start composing.

## Goal

Make the timeline a real kinetic-typography surface, delivering three things the
user asked for:
1. **Animate text well in the timeline** — variable-font axes, per-char kinetic
   presets, keyframes — with editing that scales from "fill a preset" to "rig an
   animation."
2. **Clone elements** — both plain duplicate and a parametric **cloner**
   (one element → N instances with a transform step + animation stagger): the
   marquee, the metadata grid, the burst.
3. **Variable fonts** — not just dialed in, but **animated**: axes are
   first-class keyframeable channels.

## The unifying architecture: one Motion clip

A new timeline clip kind — **Motion clip** — whose content is a **layer stack
evaluated by `lib/motion` at the timeline playhead `t`**. In v1 the stack holds
exactly one **text layer** (the "Kinetic Text" clip). Nothing in the model is
text-specific, so it generalizes at three scales with one engine:

- **v1 — text:** one text layer.
- **Later (option 3) — Frame on the timeline:** the *same clip with N layers* —
  place a static Frame composition and animate/clone its layers over time.
- **Later (option 2) — vector graphics:** *more layer kinds* (bars, lines,
  shapes, logos) in the same stack.

Text → Frame-on-timeline → graphics is one model, not three features.

### Engine unification (debt paydown)

The timeline currently carries a weaker **duplicate** of the motion engine:
`frontend/app/composables/useAnimatedTextRenderer.ts` reimplements per-char
animation with a hardcoded preset switch, separate easing, and no variable-font
axes. This work deletes that duplication: the timeline's text rendering routes
through `lib/motion`'s pure evaluator (`evaluate.ts`) + per-char drawing
(`animatedText.ts`). The Frame engine stops being dead weight behind a flag and
becomes the **shared core** both surfaces use.

The variable-font **axis-keyframe interpolation** that already exists
(`frontend/app/composables/useKineticRenderer.ts`, the Frame's bake path) is
lifted into the shared engine so both surfaces animate axes the same way.

### Relationship to existing clips

`shared/timeline/types.ts` already has `TitleClip` and `LowerThirdClip` (animated
text, preview-only, no export, no editing UI) and `CaptionClip` (word-timed
subtitles). The Motion clip **supersedes Title/LowerThird** as the animated-text
surface; they remain in the schema for back-compat but the UI offers the Motion
clip going forward. `CaptionClip` is a different job and stays as-is.

## The clip data model

A new `MotionClip extends BaseClip` in `shared/timeline/types.ts`:

```ts
interface MotionClip extends BaseClip {
  kind: 'motion'
  layers: MotionLayer[]      // v1: exactly one text layer
  cloner?: ClonerSpec        // optional; multiplies the whole stack
  // BaseClip already carries start_frame/length/transform/keyframes/blend/fade
}

interface MotionLayer {
  id: string
  kind: 'text'               // v1; 'rect'|'path'|'image' added in later phases
  // text-layer fields:
  text: string
  fontFamily: string
  axes?: Record<string, number>        // base variable-font axis values (wght/wdth/…)
  fontSize: number; color: string; align: 'left'|'center'|'right'
  // animation: in/out/loop presets from the kinetic catalog
  animation?: LayerAnimation           // reuse lib/motion/types LayerAnimation
  // hand-animated channels — keyframe lanes:
  axisKeyframes?: AxisKeyframe[]        // per-axis value curves over clip-local time
  // (transform/opacity keyframes live on the clip via BaseClip.keyframes)
}

interface ClonerSpec {
  mode: 'linear' | 'grid' | 'radial'
  count: number                        // linear/radial; grid uses cols×rows
  cols?: number; rows?: number         // grid
  radius?: number                      // radial (fraction of canvas)
  step: { dx?: number; dy?: number; rotation?: number; scale?: number }  // per-instance delta
  stagger: number                      // seconds of animation delay per instance
  staggerOrder?: 'sequence' | 'center' | 'row' | 'col'  // ripple order (grid)
}
```

`LayerAnimation`/`AxisKeyframe` are reused from `lib/motion/types` (axis-keyframe
type lifted there from `useKineticRenderer`). Geometry stays normalized as the
motion engine already defines.

## Authoring UX — hybrid

Selecting a Motion clip surfaces:

- **Inspector (right panel) — structural setup:** Content (the text) · Font +
  variable-axis sliders · Animation (in/out/loop preset + duration/stagger/ease
  from the kinetic catalog) · Cloner (mode + count/step/stagger).
- **Keyframe lanes (timeline) — hand-animation:** a **stopwatch** next to any
  animatable channel (transform x/y/rotation/scale/opacity, each font axis,
  cloner params) turns it into a keyframe lane revealed when the clip is
  twirled open. Reuses the timeline's existing `Keyframe`/`interpolate.ts`
  infrastructure, extended for font axes.
- **Canvas:** type/position text directly on the preview.

Casual users stay in inspector presets; animators twirl down and keyframe. One
surface, both depths.

## The cloner

Rendering a cloner is **the same `evaluate()` call, N times**, each instance
drawn at the accumulated `step` transform and a `stagger`-shifted `t` — so a
6-instance marquee is one source animation replayed six times with offsets, not
six clips. It reuses the whole engine; `count` is a live parameter (cranking it
is also the user's "duplicate"). Plain duplicate/copy-paste of a clip is a
separate, simpler timeline-store operation (genuinely absent today).

- **linear:** instances march along `step` dx/dy; stagger sweeps them in.
- **grid:** `cols × rows`; `staggerOrder` ripples by sequence/center/row/col.
- **radial:** `count` around a circle of `radius`, each rotated to face out.

## Rendering & export

- **Preview:** the timeline's WebGL/Canvas playback (`usePlaybackEngine` /
  `webglPreviewRenderer` via `textCanvasSource`) renders Motion clips through the
  shared `lib/motion` evaluator + `drawAnimatedTextLayer`, with the cloner as the
  N× multiplier and axis keyframes driving per-frame `fontVariationSettings`.
- **Export (v1):** bake the Motion clip to a PNG sequence (reuse
  `frontend/app/lib/motion/bake.ts`) → a video the timeline composites and
  exports. Avoids porting the evaluator to Python.
- **Export (later phase):** native Python render parity in
  `comfy_extras/nodes_timeline.py` so a Motion clip renders headless on
  graph-run without baking — this closes the existing title/lower-third/caption
  export gap. Deferred per the v1 decision.

## Phasing

Each phase is a separate spec→plan→implement cycle; this document is the
architecture all phases share. **Phase 1 is the first plannable unit.**

- **Phase 1 — Kinetic Text clip.** Motion-clip model (single text layer) +
  engine unification (timeline routes through `lib/motion`, delete
  `useAnimatedTextRenderer` duplication) + inspector + variable-font axes
  (base + keyframed) + preview + bake-to-video. Acceptance: add a Kinetic Text
  clip, pick a variable font, animate `wght` over the clip, see it in preview
  and in a baked export.
- **Phase 2 — Cloning:** plain clip duplicate/copy-paste (a generic
  timeline-store operation, independent of the engine — could land earlier) +
  the parametric cloner (linear/grid/radial) on a Motion clip.
- **Phase 3 — Frame on the timeline** (option 3): place a multi-layer Frame as a
  Motion clip; animate/clone its layers.
- **Later:** vector graphic layers (option 2); native Python export parity.

## Out of scope (v1 / Phase 1)

- Cloning — both plain duplicate and the parametric cloner (Phase 2) —
  Frame-on-timeline (Phase 3), vector graphics, Python export parity.
- Reviving the hidden Frame kinetic surface (`KINETIC_ENABLED` stays off; its
  engine is reused, its UI is not).
- Per-character independent keyframe curves (presets + stagger cover v1;
  per-char hand-keying is a future power feature).

## Testing

- Unit: the shared evaluator already has determinism + preset tests; add
  axis-keyframe interpolation tests and cloner instance-transform/stagger math
  tests (pure, mirror the existing `lib/motion` test style).
- Golden-frame: a Motion-clip fixture rendered at fixed `t` values vs committed
  PNGs, following the timeline golden-harness workflow.
- Manual: a Kinetic Text clip with an animated axis plays in preview and bakes
  to a matching video.

## Risks

- **Engine-unification regression:** deleting `useAnimatedTextRenderer` must not
  change how existing Title/LowerThird clips look. Pin current title rendering
  with a golden before the swap, or keep Title on its old path and only route
  the new Motion clip through `lib/motion`.
- **Keyframe-lane UX in `TimelineEditor.vue`** (already a large file): the
  twirl-down property lanes are the hard 60%. Keep the lane/stopwatch logic in a
  focused composable, not inline in the editor.
- **Axis animation performance:** per-frame `fontVariationSettings` + canvas
  text is fine for a few clips; cloner × many instances × per-char could get
  heavy. Cap/measure; the cloner is a render multiplier so its cost scales with
  count.
