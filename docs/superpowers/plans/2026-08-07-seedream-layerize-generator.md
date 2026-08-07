# Seedream Layerize Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new "Layerize an image" generator node backed by fal `bytedance/seedream/v5/pro/layerize` that splits a finished image into 2–17 transparent-PNG raster layers, landing them as individually-editable **image layers** in the Compositor via "Edit as Frame".

**Architecture:** A new `SeedreamLayerizeNode` (ComfyUI Python) sends the wired image (as a data URL) + prompt to fal, receives a `layers` array (each an RGBA PNG with a `[left,top,right,bottom]` bounding box and `z_index`), saves each layer PNG to ComfyUI's **input** directory, and emits a `layers_json` STRING describing them. A new frontend `parseSeedreamLayers` converts that JSON into Compositor `ImageLayer`s positioned by bounding box and ordered by z-index; the existing "Edit as Frame" path builds a Frame from them. This is a NEW node, not a change to the text-layer `LayerizeGraphicNode` (whose output contract — `layers_json` describing *text* — is incompatible).

**Tech Stack:** Python 3 (ComfyUI node, pytest), TypeScript (Nuxt 4, vitest).

## Global Constraints

- **fal endpoint:** `bytedance/seedream/v5/pro/layerize`. Input: `image_url` (required — a data URL is accepted), `prompt` (optional, default `""`), `image_size` (enum `auto`|`auto_1K`|`auto_1.5K`|`auto_2K`, default `auto`), `enable_safety_checker` (default true), `enhance_prompt_mode` (`standard`|`fast`, default `standard`). **These slugs/fields are from fal's published schema (Aug 2026); re-verify against the live endpoint before trusting the builder** (matching the repo convention "fal endpoints/schemas verified against fal's live OpenAPI").
- **fal output:** `{ images: [...], layers: [ { image: {url,width,height,...}, z_index, bounding_box: { absolute: [left,top,right,bottom], normalized: [left,top,right,bottom] (0–1000) }, name?, description? } ] }`. **The base image layer has `z_index: 0` and OMITS `bounding_box`/`name`/`description`.** `all_fal_image_urls`/`first_fal_image_url` only read `result["images"]` — the `layers` array must be parsed directly.
- **Image-layer URL resolution (load-bearing):** `ImageLayer.filename` is resolved via `type: 'input'` (`imageLayerUrl`, `useCompositorLayers.ts:533`). `save_generation_output` writes `type: 'output'`. Therefore the node must save each layer PNG into the **input** directory (this plan adds a `save_image_to_input` helper) so `createImageLayer(filename, …)` + `imageLayerUrl` resolve without touching the shared `ImageLayer` model.
- **Geometry convention (mirror `parseIdeogramLayers`):** layer `x`/`y` are normalized **center** positions (`x` = centerX / W, `y` = centerY / H); `w` **and** `h` are normalized to canvas **WIDTH** (`/W`). The base layer (no bounding box) is a full-canvas layer: `x=0.5, y=0.5, w=1, h=H/W`.
- **Stack order:** `sailor_stackOrder` is bottom→top. Sort layers by **ascending `z_index`** (base `z_index:0` at the bottom).
- **`id` / node-type string** `SeedreamLayerizeNode` is the join key across Python registration + all 4 frontend catalog files + the two Edit-as-Frame files — must match byte-for-byte everywhere.
- **No API key in this environment.** Unit tests cover pure logic (fal input builder, result parser, frontend parser). A live paid render is the only proof the endpoint works and is **OWED, not done** (Task 6). Billing is per-layer (~$0.034 <1536², ~$0.068 ≥1536²), so a call is ~$0.07–1.15.
- **Python tests:** `pytest`. **Frontend unit tests:** `cd frontend && npm run test:unit`. **Types:** `cd frontend && npx nuxt typecheck` (real baseline ~412 pre-existing errors; a new entry must add none that name its own symbols).
- Commit main-direct, staging only your own files by explicit path; never `git add -A`, never `git stash` (parallel sessions are active).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `comfy_api_nodes/seedream_layerize.py` | Pure fal input builder + result parser | Create |
| `comfy_extras/_live_preview.py` | Image-save helpers | Add `save_image_to_input` |
| `comfy_api_nodes/nodes_replicate.py` | Node classes + registration | Add `SeedreamLayerizeNode` + register it |
| `frontend/app/composables/useCompositorLayers.ts` | Layer parsing + types | Add `parseSeedreamLayers` + `SeedreamImport` |
| `frontend/app/components/vue-canvas/ComfyNode.vue` | Node footer | Add node type to `showEditAsFrame`/readiness |
| `frontend/app/components/vue-canvas/VueNodeCanvas.vue` | Edit-as-Frame + sink suppression | Add Seedream branch |
| `frontend/app/data/action-catalog.ts` | Action metadata | Add entry |
| `frontend/app/data/generator-icons.ts` | Icon + brand | Add 2 entries |
| `frontend/app/lib/agent/capabilities.ts` | Agent capability | Add entry |
| `frontend/app/lib/nodeDescriptions.ts` | Human description | Add entry (alphabetical) |
| `tests/seedream_layerize_test.py` | Python pure-logic tests | Create |
| `frontend/tests/unit/seedream-layerize.unit.spec.ts` | Frontend parser test | Create |

---

## Task 1: Python — fal input builder + result parser (pure, tested)

**Files:**
- Create: `comfy_api_nodes/seedream_layerize.py`
- Test: `tests/seedream_layerize_test.py`

**Interfaces:**
- Produces: `seedream_layerize_input(prompt: str, image_url: str, image_size: str) -> dict`; `parse_seedream_layers(result: dict) -> tuple[list[dict], int, int]` returning `(layers, width, height)` where each layer dict is `{"url": str, "z_index": int, "box": list[int]|None, "name": str, "description": str}` and `width`/`height` are the base-image dimensions.

- [ ] **Step 1: Verify the live fal schema**

WebFetch `https://fal.ai/models/bytedance/seedream/v5/pro/layerize/api`. Confirm input field names (`image_url`, `prompt`, `image_size` enum values) and the output `layers[]` shape (`image.url`, `z_index`, `bounding_box.absolute` = `[left,top,right,bottom]`, base layer omits `bounding_box`). If fal rate-limits (429), proceed with the schema in Global Constraints and note the deferral in the report.

- [ ] **Step 2: Write the failing tests**

Create `tests/seedream_layerize_test.py`:

```python
"""Pure-logic tests for the Seedream layerize node.

The fal endpoint returns a `layers` array (NOT `images`), each layer an RGBA PNG
with a [left,top,right,bottom] bounding box and z_index; the base layer has
z_index 0 and no bounding box. These tests pin the input payload shape and the
result parsing that the node's I/O wraps.
"""
from comfy_api_nodes.seedream_layerize import seedream_layerize_input, parse_seedream_layers

SAMPLE = {
    "images": [{"url": "http://x/flat.png", "width": 1024, "height": 768}],
    "layers": [
        {"image": {"url": "http://x/bg.png", "width": 1024, "height": 768}, "z_index": 0},
        {"image": {"url": "http://x/flower.png", "width": 200, "height": 150},
         "z_index": 2, "bounding_box": {"absolute": [100, 80, 300, 230],
         "normalized": [98, 104, 293, 299]}, "name": "flower", "description": "a red flower"},
    ],
}


def test_input_has_required_fal_fields():
    inp = seedream_layerize_input("split it", "data:image/png;base64,x", "auto")
    assert inp["image_url"] == "data:image/png;base64,x"
    assert inp["prompt"] == "split it"
    assert inp["image_size"] == "auto"


def test_input_image_size_falls_back_to_auto_for_bad_value():
    assert seedream_layerize_input("", "data:...", "huge")["image_size"] == "auto"
    assert seedream_layerize_input("", "data:...", "auto_2K")["image_size"] == "auto_2K"


def test_parse_returns_base_dimensions():
    layers, w, h = parse_seedream_layers(SAMPLE)
    assert (w, h) == (1024, 768)


def test_parse_base_layer_has_no_box():
    layers, _, _ = parse_seedream_layers(SAMPLE)
    base = next(l for l in layers if l["z_index"] == 0)
    assert base["box"] is None
    assert base["url"] == "http://x/bg.png"


def test_parse_element_layer_carries_absolute_box_and_name():
    layers, _, _ = parse_seedream_layers(SAMPLE)
    el = next(l for l in layers if l["z_index"] == 2)
    assert el["box"] == [100, 80, 300, 230]
    assert el["name"] == "flower"
    assert el["url"] == "http://x/flower.png"


def test_parse_empty_result_is_empty_not_crash():
    assert parse_seedream_layers({}) == ([], 0, 0)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest tests/seedream_layerize_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_api_nodes.seedream_layerize'`.

- [ ] **Step 4: Implement the module**

Create `comfy_api_nodes/seedream_layerize.py`:

```python
"""Pure input-builder + result-parser for the Seedream layerize node.

Kept free of torch / ComfyUI imports so the payload shape and layer parsing are
unit-testable without a graph. The node in nodes_replicate.py wraps these with
the fal call, per-layer download, and input-dir save.
"""
from __future__ import annotations

from typing import Any

_IMAGE_SIZES = {"auto", "auto_1K", "auto_1.5K", "auto_2K"}


def seedream_layerize_input(prompt: str, image_url: str, image_size: str) -> dict:
    """Shape the request for fal bytedance/seedream/v5/pro/layerize."""
    size = image_size if image_size in _IMAGE_SIZES else "auto"
    return {
        "prompt": prompt or "",
        "image_url": image_url,
        "image_size": size,
    }


def parse_seedream_layers(result: dict) -> tuple[list[dict], int, int]:
    """Flatten fal's `layers` array into simple dicts + base image dimensions.

    Each returned layer: {url, z_index, box|None ([l,t,r,b] absolute), name, description}.
    The base layer (z_index 0) has no bounding_box -> box is None. Width/height come
    from the base layer image, falling back to result['images'][0].
    """
    raw = (result or {}).get("layers") or []
    out: list[dict] = []
    for layer in raw:
        if not isinstance(layer, dict):
            continue
        img = layer.get("image") or {}
        url = img.get("url")
        if not isinstance(url, str):
            continue
        bbox = layer.get("bounding_box") or {}
        box = bbox.get("absolute") if isinstance(bbox, dict) else None
        if not (isinstance(box, list) and len(box) == 4):
            box = None
        out.append({
            "url": url,
            "z_index": int(layer.get("z_index", 0)),
            "box": box,
            "name": str(layer.get("name") or ""),
            "description": str(layer.get("description") or ""),
            "width": int(img.get("width") or 0),
            "height": int(img.get("height") or 0),
        })
    # Base image dimensions: the z_index==0 layer, else images[0], else 0.
    base = next((l for l in out if l["z_index"] == 0 and l["width"]), None)
    if base:
        w, h = base["width"], base["height"]
    else:
        imgs = (result or {}).get("images") or []
        first = imgs[0] if imgs and isinstance(imgs[0], dict) else {}
        w, h = int(first.get("width") or 0), int(first.get("height") or 0)
    return out, w, h
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/seedream_layerize_test.py -v`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add comfy_api_nodes/seedream_layerize.py tests/seedream_layerize_test.py
git commit -m "feat(layerize): pure fal input builder + result parser for Seedream layerize"
```

---

## Task 2: Python — the node + input-dir save + registration

**Files:**
- Modify: `comfy_extras/_live_preview.py` (add `save_image_to_input`)
- Modify: `comfy_api_nodes/nodes_replicate.py` (node class near the layerize nodes ~`:4451`; registration ~`:6099`)

**Interfaces:**
- Consumes: `seedream_layerize_input`, `parse_seedream_layers` (Task 1); `_image_tensor_to_data_url` (`nodes_replicate.py:195`), `fal_refs.run_fal_prediction`/`first_fal_image_url`, `download_url_to_image_tensor`, `save_generation_output`, `save_image_to_input`.
- Produces: node type `SeedreamLayerizeNode` emitting outputs `preview` (IMAGE) + `layers_json` (STRING), with `is_output_node=True` and `ui={"images":[preview], "text":[layers_json]}`. `layers_json` schema: `{"source":"seedream","width":W,"height":H,"layers":[{"filename","z_index","box":[l,t,r,b]|null,"name","description"}]}`.

- [ ] **Step 1: Write the failing test for the save helper**

Add to `tests/seedream_layerize_test.py`:

```python
def test_save_image_to_input_returns_filename(tmp_path, monkeypatch):
    import numpy as np, torch
    from comfy_extras import _live_preview
    monkeypatch.setattr(_live_preview.folder_paths, "get_input_directory", lambda: str(tmp_path))
    t = torch.zeros((64, 64, 4))  # RGBA, alpha 0 (transparent)
    fname = _live_preview.save_image_to_input(t, "seedream_layer")
    assert fname.endswith(".png")
    saved = tmp_path / fname
    assert saved.exists()
    from PIL import Image
    im = Image.open(saved)
    assert im.mode == "RGBA"  # transparency preserved
```

- [ ] **Step 2: Run to verify it fails**

Run: `pytest tests/seedream_layerize_test.py::test_save_image_to_input_returns_filename -v`
Expected: FAIL — `AttributeError: module 'comfy_extras._live_preview' has no attribute 'save_image_to_input'`.

- [ ] **Step 3: Add `save_image_to_input`**

In `comfy_extras/_live_preview.py`, add (mirroring `save_generation_output` at `:64`, but writing ONE image to the INPUT dir and returning its filename — image layers resolve against the input dir):

```python
def save_image_to_input(image_tensor: torch.Tensor, filename_prefix: str = "layer") -> str:
    """Save a single (H,W,C) image tensor as a uniquely-named PNG in the INPUT
    directory and return its filename. Used for layers that become editable
    Compositor ImageLayers (which resolve filenames via type='input'). RGBA
    (4-channel) tensors save with transparency preserved.
    """
    in_dir = folder_paths.get_input_directory()
    full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(
        filename_prefix, in_dir
    )
    os.makedirs(full_output_folder, exist_ok=True)
    img = image_tensor if image_tensor.ndim == 3 else image_tensor[0]
    arr = np.clip(255.0 * img.cpu().numpy(), 0, 255).astype(np.uint8)
    file = f"{filename}_{counter:05}_.png"
    PILImage.fromarray(arr).save(os.path.join(full_output_folder, file), "PNG")
    return file
```

> Confirm `folder_paths`, `os`, `np`, `PILImage`, `torch` are already imported at the top of `_live_preview.py` (they are, per `save_generation_output`). If `get_save_image_path` rejects the input dir, fall back to writing directly under `folder_paths.get_input_directory()` with a uuid-suffixed name.

- [ ] **Step 4: Run to verify it passes**

Run: `pytest tests/seedream_layerize_test.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Add the node class**

In `nodes_replicate.py`, near the other layerize nodes (after `SplitPhotoLayersNode`, ~`:4648`), add. Model the schema on `LayerizeGraphicNode` (`:4451`) and the fal-image handling on `_run_fal_kontext` (`:1059`):

```python
class SeedreamLayerizeNode(IO.ComfyNode):
    """Split a finished image into 2-17 transparent-PNG raster layers via fal
    Seedream 5 Pro Layerize. Emits a preview + layers_json; "Edit as Frame"
    turns the layers into editable Compositor image layers."""
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="SeedreamLayerizeNode",
            display_name="Layerize an image",
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("image"),
                IO.String.Input("prompt", multiline=True, default="",
                                tooltip="Optional guidance for how to split the image."),
                IO.Combo.Input("image_size", options=["auto", "auto_1K", "auto_1.5K", "auto_2K"],
                               default="auto", optional=True),
            ],
            outputs=[
                IO.Image.Output(display_name="preview"),
                IO.String.Output(display_name="layers_json"),
            ],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.34,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, image, prompt, image_size="auto"):
        from comfy_api_nodes import fal_refs
        from comfy_api_nodes.seedream_layerize import seedream_layerize_input, parse_seedream_layers
        import json as _json

        inp = seedream_layerize_input(prompt, _image_tensor_to_data_url(image), image_size)
        result = await fal_refs.run_fal_prediction(
            "bytedance/seedream/v5/pro/layerize", "", inp, poll_deadline_sec=300)
        layers, W, H = parse_seedream_layers(result)

        out_layers = []
        for lyr in layers:
            tensor = await download_url_to_image_tensor(lyr["url"], cls=cls)
            fname = save_image_to_input(tensor, "seedream_layer")
            out_layers.append({
                "filename": fname, "z_index": lyr["z_index"], "box": lyr["box"],
                "name": lyr["name"], "description": lyr["description"],
            })
        layers_json = _json.dumps({"source": "seedream", "width": W, "height": H, "layers": out_layers})

        # Preview: the recomposed flat image if fal returned one, else the input.
        preview_url = fal_refs.first_fal_image_url(result)
        preview = await download_url_to_image_tensor(preview_url, cls=cls) if preview_url else image
        ui = save_generation_output(preview, "seedream_layerize")
        if out_layers:
            ui = {**ui, "text": [layers_json]}
        return IO.NodeOutput(preview, layers_json, ui=ui)
```

> `save_image_to_input` must be imported at the top of `nodes_replicate.py` alongside `save_generation_output` (the existing import line is `from comfy_extras._live_preview import save_live_preview, save_generation_output` at `:65` — add `save_image_to_input`). Confirm the exact `IO.Combo.Input`/`IO.String.Input` keyword names against a sibling node (e.g. `LayerizeGraphicNode`'s inputs) — match whatever that file uses (`options=`, `multiline=`, `optional=`, `default=`).

- [ ] **Step 6: Register the node**

In `ReplicateExtension.get_node_list()` (~`:6099`), in the image-manipulation block next to the other two, add:

```python
            SeedreamLayerizeNode,       # Layerize an image (raster layers) · Seedream 5 Pro Layerize
```

- [ ] **Step 7: Import-sanity check**

The node has real torch/ComfyUI deps, so a full graph run isn't runnable here; verify the module imports and the pure functions are wired:

Run: `python -c "import ast; ast.parse(open('comfy_api_nodes/nodes_replicate.py').read()); print('parse ok')"`
Expected: `parse ok` (syntax valid).
Run: `pytest tests/seedream_layerize_test.py -v`
Expected: PASS (7 tests) — confirms the pure module the node imports is intact.

- [ ] **Step 8: Commit**

```bash
git add comfy_extras/_live_preview.py comfy_api_nodes/nodes_replicate.py tests/seedream_layerize_test.py
git commit -m "feat(layerize): SeedreamLayerizeNode — fal layerize, layers to input dir + layers_json"
```

---

## Task 3: Frontend — `parseSeedreamLayers` + type + test

**Files:**
- Modify: `frontend/app/composables/useCompositorLayers.ts` (near `parseIdeogramLayers` `:336`)
- Test: `frontend/tests/unit/seedream-layerize.unit.spec.ts` (create)

**Interfaces:**
- Consumes: `createImageLayer` (`:508`), `ImageLayer` (`:279`).
- Produces: `export interface SeedreamImport { width: number; height: number; imageLayers: ImageLayer[] }` and `export function parseSeedreamLayers(json: string): SeedreamImport | null`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/seedream-layerize.unit.spec.ts` (mirroring `combine-frame.unit.spec.ts` structure):

```typescript
import { describe, it, expect } from 'vitest'
import { parseSeedreamLayers } from '~/composables/useCompositorLayers'

const JSON_IN = JSON.stringify({
  source: 'seedream', width: 1000, height: 500,
  layers: [
    { filename: 'bg.png', z_index: 0, box: null, name: '', description: '' },
    { filename: 'flower.png', z_index: 2, box: [100, 50, 300, 250], name: 'flower', description: '' },
    { filename: 'bottle.png', z_index: 1, box: [400, 100, 500, 400], name: 'bottle', description: '' },
  ],
})

describe('parseSeedreamLayers', () => {
  it('returns canvas dims + one image layer per input layer', () => {
    const r = parseSeedreamLayers(JSON_IN)!
    expect(r.width).toBe(1000)
    expect(r.height).toBe(500)
    expect(r.imageLayers).toHaveLength(3)
    expect(r.imageLayers.every((l) => l.kind === 'image')).toBe(true)
  })

  it('places the base (boxless) layer as a full-canvas image', () => {
    const r = parseSeedreamLayers(JSON_IN)!
    const base = r.imageLayers.find((l) => l.filename === 'bg.png')!
    expect(base.x).toBeCloseTo(0.5)
    expect(base.y).toBeCloseTo(0.5)
    expect(base.w).toBeCloseTo(1)          // full width
    expect(base.h).toBeCloseTo(500 / 1000) // H/W (width-normalized)
  })

  it('positions an element by its [l,t,r,b] box, width-normalized', () => {
    const r = parseSeedreamLayers(JSON_IN)!
    const f = r.imageLayers.find((l) => l.filename === 'flower.png')!
    expect(f.x).toBeCloseTo(((100 + 300) / 2) / 1000)  // center X / W
    expect(f.y).toBeCloseTo(((50 + 250) / 2) / 500)    // center Y / H
    expect(f.w).toBeCloseTo((300 - 100) / 1000)        // box W / W
    expect(f.h).toBeCloseTo((250 - 50) / 1000)         // box H / W
  })

  it('returns imageLayers ordered bottom→top by z_index', () => {
    const r = parseSeedreamLayers(JSON_IN)!
    expect(r.imageLayers.map((l) => l.filename)).toEqual(['bg.png', 'bottle.png', 'flower.png'])
  })

  it('returns null for junk', () => {
    expect(parseSeedreamLayers('not json')).toBeNull()
    expect(parseSeedreamLayers(JSON.stringify({ layers: [] }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npm run test:unit -- seedream-layerize`
Expected: FAIL — `parseSeedreamLayers` is not exported.

- [ ] **Step 3: Implement `parseSeedreamLayers`**

In `useCompositorLayers.ts`, after `parseIdeogramLayers` (~`:368`), add:

```typescript
export interface SeedreamImport { width: number; height: number; imageLayers: ImageLayer[] }

/** Convert a SeedreamLayerizeNode `layers_json` into Compositor image layers.
 *  Each layer's PNG lives in the input dir (referenced by `filename`); geometry
 *  follows the shared convention — x/y are normalized centers, w AND h normalize
 *  to WIDTH. A boxless layer (the base) fills the canvas. Ordered bottom→top by z. */
export function parseSeedreamLayers(json: string): SeedreamImport | null {
  let root: any
  try { root = JSON.parse(json) } catch { return null }
  const W = Number(root?.width), H = Number(root?.height)
  const raw: any[] = Array.isArray(root?.layers) ? root.layers : []
  if (!W || !H || !raw.length) return null
  const sorted = [...raw].sort((a, b) => (Number(a?.z_index) || 0) - (Number(b?.z_index) || 0))
  const imageLayers: ImageLayer[] = []
  for (const l of sorted) {
    const filename = String(l?.filename || '')
    if (!filename) continue
    const box = Array.isArray(l?.box) && l.box.length === 4 ? l.box.map(Number) : null
    let x = 0.5, y = 0.5, w = 1, h = H / W
    if (box) {
      const [left, top, right, bottom] = box
      x = ((left + right) / 2) / W
      y = ((top + bottom) / 2) / H
      w = (right - left) / W
      h = (bottom - top) / W        // width-normalized, per LayerCommon convention
    }
    imageLayers.push(createImageLayer(filename, 1, {
      x, y, w, h, opacity: 1, name: String(l?.name || '') || undefined,
    }))
  }
  if (!imageLayers.length) return null
  return { width: W, height: H, imageLayers }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npm run test:unit -- seedream-layerize`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useCompositorLayers.ts frontend/tests/unit/seedream-layerize.unit.spec.ts
git commit -m "feat(layerize): parseSeedreamLayers — layers_json to Compositor image layers"
```

---

## Task 4: Frontend — "Edit as Frame" wiring

**Files:**
- Modify: `frontend/app/components/vue-canvas/ComfyNode.vue` (`:1452-1468`)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (`handleEditAsFrame` `:2411`; sink suppression `:7073`)

**Interfaces:**
- Consumes: `parseSeedreamLayers`, `ensureLayerImages`, `createNodeData` (existing); the `data.text` payload the node set in Task 2.

- [ ] **Step 1: Enable the footer button for the new node**

In `ComfyNode.vue`, extend the two computeds (`:1452-1461`):

```typescript
const showEditAsFrame = computed(() =>
  props.data.nodeType === 'LayerizeGraphicNode'
  || props.data.nodeType === 'SplitPhotoLayersNode'
  || props.data.nodeType === 'SeedreamLayerizeNode')
const editAsFrameReady = computed(() => {
  if (props.data.nodeType === 'LayerizeGraphicNode' || props.data.nodeType === 'SeedreamLayerizeNode')
    return !!(props.data as any).text
  return true
})
```

- [ ] **Step 2: Add the Seedream branch to `handleEditAsFrame`**

In `VueNodeCanvas.vue`, extend `handleEditAsFrame` (`:2411`). Add a `parseSeedreamLayers` import to the `useCompositorLayers` import line (`:25`), then handle the Seedream case — all layers are LOCAL image layers (no wiring), ordered by z-index. Replace the `isLayerize`/parse block with a three-way that also detects Seedream:

```typescript
  const nodeType = src.data?.nodeType
  const isLayerize = nodeType === 'LayerizeGraphicNode'
  const isSeedream = nodeType === 'SeedreamLayerizeNode'
  const parsed = isLayerize ? parseIdeogramLayers(String(src.data?.text || '')) : null
  const seedream = isSeedream ? parseSeedreamLayers(String(src.data?.text || '')) : null
  if (isLayerize && (!parsed || !parsed.textLayers.length)) {
    console.warn('[EditAsFrame] no usable text layers in layers_json')
    if (!parsed) return
  }
  if (isSeedream && (!seedream || !seedream.imageLayers.length)) {
    console.warn('[EditAsFrame] no usable image layers from Seedream layerize')
    return
  }

  const dims = parsed ? { width: parsed.width, height: parsed.height }
              : seedream ? { width: seedream.width, height: seedream.height } : undefined
  const pos = { x: (src.position?.x ?? 0) + (src.data?.size?.[0] ?? 240) + 120, y: src.position?.y ?? 0 }
  const frame = createNodeData('Compositor', pos, dims)
  const frameProps = (frame.data.properties ||= {}) as Record<string, any>
  // ... keep the existing `wire(...)` helper unchanged ...

  if (seedream) {
    frameProps.sailor_frame = { ...(frameProps.sailor_frame || {}), preset: 'custom' }
    frameProps.sailor_localLayers = seedream.imageLayers
    // All local image layers, already bottom→top by z-index. No wired inputs.
    frameProps.sailor_stackOrder = seedream.imageLayers.map((l) => `l:${l.id}`)
    ensureLayerImages(seedream.imageLayers as any).catch(() => {})
    nodes.value.push(frame as any)
  } else if (parsed) {
    // ... existing Layerize branch unchanged ...
  } else {
    // ... existing SplitPhoto branch unchanged ...
  }
```

> Preserve the existing `parsed`/else branches verbatim; only ADD the `seedream` branch first. Confirm `ensureLayerImages` is in the `:25` import (it is). If `createNodeData`'s 3rd arg shape differs, match the existing `parsed` call.

- [ ] **Step 3: Suppress the layers_json auto-sink**

In `VueNodeCanvas.vue` (~`:7078`), extend the Layerize guard so Seedream's `layers_json` isn't dumped as a Text node:

```typescript
  if ((src.data?.nodeType === 'LayerizeGraphicNode' || src.data?.nodeType === 'SeedreamLayerizeNode')
      && outputs[i].name === 'layers_json') continue
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx nuxt typecheck 2>&1 | grep -i "seedream\|handleEditAsFrame"`
Expected: no output. Confirm total error count did not rise vs the ~412 baseline (swap-compare the two files via `git show HEAD:<file>` if unsure).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/ComfyNode.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "feat(layerize): Edit-as-Frame builds a Compositor frame from Seedream image layers"
```

---

## Task 5: Frontend — catalog entries

**Files:**
- Modify: `frontend/app/data/action-catalog.ts` (`:46`), `frontend/app/data/generator-icons.ts` (`:76`, `:147`), `frontend/app/lib/agent/capabilities.ts` (`:211`), `frontend/app/lib/nodeDescriptions.ts` (`:267`)

**Interfaces:**
- Consumes: the existing catalog shapes; the node type `SeedreamLayerizeNode`.

- [ ] **Step 1: `action-catalog.ts`** — add next to the other layerize entries (`:46`):

```typescript
  SeedreamLayerizeNode:  { useCase: 'Layerize an image',              model: 'Seedream 5 Pro Layerize',                  intent: 'edit' },
```

- [ ] **Step 2: `generator-icons.ts`** — icon map (`:76`) and brand map (`:147`):

```typescript
  SeedreamLayerizeNode: Layers3,
```
```typescript
  SeedreamLayerizeNode: 'ByteDance',
```
Confirm `Layers3` is imported from lucide at the top of the file; if not, add it to the import (or reuse an imported-but-unused layer icon). Confirm `'ByteDance'` is the brand string used elsewhere and has a `BRAND_COLORS` entry (`brand-icons.ts:86` — it does).

- [ ] **Step 3: `capabilities.ts`** — add next to the other layerize entries (`:211`):

```typescript
  { nodeType: 'SeedreamLayerizeNode', kind: 'effect', title: 'Layerize an image', summary: 'Split a finished image into 2-17 transparent-PNG raster layers, editable in the Compositor.', inputs: [{ name: 'image', type: 'IMAGE' }], outputs: [{ name: 'preview', type: 'IMAGE' }, { name: 'layers_json', type: 'STRING' }],
    intents: ['layerize this image', 'split the image into layers', 'break this into separate objects', 'extract elements as layers'] },
```
Confirm `kind: 'effect'` and the field shape match the sibling entries exactly (copy their structure).

- [ ] **Step 4: `nodeDescriptions.ts`** — insert in ALPHABETICAL position (between `S...` keys; `SeedreamLayerizeNode` sorts before `SplitPhotoLayersNode`):

```typescript
  'SeedreamLayerizeNode': 'Splits a finished image into 2-17 independent transparent-PNG raster layers (background plus separate elements), editable as Compositor image layers, using Seedream 5 Pro Layerize.',
```

- [ ] **Step 5: Run the catalog-integrity tests + typecheck**

Run: `cd frontend && npm run test:unit -- action-catalog agent-capability-routing`
Expected: PASS (the new entry has a valid `intent`/`useCase` and routable intents).
Run: `cd frontend && npx nuxt typecheck 2>&1 | grep -i seedream`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/data/action-catalog.ts frontend/app/data/generator-icons.ts frontend/app/lib/agent/capabilities.ts frontend/app/lib/nodeDescriptions.ts
git commit -m "feat(layerize): catalog + agent-capability entries for SeedreamLayerizeNode"
```

---

## Task 6: Verification

- [ ] **Step 1: Full pure-logic suites**

Run: `pytest tests/seedream_layerize_test.py -q`
Expected: PASS (7).
Run: `cd frontend && npm run test:unit -- seedream-layerize action-catalog agent-capability-routing`
Expected: PASS. (Memory: *vitest-counts-lie-under-load* — if a count looks off, re-run the single file in isolation.)

- [ ] **Step 2: Typecheck sanity**

Run: `cd frontend && npx nuxt typecheck 2>&1 | grep -c "): error TS"`
Expected: ≤ baseline (~412); none naming `Seedream`/`parseSeedreamLayers`.

- [ ] **Step 3: Live paid-render verification (OWED — do not skip, do not fake)**

Unit tests prove the payload/parse/geometry logic, NOT that fal accepts the request or that layers land correctly on the canvas. With a real `FAL_KEY` in `frontend/.env`:
  1. Drop an image on the canvas, add the "Layerize an image" node, wire the image, run. Watch the ComfyUI console for the fal call to `bytedance/seedream/v5/pro/layerize` and confirm the node shows a preview + a layer count (NOT a silent failure — see memory *fal-enum-mismatch-silent-fallover*: a bad fal field 200s at submit and only fails at result).
  2. Confirm the layer PNGs wrote to the **input** dir (each with alpha) and the node's `data.text` holds the `layers_json`.
  3. Click **Edit as Frame** → confirm a Compositor frame opens with one image layer per returned layer, each positioned by its bounding box and stacked base→front, and that each layer is individually selectable/movable (see memory *synthetic-pointer-events-prove-nothing* — verify with a real click, and *graceful-fallback-hides-integration-failure* — assert the layers actually rendered, don't just eyeball a thumbnail).

Record outcomes (layer count, cost, any geometry drift) in a memory note; until then the feature is **code-complete but runtime-unverified**.

---

## Self-Review

- **Spec coverage:** new node (Task 2), pure fal logic (Task 1), frontend parser (Task 3), Edit-as-Frame image-layer path (Task 4), catalogs (Task 5), verification incl. owed render (Task 6). The input-dir vs output-dir constraint is resolved by `save_image_to_input` (Task 2). The geometry convention (center x/y, width-normalized w+h, z-order) is mirrored from `parseIdeogramLayers` and asserted in Task 3's tests.
- **Placeholder scan:** every code step carries real code; verify-against-live-schema and paid-render are concrete actions.
- **Type consistency:** `SeedreamLayerizeNode` is the join string across Python registration + 4 catalogs + 2 Edit-as-Frame files; `layers_json` schema `{source,width,height,layers:[{filename,z_index,box,name,description}]}` is written by Task 2 and read by Task 3's `parseSeedreamLayers`; `parse_seedream_layers` (Python) and `parseSeedreamLayers` (TS) are distinct layers of the pipeline (fal-result→node-json, node-json→ImageLayers) and must not be conflated.
