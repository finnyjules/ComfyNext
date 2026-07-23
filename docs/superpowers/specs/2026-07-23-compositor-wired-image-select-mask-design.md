# Compositor wired-image support for Smart Select + freehand Mask

**Date:** 2026-07-23
**Status:** Approved design
**Builds on:** the smart-select feature (`docs/superpowers/specs/2026-07-22-compositor-smart-select-design.md`, shipped), the brush freehand-mask feature (`maskStrokes` + `applyStrokeMask` in `frontend/app/composables/useCompositorLayers.ts`), and the wired-treatments system (`frontend/app/composables/useWiredTreatments.ts`, `sailor_wiredTreatments` on the node).

## Problem

Smart Select (the lasso) and the brush's freehand **Mask** mode only operate on **local** image layers — images added directly inside the Compositor (drag-drop, Add-image, brand picker). They do nothing for **wired** images — images connected through the Compositor node's image ports, which is the primary compositor workflow ("Connect images to the Compositor's layer ports").

Concretely:
- The lasso button is gated `:disabled="!smartActive && selectedLocal?.kind !== 'image'"` (`CompositorModal.vue`). Selecting a wired image sets `selectedSlot` and forces `selectedLocal` to null (`watch(selectedSlot …) → selectLocal(null)`), so the lasso stays disabled.
- The brush mask branch (`onBrushPointerUp`) writes `setLocal(sel.id, { maskStrokes })` onto `selectedLocal`; for a wired image `selectedLocal` is null → silent no-op. The wired-layer model (`WiredTreatment`) has no `maskStrokes` field and the wired render path never applies stroke masks, so freehand-masking a wired image is unsupported end-to-end.

## Approach

Introduce one shared primitive — **a single raster visibility mask stored as a wired treatment** — and build both features on it. This is non-destructive (the upstream source is immutable; the Compositor only changes what it *shows*), which is also the chosen semantics for the destructive smart-select actions.

Rejected alternative (bake-to-local on every edit): freezes the wired image into a local layer and detaches it from the live wire on the first edit. Kept only where genuinely required (not in this scope — see Generate fill).

## New primitive: wired visibility mask (single raster)

A brush produces polyline strokes; Smart Select produces a raster silhouette. Rather than store two representations, wired masking uses **one raster visibility mask per slot**, in the wired image's own (capped) pixel space, that both features stamp into. `WiredTreatment` gains one optional field:

```ts
export interface WiredTreatment {
  maskedByKey?: string
  showSource?: boolean
  maskUrl?: string   // data URL, WHITE = HIDDEN, transparent = shown; in the
                     // wired image's capped pixel space (sticks under transform)
}
```

- **Write:** `setWiredMaskUrl(node, slot, url)` in `useWiredTreatments.ts` — persists to `sailor_wiredTreatments['w:<slot>']`, drops the field/entry when the url is empty (same drop-when-empty pattern as `setWiredMask`). Back-compatible with existing `maskedByKey`/`showSource` entries.
- **Render:** in the wired draw path, after the image is drawn (per clone), apply the mask **through the same wired transform** as `destination-out` so hidden regions are cut from the image's pixels and the mask moves/scales/rotates with the image. Because the mask is in the image's pixel space, it maps onto `fitW×fitH` exactly like the image itself.
- **Coordinate space:** image pixel space (capped). Brush strokes (painted in artboard space) are mapped into image space via the inverse wired affine before stamping; Smart Select silhouettes are already in image space.

Why raster over reusing local `maskStrokes`/`applyStrokeMask`: it unifies polyline strokes and raster selections into one field and one render op, and directly represents a smart-select silhouette. Trade-off accepted: a mask PNG per masked slot on the node (compact — capped resolution, only present when masked) and no vector crispness (fine at capped res).

## Brush Mask mode → wired images

- The mask-target check (`onBrushPointerUp` mask branch, and the "Select a layer to mask" hint) accepts a selected **wired image slot** in addition to a local non-brush layer.
- A live per-slot mask canvas (image pixel space, seeded from the slot's existing `maskUrl`) accumulates strokes: each stroke is mapped artboard→image via the inverse wired affine, then stamped — a plain stroke paints WHITE (hide), an eraser stroke paints transparent (restore). On stroke end, persist the canvas to `maskUrl` via `setWiredMaskUrl` (records history like local `setLocal`).
- Selection resolution uses the existing `resolveStackKey`/`selectedSlot` plumbing so paint mode is untouched.

## Smart Select → wired images

### Enable
The lasso is enabled when a wired image slot **or** a local image layer is selected. Its target becomes a unified `{ type: 'local', layer } | { type: 'wired', slot }`.

### Capture + affine
- **Pixels:** the selected slot's element from `wiredImageEls[slot]` (`HTMLImageElement | HTMLCanvasElement`), drawn to a capped (`capDims`, ≤1536) offscreen — the SAM input, same as the local path.
- **CORS:** wired images can be cross-origin (external URLs). If the capture canvas is tainted / `getImageData` throws, Smart Select fails gracefully: a toast ("Can't read this image's pixels — try adding it directly"), no crash, lasso still toggles off cleanly. Prefer the same-origin `/view` URL when the slot exposes one.
- **Affine:** a new pure `wiredImageAffine(layer, W, H, capW, capH)` in `smartSelect.ts`, derived from `drawWiredImageLayer`'s transform: fit-contain (`iAspect>cAspect ? fitW=W,fitH=W/iAspect : fitH=H,fitW=H*iAspect`) → `translate(W/2 + x·W, H/2 + y·H)` → `rotate(rotation)` → `scale(scale)`, with the native→capped image mapping into the `fitW×fitH` box. Returns the same `Affine` shape as `layerAffine`, so `applyAffine`/`invertAffine` and the existing capture/projection code are reused unchanged.

### Actions
| Action | Wired behavior |
| --- | --- |
| **New layer** | Extract masked pixels → new **local** image layer over the wired image (unchanged output path). |
| **Use as mask** | Silhouette → new local stencil layer + wire it via `maskedByKey` (unchanged). |
| **Delete** | OR the selection silhouette (image space) into the slot's `maskUrl` (hide that region) via `setWiredMaskUrl`. Non-destructive; the exact same field the brush writes. |
| **Cut out** | New layer (extract) **and** OR the silhouette into the slot's `maskUrl` to hide it on the wired source. |
| **Generate fill** | **Disabled/hidden for wired images** in this scope (Generate mode is local-only). Deferred to a focused follow-up. |

Because the mask is a single raster in image space, Delete/Cut-out just composite the (already image-space) selection silhouette into the slot's existing `maskUrl` — no polyline conversion, no second representation.

## Error handling

- Cross-origin / unreadable wired image → toast + clean abort (no partial state).
- No wired element ready yet (`wiredImageEls[slot]` undefined) → lasso capture waits/aborts with a toast, never throws.
- Generate fill on a wired selection → the action is not offered (button hidden/disabled for wired targets), so there's no dead path.
- History: wired mask writes go through the node-properties update that records history, so undo restores the prior `maskUrl`.

## Testing

- **Unit:** `wiredImageAffine` — center maps to image center; round-trips through `invertAffine`; fit-contain correctness for both aspect branches; matches `drawWiredImageLayer`'s transform for a known case. `setWiredMaskUrl` — set/clear/empty-drop, back-compat with existing `maskedByKey`/`showSource` entries.
- **Render:** the wired `maskUrl` hides the painted region and moves with the image transform (a hidden region stays over the same image feature after the slot is scaled/moved).
- **E2E (running app, wired image):** wire an image into the Compositor → select the slot → lasso is **enabled**; scribble → refined selection; New layer / Cut out / Use as mask / Delete each behave per the table; brush Mask mode hides a painted region and the eraser restores it; cross-origin image degrades gracefully.

## Out of scope (follow-ups)

- Generate fill on wired images (needs Generate mode to accept wired targets).
- Baking a wired image to a local layer as an explicit user action (a different feature).
