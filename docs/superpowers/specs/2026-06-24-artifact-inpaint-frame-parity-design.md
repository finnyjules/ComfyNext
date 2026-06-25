# Artifact-node Inpaint ⇄ Frame Inpaint parity

**Date:** 2026-06-24
**Scope:** Make the Image-artifact-node inpaint UI (`InpaintModal.vue`) read as the same
design as the Frame modal's "Generate in region" inpaint UI (`CompositorModal.vue`),
*without* losing the artifact node's richer feature set.

## Decision

Option 2 — **skin + match controls**. Adopt the Frame's visual language and structural
rhythm; keep artifact-only features (model tier, variations, feather/expand, History grid,
SAM click-select), re-housed in the Frame's structure. Extract the shared pastel/sweep FX
into a composable so the pastel accent has a single source of truth (recommended over
duplicating). Add a **Box** region tool (ports cleanly); **drop Shape** (needs vector
layers that don't exist in the standalone modal).

The two modals keep their different *shells* — the artifact modal stays a full-screen
stage with zoom/pan; only its control panel and on-stage generation overlay change.

## Work

1. **Globalize button style.** Move `.gen-pastel` + `@keyframes gen-pastel-flow` from
   `CompositorModal.vue`'s scoped `<style>` into `app/assets/css/main.css` (beside the
   already-global `.pastel-hairline`). Both modals reference the same class.

2. **Extract `useRegionFx` composable** (`app/composables/useRegionFx.ts`) from the
   CompositorModal region-FX block: the `PASTEL` palette + gradient CSS, the dilate→punch
   ring builder, the pulsing fill + flowing pastel stroke overlay render, and the glimm
   prism "generating" sweep (WebGL band CSS-masked to the silhouette). Interface:
   - inputs: `overlay`/`sweep` canvas refs, `getMask()` → white-on-transparent silhouette
     canvas at display px (or null), `getDims()` → `{w,h}`, `busy()` → boolean.
   - returns: `start()`, `stop()`, `rebuild()` (on mask/size change), `sweepMaskUrl` ref.
   - exports: `REGION_PASTEL`, `regionPastelGradientCss()`.
   - owns its RAF + glimm lifecycle (`onBeforeUnmount` cleanup).

3. **Migrate `CompositorModal`** to consume `useRegionFx` (faithful mechanical move,
   passing its existing `genMaskCanvas` as the silhouette). Verify gen mode still animates.

4. **Rework `InpaintModal` control panel** to the Frame rhythm: uppercase section headers
   (`text-[10px] uppercase tracking-[0.12em]`) + `p-5`/generous gaps, sections **Tool ·
   Prompt · Options**. Prompt → `.pastel-hairline` border. Primary action → `.gen-pastel`
   gradient Generate (replaces emerald). Tool row → Frame's segmented style; add **Box**
   (local rect composited into the bake; no change to `useBrushMask`). Bind `--gen-pastel`
   on the modal root from `regionPastelGradientCss()`.

5. **Wire region FX onto the InpaintModal stage:** add the overlay + sweep canvases over
   the image, build a display-px white-on-transparent silhouette from brush/SAM/box,
   rebuild on mask/size change, run `start()` while open. Generation feels identical.

## Verification

- `npm run test:unit` green (no regression in existing suites).
- Harness/preview screenshots: CompositorModal gen mode still animates; InpaintModal panel
  matches Frame aesthetic; pastel ring + prism sweep appear over the painted region;
  Generate disabled until a region exists.
