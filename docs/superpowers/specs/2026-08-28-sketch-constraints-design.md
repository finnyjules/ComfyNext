# Sketch layers: constraint-aware precise drawing in Shape Studio

**Date:** 2026-08-28
**Status:** Designed, awaiting plan
**Inspiration:** Opacity's rebuilt pen tool (x.com/OpacityHQ/status/2089745364681163120, x.com/brdrck/status/2092265495349125373, x.com/brdrck/status/2085773470642639198)

## What we're building, in one paragraph

A new kind of Shape Studio layer where you draw real geometry — lines, circles, arcs — and the relationships you draw with (touching, tangent, same center, level with) are **remembered as live rules**. Drag anything afterwards and the whole drawing re-arranges itself so every rule stays true: tilt a line and the circles resting on it roll along, still touching. Rules are visible as small badges pinned to the drawing itself, and measurements (radius, distance) show as editable chips. The agent can speak the same language ("make these two tangent", "set this radius to 40"). Because a sketch is just another layer, everything Shape Studio already does — cloning and arranging, overlaps, boolean folds, fills — works on drawn geometry too.

## Why

- Precise drawing is the gap between Sailor's generators and hand-made vector work. Today no surface lets you *construct* geometry (a circle tangent to two others) — you can only eyeball it.
- Relationships-as-data is agent gold. "Two circles tangent to this line, 40px apart" is a one-line instruction against a rule system, and hopeless coordinate math against raw beziers.
- Shape Studio is the right home: a sketch that feeds the existing clone/arrange/boolean/fill pipeline gives us combinations (a drawn constrained petal, arrayed radially 12 times, boolean-folded) that neither Opacity nor Figma has.

## The model (learned from Opacity, adapted)

Three ideas, in order of importance:

1. **Shapes keep their meaning.** A circle is stored as center + radius, an arc as center + radius + angles — not as bezier approximations. You can only say "tangent" about things that know they're circles. (Export converts to paths at the very end.)
2. **Rules are captured when you draw, and stay visible.** While drawing, the tool notices relationships (this new circle touches that line) and shows them as small badges at the touch points; finishing the stroke keeps them. Badges stay pinned to the geometry afterwards — click one to remove the rule. No hidden rule manager.
3. **Every edit re-solves the drawing.** Dragging is just a temporary extra wish ("this point wants to be under the cursor"); the solver moves everything so all stored rules stay true, live, during the drag.

### Interaction, three layers

- **Draw-time suggestions:** while placing a shape, candidate relationships appear as chips at the relevant points (on-curve ⊙, tangent, level-with guides) plus a live dimension chip (`R 50.5`). Landing the click accepts them.
- **Persistent badges:** anchors that carry rules show their badges; measurements stay as chips. Click a badge to delete its rule. Click a dimension chip to type an exact value (typing one *pins* it — it becomes a rule).
- **Selection verbs:** right-click menu, context-sensitive. One line → Horizontal, Vertical. Two points → Coincident, Midpoint. Circle + line/circle → Tangent, Concentric. Always: Fix (pin in place), Make construction, Mirror.
- **Repeat is NOT a sketch feature** — it's the existing Shape Studio arrange (count/layout on the layer). The sketch draws one unit; the studio arrays it. This is the payoff of living inside Shape Studio.

### V1 vocabulary (curated, like Opacity's — not the full CAD zoo)

- **Entities:** point, line segment, circle, arc. Each can be marked *construction* (guides the drawing, doesn't render).
- **Geometric rules:** coincident (same point), point-on-entity, tangent, concentric, horizontal, vertical, midpoint, equal (radius/length), symmetric (about a construction line), fixed.
- **Measured rules (dimensions):** radius, distance between two points, angle of a line.
- **Deferred to v2:** freeform bezier paths inside sketches, parallel/perpendicular, offset curves.

## Architecture

### New library: `frontend/app/lib/sketch/` (dependency-light tier)

Following the geoshape discipline — no `paper`, no `three` in the model/solver files, so they run in plain unit tests and in `studioTune.ts`:

- `model.ts` — the document. Entities and rules with **stable ids** (rules reference entity ids, never array positions — the `idPath.ts` precedent). The doc stores **already-solved positions**: rendering never solves.

  ```ts
  interface SketchDoc {
    entities: SketchEntity[]     // { id, kind: 'point'|'line'|'circle'|'arc', construction, ...solved params }
    constraints: SketchConstraint[]  // { id, kind, refs: EntityRef[], value? }  value for dimensions
  }
  ```

- `solve.ts` — the solver. Each rule becomes a residual function ("how wrong is this rule right now, as a number"); solving is damped least-squares over all residuals until they're ~zero. Dragging adds a soft "point wants to be here" residual. Budget: a few ms at the entity cap (120), every pointer move. Deterministic (no randomness). Iteration cap; if it can't converge, positions revert to last good — geometry never explodes.
- `infer.ts` — draw-time suggestion: given cursor position + existing entities, propose snaps and the rules they'd create.
- `sketchPath.ts` — SketchDoc → SVG `d` string (pure; arcs emitted as arc commands or bezier equivalents).
- `merge.ts` — `mergeSketchDoc(raw): SketchDoc`, the tolerant validator every studio blob has: clamps, defaults, deep-copies, and **drops rules whose entity refs no longer exist** (the dead-key degradation, applied to constraints).

### Shape Studio integration

- `GeoLayer` gains `kind: 'mark' | 'sketch'` and `sketch?: SketchDoc`. `mergeStudioDoc` defaults missing kind to `'mark'` — legacy docs unaffected.
- Render: a sketch layer contributes `sketchPath(doc)` where a mark layer contributes `baseShapePath(cfg)`. Everything downstream — arrange, composite, overlap faces, fills — is unchanged and works on sketches.
- **Solve live, fold on settle:** during a drag the solver runs per pointer move on the raw sketch only; the boolean composite re-runs on pointer-up (existing async/rAF-coalesced render). The O(N²) fold is never in the drag loop.
- Editing UI lives in `ShapeStudioSurface.vue` as a sketch-edit mode when the active layer is a sketch: draw tools (line, circle, arc), drag-with-solve, badges/chips overlay, context menu. Sketch layers show sketch controls; mark layers keep the existing panel (`visibleGeoControls`-style gating by layer kind).

### Agent integration

- Extend the Shape Studio `PatchAdapter` in `studioTune.ts`: sketch-aware ops — add entity, apply rule between two ids, set a dimension value, remove a rule. Addressing by stable entity id (the `configParams` id-path pattern; a stale id makes the op dead, not misdirected).
- `agentControls.ts` guidance teaches the vocabulary in plain terms with two worked examples.

### Curvature comb (independent quick win)

A visual aid for freeform curves: tiny perpendicular hairs along a path whose length/color show how sharply it bends, so invisible lumps become visible and fixable. Pure local math (`stringGeometry.ts` already evaluates cubic points/tangents — curvature is one more derivative). Ships as an optional overlay for existing path editors (Compositor node-edit, String paths) — **not coupled to the solver work**, can land before or after.

## Error handling

- **Contradictory rules** (over-constrained): least-squares distributes the error; when residuals stay above tolerance, the involved badges turn a warning color and the last-added rule is the suggested removal. V1 does not auto-resolve.
- **Deleted referents:** rules pointing at removed entities are dropped at merge time, silently in render, visibly (toast) in the editor.
- **Solver failure:** revert to last-converged positions for that drag frame; never render a non-converged state.

## Testing

- Solver unit tests against analytic answers (circle tangent to line at known point; concentric + radius = exact position; over-constrained case flags, doesn't explode).
- Drag-simulation tests: scripted pointer paths, assert rules hold within tolerance at every step.
- Harness E2E on the dev page (Playwright), including a **deliberately broken control** first (per the runtime-bugs lesson: prove the test can fail).
- Merge round-trip: SketchDoc → JSON → merge → identical; hostile/legacy blobs degrade cleanly.
- Render parity: sketch layer through the studio pipeline produces the same `d` as `sketchPath` directly (input-correlation checked, not just self-agreement).

## Build order

1. **Prove the solver on a standalone page.** `lib/sketch/` model + solver + a hidden dev page (blank canvas, draw circles/lines, apply rules, drag). No persistence, no studio. Exit test: two circles tangent to a line stay tangent while the line rotates, at 60fps, and it *feels* right.
2. **Mount in Shape Studio.** Layer kind, merge, render-through-pipeline, minimal editing (draw + drag + delete). Exit: a sketch layer arranged radially and boolean-folded, saved and reloaded.
3. **Interaction polish.** Draw-time inference chips, persistent badges, editable dimension chips, context-menu verbs, construction geometry, mirror.
4. **Agent verbs + comb.** Sketch-aware tuner ops with guidance; curvature comb overlay (independently landable).

Each phase is separately shippable; stopping after phase 1 costs one hidden page.

## Perf guardrails

- Entity cap per sketch (start: 120) — matching the spirit of `PIECES_MAX_CLONES`.
- Solver iteration cap per frame; carry-over between frames (warm start from current positions makes drags cheap).
- The boolean fold and overlap faces never run during drag — settle only.

## Explicitly out of scope for v1

- Constraints between different layers' sketches.
- Constraints on mark (parametric) layers.
- Freeform bezier entities inside sketches (the comb covers curve *quality* in the existing editors instead).
- Canvas-level (cross-node) constraints.
