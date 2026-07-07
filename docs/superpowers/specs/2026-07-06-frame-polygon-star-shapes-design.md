# Frame — Polygon & Star Shapes (+ boolean confirm/polish) — Design

Date: 2026-07-06
Surface: the Frame = the Compositor MODAL layer editor (`frontend/app/components/vue-canvas/CompositorModal.vue`). Per the user, "Frame" = the modal, not the inline `ArtifactFrameNode`.
Related: [[project_frame_parity_audit]] (this is the next Figma-parity increment after the 4 fidelity slices), [[project_vector_editor]] (paper.js boolean engine).

## Goal

Add two new **parametric, editable** vector shape kinds to the Frame — **polygon** (n-sided) and **star** — matching Figma's behavior where the shape stays live (adjust sides/points/inner-radius/corner-radius forever via the inspector). Ship corner rounding in v1. Separately, **confirm the existing boolean ops** (union/subtract/intersect/exclude, already built on paper.js) produce correct results and give them a **light discoverability polish** so the boolean controls are clearly presented when 2+ shapes are selected.

## Current state (grounding)

From a full read of the compositor (file:line anchors):

- **Layer kinds** (`useCompositorLayers.ts:16`): `'text' | 'rect' | 'ellipse' | 'line' | 'path' | 'image'`. No polygon/star.
- **Coordinate model**: `x,y` normalized to canvas width/height (center position); `w,h` normalized to canvas **width** (resolution-independent). `path` layers store `d` in local units (1 unit = canvas width), centered on bbox midpoint, with a uniform `scale` multiplier and `fillRule`.
- **Rendering**: `drawLocalLayer` → `drawLayerContent` (`useCompositorLayers.ts:903`) branches per kind. `path` renders through `drawPath` (`:1013`) using a **cached Path2D** (`path2dFor`, `:995`), scaling ctx by `(scale||1)*W` and `ctx.fill(p, fillRule)`.
- **Factories** (`useCompositorLayers.ts:328`): `createRectLayer` / `createEllipseLayer` / `createLineLayer` / `createPathLayer`.
- **Toolbar** (`CompositorModal.vue:2701`): rect/ellipse/line buttons → `addRect/addEllipse/addLine` (`useLocalLayerEditor.ts:635`).
- **Boolean ops — ALREADY COMPLETE** (`useVectorSvg.ts:185`): `BooleanOp = 'unite'|'subtract'|'intersect'|'exclude'`, `pathLayerBoolean(layers, op, dims)` backed by paper.js (lazy-loaded, headless `PaperScope`). Wired via `applyBoolean(op)` (`useLocalLayerEditor.ts:688`), which filters selection to booleanable kinds, converts via `shapeToPathLayer`, replaces operands with one result at the top operand's z-index. `BOOLEANABLE = new Set(['path','rect','ellipse','line'])` + `BOOL_OPS` (`CompositorModal.vue:383`).
- **Shape→path conversion** (`shapeToPathLayer`, `useCompositorLayers.ts:372`): rect/ellipse/line → path (bezier for ellipse). Text/image return null.
- **Group resize** (`groupResize.ts` `scaleLayerAbout`): text→fontSize·f, line→w·f, path→scale·f, **else → w·f, h·f**. Any kind carrying w/h (rect/ellipse/image, and now polygon/star) is handled by the else branch with no new code.
- **Single-layer resize**: `resizableKind` gate → 2D edge+corner handles for rect/ellipse/image (`resizeBox.ts`).
- **Inspector** (`CompositorModal.vue:2974`): shared Fill/Stroke/Size(W/H+aspect)/Rotation/Opacity/Distort/Blend/Effects/Mask/Cloner for any shape; per-kind blocks add specifics (rect has Corner radius `:3096`).
- **Tests**: `compositor.unit.spec.ts`, `compositor-fills.unit.spec.ts`. No dedicated vector/boolean unit tests.

## Design decisions (user-confirmed)

1. **Parametric & editable** new kinds (not baked-to-path).
2. **Corner rounding included in v1.**
3. **Boolean**: confirm correctness live + light discoverability polish (no re-architecture).
4. Default polygon = **6 sides** (hexagon). Default star = **5 points, innerRatio 0.5**.
5. `cornerRadius` is a **0–1 ratio** (fraction of each corner's shorter adjacent half-edge), scale-invariant.

## Architecture

### New layer types (`useCompositorLayers.ts`)

Extend the union: `export type LocalLayerKind = 'text' | 'rect' | 'ellipse' | 'line' | 'path' | 'image' | 'polygon' | 'star'`.

```ts
export interface PolygonLayer extends LayerCommon {
  kind: 'polygon'
  w: number; h: number            // bbox, normalized to canvas width
  sides: number                   // integer >= 3
  cornerRadius: number            // 0..1 ratio (scale-invariant)
  fill: string; stroke: string; strokeWidth: number
}
export interface StarLayer extends LayerCommon {
  kind: 'star'
  w: number; h: number
  points: number                  // integer >= 3
  innerRatio: number              // 0.01..0.99 (inner radius / outer radius)
  cornerRadius: number            // 0..1 ratio
  fill: string; stroke: string; strokeWidth: number
}
```

Both extend `LayerCommon`, so they get x/y/rotation/skew/cornerPin/opacity/visible/blend/effects/mask/groupId/name/locked/cloner/animation for free.

### Pure geometry module (NEW) — `app/lib/compositor/polygonGeometry.ts`

The crux; pure + unit-tested. All output in **local units** (1 = canvas width), centered on origin, matching the PathLayer `d` convention.

```ts
export interface Pt { x: number; y: number }

// N vertices on the (w/2, h/2) ellipse, first at top (angle = -90°), clockwise.
export function polygonVertices(sides: number, w: number, h: number): Pt[]

// 2*points vertices alternating outer (w/2,h/2) and inner (innerRatio*那) radii, first outer at top.
export function starVertices(points: number, innerRatio: number, w: number, h: number): Pt[]

// Build an SVG `d`. cornerRadius in 0..1: per corner, r = cornerRadius * min(halfEdgePrev, halfEdgeNext);
// inset along both adjacent edges by r, join with a quadratic curve (control = the original vertex).
// cornerRadius <= 0 → straight polygon (M/L/Z).
export function roundedPolygonPath(vertices: Pt[], cornerRadius: number): string

// Convenience composers used by BOTH rendering and shapeToPathLayer:
export function polygonPathData(sides: number, w: number, h: number, cornerRadius: number): string
export function starPathData(points: number, innerRatio: number, w: number, h: number, cornerRadius: number): string
```

Clamps live here (defense in depth): `sides = Math.max(3, Math.round(sides))`, `points = Math.max(3, Math.round(points))`, `innerRatio = clamp(innerRatio, 0.01, 0.99)`, `cornerRadius = clamp(cornerRadius, 0, 1)`, and per-corner `r` clamped to the shorter adjacent half-edge so arcs never overlap/self-intersect. Near-zero w or h → return `''` (caller skips render).

### Factories (`useCompositorLayers.ts`)

```ts
export function createPolygonLayer(partial: Partial<PolygonLayer> = {}): PolygonLayer {
  return { id: newId(), kind: 'polygon', x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.24, h: 0.24, sides: 6, cornerRadius: 0,
    fill: '#3b82f6', stroke: '', strokeWidth: 0, ...partial }
}
export function createStarLayer(partial: Partial<StarLayer> = {}): StarLayer {
  return { id: newId(), kind: 'star', x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.24, h: 0.24, points: 5, innerRatio: 0.5, cornerRadius: 0,
    fill: '#f59e0b', stroke: '', strokeWidth: 0, ...partial }
}
```
(Fill defaults follow the existing palette convention — no purple; final hex chosen in implementation to match the rect/ellipse defaults family.)

### Rendering (`drawLayerContent`, `useCompositorLayers.ts`)

Add a `polygon`/`star` branch that computes `d` from params and draws through the **existing `drawPath`** — no new canvas primitive:

```ts
else if (layer.kind === 'polygon' || layer.kind === 'star') {
  const d = layer.kind === 'polygon'
    ? polygonPathData(layer.sides, layer.w, layer.h, layer.cornerRadius)
    : starPathData(layer.points, layer.innerRatio, layer.w, layer.h, layer.cornerRadius)
  if (!d) return
  drawPath(ctx, { ...layer, kind: 'path', d, bbox: { w: layer.w, h: layer.h }, scale: 1, fillRule: 'nonzero',
                  fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth } as any, W)
}
```

The derived `d` is never stored on the layer — params are the single source of truth, so editing Sides live re-renders. Path2D caching in `path2dFor` keys on the `d` string, so identical params reuse the cache.

### Boolean participation (`shapeToPathLayer` + sets)

Add polygon/star branches to `shapeToPathLayer` (`useCompositorLayers.ts:372`) returning a real `PathLayer` built from `polygonPathData`/`starPathData` (bbox `{w,h}`, scale 1, preserving x/y/rotation/opacity/fill/stroke/strokeWidth). Add `'polygon','star'` to `BOOLEANABLE` (`CompositorModal.vue:383`) and to the `applyBoolean` operand filter (`useLocalLayerEditor.ts:688`). Result: polygons/stars can union/subtract/intersect/exclude with each other and with rect/ellipse/line/path.

### Single-layer & group resize

- Add `'polygon','star'` to `resizableKind` → full 2D edge+corner handles via `resizeBox` (they carry w/h, so no new geometry).
- `scaleLayerAbout` else branch already covers them (w·f, h·f). `sides`/`points`/`innerRatio`/`cornerRadius` are dimensionless/ratio → correctly untouched by scale. No change to `groupResize.ts`.

### Toolbar (`CompositorModal.vue`)

Two buttons after the line button (`:2707`): lucide `Hexagon` (polygon) and `Star` (star), `@click="addPolygon"` / `@click="addStar"`. **Gotcha:** lucide icons must be **explicitly imported** in the vue-canvas component (established project gotcha) — add `Hexagon, Star` to the existing lucide import. Handlers in `useLocalLayerEditor.ts` next to `addRect`: `function addPolygon() { addLocal(createPolygonLayer()) }`, `function addStar() { addLocal(createStarLayer()) }`, and export them.

### Inspector (`CompositorModal.vue:2974+`)

Per-kind blocks (mirroring rect's Corner-radius block `:3096`):
- **polygon**: number input **Sides** (min 3, step 1) + **Corner radius** (0–1, shown as 0–100% or a slider consistent with existing controls).
- **star**: number input **Points** (min 3, step 1) + **Inner radius** slider (0.01–0.99) + **Corner radius** (0–1).
Shared Fill/Stroke/Size(W/H+aspect)/Rotation/Opacity/Distort/Effects/Mask already apply (they key off fill/stroke/w/h). Writes go through the existing patch/commit path with `recordHistory` coalescing, same as rect radius.

### Boolean discoverability polish (light)

Locate where `BOOL_OPS` buttons render relative to the multi-select (align/distribute) toolbar. Ensure the boolean cluster is clearly presented (labeled/grouped) when `selectedPathCount >= 2`. No re-architecture; if already clearly placed, this reduces to a live correctness confirmation only.

## Data flow

Create (toolbar) → factory → `addLocal` → `localLayers`. Render: `drawLocalLayer` → `drawLayerContent` → polygon/star branch → `polygonPathData`/`starPathData` → `drawPath`. Edit params (inspector) → patch → reactive re-render (params are source of truth; `d` re-derived). Resize / group-resize → w/h change → `d` re-derived. Boolean → `shapeToPathLayer` (params → `d`) → `pathLayerBoolean` (paper.js) → single `PathLayer` result.

## Error handling

- `sides`/`points`: integer, clamp ≥3 (factory, geometry, and inspector input all guard).
- `innerRatio`: clamp 0.01–0.99.
- `cornerRadius`: clamp 0–1, with per-corner radius clamped to the shorter adjacent half-edge so arcs never self-intersect at sharp angles (e.g. a thin star spike).
- Near-zero `w`/`h`: `polygonPathData`/`starPathData` return `''`; render branch early-returns; `shapeToPathLayer` returns null.

## Testing strategy

**Unit** (`frontend/tests/unit/polygon-geometry.unit.spec.ts`, hand-computed expectations):
- `polygonVertices`: count = sides; first vertex at top (x≈0, y≈-h/2); square (sides 4) vertices at expected coords; sides<3 clamps to 3.
- `starVertices`: count = 2·points; alternating outer/inner radii; innerRatio scales inner vertices.
- `roundedPolygonPath`: cornerRadius 0 → only M/L/Z (no `Q`); cornerRadius>0 → contains `Q` arcs; per-corner clamp prevents overlap on a tight star spike (radius capped).
- `polygonPathData`/`starPathData`: non-empty valid `d`; empty string on w=0.
- Clamp coverage: innerRatio and cornerRadius bounds.

**Browser** (`:3017` /dev/frame-lab): create polygon (hexagon) → change Sides to 3 and 8 → add star → change Points / Inner radius / Corner radius → resize a polygon (edge + corner) → group-resize a polygon+rect together → boolean-subtract a star from a rect. Screenshot each state. Confirm the derived shape re-renders on param change and that boolean produces the expected cut.

## Files touched

- `app/lib/compositor/polygonGeometry.ts` (NEW pure module)
- `app/composables/useCompositorLayers.ts` (types, factories, `drawLayerContent` branch, `shapeToPathLayer` branches)
- `app/composables/useLocalLayerEditor.ts` (`addPolygon`/`addStar`, boolean operand filter)
- `app/components/vue-canvas/CompositorModal.vue` (toolbar buttons + lucide import, inspector blocks, `BOOLEANABLE` set, `resizableKind` set, boolean UI polish)
- `frontend/tests/unit/polygon-geometry.unit.spec.ts` (NEW)

## Out of scope (deferred, YAGNI)

Per-vertex independent corner radii; concave/pinwheel star variants beyond simple inner-ratio; polygon-specific rotation snapping; storing baked `d` (params stay the source of truth); inline `ArtifactFrameNode` toolbar (modal only, per the Frame convention).
