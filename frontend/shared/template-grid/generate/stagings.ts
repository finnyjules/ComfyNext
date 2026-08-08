import type { BrandKit, ElementV2, Region, TextLevel, TextStyleV2, Tiers, TierId } from '../types'
import type { Rng } from './rng'
import type { KnobSpec } from './knobs'
import { DEFAULT_TIER_LEVELS, tierEntries } from './tiers'

export interface StagingInput {
  tiers: Tiers
  cols: number
  rows: number
  rng: Rng
  knobs: Record<string, unknown>
  brand?: BrandKit
}

export interface Staging {
  id: string
  name: string
  blurb: string
  knobs: KnobSpec[]
  supports?: { minTiers?: number; maxTiers?: number; surfaces?: string[] }
  compose(input: StagingInput): ElementV2[]
}

/** Build a placed text element for a tier. Level defaults from the tier but a
 *  staging may override (e.g. force the hero to display). `origin:'staging'`
 *  marks it regenerable. Foreground colour binds to the brand token so surfaces
 *  can flip contrast. */
export function tierText(
  id: TierId, tiers: Tiers, region: Region, priority: number,
  opts: { level?: TextLevel; style?: TextStyleV2 } = {},
): ElementV2 {
  const spec = tiers[id]!
  return {
    id: `tier_${id}`,
    type: 'text',
    content: spec.content,
    level: opts.level ?? DEFAULT_TIER_LEVELS[id],
    priority,
    region,
    origin: 'staging',
    role: id.toUpperCase(),
    style: {
      color: '{{ brand.foreground }}',
      ...opts.style,
      ...spec.type,   // tier's own type wins — survives re-roll
    },
  }
}

/** Clamp a region so it never leaves the grid. */
function clampRegion(r: Region, cols: number, rows: number): Region {
  const col = Math.min(Math.max(1, r.col), cols)
  const row = Math.min(Math.max(1, r.row), rows)
  return {
    col, row,
    colSpan: Math.max(1, Math.min(r.colSpan, cols - col + 1)),
    rowSpan: Math.max(1, Math.min(r.rowSpan, rows - row + 1)),
  }
}

/**
 * Tower — hero stacked at the top, fine print pinned to the corners, anchor
 * (date) blown up at the bottom. The MAT+FEST composition.
 */
const tower: Staging = {
  id: 'tower',
  name: 'Tower',
  blurb: 'Hero stacked top, anchor as a bottom slab; corners hold the fine print.',
  knobs: [{ id: 'align', pick: ['left', 'right'] }],
  compose({ tiers, cols, rows, knobs }) {
    const els: ElementV2[] = []
    const left = knobs.align !== 'right'
    const entries = tierEntries(tiers)
    const has = (id: TierId) => entries.some(e => e.id === id)
    const full = { col: 1, colSpan: cols }
    const align: TextStyleV2['align'] = left ? 'left' : 'right'

    if (has('fineprint')) {
      els.push(tierText('fineprint', tiers,
        clampRegion({ ...full, row: 1, rowSpan: 1 }, cols, rows), 4,
        { style: { align, valign: 'top' } }))
    }
    if (has('hero')) {
      els.push(tierText('hero', tiers,
        clampRegion({ ...full, row: 2, rowSpan: Math.round(rows * 0.4) }, cols, rows), 1,
        { level: 'display', style: { align, valign: 'top', fontWeight: 700 } }))
    }
    if (has('support')) {
      els.push(tierText('support', tiers,
        clampRegion({ col: 1, colSpan: Math.round(cols / 2), row: Math.round(rows * 0.56), rowSpan: 2 }, cols, rows), 3,
        { style: { align: 'left', valign: 'top' } }))
    }
    if (has('anchor')) {
      els.push(tierText('anchor', tiers,
        clampRegion({ ...full, row: Math.round(rows * 0.72), rowSpan: Math.round(rows * 0.2) }, cols, rows), 2,
        { level: 'headline', style: { align, valign: 'bottom', fontWeight: 700 } }))
    }
    return els
  },
}

export const STAGINGS: Staging[] = [tower]

export function getStaging(id: string): Staging | undefined {
  return STAGINGS.find(s => s.id === id)
}
