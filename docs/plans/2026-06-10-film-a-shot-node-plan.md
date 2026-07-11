# Film a Shot Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Film a shot" video node — 28 cinematic framing presets compiled into model-dialect prompts, dispatched through the existing video-model registry.

**Architecture:** New pure-Python catalog+compiler module (`shot_presets.py`, mirroring `text_effects.py`) consumed by a new `FilmShotNode` that reuses `GenerateVideoNode`'s dispatch path verbatim. Frontend mirrors the text-effect gallery pattern: TS catalog → gallery modal → picker widget kind → canvas modal mount.

**Tech Stack:** Python (ComfyUI `IO.ComfyNode`, Replicate dispatch), pytest (`tests-unit/`), Vue 3 / Nuxt 4 (frontend), vitest (`frontend/tests/unit/`).

**Spec:** `docs/plans/2026-06-10-film-a-shot-node-design.md`

**Conventions used throughout:**
- Run pytest from repo root: `.venv/bin/python -m pytest tests-unit/comfy_api_test/shot_presets_test.py -v`
- Run vitest from `frontend/`: `npx vitest run tests/unit/shot-presets.unit.spec.ts`
- Backend changes require a ComfyUI restart to show up in `/object_info` (kill the process; the dev supervisor restarts it).
- Commit after every task. End commit messages with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `shot_presets.py` — catalog + integrity tests

**Files:**
- Create: `comfy_api_nodes/shot_presets.py`
- Test: `tests-unit/comfy_api_test/shot_presets_test.py`

- [ ] **Step 1: Write the failing integrity tests**

Create `tests-unit/comfy_api_test/shot_presets_test.py`:

```python
from comfy_api_nodes.shot_presets import (
    AUTO,
    DEFAULT_PRESET_ID,
    PRESETS,
    PRESETS_BY_ID,
    SIZE_OPTIONS,
    ANGLE_OPTIONS,
    MOVEMENT_OPTIONS,
    LENS_OPTIONS,
    COMPOSITION_OPTIONS,
)

VALID_CATEGORIES = {"movement", "angle", "lens", "composition"}


def test_roster_has_28_unique_ids():
    ids = [p.id for p in PRESETS]
    assert len(ids) == 28
    assert len(set(ids)) == 28


def test_every_dimension_nonempty():
    for p in PRESETS:
        for field in ("label", "size", "angle", "movement", "lens", "composition", "note"):
            assert str(getattr(p, field)).strip(), f"{p.id}.{field} is empty"


def test_categories_valid():
    bad = [(p.id, p.category) for p in PRESETS if p.category not in VALID_CATEGORIES]
    assert bad == []


def test_default_preset_exists():
    assert DEFAULT_PRESET_ID == "push-in"
    assert DEFAULT_PRESET_ID in PRESETS_BY_ID


def test_override_option_lists_start_with_auto():
    for opts in (SIZE_OPTIONS, ANGLE_OPTIONS, MOVEMENT_OPTIONS, LENS_OPTIONS, COMPOSITION_OPTIONS):
        assert opts[0] == AUTO
        assert len(opts) > 3
        assert len(set(opts)) == len(opts)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/shot_presets_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'comfy_api_nodes.shot_presets'`

- [ ] **Step 3: Create the catalog module**

Create `comfy_api_nodes/shot_presets.py`:

```python
"""Cinematic shot-preset catalog + prompt compiler for FilmShotNode.

Mirrors frontend/app/data/shot-presets.ts (gallery tiles). Keep `id` identical
to the TS catalog — it's the dispatch key the gallery writes into the node's
`preset` widget.

Each preset is a complete framing recipe across five dimensions (size, angle,
movement, lens, composition) plus a mood note. `build_shot_phrase` compiles a
recipe into prompt language; the dialect arg picks per-model phrasing
(standard prose / Veo lens-forward / Hailuo bracket commands).

Design doc: docs/plans/2026-06-10-film-a-shot-node-design.md
"""
from __future__ import annotations

from dataclasses import dataclass, replace


# Sentinel for the ADVANCED override combos: keep the preset's own value.
AUTO = "auto (preset)"

DEFAULT_PRESET_ID = "push-in"


@dataclass(frozen=True)
class ShotPreset:
    id: str
    label: str
    category: str      # movement | angle | lens | composition
    size: str          # "medium close-up"
    angle: str         # composes as f"from {angle}" — write accordingly
    movement: str      # full clause: "the camera slowly dollies in"
    lens: str          # "50mm lens with shallow depth of field"
    composition: str   # "subject centered in frame"
    note: str          # mood line: "builds quiet tension"


PRESETS: list[ShotPreset] = [
    # ----- Movement-led ------------------------------------------------------
    ShotPreset("push-in", "Slow push-in", "movement",
        "medium close-up", "eye level",
        "the camera slowly dollies in toward the subject",
        "50mm lens with shallow depth of field",
        "subject centered in frame", "builds quiet tension"),
    ShotPreset("pull-back", "Pull-back reveal", "movement",
        "close-up widening to a wide shot", "eye level",
        "the camera steadily dollies out, revealing the surroundings",
        "35mm lens with deepening focus",
        "subject anchored in place as the world grows around them",
        "the context lands at the end"),
    ShotPreset("crane-reveal", "Crane reveal", "movement",
        "wide shot", "a low position rising high",
        "the camera cranes up smoothly",
        "24mm lens with deep focus",
        "landscape framing with a strong horizon", "establishing grandeur"),
    ShotPreset("orbit", "Hero orbit", "movement",
        "medium shot", "eye level",
        "the camera arcs in a slow 180-degree orbit around the subject",
        "35mm lens with shallow depth of field",
        "subject locked at frame center", "the hero moment"),
    ShotPreset("tracking", "Lateral tracking", "movement",
        "medium shot in profile", "eye level",
        "the camera tracks laterally alongside the moving subject, matched to their pace",
        "40mm lens with deep focus",
        "leading room ahead of the subject", "walk-and-talk energy"),
    ShotPreset("handheld", "Handheld urgency", "movement",
        "medium close-up", "eye level",
        "shaky handheld camera following the subject",
        "28mm lens",
        "loose, imperfect framing", "documentary urgency"),
    ShotPreset("dolly-zoom", "Dolly zoom (Vertigo)", "movement",
        "medium close-up", "eye level",
        "the camera dollies in while the lens zooms out",
        "50mm lens, the background perspective visibly warping",
        "subject locked dead center", "reality bends around them"),
    ShotPreset("tilt-reveal", "Tilt-up reveal", "movement",
        "full shot revealed from the feet upward", "a low angle",
        "the camera tilts up slowly from the ground to the face",
        "35mm lens",
        "vertical reveal framing", "sizing them up"),
    ShotPreset("whip-pan", "Whip pan", "movement",
        "medium shot", "eye level",
        "the camera whips violently sideways in a fast pan, streaking with motion blur",
        "35mm lens",
        "framing snaps from one point to the next", "an energy spike"),
    ShotPreset("crash-zoom", "Crash zoom", "movement",
        "wide shot punching in to a close-up", "eye level",
        "an abrupt crash zoom punches toward the subject",
        "zoom lens",
        "subject suddenly fills the frame", "a grindhouse exclamation mark"),
    ShotPreset("snorricam", "Snorricam", "movement",
        "close-up, body-rigged", "facing the actor",
        "a snorricam locked to the actor's body, the world lurching and swimming behind them",
        "28mm lens",
        "face pinned center while the background reels", "panic and unraveling"),
    ShotPreset("steadicam-oner", "Steadicam oner", "movement",
        "medium shot following the subject", "eye level",
        "a flowing steadicam glide that follows unbroken through doorways and spaces",
        "32mm lens with deep focus",
        "continuously reframing around the moving subject", "the long-take feel"),
    ShotPreset("fpv-dive", "FPV drone dive", "movement",
        "wide shot tightening rapidly", "a plunging aerial angle",
        "an FPV drone dives aggressively and weaves toward the subject",
        "ultra-wide lens",
        "horizon rolling with the dive", "pure adrenaline"),
    ShotPreset("aerial-orbit", "Aerial establish orbit", "movement",
        "extreme wide shot", "a high aerial angle",
        "a drone circles the location in a slow orbit",
        "24mm lens with deep focus",
        "the landscape framed like a map coming alive", "the opening-credits shot"),
    ShotPreset("ground-rush", "Ground-rush tracking", "movement",
        "low medium shot", "inches off the ground",
        "the camera skims fast and low across the surface toward the subject",
        "24mm lens",
        "ground rushing through the lower frame", "road-blur menace"),

    # ----- Angle-led ---------------------------------------------------------
    ShotPreset("god-shot", "Overhead god shot", "angle",
        "wide shot", "directly overhead, bird's-eye",
        "the camera descends slowly straight down",
        "24mm lens with deep focus",
        "geometric framing of the ground below", "fate watching from above"),
    ShotPreset("low-hero", "Low-angle power", "angle",
        "medium shot", "a strong low angle looking up",
        "the camera pushes in slightly",
        "24mm wide-angle lens with mild distortion",
        "the subject towering over the frame", "an imposing entrance"),
    ShotPreset("dutch", "Dutch drift", "angle",
        "medium close-up", "a dutch tilt of about 15 degrees",
        "the camera drifts slowly sideways",
        "40mm lens with shallow depth of field",
        "off-balance rule-of-thirds framing", "something is quietly wrong"),
    ShotPreset("worms-eye", "Worm's-eye sky", "angle",
        "extreme low angle shot", "looking straight up from the ground",
        "the camera holds static, rolling slowly",
        "18mm ultra-wide lens",
        "towers and sky swallowing the frame", "vertigo in reverse"),

    # ----- Lens-led ----------------------------------------------------------
    ShotPreset("anamorphic", "Anamorphic dream", "lens",
        "medium shot", "eye level",
        "the camera drifts slowly",
        "anamorphic lens with horizontal blue flares and oval bokeh",
        "2.39:1 widescreen letterbox framing", "prestige-film sheen"),
    ShotPreset("macro", "Macro detail", "lens",
        "extreme close-up", "eye level",
        "a focus pull racks across the detail",
        "macro lens with razor-thin depth of field",
        "the single detail isolated against soft blur", "the object tells the story"),
    ShotPreset("rack-focus", "Rack focus reveal", "lens",
        "medium close-up across two depth planes", "eye level",
        "the frame holds still while focus pulls from foreground to background",
        "85mm lens with razor-thin depth of field",
        "two subjects stacked in depth", "attention is the edit"),
    ShotPreset("telephoto", "Telephoto compression", "lens",
        "medium close-up from far away", "eye level",
        "the camera holds nearly still with a slight pan",
        "300mm telephoto lens compressing the planes",
        "blurred foreground passers-by stacking the depth", "surveillance distance"),

    # ----- Composition-led ---------------------------------------------------
    ShotPreset("locked-off", "Symmetrical one-point", "composition",
        "wide shot", "eye level",
        "a locked-off static camera, perfectly still",
        "32mm lens with deep focus",
        "dead-center one-point-perspective symmetry", "an unblinking formal stare"),
    ShotPreset("ots", "Over-the-shoulder", "composition",
        "medium close-up", "eye level",
        "the camera holds nearly still with a micro drift",
        "65mm lens with shallow depth of field",
        "framed over a foreground shoulder", "conversation intimacy"),
    ShotPreset("pov", "POV walk", "composition",
        "first-person point of view", "eye level",
        "handheld camera walking forward as the character's own eyes",
        "28mm lens",
        "hands and body edges intruding at the frame borders", "you are there"),
    ShotPreset("voyeur-frame", "Voyeur doorframe", "composition",
        "medium shot", "eye level",
        "a static camera watching through a doorway",
        "50mm lens",
        "framed through a door or window slit, dark edges crowding the subject",
        "being watched"),
    ShotPreset("mirror", "Mirror double", "composition",
        "medium close-up", "eye level",
        "the camera holds still, pushing in slowly",
        "50mm lens",
        "the subject and their mirror reflection sharing the frame",
        "two truths at once"),
]

PRESETS_BY_ID: dict[str, ShotPreset] = {p.id: p for p in PRESETS}
PRESET_IDS: list[str] = [p.id for p in PRESETS]


# ---------- ADVANCED override option lists ----------------------------------
# Each combo's options ARE the substitution phrases — picking one replaces that
# dimension of the active preset verbatim. AUTO keeps the preset's value.

SIZE_OPTIONS = [AUTO, "extreme close-up", "close-up", "medium close-up",
                "medium shot", "full shot", "wide shot", "extreme wide shot"]

ANGLE_OPTIONS = [AUTO, "eye level", "a low angle", "a high angle",
                 "directly overhead, bird's-eye", "a dutch tilt", "ground level"]

MOVEMENT_OPTIONS = [AUTO,
    "a locked-off static camera",
    "the camera slowly dollies in toward the subject",
    "the camera steadily dollies out",
    "the camera pans slowly left to right",
    "the camera tilts up slowly",
    "the camera cranes up smoothly",
    "the camera arcs in a slow orbit around the subject",
    "the camera tracks laterally alongside the subject",
    "shaky handheld camera following the subject",
    "a flowing steadicam glide",
    "an FPV drone dives toward the subject",
    "an abrupt crash zoom punches toward the subject"]

LENS_OPTIONS = [AUTO, "18mm ultra-wide lens", "24mm wide-angle lens", "35mm lens",
                "50mm lens with shallow depth of field",
                "85mm lens with razor-thin depth of field",
                "300mm telephoto lens compressing the planes",
                "anamorphic lens with horizontal flares and oval bokeh",
                "macro lens with razor-thin depth of field"]

COMPOSITION_OPTIONS = [AUTO, "subject centered in frame", "rule-of-thirds framing",
                       "dead-center one-point-perspective symmetry",
                       "framed over a foreground shoulder",
                       "first-person POV framing",
                       "framed through a doorway",
                       "leading room ahead of the subject"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/shot_presets_test.py -v`
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add comfy_api_nodes/shot_presets.py tests-unit/comfy_api_test/shot_presets_test.py
git commit -m "FilmShot: 28-preset cinematic shot catalog (data + integrity tests)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Recipe resolution + dialect compiler

**Files:**
- Modify: `comfy_api_nodes/shot_presets.py` (append)
- Test: `tests-unit/comfy_api_test/shot_presets_test.py` (append)

- [ ] **Step 1: Write the failing compiler tests**

Append to `tests-unit/comfy_api_test/shot_presets_test.py`:

```python
from comfy_api_nodes.shot_presets import (  # noqa: E402
    build_shot_phrase,
    dialect_for_model,
    resolve_recipe,
)


def test_resolve_all_auto_returns_preset_unchanged():
    r = resolve_recipe("push-in", AUTO, AUTO, AUTO, AUTO, AUTO)
    p = PRESETS_BY_ID["push-in"]
    assert (r.size, r.angle, r.movement, r.lens, r.composition) == \
           (p.size, p.angle, p.movement, p.lens, p.composition)


def test_resolve_override_replaces_exactly_one_dimension():
    r = resolve_recipe("push-in", "wide shot", AUTO, AUTO, AUTO, AUTO)
    p = PRESETS_BY_ID["push-in"]
    assert r.size == "wide shot"
    assert (r.angle, r.movement, r.lens, r.composition) == \
           (p.angle, p.movement, p.lens, p.composition)


def test_resolve_unknown_preset_falls_back_to_default():
    r = resolve_recipe("does-not-exist", AUTO, AUTO, AUTO, AUTO, AUTO)
    assert r.id == DEFAULT_PRESET_ID


def test_standard_phrase_contains_recipe_terms():
    phrase = build_shot_phrase(PRESETS_BY_ID["push-in"], "standard")
    assert "medium close-up" in phrase
    assert "dollies in" in phrase
    assert "50mm" in phrase
    assert "quiet tension" in phrase


def test_veo_dialect_leads_with_lens():
    phrase = build_shot_phrase(PRESETS_BY_ID["push-in"], "veo")
    assert phrase.lower().startswith("50mm")


def test_hailuo_dialect_prefixes_bracket_commands():
    phrase = build_shot_phrase(PRESETS_BY_ID["push-in"], "hailuo")
    assert phrase.startswith("[Push in]")


def test_hailuo_dolly_zoom_combines_commands():
    phrase = build_shot_phrase(PRESETS_BY_ID["dolly-zoom"], "hailuo")
    assert phrase.startswith("[Push in, Zoom out]")


def test_hailuo_static_preset_uses_static_shot():
    phrase = build_shot_phrase(PRESETS_BY_ID["locked-off"], "hailuo")
    assert phrase.startswith("[Static shot]")


def test_unknown_dialect_falls_back_to_standard():
    std = build_shot_phrase(PRESETS_BY_ID["push-in"], "standard")
    assert build_shot_phrase(PRESETS_BY_ID["push-in"], "nope") == std


def test_dialect_for_model():
    assert dialect_for_model("veo-3.1") == "veo"
    assert dialect_for_model("veo-3.1-fast") == "veo"
    assert dialect_for_model("hailuo-2.3") == "hailuo"
    assert dialect_for_model("kling-v2.5-turbo-pro") == "standard"
    assert dialect_for_model("unknown-model") == "standard"
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/shot_presets_test.py -v`
Expected: 5 passed (Task 1), the new ones FAIL with `ImportError: cannot import name 'build_shot_phrase'`

- [ ] **Step 3: Append the compiler to `shot_presets.py`**

```python
# ---------- Recipe resolution ------------------------------------------------

def resolve_recipe(preset_id: str, size: str, angle: str, movement: str,
                   lens: str, composition: str) -> ShotPreset:
    """Preset + ADVANCED overrides → final recipe. AUTO keeps the preset value.
    Unknown preset ids fall back to the default (old workflows, manual edits)."""
    base = PRESETS_BY_ID.get(preset_id) or PRESETS_BY_ID[DEFAULT_PRESET_ID]
    overrides = {}
    for field, value in (("size", size), ("angle", angle), ("movement", movement),
                         ("lens", lens), ("composition", composition)):
        if value and value != AUTO:
            overrides[field] = value
    return replace(base, **overrides) if overrides else base


# ---------- Dialect compiler ---------------------------------------------------
# Hailuo (MiniMax) Director-mode bracket commands, matched by keyword against the
# movement clause. Multiple matches combine: "[Push in, Zoom out]".
_HAILUO_COMMANDS: list[tuple[str, str]] = [
    ("dollies in", "Push in"),
    ("pushes in", "Push in"),
    ("punches toward", "Zoom in"),
    ("dollies out", "Pull out"),
    ("zooms out", "Zoom out"),
    ("cranes up", "Pedestal up"),
    ("descends", "Pedestal down"),
    ("tilts up", "Tilt up"),
    ("whips violently sideways", "Pan right"),
    ("orbit", "Tracking shot"),
    ("tracks laterally", "Tracking shot"),
    ("glide", "Tracking shot"),
    ("dives", "Tracking shot"),
    ("skims", "Tracking shot"),
    ("handheld", "Shake"),
    ("lurching", "Shake"),
    ("static", "Static shot"),
    ("holds still", "Static shot"),
    ("holds nearly still", "Static shot"),
]


def _hailuo_brackets(movement: str) -> str:
    m = movement.lower()
    cmds: list[str] = []
    for keyword, cmd in _HAILUO_COMMANDS:
        if keyword in m and cmd not in cmds:
            cmds.append(cmd)
    return f"[{', '.join(cmds)}]" if cmds else ""


def _cap(s: str) -> str:
    return s[0].upper() + s[1:] if s else s


def build_shot_phrase(recipe: ShotPreset, dialect: str = "standard") -> str:
    """Compile a recipe into prompt language. Unknown dialect → standard."""
    if dialect == "veo":
        # Lens-forward phrasing — Google documents Veo parsing shot vocabulary
        # ("18mm low-angle tracking shot"), so lead with the lens + framing.
        return (f"{_cap(recipe.lens)}, {recipe.size} from {recipe.angle}. "
                f"{_cap(recipe.movement)}; {recipe.composition}. "
                f"{_cap(recipe.note)}. Cinematic.")
    if dialect == "hailuo":
        brackets = _hailuo_brackets(recipe.movement)
        std = build_shot_phrase(recipe, "standard")
        return f"{brackets} {std}".strip()
    # standard — director's-note prose (the proven RotateCameraNode approach).
    return (f"Cinematic {recipe.size} from {recipe.angle}. "
            f"{_cap(recipe.movement)}. {_cap(recipe.lens)}; "
            f"{recipe.composition} — {recipe.note}.")


def dialect_for_model(model_id: str) -> str:
    mid = (model_id or "").lower()
    if mid.startswith("veo"):
        return "veo"
    if mid.startswith("hailuo"):
        return "hailuo"
    return "standard"
```

- [ ] **Step 4: Run all tests, verify pass**

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/shot_presets_test.py -v`
Expected: 15 passed

If `test_hailuo_static_preset_uses_static_shot` fails: `locked-off`'s movement is
"a locked-off static camera, perfectly still" — confirm the `("static", "Static shot")`
keyword row is present and that no earlier keyword matches first.

- [ ] **Step 5: Commit**

```bash
git add comfy_api_nodes/shot_presets.py tests-unit/comfy_api_test/shot_presets_test.py
git commit -m "FilmShot: recipe resolution + standard/veo/hailuo dialect compiler

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `FilmShotNode` backend node + registration

**Files:**
- Modify: `comfy_api_nodes/nodes_replicate.py` — add the node class right after `GenerateVideoNode`'s section (search for `class UpscaleImageNode`, insert before that section header), and register it in `ReplicateExtension.get_node_list` (search `GenerateVideoNode,          # Generate a video`).

- [ ] **Step 1: Add the node class**

Insert into `comfy_api_nodes/nodes_replicate.py` (after the GenerateVideoNode section, before the Upscale section header). Note: `_VIDEO_MODELS_BY_ID`, `_VIDEO_GEN_MODEL_IDS`, `_VIDEO_GEN_ASPECT_RATIOS`, `_VIDEO_GEN_DURATION_OPTS`, `_VIDEO_POLL_DEADLINE_SEC`, `_image_tensor_to_data_url`, `_run_prediction`, `_first_output_url`, `download_url_to_video_output` are already imported/defined at module level for GenerateVideoNode — reuse them.

```python
# =============================================================================
# Use case: Film a shot — cinematic framing presets over the video registry
# =============================================================================
#
# 28 named shot presets (slow push-in, dolly zoom, overhead god shot, …), each
# a full recipe across five dimensions: size, angle, movement, lens,
# composition. The recipe compiles into model-appropriate prompt language
# (per-model dialects: Veo gets lens-forward vocabulary, Hailuo gets Director
# bracket commands) and dispatches through the same video-model registry as
# GenerateVideoNode. Design: docs/plans/2026-06-10-film-a-shot-node-design.md

from comfy_api_nodes.shot_presets import (
    AUTO as _SHOT_AUTO,
    ANGLE_OPTIONS as _SHOT_ANGLE_OPTIONS,
    COMPOSITION_OPTIONS as _SHOT_COMPOSITION_OPTIONS,
    DEFAULT_PRESET_ID as _SHOT_DEFAULT_PRESET_ID,
    LENS_OPTIONS as _SHOT_LENS_OPTIONS,
    MOVEMENT_OPTIONS as _SHOT_MOVEMENT_OPTIONS,
    PRESET_IDS as _SHOT_PRESET_IDS,
    SIZE_OPTIONS as _SHOT_SIZE_OPTIONS,
    build_shot_phrase as _build_shot_phrase,
    dialect_for_model as _shot_dialect_for_model,
    resolve_recipe as _resolve_shot_recipe,
)

_FILM_SHOT_DEFAULT_MODEL_ID = "kling-v2.5-turbo-pro"


class FilmShotNode(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="FilmShotNode",
            display_name="Film a shot",
            category="api node/video/Replicate",
            description=(
                "Direct a video like a cinematographer: pick a shot preset "
                "(slow push-in, dolly zoom, overhead god shot, …) and describe "
                "the subject — the node writes the camera language for you. "
                "28 presets across movement, angle, lens and composition; "
                "per-dimension overrides under ADVANCED."
            ),
            inputs=[
                IO.Combo.Input(
                    "preset",
                    options=_SHOT_PRESET_IDS,
                    default=_SHOT_DEFAULT_PRESET_ID,
                    tooltip="Click to choose a shot from the preset gallery.",
                    extra_dict={"sailor_widget": "shot_preset_picker"},
                ),
                IO.String.Input("prompt", multiline=True, default="",
                                tooltip="The subject of the shot — who/what and where. "
                                        "The preset supplies the cinematography."),
                IO.Image.Input("image", optional=True,
                               tooltip="Optional first frame — turns this into "
                                       "image-to-video."),
                IO.Combo.Input(
                    "model",
                    options=_VIDEO_GEN_MODEL_IDS,
                    default=_FILM_SHOT_DEFAULT_MODEL_ID,
                    tooltip="Video model. Kling v2.5 Turbo Pro recommended for "
                            "camera-language adherence.",
                    extra_dict={"sailor_widget": "video_model_picker"},
                ),
                IO.Combo.Input("aspect_ratio", options=_VIDEO_GEN_ASPECT_RATIOS, default="16:9",
                               tooltip="Auto-falls back to the model's nearest supported ratio."),
                IO.Combo.Input("duration", options=_VIDEO_GEN_DURATION_OPTS, default="5",
                               tooltip="Seconds. Remapped to the model's nearest supported value.",
                               control_after_generate=False),
                IO.Int.Input("seed", default=0, min=0, max=0xFFFFFFFF,
                             control_after_generate=True, tooltip="0 = random."),
                IO.String.Input(
                    "model_options",
                    default="{}",
                    multiline=False,
                    extra_dict={"sailor_widget": "internal"},
                    tooltip="JSON bag of per-model advanced settings — edited via the gallery modal.",
                ),
                # ADVANCED per-dimension overrides. Option strings ARE the
                # substitution phrases (see shot_presets.py); AUTO keeps the preset.
                IO.Combo.Input("shot_size", options=_SHOT_SIZE_OPTIONS, default=_SHOT_AUTO,
                               advanced=True, tooltip="Override the preset's shot size."),
                IO.Combo.Input("camera_angle", options=_SHOT_ANGLE_OPTIONS, default=_SHOT_AUTO,
                               advanced=True, tooltip="Override the preset's camera angle."),
                IO.Combo.Input("camera_movement", options=_SHOT_MOVEMENT_OPTIONS, default=_SHOT_AUTO,
                               advanced=True, tooltip="Override the preset's camera movement."),
                IO.Combo.Input("lens_look", options=_SHOT_LENS_OPTIONS, default=_SHOT_AUTO,
                               advanced=True, tooltip="Override the preset's lens & depth of field."),
                IO.Combo.Input("composition", options=_SHOT_COMPOSITION_OPTIONS, default=_SHOT_AUTO,
                               advanced=True, tooltip="Override the preset's composition."),
            ],
            outputs=[IO.Video.Output()],
            price_badge=IO.PriceBadge(expr='{"type":"usd","usd":0.40,"format":{"approximate":true}}'),
        )

    @classmethod
    async def execute(cls, preset, prompt, model, aspect_ratio, duration, seed,
                      model_options="{}", image=None,
                      shot_size=_SHOT_AUTO, camera_angle=_SHOT_AUTO,
                      camera_movement=_SHOT_AUTO, lens_look=_SHOT_AUTO,
                      composition=_SHOT_AUTO):
        spec = _VIDEO_MODELS_BY_ID.get(model)
        if spec is None:
            raise RuntimeError(
                f"Unknown video model id: {model!r}. Known: {list(_VIDEO_MODELS_BY_ID)}"
            )
        if "t2v" not in spec.modes and image is None:
            raise RuntimeError(
                f"Model {spec.label!r} requires an input image (image-to-video only). "
                f"Connect an Image to the optional `image` input."
            )

        recipe = _resolve_shot_recipe(preset, shot_size, camera_angle,
                                      camera_movement, lens_look, composition)
        dialect = _shot_dialect_for_model(model)
        shot_phrase = _build_shot_phrase(recipe, dialect)
        full_prompt = f"{shot_phrase} {(prompt or '').strip()}".strip()

        try:
            advanced = json.loads(model_options or "{}")
            if not isinstance(advanced, dict):
                advanced = {}
        except json.JSONDecodeError:
            advanced = {}

        try:
            dur_int = int(duration)
        except (TypeError, ValueError):
            dur_int = spec.default_duration

        image_data_url = _image_tensor_to_data_url(image) if image is not None else None
        input_dict = spec.build_input(full_prompt, aspect_ratio, dur_int, int(seed or 0),
                                      image_data_url, None, advanced)
        print(
            f"[FilmShot] preset={recipe.id!r} dialect={dialect!r} model={model!r} "
            f"slug={spec.replicate_slug!r} phrase={shot_phrase!r}",
            flush=True,
        )
        pred = await _run_prediction(spec.replicate_slug, input_dict,
                                     poll_deadline_sec=_VIDEO_POLL_DEADLINE_SEC)
        video = await download_url_to_video_output(_first_output_url(pred), cls=cls)
        return IO.NodeOutput(video)
```

- [ ] **Step 2: Register the node**

In `ReplicateExtension.get_node_list` (search `GenerateVideoNode,          # Generate a video`), add directly below that line:

```python
            FilmShotNode,               # Film a shot · cinematic framing presets
```

- [ ] **Step 3: Syntax check + import check**

Run: `.venv/bin/python -c "import ast; ast.parse(open('comfy_api_nodes/nodes_replicate.py').read()); print('syntax OK')"`
Expected: `syntax OK`

Run: `.venv/bin/python -m pytest tests-unit/comfy_api_test/shot_presets_test.py -q`
Expected: 15 passed (catalog untouched; confirms no circular-import damage)

- [ ] **Step 4: Restart ComfyUI and verify the schema**

Kill the ComfyUI process (`pkill -f "main.py --listen 127.0.0.1 --port 8188"`); the dev supervisor restarts it. Wait for boot, then:

Run:
```bash
curl -s http://127.0.0.1:8188/object_info | python3 -c "
import json,sys
oi=json.load(sys.stdin)
n=oi['FilmShotNode']
req=n['input']['required']
print('display:', n['display_name'])
print('presets:', len(req['preset'][0]))
print('seed control_after_generate:', req['seed'][1].get('control_after_generate'))
print('default model:', req['model'][1].get('default'))
print('advanced overrides:', [k for k in req if req[k][1].get('advanced')] if isinstance(req.get('shot_size',[None,{}])[1],dict) else 'check optional group')
"
```
Expected: `display: Film a shot`, `presets: 28`, `seed control_after_generate: True`, `default model: kling-v2.5-turbo-pro`. (If the overrides land in `input.optional` rather than flagged-required, that's fine — note it and continue; the frontend reads both groups.)

- [ ] **Step 5: Commit**

```bash
git add comfy_api_nodes/nodes_replicate.py
git commit -m "FilmShot: backend node — preset combo, ADVANCED overrides, registry dispatch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend TS catalog (`shot-presets.ts`) + data test

**Files:**
- Create: `frontend/app/data/shot-presets.ts`
- Test: `frontend/tests/unit/shot-presets.unit.spec.ts`

- [ ] **Step 1: Write the failing data test**

Create `frontend/tests/unit/shot-presets.unit.spec.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { SHOT_PRESETS, SHOT_PRESETS_BY_ID, SHOT_CATEGORY_LABELS } from '../../app/data/shot-presets'

describe('shot-presets catalog', () => {
  it('has 28 unique ids', () => {
    const ids = SHOT_PRESETS.map(p => p.id)
    expect(ids).toHaveLength(28)
    expect(new Set(ids).size).toBe(28)
  })

  it('every entry is complete', () => {
    for (const p of SHOT_PRESETS) {
      expect(p.label.trim()).toBeTruthy()
      expect(p.recipe.trim()).toBeTruthy()
      expect(p.pitch.trim()).toBeTruthy()
      expect(Object.keys(SHOT_CATEGORY_LABELS)).toContain(p.category)
      expect(SHOT_PRESETS_BY_ID[p.id]).toBe(p)
    }
  })

  it('ids match the backend catalog convention (kebab-case)', () => {
    for (const p of SHOT_PRESETS) expect(p.id).toMatch(/^[a-z0-9-]+$/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run (from `frontend/`): `npx vitest run tests/unit/shot-presets.unit.spec.ts`
Expected: FAIL — cannot resolve `../../app/data/shot-presets`

- [ ] **Step 3: Create the catalog**

Create `frontend/app/data/shot-presets.ts`:

```typescript
/**
 * Shot-preset catalog — drives the "Film a shot" node's gallery. Each preset
 * is a complete cinematography recipe (size · angle · movement · lens ·
 * composition); the backend compiles it into model-dialect prompt language.
 *
 * Mirrors comfy_api_nodes/shot_presets.py — keep `id` identical (dispatch key).
 * Adding a preset: append an entry in BOTH files.
 *
 * `thumb` drives the data-only CSS thumbnail in the gallery card (person
 * silhouette + motion arrow + optional overlay). No image assets.
 */

export type ShotCategory = 'movement' | 'angle' | 'lens' | 'composition'

export const SHOT_CATEGORY_LABELS: Record<ShotCategory, string> = {
  movement: 'Movement',
  angle: 'Angle',
  lens: 'Lens',
  composition: 'Composition',
}

export type ShotArrow =
  | 'in' | 'out' | 'up' | 'upright' | 'down' | 'right'
  | 'orbit' | 'shake' | 'dive' | 'flow' | 'rack' | 'none'

export type ShotOverlay =
  | 'thirds' | 'doorframe' | 'mirror' | 'blur' | 'streak' | 'shoulder' | 'hands' | 'none'

export interface ShotThumb {
  scale?: number    // person scale (1 = medium); 0 hides the person
  top?: number      // person top offset in % (default 22)
  tilt?: number     // frame tilt in degrees
  arrow?: ShotArrow
  overlay?: ShotOverlay
}

export interface ShotPreset {
  id: string
  label: string
  category: ShotCategory
  recipe: string    // one-line recipe summary shown on the card
  pitch: string     // mood line
  thumb: ShotThumb
}

export const SHOT_PRESETS: ShotPreset[] = [
  // ── Movement ──────────────────────────────────────────────────────────────
  { id: 'push-in', label: 'Slow push-in', category: 'movement',
    recipe: 'MCU · eye level · slow dolly in · 50mm shallow · centered',
    pitch: 'Builds quiet tension', thumb: { scale: 1.3, arrow: 'in' } },
  { id: 'pull-back', label: 'Pull-back reveal', category: 'movement',
    recipe: 'CU → wide · dolly out · 35mm deepening · subject anchored',
    pitch: 'The context lands at the end', thumb: { scale: 0.7, arrow: 'out' } },
  { id: 'crane-reveal', label: 'Crane reveal', category: 'movement',
    recipe: 'Wide · rising low → high · crane up · 24mm deep',
    pitch: 'Establishing grandeur', thumb: { scale: 0.55, top: 40, arrow: 'upright' } },
  { id: 'orbit', label: 'Hero orbit', category: 'movement',
    recipe: 'MS · slow 180° arc · 35mm shallow · subject locked center',
    pitch: 'The hero moment', thumb: { scale: 1, arrow: 'orbit' } },
  { id: 'tracking', label: 'Lateral tracking', category: 'movement',
    recipe: 'MS profile · side-track with subject · 40mm deep · leading room',
    pitch: 'Walk-and-talk energy', thumb: { scale: 1, arrow: 'right' } },
  { id: 'handheld', label: 'Handheld urgency', category: 'movement',
    recipe: 'MCU · shaky handheld follow · 28mm · loose framing',
    pitch: 'Documentary adrenaline', thumb: { scale: 1.1, tilt: 1.5, arrow: 'shake' } },
  { id: 'dolly-zoom', label: 'Dolly zoom (Vertigo)', category: 'movement',
    recipe: 'MCU · dolly in + zoom out · warping background · centered',
    pitch: 'Reality bends around them', thumb: { scale: 1.2, arrow: 'in', overlay: 'streak' } },
  { id: 'tilt-reveal', label: 'Tilt-up reveal', category: 'movement',
    recipe: 'Feet → face · low angle · slow tilt up · 35mm',
    pitch: 'Sizing them up', thumb: { scale: 1.2, top: 8, arrow: 'up' } },
  { id: 'whip-pan', label: 'Whip pan', category: 'movement',
    recipe: 'MS · violent fast pan, motion-blur streaks · 35mm',
    pitch: 'An energy spike', thumb: { scale: 1, arrow: 'right', overlay: 'streak' } },
  { id: 'crash-zoom', label: 'Crash zoom', category: 'movement',
    recipe: 'Wide → CU · abrupt punch-in zoom · grindhouse',
    pitch: 'An exclamation mark', thumb: { scale: 1.5, top: 12, arrow: 'in' } },
  { id: 'snorricam', label: 'Snorricam', category: 'movement',
    recipe: 'CU body-rigged · face locked, world lurches · 28mm',
    pitch: 'Panic and unraveling', thumb: { scale: 1.4, top: 14, tilt: -4, arrow: 'shake' } },
  { id: 'steadicam-oner', label: 'Steadicam oner', category: 'movement',
    recipe: 'MS following · unbroken glide through spaces · 32mm deep',
    pitch: 'The long-take feel', thumb: { scale: 1, arrow: 'flow' } },
  { id: 'fpv-dive', label: 'FPV drone dive', category: 'movement',
    recipe: 'Wide → tight · plunging aerial dive + weave · ultra-wide',
    pitch: 'Pure adrenaline', thumb: { scale: 0.6, top: 46, arrow: 'dive' } },
  { id: 'aerial-orbit', label: 'Aerial establish orbit', category: 'movement',
    recipe: 'Extreme wide · high aerial · slow drone circle · 24mm deep',
    pitch: 'The opening-credits shot', thumb: { scale: 0.45, top: 48, arrow: 'orbit' } },
  { id: 'ground-rush', label: 'Ground-rush tracking', category: 'movement',
    recipe: 'Low MS · inches off the floor · fast forward skim · 24mm',
    pitch: 'Road-blur menace', thumb: { scale: 0.85, top: 16, arrow: 'right', overlay: 'streak' } },

  // ── Angle ────────────────────────────────────────────────────────────────
  { id: 'god-shot', label: 'Overhead god shot', category: 'angle',
    recipe: 'Wide · directly overhead · slow descend · geometric floor',
    pitch: 'Fate watching from above', thumb: { scale: 0.55, top: 42, arrow: 'down' } },
  { id: 'low-hero', label: 'Low-angle power', category: 'angle',
    recipe: 'MS · strong low angle · slight push · 24mm distortion',
    pitch: 'An imposing entrance', thumb: { scale: 1.35, top: 6, arrow: 'in' } },
  { id: 'dutch', label: 'Dutch drift', category: 'angle',
    recipe: 'MCU · dutch 15° · slow lateral drift · 40mm shallow',
    pitch: 'Something is quietly wrong', thumb: { scale: 1.1, tilt: -8, arrow: 'right' } },
  { id: 'worms-eye', label: "Worm's-eye sky", category: 'angle',
    recipe: 'Extreme low, looking straight up · 18mm · towers swallow the frame',
    pitch: 'Vertigo in reverse', thumb: { scale: 1.25, top: 2, arrow: 'up' } },

  // ── Lens ─────────────────────────────────────────────────────────────────
  { id: 'anamorphic', label: 'Anamorphic dream', category: 'lens',
    recipe: 'MS · slow drift · anamorphic flares, oval bokeh · letterbox',
    pitch: 'Prestige-film sheen', thumb: { scale: 1, overlay: 'streak', arrow: 'none' } },
  { id: 'macro', label: 'Macro detail', category: 'lens',
    recipe: 'ECU · rack focus pull · macro shallow · isolated detail',
    pitch: 'The object tells the story', thumb: { scale: 0, overlay: 'blur', arrow: 'rack' } },
  { id: 'rack-focus', label: 'Rack focus reveal', category: 'lens',
    recipe: 'Two depth planes · static frame, focus pulls front → back · 85mm',
    pitch: 'Attention is the edit', thumb: { scale: 0.9, overlay: 'blur', arrow: 'rack' } },
  { id: 'telephoto', label: 'Telephoto compression', category: 'lens',
    recipe: 'MCU from afar · 300mm stacked planes · blurred passers-by',
    pitch: 'Surveillance distance', thumb: { scale: 0.95, overlay: 'blur', arrow: 'none' } },

  // ── Composition ──────────────────────────────────────────────────────────
  { id: 'locked-off', label: 'Symmetrical one-point', category: 'composition',
    recipe: 'Wide · locked-off static · 32mm deep · dead-center symmetry',
    pitch: 'An unblinking formal stare', thumb: { scale: 0.9, overlay: 'thirds', arrow: 'none' } },
  { id: 'ots', label: 'Over-the-shoulder', category: 'composition',
    recipe: 'MCU · 65mm shallow · framed over a foreground shoulder',
    pitch: 'Conversation intimacy', thumb: { scale: 1, overlay: 'shoulder', arrow: 'none' } },
  { id: 'pov', label: 'POV walk', category: 'composition',
    recipe: 'First person · handheld forward · 28mm · body edges in frame',
    pitch: 'You are there', thumb: { scale: 0, overlay: 'hands', arrow: 'right' } },
  { id: 'voyeur-frame', label: 'Voyeur doorframe', category: 'composition',
    recipe: 'MS · static through doorway slit · 50mm · dark edges crowd in',
    pitch: 'Being watched', thumb: { scale: 0.95, overlay: 'doorframe', arrow: 'none' } },
  { id: 'mirror', label: 'Mirror double', category: 'composition',
    recipe: 'MCU · subject + reflection share frame · 50mm · slow push',
    pitch: 'Two truths at once', thumb: { scale: 0.9, overlay: 'mirror', arrow: 'none' } },
]

export const SHOT_PRESETS_BY_ID: Record<string, ShotPreset> =
  Object.fromEntries(SHOT_PRESETS.map(p => [p.id, p]))
```

- [ ] **Step 4: Run the test, verify pass**

Run (from `frontend/`): `npx vitest run tests/unit/shot-presets.unit.spec.ts`
Expected: 3 passed

- [ ] **Step 5: Cross-check ids against the Python catalog**

Run (from repo root):
```bash
.venv/bin/python - <<'PY'
import re, json
from comfy_api_nodes.shot_presets import PRESET_IDS
ts = open('frontend/app/data/shot-presets.ts').read()
ts_ids = re.findall(r"\{ id: '([a-z0-9-]+)'", ts)
assert ts_ids == PRESET_IDS, f"MISMATCH:\n py={PRESET_IDS}\n ts={ts_ids}"
print(f"ids match ({len(ts_ids)})")
PY
```
Expected: `ids match (28)`

- [ ] **Step 6: Commit**

```bash
git add frontend/app/data/shot-presets.ts frontend/tests/unit/shot-presets.unit.spec.ts
git commit -m "FilmShot: frontend preset catalog (TS mirror) + data tests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `ShotPresetGalleryModal.vue`

**Files:**
- Create: `frontend/app/components/vue-canvas/ShotPresetGalleryModal.vue`

Pattern reference: `TextEffectGalleryModal.vue` (same props contract `{nodeId, nodes}`, emit `close`, write the selection into `node.data.widgetsValues` at the widget's index). The full component below is self-contained.

- [ ] **Step 1: Create the modal component**

```vue
<script setup lang="ts">
/**
 * ShotPresetGalleryModal — picker for the "Film a shot" node. Cards render a
 * data-driven CSS thumbnail (person silhouette + motion arrow + overlay), the
 * recipe line, and the mood pitch. Selecting writes the preset id into the
 * node's `preset` widget and closes.
 *
 * State path mirrors TextEffectGalleryModal:
 *   node.widgetsValues[preset_idx] = selected preset id
 */
import { X } from 'lucide-vue-next'
import {
  SHOT_PRESETS, SHOT_CATEGORY_LABELS,
  type ShotPreset, type ShotCategory, type ShotArrow,
} from '~/data/shot-presets'

const props = defineProps<{
  nodeId: string
  nodes: any[]
}>()
const emit = defineEmits<{ close: [] }>()

const node = computed(() => props.nodes.find(n => n.id === props.nodeId))

const presetWidgetIdx = computed(() => {
  const defs = (node.value?.data?.widgetDefs ?? []) as any[]
  return defs.findIndex(d => d.name === 'preset')
})
const currentPresetId = computed<string | null>(() => {
  const idx = presetWidgetIdx.value
  if (idx < 0) return null
  const v = node.value?.data?.widgetsValues?.[idx]
  return typeof v === 'string' ? v : null
})

// -- Filtering ---------------------------------------------------------------

const searchQuery = ref('')
const activeFilterId = ref<string>('all')

const filters = computed(() => {
  const cats: ShotCategory[] = ['movement', 'angle', 'lens', 'composition']
  const counts = new Map<ShotCategory, number>()
  for (const p of SHOT_PRESETS) counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  return [
    { id: 'all', label: 'All', count: SHOT_PRESETS.length },
    ...cats.map(c => ({ id: c, label: SHOT_CATEGORY_LABELS[c], count: counts.get(c) ?? 0 })),
  ]
})

const visibleItems = computed<ShotPreset[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return SHOT_PRESETS.filter((p) => {
    if (activeFilterId.value !== 'all' && p.category !== activeFilterId.value) return false
    if (!q) return true
    return [p.label, p.recipe, p.pitch].some(s => s.toLowerCase().includes(q))
  })
})

// -- Selection ---------------------------------------------------------------

function pick(id: string) {
  const idx = presetWidgetIdx.value
  if (idx < 0 || !node.value) return
  const wv = [...(node.value.data.widgetsValues ?? [])]
  wv[idx] = id
  node.value.data = { ...node.value.data, widgetsValues: wv }
  emit('close')
}

// -- Thumbnail helpers ---------------------------------------------------------

const ARROW_GLYPHS: Record<ShotArrow, string> = {
  in: '»', out: '«', up: '↑', upright: '↗', down: '↓', right: '→',
  orbit: '⟲', shake: '↯', dive: '⤵', flow: '⤳', rack: '⇄', none: '',
}
function arrowGlyph(p: ShotPreset): string {
  return ARROW_GLYPHS[p.thumb.arrow ?? 'none']
}
</script>

<template>
  <div class="fixed inset-0 z-[90] flex items-center justify-center" @click.self="emit('close')">
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="emit('close')" />
    <div class="relative w-[860px] max-w-[92vw] max-h-[84vh] flex flex-col rounded-2xl border border-white/10 bg-[#101216] shadow-2xl overflow-hidden">

      <!-- Header -->
      <div class="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-white/8">
        <div class="flex-1 min-w-0">
          <h2 class="text-sm font-semibold text-white/90">Pick a shot</h2>
          <p class="text-[11px] text-white/40">Each preset is a full recipe — size, angle, movement, lens, composition. Tweak any dimension under ADVANCED after picking.</p>
        </div>
        <input
          v-model="searchQuery"
          placeholder="Search shots…"
          class="w-44 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[12px] text-white/85 placeholder:text-white/30 focus:outline-none focus:border-white/25"
        >
        <button class="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/90" @click="emit('close')">
          <X class="size-4" />
        </button>
      </div>

      <!-- Category chips -->
      <div class="flex items-center gap-1.5 px-5 py-2.5 border-b border-white/8">
        <button
          v-for="f in filters" :key="f.id"
          class="px-2.5 py-1 rounded-full text-[11px] transition-colors"
          :class="activeFilterId === f.id ? 'bg-white/15 text-white' : 'bg-white/5 text-white/50 hover:text-white/80'"
          @click="activeFilterId = f.id"
        >
          {{ f.label }} <span class="opacity-50">{{ f.count }}</span>
        </button>
      </div>

      <!-- Grid -->
      <div class="flex-1 overflow-y-auto p-4 grid grid-cols-3 gap-3 content-start">
        <button
          v-for="p in visibleItems" :key="p.id"
          class="text-left rounded-xl border p-2.5 transition-colors group"
          :class="currentPresetId === p.id
            ? 'border-blue-400/70 bg-blue-400/10'
            : 'border-white/10 bg-white/[0.03] hover:border-white/25'"
          @click="pick(p.id)"
        >
          <!-- CSS thumbnail -->
          <div
            class="relative h-20 rounded-lg overflow-hidden mb-2"
            style="background: linear-gradient(135deg, #232a3a, #161a23)"
            :style="p.thumb.tilt ? { transform: `rotate(${p.thumb.tilt}deg)` } : {}"
          >
            <!-- thirds grid -->
            <div v-if="p.thumb.overlay === 'thirds'" class="absolute inset-0 opacity-25"
                 style="background: linear-gradient(to right, transparent calc(33% - .5px), #fff 33%, transparent calc(33% + .5px), transparent calc(66% - .5px), #fff 66%, transparent calc(66% + .5px)), linear-gradient(to bottom, transparent calc(33% - .5px), #fff 33%, transparent calc(33% + .5px), transparent calc(66% - .5px), #fff 66%, transparent calc(66% + .5px))" />
            <!-- doorframe bars -->
            <template v-if="p.thumb.overlay === 'doorframe'">
              <div class="absolute left-0 top-0 bottom-0 w-[26%] bg-[#0c0e12]" />
              <div class="absolute right-0 top-0 bottom-0 w-[18%] bg-[#0c0e12]" />
            </template>
            <!-- mirror panel -->
            <div v-if="p.thumb.overlay === 'mirror'" class="absolute right-[12%] top-[10%] bottom-[10%] w-[30%] rounded-sm border-2 border-[#3a4154] bg-[#1d2230]" />
            <!-- blur disc (macro / rack / telephoto) -->
            <div v-if="p.thumb.overlay === 'blur'" class="absolute inset-0" style="background: radial-gradient(circle at 50% 50%, transparent 24%, rgba(16,20,28,.78) 62%)" />
            <!-- streak (motion blur / anamorphic flare) -->
            <div v-if="p.thumb.overlay === 'streak'" class="absolute left-0 right-0 top-1/2 h-[2px]" style="background: linear-gradient(to right, transparent, rgba(110,160,255,.7), transparent)" />
            <!-- OTS foreground shoulder -->
            <div v-if="p.thumb.overlay === 'shoulder'" class="absolute -left-2 -bottom-2 w-12 h-12 rounded-t-xl bg-[#252b37]" />
            <!-- POV hands -->
            <template v-if="p.thumb.overlay === 'hands'">
              <div class="absolute bottom-[-4px] left-[16%] w-5 h-7 rounded-t-lg bg-[#3a3022]" />
              <div class="absolute bottom-[-4px] right-[16%] w-5 h-7 rounded-t-lg bg-[#3a3022]" />
            </template>
            <!-- person silhouette -->
            <div
              v-if="(p.thumb.scale ?? 1) > 0"
              class="absolute left-1/2"
              :style="{ top: `${p.thumb.top ?? 22}%`, transform: `translateX(-50%) scale(${p.thumb.scale ?? 1})` }"
            >
              <div class="w-3.5 h-3.5 rounded-full bg-[#e8b06d] mx-auto" />
              <div class="w-[26px] h-5 rounded-t-lg bg-[#5b8dd9] -mt-0.5 mx-auto" />
            </div>
            <!-- motion arrow -->
            <span
              v-if="arrowGlyph(p)"
              class="absolute right-2 top-1.5 text-[#7ee08a] font-bold text-base leading-none"
            >{{ arrowGlyph(p) }}</span>
          </div>

          <div class="text-[12px] font-medium text-white/90 leading-tight">{{ p.label }}</div>
          <div class="text-[10px] text-white/45 leading-snug mt-0.5">{{ p.recipe }}</div>
          <div class="text-[10px] text-blue-300/70 italic leading-snug mt-0.5">{{ p.pitch }}</div>
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Type-check the new component**

Run (from `frontend/`): `npx vue-tsc --noEmit 2>&1 | grep -i "ShotPresetGallery" || echo "no errors in new component"`
Expected: `no errors in new component` (the repo has pre-existing unrelated strictness errors — only check the new file).

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/ShotPresetGalleryModal.vue
git commit -m "FilmShot: preset gallery modal — CSS thumbnails, category chips, search

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Widget plumbing — picker kind, widget route, canvas mount

**Files:**
- Modify: `frontend/app/components/vue-canvas/widgets/WidgetModelPicker.vue`
- Modify: `frontend/app/components/vue-canvas/ComfyNodeWidget.vue` (~line 419)
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (~lines 1741–1770, ~4179)

- [ ] **Step 1: Add the `shot_preset` kind to `WidgetModelPicker.vue`**

(a) Extend the kind union in the props interface:

```typescript
  kind?: 'image' | 'video' | 'text_effect' | 'shot_preset'
```

(b) Add the import alongside the existing catalog imports at the top of the script:

```typescript
import { SHOT_PRESETS_BY_ID } from '~/data/shot-presets'
```

(c) In the `item` computed (the `kind` dispatch), add before the image fallback:

```typescript
  if (kind.value === 'shot_preset') {
    const p = SHOT_PRESETS_BY_ID[id]
    return p ? { label: p.label, accent: '#5b8dd9' } : null
  }
```

(d) In `cachedCoverUrl`, extend the no-cover guard:

```typescript
  if (!model.value || kind.value === 'text_effect' || kind.value === 'shot_preset') return null
```

(e) In the template, extend the two `kind === 'text_effect'` fallbacks:
- Placeholder label: `(kind === 'text_effect' ? 'Pick an effect' : kind === 'shot_preset' ? 'Pick a shot' : 'Pick a model')`
- Subtitle line: add after the text_effect subtitle span:

```vue
      <span v-else-if="kind === 'shot_preset'" class="text-[9px] text-white/40 truncate uppercase tracking-[0.06em] leading-tight">
        Shot preset
      </span>
```

- [ ] **Step 2: Route `shot_preset_picker` in `ComfyNodeWidget.vue`**

At the gallery-route template (~line 419), extend the condition and the kind mapping:

```vue
    <template v-if="widgetDef.sailor_widget === 'model_picker' || widgetDef.sailor_widget === 'video_model_picker' || widgetDef.sailor_widget === 'text_effect_picker' || widgetDef.sailor_widget === 'shot_preset_picker'">
      <VueCanvasWidgetsWidgetModelPicker
        :model-value="modelValue"
        :node-id="nodeId"
        :kind="widgetDef.sailor_widget === 'video_model_picker' ? 'video' : widgetDef.sailor_widget === 'text_effect_picker' ? 'text_effect' : widgetDef.sailor_widget === 'shot_preset_picker' ? 'shot_preset' : 'image'"
        @update:model-value="emit('update:modelValue', $event)"
      />
    </template>
```

- [ ] **Step 3: Mount the modal in `VueNodeCanvas.vue`**

(a) Next to `textEffectGalleryOpenForId` (~line 1743), add:

```typescript
const shotPresetGalleryOpenForId = ref<string | null>(null)
```

(b) In the any-modal-open computed (~line 1754), add `shotPresetGalleryOpenForId.value ||` to the chain.

(c) In `handleOpenModelGallery` (~line 1769), add a branch ABOVE the `else` fallback:

```typescript
  else if (detail?.kind === 'shot_preset') shotPresetGalleryOpenForId.value = nodeId
```

(d) In the template next to the `VueCanvasTextEffectGalleryModal` mount (~line 4179), add (mirror the TextEffect block's props exactly — it passes `:node-id` and `:nodes`):

```vue
    <VueCanvasShotPresetGalleryModal
      v-if="shotPresetGalleryOpenForId"
      :node-id="shotPresetGalleryOpenForId"
      :nodes="nodes"
      @close="shotPresetGalleryOpenForId = null"
    />
```

(Check how the TextEffect mount passes `nodes` — if it uses a different binding, e.g. plain `:nodes="nodes"`, copy that form verbatim.)

- [ ] **Step 4: Type-check + unit tests**

Run (from `frontend/`):
```bash
npx vue-tsc --noEmit 2>&1 | grep -iE "WidgetModelPicker|ComfyNodeWidget.vue\(4[0-9][0-9]|ShotPreset" || echo "no new errors"
npx vitest run
```
Expected: `no new errors`; all vitest tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/widgets/WidgetModelPicker.vue frontend/app/components/vue-canvas/ComfyNodeWidget.vue frontend/app/components/vue-canvas/VueNodeCanvas.vue
git commit -m "FilmShot: wire shot_preset_picker — picker kind, widget route, modal mount

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Canvas registrations — toolbox, capabilities, icons

**Files:**
- Modify: `frontend/app/data/toolbox-items.ts` (Video → Generate section, ~line 448)
- Modify: `frontend/app/data/node-capabilities.ts` (~line 59)
- Modify: `frontend/app/data/generator-icons.ts` (~lines 67 and 129)

- [ ] **Step 1: Toolbox entry**

In `toolbox-items.ts`, the Video "Generate" section (directly after the `GenerateVideoNode` row):

```typescript
      { nodeType: 'FilmShotNode',         label: 'Film a Shot',        description: 'Direct a video like a cinematographer — 28 shot presets (push-in, dolly zoom, god shot…) write the camera language for you. Cloud.', icon: Clapperboard },
```

Add `Clapperboard` to the lucide import list at the top of the file (it's a valid lucide-vue-next icon).

- [ ] **Step 2: Capability rows**

In `node-capabilities.ts`, after the two `GenerateVideoNode` rows:

```typescript
  { nodeType: 'FilmShotNode',      useCase: 'Film a cinematic shot',      model: 'Kling / full gallery',          from: 'prompt', to: 'video' },
  { nodeType: 'FilmShotNode',      useCase: 'Film a shot from an image',  model: 'Kling / full gallery',          from: 'image',  to: 'video' },
```

- [ ] **Step 3: Generator icons**

In `generator-icons.ts`:
- Icon map (~line 67, beside `GenerateVideoNode:    Film,`): add `FilmShotNode:         Clapperboard,` and add `Clapperboard` to that file's lucide import.
- Model-label map (~line 129, beside `GenerateVideoNode:    null,`): add `FilmShotNode:         null,                 // Multi: full video gallery`.

- [ ] **Step 4: Type-check**

Run (from `frontend/`): `npx vue-tsc --noEmit 2>&1 | grep -iE "toolbox-items|node-capabilities|generator-icons" || echo "no new errors"`
Expected: `no new errors`

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/toolbox-items.ts frontend/app/data/node-capabilities.ts frontend/app/data/generator-icons.ts
git commit -m "FilmShot: toolbox, capability, and icon registrations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full test sweep**

```bash
.venv/bin/python -m pytest tests-unit/comfy_api_test/shot_presets_test.py -v   # 15 passed
cd frontend && npx vitest run                                                   # all passed
```

- [ ] **Step 2: Schema live-check**

ComfyUI restarted in Task 3 — confirm it's still serving the node:
`curl -s http://127.0.0.1:8188/object_info | python3 -c "import json,sys; print('FilmShotNode' in json.load(sys.stdin))"` → `True`

- [ ] **Step 3: Manual smoke (browser, dev server on :3002)**

1. Hard-refresh the canvas tab. Open the Toolbox → Video → "Film a Shot" and drop the node.
2. Click the preset tile → gallery opens, 28 cards, category chips filter, search works.
3. Pick "Slow push-in" → modal closes, tile shows "Slow push-in / Shot preset".
4. Type a subject ("a lighthouse on a cliff at dusk"), confirm model tile shows Kling v2.5 Turbo Pro, duration 5s.
5. Expand ADVANCED → five override combos present, all `auto (preset)`.
6. Run (cost-confirm if prompted, ~$0.35). Watch the ComfyUI terminal for the
   `[FilmShot] preset='push-in' dialect='standard' …` line; verify the phrase reads correctly.
7. Video artifact card auto-materializes and plays the result; the shot should visibly push in.
8. Switch model to `hailuo-2.3`, re-run cheap/short, verify the log line shows `dialect='hailuo'` and the phrase starts with `[Push in]`.

- [ ] **Step 4: Bake-off gate (decides the "Recommended" badge keeps Kling)**

On one canvas: one subject prompt + "Hero orbit" preset → three FilmShot nodes (Kling v2.5 / Seedance 2.0 / Veo 3.1 Fast), same seed. Compare orbit fidelity. Record the verdict in `docs/plans/2026-06-10-film-a-shot-node-design.md` under a new "Bake-off result" heading; if Kling loses, change `_FILM_SHOT_DEFAULT_MODEL_ID` and the toolbox/capability copy in the same commit.

- [ ] **Step 5: Final commit (if bake-off changed anything) + wrap-up**

```bash
git add -A && git status --short   # review; commit only intentional changes
```

---

## Self-review notes (kept for the executor)

- **Spec coverage:** every spec section maps to a task — catalog/compiler (1–2), node+registration (3), TS catalog (4), gallery modal (5), widget plumbing (6), registrations (7), tests inline per task, bake-off gate (8.4). Out-of-scope items (native camera params, designer node, lighting presets) have no tasks by design.
- **Known judgment calls:** `audio` input intentionally omitted (spec) — picking the Fabric lip-sync model on this node will fail at the API; acceptable, it's a framing node. Override combo VALUES are full phrases (they substitute verbatim) — keep them short-ish so the combo UI stays readable.
- **Two foot-guns from 2026-06-09 debugging, pre-checked here:** `seed` carries `control_after_generate=True` (Task 3 Step 4 asserts it via /object_info); all widget-bearing inputs are `required`-group combos/strings so positional `widgets_values` alignment matches `getWidgetDefs`.
