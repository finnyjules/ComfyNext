# Text Effect × Font Playground typography restyle — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let the Text Effect node restyle the *exact* rendered letterforms from the Font Playground (via an image-edit model) when an image is wired in, while keeping today's Ideogram text-to-image path when it isn't.

**Architecture:** A single dual-mode `TextEffectNode`. A new optional `image` input selects the path: connected → Flux Kontext edit using a per-effect *edit* instruction that preserves letterforms; empty → unchanged Ideogram generate. The effect catalog gains an `edit_template` per effect plus a `build_edit_prompt()` builder (Python only — the TS catalog is untouched because the gallery never consumes edit phrasing). The Font Playground widget gains letter-spacing (em) and a kerning toggle.

**Tech Stack:** Python (ComfyUI `IO.ComfyNode` API, Replicate), pytest (`tests-unit/`), Vue 3 + TypeScript (Nuxt 4), HTML canvas 2D.

---

## ⚠️ Execution notes (read first)

- **Not in a worktree.** This runs on `main`, which has extensive unrelated uncommitted work. **Every commit must stage only the files named in that task** — never `git add -A` / `git add .`.
- **ComfyUI restart** is required after any Python change before it's live (nodes are not hot-reloaded). Frontend changes hot-reload via the Nuxt dev server.
- Use `.venv/bin/python` for all Python/pytest commands (repo convention; `pytest.ini` sets `pythonpath = .`).
- Design reference: [`2026-05-28-text-effect-typography-restyle-design.md`](2026-05-28-text-effect-typography-restyle-design.md).

---

## Task 1: Effect catalog — `edit_template` + `build_edit_prompt`

**Files:**
- Modify: `comfy_api_nodes/text_effects.py` (dataclass + all 16 `EFFECTS` entries + new builder)
- Test: `tests-unit/comfy_api_test/text_effects_test.py` (create)

**Step 1: Write the failing test**

Create `tests-unit/comfy_api_test/text_effects_test.py`:

```python
from comfy_api_nodes.text_effects import (
    EFFECTS,
    EFFECTS_BY_ID,
    DEFAULT_EFFECT_ID,
    build_edit_prompt,
    _EDIT_PRESERVE_SUFFIX,
)


def test_every_effect_has_nonempty_edit_template():
    missing = [e.id for e in EFFECTS if not (e.edit_template or "").strip()]
    assert missing == [], f"effects missing edit_template: {missing}"


def test_build_edit_prompt_appends_preserve_suffix():
    p = build_edit_prompt("liquid-chrome")
    assert EFFECTS_BY_ID["liquid-chrome"].edit_template in p
    assert _EDIT_PRESERVE_SUFFIX in p


def test_build_edit_prompt_falls_back_on_unknown_id():
    p = build_edit_prompt("does-not-exist")
    assert EFFECTS_BY_ID[DEFAULT_EFFECT_ID].edit_template in p
    assert _EDIT_PRESERVE_SUFFIX in p
```

**Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/text_effects_test.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_edit_prompt'` (and `edit_template` doesn't exist yet).

**Step 3: Add the dataclass field**

In `comfy_api_nodes/text_effects.py`, add `edit_template` to the dataclass (before `model_slug`, which has a default):

```python
@dataclass(frozen=True)
class TextEffect:
    id: str
    label: str
    prompt_template: str   # contains "{TEXT}" — generate (text-to-image) path
    edit_template: str = ""  # restyle (image-edit) instruction; material only
    model_slug: str = _TEXT_MODEL_SLUG
```

**Step 4: Add `edit_template` to every effect**

Add `edit_template="…"` as a keyword arg to each of the 16 `TextEffect(...)` calls in `EFFECTS`, using this table (material description only — the shared preserve suffix is appended by the builder):

| id | edit_template |
|---|---|
| liquid-chrome | `Restyle the letters as flowing liquid chrome — glossy mercury metal, sharp studio reflections, Y2K aesthetic, dark seamless background.` |
| inflated-gloss | `Restyle the letters as glossy inflated 3D balloon typography — puffy vacuum-sealed forms, soft studio lighting, subtle subsurface sheen.` |
| iridescent-holo | `Restyle the letters in iridescent holographic foil — oil-slick rainbow sheen, reflective chrome edges, hyper-glossy product finish.` |
| chromatic-glitch | `Restyle the letters with heavy chromatic aberration and RGB channel split — glitch art, datamosh scanlines, VHS distortion.` |
| acid-graphics | `Restyle the letters as acid graphics — hyper-saturated warped chrome, rave-flyer aesthetic, bold melting gradients.` |
| distressed-screenprint | `Restyle the letters as a distressed screenprint — cracked faded ink, halftone grain, vintage graphic-tee print texture.` |
| gradient-mesh | `Restyle the letters with smooth bold gradient-mesh color — soft vibrant transitions, contemporary poster finish.` |
| brutalist-concrete | `Restyle the letters as raw cast brutalist concrete — rough aggregate texture, harsh directional shadows, monolithic surface.` |
| ink-in-water | `Restyle the letters as billowing black ink dispersing through clear water — elegant fluid tendrils, high-speed fine-art look.` |
| smoke-vapor | `Restyle the letters as drifting monochrome smoke and vapor — soft volumetric haze, moody fine-art lighting.` |
| frosted-glass | `Restyle the letters as translucent frosted glass — soft refraction and caustics, shallow depth of field, pastel product finish.` |
| wireframe-mesh | `Restyle the letters as a technical 3D wireframe mesh — glowing topology lines, blueprint aesthetic.` |
| risograph | `Restyle the letters as a risograph print — two-color duotone with misregistration, visible grain and ink texture.` |
| crystalline | `Restyle the letters as cut crystal and gemstone facets — prismatic light refraction, sharp polished edges, luxury finish.` |
| light-trails | `Restyle the letters as glowing long-exposure light trails — neon light-painting streaks, motion blur against darkness.` |
| molten-metal | `Restyle the letters as glowing molten metal — poured liquid steel with incandescent orange heat, dramatic industrial lighting.` |

Example for the first entry:

```python
    TextEffect("liquid-chrome", "Liquid Chrome",
        'the word "{TEXT}" sculpted from flowing liquid chrome, glossy mercury metal with sharp studio reflections, Y2K aesthetic, dark seamless background, octane render, high contrast',
        edit_template='Restyle the letters as flowing liquid chrome — glossy mercury metal, sharp studio reflections, Y2K aesthetic, dark seamless background.'),
```

**Step 5: Add the suffix constant + builder**

Add near `build_prompt` in `comfy_api_nodes/text_effects.py`:

```python
# Appended to every edit instruction so the image-edit model preserves the
# user's exact typography and only changes the surface treatment.
_EDIT_PRESERVE_SUFFIX = (
    "Keep the exact letterforms, spacing, and composition unchanged; "
    "restyle only the surface material and lighting."
)


def build_edit_prompt(effect_id: str, text: str = "") -> str:
    """Instruction for the restyle (image-edit) path. The word already lives in
    the input image, so `text` is unused today — accepted for symmetry with
    build_prompt. Falls back to the default effect on catalog drift."""
    eff = EFFECTS_BY_ID.get(effect_id) or EFFECTS_BY_ID[DEFAULT_EFFECT_ID]
    return f"{eff.edit_template} {_EDIT_PRESERVE_SUFFIX}"
```

Also update the module docstring's "Adding an effect" note to mention `edit_template` and that the TS catalog does **not** need it.

**Step 6: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/text_effects_test.py -v`
Expected: PASS (3 passed).

**Step 7: Commit**

```bash
git add comfy_api_nodes/text_effects.py tests-unit/comfy_api_test/text_effects_test.py
git commit -m "feat: add per-effect edit phrasing + build_edit_prompt to text effects catalog"
```

---

## Task 2: Text Effect node — optional image input + dual-mode dispatch

**Files:**
- Modify: `comfy_api_nodes/nodes_replicate.py` (import block ~`:1792`, `TextEffectNode` schema ~`:1806`, `execute` ~`:1842`)
- Test: `tests-unit/comfy_api_test/text_effect_node_test.py` (create)

**Step 1: Write the failing test**

Create `tests-unit/comfy_api_test/text_effect_node_test.py`:

```python
import asyncio

import pytest
import torch

import comfy_api_nodes.nodes_replicate as nr
from comfy_api_nodes.text_effects import build_prompt, build_edit_prompt


@pytest.fixture
def captured(monkeypatch):
    """Stub every network/IO helper so dispatch can be tested offline."""
    calls = {}

    async def fake_run_prediction(slug, input_dict):
        calls["slug"] = slug
        calls["input"] = input_dict
        return {"output": ["http://example/img.png"]}

    async def fake_download(url, cls=None):
        return torch.zeros(1, 8, 8, 3)

    monkeypatch.setattr(nr, "_run_prediction", fake_run_prediction)
    monkeypatch.setattr(nr, "download_url_to_image_tensor", fake_download)
    monkeypatch.setattr(nr, "_first_output_url", lambda pred: "http://example/img.png")
    monkeypatch.setattr(nr, "_image_tensor_to_data_url", lambda t: "DATA_URL")
    return calls


def test_generate_mode_uses_ideogram(captured):
    asyncio.run(nr.TextEffectNode.execute(
        text="NEXT", effect="liquid-chrome", aspect_ratio="16:9", seed=0, image=None))
    assert captured["slug"] == "ideogram-ai/ideogram-v3-turbo"
    assert captured["input"]["prompt"] == build_prompt("liquid-chrome", "NEXT")
    assert captured["input"]["aspect_ratio"] == "16:9"


def test_restyle_mode_uses_flux_kontext(captured):
    img = torch.zeros(1, 8, 8, 3)
    asyncio.run(nr.TextEffectNode.execute(
        text="", effect="liquid-chrome", aspect_ratio="16:9", seed=0, image=img))
    assert captured["slug"] == "black-forest-labs/flux-kontext-pro"
    assert captured["input"]["input_image"] == "DATA_URL"
    assert captured["input"]["aspect_ratio"] == "match_input_image"
    assert captured["input"]["prompt"] == build_edit_prompt("liquid-chrome", "")


def test_generate_mode_requires_text_but_restyle_does_not(captured):
    # Generate mode with blank text errors…
    with pytest.raises(RuntimeError):
        asyncio.run(nr.TextEffectNode.execute(
            text="  ", effect="liquid-chrome", aspect_ratio="1:1", seed=0, image=None))
    # …but restyle mode with blank text is fine (word is in the image).
    asyncio.run(nr.TextEffectNode.execute(
        text="  ", effect="liquid-chrome", aspect_ratio="1:1", seed=0,
        image=torch.zeros(1, 8, 8, 3)))
    assert captured["slug"] == "black-forest-labs/flux-kontext-pro"
```

**Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/text_effect_node_test.py -v`
Expected: FAIL — `TypeError: execute() got an unexpected keyword argument 'image'`.
(If the module fails to *import* instead, that's a different problem — confirm `.venv/bin/python -c "import comfy_api_nodes.nodes_replicate"` works first; it should, since the server imports it.)

**Step 3: Add `build_edit_prompt` to the import block**

In the `from comfy_api_nodes.text_effects import (…)` block (~`:1792`), add:

```python
    build_edit_prompt as _text_effect_build_edit_prompt,
```

**Step 4: Add the optional image input to the schema**

In `TextEffectNode.define_schema`, append after the `seed` input (still inside `inputs=[…]`):

```python
                IO.Image.Input(
                    "image", optional=True,
                    tooltip="Connect a Font Playground (or any image) to restyle "
                            "its exact letterforms instead of generating from text.",
                ),
```

**Step 5: Rewrite `execute` for dual-mode dispatch**

Replace the body of `execute` with:

```python
    @classmethod
    async def execute(cls, text, effect, aspect_ratio, seed, image=None):
        spec = _TEXT_EFFECTS_BY_ID.get(effect)
        if spec is None:
            # Tolerate catalog drift — fall back to the default effect.
            effect = _TEXT_DEFAULT_EFFECT_ID
            spec = _TEXT_EFFECTS_BY_ID[effect]

        if image is not None:
            # Restyle mode: repaint the exact letterforms from the upstream image
            # (e.g. Font Playground) via an image-edit model. The word already
            # lives in the image, so `text` is optional here.
            instruction = _text_effect_build_edit_prompt(effect, text)
            input_dict = {
                "prompt": instruction,
                "input_image": _image_tensor_to_data_url(image),
                "aspect_ratio": "match_input_image",
                "output_format": "png",
            }
            if seed and seed > 0:
                input_dict["seed"] = int(seed)
            print(f"[TextEffect/restyle] effect={effect!r} instruction={instruction!r}",
                  flush=True)
            pred = await _run_prediction("black-forest-labs/flux-kontext-pro", input_dict)
        else:
            # Generate mode: text-to-image from the effect's prompt template.
            if not (text or "").strip():
                raise RuntimeError("Enter some text to render.")
            prompt = _text_effect_build_prompt(effect, text)
            input_dict = {
                "prompt": prompt,
                "aspect_ratio": _text_effect_aspect_ok(aspect_ratio),
                "magic_prompt_option": "Off",  # we want the literal word, not an LLM rewrite
            }
            if seed and seed > 0:
                input_dict["seed"] = int(seed)
            print(f"[TextEffect] effect={effect!r} text={text!r} "
                  f"slug={spec.model_slug!r} prompt={prompt!r}", flush=True)
            pred = await _run_prediction(spec.model_slug, input_dict)

        tensor = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(tensor)
```

**Step 6: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/text_effect_node_test.py -v`
Expected: PASS (3 passed).

**Step 7: Compile-check the whole module**

Run: `.venv/bin/python -m py_compile comfy_api_nodes/nodes_replicate.py comfy_api_nodes/text_effects.py && echo OK`
Expected: `OK`.

**Step 8: Commit**

```bash
git add comfy_api_nodes/nodes_replicate.py tests-unit/comfy_api_test/text_effect_node_test.py
git commit -m "feat: Text Effect node restyles wired-in typography via Flux Kontext"
```

---

## Task 3: Font Playground — letter-spacing (em) + kerning toggle

**Files:**
- Modify: `frontend/app/components/vue-canvas/widgets/WidgetFontPlayground.vue`

No automated test (the only frontend runner is Playwright e2e); verified manually in Task 4.

**Step 1: Extend `PlaygroundState` + `parse`**

In the `PlaygroundState` interface add:

```typescript
  letterSpacing: number   // em, relative to font size
  kerning: boolean
```

In `parse()`'s returned object add (before `rendered`):

```typescript
    letterSpacing: Number.isFinite(+o.letterSpacing) ? +o.letterSpacing : 0,
    kerning: typeof o.kerning === 'boolean' ? o.kerning : true,
```

**Step 2: Apply to the live preview**

In `previewStyle` (computed) add:

```typescript
  letterSpacing: `${state.value.letterSpacing}em`,
  fontKerning: state.value.kerning ? 'normal' : 'none',
```

**Step 3: Apply to the bake (and measurement)**

In `applyCtxFont(ctx, px)` — which is called on both the measuring scratch context and the real one, so spacing is included in the crop — add after the `ctx.font = …` line:

```typescript
  if ('letterSpacing' in ctx) {
    ;(ctx as any).letterSpacing = `${state.value.letterSpacing * px}px`
  }
  if ('fontKerning' in ctx) {
    ;(ctx as any).fontKerning = state.value.kerning ? 'normal' : 'none'
  }
```

**Step 4: Add mutations**

Beside the other setters:

```typescript
function setLetterSpacing(v: number) { commit({ letterSpacing: v }); scheduleBake() }
function setKerning(v: boolean) { commit({ kerning: v }); scheduleBake() }
```

**Step 5: Add UI controls**

In the `<div class="font-pg__axes">` block, after the Size axis, add a Spacing slider:

```html
      <!-- Letter spacing (tracking), in em -->
      <div class="font-pg__axis">
        <div class="font-pg__axis-head">
          <span>Spacing</span>
          <span class="font-pg__axis-val">{{ state.letterSpacing.toFixed(2) }}em</span>
        </div>
        <input
          type="range" min="-0.05" max="0.5" step="0.01"
          :value="state.letterSpacing"
          class="font-pg__range"
          @input="setLetterSpacing(+($event.target as HTMLInputElement).value)"
        />
      </div>
```

In the `<div class="font-pg__colors">` block, after the Transparent button, add a Kerning toggle (reuses the transparent-button styling):

```html
      <button
        type="button"
        class="font-pg__transparent"
        :class="{ 'font-pg__transparent--on': state.kerning }"
        title="Font kerning (pair spacing from the font's metrics)"
        @click="setKerning(!state.kerning)"
      >Kerning</button>
```

**Step 6: Type-check**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep WidgetFontPlayground || echo "no type errors in WidgetFontPlayground"`
Expected: `no type errors in WidgetFontPlayground` (ignore unrelated pre-existing errors elsewhere).

**Step 7: Commit**

```bash
git add frontend/app/components/vue-canvas/widgets/WidgetFontPlayground.vue
git commit -m "feat: add letter-spacing and kerning controls to Font Playground"
```

---

## Task 4: End-to-end verification (browser)

**Files:** none (verification only).

**Step 1: Restart ComfyUI** so the Python node changes load.

Run (from repo root): `.venv/bin/python main.py --listen 127.0.0.1 --port 8188`
(leave running; this serves `/object_info`, `/upload/image`, and executes the graph.)

**Step 2: Start the frontend dev server** (preview tools).

`cd frontend && npm run dev` — then use the preview workflow (preview_start / preview_snapshot / preview_screenshot) against it.

**Step 3: Verify the Font Playground controls**

- Add a **Font Playground** node, type a word.
- Drag **Spacing** → the live preview tracking widens/tightens and (after the 400ms debounce) the baked image updates.
- Toggle **Kerning** → preview/bake reflects it.

**Step 4: Verify the wiring + restyle**

- Add a **Text Effect** node. Confirm it now shows an **image** input port on the left (IMAGE type colour).
- Drag from the Font Playground's `image` output to the Text Effect `image` input — the edge connects.
- Pick an effect (e.g. Liquid Chrome) in the gallery.
- (Optional, costs ~$0.04, needs Replicate creds) Run the Text Effect node → output should be the *same letterforms* restyled in chrome, not a regenerated word. Check the ComfyUI console for the `[TextEffect/restyle] …` log line.
- Confirm that with **no** image wired, running still does the Ideogram generate path (`[TextEffect] …` log line).

**Step 5: Capture proof** — `preview_screenshot` of the two wired nodes (and the restyled output if a paid run was done).

**Step 6: Commit** (only if any fix-ups were needed in Steps 3–4; otherwise nothing to commit).

---

## Done criteria

- `.venv/bin/python -m pytest tests-unit/comfy_api_test/text_effects_test.py tests-unit/comfy_api_test/text_effect_node_test.py -v` → all pass.
- `py_compile` clean on both Python files.
- Wiring a Font Playground into the Text Effect node restyles the exact letterforms; leaving it unwired keeps the Ideogram generate behavior.
- Font Playground has working Spacing + Kerning controls that affect the baked PNG.
