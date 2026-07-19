# 3D Studio — extruded shapes and 3D text

**Date:** 2026-07-18
**Status:** approved (picked alongside the gradient ramp)
**Scope:** two new geometry sources that both work by extruding a 2D outline —
a shape from Shape Studio, and text set in one of Sailor's own fonts.
Frontend-only.

## Why

Every object in the studio still originates from one of fourteen primitives.
These are the first shapes that come from somewhere else, and both lean on
things Sailor already has rather than copying Spline: Shape Studio's gem
outlines, and the `.otf` files in `public/fonts` that the templates already
measure with opentype.js.

## Key finding

Both features reduce to the same pipeline:

```
2D outline (THREE.Shape[]) → ExtrudeGeometry(depth, bevel) → the existing mesh path
```

so they share one implementation and differ only in where the outline comes
from. Two useful things are already installed, with **no new dependency**:

- **opentype.js** — already a dependency (the template renderer measures text
  with it server-side). It parses the `.otf` files in `public/fonts` and yields
  glyph outlines, so 3D text can use Sailor's real fonts rather than three's
  bundled `typeface.json` families.
- **`gemPoints(config)`** in `app/lib/shapefx/points.ts` — Shape Studio's 2D
  point list, ready to become a `THREE.Shape`.

## Decisions

| Decision | Rationale |
|---|---|
| Both arrive as **new `PrimitiveKind`s** (`'text'`, `'shape'`) rather than a new `SceneObject` kind | They then inherit everything already built — modifiers, the cloner, all seven materials, the Geometry panel's schema-driven rendering, Size, duplication, export. A new object kind would need every one of those paths touched. |
| Non-numeric content lives in a small optional `content?: { text?: string; font?: string; shape?: string }` on `PrimitiveObject` | The `params` bag is a flat number map by design (it is what makes the schema table work). Strings need somewhere else to live, and one optional object keeps parsing and `geoKey` simple. |
| `geoKey` **includes the content bag** | Otherwise editing the text or swapping the font would not rebuild the mesh. |
| Fonts are **loaded and cached asynchronously**, mirroring the GLB loader | An `.otf` is a few hundred KB. The existing `glb.ts` already establishes the pattern: cached by URL, failures not cached, a token guard so a stale load cannot overwrite a newer one. Text renders with a placeholder box until its font resolves. |
| Text is **centred on its own origin** | Consistent with every primitive, and it makes the gizmo, Size and the cloner behave sensibly. |
| Shape mode reads a **preset name**, not a live link to a Shape Studio node | A live cross-node binding is a much larger feature (and a second source of truth). A preset picker covers the intent; wiring an actual Shape Studio node in can come later. |

## Model — `config.ts`

`PRIMITIVE_KINDS` gains `'text'` and `'shape'` (appended — `PRIM_GROUPS` has a
drift test asserting the menu covers every kind in canonical order, so the menu
data gains a matching group).

```ts
export interface PrimitiveContent { text?: string; font?: string; shape?: string }
// on PrimitiveObject:
content?: PrimitiveContent
```

Parsed tolerantly: non-string entries dropped, the object dropped entirely when
empty so absent stays absent. `createPrimitive('text', …)` seeds
`content = { text: 'Text', font: <first available> }`.

### New params

| kind | params |
|---|---|
| `text` | `size` 0.1–2 (0.5), `depth` 0–1 (0.2), `bevel` 0–0.1 (0.01), `bevelSegments` 1–5 (2), `letterSpacing` −0.1–0.5 (0), `curveSegments` 2–12 (6) |
| `shape` | `depth` 0–1 (0.2), `bevel` 0–0.1 (0.01), `bevelSegments` 1–5 (2), `sides` 3–24 (6), `roundness` 0–1 (0.3) |

`sides`/`roundness` drive `gemPoints`; the rest are `ExtrudeGeometry` settings.

## Outline sources — `frontend/app/lib/scene3d/outlines.ts` (new)

```ts
export function shapeOutline(sides: number, roundness: number): THREE.Shape[]
export function textOutline(text: string, font: opentype.Font, opts): THREE.Shape[]
export function loadFont(url: string): Promise<opentype.Font>   // cached, glb.ts pattern
export const AVAILABLE_FONTS: { label: string; url: string }[]  // from public/fonts
```

`textOutline` walks each glyph's opentype path commands (`M`/`L`/`C`/`Q`/`Z`)
into `THREE.Shape`/`THREE.Path` — the closed contours become shapes and the
inner contours (counters in `o`, `a`, `e`) become holes, chosen by winding
direction. Advance widths come from the font, plus `letterSpacing`. The result
is scaled by `size / unitsPerEm` and centred on its own bounding box.

## Engine

`geometryFor` gains the two cases, both ending in `ExtrudeGeometry(shapes, {
depth, bevelEnabled: bevel > 0, bevelThickness, bevelSize, bevelSegments,
curveSegments })`, then centred. Text whose font has not resolved yet returns a
small placeholder box, and the surface re-syncs when the load completes —
exactly how a loading GLB behaves today.

`geoKey` gains the content bag. Everything downstream (modifiers, cloner, facet
variants, gradient bbox, passes) is untouched, because by that point these are
ordinary geometries.

## UI

- The **+ Primitive** menu gains a group (`Text`, `Shape`) alongside the
  existing four.
- The Geometry section renders their numeric params automatically from the
  schema table — no bespoke markup.
- Above those, for `text`: a text input bound to `content.text` and a font
  `StudioSelect` bound to `content.font`. For `shape`: a preset `StudioSelect`.
  These are the first non-schema controls in the Geometry section, so they sit
  above the generated sliders with the existing micro-label styling.
- A font that fails to load shows an inline error in the panel, following the
  GLB error convention already in this surface.

## Error handling

Font loading can fail (missing file, parse error): the object keeps its
placeholder box, the panel shows an inline message, and the failure is not
cached so a retry is possible. Empty text renders nothing rather than throwing.
A degenerate outline (zero-area shape) yields an empty geometry, which the mesh
handles without error.

## Testing

- **Unit (config):** the two new kinds round-trip; `content` round-trips and
  stays absent when empty; malformed content drops; `PRIM_GROUPS` still covers
  every kind in canonical order (the existing drift test).
- **Unit (outlines):** `shapeOutline` returns a closed shape whose point count
  tracks `sides`; `textOutline` against a real `.otf` from `public/fonts`
  produces the expected number of shapes for a known string, puts holes in
  glyphs that have counters (`o` yields one hole), advances the pen so a
  two-character string is wider than a one-character one, and honours
  `letterSpacing`; the font cache returns the same object for the same URL and
  does not cache failures.
- **Unit (engine):** `geometryFor('text', …)` with a resolved font produces a
  non-empty geometry whose depth matches the `depth` param; without a font it
  returns the placeholder; `geoKey` changes when the text or font changes and
  not when an unrelated param does.
- **Browser (real interactions):** add Text from the menu, type into it and
  watch the mesh rebuild; switch fonts; adjust size/depth/bevel; add a Shape and
  adjust sides/roundness; confirm materials (including a multi-stop gradient),
  modifiers (twist a text object) and the cloner all work on both; save/reopen;
  Export bake matches.
- **Gates:** scene3d vitest green; `vue-tsc --noEmit | grep -i scene3d` clean.

## Out of scope

Live binding to a Shape Studio node, SVG import, per-character controls
(individual glyph transforms), text on a path, multi-line text with alignment,
and font upload. Bevel profiles beyond three's built-in.
