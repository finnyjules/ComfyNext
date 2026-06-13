# Enhance Detail Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single Replicate api-node, "Enhance Detail", that adds realistic fine detail to an image in place (no resize) via one of three engines, driven by a single `detail_strength` slider.

**Architecture:** The engine→Replicate-input mapping is a pure function `build_enhance_input()` in the dependency-light `comfy_api_nodes/replicate_refs.py` (CI-unit-testable, no torch). `EnhanceDetailNode` in `comfy_api_nodes/nodes_replicate.py` is a thin wrapper: tensor→data-url, call the pure builder, `_run_prediction`, decode. Frontend per-engine advanced-widget gating mirrors the existing `UpscaleImageNode` map in `ComfyNode.vue`.

**Tech Stack:** Python (ComfyUI custom api-node, `comfy_api.latest.IO` schema), pytest (`tests-unit/`), Vue 3 / TypeScript (Nuxt frontend).

---

## Reference facts (verified — do not re-derive)

**Engines & slugs:**
- Creative (default): `philz1337x/clarity-upscaler`, in place via `scale_factor: 1.0`.
- Faithful: `topazlabs/image-upscale`, enhance-only via `upscale_factor: "None"`.
- Diffusion Refine: `cjwbw/supir` with `model_name: "SUPIR-v0Q"`, `use_llava: false`, `upscale: 1`.

**`detail_strength` (0–1, default 0.4) mapping:**
- Creative → Clarity `creativity = 0.1 + detail_strength * 0.5` (→ 0.1–0.6).
- Diffusion Refine → SUPIR `s_cfg = 3.0 + detail_strength * 5.0` (→ 3.0–8.0; SUPIR allows 1–20).
- Faithful → no-op (Topaz has no single strength dial).

**SUPIR input fields (from Cog `predict.py`):** `image`, `model_name`, `upscale`, `edm_steps` (1–500, default 50), `use_llava` (default true → we force false), `a_prompt` (positive), `n_prompt` (negative), `s_cfg` (1–20, default 7.5), `s_stage2` (default 1.0), `seed`.

**Shared plumbing in `nodes_replicate.py`:** `_image_tensor_to_data_url` (:131), `_run_prediction` (:152), `_first_output_url` (imported from `replicate_refs`), `download_url_to_image_tensor`.

**Positional-widget rule:** widget values are saved positionally. This is a brand-new node, so author the order once as specified; any *future* additions must be appended at the END. `seed` requires `control_after_generate=True` and must come before any input that depends on stable positions.

---

## Task 1: Pure engine-input builder + unit tests

**Files:**
- Modify: `comfy_api_nodes/replicate_refs.py` (append new function near the other pure helpers)
- Test: `tests-unit/comfy_api_test/enhance_detail_test.py` (create)

- [ ] **Step 1: Write the failing tests**

Create `tests-unit/comfy_api_test/enhance_detail_test.py`:

```python
"""Unit tests for the Enhance Detail engine→Replicate-input mapping.

Pure logic: given a chosen engine, an image URL, a prompt, a detail_strength,
and per-engine advanced params, produce the (slug, input_dict) that will be
sent to Replicate. No network, no torch — lives in replicate_refs so it stays
importable in CI.
"""
import pytest

from comfy_api_nodes import replicate_refs as rr

IMG = "data:image/png;base64,AAAA"


def test_creative_uses_clarity_in_place():
    slug, body = rr.build_enhance_input(
        "Creative", image_url=IMG, prompt="hi", detail_strength=0.4,
    )
    assert slug == "philz1337x/clarity-upscaler"
    assert body["image"] == IMG
    assert body["prompt"] == "hi"
    assert body["scale_factor"] == 1.0          # strictly in place
    assert body["creativity"] == pytest.approx(0.3)   # 0.1 + 0.4*0.5
    assert body["output_format"] == "png"


def test_creative_creativity_endpoints():
    _, lo = rr.build_enhance_input("Creative", image_url=IMG, prompt="", detail_strength=0.0)
    _, hi = rr.build_enhance_input("Creative", image_url=IMG, prompt="", detail_strength=1.0)
    assert lo["creativity"] == pytest.approx(0.1)
    assert hi["creativity"] == pytest.approx(0.6)


def test_creative_seed_omitted_when_zero_and_sent_when_positive():
    _, no_seed = rr.build_enhance_input("Creative", image_url=IMG, prompt="", detail_strength=0.4, seed=0)
    _, seeded = rr.build_enhance_input("Creative", image_url=IMG, prompt="", detail_strength=0.4, seed=7)
    assert "seed" not in no_seed
    assert seeded["seed"] == 7


def test_faithful_uses_topaz_enhance_only():
    slug, body = rr.build_enhance_input(
        "Faithful", image_url=IMG, prompt="ignored", detail_strength=0.9,
        topaz_enhance_model="High Fidelity V2", topaz_subject_detection="Foreground",
        topaz_output_format="jpg",
    )
    assert slug == "topazlabs/image-upscale"
    assert body["upscale_factor"] == "None"      # enhance only, no resize
    assert body["enhance_model"] == "High Fidelity V2"
    assert body["subject_detection"] == "Foreground"
    assert body["output_format"] == "jpg"
    assert "prompt" not in body                  # Faithful ignores prompt
    assert "scale_factor" not in body


def test_diffusion_refine_uses_supir_v0q_no_llava():
    slug, body = rr.build_enhance_input(
        "Diffusion Refine", image_url=IMG, prompt="portrait", detail_strength=0.4,
        supir_edm_steps=40,
    )
    assert slug == "cjwbw/supir"
    assert body["model_name"] == "SUPIR-v0Q"
    assert body["use_llava"] is False
    assert body["upscale"] == 1                  # strictly in place
    assert body["a_prompt"] == "portrait"
    assert body["edm_steps"] == 40
    assert body["s_cfg"] == pytest.approx(5.0)   # 3.0 + 0.4*5.0


def test_diffusion_refine_s_cfg_endpoints_stay_in_range():
    _, lo = rr.build_enhance_input("Diffusion Refine", image_url=IMG, prompt="", detail_strength=0.0)
    _, hi = rr.build_enhance_input("Diffusion Refine", image_url=IMG, prompt="", detail_strength=1.0)
    assert lo["s_cfg"] == pytest.approx(3.0)
    assert hi["s_cfg"] == pytest.approx(8.0)
    assert 1.0 <= lo["s_cfg"] <= 20.0 and 1.0 <= hi["s_cfg"] <= 20.0


def test_unknown_engine_raises():
    with pytest.raises(ValueError):
        rr.build_enhance_input("Nope", image_url=IMG, prompt="", detail_strength=0.4)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/enhance_detail_test.py -v`
Expected: FAIL — `AttributeError: module 'comfy_api_nodes.replicate_refs' has no attribute 'build_enhance_input'`.

- [ ] **Step 3: Implement `build_enhance_input` in `replicate_refs.py`**

Append to `comfy_api_nodes/replicate_refs.py` (after the existing helpers):

```python
# --------------------------------------------------------------------------- #
# Enhance Detail — engine → Replicate-input mapping
#
# Pure: turns a chosen engine + one universal `detail_strength` knob + per-engine
# advanced params into the (slug, input_dict) for a billable Replicate call.
# Kept here (no torch) so it stays unit-testable in CI. The node wrapper in
# nodes_replicate.py only adds tensor→data-url and the network round-trip.
# --------------------------------------------------------------------------- #

ENHANCE_ENGINES = ["Creative", "Faithful", "Diffusion Refine"]

# Clarity default style prompt, reused so the node and tests agree.
_ENHANCE_CLARITY_DEFAULT_PROMPT = "masterpiece, best quality, highres"


def build_enhance_input(
    model: str,
    *,
    image_url: str,
    prompt: str,
    detail_strength: float,
    # Creative (Clarity) advanced
    resemblance: float = 0.6,
    negative_prompt: str = "(worst quality, low quality, normal quality:2)",
    num_inference_steps: int = 18,
    seed: int = 0,
    # Faithful (Topaz) advanced
    topaz_enhance_model: str = "Standard V2",
    topaz_subject_detection: str = "None",
    topaz_output_format: str = "png",
    # Diffusion Refine (SUPIR) advanced
    supir_edm_steps: int = 50,
) -> tuple[str, dict]:
    """Map an Enhance Detail engine + detail_strength to (replicate_slug, input_dict).

    All three engines run *in place* (no resize):
      Creative → clarity-upscaler at scale_factor 1.0
      Faithful → topaz image-upscale in enhance-only mode (upscale_factor "None")
      Diffusion Refine → SUPIR-v0Q at upscale 1, LLaVA captioning disabled
    """
    if model == "Creative":
        body = {
            "image": image_url,
            "prompt": prompt,
            "scale_factor": 1.0,
            "creativity": 0.1 + float(detail_strength) * 0.5,
            "resemblance": float(resemblance),
            "negative_prompt": negative_prompt,
            "num_inference_steps": int(num_inference_steps),
            "output_format": "png",
        }
        if seed and seed > 0:
            body["seed"] = int(seed)
        return "philz1337x/clarity-upscaler", body

    if model == "Faithful":
        return "topazlabs/image-upscale", {
            "image": image_url,
            "enhance_model": topaz_enhance_model,
            "upscale_factor": "None",          # enhance only, never resize
            "subject_detection": topaz_subject_detection,
            "output_format": topaz_output_format,
        }

    if model == "Diffusion Refine":
        body = {
            "image": image_url,
            "model_name": "SUPIR-v0Q",
            "use_llava": False,                # avoid the slow LLaVA captioning pass
            "upscale": 1,                      # strictly in place
            "a_prompt": prompt,
            "s_cfg": 3.0 + float(detail_strength) * 5.0,
            "edm_steps": int(supir_edm_steps),
        }
        if seed and seed > 0:
            body["seed"] = int(seed)
        return "cjwbw/supir", body

    raise ValueError(f"Unknown enhance model: {model}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/enhance_detail_test.py -v`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add comfy_api_nodes/replicate_refs.py tests-unit/comfy_api_test/enhance_detail_test.py
git commit -m "feat(enhance): pure engine-input builder for Enhance Detail node

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `EnhanceDetailNode` class + registration

**Files:**
- Modify: `comfy_api_nodes/nodes_replicate.py` (add class after `UpscaleImageNode`, ends ~:3067; add to `get_node_list()` at ~:4725)

- [ ] **Step 1: Add the node class**

Insert immediately after the `UpscaleImageNode` class (after line ~3067, before the `RemoveBackgroundNode` section). Note the import: `build_enhance_input` comes from the already-imported `replicate_refs` module — confirm the top of `nodes_replicate.py` imports it (it imports `_first_output_url` from there; add `build_enhance_input` to that same import, or call it as `replicate_refs.build_enhance_input`). Use whichever import style the file already uses for `_first_output_url`.

```python
class EnhanceDetailNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="EnhanceDetailNode",
            display_name="Enhance Detail",
            category="api node/image/Replicate",
            description=(
                "Add realistic fine detail to an image — in place, no resize.\n"
                "• Creative — invents plausible detail, prompt-guided (Clarity, ~$0.05–0.20)\n"
                "• Faithful — cleans & sharpens, no hallucination (Topaz, ~$0.05)\n"
                "• Diffusion Refine — SDXL prior re-render for max realism (SUPIR, ~$0.10–0.20)\n"
                "Detail strength drives the active engine. Prompt is used by "
                "Creative & Diffusion Refine. To also enlarge, use the Upscale node."
            ),
            inputs=[
                IO.Combo.Input("model", options=ENHANCE_ENGINES, default="Creative",
                               tooltip="Engine. Creative invents detail; Faithful stays true; "
                                       "Diffusion Refine re-renders for max realism."),
                IO.Image.Input("image"),
                IO.String.Input("prompt", multiline=True,
                                default="masterpiece, best quality, highres",
                                tooltip="Style prompt (Creative & Diffusion Refine). Ignored by Faithful."),
                IO.Float.Input("detail_strength", default=0.4, min=0.0, max=1.0, step=0.05,
                               display_mode=IO.NumberDisplay.slider,
                               tooltip="How much new detail to add. Drives the active engine. "
                                       "Ignored by Faithful (auto)."),
                # --- Creative (Clarity) advanced ---
                IO.Float.Input("resemblance", default=0.6, min=0.0, max=3.0, step=0.05, advanced=True,
                               tooltip="(Creative) Higher = stays closer to the input."),
                IO.String.Input("negative_prompt", default="(worst quality, low quality, normal quality:2)",
                                advanced=True, tooltip="(Creative) What to avoid."),
                IO.Int.Input("num_inference_steps", default=18, min=10, max=50, advanced=True,
                             tooltip="(Creative) More steps = more detail, slower."),
                # control_after_generate=True REQUIRED so the Vue bridge reserves the
                # seed-control slot in widgets_values (same caveat as UpscaleImageNode).
                IO.Int.Input("seed", default=0, min=0, max=0xFFFFFFFF,
                             control_after_generate=True,
                             tooltip="0 = random. Used by Creative & Diffusion Refine."),
                # --- Faithful (Topaz) advanced ---
                IO.Combo.Input("topaz_enhance_model",
                               options=["Standard V2", "Low Resolution V2", "CGI",
                                        "High Fidelity V2", "Text Refine"],
                               default="Standard V2", advanced=True,
                               tooltip="(Faithful) Enhancement model."),
                IO.Combo.Input("topaz_subject_detection", options=["None", "All", "Foreground", "Background"],
                               default="None", advanced=True,
                               tooltip="(Faithful) Detect & prioritize subjects."),
                IO.Combo.Input("topaz_output_format", options=["png", "jpg"], default="png", advanced=True,
                               tooltip="(Faithful) Output image format."),
                # --- Diffusion Refine (SUPIR) advanced ---
                IO.Int.Input("supir_edm_steps", default=50, min=10, max=200, advanced=True,
                             tooltip="(Diffusion Refine) Sampling steps. More = more detail, slower."),
            ],
            outputs=[IO.Image.Output()],
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.10,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, model, image, prompt, detail_strength,
                      resemblance=0.6,
                      negative_prompt="(worst quality, low quality, normal quality:2)",
                      num_inference_steps=18, seed=0,
                      topaz_enhance_model="Standard V2", topaz_subject_detection="None",
                      topaz_output_format="png", supir_edm_steps=50):
        img_url = _image_tensor_to_data_url(image)
        slug, input_dict = build_enhance_input(
            model,
            image_url=img_url, prompt=prompt, detail_strength=detail_strength,
            resemblance=resemblance, negative_prompt=negative_prompt,
            num_inference_steps=num_inference_steps, seed=seed,
            topaz_enhance_model=topaz_enhance_model,
            topaz_subject_detection=topaz_subject_detection,
            topaz_output_format=topaz_output_format,
            supir_edm_steps=supir_edm_steps,
        )
        pred = await _run_prediction(slug, input_dict)
        tensor = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(tensor)
```

- [ ] **Step 2: Register the node**

In `ReplicateExtension.get_node_list()` (~:4708–4778), add a line in the use-case nodes section beside `UpscaleImageNode` (~:4725):

```python
            UpscaleImageNode,           # Upscale an image · Clarity
            EnhanceDetailNode,          # Enhance Detail · Clarity / Topaz / SUPIR
```

- [ ] **Step 3: Verify the module imports & node registers**

Run: `.venv/bin/python -c "from comfy_api_nodes import nodes_replicate as n; ext=n.ReplicateExtension(); names=[c.define_schema().node_id for c in ext.get_node_list()]; print('EnhanceDetailNode' in names)"`
Expected: prints `True`. (If `get_node_list` is async or differently named, adjust to the file's actual signature — confirm by reading `nodes_replicate.py:4708` first.)

- [ ] **Step 4: Verify the existing unit tests still pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/ -v`
Expected: PASS (including Task 1's tests).

- [ ] **Step 5: Commit**

```bash
git add comfy_api_nodes/nodes_replicate.py
git commit -m "feat(enhance): EnhanceDetailNode (Clarity/Topaz/SUPIR) + register

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend per-engine widget gating

**Files:**
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue` (gating map ~:330–349; dispatcher ~:295)

- [ ] **Step 1: Read the existing gating to match the exact shape**

Read `frontend/app/components/vue-canvas/ComfyNode.vue:290-370`. Confirm the `MODEL_GATED_WIDGETS` object (the `UpscaleImageNode: { ... }` map), the dispatcher object that holds the `UpscaleImageNode: (name, values, defs) => isVisibleForModel(...)` line, and the `isVisibleForModel` signature. Match their exact formatting.

- [ ] **Step 2: Add the `EnhanceDetailNode` gating map**

In `MODEL_GATED_WIDGETS`, immediately after the `UpscaleImageNode: { ... }` block, add:

```typescript
  EnhanceDetailNode: {
    prompt:                  ['Creative', 'Diffusion Refine'],
    resemblance:             'Creative',
    negative_prompt:         'Creative',
    num_inference_steps:     'Creative',
    seed:                    ['Creative', 'Diffusion Refine'],
    topaz_enhance_model:     'Faithful',
    topaz_subject_detection: 'Faithful',
    topaz_output_format:     'Faithful',
    supir_edm_steps:         'Diffusion Refine',
  },
```

(Note: `detail_strength` is intentionally absent — it's the universal knob and must always show. `image` and `model` are core inputs, also always shown.)

- [ ] **Step 3: Add the dispatcher entry**

Beside the `UpscaleImageNode: (name, values, defs) => isVisibleForModel('UpscaleImageNode', name, values, defs),` line (~:295), add:

```typescript
  EnhanceDetailNode: (name, values, defs) =>
    isVisibleForModel('EnhanceDetailNode', name, values, defs),
```

- [ ] **Step 4: Typecheck / lint the frontend**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | head -30` (or the project's typecheck script if one exists — check `frontend/package.json` "scripts").
Expected: no new errors referencing `ComfyNode.vue`. (Pre-existing unrelated errors are acceptable; the goal is no *new* ones from this change.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/ComfyNode.vue
git commit -m "feat(enhance): per-engine widget gating for EnhanceDetailNode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Manual in-browser verification

No automated harness exercises live Replicate api-nodes (network + billable). This is the acceptance gate, following the app's manual-verify norm for sibling nodes. Requires a valid Replicate token configured (same as other Replicate nodes).

**Files:** none (verification only).

- [ ] **Step 1: Start ComfyUI and the frontend**

Per CLAUDE.md (kill, don't restart, to reload):
- ComfyUI: `.venv/bin/python main.py --listen 127.0.0.1 --port 8188`
- Frontend: `cd frontend && npm run dev`

- [ ] **Step 2: Verify node presence & default widget visibility**

Add the "Enhance Detail" node to the canvas. Confirm:
- It appears under api node/image/Replicate.
- Default `model` = **Creative**.
- Visible widgets: `model`, `image`, `prompt`, `detail_strength`, and the Creative advanced set (`resemblance`, `negative_prompt`, `num_inference_steps`, `seed`).
- Topaz and SUPIR widgets are hidden.

- [ ] **Step 3: Verify gating reacts to engine switch**

Switch `model` → **Faithful**: only `topaz_*` advanced widgets show; `prompt` hides; `detail_strength` still shows.
Switch `model` → **Diffusion Refine**: `prompt`, `seed`, `supir_edm_steps` show; Topaz/Clarity advanced hide; `detail_strength` still shows.

- [ ] **Step 4: Run each engine on a sample generation**

Feed a generated image into the node. For each of Creative, Faithful, Diffusion Refine:
- Run it.
- Confirm the **output dimensions equal the input** (strictly in place).
- Confirm the result **saves as a durable asset** in the Assets panel (the `save_generation_output` / durable-asset path the other generators use).

- [ ] **Step 5: Verify `detail_strength` has visible effect**

With Creative (then Diffusion Refine): run at `detail_strength` 0.1 vs 0.9 on the same input; confirm the high value visibly adds more detail. (Faithful: confirm the slider being moved does not change output — it's a documented no-op.)

- [ ] **Step 6: Report results**

Summarize per-engine: ran ✓/✗, dimensions preserved ✓/✗, saved as asset ✓/✗, strength effect ✓/✗. If any engine errors, capture the Replicate error message (likely a field-name or value mismatch) and fix the corresponding branch in `build_enhance_input` (Task 1), re-running its unit tests before re-verifying.

---

## Self-review notes

- **Spec coverage:** node (T2) · three engines + in-place enforcement (T1) · single detail_strength mapping (T1) · advanced inputs + positional/seed discipline (T2) · frontend gating mirroring Upscale (T3) · all-Replicate, no Magnific, no enlarge, canvas-only (T1/T2 by construction) · testing (T1 unit + T4 manual). No spec requirement is unmapped.
- **Type/name consistency:** `build_enhance_input` signature, `ENHANCE_ENGINES`, engine labels ("Creative"/"Faithful"/"Diffusion Refine"), and widget names are identical across T1 (impl + tests), T2 (node schema + execute kwargs), and T3 (gating keys).
- **Known assumption to confirm during execution:** `get_node_list()` exact name/async-ness and the `_first_output_url` import style in `nodes_replicate.py` — T2 Step 1/Step 3 instruct reading the file to match. The SUPIR/Clarity/Topaz field names are verified (Clarity/Topaz from the existing `UpscaleImageNode`, SUPIR from Cog `predict.py`); residual risk surfaces as a Replicate error in T4 Step 6 with a fix path.
