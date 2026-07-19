# 3D Studio — multi-stop gradient ramp

**Date:** 2026-07-18
**Status:** approved (owed since the materials phase-1 brainstorm; re-picked
today alongside extrude/3D text, which follows separately)
**Scope:** replace the two-colour gradient with a multi-stop ramp — a draggable
stop editor, a free direction rather than three fixed axes, offset and spread,
and a radial type. Frontend-only.

## Why

The gradient material is the weakest part of an otherwise strong material set:
two colours, one of three axes, nothing else. Spline's ramp editor was the
reference Julien showed when this was first approved. All three shading modes
(smooth, faceted, prismatic) already reduce to a single scalar `t` before their
final `mix(uColorA, uColorB, t)`, so multi-stop support is a change to how that
scalar becomes a colour — the per-mode maths is untouched.

## Decisions

| Decision | Rationale |
|---|---|
| **Stops become a 256×1 `DataTexture` LUT** sampled at `t`, replacing the two-colour `mix` | Any stop count works with no shader recompile and no `MAX_STOPS` loop, and all three shading modes get it from one changed line each. Rebuilding a 256-pixel texture on edit is trivial. |
| Stops are `{ pos, color }[]`, **absent by default** | An absent array synthesizes from the existing `color` + `gradientB`, so every saved scene renders identically and `serialize→parse` stays exact. The array materializes on first edit. |
| **Direction replaces the axis picker**: yaw + pitch angles, with x/y/z presets | This is the "angle" half of what was approved. Two angles express any direction unambiguously in 3D, where a single 2D angle does not. When both are absent the direction is derived from the existing `gradientAxis`, so old scenes are unchanged and the axis field stays meaningful as a preset. |
| **Projected-AABB normalisation** for `t` | `t = (dot(p − centre, dir) + r) / 2r` where `r = dot(abs(dir), halfSize)` is exact for a box and reduces precisely to today's per-axis formula when `dir` is a unit axis — so the default look is preserved by construction, not by tuning. |
| Radial is **distance from centre over the bounding radius** | Simple, predictable, and reuses the bbox uniforms already refreshed on every geometry rebuild. |
| Max 8 stops, min 2 | Keeps the editor legible at panel width and the LUT build trivially cheap. Removing below two is refused rather than silently re-adding. |

## Model — `config.ts`

```ts
export interface GradientStop { pos: number; color: string }   // pos 0..1
```

New optional `SceneMaterial` fields:

| field | range | default | meaning |
|---|---|---|---|
| `gradientStops` | 2–8 entries | absent → `[{0, color}, {1, gradientB}]` | the ramp |
| `gradientType` | `'linear' \| 'radial'` | `'linear'` | ramp shape |
| `gradientYaw` | 0–360 | derived from `gradientAxis` | direction around Y |
| `gradientPitch` | −90–90 | derived from `gradientAxis` | direction elevation |
| `gradientOffset` | −1–1 | 0 | slides the ramp along the direction |
| `gradientSpread` | 0.1–3 | 1 | compresses (<1) or stretches (>1) the ramp |

`gradientAxis` and `gradientB` are retained: they seed the defaults above and
keep old documents meaningful. Parsing validates stops — each entry must have a
finite `pos` and a string `color`; entries are clamped to `[0,1]`, sorted by
`pos`, and the whole array is dropped (falling back to the synthesized pair) if
fewer than two survive or more than eight are given.

Axis → angle mapping for the derived defaults: `x` → yaw 90°, pitch 0°;
`y` → yaw 0°, pitch 90°; `z` → yaw 0°, pitch 0°.

## Materials — `materials.ts`

- `buildRampTexture(stops): THREE.DataTexture` — 256×1 RGBA, `SRGBColorSpace`,
  linear filtering, clamp-to-edge. Colours interpolate in sRGB between adjacent
  stops, matching what the editor draws with a CSS gradient. Stops at or beyond
  the ends flood to the edge.
- Gradient uniforms gain `uRamp` (the texture), `uDir` (vec3), `uType` (int),
  `uOffset`, `uSpread`. `uColorA`/`uColorB` are removed.
- Both fragment programs change their final line from
  `diffuseColor.rgb = mix(uColorA, uColorB, t)` to
  `diffuseColor.rgb = texture2D(uRamp, vec2(clamp((t - 0.5) / uSpread + 0.5 - uOffset, 0.0, 1.0), 0.5)).rgb`,
  and their `t` computation switches from the per-axis branch to the projected
  form above. The faceted/prismatic per-face extents project the same way.
- `updateMaterial` rebuilds and swaps the LUT **only when the stops actually
  change** (compare a cheap signature), disposing the old texture; direction,
  offset, spread and type stay plain uniform writes. The identity key is
  unchanged, so switching stops never rebuilds the material.
- `disposeMaterial` must dispose `uRamp`.

## UI

**`StudioGradientRamp.vue`** (new, in the studio kit) — `v-model` on
`GradientStop[]`:

- A ramp bar painted with a CSS `linear-gradient` from the same stops, so the
  editor and the render agree.
- Stop handles sit under the bar at their positions. **Click** a handle to
  select it; **drag** to move (clamped to 0–1, list re-sorted on drop);
  **click the bar** where there is no handle to insert a stop there, coloured by
  sampling the ramp at that position so insertion never changes the appearance;
  **double-click** a handle to delete it, refused at two stops.
- The selected stop's colour is edited by the existing `StudioColor` beneath the
  bar, alongside a numeric position field.
- Pointer handling follows this codebase's hard-won rule: the component sits in
  the panel, not over the viewport, but it still uses `@pointerdown.stop` so a
  drag can never reach OrbitControls, and it captures the pointer so a drag that
  leaves the bar keeps tracking.

**Selection panel** — the gradient block becomes: the ramp editor, then Type
(linear/radial), Direction (yaw/pitch sliders plus X/Y/Z preset buttons that set
them), Offset, Spread, and the existing Shading control (smooth/faceted/
prismatic), unchanged.

## Error handling

Parsing is tolerant as everywhere else: malformed stops are dropped and the
material falls back to the synthesized two-stop ramp rather than failing. A
degenerate direction (both angles landing on a zero vector is impossible, but a
zero-extent bounding box is not) divides by a guarded epsilon, as the current
shader already does.

## Testing

- **Unit (config):** stops round-trip exactly; absent stays absent; out-of-range
  positions clamp; unsorted input sorts; fewer than two or more than eight
  drops the array; malformed entries drop; every new field round-trips.
- **Unit (materials):** `buildRampTexture` places the right colours at the right
  texels (endpoints, a midpoint between two stops, and flooding beyond the outer
  stops); a two-stop ramp built from `color`+`gradientB` produces the same
  texels as today's endpoints; changing only direction/offset/spread updates
  uniforms in place without rebuilding the texture or the material; changing
  stops swaps the texture and disposes the old one; the identity key is
  unchanged across all of it.
- **Unit (direction):** the axis→angle mapping reproduces the current per-axis
  behaviour — for each of x/y/z, the projected `t` formula and the old formula
  agree across sample points.
- **Browser (real interactions):** add, drag, recolour and delete stops and see
  the object update live; deleting to two stops is refused; the bar preview
  matches the rendered object; direction presets reproduce the old axis looks;
  offset and spread behave; radial type works; all three shading modes still
  work with a multi-stop ramp (prismatic especially, since it samples per face);
  save/reopen restores; Export bake matches the viewport.
- **Gates:** scene3d vitest green; `vue-tsc --noEmit | grep -i scene3d` clean.

## Out of scope

Per-stop opacity, easing/interpolation curves between stops, gradients driven
by anything other than object position (screen-space, UV, normal), gradient
presets or a saved library, and gradients on material types other than
`gradient`.
