# Swap Product node — design

**Date:** 2026-07-05
**Status:** Approved, ready for implementation planning

## Problem

Building a repeatable packshot today means chaining four generative nodes
(Generate background → Blend Scene → Relight → Generate video). Every node with a
Re-roll button is a fresh dice roll, so producing the *same* packshot for a
different product means freezing backgrounds, locking seeds, and keeping every
param identical by hand — fragile and manual.

The simpler pattern: once a hero packshot exists, treat it as a fixed
scene/lighting/camera **reference** and swap only the subject in a single
reference-conditioned edit. This gives near-zero drift because the look is copied
from the reference rather than regenerated.

## Scope

Ship **Swap Product** first — the highest-value, lowest-risk slice. A single
canvas node that places a new product into a finished packshot scene.

Explicitly **out of scope for v1** (deferred, not designed here):

- Generalization to "swap object" / "swap person" (person would route through the
  existing LoRA-canonical character library, not this node)
- Model picker, seed, feather, output-format controls
- Batch-swap of multiple products
- Any custom Vue component / widget

## Existing wiring this builds on

- **BlendSceneNode** (`comfy_api_nodes/nodes_replicate.py`) — composites a product
  into a scene via Flux Kontext / Nano Banana; its `_build_blend_instruction`
  helper is the pattern for assembling a prose prompt.
- **Two-image → nano-banana-2 is proven**: RelightNode passes
  `image_input: [subject, reference]`; `/api/inpaint/pose.post.ts` passes
  `image_input: [character, pose]`. Order matters and is spelled out in the prompt.
- **Node registration**: backend ComfyUI node → appears on canvas automatically
  via `/object_info`. Frontend needs a catalog entry + icon only; it renders
  generically through `ComfyNode.vue`.

## Design

### Surface

New `SwapProductNode`, `display_name: "Swap Product"`,
`category: "api node/image/Replicate"`. No custom Vue — renders generically like
Blend Scene. Chain a video node after it for the moving packshot.

### Backend node — `comfy_api_nodes/nodes_replicate.py`

Inputs:

| Input | Type | Notes |
|-------|------|-------|
| `scene_reference` | Image | The finished packshot — fixed scene, lighting, camera |
| `product` | Image | New product; a clean cutout OR a plain photo both work |
| `instructions` | String (optional, multiline) | Extra refinement / deviation from the default swap |

Output: single Image.

Model: fixed to **`google/nano-banana-2`** (Replicate), invoked through the same
`_run_prediction` seam RelightNode uses:

```python
image_input = [_image_tensor_to_data_url(scene_reference),
               _image_tensor_to_data_url(product)]
input_dict = {
    "prompt": prompt,
    "image_input": image_input,   # [0] = scene, [1] = product
    "resolution": "1K",
    "output_format": "png",
}
await _run_prediction("google/nano-banana-2", input_dict)
```

Price ~$0.05 per swap (same as Relight).

### Prompt construction

A dedicated builder function (mirrors `_build_blend_instruction`) so it is unit
testable in isolation. Image order is load-bearing: `image[0]` = scene,
`image[1]` = product.

Base instruction (always included):

> The first image is a finished product photo. The second image is a different
> product. Replace the product in the first image with the product from the
> second image, in the same position, scale, and orientation. Keep the first
> image's background, surface, camera angle, and framing exactly as they are.
> Reproduce the second product's shape, proportions, label, logo, text, and
> colors faithfully — do not invent or alter any branding. Relight the new
> product to match the scene's lighting direction, color temperature, shadows,
> and reflections. Match the scene's lens perspective, depth of field, and grain.

If `instructions` is non-empty, append it as an additional sentence.

The preserve-branding / match-lighting / match-camera behaviors are **baked into
the base prompt**, not exposed as toggles — for a product swap they are wanted
100% of the time, so a toggle would be clutter. `instructions` is the single
escape hatch for deliberate deviation.

### Frontend registration

- `frontend/app/data/action-catalog.ts`:
  ```ts
  SwapProductNode: {
    useCase: 'Swap a product into a finished scene',
    model: 'Nano Banana 2',
    intent: 'edit',
    source: 'image',
  }
  ```
- `frontend/app/data/generator-icons.ts`: `SwapProductNode: Replace` (Lucide), and
  `NODE_MODEL_BRAND: { SwapProductNode: 'Gemini' }`.

## Testing

1. **Unit** — the prompt builder: empty `instructions` yields the base prompt;
   non-empty appends it. (Follows the existing blend-instruction test pattern.)
2. **Live + screenshot sign-off** — swap the bottle in the existing packshot for a
   different product and review the rendered result together. Per standing rule,
   a visual node is not shippable on unit tests alone.

## Success criteria

- New product lands in the reference scene with background, framing, camera, and
  lighting visually unchanged from the reference.
- The product's branding is reproduced faithfully (no invented labels).
- Running the same two inputs twice yields visually consistent results (drift is
  bounded by the reference, not a seed).
