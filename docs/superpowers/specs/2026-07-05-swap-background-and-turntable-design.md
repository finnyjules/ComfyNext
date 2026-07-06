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
- Multi-view *stitch* turntable (discrete RotateCamera frames stitched); v1
  turntable is a single image→video call.
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
| `image` | IMAGE | ✅ | Front packshot — the spin's start frame |
| `back_reference` | IMAGE | optional | True back of the product; anchors the 180° face |
| `side_reference` | IMAGE | optional | True side; anchors the 90°/270° faces |
| `direction` | COMBO `left`/`right`, default `left` | | Spin direction |
| `instructions` | STRING (multiline) | optional | Free-text refinement |

Output: one VIDEO. ~$0.50.

### Hidden-faces strategy (the core design point)
A single front image forces the model to *invent* the back/sides — unacceptable
for products with distinct back artwork. So:

- **No extra views wired** → single-image inference path: **Luma Ray 2 720p**
  with `loop: true` for a seamless spin. Reliable for simple/symmetric products.
- **`back_reference` and/or `side_reference` wired** → anchored path: dispatch to
  a model that supports real-face anchoring (multi-image reference or
  front→back start/end keyframe), so the true faces appear at their angles.

**Build-time decision (resolved in the plan, not here):** which concrete model
serves the anchored path — candidates are Kling (start+end keyframe: front→back),
a multi-reference I2V, or Seedance. The plan's first turntable task investigates
`video_models.py` capabilities and picks; it must confirm (a) real-face
anchoring and, ideally, (b) loop support. If no single model gives both, use
dual-model dispatch (loop model for the no-extra-views case, anchor-capable
model when extra views are present) — the `BlendSceneNode` pattern. Document the
chosen mechanism in the node's description.

A plain-language caveat goes in the node description for the inference path:
"With only a front image, the back and sides are inferred — wire back/side
references for products with distinct faces."

### Prompt builder (`_turntable_prompts.py`)
Dependency-light, unit-tested. A baked turntable instruction with `direction`
swapped in: "the product rotates a smooth, continuous full 360° turntable spin
to the {direction}, revealing all sides; camera fixed; consistent lighting and
background; seamless loop." Non-blank `instructions` appended.

### Registration
- `action-catalog.ts`: `TurntableNode: { useCase: 'Spin a product 360°', model: 'Luma Ray 2', intent: 'create' }` (model label updated if the plan selects a different anchored-path model)
- `generator-icons.ts`: `TurntableNode: Rotate3d` (Lucide) + `NODE_MODEL_BRAND` set to the chosen provider

### Testing
1. Unit — the prompt builder: direction swaps correctly; loop/360 language
   present; instructions appended.
2. Live + screenshot/clip sign-off — spin the packshot with no extra views
   (seamless loop check), then with a back reference (verify the real back
   appears at 180°).

---

## Success criteria

**Swap Background**
- Product's branding stays pixel-faithful across background changes.
- Each of the three toggles produces a visibly different, correct result
  (relit vs original lighting; grounded vs floating; fixed vs composed placement).
- Reference-mode and prompt-mode both work; both-blank is a safe no-op.

**Turntable**
- No-extra-views spin is a smooth, seamless 360° loop for a simple product.
- With `back_reference` wired, the real back appears at the 180° point rather
  than a hallucinated one.
- Video renders and plays on the canvas with no custom frontend work.
