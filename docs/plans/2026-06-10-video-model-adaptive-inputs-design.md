# Adaptive video-node inputs (design)

**Status:** approved in brainstorm, pending implementation plan
**Date:** 2026-06-10
**Applies to:** `FilmShotNode` ("Film a shot") and `GenerateVideoNode` ("Generate a video")

## Problem

Both video nodes expose static widgets while the 16-model registry varies per
model: Kling v2.5 Turbo Pro and Fabric 1.0 accept no `seed` (Replicate 422s on
it — see the 2026-06-10 Kling builder fix), Veo only renders 8s, every model
supports a different aspect-ratio set. Today the backend silently remaps
(duration/aspect) or the field silently does nothing (seed). The node UI lies.

## Decisions (brainstorm, 2026-06-10)

- **Scope: both nodes** — they share the model picker and registry.
- **Adapt: seed (hide), duration (filter options), aspect_ratio (filter
  options).** Ports (image/audio) deferred — hiding a port with a wire attached
  opens wiring questions; tooltips already explain model behavior.
- **Mechanism: frontend-only** (Approach A). Backend keeps its remap/fallback
  logic as defense in depth for old workflows.

## Architecture

### 1. Data — `supportsSeed` flag (`frontend/app/data/video-models.ts`)

Add `supportsSeed: boolean` to `VideoModel`. Source of truth: which Python
builders in `comfy_api_nodes/video_models.py` set a seed. Audit 2026-06-10:
every builder calls `_maybe_set_seed` EXCEPT `_b_kling_v2_5_turbo_pro` and
`_b_fabric_1_0`. So `supportsSeed: false` for `kling-v2.5-turbo-pro` and
`fabric-1.0`, `true` for the other 14. Comment each `false` with the reason.
Keep flag and builder in sync when adding models (note this in both files'
header comments).

### 2. Pure adaptation lib — `frontend/app/lib/videoModelAdapt.ts`

All functions keyed on a model id via `VIDEO_MODELS_BY_ID`; unknown/empty model
id → permissive defaults (everything visible, no filtering) so stale workflows
never lose widgets.

- `modelSupportsSeed(modelId: string): boolean` — registry flag, default true.
- `allowedDurations(modelId: string): string[] | null` — the model's
  `durations` as STRINGS (combo values are strings, e.g. `'5'`); null when
  model unknown (= no filtering).
- `allowedAspectRatios(modelId: string): string[] | null` — same pattern.
- `snapWidgetsToModel(widgetDefs, widgetsValues, modelId): {name, value}[]` —
  corrections for `duration` / `aspect_ratio` values invalid under the new
  model. Duration snaps to the model's `defaultDuration` (fall back to first
  allowed); aspect snaps to first allowed (registry order puts the model's
  preferred ratio first). Returns an empty array when everything is valid.
  Never touches other widgets; never changes array positions.

### 3. Seed visibility — extend `WIDGET_VISIBILITY` (`ComfyNode.vue`)

Add `FilmShotNode` and `GenerateVideoNode` rules: widgets `seed` and
`seed_control` are visible iff `modelSupportsSeed(currentModel)`, where
currentModel is read from `widgetsValues` at the `model` widget's index (the
registry's existing rule signature `(name, widgetsValues, widgetDefs)` already
provides both). All other widgets visible.

Note: `seed_control` is the hidden positional companion (control_after_generate)
— it's already `hidden: true` in widgetDefs, so listing it is belt-and-braces;
the positional VALUE slots are untouched either way (visibility is render-only).

### 4. Option filtering — new `WIDGET_OPTIONS` registry (`ComfyNode.vue`)

Same shape and placement as `WIDGET_VISIBILITY`:

```ts
const WIDGET_OPTIONS: Record<string,
  (name: string, values: any[], defs: any[]) => string[] | null> = { ... }
```

Rules for both nodes: `duration` → `allowedDurations(model)`, `aspect_ratio` →
`allowedAspectRatios(model)`; anything else → null. ComfyNode resolves the
filtered list and passes it to `ComfyNodeWidget` (e.g. an `optionsOverride`
prop, or by shallow-cloning the widget def with replaced `options` — pick
whichever is cleaner against the existing prop flow; the def object in
`node.data.widgetDefs` must NOT be mutated). Important: the filtered list is
intersected with the schema's options (never introduce values the backend combo
would reject), and if the intersection is empty fall back to schema options.

### 5. Snap on model change — `VideoModelGalleryModal.vue`

The model value is written in exactly one place (the video gallery modal's
confirm path). After writing the model id, call `snapWidgetsToModel` and apply
each correction to `widgetsValues` using the same direct-mutation idiom. The
visible result: switch Veo (8s) → Kling (5/10) and duration snaps from '8' to
'5' instead of holding an invalid value.

(If a second write path exists — e.g. legacy label remap on load — it is
backend-side and harmless: the backend remaps invalid values at dispatch
anyway.)

### 6. Testing (vitest)

`frontend/tests/unit/video-model-adapt.unit.spec.ts`:
- registry completeness: every model has a boolean `supportsSeed`;
- flags match the audit (false exactly for kling-v2.5-turbo-pro, fabric-1.0);
- `allowedDurations('veo-3.1')` → `['8']`; `allowedAspectRatios` for a
  representative model matches the registry; unknown id → null;
- `snapWidgetsToModel`: corrects duration '8' → Kling default; leaves valid
  values alone; returns [] when nothing to fix; empty/unknown model → [].

No Python changes, no pytest changes.

## Out of scope

- Port (image/audio) adaptation per model.
- Per-model ADVANCED settings (already handled by the gallery's options bag).
- Backend dynamic schemas.
