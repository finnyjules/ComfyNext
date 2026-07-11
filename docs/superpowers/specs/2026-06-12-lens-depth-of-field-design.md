# Virtual Lens / Depth of Field node — design

**Date:** 2026-06-12
**Status:** Approved, pre-implementation

## Goal

A local node that changes the **aperture / focus / lens** of an image: estimate
a depth map once, then render a depth-based shallow-focus look the user tweaks
live — tap a subject to focus, set aperture, choose a lens character (bokeh
shape, highlight bokeh, chromatic aberration, vignette, presets), and a
believable focal-length *compression look*. First of two nodes; the second (true
3D Reframe / Dolly with disocclusion inpainting) is a separate, later spec that
reuses the depth foundation built here.

## Decisions (from brainstorming)

- **Local, not cloud.** Depth is estimated on-device (Depth Anything V2 Small via
  `transformers`), downloaded once through the existing model-bundle system.
  Free per use, fast iteration, offline. Chosen over a cloud depth model so
  knob-by-knob tweaking is instant and free.
- **Full lens simulation (option C).** Depth-based DoF core PLUS lens character:
  bokeh shape, highlight bokeh, chromatic aberration, vignette, lens presets, and
  a focal-length *compression look*.
- **Focal-length = a compression LOOK here, not true reprojection.** A
  depth-scaled background scale/parallax within a safe range — no disocclusion
  holes. True perspective reprojection (real parallax, big focal swings, holes
  filled by the repo's local LaMa inpainter) is **Node 2 (3D Reframe / Dolly)**,
  its own later spec.
- **Tap-to-focus + sliders.** Click the preview to focus (reuses the
  MaskExtractor preview-click pattern); `focus_offset` slider pulls focus
  nearer/farther for rack-focus.
- **Live-preview effect, NOT a durable asset.** Like the adjustment nodes, this
  returns `save_live_preview` (type:"temp") and auto-reruns on tweak. It does
  NOT mint an asset on every drag (that's exactly the Assets-flooding the
  type:"temp" filter prevents). The user exports a chosen result via a
  downstream Image node with Export on. See `[[reference_generator_assets]]`.
- **Render in torch (layered DoF), not GLSL.** Portable (CPU fallback works),
  dependency-light (torch is already present), consistent with the existing
  torch `Bokeh`/`TiltShift`. GLSL is a possible later optimization, not v1.
- **Depth is internal + cached, with an optional override input.** Auto-estimated
  from the image and cached per-image so changing *lens* params never
  re-estimates; a wired `depth` input skips estimation (lets one depth feed both
  this node and the future Reframe node).

## Architecture

### Depth foundation — `comfy_extras/_depth.py` (NEW)

The shared capability both this node and the future Reframe node use.

- **Model bundle.** Register a `'depth'` `ModelBundle` in the
  `comfy_extras/_model_downloads.py` registry (same mechanism as `faceswap`,
  `bgremove`, `subjecttrack`). Depth Anything V2 Small is a `transformers` model,
  so the bundle uses a `prepare_fn` that triggers the Hugging Face download and a
  `ready_check_fn` that checks the HF cache for presence — mirroring how the
  Face Swap bundle's `prepare_fn` orchestrates `buffalo_l`. Target model:
  `depth-anything/Depth-Anything-V2-Small-hf`.
- **Loader.** `_get_depth_model()` lazily builds the `transformers`
  depth-estimation pipeline/model and stashes it in `loader_cache()` under
  `'depth:model'` (CoreML/CUDA/CPU device handling like the sibling ML nodes).
- **`estimate_depth(image_tensor) -> torch.Tensor`** — runs the model on the
  first frame, returns a single-channel H×W map normalized to `[0,1]` with a
  fixed convention (1.0 = nearest, 0.0 = farthest), resized to the input's H×W.
- **Per-image cache.** A module-level `{image_hash: depth}` cache (hash = a cheap
  digest of the input tensor, e.g. shape + a downsampled byte signature). On a
  cache hit, return immediately without invoking the model — this is what keeps
  lens-param tweaks instant. Bounded to the few most recent images.

### Lens render math — `comfy_extras/_lens.py` (NEW)

Pure torch, no model/network/I/O, so it is unit-testable. Exposes:

- `circle_of_confusion(depth, focus, aperture) -> coc` — per-pixel blur radius:
  `~0` at the focus plane, growing monotonically with `|depth - focus|` and with
  `aperture`. `focus` in `[0,1]` (a depth value); `aperture` in `[0,1]`.
- `bokeh_kernel(shape, radius) -> kernel` — normalized 2D kernel: `circular`
  (disc), `hexagonal` (6-gon), `anamorphic` (horizontally-stretched ellipse).
- `render_dof(image, coc, *, bokeh_shape, highlight_bokeh) -> image` — **layered
  depth-of-field**: bucket pixels into N depth/CoC layers, blur each layer with
  the shaped kernel scaled to that layer's radius, composite **back-to-front**
  so nearer layers occlude farther ones (avoids the classic "background bleeds
  over a sharp subject" artifact). `highlight_bokeh` boosts bright out-of-focus
  pixels before blurring so highlights bloom into shaped discs.
- `chromatic_aberration(image, amount) -> image` — radial per-channel scale
  offset (reuse the approach in the existing `ChromaticAberration` node).
- `vignette(image, amount) -> image` — radial edge darkening.
- `focal_compression(image, depth, focal_length) -> image` — depth-scaled
  resample around the focus point that reads as wide↔telephoto compression
  within a safe range (no disocclusion holes); `focal_length = 0` is a no-op.
- `LENS_PRESETS: dict[str, dict]` — `Custom` (no overrides) plus
  `85mm Portrait`, `Vintage Swirly`, `Anamorphic`, `Clean`, each a dict of
  default param values. Presets are starting points; explicit node params
  override (composition like the Relight preset rule).

### Node — `comfy_extras/nodes_lens.py` (NEW)

`LensBlurNode` (`IO`-schema, `execute`), category `image/lens`.

- **node_id** `LensBlur`, **display_name** "Lens · Depth of Field".
- **Inputs:**
  - `image` (IMAGE).
  - `depth` (IMAGE, optional) — override auto-estimation.
  - `focus_point` (String, default `'{"x":0.5,"y":0.5}'`) — a UI-managed String
    exactly like MaskExtractor's `points` widget (no custom `sailor_widget`;
    the frontend writes it on preview-click and the node parses it). Backend
    reads depth at this point as the focus plane.
  - `focus_offset` (Float, default 0.0, min −1.0, max 1.0) — rack-focus pull
    relative to the tapped plane.
  - `aperture` (Float, default 0.4, min 0.0, max 1.0).
  - `lens_preset` (Combo, options from `LENS_PRESETS`, default `Custom`).
  - `bokeh_shape` (Combo: `circular`/`hexagonal`/`anamorphic`, default
    `circular`).
  - `highlight_bokeh` (Float, default 0.3, 0..1).
  - `chromatic_aberration` (Float, default 0.0, 0..1).
  - `vignette` (Float, default 0.0, 0..1).
  - `focal_length` (Float, default 0.0; signed range mapping wide↔tele).
- **Output:** `image` (IMAGE). `is_output_node`, `hidden=[unique_id]`.
- **execute:** guard if `image is None`. Resolve depth: use wired `depth`
  (resized to image H×W) if present, else `estimate_depth(image)` (cached).
  Resolve `focus = depth_at(focus_point) + focus_offset` (clamped 0..1). Apply
  preset defaults then explicit params (`_lens.resolve_params(preset, overrides)`).
  Render: `focal_compression` → `circle_of_confusion` → `render_dof` →
  `chromatic_aberration` → `vignette`. Return
  `IO.NodeOutput(result, ui=save_live_preview(result, uid))`.
- Extension + `comfy_entrypoint` like the sibling local nodes.

### Frontend

- **Tap-to-focus:** extend `ComfyNode.vue` — add `LensBlur` alongside
  `MaskExtractor` in `onPreviewClick` (single point; plain click sets the one
  focus point), the focus-marker SVG overlay, and the crosshair cursor. Reuse
  the existing 0..1 normalization + JSON-widget write. A single focus marker
  (distinct glyph/color from the SAM points) is drawn at `focus_point`.
- **Live preview:** add `LensBlur` to `LIVE_PREVIEW_NODES` so it auto-reruns
  (debounced) on widget change. Depth caching keeps each rerun to just the lens
  render.
- **Model download:** add `'depth'` to `ModelBundleKey` + `ALL_MODEL_BUNDLES` in
  `useModelDownloads.ts`; add the toolbox card under the **Lens** section in
  `toolbox-items.ts` with `requiresModels: 'depth'` and a "Downloads ~100 MB on
  first use" description (Depth Anything V2 Small; confirm the exact size against
  the Hugging Face weights during implementation and update the copy).
- `nodes.py` — add `nodes_lens.py` to the `comfy_extras` load list.

### Data flow

`image → (wired depth | cached estimate_depth) → depth → focus = depth_at(point)
+ offset → focal_compression → CoC → layered render_dof(bokeh, highlights) → CA →
vignette → save_live_preview (temp)`. A preview tap rewrites the `focus_point`
JSON widget, and the live-preview rerun re-focuses.

## Error handling

- **Depth model missing:** `execute` guards and raises a clear "add from the
  toolbox to download the depth model" error (like `nodes_bg_remove`); in
  practice `requiresModels` downloads it before the node is added.
- **No GPU:** torch falls back to CPU (slower but works); the depth model also
  falls back to CPU.
- **Wired `depth` mismatch:** resize the wired depth to the image's H×W; if it's
  multi-channel, take luminance/first channel.
- **Degenerate focus point:** clamp to `[0,1]`; default to image center.

## Testing

- **Unit `_lens.py`:** `circle_of_confusion` ≈ 0 at the focus plane and increases
  monotonically with distance and aperture; `render_dof` leaves the focused depth
  band sharp while a far band is blurred; `bokeh_kernel` returns the expected
  shape/normalization per option; `vignette` darkens corners more than center;
  `focal_compression(…, focal_length=0)` is a no-op; `resolve_params` applies
  preset then override precedence.
- **Unit `_depth.py`:** `estimate_depth` returns a single-channel H×W map in
  `[0,1]` at the input resolution; the per-image cache returns the same tensor
  without re-invoking the model (monkeypatch `_get_depth_model` and assert one
  call across two `estimate_depth` calls with the same image).
- **Import smoke:** `import comfy_extras.nodes_lens` and
  `LensBlurNode.define_schema().node_id == "LensBlur"`.
- **Manual in-browser (needs user + model download):** add Lens from the toolbox
  (triggers the depth download), tap a subject to focus, sweep aperture, switch
  bokeh shapes, try presets, push focal-length — confirm the subject stays sharp
  while the background blurs with the chosen bokeh, focus pull works, and tweaks
  are responsive (depth cached).

## Risks

- **Depth-edge halos:** layered DoF can fringe at sharp depth discontinuities;
  mitigate with a small feather between layers. Documented; tune in QA.
- **Performance:** first run pays depth estimation; subsequent tweaks are render-
  only via the cache. Large images may still be slow in pure torch — downscale
  the render working resolution if needed (documented knob, not v1 scope).
- **Compression-look limits:** the depth-scaled focal-length look is convincing
  only within a moderate range; large swings need the real reprojection in
  Node 2. The slider range is bounded to stay believable.

## Out of scope (this node)

- True 3D reprojection / parallax / big focal-length swings with disocclusion
  inpainting — that is **Node 2 (3D Reframe / Dolly)**, a separate spec.
- A standalone "Depth Map" node (YAGNI; depth is internal + an optional input).
- GLSL render path (possible later optimization).
- Video DoF across frames (v1 is single-image; the node may process frame 0).
