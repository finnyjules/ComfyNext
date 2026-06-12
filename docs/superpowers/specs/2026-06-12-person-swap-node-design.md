# Person Swap node — design

**Date:** 2026-06-12
**Status:** Approved, pre-implementation

## Goal

Replace the person in a scene image with a different person (identity swap),
preserving the original pose, framing, lighting, and background. A standard API
node powered by `google/nano-banana-2`, sitting alongside the existing
**Face Swap** node (which is face-only) as the whole-person counterpart.

## Decisions (from brainstorming)

- **Node style:** a standard API node rendered by the normal `ComfyNode` (NO
  custom Vue renderer). It therefore inherits regular-node chrome, the header ▶
  run control, and automatic downstream-sink routing for free. Mirrors the
  schema/registration of the existing nano-banana node (Pose Mannequin) and the
  local AI nodes (Face Swap).
- **Model:** `google/nano-banana-2` via the existing Replicate helpers in
  `comfy_api_nodes.nodes_replicate` — same plumbing as Pose Mannequin.
- **Target person source (v1):** a **wired IMAGE input** only. The
  character-library picker is an explicit fast-follow, NOT in v1 (the library is
  LoRA-based — only a cover portrait per character — so a clean library path is
  its own piece of work).
- **Outfit handling:** a `keep_outfit` BOOLEAN, **default on**.
  - on → swap identity only, keep the original scene's wardrobe.
  - off → bring the new person's own clothing/style too.
- **Always preserved** regardless of toggle: body pose/stance, framing, camera
  angle, background, lighting.
- **Multi-person:** v1 replaces the main/most-prominent subject. Precise
  targeting is via the free-text `instructions` hint ("replace the woman on the
  left"). Mask/region targeting is deferred.

## Architecture

### Prompt module — `comfy_extras/_person_swap_prompts.py` (NEW)

Torch-free, dependency-light (like `comfy_extras/_pose_prompts.py` /
`comfy_api_nodes/replicate_refs.py`) so it is unit-testable in CI. Exposes:

- `KEEP_OUTFIT_PROMPT` — identity-only swap: "...replace the person in the first
  image with the person from the second image — give them the second person's
  face, hair, skin tone and body type — but keep EVERYTHING ELSE from the first
  image identical: the same clothing/outfit, the same body pose and stance, the
  same framing, camera angle, background and lighting. Only the person's identity
  changes. Output only the edited scene."
- `NEW_LOOK_PROMPT` — person + their wardrobe: "...replace the person in the
  first image with the person from the second image, bringing the second
  person's own appearance AND clothing/style. Keep the first image's body pose
  and stance, framing, camera angle, background and lighting. Output only the
  edited scene."
- `swap_instruction(keep_outfit: bool, instructions: str = "") -> str` — returns
  `KEEP_OUTFIT_PROMPT` or `NEW_LOOK_PROMPT`; if `instructions` (stripped) is
  non-empty, appends `" Additional direction: {instructions}."`.

### Node — `comfy_extras/nodes_person_swap.py` (NEW)

A single `PersonSwapNode` (`IO`-schema, async `execute`). Schema mirrors how
Pose Mannequin declares itself (category, `is_api_node`, output node +
`save_live_preview`, the lazy `comfy_api_nodes.nodes_replicate` import inside
execute). Concretely:

- **node_id** `PersonSwap`, **display_name** "Person Swap".
- **Inputs:**
  - `scene` (IMAGE, required) — the image with the person to replace.
  - `person` (IMAGE, required) — reference photo of the new person.
  - `keep_outfit` (Boolean, default `True`, optional) — the outfit toggle.
  - `instructions` (String, multiline, default "", optional) — free-text
    direction + multi-person targeting hint.
- **Output:** `image` (IMAGE).
- **execute(scene, person, keep_outfit=True, instructions=""):**
  - Guard: if `scene is None` or `person is None` → pass the scene through (or a
    tiny blank if scene is also None). No paid call. Mirrors Pose Mannequin's
    "nothing to pose with" branch.
  - Else build `instruction = swap_instruction(bool(keep_outfit), instructions)`
    and call nano-banana-2 with `image_input = [scene_data_url, person_data_url]`
    via the shared helpers (`_image_tensor_to_data_url`, `_run_prediction(
    "google/nano-banana-2", ...)`, `_first_output_url`,
    `download_url_to_image_tensor(..., cls=cls)`), returning
    `IO.NodeOutput(result, ui=save_live_preview(result, uid))`.
  - `input_dict`: `{prompt, image_input, resolution: "1K", output_format:
    "png"}` (same shape Pose Mannequin uses).

### Registration / discovery

- Register `PersonSwapNode` in the module's `comfy_entrypoint`/node list the same
  way `nodes_pose_mannequin.py` does, so it loads into `object_info`.
- Add a toolbox catalog entry in `frontend/app/data/toolbox-items.ts` under the
  Image → AI section (next to Face Swap) so users can add it from the toolbox.
- Optional: a generator icon mapping (e.g. a "users" glyph) via the existing
  `getGeneratorIcon` map — nice-to-have, not required for function.

No `VueNodeCanvas.vue` / custom-renderer changes: result routing and the header
run button come from the standard node path.

## Testing

- **Unit (TDD):** `tests-unit/comfy_extras_test/person_swap_prompts_test.py` —
  `swap_instruction` returns the keep-outfit base when `keep_outfit=True`, the
  new-look base when `False`, appends "Additional direction: …" when
  instructions present, omits it when blank/whitespace. Dependency-light, no
  torch.
- **Import smoke:** `python -c "import comfy_extras.nodes_person_swap"` +
  `define_schema().node_id == "PersonSwap"`.
- **In-browser (needs user):** restart ComfyUI (new Python node), hard-reload,
  add the node from the toolbox, wire a scene + a person reference, run once per
  toggle state (~$0.05 each) — confirm identity swapped, pose/framing/background
  preserved, and `keep_outfit` flips wardrobe behavior. One multi-person scene
  with an `instructions` targeting hint.

## Risks

- Single reference photo → likeness is naturalized, not exact (same property as
  the Pose Mannequin path; acceptable).
- Multi-person disambiguation relies on the text hint; busy scenes may swap the
  wrong subject — documented v1 limitation, mask targeting deferred.
- nano-banana may alter the kept outfit slightly; the prompt emphasizes "keep
  the outfit identical" to minimize drift.

## Out of scope (v1)

- Character-library picker (fast-follow; resolves a character's cover portrait
  into the `person` reference).
- Mask/region targeting for a specific person in a crowd.
- Batch/multi-face.
