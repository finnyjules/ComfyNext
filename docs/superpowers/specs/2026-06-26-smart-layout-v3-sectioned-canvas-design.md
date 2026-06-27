# Spec — Smart Layout v3: Sectioned, Format-Aware Canvas

**Date:** 2026-06-26
**Status:** Design approved, pending spec review
**Author:** brainstormed with Claude

---

## 1. Why

Smart Layout v2's concept — *pick an archetype → fill named slots → auto-layout on a coarse
Swiss grid → export* — is not how designers actually build these assets. Slot-filling a rigid
grid is a tool's idea of design, not a designer's. The result feels generic, the editing is
constrained to whole cells, and the range is limited.

We are reconceiving the **editing model**, not the engine. The v2 resolver, satori→PNG render
pipeline, fonts, token resolution, brand-kit merge, and — critically — the **multi-format outputs +
per-output override** machinery are all interaction-agnostic and stay. What's wrong is the editing
surface (snap-to-whole-cell, archetype-first) and two missing concepts: **sections** and a **fine
grid**.

**v3 in one line:** a format-aware, sectioned design canvas on a fine snapping grid, built on the
v2 engine.

## 2. Approach: evolve, don't rebuild

The v2 resolver (`frontend/shared/template-grid/resolve.ts`), render pipeline
(`frontend/server/api/render-template.post.ts` → satori → resvg), grid math
(`frontend/shared/template-grid/grid.ts`), and per-output override mechanism are decoupled from how
an element acquired its position. So we keep them and build a new editing model and schema superset
on top. A from-scratch rebuild would discard the satori render + multi-format machinery for no
benefit — rejected.

`TemplateV3` is a **superset of v2**. Old templates load with flat elements treated as ungrouped;
nothing breaks.

## 3. The three new concepts

### 3.1 Fine grid (replaces snap-to-whole-cell)

Today placement snaps to coarse class cells (square 6×6, portrait 4×8, etc. — see
`grid.ts` `CLASS_DEFAULTS`). v3 introduces a **dense, configurable grid** with snapping, so the user
places elements precisely but never with chaotic free placement ("constrained, not free").

- Resolution is **baseline-derived** (decided) so vertical type rhythm stays intact: the fine grid
  unit is a function of the template `typeScale` baseline rather than a fixed count, so snapping and
  type rhythm share one source of truth across formats.
- Regions remain the existing `{ col, colSpan, row, rowSpan }` shape, just expressed in fine units
  instead of coarse cells. The resolver already converts region → pixels via `gridMetrics()`; this
  is primarily a metrics change plus new snapping helpers.
- New editor helpers replace cell-rounding drag/resize: `dragRegion()` / `resizeRegion()` snap to
  fine units (with the existing whole-cell behavior generalizing to a coarser snap step).
- Visible grid overlay in the editor.

### 3.2 Sections (the new grouping abstraction)

A **Section** is a named container with its own region on the fine grid and a set of child
elements. Children's positions are stored **relative to the section**.

```ts
interface SectionV3 {
  id: string
  name: string                                   // "headline lockup", "logo + cta"
  region: Region                                 // section box on the fine grid (master format)
  regionByClass?: Partial<Record<FormatClass, Region>>
  overrides?: Record<string /* outputId */, { region?: Region; hidden?: boolean }>
  children: ElementV2[]                           // child element regions are LOCAL to the section
}

interface TemplateV3 extends Omit<TemplateV2, 'version'> {
  version: 3
  sections: SectionV3[]
  // top-level `elements` retained for ungrouped elements + v2 back-compat
}
```

- Editor flow: select elements → **"group into section"**, name it. The section renders as a box
  with a move/resize handle.
- Children scale **proportionally** within the section box (the chosen "hybrid: containers now"
  model). Internal auto-layout is explicitly the next slice (§6).

### 3.3 Section-level format adaptation (the payoff)

Instead of overriding every element per format, the user **repositions/resizes the section box per
format**, and children follow proportionally. This reuses the existing per-output override
mechanism — applied at **section** granularity rather than element granularity.

- Adapting 1:1 → 9:16 becomes "nudge a handful of section boxes," not "redo every element." This is
  the core value over a generic design tool.
- Resolution precedence mirrors v2: section `overrides[outputId].region` > `regionByClass[class]` >
  master region remapped via `remapRegion()`. Children resolve within the section's resolved box.

## 4. Resolver & render changes

- **Resolver** (`resolve.ts`): add a composition pass — resolve each section's box for the target
  format, then resolve each child's local region within that box → absolute pixels. Existing
  copy-fit / cull / token logic runs unchanged on the composed elements.
- **Render pipeline** (`translate.ts`, `render-template.post.ts`): unchanged — it consumes resolver
  output, which is still a flat list of positioned elements.
- **Brand / fonts / tokens:** unchanged.

## 5. Editor changes

- Replace cell-only snapping with fine-grid snapping (drag/resize helpers + grid overlay).
- Section authoring: group/ungroup, name, section handles (move/resize the box), child editing
  inside a section.
- **Archetypes demoted** to optional quick-starts. The primary flow is direct manipulation on the
  fine-grid canvas. `ArchetypeGallery` stays available but is no longer the required entry point.
- Outputs rail / per-output switching: unchanged in concept; overrides now primarily target
  sections.

## 6. First slice (what we build first)

Prove the core loop end-to-end, nothing more:

1. **Fine-grid placement** with snapping + visible grid overlay.
2. **Group elements into a named section**; move/resize the section box; children scale
   proportionally.
3. **Switch format/output and adapt** by nudging section boxes (section-level overrides).
4. **Render** through the existing satori pipeline.
5. **Backward-compatible v2 load** (flat elements = ungrouped).
6. **In-app screenshot sign-off** of the place → section → adapt-across-formats loop.

## 7. Deliberately later (not the first slice)

- ❌ Internal auto-layout inside sections (flow/align/wrap) — hybrid phase 2.
- ❌ Reference remix — ingest a successful ad/post, derive structure, rebuild on grid + brand.
  Eventually *replaces* archetypes as the starting point.
- ❌ Richer smart assists (hierarchy suggestions, "tidy this", distribute).
- ❌ Extreme-format (strip/skyscraper) section behavior — first slice targets
  square/portrait/landscape well; strips keep the v2 slot fallback for now.
- ❌ v2→v3 auto-clustering heuristic (group flat elements into sections automatically).

## 8. Open questions / risks

- ~~**Fine-grid resolution default:**~~ **Decided: baseline-derived** — fine-grid unit is a
  function of the `typeScale` baseline, so snapping and type rhythm share one source of truth.
- **Type scaling inside proportional sections:** font sizes scaling with the box can get awkward;
  may need clamping against the `typeScale`. Refinement, not a blocker for slice 1.
- **Archetypes:** keep-but-demote in v3 (chosen) vs. cut now. Kept as optional quick-starts; remix
  will eventually supersede them.
- **Strip/skyscraper:** sections give a cleaner per-format answer, but extreme aspect ratios may
  still need manual attention; deferred from slice 1.

## 9. Testing

- **Pure functions (unit):** fine-grid snapping math; section region composition (section box +
  child local region → pixels); per-format section override resolution; v2→v3 load compatibility.
- **Resolver:** section + children → positioned elements across multiple formats; precedence
  (override > class > remap).
- **Visual sign-off (required):** the first-slice loop verified in-app via screenshots before ship
  — per the project rule that visual output is never shipped on unit tests alone.

## 10. Relationship to other work

The **Variables & Data Merge** PRD (`2026-06-26-variables-and-data-merge-design.md`) is intentionally
parked: data-merge sits *on top of* a template you trust. v3 hardens that foundation first. When
data-merge resumes, Smart Layout (now v3) remains its first batch target; sections + named variables
compose cleanly.
