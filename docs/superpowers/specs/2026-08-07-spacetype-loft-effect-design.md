# Space Type — Loft Effect

**Date:** 2026-08-07
**Status:** Design approved, pre-plan

## Plain-language summary

A new Space Type effect called **Loft**. You draw a curve in 3D (the "spine") by
placing **stops** along it. Each stop is a point on the curve *and* carries a set
of shape properties — how wide/tall/round the cross-section is there, how twisted
it is, and what colour it is. The effect then sweeps a shape down that spine,
drawing hundreds of interpolated copies between the stops, with the colour
gradient running along the sweep. It produces the iridescent spirals, gradient
ribbons, and lofted tubes in the reference set (abstract, no text required).

This is the "gradient stops, but for geometry" idea: a keyframed cross-section
swept along an editable path.

## Goal & references

Reproduce, as a single parametric effect:

- **img 1** — iridescent spiral: an oval profile lofted along a 3D helix/loop,
  rendered as dense stroked outlines that overlap into a translucent line-field,
  with per-position colour and profile twist (roll).
- **img 2 (SUSPENSION)** — flat gradient ribbons: capsule profiles swept along a
  2D zig-zag spine, solid fill, gradient across the sweep.
- **img 3 / img 5** — 3D lofted ribbons/tubes with real depth and a colour
  gradient across the surface.
- **img 4 grid** — the coil is the same loft closed into a loop.

## Decisions (locked)

| Question | Decision |
| --- | --- |
| Dimensionality | **3D-native, with a flat 2D mode as a subset.** Build 3D first; 2D is the spine collapsed to a plane, viewed head-on. |
| Copy style | **Both stroked outlines and solid fill, as a toggle.** |
| Profile | **One cross-section, two kinds — parametric shape OR a word.** Parametric = a rounded shape (width, height, corner-radius, sides). Word = the word's glyph outlines become the swept cross-section, lofted into a 3D form that follows the spine. The kind is a global toggle for the whole spine, not per-stop (per-stop outline-morphing is out of scope). No arbitrary shape-morphing within a kind. |
| Spine editing | **Stops ARE the curve.** A preset menu stamps a starting set of stops (helix/wave/arch/S-curve/loop); every stop is then free-hand editable. Presets are pure generators, not a locked mode. |
| Stops editor | **Option B — build the full `profileStops` ControlSpec kind + editor UI now.** Arbitrary add/remove/reorder of rich stops. |

## Core model

- **Spine** — a curve fitted (Catmull-Rom) through the ordered stop positions in
  3D. Optionally closed into a loop.
- **Stop** — an ordered control point that is simultaneously a position on the
  spine and a keyframe of shape properties.
- **Profile** — one parametric rounded shape. Its parameters are interpolated
  between the two bracketing stops by arc-length `t`, then swept.
- **Copies** — N cross-sections sampled along the spine. In stroke mode each is an
  outline; in solid mode consecutive cross-sections are skinned into a surface.
- **Gradient** — built from the per-stop colours, interpolated along `t`, applied
  as vertex colours (same technique as `blend.ts` `lerpColors` / `setColorAt`).

## Data model

```ts
interface LoftStop {
  id: string        // stable id — list addressing by id, never index (see gotchas)
  x: number         // 0..1 on the curve-editor canvas
  y: number         // 0..1
  z: number         // depth, -1..1
  width: number     // profile params …
  height: number
  radius: number    // corner radius 0..1
  sides: number     // 3..64; high → ellipse/capsule
  roll: number      // twist of the profile about the spine tangent, degrees
  color: string     // hex; MUST pass through stripAlpha before new THREE.Color
}

interface LoftParams {
  stops: LoftStop[]
  profileKind: 'shape' | 'word'   // global cross-section kind for the whole spine
  text: string          // word mode: the word whose outline is swept
  font: string          // word mode: font (reuse the shared FontPicker scheme)
  weight: number        // word mode: weight
  spinePreset: 'custom' | 'helix' | 'wave' | 'arch' | 's-curve' | 'loop'
  closed: boolean
  copies: number        // ~10 (discrete ribbons) … ~400 (dense line-field)
  mode: 'flat' | '3d'
  render: 'stroke' | 'fill'
  strokeWidth: number
  strokeOpacity: number
  fillOpacity: number
  spin: number          // turntable, reuse blend's semantics
  flow: number          // phase travel of copies along the spine (seamless loop)
  // + standard Space Type camera + universal post-stack params
}
```

In **word** mode a `LoftStop`'s `width`/`height` act as cross-section scale and
`radius`/`sides` are ignored (their controls hide via `showIf` on `profileKind`);
`roll` and `color` keyframe as before. So per-stop you keyframe scale, twist, and
colour of the word along the sweep, while the glyph outline itself is constant.

## Controls & UI

Declared as `ControlSpec[]` on the effect
(`frontend/app/lib/spacetype/effect.ts:49`), so the Motion tab,
AI-editability, defaults, and seamless-loop export all derive automatically
(`SpaceTypeSurface.vue` `controlDesc` at `:407`/`:430`).

**New ControlSpec kind: `profileStops`** — this is the Option-B build.

- Value = `LoftStop[]`.
- Editor component (new): a curve-editor canvas rendering stops as draggable XY
  nodes, plus a selected-stop inspector exposing `z`, `width`, `height`,
  `radius`, `sides`, `roll`, `color`, and add/remove/reorder controls.
- Wired into the control switch in `effect.ts` (the `ControlSpec` union) and into
  `SpaceTypeSurface.vue`'s `controlDesc()` → `StudioControl` rendering. This is
  the one place the change exceeds "two files."
- Reuse the existing curve-editor canvas and `StudioColor` picker rather than
  hand-rolling; the inspector rows are standard studio control rows.

**Spine preset** (`select`) — stamps a starting `stops` array via a pure
generator function `presetStops(preset): LoftStop[]`. Selecting a preset
replaces the current stops (with a confirm if the user has edited them).

**Profile kind** (`select` — shape/word). When `word`, reveal (`showIf`) a `text`
control plus a shared `font` picker + `weight` slider; the per-stop `radius`/
`sides` rows hide. Reuse the existing shared FontPicker + TTF-proxy scheme and the
Scene3D glyph→Shape path so the word becomes real outline contours.

Global controls (existing kinds): `closed` (switch), `copies` (slider),
`mode` (select flat/3d), `render` (select stroke/fill), `strokeWidth`,
`strokeOpacity`, `fillOpacity` (sliders, shown via `showIf` on `render`),
`spin`, `flow` (sliders, `group: 'Motion'`).

## Rendering

`buildScene(three, params, _textTexture)` ignores the text texture entirely
(precedent: `blend.ts:111`, `string.ts:81`). Steps:

1. Build the spine curve (Catmull-Rom through stop XYZ; closed if `closed`).
2. Sample K stations along the spine by arc length. Per station, interpolate the
   profile params and colour from the bracketing stops.
3. Build the cross-section for each station, oriented by the Frenet/
   parallel-transport frame plus the station's `roll`, scaled by the station's
   width/height:
   - **shape kind** — the parametric outline (width/height/radius/sides → a ring
     of points).
   - **word kind** — the word's glyph outlines as one or more closed contours
     (letters + counters/holes), from the shared font→path machinery. The
     contour set is the constant cross-section; per-station scale/roll/colour
     still apply.
   `THREE.ExtrudeGeometry` with an `extrudePath` is the reference for a
   *constant* cross-section swept along a curve, but per-stop keyframed variation
   (scale/roll/colour changing along the spine) needs the custom station-sampling
   + skinning below, so we don't use vanilla ExtrudeGeometry for the varying case.
   Multi-contour glyphs (holes) are skinned per contour.
4. **Stroke mode:** each ring → a `LineLoop`; merge into one `BufferGeometry`
   (`LineSegments`) with per-vertex gradient colour and `strokeOpacity`
   transparency. Dense + translucent = the img-1 line-field.
5. **Solid mode:** skin consecutive rings into a triangle-strip surface — one
   `BufferGeometry` mesh, vertex colours from the gradient, `fillOpacity`. A
   proper loft surface (img 3/5), not stacked flat copies.
6. **Flat (2D) mode:** force `z = 0`, orient profiles in the picture plane,
   render with the head-on orthographic path. 3D is a superset. **Word kind is
   3D-primary:** a word cross-section swept perpendicular to a flat spine is seen
   edge-on and degenerates to a line. Resolution deferred to the plan; likely
   flat+word orients the word face-on to camera and the sweep produces trailing
   offset copies rather than a perpendicular extrusion. Shape kind is unaffected.

`update(t01, params, root)` advances `flow` (phase travel of the sampled stations
along the spine) and `spin` (turntable rotation of the root). Per-scene state
(sampled curve, geometry handles) lives on `root.userData`, never module-level.
`liveKeys` lists params read every frame (`flow`, `spin`, opacities) so tweaking
them doesn't trigger a structural rebuild.

## Motion / seamless loop

- `flow` scrolls the gradient/copies along the spine; `spin` rotates the form.
- `loopRates(params)` returns the cycle coefficients (e.g. `[flow, spin]`) so the
  seamless-loop exporter (`SpaceTypeSurface.vue:747`/`:1243`) closes cleanly.

## Architecture & files

**New:**
- `frontend/app/lib/spacetype/effects/loft.ts` — the effect (templated on
  `blend.ts`). Note: id must **not** be `blend` (taken at `effects/blend.ts:106`);
  use `loft`.
- Stops-editor Vue component (name TBD in plan, e.g. `LoftStopsEditor.vue`) under
  the vue-canvas components dir.
- `presetStops()` + curve/profile geometry helpers (own module, e.g.
  `spacetype/loftGeometry.ts`).

**Edited:**
- `frontend/app/lib/spacetype/effects/index.ts` — one import + one array entry
  (`:2-27`, `:30`).
- `frontend/app/lib/spacetype/effect.ts` — add `profileStops` to the `ControlSpec`
  union.
- `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` — map `profileStops`
  in `controlDesc()` and render the editor component.

**Reused:** curve-editor canvas, `StudioColor`, `StudioControl` auto-UI,
`stripAlpha` (`frontend/app/lib/color/convert.ts:178`), `loopRates`/`liveKeys`,
universal post stack, existing camera controls, the shared FontPicker + TTF-proxy
scheme, and the Scene3D glyph→Shape (Text+Shape) path for word-mode contours.

## Gotchas / constraints

- **id collision** — do not reuse `blend`; `getEffect` resolves case-insensitively.
- **stripAlpha** — every `new THREE.Color(hex)` where the hex may carry alpha
  (stop colours) must call `stripAlpha` first; 8-digit hex silently renders
  **white**, not an error.
- **synchronous `buildScene`** — no `await` (re-entrancy guard at
  `engine.ts:245`).
- **per-scene state on `root.userData`** — never module-level vars (concurrency
  note `blend.ts:53`/`ring.ts:14`).
- **stable stop ids** — address the stops list by `id`, never by positional index;
  reorder/removal re-points indices silently.

## Testing

- Unit: `presetStops()` returns well-formed stops for each preset; profile-param
  interpolation is monotonic between stops; gradient colour sampling matches
  stop colours at stop `t`s; `stripAlpha` applied to every stop colour.
- Unit: geometry builder produces the expected vertex/segment counts for a given
  `copies` in both stroke and fill modes; flat mode zeroes `z`.
- Unit: word mode resolves a word into ≥1 closed contour (and holes for glyphs
  like 'o'/'e'); `radius`/`sides` are ignored while `width`/`height` scale the
  cross-section; switching `profileKind` shape↔word rebuilds without leaking the
  old geometry.
- Parity/regression: pair a golden thumbnail with an input-correlation check
  (per house convention — goldens alone pass flat-wash bugs).
- Runtime (the real proof): drive the live effect in the Space Type surface,
  add/drag/remove stops, toggle stroke↔fill and flat↔3d, and verify with a
  deliberately-broken control that the path actually runs (synthetic events and
  "it rendered" prove nothing here).

## Out of scope (YAGNI)

- Arbitrary shape-identity morphing between stops (oval→star, or shape→word).
  Profile kind is global; within a kind the outline is constant.
- Per-stop different words. Word mode sweeps one word for the whole spine.
- Photo content on the loft. The two cross-section kinds are parametric shape and
  word; images are not part of v1.
- A full 3D drag gizmo. 3D position is XY-on-canvas + a depth field per stop.
- Import of external paths as the spine.
