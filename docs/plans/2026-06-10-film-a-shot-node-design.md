# Film a Shot — cinematic framing node (design)

**Status:** spec approved in brainstorm, pending implementation plan
**Date:** 2026-06-10

## What it is

A video-generator node ("Film a shot", `FilmShotNode`) that turns a subject prompt
(and optionally a start image) into a video with professional cinematography,
chosen from a gallery of named shot presets. Each preset is a complete recipe
across five dimensions: **shot size, camera angle, camera movement, lens & depth
of field, composition**. The node compiles the recipe into model-appropriate
prompt language and dispatches through the existing video-model registry.

Decisions made during brainstorm (with the user, 2026-06-10):

- **Scope:** all five framing dimensions (size / angle / movement / lens / composition).
- **Shape:** a generator (like `GenerateVideoNode`), not a prompt-designer node —
  but with the preset→prompt compiler factored into its own module so a designer
  node could reuse it later.
- **Inputs:** text + optional start image (mirrors `GenerateVideoNode`).
- **UX:** hybrid — preset gallery up front, five per-dimension overrides under
  ADVANCED. (Pattern: model gallery + advanced options on Generate-an-image.)
- **Models:** the full `video_models.py` registry via the existing
  `video_model_picker`; **default `kling-v2.5-turbo-pro`** with a "Recommended"
  badge (strongest camera-movement pedigree at mid-tier cost). Confirm via a
  variant fan-out bake-off before shipping the badge.
- **Roster:** 28 presets (16 + 12), validated visually; full table below.

## Backend

### `FilmShotNode` (comfy_api_nodes/nodes_replicate.py)

Category `api node/video/Replicate`, display name **"Film a shot"**.

| Input | Type | Notes |
|---|---|---|
| `preset` | Combo over 28 preset ids | default `push-in`; `extra_dict={"sailor_widget": "shot_preset_picker"}` |
| `prompt` | String, multiline | the *subject*; the preset supplies the cinematography |
| `image` | Image, optional | start frame → image-to-video |
| `model` | Combo | same registry + `video_model_picker` widget as GenerateVideoNode; default `kling-v2.5-turbo-pro` |
| `aspect_ratio` | Combo | as GenerateVideoNode (auto-fallback per model) |
| `duration` | Combo | as GenerateVideoNode (remap to nearest supported) |
| `seed` | Int | `control_after_generate=True` (required for widget alignment — see 2026-06 seed-control bug) |
| `model_options` | String JSON | internal; per-model advanced bag written by the model gallery |
| `shot_size` | Combo, advanced | `auto (preset)` + explicit options |
| `camera_angle` | Combo, advanced | `auto (preset)` + explicit options |
| `camera_movement` | Combo, advanced | `auto (preset)` + explicit options |
| `lens_look` | Combo, advanced | `auto (preset)` + explicit options |
| `composition` | Combo, advanced | `auto (preset)` + explicit options |

Output: `IO.Video.Output()`. Price badge: same approximate expr as
GenerateVideoNode (~$0.40) — same model pool.

`execute()`:
1. Resolve preset id → `ShotPreset`; apply any non-`auto` overrides (each
   override replaces exactly one dimension).
2. Pick dialect from the model id/brand; `build_shot_phrase(recipe, dialect)`.
3. Weave with the subject: `f"{shot_phrase} {prompt}"`.
4. Dispatch exactly as `GenerateVideoNode.execute` does: `_VIDEO_MODELS_BY_ID`
   lookup, t2v/i2v mode check, duration remap, `build_input`, `_run_prediction`,
   download to video output. No new dispatch plumbing.

### `shot_presets.py` (new module, pattern: `text_effects.py`)

```python
@dataclass(frozen=True)
class ShotPreset:
    id: str            # "dolly-zoom"
    label: str         # "Dolly zoom (Vertigo)"
    category: str      # movement | angle | lens | composition
    size: str          # "medium close-up"
    angle: str         # "eye level"
    movement: str      # "camera dollies in while the lens zooms out"
    lens: str          # "50mm, background perspective visibly warping"
    composition: str   # "subject locked dead center"
    note: str          # mood line, woven into the phrase
```

The module owns: `PRESETS` (ordered list of 28), `PRESETS_BY_ID`, the
per-dimension option lists for the ADVANCED override combos (single source of
truth), and the compiler.

### Compiler: `build_shot_phrase(recipe, dialect) -> str`

Pure function. Dialects:

- `standard` — director's-note prose: *"Medium close-up at eye level. The camera
  dollies in slowly. 50mm lens, shallow depth of field; subject centered.
  Builds quiet tension."* (proven approach from `RotateCameraNode`)
- `veo` — lens-mm-forward phrasing (Google documents shot vocabulary parsing:
  "18mm low-angle tracking shot").
- `hailuo` — prefixes MiniMax Director bracket commands (`[Push in]`,
  `[Pan left]`) before the prose.

Dialect chosen by model id/brand lookup; unknown → `standard`. Per-model
dialects are the key extensibility point: same recipe, best phrasing per engine.

## The 28 presets

| id | label | cat | recipe sketch |
|---|---|---|---|
| push-in | Slow push-in | movement | MCU · eye level · slow dolly in · 50mm shallow · centered — quiet tension |
| pull-back | Pull-back reveal | movement | CU→wide · eye level · dolly out · 35mm deepening · subject anchored — context lands last |
| crane-reveal | Crane reveal | movement | wide · rising low→high · crane up · 24mm deep · landscape — establishing grandeur |
| orbit | Hero orbit | movement | MS · eye level · slow 180° arc · 35mm shallow · subject locked center |
| tracking | Lateral tracking | movement | MS profile · eye level · smooth side-track · 40mm deep · leading room |
| handheld | Handheld urgency | movement | MCU · eye level · shaky handheld follow · 28mm · loose framing — documentary |
| dolly-zoom | Dolly zoom (Vertigo) | movement | MCU · eye level · dolly in + zoom out · warping background · centered |
| locked-off | Symmetrical one-point | composition | wide · eye level · locked-off static · 32mm deep · dead-center symmetry |
| tilt-reveal | Tilt-up reveal | movement | feet→face · low angle · slow tilt up · 35mm · vertical reveal |
| god-shot | Overhead god shot | angle | wide · directly overhead · slow descend · 24mm deep · geometric floor |
| low-hero | Low-angle power | angle | MS · strong low angle · slight push · 24mm distortion · towering frame |
| dutch | Dutch drift | angle | MCU · dutch 15° · slow lateral drift · 40mm shallow · off-balance thirds |
| ots | Over-the-shoulder | composition | MCU · eye level · static/micro-drift · 65mm shallow · foreground shoulder |
| pov | POV walk | composition | first person · eye level · handheld forward · 28mm · body edges in frame |
| anamorphic | Anamorphic dream | lens | MS · eye level · slow drift · anamorphic flares, oval bokeh · letterbox feel |
| macro | Macro detail | lens | ECU · top-down/eye level · rack focus pull · macro shallow · isolated detail |
| whip-pan | Whip pan | movement | MS · eye level · violent fast pan, motion-blur streaks · 35mm |
| crash-zoom | Crash zoom | movement | wide→CU · eye level · abrupt punch-in zoom · zoom-lens feel — grindhouse |
| snorricam | Snorricam | movement | CU body-rigged · face locked, world lurches · 28mm — panic |
| steadicam-oner | Steadicam oner | movement | MS following · eye level · unbroken glide through spaces · 32mm deep |
| fpv-dive | FPV drone dive | movement | wide→tight · plunging aerial · aggressive dive + weave · ultra-wide |
| aerial-orbit | Aerial establish orbit | movement | extreme wide · high aerial · slow drone circle · 24mm deep |
| ground-rush | Ground-rush tracking | movement | low MS · inches off floor · fast forward skim · 24mm |
| worms-eye | Worm's-eye sky | angle | extreme low looking straight up · static/slow roll · 18mm |
| rack-focus | Rack focus reveal | lens | two planes MCU · eye level · static frame, focus pulls front→back · 85mm |
| telephoto | Telephoto compression | lens | MCU from afar · eye level · static/micro-pan · 300mm stacked planes |
| voyeur-frame | Voyeur doorframe | composition | MS · eye level · static through doorway/window slit · 50mm · dark edges |
| mirror | Mirror double | composition | MCU · subject + reflection share frame · static/slow push · 50mm |

(Authoritative recipe strings live in `shot_presets.py`; this table is the
human-readable index. Brainstorm mockups: `.superpowers/brainstorm/93729-*/content/`.)

## Frontend

- **Picker widget:** add `shot_preset_picker` to the existing gallery route in
  `ComfyNodeWidget.vue` (the `model_picker` / `video_model_picker` /
  `text_effect_picker` switch) with `kind: 'shot_preset'`. Tiles: CSS-drawn
  thumbnails (person silhouette + motion arrows — no image assets), label,
  one-line recipe, category filter chips. Selection writes the preset id to the
  combo. Node body shows the selected preset as a compact tile.
- **Node body:** standard `comfy` node type; the five override combos are
  `advanced=True` so the existing ADVANCED grouping collapses them.
- **Registrations:** `toolbox-items.ts` (Video section, "Film a shot",
  clapperboard icon), `node-capabilities.ts` (image→video capability),
  generator icon map.
- **Auto-sink:** VIDEO output flows through existing `ARTIFACT_NODE_FOR_OUTPUT`
  → Video artifact card. Nothing new.

## Testing

- **pytest** (`tests-unit/comfy_api_test/shot_presets_test.py`, mirroring
  `text_effects_test.py`):
  - table integrity: 28 unique ids, every dimension non-empty, categories valid;
  - compiler: standard phrase contains the recipe's size/movement terms; hailuo
    starts with bracket commands; veo contains lens-mm vocabulary; an override
    substitutes exactly one dimension; unknown model falls back to standard.
- **vitest:** none — the picker reuses an existing component; new code is data.
- **Manual gate:** variant fan-out bake-off (one subject, one preset, 3 models:
  Kling 2.5 / Seedance 2.0 / Veo 3.1 Fast) before shipping the "Recommended"
  badge on Kling.

## Operational notes

- Backend changes require a ComfyUI restart (kill, don't auto-restart — dev
  supervisor pattern); the frontend picks up the new schema via the existing
  once-per-session `refreshSchema` force-fetch.
- Seed input MUST carry `control_after_generate=True` and widget order must
  match the schema — both foot-guns from the 2026-06-09 debugging session are
  called out here so the implementation plan includes them as checks.

## Out of scope (v1)

- Native camera-parameter mapping (e.g. Kling `camera_control` JSON) — the
  dialect compiler is the v2 seam for this.
- A standalone "shot designer" node emitting an enriched prompt — the factored
  compiler makes this cheap to add later if wanted.
- Lighting/color presets (golden hour, low-key noir) — framing only; lighting
  is a natural sibling node.
