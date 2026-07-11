/** Grid geometry: format classification, metric scaling, region→pixel
 * resolution, and proportional remapping. Pure functions — the single source
 * of truth for both the renderer and the editor. */

import type { AnyGridTemplate, FormatClass, FormatSpec, Region, TemplateV2 } from './types'
import { isV3 } from './types'

export const CLASS_DEFAULTS: Record<FormatClass, { cols: number; rows: number; typeMultiplier: number }> = {
  skyscraper: { cols: 3,  rows: 10, typeMultiplier: 2 },
  portrait:   { cols: 4,  rows: 8,  typeMultiplier: 1 },
  square:     { cols: 6,  rows: 6,  typeMultiplier: 1 },
  landscape:  { cols: 8,  rows: 4,  typeMultiplier: 1 },
  strip:      { cols: 12, rows: 1,  typeMultiplier: 3 },
}

// Tunable constants — keep them here and only here.
export const FONT_FLOOR = 10     // px; absolute minimum rendered font size
export const MIN_GUTTER = 2      // px; scaled gutter never drops below this
export const MIN_MARGIN = 4      // px
export const MIN_VISIBLE = 24    // px; image/shape regions smaller than this are culled

export function classifyFormat(f: FormatSpec): FormatClass {
  if (f.class) return f.class
  const r = f.w / f.h
  if (r <= 0.35) return 'skyscraper'
  if (r < 0.8) return 'portrait'
  if (r <= 1.25) return 'square'
  if (r < 3.5) return 'landscape'
  return 'strip'
}

export function formatDims(f: FormatSpec): { cols: number; rows: number } {
  const d = CLASS_DEFAULTS[classifyFormat(f)]
  return { cols: f.cols ?? d.cols, rows: f.rows ?? d.rows }
}

// Bounds for the grid column/row counts — coarse enough to read as a layout
// grid, fine enough for precise placement.
export const MIN_GRID_LINES = 1
export const MAX_GRID_LINES = 240

function clampLines(n: number): number {
  return Math.min(MAX_GRID_LINES, Math.max(MIN_GRID_LINES, Math.round(n)))
}

/** The v3 grid's column and row counts. Explicit `grid.columns`/`grid.rows`
 * win; otherwise each axis is derived from `baseline` against the MASTER format
 * (canvas ÷ baseline) so existing templates keep their coordinate space. FIXED
 * across every format, so `remapRegion` between formats is the identity. */
export interface MarginBox { top: number; right: number; bottom: number; left: number }

/** Resolve the master-px gutters per axis. `grid.gutters.column` (space between
 * columns / horizontal) and `grid.gutters.row` (space between rows / vertical)
 * win; otherwise the uniform `grid.gutter` applies to both. Back-compatible:
 * templates without `gutters` behave exactly as before. */
export function gutterBox(template: AnyGridTemplate): { column: number; row: number } {
  const g = template.grid.gutters
  const base = template.grid.gutter
  return { column: g?.column ?? base, row: g?.row ?? base }
}

/** Resolve the master-px margins for each side. A per-side value in
 * `grid.margins` wins; otherwise the uniform `grid.margin` applies to that side.
 * Kept back-compatible: templates without `margins` behave exactly as before. */
export function marginBox(template: AnyGridTemplate): MarginBox {
  const m = template.grid.margins
  const base = template.grid.margin
  return {
    top: m?.top ?? base,
    right: m?.right ?? base,
    bottom: m?.bottom ?? base,
    left: m?.left ?? base,
  }
}

export function gridDims(template: AnyGridTemplate): { cols: number; rows: number } {
  const master = template.formats[template.master]
  const baseline = Math.max(1, template.grid.baseline)
  const mb = marginBox(template)
  const derive = (explicit: number | undefined, extent: number, m0: number, m1: number) => {
    if (typeof explicit === 'number' && Number.isFinite(explicit)) return clampLines(explicit)
    return Math.max(1, Math.round(Math.max(baseline, extent - m0 - m1) / baseline))
  }
  return {
    cols: derive(template.grid.columns, master.w, mb.left, mb.right),
    rows: derive(template.grid.rows, master.h, mb.top, mb.bottom),
  }
}

/** Grid dimensions for a format. v2 → coarse class cells (formatDims). v3 →
 * the FIXED template grid (`gridDims`) on every format, so `remapRegion` between
 * formats is the identity and placement carries across aspects without drift.
 * Explicit `f.cols`/`f.rows` still win as a per-format opt-out. */
export function fineGridDims(template: AnyGridTemplate, f: FormatSpec): { cols: number; rows: number } {
  if (!isV3(template)) return formatDims(f)
  const g = gridDims(template)
  return {
    cols: f.cols ?? g.cols,
    rows: f.rows ?? g.rows,
  }
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface GridMetrics {
  cols: number; rows: number
  originX: number; originY: number
  cellW: number; cellH: number
  /** `gutter` stays as the column (horizontal) gutter for back-compat;
   * `gutterX` is between columns, `gutterY` is between rows. */
  gutter: number; gutterX: number; gutterY: number
  baseline: number
  /** `margin` stays as the top-side value for back-compat; per-side values
   * live in the `margin{Top,Right,Bottom,Left}` fields. */
  margin: number
  marginTop: number; marginRight: number; marginBottom: number; marginLeft: number
  scale: number
}

/** Metric scale factor relative to the master format: min-dimension ratio, so
 * width-bound text stays stable across portrait/landscape flips. */
export function metricScale(template: AnyGridTemplate, f: FormatSpec): number {
  const master = template.formats[template.master]
  return Math.min(f.w, f.h) / Math.min(master.w, master.h)
}

export function gridMetrics(template: AnyGridTemplate, formatKey: string): GridMetrics {
  const f = template.formats[formatKey]
  if (!f) throw new Error(`Unknown format '${formatKey}' on template '${template.id}'`)
  const s = metricScale(template, f)
  const baseline = Math.max(1, template.grid.baseline * s)
  const safe = { top: 0, right: 0, bottom: 0, left: 0, ...(f.safeArea ?? {}) }
  // Per-side margins (master px, scaled per format). Uniform `grid.margin` is
  // the fallback for any side not set in `grid.margins`.
  const mb = marginBox(template)
  const mTop = Math.max(0, mb.top * s)
  const mRight = Math.max(0, mb.right * s)
  const mBottom = Math.max(0, mb.bottom * s)
  const mLeft = Math.max(0, mb.left * s)
  const { cols, rows } = fineGridDims(template, f)
  // Clamp so degenerate safe areas/margins can't push cells non-positive.
  const innerW = Math.max(cols, f.w - safe.left - safe.right - mLeft - mRight)
  const innerH = Math.max(rows, f.h - safe.top - safe.bottom - mTop - mBottom)
  // Gutter. v2 always gutters its coarse columns. v3 used to force gutter to 0
  // (its fine lattice was gutterless); it now honours the gutter, but ONLY on an
  // explicit grid (grid.columns/rows set — i.e. authored on the coarse grid).
  // Legacy v3 templates on the derived ~78-cell lattice stay gutterless so their
  // rendering is byte-identical. The cap stops a large gutter from driving cells
  // negative on a dense grid.
  const v3Explicit = isV3(template) && (template.grid.columns != null || template.grid.rows != null)
  const gutterActive = !isV3(template) || v3Explicit
  const gb = gutterBox(template)
  const capW = cols > 1 ? (innerW * 0.5) / (cols - 1) : Infinity
  const capH = rows > 1 ? (innerH * 0.5) / (rows - 1) : Infinity
  const gutterFloor = isV3(template) ? 0 : MIN_GUTTER
  // Column gutter (horizontal, between columns) is capped by the width; row
  // gutter (vertical, between rows) by the height.
  const gutterX = Math.max(gutterFloor, Math.min(gutterActive ? Math.max(0, gb.column * s) : 0, capW))
  const gutterY = Math.max(gutterFloor, Math.min(gutterActive ? Math.max(0, gb.row * s) : 0, capH))
  return {
    cols, rows,
    originX: safe.left + mLeft,
    originY: safe.top + mTop,
    cellW: (innerW - gutterX * (cols - 1)) / cols,
    cellH: (innerH - gutterY * (rows - 1)) / rows,
    gutter: gutterX, gutterX, gutterY,
    margin: mTop, marginTop: mTop, marginRight: mRight, marginBottom: mBottom, marginLeft: mLeft,
    baseline, scale: s,
  }
}

export function regionToRect(region: Region, m: GridMetrics): Rect {
  const col = Math.min(m.cols, Math.max(1, Math.round(region.col)))
  const row = Math.min(m.rows, Math.max(1, Math.round(region.row)))
  const colSpan = Math.max(1, Math.min(m.cols - col + 1, Math.round(region.colSpan)))
  const rowSpan = Math.max(1, Math.min(m.rows - row + 1, Math.round(region.rowSpan)))
  return {
    x: m.originX + (col - 1) * (m.cellW + m.gutterX),
    y: m.originY + (row - 1) * (m.cellH + m.gutterY),
    w: colSpan * m.cellW + (colSpan - 1) * m.gutterX,
    h: rowSpan * m.cellH + (rowSpan - 1) * m.gutterY,
  }
}

/** Extend a region's rect to the canvas edge on each side its region touches —
 * full-bleed semantics. A region spanning the full grid covers the whole
 * canvas; a half-grid region bleeds on its three outer sides and keeps the
 * grid line on the inner side. Safe areas are intentionally ignored: bleed is
 * for backgrounds that should fill behind platform UI chrome. */
export function bleedToEdges(
  rect: Rect, region: Region, m: GridMetrics, formatW: number, formatH: number,
): Rect {
  const col = Math.min(m.cols, Math.max(1, Math.round(region.col)))
  const row = Math.min(m.rows, Math.max(1, Math.round(region.row)))
  const colSpan = Math.max(1, Math.min(m.cols - col + 1, Math.round(region.colSpan)))
  const rowSpan = Math.max(1, Math.min(m.rows - row + 1, Math.round(region.rowSpan)))
  const left = col === 1
  const right = col + colSpan - 1 === m.cols
  const top = row === 1
  const bottom = row + rowSpan - 1 === m.rows
  const x = left ? 0 : rect.x
  const y = top ? 0 : rect.y
  const w = (right ? formatW : rect.x + rect.w) - x
  const h = (bottom ? formatH : rect.y + rect.h) - y
  return { x, y, w, h }
}

/** Proportionally remap a region between grids of different dimensions.
 * Used between square/portrait/landscape only — strip and skyscraper get
 * default class layouts instead (see layouts.ts). */
export function remapRegion(
  r: Region,
  from: { cols: number; rows: number },
  to: { cols: number; rows: number },
): Region {
  const sc = to.cols / from.cols
  const sr = to.rows / from.rows
  const col = Math.min(to.cols, Math.max(1, Math.round((r.col - 1) * sc) + 1))
  const row = Math.min(to.rows, Math.max(1, Math.round((r.row - 1) * sr) + 1))
  return {
    col, row,
    colSpan: Math.max(1, Math.min(to.cols - col + 1, Math.round(r.colSpan * sc))),
    rowSpan: Math.max(1, Math.min(to.rows - row + 1, Math.round(r.rowSpan * sr))),
  }
}
