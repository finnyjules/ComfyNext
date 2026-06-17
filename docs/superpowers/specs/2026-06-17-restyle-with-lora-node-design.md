# Restyle an Image · Style LoRA — fused node design

**Date:** 2026-06-17
**Status:** Approved (design), pending implementation plan

## Goal

Collapse a proven three-node manual workflow into a single node. Today, to
restyle an image with a trained LoRA style while preserving structure, the user
chains:

1. **Describe an image** (`DescribeImageNode`, Moondream 2) — caption the source.
2. **Generate with a style** (`FluxLoRARemoteNode`, Flux-Dev-LoRA img2img) — paste
   the caption as the prompt, wire the source image in, apply a LoRA. This
   produces a *style-reference* image.
3. **Restyle from an image** (`RestyleFromImageNode`, Nano Banana 2) — content =
   the original source, style = the step-2 image. Structure-preserving restyle.

The trick: a LoRA can't be handed to Nano Banana directly, so steps 1–2
*manufacture* a style-reference image from the LoRA + the source. Step 3 then
paints that style back onto the original with good structure preservation.

The new node, `RestyleWithLoRANode`, performs all three steps internally.

## Decisions (from brainstorming)

- **Style source:** LoRA only — mirrors the current flow exactly.
- **Control surface:** Simple top-level controls + a collapsed advanced section.
- **Intermediate image:** Hidden. The step-2 style-reference image is used
  internally and discarded; only the final image is output and saved to Assets.
- **Output:** Single `IMAGE` output, no debug `info` string.
- **Architecture:** Approach A — a single backend node whose `execute()`
  orchestrates the three Replicate predictions in sequence, reusing the existing
  helpers.

## Node

- **node_id:** `RestyleWithLoRANode`
- **display_name:** "Restyle an Image · Style LoRA"
- **category:** `api node/image/Replicate`
- **is_output_node:** `True` (final image is a leaf result, like
  `RestyleFromImageNode`)
- **price_badge:** ~$0.09/run at 1K (Moondream ~$0.001 + Flux-LoRA ~$0.04 +
  Nano Banana 2 ~$0.05), `approximate: true`. Higher resolutions cost more on the
  Nano Banana stage.

### Inputs

**Top-level (simple):**

| name | type | default | notes |
|------|------|---------|-------|
| `content_image` | Image | — | The image to restyle. Its subject/composition is preserved. |
| `lora_name` | Combo (`lora_picker` widget) | `[None]` | The style LoRA. Options = `folder_paths.get_filename_list("loras") + ["[None]"]`, identical to `FluxLoRARemoteNode`. |
| `style_strength` | Float 0.0–1.0, step 0.05 | 0.5 | Single intuitive slider (see mapping below). Higher = bolder restyle; lower = closer to the original. |
| `resolution` | Combo `1K`/`2K`/`4K` | `1K` | Nano Banana 2 output size. |
| `seed` | Int 0–0xFFFFFFFF | 0 | 0 = random. Applied to the Flux-LoRA and Nano Banana stages. |

**Advanced (`advanced=True`, collapsed):**

| name | type | default | notes |
|------|------|---------|-------|
| `lora_url` | String | "" | Override LoRA source (HF / CivitAI / Replicate ref / direct .safetensors). Wins over `lora_name`. Same semantics as `FluxLoRARemoteNode`. |
| `lora_scale` | Float 0.0–1.5 | 1.0 | LoRA strength on the Flux stage. |
| `flux_prompt_strength` | Float 0.0–1.0 | 0.0 | When > 0, overrides the value derived from `style_strength` for the Flux img2img stage. 0 = use the mapping. |
| `flux_steps` | Int 4–50 | 28 | Flux inference steps. |
| `flux_guidance` | Float 0.0–20.0 | 3.5 | Flux prompt adherence. |
| `describe_prompt` | String (multiline) | "Describe this image in detail." | The question handed to Moondream. |
| `extra_style_direction` | String (multiline) | "" | Appended to the Nano Banana restyle instruction (e.g. "watercolor", "cyberpunk neon"). |
| `output_format` | Combo `png`/`jpg` | `png` | Nano Banana output format. |

### `style_strength` mapping

A single slider drives the two stage knobs that matter:

- Nano Banana `structure_strength = clamp(1.0 − style_strength, 0.0, 1.0)`
  (higher style → less original structure preserved).
- Flux img2img `prompt_strength = 0.5 + 0.4 · style_strength` (range 0.5–0.9).
  Overridden by `flux_prompt_strength` when that advanced field is > 0.

Default `style_strength = 0.5` → `structure_strength = 0.5`, `prompt_strength = 0.7`.

### Output

- A single `IMAGE` (the final restyle).
- Saved to the Assets library via `save_generation_output(tensor, "restyle_lora")`.

## Execution flow

`execute(content_image, lora_name, style_strength, resolution, seed, lora_url="",
lora_scale=1.0, flux_prompt_strength=0.0, flux_steps=28, flux_guidance=3.5,
describe_prompt="Describe this image in detail.", extra_style_direction="",
output_format="png")`:

1. **Encode** the content image once: `content_url = _image_tensor_to_data_url(content_image)`.
2. **Resolve LoRA** + read sidecar metadata via `_read_lora_sidecar(lora_name)`:
   `trigger` and `aesthetic` (used to build the Flux prompt). Resolution of
   trained-model vs external `lora_weights` reuses the existing
   `FluxLoRARemoteNode` logic (extracted helper — see below).
3. **Stage 1 — Describe (Moondream 2):**
   `_run_prediction("lucataco/moondream2", {"image": content_url, "prompt": describe_prompt})`.
   Parse output to text (handles list/str/None as `DescribeImageNode` does). If
   empty, fall back to `"a high quality image"`.
4. **Stage 2 — Flux-LoRA img2img:** build prompt =
   `", ".join(filter(None, [trigger, aesthetic_keywords, caption]))` where
   `aesthetic_keywords` is the keyword tail of the sidecar `aesthetic` field
   (or the whole field if no clear split). Run via the extracted
   `_flux_lora_img2img(...)` helper with `image=content_url`,
   `prompt_strength` (from mapping/override), `lora_scale`, `flux_steps`,
   `flux_guidance`, `seed`. Returns a tensor; convert to a data URL
   (`style_url`) for the next stage. Force RGB (drop alpha) as the existing node
   does.
5. **Stage 3 — Nano Banana 2 restyle:** via the extracted
   `_nano_banana_restyle(...)` helper: `image_input = [content_url, style_url]`,
   instruction built from `_RESTYLE_DEFAULT_PROMPT` + structure clause (keyed on
   the derived `structure_strength`) + `extra_style_direction`, with
   `resolution` and `output_format`. Slug `google/nano-banana-2`.
6. **Finalize:** force RGB, `save_generation_output(final, "restyle_lora")`,
   return `IO.NodeOutput(final)`.

## Refactor (behavior-preserving)

To avoid duplicating ~40 lines of Flux-LoRA resolution and the Nano Banana
instruction builder, extract two internal module-level helpers in
`nodes_replicate.py`:

- `_flux_lora_img2img(*, prompt, content_url, lora_name, lora_url, lora_scale,
  prompt_strength, steps, guidance, seed, cls) -> tensor` — the resolution +
  `_run_prediction` + RGB-force body currently inline in
  `FluxLoRARemoteNode.execute` (img2img path).
- `_nano_banana_restyle(*, content_url, style_url, structure_strength,
  extra_direction, resolution, output_format, seed, model_slug, cls) -> tensor`
  — the Nano Banana branch currently inline in `RestyleFromImageNode.execute`.

`FluxLoRARemoteNode` and `RestyleFromImageNode` are refactored to call these
helpers so behavior is unchanged and the new node shares one source of truth.
The text-to-image path and the IP-Adapter path of those nodes are left as-is.

## Error handling

- Each stage is wrapped so a failure reports which stage failed
  (`f"Restyle stage failed (describe|stylize|restyle): {err}"`).
- Empty/blank Moondream output → fall back to `"a high quality image"` so the
  pipeline still runs.
- Unresolved LoRA (no sidecar, no `lora_url`) raises the same clear message
  `FluxLoRARemoteNode` produces today.
- Server logs note each stage start/finish for progress visibility, since the
  three sequential paid calls take ~30–90s behind one click.

## Frontend

- Add a capability entry in
  `frontend/app/data/node-capabilities.ts`:
  `{ nodeType: 'RestyleWithLoRANode', useCase: 'Restyle an image with your style',
  model: 'Moondream + Flux LoRA + Nano Banana 2', from: 'image', to: 'image' }`.
- Add discoverability entries: `frontend/app/lib/nodeKeywords.ts` (keywords:
  restyle, style, lora, nano banana, transfer) and
  `frontend/app/lib/nodeDescriptions.ts` (one-line description).
- The `lora_picker` widget is already wired via `extra_dict={"comfynext_widget":
  "lora_picker"}`; reuse it on `lora_name`.

## Registration & rollout

- Register `RestyleWithLoRANode` in `ReplicateExtension.get_node_list()`.
- The embedded canvas caches node schemas, so: finalize the input list before
  shipping (avoid post-ship schema churn), and a ComfyUI restart is required to
  register the new node.

## Risks / tradeoffs

- ~3× latency and three paid Replicate calls behind one click. Mitigated by the
  price badge and staged server logs.
- The only change to working code is the two-helper extraction, which is
  behavior-preserving and verified by re-running the existing Flux-LoRA and
  Restyle flows.

## Out of scope (YAGNI)

- Style-by-reference-image or style-by-text-preset inputs (LoRA-only by design).
- Exposing the intermediate style-reference image as an output or asset.
- Selectable per-stage models (Moondream / Flux-Dev-LoRA / Nano Banana 2 are
  fixed). Resolution is the only model-side variability exposed.
