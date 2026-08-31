# Sketch Feel Backlog (M5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Finish everything scoped before the Shape Studio mount — the solver goes fast enough for mandala-scale play (analytic Jacobian), the constraint vocabulary completes (Midpoint, Equal), constraints become removable by clicking their badges, path segments become selectable/constrainable, construction guides get a first-class placement flow, dimensions can be typed while drawing, and a snap fires a little delight.

**Architecture:** Solver gets an analytic Jacobian (lib). Two new residuals + verbs. The rest is page work: clickable badges, a segment-selection channel, a guide toggle, a dimension-typing buffer, a sparkle overlay. All on `/dev/sketch-draw`.

## Global Constraints

- All prior sketch global constraints apply (no paper/three in lib/sketch; deterministic — no Math.random/Date.now IN lib/sketch; solve only on interaction; staging discipline — NEVER `git add -A`; shared `lib/sketch/` dir untouchable files `sketchIntent.ts`/`sketchPadPrompt.ts`/`sketchPile.ts`; find live dev port by curl-probing 3000-3004 for `/dev/sketch-draw`→200, never start/stop servers; full sketch suite green after every task).
- **`vue-tsc` gate every task:** `npx vue-tsc --noEmit 2>&1 | grep -E "sketch"` → NO new sketch errors.
- **Model mutations commit history** (`commitHistory()`); view/selection changes do NOT. (M4 established this.)
- The page uses `window.prompt` ONLY from `<script setup>` methods, never bare in a template. Solve never runs in a computed.
- Sparkle/animation (page-only, allowed to use `performance.now`/`requestAnimationFrame` in the PAGE, never in lib/sketch).

**Existing lib API** (import `~/lib/sketch/...`): `model` (types incl. `PathEntity`, `SegmentSpec`, `ConstraintKind`, accessors), `geom`, `solve` (numerical-Jacobian LM), `residuals` (`constraintResiduals`), `edit` (`add*`, `removeConstraint`, `deleteEntity`, `repeatEntities`/`mirrorEntities`, `pointClosure`), `infer`, `merge`, `annotate` (`constraintMarks`, `arcDimensionMarks`), `clone` (`cloneDoc`). Residual kinds so far: coincident, pointOnLine, pointOnCircle, tangentLineCircle, tangentCircleCircle, concentric, horizontal (line OR 2-point), vertical (line OR 2-point), distance, radius, equalDist, rotatedFrom, mirroredFrom, collinear, perpendicular, parallel.

All paths relative to `frontend/`.

---

### Task 1: Analytic Jacobian (solver perf)

Replace the finite-difference Jacobian in `solve.ts` with analytic partial derivatives, assembled sparsely. This removes the O(n) residual re-evaluations per iteration and is the lever for mandala-scale liveness.

**Files:**
- Create: `app/lib/sketch/jacobian.ts`
- Modify: `app/lib/sketch/solve.ts` (use analytic J)
- Test: `tests/unit/sketch-jacobian.unit.spec.ts`

**Interfaces:**
- `jacobianRows(doc, constraint): { param: { id: EntityId; comp: 'x'|'y'|'r' }, d: number }[][]` — for one constraint, returns one array of (param, partial-derivative) entries per residual it contributes. Params reference the point coord (`x`/`y`) or circle `r` the residual depends on. Only NON-zero partials.
- `buildJacobian(doc, slots, constraintResidualLayout): number[][]` — assemble the full m×n dense matrix for the solver from the per-constraint rows, mapping each `{id,comp}` to its slot column (skip params not in `slots`, i.e. fixed/held). Order of rows must match `constraintResiduals(doc)` exactly.

**Correctness gate:** the analytic Jacobian MUST match a finite-difference Jacobian to ~1e-5 for every constraint kind (the test does this comparison; any mismatch = a wrong derivative).

- [ ] **Step 1: Write the analytic-vs-numerical test** (`tests/unit/sketch-jacobian.unit.spec.ts`): for a doc containing at least one instance of EACH constraint kind, compute the analytic Jacobian (`buildJacobian`) and a numerical one (perturb each slot by h=1e-6, diff `constraintResiduals`), assert every entry matches within 1e-4. Also a per-kind micro-test for the trickier ones (tangentLineCircle, rotatedFrom, mirroredFrom, distance, radius, collinear).
- [ ] **Step 2:** Run → FAIL (jacobian.ts absent).
- [ ] **Step 3: Implement `jacobian.ts`** — per-constraint analytic partials. Reference formulas (residual → nonzero partials):
  - `coincident[A,B]`: r=[Ax−Bx, Ay−By] → ∂r0/Ax=1, ∂r0/Bx=−1; ∂r1/Ay=1, ∂r1/By=−1.
  - `distance[A,B]=|A−B|−v`: let d=|A−B|, u=(A−B)/d → ∂/Ax=ux, ∂/Ay=uy, ∂/Bx=−ux, ∂/By=−uy. (d≈0 → zero partials.)
  - `radius[circle]=r−v` → ∂/circle.r=1.
  - `equalDist[A,B,C,D]=|A−B|−|C−D|`: u=(A−B)/|A−B|, w=(C−D)/|C−D| → ∂/A=u, ∂/B=−u, ∂/C=−w, ∂/D=w.
  - `horizontal` (line `[L]` or 2pt `[A,B]`)=Ay−By → ∂/Ay=1, ∂/By=−1. `vertical`=Ax−Bx → ∂/Ax=1, ∂/Bx=−1. (For line form, A/B are the line's endpoints.)
  - `pointOnLine[P,line]`=signed dist of P to line(a,b): res=cross(b−a, P−a)/|b−a|. Partials via quotient/cross rule w.r.t. P.x,P.y,a.x,a.y,b.x,b.y — derive carefully; test against numerical.
  - `pointOnCircle[P,circle]`=|P−C|−r → u=(P−C)/|P−C| → ∂/P=u, ∂/C=−u, ∂/circle.r=−1.
  - `tangentLineCircle[line,circle]`=|dist(C,line)|−r: dist(C,line)=cross(b−a,C−a)/|b−a| (signed s); res=|s|−r; ∂|s|=sign(s)·∂s → chain the ∂s partials (like pointOnLine w.r.t. C and a,b) times sign(s); ∂/circle.r=−1.
  - `tangentCircleCircle[cA,cB]`=|CA−CB|−(rA+rB): u=(CA−CB)/dist → ∂/CA=u, ∂/CB=−u, ∂/cA.r=−1, ∂/cB.r=−1.
  - `concentric[cA,cB]`=[CAx−CBx, CAy−CBy] → like coincident on centers.
  - `collinear[A,B,C]`=cross(B−A,C−A)=(Bx−Ax)(Cy−Ay)−(By−Ay)(Cx−Ax): partials w.r.t. all six coords (expand).
  - `perpendicular[a,b,c,d]`=dot(b−a,d−c): ∂/a=−(d−c), ∂/b=(d−c), ∂/c=−(b−a), ∂/d=(b−a) (component-wise: ∂/ax=−(dx−cx), ∂/ay=−(dy−cy), etc.).
  - `parallel[a,b,c,d]`=cross(b−a,d−c): expand partials.
  - `rotatedFrom[copy,orig,center]`, value=deg θ, R=rot(θ): res=[copyx−(cx+ce·(ox−cx)−se·(oy−cy)), copyy−(cy+se·(ox−cx)+ce·(oy−cy))] where ce=cos, se=sin. Partials: ∂/copy=I; ∂/orig = −R (a 2×2 block); ∂/center = −(I − R) block. Derive the 8 nonzero entries; test vs numerical.
  - `mirroredFrom[copy,orig,axisLine]`: reflection across the infinite line. res=copy−reflect(orig; a,b). Partials w.r.t. copy=I; w.r.t. orig, a, b via the reflection formula. This is the hairiest — derive OR (acceptable fallback for THIS kind only) compute its rows numerically (perturb only the ≤6 involved coords) while all other kinds are analytic. Document the choice.
  Assemble `buildJacobian` mapping `{id,comp}`→slot column.
- [ ] **Step 4:** Run the analytic-vs-numerical test → PASS.
- [ ] **Step 5: Swap `solve.ts`** to build J via `buildJacobian` instead of finite differences. Keep the LM loop, damping, revert-on-failure, hard-residual break, regularization rows (∂reg_j/q_j = W_REG, identity), and drag handling IDENTICAL — only the J source changes. All existing `sketch-solve` tests must pass UNCHANGED (same convergence, same 4-decimal tangency).
- [ ] **Step 6: Perf measurement.** Extend/replace `tests/unit/sketch-solve-perf.unit.spec.ts`: build a mandala doc (a 3-point unit repeated 30–40× via `repeatEntities` ≈ 120–160 points) and time drag-solves; assert mean well under the old numerical time (record the number). Loosen the machine-load threshold generously but assert a real improvement vs a numerical baseline captured in the same test.
- [ ] **Step 7:** Full `npm run test:unit -- sketch` green + vue-tsc gate. **Commit**:
```bash
git add app/lib/sketch/jacobian.ts app/lib/sketch/solve.ts tests/unit/sketch-jacobian.unit.spec.ts tests/unit/sketch-solve-perf.unit.spec.ts
git commit -m "perf(sketch): analytic Jacobian — mandala-scale solving"
```
- [ ] **Step 8 (controller):** live-measure mandala-scale drag on the page; record before/after ms. If still solve-dominated (O(n³) Gaussian elimination is now the wall), note it — the follow-up lever is a sparse linear solve or treating repeat/mirror copies as substitutions (OUT of scope here; record for later).

---

### Task 2: Midpoint + Equal verbs

**Files:** `app/lib/sketch/model.ts`, `app/lib/sketch/merge.ts`, `app/lib/sketch/residuals.ts`, `app/lib/sketch/jacobian.ts`, `app/pages/dev/sketch-draw.vue`, tests.

**New residuals:**
- `midpoint[P, A, B]` = [Px−(Ax+Bx)/2, Py−(Ay+By)/2] (P pinned to the middle of segment A–B). Jacobian: ∂/Px=1, ∂/Ax=−0.5, ∂/Bx=−0.5 (and y). Add to model ConstraintKind, merge, residuals, jacobian.
- `equalRadius[cA, cB]` = cA.r − cB.r. Jacobian: ∂/cA.r=1, ∂/cB.r=−1. (Line-length equality reuses existing `equalDist`.)

**Verbs (page `availableConstraints`/`orderRefs`/`apply`):**
- 1 point + 1 line selected → **Midpoint** → `midpoint[P, lineA, lineB]`.
- 2 lines selected → **Equal** (length) → `equalDist[L1a, L1b, L2a, L2b]` (alongside the existing Perpendicular/Parallel for 2 lines).
- 2 circles selected → **Equal** (radius) → `equalRadius[c1, c2]` (alongside Concentric/Tangent).

- [ ] Analytic-partial tests for midpoint + equalRadius (vs numerical); residual value tests; merge accepts the kinds. Page verbs offered for the right selections; apply produces the right refs; live: apply Midpoint moves the point to the segment's middle and holds under drag; Equal makes two lines equal length. E2E for one of each. Full suite + vue-tsc gate. **Commit** `feat(sketch): Midpoint + Equal constraint verbs`.

---

### Task 3: Badge click-to-remove + Escape aborts marquee/pan

**Files:** `app/pages/dev/sketch-draw.vue`, `tests/sketch-draw.spec.ts`.

- **Click a constraint badge to remove its rule** (the Opacity model): the `constraintMarks` badges (currently display-only) become clickable → `removeConstraint(id)` → `runSolve()` + `commitHistory()`. Apply to ALL constraint badges (user-facing AND auto like equalDist/rotatedFrom — undo is the safety net; document that removing an arc's equalDist lets it degenerate). `@pointerdown.stop @click.stop`, `pointer-events:auto`, cursor pointer, a subtle hover affordance. Distinguish from the editable DIMENSION chips from M4 (those edit value on click) — a value-bearing chip edits; a glyph-only badge removes. (For value chips like radius/distance: keep M4's click-to-edit; add a small ✕ affordance or a modifier to remove — simplest: shift+click a value chip removes it, plain click edits.)
- **Escape aborts a live marquee or pan** (carry from M4): if a marquee drag or pan is in progress, Escape cancels it (clears the marquee rect / ends the pan) in addition to the existing path-cancel.

- [ ] Test hook `removeConstraintById(id)` mirroring the click. E2E: create a tangent joint (a `perpendicular`/`tangent` badge), `removeConstraintById` → constraint gone, solve still converges, `undo()` restores it. Live: click a badge, it disappears; Escape mid-marquee clears it. Full suite + vue-tsc gate. **Commit** `feat(sketch): click a constraint badge to remove it; Escape aborts marquee/pan`.

---

### Task 4: Path-segment selection

Let the user select an individual path SEGMENT and apply segment-targeted verbs (the "right answer" to the earlier corner limitation).

**Files:** `app/pages/dev/sketch-draw.vue`, `tests/sketch-draw.spec.ts`.

**Design:**
- Add a segment-selection channel: `selectedSegments = ref<{ pathId: EntityId; segIndex: number }[]>([])`. Clicking a path's hit-`<path>` in select mode selects that SEGMENT (replace; Shift+click adds). Clicking empty or an entity clears segment selection (mutually exclusive-ish with entity selection, or allow both — simplest: selecting a segment clears the entity selection and vice-versa; document).
- Render a selected segment highlighted (thicker/orange stroke on just that segment — emit its own path-data for that one segment).
- **Segment verbs** in `availableConstraints` (when 1 or 2 segments selected): 1 line-segment → Horizontal / Vertical (via the 2-point H/V on its anchors); 2 segments → Perpendicular / Parallel / Equal-length (via perpendicular/parallel/equalDist on the segments' anchor pairs). Reuse the point-pair residuals — a segment resolves to its two anchor ids (`anchors[i]`, `anchors[(i+1)%n]`).
- `apply` handles the segment case: map selected segments → their anchor pairs → the right refs. `commitHistory` on apply.

**Test hooks:** `pickSegment(pathId, segIndex, additive?)`, `clearSegSel()`, `selectedSegments` getter.

- [ ] E2E: draw a 3-anchor path (2 line segments at an angle), `pickSegment(path,0)` + `pickSegment(path,1,true)` → 2 segments selected, `availableConstraints` includes perpendicular; apply → the two segments become perpendicular (dot ≈ 0). Also a single-segment Horizontal test. Live: click a segment highlights just it; verbs appear. Full suite + vue-tsc gate. **Commit** `feat(sketch): path-segment selection + segment-targeted verbs`.

---

### Task 5: Guides-first placement

Make construction geometry a first-class placement mode, so "draw a construction circle, hang shapes on it" is one flow.

**Files:** `app/pages/dev/sketch-draw.vue`, `tests/sketch-draw.spec.ts`.

**Design:**
- A persistent **Guide** toggle button in the toolbar (`guideMode = ref(false)`). While ON, the Point/Line/Circle/Path tools place geometry with `construction: true` (points too — construction points that are GUIDES, distinct from bezier-handle construction points which are gone). Toggle styling makes the mode obvious.
- Guides render dashed/lighter (already the case for construction lines/circles; ensure construction POINTS render distinctly — small hollow/grey). Guides remain full snap/constraint targets (already true).
- Guides are excluded from Copy-SVG export (already true via the construction filter).
- The existing "Make construction" verb stays (toggle existing geometry); Guide mode is the *draw-as-guide* counterpart.

- [ ] Test hook: `setGuideMode(on)`. E2E: `setGuideMode(true)`; draw a circle → it has `construction:true`; `setGuideMode(false)`; draw a path anchor that snaps onto the guide circle → a `pointOnCircle` constraint captured against the guide; Copy-SVG excludes the guide circle. Live: guide toggle draws dashed geometry; snapping to it works. Full suite + vue-tsc gate. **Commit** `feat(sketch): guides-first — draw construction geometry directly`.

---

### Task 6: Type-a-dimension while drawing

Fusion-style: while a segment/arc gesture is live, type digits to set the exact length/radius.

**Files:** `app/pages/dev/sketch-draw.vue`, `tests/sketch-draw.spec.ts`.

**Design:**
- A `dimBuffer = ref<string>('')`. During an active LINE placement (path tool, pending anchor being positioned) or ARC bow, digit/decimal keys append to `dimBuffer` (route in the keydown handler when a draw gesture is active); Backspace edits it; Escape clears it; Enter (or committing the click) applies.
- Show the buffer in the live chip (e.g. the R chip shows the typed value with a caret) so it's visible.
- On apply: for an arc bow, the typed value sets the RADIUS — pin `distance[center, startAnchor]=value` (like the editable chip). For a line, the typed value sets the LENGTH — pin `distance[prevAnchor, newAnchor]=value` and place the new anchor at that distance along the current direction. Then solve + commit. Clear the buffer.
- Keep it scoped: only length (line) and radius (arc). Angle-typing is out.

- [ ] Test hooks: `typeDimension(str)` (sets buffer), `commitDimension()` (applies to the active gesture). E2E: start a line segment (pending), `typeDimension('5')`, `commitDimension()` → the placed segment length ≈ 5 AND a `distance` constraint pins it. Arc: bow, type '3', commit → radius ≈ 3 pinned. Full suite + vue-tsc gate. **Commit** `feat(sketch): type a dimension while drawing (exact length/radius)`.

---

### Task 7: Sparkle-on-snap delight

A small celebratory flourish when a constraint is captured while drawing (the trailer's sparkle).

**Files:** `app/pages/dev/sketch-draw.vue`, `tests/sketch-draw.spec.ts`.

**Design:**
- A transient overlay: when a constraint is CAPTURED during drawing (tangent-joint snap, coincident/on-line/on-circle snap on placement, Shift H/V capture, an applied verb), spawn a short-lived sparkle at that world point — a few small dots/rays that expand + fade over ~350ms via `requestAnimationFrame` (page may use `performance.now`). Pure visual; no doc mutation, no solve, no history.
- A `sparkle(worldX, worldY)` function pushes a `{x,y,born}` into a `sparkles` ref; an rAF loop advances/prunes them; a `<g>` renders each with opacity/scale from its age. Call `sparkle(...)` at the capture sites (tangent-joint commit, snap-on-place, shift-capture, apply-verb).
- Respect reduced-motion? Optional; keep it subtle regardless.

- [ ] Test hook: `sparkleCount()` (active sparkle count) + `sparkleAt(x,y)`. E2E (light): draw a tangent joint → assert at least one sparkle spawned within a moment of the capture (poll `sparkleCount() > 0`), and that it prunes to 0 after the lifetime. Don't over-assert timing. Live: eyeball the sparkle on a snap (screenshot mid-animation). Full suite + vue-tsc gate. **Commit** `feat(sketch): sparkle-on-snap delight`.

---

### Task 8: Close-out

- [ ] Full sketch unit suite + all E2E green; vue-tsc gate clean for all sketch files; record totals.
- [ ] Controller live exit test: exercise each new thing (mandala drag speed, Midpoint/Equal, click-badge-remove, segment select + perpendicular, guide-mode circle + snap, type a radius, see a sparkle).
- [ ] Update `docs/STATE.md` (M5 entry) + memory (`opacity-pen-interaction-reference.md`: move the implemented items to HAVE; note the comb-obsolete decision) + `MEMORY.md` pointer. Note remaining non-core (grid, copy/paste) + the big next thing = Shape Studio mount.
- [ ] Commit docs.

---

## Self-Review

**Spec coverage:** analytic Jacobian → T1; Midpoint+Equal → T2; badge-remove + Escape-abort → T3; path-segment selection → T4; guides-first → T5; type-dimension → T6; sparkle → T7. Curvature comb intentionally dropped (bezier retired → arcs have constant curvature; obsolete). Grid/copy-paste deferred as non-core (stated to the user). Shape Studio mount explicitly excluded (the next decision).

**Placeholder scan:** T1/T2 pure pieces have full formulas; the analytic derivatives are specified per-kind with a numerical-comparison gate that catches any wrong partial (the mirroredFrom fallback-to-numerical-rows is explicitly allowed). Page tasks are behavioral specs + hooks + E2E (the proven M1–M4 style). No TBDs.

**Type consistency:** `buildJacobian`/`jacobianRows` shapes; `midpoint`/`equalRadius` refs orders; `removeConstraintById`, `pickSegment`/`selectedSegments`, `setGuideMode`, `typeDimension`/`commitDimension`, `sparkle`/`sparkleCount` hooks — consistent across tasks. New residuals get BOTH a `residuals.ts` case AND a `jacobian.ts` partial (or the constraint is invisible to the analytic solver) — every task adding a residual updates both.
