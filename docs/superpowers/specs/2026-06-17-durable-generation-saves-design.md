# Durable saves for generators + frames — design

**Date:** 2026-06-17
**Branch:** `main` (current; small, additive changes — no isolation needed, but a worktree is fine)

## Goal

Make every image-producing result durable so it lands in the **Assets** panel and persists
as its own history entry:
1. **All image-producing api nodes** (`comfy_api_nodes/nodes_replicate.py`) — generators AND
   image utilities — should save a `type:output` PNG per run.
2. **The Frame/Compositor node** — its baked composite should be recorded as a project asset.

## Background (confirmed)

- The Assets panel (`useProjectGenerations.fetchGenerations`) reads ComfyUI's `/history` and
  keeps only `type:"output"` files (it filters out `type:"temp"` live-preview frames).
- `comfy_extras/_live_preview.py` has two helpers:
  - `save_live_preview(tensor, node_id)` → a single **overwriting temp** file, `type:"temp"`
    (transient in-node preview; NOT kept by Assets; fixed filename per node).
  - `save_generation_output(tensor, prefix)` → a **uniquely-numbered** PNG, `type:"output"`
    (like SaveImage; kept by Assets; each run is its own file).
- Several api nodes already use the durable pattern — e.g. `BlendSceneNode`
  (`ui=save_generation_output(edited, "blend_scene")`), `RestyleFromImageNode`, `ProductShotNode`.
  This is the proven template to copy.
- The bare-tensor image nodes (below) return `IO.NodeOutput(tensor)` with no `ui=`, so their
  results never become `type:"output"` and never reach Assets.
- The Frame node (`ArtifactFrameNode.vue`) bakes a composite (`exportCompositeCanvas`) but never
  calls `recordAsset`. The studios (Space Type, Gradient) show the frontend pattern:
  `uploadFrameBatch([blob], prefix)` → `recordAsset(projectUuid, 'image', filename)`.

## Decisions (locked during brainstorming)

1. **Scope = all image-producing api nodes** — generators (Generate an image, Flux 1.1 Pro,
   Flux Kontext, Ideogram, Edit Image, Rotate Camera, Text Effect) AND image utilities
   (Remove Background, Restore Photo, Fix Faces/CodeFormer, Clarity Upscale). Video/audio
   generators are **out of scope** (they output Video/Audio, which need a different durable-save
   mechanism than the image-only `save_generation_output`).
2. **"Frames" = the Frame/Compositor node's baked output → Assets.**

## Part A — Image api nodes durable save

Add `ui=save_generation_output(<image_tensor>, "<prefix>")` to the `IO.NodeOutput(...)` return of
each bare-tensor image-producing node in `comfy_api_nodes/nodes_replicate.py`:

| Node | prefix |
|------|--------|
| `GenerateImageNode` | `generate_image` |
| `FluxProRemoteNode` | `flux_pro` |
| `FluxKontextRemoteNode` | `flux_kontext` |
| `IdeogramV3TurboNode` | `ideogram` |
| `EditImageNode` | `edit_image` |
| `RotateCameraNode` | `rotate_camera` |
| `TextEffectNode` | `text_effect` |
| `ClarityUpscaleRemoteNode` | `clarity_upscale` |
| `RemoveBackgroundRemoteNode` | `remove_bg` |
| `RestorePhotoRemoteNode` | `restore_photo` |
| `CodeformerRemoteNode` | `codeformer` |
| `FluxLoRARemoteNode` / `FluxMultiLoRARemoteNode` | `flux_lora` (save the image; keep `info`) |

Each `execute` currently ends with `return IO.NodeOutput(tensor)` (or `(tensor, info)`); change to
`return IO.NodeOutput(tensor, ui=save_generation_output(tensor, "<prefix>"))` (keeping any extra
positional outputs). `save_generation_output` already handles batches (`ndim==4` loops).
`save_generation_output` is already imported at the top of the file.

### Canary-first rollout (the one real risk)

These bare nodes currently display on the canvas via *some* existing path. Emitting a `ui` image
(via `save_generation_output`) makes the node report a UI result, which could in principle:
(a) cause a **double** inline preview (the generator node showing the image inline *and* the
downstream artifact), or (b) be redundant with an existing display path.

So Part A is **canary-first**: wire up **`GenerateImageNode` only**, then verify in-app that
(1) it appears in the Assets panel, (2) the canvas still looks right (no double preview, the
artifact still shows the result), and (3) re-rolls accumulate as separate Assets entries. Only
after that verification passes do we roll out to the remaining nodes (mechanical, identical edit).
If the canary double-displays, the fix is to adjust how the node body renders `data.images` for
generators with a downstream artifact (out-of-band; revisit before rollout).

## Part B — Frame/Compositor durable save

In `ArtifactFrameNode.vue`, when the Frame produces its baked composite (the
`exportCompositeCanvas()` path used for the node's output/export), additionally:
1. Convert the composite canvas to a PNG blob.
2. `const { uploadFrameBatch } = await import('~/composables/useKineticRenderer')`;
   `const [filename] = await uploadFrameBatch([blob], 'frame')`.
3. `await recordAsset(activeTab.value?.projectUuid, 'image', filename)` (via
   `useProjectGenerations()` + `useTabs()`), mirroring `GradientStudioSurface.generateImage`.

Trigger at the Frame's existing bake/output hook (so a baked frame is recorded once per bake,
not on every live re-composite). Guard against double-recording the identical composite (dedupe
by a content/signature check or only record on the explicit bake/run, not on every reactive
re-render).

## Testing

- **Python (Part A):** a unit test that calls each updated node's logic is impractical (network).
  Instead, assert the *shape*: `save_generation_output(fixture_tensor, "x")` returns
  `{"images": [{type:"output", filename, subfolder}], ...}` (already true — a guard test confirms
  the helper contract the nodes rely on). Confirm the module still imports and the catalog of api
  nodes loads.
- **In-app (Part A canary, then rollout):** generate from `GenerateImageNode` → appears in Assets;
  re-roll → multiple Assets entries; canvas unchanged. Then a couple of the rolled-out nodes.
- **In-app (Part B):** bake a Frame → its composite appears in Assets.

## Risks / non-goals

- **Double inline preview** (Part A) — gated by the canary verification.
- **Assets clutter:** utilities (bg-remove/restore/fix-faces/upscale) now save on every run — this
  is the explicit "all image-producing nodes" choice.
- **Out of scope:** video/audio generator durable saves (different mechanism); 3D/text outputs.
- **Frame double-record:** mitigated by recording only on the explicit bake/run hook.
