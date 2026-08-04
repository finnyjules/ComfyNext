# Colour + gradient params for the shader catalog — design

**Date:** 2026-08-04
**Status:** approved, implementing

## Problem

The `gradient_map` catalog effect is not a gradient map. It is a hardcoded cosine
rainbow:

```glsl
vec3 pal(float t) { return 0.5 + 0.5 * cos(6.28318 * (vec3(1.0)*t + vec3(0.0,0.33,0.66) + u_hue)); }
```

`Hue` rotates the rainbow, `Spread` wraps it more times. There are no colours in
it, so it can only ever produce a rainbow. `duotone` has the same disease —
"Shadow Hue" / "Light Hue" floats instead of two colours.

The root cause is the catalog's param vocabulary: `float` and `enum` only. No
catalog effect can accept a colour, so every colour-shaped effect fakes one.

Meanwhile the Shader Studio's *post* section already ships a correct Photoshop
gradient map (`GRADIENT_MAP_FS` in `frontend/app/lib/shaderstudio/glsl.ts`):
luminance → up to 8 interpolated stops, with a mix. Two different things are
named "Gradient Map" and only one behaves.

## Design

### Transport: a uniform value may be a 3-tuple

Both renderers upload `Record<string, number>` via `uniform1f`
(`frontend/app/lib/shaderfx/renderer.ts`, `comfy_extras/_shader_effects.py`).
Widen the value type to `number | [number, number, number]` and dispatch to
`uniform3f`. Shader authors then write `uniform vec3 u_ink;` and
`uniform vec3 u_ramp[8];` rather than `u_ink_r/u_ink_g/u_ink_b`.

Indexed uniform names (`u_ramp[0]`) are ordinary uniform locations, so arrays
need no extra machinery. This is the same shape `GRADIENT_MAP_FS` already uses
for its stops — a proven pattern, not an invention.

### Two new param types

```json
{ "uniform": "u_ink",  "label": "Ink", "type": "color", "default": "#1a1a2e" }
{ "uniform": "u_ramp", "label": "Gradient", "type": "gradient", "maxStops": 8,
  "default": [{ "pos": 0, "color": "#06283d" }, { "pos": 1, "color": "#47b5ff" }] }
```

- `color` → one vec3 uniform.
- `gradient` → `u_ramp[i]` (vec3), `u_rampPos[i]` (float), `u_rampCount` (float).

`EffectParam.default` becomes `float | str | list`. Validation: a colour must be
`#rgb` or `#rrggbb`; gradient stops must be within `[0,1]`, sorted on load, and
no more than `maxStops`.

Neither type is animatable. A colour is not a float sweep, and motion targets
are derived from the same param list — so both must be excluded explicitly
rather than falling into the numeric default.

### Inspector reuses what exists

`color` renders as `StudioColor`; `gradient` renders as `PalettePicker` in
`stops` mode — the same harmony/palette picker the studio's own Gradient Map
section already uses. No new controls.

### The effects

- **`gradient_map`** becomes a real one: `Gradient` (stops) + `Contrast` + `Mix`,
  same maths as the studio post pass.
- **`duotone`** gets real `Shadow` / `Highlight` colours.
- **`spectrum_map`** (new) preserves the old cosine rainbow verbatim. Saved
  layers on the old `gradient_map` migrate to `spectrum_map` with their params
  intact, so no existing project changes appearance.

## Blast radius

Eleven sites read catalog params, and most branch as "enum, else float". Two are
load-bearing:

- **`shaderfill/descriptor.ts`** — shader-fill cache identity. A colour that does
  not participate in the descriptor key means two different colours collide on
  one cached render: wrong picture, no error.
- **`shaderfill/controls.ts`** — `derivedShaderFillControls` is `if enum / else
  slider`, so a colour would render as a 0–1 slider over a hex string and motion
  would offer to animate it.

Mechanical but mandatory: `shaderfx/params.ts`, `shaderfx/renderer.ts`,
`shaderfill/field.ts`, `spacetype/fills.ts`, `texturefx/stylize.ts`,
`shaderstudio/passes.ts`, `shaderstudio/agentControls.ts`,
`ShaderStudioSurface.vue`, `_shader_effects.py`, `nodes_shader_effects.py`,
`frontend/tests/shaderfx-golden.spec.ts`.

A missed consumer degrades silently — it drops the param and renders the default
— so each one is visited, not inferred.

## What the live run changed

Two things only running it in the app surfaced:

1. **`StudioColor` emits 8-digit `#rrggbbaa`.** Its alpha track sits directly
   under the hue track, so a user touching it produces `#e609f580`. `isHex` only
   accepts 3- and 6-digit forms, so the param rejected it and fell back to its
   default: picking a colour did nothing, silently, with the swatch showing the
   new colour and the render showing the old one. Colour params now accept 4- and
   8-digit hex and drop the alpha (uniforms are `vec3`). Same family as the
   THREE.Color 8-digit-hex-renders-white trap already documented in this repo.

2. **A Python-side catalog change needs a ComfyUI restart.** Adding a `.frag` is
   picked up by a browser reload because the manifest is re-read per request — but
   the *loader* is imported once at startup, so the running server validated the
   new manifest with the old code and served a 500 (`'<=' not supported between
   instances of 'float' and 'str'`).

## Verification

- Golden parity gate covers the new uniform path for all three effects.
- Per new type, a **deliberately-broken control**: set the colour to magenta and
  assert the pixels actually become magenta. A colour that never reaches the
  shader looks identical to one that does whenever the default is close — so
  "it rendered" proves nothing here (see the risograph parity lesson).
- Migration test: an old `gradient_map` layer loads as `spectrum_map` with the
  same params and renders the same pixels.
