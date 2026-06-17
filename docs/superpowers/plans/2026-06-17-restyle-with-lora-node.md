# Restyle an Image · Style LoRA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single `RestyleWithLoRANode` that fuses the manual three-step workflow (Moondream describe → Flux-Dev-LoRA img2img → Nano Banana 2 restyle) into one node: content image + style LoRA in, final restyled image out.

**Architecture:** A new backend node in `comfy_api_nodes/nodes_replicate.py` whose `execute()` runs the three Replicate predictions in sequence. All decision logic that can be tested without torch/network (LoRA resolution, the `style_strength` mapping, the Flux prompt builder, the Nano Banana instruction builder) is extracted into the dependency-light `comfy_api_nodes/replicate_refs.py` and unit-tested. The two existing nodes (`FluxLoRARemoteNode`, `RestyleFromImageNode`) are refactored to call the same extracted helpers — behavior-preserving — so there is one source of truth.

**Tech Stack:** Python (ComfyUI custom node, `IO.ComfyNode` schema), pytest (`tests-unit/`), Nuxt 4 / TypeScript frontend registries.

---

## Why the test boundary is where it is

`comfy_api_nodes/nodes_replicate.py` cannot be imported under plain pytest — it pulls in `server`, which only resolves when launched via `main.py` (see the import comment at `nodes_replicate.py:64-83`). So:

- **Pure logic → `replicate_refs.py`** (dependency-light, already unit-tested in `tests-unit/comfy_api_test/replicate_refs_test.py`). These tasks use real TDD.
- **Node `execute()` orchestration + the refactors inside `nodes_replicate.py`** cannot run in CI pytest. They are verified by (a) a schema/import smoke check run with the project's `.venv/bin/python`, and (b) a real in-app run. This matches the existing project pattern — the current nodes have no `execute()` unit tests either.

Run unit tests with:
```bash
.venv/bin/python -m pytest tests-unit/comfy_api_test/replicate_refs_test.py -v
```

## File structure

- **Modify** `comfy_api_nodes/replicate_refs.py` — add 5 pure helpers + 1 constant:
  `resolve_flux_lora_plan`, `restyle_style_strength_to_knobs`, `aesthetic_to_keywords`,
  `build_flux_style_prompt`, `build_restyle_instruction`, `RESTYLE_DEFAULT_PROMPT`.
- **Modify** `tests-unit/comfy_api_test/replicate_refs_test.py` — add tests for all 5 helpers.
- **Modify** `comfy_api_nodes/nodes_replicate.py` — import the new helpers; refactor
  `FluxLoRARemoteNode.execute` and `RestyleFromImageNode.execute` to use them; add the new
  `RestyleWithLoRANode`; register it in `ReplicateExtension.get_node_list`.
- **Modify** `frontend/app/data/node-capabilities.ts` — capability entry.
- **Modify** `frontend/app/lib/nodeKeywords.ts` — search keywords.
- **Modify** `frontend/app/lib/nodeDescriptions.ts` — one-line description.

---

## Task 1: Pure helper `resolve_flux_lora_plan` + refactor `FluxLoRARemoteNode`

Extracts the trained-model-vs-external-weights branching (currently inline at
`nodes_replicate.py:483-521`) into a pure, testable function. The network step
(`_autodetect_huggingface`) stays in the node and is applied after.

**Files:**
- Modify: `comfy_api_nodes/replicate_refs.py`
- Test: `tests-unit/comfy_api_test/replicate_refs_test.py`
- Modify: `comfy_api_nodes/nodes_replicate.py:483-521` (FluxLoRARemoteNode.execute)

- [ ] **Step 1: Write the failing tests**

Append to `tests-unit/comfy_api_test/replicate_refs_test.py` (reuses the existing
`loras_dir` fixture and `_write_sidecar` helper already in that file):

```python
# --------------------------------------------------------------------------- #
# resolve_flux_lora_plan — trained-model vs external-weights decision (pure)
# --------------------------------------------------------------------------- #

def test_flux_plan_replicate_ref_url_is_trained_model():
    plan = rr.resolve_flux_lora_plan("[None]", "owner/model:abc123")
    assert plan == {"trained_model": "owner/model", "lora_ref": None}

def test_flux_plan_sidecar_trained_model(loras_dir):
    _write_sidecar(loras_dir, "Style.safetensors",
                   {"replicate_model": "finny/jules-style:deadbeef"})
    plan = rr.resolve_flux_lora_plan("Style.safetensors", "")
    assert plan["trained_model"] == "finny/jules-style"
    assert plan["lora_ref"] is None

def test_flux_plan_sidecar_external_weights(loras_dir):
    _write_sidecar(loras_dir, "Ext.safetensors",
                   {"replicate_url": "https://example.com/lora.safetensors"})
    plan = rr.resolve_flux_lora_plan("Ext.safetensors", "")
    assert plan["trained_model"] is None
    assert plan["lora_ref"] == "https://example.com/lora.safetensors"

def test_flux_plan_external_url_overrides_name(loras_dir):
    _write_sidecar(loras_dir, "Ext.safetensors",
                   {"replicate_url": "https://example.com/from-name.safetensors"})
    plan = rr.resolve_flux_lora_plan("Ext.safetensors", "huggingface.co/owner/repo")
    assert plan["trained_model"] is None
    # lora_url wins over the sidecar-derived ref
    assert "owner/repo" in plan["lora_ref"]

def test_flux_plan_no_lora_resolves_nothing():
    plan = rr.resolve_flux_lora_plan("[None]", "")
    assert plan == {"trained_model": None, "lora_ref": None}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/replicate_refs_test.py -k flux_plan -v`
Expected: FAIL with `AttributeError: module ... has no attribute 'resolve_flux_lora_plan'`

- [ ] **Step 3: Implement the helper**

Add to `comfy_api_nodes/replicate_refs.py` (after `_normalize_lora_ref`, near line 230).
This mirrors the original branching exactly — `if replicate-ref → trained`, `elif no
url → sidecar trained model`, then `lora_ref = _normalize_lora_ref(url) or
_resolve_lora_url(name)`:

```python
def resolve_flux_lora_plan(lora_name: str, lora_url: str) -> dict:
    """Decide how to run a Flux LoRA: a baked-in trained model run directly, or
    flux-dev-lora with external ``lora_weights``. Pure (no network) so it stays
    unit-testable; the caller still applies ``_autodetect_huggingface`` to
    ``lora_ref`` before use. Returns ``{"trained_model": str|None,
    "lora_ref": str|None}`` with at most one set.
    """
    lora_url = (lora_url or "").strip()
    if lora_url and _is_replicate_model_ref(lora_url):
        return {"trained_model": _bare_owner_model(lora_url), "lora_ref": None}
    trained_model = _resolve_trained_model(lora_name) if not lora_url else None
    if trained_model:
        return {"trained_model": trained_model, "lora_ref": None}
    lora_ref = _normalize_lora_ref(lora_url) or _resolve_lora_url(lora_name)
    return {"trained_model": None, "lora_ref": lora_ref}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/replicate_refs_test.py -k flux_plan -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Refactor `FluxLoRARemoteNode.execute` to use the plan**

In `comfy_api_nodes/nodes_replicate.py`, first add `resolve_flux_lora_plan` to the
import block from `replicate_refs` (the `from comfy_api_nodes.replicate_refs import (...)`
list at lines 69-83).

Then replace the branching block at `nodes_replicate.py:483-521`. The current code:

```python
        if lora_url and _is_replicate_model_ref(lora_url):
            trained_model = _bare_owner_model(lora_url)
        elif not lora_url:
            trained_model = _resolve_trained_model(lora_name)
        else:
            trained_model = None

        input_dict: dict = {
            "prompt": full_prompt,
            ...
        }
        if seed and seed > 0:
            input_dict["seed"] = seed

        img2img = image is not None
        if img2img:
            input_dict["image"] = _image_tensor_to_data_url(image)
            input_dict["prompt_strength"] = prompt_strength

        if trained_model:
            model = trained_model
            resolved_lora = trained_model
            input_dict["guidance_scale"] = guidance
            input_dict["lora_scale"] = lora_scale
        else:
            input_dict["guidance"] = guidance
            resolved_lora = _normalize_lora_ref(lora_url) or _resolve_lora_url(lora_name)
            if resolved_lora:
                resolved_lora = await _autodetect_huggingface(resolved_lora)
                input_dict["lora_weights"] = resolved_lora
                input_dict["lora_scale"] = lora_scale
            model = "black-forest-labs/flux-dev-lora"
```

becomes (only the first branch and the `else` ref-resolution change; everything
else stays byte-for-byte):

```python
        plan = resolve_flux_lora_plan(lora_name, lora_url)
        trained_model = plan["trained_model"]

        input_dict: dict = {
            "prompt": full_prompt,
            "aspect_ratio": aspect_ratio,
            "megapixels": megapixels,
            "num_inference_steps": num_inference_steps,
            "num_outputs": 1,
            "output_format": "png",
            "disable_safety_checker": False,
        }
        if seed and seed > 0:
            input_dict["seed"] = seed

        img2img = image is not None
        if img2img:
            input_dict["image"] = _image_tensor_to_data_url(image)
            input_dict["prompt_strength"] = prompt_strength

        if trained_model:
            model = trained_model
            resolved_lora = trained_model
            input_dict["guidance_scale"] = guidance
            input_dict["lora_scale"] = lora_scale
        else:
            input_dict["guidance"] = guidance
            resolved_lora = plan["lora_ref"]
            if resolved_lora:
                resolved_lora = await _autodetect_huggingface(resolved_lora)
                input_dict["lora_weights"] = resolved_lora
                input_dict["lora_scale"] = lora_scale
            model = "black-forest-labs/flux-dev-lora"
```

- [ ] **Step 6: Smoke-check the module still imports and the schema is intact**

Run:
```bash
.venv/bin/python -c "from comfy_api_nodes.nodes_replicate import FluxLoRARemoteNode; \
s=FluxLoRARemoteNode.define_schema(); \
print('OK', s.node_id, [i.id for i in s.inputs])"
```
Expected: prints `OK FluxLoRARemoteNode [...]` with no traceback. (If `server` import
fails outside main.py, note it and defer this check to the in-app verification in
Task 7 — the unit tests in Step 4 already cover the extracted logic.)

- [ ] **Step 7: Commit**

```bash
git add comfy_api_nodes/replicate_refs.py tests-unit/comfy_api_test/replicate_refs_test.py comfy_api_nodes/nodes_replicate.py
git commit -m "refactor(replicate): extract pure resolve_flux_lora_plan, reuse in FluxLoRARemoteNode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `RESTYLE_DEFAULT_PROMPT` + `build_restyle_instruction` + refactor `RestyleFromImageNode`

Extracts the Nano Banana instruction builder (currently inline at
`nodes_replicate.py:2294-2314`) into a pure function.

**Files:**
- Modify: `comfy_api_nodes/replicate_refs.py`
- Test: `tests-unit/comfy_api_test/replicate_refs_test.py`
- Modify: `comfy_api_nodes/nodes_replicate.py:2232-2236` (constant) and `2294-2314` (RestyleFromImageNode.execute)

- [ ] **Step 1: Write the failing tests**

Append to `tests-unit/comfy_api_test/replicate_refs_test.py`:

```python
# --------------------------------------------------------------------------- #
# build_restyle_instruction — Nano Banana instruction builder (pure)
# --------------------------------------------------------------------------- #

def test_restyle_instruction_high_structure_locks_subject():
    out = rr.build_restyle_instruction(0.8)
    assert out.startswith(rr.RESTYLE_DEFAULT_PROMPT)
    assert "exactly as in the first image" in out

def test_restyle_instruction_low_structure_allows_reinterpret():
    out = rr.build_restyle_instruction(0.2)
    assert "loosely reinterpret" in out

def test_restyle_instruction_mid_structure_is_plain():
    out = rr.build_restyle_instruction(0.5)
    assert out == rr.RESTYLE_DEFAULT_PROMPT

def test_restyle_instruction_appends_extra_direction():
    out = rr.build_restyle_instruction(0.5, "watercolor")
    assert out.endswith("Additional style direction: watercolor.")

def test_restyle_instruction_blank_extra_is_ignored():
    out = rr.build_restyle_instruction(0.5, "   ")
    assert out == rr.RESTYLE_DEFAULT_PROMPT
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/replicate_refs_test.py -k restyle_instruction -v`
Expected: FAIL with `AttributeError: ... 'build_restyle_instruction'`

- [ ] **Step 3: Implement the constant + builder**

Add to `comfy_api_nodes/replicate_refs.py`:

```python
RESTYLE_DEFAULT_PROMPT = (
    "Redraw the first image in the visual art style of the second image. "
    "Preserve the first image's composition, subject, pose and layout — "
    "change only the rendering style, colors, texture, lighting and finish."
)


def build_restyle_instruction(structure_strength: float, extra_direction: str = "") -> str:
    """Build the Nano Banana edit instruction from a structure-preservation
    dial. Nano Banana has no numeric structure knob, so the slider is folded
    into explicit language: high = lock the subject, low = free reinterpretation.
    """
    instruction = RESTYLE_DEFAULT_PROMPT
    if structure_strength >= 0.66:
        instruction += (
            " Keep the subject's identity, clothing, pose, framing and"
            " background composition exactly as in the first image —"
            " restyle only colour, texture, lighting and finish; add"
            " nothing and remove nothing."
        )
    elif structure_strength <= 0.33:
        instruction += " You may loosely reinterpret the content while matching the style."
    extra = (extra_direction or "").strip()
    if extra:
        instruction += f" Additional style direction: {extra}."
    return instruction
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/replicate_refs_test.py -k restyle_instruction -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Refactor `RestyleFromImageNode` to use the helper**

In `comfy_api_nodes/nodes_replicate.py`:

(a) Add `RESTYLE_DEFAULT_PROMPT` and `build_restyle_instruction` to the
`from comfy_api_nodes.replicate_refs import (...)` block.

(b) Delete the local constant definition at lines 2232-2236:
```python
_RESTYLE_DEFAULT_PROMPT = (
    "Redraw the first image in the visual art style of the second image. "
    "Preserve the first image's composition, subject, pose and layout — "
    "change only the rendering style, colors, texture, lighting and finish."
)
```
(If any other reference to `_RESTYLE_DEFAULT_PROMPT` exists, replace it with
`RESTYLE_DEFAULT_PROMPT`. Verify with `grep -n _RESTYLE_DEFAULT_PROMPT comfy_api_nodes/nodes_replicate.py` — expect zero hits after this step.)

(c) Replace the instruction-building block in `RestyleFromImageNode.execute`
(lines 2294-2314), which currently reads:
```python
            instruction = _RESTYLE_DEFAULT_PROMPT
            if structure_strength >= 0.66:
                instruction += (
                    " Keep the subject's identity, clothing, pose, framing and"
                    " background composition exactly as in the first image —"
                    " restyle only colour, texture, lighting and finish; add"
                    " nothing and remove nothing."
                )
            elif structure_strength <= 0.33:
                instruction += " You may loosely reinterpret the content while matching the style."
            if guidance:
                instruction += f" Additional style direction: {guidance}."
```
with:
```python
            instruction = build_restyle_instruction(structure_strength, guidance)
```

- [ ] **Step 6: Smoke-check import + schema**

Run:
```bash
.venv/bin/python -c "from comfy_api_nodes.nodes_replicate import RestyleFromImageNode; \
print('OK', RestyleFromImageNode.define_schema().node_id)"
```
Expected: prints `OK RestyleFromImageNode` (or defer per Task 1 Step 6 note).

- [ ] **Step 7: Commit**

```bash
git add comfy_api_nodes/replicate_refs.py tests-unit/comfy_api_test/replicate_refs_test.py comfy_api_nodes/nodes_replicate.py
git commit -m "refactor(replicate): extract build_restyle_instruction, reuse in RestyleFromImageNode

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Pure helper `restyle_style_strength_to_knobs`

The single `style_strength` slider drives two stage knobs.

**Files:**
- Modify: `comfy_api_nodes/replicate_refs.py`
- Test: `tests-unit/comfy_api_test/replicate_refs_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests-unit/comfy_api_test/replicate_refs_test.py`:

```python
# --------------------------------------------------------------------------- #
# restyle_style_strength_to_knobs — single slider -> two stage knobs (pure)
# --------------------------------------------------------------------------- #

def test_style_strength_default_midpoint():
    structure, prompt_strength = rr.restyle_style_strength_to_knobs(0.5)
    assert structure == pytest.approx(0.5)
    assert prompt_strength == pytest.approx(0.7)

def test_style_strength_high_means_bold_restyle():
    structure, prompt_strength = rr.restyle_style_strength_to_knobs(1.0)
    assert structure == pytest.approx(0.0)
    assert prompt_strength == pytest.approx(0.9)

def test_style_strength_low_means_faithful():
    structure, prompt_strength = rr.restyle_style_strength_to_knobs(0.0)
    assert structure == pytest.approx(1.0)
    assert prompt_strength == pytest.approx(0.5)

def test_style_strength_clamps_out_of_range():
    structure, prompt_strength = rr.restyle_style_strength_to_knobs(5.0)
    assert structure == pytest.approx(0.0)
    assert prompt_strength == pytest.approx(0.9)

def test_style_strength_override_wins():
    structure, prompt_strength = rr.restyle_style_strength_to_knobs(0.5, 0.85)
    assert structure == pytest.approx(0.5)   # structure still from style_strength
    assert prompt_strength == pytest.approx(0.85)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/replicate_refs_test.py -k style_strength -v`
Expected: FAIL with `AttributeError: ... 'restyle_style_strength_to_knobs'`

- [ ] **Step 3: Implement the helper**

Add to `comfy_api_nodes/replicate_refs.py`:

```python
def restyle_style_strength_to_knobs(
    style_strength: float, flux_prompt_strength_override: float = 0.0
) -> tuple[float, float]:
    """Map the single user-facing ``style_strength`` (0-1) onto the two stage
    knobs that matter: Nano Banana ``structure_strength`` (inverse) and Flux
    img2img ``prompt_strength`` (0.5-0.9). A positive
    ``flux_prompt_strength_override`` replaces the derived prompt_strength.
    Returns ``(structure_strength, prompt_strength)``.
    """
    s = max(0.0, min(1.0, float(style_strength)))
    structure_strength = max(0.0, min(1.0, 1.0 - s))
    if flux_prompt_strength_override and flux_prompt_strength_override > 0:
        prompt_strength = max(0.0, min(1.0, float(flux_prompt_strength_override)))
    else:
        prompt_strength = 0.5 + 0.4 * s
    return structure_strength, prompt_strength
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/replicate_refs_test.py -k style_strength -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add comfy_api_nodes/replicate_refs.py tests-unit/comfy_api_test/replicate_refs_test.py
git commit -m "feat(replicate): add restyle_style_strength_to_knobs mapping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Pure helpers `aesthetic_to_keywords` + `build_flux_style_prompt`

Builds the Flux img2img prompt from the LoRA sidecar's `trigger` + `aesthetic`
(see `models/loras/Azure_Bloom.json`) plus the Moondream caption.

**Files:**
- Modify: `comfy_api_nodes/replicate_refs.py`
- Test: `tests-unit/comfy_api_test/replicate_refs_test.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests-unit/comfy_api_test/replicate_refs_test.py`:

```python
# --------------------------------------------------------------------------- #
# Flux style prompt construction (pure)
# --------------------------------------------------------------------------- #

def test_aesthetic_prefers_keyword_tail():
    aesthetic = "A long prose description of the look.\n\nwarm florals, fauvist brushwork, cobalt blue"
    assert rr.aesthetic_to_keywords(aesthetic) == "warm florals, fauvist brushwork, cobalt blue"

def test_aesthetic_prose_only_returns_whole():
    aesthetic = "A single prose sentence with no keyword tail"
    assert rr.aesthetic_to_keywords(aesthetic) == aesthetic

def test_aesthetic_empty_returns_empty():
    assert rr.aesthetic_to_keywords("") == ""
    assert rr.aesthetic_to_keywords(None) == ""

def test_build_flux_style_prompt_joins_all_parts():
    out = rr.build_flux_style_prompt(
        "azure_bloom",
        "prose.\n\nwarm florals, cobalt blue",
        "A photo of a woman in a garden.",
    )
    assert out == "azure_bloom, warm florals, cobalt blue, A photo of a woman in a garden."

def test_build_flux_style_prompt_skips_blank_parts():
    out = rr.build_flux_style_prompt("", "", "A cat on a sofa.")
    assert out == "A cat on a sofa."
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/replicate_refs_test.py -k "aesthetic or flux_style_prompt" -v`
Expected: FAIL with `AttributeError: ... 'aesthetic_to_keywords'`

- [ ] **Step 3: Implement the helpers**

Add to `comfy_api_nodes/replicate_refs.py`:

```python
def aesthetic_to_keywords(aesthetic: str) -> str:
    """A LoRA sidecar's ``aesthetic`` field is prose followed by a
    comma-separated keyword tail, split by a blank line. Prefer the keyword
    tail (it steers Flux better than prose); fall back to the whole string when
    there is no comma-separated tail.
    """
    text = (aesthetic or "").strip()
    if not text:
        return ""
    segments = [s.strip() for s in text.split("\n\n") if s.strip()]
    tail = segments[-1] if segments else text
    return tail if "," in tail else text


def build_flux_style_prompt(trigger: str, aesthetic: str, caption: str) -> str:
    """Compose the Flux img2img prompt: LoRA trigger word + the LoRA's aesthetic
    keywords + the Moondream caption of the content image. Blank parts are
    skipped so an external LoRA (no sidecar) still gets a clean caption-only
    prompt.
    """
    parts = [
        (trigger or "").strip(),
        aesthetic_to_keywords(aesthetic),
        (caption or "").strip(),
    ]
    return ", ".join(p for p in parts if p)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/replicate_refs_test.py -k "aesthetic or flux_style_prompt" -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Run the full unit-test file**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/replicate_refs_test.py -v`
Expected: PASS (all pre-existing + 20 new tests).

- [ ] **Step 6: Commit**

```bash
git add comfy_api_nodes/replicate_refs.py tests-unit/comfy_api_test/replicate_refs_test.py
git commit -m "feat(replicate): add Flux style-prompt builders from LoRA sidecar

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: The `RestyleWithLoRANode` node + registration

The orchestrator. Cannot be unit-tested in CI (torch + network); verified by the
schema smoke check here and the real run in Task 7.

**Files:**
- Modify: `comfy_api_nodes/nodes_replicate.py` (add class near `RestyleFromImageNode`, ~line 2350; register in `get_node_list` ~line 2238/4868)

- [ ] **Step 1: Add the imports**

Ensure the `from comfy_api_nodes.replicate_refs import (...)` block now includes
`restyle_style_strength_to_knobs`, `aesthetic_to_keywords` (transitively used),
`build_flux_style_prompt`, `build_restyle_instruction`, `RESTYLE_DEFAULT_PROMPT`,
and `resolve_flux_lora_plan` (added in Tasks 1-4).

- [ ] **Step 2: Add the node class**

Insert after `RestyleFromImageNode` (after its closing `return IO.NodeOutput(...)`,
around line 2345) in `comfy_api_nodes/nodes_replicate.py`:

```python
# =============================================================================
# Use case: Restyle an Image · Style LoRA — fuse describe → flux-lora → nano-banana
# =============================================================================


class RestyleWithLoRANode(IO.ComfyNode):
    """Restyle a content image with a trained style LoRA, structure-preserving.

    Runs the proven three-step pipeline internally:
      1. Moondream 2 captions the content image.
      2. Flux-Dev-LoRA img2img restyles the content, prompted with the LoRA's
         trigger + aesthetic + the caption — producing a style-reference image.
      3. Nano Banana 2 paints that style back onto the original content image,
         preserving structure.
    The intermediate (step-2) image is used internally and discarded; only the
    final image is output and saved to Assets.
    """

    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="RestyleWithLoRANode",
            display_name="Restyle an Image · Style LoRA",
            category="api node/image/Replicate",
            description=(
                "Restyle an image with a trained style LoRA, keeping its "
                "structure. Captions the image (Moondream), restyles it with "
                "your LoRA (Flux Dev), then transfers that look back with Nano "
                "Banana 2. ~$0.09/run at 1K; higher resolutions cost more."
            ),
            inputs=[
                IO.Image.Input("content_image",
                               tooltip="The image to restyle — its subject/composition is kept."),
                IO.Combo.Input(
                    "lora_name",
                    options=folder_paths.get_filename_list("loras") + ["[None]"],
                    default="[None]",
                    tooltip="Your style LoRA (needs a sidecar .json from the cloud trainer).",
                    extra_dict={"comfynext_widget": "lora_picker"},
                ),
                IO.Float.Input("style_strength", default=0.5, min=0.0, max=1.0, step=0.05,
                               tooltip="Higher = bolder restyle (looser structure); "
                                       "lower = stays closer to the original."),
                IO.Combo.Input("resolution", options=["1K", "2K", "4K"], default="1K",
                               tooltip="Nano Banana 2 output resolution — higher costs more."),
                IO.Int.Input("seed", default=0, min=0, max=0xFFFFFFFF,
                             tooltip="0 = random. Applied to the Flux and Nano Banana stages."),
                IO.String.Input("lora_url", default="", multiline=False, advanced=True,
                                tooltip="Override LoRA source (HF / CivitAI / Replicate ref / "
                                        ".safetensors URL). Wins over lora_name."),
                IO.Float.Input("lora_scale", default=1.0, min=0.0, max=1.5, step=0.05,
                               advanced=True, tooltip="LoRA strength on the Flux stage."),
                IO.Float.Input("flux_prompt_strength", default=0.0, min=0.0, max=1.0, step=0.05,
                               advanced=True,
                               tooltip="Override the Flux img2img strength. 0 = derive from "
                                       "style_strength."),
                IO.Int.Input("flux_steps", default=28, min=4, max=50, advanced=True,
                             tooltip="Flux inference steps."),
                IO.Float.Input("flux_guidance", default=3.5, min=0.0, max=20.0, step=0.1,
                               advanced=True, tooltip="Flux prompt adherence."),
                IO.String.Input("describe_prompt", multiline=True,
                                default="Describe this image in detail.",
                                advanced=True, tooltip="What to ask Moondream about the content image."),
                IO.String.Input("extra_style_direction", multiline=True, default="",
                                advanced=True,
                                tooltip="Extra guidance appended to the Nano Banana instruction "
                                        "(e.g. 'watercolor', 'cyberpunk neon')."),
                IO.Combo.Input("output_format", options=["png", "jpg"], default="png", advanced=True),
            ],
            outputs=[IO.Image.Output()],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.09,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, content_image, lora_name, style_strength=0.5,
                      resolution="1K", seed=0, lora_url="", lora_scale=1.0,
                      flux_prompt_strength=0.0, flux_steps=28, flux_guidance=3.5,
                      describe_prompt="Describe this image in detail.",
                      extra_style_direction="", output_format="png"):
        content_url = _image_tensor_to_data_url(content_image)
        structure_strength, prompt_strength = restyle_style_strength_to_knobs(
            style_strength, flux_prompt_strength
        )

        # --- Stage 1: describe the content image (Moondream 2) ---------------
        try:
            pred = await _run_prediction(
                "lucataco/moondream2",
                {"image": content_url, "prompt": describe_prompt},
            )
            out = pred.get("output")
            if isinstance(out, list):
                caption = "".join(str(x) for x in out).strip()
            else:
                caption = str(out or "").strip()
        except Exception as err:
            raise RuntimeError(f"Restyle stage failed (describe): {err}") from err
        if not caption:
            caption = "a high quality image"

        # --- Stage 2: restyle with the LoRA (Flux-Dev-LoRA img2img) ----------
        sidecar = _read_lora_sidecar(lora_name) or {}
        flux_prompt = build_flux_style_prompt(
            sidecar.get("trigger", ""), sidecar.get("aesthetic", ""), caption
        )
        try:
            plan = resolve_flux_lora_plan(lora_name, lora_url)
            flux_input = {
                "prompt": flux_prompt,
                "image": content_url,
                "prompt_strength": prompt_strength,
                "num_inference_steps": flux_steps,
                "num_outputs": 1,
                "output_format": "png",
                "disable_safety_checker": False,
            }
            if seed and seed > 0:
                flux_input["seed"] = seed
            if plan["trained_model"]:
                flux_model = plan["trained_model"]
                flux_input["guidance_scale"] = flux_guidance
                flux_input["lora_scale"] = lora_scale
            else:
                flux_model = "black-forest-labs/flux-dev-lora"
                flux_input["guidance"] = flux_guidance
                lora_ref = plan["lora_ref"]
                if lora_ref:
                    lora_ref = await _autodetect_huggingface(lora_ref)
                    flux_input["lora_weights"] = lora_ref
                    flux_input["lora_scale"] = lora_scale
            flux_pred = await _run_prediction(flux_model, flux_input)
            style_tensor = await download_url_to_image_tensor(
                _first_output_url(flux_pred), cls=cls
            )
            if style_tensor.dim() == 4 and style_tensor.shape[-1] == 4:
                style_tensor = style_tensor[..., :3].contiguous()
            style_url = _image_tensor_to_data_url(style_tensor)
        except Exception as err:
            raise RuntimeError(f"Restyle stage failed (stylize): {err}") from err

        # --- Stage 3: transfer the style back onto the content (Nano Banana 2)
        try:
            instruction = build_restyle_instruction(structure_strength, extra_style_direction)
            nb_input = {
                "prompt": instruction,
                "image_input": [content_url, style_url],
                "output_format": output_format,
                "resolution": resolution,
            }
            nb_pred = await _run_prediction("google/nano-banana-2", nb_input)
            final = await download_url_to_image_tensor(_first_output_url(nb_pred), cls=cls)
            if final.dim() == 4 and final.shape[-1] == 4:
                final = final[..., :3].contiguous()
        except Exception as err:
            raise RuntimeError(f"Restyle stage failed (restyle): {err}") from err

        return IO.NodeOutput(final, ui=save_generation_output(final, "restyle_lora"))
```

- [ ] **Step 3: Register the node**

In `ReplicateExtension.get_node_list` (`nodes_replicate.py`, the "Image — manipulation"
block ~line 4868), add immediately after the `RestyleFromImageNode` line:

```python
            RestyleWithLoRANode,        # Restyle an Image · Style LoRA — describe→flux-lora→nano-banana
```

- [ ] **Step 4: Smoke-check schema & registration**

Run:
```bash
.venv/bin/python -c "
from comfy_api_nodes.nodes_replicate import RestyleWithLoRANode
s = RestyleWithLoRANode.define_schema()
ids = [i.id for i in s.inputs]
assert s.node_id == 'RestyleWithLoRANode'
assert ids[:5] == ['content_image','lora_name','style_strength','resolution','seed'], ids
assert s.is_output_node is True
print('OK', s.node_id, len(ids), 'inputs')
"
```
Expected: `OK RestyleWithLoRANode 13 inputs`. (If `server` import blocks this outside
main.py, defer to Task 7's in-app load — the node will surface or fail visibly there.)

- [ ] **Step 5: Commit**

```bash
git add comfy_api_nodes/nodes_replicate.py
git commit -m "feat(restyle-lora): add RestyleWithLoRANode fusing describe/flux-lora/nano-banana

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend registry wiring

Make the node discoverable in the Generators panel / Get-Started modal.

**Files:**
- Modify: `frontend/app/data/node-capabilities.ts`
- Modify: `frontend/app/lib/nodeKeywords.ts`
- Modify: `frontend/app/lib/nodeDescriptions.ts`

- [ ] **Step 1: Add the capability entry**

In `frontend/app/data/node-capabilities.ts`, in the `// ---------- Image · from an image ----------`
block, add immediately after the `RestyleFromImageNode` line:

```typescript
  { nodeType: 'RestyleWithLoRANode',   useCase: 'Restyle an image with your style', model: 'Moondream + Flux LoRA + Nano Banana 2', from: 'image', to: 'image' },
```

- [ ] **Step 2: Add search keywords**

In `frontend/app/lib/nodeKeywords.ts`, inside the `NODE_KEYWORDS` object, add after the
`RestyleFromImageNode` entry:

```typescript
  RestyleWithLoRANode: [
    'restyle with style', 'restyle with lora', 'apply my style', 'apply lora style',
    'style my image', 'lora restyle', 'restyle lora', 'my style', 'trained style',
  ],
```

- [ ] **Step 3: Add the description**

In `frontend/app/lib/nodeDescriptions.ts`, inside the `NODE_DESCRIPTIONS` object, add an
entry (keep the object's alphabetical ordering — place near other `Restyle*`/`R*` keys):

```typescript
  'RestyleWithLoRANode': 'Restyles your image in a trained style LoRA while keeping its structure — captions it, restyles with Flux, then transfers the look with Nano Banana 2.',
```

- [ ] **Step 4: Verify the frontend builds**

Run: `cd frontend && npx tsc --noEmit -p . 2>&1 | head -20`
Expected: no new type errors referencing the three edited files. (If the project has no
standalone tsc script, instead confirm the dev server compiles: the edits are plain object
literals matching the existing `Capability` / `Record<string,...>` shapes, so a type error
would point at one of these three lines.)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/node-capabilities.ts frontend/app/lib/nodeKeywords.ts frontend/app/lib/nodeDescriptions.ts
git commit -m "feat(restyle-lora): register RestyleWithLoRANode in frontend generator registries

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: In-app verification (manual, real run)

The orchestration and the two refactors run real Replicate calls; this is where they're
actually proven. Requires `REPLICATE_API_TOKEN` set and a LoRA with a sidecar in
`models/loras/` (e.g. `Azure_Bloom`).

- [ ] **Step 1: Restart the backend** (new node schemas are not hot-reloaded — see CLAUDE.md)

Kill the running ComfyUI process, then:
```bash
cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python main.py --listen 127.0.0.1 --port 8188
```
Expected: starts with no traceback; logs show the Replicate extension nodes loaded.

- [ ] **Step 2: Confirm the node registers**

In the running app, open the Generators panel and search "restyle" — expect
**"Restyle an Image · Style LoRA"** to appear alongside the existing "Restyle from an image".

- [ ] **Step 3: Run the regression check on the refactored nodes first**

Add a **"Generate with a style"** (`FluxLoRARemoteNode`) node with a known LoRA + image,
run it, and confirm it still produces a styled image and an `info` string (this guards the
Task 1 refactor). Add a **"Restyle from an image"** node, run it with a content + style
image, and confirm it still restyles (guards the Task 2 refactor).

- [ ] **Step 4: Run the new node end-to-end**

Add the new node, wire a content image, pick the LoRA (e.g. `Azure_Bloom`), leave
`style_strength` at 0.5, run it. Expected: after ~30-90s, a single restyled image that
keeps the content's composition but adopts the LoRA's look, and the image appears in the
Assets library (tagged `restyle_lora`).

- [ ] **Step 5: Spot-check the slider**

Run again at `style_strength` 0.9 (expect a bolder, looser restyle) and 0.1 (expect very
close to the original). Confirm the direction matches.

- [ ] **Step 6: Report results** with the generated images / server logs as evidence. Do not
claim success without a completed run.

---

## Self-review notes

- **Spec coverage:** style source LoRA-only ✓ (Task 5 inputs); simple+advanced controls ✓
  (Task 5 `advanced=True` split); intermediate hidden ✓ (style_tensor discarded, only `final`
  returned); single IMAGE output ✓; Approach A orchestration ✓ (Task 5 execute); helper
  extraction + behavior-preserving refactors ✓ (Tasks 1-2); `style_strength` mapping ✓ (Task 3);
  trigger+aesthetic+caption prompt ✓ (Task 4); error handling per-stage ✓ (Task 5 try/except);
  frontend discoverability ✓ (Task 6); price badge ✓; restart-required note ✓ (Task 7).
- **Type/name consistency:** `resolve_flux_lora_plan` returns `{"trained_model","lora_ref"}` and
  is consumed with those exact keys in Tasks 1 and 5. `restyle_style_strength_to_knobs` returns
  `(structure_strength, prompt_strength)` consumed in that order in Task 5.
  `build_restyle_instruction(structure_strength, extra_direction)` and
  `build_flux_style_prompt(trigger, aesthetic, caption)` signatures match all call sites.
- **Out of scope (unchanged):** the Flux text-to-image path and the IP-Adapter path of the two
  existing nodes are left intact; no selectable per-stage models; intermediate image not exposed.
```
