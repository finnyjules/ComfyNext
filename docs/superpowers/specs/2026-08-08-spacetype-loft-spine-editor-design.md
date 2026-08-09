# Space Type — Loft: on-preview bezier spine editor + angled caps (round 3b)

**Date:** 2026-08-08
**Status:** Design approved, pre-plan
**Builds on:** the Loft effect + rounds 3a/3c/3d.

## Plain-language summary

Two ways to control the loft's **ends** (and the whole spine):
1. **On-preview bezier spine editor** — an overlay on the main preview where you
   drag the spine's points AND grab **tangent handles** to swing each end's
   direction. 2-D-first: while editing, the preview shows head-on so screen = the
   spine's plane; depth stays a per-stop slider. Handles are **auto** (smooth) by
   default and become **manual** when you drag one.
2. **Angled end caps** — one "End cap angle" control that tilts both end caps away
   from perpendicular (angled/mitred tube ends).

Staged: (1) the bezier **model** (data + curve maths, unit-testable) → (2) angled
**caps** (small geometry) → (3) the on-preview **overlay UI** (needs live
interaction testing — the user verifies it, since the running dev server belongs
to a parallel chat and this session's browser can't reach it).

## Part 1 — Bezier spine model (foundation, no UI)

**Stop tangent data.** `LoftStop` gains optional tangent fields (defaulting to
auto): `ta` (tangent angle, radians), `hlf` (forward handle length, fraction of
frame), `hlb` (back handle length), `manual` (boolean — true once the user drags a
handle; auto stops re-smooth). `parseStops`/`sanitizeStop` tolerate their absence
(legacy stops have none). `serializeStops` includes them.

**Auto-smooth.** `autoSmoothStops(stops)` derives `ta`/`hlf`/`hlb` for every
non-`manual` stop from its neighbours (Catmull-Rom-equivalent tangents), leaving
`manual` stops untouched. Runs at load (migration) and whenever an auto stop's
position changes. (Mirrors the String effect's `autoSmooth` in
`~/lib/spacetype/stringPath.ts` — reuse its handle math or a small local copy.)

**Bezier `sampleSpine`.** `sampleSpine` changes from Catmull-Rom to **cubic bezier
through the stops** using their handles: for segment `i→i+1`, `P0 = stop[i]`,
`P1 = stop[i] + forwardHandle(i)`, `P2 = stop[i+1] + backHandle(i+1)`,
`P3 = stop[i+1]`; sample by arc length as today. Handles come from `ta`/`hlf`/`hlb`
(a stop with none is auto-smoothed first). The parallel-transport frame + closed
wrap + endpoint-`t` behaviour are unchanged — only the position curve changes.

**Migration / compatibility.** Legacy stops (no tangent fields) are auto-smoothed
on load → the bezier curve reproduces the old smooth Catmull-Rom look, so existing
lofts render visually identical until a handle is dragged. The spine-sampling unit
tests (frame orthonormality, endpoint `t`, closed wrap, coincident-stop guard)
still hold — they assert frame/endpoint properties, not exact interior positions.

## Part 2 — Angled end caps (small)

**Control:** `capAngle` slider (`min -80, max 80, step 1, default 0`, group Style)
— degrees the end caps tilt from perpendicular.

**Geometry:** the fill caps (round 3a) are perpendicular fans at the end stations.
When `capAngle != 0`, shear each end cap: offset every cap vertex ALONG the
station tangent by `tan(capAngle) * (projection of the vertex onto the shear axis)`
— i.e., the cap plane tilts by `capAngle`. Applies to both end caps (continuous)
and both band-end caps are NOT affected (only the two OUTER ends of the whole
sweep — start cap of the first element, end cap of the last). Passed from the
effect as `capAngle` in the builder opts; 0 = today's perpendicular caps.

## Part 3 — On-preview overlay editor (UI)

**Component:** `LoftSpineEditor.vue` — an SVG overlay tracking the preview canvas's
on-screen rect (modeled on `StringPathEditor.vue`). Draws the spine as a cubic
bezier through the stops' `x,y` (normalized 0..1), with:
- draggable **point** nodes (updates stop `x,y`),
- draggable **tangent handles** per point (updates `ta`/`hlf`/`hlb`, sets
  `manual=true` for that stop),
- add/remove points (reuse the existing add/remove-stop affordances),
- it edits ONLY `x,y` + tangents; `z`/width/height/roll/colour pass through
  unchanged (still edited via the inspector sliders + "set all" masters).
Contract: props `{ modelValue: string }` (the stops JSON), emit `update:modelValue`
— same as `ProfileStopsEditor`, so it drops into the existing `profileStops`
control wiring.

**Edit-spine mode.** The loft studio (`SpaceTypeSurface`) gets an **"Edit spine"**
toggle (shown for the loft effect). While active: (a) render the overlay over the
preview, (b) force the preview **head-on** (temporarily zero the scene
`rotateX/rotateY/rotateZ` so screen = the spine's x/y plane) and restore on exit.
The existing `ProfileStopsEditor` (the small XY canvas + inspector) stays as the
non-overlay editor; the overlay is the richer on-preview mode.

**Reuse.** `StringPathEditor.vue`'s overlay mechanics (canvas-rect tracking,
pointer→normalized mapping, handle drag, auto/manual mode, `autoSmooth`) are the
template; `LoftSpineEditor` adapts them to the loft stop array (pass-through of the
non-spine fields).

## Files

**Modify:**
- `app/lib/spacetype/loftStops.ts` — `LoftStop` tangent fields; `sanitizeStop`
  tolerance; `autoSmoothStops`; serialize includes tangents.
- `app/lib/spacetype/loftGeometry.ts` — bezier `sampleSpine` (handles + auto-smooth
  fallback); `capAngle` shear in the end-cap emission of `buildLoftGeometry`/
  `buildSlicedLoftGeometry`.
- `app/lib/spacetype/effects/loft.ts` — `capAngle` control + pass to builders.
- `app/components/vue-canvas/SpaceTypeSurface.vue` — "Edit spine" toggle + head-on
  override + render `LoftSpineEditor` when active.

**New:**
- `app/components/vue-canvas/LoftSpineEditor.vue` — the on-preview overlay.

## Tests

- Part 1: `autoSmoothStops` derives handles for auto stops, leaves manual ones;
  bezier `sampleSpine` still yields orthonormal frames + endpoint `t` + closed
  wrap; a manual handle visibly bends the curve (a sampled interior point moves vs
  the auto curve); legacy stops (no tangents) sample without throwing.
- Part 2: `capAngle != 0` shears the end-cap vertices (a cap vertex's position
  shifts along the tangent proportional to its shear-axis projection); `capAngle=0`
  = today's caps (byte-identical).
- Part 3: no unit test for the Vue overlay (drag UI) — the model tests cover the
  data; the user live-verifies the overlay interaction.

## Out of scope (follow-ups)

- Full 3-D on-preview dragging (depth on the overlay) — 2-D-first; depth stays a
  slider.
- Per-end cap angles (v1 is one global angle).
- Replacing the small `ProfileStopsEditor` canvas — the overlay is added alongside.

## Verification note

The overlay (Part 3) is an interactive drag editor whose correctness is the
interaction itself — it cannot be meaningfully unit-tested, and this session's
browser tools can't reach the running dev server (a parallel chat owns it). So
Parts 1–2 are proven by unit tests + review; Part 3's UI is built to the
`StringPathEditor` pattern and **the user live-verifies the drag/handle behaviour**.
