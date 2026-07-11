# Rotate camera — design

A new generator node, **"Rotate camera"**, purpose-built around
`qwen/qwen-image-edit-plus`. The point of the node: change the viewing angle
of any subject in an image via a tactile 3-axis gimbal widget, with no
text-prompt input. The widget IS the prompt.

This sits next to (not inside) the existing "Generate an image" / "Edit an
image" nodes — its UX is specific enough to deserve its own surface.

## Node shape

| Field | Type | Notes |
|---|---|---|
| `image` | IMAGE (req.) | The source image. |
| `camera` | hidden JSON string | `{"yaw":N,"pitch":N,"roll":N}` — edited via the gimbal widget. |
| `seed` | INT | 0 = random. |
| **output** | IMAGE | Qwen's render of the requested view. |

Backend: `RotateCameraNode` in `comfy_api_nodes/nodes_replicate.py`. Per-model
dispatch lives in a new `comfy_api_nodes/image_edit_models.py` (just Qwen for
now, structured so Nano Banana / Seedream-Edit can drop in later).

## The gimbal widget

`frontend/app/components/vue-canvas/widgets/WidgetCameraGimbal.vue`.
Activated by `extra_dict={"sailor_widget": "camera_gimbal"}` on the
`camera` input — same routing pattern as `model_picker`.

**Visual** — SVG, ~240×240px:
- Three rings: red (X / pitch), green (Y / yaw), blue (Z / roll)
- Each ring drawn with isometric projection so it reads as 3D
- Each ring carries a draggable hexagonal handle
- Three axis arrows from origin show the current basis vectors
- Back-half of each ring dims to give 3D depth cues
- Live phrase caption underneath: *"viewed from the right side at eye level"*

**Interaction:**
- Drag a handle → updates that one axis
- Drag the sphere body → free orbit (yaw + pitch together)
- Shift+drag → snap to 15° increments
- Double-click center → reset to (0, 0, 0)

**State:** JSON string in `widgetsValues`, round-trips with the workflow
file like any other widget value.

## Prompt mapping

Single Python function `_camera_to_phrase(yaw, pitch, roll) -> str`. The
template:

```
viewed from {yaw_phrase}{, pitch_phrase}{, roll_clause}
```

Buckets:

- **Yaw** (-180..+180): front · front-right · right side · back-right ·
  directly behind · back-left · left side · front-left
- **Pitch** (-90..+90): eye level · a slight high angle · a high angle ·
  nearly top-down · (mirror for negative) slight low angle · low angle ·
  nearly worm's-eye
- **Roll** (-180..+180): omitted if |roll| < 5° · "with the camera tilted
  slightly clockwise / counter-clockwise" · "with a heavy Dutch tilt..."

Pitch and roll fragments are omitted when they're at the no-op value, so
*"front view"* stays terse when the user only changed yaw.

## Edge cases & scope cuts

**In scope:** single-subject images, full 360° in all three axes, arbitrary
combinations of yaw/pitch/roll.

**Out of scope for v1:**
- Multi-subject images (prompt phrasing assumes "the subject")
- Zoom / focal length / dolly
- Saving custom angle presets (built-in presets via right-click menu only)
- Refactoring `EditImageNode` to a dispatcher — separate concern

**Failure mode:** "impossible" views (back of a flat poster, undersides of
objects only seen from above) — we still send the prompt; Qwen does its
best; feedback is the rendered output.

## Files

**New:**
- `frontend/app/components/vue-canvas/widgets/WidgetCameraGimbal.vue`
- `comfy_api_nodes/image_edit_models.py`

**Modified:**
- `frontend/app/components/vue-canvas/ComfyNodeWidget.vue` — route new widget
- `comfy_api_nodes/nodes_replicate.py` — add `RotateCameraNode`

## Implementation notes

- Skipping `writing-plans` step per user request — design is self-contained
  and the file list above scopes the work to ~4 touchpoints
- 3D math kept inline in the widget (minimal: 3×3 rotation matrices,
  matrix-multiply, project to 2D). No new deps.
- Rotation order: extrinsic XYZ (yaw → pitch → roll applied in world space).
  Matches what users expect from a Blender-style gimbal.
