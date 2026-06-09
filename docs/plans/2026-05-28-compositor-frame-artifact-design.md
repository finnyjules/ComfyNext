# Compositor as a Frame artifact — design

Promote the Compositor from *a processing node you wire into* to a **Frame** —
a first-class **artboard** that lives directly on the canvas. A frame has an
explicit size, you compose *into* it (drop images, type text, draw shapes, wire
in generated outputs), and its flattened result is itself a wireable, exportable
artifact. This is the bridge for people coming from Photoshop / Illustrator /
Figma: the node canvas is already an infinite spatial surface — the frame is the
missing **artboard** primitive.

## Why this is low-risk

A Frame is the fusion of three patterns ComfyNext already ships:

| Pattern | Source | What it gives the Frame |
|---|---|---|
| Artifact skeleton | `ArtifactImageNode.vue` | IMAGE output, per-node Run, export badge, lock/pin, drop-to-add ([:151](../../frontend/app/components/vue-canvas/ArtifactImageNode.vue#L151), [:204](../../frontend/app/components/vue-canvas/ArtifactImageNode.vue#L204)) |
| In-node editing on the live canvas | `ArtifactTextNode.vue` | `nopan nodrag` interactive elements + state in `data.properties` ([:253](../../frontend/app/components/vue-canvas/ArtifactTextNode.vue#L253)) |
| Layer / transform / bake engine | `useCompositorLayers.ts` + Compositor overlay | text, shapes, alpha compositing (already built) |

So "editing on a pannable/zoomable canvas" is **already solved here** — Frame
just stacks these together.

## Editing model — inline *and* modal (both, on purpose)

- **Inline (on the artboard):** quick, direct manipulation — drop an image,
  drag/scale/rotate a layer, double-click text to type. The 80% case.
- **Modal (focused mode):** precise / fiddly work — blend-mode changes, exact
  numeric transforms, dense layer lists, anything that benefits from a dedicated
  workspace. The modal built in the previous pass becomes "Open editor" / expand.

They complement each other; the modal is not deprecated.

## A reusable paradigm (Timeline, Audio, … later)

Build the Frame so its structure is a **template** other artifacts adopt:
`node-as-artboard` + `owned layers in data.properties` + `live preview as the
node body` + `dual inline/modal editing` + `bake/compose on Run → first-class
output`. Timeline already has a fullscreen editor; Audio could become a waveform
artboard. Not in scope now — but factor the Frame so the pattern extracts cleanly.

## Node shape

The Frame **reuses the `Compositor` backend** — no new backend node. It becomes
an artifact by routing the `Compositor` type to a new Vue component:

- `ARTIFACT_NODE_COMPONENTS`: add `Compositor: 'artifact-frame'`
  ([useVueNodes.ts:141](../../frontend/app/composables/useVueNodes.ts#L141))
- canvas `node-types` map: add `'artifact-frame': markRaw(ArtifactFrameNode)`
  ([VueNodeCanvas.vue:2672](../../frontend/app/components/vue-canvas/VueNodeCanvas.vue#L2672))

State on `data.properties` (round-trips like `textEntries` / `comfynext_localLayers`):

| Key | Type | Notes |
|---|---|---|
| `comfynext_frame` | `{ width, height, preset }` | artboard dimensions + chosen preset |
| `comfynext_localLayers` | `LocalLayer[]` | text/shape layers (already implemented) |
| `comfynext_imageLayers` | `{ id, filename, x,y,rotation,scale,opacity,blend }[]` | **owned** dropped images (new) |
| `locked` | bool | pin, mirrors `ArtifactImageNode` |

Output: IMAGE (wireable), plus Export + Download + Lock, identical to the Image
artifact. Editing opens the existing modal (`comfynext:openCompositor`).

## Backend change (small)

Add optional `width` / `height` INT inputs to `Compositor`. When both > 0 the
canvas is exactly that size (all layers fit into it); when unset, current
behavior (canvas = layer 1's size) — backward compatible. This gives the frame a
true artboard size independent of any base image, and removes the "need a base
to know the size" constraint.

## Layers in: drop AND wire

- **Drop / paste** an image onto the frame → an *owned* image layer
  (`comfynext_imageLayers`). At Run, each owned image is uploaded and injected as
  a `LoadImage → Compositor.layerN` (extending the overlay-injection already in
  `injectCompositorOverlays`), so it composites at full quality with the backend's
  transforms — not re-rastered.
- **Wired** IMAGE inputs remain layers exactly as today.
- Text/shapes bake into the alpha overlay (already implemented).

## Phasing

**Phase 1 — the artboard artifact.** Frame renders its live composite as the
node body at the artboard aspect; dimensions via presets (1:1, 16:9, 9:16, 4:5,
A4, custom) + backend `width`/`height`; owns dropped-image layers; IMAGE output +
export/lock; resizable on-canvas (manual, zoom-aware handle like
`StickyAnnotation`); editing via the modal. Delivers "named artboards on your
canvas showing live composites that feed generations."

**Phase 2 — inline manipulation.** Select / drag / scale / rotate layers and
double-click-to-edit text *directly on the artboard* (`nopan nodrag`). Modal stays
for focused/precise work (blend, exact numbers).

## Edge cases & scope cuts

- **In scope (P1):** explicit dimensions + presets, dropped + wired image layers,
  text/shape overlay, IMAGE output, export/lock, modal editing.
- **Out of scope (P1):** inline layer manipulation (P2); generate-*into*-frame /
  inpaint within bounds (future); multi-select across layers; the Timeline/Audio
  generalization (future).
- Frame with no layers → transparent/checkerboard artboard at its set size.
- Very large artboards (e.g. 4096²) — bake/preview at a capped preview res, full
  res only on Run.

## Files

**New**
- `frontend/app/components/vue-canvas/ArtifactFrameNode.vue`
- `docs/plans/2026-05-28-compositor-frame-artifact-design.md` (this)

**Modified**
- `frontend/app/composables/useVueNodes.ts` — register `Compositor → artifact-frame`
- `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — `node-types` entry;
  extend `injectCompositorOverlays` for owned image layers; size handling in
  `renderComposite` / `collectCompositorLayers`
- `frontend/app/data/toolbox-items.ts` — "Frame" entry; refresh Compositor copy
- `frontend/app/composables/useCompositorLayers.ts` — owned image-layer helpers
- `comfy_extras/nodes_compositor.py` — optional `width` / `height`
- `frontend/app/components/vue-canvas/CompositorModal.vue` — dimensions awareness;
  positioned as the focused/precise editor

## Layer ingestion — flat image → editable layers (2026-06-09)

The Figma-parity payoff for imports: deconstruct a flat image into Frame layers.
Three generator nodes (`comfy_api_nodes/nodes_replicate.py`) + an **"Edit as
Frame"** button on each that builds a wired Frame:

- **`LayerizeGraphicNode`** (Ideogram Layerize, ~$0.08) — text-free background
  + structured text JSON. The node is an output node carrying its own result
  (`ui.text` → `data.text`), so no downstream wiring is needed.
  `parseIdeogramLayers` (useCompositorLayers) converts Ideogram's px-space
  containers (in its *re-rendered* `resolution`, not the input size) into
  normalized `TextLayer`s; Edit-as-Frame wires background → layer1, sets the
  artboard to that resolution, and stacks the text layers on top. Container
  extraction varies by seed — zero-container results still produce a valid
  background-only frame. Its `layers_json` STRING output is excluded from
  auto-sink materialization (machine data, not user content).
- **`SplitPhotoLayersNode`** (bg-remover + LaMa/Bria eraser) — RGBA subject +
  clean background plate → wired as layer2-over-layer1.
- **`OutpaintImageNode`** (Flux Fill / Bria Expand) — with a live zone-preview
  on the node. Not frame-specific. *Not yet run live.*

**Stack-key alignment (latent bug fixed):** persisted `comfynext_stackOrder`
wired keys are **1-based** (`w:1` = the backend's layer1) everywhere. Before,
ArtifactFrameNode and the submit/bake interleaver used 0-based keys while
CompositorModal used 1-based — so wired-layer z-orders saved in one surface
were silently dropped by the others (filtered as "not present"). All three now
agree; pre-fix frame-saved orders fall back to the default stacking.

## Layer parity batch (2026-06-09, second pass)

- **Per-layer visibility + lock.** Locals carry `visible`/`locked` on the layer;
  wired layers persist 1-based slot arrays (`comfynext_hiddenWired` /
  `comfynext_lockedWired`) on node properties. Hidden layers drop out of
  render, bake, export; at submit a hidden wired slot gets opacity 0 stamped on
  the outgoing copy only. Locked layers ignore canvas hits everywhere (the
  shared `useLocalLayerEditor.hitTest` + both wired hit-tests) but stay
  selectable from the layers panel — Figma behavior. Eye/lock buttons on every
  modal stack row.
- **Blend modes for local layers** (`blend` on LayerCommon, same names as the
  backend's `layer{N}_blend`). Live preview via `globalCompositeOperation`; at
  submit a non-normal local bakes as its own single-layer run so the backend
  applies the mode against the real backdrop.
- **Text: full weight range + wrapping.** `fontWeight` is any 100–900 (select
  in modal + inline toolbar); the Google-font loader optimistically requests
  the `wght@100..900` variable range (static families fail that stylesheet
  silently and snap to the nearest loaded weight). Optional `boxW` turns a
  text layer into a wrapping text box (greedy word-wrap in `wrappedTextLines`,
  alignment anchored to the box).
- **Inner shadow + background blur effects.** Inner shadow composites the
  inverted-silhouette shadow back into the layer offscreen (mind the gotcha:
  the offscreen ctx still carries the layer transform — stamp in identity
  space). Background blur blurs the already-painted backdrop within the
  layer's silhouette inside `paintLayerStack` (device-space, dpr-aware). Bake
  caveat: a baked locals-run can only background-blur the locals below it —
  wired pixels behind it composite server-side and can't be pre-blurred.

## Implementation notes

- No `@vue-flow/node-resizer` dependency — resize manually, zoom-aware, mirroring
  `StickyAnnotation` ([:54](../../frontend/app/components/vue-canvas/StickyAnnotation.vue#L54)).
- Keep the raw `Compositor` node reachable for graph power-users (the artifact
  routing is presentational; the backend is unchanged besides `width`/`height`).
- Reuse `renderComposite` for the node-body artboard preview; it already draws
  image layers + the local overlay.
