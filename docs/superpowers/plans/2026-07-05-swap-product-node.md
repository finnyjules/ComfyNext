# Swap Product node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Swap Product` canvas node that places a new product into a finished packshot scene via a single two-image nano-banana-2 reference edit, keeping the reference's background, framing, camera and lighting.

**Architecture:** A standard ComfyUI API node (no custom Vue renderer), modeled exactly on the existing `PersonSwap` node. Backend: a dependency-light prompt module + a node file that passes `image_input: [scene_reference, product]` to `google/nano-banana-2`. Frontend: one action-catalog entry + one icon/brand entry so it appears on the canvas and in the Actions panel. The scene look is copied from the reference image, so results stay consistent across products without any seed-locking.

**Tech Stack:** Python (ComfyUI node + pytest), Replicate (`google/nano-banana-2`), Nuxt 4 / TypeScript / Vitest (frontend registration).

## Global Constraints

- **Commit directly to `main`. Do NOT create a feature branch.**
- **Stage only the files each task names, with explicit paths. NEVER `git add -A` / `git add .`** — the working tree has unrelated uncommitted changes that must not be swept in.
- **The single node identifier is `SwapProductNode`** — used verbatim as the backend `node_id`, the `ACTION_CATALOG` key, the `GENERATOR_NODE_ICONS` key, and the `NODE_MODEL_BRAND` key. No variants.
- **Model is fixed to `google/nano-banana-2`.** No model picker, no seed, no toggles in v1.
- **A new backend node file MUST be added to the `extras_files` list in `nodes.py`** — comfy_extras nodes are NOT auto-scanned.
- **Backend node changes require a ComfyUI restart** (kill + relaunch; not hot-reloaded).
- **This is a visual node: it is not "done" on unit tests alone.** The final task is a live render + screenshot sign-off with the user.

---

### Task 1: Product-swap prompt module (dependency-light, unit-tested)

Mirrors `comfy_extras/_person_swap_prompts.py` + its test — a torch/comfy/network-free prompt builder so it runs fast in CI.

**Files:**
- Create: `comfy_extras/_swap_product_prompts.py`
- Test: `tests-unit/comfy_extras_test/swap_product_prompts_test.py`

**Interfaces:**
- Produces: `SWAP_PRODUCT_PROMPT: str` and `swap_product_instruction(instructions: str = "") -> str` — imported by Task 2's node.

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/swap_product_prompts_test.py`:

```python
"""Unit tests for product-swap instruction building
(comfy_extras._swap_product_prompts). Dependency-light by design: no torch, no
comfy_api, no network — fast and importable in CI.
"""
from comfy_extras import _swap_product_prompts as sp


def test_blank_instructions_returns_base_prompt():
    assert sp.swap_product_instruction("") == sp.SWAP_PRODUCT_PROMPT


def test_whitespace_instructions_returns_base_prompt():
    assert sp.swap_product_instruction("   ") == sp.SWAP_PRODUCT_PROMPT


def test_instructions_appended_when_present():
    out = sp.swap_product_instruction("shift the bottle slightly left")
    assert out.startswith(sp.SWAP_PRODUCT_PROMPT)
    assert "Additional direction: shift the bottle slightly left." in out


def test_base_prompt_preserves_branding_language():
    # The whole point of a product swap: the new product's own branding must be kept.
    low = sp.SWAP_PRODUCT_PROMPT.lower()
    assert "label" in low or "logo" in low or "branding" in low


def test_base_prompt_keeps_scene_fixed():
    # The reference scene's background and camera must be preserved.
    low = sp.SWAP_PRODUCT_PROMPT.lower()
    assert "background" in low and "camera" in low
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python -m pytest tests-unit/comfy_extras_test/swap_product_prompts_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._swap_product_prompts'`

- [ ] **Step 3: Write minimal implementation**

Create `comfy_extras/_swap_product_prompts.py`:

```python
"""Product-swap instruction text for the Swap Product node.

Kept free of torch / comfy_api / network imports so the prompt building stays
fast and importable in CI (mirrors comfy_extras/_person_swap_prompts.py). The
node places a new product into a finished packshot scene, copying the scene's
background, framing, camera and lighting from the reference image — so results
stay consistent across products without seed-locking.
"""
from __future__ import annotations

SWAP_PRODUCT_PROMPT = (
    "The first image is a finished product photo — a packshot with a fixed "
    "background, surface, camera angle and lighting. The second image shows a "
    "different product. Replace the product in the first image with the product "
    "from the second image, placing it in the same position, scale and "
    "orientation as the original product. Reproduce the second product's shape, "
    "proportions, label, logo, text and colours faithfully — do not invent, "
    "restyle or alter any branding. Relight the new product to match the "
    "scene's lighting direction, colour temperature, shadows and reflections, "
    "and match the camera's lens perspective, depth of field and grain. Keep "
    "EVERYTHING ELSE from the first image identical: the background, surface, "
    "framing and camera angle. Output only the edited scene."
)


def swap_product_instruction(instructions: str = "") -> str:
    """Build the nano-banana-2 instruction for a product swap.

    instructions: optional free-text refinement; appended as an extra sentence
                  when non-blank.
    """
    extra = (instructions or "").strip()
    if extra:
        return f"{SWAP_PRODUCT_PROMPT} Additional direction: {extra}."
    return SWAP_PRODUCT_PROMPT
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python -m pytest tests-unit/comfy_extras_test/swap_product_prompts_test.py -v`
Expected: PASS — 5 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add comfy_extras/_swap_product_prompts.py tests-unit/comfy_extras_test/swap_product_prompts_test.py
git commit -m "feat(swap-product): product-swap prompt builder + unit tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: SwapProductNode backend node + registration

Mirrors `comfy_extras/nodes_person_swap.py`. Two IMAGE inputs, optional instructions, nano-banana-2, missing-image passthrough. Registered in the explicit extras list.

**Files:**
- Create: `comfy_extras/nodes_swap_product.py`
- Modify: `nodes.py` (add `"nodes_swap_product.py"` to the `extras_files` list, after `"nodes_relight.py"` at line 2592)

**Interfaces:**
- Consumes: `swap_product_instruction` from `comfy_extras._swap_product_prompts` (Task 1); the helpers `_run_prediction`, `_image_tensor_to_data_url`, `_first_output_url`, `download_url_to_image_tensor` from `comfy_api_nodes.nodes_replicate` (existing, imported lazily).
- Produces: node type `SwapProductNode` visible via `/object_info` after a ComfyUI restart — consumed by Task 3's frontend registration.

- [ ] **Step 1: Create the node file**

Create `comfy_extras/nodes_swap_product.py`:

```python
from __future__ import annotations

"""Swap Product node — place a new product into a finished packshot scene.

Standard nano-banana-2 API node (no custom Vue renderer). Two wired IMAGE inputs:
`scene_reference` (a finished packshot whose background, framing, camera and
lighting to keep) and `product` (the new product to drop in — a clean cutout or a
plain photo both work). An optional `instructions` field refines the swap. The
scene look is copied from the reference, so results stay consistent across
products without seed-locking. When a required image is missing, the scene passes
through unchanged (no API call).

Sibling to the Person Swap node; this swaps the product instead of the person.
"""

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview, save_generation_output
from comfy_extras._swap_product_prompts import swap_product_instruction


class SwapProductNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SwapProductNode",
            display_name="Swap Product",
            description=(
                "Place a new product into a finished packshot scene (Nano Banana 2). "
                "Wire the finished shot as the scene reference and the new product; "
                "keeps the reference's background, framing, camera and lighting, and "
                "reproduces the new product's branding faithfully. ~$0.05 per swap."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("scene_reference",
                               tooltip="A finished packshot whose background, framing, camera and lighting to keep."),
                IO.Image.Input("product",
                               tooltip="The new product to place into the scene — a clean cutout or a plain photo both work."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction to refine the swap, e.g. \"shift the product slightly left\"."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, scene_reference=None, product=None, instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)

        # Missing a required image → pass the scene through (or a tiny blank). No API call.
        if scene_reference is None or product is None:
            if scene_reference is not None:
                return IO.NodeOutput(scene_reference, ui=save_live_preview(scene_reference, uid))
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))

        # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
        from comfy_api_nodes.nodes_replicate import (
            _run_prediction, _image_tensor_to_data_url,
            _first_output_url, download_url_to_image_tensor,
        )
        input_dict = {
            "prompt": swap_product_instruction(instructions),
            # Order is load-bearing: [0] = scene reference, [1] = new product.
            "image_input": [
                _image_tensor_to_data_url(scene_reference),
                _image_tensor_to_data_url(product),
            ],
            "resolution": "1K",
            "output_format": "png",
        }
        pred = await _run_prediction("google/nano-banana-2", input_dict)
        result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        # Durable output so the swapped result is recorded as an asset (the
        # passthrough/blank guards above stay temp previews — no asset on a no-op).
        return IO.NodeOutput(result, ui=save_generation_output(result, "swap_product"))


class SwapProductExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [SwapProductNode]


async def comfy_entrypoint() -> SwapProductExtension:
    return SwapProductExtension()
```

- [ ] **Step 2: Register the node file in the extras list**

In `nodes.py`, find the `extras_files` list entry `"nodes_relight.py",` (line 2592) and add the new file immediately after it:

```python
        "nodes_person_swap.py",
        "nodes_relight.py",
        "nodes_swap_product.py",
        "nodes_model3d.py",
```

- [ ] **Step 3: Verify the module imports cleanly (no torch/API runtime needed for the import path)**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python -c "import ast; ast.parse(open('comfy_extras/nodes_swap_product.py').read()); print('syntax ok')"`
Expected: `syntax ok`

Then confirm the registration line is present:

Run: `cd /Users/julien/Documents/GitHub/ComfyNext && grep -n "nodes_swap_product.py" nodes.py`
Expected: one match inside the `extras_files` list.

- [ ] **Step 4: Restart ComfyUI and confirm the node loads**

Kill any running ComfyUI, relaunch:
`cd /Users/julien/Documents/GitHub/ComfyNext && .venv/bin/python main.py --listen 127.0.0.1 --port 8188`

Wait for startup, then in another shell confirm the node is registered:
Run: `curl -s http://127.0.0.1:8188/object_info/SwapProductNode | head -c 200`
Expected: JSON describing the `SwapProductNode` (non-empty, contains `"display_name": "Swap Product"`). If empty, check the startup log for a `comfy_extras/ nodes did not import correctly` warning and fix the import error.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add comfy_extras/nodes_swap_product.py nodes.py
git commit -m "feat(swap-product): SwapProductNode (nano-banana-2 two-image swap)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Frontend registration (catalog + icon + brand)

Makes the node discoverable: a use-case card in the Actions panel and the right icon/brand on the canvas title bar. Guarded by a small Vitest spec.

**Files:**
- Modify: `frontend/app/data/action-catalog.ts` (add `SwapProductNode` entry near `BlendSceneNode`)
- Modify: `frontend/app/data/generator-icons.ts` (import `Replace`; add icon entry + `NODE_MODEL_BRAND` entry)
- Test: `frontend/tests/unit/swap-product-catalog.unit.spec.ts`

**Interfaces:**
- Consumes: node type string `SwapProductNode` (Task 2).
- Produces: nothing consumed by later tasks (Task 4 is manual verification).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/swap-product-catalog.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ACTION_CATALOG } from '../../app/data/action-catalog'
import { GENERATOR_NODE_ICONS, NODE_MODEL_BRAND } from '../../app/data/generator-icons'

describe('Swap Product node registration', () => {
  it('has an action-catalog entry (edit intent, Nano Banana 2)', () => {
    const entry = ACTION_CATALOG.SwapProductNode
    expect(entry).toBeDefined()
    expect(entry.intent).toBe('edit')
    expect(entry.model).toBe('Nano Banana 2')
  })

  it('has a canvas icon', () => {
    expect(GENERATOR_NODE_ICONS.SwapProductNode).toBeDefined()
  })

  it('is branded Gemini (Nano Banana)', () => {
    expect(NODE_MODEL_BRAND.SwapProductNode).toBe('Gemini')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext/frontend && npx vitest run tests/unit/swap-product-catalog.unit.spec.ts`
Expected: FAIL — `ACTION_CATALOG.SwapProductNode` is undefined.

- [ ] **Step 3a: Add the action-catalog entry**

In `frontend/app/data/action-catalog.ts`, add this line directly after the `BlendSceneNode` entry (line 47):

```ts
  SwapProductNode:       { useCase: 'Swap a product into a scene', model: 'Nano Banana 2',                            intent: 'edit' },
```

- [ ] **Step 3b: Add the icon import and entry**

In `frontend/app/data/generator-icons.ts`, add `Replace` to the `lucide-vue-next` import block (alongside `Blend`, `Layers`, …):

```ts
  Replace,
```

Then add the icon entry directly after the `BlendSceneNode: Blend,` line (line 66):

```ts
  SwapProductNode:      Replace,
```

- [ ] **Step 3c: Add the model-brand entry**

In `frontend/app/data/generator-icons.ts`, in the `NODE_MODEL_BRAND` object, add directly after the `RelightNode: 'Gemini',` line (line 130):

```ts
  SwapProductNode:      'Gemini',             // Nano Banana 2
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/ComfyNext/frontend && npx vitest run tests/unit/swap-product-catalog.unit.spec.ts`
Expected: PASS — 3 passed

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/ComfyNext
git add frontend/app/data/action-catalog.ts frontend/app/data/generator-icons.ts frontend/tests/unit/swap-product-catalog.unit.spec.ts
git commit -m "feat(swap-product): register Swap Product node in the frontend catalog

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Live render + screenshot sign-off (acceptance gate)

A visual node is not shippable on unit tests alone. Prove it works in the real app and review the result with the user before calling it done. No code, no commit.

**Files:** none.

- [ ] **Step 1: Ensure both servers are running**

- ComfyUI on `127.0.0.1:8188` (restarted in Task 2 so it has the new node).
- Frontend: `cd /Users/julien/Documents/GitHub/ComfyNext/frontend && npm run dev`.

- [ ] **Step 2: Build the swap in the canvas**

- Drop a **Swap Product** node onto the canvas.
- Wire the existing finished packshot (the bottle shot) into `scene_reference`.
- Wire a *different* product image into `product` (a clean cutout or a plain product photo).
- Leave `instructions` empty for the first run.
- Run the node.

- [ ] **Step 3: Capture and inspect the result**

Take a screenshot of the output. Verify against the success criteria:
- The new product sits in the reference scene with the **background, framing, camera angle and lighting visually unchanged** from the reference.
- The new product's **branding/label is reproduced faithfully** (no invented text/logos).
- Run it a second time with the same inputs — the result should be **visually consistent** (drift bounded by the reference, not a seed).

- [ ] **Step 4: Share proof and get sign-off**

Show the user the before/after (reference packshot vs swapped result). Get explicit visual sign-off. If the product's identity drifts or the scene shifts, iterate on `SWAP_PRODUCT_PROMPT` wording (Task 1) and/or try wiring a cleaner cutout, then re-run — do not mark the feature done until the user confirms the look.

---

## Self-Review

**Spec coverage:**
- Surface (new canvas node) → Task 2 + Task 3. ✓
- Backend node, nano-banana-2, `image_input: [scene, product]` → Task 2. ✓
- Prompt with baked-in preserve-branding / match-lighting / match-camera clauses + optional `instructions` → Task 1 (`SWAP_PRODUCT_PROMPT`, `swap_product_instruction`). ✓
- Frontend registration (catalog + icon + brand) → Task 3. ✓
- Unit test (prompt builder) → Task 1. ✓
- Live + screenshot sign-off → Task 4. ✓
- Out-of-scope items (toggles, model picker, seed, batch, person/object) → none added. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected output.

**Type/name consistency:** `SwapProductNode` used identically as backend `node_id`, catalog key, icon key, brand key. `swap_product_instruction` / `SWAP_PRODUCT_PROMPT` defined in Task 1 and consumed by name in Task 2. Helper names (`_run_prediction`, `_image_tensor_to_data_url`, `_first_output_url`, `download_url_to_image_tensor`) match the existing `nodes_replicate.py` exports used by the sibling `PersonSwap` node.
