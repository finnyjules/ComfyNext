# SVG import into 3D Studio — design

**Date:** 2026-07-31
**Status:** Design approved — ready to plan
**Framing:** The first time a vector reaches a Sailor studio as *geometry* rather than as a picture. Vector Type Studio can already write SVG; nothing has ever read it.

## The idea in one line

Drop or paste an SVG and it becomes **real extruded 3D geometry** — one object per path, held together by a group, with every material, modifier and motion the studio already has.

## Why this, and why now

3D Studio's `text` primitive already does the whole job for glyphs: resolve an outline, hand it to `extrudeShapes()`, get a solid. An SVG path is the same operation with a different outline source. The seam has been sitting there since Text shipped.

What blocked it was not the extruder. It was that a logo is a dozen paths, and importing a dozen loose objects with no way to move them together would have been useless. That is why [grouping](2026-07-29-scene3d-grouping-design.md) was built first. This spec spends that groundwork.

**Vector Type Studio's own export comment says it plainly: no node in the product consumes SVG.** This is the first consumer.

## What this is not

**Not a wired input.** Vector Type's SVG and the Compositor's paths are not sources here — that needs an SVG artifact type and port plumbing that does not exist. Both remain plausible follow-ups, and both get cheaper once this lands, because they only have to produce a string this pipeline already accepts.

**Not an SVG renderer.** Gradients, patterns, filters, masks, clip paths, opacity and `<image>` are all discarded. What survives is *outline and fill colour*, because that is what extrudes.

**Not editable-as-vector.** Once imported, a path is geometry. There is no round trip back to SVG and no node editing.

## Object model — a new primitive, not a new object kind

`PrimitiveKind` gains `svgPath`, and `PrimitiveContent` gains the path data:

```ts
export type PrimitiveKind =
  | 'box' | 'sphere' | … | 'text' | 'shape' | 'svgPath'

export interface PrimitiveContent {
  text?: string
  font?: string
  /** An SVG path `d` string with transforms already baked, in SVG coordinate
   *  convention (Y DOWN) — a faithful path, not a scene-space one. The single
   *  stored form for every source element: rect, circle, polygon and path all
   *  normalize to this, so the render path has exactly one thing to understand.
   *  The Y flip happens at geometry build, not here — see below. */
  path?: string
  /** Digest of `path`, used ONLY as a geometry cache key — see below. Computed
   *  once at import as `${path.length}:${hash32(path)}`; a cache key, not a
   *  security boundary, so a cheap non-cryptographic hash is the right tool. */
  pathKey?: string
}
```

**Why a primitive rather than a top-level kind.** Slotting in beside `text` means an imported path arrives with all eight material types, every modifier, motion, the Size row, the gizmo, duplicate and grouping already working. A top-level `svg` object kind (the `GlbObject` shape) would need its own material sync, size handling and motion path for no gain.

**Why a `d` string per object.** Two alternatives were rejected. Storing the **whole SVG source plus an index** on each object costs a 50KB logo about 600KB across twelve objects. Storing it **centrally on the group** couples children to the group's existence, so ungrouping or deleting the group destroys their geometry — and ungrouping is a first-class action. A per-object `d` string is compact, self-contained, and survives every operation grouping introduced.

### The cache-key hazard

`geoKeyFor` builds the geometry cache key with `JSON.stringify(obj.content)` ([engine.ts:247](../../../frontend/app/lib/scene3d/engine.ts)). That is fine for a short text string. A path `d` runs to several KB, and this key is rebuilt **on every sync, for every object** — twelve paths would mean tens of KB of string work per sync, on a path that runs during drags.

So `svgPath` carries `pathKey`, a short digest computed once at import, and `geoKeyFor` uses `pathKey` in place of `path` when present. The digest only has to distinguish *this* object's path from a later replacement of it; it is a cache key, not a security boundary.

## The import pipeline — reuse, don't rebuild

**Corrected 2026-07-31, during planning.** This spec's first draft proposed a new `SVGLoader`-based module. Reading the code showed that pipeline already exists and is trusted by three shipped features, and that one of the first draft's premises was simply false. Both corrections are recorded here rather than quietly applied.

**`svgToPathLayers()` in [useVectorSvg.ts](../../../frontend/app/composables/useVectorSvg.ts) already does the import half.** It runs paper.js headlessly with `expandShapes: true` (so `<rect>`, `<circle>`, `<ellipse>` and `<polygon>` become real paths) and `applyMatrix: true` (so transforms are baked), walks the tree to leaf `Path`/`CompoundPath` items, normalizes the whole import to a target size around its centre, and emits per path: a `d` string, `fill`, `stroke`, `strokeWidth` and `fillRule`. That is this spec's import pipeline, already written and already exercised by the pen tool, SVG file import and the AI vector features.

It returns Compositor `PathLayer`s, which is the wrong output type for 3D. So the **shared core is extracted** into a neutral function both consumers call:

```ts
/** One leaf path from an imported SVG, in normalized import space. */
export interface SvgLeafPath {
  d: string
  fill: string          // CSS colour, or 'none'
  stroke: string        // CSS colour, or 'none'
  strokeWidth: number   // already scaled by the import's normalization factor
  fillRule: 'nonzero' | 'evenodd'
}

export async function svgToLeafPaths(svg: string, opts?: { targetWidth?: number }): Promise<SvgLeafPath[]>
```

`svgToPathLayers` becomes a thin wrapper mapping `SvgLeafPath[]` → `PathLayer[]`, so the Compositor's behaviour is unchanged. This is a targeted improvement to code the feature is already touching, not unrelated refactoring.

**The render half converts `d` → `THREE.Shape[]`** by handing a minimal `<svg><path d="…"/></svg>` wrapper to `SVGLoader`, then `createShapes()`. Two libraries in one pipeline is deliberate: paper is the stronger *parser* and is already wrapped here, while `SVGLoader.createShapes` resolves holes by fill-rule and hands back exactly the `THREE.Shape[]` the extruder wants. Neither is doing the other's job.

**The Y flip lives here, in one place.** SVG's Y points down, three's points up. Doing it at geometry build rather than at import means the stored `d` stays a faithful SVG path (debuggable, and a future SVG re-export stays possible), and — more importantly — it puts the flip in the half that unit-tests, where a `d` fixture with a known topmost point can assert it and a deliberately-disabled flip can be shown to turn that assertion red.

This split also decides what is unit-testable. Paper touches browser globals, so the import half is browser-only and is covered by E2E. The render half needs only `DOMParser`, so it runs under vitest with `// @vitest-environment happy-dom` — and it is the half where the bugs live (Y-flip, holes, fill-rule).

```ts
export interface ImportedPath {
  /** Serialized outline, Y-flipped, transform-baked. */
  d: string
  /** Hex colour from the source `fill`, or null when it had none. */
  color: string | null
  /** Centre of this path's own bounds, in the import's normalized space —
   *  becomes the object's position so the artwork keeps its arrangement. */
  centroid: [number, number]
}

export interface ImportResult {
  paths: ImportedPath[]
  /** Non-fatal things the user should know: unimplemented fill rules, paths
   *  that produced no extrudable area. Surfaced in the UI, never swallowed. */
  notes: string[]
}

export function importSvg(source: string): ImportResult
```

Per source path:

1. **Transforms are already handled.** `SVGLoader.parse()` runs `transformPath` as it walks, so nested `<g transform>` needs nothing from us.
2. **Stroke-only paths are outlined into fills.** A path with `fill: "none"` has an open outline and nothing to extrude. This is not an edge case: Lucide (which this repo uses for every icon), Feather and Heroicons-outline are entirely stroke-only, so without this step the most likely paste — an icon — imports as nothing.

   **The first draft named the wrong tool.** `SVGLoader.pointsToStroke` returns a `BufferGeometry` of stroke *triangles*, not a `Shape`, so it cannot feed `ExtrudeGeometry` at all.

   Instead the outline is constructed with paper.js boolean ops, which are already available: for each subpath, unite one rectangle per segment with one circle at every join and cap. **For round caps and joins this is exact** — and round is precisely what Lucide, Feather and Heroicons specify. Miter and bevel joins are approximated as round, so a sharp-cornered stroked logo loses its points; that is an accepted v1 limitation, not a bug to be surprised by later.
3. **Holes come from fill-rule.** `createShapes()` implements `nonzero` and `evenodd`; anything else `console.warn`s and produces wrong holes. That warning becomes a `note`, not a console message nobody reads.
4. **Emit `d` unflipped.** SVG's Y axis points down and three's points up, but the flip belongs at geometry build, not here — see below.
5. **Normalize the whole import together**, preserving relative positions, so overall bounds land at a sensible scene size — the same job `fitGlbGroup` does for generated GLBs.

## What lands in the scene

One auto-created **group**, named after the file (or `SVG` for a paste), holding one `svgPath` object per path. The group's `parentId` follows the current selection's, so importing while inside a group nests.

**Each object's material colour is seeded from its SVG `fill`,** so a logo arrives looking like itself rather than as a dozen default-grey solids. The obvious objection — a black logo on a dark background is invisible — is answered by a feature that already exists: select the children and set one colour, using the material fan-out grouping shipped.

**Above 40 paths, import asks before committing:** *"This SVG has 247 paths — separate objects, or one merged object?"* At or below 40 it just imports. This turns the flood case into a choice and delivers merged import as a real feature for when you want the logo as a single solid. A silent cap was rejected: truncating someone's artwork without saying so erodes trust more than a dialog costs.

**40 is a starting value, not a measured one.** Wordmarks and logos sit well under it; detailed illustrations and maps sit well over. The implementation should measure the frame-time cost of N separate `svgPath` meshes and move the number if the data disagrees — and it lives in one exported constant so moving it is a one-line change.

**"Merged" means one `svgPath` object whose `d` holds every path's subpaths concatenated.** Not a boolean flag, not a second code path: the same primitive, the same extruder, the same serializer, with all the outlines in one string. `createShapes` then resolves holes across the whole set, which is what makes a merged import look right rather than like overlapping solids. A merged object takes the colour of the first path that had a fill, since one object can only carry one material.

## Entry points

Both live in the toolbar beside the existing GLB upload, which is where file imports already are:

- **File picker**, `accept=".svg,image/svg+xml"`.
- **Paste markup**, a textarea taking raw `<svg>` source. Marginal cost over the picker is a box and a button — and it is likely the *primary* route, since Figma's "Copy as SVG" goes straight to the clipboard with no file in between.

## The `PRIM_GROUPS` collision

`primGroups.ts` carries a drift test asserting its kinds cover `PRIMITIVE_KINDS` **exactly**. Adding `svgPath` breaks it — correctly, because `svgPath` is the one primitive that cannot be placed blank from a menu. It exists only as the product of an import.

The fix is **not** a menu entry. It is an explicit not-directly-placeable exemption in the assertion, named and commented, so the drift test keeps doing its job for every kind that *is* placeable. (This is the shared-catalog-with-two-consumers shape: adding to the table breaks its other reader, and the gate must be derived rather than silently widened.)

## Error handling

- **Unparseable source** → a message naming what failed; nothing is added to the scene.
- **Zero extrudable paths** → a message saying so explicitly. With stroke outlining in place this should be rare, and if it happens the user needs to know the import ran and found nothing, not watch it silently do nothing.
- **Partial success** → import what worked, surface the rest as `notes`. Never drop a path silently.

## Testing

The two halves test differently, and that split is the point of the split.

**Unit — the render half** (`frontend/tests/unit/scene3d-svg-path.unit.spec.ts`, `// @vitest-environment happy-dom` for `DOMParser`). This is where the bugs live, and it takes `d` strings as fixtures so it needs no browser:

- A letter-shaped `d` (outer subpath + inner subpath) resolves the inner one as a **hole**, not a second solid — assert the extruded geometry's area, not just that it built.
- The same geometry under `evenodd` and `nonzero` resolves holes **differently**.
- **Y-flip:** a `d` whose topmost point is known ends up at **+Y** in scene space. **A deliberately-disabled flip must turn this red** — a flipped import looks plausible on a symmetric logo and wrong on everything else, so this assertion must be proven capable of failing before it is believed.
- An unparseable `d` yields no geometry and does not throw.
- `pathKey` changes when `path` changes, and `geoKeyFor` returns a different key as a result — the cache-invalidation contract.

**E2E — the import half** (`frontend/tests/scene3d-svg-import.spec.ts`), because paper.js is browser-only:

- Pasting a two-path filled SVG produces a group with two `svgPath` children, each with its fill colour seeded.
- Pasting a **Lucide icon** (stroke-only, `fill="none"`, round caps and joins) produces geometry with non-zero bounds. This is the case the whole stroke-outlining branch exists for; if it is not covered end to end, it is not covered.
- A nested `<g transform>` lands where the composed transform says.
- Above the threshold the choice dialog appears; choosing *merged* yields exactly one object.

E2E (`frontend/tests/scene3d-svg-import.spec.ts`), modelled on the grouping spec's harness: paste a known multi-path SVG, assert a group appears with the expected child count and that each child is an `svgPath` object with non-empty geometry.

## Risks

**Stroke outlining is the largest new surface, and the least testable.** It runs on the paper.js side, which is browser-only, so it is covered by E2E rather than unit tests. Widths, joins, caps and dasharray each behave differently. Mitigation: implement and verify the case icon sets actually use (uniform width, round joins and caps, no dashes), approximate miter/bevel as round, and let anything more exotic degrade to a `note` rather than a crash. Dasharray is ignored entirely — a dashed stroke outlines as solid.

**`createShapes` hole detection is scanline-based and imperfect** on self-intersecting or degenerate paths. It is three's own implementation and replacing it is out of scope; misdetection becomes a visual artefact, not an error.

**The 40-path threshold is a starting value, not a measured one** — see the note where it is defined. It lives in one exported constant so the implementation can move it once the frame-time cost of N meshes is actually measured.

## Follow-ups, explicitly not in this project

- Wiring Vector Type Studio's SVG output in as a live source.
- "Send to 3D" from Compositor path layers.
- Re-importing / relinking a changed source file.
- Gradient and pattern fills as materials rather than flat colour.
