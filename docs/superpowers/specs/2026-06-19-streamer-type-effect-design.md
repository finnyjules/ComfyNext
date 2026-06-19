# Streamer — Space Type effect

**Date:** 2026-06-19
**Status:** Design approved, pending spec review

## Goal

Add a new Space Type effect, **Streamer**, that faithfully reproduces the
Space Type Generator "Ribbon" generator's signature look
(`spacetypegenerator.com/ribbon`, specifically the "Streamers" preset): flat
per-character tiles arranged around a closed racetrack/oval loop, stacked into
multiple ribbons, gradient-colored along the text, with the text scrolling
around the loop and looping seamlessly. Distinct from the existing wave-based
`ribbon` effect.

Reference: STG `sketch_ribbon.js` (p5.js, read from the live site). Copyright
Kiel Mutschelknaus, CC BY-NC-SA 4.0 — we reproduce the *technique/look*, not the
source. Note that in our codebase's licensing terms this is consistent with the
other "source-matched"/"source-inspired" STG effects (cascade, cylinder, coil,
field, onionburst, boost).

## Decisions (from brainstorming)

- **New effect**, not an extension of the existing wave `ribbon` effect.
- **Match the STG screenshot closely** (geometry, gradient steps, stacking, tilt).
- **Render approach: instanced flat tiles** — one InstancedMesh of per-character
  planes placed around the loop exactly like STG (faceted, not a swept strip),
  with a glyph atlas + per-instance color/char/side via a custom shader.
- **Glyphs: the font picker** — render the chosen Google font (stroked/filled
  per `typeStroke`) onto the tiles; not STG's mono stroke font.

## STG algorithm (reference, distilled from sketch_ribbon.js)

- **Loop cycle** = `2*segmentCount + 2*segmentCount*middleStretch` character
  slots. `radius = segmentCount*segmentSpace/PI`. `segmentLength = segmentCount*segmentSpace`.
- **Per character index `i`**, `step = i % cycle`, four phases:
  1. top straight (`step <= segmentCount*middleStretch`): `xCenter=step*segmentSpace`,
     `yCenter=jumper*radius*4`, `rot=0`, `side=1`, `textDirect=-1`.
  2. right semicircle: `xCenter=segmentLength*middleStretch`, `yCenter=jumper*radius*4`,
     `rot=(step-segmentCount*middleStretch)*sinStep`, `side=1`, where `sinStep=PI/segmentCount`.
  3. bottom straight: `xCenter=segmentLength*middleStretch - step'*segmentSpace`,
     `yCenter=radius*2 + jumper*radius*4`, `rot=0`, `side=-1`, `textDirect=1`.
  4. left semicircle: `xCenter=0`, `yCenter=radius*2 + jumper*radius*4`,
     `rot=-step'*sinStep + PI*middleStretch`, `side=-1`.
  `jumper = floor(i/cycle)` stacks extra loops vertically when the text run
  exceeds one cycle.
- **Per-tile transform**: `translate(xCenter, yCenter + ribbonYOffset, ribbonZ)`
  → `rotateZ(rot)` → `translate(0,-radius)` → `rotateX(PI/2)`; draw a
  `rect(segmentSpace, depth)` (front = ribbonColor, back at +side = bSide/text
  color), then the glyph stroked in text color, offset by `typeX/typeY`
  (tracking/typeHeight).
- **Ribbons**: `for j in 0..count-1`, offset `y += j*ribbonOffset*radius*2`,
  `z += j*depth*ribbonSpacing` (alternate mode interleaves: `y += (j%2)*radius*2`,
  `z += j*depth*ribbonSpacing`).
- **Scroll**: `i` runs `[frameCount*speed, runLength + frameCount*speed)`;
  `yCrawl` re-centers. Text char at window slot `k` = `runLength-1-k`.
- **Gradient** (`setGradient`): 2–5 stops; color is a function of the window
  slot `k` (0..runLength), NOT the character identity — so colors are fixed per
  slot and the text scrolls through the gradient. The glyph + back face use the
  single text color.
- **Streamer preset**: segmentSpace 23, segmentCount 22, typeHeight 25,
  tracking 40, typeStroke 2, speed 0.4, depth(ribbonHeight) 56,
  middleStretch(ribbonStretch) **0** (pure ovals), count 4, ribbonSpacing(z) 1.62,
  ribbonOffset(x) 1.3, scale 1.04, rotX −1.91, rotY 0.56, rotZ −0.53,
  gradient `#FFFC79 → #FF2F92 → #011993 → #0096FF` (4 stops), bg `#212121`,
  text `#ffffff`.

## Architecture

New effect file `frontend/app/lib/spacetype/effects/streamer.ts` implementing
`SpaceTypeEffect`, registered by appending to `SPACE_TYPE_EFFECTS` in
`effects/index.ts`. No core changes.

### `frontend/app/lib/spacetype/streamerLayout.ts` (pure, unit-tested)

```ts
export interface TilePose { xCenter: number; yCenter: number; rot: number; side: number; textDir: number; jumper: number }
export function streamerRadius(segmentCount: number, segmentSpace: number): number
export function streamerCycle(segmentCount: number, middleStretch: number): number   // slot count per loop
export function tilePose(i: number, segmentCount: number, segmentSpace: number, middleStretch: number): TilePose
export function gradientColorAt(slot: number, runLength: number, stops: string[]): { r: number; g: number; b: number }  // lerp along stops
```

`tilePose` is the 4-phase port (no Three.js, no canvas). `gradientColorAt`
mirrors STG's `setGradient` segmenting (runLength split into `stops.length-1`
bands, lerp within each). Returns linear-ish rgb in 0..1 for instance colors.

### Glyph atlas (in `streamer.ts`)

Build one `CanvasTexture` atlas: collect unique characters from the (uppercased
as-typed) text, lay them in a grid, render each centered in the resolved font as
a **white-on-transparent alpha matte**, stroked at `typeStroke` px (filled when
`typeStroke` is 0 so the glyph is still visible), with `typeHeight`/`tracking`
offsets baked into cell placement. Produce `cellUV[char] = {u,v,du,dv}`. Rebuilt
in `buildScene` and re-run once after `document.fonts.load` resolves.

### Instanced rendering

One `InstancedMesh(PlaneGeometry(1,1), shaderMaterial, count*runLength)`. Per
instance:
- `instanceMatrix`: composed from `tilePose` + ribbon `j` offsets + per-tile
  scale `(segmentSpace, depth, 1)` (built with `THREE.Matrix4`/`Object3D` and
  `setMatrixAt`).
- instanced attributes: `aCellUV` (vec4 atlas cell), `aColor` (vec3 front color),
  `aSide` (float; +1 front / −1 back).

Custom `ShaderMaterial` (`DoubleSide`):
- vertex: standard instanced transform; pass `vUv`, `aCellUV`, `aColor`, `aSide`.
- fragment: `glyphA = texture2D(uAtlas, cellUV.xy + vUv*cellUV.zw).a`;
  `face = aSide >= 0 ? aColor : uBSide` (or discard the tile fill when
  `uNoStripes`); `gl_FragColor = vec4(mix(face, uTextColor, glyphA), 1.0)`.
  When `uNoStripes`, render only the glyph over transparent (alpha = glyphA).

### Animation / update

`update(t01)`: `scroll = t01 * cycle * loops` (whole cycles for a seamless loop;
`speed` scales how many cycles per loop). Recompute each instance's
`instanceMatrix` (tiles crawl) and `aCellUV` (text scrolls through slots);
`aColor` is fixed per slot. Mark `instanceMatrix.needsUpdate` + attribute
update. `runLength` = number of visible tiles per ribbon (derived from text
length, capped to a sane max e.g. 240 to bound instance count).

### Rendering env

Returns a `THREE.Object3D`; reuses the engine's `scale` + `rotateX/Y/Z` scene
params (same pattern as `ribbon.ts`) and the output-aspect handling. Perspective
camera by default; scale tuned so the loop frames like STG. (Projection switch
deferred unless the look needs ortho.)

## Controls + defaults (Streamer preset)

- **Type:** `text` (textList, default the STG sea quote or a short default),
  `font` (default `IBM Plex Mono` if available else `Inter`), `typeHeight`
  (0–100, 25), `tracking` (0–100, 40), `typeStroke` (0–6, 2).
- **Ribbon:** `segmentSpace` (4–60, 23), `segmentCount` (3–50, 22),
  `ribbonHeight` (8–200, 56), `ribbonStretch` (0–6, 0), `ribbonCount` (1–10, 4),
  `ribbonSpacing` (1–3, 1.62), `ribbonOffset` (0–2, 1.3), `alternate`
  (on/off, off).
- **Color:** `fills` (fillList; the 2–5 gradient stops + text color reuse the
  existing fill control — A-side gradient via stops), `bSideColor` (#212121-ish
  dark / matches text), `textColor` (#ffffff), `noStripes` (off).
- **Motion:** `speed` (0–3, 0.4; 0 = stop).
- **Transform:** `scale` (0.4–2.5, 1.04), `rotateX` (−3.14..3.14, −1.91),
  `rotateY` (0.56), `rotateZ` (−0.53).

Gradient stops: represent as a small fixed set of color controls or via the
`fillList` colors. Decision: use a dedicated `fillList`-style list of up to 5
colors for the gradient stops (reuse the palette pattern from sliceGlitch /
ribbon `fills`), reading `.a` of each entry as a stop; `textColor`/`bSideColor`
are separate color controls.

## Out of scope (v1)

- STG mono stroke font emulation (using the font picker instead).
- Save-loop GIF specifics (we reuse the existing motion-bake rails).
- B-side "No stripes" interplay edge cases beyond glyph-only rendering.
- Per-ribbon independent gradients (gradient is shared along the text run).

## Verification plan

1. Unit tests for `streamerLayout` (`tilePose` phases/loop-closure/radius/cycle;
   `gradientColorAt` stop mapping + endpoints).
2. Standalone screenshot loop (the `/sgtest`-style harness, extended or a new
   page) against the STG Streamer preset until it reads like STG; user look
   sign-off.
3. In-app SpaceTypeSurface check: appears in the picker, controls render
   (groups Type/Ribbon/Color/Motion/Transform — all already in the Surface
   `SECTION_ORDER` whitelist), animates + loops, bakes.

## Open implementation notes

- Confirm `ribbon.ts`'s scene-rotation/scale wiring and reuse the same param
  keys so the engine applies them.
- Bound `runLength`/instance count for very long text.
- IBM Plex Mono availability in the font picker — fall back to Inter/mono stack
  if not resolvable.
