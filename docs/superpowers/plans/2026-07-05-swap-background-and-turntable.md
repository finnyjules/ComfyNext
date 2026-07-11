# Swap Background + Turntable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two packaged ecomm nodes — `SwapBackgroundNode` (lock the product, change the environment; nano-banana-2) and `TurntableNode` (front packshot → seamless 360° spin video; Luma loop or Seedance keyframe-stitch).

**Architecture:** Both are standard ComfyUI API nodes (no custom Vue), each backed by a dependency-light, unit-tested prompt/logic module — the exact pattern of the just-shipped `SwapProductNode`. Swap Background clones Swap Product with a branching (reference-vs-prompt) builder and three toggles. Turntable dispatches by context: front-only → Luma Ray 2 `loop:true`; real side/back views wired → Seedance 2.0 first→last keyframe segments concatenated with ffmpeg, with a pure segment-planner deciding the arcs.

**Tech Stack:** Python (ComfyUI nodes + pytest), Replicate/fal (`google/nano-banana-2`, `luma/ray-2-720p`, `bytedance/seedance-2.0`), ffmpeg (video concat), Nuxt 4 / TypeScript / Vitest (frontend registration).

## Global Constraints

- **Commit directly to `main`. Do NOT create a feature branch.**
- **Stage only the files each task names, with explicit paths. NEVER `git add -A` / `git add .`** — the working tree has unrelated uncommitted changes that must not be swept in.
- **Node identifiers are exactly `SwapBackgroundNode` and `TurntableNode`** — used verbatim as the backend `node_id`, the `ACTION_CATALOG` key, the `GENERATOR_NODE_ICONS` key, and the `NODE_MODEL_BRAND` key.
- **Every new backend node file MUST be added to the `extras_files` list in `nodes.py`** — comfy_extras nodes are NOT auto-scanned.
- **Backend node changes require a ComfyUI restart** (kill + relaunch; not hot-reloaded). Verify a new node loads via `curl http://127.0.0.1:8188/object_info/<NodeId>` returning JSON with `"display_name"`. Note: a parallel session may rebind port 8188; if a fresh process (start time after your kill) is serving the node, that's fine.
- **Prompt/logic modules must be dependency-light** (no torch / comfy_api / network imports) so their unit tests run fast in CI — mirror `comfy_extras/_swap_product_prompts.py`.
- **Relight-prompt lesson (commit `b38f825e0`):** never tell a reference-edit model to reproduce the subject's *colours* "faithfully / do not alter" when relighting is wanted — separate branding fidelity from illumination.
- **Swap Background model is fixed to `google/nano-banana-2`.** No model picker/seed.
- **Turntable models are fixed to `luma-ray-2-720p` (front-only) and `seedance-2.0` (keyframe-stitch).** No model picker; Veo is explicitly not built.
- **Live paid renders are the user's to run** (cost-conscious). Tasks verify node-load + unit tests; the visual/clip sign-off is a documented manual step, not an auto-spend.
- Python runs via `.venv/bin/python`. Frontend unit tests via `cd frontend && npx vitest run <path>`.

---

# FEATURE A — Swap Background

### Task A1: Swap-background prompt builder (dependency-light, unit-tested)

Mirrors `comfy_extras/_swap_product_prompts.py`. A branching builder (reference-mode vs prompt-mode) that assembles clauses from three booleans — the `_build_blend_instruction` pattern.

**Files:**
- Create: `comfy_extras/_swap_background_prompts.py`
- Test: `tests-unit/comfy_extras_test/swap_background_prompts_test.py`

**Interfaces:**
- Produces: `build_swap_background_instruction(has_reference: bool, scene_prompt: str, relight_to_scene: bool, ground_with_shadow: bool, keep_scale_and_placement: bool, instructions: str = "") -> str` — consumed by Task A2.

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/swap_background_prompts_test.py`:

```python
"""Unit tests for swap-background instruction building
(comfy_extras._swap_background_prompts). Dependency-light: no torch, no
comfy_api, no network — fast and importable in CI.
"""
from comfy_extras import _swap_background_prompts as sb


def _base(**kw):
    args = dict(has_reference=False, scene_prompt="", relight_to_scene=True,
                ground_with_shadow=True, keep_scale_and_placement=True, instructions="")
    args.update(kw)
    return sb.build_swap_background_instruction(**args)


def test_reference_mode_wording_when_has_reference():
    out = _base(has_reference=True)
    low = out.lower()
    assert "first image" in low and "second image" in low  # two-image framing

def test_prompt_mode_includes_scene_prompt_text():
    out = _base(has_reference=False, scene_prompt="marble bathroom counter")
    assert "marble bathroom counter" in out

def test_branding_always_preserved():
    low = _base().lower()
    assert "label" in low or "logo" in low or "branding" in low

def test_relight_on_adds_relight_clause_off_keeps_original():
    on = _base(relight_to_scene=True).lower()
    off = _base(relight_to_scene=False).lower()
    assert "relight" in on or "re-light" in on
    assert "original lighting" in off or "keep the product's lighting" in off

def test_no_faithful_colours_trap_when_relighting():
    # The b38f825e0 lesson: relight mode must NOT tell the model to keep the
    # product's colours faithfully/unaltered (that suppresses relighting).
    low = _base(relight_to_scene=True).lower()
    assert "colours faithfully" not in low and "colors faithfully" not in low

def test_ground_with_shadow_toggles_clause():
    on = _base(ground_with_shadow=True).lower()
    off = _base(ground_with_shadow=False).lower()
    assert "shadow" in on
    assert "no cast shadow" in off or "no shadow" in off

def test_keep_scale_toggles_clause():
    on = _base(keep_scale_and_placement=True).lower()
    off = _base(keep_scale_and_placement=False).lower()
    assert "same size and position" in on or "same scale and position" in on
    assert "compose" in off

def test_instructions_appended_when_present():
    out = _base(instructions="warmer tone")
    assert "Additional direction: warmer tone." in out

def test_instructions_blank_not_appended():
    assert "Additional direction" not in _base(instructions="   ")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/swap_background_prompts_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._swap_background_prompts'`

- [ ] **Step 3: Write minimal implementation**

Create `comfy_extras/_swap_background_prompts.py`:

```python
"""Swap-background instruction text for the Swap Background node.

Locks the product and changes the environment (the inverse of Swap Product).
Kept free of torch / comfy_api / network imports so it is unit-testable in CI
(mirrors comfy_extras/_swap_product_prompts.py). Two modes: a wired background
reference image, or a text scene prompt.

Relight lesson (commit b38f825e0): when relighting, do NOT tell the model to
reproduce the product's colours "faithfully / do not alter" — that suppresses
the relight. Branding fidelity (shape/label/logo) is separated from illumination.
"""
from __future__ import annotations

_REF_BASE = (
    "The first image is a background scene. The second image is a product. "
    "Place the product from the second image into the first image's scene so it "
    "looks like it genuinely belongs there. "
)
_PROMPT_BASE_TEMPLATE = (
    "The image is a product on a plain/neutral background. Replace the "
    "background with a new scene described as: {scene}. Place the product into "
    "that new scene so it looks like it genuinely belongs there. "
)
_BRANDING = (
    "Preserve the product's exact shape, proportions and branding — its label, "
    "logo, text and artwork must stay accurate, correctly placed and legible. "
)
_RELIGHT_ON = (
    "Re-light the product so it is physically lit by the new scene: match the "
    "scene's light direction, colour temperature and reflections, while keeping "
    "its branding artwork intact. "
)
_RELIGHT_OFF = (
    "Keep the product's original lighting exactly as shot — do not change how the "
    "product itself is lit; only replace what is behind it. "
)
_SHADOW_ON = (
    "Add a soft, realistic contact shadow and any appropriate reflection where the "
    "product meets the surface, so it sits in the scene. "
)
_SHADOW_OFF = (
    "Add no cast shadow — keep the product cleanly separated from the background. "
)
_KEEP_PLACEMENT_ON = (
    "Keep the product at the same size and position in frame as the input. "
)
_KEEP_PLACEMENT_OFF = (
    "Compose the product naturally within the new scene (it may be re-placed or "
    "resized for a pleasing composition). "
)
_TAIL = "Output only the edited image."


def build_swap_background_instruction(
    has_reference: bool,
    scene_prompt: str,
    relight_to_scene: bool,
    ground_with_shadow: bool,
    keep_scale_and_placement: bool,
    instructions: str = "",
) -> str:
    """Assemble the nano-banana-2 instruction for a product background swap.

    has_reference True → reference mode (image_input = [background, product]).
    Else prompt mode (image_input = [product]); scene_prompt describes the scene.
    """
    if has_reference:
        parts = [_REF_BASE]
    else:
        parts = [_PROMPT_BASE_TEMPLATE.format(scene=(scene_prompt or "").strip())]
    parts.append(_BRANDING)
    parts.append(_RELIGHT_ON if relight_to_scene else _RELIGHT_OFF)
    parts.append(_SHADOW_ON if ground_with_shadow else _SHADOW_OFF)
    parts.append(_KEEP_PLACEMENT_ON if keep_scale_and_placement else _KEEP_PLACEMENT_OFF)
    parts.append(_TAIL)
    base = "".join(parts)
    extra = (instructions or "").strip()
    if extra:
        return f"{base} Additional direction: {extra}."
    return base
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/swap_background_prompts_test.py -v`
Expected: PASS — 9 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add comfy_extras/_swap_background_prompts.py tests-unit/comfy_extras_test/swap_background_prompts_test.py
git commit -m "feat(swap-background): branching prompt builder + unit tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A2: SwapBackgroundNode backend node + registration

Mirrors `comfy_extras/nodes_swap_product.py`. Product locked; background from a reference image (wins) or a scene prompt; three toggles; nano-banana-2.

**Files:**
- Create: `comfy_extras/nodes_swap_background.py`
- Modify: `nodes.py` (add `"nodes_swap_background.py"` to `extras_files`, after `"nodes_swap_product.py"`)

**Interfaces:**
- Consumes: `build_swap_background_instruction(...)` from Task A1; helpers `_run_prediction`, `_image_tensor_to_data_url`, `_first_output_url`, `download_url_to_image_tensor` from `comfy_api_nodes.nodes_replicate` (existing, lazy-imported).
- Produces: node type `SwapBackgroundNode` visible via `/object_info` after a ComfyUI restart — consumed by Task A3.

- [ ] **Step 1: Create the node file**

Create `comfy_extras/nodes_swap_background.py`:

```python
from __future__ import annotations

"""Swap Background node — lock a product, change the environment.

The inverse of Swap Product: keeps the product exact and swaps the scene behind
it. A wired `background_reference` image wins; otherwise a `scene_prompt` text
describes a new scene to generate. Three toggles (relight / shadow / keep
placement) shape the composite. Nano Banana 2. When there is nothing to change
the background to (no reference and no prompt), the product passes through.

Sibling to nodes_swap_product.py.
"""

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview, save_generation_output
from comfy_extras._swap_background_prompts import build_swap_background_instruction


class SwapBackgroundNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SwapBackgroundNode",
            display_name="Swap Background",
            description=(
                "Lock the product, change the background (Nano Banana 2). Wire a "
                "background reference image, or type a scene to generate one. "
                "Toggles: relight the product to the new scene, ground it with a "
                "contact shadow, and keep its scale/placement for batch "
                "consistency. Branding stays pixel-faithful. ~$0.05 per swap."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("product", tooltip="The product to keep. Its branding stays exact."),
                IO.Image.Input("background_reference", optional=True,
                               tooltip="A scene/backdrop photo to place the product into. Wins over the scene prompt."),
                IO.String.Input("scene_prompt", multiline=True, default="", optional=True,
                                tooltip="Describe a new background to generate when no reference is wired, e.g. 'marble bathroom counter, soft morning light'."),
                IO.Boolean.Input("relight_to_scene", default=True,
                                 tooltip="On: relight the product to the new scene. Off: keep the product's original lighting, only change what's behind it."),
                IO.Boolean.Input("ground_with_shadow", default=True,
                                 tooltip="On: add a contact shadow/reflection so it sits on the surface. Off: clean float (good for gradient/abstract backdrops)."),
                IO.Boolean.Input("keep_scale_and_placement", default=True,
                                 tooltip="On: keep the product the same size and position (consistent across a product line). Off: let the model compose it into the scene."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction, appended to the instruction."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, product=None, background_reference=None, scene_prompt="",
                      relight_to_scene=True, ground_with_shadow=True,
                      keep_scale_and_placement=True, instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)

        # No product → tiny blank. No API call.
        if product is None:
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))

        has_reference = background_reference is not None
        # Nothing to change the background to → pass the product through unchanged.
        if not has_reference and not (scene_prompt or "").strip():
            return IO.NodeOutput(product, ui=save_live_preview(product, uid))

        # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
        from comfy_api_nodes.nodes_replicate import (
            _run_prediction, _image_tensor_to_data_url,
            _first_output_url, download_url_to_image_tensor,
        )
        prompt = build_swap_background_instruction(
            has_reference, scene_prompt, bool(relight_to_scene),
            bool(ground_with_shadow), bool(keep_scale_and_placement), instructions,
        )
        # Reference mode: [background, product] (order matches the prompt's
        # "first image / second image" framing). Prompt mode: [product] only.
        if has_reference:
            image_input = [
                _image_tensor_to_data_url(background_reference),
                _image_tensor_to_data_url(product),
            ]
        else:
            image_input = [_image_tensor_to_data_url(product)]
        input_dict = {
            "prompt": prompt,
            "image_input": image_input,
            "resolution": "1K",
            "output_format": "png",
        }
        pred = await _run_prediction("google/nano-banana-2", input_dict)
        result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(result, ui=save_generation_output(result, "swap_background"))


class SwapBackgroundExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [SwapBackgroundNode]


async def comfy_entrypoint() -> SwapBackgroundExtension:
    return SwapBackgroundExtension()
```

- [ ] **Step 2: Register in the extras list**

In `nodes.py`, find `"nodes_swap_product.py",` in the `extras_files` list and add immediately after it:

```python
        "nodes_swap_product.py",
        "nodes_swap_background.py",
```

- [ ] **Step 3: Syntax check + registration check**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -c "import ast; ast.parse(open('comfy_extras/nodes_swap_background.py').read()); print('syntax ok')"`
Expected: `syntax ok`

Run: `cd /Users/julien/Documents/GitHub/Sailor && grep -n "nodes_swap_background.py" nodes.py`
Expected: one match inside `extras_files`.

- [ ] **Step 4: Restart ComfyUI and confirm the node loads**

Kill the running ComfyUI and relaunch (a parallel session may relaunch it for you — a process whose start time is after your kill and that serves the node is fine):
`cd /Users/julien/Documents/GitHub/Sailor && nohup .venv/bin/python main.py --listen 127.0.0.1 --port 8188 > /tmp/comfyui-swapbg.log 2>&1 &`

Then poll (Python avoids the shell choking on unicode tooltips):
```bash
cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python - <<'PY'
import json,urllib.request,time
for _ in range(60):
    try:
        d=json.load(urllib.request.urlopen('http://127.0.0.1:8188/object_info/SwapBackgroundNode', timeout=5))
        n=d.get('SwapBackgroundNode')
        if n: print("LOADED", n.get('display_name'), "| req:", list(n['input'].get('required',{})), "| opt:", list(n['input'].get('optional',{}))); break
    except Exception: pass
    time.sleep(3)
else:
    print("NOT LOADED — check /tmp/comfyui-swapbg.log")
PY
```
Expected: `LOADED Swap Background | req: ['product', 'relight_to_scene', 'ground_with_shadow', 'keep_scale_and_placement'] | opt: ['background_reference', 'scene_prompt', 'instructions']`

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add comfy_extras/nodes_swap_background.py nodes.py
git commit -m "feat(swap-background): SwapBackgroundNode (nano-banana-2, ref-or-prompt)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task A3: Swap Background frontend registration

**Files:**
- Modify: `frontend/app/data/action-catalog.ts` (add `SwapBackgroundNode` near `SwapProductNode`)
- Modify: `frontend/app/data/generator-icons.ts` (import `ImagePlus`; add icon + brand)
- Test: `frontend/tests/unit/swap-background-catalog.unit.spec.ts`

**Interfaces:**
- Consumes: node type string `SwapBackgroundNode` (Task A2).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/swap-background-catalog.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ACTION_CATALOG } from '../../app/data/action-catalog'
import { GENERATOR_NODE_ICONS, NODE_MODEL_BRAND } from '../../app/data/generator-icons'

describe('Swap Background node registration', () => {
  it('has an action-catalog entry (edit intent, Nano Banana 2)', () => {
    const e = ACTION_CATALOG.SwapBackgroundNode
    expect(e).toBeDefined()
    expect(e.intent).toBe('edit')
    expect(e.model).toBe('Nano Banana 2')
  })
  it('has a canvas icon', () => {
    expect(GENERATOR_NODE_ICONS.SwapBackgroundNode).toBeDefined()
  })
  it('is branded Gemini', () => {
    expect(NODE_MODEL_BRAND.SwapBackgroundNode).toBe('Gemini')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/swap-background-catalog.unit.spec.ts`
Expected: FAIL — `ACTION_CATALOG.SwapBackgroundNode` is undefined.

- [ ] **Step 3a: Add the action-catalog entry**

In `frontend/app/data/action-catalog.ts`, add directly after the `SwapProductNode` entry:

```ts
  SwapBackgroundNode:    { useCase: 'Swap the background behind a product', model: 'Nano Banana 2', intent: 'edit' },
```

- [ ] **Step 3b: Add the icon import + entry**

In `frontend/app/data/generator-icons.ts`, add `ImagePlus` to the `lucide-vue-next` import block:

```ts
  ImagePlus,
```

Add the icon entry directly after the `SwapProductNode: Replace,` line:

```ts
  SwapBackgroundNode:   ImagePlus,
```

- [ ] **Step 3c: Add the brand entry**

In `NODE_MODEL_BRAND`, add directly after the `SwapProductNode: 'Gemini',` line:

```ts
  SwapBackgroundNode:   'Gemini',             // Nano Banana 2
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/swap-background-catalog.unit.spec.ts`
Expected: PASS — 3 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/data/action-catalog.ts frontend/app/data/generator-icons.ts frontend/tests/unit/swap-background-catalog.unit.spec.ts
git commit -m "feat(swap-background): register Swap Background in the frontend catalog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# FEATURE B — Turntable

> **Note on verification:** the pure logic (prompt builders, segment planner, and
> the PyAV stitch) is fully unit-tested with **no API calls**. The live
> end-to-end video render is a **paid** run (~$0.50 front-only, ~$2–$6 with extra
> views) needing real product photos — that is the user's manual sign-off, not an
> auto-spend. Tasks below verify node-load + unit tests only.

### Task B1: Turntable prompt builders (dependency-light, unit-tested)

**Files:**
- Create: `comfy_extras/_turntable_prompts.py`
- Test: `tests-unit/comfy_extras_test/turntable_prompts_test.py`

**Interfaces:**
- Produces: `simple_spin_instruction(direction: str, instructions: str = "") -> str` and `segment_instruction(degrees: int, direction: str, instructions: str = "") -> str` — consumed by Task B4.

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/turntable_prompts_test.py`:

```python
"""Unit tests for turntable instruction building (comfy_extras._turntable_prompts).
Dependency-light: no torch/comfy_api/network."""
from comfy_extras import _turntable_prompts as tp


def test_simple_spin_has_360_loop_and_direction():
    out = tp.simple_spin_instruction("left").lower()
    assert "360" in out and "loop" in out and "left" in out

def test_segment_has_degrees_direction_and_no_morphing():
    out = tp.segment_instruction(90, "right").lower()
    assert "90" in out and "right" in out and "no morphing" in out

def test_instructions_appended_both_helpers():
    assert "Additional direction: keep it slow." in tp.simple_spin_instruction("left", "keep it slow")
    assert "Additional direction: keep it slow." in tp.segment_instruction(180, "left", "keep it slow")

def test_blank_instructions_not_appended():
    assert "Additional direction" not in tp.simple_spin_instruction("left", "   ")
    assert "Additional direction" not in tp.segment_instruction(90, "left", "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/turntable_prompts_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._turntable_prompts'`

- [ ] **Step 3: Write minimal implementation**

Create `comfy_extras/_turntable_prompts.py`:

```python
"""Turntable instruction text. Dependency-light (no torch/comfy_api/network) so
it is unit-testable in CI (mirrors comfy_extras/_swap_product_prompts.py)."""
from __future__ import annotations

_SPIN = (
    "The product makes a smooth, continuous full 360° turntable spin to the "
    "{direction}; camera fixed; consistent lighting and background; seamless loop."
)
_SEG = (
    "Smooth turntable rotation {degrees}° to the {direction}: the product turns "
    "cleanly with no morphing or warping; camera fixed; consistent lighting and "
    "background."
)


def _append(base: str, instructions: str) -> str:
    extra = (instructions or "").strip()
    return f"{base} Additional direction: {extra}." if extra else base


def simple_spin_instruction(direction: str, instructions: str = "") -> str:
    return _append(_SPIN.format(direction=direction), instructions)


def segment_instruction(degrees: int, direction: str, instructions: str = "") -> str:
    return _append(_SEG.format(degrees=int(degrees), direction=direction), instructions)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/turntable_prompts_test.py -v`
Expected: PASS — 4 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add comfy_extras/_turntable_prompts.py tests-unit/comfy_extras_test/turntable_prompts_test.py
git commit -m "feat(turntable): spin/segment prompt builders + unit tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task B2: Turntable segment planner (pure function, unit-tested)

Decides the keyframe arcs from whichever real views are wired. Front is 0°, right 90°, back 180°, left 270°; walk the provided views around the circle in `direction` order, closing back to front.

**Files:**
- Create: `comfy_extras/_turntable_plan.py`
- Test: `tests-unit/comfy_extras_test/turntable_plan_test.py`

**Interfaces:**
- Produces: `plan_segments(extra_views, direction: str) -> list[tuple[str, str, int]]` where `extra_views` is an iterable subset of `{"right","back","left"}`; returns ordered `(start_view, end_view, degrees)` segments. Consumed by Task B4.

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/turntable_plan_test.py`:

```python
"""Unit tests for the turntable segment planner (comfy_extras._turntable_plan).
Pure function, no deps."""
from comfy_extras import _turntable_plan as tpl


def test_front_only_single_full_loop():
    assert tpl.plan_segments(set(), "left") == [("front", "front", 360)]

def test_front_and_back_two_half_arcs():
    assert tpl.plan_segments({"back"}, "left") == [("front", "back", 180), ("back", "front", 180)]

def test_all_four_views_left():
    assert tpl.plan_segments({"right", "back", "left"}, "left") == [
        ("front", "right", 90), ("right", "back", 90),
        ("back", "left", 90), ("left", "front", 90)]

def test_all_four_views_right_reverses_order():
    assert tpl.plan_segments({"right", "back", "left"}, "right") == [
        ("front", "left", 90), ("left", "back", 90),
        ("back", "right", 90), ("right", "front", 90)]

def test_degrees_always_sum_to_360():
    for extra in [set(), {"back"}, {"right", "left"}, {"right", "back", "left"}]:
        for direction in ("left", "right"):
            total = sum(d for _, _, d in tpl.plan_segments(extra, direction))
            assert total == 360, (extra, direction, total)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/turntable_plan_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._turntable_plan'`

- [ ] **Step 3: Write minimal implementation**

Create `comfy_extras/_turntable_plan.py`:

```python
"""Turntable segment planner. Pure function (no deps) — decides the keyframe
arcs from whichever real views are wired. Angles: front 0°, right 90°, back
180°, left 270°."""
from __future__ import annotations

_ORDER = ["front", "right", "back", "left"]
_ANGLE = {"front": 0, "right": 90, "back": 180, "left": 270}


def plan_segments(extra_views, direction: str) -> list[tuple[str, str, int]]:
    """Ordered (start_view, end_view, degrees) arcs that walk the provided views
    around the full circle and close back to front. `extra_views` is a subset of
    {"right","back","left"}; front is always present. Segment degrees sum to 360.
    """
    extra = set(extra_views)
    views = [v for v in _ORDER if v == "front" or v in extra]  # ascending by angle, front first
    if len(views) == 1:
        return [("front", "front", 360)]
    seq = views[:] if direction == "left" else [views[0]] + views[:0:-1]
    segs: list[tuple[str, str, int]] = []
    n = len(seq)
    for i in range(n):
        a, b = seq[i], seq[(i + 1) % n]
        if direction == "left":
            deg = (_ANGLE[b] - _ANGLE[a]) % 360
        else:
            deg = (_ANGLE[a] - _ANGLE[b]) % 360
        segs.append((a, b, deg))
    return segs
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/turntable_plan_test.py -v`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add comfy_extras/_turntable_plan.py tests-unit/comfy_extras_test/turntable_plan_test.py
git commit -m "feat(turntable): segment planner (views + direction -> arcs) + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task B3: Video-clip stitcher (PyAV, unit-tested with synthetic clips)

Concatenates the per-segment clips into one video, dropping the duplicate boundary frame between consecutive clips (segment N's last frame == segment N+1's first frame, the same real photo). PyAV (`av`) is already a repo dependency — see `comfy_extras/nodes_timeline.py`.

**Files:**
- Create: `comfy_extras/_turntable_stitch.py`
- Test: `tests-unit/comfy_extras_test/turntable_stitch_test.py`

**Interfaces:**
- Produces: `stitch_clips(sources: list) -> io.BytesIO` where each source is a `BytesIO` (or path) of an encoded video; returns a seekable `BytesIO` of the concatenated H.264/mp4. Consumed by Task B4.

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/turntable_stitch_test.py`:

```python
"""Unit tests for the PyAV clip stitcher (comfy_extras._turntable_stitch).
Builds synthetic clips in-memory — NO network / no paid API."""
import io
import av
import numpy as np
from comfy_extras import _turntable_stitch as st


def _make_clip(n_frames, color, w=32, h=32, fps=8):
    buf = io.BytesIO()
    c = av.open(buf, mode="w", format="mp4")
    s = c.add_stream("h264", rate=fps)
    s.width, s.height, s.pix_fmt = w, h, "yuv420p"
    for _ in range(n_frames):
        arr = np.full((h, w, 3), color, dtype=np.uint8)
        for p in s.encode(av.VideoFrame.from_ndarray(arr, format="rgb24")):
            c.mux(p)
    for p in s.encode():
        c.mux(p)
    c.close()
    buf.seek(0)
    return buf


def _count_frames(buf):
    buf.seek(0)
    with av.open(buf, mode="r") as c:
        return sum(1 for _ in c.decode(c.streams.video[0]))


def test_stitch_drops_one_boundary_frame_per_join():
    clips = [_make_clip(5, 10), _make_clip(5, 120), _make_clip(5, 240)]
    out = st.stitch_clips(clips)
    # 15 total input frames, 2 joins → 2 duplicate boundary frames dropped.
    assert _count_frames(out) == 15 - 2

def test_single_clip_passes_through_frame_count():
    out = st.stitch_clips([_make_clip(6, 90)])
    assert _count_frames(out) == 6

def test_empty_raises():
    import pytest
    with pytest.raises(ValueError):
        st.stitch_clips([])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/turntable_stitch_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._turntable_stitch'`

- [ ] **Step 3: Write minimal implementation**

Create `comfy_extras/_turntable_stitch.py`:

```python
"""Concatenate turntable segment clips into one seamless video with PyAV.

Drops the first frame of every clip after the first: consecutive segments share
a real boundary photo (segment N's last frame == segment N+1's first frame), so
dropping the duplicate avoids a 1-frame stutter. Output dimensions/fps follow the
first clip. (PyAV is already used in comfy_extras/nodes_timeline.py.)"""
from __future__ import annotations

import io
from fractions import Fraction

import av


def stitch_clips(sources: list) -> io.BytesIO:
    if not sources:
        raise ValueError("stitch_clips: no clips to concatenate")
    out_buf = io.BytesIO()
    out_container = None
    out_stream = None
    W = H = None
    for idx, src in enumerate(sources):
        if hasattr(src, "seek"):
            src.seek(0)
        with av.open(src, mode="r") as cin:
            vin = cin.streams.video[0]
            fps = vin.average_rate or Fraction(24, 1)
            frame_no = 0
            for frame in cin.decode(vin):
                if out_container is None:
                    W, H = frame.width, frame.height
                    out_container = av.open(out_buf, mode="w", format="mp4")
                    out_stream = out_container.add_stream("h264", rate=fps)
                    out_stream.width, out_stream.height = W, H
                    out_stream.pix_fmt = "yuv420p"
                    out_stream.options = {"preset": "veryfast", "crf": "20"}
                # Drop the duplicate boundary frame at the start of joined clips.
                if idx > 0 and frame_no == 0:
                    frame_no += 1
                    continue
                frame_no += 1
                rf = frame.reformat(width=W, height=H, format="yuv420p")
                for pkt in out_stream.encode(rf):
                    out_container.mux(pkt)
    for pkt in out_stream.encode():
        out_container.mux(pkt)
    out_container.close()
    out_buf.seek(0)
    return out_buf
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/turntable_stitch_test.py -v`
Expected: PASS — 3 passed. (If the H.264 encoder in this PyAV build drops/reorders and the exact count is off by a frame, switch the synthetic-clip codec to `"mpeg4"`; do NOT weaken the boundary-drop assertion.)

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add comfy_extras/_turntable_stitch.py tests-unit/comfy_extras_test/turntable_stitch_test.py
git commit -m "feat(turntable): PyAV clip stitcher w/ boundary-frame drop + tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task B4: TurntableNode backend node + registration

Dual-path video node: front-only → Luma loop (one call); extra views → Seedance keyframe segments (per `plan_segments`) stitched with `stitch_clips`. Uses the existing video registry + dispatch.

**Files:**
- Create: `comfy_extras/nodes_turntable.py`
- Modify: `nodes.py` (add `"nodes_turntable.py"` to `extras_files`, after `"nodes_swap_background.py"`)

**Interfaces:**
- Consumes: `simple_spin_instruction`, `segment_instruction` (B1); `plan_segments` (B2); `stitch_clips` (B3); and from `comfy_api_nodes.nodes_replicate`: `_image_tensor_to_data_url`, `_dispatch_video_prediction`, `_VIDEO_MODELS_BY_ID` (lazy-imported).
- Produces: node type `TurntableNode` (VIDEO output) visible via `/object_info` — consumed by Task B5.

- [ ] **Step 1: Confirm the exact `VideoFromFile` import used in the codebase**

Run: `cd /Users/julien/Documents/GitHub/Sailor && grep -rn "VideoFromFile" comfy_api_nodes/util/download_helpers.py comfy_api/latest/__init__.py | head`
Expected: shows how `VideoFromFile` is imported/exposed (e.g. `from comfy_api.latest import InputImpl` then `InputImpl.VideoFromFile`, or a direct module path). Use that exact form in Step 2's `stitched` return. If `from comfy_api.latest import InputImpl` does not expose it, use the path `download_url_to_video_output` uses.

- [ ] **Step 2: Create the node file**

Create `comfy_extras/nodes_turntable.py` (adjust the `VideoFromFile` import per Step 1 if needed):

```python
from __future__ import annotations

"""Turntable node — a product packshot → seamless 360° spin video.

Front only → Luma Ray 2 720p with loop=True (one call, natively seamless; the
back/sides are inferred). Real right/back/left views wired → Seedance 2.0
first→last keyframe segments (each arc interpolates between two REAL supplied
photos, so the faces are correct), concatenated with PyAV; the loop closes by
construction (the final segment ends on the front = the first segment's start).

Front is required (0°); right/back/left sit at 90/180/270°. The pure segment
planner (_turntable_plan) decides the arcs from whatever is wired.
"""

from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO, InputImpl
from comfy_extras._turntable_prompts import simple_spin_instruction, segment_instruction
from comfy_extras._turntable_plan import plan_segments
from comfy_extras._turntable_stitch import stitch_clips


class TurntableNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="TurntableNode",
            display_name="Turntable",
            category="api node/video/Replicate",
            description=(
                "Spin a product 360° into a seamless loop. Front only → Luma Ray 2 "
                "loop (back/sides inferred). Wire the real right/back/left views → "
                "Seedance stitches keyframe arcs through the true faces. "
                "~$0.50 front-only; ~$2–$6 with extra views."
            ),
            inputs=[
                IO.Image.Input("image", tooltip="Front view of the product (0°). The spin's start/end frame."),
                IO.Image.Input("right_reference", optional=True, tooltip="True right side (90°) — anchors that face."),
                IO.Image.Input("back_reference", optional=True, tooltip="True back (180°) — anchors that face."),
                IO.Image.Input("left_reference", optional=True, tooltip="True left side (270°) — anchors that face."),
                IO.Combo.Input("direction", options=["left", "right"], default="left", tooltip="Spin/rotation direction."),
                IO.String.Input("instructions", multiline=True, default="", optional=True, tooltip="Optional extra direction, appended."),
            ],
            outputs=[IO.Video.Output(display_name="video")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.50,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, image=None, right_reference=None, back_reference=None,
                      left_reference=None, direction="left", instructions="") -> IO.NodeOutput:
        if image is None:
            raise RuntimeError("Turntable requires a front image.")

        # Lazy import: video dispatch helpers live in the Replicate node module.
        from comfy_api_nodes.nodes_replicate import (
            _image_tensor_to_data_url, _dispatch_video_prediction, _VIDEO_MODELS_BY_ID,
        )

        views = {"front": image}
        if right_reference is not None:
            views["right"] = right_reference
        if back_reference is not None:
            views["back"] = back_reference
        if left_reference is not None:
            views["left"] = left_reference
        extra = set(views) - {"front"}

        # Path A — front only: Luma Ray 2 loop, single call.
        if not extra:
            spec = _VIDEO_MODELS_BY_ID["luma-ray-2-720p"]
            input_dict = spec.build_input(
                simple_spin_instruction(direction, instructions),
                "1:1", 5, 0, _image_tensor_to_data_url(image), None, {"loop": True},
            )
            video = await _dispatch_video_prediction(
                spec, input_dict, cls=cls, log_prefix="Turntable", model="luma-ray-2-720p")
            return IO.NodeOutput(video)

        # Path B — extra views: Seedance first→last keyframe segments, stitched.
        spec = _VIDEO_MODELS_BY_ID["seedance-2.0"]
        clip_sources = []
        for start_view, end_view, degrees in plan_segments(extra, direction):
            input_dict = spec.build_input(
                segment_instruction(degrees, direction, instructions),
                "1:1", 5, 0, _image_tensor_to_data_url(views[start_view]), None,
                {"end_image_url": _image_tensor_to_data_url(views[end_view])},
            )
            clip = await _dispatch_video_prediction(
                spec, input_dict, cls=cls, log_prefix="Turntable", model="seedance-2.0")
            clip_sources.append(clip.get_stream_source())

        stitched = stitch_clips(clip_sources)
        return IO.NodeOutput(InputImpl.VideoFromFile(stitched))


class TurntableExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [TurntableNode]


async def comfy_entrypoint() -> TurntableExtension:
    return TurntableExtension()
```

- [ ] **Step 3: Register in the extras list**

In `nodes.py`, find `"nodes_swap_background.py",` and add immediately after it:

```python
        "nodes_swap_background.py",
        "nodes_turntable.py",
```

- [ ] **Step 4: Syntax + registration checks**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -c "import ast; ast.parse(open('comfy_extras/nodes_turntable.py').read()); print('syntax ok')"`
Expected: `syntax ok`

Run: `cd /Users/julien/Documents/GitHub/Sailor && grep -n "nodes_turntable.py" nodes.py`
Expected: one match in `extras_files`.

- [ ] **Step 5: Restart ComfyUI and confirm the node loads**

Relaunch (a parallel session may beat you to the port; a fresh process serving the node is fine):
`cd /Users/julien/Documents/GitHub/Sailor && nohup .venv/bin/python main.py --listen 127.0.0.1 --port 8188 > /tmp/comfyui-turntable.log 2>&1 &`

Poll:
```bash
cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python - <<'PY'
import json,urllib.request,time
for _ in range(60):
    try:
        d=json.load(urllib.request.urlopen('http://127.0.0.1:8188/object_info/TurntableNode', timeout=5))
        n=d.get('TurntableNode')
        if n:
            out=n.get('output'); 
            print("LOADED", n.get('display_name'), "| output:", out, "| req:", list(n['input'].get('required',{})), "| opt:", list(n['input'].get('optional',{}))); break
    except Exception: pass
    time.sleep(3)
else:
    print("NOT LOADED — check /tmp/comfyui-turntable.log")
PY
```
Expected: `LOADED Turntable | output: ['VIDEO'] | req: ['image', 'direction'] | opt: ['right_reference', 'back_reference', 'left_reference', 'instructions']`

If NOT LOADED, read `/tmp/comfyui-turntable.log` for the import error (most likely the `VideoFromFile`/`InputImpl` import from Step 1 — fix and restart).

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add comfy_extras/nodes_turntable.py nodes.py
git commit -m "feat(turntable): TurntableNode (Luma loop / Seedance keyframe-stitch)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task B5: Turntable frontend registration

**Files:**
- Modify: `frontend/app/data/action-catalog.ts` (add `TurntableNode` near the video nodes)
- Modify: `frontend/app/data/generator-icons.ts` (import `Rotate3d`; add icon + brand)
- Test: `frontend/tests/unit/turntable-catalog.unit.spec.ts`

**Interfaces:**
- Consumes: node type string `TurntableNode` (Task B4).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/turntable-catalog.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ACTION_CATALOG } from '../../app/data/action-catalog'
import { GENERATOR_NODE_ICONS, NODE_MODEL_BRAND } from '../../app/data/generator-icons'

describe('Turntable node registration', () => {
  it('has an action-catalog entry (create intent)', () => {
    const e = ACTION_CATALOG.TurntableNode
    expect(e).toBeDefined()
    expect(e.intent).toBe('create')
  })
  it('has a canvas icon', () => {
    expect(GENERATOR_NODE_ICONS.TurntableNode).toBeDefined()
  })
  it('is branded Luma', () => {
    expect(NODE_MODEL_BRAND.TurntableNode).toBe('Luma')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/turntable-catalog.unit.spec.ts`
Expected: FAIL — `ACTION_CATALOG.TurntableNode` is undefined.

- [ ] **Step 3a: Add the action-catalog entry**

In `frontend/app/data/action-catalog.ts`, add near the video-node entries (e.g. after `GenerateVideoNode`):

```ts
  TurntableNode:         { useCase: 'Spin a product 360°', model: 'Luma Ray 2 / Seedance 2.0', intent: 'create' },
```

- [ ] **Step 3b: Add the icon import + entry**

In `frontend/app/data/generator-icons.ts`, add `Rotate3d` to the `lucide-vue-next` import block:

```ts
  Rotate3d,
```

Add the icon entry near the video-node icons (e.g. after `GenerateVideoNode: Film,`):

```ts
  TurntableNode:        Rotate3d,
```

- [ ] **Step 3c: Add the brand entry**

In `NODE_MODEL_BRAND`, add near the video entries:

```ts
  TurntableNode:        'Luma',               // Luma Ray 2 (front-only default path)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/turntable-catalog.unit.spec.ts`
Expected: PASS — 3 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/data/action-catalog.ts frontend/app/data/generator-icons.ts frontend/tests/unit/turntable-catalog.unit.spec.ts
git commit -m "feat(turntable): register Turntable node in the frontend catalog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Swap Background surface/inputs/3 toggles/ref-or-prompt/branding-baked/relight-lesson → Tasks A1–A2. ✓
- Swap Background registration + unit test → A3. ✓
- Turntable dual-path (Luma loop / Seedance keyframe-stitch), segment planner, ffmpeg stitch, VIDEO output → B1–B4. ✓
- Turntable registration → B5. ✓
- "Live paid render is manual" constraint → stated in the Feature B note; no task auto-spends. ✓
- Out-of-scope (Veo, model pickers, discrete-frame stitch) → none added. ✓

**Placeholder scan:** none — every step has full code + exact commands + expected output. The one runtime-confirm (B4 Step 1, `VideoFromFile` import) is a concrete grep with a defined fallback, not a TBD.

**Type/name consistency:** `SwapBackgroundNode` / `TurntableNode` identical across backend `node_id`, catalog key, icon key, brand key. `build_swap_background_instruction`, `simple_spin_instruction`, `segment_instruction`, `plan_segments`, `stitch_clips` defined in their tasks and consumed by name in the node tasks. Video helpers (`_dispatch_video_prediction`, `_VIDEO_MODELS_BY_ID`, `_image_tensor_to_data_url`) match `nodes_replicate.py`. Model ids `luma-ray-2-720p` / `seedance-2.0` match `video_models.py`.
