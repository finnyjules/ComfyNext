# Enhance Detail node — design

**Date:** 2026-06-12
**Status:** Approved design, pending implementation plan
**Author:** Claude (brainstormed with Julien)

## Problem

The app can *upscale* images (faithful pixel-doubling) but has no front-and-center
way to **add realistic fine detail / increase photorealism in place**. The capability
exists today only buried inside the multi-model `UpscaleImageNode` — and only if a
user knows the "set scale to 1, raise creativity" trick. We want a dedicated,
one-knob node whose explicit purpose is "make this generation more realistic."

## Goal

A single Replicate api-node, **`EnhanceDetailNode`** (display name **"Enhance Detail"**),
that takes an image and synthesizes/cleans fine detail **without changing its size**.
One prominent `detail_strength` slider drives the active engine; power users keep
per-engine advanced controls.

### Non-goals (YAGNI)

- **No enlargement.** Strictly in-place. Users chain the existing Upscale node if
  they want bigger. (No `upscale`/`scale_factor` input on this node.)
- **No local/diffusion-on-device path.** All engines are cloud via Replicate, matching
  every other generator in the app.
- **No new UI entry points** beyond the canvas node itself (no asset-action button,
  no quick-action). Ships in the api-node menu like Upscale.
- **No Magnific engine.** Magnific runs through ComfyUI's own API (`comfy_api_nodes/apis/magnific`),
  not Replicate; including it would break the all-Replicate consistency. Clarity covers
  the "creative" tier on Replicate.

## Architecture

Sibling to `UpscaleImageNode` in
[`comfy_api_nodes/nodes_replicate.py`](../../../comfy_api_nodes/nodes_replicate.py).
Reuses the existing shared plumbing — no new infrastructure:

- `_run_prediction(slug, input_dict)` — `nodes_replicate.py:152`
- `_image_tensor_to_data_url(image)` — `nodes_replicate.py:131`
- `_first_output_url(pred)` + `download_url_to_image_tensor(...)` — output handling
- Registered by appending the class to `ReplicateExtension.get_node_list()`
  (`nodes_replicate.py:4708-4778`, beside the `UpscaleImageNode` entry at line 4725).

### Engines

`model` combo, ordered cheap → premium, **default `"Creative"`**:

| Engine label       | Replicate slug                  | Role                                              | ~Cost      |
|--------------------|---------------------------------|---------------------------------------------------|------------|
| **Creative** *(default)* | `philz1337x/clarity-upscaler`   | Invents plausible fine detail, prompt-guided      | $0.05–0.20 |
| **Faithful**       | `topazlabs/image-upscale`       | Cleans / sharpens true-to-source, no hallucination| ~$0.05     |
| **Diffusion Refine** | `fermatresearch/magic-image-refiner` | ControlNet-tile img2img re-render for max realism | $0.05–0.10 |

In-place is enforced per engine:
- **Creative (Clarity):** `scale_factor = 1.0`.
- **Faithful (Topaz):** `upscale_factor = "None"` (enhance-only mode).
- **Diffusion Refine (Magic Refiner):** `resolution = "original"`.

> **Diffusion Refine backend — swapped after live verification (2026-06-12).** The
> original design wired SUPIR (`cjwbw/supir`). Live testing showed our request was
> accepted (all fields valid) but the model deployment itself crashes server-side
> (`xFormers wasn't built with CUDA support` — a rotted community deployment). Replaced
> with `fermatresearch/magic-image-refiner`, a maintained ControlNet-tile img2img
> refiner, schema VERIFIED against its Cog `predict.py`
> (github.com/fermatresearch/magic-image-refiner). It keeps the subject (controlnet
> conditioning) while synthesizing new detail. `resolution="original"` keeps it in place;
> `creativity` is the denoise strength; `resemblance` (0.75) is the controlnet conditioning
> scale; `steps` is the sampler step count. Verified: 1024×1024 in → 1024×1024 out, ~156s.

### The `detail_strength` knob (the core UX move)

One `IO.Float.Input("detail_strength", min=0.0, max=1.0, default=0.4, step=0.05,
display_mode=slider)`. The `execute` method maps it to each engine's native knob so the
user never juggles per-model params:

- **Creative (Clarity):** → `creativity`, mapped `0.1 + detail_strength * 0.5` (range 0.1–0.6;
  0.4 default → 0.3, the documented sweet spot). `resemblance` held at a sane default (0.6).
- **Diffusion Refine (Magic Refiner):** → `creativity` (the denoise strength; 1.0 = total
  destruction of the original), mapped `0.15 + detail_strength * 0.45` (range 0.15–0.60;
  0.4 default → 0.33) — a conservative band that adds new detail without losing the
  subject. `resemblance` held at 0.75 (model default).
- **Faithful (Topaz):** Topaz enhance has no single strength dial → slider is a **no-op**;
  its tooltip says "Ignored by Faithful (auto)."

> **Resolved & verified:** all three engines confirmed via a live money-path run
> (2026-06-12) — input fields accepted, output dimensions preserved. No remaining
> schema uncertainty.

### Inputs (positional widget order — append-only discipline)

`UpscaleImageNode`'s comment block warns that widget values are **positional**; inserting
mid-list scrambles saved values on existing nodes. This is a **new** node so we author the
order freely once, but the same rule applies to any future additions: append at the end.

Prominent inputs (in order):
1. `model` — Combo `["Creative", "Faithful", "Diffusion Refine"]`, default `"Creative"`.
2. `image` — Image.
3. `prompt` — String, multiline, default `"masterpiece, best quality, highres"`.
   Used by Creative + Diffusion Refine; ignored by Faithful.
4. `detail_strength` — Float slider 0–1, default 0.4.

Advanced inputs (`advanced=True`, frontend-gated to their engine):
- **Creative:** `resemblance` (0–3, default 0.6), `negative_prompt`, `num_inference_steps`
  (10–50, default 18), `seed` (`control_after_generate=True`).
- **Faithful:** `topaz_enhance_model` (Standard V2 / Low Resolution V2 / CGI /
  High Fidelity V2 / Text Refine), `topaz_subject_detection` (None / All / Foreground /
  Background), `topaz_output_format` (png / jpg).
- **Diffusion Refine:** `refine_steps` (10–50, default 20).

`seed` carries the same `control_after_generate=True` requirement and end-of-list caveat
documented on `UpscaleImageNode` (the Vue bridge only reserves the seed-control slot when
the flag is set).

Output: single `IO.Image.Output()`.
Price badge: `~$0.10` approximate (`IO.PriceBadge`, same form as Upscale).

### `execute` dispatch

```
img_url = _image_tensor_to_data_url(image)
if model == "Creative":
    input_dict = { image, prompt, scale_factor: 1.0,
                   creativity: 0.1 + detail_strength*0.5, resemblance,
                   negative_prompt, num_inference_steps, output_format: "png" }
    if seed > 0: input_dict["seed"] = seed
    slug = "philz1337x/clarity-upscaler"
elif model == "Faithful":
    input_dict = { image, enhance_model: topaz_enhance_model,
                   upscale_factor: "None", subject_detection: topaz_subject_detection,
                   output_format: topaz_output_format }
    slug = "topazlabs/image-upscale"
elif model == "Diffusion Refine":
    input_dict = { image, resolution: "original", prompt,
                   creativity: 0.15 + detail_strength*0.45, resemblance: 0.75,
                   steps: refine_steps }
    if seed > 0: input_dict["seed"] = seed
    slug = "fermatresearch/magic-image-refiner"
pred = await _run_prediction(slug, input_dict)
return IO.NodeOutput(await download_url_to_image_tensor(_first_output_url(pred), cls=cls))
```

### Frontend widget gating

Mirror the existing per-model gating in
[`frontend/app/components/vue-canvas/ComfyNode.vue`](../../../frontend/app/components/vue-canvas/ComfyNode.vue):

- Add an `EnhanceDetailNode` entry to the `MODEL_GATED_WIDGETS` map (alongside
  `UpscaleImageNode` at lines 330-349), mapping each advanced widget → its engine
  label (string) or labels (array):
  ```
  EnhanceDetailNode: {
    prompt:                  ['Creative', 'Diffusion Refine'],
    resemblance:             'Creative',
    negative_prompt:         'Creative',
    num_inference_steps:     'Creative',
    seed:                    ['Creative', 'Diffusion Refine'],
    topaz_enhance_model:     'Faithful',
    topaz_subject_detection: 'Faithful',
    topaz_output_format:     'Faithful',
    refine_steps:            'Diffusion Refine',
  }
  ```
- Add the dispatcher line beside `UpscaleImageNode` at `ComfyNode.vue:295`:
  ```
  EnhanceDetailNode: (name, values, defs) =>
    isVisibleForModel('EnhanceDetailNode', name, values, defs),
  ```
- `detail_strength` is **not** gated (always visible — it's the universal knob).
  `isVisibleForModel` (lines 356-366) keys off the node's `model` input value, so no new
  mechanism is needed.

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `EnhanceDetailNode` class | Schema + per-engine input mapping + dispatch | `_run_prediction`, `_image_tensor_to_data_url`, `_first_output_url`, `download_url_to_image_tensor` |
| `get_node_list()` entry | Make ComfyUI register the node | the class |
| `ComfyNode.vue` gating entry | Show only the active engine's advanced widgets | node `model` widget value |

Each is independently understandable and changeable: the engine mapping lives entirely in
`execute`; the gating is a declarative map keyed by node_id + widget name.

## Error handling

- Unknown `model` → `raise ValueError(f"Unknown enhance model: {model}")` (matches
  `UpscaleImageNode`).
- Replicate failures propagate through `_run_prediction` exactly as the sibling node —
  no new handling.
- `seed` only sent when `> 0` (Creative), preserving the random-by-default behavior.

## Testing

- **Unit (CI):** `build_enhance_input()` is pure (no torch/network), unit-tested in
  `tests-unit/comfy_api_test/enhance_detail_test.py` — 7 cases covering all three engines,
  the strength curves, and the seed/unknown-engine edges.
- **Live money-path (done 2026-06-12):** a script built each engine's input via the real
  `build_enhance_input`, sent a 1024×1024 image to Replicate, and checked the result.
  Creative, Faithful, and Diffusion Refine all returned 1024×1024 (in place) with visible
  detail changes; the SUPIR original was caught here as broken and swapped (see Engines note).
- **Manual / in-browser (remaining, per app norm):** drop the node, confirm advanced widgets
  show/hide as `model` changes, and that results save as durable assets in the Assets panel.

## Open implementation tasks (carried to the plan)

1. ~~Confirm Diffusion Refine backend + field names~~ — **done** (SUPIR broken on Replicate;
   swapped to `fermatresearch/magic-image-refiner`, schema verified against its Cog `predict.py`).
2. ~~Decide the `detail_strength` curve~~ — **done** (`creativity = 0.15 + strength*0.45`).
3. ~~Extract the pure CI-testable `build_enhance_input()`, author the node, register it,
   add frontend gating, verify all three engines~~ — **done** (live-verified 2026-06-12).
   Remaining: in-browser widget-gating + durable-asset spot check.
