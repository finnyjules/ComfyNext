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

/** Grid dimensions for a format. v2 → coarse class cells (formatDims). v3 →
 * a baseline-derived FINE grid: one fine unit ≈ `grid.baseline` master px, so
 * snapping and vertical type rhythm share one source of truth. Explicit
 * `f.cols`/`f.rows` still win. The margin used is the unscaled master margin so
 * every format derives proportionally (remapRegion bridges differing dims). */
export function fineGridDims(template: AnyGridTemplate, f: FormatSpec): { cols: number; rows: number } {
  if (!isV3(template)) return formatDims(f)
  const baseline = Math.max(1, template.grid.baseline)
  const margin = template.grid.margin
  const innerW = Math.max(baseline, f.w - 2 * margin)
  const innerH = Math.max(baseline, f.h - 2 * margin)
  return {
    cols: f.cols ?? Math.max(1, Math.round(innerW / baseline)),
    rows: f.rows ?? Math.max(1, Math.round(innerH / baseline)),
  }
}

export interface Rect { x: number; y: number; w: number; h: number }

export interface GridMetrics {
  cols: number; rows: number
  originX: number; originY: number
  cellW: number; cellH: number
  gutter: number; margin: number; baseline: number
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
  // v3 fine grid is a positioning lattice (cell ≈ baseline), so it carries no
  // inter-cell gutter; v2 keeps its coarse gutter'd columns.
  const gutter = isV3(template) ? 0 : Math.max(MIN_GUTTER, template.grid.gutter * s)
  const margin = Math.max(MIN_MARGIN, template.grid.margin * s)
  const baseline = Math.max(1, template.grid.baseline * s)
  const safe = { top: 0, right: 0, bottom: 0, left: 0, ...(f.safeArea ?? {}) }
  const { cols, rows } = fineGridDims(template, f)
  // Clamp so degenerate safe areas/margins can't push cells non-positive.
  const innerW = Math.max(cols, f.w - safe.left - safe.right - 2 * margin)
  const innerH = Math.max(rows, f.h - safe.top - safe.bottom - 2 * margin)
  return {
    cols, rows,
    originX: safe.left + margin,
    originY: safe.top + margin,
    cellW: (innerW - gutter * (cols - 1)) / cols,
    cellH: (innerH - gutter * (rows - 1)) / rows,
    gutter, margin, baseline, scale: s,
  }
}

export function regionToRect(region: Region, m: GridMetrics): Rect {
  const col = Math.min(m.cols, Math.max(1, Math.round(region.col)))
  const row = Math.min(m.rows, Math.max(1, Math.round(region.row)))
  const colSpan = Math.max(1, Math.min(m.cols - col + 1, Math.round(region.colSpan)))
  const rowSpan = Math.max(1, Math.min(m.rows - row + 1, Math.round(region.rowSpan)))
  return {
    x: m.originX + (col - 1) * (m.cellW + m.gutter),
    y: m.originY + (row - 1) * (m.cellH + m.gutter),
    w: colSpan * m.cellW + (colSpan - 1) * m.gutter,
    h: rowSpan * m.cellH + (rowSpan - 1) * m.gutter,
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
