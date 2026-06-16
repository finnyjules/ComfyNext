# Shader Studio — design

**Date:** 2026-06-16
**Branch:** `feat/gradient-studio` (continue here — Shader Studio is the next studio in the same suite; a dedicated `feat/shader-studio` branch may be cut at implementation time)
**Comp:** Morflax Studio (morflax.com/studio) — drop an image, apply a stacked shader pipeline, export still/video.

## Goal

A **Shader Studio** node in the same vein as Type Studio and Gradient Studio: a
frontend-only "studio" that **accepts an input image and applies a stacked shader
pipeline** — a stylized effect, a duotone, a colour-grade, and post-processing —
then bakes the result to a still or a looping video.

Unlike Gradient Studio (generative, no input) this studio is **input-driven**. It
reuses the already-merged `shaderfx` effect engine and the Space Type bake rails;
the only genuinely new rendering work is four GLSL fragments and the studio shell.

## Decisions (locked during brainstorming)

1. **Input source — Both.** Accept a wired image input when connected; otherwise an
   in-studio upload / Asset picker. Wired wins when present.
2. **Scope — Full stack.** Stylized Effects + Duotone + Adjustments + Post-processing
   (lens blur + chromatic aberration) + Animation.
3. **Animation — time-driven loop.** Reuse the Gradient Studio / Space Type motion
   model: deterministic `t01 = frame/frameCount`, params oscillate over a fixed loop
   duration, baked frame-by-frame to a seamless-loop video. No keyframe-lane editor
   (that is an explicit v2 follow-up).
4. **Per-effect colour — Duotone as a studio-level pass.** Keep the existing 33
   shaderfx effects as-is (float params). Add one studio-level **Duotone** section
   (Ink/Paper colours + preset swatch grid) as its own pass after the stylized
   effect, instead of reworking every effect's GLSL/schema.

## Architecture

Mirrors Gradient Studio ([[project_gradient_studio]]) exactly:

- A **frontend-only node** — no backend `class_type`, never executes. Config persisted
  at `node.data.properties.comfynext_shaderStudio`.
- A **live-preview card** (`ShaderStudioNode.vue`) + a **full-screen surface editor**
  (`ShaderStudioSurface.vue`) that bakes its own outputs.
- The **one structural difference** from the other two studios: the node has an
  **input handle** (target, left) because it consumes an image — not just an output
  handle.

### Rendering pipeline

Everything composes into a single `ShaderPass[]` array fed to the existing
`shaderFx` singleton renderer (`app/lib/shaderfx/renderer.ts`), which already supports
an arbitrary pass list with multi-pass ping-pong over a base image. Panel order =
processing order (Morflax order):

```
input image
  → [Stylized Effect]   reuse existing shaderfx effect passes (incl. multi-pass: bloom/glow/etc.)
  → [Duotone]            NEW pass — map luminance → Ink/Paper gradient (+ presets)
  → [Adjustments]        NEW pass — exposure/brightness/contrast/saturation/hue/temperature/tint
  → [Lens Blur]          NEW pass — disc blur weighted by distance from a draggable focus point
  → [Chromatic]          NEW pass — radial R/G/B channel offset
  → canvas
```

Each section has an **enable (eye) toggle**; a disabled section is omitted from the
pass list (no-op, zero cost). The renderer is reused unchanged — the only new GLSL is
the four fragments above.

### Engine — `frontend/app/lib/shaderstudio/`

Parallels `app/lib/gradientfx/`:

- **`types.ts`** — `ShaderStudioConfig`:
  ```
  {
    source:  { kind: 'wired' | 'upload' | 'asset', dataUrl?, assetId?, naturalW?, naturalH? },
    canvas:  { aspect, resolution },
    effect:  { id, params: Record<string,number>, enabled },
    duotone: { enabled, ink, paper, preset? },
    adjust:  { enabled, exposure, brightness, contrast, saturation, hue, temperature, tint, preset? },
    post:    {
      blur:      { enabled, focus: {x,y}, range, aperture, maxBlur },
      chromatic: { enabled, amount }
    },
    motion:  { duration, fps, tracks: MotionTrack[] }   // reuse gradientfx motion shape
  }
  ```
- **`glsl.ts`** — the four new GLSL ES 3.00 fragment sources (duotone, adjust, lensBlur,
  chromatic), each conforming to the renderer contract (`uniform sampler2D u_image0`,
  `uniform vec2 u_resolution`, `in vec2 v_texCoord`, `layout(location=0) out vec4 fragColor0`).
  Lens blur = single-pass disc/poisson tap blur whose radius scales with distance from
  `focus` (sharp at focus, up to `maxBlur` past `range`, shaped by `aperture`). This is a
  **2D focus-point blur, not a depth-based DoF** (the depth-based version is the separate
  Lens/DoF node [[project_lens_dof_node]] and is out of scope here).
- **`passes.ts`** — `composePasses(config, effectDef, t01)` → `ShaderPass[]`. Builds the
  stylized effect's passes (same logic the ShaderEffect node uses — `expandPasses` for
  multi-pass, `centerParam`/textures honoured), then appends the enabled duotone / adjust /
  blur / chromatic passes with their uniforms resolved (colours → vec3 uniforms split into
  `*_r/_g/_b` floats, since the renderer's uniform path is `uniform1f`-only).
- **`motion.ts`** — reuse the Gradient Studio track model: a `MotionTrack` oscillates any
  numeric studio param (an effect param, an adjustment, the focus x/y, chromatic amount)
  over the loop. `evalConfig(config, t01)` returns a config snapshot for that frame;
  seamless loop via integer cycle counts. Deterministic, no wall clock.
- **`presets.ts`** — duotone colour presets (the swatch grid) + adjustment presets ("Punchy",
  etc.). Pure data.

### Source (input) resolution — "Both"

- **Wired:** when an image output is connected to the input handle, resolve the upstream
  node's latest output image URL at editor-open time, reusing the ShaderEffect chain
  resolution (`app/lib/shaderfx/chain.ts`). The resolved URL is loaded into an
  `HTMLImageElement` / `ImageBitmap` and used as the renderer base.
- **In-studio:** an upload control (file → data URL) and an Asset picker store the chosen
  image in `config.source`. Used when nothing is wired.
- **Precedence:** wired input wins when connected; otherwise the in-studio source is used.
  If neither is present the preview shows an empty-state prompt to add a source.

### UI — `ShaderStudioNode.vue` + `ShaderStudioSurface.vue`

- **Node card** — mirrors `GradientStudioNode.vue`: header (Sparkles + "Shader Studio"),
  live preview canvas (input composed through the saved config; animates only when the
  config has motion tracks), an "Edit" button (dispatches `comfynext:openShaderStudio`),
  an **input handle** (target, left) and an output handle (source, right, emerald).
- **Surface** — `StudioModalShell`: preview canvas + a draggable focus-point pad overlay on
  the left, actions footer ("Add as image" / "Add as video"), and a controls column of
  collapsible `StudioSection`s on the right, each with an eye/enable toggle in its `#badge`
  slot:
  - **Source** — upload / pick Asset / "(wired)" indicator
  - **Stylized Effects** — gallery picker over the shaderfx catalog (rendered thumbnails,
    as the ShaderEffect node already does) + the selected effect's float params
  - **Duotone** — Ink / Paper colour swatches + preset grid + swap
  - **Adjustments** — exposure/brightness/contrast/saturation/hue/temperature/tint sliders + presets
  - **Post-processing** — Lens Blur (focus pad, focus range, aperture, max blur) + Chromatic (amount)
  - **Canvas** — aspect + resolution
  - **Motion** — loop duration, fps, add/remove oscillation tracks
- Live preview re-renders on config change (debounced) and animates over the loop when motion
  tracks exist.

### Wiring (identical pattern to Gradient Studio)

- `ARTIFACT_NODE_COMPONENTS`: `ShaderStudio: 'shader-studio'`
- VueNodeCanvas node-types map + wildcard-output case
- Events `comfynext:openShaderStudio` / `comfynext:shaderStudioOutput` (output reuses
  `handleSpaceTypeOutput`)
- `default.vue` Add menu: a "Shader" entry (`special: 'shader-studio'`)

### Output / bake rails (no Python changes)

Reuse the Space Type rails, as Gradient Studio does:
- **Still:** `uploadFrameBatch` → recorded as a project asset (asset recording for these
  studios is already wired, commit `1e88e005f`).
- **Video:** `ensureSpaceTypeBake` → `/comfynext/spacetype_encode`
  (`comfy_extras/nodes_timeline.py`).
- Bake iterates `frame = 0..frameCount-1`, computes `t01`, `evalConfig(config,t01)`,
  `composePasses(...)`, `shaderFx.render(passes, base, w, h)`, reads the canvas PNG.

## Components & responsibilities

| Unit | Does | Depends on |
|------|------|-----------|
| `shaderstudio/types.ts` | Config shape + aspect helper | — |
| `shaderstudio/glsl.ts` | 4 fragment sources (duotone/adjust/lensBlur/chromatic) | renderer contract |
| `shaderstudio/passes.ts` | Compose config → `ShaderPass[]` | shaderfx catalog/types, glsl.ts |
| `shaderstudio/motion.ts` | Oscillate params over the loop; `evalConfig` | types.ts |
| `shaderstudio/presets.ts` | Duotone + adjustment presets (data) | types.ts |
| `ShaderStudioNode.vue` | Card + live preview + handles + Edit | shaderFx, passes, motion |
| `ShaderStudioSurface.vue` | Full editor + bake actions | StudioModalShell/Section, passes, motion, bake rails |
| wiring (canvas/menu/events) | Mount node, open editor, route output | existing studio plumbing |

## Testing

Follows the Gradient Studio / Space Type approach (Vitest, `environment: 'node'`; no
@vue/test-utils):

- **Unit (pure, deterministic):**
  - `passes.ts` — disabled sections omitted; pass order correct; multi-pass effect expanded;
    colour uniforms split to `_r/_g/_b`; uniforms resolved from config.
  - `motion.ts` — `evalConfig` deterministic for given `t01`; seamless loop (eval at t01=0 ==
    t01=1 for integer cycles); tracks target the right params.
  - `presets.ts` — presets apply expected values.
- **WebGL render harness (headless Chromium, esbuild-bundled engine):** each new fragment
  compiles and renders without GLSL errors over a fixture image; the full composed pipeline
  (effect + duotone + adjust + blur + chromatic) produces a non-empty frame; duotone maps a
  grey ramp to the Ink↔Paper gradient; lens blur sharpens at the focus point and blurs past
  range. (This is the route that caught the Gradient Studio backtick-in-GLSL bug.)
- **In-app verify (PENDING, like the sibling studios):** node mount, surface open, wired +
  uploaded source, each section's live effect, image + video round-trip. Gated by the same
  preview-browser limitation noted for Gradient Studio.

## Risks / open items

- **Wired-input resolution** is the one integration unknown — it depends on how reliably
  `chain.ts` exposes the upstream node's latest output URL at open time. The in-studio
  upload/Asset path is the fallback that always works, so the feature ships even if wired
  resolution needs follow-up.
- **GLSL backtick gotcha** (from Gradient Studio): a backtick inside a shader comment
  silently terminates the JS template literal. Keep shader sources clean / esbuild-verify.
- **Renderer uniform path is `uniform1f`-only** — colours and vec params must be split into
  scalar `_r/_g/_b` (or `_x/_y`) uniforms in both `passes.ts` and the GLSL.
- **Generative effects** (aurora/nebula/etc., `generative:true`) ignore the input; v1 either
  hides them from the picker or treats them as a source replacement. Default: hide them
  (Shader Studio is input-driven) — revisit in v2.

## Explicit non-goals (v2+)

- Keyframe-lane animation editor (v1 = time-driven oscillation loop).
- Depth-based DoF (that is the separate Lens/DoF node).
- Per-effect colour/enum param schema (duotone covers the screenshot's headline case).
- Stacking multiple stylized effects (v1 = one selected effect).
