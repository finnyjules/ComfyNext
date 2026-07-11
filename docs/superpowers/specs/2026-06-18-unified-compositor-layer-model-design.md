# Unified Compositor Layer Model — Design

**Date:** 2026-06-18
**Status:** Approved (brainstorming) → ready for implementation plan

## Problem

The Compositor (a.k.a. Frame) presents users with one list of "layers," but two
incompatible kinds live underneath:

- **Wired layers** — images flowing in from the node graph. A *computed view* of
  the graph: each is an image-input edge connected to a Compositor slot, with its
  transform stored in fixed per-slot widgets (`layer{i}_x`, `layer{i}_rotation`,
  `layer{i}_scale`, `layer{i}_opacity`, `layer{i}_blend`) on the node's
  `widgetsValues`. Composited **server-side** by the Python node
  (`comfy_extras/nodes_compositor.py`). Inspector shows only transform + opacity +
  blend.
- **Local layers** — text / shapes / paths / images authored *inside* the
  Compositor. Stored in `node.data.properties.sailor_localLayers`, composited
  **client-side** on Canvas-2D (`paintLayerStack` in
  `frontend/app/composables/useCompositorLayers.ts`). Full feature set: effects,
  crop, Figma-style silhouette masking (`maskedById`), AI actions.

The split leaks into UX as wildly different capabilities. The trigger: a user with
two wired image layers could not find the **Mask** control (it renders only in the
local-layer inspector branch, `CompositorModal.vue:2343`), because wired layers can
be neither a mask **target** nor a mask **source** — `maskCandidates` and the
`maskedById` lookup are local-only, and locals are keyed by `id` while wired layers
are keyed by `slot`.

## Goal

A user perceives **one kind of layer**. Every layer — regardless of where its pixels
come from — exposes the same inspector and the same capabilities (transform, blend,
mask, crop, effects). Silhouette masking works for any layer masking any other.
Behavior is robust: what the editor shows is what the output is.

## Non-Goals

- **Collapsing the two storage backends into one list.** Locals stay in
  `sailor_localLayers`; wired transforms stay in `widgetsValues`. Unification is
  at the *model + inspector + mask system* layer, transparent to users. Merging
  storage is a possible future step, not required for parity, and high-risk for
  little gain (YAGNI).
- **Reimplementing Canvas-2D effects (shadow/blur) in PyTorch.** Rejected (see
  Approach B).
- **Headless graph execution support.** Confirmed unnecessary: the Compositor is
  already browser-driven — local content and motion are baked into the workflow at
  submit time by `injectCompositorOverlays()` (`VueNodeCanvas.vue:2447`) before the
  prompt is queued. No path runs a Compositor-bearing workflow without a browser
  having prepared it.

## Decision: Approach A — Frontend is the single source of truth

One `EditorLayer` model with a `source` discriminator. The frontend Canvas-2D
renderer (`paintLayerStack`) is the authority for both preview and the baked output.
Wired-layer masking is honored server-side by **compiling the silhouette down to the
slot's existing per-pixel `layer{i}_mask` input**, which the Python node already
supports — so no PyTorch masking code, and masked wired layers stay live.

### Rejected alternatives

- **B — True dual-engine parity.** Port `maskedById` + all effects into the Python
  node so both engines match byte-for-byte. Massive, permanent two-renderer
  maintenance burden — the exact divergence that created the problem.
- **C — Cosmetic only.** Just widen `maskCandidates` + the lookup so the dropdown
  appears in-editor, no model change, no submit-path change. Fast but silently
  breaks on server-side re-runs and doesn't deliver "no distinction."

## Architecture

### 1. Unified layer identity (`EditorLayer`)

A thin normalized view-model that both sources project into. **Storage is
unchanged**; this is a read/write façade for the inspector and mask system.

```ts
interface EditorLayer {
  key: StackKey                  // 'w:<slot>' | 'l:<id>' — the id the z-order already uses
  source: 'graph-slot' | 'local'
  label: string                  // "Layer 2" | "image 9f3a"
  // transform / opacity / blend read & written via a source-specific adapter:
  //   local  → setLocal(id, {...})
  //   wired  → setLayerProp(slot, prop, value)
  // mask / crop / effects — see sections 2, 4
}
```

- `key` is the **existing** `StackKey` already used by `sailor_stackOrder`,
  `wiredKey()`, `localKey()`. We are not inventing an id space — we promote the
  z-order's key into the layer model and mask system.
- The inspector binds to `EditorLayer`, so **one property panel renders for both
  kinds**. This alone removes the most visible difference.

### 2. Masking across sources (renderer)

Today `paintLayerStack` draws wired items blind (`item.draw(...)`) and resolves
`maskedById` only against `localLayers` (`useCompositorLayers.ts:862`).

- Introduce `maskedByKey: StackKey` (replaces local-only `maskedById`). One
  `resolveSilhouette(key)` helper renders **any** layer's alpha to an offscreen, so
  the mask **source** may be wired or local.
- Generalize the render loop: for **any** item carrying `maskedByKey` (wired or
  local), run the existing content→offscreen → silhouette `destination-in` → stamp
  path. Wired layers stop being a special blind-draw case.
- `maskCandidates` returns every *other* layer regardless of source. A layer used as
  a mask source does not paint on its own — extend the existing `maskIds` skip to
  operate on keys.

Result: silhouette masking works in editor preview for all combinations
(wired↔wired, wired↔local, local↔local).

### 3. Submit-time compile — headless/server correctness

So a server-side re-run matches the editor, at submit `injectCompositorOverlays`
does, **per wired layer that carries a mask**:

- Render the mask source's silhouette via the **same** `resolveSilhouette` used for
  preview (single source of truth), to a mask PNG at canvas resolution, upload it,
  and wire it into that slot's existing **`layer{i}_mask`** input. The Python node
  already folds it per-pixel (1−alpha convention). No PyTorch change. The layer
  stays **live**: an upstream re-render still re-composites correctly because the
  mask is independent of the image content.

### 4. Effects parity and the "no difference" tax

The inspector shows the **same** controls for every layer — mask, crop, drop shadow,
inner shadow, blur — or the difference returns. They split by how they are honored:

- **Mask & crop** → coverage / alpha ops → compiled to `layer{i}_mask` (live,
  Section 3). Asset change is a non-event.
- **Drop / inner shadow, blur** → no Python equivalent → the wired layer with
  effects is **baked through `paintLayerStack` into its slot image at submit**.

Trade-off (accepted): a shadow/blur on a wired layer is no longer fully live — its
output is a frozen render of the current upstream image and needs a re-bake when the
source changes. This is **not** silent breakage:

- **Editor preview** always re-renders live on the fresh asset (Canvas-2D).
- **Run/export** re-bakes at submit, so output reflects the current asset.
- The only stale window — a prior bake consumed without a fresh submit after the
  asset changed — is flagged by the fresh/stale indicator (Section 6) and cleared by
  one Render.

To keep stale detection honest, `motionSourceKey` is extended to include wired-layer
**treatments** (mask key, crop, effect params) and wired-source identity; today it
hashes only locals + motion + size (`bake.ts:16`).

Mask/crop are the common case (the originating silhouette request); the liveness tax
touches only shadow/blur on wired layers.

### 5. Persistence & migration

- **Local layers:** add `maskedByKey`. Keep reading legacy `maskedById` as
  `l:<id>` (interpreted on load — no data migration).
- **Wired treatments:** new node property `sailor_wiredTreatments: { [slot]:
  { maskedByKey?, crop?, effects? } }`, mirroring how `sailor_stackOrder` already
  lives in `node.data.properties`. Absent = none. (New — no migration.)
- `sailor_stackOrder` unchanged.

### 6. Render button (this frame)

A primary **Render** control in the Compositor with a **fresh/stale** indicator,
generalized to **static** frames (today the stale concept exists only for motion via
the MotionTransport bake button, `CompositorModal.vue:1617`).

- **Static frame** → composites the full unified stack client-side via
  `paintLayerStack` to the node's output image, instantly (no graph round-trip).
- **Motion frame** → existing bake path.
- Scope: **this frame only.** Downstream nodes pick up the refreshed output on the
  next graph run. (Render-and-run-downstream was considered and rejected to avoid
  blurring the line with the global Run button.)
- This is the affordance that makes "the frame is a node that produces an image"
  legible, and the same control that clears the effect-bake staleness from Section 4.
- Verb is **Render**, not "Reroll": frame compositing is deterministic (same layers
  → same image). "Reroll" applies only to the AI Generate-in-region sub-action, not
  the frame.

## Phasing

Shippable in slices; both land for "zero difference":

- **Phase 1** — Unified `EditorLayer` + single inspector; mask + crop across all
  layers (live via `layer{i}_mask`); Render button + fresh/stale for static frames.
  Independently useful; solves the originating silhouette-masking request.
- **Phase 2** — Effects (shadow/blur) on wired layers via the submit-time per-slot
  bake; `motionSourceKey` extended to wired treatments.

## Testing

- **Unit:** `maskedByKey` resolves across sources; extend
  `tests/unit/layer-mask-composite.unit.spec.ts` invariants to wired sources/targets;
  submit-compile emits the correct `layer{i}_mask`; preview and submit silhouettes
  are byte-identical (shared `resolveSilhouette`).
- **Migration:** a legacy frame with bare `maskedById` still renders.
- **Visual (required):** per the standing rule — never ship a visual/WebGL effect on
  unit tests alone — verify silhouette masking via a standalone HTML + screenshot
  loop and get look sign-off before merge.

## Key constraints (carried from data-flow investigation)

1. Two composite engines exist; they agree on size, blend enum, affine transform
   math, and z-order. They diverge on effects, `maskedById`, and motion (frontend
   only).
2. The unified z-order already exists as `sailor_stackOrder` (StackKey strings).
3. Motion frames already bake wired + local together; the Python node just loads
   them. No change there.
4. The Python node already supports per-slot per-pixel `layer{i}_mask` — the rail
   Section 3 exploits.
