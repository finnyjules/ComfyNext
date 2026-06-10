# Smart Layout v2 — Swiss Grid Engine

**Date:** 2026-06-10
**Status:** Approved
**Owner:** Julien

## Goal

Overhaul the Smart Layout node from free-form anchor/offset positioning to a Swiss-design modular grid system, so that one master creative deterministically reflows into a full campaign set: social aspects (1:1, 4:5, 9:16, 16:9) plus IAB web-ad sizes (300×250, 728×90, 160×600, 970×250, 320×50, 300×600). All reflow is local, rule-based math — zero credit cost per variant.

## Decisions (approved in brainstorm)

- **Authoring model:** design once on a master grid, auto-reflow to every format via format classes. Editor is a touch-up tool, not the primary workflow.
- **Formats:** social + IAB display in v1; all five format classes ship in v1, including strip/skyscraper culling.
- **Migration:** evolve in place. Layout JSON gains `"version": 2`; version-1 templates render unchanged through the existing code path. One-time convert offered in the editor.

## Schema v2

Lives alongside v1 in `frontend/server/templates/schema.ts`. The `version` field discriminates. `{{ props.* }}` / `{{ brand.* }}` interpolation, element types (text/image/shape), and background are unchanged from v1.

```typescript
interface TemplateV2 {
  version: 2
  id: string
  name: string
  master: string                          // key into formats; the design-time format
  formats: Record<string, FormatSpec>
  grid: { gutter: number; margin: number; baseline: number }   // master-format px
  typeScale: { base: number; ratio: number }                   // base = caption size in master px
  background?: BackgroundSpec
  elements: ElementV2[]
}

interface FormatSpec {
  w: number
  h: number
  label?: string
  class?: FormatClass            // explicit override; otherwise derived from w/h
  cols?: number                  // default per class
  rows?: number                  // default per class
  safeArea?: { top: number; right: number; bottom: number; left: number }  // px insets
}

type FormatClass = 'square' | 'portrait' | 'landscape' | 'strip' | 'skyscraper'

interface Region { col: number; colSpan: number; row: number; rowSpan: number }  // 1-based

interface ElementV2Base {
  id: string
  role?: string
  priority: number               // 1 = most important; drives culling and default layouts
  region: Region                 // placement on the master grid
  regionByClass?: Partial<Record<FormatClass, Region>>
  overrides?: Record<string, Partial<ElementV2>>   // per-format-key escape hatch (kept from v1)
}

interface TextElementV2 extends ElementV2Base {
  type: 'text'
  content: string
  level: 'display' | 'headline' | 'subhead' | 'body' | 'caption'
  overflow?: 'shrink' | 'shrink-then-truncate' | 'grow'        // default 'shrink-then-truncate'
  maxLines?: number
  style?: { fontFamily?: string; fontWeight?: 400 | 700; color?: string
            align?: 'left' | 'center' | 'right'; lineHeight?: number; letterSpacing?: number }
}

interface ImageElementV2 extends ElementV2Base {
  type: 'image'
  content: string
  focal?: { x: number; y: number }      // 0–1, default { x: 0.5, y: 0.5 }
  collapse?: 'mark'                      // logo-style: swap to compact square variant below threshold
  style?: { fit?: 'cover' | 'contain' | 'stretch'; borderRadius?: number }
}

interface ShapeElementV2 extends ElementV2Base {
  type: 'shape'
  shape: 'rect' | 'circle'
  style?: { fill?: string; borderRadius?: number; borderColor?: string; borderWidth?: number }
}
```

### Format classification

Derived from ratio `r = w / h` when `class` is not explicit:

| Class | Condition | Default grid (cols × rows) |
|---|---|---|
| skyscraper | r ≤ 0.35 | 3 × 10 |
| portrait | 0.35 < r < 0.8 | 4 × 8 |
| square | 0.8 ≤ r ≤ 1.25 | 6 × 6 |
| landscape | 1.25 < r < 3.5 | 8 × 4 |
| strip | r ≥ 3.5 | 12 × 1 |

Examples: 300×600 (r = 0.5) → portrait; 970×250 (r = 3.88) → strip; 160×600 (r = 0.27) → skyscraper. Explicit `class` always wins.

### Grid metrics scaling

Gutter/margin/baseline are authored in master px and scale by `s = min(w, h) / min(masterW, masterH)`, floored at 2 px gutter / 4 px margin. `safeArea` insets are absolute px for that format and shrink the usable canvas before the grid is laid out (margin applies inside the safe area).

### Built-in format presets

Starter set shipped by the node (user-extensible):

| Key | Size | Class | Notes |
|---|---|---|---|
| 1x1 | 1080×1080 | square | default master |
| 4x5 | 1080×1350 | square | feed portrait |
| 9x16 | 1080×1920 | portrait | safeArea top 270 / bottom 380 (story/reel UI chrome) |
| 16x9 | 1920×1080 | landscape | |
| 300x250 | 300×250 | square | IAB MPU |
| 300x600 | 300×600 | portrait | IAB half-page |
| 728x90 | 728×90 | strip | IAB leaderboard |
| 970x250 | 970×250 | strip | IAB billboard |
| 320x50 | 320×50 | strip | IAB mobile banner |
| 160x600 | 160×600 | skyscraper | IAB wide skyscraper |

## Reflow engine

All pure functions in one shared module (see Architecture).

### Region resolution order

For element E on format F with class C:

1. `overrides[formatKey].region` if present (per-format escape hatch),
2. else `regionByClass[C]` if present,
3. else if C is `strip` or `skyscraper`: the element is **not** placed by proportional remap — it is placed by the default class layout (below) or culled. Proportional remap is forbidden for these classes; it produces garbage compositions.
4. else (square/portrait/landscape): proportional remap of the master region — scale col/colSpan by `F.cols / master.cols` and row/rowSpan by `F.rows / master.rows`, round to nearest whole cell, clamp spans to ≥ 1 and within the grid.

### Default class layouts (strip & skyscraper)

When a v2 template has elements without `regionByClass.strip` / `.skyscraper`, the engine generates default placements at resolve time (and the editor materializes them into the template on save, so what you see is what is stored):

- **strip:** a single-row flow. Elements sorted by a fixed slot order — logo (cols 1–2), headline (next ~50% of cols), image (1 col, as mark), CTA (last 2–3 cols) — placed in priority order until columns run out; anything that doesn't fit is culled. Subhead/body are culled by default in strips.
- **skyscraper:** a single-column flow top-to-bottom — logo, image, headline, subhead, CTA — placed in priority order until rows run out.

Slot order is keyed off element `role`/`type`, with priority breaking ties.

### Culling

Deterministic, size-based, applied after region resolution:

- Text: culled when the resolved region cannot hold one line at the floor font size (region height < floor × lineHeight).
- Image/shape: culled when the resolved region is under 24 px in either dimension, except images with `collapse: 'mark'`, which instead render as a centered square mark filling the region's min dimension.
- Default class layouts cull lowest-priority elements first when space runs out.

Culling removes the element; nothing reflows into freed space (predictability over density).

### Type scale

`fontSize(level) = typeScale.base × typeScale.ratio^levelIndex × s × m(C)` where levelIndex is caption=0 … display=4, `s = min(w,h) / min(masterW,masterH)`, and `m(C)` is a class multiplier compensating extreme aspects: square/portrait/landscape = 1, skyscraper = 2, strip = 3. Absolute floor: 10 px. Line heights snap to the scaled baseline grid. The multipliers and floor are named constants in the resolver — tunable in one place.

### Overflow policy (copy fitting)

Copy arrives at runtime via `props` and can be any length. Per text element, `overflow` defines what happens when the resolved font size still overflows the region:

- `shrink` — auto-fit down to the floor; may clip if copy is extreme.
- `shrink-then-truncate` (default) — auto-fit to floor, then truncate with an ellipsis at `maxLines` (default: lines that fit the region).
- `grow` — extend `rowSpan` downward one row at a time until the copy fits or the grid ends; overlaps are permitted (z-order = element array order, as in v1).

The editor previews worst-case copy (a long-string toggle), not just the wired values.

## Architecture

### Shared grid resolver (single source of truth)

One TypeScript module — `frontend/shared/templates/grid.ts` (Nuxt 4 `shared/` folder, importable from both `app/` and `server/`) — owning: format classification, grid metric scaling, region→pixel resolution, proportional remap, default class layouts, culling, type scale, overflow resolution. Both the editor canvas and the render path import this module. **No second implementation of grid math may exist** — this is the guard against editor previews diverging from rendered output. Schema types move to `shared/` as well (server re-exports for back-compat).

Resolver output per (template, formatKey, props): a flat list of positioned elements `{ id, type, x, y, w, h, fontSize?, lines?, culled, cullReason? }` in master-independent absolute pixels for that format.

### Render path

`translate.ts` branches on `version`: v1 takes the existing path untouched; v2 calls the shared resolver and emits the same absolute-positioned satori nodes it already produces. Satori, resvg, fonts, and `/api/render-template` are unchanged. Focal-point cover crops are implemented with wrapper math (overflow-hidden wrapper + oversized inner `<img>` offset from `focal`), not CSS `object-position`, so we don't depend on satori support.

### Python node

`comfy_extras/nodes_smart_layout.py`:

- Starter layout becomes v2 with the preset format table above; `aspects` input keeps its name and accepts format keys (`"1x1,9x16,728x90"`).
- Auto-populate (connected layers, empty template) assigns roles, priorities (headline 1, CTA 2, logo 3, image 4, subhead 5), master regions, and relies on default class layouts for strip/skyscraper.
- Output contract unchanged: one image per format key, `is_output_list=True`, live-preview carousel labeled by format key.

### Editor

`SmartLayoutEditorModal.vue` / `TemplatesEditorShell`, v2 mode:

- Grid overlay (columns, rows, baseline) with snap-to-cell drag/resize; positions stored as regions.
- Format strip: live thumbnails of every target format rendered via the shared resolver.
- Class tabs: edit the master, or open a class tab to adjust placements — edits write `regionByClass` entries; per-format-key `overrides` remain available for one-off fixes.
- Culling indicators: elements dropped in a given format are listed with the cull reason.
- Worst-case copy toggle for overflow previewing.
- Safe-area hatching on formats that define one.
- Focal-point picker (drag a crosshair on the image) writing `focal`.
- "Convert to grid" on v1 templates: snap each element's pixel box (on the default aspect) to nearest gridlines (min 1 cell), map font sizes to nearest type-scale level, assign priorities by role heuristic. One-way, explicit, user-initiated.

## Testing

- Unit tests (vitest, alongside `frontend/tests/smart-layout.spec.ts`): format classifier boundaries, metric scaling, region→pixel resolution per class, proportional remap rounding/clamping, default strip/skyscraper layouts, culling thresholds and priority order, type scale incl. floor and class multipliers, overflow policies, v1→v2 conversion snapping.
- Golden render tests: one fixture template rendered through `/api/render-template` per format class; assert dimensions and stable hashes.
- Regression: existing v1 template tests must pass unchanged.

## Out of scope (v1) — named fast-follows

1. **Brand fonts** — render endpoint currently hardcodes Inter 400/700. Satori accepts arbitrary font buffers; brand-kit font upload is the first fast-follow, as Swiss design is typography-led.
2. **Text panels** — optional solid panel behind text elements for legibility when reflow places text over imagery (one schema field; Swiss-native alternative to scrims).
3. AI art-director placement pass (LLM proposes grid placements, constrained to grid coordinates; opt-in, costs credits).
4. AI smart-crop upgrade behind the existing `focal` crop.
5. Archetype preset library (Swiss poster starting points).
6. Animated/HTML5 ad output.
