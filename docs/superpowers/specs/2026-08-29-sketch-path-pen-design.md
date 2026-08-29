# Sketch paths: construction path tool + bezier pen

**Date:** 2026-08-29
**Status:** Designed, awaiting plan
**Builds on:** `2026-08-28-sketch-constraints-design.md` (solver + drawing surface, both landed dev-only)
**Inspiration:** Opacity demos — pen panel (x.com/OpacityHQ/status/2089745364681163120), smart flower construction (x.com/brdrck/status/2092265495349125373), OpenAI-knot logo construction (x.com/brdrck/status/2092716899008188560), curvature comb (x.com/brdrck/status/2085773470642639198)

## What we're building, in one paragraph

Paths join the sketch system: chains of anchors connected by straight, arc, or (milestone 2) curved segments, drawn point by point with the same live constraints as everything else. Plus the two structural verbs that make the logo workflow possible: **Repeat…** (copies arranged around a center) and **Mirror…** (a reflected copy) — where copies are real geometry held in place by rules, so you can weld them together and drag *any* copy to re-solve the whole figure. Exit test for milestone 1: draw the OpenAI-style knot — one line+arc unit, repeated six times, welded with Coincident, every dimension still editable. Milestone 2 adds the classic freeform pen (click = corner, click-drag = smooth anchor with handles) with a "smooth" rule that keeps curves kink-free. Everything lands on the `/dev/sketch-draw` page first; the Shape Studio mount stays a separate later decision.

## Why

- The construction workflow (paths + dimensions + repeat + weld, live forever) is what turns the sketch system into a **logo tool** — the star of every Opacity demo, and the thing neither hand-drawn bezier nor our current circles/lines can do alone.
- The freeform pen is the classic drawing gesture designers expect; building it on the same path model (anchors are points, handles are points) means one system, not two.
- Live copies via rules (not stamps) is the leap: edit anything, the whole figure re-solves — symmetric logos stay symmetric.

## The model

### Path entity

```
PathEntity {
  id, kind: 'path'
  anchors: EntityId[]            // ordered point ids
  segments: SegmentSpec[]        // length = anchors.length - 1 (or == length if closed)
  closed: boolean
  construction?: boolean
}
SegmentSpec =
  | { kind: 'line' }
  | { kind: 'arc'; center: EntityId; sweep: 0 | 1 }     // radius = dist(center, anchor); solver keeps both ends equidistant
  | { kind: 'cubic'; h1: EntityId | null; h2: EntityId | null }   // milestone 2; handle point ids
```

- **Anchors, arc centers, and handles are all `point` entities.** The solver never learns a new motion concept; a path is pure structure over points.
- An **arc segment** references a center point. On creation we auto-add an `equalDist` rule (dist(center, A) = dist(center, B)) so the arc stays a true circular arc while anything moves. Radius chip = a `distance` dimension from center to an anchor.
- A **cubic segment** (milestone 2) references optional handle points. A missing handle = that side is straight-ish (handle sits on the anchor).
- **Smooth rule** (milestone 2): `collinear` — in-handle, anchor, out-handle stay on one line (one cross-product residual). Applied automatically when an anchor is drawn by click-drag; removable by badge/verb like any rule.

### New constraint kinds (all simple algebra, tested analytically like the existing ten)

| Kind | Refs | Residuals | For |
|---|---|---|---|
| `equalDist` | [pA, pB, pC, pD] | dist(A,B) − dist(C,D) | arc integrity (center↔endA = center↔endB); also "equal radius" between arcs |
| `rotatedFrom` | [copy, orig, center], value=angle° | copy − rotate(orig−center, angle)−center (2 residuals) | Repeat |
| `mirroredFrom` | [copy, orig, axisLine] | copy − reflect(orig, axis) (2 residuals) | Mirror |
| `collinear` | [pA, pB, pC] | cross(B−A, C−A) (1 residual) | smooth anchors; also point-on-infinite-line uses stay as-is |

### Repeat… and Mirror… (structural verbs)

- **Repeat…**: select entities → pick a center point (click on canvas or an existing point) and a count. For each source point, N−1 real copy points are created, each with a `rotatedFrom` rule at k·(360/N)°. Copy paths/lines/circles are created referencing the copy points. Copies render, select, weld, and drag like anything else; dragging a copy re-solves the original through the rules (bidirectional — the video behavior).
- **Mirror…**: same shape, with an axis line (construction or real) instead of center+count.
- Deleting a copy removes just that copy + its rules. **As built (M1):** deleting an original DETACHES its copies (their rotatedFrom/mirroredFrom rules drop as dangling; the copies stay as free geometry) rather than cascading — revisit if detached copies prove confusing.
- No live "count" editing in v1 (re-run Repeat after deleting copies); recorded as future work.

### Interaction

- **Path tool**: click to place anchors (with the existing snapping — anchors snap onto points/lines/circles and record the rule). While drawing, a keypress or toolbar toggle switches the *next* segment between line and arc (arc places its center at the perpendicular midpoint initially; drag before release adjusts bulge side = sweep). Double-click or click-on-first-anchor to close; Escape/Enter to end open.
- **Pen behavior on anchors (milestone 2)**: plain click = corner anchor; click-drag = smooth anchor (drag pulls out symmetric handles; `collinear` rule auto-added). Handles render as thin arms with dots when the anchor is selected; drag them live-solved.
- **Menu grows**: Repeat…, Mirror…, Make construction, Flip H/V, Copy as SVG on the existing context-sensitive bar; selection header counts ("Fix 5 points" style). Value entry via the existing script-method prompt pattern.
- **Badges**: arc radius chips, `equalDist`/`rotatedFrom`/`mirroredFrom`/`collinear` glyphs via the existing annotate layer.

### Rendering / export

- `sketchPath` learns paths: line segments → `L`, arcs → `A` (radius from center distance, large-arc from geometry, sweep from spec), cubics → `C` (milestone 2). Closed → `Z`.
- Copy-as-SVG = existing `sketchPathData` output to clipboard.

## Milestones

**M0 — solver cleanups (small, first):** in-loop early-break on HARD residual only (stop burning maxIter — matters with repeat-sized docs); `n===0` early-return honors the revert contract + consistent threshold.

**M1 — construction path tool (exit: the knot):** path entity + line/arc segments + `equalDist`; path drawing tool with segment toggle + snapping + close; `rotatedFrom`/`mirroredFrom` + Repeat…/Mirror… verbs with canvas center/axis pick; welding via existing Coincident; Make construction toggle + construction rendering (dashed, excluded from export); Flip H/V; Copy as SVG; badges for the new rules. Exit test scripted end-to-end: build the knot via `window.__sketchDraw`, drag a dimension, assert all copies + welds hold; and drawn by hand in the Browser pane.

**M1.5 — trim (stretch, only if M1 lands clean):** cut a circle/line at its intersections with selected neighbors; kept pieces become arc/line path segments (flower workflow). Circle/line intersections are closed-form — no new dependency.

**M2 — freeform pen (exit: a smooth blob):** cubic segments + handle points + `collinear` smooth rule; click vs click-drag anchor gesture; handle rendering + drag; smooth/corner toggle per anchor; anchor snapping onto geometry.

**Follow-up (already agreed, not in this program):** curvature comb overlay; Shape Studio mount; live-editable repeat count.

## Error handling

- Rules referencing deleted path members: existing cascade + merge-drop semantics (dangling → dropped, tolerantly).
- Over-constrained welds (e.g. coincident + rotatedFrom conflict): existing behavior — solver reverts, status shows not-converged; last-added rule is the suggested removal.
- Arc degenerate (center dragged onto an anchor): radius → ~0; clamp arc rendering to a line segment when radius < epsilon rather than emitting NaN path data.

## Testing

- Analytic unit tests per new residual kind (rotation at known angles, reflection across known axes, collinear at known offsets), same style as the existing ten.
- Path emitter tests: exact `d` strings for line/arc/closed/cubic paths, degenerate-arc clamp.
- E2E: scripted knot build (M1) and blob draw (M2) via `window.__sketchDraw`, asserting geometric invariants (weld distances ~0, rotational symmetry holds after a drag, smooth anchors stay collinear).
- Perf guard: knot-scale doc (≈60–80 points, ≈80+ constraints) must drag at interactive rates on the dev page; measure and record.

## Out of scope

- Shape Studio mount, agent verbs for paths, curvature comb (follow-ups).
- Elliptical arcs, variable-width strokes, path booleans (Compositor already has paper.js booleans for baked shapes).
- Live-editing a Repeat's count after creation.
