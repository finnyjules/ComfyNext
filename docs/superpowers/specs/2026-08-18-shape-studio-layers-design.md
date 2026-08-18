# Shape Studio — Stacked Shape Layers with Colourable Intersections

Date: 2026-08-18
Status: Approved (brainstorm), implementing

## Plain-language summary

Today Shape Studio makes **one** mark — a single base shape cloned and folded into a flat
logo. This feature lets you **stack several independent shape layers** (like Gradient and
Shader studios do), each its own full mark with its own shape, arrangement, colours, and
now an **X/Y offset, scale and rotation** so you can slide layers into overlap. Where two
or more layers cross, that **intersection region becomes its own colourable face** — you
define a palette of fills plus an order-logic, exactly like the existing "pieces" overlap
colouring, but now across whole layers instead of clones of one shape.

Interaction mirrors the other studios: a **layer rail on the left** (add/remove/reorder/
toggle). Selecting a layer edits **that layer** on the right. **Deselecting** (no layer
selected) turns the right panel into the **composite properties**: the Frame (padding /
aspect / size) and the **Intersections** palette.

Everything stays vector: preview, PNG bake, and SVG export all render from one shared
`VectorShape[]`, so they remain pixel-identical, and existing single-mark nodes keep
rendering exactly as before.

## Goals

- Stack 1..6 shape layers, each a complete independent mark (full reuse of today's
  `GeoShapeConfig` and its whole controls panel, scoped to the active layer).
- Per-layer placement: offset X/Y, scale, rotate; plus opacity and blend mode.
- Cross-layer **intersection colouring**: a stack-level palette (`fills[]`) + order-logic
  (`GeoFillOrder`) + `crossingMode` (depth vs split), painted over the overlaps.
- Left layer rail matching the other studios; selection-driven right panel; a
  no-selection state that edits Frame + Intersections.
- Canvas / PNG / SVG parity preserved; existing nodes migrate with zero visual change.
- Agent can edit the active layer (`layer.*`) and the stack (`overlap.*`, `padding`),
  reusing `makeConfigParams`.

## Non-goals (this spec)

- On-canvas drag of a layer's offset (numeric Placement controls only in v1; drag is a
  fast-follow).
- Cross-layer boolean *merge into one path taking the base layer's paint* (we chose the
  independent-layers + separate overlap-palette model, not the Pathfinder/boolean-group
  model).
- Per-layer animation/motion tracks (Shape Studio has none today).

## Data model

Persisted blob key stays `node.data.properties.sailor_shapeStudio`. Its shape changes from
`{ config, canvasW, canvasH, aspectKey }` to `{ doc, canvasW, canvasH, aspectKey }`.

```ts
const LAYER_MAX = 6

interface GeoLayer {
  layerId: string            // stable id — survives reorder; anchors agent + overlap refs
  enabled: boolean           // eye toggle in the rail
  mark: GeoShapeConfig       // the ENTIRE existing single-mark config, per layer, unchanged
  offset: { x: number; y: number; scale: number; rotate: number } // NEW placement (doc units / deg)
  opacity: number            // 0..1 — how this layer's own paint composites
  blend: BlendKind           // shared studio blend vocab (~/lib/studio/blend)
}

interface GeoOverlap {
  enabled: boolean
  fills: Paint[]             // the intersection palette ("multiple fills"); always non-empty
  order: GeoFillOrder        // the "logic": created/depth/leftRight/topBottom/rows/columns/centerOut/around
  crossingMode: GeoCrossingMode // 'depth' = one colour per overlap depth; 'split' = each crossing face its own colour
}

interface GeoStudioDoc {
  layers: GeoLayer[]         // 1..LAYER_MAX, index 0 = bottom/base
  overlap: GeoOverlap        // stack-level cross-layer intersection colouring
  padding: number            // LIFTED out of the mark — the single frame around the whole composite
  seed: number               // stack-level reroll seed (each layer keeps its own mark.seed too)
}
```

Notes:
- `mark` is `GeoShapeConfig` **verbatim** so every existing control/validator/agent key
  keeps working. `mark.padding` is retired from the per-layer panel in favour of
  `doc.padding` (one frame for the composite). The field may remain on the type for reuse
  but is ignored by the layered renderer.
- `overlap` is a **separate** palette (not each layer's own `overlapFills`) reusing the
  existing `GeoFillOrder` / `GeoCrossingMode` / `Paint[]` types.
- Naming the array `layers` gives the agent's `layer.*` path bridge (`makeConfigParams`,
  `listKey: 'layers'`) for free.

## Rendering pipeline (parity-preserving)

One new top-level entry, everything else reused:

```ts
renderStudio(doc: GeoStudioDoc): Promise<VectorShape[]>
```

1. **Per layer (bottom→top, skip `!enabled`):** `renderShapes(layer.mark)` → the layer's own
   coloured `VectorShape[]`; apply `layer.offset` (translate/scale/rotate) to its paths;
   tag each shape with `layerId` and carry `opacity`/`blend`.
2. **Overlap faces (only if `overlap.enabled`):** union each layer's shapes into a
   per-layer **silhouette** (paper.js, the lib `boolean.ts` already uses), intersect
   silhouettes across layers to get overlap regions, tracked by **depth** (how many layers
   cover a region) and membership. Reuses the piece-splitting logic that in-mark "pieces"
   mode runs — fed layer silhouettes instead of clones of one shape.
3. **Colour overlap faces** from `overlap.fills` via `overlap.order` + `overlap.crossingMode`
   → overlap `VectorShape[]`.
4. **Concatenate** `[...layer0, ...layer1, …, ...overlapFaces]` — overlap faces last so they
   overpaint the intersections.

Surface consumption (largely unchanged):
- **Preview / PNG:** `drawToCanvas(shapes, ctx, w, h, framePad(doc))`. `framePad`/`fitScale`
  now frame the **union bounds of all layers** (the negative-padding bleed work applies to
  the whole stack). Per-layer opacity/blend map to `globalAlpha` / `globalCompositeOperation`
  grouped by `layerId`.
- **SVG:** `toSvg` wraps each layer's shapes in a `<g opacity mix-blend-mode>` group, overlap
  faces as a final group — identical geometry to the canvas.
- **Node bake** (`ShapeStudioNode.vue`) reads `doc` and calls the same `renderStudio`.

Performance: overlap detection is O(layers²) paper.js work, bounded by `LAYER_MAX = 6` and
run only on the coalesced/warmed render (not every rAF). Per-layer silhouettes are cached so
moving one layer only recomputes its pairs — same budget class as today's in-mark fold.

## UI

- **Left rail (`#aside`):** reuse `StudioLayerStack.vue` (add/remove/duplicate/reorder/toggle;
  base at the bottom). Labels are **identity-based** (derived from each layer's shape, with
  de-duping ordinals) so reordering doesn't renumber and break refs. Extend the shared
  component to allow an **empty selection** (`activeIndex = -1`).
- **Right panel, selection-driven:**
  - **Layer selected** → that layer's `mark` controls (the existing `GEO_CONTROLS` →
    `visibleGeoControls`, bound to `layers[active].mark`), plus a new **Placement** group
    (`offset.x/y/scale/rotate`, `opacity`, `blend`; blend/opacity hidden for the base layer).
  - **No layer selected** (click active row again or empty rail space to deselect) →
    **composite properties**: the **Frame** group (`padding` + Aspect / W / H) and the
    **Intersections** group (`overlap.enabled`, `overlap.fills[]` list editor, `overlap.order`,
    `overlap.crossingMode`).
- `padding` control moves out of the per-layer Style group to the no-selection Frame group.

## Persistence, migration, agent

- **Blob:** `{ doc, canvasW, canvasH, aspectKey }`. `mergeStudioDoc(raw)` wraps `mergeConfig`
  per layer and fills stack defaults.
- **Migration:** if `doc` absent but legacy `config` present, wrap into a one-layer doc:
  `layers: [{ layerId, enabled: true, mark: mergeConfig(old.config), offset: {0,0,1,0},
  opacity: 1, blend: 'normal' }]`, `overlap.enabled: false`, `padding: old.config.padding ?? 40`,
  `seed: old.config.seed ?? 1`. A one-layer doc with overlap off renders **identically** to
  today — no regression.
- **Agent:** `makeConfigParams(() => doc, () => activeLayer, 'layers')`. The `layer.*` prefix
  roots at `doc.layers[active].mark` so existing geo keys (`layer.size`, `layer.count`) map
  straight through; placement/opacity/blend are `layer.offset.x`, `layer.opacity`, `layer.blend`.
  Stack keys (`overlap.fills.0`, `overlap.order`, `padding`) address the doc root (available
  when nothing is selected). `geoAgentControls` keeps deriving per-layer vocab; a small
  `overlapAgentControls` adds the intersection knobs.

## Phasing

- **Phase 1 — Stacking core.** Data model + migration + `renderStudio` (composite with
  offset/opacity/blend, overlap off) + left rail + per-layer scoping + Placement controls +
  parity across preview/PNG/SVG/node-bake. Existing nodes migrate to one-layer docs and
  render identically. Ships "stack different shape layers".
- **Phase 2 — Intersections.** Per-layer silhouette union + cross-layer overlap faces + the
  no-selection Intersections panel + agent overlap vocab. Ships "colour the intersections".
- **Phase 3 — Fast-follow (out of scope here).** On-canvas drag of a layer's offset;
  silhouette caching tuning.

## Testing

Unit-first (repo lesson: parity units can pass on a wrong answer, so pair with input
correlation and live checks):
- Migration: legacy `{config}` → one-layer doc whose `renderStudio` output matches
  `renderShapes(config)` shape-for-shape (no regression).
- `renderStudio` composite order; offset transform math; union-bounds framing incl. negative
  padding bleed.
- Overlap faces: two known shapes at a known offset → expected intersection present at the
  right depth; disabling overlap removes them; overlap faces render last.
- Parity: `toSvg` groups and `drawToCanvas` consume the identical `VectorShape[]`.
- **Live verification owed:** drive the studio — add a second layer, offset it, colour the
  lens, confirm preview = PNG = SVG, and confirm a migrated old node is unchanged.

## Risks

- Relocating `padding` from the mark to the stack touches `GEO_CONTROLS` + config + the
  controls drift-guard test + agent vocab (shared-catalog / two-consumers) — update all
  consumers together.
- New `doc` fields must survive node serialization (`convertToLiteGraph` has silently
  dropped new `node.data` fields before).
- paper.js overlap cost O(layers²) — bounded by `LAYER_MAX` and warmed-render-only, with
  per-layer silhouette caching.
</content>
</invoke>
