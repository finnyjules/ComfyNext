/** The resolver: template + format key + props → absolutely positioned,
 * culled, copy-fitted elements. The renderer and the editor both consume
 * this output; neither does grid math of its own. */

import {
  FONT_FLOOR, MIN_VISIBLE, bleedToEdges, classifyFormat, formatDims, gridMetrics,
  regionToRect, remapRegion,
} from './grid'
import type { GridMetrics, Rect } from './grid'
import { defaultClassRegion } from './layouts'
import type { Slot } from './layouts'
import { fitText, typeSize, wrapLines } from './text'
import type { FitResult } from './text'
import { resolveTokens } from './tokens'
import type { TokenScope } from './tokens'
import type { ElementV2, FormatClass, FormatSpec, OutputSpec, Region, TemplateV2 } from './types'

/** The deliverables to render. Uses the template's explicit `outputs` when
 * present; otherwise derives one output per format key in `aspectsCsv`
 * (back-compat with the pre-outputs `aspects` widget), falling back to the
 * master. Migrated outputs use id === format key so existing
 * overrides[formatKey] keep resolving. */
export function deriveOutputs(template: TemplateV2, aspectsCsv?: string): OutputSpec[] {
  if (template.outputs?.length) return template.outputs
  const keys = (aspectsCsv ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .filter(k => k in template.formats)
  const fallback = keys.length ? keys : [template.master]
  return fallback.map(k => ({ id: k, format: k, label: template.formats[k]?.label }))
}

export type CullReason = 'no-slot' | 'too-small' | 'hidden'

export interface ResolvedElement {
  el: ElementV2
  region: Region | null
  rect: Rect
  culled: boolean
  cullReason?: CullReason
  text?: FitResult        // text elements only
  mark?: boolean          // image collapsed to a centered square mark
}

export interface ResolvedLayout {
  formatKey: string
  format: FormatSpec
  formatClass: FormatClass
  metrics: GridMetrics
  elements: ResolvedElement[]   // template order = z-order
}

const ZERO_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 }
const MIN_MARK = 8   // px; marks smaller than this are culled outright

export function resolveFormat(
  template: TemplateV2,
  formatKey: string,
  props: TokenScope = {},
  brand: TokenScope = {},
  opts: { outputId?: string } = {},
): ResolvedLayout {
  const format = template.formats[formatKey]
  if (!format) throw new Error(`Unknown format '${formatKey}' on template '${template.id}'`)
  const cls = classifyFormat(format)
  const m = gridMetrics(template, formatKey)
  const masterDims = formatDims(template.formats[template.master])
  // Per-output overrides key. Falls back to the format key so single-output
  // (pre-outputs) templates keep resolving their overrides[formatKey].
  const oid = opts.outputId ?? formatKey

  // Region assignment runs in priority order so high-priority elements win
  // contested default slots. Rendering below keeps template order (z-order).
  const regions = new Map<string, Region | null>()
  const taken = new Set<Slot>()
  const byPriority = [...template.elements].sort((a, b) => a.priority - b.priority)
  for (const el of byPriority) {
    const explicit = el.overrides?.[oid]?.region ?? el.regionByClass?.[cls]
    if (explicit) {
      regions.set(el.id, explicit)
    } else if (cls === 'strip' || cls === 'skyscraper') {
      regions.set(el.id, defaultClassRegion(el, cls, m, taken))
    } else {
      regions.set(el.id, remapRegion(el.region, masterDims, m))
    }
  }

  const elements = template.elements.map((el): ResolvedElement => {
    // Hidden globally or in this specific output — drop before geometry.
    if (el.hidden || el.overrides?.[oid]?.hidden) {
      return { el, region: null, rect: ZERO_RECT, culled: true, cullReason: 'hidden' }
    }
    let region = regions.get(el.id) ?? null
    if (!region) return { el, region: null, rect: ZERO_RECT, culled: true, cullReason: 'no-slot' }

    if (el.type === 'text') {
      const lineHeight = el.style?.lineHeight ?? 1.1
      const overflow = el.overflow ?? 'shrink-then-truncate'
      let content = String(resolveTokens(el.content, props, brand) ?? '')
      // Transform happens here so copy fitting, the editor canvas, and the
      // satori render all see the same final string.
      if (el.style?.transform === 'uppercase') content = content.toUpperCase()
      const maxFontSize = typeSize(el.level, template, formatKey, el.style?.fontSize)
      let rect = regionToRect(region, m)
      if (overflow === 'grow') {
        const fullFits = () => {
          const lines = wrapLines(content, maxFontSize, rect.w)
          const okLines = el.maxLines == null || lines.length <= el.maxLines
          return okLines && lines.length * maxFontSize * lineHeight <= rect.h
        }
        while (!fullFits() && region.row + region.rowSpan - 1 < m.rows) {
          region = { ...region, rowSpan: region.rowSpan + 1 }
          rect = regionToRect(region, m)
        }
      }
      if (rect.h < FONT_FLOOR * lineHeight) {
        return { el, region, rect, culled: true, cullReason: 'too-small' }
      }
      // An explicit fontSize is the user's exact target — don't auto-shrink it.
      // Text fits inside the un-bled (margin-respecting) box, so lines wrap on
      // the grid; bleed only extends the container rect (for panel/scrim) past
      // the margin. This matches "text respects the margin, panel goes wider".
      const text = fitText({
        content, maxFontSize, w: rect.w, h: rect.h, lineHeight, overflow,
        maxLines: el.maxLines, autoShrink: el.style?.fontSize == null,
      })
      const outRect = el.bleed ? bleedToEdges(rect, region, m, format.w, format.h) : rect
      return { el, region, rect: outRect, culled: false, text }
    }

    const rect = regionToRect(region, m)
    if (el.type === 'image' && el.collapse === 'mark') {
      const side = Math.min(rect.w, rect.h)
      if (side < MIN_MARK) return { el, region, rect, culled: true, cullReason: 'too-small' }
      const markRect = { x: rect.x + (rect.w - side) / 2, y: rect.y + (rect.h - side) / 2, w: side, h: side }
      return { el, region, rect: markRect, culled: false, mark: true }
    }
    if (rect.w < MIN_VISIBLE || rect.h < MIN_VISIBLE) {
      return { el, region, rect, culled: true, cullReason: 'too-small' }
    }
    const outRect = el.bleed ? bleedToEdges(rect, region, m, format.w, format.h) : rect
    return { el, region, rect: outRect, culled: false }
  })

  return { formatKey, format, formatClass: cls, metrics: m, elements }
}
