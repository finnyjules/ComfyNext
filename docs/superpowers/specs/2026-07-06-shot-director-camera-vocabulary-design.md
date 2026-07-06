# Shot Director — camera vocabulary upgrade

**Date:** 2026-07-06
**Status:** Design approved (full pass). Source: aicameramovements.com taxonomy (46 moves / 8 categories / descriptive clauses).
**Related:** [[project_shot_director]] (ShotCameraPicker, ShotViewfinder, compile). Keeps one-move-per-shot.

## Learnings applied
1. **Descriptive, model-legible phrasing** beats short labels for generation fidelity — compile the *physical action*, not just a name.
2. **Direction** is a first-class part of many moves (pan L/R, orbit CW/CCW, tilt up/down…).
3. **Dolly (physical) ≠ zoom (optical)** — our ambiguous "push-in" conflated them.
4. **Categories** organize a growing move set. But NOT all 46 — a curated ~16 stays on-guardrail.

## Data model (`types.ts`)

Keep the existing 8 move ids (back-compat, no migration): `push-in, pull-out, pan,
track, orbit, aerial, handheld, locked-off`. Add 8: `tilt, whip-pan, zoom-in,
zoom-out, truck, pedestal, arc, crane` → **16 total**.

- `CameraDirection = 'left' | 'right' | 'up' | 'down' | 'cw' | 'ccw'`.
- `ShotCamera` gains optional `direction?: CameraDirection`.
- `MOVE_DIRECTIONS: Record<CameraMove, CameraDirection[]>` — allowed dirs (most `[]`).
  - L/R: pan, whip-pan, truck, arc. U/D: tilt, pedestal, crane. CW/CCW: orbit.
- `MOVE_DEFAULT_DIR: Partial<Record<CameraMove, CameraDirection>>` — right / up / cw.
- `MOVE_CATEGORY: Record<CameraMove, 'Static'|'Pan/Tilt'|'Zoom'|'Dolly'|'Physical'|'Orbit'|'Aerial'|'Human'>`.
- `CAMERA_MOVE_PHRASE` (existing short label, keep for dropdowns/beats) — extended to 16.
- NEW `cameraMoveClause(move, direction?): string` — the descriptive compile clause,
  e.g. push-in → `"dolly in, the camera moving physically forward"`, zoom-in →
  `"zoom in, lens only with the camera fixed"`, pan+right → `"pan right, rotating
  horizontally"`, orbit+ccw → `"orbit counterclockwise around the subject"`. Concise
  (word budget) but names the physical action. Direction interpolated where applicable.

`hydrate.ts`: unknown move → `locked-off`; `direction` kept only if in that move's
`MOVE_DIRECTIONS`, else dropped.

## Compile (`compile.ts`)
`cameraLine` / `beatLine` use `cameraMoveClause(move, direction)` instead of
`CAMERA_MOVE_PHRASE[move]`. Shape unchanged: `"{ShotType}, {pacing} {clause}."`.
(Beats stay move-only, no per-beat direction — scope.)

## UI
- **ShotCameraPicker**: the move grid groups by `MOVE_CATEGORY` (small category
  labels). Below it, a **direction control** appears only when the selected move has
  `MOVE_DIRECTIONS.length` — a 2-button toggle (← →, ↑ ↓, or ⟳ ⟲) emitting
  `update:direction`. Selecting a move seeds its default direction.
- **ShotViewfinder**: move-motif is direction-aware — the existing motif kinds map
  the 16 moves; horizontal/vertical arrows point per direction, orbit/arc curve per
  CW/CCW. New `direction` prop.

## Testing
- Unit: `cameraMoveClause` for representative moves incl. every direction axis; the
  dolly-vs-zoom clauses differ; unknown/absent direction is safe.
- Unit: compile emits the descriptive clause + direction; existing golden prompts
  updated to the new phrasing.
- Unit: hydrate drops an invalid direction, defaults unknown move.
- Browser (harness): grouped picker, direction toggle appears/flips for a directional
  move, viewfinder glyph reflects direction.

## Build order (two commits)
1. **Logic**: types (moves/dirs/categories/clause) + compile + hydrate + tests.
2. **UI**: ShotCameraPicker grouping + direction toggle; ShotViewfinder direction glyphs.

## Files
- `frontend/app/lib/shotdirector/types.ts`, `compile.ts`, `hydrate.ts`
- `frontend/app/components/vue-canvas/ShotCameraPicker.vue`, `ShotViewfinder.vue`
- `frontend/tests/unit/shotdirector-*.unit.spec.ts` (camera clause, compile, hydrate)
