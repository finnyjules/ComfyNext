# Rings effect — repeat characters around the ring

**Date:** 2026-06-18
**Status:** Approved — implementing
**Scope:** `frontend/app/lib/spacetype/effects/onionburst.ts` only

## Goal

In the Space Type **Rings** effect (`onionburst`), each character rides the front arc of
its own spinning tube and appears **once**. Add an option to **tile the glyph N times
evenly around the tube's circumference**, so a spinning ring shows the character recur.

## Approach (shader angular tiling)

The glyph is painted onto the tube by the fragment shader via the surface angle `theta`
(`onionburst.ts` tube `ShaderMaterial`). Repetition = fold `theta` into N equal segments
and draw the glyph in each. No extra geometry/draw calls; spin/tumble unaffected.

Rejected: duplicating glyph meshes (heavier, the glyph isn't a mesh); atlas UV tiling
(doesn't map to angular spacing).

## Changes (one file)

- **Control:** `{ key: 'repeat', label: 'Repeat around ring', kind: 'slider', min: 1,
  max: 12, step: 1, default: 1, group: 'Ribbon' }`.
- **Build:** `const repeat = Math.max(1, Math.floor(Number(params.repeat) || 1))`
  (so pre-existing saved nodes with no `repeat` resolve to 1). Add uniform
  `uRepeat: { value: repeat }` to the tube material.
- **Fragment shader:** add `uniform float uRepeat;` and replace the front-arc test with:
  ```glsl
  float seg = (2.0 * PI) / uRepeat;
  float local = mod(theta + PI, seg) - seg * 0.5;   // local angle within each segment
  float arcEff = min(uArc, seg);                     // clamp so neighbours don't overlap
  if (abs(local) <= arcEff * 0.5) {
    float gv = clamp(0.5 - local / arcEff, 0.0, 1.0);
    a = texture2D(uAtlas, vec2(mix(uU0, uU1, fv), gv)).a;
  }
  ```
- Onion caps + fill wall unchanged. `update()` (spin/tumble) unchanged. Changing `repeat`
  rebuilds the scene, same as Arc/Radius today.

## Back-compat

With `repeat = 1`: `seg = 2π`, `local = theta`, `arcEff = uArc` → byte-identical to the
current output. Saved nodes without the param default to 1.

## YAGNI

One global integer repeat. No per-character counts, no fractional repeats, no per-line
override.

## Testing

It's a Three.js visual effect, so verify in the running app preview (screenshots):
Repeat = 1 (unchanged from today), 3, and 6 (evenly tiled around each tube, spin intact).
