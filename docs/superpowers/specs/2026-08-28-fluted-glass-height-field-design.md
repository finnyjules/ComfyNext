# Fluted Glass — rebuild as a height-field glass engine

Date: 2026-08-28
Status: approved, implementing

## Why

`shader_effects/blinds.frag` ("Fluted Glass") models one thing analytically: a row
of half-cylinders. Its refraction is a closed-form bend across the flute, and its
shading is a painted crest. That works for two looks — linear flutes and
concentric rings — and cannot be extended, because every other textured-glass
pattern (pillows, raindrops, hex, frost) is a 2-D surface, not a 1-D profile.

designminis.com/refract demonstrates the generalization: treat the pattern as a
**height field**, derive the normal from it, and drive refraction and specular
from that normal. Every pattern then shares one control set, and adding a pattern
is one height function.

## The engine

Per pixel, in aspect-corrected square space:

1. `p` — square-space coordinate, rotated by Angle.
2. `h = height(p, pattern)` — the only per-pattern code. Returns roughly 0..1.
3. Normal by central differences on `h`, slope scaled by Relief:
   `n = normalize(vec3(-dhdx * relief, -dhdy * relief, 1.0))`
4. Refraction: `offset = n.xy * Depth`, applied in texcoord space (divide x by aspect).
5. Dispersion: per-channel scaling of `offset` — R at `(1+d)`, G at `1`, B at `(1-d)`.
6. Blur: N taps along the tangent axis. **N = 1 when Blur is 0.**
7. Sheen: Blinn-style specular from `n` and Light angle, added to the colour.

Steps 4-7 are pattern-independent. Height is evaluated once per pixel (plus 4
cheap taps for the normal); Blur multiplies only *texture* samples, as today.

## The nine patterns (`u_mode`)

| Value | Name | Height function |
|---|---|---|
| 0 | Reeded | cylinder profile across one axis |
| 1 | Concentric | same profile on `length(p - center)` |
| 2 | Pillows | reeded profile multiplied on both axes |
| 3 | Brick | offset rows, flat top, smoothstep chamfer, Mortar gap |
| 4 | Raindrops | jittered spherical caps on a hash grid, Seed reshuffles |
| 5 | Zigzag reeds | reeded, across-coord offset by a triangle wave of the along-coord |
| 6 | Hex | three reeded profiles summed at 0/60/120 degrees |
| 7 | Wobble | fbm domain-warped by fbm |
| 8 | Frost | one noise summed at three scales, finest below lens size |

Values 0 and 1 keep their current meanings exactly, so `u_mode` extends from a
2-value enum to a 9-value one without touching any saved config.

## Controls

Uniform NAMES are preserved wherever the quantity survives; only labels change.
Motion tracks address uniforms by name (`effects.0.params.u_chromatic`), so a
rename silently breaks saved animations.

| Uniform | Old label | New label | Range | Status |
|---|---|---|---|---|
| `u_mode` | Pattern (2) | Pattern (9) | enum 0..8 | extended; 0,1 unchanged |
| `u_count` | Flutes | Cell size | 1..120 | label only |
| `u_refraction` | Refraction | Depth | 0..3 | label only |
| `u_chromatic` | Dispersion | Dispersion | 0..0.05 | unchanged |
| `u_blur` | Blur | Blur | 0..0.5 | unchanged |
| `u_angle` | Angle | Angle | 0..180 | gated to modes [0,2,3,4,5,6,7,8] |
| `u_centerX/Y` | Center X/Y | Center X/Y | 0..1 | gated to mode 1 |
| `u_relief` | - | Relief | 0..2 | NEW |
| `u_sheen` | - | Sheen | 0..1 | NEW |
| `u_lightAngle` | - | Light angle | 0..360 | NEW |
| `u_mortar` | - | Mortar | 0..0.3 | NEW, mode 3 only |
| `u_rainSeed` | - | Seed | 0..99 | NEW, mode 4 only |
| `u_depth` | Rib Shading | - | - | RETIRED |
| `u_shadeWidth` | Shade Width | - | - | RETIRED |

`u_rainSeed` is its own param because the built-in `u_seed` is hardcoded to 42 in
`frontend/app/lib/shaderstudio/passes.ts` and is not user-reachable.

`showWhen.equals` already accepts an array (`app/lib/shaderfx/showWhen.ts`), so
per-pattern gating needs no new plumbing.

## Migration (config version 3 -> 4)

For each effect with `id === 'blinds'`:

- delete `u_depth` and `u_shadeWidth` from `params`
- if `u_relief` is absent, set it to the calibrated default
- if `u_sheen` is absent, set it to the calibrated default
- drop motion tracks whose path ends in the two retired uniforms

Gated on `version < 4`, following the `migrateSpectrumMap` precedent: run once,
identified by the stored version rather than by inspection.

## Known visual delta

Old rib shading is a PAINTED dark seam; the new shading is a LIT surface.
Reeded at Cell size 28 / Depth 1.2 / Relief 100% is calibrated to read as the
same material as today's default. Layers that pushed Rib Shading hard will lose
their hard black seams. This was accepted explicitly during design.

## Also

Update the agent vocabulary line in `app/lib/shaderstudio/agentControls.ts` so
pillow / rain / hex / frosted / brick / dimpled route to `blinds`.

## Testing

- `shaderstudio-migrate.unit.spec.ts` — retired uniforms dropped, new defaults
  seeded, tracks pruned, version bumped, idempotent, and a v4 config untouched.
- `shader-agent-vocab.unit.spec.ts` — new words resolve to `blinds`.
- Manifest integrity — every uniform declared in the manifest exists in the
  `.frag`, and every non-builtin uniform in the `.frag` is declared.
- Live verification in Shader Studio: all nine patterns render, controls gate
  correctly, Blur 0 is a single tap.
