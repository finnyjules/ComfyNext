# Slot — Expressive Studio effect (design)

Date: 2026-08-27
Status: approved (brainstorm), pending implementation

## Summary

A new Expressive Studio (Space Type) effect, **Slot**: a row of fixed **slot windows**
(apertures that hard-clip their contents). Behind each window a vertical **reel** of
content scrolls with motion blur, then the reels **decelerate and land left-to-right in
sequence** (staggered), each snapping onto its target with a little overshoot, so a
phrase resolves one unit at a time. The animation **rotates between multiple messages**,
cycling message 0 → 1 → … → 0 over one seamless loop, with selectable **filler** streaming
past the aperture between landings.

It is one new plugin implementing the existing `SpaceTypeEffect` contract
(`app/lib/spacetype/effect.ts`) — no engine or surface changes, matching the documented
"new effect = one module + one registry line" seam.

## Concept (the four decisions)

- **Reel unit** (`reelUnit`): switchable **word** (one slot per word) or **char** (one slot
  per character).
- **Motion**: **staggered settle** — spin → cascading left-to-right land → hold, per message.
- **Reel shape** (`reelShape`): switchable **flat strip** (hard-clipped filmstrip) or
  **curved drum** (glyphs wrap a cylinder, neighbours curl away and dim).
- **Rotation + filler**: messages are an ordered list the reels rotate through; filler is
  drawn from the messages, a preset glyph set, geometric shapes, or a custom token list.

## Architecture

Rendering unit: **one quad (mesh) per slot window.** This is what makes clipping,
blur, and the drum curve cheap and correct:

- **Reel = tall alphaMap.** Each slot's cells (land cells + filler) are painted, stacked
  vertically, into one offscreen canvas as a **white mask** (via `layoutChars` for
  text/glyphs, a small shape painter for geometric shapes). Used as the mesh's `alphaMap`
  with `wrapT = RepeatWrapping`; `repeat.y = 1/cellCount` shows exactly one cell in the
  window; scrolling `offset.y` moves the reel. The window quad is the aperture, so the reel
  is **hard-clipped for free** — content outside the window is never drawn.
- **Fill pinned to the aperture.** The word fill (solid/gradient/ombre/grid/noise) paints
  through the glyph mask exactly as `ring.ts` does (`map` on channel 0, glyph mask as
  `alphaMap`), but the fill is **pinned to the window** (not scrolled), so a gradient reads
  top→bottom of each slot while glyphs scroll through it. Solid fill → flat `color`, no map.
- **Custom shader (`onBeforeCompile`)** on the reel material adds three uniforms:
  - `uBlur` — velocity-scaled vertical motion blur: average M alphaMap samples along V.
  - `uCurve` — drum bend + foreshorten + neighbour dim (vertex displacement in Z + a
    `1 - k*|vUv.y-0.5|` brightness term); 0 = flat strip.
  - `uEdge` — aperture edge falloff: dim/fade near the top/bottom window edges.
- **Slot background + frame.** A `slotFill` quad behind the reel; an optional frame stroke
  (`frameWidth`/`frameColor`) drawn as a thin border mesh.
- **Layout.** Slots laid out in a row, wrapping to `columns`; `slotGap` between; `align`
  (left/center) sets how a short message sits when slot count exceeds its length.

### Files

- `app/lib/spacetype/effects/slot.ts` — the `SpaceTypeEffect` (controls, `buildScene`,
  `update`, `liveKeys`, `loopRates`). Registered in `effects/index.ts` (one import + one
  array entry, after `loftEffect`).
- `app/lib/spacetype/slotGeometry.ts` — **pure, unit-tested** helpers:
  - `buildReel(params)` → `{ slotCount, cells: string[][] }`: per-slot ordered cell tokens
    (land cells + interleaved filler), derived from messages, reelUnit, filler source, and
    fillerDensity. Deterministic (seeded) filler.
  - `reelScroll(t01, slotIndex, timing)` → `{ offsetCells, velocity, dim }`: the scroll
    position (in fractional cells), current velocity (drives blur), and spin-dim, from the
    staggered-settle + rotation timing. **This is where the seamless loop lives.**
  - Small shape-token catalog + `drawShapeToken(ctx, id, box, color)` used by the canvas
    painter in `slot.ts`.

### Seamless loop model

The **entire** message rotation is authored as one function of `t01 ∈ [0,1)`, so
`loopRates()` returns `[1]` (a single loop). The loop divides into `M` equal segments
(one per message). Within segment `m`: **hold** message `m` (readable) for `hold` fraction,
then **spin + settle** to message `m+1` over the rest, staggered across slots by `stagger`.

- Per-slot scroll `s_j(t01)` is **monotonic**, advancing exactly `(1 + fillerDensity)` cells
  per segment, so over `M` segments it advances `M·(1+fillerDensity)` = the full strip
  length → `offset.y` wraps cleanly (RepeatWrapping). Seamless by construction: segment
  `M-1` settles onto message `M ≡ 0`, matching `t01 = 0`'s hold of message 0.
- **Overshoot** adds a small localized bounce at each settle; velocity is `ds/dt` (≈0 during
  hold, high during spin) and drives `uBlur`.
- Unit tests assert: `offsetCells(t01=0) ≡ offsetCells(t01→1) (mod stripLen)`, velocity is
  ~0 at every hold, lands hit integer cell offsets, and the stagger orders slot settle times
  left→right.

## Controls (mapped to existing `SPACE_TYPE_SECTIONS` — no new groups)

**Type**
- `messages` — `textList`, the phrases the reels rotate between. Default e.g. `MAKE IT REAL` / `SHIP TODAY`.
- `reelUnit` — `select` `word|char`, default `word`.
- `font` — `font`, default `Inter`.
- `typeWeight` — `slider` 100..900, default 700.
- `typeSize` — `slider` 40..320, default 180.
- `tracking` — `slider` -20..80, default 0.
- `fillerSource` — `select` `messages|glyphs|shapes|custom`, default `messages`.
- `glyphSet` — `select` `alpha|digits|symbols|mixed`, default `mixed`, `showIf fillerSource=glyphs`.
- `shapeSet` — `select` `basic|geometric`, default `geometric`, `showIf fillerSource=shapes`.
- `fillerTokens` — `textList`, default `A B C`, `showIf fillerSource=custom`.
- `fillerDensity` — `slider` 0..12, default 4 (filler cells between landings).

**Color**
- `wordFill` — `fillList` (one global fill, ring-style; parsed by a `resolveFill` that
  tolerates a bare object or `[fill]`). **First `fillList` control ⇒ its default MUST be
  `defaultFillsFor(1,'slot')`** (a 1-element seeded-palette array) so the palette guard passes
  cleanly — `resolveFill` reads `v[0]`. (ring/cornerpin/shutter/loft override with custom
  defaults and already "fail" that soft guard on main; slot will not add a 5th red.)
- `slotFill` — `fillList` (one fill), slot background. Second `fillList`, so the palette guard
  does not check it; default a bare `[{solid dark}]` array. Parsed by the same `resolveFill`.

**Stroke**
- `frameWidth` — `slider` 0..0.4, default 0.
- `frameColor` — `color`, default `#000000`, `showIf frameWidth≠0`.

**Layout**
- `reelShape` — `select` `flat|drum`, default `drum`.
- `curveAmount` — `slider` 0..1, default 0.6, `showIf reelShape=drum`.
- `slotAspect` — `slider` 0.4..3 (w/h), default 0.9.
- `slotGap` — `slider` 0..1, default 0.12.
- `columns` — `slider` 1..12, default 6 (wrap after N slots).
- `align` — `select` `left|center`, default `center`.
- `edgeFalloff` — `slider` 0..1, default 0.3.

**Motion**
- `direction` — `select` `up|down`, default `up`.
- `stagger` — `slider` 0..1, default 0.4 (left→right landing delay).
- `overshoot` — `slider` 0..1, default 0.3 (landing bounce).
- `hold` — `slider` 0..0.9, default 0.4 (readable dwell per message).
- `blur` — `slider` 0..1, default 0.6 (max motion blur while spinning).

**Look**
- `spinDim` — `slider` 0..1, default 0.3 (dim/desaturate while moving).

**Transform** (framing parity with ticker)
- `scale` — `slider` 0.4..2.5, default 1.2.
- `rotateX` / `rotateY` / `rotateZ` — `slider` -1.8..1.8, default 0.

**liveKeys** (no structural rebuild): `direction`, `stagger`, `overshoot`, `hold`, `blur`,
`spinDim`, `edgeFalloff`, `curveAmount`, `slotGap`, `scale`, `rotateX`, `rotateY`,
`rotateZ`. Everything that changes the reel atlas or slot geometry (messages, reelUnit,
font, typeWeight, typeSize, tracking, wordFill, slotFill, filler*, columns, reelShape,
slotAspect, frameWidth) is structural.

## Scope cuts (YAGNI v1)

- Messages are plain text (no per-word images / rich `contentList`).
- One global `wordFill` (no per-slot colours).
- Geometric shapes are a fixed curated catalog.
- Shader fills as the reel paint are not special-cased (static/gradient/solid fills only for
  v1; a shader fill renders as its first frame). Easy later extensions, all additive.

## Testing

- **Unit** (`tests/unit/slot-geometry.unit.spec.ts`): `buildReel` cell layout (counts, land
  positions, padding for short messages, filler determinism, char vs word); `reelScroll`
  seamlessness (t01 0≡1), zero-velocity holds, integer landings, stagger ordering, direction
  sign.
- **Sections guard**: existing `tests/unit/spacetype-sections.unit.spec.ts` must still pass
  (all groups are in `SPACE_TYPE_SECTIONS`).
- **Palette guard** (`tests/unit/spacetype-palette.unit.spec.ts`): checks the FIRST `fillList`
  control's default `=== defaultFillsFor(JSON.parse(default).length, id)`. Baseline: 4
  pre-existing reds on main (ring, cornerpin, shutter, loft) from intentional overrides — NOT
  regressions. `slot`'s `wordFill` uses `defaultFillsFor(1,'slot')` so slot passes and adds no
  red. Re-verify this baseline before/after so the 4 aren't mistaken for slot regressions.
- **Typecheck**: `npx vue-tsc --noEmit` clean at the effect's own types (baseline-anchored).
- **Live**: verify in the Expressive Studio via the dev-server browser — the effect renders,
  reels spin, land staggered, rotate messages, and the loop is seamless.
