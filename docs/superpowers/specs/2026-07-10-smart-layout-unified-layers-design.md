# Smart Layout — unified layers (frames behave like Figma frames)

**Date:** 2026-07-10
**Surface:** Smart Layout v3 editor + shared resolver + satori renderer
**Harness:** `/dev/sl-modal`
**Feedback driving this:** the editor was built data-structure-first (two arrays), not layers-first. To a Figma-native user that reads as broken. See memory `feedback_creative_figma_workflow`.

## Root problem

Z-order is split across **two arrays**: `template.elements` (ungrouped) and `template.sections` (frames). The resolver renders *all* elements, then *all* sections on top, in array order. Consequences a Figma user hits immediately:

- A frame can never sit **behind** a loose element (frames are always on top).
- There is **no operation to reorder frames** — not relative to elements, not even among themselves. Only ungrouped elements have ↑/↓ (they share one array).
- There is no single notion of "a layer", which also blocks child selection/editing and reparenting.

## Foundation: one unified layer order

Add a single **top-level z-order** that both the renderer and the Layers panel obey.

- `AnyGridTemplate` gains `order?: string[]` — the ids of top-level layers (ungrouped element ids **and** section ids), back to front. Children inside a frame keep their own order (the section's `children` array = that frame's internal z-order), mirroring Figma's per-container stacking.
- `effectiveOrder(template): string[]` — `template.order` filtered to ids that still exist, then any element/section id **not** listed appended (ungrouped first, then sections). So a template without `order` renders exactly as today (byte-identical), and new/edited templates stay self-healing.
- `topLayer(template, id): { kind: 'element', el } | { kind: 'section', section } | undefined`.

Storage stays in `elements` + `sections` (low-risk, additive); `order` is the authority for z only.

### Resolver

`resolveFormat` iterates `effectiveOrder(template)` instead of "elements loop, then sections loop". For each id it runs the existing per-item resolution (ungrouped element → `fitElementAtRect`; section → frame shape + children). Output order = render order, so satori and the editor canvas render correctly with no renderer change.

### Composable

- Maintain `order` on every add/remove: `addElement`, `addImage/Text/Shape`, `addSection`, `groupSelectedInto`, `wrapInSection`, `removeElement`, `ungroupSection`, delete. New top-level ids append; removed ids drop; grouping moves an element id out of top-level `order` (it becomes a child) and adds the new section id.
- `moveLayer(id, dir)` / `moveLayerTo(id, index)` operate on `order` and work for **any** top-level layer (element or frame). `moveElement`/`moveElementTo` become thin wrappers (or are replaced) so existing callers keep working.

### Layers panel

Render **one list** by `effectiveOrder` (reversed = front-to-back). Each entry is an element row or a frame row (with nested children). ↑/↓ and drag-reorder call `moveLayer*` and work for frames too. (This replaces the current elements-then-frames split.)

### Migration

`order` absent → `effectiveOrder` derives the current order. First mutation writes an explicit `order`. Existing saved templates and the Python starter are untouched and render identically.

## Then, on that foundation (later slices)

2. **Select + edit any layer** — `selectedElement`/`elById`/`patchElement` resolve children too (search `allElements`), so clicking a child opens its inspector and edits it on canvas; the right panel always reflects the selection.
3. **Frames clip content** — the section frame renders with `overflow: hidden`; children are clipped to the frame like a Figma frame (vs today's box-behind).
4. **Reparent + rename** — drag a layer into/out of a frame in the panel (and on canvas); double-click a frame name to rename.
5. **Draw-a-frame + enter-to-edit** — draw a frame at any size; single-click selects the frame, double-click steps inside to its children.

## Slice 1 scope (this pass)

Unified `order` model + resolver + composable `moveLayer*` + panel reorder for any layer + migration. Delivers: **reorder any layer (frame or element) up/down and by drag**, frames can sit behind elements, nothing in existing templates changes.

## Verification

Unit: `effectiveOrder` fallback = elements-then-sections when `order` absent; resolver renders by `order`; `moveLayer` reorders frames and elements; add/remove keep `order` consistent; a legacy template (no `order`) resolves identically to before. `/dev/sl-modal`: add a frame + a loose element, reorder the frame below the element in the panel and confirm z-order on canvas; ↑/↓ and drag both work on frames.
