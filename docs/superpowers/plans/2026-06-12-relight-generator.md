# Relight Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a **Relight** generator node — feed an image, aim the light with an interactive gimbal, set intensity, optionally pick a preset or wire a reference image, and get the same subject re-lit by `google/nano-banana-2`.

**Architecture:** A standard API node (rendered by the normal `ComfyNode`, **not** an artifact node) whose controls compile into one plain-English "lighting director's note" sent to nano-banana-2 — the same "the widget IS the prompt" pattern as the existing **Rotate camera** node. A pure-Python prompt module (unit-tested) builds the note; a forked SVG gimbal widget (`light_gimbal`) drives the light direction + intensity. Frontend discovery is automatic via the `api node/` category plus three small registry entries.

**Tech Stack:** Python (ComfyUI `comfy_api.latest.IO` nodes, Replicate helpers), Vue 3 + TypeScript (Nuxt frontend), pytest, Vitest.

---

## File Structure

**Create:**
- `comfy_extras/_relight_prompts.py` — torch-free prompt builder (`light_to_phrase`, `PRESET_PHRASES`, `relight_instruction`).
- `comfy_extras/nodes_relight.py` — the `RelightNode` (schema + async `execute` + extension).
- `tests-unit/comfy_extras_test/relight_prompts_test.py` — unit tests for the prompt builder.
- `frontend/app/components/vue-canvas/widgets/WidgetLightGimbal.vue` — forked gimbal (sun glyph + intensity slider; outputs `{azimuth,elevation,intensity}`).

**Modify:**
- `nodes.py` — add `"nodes_relight.py"` to the `comfy_extras` load list (near line 2589).
- `frontend/app/components/vue-canvas/ComfyNodeWidget.vue` — add a `light_gimbal` render branch (near line 442).
- `frontend/app/components/vue-canvas/GeneratorsPanel.vue` — add `RelightNode` to `USE_CASE_BY_NODE` (near line 447).
- `frontend/app/data/generator-icons.ts` — add `RelightNode` to `GENERATOR_NODE_ICONS` + `NODE_MODEL_BRAND`.
- `frontend/app/data/toolbox-items.ts` — add a `RelightNode` item to the image-domain "Create" section (near line 287).

**Why this split:** the prompt text lives apart from the node (torch-free, CI-testable — mirrors `_person_swap_prompts.py`); the widget is self-contained; registration edits are one-liners in existing registries. Same shape as the shipped Person Swap and Rotate camera nodes.

---

## Task 1: Prompt builder module (TDD)

**Files:**
- Create: `comfy_extras/_relight_prompts.py`
- Test: `tests-unit/comfy_extras_test/relight_prompts_test.py`

- [ ] **Step 1: Write the failing test**

Create `tests-unit/comfy_extras_test/relight_prompts_test.py`:

```python
"""Unit tests for relight instruction building (comfy_extras._relight_prompts).

Dependency-light by design: no torch, no comfy_api, no network — so the
gimbal-angle → director's-note translation stays fast and importable in CI
(mirrors comfy_extras/_person_swap_prompts.py).
"""
from comfy_extras import _relight_prompts as rl


def test_direction_buckets():
    assert "from the front" in rl.light_to_phrase(0, 0, 0.6)
    assert "from the front-left" in rl.light_to_phrase(-30, 0, 0.6)
    assert "from the left" in rl.light_to_phrase(-90, 0, 0.6)
    assert "from the back-right" in rl.light_to_phrase(135, 0, 0.6)
    assert "from behind" in rl.light_to_phrase(180, 0, 0.6)


def test_elevation_buckets():
    # near eye level → no height clause
    assert "positioned" not in rl.light_to_phrase(0, 0, 0.6)
    assert "overhead" in rl.light_to_phrase(0, 85, 0.6)
    assert "below" in rl.light_to_phrase(0, -60, 0.6)


def test_intensity_buckets():
    assert "soft" in rl.light_to_phrase(0, 0, 0.1)
    assert "moderate" in rl.light_to_phrase(0, 0, 0.4)
    assert "strong" in rl.light_to_phrase(0, 0, 0.6)
    assert "dramatic" in rl.light_to_phrase(0, 0, 0.9)


def test_preset_phrase_included_only_when_not_custom():
    custom = rl.relight_instruction("Custom", 0, 0, 0.6, True, False, "")
    assert "Lighting style:" not in custom
    golden = rl.relight_instruction("Golden hour", 0, 0, 0.6, True, False, "")
    assert "Lighting style:" in golden
    assert rl.PRESET_PHRASES["Golden hour"] in golden


def test_keep_background_clause_toggles():
    keep = rl.relight_instruction("Custom", 0, 0, 0.6, True, False, "")
    assert "ONLY the lighting" in keep
    change = rl.relight_instruction("Custom", 0, 0, 0.6, False, False, "")
    assert "environment and background" in change


def test_reference_clause_only_when_has_reference():
    assert "lighting reference" not in rl.relight_instruction("Custom", 0, 0, 0.6, True, False, "")
    assert "lighting reference" in rl.relight_instruction("Custom", 0, 0, 0.6, True, True, "")


def test_instructions_appended_only_when_present():
    assert "Additional direction:" not in rl.relight_instruction("Custom", 0, 0, 0.6, True, False, "   ")
    out = rl.relight_instruction("Custom", 0, 0, 0.6, True, False, "warmer please")
    assert "Additional direction: warmer please." in out


def test_always_ends_with_output_clause():
    out = rl.relight_instruction("Golden hour", -30, 20, 0.6, True, True, "x")
    assert out.rstrip().endswith("Output only the edited image.")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/relight_prompts_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_extras._relight_prompts'`.

- [ ] **Step 3: Write the module**

Create `comfy_extras/_relight_prompts.py`:

```python
"""Relight instruction text for the Relight node.

Translates the light gimbal's {azimuth, elevation, intensity} plus the preset,
background toggle and optional reference into one nano-banana-2 director's note.
Kept free of torch / comfy_api / network imports so it is unit-testable in CI
(mirrors comfy_extras/_person_swap_prompts.py). The Vue light_gimbal widget
mirrors light_to_phrase() client-side so the caption equals what's sent.
"""
from __future__ import annotations

# Preset → mood/colour/quality clause. "Custom" = neutral white, gimbal only.
PRESET_PHRASES: dict[str, str] = {
    "Custom": "",
    "Golden hour": "warm golden-hour sunlight, long soft shadows, amber tones",
    "Studio softbox": "clean studio softbox lighting, gentle falloff, neutral white balance",
    "Hard noon": "harsh midday sun, hard-edged shadows, high contrast, cool daylight",
    "Blue hour": "cool blue-hour twilight, soft ambient light, moody desaturated tones",
    "Rim/backlight": "strong rim/backlight separating the subject from the background, glowing edges",
    "Window light": "soft directional window light, natural indoor falloff",
    "Neon night": "colourful neon night lighting, saturated magenta and cyan accents, urban glow",
    "Candlelit": "warm low-key candlelight, flickering amber glow, deep shadows",
    "Overcast soft": "flat overcast daylight, very soft shadows, even cool illumination",
}

PRESETS = list(PRESET_PHRASES.keys())


def _direction_phrase(azimuth_deg: float) -> str:
    """Azimuth in [-180, 180]: 0 = front, +90 = right, ±180 = behind. 45° buckets."""
    a = ((azimuth_deg + 180) % 360) - 180
    aa = abs(a)
    if aa < 22.5:    return "from the front"
    if aa > 157.5:   return "from behind"
    if a > 0:
        if aa < 67.5:    return "from the front-right"
        if aa < 112.5:   return "from the right"
        return "from the back-right"
    else:
        if aa < 67.5:    return "from the front-left"
        if aa < 112.5:   return "from the left"
        return "from the back-left"


def _elevation_phrase(elevation_deg: float) -> str | None:
    """Elevation in [-90, 90]: 0 = eye level (omit), + = above, - = below."""
    e = max(-90.0, min(90.0, elevation_deg))
    if abs(e) < 15:
        return None
    if e > 0:
        if e < 45:   return "above"
        if e < 75:   return "high above"
        return "directly overhead"
    else:
        if e > -45:  return "slightly below"
        return "below"


def _intensity_phrase(intensity: float) -> str:
    """Intensity in [0, 1] → strength/quality word."""
    i = max(0.0, min(1.0, intensity))
    if i < 0.25:  return "soft, diffused"
    if i < 0.5:   return "moderate"
    if i < 0.75:  return "strong, defined"
    return "dramatic, high-contrast"


def light_to_phrase(azimuth: float, elevation: float, intensity: float) -> str:
    """Compose the light description, e.g.
      (0, 0, 0.6)    -> "a strong, defined key light from the front"
      (-30, 60, 0.9) -> "a dramatic, high-contrast key light from the front-left,
                         positioned high above"
    """
    phrase = f"a {_intensity_phrase(intensity)} key light {_direction_phrase(azimuth)}"
    height = _elevation_phrase(elevation)
    if height:
        phrase += f", positioned {height}"
    return phrase


def relight_instruction(
    preset: str,
    azimuth: float,
    elevation: float,
    intensity: float,
    keep_background: bool,
    has_reference: bool,
    instructions: str = "",
) -> str:
    """Build the full nano-banana-2 relight instruction."""
    parts = [f"Relight the image with {light_to_phrase(azimuth, elevation, intensity)}."]

    preset_phrase = PRESET_PHRASES.get(preset, "")
    if preset_phrase:
        parts.append(f"Lighting style: {preset_phrase}.")

    if keep_background:
        parts.append(
            "Keep the subject, composition, pose, background and colours exactly as "
            "they are — change ONLY the lighting and the shadows it casts."
        )
    else:
        parts.append(
            "You may transform the surrounding environment and background to suit the "
            "new lighting; keep the subject's identity and pose."
        )

    if has_reference:
        parts.append(
            "A second image is provided as a lighting reference — match its lighting "
            "direction, quality and colour temperature."
        )

    extra = (instructions or "").strip()
    if extra:
        parts.append(f"Additional direction: {extra}.")

    parts.append("Output only the edited image.")
    return " ".join(parts)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `.venv/bin/python -m pytest tests-unit/comfy_extras_test/relight_prompts_test.py -v`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add comfy_extras/_relight_prompts.py tests-unit/comfy_extras_test/relight_prompts_test.py
git commit -m "feat(relight): prompt builder for the Relight node

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The RelightNode (backend) + registration

**Files:**
- Create: `comfy_extras/nodes_relight.py`
- Modify: `nodes.py:2589`

- [ ] **Step 1: Write the node**

Create `comfy_extras/nodes_relight.py`:

```python
from __future__ import annotations

"""Relight node — re-light an image via nano-banana-2.

Standard API node (no custom Vue renderer). One wired IMAGE input plus a light
gimbal widget ({azimuth, elevation, intensity}), a preset combo, a keep_background
toggle, an optional reference IMAGE whose lighting to match, and free-text refine.
All controls compile into one director's-note prompt — the widget IS the prompt,
the same pattern as the Rotate camera node. When the image is missing it passes a
tiny blank through (no API call).
"""

import json

import torch
from typing_extensions import override

from comfy_api.latest import ComfyExtension, IO
from comfy_extras._live_preview import save_live_preview
from comfy_extras._relight_prompts import PRESETS, relight_instruction


class RelightNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="RelightNode",
            display_name="Relight",
            description=(
                "Re-light an image via Nano Banana 2. Aim the light with the gimbal, "
                "set its intensity, optionally pick a preset look or wire a reference "
                "photo to match its lighting. The widget IS the prompt — no typing "
                "needed. ~$0.05 per render."
            ),
            category="api node/image/Replicate",
            inputs=[
                IO.Image.Input("image", tooltip="The image to relight."),
                IO.Combo.Input("preset", options=PRESETS, default="Custom",
                               tooltip="A starting lighting look. 'Custom' uses only the gimbal (neutral white light)."),
                # JSON string {"azimuth":N,"elevation":N,"intensity":0..1} driven by
                # the light_gimbal widget. Required so ComfyUI auto-instantiates it.
                IO.String.Input(
                    "light",
                    default='{"azimuth":-30,"elevation":20,"intensity":0.6}',
                    multiline=False,
                    extra_dict={"sailor_widget": "light_gimbal"},
                    tooltip="Light direction + intensity. Edited via the gimbal widget.",
                ),
                IO.Boolean.Input("keep_background", default=True, optional=True,
                                 tooltip="On: keep the scene, change only the lighting. Off: let the new light define a new environment."),
                IO.Image.Input("reference", optional=True,
                               tooltip="Optional: a photo whose lighting direction, quality and colour temperature to match."),
                IO.String.Input("instructions", multiline=True, default="", optional=True,
                                tooltip="Optional extra direction to refine the relight."),
                IO.Int.Input("seed", default=0, min=0, max=0xFFFFFFFF,
                             control_after_generate=True, tooltip="0 = random."),
            ],
            outputs=[IO.Image.Output(display_name="image")],
            hidden=[IO.Hidden.unique_id],
            is_output_node=True,
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.05,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, image=None, preset="Custom", light="{}", keep_background=True,
                      reference=None, instructions="", seed=0) -> IO.NodeOutput:
        uid = str(cls.hidden.unique_id)

        # Nothing to relight → tiny blank passthrough. No API call.
        if image is None:
            blank = torch.zeros(1, 16, 16, 3)
            return IO.NodeOutput(blank, ui=save_live_preview(blank, uid))

        # Parse the gimbal JSON tolerantly (older workflow / manual edit → defaults).
        try:
            cfg = json.loads(light or "{}")
            if not isinstance(cfg, dict):
                cfg = {}
        except json.JSONDecodeError:
            cfg = {}
        azimuth   = float(cfg.get("azimuth", 0) or 0)
        elevation = float(cfg.get("elevation", 0) or 0)
        intensity = float(cfg.get("intensity", 0.6) or 0.6)

        # Lazy import: avoids comfy_extras/comfy_api_nodes load-order coupling.
        from comfy_api_nodes.nodes_replicate import (
            _run_prediction, _image_tensor_to_data_url,
            _first_output_url, download_url_to_image_tensor,
        )

        image_input = [_image_tensor_to_data_url(image)]
        if reference is not None:
            image_input.append(_image_tensor_to_data_url(reference))

        prompt = relight_instruction(
            preset, azimuth, elevation, intensity,
            bool(keep_background), reference is not None, instructions,
        )
        print(
            f"[Relight] az={azimuth:.1f} el={elevation:.1f} int={intensity:.2f} "
            f"preset={preset!r} keep_bg={bool(keep_background)} ref={reference is not None}",
            flush=True,
        )
        input_dict = {
            "prompt": prompt,
            "image_input": image_input,
            "resolution": "1K",
            "output_format": "png",
        }
        pred = await _run_prediction("google/nano-banana-2", input_dict)
        result = await download_url_to_image_tensor(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(result, ui=save_live_preview(result, uid))


class RelightExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[IO.ComfyNode]]:
        return [RelightNode]


async def comfy_entrypoint() -> RelightExtension:
    return RelightExtension()
```

- [ ] **Step 2: Register the node in the load list**

In `nodes.py`, find line 2589 (`"nodes_person_swap.py",`) and add `nodes_relight.py` right after it:

```python
        "nodes_pose_mannequin.py",
        "nodes_person_swap.py",
        "nodes_relight.py",
```

- [ ] **Step 3: Import smoke test**

Run:
```bash
.venv/bin/python -c "import comfy_extras.nodes_relight as m; print(m.RelightNode.define_schema().node_id)"
```
Expected: prints `RelightNode` with no import error.

- [ ] **Step 4: Commit**

```bash
git add comfy_extras/nodes_relight.py nodes.py
git commit -m "feat(relight): RelightNode (nano-banana-2) + register in load list

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Light gimbal widget (frontend)

The light gimbal is a fork of `WidgetCameraGimbal.vue`. **Keep all the proven 3D math untouched** — internally the component still tracks `yaw`/`pitch` (now meaning azimuth/elevation); we only remap names at the parse/serialize boundary, add an intensity slider, drop the roll ring, swap the caption text, and restyle the glyph. Roll is forced to 0 (light has no roll).

**Files:**
- Create: `frontend/app/components/vue-canvas/widgets/WidgetLightGimbal.vue`
- Modify: `frontend/app/components/vue-canvas/ComfyNodeWidget.vue:442`

- [ ] **Step 1: Copy the camera gimbal as the starting point**

Run:
```bash
cp frontend/app/components/vue-canvas/widgets/WidgetCameraGimbal.vue \
   frontend/app/components/vue-canvas/widgets/WidgetLightGimbal.vue
```

- [ ] **Step 2: Add an intensity ref + remap parse**

In `WidgetLightGimbal.vue`, replace the `parseValue` function and the `angles` ref setup (around lines 54–66) so the JSON keys are `azimuth`/`elevation`/`intensity` while the internal state stays `yaw`/`pitch`/`roll`:

```typescript
function parseValue(s: string): { yaw: number; pitch: number; roll: number } {
  try {
    const o = JSON.parse(s || '{}')
    return {
      yaw:   Number.isFinite(+o.azimuth)   ? +o.azimuth   : 0,   // azimuth → internal yaw
      pitch: Number.isFinite(+o.elevation) ? +o.elevation : 0,   // elevation → internal pitch
      roll:  0,                                                  // light has no roll
    }
  } catch { return { yaw: 0, pitch: 0, roll: 0 } }
}
function parseIntensity(s: string): number {
  try {
    const o = JSON.parse(s || '{}')
    return Number.isFinite(+o.intensity) ? Math.max(0, Math.min(1, +o.intensity)) : 0.6
  } catch { return 0.6 }
}

const angles = ref(parseValue(props.modelValue))
const intensity = ref(parseIntensity(props.modelValue))
watch(() => props.modelValue, v => { angles.value = parseValue(v); intensity.value = parseIntensity(v) })
```

- [ ] **Step 3: Remap the serializer (`commit`)**

Replace the `commit()` function (around lines 73–81) to emit the light schema:

```typescript
function commit() {
  const out = {
    azimuth:   +normalize(angles.value.yaw).toFixed(2),
    elevation: +Math.max(-90, Math.min(90, angles.value.pitch)).toFixed(2),
    intensity: +intensity.value.toFixed(2),
  }
  emit('update:modelValue', JSON.stringify(out))
}
```

- [ ] **Step 4: Swap the caption to a light phrase (mirror Python `light_to_phrase`)**

Replace the three phrase helpers (`yawPhrase`/`pitchPhrase`/`rollPhrase`, around lines 563–594) and the caption composer (around lines 604–606) with:

```typescript
function directionPhrase(azDeg: number): string {
  const a = ((azDeg + 180) % 360 + 360) % 360 - 180
  const aa = Math.abs(a)
  if (aa < 22.5)  return 'from the front'
  if (aa > 157.5) return 'from behind'
  if (a > 0) {
    if (aa < 67.5)  return 'from the front-right'
    if (aa < 112.5) return 'from the right'
    return 'from the back-right'
  } else {
    if (aa < 67.5)  return 'from the front-left'
    if (aa < 112.5) return 'from the left'
    return 'from the back-left'
  }
}
function elevationPhrase(elDeg: number): string | null {
  const e = Math.max(-90, Math.min(90, elDeg))
  if (Math.abs(e) < 15) return null
  if (e > 0) return e < 45 ? 'above' : e < 75 ? 'high above' : 'directly overhead'
  return e > -45 ? 'slightly below' : 'below'
}
function intensityPhrase(i: number): string {
  const v = Math.max(0, Math.min(1, i))
  if (v < 0.25) return 'soft, diffused'
  if (v < 0.5)  return 'moderate'
  if (v < 0.75) return 'strong, defined'
  return 'dramatic, high-contrast'
}
```

Then update the `caption` computed (around line 604) to:

```typescript
const caption = computed(() => {
  let s = `a ${intensityPhrase(intensity.value)} key light ${directionPhrase(angles.value.yaw)}`
  const h = elevationPhrase(angles.value.pitch)
  if (h) s += `, positioned ${h}`
  return s
})
```

If the original used a differently named computed (e.g. `phrase`/`captionText`), keep that name and only change the body — grep for the text "viewed from" to find the exact identifier and template binding, and replace the "viewed from …" rendering with `caption`.

- [ ] **Step 5: Add the intensity slider to the template**

Below the gimbal SVG and above (or below) the caption line in the `<template>`, add:

```html
<div class="lg-intensity">
  <span class="lg-intensity__label">Intensity</span>
  <input
    type="range" min="0" max="1" step="0.01"
    :value="intensity"
    @input="intensity = +($event.target as HTMLInputElement).value; commit()"
  />
</div>
```

Add minimal styling in `<style scoped>` (match the widget's existing neutral look — white-opacity, no purple):

```css
.lg-intensity { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.lg-intensity__label { font-size: 11px; opacity: 0.7; }
.lg-intensity input { flex: 1; accent-color: rgba(255,255,255,0.8); }
```

- [ ] **Step 6: Drop the roll ring + restyle the glyph (visual cleanup)**

- Remove the roll ring and roll handle from the `<template>`: grep the file for `roll` and remove the blue roll-ring `<path>`/`<circle>` SVG elements and the roll handle pointer-handler wiring (the `'z'` axis case). Leave the yaw (azimuth) equator and pitch (elevation) ring.
- Restyle the amber camera indicator as a light source: change its glyph to a small sun/dot (e.g. a filled circle with short rays, or swap the camera path for a simple ☀-style mark) and update any `aria-label`/title from "camera" to "light". Functionally it already marks the yaw/pitch point, which now reads as the light's direction — no behaviour change needed.

- [ ] **Step 7: Update the header comment + props doc**

Replace the top doc comment block to describe the light gimbal (azimuth/elevation/intensity, JSON `{"azimuth":N,"elevation":N,"intensity":N}`, mirrors Python `light_to_phrase`). Update the `modelValue` prop comment to `// JSON: {"azimuth":N,"elevation":N,"intensity":N}`.

- [ ] **Step 8: Register the widget render branch**

In `frontend/app/components/vue-canvas/ComfyNodeWidget.vue`, after the `camera_gimbal` branch (lines 442–449) add:

```html
    <template v-else-if="widgetDef.sailor_widget === 'light_gimbal'">
      <VueCanvasWidgetsWidgetLightGimbal
        :model-value="modelValue"
        :node-id="nodeId"
        :label="formatLabel(widgetDef.name)"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
```

(The `VueCanvasWidgetsWidgetLightGimbal` auto-import name follows Nuxt's path-based convention, exactly like `VueCanvasWidgetsWidgetCameraGimbal`.)

- [ ] **Step 9: Type-check the frontend**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "WidgetLightGimbal\|ComfyNodeWidget" || echo "no new type errors in touched files"`
Expected: `no new type errors in touched files` (the project may have pre-existing errors elsewhere; only the two touched files must be clean).

- [ ] **Step 10: Commit**

```bash
git add frontend/app/components/vue-canvas/widgets/WidgetLightGimbal.vue \
        frontend/app/components/vue-canvas/ComfyNodeWidget.vue
git commit -m "feat(relight): light gimbal widget (sun + intensity) forked from camera gimbal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Frontend discovery wiring

**Files:**
- Modify: `frontend/app/components/vue-canvas/GeneratorsPanel.vue:447`
- Modify: `frontend/app/data/generator-icons.ts`
- Modify: `frontend/app/data/toolbox-items.ts:287`

- [ ] **Step 1: Generators panel use-case label**

In `GeneratorsPanel.vue`, in the `USE_CASE_BY_NODE` map (after the `PersonSwap` line ~447) add:

```typescript
  RelightNode:             { useCase: 'Relight a photo',          model: 'Nano Banana 2' },
```

- [ ] **Step 2: Generator icon + brand**

In `frontend/app/data/generator-icons.ts`:

Add `Lightbulb` to the lucide import block (lines 14–42):

```typescript
  PersonStanding,
  Lightbulb,
} from 'lucide-vue-next'
```

In `GENERATOR_NODE_ICONS` (after the `PoseMannequin` line ~53):

```typescript
  RelightNode:          Lightbulb,
```

In `NODE_MODEL_BRAND`, under the `Image · manipulation` group:

```typescript
  RelightNode:          'Gemini',              // Nano Banana 2
```

- [ ] **Step 3: Toolbox entry**

In `frontend/app/data/toolbox-items.ts`, in the image-domain `Create` section (the one containing `RotateCameraNode`, ~line 287), add a sibling item. Verify `Lightbulb` is already imported at the top of this file (it is used by `AdjustGlow`); if not, add it to the import block.

```typescript
  {
    title: 'Create',
    items: [
      { nodeType: 'RotateCameraNode', label: 'Rotate Camera',   description: 'Re-render an image from a new viewpoint with a 3-axis camera gimbal. Powered by Qwen-Image-Edit. Cloud, ~$0.04.', icon: Camera },
      { nodeType: 'RelightNode', label: 'Relight', description: 'Re-light an image — aim the light with a gimbal, set intensity, pick a preset or match a reference photo. Powered by Nano Banana 2. Cloud, ~$0.05.', icon: Lightbulb },
    ],
  },
```

- [ ] **Step 4: Type-check the touched data files**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "generator-icons\|toolbox-items\|GeneratorsPanel" || echo "no new type errors in touched files"`
Expected: `no new type errors in touched files`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/GeneratorsPanel.vue \
        frontend/app/data/generator-icons.ts \
        frontend/app/data/toolbox-items.ts
git commit -m "feat(relight): list Relight in generators panel, icons and toolbox

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Manual in-browser verification (needs user)

The gimbal is visual and the model call is paid, so this task is a guided manual check rather than an automated test.

- [ ] **Step 1: Restart ComfyUI** (new Python node — not hot-reloaded). Per the project's dev-environment note, **kill** the existing ComfyUI process and relaunch:
  `.venv/bin/python main.py --listen 127.0.0.1 --port 8188`

- [ ] **Step 2: Run the frontend** (`cd frontend && npm run dev`) and hard-reload the canvas.

- [ ] **Step 3:** Open the toolbox → image → **Create** → add **Relight** (and confirm it also appears in the Generators panel as "Relight a photo · Nano Banana 2"). Confirm the node renders as a **regular node** (standard chrome + header ▶), not an artifact card.

- [ ] **Step 4:** Confirm the **light gimbal** renders inside the node body with two rings (no roll ring), a draggable light glyph, an **Intensity** slider, and a live caption that updates as you drag (e.g. "a strong, defined key light from the front-left, positioned above").

- [ ] **Step 5:** Wire an image, aim the light up-left, raise intensity, run once (~$0.05). Confirm the relit result's key light direction tracks the gimbal and intensity reads through.

- [ ] **Step 6:** Pick the **Golden hour** preset and re-run — confirm the warm look applies *and* still respects the gimbal direction. Toggle **keep_background** off and confirm the environment is allowed to change. Wire a **reference** image with distinctive lighting and confirm the result matches its direction/temperature.

- [ ] **Step 7:** Reload the page and confirm the gimbal/intensity/preset values persisted (serialized into the node's widget values).

---

## Self-Review

- **Spec coverage:** prompt-encoded relight on nano-banana-2 (Tasks 1–2) ✓; regular node, not artifact (Task 2 + Task 5 step 3) ✓; gimbal carries intensity (Task 3) ✓; presets compose with gimbal (Task 1 `relight_instruction` + Task 5 step 6) ✓; `keep_background` toggle (Tasks 1–2) ✓; optional reference image (Tasks 1–2) ✓; light gimbal as a forked widget with sun glyph + intensity, roll ring dropped (Task 3) ✓; all four registration points — load list, ComfyNodeWidget branch, GeneratorsPanel, icons, toolbox (Tasks 2–4) ✓; Python unit tests + caption/Python parity (Task 1 + Task 3 step 4) ✓; in-browser verification (Task 5) ✓.
- **Placeholder scan:** no TBD/TODO; every code step shows full code. The widget fork (Task 3) cannot reproduce all 1000 lines, so it gives exact replacement blocks for every region that changes (parse, commit, caption, intensity, glyph/roll) anchored to line numbers and grep terms — the unchanged 3D math is reused verbatim by design.
- **Type/name consistency:** JSON schema `{azimuth, elevation, intensity}` is identical across the Python node parser (Task 2), the widget serializer (Task 3 step 3), the default string in the schema (Task 2), and the prompt builder signature `relight_instruction(preset, azimuth, elevation, intensity, keep_background, has_reference, instructions)` (Task 1) called with matching positional args in the node (Task 2). Node id `RelightNode` is consistent across schema, registries, icons, toolbox and tests. Widget key `light_gimbal` matches between the node's `extra_dict` (Task 2) and the render branch (Task 3 step 8).
