/** Client-side twin of the Python `_autopopulate_elements_v2`: seed one
 * default element per connected layer socket that no element references yet
 * — whether the layout is empty or already has content (e.g. an image wired
 * into a text-only layout). Shared by the layout editor (draft, at mount)
 * and the batch-export render path (per-render clone) so both surfaces show
 * exactly what a backend run would produce.
 */

import { allElements } from './sections'
import { fineGridDims } from './grid'
import type { TemplateV2 } from './types'

/** True when some element (top-level or section child) already renders the
 * `props.<key>` socket — so we seed a default element per connected socket
 * exactly once, and a layer wired *after* the layout has content still shows. */
export function refsSocket(layout: unknown, key: string): boolean {
  const token = `props.${key}`
  return allElements(layout as any).some((e: any) =>
    e?.id === key || String(e?.content ?? '').includes(token))
}

/** One grid-region element per connected layer socket that no element
 * references yet. Strip/skyscraper placement comes from the resolver's
 * default class layouts. Mutates `layout` in place. */
export function autopopulateV2(layout: TemplateV2, connected: Record<string, string>) {
  const keys = Object.keys(connected).sort()
  for (const key of keys) {
    if (refsSocket(layout, key)) continue
    if (key.startsWith('image_layer_')) {
      const idx = Number(key.slice('image_layer_'.length))
      if (idx === 1) {
        // First image = full-bleed background: spans the whole grid, bleeds to
        // the canvas edges, and sits at the BACK of the z-order (front of the
        // list / order) so it reads as the backdrop behind the text.
        const { cols, rows } = fineGridDims(layout as any, layout.formats[layout.master]!)
        layout.elements.unshift({
          id: key, type: 'image', role: `IMAGE_LAYER_${idx}`, priority: 4,
          region: { col: 1, colSpan: cols, row: 1, rowSpan: rows },
          bleed: true,
          focal: { x: 0.5, y: 0.5 },
          style: { fit: 'cover' },
          content: `{{ props.${key} }}`,
        } as any)
        const ord = (layout as any).order
        if (Array.isArray(ord) && !ord.includes(key)) ord.unshift(key)
      } else {
        layout.elements.push({
          id: key, type: 'image', role: `IMAGE_LAYER_${idx}`, priority: 5 + idx,
          region: { col: 6, colSpan: 1, row: Math.min(6, idx - 1), rowSpan: 1 },
          collapse: 'mark',
          style: { fit: 'cover' },
          content: `{{ props.${key} }}`,
        } as any)
      }
    } else if (key.startsWith('text_layer_')) {
      const idx = Number(key.slice('text_layer_'.length))
      if (idx === 1) {
        layout.elements.push({
          id: key, type: 'text', role: `TEXT_LAYER_${idx}`, priority: 1,
          level: 'display',
          region: { col: 1, colSpan: 6, row: 4, rowSpan: 2 },
          overflow: 'shrink-then-truncate',
          style: { fontWeight: 700, color: '#ffffff' },
          content: `{{ props.${key} }}`,
        } as any)
      } else {
        layout.elements.push({
          id: key, type: 'text', role: `TEXT_LAYER_${idx}`, priority: 5,
          level: 'subhead',
          region: { col: 1, colSpan: 4, row: 6, rowSpan: 1 },
          style: { color: '#ffffff' },
          content: `{{ props.${key} }}`,
        } as any)
      }
    }
  }
}
