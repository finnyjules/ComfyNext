# Relight generator — design

**Date:** 2026-06-12
**Status:** Approved, pre-implementation

## Goal

A relighting generator: feed an image, aim the light with an interactive
**gimbal**, dial intensity, optionally pick a lighting **preset** or wire a
**reference image** to match — and get the same subject re-lit. Powered by
`google/nano-banana-2`, in the spirit of the existing **Rotate camera** node
("the widget IS the prompt"): all controls compile into one plain-English
lighting director's note sent to the model.

## Decisions (from brainstorming)

- **Approach:** prompt-encoded relight on `google/nano-banana-2` (chosen over a
  dedicated relighting model like IC-Light). Consistent with every existing
  generator, cheap (~$0.05/run), reuses the camera-gimbal widget and the
  Replicate plumbing almost verbatim, no new modal/Three.js. IC-Light stays a
  documented future fidelity upgrade — **not** launch scope. The lighting state
  is kept as a tidy schema so a "precise" backend could be added later without
  rework.
- **Node style — REGULAR node, not an artifact node.** `RelightNode` is a
  standard API node rendered by the normal `ComfyNode` path (header ▶ run
  control, automatic downstream routing for free). It is **NOT** registered in
  `ARTIFACT_NODE_COMPONENTS` / VueFlow `node-types`. The gimbal rides in as an
  inline `comfynext_widget` (exactly how `camera_gimbal` works on
  `RotateCameraNode`), not as a custom VueFlow component. This mirrors the
  Person Swap decision.
- **Gimbal carries intensity.** "Position the light + set intensity" is one
  control: the gimbal widget outputs `{"azimuth","elevation","intensity"}`, with
  an intensity slider beneath the sphere. (Not a separate node dropdown.)
- **Presets compose with the gimbal**, they don't override it. Picking "Golden
  hour" still respects where you aimed the sun: the gimbal contributes
  *direction + strength*, the preset contributes *color/mood/quality* words, and
  they stack. `Custom` preset = neutral white light, gimbal only.
- **Background handling = a `keep_background` BOOLEAN, default on.**
  - on → keep subject, composition, background and colors; only the lighting
    changes.
  - off → relight the subject and let the new lighting define the environment /
    background.
- **Reference image (optional):** when wired, becomes the second `image_input`
  with a "match the lighting direction, style and color temperature of the
  second image" clause.

## Architecture

### Prompt module — `comfy_extras/_relight_prompts.py` (NEW)

Torch-free, dependency-light (like `comfy_extras/_person_swap_prompts.py`) so it
is unit-testable in CI. Exposes:

- `light_to_phrase(azimuth: float, elevation: float, intensity: float) -> str` —
  e.g. `"a strong key light from the upper front-left"`. Three independent
  sub-mappings, then composed:
  - **azimuth → direction** (mirrors the camera gimbal's `yawPhrase` buckets):
    `front`, `front-left`/`front-right`, `left`/`right` side, `back-left`/
    `back-right`, `directly behind`. 0° = front, signed, wraps at ±180°.
  - **elevation → height:** `from far below`, `from below`, `at eye level`,
    `from above`, `from directly overhead`.
  - **intensity → strength/quality:** `soft, diffused` · `moderate` · `strong,
    defined` · `dramatic, high-contrast` (4 buckets over 0..1).
- `PRESET_PHRASES: dict[str, str]` — canned mood/color/quality per preset:
  `Custom` (→ `""`, neutral white), `Golden hour`, `Studio softbox`,
  `Hard noon`, `Blue hour`, `Rim/backlight`, `Window light`, `Neon night`,
  `Candlelit`, `Overcast soft`.
- `relight_instruction(preset, azimuth, elevation, intensity, keep_background,
  has_reference, instructions="") -> str` — assembles the full director's note:
  base relight instruction + `light_to_phrase(...)` + the preset phrase (if not
  Custom) + the background clause (keep vs. let-light-define) + the reference
  clause (when `has_reference`) + `" Additional direction: {instructions}."`
  when the stripped free-text is non-empty. Always ends "Output only the edited
  image."

Keeping the phrase buckets identical to the gimbal widget's caption logic is the
contract: **what the caption shows is what the model is told.**

### Node — `comfy_extras/nodes_relight.py` (NEW)

A single `RelightNode` (`IO`-schema, async `execute`), schema mirroring how
`RotateCameraNode` (in `comfy_api_nodes/nodes_replicate.py`) and `PersonSwapNode`
declare themselves (category `api node/image/Replicate`, output node +
`save_live_preview`, lazy `comfy_api_nodes.nodes_replicate` import inside
`execute`).

- **node_id** `RelightNode`, **display_name** "Relight".
- **Inputs:**
  - `image` (IMAGE, required) — the subject/scene to relight.
  - `preset` (Combo, default `Custom`) — the preset list above.
  - `light` (String, JSON, default `{"azimuth":-30,"elevation":20,
    "intensity":0.6}`, `extra_dict={"comfynext_widget": "light_gimbal"}`) —
    driven by the gimbal widget.
  - `keep_background` (Boolean, default `True`, optional).
  - `reference` (IMAGE, optional) — lighting to match.
  - `instructions` (String, multiline, default "", optional) — free-text refine.
  - `seed` (Int, default 0, `control_after_generate=True`) — same as Rotate
    camera.
- **Output:** `image` (IMAGE).
- **execute(image, preset, light, keep_background=True, reference=None,
  instructions="", seed=0):**
  - Parse `light` JSON defensively (try/except → `{}`; coerce azimuth/elevation/
    intensity to float with sane defaults), as `RotateCameraNode` parses
    `camera`.
  - Guard: if `image is None` → pass through / tiny blank, no paid call (mirrors
    Person Swap's guard).
  - Build `prompt = relight_instruction(preset, azimuth, elevation, intensity,
    bool(keep_background), reference is not None, instructions)`.
  - `image_input = [image_data_url]`, plus `reference_data_url` appended when
    `reference is not None`.
  - Call via shared helpers (`_image_tensor_to_data_url`,
    `_run_prediction("google/nano-banana-2", input_dict)`, `_first_output_url`,
    `download_url_to_image_tensor(..., cls=cls)`); `input_dict` shape
    `{prompt, image_input, resolution: "1K", output_format: "png"}`.
  - Return `IO.NodeOutput(result, ui=save_live_preview(result, uid))`.
- Extension class + `comfy_entrypoint()` like `nodes_person_swap.py`.

### Light gimbal widget — `frontend/app/components/vue-canvas/widgets/WidgetLightGimbal.vue` (NEW)

A fork of `WidgetCameraGimbal.vue` (the existing 1,000-line self-contained SVG
pseudo-3D gimbal — no Three.js, inline 3×3 rotation matrices). Changes:

- **Drag a sun/light glyph** around the sphere instead of a camera glyph; the
  dragged point's position maps to **azimuth (horizontal orbit)** and
  **elevation (vertical)**. Reuse the existing orbit-drag + brute-force angle
  solver wholesale.
- **Intensity slider** beneath the sphere (0..1), shown as a brightness/size cue
  on the glyph.
- **Output value:** JSON string `{"azimuth","elevation","intensity"}` (was
  `{"yaw","pitch","roll"}`).
- **Live caption** mirroring `light_to_phrase` ("strong light from the upper
  front-left") so the UI preview equals what's sent.
- Drop the roll ring (light has no roll); keep two rings (azimuth equator +
  elevation) for orientation legibility.

Register in `frontend/app/components/vue-canvas/ComfyNodeWidget.vue` with a
branch `v-else-if="widgetDef.comfynext_widget === 'light_gimbal'"` rendering the
new widget, parallel to the existing `camera_gimbal` branch.

### Registration / discovery (auto, like Person Swap)

- Add `nodes_relight.py` to the `comfy_extras` load list in `nodes.py` (the same
  list `nodes_person_swap.py` was added to), so it loads into `object_info`.
- `frontend/app/components/vue-canvas/GeneratorsPanel.vue` →
  `USE_CASE_BY_NODE`: `RelightNode: { useCase: 'Relight a photo', model:
  'Nano Banana 2' }`.
- `frontend/app/data/generator-icons.ts` → `GENERATOR_NODE_ICONS`:
  `RelightNode: Lightbulb` (or `SunMedium`); `NODE_MODEL_BRAND`:
  `RelightNode: 'Gemini'`.
- `frontend/app/data/toolbox-items.ts` → Image → AI section entry
  (`{ nodeType: 'RelightNode', label: 'Relight', description: '...~$0.05 per
  run.', icon: Lightbulb }`).

No `VueNodeCanvas.vue` / artifact-renderer changes: result routing and the
header run button come from the standard node path.

## Testing

- **Unit (TDD), Python:** `tests-unit/comfy_extras_test/relight_prompts_test.py`
  — `light_to_phrase` direction buckets across azimuth (front / front-left /
  left / back-right / behind), elevation buckets, intensity buckets;
  `relight_instruction` includes the preset phrase only when not `Custom`, emits
  the correct keep-background clause for each toggle state, includes the
  reference clause only when `has_reference=True`, appends "Additional
  direction: …" only when instructions are non-blank. Torch-free.
- **Import smoke:** `python -c "import comfy_extras.nodes_relight"` +
  `define_schema().node_id == "RelightNode"`.
- **Frontend:** the gimbal caption equals `light_to_phrase` for the same
  azimuth/elevation/intensity (parity check; the bucket boundaries are the
  contract). Light a Vitest unit on the caption mapping if a clean seam exists,
  matching the existing `frontend/tests/unit/*.unit.spec.ts` pattern.
- **In-browser (needs user):** restart ComfyUI (new Python node), hard-reload,
  add Relight from the toolbox, wire an image, drag the gimbal + intensity, run
  (~$0.05) — confirm light direction tracks the gimbal, intensity reads through,
  presets compose with direction, `keep_background` on preserves the scene / off
  re-environments it, and a wired reference matches its lighting.

## Risks

- nano-banana *interprets* direction from text, so relighting is directionally
  faithful, not physically exact; very steep/precise angles are approximate.
  Documented v1 property; IC-Light is the fidelity upgrade path.
- Preset + gimbal + reference can over-specify and conflict (e.g. "Golden hour"
  preset + a cool reference). Prompt ordering puts the reference last as the
  strongest signal; documented, tune in QA.
- `keep_background=on` may still drift background lighting slightly; the clause
  emphasizes "only the lighting changes" to minimize it.

## Out of scope (v1)

- IC-Light / baked light-condition-map backend (future fidelity upgrade).
- Multiple/colored light sources (single key light in v1).
- Relighting video / batches.
