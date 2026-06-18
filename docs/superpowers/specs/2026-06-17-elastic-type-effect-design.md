# Elastic type effect — design

**Date:** 2026-06-17
**Base branch:** `feat/elastic-type-effect` (off `main`)
**Comp:** kielm's **STG V.STRETCH** — bold condensed type, stacked full-bleed (one word per
line), warping like a printed-on-rubber sheet: horizontal shear + vertical stretch flowing
through the block, easing between a clean readable state and warped extremes.

## Goal

Add a new Space Type effect **`elastic`** that deforms stacked lines of type like a stretchy
material. A single **Mode** dropdown switches between five distortion algorithms (Wave, Spring,
Taffy, Pinch, Jelly). Static **skew** controls slant the glyphs and the line blocks underneath
the animation. Works in **both** the studio's orthographic/isometric and perspective cameras.

It's a new module implementing the existing `SpaceTypeEffect` seam — **no engine, surface, or
seam changes**. It inherits the picker, live preview, fill system, font/text rasterization, and
bake-to-PNG pipeline for free, exactly like the existing 9 effects.

## Decisions (locked during brainstorming)

1. **One effect, Mode dropdown — not five picker entries.** A `select` control switches the
   displacement function so users A/B modes on the same text instantly and the picker stays clean.
2. **All five modes in v1:** Wave, Spring, Taffy, Pinch, Jelly.
3. **Stacked full-bleed lines.** Reuse the `textList` control: each row = one line, laid out
   stacked and auto-scaled to fill frame width (the kielm layout).
4. **Two skew controls, static (not animated):** **Text skew** (glyph slant / faux-italic) and
   **Line skew** (parallelogram lean of the line planes), plus **Line stagger** (per-line
   horizontal offset). They compose *under* the animated warp.
5. **Both cameras.** Displacement is in local/world space, so it renders under either projection
   with no per-mode special-casing. Projection stays a studio-level toggle, not an effect control.
6. **Default look = the reference:** solid black type on white, flat (best viewed in ortho), but
   fills/gradients available via the standard `fillList`.

## Architecture

Mirrors `field.ts` (the closest sibling): subdivided `PlaneGeometry` + vertex-shader
displacement injected via `material.onBeforeCompile`, module-level uniforms advanced per frame in
`update()`, `MeshLambertMaterial` so the existing shadow path keeps working.

### Module — `frontend/app/lib/spacetype/effects/elastic.ts`

Exports `elasticEffect: SpaceTypeEffect` (`id: 'elastic'`, `label: 'Elastic'`).

**Geometry — one plane per line.** Split the `textList` into N lines. For each line build a
`PlaneGeometry(lineW, lineH, segX, 1)` where `segX` scales with width (e.g. ~64–160 segments) so
the horizontal warp is smooth; `segY` can stay low (1–2) since the deformation is dominantly a
function of x and a per-line constant. Stack the planes vertically with consistent leading, and
compute a uniform scale so the widest line fills the target frame width (auto-fit). Center the
whole stack on the origin so it stays framed in **both** cameras (perspective needs the centroid
on the camera axis).

**Texture — one atlas row per line.** `textTexture` already carries an N-row atlas
(`userData.numTexts`, one row per `textList` entry — see `field.ts` line 190). Plane *i* samples
row *i*: `uv.y mapped into [i/N, (i+1)/N]`. So each line shows its own word, crisp.

**Per-line uniforms.** Keep a module-level array (like `field.ts`'s `waveUniforms`), one entry
per plane, holding the shared animation uniforms plus that plane's constants (`uLineIndex`,
`uLineCount`, `uLineSkew`, `uPlaneWidth`). `buildScene` resets and fills it; `update` writes the
time + live slider values into every entry.

### Displacement modes (vertex shader)

A single injected vertex-shader block dispatches on `uMode` (int). All functions are **periodic
in `t01`** so the loop and the bake are seamless — including Spring (see below). Inputs: local
`position` (centered), `uTime = t01 * 2π * cycles`, the shared amplitude/frequency uniforms, and
the per-line constants. Common transform order per vertex:

1. **Static skew first:** `position.x += position.y * tan(uTextSkew)` is *not* used here — text
   skew is a UV-space glyph slant (see below). **Line skew** shears the geometry:
   `transformed.x += position.y * uLineSkew` where `uLineSkew = tan(lineSkew°)` (parallelogram
   lean). Line stagger is applied as a per-plane world offset in `buildScene`, not in the shader.
2. **Mode displacement** adds to `transformed`:
   - **Wave** — traveling shear + vertical stretch down the stack:
     `phase = position.x * uWaveLen + uLineIndex * k + uTime`;
     `transformed.x += sin(phase) * uShear`; `transformed.y += cos(phase) * uStretch`.
   - **Spring** — global squash/stretch with damped-overshoot *shape*. Use a periodic
     pseudo-spring envelope `e(t) = sin(uTime) * exp(-d * fract-distance)` expressed so it
     returns to 0 at loop end (e.g. `sin(uTime) * cos(uTime * 0.5)` style product, or a baked
     easing LUT) — scales `transformed.xy` about the stack center. The point is the *clean→
     stretched→overshoot→clean* read, achieved with a periodic curve, **never** an unbounded
     `exp` decay (that wouldn't loop).
   - **Taffy** — low-frequency, high-amplitude horizontal drag, weighted by vertical position so
     lines smear at different rates: `transformed.x += sin(uTime + position.y * uWaveLen * 0.3)
     * uShear * 2.0 * dragWeight`.
   - **Pinch** — radial bulge/pinch from a moving center `c(t)`: displace each vertex along
     `(pos - c)` by `sin(dist * uWaveLen - uTime) * uStretch / (1 + dist)`.
   - **Jelly** — summed multi-axis sine ripple (2–3 octaves on x and y) scaled by `uIntensity`
     for an all-over wobble.
   All mode amplitudes are multiplied by **`uIntensity`** (master) so one slider tames everything.

### Skew

- **Text skew (glyph slant).** A UV-space shear in the fragment: sample `map` at
  `u' = u + (v - 0.5) * tan(uTextSkew)` before the atlas-row remap. Gives a clean faux-italic
  slant of the glyphs without moving the plane. The text atlas is rasterized with horizontal
  padding (existing pipeline) so the slant doesn't clip at typical angles; clamp/guard the
  sampled `u` to the row band to avoid bleeding into neighbors.
- **Line skew + stagger.** Geometry shear (`uLineSkew`, above) + per-plane world-x offset
  (`uLineIndex * uStagger`) set in `buildScene`.

### Fragment

Reuse `field.ts`'s fill compositing: sample the per-line atlas cell, sample `uFillTex` at the
plane UV for the fill (solid/gradient/grid/noise via `fillShaderTexture`/`fillTiling`), `mix(fill,
textColor, alpha)`, then the optional `getShadowMask()` multiply. One fill applies across the
stack (first fill in the list), matching `field`.

### Registration

Add to `frontend/app/lib/spacetype/effects/index.ts`: import `elasticEffect`, append to
`SPACE_TYPE_EFFECTS`. Nothing else — the surface auto-builds the UI from `controls`.

## Controls (ControlSpec)

| key | kind | group | notes |
|---|---|---|---|
| `text` | textList | Type | one line per row (stacked) |
| `font` | font | Type | |
| `typeHeight` | slider | Type | glyph raster height |
| `tracking` | slider | Type | letter spacing |
| `textSkew` | slider | Type | glyph slant degrees (−40..40, default 0) |
| `lineSkew` | slider | Layout | parallelogram lean degrees (−40..40, default 0) |
| `lineStagger` | slider | Layout | per-line x offset (default 0) |
| `leading` | slider | Layout | vertical gap between lines |
| `scale` | slider | Transform | overall scale |
| `mode` | select | Motion | `Wave` / `Spring` / `Taffy` / `Pinch` / `Jelly` (default Wave) |
| `intensity` | slider | Motion | master amplitude |
| `stretch` | slider | Motion | vertical-stretch weight |
| `shear` | slider | Motion | horizontal-shear weight |
| `waveLength` | slider | Motion | ripple frequency |
| `speed` | slider | Motion | loop cycles (integerized like `field` for seamless loop) |
| `fills` | fillList | Color | default `[{"type":"solid","a":"#ffffff","b":"#000000","textColor":"#000000"}]` |
| `shadows` | select | Shadow | on/off (reuse field's shadow rig) |
| `shadowStrength` | slider | Shadow | |

## Loop / bake correctness

- `update(t01)` is pure in `t01`; `uTime = t01 * round(speed) * 2π` so every mode is periodic
  over the loop (same first/last frame). Spring's envelope must be built from periodic terms —
  **verify** the last baked frame equals the first.
- No `Math.random()` / time-of-day; deformation is deterministic from `(t01, params)`, so the
  bake cache key (config hash) stays stable and re-exports reuse frames.

## Testing

- **Unit (vitest):** the effect exports a valid `SpaceTypeEffect` (id/label/controls present;
  `mode` select lists all five; `defaultsFromControls` round-trips). A pure helper that splits
  `textList` → lines and computes the auto-fit scale gets a direct unit test.
- **Headless build smoke:** `buildScene` returns an `Object3D` with N planes for an N-line input
  and doesn't throw for each of the five modes; `update(0)` and `update(0.999)` run clean.
- **In-app manual verify (gated preview):** open Type Studio → Elastic, cycle all five modes,
  exercise text/line skew + stagger, confirm it reads in both ortho and perspective, export a
  loop and confirm seamless (first frame == last).

## Out of scope (v1)

- Per-letter independent physics (we warp the line plane, not individual glyph meshes).
- A separate perspective-only "tilt" treatment (the shared camera toggle covers it).
- User-typed custom easing curves for Spring (ship one good periodic envelope).
- Multiple fills per line (one fill across the stack, like `field`).
