# Lens · 3D Reframe — Design

**Date:** 2026-06-13
**Branch:** `feat/lens-3d-reframe`
**Status:** Approved, implementing

Node 2 of the lens family. Where Node 1 (`Lens · Depth of Field`, shipped) renders
a depth-based shallow-focus *look*, Node 2 performs a **true focal-length
re-shoot**: unproject the image to 3D using the depth map, physically move the
virtual camera and change the field of view, re-project, and fill the revealed
(disoccluded) background with the local LaMa inpainter. The user "switches to a
different lens" by name and the *perspective itself* changes — wide lenses
exaggerate near/far separation, telephotos compress.

Builds directly on the shared `estimate_depth()` foundation from Node 1.

## Goals

- Re-shoot a single image as if captured on a different **real lens**, chosen
  from a curated library (focal length + optical character).
- Geometrically real perspective change (parallax), not a crop or a 2D scale.
- Be honest about fidelity: monocular depth + single-image reprojection is
  convincing for *adjacent-lens* moves and degrades on extreme swings, so the UI
  surfaces a live fidelity meter rather than hiding the limit.

## Non-goals (v1)

- **Depth of field / bokeh** — chain Node 1 (`Lens · Depth of Field`) downstream.
- **Relighting / specular update** — baked lighting stays as-is for the new view.
- **Video / batch** — single image, like Node 1 (`batch[0]` only).
- **EXIF auto-read of source focal length** — the decoded ComfyUI IMAGE tensor has
  no EXIF, so the source lens is a manual dropdown. Auto-fill would require the
  loader to thread metadata through; deferred.

## Honesty about fidelity

We do real 3D reprojection, so the *direction and feel* of the perspective shift
matches a real re-shoot (same pinhole-camera math). It diverges from a real
re-shoot in three ways, all surfaced or bounded rather than hidden:

1. **Monocular depth is relative and imperfect** — fine edges (hair, foliage),
   transparent/reflective, and flat textureless regions can rubber-sheet warp.
2. **Disocclusion holes are invented** — moving the camera reveals background the
   photo never captured; LaMa fills it plausibly but it is hallucinated. Small
   moves = small holes = invisible; big swings = large holes = obvious.
3. **Lens character is evocative, not measured** — distortion/vignette are tuned
   to read right, not ray-traced MTF.

Decision: **full range + a fidelity meter** (not a hard clamp). `reframe_strength`
goes past 1.0 so users can push it; the meter goes green→amber→red as the
invented fraction of the frame climbs, so degradation is informed, not surprising.
We can tighten ranges later if real images look too weird.

## Architecture & files

Mirrors Node 1's shape (interactive, live-preview, export via downstream Image
node).

- **`comfy_extras/nodes_lens_reframe.py`** — `LensReframeNode`
  (`node_id="LensReframe"`, display *"Lens · 3D Reframe"*, category `image/lens`).
  Live-preview (`save_live_preview`, `type:"temp"`), `is_output_node=True`.
- **`comfy_extras/_reframe.py`** — pure-torch reprojection math (no I/O, testable).
- **`comfy_extras/_lenses.py`** — the curated lens library (data only).
- **`comfy_extras/_inpaint.py`** — *new shared helper.* Extract LaMa's ONNX
  session + per-frame inpaint loop out of `nodes_object_remove.py` into
  `lama_ready()` and `lama_inpaint(image, mask, grow=0)`; rewrite
  `ObjectRemoveNode.execute` to call it (no behavior change). Node 2 calls the
  same helper to fill disocclusion holes.
- Reuses `estimate_depth()` from `_depth.py` and the `'depth'` + `'lama'` model
  bundles unchanged.

## Reprojection pipeline (`_reframe.py`)

Input: image `[H,W,3]`, depth `[H,W]` normalized (1.0 = nearest), anchor `(x,y)`
in 0..1, `f_src` / `f_tgt` in mm, `strength`.

1. **Depth → camera-space Z.** Map normalized depth to a metric-ish Z with the
   anchor plane as the pivot distance. Relative scale folds into the dolly, so
   exact units are irrelevant; near pixels get small Z, far pixels large Z.
2. **Unproject to 3D** using source intrinsics. Full-frame 36mm sensor:
   `f_px = f_mm / 36 * W`, `cx, cy = W/2, H/2`.
   `X = (u-cx)*Z/f_src_px`, `Y = (v-cy)*Z/f_src_px`, `Z = Z`.
3. **Dolly + new FOV.** To keep the anchor subject the same size when swapping
   `f_src → f_tgt`, translate the camera along Z so the anchor distance scales by
   `f_tgt/f_src` (telephoto → camera back, compresses; wide → camera in,
   exaggerates). `strength` lerps the camera translation (and FOV change) from
   identity (0) to full (1), past 1 to exaggerate.
4. **Forward-splat reproject** with target intrinsics. Depth-sorted painter's
   write (sort source pixels far→near, scatter so near occludes far) produces the
   warped image + a written-pixel mask. A 2×2 splat footprint + a small
   morphological closing on the written mask suppress 1-px sampling speckle so
   only true disocclusions remain as holes.
5. **Inpaint holes** via `lama_inpaint(warped, hole_mask)`.
6. **Lens character** in screen space: radial **distortion** remap
   (barrel/pincushion via `grid_sample`) + **vignette** (radial falloff multiply).
7. **Fidelity** = fraction of output pixels that were true holes before inpaint.

The risky novelty (steps 4–5) is isolated in this pure-torch module so it is unit
testable without the model or the node.

## Lens library (`_lenses.py`)

Curated list; full-frame 36mm assumed. Numbers are evocative and tunable.

| Name | focal mm | distortion | vignette | max f |
|---|---|---|---|---|
| Ultra-Wide 16mm | 16 | +0.06 | 0.30 | 2.8 |
| Wide 24mm Art | 24 | +0.03 | 0.22 | 1.4 |
| Classic 35mm Summilux | 35 | +0.01 | 0.18 | 1.4 |
| Normal 50mm Planar | 50 | 0.00 | 0.12 | 1.4 |
| Portrait 85mm GM | 85 | −0.01 | 0.16 | 1.4 |
| Tele 135mm f/2 | 135 | −0.02 | 0.20 | 2.0 |
| Long 200mm | 200 | −0.03 | 0.24 | 2.8 |
| Custom | (slider) | (slider) | (slider) | — |

`distortion`: positive = barrel, negative = pincushion. `max f` is informational
(which aperture to dial when chaining Node 1). Each row also carries a one-line
character note for a tooltip. Exposed as `LENSES` (list of dicts) plus
`NAMES` (combo options) and a `get(name)` lookup.

## Node schema & frontend

**Inputs:**
- `image` (IMAGE); `depth` (IMAGE, optional override — resized + collapsed to
  `[H,W]` exactly like Node 1).
- `anchor_point` (String, default `{"x":0.5,"y":0.5}`) — tap the preview to set
  the subject the dolly pivots on. Reuses Node 1's preview-click → widget pattern.
- `source_lens` (Combo, default *Normal 50mm*) — "Shot on."
- `target_lens` (Combo, default *Portrait 85mm GM*) — "Re-shoot as."
- `reframe_strength` (Float, 0.0–1.5, default 1.0).
- `custom_focal` (Float, 10–300, used when a lens = Custom).
- `distortion` (Float, −0.2..0.2) and `vignette` (Float, 0..1) overrides,
  populated from `target_lens` by a frontend watcher (reuses Node 1's
  `lens_preset` watcher); user edits win.

**Output:** `image` (IMAGE), live preview via `save_live_preview`.

**Fidelity meter:** `execute` returns
`ui = {**save_live_preview(...), "lens_fidelity": [pct]}`. A small addition in
`frontend` `ComfyNode.vue` renders a thin bar under the preview, green→amber→red
as `pct` rises. This is the only genuinely new frontend piece; the watcher and
preview-click reuse Node 1's code paths.

## Error handling

- No `image` → return a 16×16 blank with a preview, like Node 1.
- Depth model not ready and no wired depth → raise the same friendly "click the
  card to download" error Node 1 raises.
- LaMa not ready → raise a friendly "click the Object Removal / Reframe card to
  download (~196 MB)" error (reuses the `lama` bundle's readiness check).
- Degenerate move (`f_src == f_tgt` or `strength == 0`) → short-circuit to the
  original image (no reprojection, fidelity 0).

## Testing

Pure-torch `_reframe` on a synthetic two-plane scene (near square on a far
background):
- Parallax: under a dolly, the near plane's pixels shift more than the far plane's.
- Occlusion side: the hole mask appears on the geometrically correct side of the
  near plane for the camera-move direction.
- Monotonic fidelity: hole fraction rises with `reframe_strength`.
- Degenerate: `strength=0` returns the input unchanged, fidelity 0.

Plus: `_lenses` validity (every entry has the required keys, focal > 0), and an
`_inpaint` refactor regression check (Object Removal output unchanged for a fixed
image+mask before/after the extraction).
