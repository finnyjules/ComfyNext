# AI Edit Actions Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five AI edit actions — one-click Remove Object, Cut-out-subject on Frame layers, Harmonize Layer, Text Edit, Recolor Object — per the approved spec `docs/superpowers/specs/2026-07-08-ai-edit-actions-design.md`.

**Architecture:** All engines are cloud (nano-banana-2 / SAM / FLUX Fill / Replicate bg-remover) reached through the five existing Nitro routes under `/api/inpaint/*` — **zero new server routes**. Three new ComfyUI Python nodes (`RemoveObjectNode`, `TextEditNode`, `RecolorObjectNode`) clone the SwapProduct V3 pattern for the graph/agent surface. Interactive surfaces are the artifact Edit menu, the InpaintModal (new `intent` prop), and the CompositorModal's image-layer inspector (Cut out subject + Harmonize, both replacing layer content in place with one undo step).

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, vitest (`cd frontend && npm run test:unit`), ComfyUI V3 node API (`comfy_api.latest.IO`), pytest (`.venv/bin/python -m pytest tests-unit/comfy_extras_test/`).

## Global Constraints

- Commit directly to `main`; do NOT create feature branches.
- Stage ONLY the files you touched, with explicit paths — NEVER `git add -A`.
- Actions = cloud/billed (pastel affordance `gen-pastel`); Toolbox = local/free. The existing local `ObjectRemove` (LaMa, mask-input, Toolbox) is a DIFFERENT node from the new cloud `RemoveObjectNode` — do not merge or rename either.
- Pink (`--var-accent` #f472b6) = variable-bound; pastel gradient = AI; never purple accents.
- Any `shared/**` import in frontend code must use the `~~/` alias, never a relative path.
- New Python nodes register only after a ComfyUI restart (kill the process; the dev supervisor restarts it — do not leave it dead). Bridge JS is not hot-reloaded either.
- Paid render sign-off is user-owned: verify mechanics in the browser (menus, network calls firing, UI states), but do NOT claim end-to-end visual success for paid generations — report and hand off.
- Escalator/spawn actions from an artifact must pass `branch: true` so existing downstream chains keep running unchanged.
- Deviation from spec (already reflected here): the spec's "OCR pre-fill chips" for Text Edit are DEFERRED (no OCR server route exists; v1 ships the free-text find/replace degrade path, which the spec already defines). The spec's "Frame layer context menu" is implemented as inspector buttons in CompositorModal (no layer context menu exists on either Frame surface today; building one is out of scope). The spec's §2 Edit-menu entry already exists (local `BackgroundRemove` splice at ArtifactImageNode.vue:711) — skip it.

---

### Task 1: Python prompt builders

**Files:**
- Create: `comfy_extras/_edit_action_prompts.py`
- Test: `tests-unit/comfy_extras_test/edit_action_prompts_test.py`

**Interfaces:**
- Consumes: nothing (dependency-light module: no torch, no comfy_api, no network — mirrors `comfy_extras/_swap_product_prompts.py`).
- Produces: `remove_object_instruction(target: str, instructions: str = "") -> str`, `text_edit_instruction(find: str, replace: str, instructions: str = "") -> str`, `recolor_instruction(target: str, color: str, instructions: str = "") -> str`. Task 2 imports all three.

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/edit_action_prompts_test.py`:

```python
"""Unit tests for edit-action instruction building
(comfy_extras._edit_action_prompts). Dependency-light by design: no torch, no
comfy_api, no network — fast and importable in CI.
"""
from comfy_extras import _edit_action_prompts as ep


# ── remove_object_instruction ────────────────────────────────────────────────

def test_remove_names_the_target():
    out = ep.remove_object_instruction("the red car")
    assert "the red car" in out


def test_remove_fills_with_background():
    # The hole must be filled from the surrounding scene, not left blank or
    # replaced with something new.
    low = ep.remove_object_instruction("a lamppost").lower()
    assert "background" in low or "surrounding" in low
    assert "remove" in low


def test_remove_keeps_everything_else():
    low = ep.remove_object_instruction("a lamppost").lower()
    assert "everything else" in low or "keep" in low


def test_remove_appends_extra_instructions():
    out = ep.remove_object_instruction("the sign", "match the wall texture")
    assert out.endswith("Additional direction: match the wall texture.")


def test_remove_strips_blank_instructions():
    assert ep.remove_object_instruction("x", "   ") == ep.remove_object_instruction("x")


# ── text_edit_instruction ────────────────────────────────────────────────────

def test_text_edit_quotes_find_and_replace():
    out = ep.text_edit_instruction("SALE", "50% OFF")
    assert "'SALE'" in out and "'50% OFF'" in out


def test_text_edit_preserves_typography():
    # Regression guard: without this clause the model redraws the whole sign.
    low = ep.text_edit_instruction("a", "b").lower()
    assert "font" in low and "perspective" in low
    assert "change nothing else" in low or "everything else" in low


def test_text_edit_appends_extra_instructions():
    out = ep.text_edit_instruction("a", "b", "keep the neon glow")
    assert out.endswith("Additional direction: keep the neon glow.")


# ── recolor_instruction ──────────────────────────────────────────────────────

def test_recolor_names_target_and_color():
    out = ep.recolor_instruction("the shirt", "forest green (#2d6a4f)")
    assert "the shirt" in out and "forest green (#2d6a4f)" in out


def test_recolor_keeps_material_and_lighting():
    # The point of recolor vs regenerate: texture, shading and lighting stay.
    low = ep.recolor_instruction("the shirt", "red").lower()
    assert "texture" in low and "lighting" in low
    assert "material" in low or "shading" in low


def test_recolor_appends_extra_instructions():
    out = ep.recolor_instruction("the mug", "#ff0000", "matte finish")
    assert out.endswith("Additional direction: matte finish.")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/edit_action_prompts_test.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._edit_action_prompts'`

- [ ] **Step 3: Write the implementation**

Create `comfy_extras/_edit_action_prompts.py`:

```python
"""Edit-action instruction text for the Remove Object / Text Edit / Recolor
Object nodes (comfy_extras/nodes_edit_actions.py).

Kept free of torch / comfy_api / network imports so prompt building stays fast
and importable in CI (mirrors comfy_extras/_swap_product_prompts.py). Each
builder returns a complete nano-banana-2 instruction; the shared `_finish`
appends the user's optional free-text refinement.
"""
from __future__ import annotations


def _finish(base: str, instructions: str = "") -> str:
    extra = (instructions or "").strip()
    if extra:
        return f"{base} Additional direction: {extra}."
    return base


def remove_object_instruction(target: str, instructions: str = "") -> str:
    """Instruction to erase a described object and fill the hole from the scene."""
    base = (
        f"Remove {target.strip()} from the image completely. Fill the area it "
        "occupied by seamlessly continuing the surrounding background — match "
        "the scene's textures, perspective, lighting and grain so no trace, "
        "outline or shadow of the removed object remains. "
        "Keep EVERYTHING ELSE in the image exactly as it is: composition, "
        "framing, colours, other subjects and overall lighting. "
        "Output only the edited image."
    )
    return _finish(base, instructions)


def text_edit_instruction(find: str, replace: str, instructions: str = "") -> str:
    """Instruction to replace rendered text in the image, keeping typography."""
    base = (
        f"Find the text '{find.strip()}' in the image and replace it with "
        f"'{replace.strip()}'. Match the original typography exactly: the same "
        "font, weight, size, colour, letter-spacing, perspective, distortion "
        "and lighting, so the new text looks native to the image. "
        "Change NOTHING ELSE — every other pixel, object and text element "
        "stays exactly as it is. Output only the edited image."
    )
    return _finish(base, instructions)


def recolor_instruction(target: str, color: str, instructions: str = "") -> str:
    """Instruction to recolor a described object while keeping its material."""
    base = (
        f"Change the colour of {target.strip()} to {color.strip()}. "
        "Keep the object's material, texture, shading, highlights, reflections "
        "and the scene's lighting exactly as they are — only the object's base "
        "colour changes, as if the same object had been manufactured in the "
        "new colour. Keep EVERYTHING ELSE in the image untouched. "
        "Output only the edited image."
    )
    return _finish(base, instructions)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/edit_action_prompts_test.py -q`
Expected: `11 passed`

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add comfy_extras/_edit_action_prompts.py tests-unit/comfy_extras_test/edit_action_prompts_test.py
git commit -m "feat(edit-actions): prompt builders for remove/text-edit/recolor instructions"
```

---

### Task 2: Three cloud edit-action Python nodes

**Files:**
- Create: `comfy_extras/nodes_edit_actions.py`
- Modify: `nodes.py` (the extras filename list around line 2592 — insert after `"nodes_swap_product.py",`)

**Interfaces:**
- Consumes: `remove_object_instruction`, `text_edit_instruction`, `recolor_instruction` from Task 1; `save_live_preview`, `save_generation_output` from `comfy_extras._live_preview`; `_run_prediction`, `_image_tensor_to_data_url`, `_first_output_url`, `download_url_to_image_tensor` (lazy) from `comfy_api_nodes.nodes_replicate`.
- Produces: ComfyUI nodes `RemoveObjectNode`, `TextEditNode`, `RecolorObjectNode` — each `IO.Image.Input("image")` + string widgets, one `IO.Image.Output`, `price_badge` $0.05. Tasks 4 and 7 reference these node ids and widget names (`target`, `find`, `replace`, `color`, `instructions`).

- [ ] **Step 1: Write the node module**

Create `comfy_extras/nodes_edit_actions.py`:

```python
from __future__ import annotations

"""Cloud edit-action nodes — Remove Object, Text Edit, Recolor Object.

Three standard nano-banana-2 API nodes (no custom Vue renderer), siblings of
the Swap Product node. Each takes ONE wired IMAGE plus text widgets and runs a
single instruction edit. When the image or a required string is missing, the
image passes through unchanged (no API call, no charge).

NOT to be confused with the local, mask-input ObjectRemove (LaMa) node in the
Toolbox — these are prompt-driven cloud Actions.
"""

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview, save_generation_output
from comfy_extras._edit_action_prompts import (
    remove_object_instruction,
    text_edit_instruction,
    recolor_instruction,
)

_PRICE = IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}')


async def _nano_edit(image, prompt: str, asset_tag: str) -> IO.NodeOutput:
    """Run one nano-banana-2 instruction edit on a single image."""
    # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
    from comfy_api_nodes.nodes_replicate import (
        _run_prediction, _image_tensor_to_data_url,
        _first_output_url, download_url_to_image_tensor,
    )
    input_dict = {
        "prompt": prompt,
        "image_input": [_image_tensor_to_data_url(image)],
        "resolution": "1K",
        "output_format": "png",
    }
    pred = await _run_prediction("google/nano-banana-2", input_dict)
    result = await download_url_to_image_tensor(_first_output_url(pred))
    # Durable output so the edit is recorded as an asset.
    return IO.NodeOutput(result, ui=save_generation_output(result, asset_tag))


def _passthrough(image, uid: str) -> IO.NodeOutput:
    """No-op guard: return the input (or a tiny blank) as a temp preview."""
    if image is not None:
        return IO.NodeOutput(image, ui=save_live_preview(image, uid))
    blank = torch.zeros(1, 16, 16, 3)
    return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))


class RemoveObjectNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="RemoveObjectNode",
            display_name="Remove Object",
            description=(
                "Erase a described object and seamlessly fill the hole from the "
                "surrounding scene (Nano Banana 2). Describe what to remove — "
                "no mask needed. ~$0.05 per edit."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("image", tooltip="The image to edit."),
                IO.String.Input("target", multiline=False, default="",
                                tooltip="What to remove, e.g. \"the red car on the left\"."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction, e.g. \"match the brick texture\"."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=_PRICE,
        )

    @classmethod
    async def execute(cls, image=None, target="", instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)
        if image is None or not (target or "").strip():
            return _passthrough(image, uid)
        return await _nano_edit(image, remove_object_instruction(target, instructions), "remove_object")


class TextEditNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="TextEditNode",
            display_name="Edit Text",
            description=(
                "Find and replace rendered text inside the image (Nano Banana 2), "
                "matching the original font, colour, perspective and lighting. "
                "~$0.05 per edit."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("image", tooltip="The image containing the text."),
                IO.String.Input("find", multiline=False, default="",
                                tooltip="The exact text currently in the image, e.g. \"SALE\"."),
                IO.String.Input("replace", multiline=False, default="",
                                tooltip="The new text, e.g. \"50% OFF\"."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction, e.g. \"keep the neon glow\"."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=_PRICE,
        )

    @classmethod
    async def execute(cls, image=None, find="", replace="", instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)
        if image is None or not (find or "").strip() or not (replace or "").strip():
            return _passthrough(image, uid)
        return await _nano_edit(image, text_edit_instruction(find, replace, instructions), "text_edit")


class RecolorObjectNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="RecolorObjectNode",
            display_name="Recolor Object",
            description=(
                "Change a described object's colour while keeping its material, "
                "texture and the scene's lighting (Nano Banana 2). The color "
                "input is variable-bindable for campaign batches. ~$0.05 per edit."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("image", tooltip="The image to edit."),
                IO.String.Input("target", multiline=False, default="",
                                tooltip="What to recolor, e.g. \"the shirt\"."),
                IO.String.Input("color", multiline=False, default="",
                                tooltip="The new colour — a name, hex, or both, e.g. \"forest green (#2d6a4f)\"."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction, e.g. \"matte finish\"."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=_PRICE,
        )

    @classmethod
    async def execute(cls, image=None, target="", color="", instructions="") -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)
        if image is None or not (target or "").strip() or not (color or "").strip():
            return _passthrough(image, uid)
        return await _nano_edit(image, recolor_instruction(target, color, instructions), "recolor_object")


class EditActionsExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [RemoveObjectNode, TextEditNode, RecolorObjectNode]


async def comfy_entrypoint() -> EditActionsExtension:
    return EditActionsExtension()
```

Note: `download_url_to_image_tensor(_first_output_url(pred))` — check the call sites in `comfy_extras/nodes_swap_product.py:78` first; if that file passes `cls=cls`, do the same here (`download_url_to_image_tensor(_first_output_url(pred), cls=cls)`).

- [ ] **Step 2: Register the module**

In `nodes.py`, find the extras list (search for `"nodes_swap_product.py",` around line 2593) and insert after it:

```python
        "nodes_edit_actions.py",
```

- [ ] **Step 3: Verify registration**

Kill the running ComfyUI process (the dev supervisor restarts it — do NOT start a second instance), wait for boot, then:

Run: `curl -s http://127.0.0.1:8188/object_info | python3 -c "import json,sys; d=json.load(sys.stdin); print([k for k in d if k in ('RemoveObjectNode','TextEditNode','RecolorObjectNode')])"`
Expected: `['RemoveObjectNode', 'TextEditNode', 'RecolorObjectNode']`

Also run the full extras test dir to catch import regressions:
Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/ -q`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add comfy_extras/nodes_edit_actions.py nodes.py
git commit -m "feat(edit-actions): RemoveObject / TextEdit / RecolorObject cloud nodes (nano-banana-2)"
```

---

### Task 3: Frontend prompt utils

**Files:**
- Create: `frontend/app/lib/editActions/prompts.ts`
- Test: `frontend/tests/unit/edit-action-prompts.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (pure functions).
- Produces: `recolorPrompt(colorLabel: string): string` (Task 6 sends it to flux-fill) and `HARMONIZE_PROMPT: string` (Task 9 sends it to nano-gen).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/edit-action-prompts.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { recolorPrompt, HARMONIZE_PROMPT } from '~/lib/editActions/prompts'

describe('recolorPrompt', () => {
  it('names the color', () => {
    expect(recolorPrompt('forest green (#2d6a4f)')).toContain('forest green (#2d6a4f)')
  })
  it('keeps material and lighting (masked recolor, not regenerate)', () => {
    const low = recolorPrompt('red').toLowerCase()
    expect(low).toContain('texture')
    expect(low).toContain('lighting')
  })
  it('describes the masked object generically (flux-fill sees only the region)', () => {
    // The SAM mask picks the object; the prompt must not require a target name.
    expect(recolorPrompt('#ff0000').toLowerCase()).toContain('same object')
  })
})

describe('HARMONIZE_PROMPT', () => {
  it('relights the second image to the first', () => {
    const low = HARMONIZE_PROMPT.toLowerCase()
    expect(low).toContain('second image')
    expect(low).toContain('first image')
    expect(low).toMatch(/relight|re-light/)
  })
  it('preserves identity, shape and framing', () => {
    const low = HARMONIZE_PROMPT.toLowerCase()
    expect(low).toContain('identity')
    expect(low).toContain('shape')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/edit-action-prompts.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/editActions/prompts`

- [ ] **Step 3: Write the implementation**

Create `frontend/app/lib/editActions/prompts.ts`:

```typescript
/**
 * Prompt builders for the interactive edit actions (Recolor in the
 * InpaintModal, Harmonize in the Compositor). The graph-node siblings build
 * their prompts Python-side in comfy_extras/_edit_action_prompts.py — keep the
 * two in the same spirit if you tune one.
 */

/** Masked recolor via FLUX Fill: the SAM mask already isolates the object, so
 *  the prompt describes the SAME object in a new colour — never a replacement. */
export function recolorPrompt(colorLabel: string): string {
  return (
    `the exact same object recolored to ${colorLabel.trim()}, identical shape ` +
    'and material, keeping its texture, shading, highlights, reflections and ' +
    'the scene\'s lighting unchanged — only the base colour is different'
  )
}

/** Two-image nano-banana-2 edit: [scene crop, layer cutout] → the cutout
 *  relit/graded to sit in the scene. Order is load-bearing. */
export const HARMONIZE_PROMPT =
  'The first image is a scene. The second image is an object that will be ' +
  'composited into that scene. Relight and color-grade the object in the ' +
  'second image so it is physically lit by the first image\'s scene: match ' +
  'the lighting direction, colour temperature, contrast and falloff. Keep the ' +
  'object\'s identity, shape, proportions, pose and framing EXACTLY as in the ' +
  'second image — same silhouette, same camera, no repositioning, no added ' +
  'background. Return the object alone on a plain uniform background. ' +
  'Output only the edited object image.'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/edit-action-prompts.unit.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/editActions/prompts.ts frontend/tests/unit/edit-action-prompts.unit.spec.ts
git commit -m "feat(edit-actions): frontend prompt builders for recolor + harmonize"
```

---

### Task 4: Action catalog entries

**Files:**
- Modify: `frontend/app/data/action-catalog.ts` (the `// -- Image · edit --` block, after the `RotateCameraNode` line)
- Test: `frontend/tests/unit/action-catalog.unit.spec.ts` (existing — must stay green)

**Interfaces:**
- Consumes: node ids from Task 2.
- Produces: catalog entries so the Actions panel, start-modal and agent planning see the new nodes.

- [ ] **Step 1: Add the three entries**

In `frontend/app/data/action-catalog.ts`, after the `RotateCameraNode:` line, add:

```typescript
  RemoveObjectNode:      { useCase: 'Remove an object',               model: 'Nano Banana 2',                            intent: 'edit', source: 'image' },
  TextEditNode:          { useCase: 'Edit text in an image',          model: 'Nano Banana 2',                            intent: 'edit', source: 'image' },
  RecolorObjectNode:     { useCase: 'Recolor an object',              model: 'Nano Banana 2',                            intent: 'edit', source: 'image' },
```

- [ ] **Step 2: Run the catalog test**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npx vitest run tests/unit/action-catalog.unit.spec.ts`
Expected: PASS. If a test asserts an exact entry count, update that count — nothing else.

- [ ] **Step 3: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/data/action-catalog.ts
git commit -m "feat(edit-actions): catalog entries for RemoveObject / TextEdit / RecolorObject"
```

(If the count assertion changed, include `frontend/tests/unit/action-catalog.unit.spec.ts` in the `git add`.)

---

### Task 5: One-click Remove Object (Edit menu → InpaintModal intent)

**Files:**
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (menu entry near line 715; new function near `openInpaint` at line 249)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (`handleOpenInpaint` around line 3008; the `<InpaintModal>` usage in the template)
- Modify: `frontend/app/components/vue-canvas/InpaintModal.vue` (props line 20; tool init; `doSamSelect` line 381)

**Interfaces:**
- Consumes: existing `sailor:openInpaint` event, `doSamSelect()`, `runInpaint(removeMode)` (InpaintModal.vue:317), `tool` ref (line 110).
- Produces: `intent?: 'remove' | 'recolor'` prop on InpaintModal and an `intent` field on the `sailor:openInpaint` event detail. Task 6 reuses both.

- [ ] **Step 1: ArtifactImageNode — menu entry + intent event**

Below `openInpaint()` (line ~252), add:

```typescript
// One-click remove: open the inpaint editor pre-set to click-select, which
// auto-runs a removal as soon as an object is picked.
function openRemoveObject() {
  window.dispatchEvent(new CustomEvent('sailor:openInpaint', { detail: { nodeId: props.id, intent: 'remove' } }))
}
```

In the Edit menu template, after the `Inpaint` button (line ~717), add:

```vue
              <button class="edit-menu-item" @click.stop="runAction(openRemoveObject)">
                <Scissors class="size-3 shrink-0" /> Remove object
                <span class="edit-menu-hint">click it</span>
              </button>
```

Add `Scissors` to the existing `lucide-vue-next` import. (GOTCHA from memory: a lucide icon named `Map` once shadowed the global — check the new icon name doesn't collide with anything in scope.)

- [ ] **Step 2: VueNodeCanvas — carry the intent**

In `handleOpenInpaint` (line ~3008), capture the intent alongside the id:

```typescript
const inpaintIntent = ref<'remove' | 'recolor' | null>(null)

function handleOpenInpaint(e: Event) {
  const detail = (e as CustomEvent).detail
  if (detail?.nodeId) {
    inpaintOpenForId.value = String(detail.nodeId)
    inpaintIntent.value = detail.intent === 'remove' || detail.intent === 'recolor' ? detail.intent : null
  }
}
```

(Declare `inpaintIntent` next to the existing `inpaintOpenForId` declaration, not inside the handler.) Pass it to the modal in the template where `<InpaintModal>` is rendered, and clear it on close:

```vue
<InpaintModal v-if="inpaintOpenForId" :node-id="inpaintOpenForId" :nodes="nodes" :edges="edges"
              :intent="inpaintIntent" @close="inpaintOpenForId = null; inpaintIntent = null" />
```

(Adapt to the existing binding — only ADD `:intent` and the `inpaintIntent = null` reset; keep everything else as-is.)

- [ ] **Step 3: InpaintModal — accept the intent and auto-run**

Extend props (line 20):

```typescript
const props = defineProps<{
  nodeId: string
  nodes: any[]
  edges: any[]
  intent?: 'remove' | 'recolor' | null
}>()
```

After the `tool` ref setup (line ~110), default intents to click-select:

```typescript
// Intent flows (Remove object / Recolor) start on click-select: one click on
// the object is the whole gesture.
if (props.intent) tool.value = 'select'
```

In `doSamSelect` (line 381), after `brush.clear()`, auto-run removal:

```typescript
    samMask.value = imageToDataUrl(m, out.value.w, out.value.h)
    brush.clear()
    // Remove intent: the click IS the command — erase immediately.
    if (props.intent === 'remove') await runInpaint(true)
```

Note: `runInpaint` is declared later in the file — Vue SFC setup scope hoists function declarations, so the call is fine; do NOT reorder the file.

- [ ] **Step 4: Verify in the browser (free mechanics only)**

Start the dev preview, open a canvas with an image artifact, then: Edit menu → "Remove object" → modal opens with the select tool active. Click the image → confirm via the network panel that `/api/inpaint/segment` fires and then `/api/inpaint/flux-fill` fires with an empty `prompt`. (The flux-fill call is paid — ONE verification run is acceptable; do not loop.) Screenshot the modal state for the user.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/ArtifactImageNode.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/components/vue-canvas/InpaintModal.vue
git commit -m "feat(edit-actions): one-click Remove object — Edit menu intent + auto-run in InpaintModal"
```

---

### Task 6: Recolor Object (click + brand swatches)

**Files:**
- Modify: `frontend/app/components/vue-canvas/InpaintModal.vue` (swatch strip UI + `runRecolor`)
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (menu entry)

**Interfaces:**
- Consumes: `intent` prop from Task 5; `recolorPrompt` from Task 3; `inpaint.fluxFill(image, mask, prompt, opts)` (useInpaint.ts:164); `inject('sailor:brand')` (provided by the default layout — see CompositorModal.vue:1317 for the shape); `useBrandLibrary(activeKitId)` (useBrandLibrary.ts:39); `BRAND_COLOR_KEYS` from `~~/shared/brand/types`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: ArtifactImageNode — menu entry**

Below `openRemoveObject()`, add:

```typescript
function openRecolor() {
  window.dispatchEvent(new CustomEvent('sailor:openInpaint', { detail: { nodeId: props.id, intent: 'recolor' } }))
}
```

In the Edit menu, after the "Remove object" button:

```vue
              <button class="edit-menu-item" @click.stop="runAction(openRecolor)">
                <Palette class="size-3 shrink-0" /> Recolor…
                <span class="edit-menu-hint">click + pick</span>
              </button>
```

Add `Palette` to the lucide import.

- [ ] **Step 2: InpaintModal — brand swatches + runRecolor**

In the script, add imports and the swatch source:

```typescript
import { recolorPrompt } from '~/lib/editActions/prompts'
import { useBrandLibrary } from '~/composables/useBrandLibrary'
import { BRAND_COLOR_KEYS } from '~~/shared/brand/types'
```

(If the project auto-imports composables, drop the `useBrandLibrary` import line to match file conventions — check how other composables are referenced in this file first.)

```typescript
// ── Recolor intent: brand-kit swatches + free picker ─────────────────────────
const projectBrand = inject<{ activeKitId: ComputedRef<string | null>; setBrandKit: (id: string | null) => void } | null>('sailor:brand', null)
const brandLib = useBrandLibrary(projectBrand?.activeKitId)
/** Active-kit colors first (deduped), else a small neutral default set. */
const recolorSwatches = computed<{ label: string; hex: string }[]>(() => {
  const kit = brandLib.activeKit.value as Record<string, string | undefined> | undefined
  const out: { label: string; hex: string }[] = []
  if (kit) {
    for (const key of BRAND_COLOR_KEYS) {
      const hex = kit[key]
      if (hex && !out.some(s => s.hex.toLowerCase() === hex.toLowerCase())) out.push({ label: key, hex })
    }
  }
  if (!out.length) {
    out.push(
      { label: 'red', hex: '#e5484d' }, { label: 'blue', hex: '#3e63dd' },
      { label: 'green', hex: '#30a46c' }, { label: 'yellow', hex: '#f5d90a' },
      { label: 'black', hex: '#1c1c1c' }, { label: 'white', hex: '#f2f2f2' },
    )
  }
  return out
})
const customColor = ref('#3e63dd')

async function runRecolor(label: string, hex: string) {
  if (!sourceImg.value || !samMask.value) { inpaintError.value = 'Click the object to recolor first.'; return }
  inpaintError.value = ''
  try {
    const source = imageToDataUrl(sourceImg.value, out.value.w, out.value.h)
    await inpaint.fluxFill(source, samMask.value, recolorPrompt(`${label} (${hex})`), { tier: tier.value, count: count.value })
  } catch (err: any) {
    inpaintError.value = err?.data?.message || err?.message || 'Recolor failed'
  }
}
```

(`inpaint.fluxFill` writes `inpaint.results`, so the modal's existing results strip and accept flow work unchanged. Check how `runInpaint` consumes its `images` return — if it does more than rely on `inpaint.results` (e.g. local `results` handling around InpaintModal.vue:335-350), mirror that handling here so recolor results appear in the same place.)

In the template, next to the Remove/Generate buttons (around line 618), add the swatch strip, visible only in recolor intent with a picked mask:

```vue
            <div v-if="intent === 'recolor' && samMask" class="flex items-center gap-1.5 flex-wrap">
              <span class="text-[10px] text-white/40 select-none">Recolor to</span>
              <button v-for="s in recolorSwatches" :key="s.hex"
                      class="size-6 rounded-md border border-white/15 cursor-pointer hover:scale-110 transition-transform"
                      :style="{ background: s.hex }" :title="`${s.label} ${s.hex}`"
                      :disabled="inpaint.busy.value"
                      @click="runRecolor(s.label, s.hex)" />
              <label class="relative size-6 rounded-md border border-dashed border-white/25 cursor-pointer overflow-hidden" title="Custom color">
                <input v-model="customColor" type="color" class="absolute inset-0 opacity-0 cursor-pointer"
                       @change="runRecolor('custom', customColor)" />
                <span class="absolute inset-0 grid place-items-center text-[10px] text-white/50">+</span>
              </label>
            </div>
```

(`intent` and `samMask` are already in template scope via `defineProps`/refs.)

- [ ] **Step 3: Verify in the browser**

Edit menu → "Recolor…" → select tool active → click an object → swatch strip appears (brand colors first if a kit is active). Click a swatch → network shows `/api/inpaint/flux-fill` with the recolor prompt (one paid verification run max). Screenshot the swatch strip.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/InpaintModal.vue frontend/app/components/vue-canvas/ArtifactImageNode.vue
git commit -m "feat(edit-actions): Recolor object — SAM click + brand-kit swatch strip"
```

---

### Task 7: Edit Text popover

**Files:**
- Modify: `frontend/app/components/vue-canvas/ArtifactImageNode.vue` (popover + menu entry)

**Interfaces:**
- Consumes: `spliceEffect(nodeType, opts, widgetOverrides)` (ArtifactImageNode.vue:318) with Task 2's `TextEditNode` widget names `find` / `replace`; `menuStyleFor()` positioning helper (line 401); `onClickOutside` pattern (line 395).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Popover state + spawn function**

In the script, next to the Edit-menu state (around line 387):

```typescript
// ── Edit text popover — find/replace fields, spawns a TextEditNode ───────────
const textEditOpen = ref(false)
const textEditPanelRef = ref<HTMLElement | null>(null)
const textEditStyle = ref<Record<string, string>>({})
const textFind = ref('')
const textReplace = ref('')
onClickOutside(textEditPanelRef, () => { textEditOpen.value = false })

function openTextEdit() {
  textEditStyle.value = menuStyleFor(editMenuRef.value)
  textFind.value = ''
  textReplace.value = ''
  textEditOpen.value = true
}

function runTextEdit() {
  if (!textFind.value.trim() || !textReplace.value.trim()) return
  spliceEffect('TextEditNode', { run: true, branch: true }, { find: textFind.value.trim(), replace: textReplace.value.trim() })
  textEditOpen.value = false
}
```

Before writing `runTextEdit`, verify how `widgetOverrides` keys are consumed: check `createNodeData` in VueNodeCanvas.vue (called at line ~1600) — the keys must be the node's INPUT names (`find`, `replace`). If it expects widget indices or another shape, adapt to what `createNodeData` actually does.

- [ ] **Step 2: Menu entry + popover template**

In the Edit menu, after the "Recolor…" button:

```vue
              <button class="edit-menu-item" @click.stop="runAction(openTextEdit)">
                <Type class="size-3 shrink-0" /> Edit text…
                <span class="edit-menu-hint">find / replace</span>
              </button>
```

Add `Type` to the lucide import. Next to the existing Edit-menu `<Teleport>` panel, add a sibling:

```vue
            <Teleport to="body">
              <div v-if="textEditOpen" ref="textEditPanelRef"
                   class="nopan nodrag fixed z-[9999] w-[230px] rounded-md border border-white/10 bg-[#1a1a1a] shadow-lg p-2.5 flex flex-col gap-2"
                   :style="textEditStyle">
                <div class="text-[9px] uppercase tracking-wider text-white/30 select-none">Edit text in image</div>
                <input v-model="textFind" placeholder="Text currently in the image" spellcheck="false"
                       class="h-7 px-2 rounded bg-white/[0.06] border border-white/10 text-[11px] text-white/85 outline-none focus:border-white/25"
                       @keydown.enter.prevent="runTextEdit" />
                <input v-model="textReplace" placeholder="Replace with…" spellcheck="false"
                       class="h-7 px-2 rounded bg-white/[0.06] border border-white/10 text-[11px] text-white/85 outline-none focus:border-white/25"
                       @keydown.enter.prevent="runTextEdit" />
                <button class="gen-pastel h-7 rounded-md text-neutral-900 text-[11px] font-semibold cursor-pointer disabled:opacity-40"
                        :disabled="!textFind.trim() || !textReplace.trim()" @click="runTextEdit">
                  Replace text · ~$0.05
                </button>
              </div>
            </Teleport>
```

- [ ] **Step 3: Verify in the browser**

Edit menu → "Edit text…" → popover with two fields; fill both → "Replace text" → a `TextEditNode` appears branched off the artifact with `find`/`replace` pre-filled and starts running (one paid verification run max). Screenshot the popover.

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/ArtifactImageNode.vue
git commit -m "feat(edit-actions): Edit text popover — find/replace spawns a TextEditNode"
```

---

### Task 8: Cut out subject (Frame layer, in place)

**Files:**
- Create: `frontend/app/composables/useLayerImageEdit.ts`
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (image-layer inspector section, around line 3531)

**Interfaces:**
- Consumes: `setLocal(id, patch)` (destructured from `useLocalLayerEditor` in CompositorModal.vue:308 — records one undo step per call); `inpaint.removeBackground(image)` and `inpaint.uploadDataUrl(dataUrl, hint)` (useInpaint.ts); `ImageLayer.filename` (useCompositorLayers.ts:253).
- Produces: `useLayerImageEdit()` returning `{ busy: Ref<boolean>, error: Ref<string>, layerImageDataUrl(filename: string): Promise<string>, cutOutLayer(layer: ImageLayer, setLocal): Promise<void> }`. Task 9 reuses `busy`, `error`, and `layerImageDataUrl`.

- [ ] **Step 1: Write the composable**

Create `frontend/app/composables/useLayerImageEdit.ts`:

```typescript
/**
 * In-place AI edits on Frame image layers (Cut out subject, Harmonize).
 * Loads the layer's bitmap from ComfyUI's input dir, runs a cloud edit, uploads
 * the result and swaps the layer's `filename` via the editor's setLocal — which
 * records exactly one undo step. The swap happens only after the FULL pipeline
 * succeeds: any failure leaves the layer untouched.
 */
import type { ImageLayer } from '~/composables/useCompositorLayers'

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`could not load ${url}`))
    img.src = url
  })
}

export function useLayerImageEdit() {
  const inpaint = useInpaint()
  const busy = ref(false)
  const error = ref('')

  /** The layer's source bitmap as a PNG data URL (from ComfyUI's input dir). */
  async function layerImageDataUrl(filename: string): Promise<string> {
    const img = await loadImageEl(`/view?${new URLSearchParams({ filename, type: 'input' })}`)
    const c = document.createElement('canvas')
    c.width = img.naturalWidth || 1
    c.height = img.naturalHeight || 1
    c.getContext('2d')!.drawImage(img, 0, 0)
    return c.toDataURL('image/png')
  }

  /** Replace the layer's content with its background-removed cutout. */
  async function cutOutLayer(layer: ImageLayer, setLocal: (id: string, patch: Record<string, any>) => void): Promise<void> {
    if (busy.value) return
    busy.value = true; error.value = ''
    try {
      const source = await layerImageDataUrl(layer.filename)
      const cutout = await inpaint.removeBackground(source)
      const filename = await inpaint.uploadDataUrl(cutout, `cutout_${layer.id}`)
      setLocal(layer.id, { filename })
    } catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Cut out failed'
    } finally {
      busy.value = false
    }
  }

  return { busy, error, layerImageDataUrl, cutOutLayer }
}
```

(If the project does not auto-import `useInpaint`/`ref` in composables, add the explicit imports matching neighboring composable files.)

- [ ] **Step 2: Inspector button in CompositorModal**

In the script (near the other editor destructuring, line ~308 area):

```typescript
const layerEdit = useLayerImageEdit()
```

In the selected-layer inspector body (the `v-if="selected"` block around line 3531), add a kind-gated section — follow the file's existing section-card markup convention (see the neighboring control groups):

```vue
          <div v-if="selected && selected.kind === 'image'" class="flex flex-col gap-1.5">
            <button class="gen-pastel h-7 rounded-md text-neutral-900 text-[11px] font-semibold cursor-pointer disabled:opacity-40"
                    :disabled="layerEdit.busy.value"
                    @click="layerEdit.cutOutLayer(selected as any, setLocal)">
              {{ layerEdit.busy.value ? 'Working…' : 'Cut out subject' }}
            </button>
            <p v-if="layerEdit.error.value" class="text-[10px] text-red-400/80">{{ layerEdit.error.value }}</p>
          </div>
```

GOTCHA (bit twice before): if this section reads any NEW reactive state that affects the preview, the render-watch deps in BOTH CompositorModal and ArtifactFrameNode must include it. A `filename` swap via `setLocal` flows through `localLayers`, which is already watched — verify the frame node preview updates after a cutout; if it doesn't, add the missing dep rather than forcing a re-render elsewhere.

- [ ] **Step 3: Verify in the browser**

Open a Frame with an image layer → select it → "Cut out subject" → layer content becomes a transparent cutout IN PLACE (position/scale unchanged) → Cmd+Z restores the original in one step → the on-canvas ArtifactFrameNode preview reflects both changes. Screenshot before/after. (This calls the paid Replicate remover once.)

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useLayerImageEdit.ts frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(edit-actions): Cut out subject on Frame image layers (in-place, undoable)"
```

---

### Task 9: Harmonize Layer

**Files:**
- Modify: `frontend/app/composables/useInpaint.ts` (extend `nanoGen` with multi-image support, line 248)
- Modify: `frontend/app/composables/useLayerImageEdit.ts` (add `harmonizeLayer`)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (Harmonize button next to Cut out subject)

**Interfaces:**
- Consumes: `HARMONIZE_PROMPT` (Task 3); `buildStackItems()` (CompositorModal.vue:1465), `paintLayerStack(ctx, W, H, items, localLayers)` and `bakeSize()` (already used by `bakeMotion`, CompositorModal.vue:1380); `layerImageDataUrl` + pipeline shape from Task 8.
- Produces: `harmonizeLayer(layer, setLocal, renderScene)` on `useLayerImageEdit` where `renderScene: () => { canvas: HTMLCanvasElement; W: number; H: number }` is supplied by the surface (keeps the composable free of CompositorModal internals).

- [ ] **Step 1: Extend nanoGen for multi-image input**

In `frontend/app/composables/useInpaint.ts` line 248, change:

```typescript
  async function nanoGen(prompt: string, image?: string): Promise<string[]> {
```

to:

```typescript
  async function nanoGen(prompt: string, image?: string, images?: string[]): Promise<string[]> {
```

and the body line `body: { prompt, image },` to:

```typescript
        body: { prompt, image, images },
```

(The `/api/inpaint/nano-gen` route already accepts `images: string[]` — `images` takes precedence over `image` server-side. Existing callers pass two args and are unaffected.)

- [ ] **Step 2: Add harmonizeLayer to the composable**

In `frontend/app/composables/useLayerImageEdit.ts`, import the prompt and add inside `useLayerImageEdit()` (before the return, and add `harmonizeLayer` to the returned object):

```typescript
import { HARMONIZE_PROMPT } from '~/lib/editActions/prompts'
```

```typescript
  /** Relight + color-match a layer to the scene around it, in place.
   *  renderScene: surface-supplied full-composite render (wired + local). */
  async function harmonizeLayer(
    layer: ImageLayer,
    setLocal: (id: string, patch: Record<string, any>) => void,
    renderScene: () => { canvas: HTMLCanvasElement; W: number; H: number },
  ): Promise<void> {
    if (busy.value) return
    busy.value = true; error.value = ''
    try {
      const { canvas, W, H } = renderScene()
      // Layer bbox in scene pixels — note w AND h are normalized to canvas WIDTH.
      const pxW = layer.w * W, pxH = layer.h * W
      const pad = 0.4
      const cx = layer.x * W, cy = layer.y * H
      const x0 = Math.max(0, Math.round(cx - (pxW * (1 + pad)) / 2))
      const y0 = Math.max(0, Math.round(cy - (pxH * (1 + pad)) / 2))
      const x1 = Math.min(W, Math.round(cx + (pxW * (1 + pad)) / 2))
      const y1 = Math.min(H, Math.round(cy + (pxH * (1 + pad)) / 2))
      if (x1 - x0 < 8 || y1 - y0 < 8) throw new Error('Layer is too small to harmonize')
      const crop = document.createElement('canvas')
      crop.width = x1 - x0
      crop.height = y1 - y0
      crop.getContext('2d')!.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0)
      const sceneCrop = crop.toDataURL('image/png')

      const layerImg = await layerImageDataUrl(layer.filename)
      // Order is load-bearing: [0] = scene context, [1] = the object to relight.
      const results = await inpaint.nanoGen(HARMONIZE_PROMPT, undefined, [sceneCrop, layerImg])
      const harmonized = results[0]
      if (!harmonized) throw new Error('Harmonize returned no image')
      // Recover the alpha cutout (nano-banana returns an opaque image).
      const cutout = await inpaint.removeBackground(harmonized)
      const filename = await inpaint.uploadDataUrl(cutout, `harmonize_${layer.id}`)
      setLocal(layer.id, { filename })
    } catch (err: any) {
      error.value = err?.data?.message || err?.message || 'Harmonize failed'
    } finally {
      busy.value = false
    }
  }
```

- [ ] **Step 3: Wire the button + scene renderer in CompositorModal**

In the script, add the surface-side renderer (near `bakeMotion`, which shows the same `bakeSize`/`buildStackItems` usage at line ~1380):

```typescript
// Full composite (wired + local) at bake resolution, for Harmonize context.
function renderSceneForHarmonize(): { canvas: HTMLCanvasElement; W: number; H: number } {
  const { W, H } = bakeSize()
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  paintLayerStack(ctx, W, H, buildStackItems(), localLayers.value as LocalLayer[])
  return { canvas, W, H }
}
```

(Ensure `paintLayerStack` is imported from `~/composables/useCompositorLayers` in this file — it likely already is; check the existing import list. If wired-layer bitmaps load asynchronously and `paintLayerStack` needs them pre-warmed, mirror however `bakeAndUpload` warms them — inspect `bakeAndUpload`'s implementation before assuming.)

In the Task-8 inspector section, add the Harmonize button after "Cut out subject":

```vue
            <button class="gen-pastel h-7 rounded-md text-neutral-900 text-[11px] font-semibold cursor-pointer disabled:opacity-40"
                    :disabled="layerEdit.busy.value"
                    @click="layerEdit.harmonizeLayer(selected as any, setLocal, renderSceneForHarmonize)">
              {{ layerEdit.busy.value ? 'Working…' : 'Harmonize into scene' }}
            </button>
```

- [ ] **Step 4: Verify in the browser**

Frame with a scene (wired base image) + a pasted-looking image layer → select layer → "Harmonize into scene" → network shows nano-gen (2 images) then remove-bg → layer content swaps in place, position/scale/z untouched → one Cmd+Z restores the original → ArtifactFrameNode preview updates. This is TWO paid calls (~$0.05 + remover) — one verification run, then screenshot before/after and hand visual sign-off to the user.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/composables/useInpaint.ts frontend/app/composables/useLayerImageEdit.ts frontend/app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(edit-actions): Harmonize layer — relight+grade a Frame layer to its scene, in place"
```

---

### Task 10: Full verification pass + spec sync

**Files:**
- Modify: `docs/superpowers/specs/2026-07-08-ai-edit-actions-design.md` (record the three deviations)

- [ ] **Step 1: Run all unit suites**

Run: `cd /Users/julien/Documents/GitHub/Sailor/frontend && npm run test:unit`
Expected: all pass.
Run: `cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python -m pytest tests-unit/comfy_extras_test/ -q`
Expected: all pass.

- [ ] **Step 2: Browser smoke of every free mechanic**

With the dev preview running: Edit menu shows Remove object / Recolor… / Edit text… entries; each opens its surface; the three new nodes appear in the Actions panel under Edit with `~$0.05` badges; placing each node and running with EMPTY strings passes the image through without any Replicate call (check ComfyUI logs). Screenshot the Edit menu and Actions panel.

- [ ] **Step 3: Update the spec's deviations**

In the spec, under `## Locked decisions`, append a `## Implementation deviations` section:

```markdown
## Implementation deviations (2026-07-08 plan)

- Text Edit OCR pre-fill chips DEFERRED (no OCR server route exists); v1 ships
  the free-text find/replace fields, which were already the degrade path.
- Harmonize + Cut-out surface as inspector buttons in CompositorModal (neither
  Frame surface has a layer context menu today; building one was out of scope).
- §2's Edit-menu entry already existed (local BackgroundRemove splice) — the
  cloud RemoveBackgroundNode remains reachable from the Actions panel.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add docs/superpowers/specs/2026-07-08-ai-edit-actions-design.md
git commit -m "docs(edit-actions): record implementation deviations in the spec"
```

---

### Task 11 (STRETCH, optional): Procedural Cast Shadow layer

Only start if Tasks 1–10 are done, verified, and the user wants it. Adds a "Cast shadow" button beside Harmonize that builds a free, local shadow: draw the layer's alpha silhouette to an offscreen canvas, fill black, apply `ctx.filter = 'blur(12px)'`, skew via `setTransform(1, 0, -0.35, 0.45, …)`, upload with `inpaint.uploadDataUrl`, then `createImageLayer(filename, aspect, { x: layer.x, y: layer.y + layer.h * 0.35, opacity: 0.5 })` inserted BELOW the source layer in the z-order (see `useLocalLayerEditor`'s order helpers). Fully local — no cloud calls. Design the exact offsets against a real render; get user sign-off on the look before committing (screenshot loop).

---

## Execution notes

- Ship order is the task order (spec's §2→§1→§5→§4→§3 mapped through dependencies).
- Tasks 1–4 are safe to run headless. Tasks 5–9 each end in a browser verification step — use the preview tools, and cap paid calls at one render per feature.
- If `/api/inpaint/segment` errors during Task 5/6 verification (SAM model refs vary by Replicate account), the modal's existing fallback flips to brushing — that's the designed degrade, not a task failure. Note it and continue.
