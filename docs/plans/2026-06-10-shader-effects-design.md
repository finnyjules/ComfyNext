# Shader Effects — Unicorn Studio-style shader nodes

**Date:** 2026-06-10
**Status:** v1 implemented (feat/shader-effects, 2026-06-10) — 14 effects, parity-verified

## Goal

Reproduce Unicorn Studio's shader effects as first-class ComfyNext nodes: a live,
animated, 60fps WebGL preview in the node body (tweak params in real time, no server
round-trip), and the *same* GLSL executed server-side on Run to produce real
IMAGE/frame-batch outputs for the rest of the graph. Local GPU only — zero credits.

This supersedes the May "GLSL" node push (`comfy_extras/nodes_glsl_*.py`), which is
actually 38 torch-based static nodes previewed by re-running the server per slider
drag. Those nodes stay untouched and shipped; this system replaces them functionally
and we deprecate overlapping ones later.

## Architecture: GLSL-first, dual runtime, shared catalog

Each effect is written **once** as a GLSL ES 3.00 fragment shader. Two runtimes
execute the identical source:

- **Browser (preview):** WebGL2 canvas inside the node's Vue body.
- **Server (output):** the proven OpenGL machinery in `comfy_extras/nodes_glsl.py`
  (PyOpenGL + glfw, used in production by the 13 GLSL blueprints), refactored to
  expose a reusable `render_shader()` helper.

Parity between the two is enforced by golden-frame tests (see Testing).

### The catalog (single source of truth)

New directory `shader_effects/` at repo root (server-side):

```
shader_effects/
  manifest.json          # one entry per effect
  liquify.frag
  halftone.frag
  ...
  assets/glyph_atlas.png # shared glyph atlas for ASCII / Glyph Dither
```

Manifest entry per effect:

- `id`, `displayName`, `category` (`distortion` | `stylize` | …)
- `params[]`: `{ uniform, label, type, min, max, default, step }`
- `animated`: whether the effect uses `u_time`
- `passes`: number of render passes. **v1 is always 1**, but the field exists now so
  multi-pass effects (bloom, blur) don't force a schema migration later.
- `centerParam` (optional): names the param pair that is a spatial center point,
  enabling the draggable handle on the preview canvas.
- `textures[]` (optional): catalog assets to bind (e.g. glyph atlas).

**Standard uniforms:** `u_image0` (sampler2D), `u_resolution` (vec2), `u_time`
(float, seconds), `u_seed` (float), plus `u_<param>` per manifest.

**Unit convention (mandatory):** all spatial params are resolution-independent —
fractions of image height or UV space, never raw pixels. The preview canvas renders
at ~300px while the server renders at full resolution; pixel-unit params would make
the run output visibly different from the preview. Enforced in shader review and by
the golden tests running at two resolutions.

The ComfyUI server exposes `GET /comfynext/shader_effects` (manifest) and
`GET /comfynext/shader_effects/{file}` (shader sources, texture assets). The Nuxt frontend fetches
from it at runtime — no copies in the frontend bundle, so browser preview and server
render can never drift to different sources.

### The node (backend)

One node, `ShaderEffect`, category `image/effects`:

| Input | Type | Notes |
|---|---|---|
| `image` | IMAGE | single frame or batch |
| `effect` | COMBO | populated from manifest |
| `params` | STRING (JSON) | written by the Vue body; hidden from default widget UI |
| `time` | FLOAT | time offset for static output |
| `duration` | FLOAT | `0` = single frame (default) |
| `fps` | INT | frame pacing for animated output and batch input |
| `seed` | INT | drives `u_seed` |

Output: IMAGE (frame batch when animated), ready for SaveVideo / Timeline.

**Animation semantics:**
- Still input + `duration == 0` → one frame at `u_time = time`.
- Still input + `duration > 0` → `duration × fps` frames, `u_time` advancing.
- **Batch input → `u_time` advances per input frame at `fps`; `duration` is ignored.**

Execution loads the `.frag` from the catalog, binds uniforms from `params` JSON, and
renders via `render_shader()`. Shader compile errors surface as normal node errors
with the GL info log attached.

### The Vue body (the Unicorn feel)

Custom node component registered via `ARTIFACT_NODE_COMPONENTS` /
`VueNodeCanvas.vue` `:node-types` (same pattern as `PoseMannequinNode`):

- **WebGL2 preview canvas** running the actual shader, animated, with play/pause.
- **Effect gallery picker** — modal in the Film-a-Shot pattern, grouped by family.
  Thumbnails are rendered sequentially by one shared thumbnail context (not one
  context each).
- **Param sliders generated from the manifest**, bound directly to uniforms — fully
  live, no server round-trip. Slider changes also write the `params` JSON widget so
  the graph serializes/executes correctly.
- **Input texture:** the upstream node's preview image (the `ArtifactFrameNode`
  wired-image pattern). Placeholder gradient when nothing is connected.
- **Draggable center handle** on the canvas for effects with `centerParam`.
- No `live_preview_*.png` loop: the canvas *is* the preview; the server renders only
  on actual Run.

**Animation budget / context limit (mandatory):** browsers cap WebGL contexts at
~8–16 per page, and N simultaneous rAF loops burn GPU/battery. Rule: **only the
selected (or hovered) ShaderEffect node animates; all others display their last
rendered frame as a static image and release their GL context.** A node acquires a
context on select/hover, renders, and on deselect captures a final frame to an
`ImageBitmap`/data URL and frees the context. This also matches Unicorn's own
behavior (one scene animating at a time).

**Chained previews (in scope for v1):** stacking effects is core to the Unicorn
look, and chaining ShaderEffect nodes is how you stack. If a ShaderEffect's upstream
is another ShaderEffect with no executed output, the preview walks the upstream
chain (until it hits a real image or the chain ends) and renders each shader as a
pass in its own loop — so each node's canvas shows the stack up to and including
itself, animating on a shared clock. The most-downstream node is the "full scene"
view.

**Downstream refresh:** when params change on any ShaderEffect, every downstream
ShaderEffect in the chain re-renders **one frame** via the shared offscreen context
and updates its frozen preview. Tweaking an upstream effect therefore never leaves a
stale composite downstream: the node being touched runs the live 60fps loop, and the
rest of the chain follows with near-live single-frame updates — without violating
the one-animating-context rule.

### Mouse interactivity

Unicorn's cursor-reactive effects (mouse trails, cursor-centered distortion) have no
meaning in a rendered IMAGE. v1 compromise:

- Effects with a spatial center get the draggable handle (covers cursor-centered
  pinch/ripple "feel" at authoring time).
- Mouse-trail-style effects are **explicitly out of scope** until there's a decision
  on what they bake to (e.g. a recorded/procedural path). Not in the v1 catalog.

## v1 effect list (14)

**Distortion:** Liquify, Water Ripple, Wave, Pinch/Bulge, Noise Distortion, Swirl.
**Stylize:** ASCII Dither, Glyph Dither, Halftone, Pixelate, Mondrian, Blocks,
Recursive Grid, Outline (Sobel).

All single-pass. ASCII/Glyph Dither share the glyph-atlas texture asset. After v1,
adding an effect = one `.frag` + one manifest entry + one golden test.

## Risk to retire first (spike)

Browser WebGL2 on macOS runs through ANGLE→Metal; the server uses native OpenGL.
Noise-heavy shaders may diverge beyond the blend-mode tolerance. **Implementation
step 1 is a two-effect spike** (one noise-heavy, e.g. Noise Distortion; one
deterministic, e.g. Halftone) through both pipelines to calibrate tolerance — before
writing the other 12 shaders. The spike also smoke-tests that the PyOpenGL/glfw path
renders headless on this machine (blueprints imply yes; verify, it's load-bearing).

## Testing

- **Golden-frame parity:** extend the existing Playwright golden harness. For each
  effect: headless WebGL2 render at fixed `time`/`seed`/params vs server render,
  compared within the calibrated tolerance (recalibrated by the spike), at **two
  resolutions** (also validates the unit convention).
- **Server unit tests:** manifest schema validation; `render_shader()` happy path +
  compile-error path; animation semantics (still+duration, batch input).
- **Frontend:** params JSON round-trip (slider → widget → execution), context
  acquire/release on select/deselect.

## Error handling

- Missing OpenGL deps → existing `_check_opengl_availability` message.
- Shader compile failure → node error with GL info log.
- WebGL2 unavailable in browser → static placeholder + note; node still executes
  server-side.
- Unknown effect id / malformed params JSON → node error naming the effect.

## Explicitly out of scope (v1)

- Generative background effects (aurora, nebula, fluid…) — next family; the
  catalog/node design already accommodates input-less effects.
- Color/utility ports of the 13 existing blueprints.
- Multi-pass effects (bloom, blur) — manifest field reserved.
- Mouse-trail effects and scroll/hover event reactivity.
- Deprecating the 38 torch nodes — revisit after v1 ships.
