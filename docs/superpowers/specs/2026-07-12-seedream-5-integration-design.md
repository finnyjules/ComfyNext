# Seedream 5.0 Integration — Design

**Date:** 2026-07-12
**Status:** Approved design, pending spec review

## Goal

Bring ByteDance's new Seedream 5.0 models (`bytedance/seedream-5-pro` and
`bytedance/seedream-5-lite`) into Sailor, and — prompted by the realization
that nothing in the app generates from a *variable set* of reference images —
add a purpose-built **multi-reference generation** node that Seedream 5's
up-to-10-reference capability is ideal for.

Two independent parts:

1. **Text-to-image** — register/fix the two Seedream 5 models in the
   text-to-image catalog (the "Generate an image" node).
2. **Multi-reference generation** — a new "Generate from references" node that
   takes up to 6 reference images + a prompt and routes to Seedream 5.

## Confirmed Replicate facts

Both slugs exist on Replicate (verified against `replicate.com/bytedance`):

| Model | Slug | `size` enum | References | Batch | Price/image |
|---|---|---|---|---|---|
| Seedream 5 Pro | `bytedance/seedream-5-pro` | `1K` / `2K` | up to 10 (`image_input[]`) | not documented | $0.045 (1K) / $0.09 (2K) |
| Seedream 5 Lite | `bytedance/seedream-5-lite` | `2K` / `3K` | yes (`image_input[]`) | `sequential_image_generation` + `max_images` (1–15) | ~$0.035 |

Common inputs: `prompt`, `aspect_ratio` (`1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3,
21:9`, plus `match_input_image` when references are supplied), `seed`,
`output_format` (PNG/JPEG). Output is a URL (or URL array for batch).

> **Implementation note:** Pro's batch parameters (`sequential_image_generation`,
> `max_images`) are not documented. During implementation, fetch the live
> Replicate OpenAPI schema for `seedream-5-pro`; only expose batch controls on
> Pro if the schema confirms them. Otherwise Pro is size-only. Do not send
> undocumented params — Replicate rejects unknown input keys.

## Current state in the codebase

- `seedream-5-lite` is **already registered** end-to-end but with a wrong `size`
  enum (`1K`/`2K` instead of `2K`/`3K`). It must be corrected, not added.
  - Frontend: `frontend/app/data/image-models.ts:506-519`
  - Backend: `comfy_api_nodes/image_models.py:325-332` (`_b_seedream_5_lite`),
    registry entry at line 637.
- `seedream-5-pro` does **not** exist.
- The editing surface (`EditImageNode`, `BlendSceneNode`, `RotateCameraNode`) is
  **single-image only**. `RestyleFromImageNode` is the only multi-image node and
  it's a fixed 2-slot (content + style). No node accepts a variable list of
  references. This is the gap Part 2 fills.
- `comfy_api_nodes/image_edit_models.py` is a dispatcher explicitly built to grow
  ("adding more edit models … Seedream-Edit … is one entry per model") but today
  holds one model (`qwen-image-edit-plus`) and is used only by `RotateCameraNode`.

## Part 1 — Text-to-image models

Pure catalog edit across the two mirrored files, keyed by shared `id`. No node
schema, bridge, or gallery changes — both are data-driven.

### 1a. Fix `seedream-5-lite`

**Frontend** (`image-models.ts:506-519`): correct the `size` options and add
batch controls.

```ts
{
  id: 'seedream-5-lite',
  label: 'Seedream 5 Lite',
  brand: 'ByteDance',
  replicateSlug: 'bytedance/seedream-5-lite',
  pitch: 'Reasoning-driven generation with example-based editing. Batches related images.',
  tags: ['cinematic', 'multi-image'],
  pricePerImage: 0.035,
  aspectRatios: SEEDREAM_AR,
  defaultAspectRatio: '1:1',
  advanced: [
    { name: 'size', type: 'select', label: 'Size preset', default: '2K', options: ['2K', '3K'] },
    { name: 'sequential_image_generation', type: 'select', label: 'Batch mode',
      default: 'disabled', options: ['disabled', 'auto'],
      description: '"auto" lets the model produce a set of related images.' },
    { name: 'max_images', type: 'integer', label: 'Max images', default: 1, min: 1, max: 15,
      description: 'Only used when Batch mode is "auto".' },
  ],
}
```

**Backend** (`image_models.py`, replace `_b_seedream_5_lite` at 325):

```python
def _b_seedream_5_lite(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_SEEDREAM_AR, ar),
        "size": _opt_str(adv, "size", "2K"),  # 2K | 3K
    }
    seq = _opt_str(adv, "sequential_image_generation", "disabled")
    if seq == "auto":
        inp["sequential_image_generation"] = "auto"
        inp["max_images"] = _opt_int(adv, "max_images", 1)
    _maybe_set_seed(inp, seed)
    return inp
```

`size` should clamp/fall back to `2K` if an out-of-range value arrives (defensive,
since the old stored value could be `1K`). Registry entry at line 637 is unchanged
(slug and builder name stay the same).

### 1b. Add `seedream-5-pro`

**Frontend** — new entry in the ByteDance block (`image-models.ts`, after 4.5):

```ts
{
  id: 'seedream-5-pro',
  label: 'Seedream 5 Pro',
  brand: 'ByteDance',
  replicateSlug: 'bytedance/seedream-5-pro',
  pitch: 'ByteDance flagship — sharp 1K/2K, design-aware reasoning, reference editing.',
  tags: ['cinematic', 'photoreal', 'multi-image'],
  pricePerImage: null,  // varies by size: $0.045 (1K) / $0.09 (2K)
  aspectRatios: SEEDREAM_AR,
  defaultAspectRatio: '1:1',
  advanced: [
    { name: 'size', type: 'select', label: 'Size preset', default: '2K', options: ['1K', '2K'] },
  ],
}
```

**Backend** — new builder + registry entry (`image_models.py`):

```python
def _b_seedream_5_pro(prompt: str, ar: str, seed: int, adv: dict) -> dict:
    inp = {
        "prompt": prompt,
        "aspect_ratio": _ar_or(_SEEDREAM_AR, ar),
        "size": _opt_str(adv, "size", "2K"),  # 1K | 2K
    }
    _maybe_set_seed(inp, seed)
    return inp
```

```python
ImageModel("seedream-5-pro", "Seedream 5 Pro", "ByteDance",
           "bytedance/seedream-5-pro", sorted(_SEEDREAM_AR), _b_seedream_5_pro),
```

Place it above `seedream-5-lite` in both catalogs so Pro reads as the flagship.

## Part 2 — "Generate from references" node

A new node dedicated to composing a new image from a variable set of reference
images. Decision (confirmed): **new node**, **up to 6 fixed image slots**.

### 2a. Generalize the edit dispatcher

`image_edit_models.py`'s builder signature takes a single `image_url`. Broaden it
to a list — the only consumers are the Qwen builder and `RotateCameraNode`, both
of which already work in terms of a 1-element list.

```python
# (prompt, image_urls: list[str], seed, advanced) -> Replicate input dict
ImageEditInputBuilder = Callable[[str, list[str], int, dict[str, Any]], dict[str, Any]]

def _b_qwen_image_edit_plus(prompt, image_urls, seed, adv):
    inp = {"prompt": prompt, "image": list(image_urls),
           "output_format": "png", "output_quality": 95}
    _maybe_set_seed(inp, seed)
    return inp
```

Update `RotateCameraNode.execute` (nodes_replicate.py:2918) to pass `[image_url]`
instead of `image_url`. Behavior identical.

### 2b. Register the multi-reference edit models

Add to `image_edit_models.py`'s `MODELS`:

```python
def _b_seedream_5_pro_edit(prompt, image_urls, seed, adv):
    inp = {"prompt": prompt, "image_input": list(image_urls),
           "size": _clamp_size(adv.get("size"), {"1K", "2K"}, "2K")}
    if adv.get("aspect_ratio"):
        inp["aspect_ratio"] = adv["aspect_ratio"]   # supports match_input_image
    _maybe_set_seed(inp, seed)
    return inp

def _b_seedream_5_lite_edit(prompt, image_urls, seed, adv):
    inp = {"prompt": prompt, "image_input": list(image_urls),
           "size": _clamp_size(adv.get("size"), {"2K", "3K"}, "2K")}
    if adv.get("aspect_ratio"):
        inp["aspect_ratio"] = adv["aspect_ratio"]
    _maybe_set_seed(inp, seed)
    return inp

def _b_nano_banana_2_edit(prompt, image_urls, seed, adv):
    inp = {"prompt": prompt, "image_input": list(image_urls),
           "resolution": adv.get("size", "2K"), "output_format": "png"}
    _maybe_set_seed(inp, seed)
    return inp
```

`_clamp_size(value, allowed_set, fallback)` is a small new helper added to
`image_edit_models.py` (returns `value` if in `allowed_set`, else `fallback`).

Catalog entries: `seedream-5-pro` (default), `seedream-5-lite`, `nano-banana-2`.
Nano Banana 2 is included because it already accepts a multi-element
`image_input` and gives users a proven alternative.

### 2c. The node

`GenerateFromReferencesNode` in `nodes_replicate.py`:

- **Model**: `IO.Combo.Input("model", options=[…edit ids…], default="seedream-5-pro")`
  — a plain dropdown, matching `EditImageNode`. (No new gallery `kind`/modal is
  built for v1; see "Scoping decisions".)
- **Images**: `image_1` required; `image_2`–`image_6` optional `IO.Image.Input`s.
  The Vue canvas already renders multiple/optional image ports (as
  `RestyleFromImageNode`'s two slots prove).
- **prompt**: multiline string.
- **aspect_ratio**: `IO.Combo` of `SEEDREAM_AR + ["match_input_image"]`, default
  `match_input_image`.
- **size**: `IO.Combo(["1K", "2K", "3K"], default="2K", advanced=True)` — the
  union; each model's builder clamps to its allowed set.
- **seed**: `IO.Int` with `control_after_generate=True`.
- **output**: `IO.Image.Output()`.

`execute`:

```python
async def execute(cls, model, image_1, image_2, image_3, image_4, image_5, image_6,
                  prompt, aspect_ratio, size, seed):
    imgs = [i for i in (image_1, image_2, image_3, image_4, image_5, image_6) if i is not None]
    image_urls = [_image_tensor_to_data_url(t) for t in imgs]
    spec = _IMAGE_EDIT_MODELS_BY_ID[model]
    adv = {"size": size, "aspect_ratio": aspect_ratio}
    input_dict = spec.build_input(prompt, image_urls, int(seed or 0), adv)
    pred = await _run_prediction(spec.replicate_slug, input_dict)
    tensor = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
    return IO.NodeOutput(tensor, ui=save_generation_output(tensor, "generate_from_references"))
```

Register the node in the node list (nodes_replicate.py ~line 5387) and surface it
in the Generators panel (`GeneratorsPanel.vue`) alongside the other image
generators so users can find it.

## Scoping decisions (YAGNI)

- **Plain model dropdown, not a gallery, for the new node.** Building a new
  gallery `kind` + modal + a frontend edit catalog for 3 models isn't warranted
  yet. A follow-up can promote it to a gallery once the edit catalog grows.
- **6 slots, not 10.** Covers real use; keeps the node readable. Seedream Pro's
  10-reference ceiling is documented in a code comment for a future bump.
- **Batch controls on Lite only** (unless Pro's schema confirms them).
- **No changes to the existing edit nodes' semantics.** They stay single-image.

## Testing / verification

- Typecheck the frontend (baseline ~328 errors; no new errors introduced).
- Vite compile-check on `image-models.ts`.
- Restart ComfyUI (bridge/Python not hot-reloaded) and confirm both new
  text-to-image models generate via the "Generate an image" node.
- Drop the new "Generate from references" node, wire 2–3 image sources, and
  confirm a Seedream 5 Pro generation returns an image.
- Confirm `RotateCameraNode` still works after the dispatcher signature change
  (regression check on the one existing consumer).

## Files touched

- `frontend/app/data/image-models.ts` — fix lite, add pro (Part 1).
- `comfy_api_nodes/image_models.py` — fix `_b_seedream_5_lite`, add
  `_b_seedream_5_pro` + registry entry (Part 1).
- `comfy_api_nodes/image_edit_models.py` — generalize signature, add 3 edit
  builders + entries (Part 2).
- `comfy_api_nodes/nodes_replicate.py` — new `GenerateFromReferencesNode`,
  register it, update `RotateCameraNode` call site (Part 2).
- `frontend/app/components/agent/GeneratorsPanel.vue` — surface the new node
  (Part 2).
