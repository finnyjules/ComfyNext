# Smart Layout Batch Export — Design

**Date:** 2026-07-11
**Status:** Approved

## Problem

Smart Layout can render one combination of values at a time (plus the
Collection drawer's row-wise batch, where each row is one paired set). Users
need a **cartesian** batch: pick 3 formats, 3 images, 3 taglines → 27 outputs,
delivered as a single browsable artifact on the canvas.

## Decisions (from brainstorming)

1. **Selection lives in a "Batch export" sheet on the Smart Layout node**,
   also openable from the layout editor modal. Value pools come from the
   wired Collection's columns; formats come from the layout's outputs.
2. **Results land in a new dedicated frontend-only "batch" node** — a
   stacked-deck card on the graph that opens a gallery modal showing every
   output, with per-image and ZIP download.
3. **Each export spawns a fresh node** (no in-place refresh) so batches can
   be compared side by side; unwanted ones are deleted manually.

## UX

### Entry points
- Smart Layout node body: a "Batch export" button under "Edit layout"
  (SmartLayoutNodeBody.vue). Disabled with a tooltip when the layout has no
  formats or the node has no renderable template.
- Layout editor modal header (SmartLayoutEditorModal.vue): same button, same
  sheet, pre-scoped to the node being edited.

### Batch Export sheet
One section per crossable axis:

- **Formats** — checkboxes over the template's derived outputs (id + label,
  via `deriveOutputs`). Default: ALL of the layout's outputs checked.
- **One section per bound variable** — every `props.*` entry in the node's
  `sailor_varBindings` whose collection still exists. Pool = that column's
  distinct, non-empty cell values across all rows, in row order. Text columns
  render value chips; image columns render thumbnails. Default: only the
  preview-row's value checked.
- Variables left at a single value, unbound sockets, and `brand.*` bindings
  resolve exactly like a normal preview render (preview row semantics).

Footer: live count ("3 formats × 3 taglines × 3 images = 27 outputs"),
Generate/Cancel. Above **100** combos, Generate requires a confirm step
(inline "Really render N images?" state, not a browser dialog). During a run
the sheet shows per-item progress (queued/rendering/done/failed via the
existing `BatchItem` statuses), a cancel button, and retry-failed.

### Batch node (canvas card)
- Renders as a **stacked deck**: the first successful image on top, two
  offset card shadows behind, and a count badge (e.g. "27"). Width matches
  other artifact cards.
- Click (or an "Open" button) opens the **gallery modal**: a contact-sheet
  grid grouped by format, each cell labeled with its combo values, hover
  actions for single download, and a "Download all (ZIP)" button.
- Spawned adjacent to the Smart Layout node (offset right/below, reusing the
  canvas's existing free-position placement conventions). No edge is drawn;
  provenance lives in properties.

## Architecture

### New pure module: `app/lib/collection/matrix.ts`
- `interface MatrixPool { key: string; label: string; kind: 'format' | 'text' | 'image'; values: { value: string; label: string }[] }`
- `planMatrix(pools: MatrixPool[]): MatrixCombo[]` — cartesian product in
  pool order; `MatrixCombo = { format: string; values: Record<string, string>; labels: Record<string, string> }`
  (the `format` pool is identified by `key === 'format'`). The sheet
  disables Generate until every shown pool has ≥ 1 selection; defensively,
  `planMatrix` treats an empty pool as contributing no axis.
- `columnPool(c: CollectionData, columnKey: string): { value: string; label: string }[]`
  — distinct, non-empty cell values in row order.
- `comboFilename(layoutName: string, combo: MatrixCombo, index: number): string`
  — `sanitize()`d parts joined with `_`, e.g. `story_fresh-skin_bottle-2.png`;
  the numeric index disambiguates collisions.
- Unit-tested; no Vue imports.

### Render pipeline (reuse)
- `runBatch` from `lib/collection/batch.ts` runs combos at concurrency 3
  with cancel + status callbacks (combos are adapted into `BatchItem`s with
  synthetic ids; `rowIndex`/`rowId` are unused by the matrix path).
- A new `buildMatrixRenderItem(target, combos, runStamp)` in
  `lib/collection/generate.ts` mirrors `buildRenderItem`, but takes each
  combo's explicit `props` values (merged OVER the preview-row resolution,
  so non-crossed bindings keep their current values) instead of a rowIndex.
  Render → `POST /api/render-template` with `{ template, outputId, aspect,
  props, brand }` → `uploadAndRegister` (unchanged) → durable `/view?...`
  input-dir URL.

### Batch node type
- Type name: `BatchGrid`; Vue Flow component `batch-grid`
  (`ARTIFACT_NODE_COMPONENTS` entry in useVueNodes.ts, new
  `BatchGridNode.vue`). Added to `FRONTEND_ONLY_NODE_TYPES` (via the same
  explicit list as `Reference`) so runs strip it — it has no backend
  class type, mirroring Collection.
- Properties payload (survives serialization via node `properties`):
  ```ts
  properties.sailor_batch = {
    createdAt: string          // ISO — stamped at spawn
    sourceNodeId: string       // the Smart Layout node id (provenance only)
    layoutName: string
    items: {
      url: string              // /view?... (ComfyUI input dir — durable)
      filename: string
      format: string           // output/format id
      formatLabel: string
      vars: Record<string, string>    // columnKey → display label of the chosen value
    }[]
  }
  ```
- Gallery modal (`BatchGridModal.vue`): grid grouped by `formatLabel`,
  combo labels under each cell, single download (anchor download of the
  view URL), ZIP-all via JSZip (existing dependency, same pattern as
  CollectionDrawer's `exportZip`).
- Node spawning: the Batch Export sheet emits the successful items; the
  canvas adds the node via its existing node-insertion path (same mechanism
  `materializeAutoImageSinks` uses: new id, position offset from the source
  node, `nodes.value` push). Only successful items are included; if ALL
  items fail, no node is spawned and the sheet keeps the error list visible.

### Sheet component + wiring
- `BatchExportModal.vue` (new, under `app/components/vue-canvas/`): builds
  pools (formats from `readTemplateFromNode` + `deriveOutputs`; variables
  from `sailor_varBindings` + wired Collection via the same lookup the
  drawer uses), runs the batch, then emits `spawn` with the items payload.
- Opened from SmartLayoutNodeBody (button dispatches the same event pattern
  as "Edit layout") and from SmartLayoutEditorModal's header. VueNodeCanvas
  owns the modal instance and handles the `spawn` event (it has node-list
  access for placement).

## Error handling
- Per-item render/upload failures: `runBatch` marks the item failed; the
  sheet lists failures with retry; the spawned node contains only successes.
- Collection deleted mid-flight / no bound variables: the sheet shows only
  the Formats section (formats-only batch is valid — N formats × 1 = N).
- Malformed template (no formats): entry buttons disabled with tooltip.
- ZIP export failures surface as a toast in the modal; single downloads are
  plain anchor navigations.

## Testing
- `matrix.unit.spec.ts`: cartesian correctness (3×3×3 = 27, order stable),
  single-value pools collapse correctly, `columnPool` distinct/non-empty/
  row-order behavior, `comboFilename` sanitization + collision suffixing.
- `batch-node-payload.unit.spec.ts`: successful-items-only filtering and
  the `sailor_batch` payload shape from a run result.
- Existing `collection-batch` tests keep covering `runBatch`.
- Sheet UI, node card, and gallery modal: manual verification via the
  dev app (documented steps in the implementation plan).

## Out of scope
- Filters/search inside the gallery modal (grouping by format only, v1).
- Wiring batch items onward into the graph (a per-cell "send to canvas as
  Image node" can come later).
- Ad-hoc value pools not backed by a Collection column.
- Brand-variable crossing (`brand.*` bindings always resolve, never cross).
- Backend/ComfyUI changes — the whole feature is frontend + the existing
  render endpoint.
