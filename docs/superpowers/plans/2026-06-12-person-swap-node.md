# Person Swap Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Person Swap" node that replaces the person in a scene image with a different person (identity swap) via `google/nano-banana-2`, preserving the original pose, framing, lighting, and background.

**Architecture:** A torch-free prompt module (`_person_swap_prompts.py`) holds the two instruction templates + a `swap_instruction()` builder so the prompt logic is unit-testable without torch. A standard ComfyUI API node (`nodes_person_swap.py`) takes two wired IMAGE inputs (`scene`, `person`), a `keep_outfit` boolean, and optional `instructions`, then calls nano-banana-2 with `image_input=[scene, person]`. It mirrors the existing Pose Mannequin node's schema/registration, so it inherits regular-node chrome, the header run button (via `is_output_node=True`), and automatic downstream-sink routing — no custom Vue renderer. A toolbox entry makes it addable from the UI.

**Tech Stack:** Python (ComfyUI custom node, `comfy_api.latest.IO`), pytest, nano-banana-2 via Replicate, Vue 3 + TypeScript (toolbox catalog only).

---

## Background the engineer needs

- **The model + helpers.** Generation uses `google/nano-banana-2` through helpers lazily imported from `comfy_api_nodes.nodes_replicate`: `_image_tensor_to_data_url(tensor) -> str`, `_run_prediction(model, input_dict) -> dict`, `_first_output_url(pred) -> str`, `download_url_to_image_tensor(url, cls=cls) -> tensor`. The lazy import (inside `execute`) avoids a `comfy_extras`/`comfy_api_nodes` load-order problem — keep it lazy.
- **The reference node.** [comfy_extras/nodes_pose_mannequin.py](../../comfy_extras/nodes_pose_mannequin.py) is the template: a `class XxxNode(IO.ComfyNode)` with `define_schema()` (returns `IO.Schema(node_id=..., display_name=..., description=..., category="image/generate", inputs=[...], outputs=[IO.Image.Output(display_name="image")], hidden=[IO.Hidden.unique_id], is_output_node=True, price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}'))`) and an `async def execute(cls, ...)`. Registration is an `XxxExtension(ComfyExtension)` with `async def get_node_list(self) -> list[type[IO.ComfyNode]]: return [XxxNode]` plus `async def comfy_entrypoint() -> XxxExtension: return XxxExtension()`. ComfyUI auto-discovers `comfy_extras/nodes_*.py` modules with a `comfy_entrypoint`, so **no central registry edit is needed**.
- **`is_output_node=True`** is what makes the header ▶ Run button appear (the frontend's `showRunButton` checks `data.outputNode`) and lets a no-downstream graph run still execute. Keep it.
- **`save_live_preview(tensor, uid)`** (from `comfy_extras._live_preview`) builds the `ui=` payload so the result previews on the node. `uid = str(cls.hidden.unique_id)`.
- **Two IMAGE inputs arrive as tensors** already — no input-dir loading needed (unlike Pose Mannequin's editor filenames). So this node does NOT need `numpy`, `PIL`, `folder_paths`, or a `_load_input_image` helper.
- **Dependency-light prompt module convention:** `comfy_extras/_pose_prompts.py` and `comfy_api_nodes/replicate_refs.py` are kept import-light (only `from __future__ import annotations`) so their logic is unit-testable in CI without torch. Follow that for `_person_swap_prompts.py`.
- **Schema-change gotcha:** adding a Python node requires a ComfyUI restart to load into `object_info` (the dev supervisor relaunches it when the 8188 pid is killed). Frontend toolbox change is HMR.

---

## File Structure

- **Create** `comfy_extras/_person_swap_prompts.py` — `KEEP_OUTFIT_PROMPT`, `NEW_LOOK_PROMPT`, `swap_instruction()`. Torch-free.
- **Create** `tests-unit/comfy_extras_test/person_swap_prompts_test.py` — unit tests for `swap_instruction`.
- **Create** `comfy_extras/nodes_person_swap.py` — `PersonSwapNode` + `PersonSwapExtension` + `comfy_entrypoint`.
- **Modify** `frontend/app/data/toolbox-items.ts` — one entry in the AI section.

---

## Task 1: Prompt module + tests (torch-free)

**Files:**
- Create: `comfy_extras/_person_swap_prompts.py`
- Test: `tests-unit/comfy_extras_test/person_swap_prompts_test.py`

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/person_swap_prompts_test.py`:

```python
"""Unit tests for person-swap instruction building (comfy_extras._person_swap_prompts).

Dependency-light by design: no torch, no comfy_api, no network — so the
keep-outfit-vs-new-look prompt selection stays fast and importable in CI.
"""
from comfy_extras import _person_swap_prompts as ps


def test_keep_outfit_true_uses_keep_outfit_prompt():
    assert ps.swap_instruction(True, "") == ps.KEEP_OUTFIT_PROMPT


def test_keep_outfit_false_uses_new_look_prompt():
    assert ps.swap_instruction(False, "") == ps.NEW_LOOK_PROMPT


def test_instructions_appended_when_present():
    out = ps.swap_instruction(True, "replace the woman on the left")
    assert out.startswith(ps.KEEP_OUTFIT_PROMPT)
    assert "Additional direction: replace the woman on the left." in out


def test_no_instructions_appended_when_blank():
    assert ps.swap_instruction(True, "   ") == ps.KEEP_OUTFIT_PROMPT
    assert ps.swap_instruction(False, "") == ps.NEW_LOOK_PROMPT


def test_keep_outfit_prompt_preserves_wardrobe_language():
    # The whole point of keep_outfit: the original clothing must be retained.
    assert "outfit" in ps.KEEP_OUTFIT_PROMPT.lower() or "clothing" in ps.KEEP_OUTFIT_PROMPT.lower()


def test_new_look_prompt_brings_new_wardrobe():
    assert "clothing" in ps.NEW_LOOK_PROMPT.lower() or "wardrobe" in ps.NEW_LOOK_PROMPT.lower()
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/person_swap_prompts_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._person_swap_prompts'`.

- [ ] **Step 3: Write the module**

Create `comfy_extras/_person_swap_prompts.py`:

```python
"""Person-swap instruction text for the Person Swap node's two outfit modes.

Kept free of torch / comfy_api / network imports so the keep-outfit-vs-new-look
prompt selection is unit-testable in CI (mirrors comfy_extras/_pose_prompts.py).
"""
from __future__ import annotations

# keep_outfit = True: swap identity only, keep the original scene's wardrobe.
KEEP_OUTFIT_PROMPT = (
    "The first image is a scene containing a person. The second image shows a "
    "different person (their identity/likeness). Replace the person in the first "
    "image with the person from the second image — give them the second person's "
    "face, hair, skin tone and body type — but keep EVERYTHING ELSE from the first "
    "image identical: the same clothing/outfit, the same body pose and stance, the "
    "same framing, camera angle, background and lighting. Only the person's "
    "identity changes; the wardrobe and the scene stay exactly as they are. Do not "
    "restyle, recolor or redraw the clothing. Output only the edited scene."
)

# keep_outfit = False: bring the new person AND their own clothing/style.
NEW_LOOK_PROMPT = (
    "The first image is a scene containing a person. The second image shows a "
    "different person. Replace the person in the first image with the person from "
    "the second image, bringing the second person's own appearance AND their "
    "clothing/style. Keep the first image's body pose and stance, framing, camera "
    "angle, background and lighting unchanged — only the person and their wardrobe "
    "become the second person. Output only the edited scene."
)


def swap_instruction(keep_outfit: bool, instructions: str = "") -> str:
    """Build the nano-banana-2 instruction for a person swap.

    keep_outfit:  True → keep the original scene's wardrobe (identity-only swap);
                  False → bring the new person's own clothing too.
    instructions: optional free-text direction (also the multi-person targeting
                  hint, e.g. "replace the woman on the left"); appended when set.
    """
    base = KEEP_OUTFIT_PROMPT if keep_outfit else NEW_LOOK_PROMPT
    extra = (instructions or "").strip()
    if extra:
        return f"{base} Additional direction: {extra}."
    return base
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/person_swap_prompts_test.py -v`
Expected: PASS — 6 passed.

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/_person_swap_prompts.py tests-unit/comfy_extras_test/person_swap_prompts_test.py
git commit -m "feat(person-swap): dependency-light swap-instruction builder + tests"
```

---

## Task 2: The PersonSwap node

**Files:**
- Create: `comfy_extras/nodes_person_swap.py`

- [ ] **Step 1: Write the node module**

Create `comfy_extras/nodes_person_swap.py`:

```python
from __future__ import annotations

"""Person Swap node — replace the person in a scene with a different person.

Standard nano-banana-2 API node (no custom Vue renderer). Two wired IMAGE inputs:
`scene` (the image whose person to replace) and `person` (a reference photo of the
new person). A `keep_outfit` toggle decides whether the original wardrobe is kept
(identity-only swap, the default) or the new person's own clothing is brought in.
The original pose, framing, background and lighting are always preserved. When a
required image is missing, the scene passes through unchanged (no API call).

Sibling to the face-only Face Swap node; this swaps the whole person.
"""

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview
from comfy_extras._person_swap_prompts import swap_instruction


class PersonSwapNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="PersonSwap",
            display_name="Person Swap",
            description=(
                "Replace the person in a scene with a different person (Nano Banana 2). "
                "Wire the scene and a reference photo of the new person. Keeps the "
                "original pose, framing, background and lighting; the outfit toggle "
                "keeps or replaces the wardrobe."
            ),
            category="image/generate",
            inputs=[
                IO.Image.Input("scene", tooltip="The image containing the person to replace."),
                IO.Image.Input("person", tooltip="A reference photo of the new person."),
                IO.Boolean.Input("keep_outfit", default=True, optional=True,
                                 tooltip="On: keep the original outfit, swap identity only. Off: bring the new person's own clothing too."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction. Also targets a specific person in a crowd, e.g. \"replace the woman on the left\"."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, scene=None, person=None, keep_outfit=True, instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)

        # Nothing to swap with → pass the scene through (or a tiny blank). No API call.
        if scene is None or person is None:
            if scene is not None:
                return IO.NodeOutput(scene, ui=save_live_preview(scene, uid))
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))

        # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
        from comfy_api_nodes.nodes_replicate import (
            _run_prediction, _image_tensor_to_data_url,
            _first_output_url, download_url_to_image_tensor,
        )
        input_dict = {
            "prompt": swap_instruction(bool(keep_outfit), instructions),
            "image_input": [_image_tensor_to_data_url(scene), _image_tensor_to_data_url(person)],
            "resolution": "1K",
            "output_format": "png",
        }
        pred = await _run_prediction("google/nano-banana-2", input_dict)
        result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(result, ui=save_live_preview(result, uid))


class PersonSwapExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [PersonSwapNode]


async def comfy_entrypoint() -> PersonSwapExtension:
    return PersonSwapExtension()
```

- [ ] **Step 2: Verify the module imports + schema is well-formed**

Run: `.venv/bin/python -c "import comfy_extras.nodes_person_swap as m; s=m.PersonSwapNode.define_schema(); print(s.node_id, [i.id for i in s.inputs])"`
Expected: prints `PersonSwap ['scene', 'person', 'keep_outfit', 'instructions']` with no ImportError. (If the `IO.Schema` input objects expose the name under a different attribute than `.id`, adjust the debug print only — the schema itself is correct; do not change the node.)

- [ ] **Step 3: Re-run the prompt unit tests (guards against a constant/signature rename)**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/person_swap_prompts_test.py -v`
Expected: PASS — 6 passed.

- [ ] **Step 4: Commit**

```bash
git add comfy_extras/nodes_person_swap.py
git commit -m "feat(person-swap): PersonSwap nano-banana-2 node (scene + person → swap)"
```

---

## Task 3: Toolbox entry

**Files:**
- Modify: `frontend/app/data/toolbox-items.ts`

- [ ] **Step 1: Add the icon import**

In `frontend/app/data/toolbox-items.ts`, find the `lucide-vue-next` import statement (it already imports many icons like `UserRoundCog`, `Maximize`, etc.). Add `UsersRound` to that import list (keep it alphabetical if the list is alphabetical; otherwise append). Example — if the line is:

```ts
import { /* …existing… */, UserRoundCog, /* …existing… */ } from 'lucide-vue-next'
```

ensure `UsersRound` is included:

```ts
import { /* …existing… */, UserRoundCog, UsersRound, /* …existing… */ } from 'lucide-vue-next'
```

(If `UsersRound` is already imported, skip this step.)

- [ ] **Step 2: Add the toolbox item to the AI section**

In `frontend/app/data/toolbox-items.ts`, find the `title: 'AI'` group (its `items` array starts with the `FaceSwap` entry). Add this line immediately after the `FaceSwap` entry. Note: NO `requiresModels` field — Person Swap is an API node (Replicate), nothing to download locally:

```ts
      { nodeType: 'PersonSwap', label: 'Person Swap', description: 'Replace the person in a scene with a different person — wire the scene and a reference photo. Keeps the original pose, framing and background. ~$0.05 per run.', icon: UsersRound },
```

- [ ] **Step 3: Type-check the file**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep toolbox-items | wc -l`
Expected: `0` (no new errors introduced by this file).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/data/toolbox-items.ts
git commit -m "feat(person-swap): add Person Swap to the AI toolbox section"
```

---

## Task 4: In-browser verification (manual, real generations)

**Files:** none (verification only).

**Prereqs:** New Python node → restart ComfyUI. Per the dev-environment setup, KILL the ComfyUI pid (the supervisor relaunches it on 8188). Then hard-reload the frontend.

- [ ] **Step 1: Restart backend + confirm the node registered**

Kill the ComfyUI process so the supervisor relaunches it with the new node, then:

Run: `curl -s 127.0.0.1:8188/object_info/PersonSwap | python3 -c "import sys,json; d=json.load(sys.stdin); print(list(d['PersonSwap']['input'].get('required',{}).keys()), list(d['PersonSwap']['input'].get('optional',{}).keys()))"`
Expected: required includes `scene`, `person`; optional includes `keep_outfit`, `instructions`.

- [ ] **Step 2: Add the node from the toolbox**

In the browser (use `127.0.0.1:PORT`, not `localhost`): open the toolbox → AI section → confirm "Person Swap" appears with the people icon. Add it. Confirm it renders as a regular node with a header ▶ run button and a ~$0.05 price chip.

- [ ] **Step 3: Keep-outfit swap — real generation (~$0.05)**

Wire a scene image (a person in a setting) into `scene` and a reference photo of a different person into `person`. Leave `keep_outfit` ON. Click the header ▶. Expected: a downstream image node receives the result — the new person's identity in the SAME outfit, pose, framing, and background as the scene.

- [ ] **Step 4: New-look swap — real generation (~$0.05)**

Toggle `keep_outfit` OFF, run again. Expected: the new person now wears their OWN clothing (from the reference), while pose/framing/background stay from the scene.

- [ ] **Step 5: Multi-person targeting (optional, ~$0.05)**

On a scene with two people, type a hint in `instructions` (e.g. "replace the person on the right"), run. Expected: the targeted person is the one swapped.

- [ ] **Step 6: Record results**

Append a short "Verification" note (pass/fail per mode + output-quality observations) to this plan file and commit:

```bash
git add docs/superpowers/plans/2026-06-12-person-swap-node.md
git commit -m "docs(person-swap): record in-browser verification results"
```

---

## Self-review notes

- **Spec coverage:** standard API node, no custom renderer (Task 2) ✓; nano-banana-2 + lazy helpers (Task 2) ✓; wired `scene` + `person` IMAGE inputs (Task 2) ✓; `keep_outfit` boolean default on (Task 2) ✓; `instructions` optional + multi-person hint (Tasks 1–2, 4) ✓; two prompt templates via `swap_instruction` in a torch-free module + unit tests (Task 1) ✓; missing-input passthrough guard (Task 2) ✓; `is_output_node=True` + price badge (Task 2) ✓; toolbox entry, no `requiresModels` (Task 3) ✓; in-browser verification per outfit state (Task 4) ✓.
- **Naming consistency:** `swap_instruction`, `KEEP_OUTFIT_PROMPT`, `NEW_LOOK_PROMPT`, node_id `PersonSwap`, inputs `scene`/`person`/`keep_outfit`/`instructions` are used identically across the test, prompt module, node, and toolbox entry.
- **YAGNI:** no `_load_input_image`/numpy/PIL (images are wired tensors); no custom Vue component (standard node path covers chrome + run + sink routing); character-library picker and mask targeting explicitly deferred per spec.
