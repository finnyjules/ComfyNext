# Swap Background + Turntable nodes — design

**Date:** 2026-07-05
**Status:** Approved, ready for implementation planning

## Problem

Ecomm/marketing teams shoot one hero product asset, then need many derived
assets: the same product in different scenes, and a 360° spin for the PDP.
Reshooting each variant costs studio time. Two packaged, one-click nodes cover
the highest-volume cases, following the just-shipped **Swap Product** pattern
(one reference-anchored node, minimal controls).

These are **two independent nodes** sharing one theme. They can be built and
shipped separately; Swap Background is the natural first slice (it reuses the
Swap Product engine).

## Scope

- **Swap Background** — lock the product, change the environment (inverse of Swap
  Product). Image → image.
- **Turntable** — a front packshot → seamless 360° spin. Image → video.

**Out of scope (deferred, not designed here):**
- Discrete-frame stitch turntable (still frames from RotateCameraNode stitched).
  The Turntable's anchored path DOES stitch — but it stitches short *keyframe
  video segments*, not discrete stills (see Feature 2).
- Veo 3.1 as a first/last keyframe engine — its fal app supports it, but the
  builder isn't wired for a tail frame and it is ~10× the cost. Noted as a
  future "max quality" lever; not built.
- Model pickers, seed, duration/fps controls, GIF export.
- Batch runners, colourway/variant generators, channel-resize packs (separate
  future features).
- Removing the existing `ProductShotNode` (Swap Background overlaps its
  prompt→background path but supersedes it with a better model; leaving
  ProductShot in place is out of scope).

## Existing infrastructure this builds on

- **SwapProductNode** (`comfy_extras/nodes_swap_product.py` +
  `_swap_product_prompts.py`) — two IMAGE inputs + optional `instructions` →
  `google/nano-banana-2`; dependency-light, unit-tested prompt builder; guard
  that skips the API call when a required image is missing. Swap Background
  mirrors this exactly.
- **`_build_blend_instruction`** (`nodes_replicate.py:2247`) — the pattern for
  assembling a prompt from boolean toggles (used by Swap Background's builder).
- **Relight lesson** (commit `b38f825e0`): a reference-edit prompt must NOT tell
  the model to reproduce the subject's *colours* "faithfully / do not alter"
  when relighting is wanted — that clause suppresses relight. Separate branding
  fidelity from illumination. Swap Background's `relight_to_scene` clause follows
  this.
- **Video nodes + registry** (`video_models.py`, `GenerateVideoNode`,
  `KlingVideoRemoteNode`, `Seedance2RemoteNode`) — image→video with a start
  image + motion prompt. **Luma Ray 2 720p** exposes a native `loop: true` for a
  seamless loop. Video outputs (`IO.Video.Output()`) render generically on the
  canvas — no custom frontend.
- **BlendSceneNode** dual-model dispatch (picks model by context) — the pattern
  Turntable uses to switch between the loop model and the face-anchoring model.
- **Registration**: backend node → add file to the `extras_files` list in
  `nodes.py` (NOT auto-scanned), plus an `action-catalog.ts` entry and a
  `generator-icons.ts` icon (+ `NODE_MODEL_BRAND`).

---

## Feature 1 — Swap Background (`SwapBackgroundNode`)

### Surface
New `SwapBackgroundNode`, `display_name: "Swap Background"`,
`category: "api node/image/Replicate"`. No custom Vue (renders generically).

### Inputs

| Input | Type | Req | Notes |
|-------|------|-----|-------|
| `product` | IMAGE | ✅ | The locked subject to keep |
| `background_reference` | IMAGE | optional | A scene/backdrop photo; wins if wired |
| `scene_prompt` | STRING (multiline) | optional | Describe the scene when no reference |
| `relight_to_scene` | BOOLEAN, default **True** | | On: product adopts the new scene's light direction/colour-temp/reflections. Off: keep the product's original lighting exactly (clean backdrop swap) |
| `ground_with_shadow` | BOOLEAN, default **True** | | On: add a contact shadow/reflection so it sits on the surface. Off: clean float (gradient/abstract backdrops) |
| `keep_scale_and_placement` | BOOLEAN, default **True** | | On: product stays the same size & position as the source (batch consistency). Off: model composes it naturally into the scene |
| `instructions` | STRING (multiline) | optional | Free-text refinement, appended |

Output: one IMAGE. Model: `google/nano-banana-2`. ~$0.05.

### Behavior & data flow
- **Both `background_reference` and `scene_prompt` blank** → pass `product`
  through unchanged, no API call (mirrors Swap Product's missing-input guard).
- **`background_reference` wired** (reference mode) →
  `image_input: [background_reference, product]`; prompt: "the first image is a
  background scene; the second image is a product; place the product into this
  background…". Reference wins even if `scene_prompt` is also set.
- **Only `scene_prompt`** (prompt mode) → `image_input: [product]`; prompt:
  "the image is a product; generate a new background around it described as:
  {scene_prompt}…".

### Prompt builder (`_swap_background_prompts.py`)
Dependency-light (no torch/comfy/network), unit-tested — mirrors
`_swap_product_prompts.py` and `_build_blend_instruction`. Signature:

```
build_swap_background_instruction(
    has_reference: bool,
    scene_prompt: str,
    relight_to_scene: bool,
    ground_with_shadow: bool,
    keep_scale_and_placement: bool,
    instructions: str = "",
) -> str
```

- A base clause picks reference-mode vs prompt-mode wording.
- **Always baked (not toggled):** preserve the product's exact shape,
  proportions, label, logo, text and branding — accurate and legible.
- **`relight_to_scene` True** appends the relight clause (adopt scene light,
  colour temp, reflections) — deliberately worded to relight the product's
  *illumination* while its branding artwork stays intact (the `b38f825e0`
  lesson). **False** appends a clause to keep the product's original lighting
  untouched and only replace what's behind it.
- **`ground_with_shadow` True** appends a contact-shadow/reflection clause;
  **False** appends "no cast shadow; keep the product cleanly separated".
- **`keep_scale_and_placement` True** appends "keep the product at the same
  size and position as the input"; **False** appends "compose the product
  naturally within the scene".
- Non-blank `instructions` appended as a final sentence.

### Registration
- `action-catalog.ts`: `SwapBackgroundNode: { useCase: 'Swap the background behind a product', model: 'Nano Banana 2', intent: 'edit' }`
- `generator-icons.ts`: `SwapBackgroundNode: ImagePlus` (Lucide) + `NODE_MODEL_BRAND: 'Gemini'`

### Testing
1. Unit — the prompt builder: reference-mode vs prompt-mode base clause; each
   of the three booleans flips its clause; instructions appended; branding
   language always present.
2. Live + screenshot sign-off — swap the packshot into (a) a reference backdrop
   and (b) a text-prompted scene; verify product fidelity + that each toggle
   visibly changes the result.

---

## Feature 2 — Turntable (`TurntableNode`)

### Surface
New `TurntableNode`, `display_name: "Turntable"`,
`category: "api node/image/Replicate"`. No custom Vue. Outputs VIDEO.

### Inputs

| Input | Type | Req | Notes |
|-------|------|-----|-------|
| `image` | IMAGE | ✅ | **Front** view — position 0° (also the loop's start/end frame) |
| `right_reference` | IMAGE | optional | True right side — position 90° |
| `back_reference` | IMAGE | optional | True back — position 180° |
| `left_reference` | IMAGE | optional | True left side — position 270° |
| `direction` | COMBO `left`/`right`, default `left` | | Traversal/rotation sense |
| `instructions` | STRING (multiline) | optional | Free-text refinement, appended |

Output: one VIDEO. Cost scales with the number of segments (see below): ~$0.50
front-only, up to ~$2–$6 for a full 4-view spin.

### Hidden-faces strategy (the core design point)
A single front image forces the model to *invent* the back/sides — unacceptable
for products with distinct back artwork. Two pinned paths, dispatched by whether
any extra view is wired (the `BlendSceneNode` "pick model by context" pattern):

**Path A — simple spin (front only): Luma Ray 2 720p.**
`start_image_url = front`, `loop: true` (`video_models.py:356`, `:360`) → one
call, natively seamless. Reliable for simple/symmetric products; the back is
inferred. A plain-language caveat goes in the node description: "With only a
front image, the back and sides are inferred — wire the side/back views for
products with distinct faces."

**Path B — faces-correct spin (extra views wired): Seedance 2.0 keyframe-stitch.**
Seedance 2.0 (fal) is the one registered model wired for a last frame
(`image_url` + `end_image_url`, `video_models.py:273–277`; `firstLast` fal fn,
`:481`). Because both endpoints of each segment are *real supplied photos*, the
faces are guaranteed correct and the concatenation closes seamlessly (segment N
ends on the front = segment 1's start). Mechanism:

- The provided views sit at fixed angles: front 0°, right 90°, back 180°,
  left 270°. Walk them in `direction` order around the circle, wrapping back to
  front. For each consecutive pair of *provided* views, emit one Seedance
  first→last segment; its prompt says "smooth turntable rotation by N degrees,
  no morphing, camera fixed" where N is the angular gap.
- So the segment count adapts to what's wired: front+back → two 180° arcs (sides
  interpolated); front+right+back+left → four 90° arcs (every face real). Any
  subset works.
- **Stitch** the segment clips into one video with ffmpeg `concat`, dropping the
  duplicate boundary frame between segments (segment N's last frame == segment
  N+1's first frame) so there's no 1-frame stutter.

**Residual risk (call out, verify live):** within a segment the *rotation path*
is Seedance's interpolation — it could morph rather than cleanly rotate. The
keyframe faces are locked; the in-between needs the "no morphing / smooth
turntable" prompt and a live check. Far lower risk than inventing a whole back.

**Build-time confirmations (plan, first turntable task):** (a) `ffmpeg` is
available in the ComfyUI env for the concat step; (b) the exact Seedance
first→last invocation via the video registry / fal `firstLast` fn. Neither
changes the design; both are wiring checks.

### Prompt builder (`_turntable_prompts.py`)
Dependency-light, unit-tested. Two helpers:
- `simple_spin_instruction(direction, instructions="")` — Path A: "the product
  makes a smooth, continuous full 360° turntable spin to the {direction},
  camera fixed, consistent lighting and background, seamless loop."
- `segment_instruction(degrees, direction, instructions="")` — Path B per
  segment: "smooth turntable rotation {degrees}° to the {direction}, no
  morphing, camera fixed, consistent lighting and background."
Both append non-blank `instructions`.

### Registration
- `action-catalog.ts`: `TurntableNode: { useCase: 'Spin a product 360°', model: 'Luma Ray 2 / Seedance 2.0', intent: 'create' }`
- `generator-icons.ts`: `TurntableNode: Rotate3d` (Lucide) + `NODE_MODEL_BRAND: 'Luma'` (the default/front-only path's brand)

### Testing
1. Unit — the prompt builders: `simple_spin_instruction` direction swaps and has
   loop/360 language; `segment_instruction` includes the degree gap, direction,
   and "no morphing"; instructions appended in both.
2. Unit — the segment planner (pure function: set of provided view-angles +
   direction → ordered list of `(startView, endView, degrees)` segments):
   front-only → empty (Path A); front+back → two 180° segments; all four → four
   90° segments; direction reverses the order.
3. Live + clip sign-off — front-only spin (seamless loop check on Luma), then a
   full 4-view spin (verify each real face appears at its angle and the stitched
   loop has no seam/stutter).

---

## Success criteria

**Swap Background**
- Product's branding stays pixel-faithful across background changes.
- Each of the three toggles produces a visibly different, correct result
  (relit vs original lighting; grounded vs floating; fixed vs composed placement).
- Reference-mode and prompt-mode both work; both-blank is a safe no-op.

**Turntable**
- Front-only spin (Path A / Luma) is a smooth, seamless 360° loop for a simple
  product.
- Full-view spin (Path B / Seedance keyframe-stitch): each supplied real face
  (right/back/left) appears at its angle rather than a hallucinated one, and the
  stitched result loops with no visible seam or 1-frame stutter.
- The segment planner emits the correct segments for any subset of wired views.
- Video renders and plays on the canvas with no custom frontend work.
