# Compositor smart select — scribble → SAM-refined selection + action bar

**Date:** 2026-07-22
**Status:** Approved design
**Builds on:** the Compositor's Generate-mode region painting (artboard-space mask canvas, brush stroke capture, `useRegionFx` overlay in `frontend/app/components/vue-canvas/CompositorModal.vue`), the click-to-select SAM flow in the Inpaint modal (`frontend/app/composables/useInpaint.ts` → `frontend/server/api/inpaint/segment.post.ts`, SAM-2 on Replicate), and the existing layer-mask mechanism (`maskedByKey` / `maskStrokes`).

## Problem

Selecting an object inside a frame today means either hand-painting its silhouette with the brush (slow, imprecise edges) or a single-click SAM select that only exists in the Inpaint modal. There is no way in the Compositor to roughly mark an object and have the app resolve a precise selection — and no unified place to then act on that selection (extract it, mask with it, regenerate it, or erase it).

## Approach

Extend the existing SAM-2 Replicate endpoint with scribble-derived prompts (approach A of A/B/C considered):

- A scribble is a generous set of foreground point prompts. Sample ~5–10 well-spread points along the stroke in the **selected layer's image space** and send them to SAM-2, which already accepts point arrays. Server change is small: `segment.post.ts` accepts `points: [{x, y, label}]` alongside the existing single `xPx`/`yPx` (kept for the Inpaint modal's back-compat).
- fal SAM-2 (approach B) was rejected: equivalent capability, but it would open a second segmentation path when a working Replicate one exists.
- In-browser segmentation via onnxruntime-web (approach C) was rejected for v1: a much larger integration (WASM/WebGPU runtime, ~40 MB model hosting, memory pressure) for below-SAM-2 quality.

Graceful degradation is a hard requirement: if the API errors or times out, the raw scribble **is** the selection and every downstream action still works with it (same philosophy as `useInpaint.segment`'s fallback-to-brushing).

## UX flow

1. **Enter Smart select.** A new tool/mode in the Compositor toolbar (sibling of Generate mode, mutually exclusive with it). Requires an image layer to be selected first; if none is selected, activating the tool prompts for one (toast) rather than guessing.
2. **Scribble.** Brush cursor (reuses the Generate-mode brush stroke capture and artboard-space mask canvas plumbing). Strokes render with the existing animated `useRegionFx` overlay while pending.
3. **Refine on mouse-up.** The selected layer's source pixels are captured at natural resolution; scribble points are mapped through the layer's inverse draw transform into image space; `/api/inpaint/segment` returns the object mask; the overlay snaps from the rough scribble to the refined silhouette.
4. **Add / subtract.** Further scribbles append foreground points and re-segment. Alt-scribble appends label-0 (background) points. All accumulated points are re-sent each round — SAM-2 point prompts are cheap, and cumulative prompting is how the model is designed to converge.
5. **Action bar.** A small floating bar appears near the selection with five actions (below). Escape or leaving the mode clears the selection and points.

Busy state: a local `samBusy`-style guard (per the Inpaint modal pattern) blocks re-entrant segment calls; new scribbles during a pending call queue a single re-run.

## Selection target

Segmentation always runs on the **selected image layer's own pixels**, not the composed artboard. This keeps cut-out/erase sources unambiguous when layers overlap. The refined mask is stored in the layer's image space (a canvas at the source's natural resolution) plus its artboard-space projection for overlay drawing.

## Actions

| Action | Effect |
| --- | --- |
| **New layer** | Copy masked pixels into a new image layer positioned exactly over the original (same draw transform). Non-destructive. New layer becomes selected. |
| **Cut out** | Same extraction, but the source layer's image gets the inverse mask baked in (pixels removed), so the object lifts off. One-step undoable. |
| **Generate fill** | Hand the refined mask (artboard-space projection) to the existing generative-fill pipeline as its region mask, then switch into Generate mode's prompt flow. |
| **Use as mask** | Persist the silhouette so other layers can clip by it via the existing `maskedByKey` mechanism, mirroring the brush-mask flow (mask source hidden by default, `maskShowSource=false`). |
| **Delete** | Bake the inverse mask into the layer (transparent hole). No content-aware fill in v1 — that is what Generate fill is for. |

Extraction ("New layer"/"Cut out") writes the masked pixels to a data URL/blob and registers it through the same asset path other local layers use, so persistence and previews behave like any other image layer.

## Server change

`frontend/server/api/inpaint/segment.post.ts`:

- Body gains optional `points?: { x: number; y: number; label: 0 | 1 }[]`. When present it wins over `xPx`/`yPx`; when absent, behavior is byte-identical to today.
- `buildInput` maps to SAM-2's `point_coords` / `point_labels` arrays (the isolation comment in that file already anticipates model-input remapping staying in one spot).
- Response unchanged: `{ mask: dataUrl }`, WHITE = selected.

## Client modules

- `frontend/app/composables/useSmartSelect.ts` — new composable owning: accumulated point prompts, scribble mask canvas, segment call + busy/queue guard, refined mask state, add/subtract logic, and the fallback-to-scribble rule. Pure logic separated from the modal so it is unit-testable.
- `CompositorModal.vue` — tool activation, pointer handling (delegating stroke capture to the existing brush plumbing), overlay rendering via `useRegionFx`, the action bar, and the five action implementations (which mostly delegate to existing mechanisms: layer creation, `maskedByKey`, generative-fill handoff).
- Point sampling utility (stroke polyline → N spread points, e.g. evenly by arc length with a minimum-distance filter) lives in `frontend/app/lib/compositor/` next to `brushStamp.ts`.

## Error handling

- Segment API failure/timeout → toast ("Smart refine unavailable — using your scribble"), raw scribble becomes the active selection, action bar still shows.
- No image layer selected → tool activation blocked with a toast.
- Empty scribble (accidental click) → ignored, no API call.
- Undo: each action lands as a single history entry via the existing layer-state `setLocal` history behavior.

## Testing

- Unit: point sampling from strokes (spread, min-distance, arc-length coverage); mask compositing (add/subtract accumulation, inverse-bake); image-space ↔ artboard-space mapping through a layer transform.
- Server: `segment.post.ts` body handling — multi-point mapping, single-point back-compat, undefined-key stripping.
- E2E hand-check in the running app: scribble → refined overlay; each of the five actions; Alt-subtract; API-failure fallback (kill key) keeps the scribble usable.
