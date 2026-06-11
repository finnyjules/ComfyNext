# Smart Layout v2 Visual Grid Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v2 "JSON + previews" compat mode with a direct-manipulation grid editor: drag/resize elements with snap-to-cell, per-format-class adjustment tabs, focal-point picking, and one-click v1→v2 conversion.

**Architecture:** A parallel set of v2 editor components (`GridEditorShell` / `GridEditorCanvas` / `GridPropertyPanel` / `GridFormatTabs` / `FocalPointPicker`) driven by a new `useGridEditor` composable. All geometry comes from the existing shared resolver (`shared/template-grid/`); new drag/resize snap math also lives in `shared/template-grid/editor.ts` (single-source rule). The v1 editor (`EditorShell` + friends) is untouched; `LayersPanel` is reused as-is via a structurally compatible injected context. `SmartLayoutEditorModal` mounts the grid editor for v2 templates (with a JSON escape-hatch toggle) and gains a "Convert to grid" button for v1.

**Tech Stack:** Vue 3 + Tailwind (existing dark-theme tokens: `#0a0a0a`/`#0e0e10` panels, `border-white/[0.06]`, accent `#96b4ff`), shared template-grid resolver, vitest for math/composable, Playwright for the modal flow.

**Editing semantics (from the spec):**
- Editing the **master format** writes `el.region`.
- Editing any **non-master format** writes `el.regionByClass[classOf(format)]` — one edit fixes the whole class. A banner in the property panel says so; a reset button clears the class entry.
- Per-format-key `overrides` stay JSON-only (escape hatch, no UI in this plan).
- The canvas always renders through `resolveFormat`, so the editor shows exactly what culling/copy-fitting will do; culled elements appear in a clickable chip list, not on canvas.

---

### Task 1: Snap math in shared/template-grid/editor.ts (TDD)

**Files:** Create `frontend/shared/template-grid/editor.ts`, re-export from `index.ts`. Test `frontend/tests/unit/template-grid-editor-math.unit.spec.ts`.

Pure helpers, complete code:

```typescript
import type { GridMetrics } from './grid'
import type { Region } from './types'

/** Template-space point → 1-based cell coordinates (clamped). */
export function pointToCell(x: number, y: number, m: GridMetrics): { col: number; row: number } {
  const col = Math.floor((x - m.originX) / (m.cellW + m.gutter)) + 1
  const row = Math.floor((y - m.originY) / (m.cellH + m.gutter)) + 1
  return {
    col: Math.min(m.cols, Math.max(1, col)),
    row: Math.min(m.rows, Math.max(1, row)),
  }
}

/** Move a region by a template-px delta, snapped to whole cells. Span preserved. */
export function dragRegion(start: Region, dxPx: number, dyPx: number, m: GridMetrics): Region {
  const dCols = Math.round(dxPx / (m.cellW + m.gutter))
  const dRows = Math.round(dyPx / (m.cellH + m.gutter))
  const col = Math.min(m.cols - start.colSpan + 1, Math.max(1, start.col + dCols))
  const row = Math.min(m.rows - start.rowSpan + 1, Math.max(1, start.row + dRows))
  return { ...start, col, row }
}

/** Resize a region from a corner handle by a template-px delta, snapped to cells.
 * dir is e.g. 'se' (south-east). Opposite edges stay fixed; spans never go below 1. */
export function resizeRegion(
  start: Region, dir: 'nw' | 'ne' | 'sw' | 'se',
  dxPx: number, dyPx: number, m: GridMetrics,
): Region {
  const dCols = Math.round(dxPx / (m.cellW + m.gutter))
  const dRows = Math.round(dyPx / (m.cellH + m.gutter))
  let { col, colSpan, row, rowSpan } = start
  if (dir.includes('e')) {
    colSpan = Math.max(1, Math.min(m.cols - col + 1, start.colSpan + dCols))
  } else {
    const newCol = Math.min(start.col + start.colSpan - 1, Math.max(1, start.col + dCols))
    colSpan = start.colSpan + (start.col - newCol)
    col = newCol
  }
  if (dir.includes('s')) {
    rowSpan = Math.max(1, Math.min(m.rows - row + 1, start.rowSpan + dRows))
  } else {
    const newRow = Math.min(start.row + start.rowSpan - 1, Math.max(1, start.row + dRows))
    rowSpan = start.rowSpan + (start.row - newRow)
    row = newRow
  }
  return { col, colSpan, row, rowSpan }
}
```

Tests: pointToCell at origins/edges/out-of-bounds; dragRegion snap rounding, clamping at all four borders, span preservation; resizeRegion each corner grows/shrinks, min-span 1, opposite edge fixed (use the 1x1 master metrics from the geometry spec: 6×6, cell 136, gutter 24, margin 72).

Steps: write failing test → implement → `npm run test:unit` green → commit.

### Task 2: useGridEditor composable (TDD)

**Files:** Create `frontend/app/composables/useGridEditor.ts`. Test `frontend/tests/unit/grid-editor-composable.unit.spec.ts` (vitest can import vue's `ref`/`computed` in node env).

State (mirrors `useTemplateEditor`'s shape so `LayersPanel` injects work):
`template: Ref<TemplateV2>`, `currentFormat: Ref<string>` (init = master), `selectedId`, `dirty`, `sampleProps`, `sampleBrand`, `worstCase: Ref<boolean>`.

Computeds: `format`, `formatClass` (via `classifyFormat`), `isMaster`, `metrics` (gridMetrics), `resolved` (resolveFormat with `effectiveProps` = sampleProps, but every `text_layer_*`/string prop replaced by a 140-char lorem when `worstCase`), `resolvedAll` (map over all format keys — for tabs/culling badges), `selectedElement`, `selectedResolved`, `hasClassRegion(el)` (does el.regionByClass have an entry for the current class).

Mutations (all set `dirty`):
- `setFormat(key)`
- `setRegion(id, region)` — master → `el.region = region`; else `el.regionByClass = { ...el.regionByClass, [formatClass]: region }`
- `clearClassRegion(id)` — delete `el.regionByClass[formatClass]`
- `patchElement(id, patch)` / `patchStyle(id, patch)` — base mutations (v2 has no per-aspect style overrides)
- `addText/addImage/addShape` — defaults: next priority = `max(priorities)+1`; text `{ level: 'body', region: {col:1,colSpan:3,row:1,rowSpan:1}, content: 'New text', style: { color: '#ffffff' } }`; image `{ region: {col:2,colSpan:4,row:2,rowSpan:4}, content: '', style: { fit: 'cover' } }`; shape rect `{ region: {col:1,colSpan:2,row:1,rowSpan:2}, style: { fill: '#96b4ff55' } }`; ids via `uid(type)`; select on add
- `removeElement(id)`, `moveElement(id, dir)`, `moveElementTo(id, idx)` (LayersPanel compatibility)

Tests: setRegion writes base on master vs regionByClass on a strip format; clearClassRegion; worstCase swaps text props; resolvedAll exposes culled counts; addText assigns next priority; moveElementTo reorders.

Steps: failing test → implement → green → commit.

### Task 3: GridEditorCanvas.vue

**Files:** Create `frontend/app/components/templates/GridEditorCanvas.vue`.

Injects `gridEditor` ctx. Same scale model as v1 canvas (`ResizeObserver`, fit minus 64px, clamp ≤1). Renders, in template space scaled as a unit:
1. Background (template.background fill/image, token-resolved).
2. **Grid overlay** (non-interactive, under elements): margin boundary (dashed white/10 rect at originX/Y), column bands (`rgba(150,180,255,0.05)` fill + `rgba(150,180,255,0.18)` inline borders) from metrics, row lines, safe-area hatch (`repeating-linear-gradient(45deg, rgba(255,80,80,.06)...)`) over `format.safeArea` strips when present.
3. **Elements** from `resolved.elements.filter(e => !e.culled)`: text (resolved `text.fontSize`/`content`, style color/weight/align/valign via flex), image (`<img>` objectFit + objectPosition from focal; mark renders the squared rect), shape. Selection outline `outline-2 outline-[#96b4ff]`, hover outline, pointer cursor.
4. **Drag**: pointerdown on element → capture, store start region (from the resolved element — materializes class defaults when dragging on a class tab) + start client coords; pointermove → `dragRegion(start, dx/scale, dy/scale, metrics)` → `setRegion` when changed. Click empty canvas clears selection.
5. **Resize**: 4 corner handles when selected → `resizeRegion`.
6. **Culled chips**: bottom-left overlay listing `resolved.elements.filter(e => e.culled)` as `id · reason` chips; click selects the element.
7. Bottom-right readout: `W×H · class · zoom%`.

Verify by mounting (Task 6) — no isolated unit test (DOM-heavy); the math it calls is already covered.

### Task 4: GridFormatTabs.vue

**Files:** Create `frontend/app/components/templates/GridFormatTabs.vue`.

Injects ctx. Horizontal strip of all `template.formats`: mini wireframe thumb (fixed 40px height, width = `40 × w/h` clamped 24–96px; elements from `resolvedAll[key]` drawn as proportional divs — accent fill for selected element, white/20 otherwise), label + dimensions, class letter badge for strip/skyscraper, amber culled-count badge (e.g. `–2`) when elements drop. Active tab: accent ring. Click → `setFormat`. Master tab gets a small "master" tag.

### Task 5: GridPropertyPanel.vue + FocalPointPicker.vue

**Files:** Create both under `frontend/app/components/templates/`.

GridPropertyPanel (injects ctx; only when `selectedElement`):
- Header: type icon, id input (`patchElement`), delete.
- **Class banner** when `!isMaster`: "Editing **{class}** placement — applies to every {class} format" + "Reset to default" (`clearClassRegion`, shown only when `hasClassRegion`).
- Region: 4 numeric steppers (col/row clamped to grid, colSpan/rowSpan ≥1) writing via `setRegion`.
- Priority stepper (1–9) + one-line hint ("1 = kept longest on small formats").
- Text: content textarea, level select, overflow select (`shrink` / `shrink-then-truncate` / `grow`), maxLines, weight (400/700), align + valign button rows, color swatch+hex, lineHeight, letterSpacing.
- Image: content input, fit select (cover/contain/stretch), borderRadius, "Collapse to mark on small formats" checkbox (`collapse`), FocalPointPicker.
- Shape: rect/circle toggle, fill, borderRadius, border color/width.

FocalPointPicker: 16:9 box, background = token-resolved sample image (fallback checker), draggable crosshair → emits `{ x, y }` clamped 0–1, writes `patchElement(id, { focal })`. Readout `x%, y%`.

### Task 6: GridEditorShell.vue

**Files:** Create `frontend/app/components/templates/GridEditorShell.vue`.

Owns `useGridEditor(props.initial)`, `provide('gridEditor', ctx)` AND `provide('templateEditor', ctx as any)` (LayersPanel compatibility — it only touches template/selectedId/move/remove APIs which ctx exposes).

Props `{ initial: TemplateV2, initialProps?, initialBrand? }`, emit `save: [TemplateV2]`. Seed/watch sampleProps+sampleBrand like v1 shell.

Layout (mirrors v1 shell): top bar = name input · GridFormatTabs (flex-1, scrollable) · worst-case copy toggle (`AA⟶` icon button w/ tooltip "Preview with worst-case copy length") · add Text/Image/Shape buttons · dirty dot + "Save & close". Body = LayersPanel (260px) | GridEditorCanvas | GridPropertyPanel (300px, conditional).

Save: `emit('save', JSON.parse(JSON.stringify(template)))`.

### Task 7: Modal integration + v1 Convert button

**Files:** Modify `frontend/app/components/vue-canvas/SmartLayoutEditorModal.vue`.

- v2 path: replace the previews+JSON panel with `<TemplatesGridEditorShell :initial :initial-props :initial-brand @save="onLayoutSaved" />`, plus a small header toggle `Visual | JSON` — JSON mode keeps the existing textarea+previews panel (escape hatch, unchanged code, just behind the toggle).
- v1 path: add a "Convert to grid" button next to the close button; click → confirm tooltip-style inline ("One-way conversion — Save afterwards to keep it") → `initial.value = convertV1toV2(initial.value as Template)` (import from shared) → component swaps to the grid editor automatically via `isV2`.
- `onLayoutSaved` already writes both versions.

### Task 8: E2E + browser verification

**Files:** Modify `frontend/tests/smart-layout.spec.ts` (editor modal test).

Extend the modal test: after opening on a fresh node, assert the grid editor is shown (format tabs strip with `728×90` tab visible, grid overlay container present), click the `728x90` tab → canvas readout shows `728×90 · strip`, click "Save & close" → modal closes. Browser verification: run `pnpm dev` on port 3010 inside the worktree, point Playwright at it via its baseURL env (check `playwright.config.ts` for the override mechanism; add one if missing), run the editor-modal spec + full smart-layout spec. Manual screenshot pass over the editor (canvas, tabs, property panel, focal picker) via preview tooling before finishing.

### Final verification

- `npm run test:unit` green (all suites).
- smart-layout Playwright spec green against the worktree dev server.
- Screenshot evidence of: master canvas w/ grid overlay; strip tab edit writing regionByClass (drag CTA in 728×90, check JSON via toggle); culled chip; focal picker; v1 convert.

## Out of scope (unchanged from spec)

Brand fonts, text panels, baseline snapping, per-format-key override UI, archetype presets, AI art director.
