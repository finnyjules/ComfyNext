# Sketch node refinement — lock model, drop the mode, 4-up, enhance-as-main

**Date:** 2026-07-08
**Status:** Approved design (user-directed), post-sketch-node
**Builds on:** 2026-07-08-sketch-node-design.md (the Sketch node exists; this tightens it toward its purpose)

## Problem

The Sketch node shipped, but four things fight its purpose (fast, cheap, explore-then-commit):
1. Its model dropdown is still live — you can change it away from Schnell and it silently stops being a sketch.
2. The separate **Draft/Final mode toggle** is now redundant (the node *is* draft-as-a-node) and confuses the model.
3. A sketch run produces **one** output — but sketching is about seeing options at a glance.
4. The "make it real" action was Promote (re-*generate*), which returns a *different* image; users who pick a specific draft want *that* image made real.

## Design

### Change 1 — Lock the model to Flux Schnell
On a sketch node (`data.properties.sketch === true`), render the model selector as a **static, non-interactive** "Flux Schnell / BFL" label — no chevron, no click, no gallery. The model is the node's identity. Non-sketch generators are unchanged. Frontend-only, in `ComfyNode.vue`'s model-row render.

### Change 2 — Remove the Draft/Final mode toggle
Remove the user-facing mode entirely:
- The header chip in `default.vue` (the `activeTabIsProject` Draft/Final button).
- The run-path draft branch in `runVueWorkflow` (`applyDraftOverrides` + `markDraftRun`/`clearDraftRun` + the `plainWorkflow.extra.draft` stamp + the draft-aware cost-estimate branch).
- The persistence (`extra.draftMode` stamp in `snapshotActiveCanvasIntoDoc` + the restore watcher).
- Delete `useDraftMode.ts` + its unit test.

Leave dormant (referenced elsewhere, harmless, removing them is a separate cleanup): `lib/draft/overrides.ts`, `lib/draft/runMeta.ts`, and `tagTakeFromRunMeta` at the appendTake sites (with the mode gone, `draftMetaFor` always misses → tagging no-ops, which is correct). The Sketch node never used the mode path (it bakes Schnell into widgets), so nothing sketch-related regresses. The **in-place mode-draft promote** path in `ArtifactImageNode` becomes dead (no draft takes are ever created); leave it, it self-noops.

### Change 3 — 4 outputs as 4 cards on the canvas
**Backend (needs one ComfyUI restart):** teach the Flux builders to read `num_outputs` from `advanced` (default 1), so `model_options` can request a batch:
- `_b_flux_schnell` / `_b_flux_dev` (`image_models.py`): `"num_outputs": _opt_int(adv, "num_outputs", 1)` clamped to 1–4.
- Sketch preset `model_options` (`useNodeSearch.ts`): `{"megapixels":"0.25","num_outputs":4}`.

One prediction returns a batch of 4 images — cheap, fast, and **one queue wait** (deliberately avoids the parallel worker pool the parallel-dispatch epic owns, and the 4× queue variance).

**Frontend (the meaty part — gated behind a DISCOVERY step, see plan):** when a sketch node's run returns N>1 images, materialize **N Image cards in a 2×2 grid** to the right of the sketch node, reusing the same cards on re-run (stable ids: `sketch-out-<sourceNodeId>-<slot>`), each holding one image and marked `properties.sketchOutput = true` + `properties.sketchSourceId = <sourceNodeId>`. Re-running refreshes the same 4 slots rather than accumulating. This replaces the single wired sink for sketch nodes.

### Change 4 — Enhance as the main action, Promote secondary
On a sketch-output card (`properties.sketchOutput`):
- **Primary — "Enhance":** super-resolve *this exact image* into a detailed high-res version via the existing `EnhanceDetailNode` (Clarity engine, `philz1337x/clarity-upscaler`). Spawn it fed by this card's image (reuse the escalator/`spawnEnhanceDetail` pattern already on `ArtifactImageNode`, `branch: true`). Keeps the picked image; makes it real.
- **Secondary — "Promote":** re-generate at full quality from the *source sketch's* prompt/seed (look up `sketchSourceId`), model left at the finisher default. For when the *idea* was right and a fresh full render is wanted. Reuse `sketchPromoteOverridesFor` + `comfynext:spawnBeside`.

Both spawn focused, never auto-run (standing rule). Copy honest: Enhance = "make this exact image real," Promote = "re-render the idea fresh."

## Non-goals / deferred

- No change to the parallel-dispatch epic's worker pool / registry (Change 3 uses one prediction on purpose).
- No slot-reuse animation; a plain in-place refresh of the 4 cards is fine.
- Removing the dormant `lib/draft/*` machinery — a later cleanup once confirmed unused.
- Promote's finisher-model memory (last-used) — still deferred.

## Testing

- Unit: Flux builder reads/clamps `num_outputs`; sketch preset carries num_outputs:4; sketch-output card detection + Enhance/Promote override builders.
- Discovery (Change 3): confirm num_outputs:4 yields 4 `executed` image files through the bridge, and where they land, BEFORE building card materialization.
- Browser: sketch card shows locked Schnell label (no dropdown); no Draft/Final chip anywhere; a run lays 4 cards in a grid; re-run refreshes the same 4; each card's Enhance spawns a Clarity node, Promote spawns a full generator. (Paid-render steps owed to the user as before.)

## Sequencing

1. **Lock model** (frontend, safe)
2. **Remove toggle** (frontend, safe)
3. **num_outputs backend + preset** + **DISCOVERY** of how the batch lands
4. **4-card materialization** (frontend orchestration, built on the discovery)
5. **Enhance/Promote actions** on sketch-output cards
