# Pose Source Modes — design

**Date:** 2026-06-11
**Status:** Approved, pre-implementation

## Goal

Let a user re-pose a wired character three ways from one node: pose a 3D
mannequin (today), wire a **pose reference image**, or type a **pose prompt**.
Extend the existing **Pose Mannequin** node rather than adding a new one.

## Decisions (from brainstorming)

- **Scope:** extend the existing `PoseMannequin` node + `PoseMannequinNode.vue`,
  reusing the verified nano-banana-2 pipeline. No new node.
- **Pose-image input:** a **wired IMAGE input** only (`pose_image`). No
  upload-in-modal. The pose source must exist as a node on the canvas.
- **Mode selection:** an **explicit segmented toggle** on the node
  (Mannequin / Image / Prompt) bound to a `pose_source` widget. Not a dropdown,
  not automatic precedence.
- **Generation path (Approach A):** Image and Prompt modes generate through the
  normal graph-run path, scoped to just this node via the existing
  `comfynext:runFiltered { targetIds, live: true }` event (added 2026-06-11 for
  Smart Layout). No new API route; the Python `execute()` does the call. The
  in-editor instant path (`/api/inpaint/pose`) stays mannequin-only.

## Architecture

### Python node — `comfy_extras/nodes_pose_mannequin.py`

Append new inputs (append-only to minimize widget-position drift; existing
canvas instances must be re-added after the schema change — known gotcha):

- `pose_source` Combo `["mannequin", "image", "prompt"]`, default `"mannequin"`.
- `pose_image` optional **IMAGE input** (wired only).
- `pose_prompt` optional multiline String — the pose description for prompt mode.

`execute()` branches on `pose_source`:

- **mannequin** (unchanged): baked `result_image` shortcut wins; else
  character + normal-map/gray conditioning → nano-banana-2 with the existing
  `_BASE_PROMPT`; else passthrough.
- **image**: `character` + `pose_image` → nano-banana-2 with a **new pose-photo
  base prompt** (the current `_BASE_PROMPT` describes a surface-normal render —
  wrong for a real photo/figure; the new one says "the second image shows a
  person/figure in the TARGET pose; copy the body pose, stance, limb positions,
  head angle and whole-body orientation; keep the first character's identity,
  clothing and art style"). `result_image` shortcut does NOT apply (it's
  editor-managed mannequin state).
- **prompt**: single-image call `image_input: [character]`, instruction =
  identity-preservation preamble + "pose them as follows: {pose_prompt}". No
  baked shortcut.
- Guard rails: image mode with no `pose_image`, or prompt mode with empty
  `pose_prompt` → passthrough the character (same as today's "nothing to pose
  with" branch).

Three base-prompt constants live in the node module: `_BASE_PROMPT` (mannequin,
unchanged), `_IMAGE_POSE_PROMPT` (new), `_TEXT_POSE_PROMPT` (new). Keep them in
sync conceptually with the route, but the route is not modified (mannequin-only).

### Vue node — `frontend/app/components/vue-canvas/PoseMannequinNode.vue`

Add a 3-segment **toggle** below the header writing `pose_source`. Read/write
widgets via the existing `widgetIdx`/`widgetStr` helpers plus a `setWidget`
that emits the canvas's standard widget-update (match how other custom nodes
mutate `widgetsValues`).

Body adapts to the selected mode:

- **mannequin**: current mannequin preview + "Edit pose" / "Pose & Generate"
  button (unchanged).
- **image**: render a **second target input handle** for `pose_image`; preview
  area shows the wired pose image when connected (resolve like the existing
  `mannequinUrl`, but from the wired upstream image) or a "Wire a pose image"
  hint. Footer button = **Generate**.
- **prompt**: a small `nodrag nopan` textarea bound to `pose_prompt`. Footer
  button = **Generate**.

**Generate** dispatches `comfynext:runFiltered { targetIds: [props.id], live:
true }`. The result flows out the existing IMAGE output into the downstream
artifact-image node via the existing result-routing (unchanged).

Handle indexing: `character` stays input 0; `pose_image` is input 1. The
`pose_image` handle only renders in image mode to avoid a dangling port in the
other modes (verify VueFlow is happy with conditionally-rendered handles; if
not, always render it but visually de-emphasize outside image mode).

## Out of scope / untouched

- `PoseEditorModal.vue`, `usePoseRig.ts`, multi-view + Hunyuan3D pipeline.
- `/api/inpaint/pose.post.ts` (mannequin instant path only).
- Result-routing events (`comfynext:poseResult`).

## Testing

- **Unit:** test `execute()` branch selection with the Replicate helpers mocked
  — mannequin/image/prompt each call with the right `image_input` shape and
  prompt; missing-input guards passthrough.
- **In-browser:** restart ComfyUI (Python schema change), hard-reload, re-add
  the node. Verify: toggle switches modes and persists; `pose_image` handle
  appears in image mode and accepts a wired image; prompt textarea persists;
  Generate triggers a scoped run. One real ~$0.05 generation per new mode to
  confirm output quality (identity held, pose adopted).

## Risks

- Schema change shifts widget positions → existing instances misalign and must
  be re-added (documented gotcha, not a regression).
- Conditionally-rendered VueFlow handle may need the always-render fallback.
- Image-mode pose adherence from a real photo is naturalized, not joint-exact
  (same property as the mannequin path) — acceptable per prior spike.
