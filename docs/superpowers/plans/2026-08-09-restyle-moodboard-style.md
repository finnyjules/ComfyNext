# Restyle-from-image accepts a moodboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a moodboard drive `RestyleFromImageNode` — its images (≤3) become the style references and its taste reading rides the TASTE wire, overriding the single `style_image` slot.

**Architecture:** Reuse the existing moodboard "style channel" (a TASTE wire into `style_in` + a hidden `style_refs` widget) that already feeds `GenerateImageNode`, adding `RestyleFromImageNode` as a second consumer. The Python `execute` learns to fold ≤3 board images into `image_input` and the taste block into its instruction. The frontend relaxes four "Generate-only" gates through one shared predicate, applies the board with **no** model-switch (restyle already defaults to Nano Banana 2), and disconnects any wire feeding `style_image`.

**Tech Stack:** Python (ComfyUI node), Vue 3 + TypeScript (Nuxt 4), Vitest (frontend unit), pytest + pytest-asyncio (backend unit).

## Global Constraints

- Moodboard refs are capped at **3** images everywhere (`_MOODBOARD_MAX_REFS` Python / `MOODBOARD_MAX_REFS` TS). Copy this cap; never hardcode a different number.
- Moodboard folder must match `^moodboard_\d+$`; file paths validated by the existing `_parse_style_refs` guards. Never pass a `lora_dataset_*` folder as refs.
- The style-refs instruction is verbatim `_STYLE_REFS_INSTRUCTION` ("...strictly as STYLE references — match their palette, light, grain and mood; do not copy their subjects or composition").
- `RestyleWithLoRANode` is **out of scope** — do not touch it.
- No model auto-switch on restyle: never write its `model` widget, never set `sailor_moodboard_switched` on a restyle node.
- Schema changes to `nodes_replicate.py` require **restarting ComfyUI** (not hot-reloaded) before the frontend sees the new `style_in` port.
- Frontend unit tests: `cd frontend && npm run test:unit`. Python unit tests: `pytest tests-unit/comfy_api_test/<file>` from repo root.
- Commit hygiene: stage only the files each step names (`git add <exact paths>`); never `git add -A`, never `git stash`.

---

### Task 1: Backend — `RestyleFromImageNode` accepts moodboard refs + taste

**Files:**
- Modify: `comfy_api_nodes/nodes_replicate.py` — `RestyleFromImageNode.define_schema` (~3084-3120) and `.execute` (~3119-3163)
- Test: `tests-unit/comfy_api_test/restyle_moodboard_test.py` (create)

**Interfaces:**
- Consumes (all already module-level in `nodes_replicate.py`): `_parse_style_refs(style_refs) -> tuple[str, list[str]] | None`, `_moodboard_ref_data_urls(folder, files, input_dir=None) -> list[str]`, `_STYLE_REFS_INSTRUCTION: str`, `_NANO_BANANA_SLUGS: dict`, `build_restyle_instruction(structure_strength, extra_direction="") -> str`, `_image_tensor_to_data_url`, `_run_image_edit_prediction`, `download_url_to_image_tensor`, `save_generation_output`, `_TASTE = IO.Custom("TASTE")`.
- Produces: `RestyleFromImageNode.execute(cls, model, content_image, style_image=None, prompt="", structure_strength=0.65, resolution="1K", seed=0, output_format="png", style_in="", style_refs="")` — the two new trailing kwargs are what the frontend feeds (TASTE wire + hidden widget).

- [ ] **Step 1: Write the failing tests**

Create `tests-unit/comfy_api_test/restyle_moodboard_test.py`:

```python
import json
import pytest

import utils.install_util  # noqa: F401
import comfy_api_nodes.nodes_replicate as nr
from comfy_api_nodes.nodes_replicate import RestyleFromImageNode


@pytest.fixture
def captured(monkeypatch):
    """Stub the tensor→url, network and save layers so execute() is a pure
    input_dict builder we can assert on. Returns a dict the test reads after."""
    holder = {}

    monkeypatch.setattr(nr, "_image_tensor_to_data_url", lambda t: f"DATA:{t}")
    monkeypatch.setattr(nr, "_moodboard_ref_data_urls",
                        lambda folder, files, input_dir=None: [f"BOARD:{f}" for f in files])

    async def fake_predict(slug, input_dict):
        holder["slug"] = slug
        holder["input"] = input_dict
        return "http://result/img.png"

    async def fake_download(url, cls=None):
        return "TENSOR"

    monkeypatch.setattr(nr, "_run_image_edit_prediction", fake_predict)
    monkeypatch.setattr(nr, "download_url_to_image_tensor", fake_download)
    monkeypatch.setattr(nr, "save_generation_output", lambda *a, **k: {})
    return holder


def _refs(files=("00_a.png", "01_b.jpg")):
    return json.dumps({"folder": "moodboard_1754000000000", "files": list(files)})


@pytest.mark.asyncio
async def test_nano_banana_uses_board_images_as_style_refs(captured):
    await RestyleFromImageNode.execute(
        model="Nano Banana 2", content_image="C", style_image="S",
        style_refs=_refs(), style_in="dusty pastel palette",
    )
    # content first, then the board images — the single style image is ignored.
    assert captured["input"]["image_input"] == ["DATA:C", "BOARD:00_a.png", "BOARD:01_b.jpg"]
    assert "DATA:S" not in captured["input"]["image_input"]
    # style-only instruction + the taste block both present.
    assert "STYLE references" in captured["input"]["prompt"]
    assert "dusty pastel palette" in captured["input"]["prompt"]


@pytest.mark.asyncio
async def test_board_images_capped_at_three(captured):
    await RestyleFromImageNode.execute(
        model="Nano Banana 2", content_image="C", style_image=None,
        style_refs=_refs(("a.png", "b.png", "c.png", "d.png", "e.png")),
    )
    # _parse_style_refs caps at 3 before the loader ever runs.
    assert len(captured["input"]["image_input"]) == 1 + 3


@pytest.mark.asyncio
async def test_ip_adapter_falls_back_to_first_board_image(captured):
    await RestyleFromImageNode.execute(
        model="Style Transfer · IP-Adapter", content_image="C", style_image=None,
        style_refs=_refs(("first.png", "second.png")), style_in="mood text",
    )
    assert captured["slug"] == "fofr/style-transfer"
    assert captured["input"]["style_image"] == "BOARD:first.png"
    assert captured["input"]["structure_image"] == "DATA:C"
    assert "mood text" in captured["input"]["prompt"]


@pytest.mark.asyncio
async def test_no_board_is_unchanged_single_style_image(captured):
    await RestyleFromImageNode.execute(
        model="Nano Banana 2", content_image="C", style_image="S",
    )
    assert captured["input"]["image_input"] == ["DATA:C", "DATA:S"]
    assert "STYLE references" not in captured["input"]["prompt"]


@pytest.mark.asyncio
async def test_malformed_refs_degrade_to_single_style_image(captured):
    await RestyleFromImageNode.execute(
        model="Nano Banana 2", content_image="C", style_image="S",
        style_refs="{not json",
    )
    assert captured["input"]["image_input"] == ["DATA:C", "DATA:S"]


@pytest.mark.asyncio
async def test_no_style_source_raises(captured):
    with pytest.raises(RuntimeError):
        await RestyleFromImageNode.execute(
            model="Nano Banana 2", content_image="C", style_image=None,
        )
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests-unit/comfy_api_test/restyle_moodboard_test.py -v`
Expected: FAIL — `execute()` got an unexpected keyword argument `style_refs` (and `style_in`), since the schema/signature don't have them yet.

- [ ] **Step 3: Add the schema inputs**

In `comfy_api_nodes/nodes_replicate.py`, `RestyleFromImageNode.define_schema`, change the `style_image` input to optional and append the two moodboard inputs. Replace this exact input line:

```python
                IO.Image.Input("style_image",
                               tooltip="The reference image whose look/style is copied onto the content."),
```

with:

```python
                IO.Image.Input("style_image", optional=True,
                               tooltip="The reference image whose look/style is copied onto the content. "
                                       "Ignored when a moodboard is wired into style_in."),
```

Then, immediately before `outputs=[IO.Image.Output()],` in the same schema, add the moodboard inputs (mirrors GenerateImageNode's appended pair + TASTE socket):

```python
                # ── Moodboard style source (2026-08-09) ──────────────────────
                # Reference-image payload written by the frontend at submit time
                # (properties.style_refs → this hidden widget, by NAME). A
                # moodboard here OVERRIDES the single style_image.
                IO.String.Input(
                    "style_refs",
                    default="",
                    multiline=False,
                    optional=True,
                    extra_dict={"sailor_widget": "internal"},
                    tooltip="Moodboard reference-image payload (JSON) — the board's ≤3 images.",
                ),
                # Taste wire: the Moodboard node's compiled style block flows in
                # here and folds into the restyle instruction as extra direction.
                _TASTE.Input(
                    "style_in",
                    optional=True,
                    tooltip="Taste wire: a Moodboard node's compiled style block.",
                ),
```

- [ ] **Step 4: Rewrite `execute`**

Replace the entire current `execute` method body of `RestyleFromImageNode` (from `async def execute` through the `return IO.NodeOutput(...)`) with:

```python
    @classmethod
    async def execute(cls, model, content_image, style_image=None, prompt="",
                      structure_strength=0.65, resolution="1K", seed=0,
                      output_format="png", style_in="", style_refs=""):
        content_url = _image_tensor_to_data_url(content_image)
        guidance = (prompt or "").strip()
        taste = (style_in or "").strip()

        # Moodboard style source (2026-08-09): a validated style_refs payload
        # overrides the single style_image. Up to 3 board images become the
        # style references and the taste block (the TASTE wire) rides along as
        # extra style direction.
        parsed_refs = _parse_style_refs(style_refs)
        board_urls = _moodboard_ref_data_urls(*parsed_refs) if parsed_refs else []

        # A restyle needs SOME style source. With no board and no style image
        # there is nothing to restyle toward — fail loudly rather than crash in
        # the tensor encoder.
        if not board_urls and style_image is None:
            raise RuntimeError(
                "Restyle needs a style image or a wired moodboard — neither was provided."
            )

        extra_direction = f"{guidance} {taste}".strip() if taste else guidance

        if model in _NANO_BANANA_SLUGS:
            if board_urls:
                # Content first, then the board images as STYLE-only refs.
                instruction = (
                    f"{build_restyle_instruction(structure_strength, extra_direction)} "
                    f"{_STYLE_REFS_INSTRUCTION}"
                ).strip()
                image_input = [content_url, *board_urls]
            else:
                # Original single-style-image path.
                instruction = build_restyle_instruction(structure_strength, extra_direction)
                image_input = [content_url, _image_tensor_to_data_url(style_image)]
            input_dict = {
                "prompt": instruction,
                "image_input": image_input,
                "output_format": output_format,
            }
            if model != "Nano Banana":
                input_dict["resolution"] = resolution
            slug = _NANO_BANANA_SLUGS[model]
        else:  # Style Transfer · IP-Adapter — single style image only
            # IP-Adapter cannot take multiple references, so a moodboard
            # degrades to its FIRST image; the taste block folds into the prompt.
            style_url = board_urls[0] if board_urls else _image_tensor_to_data_url(style_image)
            base_prompt = guidance or "a high quality image"
            input_dict = {
                "prompt": f"{base_prompt} {taste}".strip() if taste else base_prompt,
                "style_image": style_url,
                "structure_image": content_url,
                "structure_denoising_strength": float(structure_strength),
                "output_format": output_format,
                "number_of_images": 1,
            }
            if seed and seed > 0:
                input_dict["seed"] = seed
            slug = "fofr/style-transfer"

        url = await _run_image_edit_prediction(slug, input_dict)
        result = await download_url_to_image_tensor(url, cls=cls)
        return IO.NodeOutput(
            result,
            ui=save_generation_output(result, "restyle"),
        )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pytest tests-unit/comfy_api_test/restyle_moodboard_test.py -v`
Expected: PASS (6 passed).

- [ ] **Step 6: Run the neighbouring suites to confirm no regression**

Run: `pytest tests-unit/comfy_api_test/generate_image_refs_test.py tests-unit/comfy_api_test/replicate_refs_test.py -q`
Expected: PASS (unchanged).

- [ ] **Step 7: Commit**

```bash
git add comfy_api_nodes/nodes_replicate.py tests-unit/comfy_api_test/restyle_moodboard_test.py
git commit -m "feat(restyle): accept a moodboard as the style source (backend)

RestyleFromImageNode gains style_in (TASTE) + style_refs (hidden); a
validated board payload overrides the single style_image — ≤3 board
images become style refs (IP-Adapter falls back to the first), and the
taste block folds into the instruction.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Frontend — `applyMoodboardToRestyleNode` (no model switch)

**Files:**
- Modify: `frontend/app/lib/graph/moodboardApply.ts` (add one exported function)
- Test: `frontend/tests/unit/moodboard-apply.unit.spec.ts` (add a describe block)

**Interfaces:**
- Consumes: `MoodboardApplyTarget` (`{ properties?: Record<string, any> }`), `MoodboardEntry`, `MOODBOARD_MAX_REFS` — all already in this module.
- Produces: `applyMoodboardToRestyleNode(nodeData: MoodboardApplyTarget, entry: MoodboardEntry, files: string[]): { sailor_moodboard: string; style_refs: string }` — attaches board identity + refs, deletes any stale `aesthetic`, and (unlike the Generate helper) never touches the model or sets `sailor_moodboard_switched`.

- [ ] **Step 1: Write the failing tests**

Add to the end of `frontend/tests/unit/moodboard-apply.unit.spec.ts` (the file already imports from `~/lib/graph/moodboardApply`, defines `ENTRY`, `FILES`, and `MOODBOARD_MAX_REFS` — reuse them; add `applyMoodboardToRestyleNode` to the existing import block at the top of the file):

```ts
describe('applyMoodboardToRestyleNode — restyle path, no model switch (2026-08-09)', () => {
  it('writes style_refs JSON {folder, files[≤3]} and the board identity', () => {
    const node = { properties: {} as Record<string, any> }
    const writes = applyMoodboardToRestyleNode(node, ENTRY, FILES)
    const parsed = JSON.parse(node.properties.style_refs)
    expect(parsed).toEqual({ folder: ENTRY.folder, files: FILES.slice(0, MOODBOARD_MAX_REFS) })
    expect(node.properties.sailor_moodboard).toBe(ENTRY.id)
    expect(writes.sailor_moodboard).toBe(ENTRY.id)
  })

  it('never sets the auto-switch marker (restyle does not switch models)', () => {
    const node = { properties: {} as Record<string, any> }
    applyMoodboardToRestyleNode(node, ENTRY, FILES)
    expect(node.properties.sailor_moodboard_switched).toBeUndefined()
  })

  it('deletes a stale aesthetic property (single-carrier rule)', () => {
    const node = { properties: { aesthetic: 'old block' } as Record<string, any> }
    applyMoodboardToRestyleNode(node, ENTRY, FILES)
    expect(node.properties.aesthetic).toBeUndefined()
  })

  it('empty file list → empty style_refs', () => {
    const node = { properties: {} as Record<string, any> }
    const writes = applyMoodboardToRestyleNode(node, ENTRY, [])
    expect(writes.style_refs).toBe('')
    expect(node.properties.style_refs).toBe('')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test:unit -- moodboard-apply`
Expected: FAIL — `applyMoodboardToRestyleNode is not a function` / import undefined.

- [ ] **Step 3: Implement the function**

Add to `frontend/app/lib/graph/moodboardApply.ts`, after `clearMoodboardFromGenerateNode` (end of file):

```ts
/**
 * The RESTYLE path (2026-08-09): attach a moodboard as the style source to a
 * RestyleFromImageNode. Unlike the Generate helper this NEVER switches the
 * model or sets an auto-switch marker — restyle's engine defaults to Nano
 * Banana 2 (already multi-image) and its selector is not the shared image-model
 * catalog. The board's ≤3 images ride as style_refs; the prose taste block
 * travels on the TASTE wire (style_in), so it is not written here. Any stale
 * `aesthetic` is deleted (single-carrier rule).
 */
export function applyMoodboardToRestyleNode(
  nodeData: MoodboardApplyTarget,
  entry: MoodboardEntry,
  files: string[],
): { sailor_moodboard: string; style_refs: string } {
  if (!nodeData.properties) nodeData.properties = {}
  const props = nodeData.properties
  const refFiles = files.filter(f => typeof f === 'string' && f).slice(0, MOODBOARD_MAX_REFS)
  const styleRefs = refFiles.length > 0
    ? JSON.stringify({ folder: entry.folder, files: refFiles })
    : ''
  delete props.aesthetic
  props.sailor_moodboard = entry.id
  props.style_refs = styleRefs
  return { sailor_moodboard: entry.id, style_refs: styleRefs }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm run test:unit -- moodboard-apply`
Expected: PASS (existing describes + the 4 new tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/graph/moodboardApply.ts frontend/tests/unit/moodboard-apply.unit.spec.ts
git commit -m "feat(restyle): applyMoodboardToRestyleNode — attach board, no model switch

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — `styleInject` writes restyle's `style_refs`

**Files:**
- Modify: `frontend/app/lib/graph/styleInject.ts` (~24-93)
- Test: `frontend/tests/unit/generate-image-style-inject.unit.spec.ts` (add cases)

**Interfaces:**
- Consumes: `injectLoraStyleIntoPrompt(workflow, objectInfo)` (existing), `widgetSlots(nodeType, objectInfo)`.
- Produces: same signature; now also injects `style_refs` for `RestyleFromImageNode` nodes.

Restyle's moodboard is always wire-applied, so `style_in` is linked and the prose block travels the wire — `styleInject` only needs to write the `style_refs` file-path payload into restyle's hidden `style_refs` widget (never `style_block`, which restyle does not have).

- [ ] **Step 1: Write the failing tests**

In `frontend/tests/unit/generate-image-style-inject.unit.spec.ts`, extend the `OBJECT_INFO` fixture to include a `RestyleFromImageNode` schema and add a test. First, add this node to the `OBJECT_INFO` object (mirror how `GenerateImageNode` lists its widget order — `style_refs` must appear as an input so `widgetSlots` resolves it):

```ts
  RestyleFromImageNode: {
    input: {
      required: {
        model: [['Nano Banana 2']],
        content_image: ['IMAGE'],
      },
      optional: {
        style_image: ['IMAGE'],
        prompt: ['STRING', { multiline: true }],
        structure_strength: ['FLOAT'],
        resolution: [['1K', '2K', '4K']],
        seed: ['INT'],
        output_format: [['png', 'jpg']],
        style_refs: ['STRING', { multiline: false }],
        style_in: ['TASTE'],
      },
    },
  },
```

Then add the test (mirror the existing `generateNode()` factory pattern — a `restyleNode()` factory that returns a node with a `widgets_values` array sized to the widget order and `properties.style_refs` set):

```ts
function restyleNode(props: Record<string, any>, wv: any[]) {
  return {
    type: 'RestyleFromImageNode',
    // style_image, prompt, structure_strength, seed, output_format, style_refs
    // are the widgetized inputs (model is model-combo, content_image/style_in
    // are sockets); the factory pads to the resolved slot.
    widgets_values: wv,
    inputs: [{ name: 'style_in', link: 42 }], // wire linked → block rides the wire
    properties: props,
  }
}

it('injects style_refs into a RestyleFromImageNode by name', () => {
  const node = restyleNode(
    { style_refs: JSON.stringify({ folder: 'moodboard_1', files: ['a.png'] }) },
    [],
  )
  const wf = { nodes: [node] }
  injectLoraStyleIntoPrompt(wf, OBJECT_INFO)
  const slots = require('~/lib/graph/widgetOrder').widgetSlots('RestyleFromImageNode', OBJECT_INFO)
  const idx = slots.findIndex((s: any) => s.name === 'style_refs')
  expect(node.widgets_values[idx]).toBe(node.properties.style_refs)
})

it('does not write a style_block for restyle (wire carries the block)', () => {
  const node = restyleNode(
    { style_refs: JSON.stringify({ folder: 'moodboard_1', files: ['a.png'] }) },
    [],
  )
  injectLoraStyleIntoPrompt({ nodes: [node] }, OBJECT_INFO)
  const slots = require('~/lib/graph/widgetOrder').widgetSlots('RestyleFromImageNode', OBJECT_INFO)
  const blockIdx = slots.findIndex((s: any) => s.name === 'style_block')
  expect(blockIdx).toBe(-1) // restyle has no style_block slot at all
})
```

> If `require(...)` is not available in this ESM test file, import `widgetSlots` at the top: `import { widgetSlots } from '~/lib/graph/widgetOrder'` and use it directly.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm run test:unit -- generate-image-style-inject`
Expected: FAIL — `node.widgets_values[idx]` is `undefined` (styleInject skips non-Generate nodes today).

- [ ] **Step 3: Generalize `styleInject` to both node types**

In `frontend/app/lib/graph/styleInject.ts`, add a set constant after `PROMPT_INDEX0_NODES` (line 24):

```ts
// Nodes that carry a moodboard via the hidden style_block/style_refs widgets +
// the style_in TASTE wire. GenerateImageNode has both widgets; restyle has only
// style_refs (its taste block travels the wire).
const STYLE_CHANNEL_NODES = new Set(['GenerateImageNode', 'RestyleFromImageNode'])
```

Replace line 46:

```ts
    if (type !== 'GenerateImageNode') continue
```

with:

```ts
    if (!STYLE_CHANNEL_NODES.has(type)) continue
```

Replace the `widgetSlots('GenerateImageNode', objectInfo)` call (line 69) with `widgetSlots(type, objectInfo)`, and update the two adjacent `console.warn` messages to interpolate `type` instead of the literal `GenerateImageNode`:

```ts
    try {
      slots = widgetSlots(type, objectInfo)
    } catch {
      console.warn(`[styleInject] ${type} missing from objectInfo — style block not injected`)
      continue
    }
```

and inside `writeSlot`:

```ts
        console.warn(`[styleInject] ${name} not in ${type} schema (stale backend?) — not injected`)
```

The existing `writeSlot('style_block', style)` at line 91 is guarded (`idx < 0` → warn + skip), so for restyle — which has no `style_block` slot and where `style` is `''` because `style_in` is linked — it is never called. No further change needed.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm run test:unit -- generate-image-style-inject`
Expected: PASS (existing Generate cases + the 2 new restyle cases).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/graph/styleInject.ts frontend/tests/unit/generate-image-style-inject.unit.spec.ts
git commit -m "feat(restyle): styleInject writes style_refs for RestyleFromImageNode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — canvas wiring accepts restyle (shared predicate + restyle branch)

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` — near `generatorStyleInIndex` (~3055) and `runMoodboardWireEffects` (3084-3105), plus the three gates at 3115, 3175, 3204
- Verify: typecheck + Browser-pane E2E (no unit test — canvas glue is verified live per this repo's convention)

**Interfaces:**
- Consumes: `applyMoodboardToRestyleNode` (Task 2), `applyMoodboardWireEffects` (existing), `removeEdges`, `edges`, `nodes` (all in-scope in this component).
- Produces: `nodeTakesMoodboard(nodeType): boolean` — true for `GenerateImageNode` and `RestyleFromImageNode`; used by all four gates.

- [ ] **Step 1: Add the shared predicate + edge-disconnect helper**

Add the import to the existing `moodboardApply` import in this file (find the line importing `applyMoodboardWireEffects` / `clearMoodboardFromGenerateNode` and add `applyMoodboardToRestyleNode`).

Immediately after `generatorStyleInIndex` (line 3057), add:

```ts
/** Node types that accept a moodboard style channel — the single source of
 *  truth for the four wire gates below. */
const MOODBOARD_TARGET_TYPES = new Set(['GenerateImageNode', 'RestyleFromImageNode'])
function nodeTakesMoodboard(nodeType: any): boolean {
  return MOODBOARD_TARGET_TYPES.has(String(nodeType))
}

/** Remove any edge feeding a node's `style_image` input — a moodboard overrides
 *  it (2026-08-09 restyle spec). */
function disconnectStyleImageEdge(node: any): void {
  const idx = ((node?.data?.inputs ?? []) as any[]).findIndex((i: any) => i?.name === 'style_image')
  if (idx < 0) return
  const drop = (edges.value as any[]).filter(e2 =>
    String(e2.target) === String(node.id) && e2.targetHandle === `input-${idx}`)
  if (drop.length) removeEdges(drop.map(e2 => e2.id))
}
```

- [ ] **Step 2: Branch `runMoodboardWireEffects` for restyle (no model switch)**

In `runMoodboardWireEffects` (line 3084), after the `files` fetch block (right after the closing `} catch { ... }` on line 3089) and before the `const defs = ...` line, insert:

```ts
  // Restyle: no model switch — its engine (Nano Banana 2) is already
  // multi-image and its selector is not the shared catalog. Attach the board
  // (identity + refs) and disconnect any wired single style image.
  if (gen.data?.nodeType === 'RestyleFromImageNode') {
    applyMoodboardToRestyleNode(gen.data, entry, files)
    disconnectStyleImageEdge(gen)
    return
  }
```

- [ ] **Step 3: Widen the three gates**

Line 3115 — replace:

```ts
  if (!gen || gen.data?.nodeType !== 'GenerateImageNode') return
```
with:
```ts
  if (!gen || !nodeTakesMoodboard(gen.data?.nodeType)) return
```

Line 3175 (`maybeApplyTasteWire`) — replace:

```ts
  if (targetNode?.data?.nodeType !== 'GenerateImageNode') return
```
with:
```ts
  if (!nodeTakesMoodboard(targetNode?.data?.nodeType)) return
```

Line 3204 (`onEdgesChange`) — replace:

```ts
    if (gen?.data?.nodeType !== 'GenerateImageNode') continue
```
with:
```ts
    if (!nodeTakesMoodboard(gen?.data?.nodeType)) continue
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | tail -20`
Expected: no NEW errors mentioning `VueNodeCanvas.vue`, `moodboardApply`, `styleInject`, or the symbols added here. (This repo carries a ~328-error typecheck baseline — compare against it; any error naming the files/symbols this task introduced is a real regression and must be fixed.)

- [ ] **Step 5: Browser-pane E2E verification (real wiring, headless)**

Restart ComfyUI so the new `style_in` port exists on restyle (`cd /Users/julien/Documents/GitHub/Sailor && .venv/bin/python main.py --listen 127.0.0.1 --port 8188` — or `./dev.sh`), start the frontend dev server, and open the canvas in the Browser pane at `127.0.0.1:3000` (NOT localhost — see the dev-server memory).

In the Browser pane console (`javascript_tool`), verify the real wire path:

```js
// 1. Add a RestyleFromImageNode and a Moodboard node, wire style→style_in.
//    Use the existing sailor:moodboardWire recipe:
window.dispatchEvent(new CustomEvent('sailor:moodboardWire', {
  detail: { nodeId: '<restyleNodeId>', entryId: '<aBoardId>' },
}))
```

Then assert, in the console:
- `nodes` state for the restyle node has `properties.sailor_moodboard === '<aBoardId>'` and a non-empty `properties.style_refs`.
- `properties.sailor_moodboard_switched` is **undefined** (no model switch).
- an edge exists from the Moodboard node into the restyle node's `style_in` handle.
- if a `style_image` edge was present first, it is now gone.

Capture a screenshot showing the wired restyle node.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(restyle): canvas wires a moodboard into restyle (no model switch)

nodeTakesMoodboard() gates all four moodboard-wire sites; restyle takes a
dedicated apply that attaches refs and disconnects the style_image edge.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — chip on restyle + disabled `style_image` slot

**Files:**
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue` — `generateMoodboardId` (962-966), the chip mount (`v-if` at ~1851), the input-port `v-for` (1603-1614)
- Modify: `frontend/app/components/vue-canvas/NodePort.vue` — add a `disabled` prop
- Verify: typecheck + Browser-pane visual

**Interfaces:**
- Consumes: `generateMoodboardId` (widened), `getInputTooltip`, `WidgetMoodboardChip` (existing), `NodePort` (gets a new `disabled` prop).
- Produces: no exported API; UI behavior only.

- [ ] **Step 1: Widen the chip's node-type gate**

In `ComfyNode.vue`, `generateMoodboardId` (line 963), replace:

```ts
  if (props.data.nodeType !== 'GenerateImageNode') return null
```
with:
```ts
  if (props.data.nodeType !== 'GenerateImageNode'
      && props.data.nodeType !== 'RestyleFromImageNode') return null
```

- [ ] **Step 2: Mount the chip on restyle too**

Find the chip mount (`<div v-if="data.nodeType === 'GenerateImageNode'" class="px-2.5">` at ~1851) and replace that `v-if` condition with:

```html
    <div v-if="data.nodeType === 'GenerateImageNode' || data.nodeType === 'RestyleFromImageNode'" class="px-2.5">
```

The `:switched-from="generateMoodboardSwitchedFrom ?? undefined"` binding is left as-is — restyle never sets `sailor_moodboard_switched`, so it resolves to `undefined` and the banner (self-gated by `v-if="switchedFrom"` in `WidgetMoodboardChip.vue`) never renders on restyle. No other chip binding changes.

- [ ] **Step 3: Add a `disabled` prop to `NodePort`**

In `frontend/app/components/vue-canvas/NodePort.vue`, add `disabled` to the props (in the `withDefaults(defineProps<{...}>(), {...})` block — add `disabled?: boolean` to the type and `disabled: false` to the defaults):

```ts
  connectable?: boolean
  /** Greyed + non-connectable: the slot is overridden (e.g. a moodboard is
   *  providing the style, so style_image is inert). */
  disabled?: boolean
}>(), { connectable: true, disabled: false })
```

Update the dot's `borderColor` (line 95) to mute when disabled:

```ts
        borderColor: disabled ? '#4b5563' : color,
```

and force the Handle non-connectable when disabled — replace line 120:

```ts
      :connectable="props.connectable"
```
with:
```ts
      :connectable="props.connectable && !disabled"
```

- [ ] **Step 4: Pass `disabled` + override tooltip for the overridden `style_image`**

In `ComfyNode.vue`, in the input-port `v-for` (lines 1603-1614), add the two bindings so a restyle node with a moodboard greys its `style_image` slot:

```html
  <VueCanvasNodePort
    v-for="(port, i) in visiblePorts"
    :id="`input-${port.idx}`"
    :key="`in-${port.idx}`"
    type="target"
    side="left"
    :index="i"
    :data-type="port.slot.type"
    :label="port.slot.name"
    :tooltip="data.nodeType === 'RestyleFromImageNode' && generateMoodboardId && port.slot.name === 'style_image'
      ? 'Moodboard is providing the style'
      : getInputTooltip(data.nodeType, port.slot.name)"
    :disabled="data.nodeType === 'RestyleFromImageNode' && !!generateMoodboardId && port.slot.name === 'style_image'"
    :connectable="!isCapsule"
  />
```

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | tail -20`
Expected: no NEW errors naming `ComfyNode.vue` or `NodePort.vue`.

- [ ] **Step 6: Browser-pane visual verification**

With ComfyUI restarted and the dev server up (Task 4 Step 5), in the Browser pane:
- Wire a moodboard into a restyle node (as in Task 4 Step 5).
- Confirm the moodboard chip renders on the restyle node with the "refs ✓" badge and **no** "Switched to Nano Banana" banner.
- Confirm the `style_image` port dot is greyed and shows the tooltip "Moodboard is providing the style" on hover, and that a wire cannot be started from it.
- Clear the board via the chip ✕ and confirm the `style_image` slot re-enables.
- Screenshot both states.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/ComfyNode.vue frontend/app/components/vue-canvas/NodePort.vue
git commit -m "feat(restyle): moodboard chip on restyle + disabled style_image slot

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Live paid render + dashboard update

**Files:**
- Verify: real render (no code)
- Modify: the ⛵ State-of-the-Build artifact + `docs/STATE.md` (standing rule)

- [ ] **Step 1: Run one real restyle-with-moodboard render**

With the stack running, on the canvas: wire a content photo → restyle `content_image`, wire a moodboard → `style_in`, and Play. Confirm:
- the content subject survives and the board's look transfers, AND
- the moodboard path actually ran — inspect the outgoing workflow / network request and confirm restyle's `style_refs` widget carried the `{folder, files}` payload and `image_input` had >2 entries (content + board), NOT a silent fallover to the plain 2-image restyle. ("It rendered" is not evidence — assert the path.)

- [ ] **Step 2: Update the build dashboard**

Read the LIVE ⛵ State-of-the-Build artifact first (other sessions publish to it), then add this feature to it and to `docs/STATE.md`. Note the live render result from Step 1.

- [ ] **Step 3: Commit any doc changes**

```bash
git add docs/STATE.md
git commit -m "docs(state): restyle accepts a moodboard as the style source

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Restyle-from-image accepts a moodboard → Task 1 (schema/execute), Task 4 (wiring). ✓
- Moodboard overrides the single style image → Task 1 (execute ignores style_image when refs present) + Task 4 (disconnects the edge) + Task 5 (disables the slot). ✓
- Uses whole board — images + taste reading → Task 1 (board images in `image_input` + `style_in`/taste folded into instruction). ✓
- Reuse the existing style channel → Tasks 1/3 reuse `_parse_style_refs`, `_STYLE_REFS_INSTRUCTION`, `style_refs`/`style_in`. ✓
- No model switch on restyle → Task 2 (dedicated helper) + Task 4 (restyle branch returns before the switch code). ✓
- IP-Adapter single-image fallback → Task 1 `test_ip_adapter_falls_back_to_first_board_image`. ✓
- Disconnect the style_image edge → Task 4 `disconnectStyleImageEdge` + Task 5 disabled slot. ✓
- Chip renders, no banner → Task 5. ✓
- Zero regression with no board → Task 1 `test_no_board_is_unchanged_single_style_image`; the `STYLE_CHANNEL_NODES`/`nodeTakesMoodboard` widenings are additive. ✓
- Shared guard, one source of truth → Task 4 `nodeTakesMoodboard` + Task 3 `STYLE_CHANNEL_NODES`. ✓

**Deviation from the spec (intentional):** the spec listed a `capabilities.ts:174` edit to add a `style_in` input. That is unnecessary and would diverge from the pattern — `GenerateImageNode` carries `inputs: []` in `capabilities.ts` yet accepts the moodboard TASTE wire, because ports are derived from the ComfyUI `/object_info` schema (the Python `_TASTE.Input("style_in")` in Task 1), not from `capabilities.ts` (which is the agent NL-wiring manifest, IMAGE-typed only). No `capabilities.ts` change is made.

**Placeholder scan:** none — every code step carries full code.

**Type consistency:** `applyMoodboardToRestyleNode` signature identical in Task 2 (def) and Task 4 (call). `nodeTakesMoodboard`/`disconnectStyleImageEdge` defined and used within Task 4. `STYLE_CHANNEL_NODES` local to Task 3. Python `execute` kwargs (`style_in`, `style_refs`) match between Task 1's schema, signature, and tests.
