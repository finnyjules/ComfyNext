/** One-way, best-effort v1 → v2 conversion: anchor/offset boxes snap to the
 * nearest grid cells on the master aspect; raw font sizes map to the nearest
 * type-scale level; priorities come from a role heuristic. User-initiated
 * from the editor — never automatic. */

import type {
  LayoutElement, Length, Template,
} from '../../server/templates/schema'
import { gridMetrics } from './grid'
import { LEVELS, typeSize } from './text'
import type { Region, TemplateV2, TextLevel } from './types'

function lenPx(v: Length | undefined, parent: number, fallback: number): number {
  if (v == null) return fallback
  if (typeof v === 'number') return v
  if (v === 'fill') return parent
  if (v === 'auto') return fallback
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? (n / 100) * parent : fallback
}

/** Pixel box of a v1 element on the master aspect (anchor + offset + size). */
function v1Box(el: LayoutElement, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const w = lenPx(el.size.w, W, W * 0.5)
  const h = lenPx(el.size.h, H, H * 0.15)
  const ox = lenPx(el.offset.x, W, 0)
  const oy = lenPx(el.offset.y, H, 0)
  const a = el.anchor
  const x = a.endsWith('left') ? ox
    : a.endsWith('right') ? W - ox - w
    : W / 2 + ox - w / 2
  const y = a.startsWith('top') ? oy
    : a.startsWith('bottom') ? H - oy - h
    : H / 2 + oy - h / 2
  return { x, y, w, h }
}

function rolePriority(el: LayoutElement): number {
  const role = (el.role ?? '').toUpperCase()
  if (role.includes('HEADLINE') || role === 'TEXT_LAYER_1') return 1
  if (role.includes('CTA')) return 2
  if (role.includes('LOGO')) return 3
  if (role === 'IMAGE_LAYER_1' || role.includes('HERO')) return 4
  if (el.type === 'text') return 5
  if (el.type === 'image') return 6
  return 7
}

export function convertV1toV2(t: Template): TemplateV2 {
  const masterKey = t.defaultAspect ?? Object.keys(t.aspects)[0]
  const master = t.aspects[masterKey]
  const s = Math.min(master.w, master.h) / 1080

  const t2: TemplateV2 = {
    version: 2, id: t.id, name: t.name,
    master: masterKey,
    formats: Object.fromEntries(
      Object.entries(t.aspects).map(([k, a]) => [k, { w: a.w, h: a.h, label: a.label }]),
    ),
    grid: { gutter: Math.round(24 * s), margin: Math.round(72 * s), baseline: Math.round(12 * s) },
    typeScale: { base: Math.round(28 * s), ratio: 1.414 },
    background: t.background,
    elements: [],
  }

  const m = gridMetrics(t2, masterKey)
  const step = (cell: number, gutter: number) => cell + gutter
  const snapRegion = (box: { x: number; y: number; w: number; h: number }): Region => {
    const col = Math.min(m.cols, Math.max(1, Math.round((box.x - m.originX) / step(m.cellW, m.gutterX)) + 1))
    const row = Math.min(m.rows, Math.max(1, Math.round((box.y - m.originY) / step(m.cellH, m.gutterY)) + 1))
    return {
      col, row,
      colSpan: Math.max(1, Math.min(m.cols - col + 1, Math.round(box.w / step(m.cellW, m.gutterX)))),
      rowSpan: Math.max(1, Math.min(m.rows - row + 1, Math.round(box.h / step(m.cellH, m.gutterY)))),
    }
  }
  const nearestLevel = (px: number): TextLevel => {
    let best: TextLevel = 'body'
    let bestD = Number.POSITIVE_INFINITY
    for (const level of LEVELS) {
      const d = Math.abs(typeSize(level, t2, masterKey) - px)
      if (d < bestD) { bestD = d; best = level }
    }
    return best
  }

  for (const el of t.elements) {
    const region = snapRegion(v1Box(el, master.w, master.h))
    const priority = rolePriority(el)
    if (el.type === 'text') {
      t2.elements.push({
        id: el.id, type: 'text', role: el.role, priority, region,
        content: el.content,
        level: nearestLevel(el.style?.fontSize ?? 48),
        style: {
          fontFamily: el.style?.fontFamily,
          fontWeight: (el.style?.fontWeight ?? 400) >= 600 ? 700 : 400,
          color: el.style?.color,
          align: el.style?.align,
          lineHeight: el.style?.lineHeight,
          letterSpacing: el.style?.letterSpacing,
        },
      })
    } else if (el.type === 'image') {
      t2.elements.push({
        id: el.id, type: 'image', role: el.role, priority, region,
        content: el.content,
        collapse: (el.role ?? '').toUpperCase().includes('LOGO') ? 'mark' : undefined,
        style: {
          fit: el.style?.fit === 'contain' ? 'contain' : el.style?.fit === 'stretch' ? 'stretch' : 'cover',
          borderRadius: el.style?.borderRadius,
        },
      })
    } else {
      t2.elements.push({
        id: el.id, type: 'shape', role: el.role, priority, region,
        shape: el.shape,
        style: el.style,
      })
    }
  }
  return t2
}
