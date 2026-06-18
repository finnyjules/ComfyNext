# String — Type Studio effect (STG `/string` port)

**Date:** 2026-06-17
**Branch:** `feat/elastic-type-effect` (continues the Space Type / "Type Studio" suite)
**Status:** approved, implementing

## Goal

Port spacetypegenerator.com `/string` (Kiel Mutschelknaus) into the Type Studio as a
new pluggable `SpaceTypeEffect`. Your text becomes **flowing ribbons that follow
hand-drawn bézier paths**: drop control points on the preview, each with a bézier
tangent handle; consecutive points connect with cubic béziers; the curve is swept
into a ribbon of `stripHeight`, sliced into 1–6 horizontal **strips**, each wrapped
with a repeating, **scrolling** texture (text / two gradients / stripes / mixtures).
Multiple separate strings supported (STG's ENTER → new string).

Source verified line-by-line: `sketch_string.js` (742), `particle.js` (123),
`textures.js` (181). The page loads nothing else but p5.js.

## Decisions (from brainstorming)

1. **Interactive path editor** — faithful click-drag drawing, not slider-procedural.
2. **Full texture set** — 4 textures + 1–6 strips + both mixture modes + per-strip
   scroll + round caps + outlines.
3. **Flat, front-locked** — drawn path maps 1:1 to the view; no 3D rotate/pan/scale
   for this effect in v1 (deferred — see Non-goals).

## Coordinate system

Path points stored **normalized** `x,y ∈ [0,1]` over the render frame. The engine's
existing **orthographic** camera frames world `y ∈ [−H0, H0]`, `x ∈ [−H0·a, H0·a]`
where `H0 = tan(22.5°)·14 ≈ 5.799` and `a = W/H` (perspective at z=14 frames the
identical box at z=0, so either camera works for a flat z≈0 effect; we force ortho).

- normalized → world: `wx = (nx−0.5)·2·H0·a`, `wy = (0.5−ny)·2·H0` (y flips: screen-down
  → world-up).
- editor screen → normalized: `nx = (clientX − rect.left)/rect.width`,
  `ny = (clientY − rect.top)/rect.height` using the **canvas** `getBoundingClientRect()`
  (handles the letterbox scaling between internal W×H and displayed size).

Because v1 has no scale/pan/rotate for this effect, the mapping is exact and the bake
reproduces a drawn path pixel-faithfully at any export resolution.

## Faithful mechanics (to replicate exactly)

- **Point handles** (`particle.js:16–19`): a point has `(x, y, a, hl, althl)`. Forward
  handle `= (x+cos(a)·hl, y+sin(a)·hl)`; back handle `= (x−cos(a)·althl, y−sin(a)·althl)`.
  The two handles share angle `a` (collinear) but have independent lengths; dragging one
  handle updates `a` + that handle's length and repositions the other along the new angle.
- **Segment béziers** (`sketch_string.js:317`): for consecutive points the curve uses the
  **higher-index point's forward handle** as control-1 and the **lower-index point's back
  handle** as control-2: `cubic(p[j], p[j].forward, p[j−1].back, p[j−1])`, 70 steps. We
  replicate this pairing exactly (it differs from the naive lower.forward/higher.back).
- **Strips** (`:327–331`): strip `m` spans perpendicular `[−H/2 + m·H/n, −H/2 + (m+1)·H/n]`,
  perpendicular = `atan2(tangent) − π/2`.
- **Texture U scale** (`:297, :325`): `heightRatio = texAspect · (stripHeight/stripCount)`
  in world units; `U = culmDist / heightRatio` where `culmDist` is cumulative **arc
  length** → the tile repeats by real distance and stays aspect-correct. Scroll offsets U.
- **Round caps** (`:343–363`): a `curveStop = 5`-segment semicircular fan at the first/last
  segment ends, bulging the strip ends.
- **Textures** (`textures.js`): **Text** = the word in `fore` on a **solid knot-1
  background** (not glyph-alpha); **Gradient 1** (`pgGH`) = 5-knot gradient **across** the
  strip width; **Gradient 2** (`pgG`) = 5-knot gradient **along** the ribbon length;
  **Stripes** = `fore` background with horizontal lines in the canvas background colour.
- **Texture mode** (`:263–292`): Text / Gradient 1 / Gradient 2 / Stripes / **Mixture per
  strip** (cycle by strip index) / **Mixture per string** (cycle by string index); mixture
  order is fixed `[Text, Gradient 1, Stripes, Gradient 2]`.
- **Outlines**: a stroked border baked **into each texture tile** + end strokes.
- **Default seed** (`:124–126`): one string of 3 points down the centre.
- Ignore `pgB` (built, never used). The dynamic `textureUnit` padding → fixed padding.

## Deliberate deviation: seamless looping

STG scrolls each strip at a *random* speed forever and never loops. The Type Studio bakes
**seamless loops**, so each strip's scroll is quantized to an **integer number of tiles per
loop** via the existing `loopTiles(speed, ·)` helper (every other effect's convention). A
`speedVary` control spreads strips across different integer tile counts via a fixed
deterministic per-strip factor, keeping the woven multi-speed feel while looping cleanly.

## Architecture (isolated, testable units)

### `lib/spacetype/stringPath.ts` (pure)
Path data model + (de)serialize. Stored as **one JSON string in params** (like
`fillList`/`textList`, so `ParamValue` stays scalar).
```ts
interface PathPoint { x: number; y: number; a: number; hl: number; althl: number } // x,y,hl,althl normalized
interface PathString { points: PathPoint[] }
interface StringPathDoc { strings: PathString[] }
parsePath(raw: unknown): StringPathDoc      // tolerant; bad input → defaultPath()
serializePath(doc): string
defaultPath(): StringPathDoc                 // one string, 3 points down centre
forwardHandle(p): {x,y}; backHandle(p): {x,y}   // normalized handle positions
```

### `lib/spacetype/stringGeometry.ts` (pure, Vitest)
No THREE import — returns typed arrays.
```ts
interface WorldPoint { x:number; y:number; fhx:number; fhy:number; bhx:number; bhy:number }
interface CenterSample { x:number; y:number; nx:number; ny:number; s:number } // pt, unit perpendicular, cum arc len
cubicPoint/cubicTangent(...)                  // standard cubic bézier + derivative
sampleString(points: WorldPoint[], stepsPerSeg): CenterSample[]   // STG pairing; arc length accumulated
interface StripSpec { index:number; count:number; stripHeight:number; texAspect:number; roundCap:boolean }
buildStrip(samples, spec): { positions:Float32Array; uvs:Float32Array; indices:Uint32Array }
```
`buildStrip` offsets each sample ±perpendicular between the strip's bottom/top, sets
`U = s/heightRatio`, `V ∈ {0,1}`, emits indexed triangles, and appends the two semicircular
cap fans when `roundCap`.

### `lib/spacetype/stringTextures.ts`
Build the four repeating tiles as `<canvas>` → `THREE.CanvasTexture` (`wrapS=Repeat`,
`wrapT=ClampToEdge`), each returning `{ texture, aspect }`:
`makeTextTile`, `makeGradient1Tile` (across), `makeGradient2Tile` (along), `makeStripesTile`.
Optional outline border drawn into the tile. Text tile reuses the font resolver.

### `lib/spacetype/effects/string.ts` — the `SpaceTypeEffect`
- `controls`: `path` (new kind) · `text` (textList, alternates per string) · `font` ·
  `typeSize` · `stripHeight` · `stripCount` (1–6) · `textureMode` (select) · `speed` ·
  `speedVary` · `roundCap` (select) · `outline` (select) · `fore` (color) · `g1…g5`
  (colors). No scale/rotate (front-locked). Background = surface-level `bgColor`.
- `buildScene`: parse path → map normalized→world → `sampleString` per string → for each
  `(string, strip)` build a `BufferGeometry` from `buildStrip` and a mesh with the tile
  texture chosen by `textureMode` (+ mixture cycling). One mesh per (string, strip), like
  `stripes.ts`. Register cloned textures on `userData.tex` for `disposeRoot`. Text per
  string = atlas row `stringIndex % numTexts`.
- `update(t01)`: per (string, strip) mesh set `tex.offset.x = −t01 · K_strip`, where
  `K_strip = loopTiles(speed · varyFactor(stripIndex, speedVary), 1)` (integer ⇒ seamless).

### `lib/spacetype/effect.ts`
Add `ControlSpec` kind `'path'`: `{ key; label; kind:'path'; default:string; group? }`.

### `components/vue-canvas/StringPathEditor.vue`
SVG overlay positioned over the preview canvas (wrap canvas + overlay in a `relative`
container; overlay tracks the canvas `getBoundingClientRect`). Interaction mirrors STG:
- **click-drag on empty space** → adds a point at the press position; the drag sets the
  handle angle/length (`a = atan2(Δ)`, `hl = althl = |Δ|`).
- **drag a point** → moves it; **drag a handle square** → sets `a` + that handle's length,
  repositions the opposite handle.
- **Enter** → start a new string; **Reset** button → back to `defaultPath()`;
  **Backspace/Delete** on a selected point → remove it.
Renders the bézier paths, point circles, handle lines/squares as SVG. Emits the updated
`StringPathDoc` (→ serialized into the param, debounced → structural rebuild).

### `components/vue-canvas/SpaceTypeSurface.vue` integration
- Render the `'path'` control by mounting `StringPathEditor` (passes the canvas ref +
  current param value, receives updates).
- Add `path` to the structural-rebuild signature (it changes geometry).
- For `effectId === 'string'`: force `projection = 'isometric'`, `panX/panY = 0`, and hide
  the Projection/Pan UI (front-lock). Achieved with a small `watch(effectId)` branch +
  `v-if` on those controls.

## Output

Rides the existing rails unchanged: **poster PNG** (`generateImage`) and **Add to
timeline** video (`generateVideo` → `ensureSpaceTypeBake` → `spacetype_encode`). No Python
changes. The path is baked into geometry; the animation is the seamless scroll.

## Testing

Vitest (node) pure tests:
- `stringPath`: round-trip serialize/parse, tolerant parse of garbage → default, handle
  positions from `(a, hl, althl)`.
- `stringGeometry`: `cubicPoint` endpoints/midpoint, `cubicTangent` direction, `sampleString`
  arc length monotonic + STG pairing, `buildStrip` vertex/index counts, V partition per
  strip, U = s/heightRatio, indices in-bounds, cap vertex counts.
- looping: `K_strip` integer ⇒ `offset(1) − offset(0)` integer (seamless) for varied strips.

Editor + live render verified manually (no `@vue/test-utils` in this repo — suite
convention). I cannot render the GPU/preview headlessly; visual claims are math-checks
unless the user confirms via screenshot.

## Non-goals (v1)

- STG's exact preset buttons (b1–b7) — seed one default path + Reset; presets later.
- STG's bundled fonts — reuse the Google Fonts picker.
- 3D posing, scale, pan for this effect — front-locked; revisit once the editor is proven.
- The strip draw-order interleave (`:255–258`) — only affects painter z-order for
  overlapping strips; our flat non-overlapping strips don't need it. Mixture texture
  assignment uses straight strip index. Include only if visual review shows it matters.
