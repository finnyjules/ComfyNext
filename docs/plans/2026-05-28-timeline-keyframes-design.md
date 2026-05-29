# Timeline keyframes — design

Animate per-clip transforms (x, y, rotation, scale, opacity) over time — pans,
zooms, moving overlays, Ken-Burns. Today clips have only **static** transforms.

## Data model

Extend `BaseClip` ([frontend/shared/timeline/types.ts:29](../../frontend/shared/timeline/types.ts#L29)):

```ts
interface Keyframe {
  frame: number              // clip-local frame index
  x: number; y: number; rotation: number; scale: number; opacity: number
  ease?: 'linear' | 'easeInOut'   // segment leaving this keyframe
}
// on BaseClip:
keyframes?: Keyframe[]       // sorted by frame; present ⇒ animated, absent ⇒ static scalars
```

Each keyframe is a **full transform snapshot** (simplest model; per-property
tracks are a v2). Round-trips inside `edit_state` (already persisted to
`node.data.properties` and versioned by `useTimelineStore`).

## One shared interpolation

`interpolateClipAt(clip, localFrame) → {x,y,rotation,scale,opacity}`:
- no keyframes → return the static scalars (back-compat),
- else lerp between the bracketing keyframes (clamp before first / after last),
  with `ease` applied to the segment `t`.

Mirrored in **JS** (preview) and **Python** (export) — the same way the blend
modes are already duplicated across both.

## Render sites — the architecture point

Transforms are applied per-frame in **four** places, on **two data paths**:

| Path | Site | Sees `edit_state`? | v1? |
|---|---|---|---|
| edit_state | editor playback — `usePlaybackEngine.ts:173` | ✅ | **yes** |
| edit_state | FFmpeg export — `nodes_timeline.py:466` (`render_timeline_to_file`) | ✅ (via `_adapt_edit_state`) | **yes** |
| flat widget | node-body preview — `TimelineNodePreview.vue` | ❌ reads `clip{i}_*` | no |
| flat widget | backend `execute()` — `nodes_timeline.py:156` | ❌ reads `clip{i}_*` | no |

The flat-widget paths can't express a keyframe *list*, and **already don't
reflect editor edits** (the editor only writes `edit_state`, not the flat
widgets — a pre-existing disconnect). So v1 keyframes land where you actually
**create and render** the animation: the **editor preview + the export**.
Making the node-body preview / node-run animate needs a separate
flat-widget→`edit_state` refactor — flagged, not bundled.

## Editor UI (minimal v1)

- A **keyframe lane** under the selected clip: diamonds at keyframe frames.
- **Add keyframe** at the playhead captures the clip's current transform;
  **auto-keyframe** when a transform is changed while the playhead is on/at a
  keyframe.
- Drag diamonds to retime · click to select · delete.
- Easing: `linear` + `easeInOut` for v1; curve editor later.

## Scope cuts (v1)

- Full-snapshot keyframes (not per-property tracks).
- Editor preview + export only (node-body preview / `execute()` deferred).
- Animatable props = x / y / rotation / scale / opacity (fade & volume keep
  their existing ramps).

## Files

**New**
- `frontend/shared/timeline/interpolate.ts` — `interpolateClipAt` + easing
- `comfy_extras/_timeline_interp.py` (or inline) — Python mirror

**Modified**
- `frontend/shared/timeline/types.ts` — `Keyframe` type + `keyframes` field
- `frontend/app/composables/useTimelineStore.ts` — keyframe mutations + undo
- `frontend/app/components/vue-canvas/TimelineEditor.vue` — keyframe lane UI
- `frontend/app/composables/usePlaybackEngine.ts` — interpolate in `drawFrame`
- `comfy_extras/nodes_timeline.py` — interpolate in `render_timeline_to_file`;
  pass `keyframes` through `_adapt_edit_state`

## Open decision

**Render coverage:** editor preview + export (v1) — or also the node-body
preview + `execute()` (bigger; entails the flat-widget→`edit_state` refactor).
