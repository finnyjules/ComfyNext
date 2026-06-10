/** Default class layouts for strip and skyscraper formats. Proportional
 * remap from a square master to a 12×1 banner produces garbage compositions,
 * so these classes use fixed slot tables on a reference grid, remapped to
 * the format's actual column count. Elements claim slots in priority order;
 * losers and slotless elements (shapes, extra texts) are culled. */

import { remapRegion } from './grid'
import type { ElementV2, Region } from './types'

export type Slot = 'logo' | 'image' | 'headline' | 'subhead' | 'cta'

export function slotOf(el: ElementV2): Slot | null {
  const role = (el.role ?? '').toUpperCase()
  if (role.includes('LOGO')) return 'logo'
  if (role.includes('CTA')) return 'cta'
  if (el.type === 'image') return el.collapse === 'mark' ? 'logo' : 'image'
  if (el.type === 'text') {
    return el.level === 'display' || el.level === 'headline' ? 'headline' : 'subhead'
  }
  return null
}

const REF = {
  strip:      { cols: 12, rows: 1 },
  skyscraper: { cols: 3,  rows: 10 },
} as const

const SLOTS: Record<'strip' | 'skyscraper', Partial<Record<Slot, Region>>> = {
  strip: {
    logo:     { col: 1,  colSpan: 2, row: 1, rowSpan: 1 },
    headline: { col: 3,  colSpan: 6, row: 1, rowSpan: 1 },
    image:    { col: 9,  colSpan: 1, row: 1, rowSpan: 1 },
    cta:      { col: 10, colSpan: 3, row: 1, rowSpan: 1 },
    // subhead intentionally absent: strips cull it by default
  },
  skyscraper: {
    logo:     { col: 1, colSpan: 3, row: 1, rowSpan: 1 },
    image:    { col: 1, colSpan: 3, row: 2, rowSpan: 3 },
    headline: { col: 1, colSpan: 3, row: 5, rowSpan: 3 },
    subhead:  { col: 1, colSpan: 3, row: 8, rowSpan: 1 },
    cta:      { col: 1, colSpan: 3, row: 9, rowSpan: 2 },
  },
}

export function defaultClassRegion(
  el: ElementV2,
  cls: 'strip' | 'skyscraper',
  dims: { cols: number; rows: number },
  taken: Set<Slot>,
): Region | null {
  const slot = slotOf(el)
  if (!slot || taken.has(slot)) return null
  const ref = SLOTS[cls][slot]
  if (!ref) return null
  taken.add(slot)
  return remapRegion(ref, REF[cls], dims)
}
