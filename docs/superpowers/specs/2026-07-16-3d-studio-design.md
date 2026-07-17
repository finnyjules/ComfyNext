# 3D Studio — design spec

**Date:** 2026-07-16
**Status:** approved (brainstorm with Julien)
**Scope:** v1 of the merged "3D Studio" node — a Studio-family 3D workspace whose
outputs feed the AI generation pipeline. A later, separate sub-project (standalone
3D design tool, "mini-Spline") will reuse this project's `app/lib/scene3d/` core.

## Purpose

A canvas node + fullscreen editor where the user composes a 3D scene — primitives
and imported GLB models, moved with gizmos, with PBR materials, lighting presets,
and a framed camera — and bakes it into three images:

- **beauty** — the shaded viewport render (img2img base, or transparent-bg design asset)
- **depth** — normalized grayscale depth (ControlNet depth conditioning)
- **normal** — surface-normal pass (ControlNet normal conditioning)

3D here is a staging/composition tool for AI images, in the same spirit as
PoseMannequin and SpaceType.

## Decisions (from brainstorm)

| Question | Decision |
|---|---|
| Purpose | AI-generation feeder first; standalone 3D tool is a later separate project |
| One node or two? | One merged "3D Studio" node (Studio-family UX, PoseMannequin data flow) |
| Scene content v1 | Primitives (box, sphere, cylinder, cone, torus, plane) + imported GLBs |
| Outputs | beauty + depth + normal (`IMAGE` ×3) |
| Editor UI | Node card + fullscreen surface on `StudioModalShell` |
| Lighting | Presets (studio/soft/dramatic/flat) + sun azimuth/elevation/intensity + ambient |
| Materials | Per-object color + roughness + metalness (`MeshStandardMaterial`) |
| Camera | Render-what-you-framed: orbit to edit, "Set camera from view" commits; FOV slider |
| Rendering | Client-side (Three.js) baked on the frontend; no server-side rendering |
| Libraries | Zero new deps: `three` (already 0.171) + bundled addons (OrbitControls, TransformControls, GLTFLoader, RoomEnvironment/PMREMGenerator) |

## Architecture

### Backend — `comfy_extras/nodes_scene3d.py`, node id `Scene3DStudio`

Follows `nodes_pose_mannequin.py` exactly:

- Editor-managed hidden string inputs (serialize with the workflow):
  - `scene_state` — the serialized `SceneDoc` JSON
  - `beauty_image`, `depth_image`, `normal_image` — uploaded bake filenames in ComfyUI's input dir
- Optional `glb_url` string input so a Model3D (image-to-3D) node can be wired in as an import source.
- `execute()` loads the three files (`_load_input_image` pattern) and returns
  `(IMAGE, IMAGE, IMAGE)` = beauty, depth, normal. A graph Run replays the last
  bake; it never re-renders server-side.
- No bake yet → return neutral gray placeholders instead of erroring the graph.

### Frontend node — `frontend/app/components/vue-canvas/Scene3DStudioNode.vue`

Studio-style card: beauty-bake thumbnail, "Edit" button opening the surface,
three IMAGE output ports (beauty/depth/normal), `glb_url` input port, and an
"unbaked changes" badge when `scene_state` is newer than the last bake.

### Editor surface — `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`

Built on `StudioModalShell` (sibling of ShapeStudioSurface), but the center is an
interactive viewport:

- **Viewport:** Three.js scene, OrbitControls, ground grid, soft shadow.
  Click-select via raycast; TransformControls gizmo on selection. Keys: W/E/R
  move/rotate/scale, Esc deselect, Backspace delete. Overlay toolbar: add-object
  menu, gizmo mode, snap toggle, "Set camera from view".
- **Left rail — object list:** name, type icon, visibility toggle,
  duplicate/delete; selection synced with viewport. Import section: GLB from
  wired `glb_url` or file upload.
- **Right rail — inspector** (reuses `studio/` control kit):
  - Selection: numeric transform fields; material color/roughness/metalness.
  - Camera: FOV slider, output aspect/size.
  - Lighting: preset segmented control, sun azimuth/elevation/intensity, ambient.
  - Background: color or transparent.
- **Footer:** Bake button (renders passes, uploads, writes widgets).
  Closing the surface with unbaked edits auto-bakes.

### Lib core — `frontend/app/lib/scene3d/`

Framework-agnostic (Smart Layout render-parity lesson: render logic lives in
shared modules, the Vue surface is a thin shell). The future standalone tool
reuses this wholesale.

- `config.ts` — `SceneDoc` types (objects[], camera, lighting, background,
  version) + defaults + version migration. This is what `scene_state` stores.
- `engine.ts` — `SceneEngine` (mirrors `ShapeEngine`): owns renderer/scene/cameras,
  `syncFromDoc(doc)` diffs the document into Three objects, rAF loop, dispose.
- `passes.ts` — `renderPasses(engine, doc, w, h)` → three PNG blobs.
  Beauty: scene as-is. Depth: `MeshDepthMaterial` override, normalized to the
  scene bounding range. Normal: `MeshNormalMaterial` override. All from the
  committed scene camera at output resolution.
- `interaction.ts` — selection raycasting + TransformControls wiring, emitting
  document mutations (future undo/redo hook point).
- `glb.ts` — GLTFLoader wrapper with per-URL caching.

## Data flow

1. Edit in surface → reactive `SceneDoc` (lib core), live rAF viewport render.
2. Bake (button or close-with-edits) → `renderPasses` off-screen at output
   resolution from the committed scene camera.
3. Upload three PNGs via the existing image-upload path → filenames + serialized
   `SceneDoc` written into node widgets.
4. Graph Run → Python loads files → IMAGE ×3 flow downstream.

Scene JSON lives in a widget, so scenes save/load with the workflow and stay
re-editable.

## Error handling

- **No WebGL:** `detectWebGL` guard (ShapeStudio pattern); surface shows fallback message.
- **GLB load failure** (bad URL, CORS, oversized): object shows error state in
  the list with retry; scene stays usable. Size cap warns before loading.
- **Run with no bake:** gray placeholder outputs, no graph error.
- **Stale bake:** node badge + auto-bake on surface close.

## Testing

- Unit: `config.ts` serialize/migrate round-trip; depth normalization math in `passes.ts`.
- Dev-lab standalone mount of the surface before canvas wiring (ShapeStudio smoke-test pattern).
- Manual: gizmo/selection feel; end-to-end wire into an img2img graph
  (beauty → img2img, depth → ControlNet) on the dev server at 127.0.0.1.
- Typecheck stays at the ~328 baseline.

## Out of scope (v1)

- Server-side rendering on Run (frontend bake replay only, like PoseMannequin).
- 3D text, pose mannequins inside scenes, editable point/spot lights, material
  preset library, undo/redo, animation, physics, CSG booleans, GLB export.
- The standalone 3D design tool (separate follow-up project on the same core).
