# Dither with patterns — design

**Date:** 2026-06-16
**Base branch:** `feat/gradient-studio` (where Shader Studio + the Duotone pass live; `bayer_dither` itself is also on `main`)
**Comp:** Morflax Studio's "Dither" stylized effect — a Pattern dropdown of 12 ordered/noise dither matrices, paired with a Duotone color mode.

## Goal

Evolve the single-pattern `bayer_dither` shaderfx effect into a Morflax-style **Dither**
effect with a **12-entry pattern dropdown**, available everywhere shaderfx effects are
surfaced (Shader Studio's Stylized Effects section **and** the standalone ShaderEffect
graph node). Reuse the existing studio **Duotone pass** for the "Color Mode: Duotone" look.

This requires a one-time, additive **enum param** capability in the shaderfx schema (the
existing schema is float-only), which future effects can also use.

## Decisions (locked during brainstorming)

1. **First-class shaderfx effect**, not a studio-only pass — so the pattern menu shows in
   the effect picker and benefits the standalone ShaderEffect node too. This entails enum
   param support in the schema.
2. **All 12 patterns, faithful to Morflax:** Coarse 2×2, Bayer 4×4, Fine 8×8, Clustered,
   Scanline, Diagonal, White Noise, Noise 2×, Blue Noise, Blue Noise 2×, Blue Noise 0.5×,
   R2 Noise. The ×N noise scales are baked into their pattern branches (no separate scale
   slider).
3. **Real baked blue-noise texture** (void-and-cluster), not a procedural approximation.

## Architecture

### 1. The Dither shader — `shader_effects/bayer_dither.frag` (rewritten)

Keeps the current uniforms `u_scale` (Size — dither cell/downsample), `u_levels`
(quantization levels), `u_colored` (mono vs per-channel). Adds `u_pattern` (0–11). Adds a
sampler `u_blueNoise`.

A `float dither_threshold(ivec2 pc, int pattern)` returns a threshold in [0,1):
- **0 Coarse 2×2 / 1 Bayer 4×4 / 2 Fine 8×8** — the three classic ordered Bayer matrices
  (`(value + 0.5) / N²`). Default = 1 (preserves the current effect's look).
- **3 Clustered** — clustered-dot 8×8 threshold matrix.
- **4 Scanline** — horizontal line threshold (period from `u_scale`).
- **5 Diagonal** — diagonal line threshold.
- **6 White Noise** — `hash(pc)` per pixel; **7 Noise 2×** — `hash(pc/2)` (coarser grain).
- **8 Blue Noise / 9 Blue Noise 2× / 10 Blue Noise 0.5×** —
  `texelFetch(u_blueNoise, (pc / scale) % texSize, 0).r` with scale 1 / 2 / 0.5
  (exact per-pixel, wrap-independent; sidesteps the renderer's CLAMP_TO_EDGE on extra textures).
- **11 R2 Noise** — Martin Roberts' R2 low-discrepancy sequence:
  `fract(pc.x*0.7548776662 + pc.y*0.5698402910)`.

The downsample (`u_scale` cell), the level quantization, and the mono/colored branch are
unchanged from the current shader; only the threshold source becomes pattern-selectable.
`u_pattern` arrives as a float; cast `int(u_pattern + 0.5)`.

GLSL note: the renderer auto-declares `u_image0`/`u_source`/`u_resolution` and binds extra
textures (declared in the manifest) on units 2+. Keep the renderer-contract header
(`#version 300 es`, `fragColor0`, etc.). No backtick characters in comments.

### 2. Blue-noise asset

- **`shader_effects/bake_blue_noise.py`** (committed, run once): void-and-cluster using
  `scipy.ndimage.gaussian_filter(..., mode='wrap')` (scipy 1.17.1 is present) to produce a
  **tileable 64×64** blue-noise tile; write the rank/threshold into all of R,G,B of
  `shader_effects/assets/blue_noise.png` (8-bit). Deterministic seed so re-runs are stable.
- Declared in the manifest: `"textures": [{ "uniform": "u_blueNoise", "file": "blue_noise.png" }]`.
  This auto-loads server-side via `_load_effect_textures` (`PILImage.open(...).convert("RGBA")`)
  and browser-side via `assetUrl('blue_noise.png')` → `/sailor/shader_effects/assets/...`,
  exactly like `ascii_dither`'s glyph atlas.
- The texture is bound for **every** `bayer_dither` render (NEAREST, units 2+) regardless of
  pattern; non-blue patterns simply don't sample it, so output stays deterministic.

### 3. Enum param support (additive, four spots)

The schema is float-only today. Add an `enum` param type:

- **`frontend/app/lib/shaderfx/types.ts`** — `EffectParamDef.type: 'float' | 'enum'`; add
  optional `options?: { label: string; value: number }[]`. `min/max/step` stay required for
  floats; for enums they may be omitted (make them optional in the type).
- **`comfy_extras/_shader_effects.py`** — `EffectParam` dataclass: `type` may be `'enum'`,
  with an `options` list; make `min/max/step` optional/defaulted for enums. The
  `min <= default <= max` validation in `load_catalog` applies only to floats; for enums
  validate `default ∈ {option values}`. `resolve_params`: for an enum, snap the user value to
  the nearest valid option value, else use `default` (floats unchanged: clamp to [min,max]).
- **`frontend/app/lib/shaderfx/params.ts`** — `resolveUniforms`: for an enum param, resolve to
  the chosen option value if valid, else `default` (returns a float uniform, as today).
  `serializeParams`: store non-default as it already does.
- **UIs** — the param loop in BOTH `frontend/app/components/vue-canvas/ShaderEffectNode.vue`
  and `frontend/app/components/vue-canvas/ShaderStudioSurface.vue`: when `p.type === 'enum'`
  render a `<select>` of `p.options` (value-bound, calls the existing `setParam`); otherwise the
  existing range slider. Keep styling consistent with each surface (no purple accents).

### 4. Manifest entry (`shader_effects/manifest.json`)

Update the `bayer_dither` entry: `name` → `"Dither"`; add the `u_blueNoise` texture; add the
`u_pattern` enum param (default 1) with the 12 options; keep `u_scale`/`u_levels`/`u_colored`.
Keep the **id `bayer_dither`** (back-compat with saved graphs + golden filenames).

## Components & responsibilities

| Unit | Change | Depends on |
|------|--------|-----------|
| `bayer_dither.frag` | 12-pattern threshold + blue-noise sampler | renderer contract |
| `bake_blue_noise.py` | offline void-and-cluster → blue_noise.png | numpy, scipy |
| `manifest.json` (bayer_dither) | name, texture, enum pattern param | enum schema |
| `_shader_effects.py` | enum in EffectParam + resolve_params | — |
| `shaderfx/types.ts` | enum in EffectParamDef | — |
| `shaderfx/params.ts` | enum in resolveUniforms | types.ts |
| `ShaderEffectNode.vue` / `ShaderStudioSurface.vue` | `<select>` for enum params | params/types |

## Testing

- **Python unit** (`tests-unit/`): `resolve_params` snaps enum values (valid → kept; invalid →
  default; float params still clamp). `load_catalog` accepts the enum param + validates the
  default is a valid option.
- **Frontend unit** (`frontend/tests/unit/shaderfx-params.unit.spec.ts`, extend): `resolveUniforms`
  resolves enum to option value / default; `serializeParams` round-trips.
- **Goldens:** regenerate `bayer_dither_128.png` / `_256.png` (shader changed) via
  `tests-unit/shaderfx_golden/generate_goldens.py` (it already binds manifest textures, so it
  picks up `blue_noise.png`). Goldens render at the default pattern (Bayer 4×4).
- **Per-pattern parity (NEW):** a dedicated test that renders `bayer_dither` at each of the 12
  `u_pattern` values on both runtimes (server `render_effect` vs browser `shaderFx`) and asserts
  near-identity (same tolerance as the existing parity spec). This covers the patterns the
  default-only golden protocol misses. Add to the Playwright parity harness
  (`frontend/tests/shaderfx-golden.spec.ts`) or a sibling spec.
- **In-app:** open the effect (studio + standalone node), confirm the Pattern `<select>`,
  switch through all 12, confirm each renders distinctly and the blue-noise variants look like
  true blue noise; confirm Duotone stacks correctly in the studio.

## Risks / open items

- **Per-pattern parity** is the one thing the existing harness doesn't cover by default → the new
  per-pattern parity test closes this. Float-precision divergence in pattern branches between the
  CGL (server) and WebGL2 (browser) runtimes is the risk it guards.
- **Blue-noise quality** depends on the bake script; verify by eyeballing the tile and its radial
  power spectrum (energy pushed to high frequencies). 64×64 is a balance of quality vs asset size.
- **scipy dependency** for the bake script — present in `.venv` (1.17.1); the script runs offline
  and its output (the PNG) is committed, so runtime/CI never needs scipy.
- **Renderer wrap mode**: extra textures bind CLAMP_TO_EDGE; blue noise uses `texelFetch` +
  modulo to tile exactly, so wrap mode is irrelevant (no shader/renderer change needed).

## Non-goals (this pass)

- Adding enum params to any other effect (just `bayer_dither`).
- A separate continuous "noise scale" slider (the ×N variants are discrete menu entries).
- Building color modes into the effect (Duotone is the existing studio pass).
- Renaming the effect id (`bayer_dither` kept for back-compat).
