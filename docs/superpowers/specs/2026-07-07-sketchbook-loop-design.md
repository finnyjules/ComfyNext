# The Sketchbook Loop — draft mode, Light Table, promote

**Date:** 2026-07-07
**Status:** Approved design, pre-implementation
**Epic:** Explore/speed-of-thought workstream — phase 1 of (draft → light table → promote → batch auto-open → Wake)

## Problem

Creative iteration is *think → see → decide*. Today "see" costs 15–40 s and $0.03–0.08 per attempt, so users ration attempts: they deliberate instead of trying, and exploration happens in their head instead of on the canvas. Separately, when they *do* generate multiple candidates (re-rolls, Variations ×4), the results accumulate invisibly in the TakesStrip — a thumbnail filmstrip with no way to spread candidates out, compare them, or see what parameters produced what.

The loop this design closes: **sketch cheaply → spread candidates out → pick a winner → promote it to final quality.** Four candidates in ~3 seconds for ~$0.01, compared on a light table, winner re-rendered at full quality with one click.

## Goals

- A canvas-level **Draft / Final** mode: draft runs route image generation to a fast/cheap tier (Flux Schnell, low megapixels) while preserving seed/prompt/aspect.
- Draft results are visibly marked and carry enough provenance to be **promoted**: re-run the exact take snapshot on the intended (full-quality) model with the same seed.
- A **Light Table**: a keyboard-first compare view over a node's takes — grid, params chips, diff between two selected takes, set-active/pin/discard/promote.
- One reusable mechanism underneath: **dispatch-time widget overrides** (used by draft mode as a standing override, by promote as a one-shot override).

## Non-goals (explicitly deferred)

- Video/edit-node draft mappings (slice D3). In v1 those nodes run unchanged in draft mode; the UI says so.
- Batch grouping + auto-open of the Light Table after Variations (slice B).
- The Wake / project version snapshots (slice C).
- Variation axes (prompt paraphrase, model shootout) — v2 of Variations.
- Synced pan/zoom and hold-to-flicker A/B in the Light Table (polish slice A2). V1 gets a lightbox with arrow-key flip-through, which covers most of the comparison value.
- Any change to billing rates — drafts bill normally through the meter (they're just cheap).

## Design

### 1. Dispatch-time widget overrides (the shared mechanism)

A small utility in the `getWorkflow` transform pipeline (alongside `applyArtifactLocks` / `applyVariantFanOut` in `frontend/app/composables/useFilteredPrompt.ts`): given a map of `nodeId → widget overrides`, produce the outgoing prompt graph with those widget values substituted, **without mutating node state**. Two clients:

- **Draft mode** registers a *standing* override for every participating generator while the canvas is in Draft.
- **Promote** registers a *one-shot* override for a single node and run, cleared after dispatch.

This is a frontend-only change; the backend sees an ordinary prompt. No ComfyUI/python changes are required for the whole slice.

### 2. Draft mode (D1)

**Toggle.** A Draft/Final segmented control in `CanvasStatusBar.vue`. State is per-canvas, persisted in the ProjectDoc canvas (`workflow.extra.draftMode`), default **Final** (drafting is opt-in; we may revisit the default after usage data). Tooltip enumerates coverage honestly: "Draft affects image generators (~10× faster/cheaper). Edit and video nodes run at full quality."

**Mapping.** `frontend/app/lib/draft/overrides.ts` — a table from node type → draft overrides. V1 has two families:

- `GenerateImageNode`: `model → flux-schnell`, `model_options.megapixels → "0.5"` (Schnell's builder already defaults `num_inference_steps: 4`, `go_fast: true` — see `comfy_api_nodes/image_models.py:179`). Seed, prompt, aspect ratio untouched.
- **LoRA-bearing generators** (Restyle-with-LoRA / Flux-LoRA paths, `nodes_replicate.py:532–578`): do **NOT** swap the model — a model swap would silently drop the trained LoRA. Instead reduce on the node's own model via existing widgets: `num_inference_steps → 8`, `megapixels → "0.5"`. Works identically for path A (private trained-model forks) and path B (`flux-dev-lora` + `lora_weights`), since both share the same input dict. ~3–4× faster/cheaper with the LoRA fully applied. V2 knobs, deliberately deferred: the ostris forks' `model: "dev"|"schnell"` input (needs one verification run against a real trained model, and isn't a widget today) and the `flux-schnell-lora` slug swap for path B (Python change).

Nodes not in the table are unaffected. The table is the extension point for D3 (video: min resolution, shortest duration, audio off).

**Cost estimate.** `costEstimate.ts` gains a draft-aware path: when draft mode is on and a node has a draft mapping, the estimate reflects the *effective* (overridden) model. The run button's price preview therefore tells the truth in both modes.

**Provenance & badge.** At dispatch, the run pipeline records per-promptId: `{ draft: true, intendedModel: <the node's real model widget value> }`. When `appendTake` ingests the result, the take gets `draft: true` and `params.intendedModel`. UI: a small dashed-outline "sketch" badge on draft takes in the TakesStrip and Light Table (deliberately **not** pastel — pastel means AI-affordance; draft needs its own quiet token). `extra_data.draft` also rides the meter POST so spend analytics can split sketch vs. finish spend later (no UI in this slice).

### 3. Promote (D2)

On any draft take: **Promote** re-dispatches the take's `params` snapshot — not the node's current widgets — as a one-shot override with `model = params.intendedModel`, `seed` locked to the take's seed, draft mapping suppressed for that run. The resulting take records `promotedFrom: <draftTakeId>` and renders adjacent to its draft for comparison.

- Buttons: on the TakesStrip item (hover), in the Light Table cell, and the price is shown inline ("Promote · ~$0.03") via the cost-estimate lib.
- If the take predates this feature or lacks `intendedModel`, Promote falls back to the node's current model widget.
- Promote of an already-final take is not offered (no-op).

### 4. Light Table (A)

`frontend/app/components/vue-canvas/LightTableModal.vue`, opened from: an expand button on the TakesStrip, double-click on a take thumbnail, or the artifact node's context menu. Reads/writes takes through the existing `useTakes` composable — no new state store.

**Layout.** Overlay modal (reuse the gallery-modal shell pattern, e.g. VoiceGalleryModal). Responsive grid (`auto-fit, minmax(280px, 1fr)`), takes stream in reactively as runs complete. Each cell: the image (object-fit contain), chips for seed · model short-label · draft badge · pinned star, and a ring on the active take.

**Selection model.** Click focuses a cell; shift-click selects a second. With two selected, a **diff row** appears at the bottom listing only the params that differ (seed, model, prompt with changed tokens highlighted, strength…). Data comes straight from `take.params` — it exists today and is displayed nowhere.

**Keyboard.** Arrows move focus · Enter = set active · `P` pin · `X` discard (pinned takes require a second confirm) · `Cmd+Enter` promote (draft takes) · `Space` opens the focused take in a lightbox at fit-to-screen where arrow keys flip between takes at identical framing (the v1 substitute for synced zoom/flicker) · Esc closes lightbox, then modal.

**Exit gestures.**
- *Set active* — existing `setActiveTake`; the node's output/downstream sees the winner (projection already mirrors active take to legacy fields).
- *Branch winner* — spawn a standalone Image node seeded with this take's image (reuses the image-import path the search picker uses), so the user can continue the chain from the winner while keeping the generator exploring.
- *Discard others* — keeps focused + pinned, discards the rest, with an undo toast (restore = snapshot of the takes array taken before the discard).

**Legacy nodes** (takes disabled/empty): the modal opens with the single current image — degraded but functional.

## Data model changes

`Take` gains three optional fields (all backward-compatible): `draft?: boolean`, `promotedFrom?: string`, and `params.intendedModel?: string`. ProjectCanvas workflow gains `extra.draftMode?: boolean`. No migrations needed — absent fields mean "final, unlinked", which is correct for existing docs.

## Touch map

| Area | Files |
|---|---|
| Override utility | `useFilteredPrompt.ts` (new transform in getWorkflow pipeline), new `lib/draft/overrides.ts` |
| Toggle | `CanvasStatusBar.vue`, ProjectDoc persistence in `layouts/default.vue` |
| Cost preview | `lib/costEstimate.ts` |
| Provenance | `lib/artifact/takeProvenance.ts`, `useTakes.ts` (draft/promotedFrom fields, badge data) |
| Promote | `useTakes.ts` or small `usePromote.ts` (one-shot override + dispatch via existing runFiltered self-scope) |
| Light Table | new `LightTableModal.vue`, entry points in `TakesStrip.vue` + `ArtifactImageNode.vue` |

## Edge cases

- **Draft mode + node whose model has no Schnell-equivalent semantics** (e.g. user picked a stylized model for its look): the draft still runs Schnell, which changes the look. Mitigation is the honesty tooltip + the badge; the promoted result is always the user's chosen model. We accept this v1; per-node opt-out is a follow-up if it bites.
- **Character likeness in drafts**: fewer steps softens likeness first — LoRA drafts answer composition/pose/scene, not identity fidelity. The badge tooltip must say this explicitly (characters are the product's core use case); Promote is the likeness check.
- **Params drift**: user edits the prompt after generating draft takes → Promote uses the take snapshot (correct by construction). The diff row makes this visible.
- **MAX_TAKES eviction** (30/node): promoting near the cap may evict the oldest unpinned take — acceptable; pinned takes are never evicted (existing behavior).
- **Variations ×4 in draft mode**: works with zero extra code (each variation dispatch passes through the standing override) — this is the payoff interaction and must be in the verification script.
- **Paste/typing guards**: Light Table keyboard handlers must not fire while its (future) rename/label inputs are focused — same guard pattern as CompositorModal's undo/text handling.
- **Render-trigger watches**: takes updates must trigger re-render on the artifact node surface — follow the localGroups lesson (watch deps include the takes array on every surface that renders badges).

## Testing

- Unit: draft override transform (graph in → graph out; seed/prompt untouched; non-mapped nodes untouched), one-shot promote override (applies once, clears), provenance capture of `intendedModel`/`draft`, take field back-compat (old docs load), diff-row param comparison.
- Component: Light Table keyboard map (focus moves, Enter/P/X/Cmd+Enter dispatch the right calls), discard-others undo restore.
- Browser (per house rule — visuals verified by screenshot before ship): draft toggle → run → badge appears; Variations ×4 in draft → four takes stream into the Light Table; promote → final lands beside draft; cost preview shows draft vs final price.

## Sequencing

1. **D1** — override utility + draft mapping + toggle + badge + cost preview (~3–4 days)
2. **A** — Light Table v1 (~1 week)
3. **D2** — Promote, living primarily in the Light Table (~2–3 days)

Then (separate specs): B (batch auto-open), C (Wake + durable autosave), D3 (video drafts), A2 (synced zoom/flicker), variation axes.
