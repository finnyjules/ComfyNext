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

/**
 * Split — hero broken across a diagonal of air: first half flush-left high,
 * second half flush-right lower. Anchor sits bottom-left, fine print bottom-right.
 */
const split: Staging = {
  id: 'split',
  name: 'Split',
  blurb: 'Hero broken across a diagonal of whitespace.',
  knobs: [{ id: 'drop', pick: [2, 3, 4] }],
  compose({ tiers, cols, rows, knobs }) {
    const els: ElementV2[] = []
    const half = Math.round(cols / 2)
    const drop = Number(knobs.drop ?? 3)
    if (tiers.hero) {
      els.push(tierText('hero', tiers,
        clampRegion({ col: 1, colSpan: cols, row: 2, rowSpan: Math.round(rows * 0.22) }, cols, rows), 1,
        { level: 'display', style: { align: 'left', valign: 'top', fontWeight: 700 } }))
    }
    if (tiers.support) {
      els.push(tierText('support', tiers,
        clampRegion({ col: 1, colSpan: half, row: Math.round(rows * 0.44), rowSpan: 3 }, cols, rows), 3,
        { style: { align: 'left', valign: 'top' } }))
    }
    if (tiers.anchor) {
      els.push(tierText('anchor', tiers,
        clampRegion({ col: 1, colSpan: cols, row: rows - drop - 2, rowSpan: 2 }, cols, rows), 2,
        { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700 } }))
    }
    if (tiers.fineprint) {
      els.push(tierText('fineprint', tiers,
        clampRegion({ col: half, colSpan: cols - half + 1, row: rows, rowSpan: 1 }, cols, rows), 4,
        { style: { align: 'right', valign: 'bottom' } }))
    }
    return els
  },
}

/**
 * Frame — hero anchored to the top-left corner with generous air below (that
 * air is where an image surface reads). Anchor bottom-left; support/fine print
 * hug the right edge.
 */
const frame: Staging = {
  id: 'frame',
  name: 'Frame',
  blurb: 'Hero anchored to a corner; the open field carries the surface.',
  knobs: [{ id: 'corner', pick: ['tl', 'bl'] }],
  compose({ tiers, cols, rows, knobs }) {
    const els: ElementV2[] = []
    const heroTop = knobs.corner === 'bl' ? Math.round(rows * 0.55) : 2
    const half = Math.round(cols / 2)
    if (tiers.hero) {
      els.push(tierText('hero', tiers,
        clampRegion({ col: 1, colSpan: half + 1, row: heroTop, rowSpan: Math.round(rows * 0.28) }, cols, rows), 1,
        { level: 'display', style: { align: 'left', valign: 'top', fontWeight: 700 } }))
    }
    if (tiers.support) {
      els.push(tierText('support', tiers,
        clampRegion({ col: half + 1, colSpan: cols - half, row: Math.round(rows * 0.42), rowSpan: 3 }, cols, rows), 3,
        { style: { align: 'right', valign: 'top' } }))
    }
    if (tiers.anchor) {
      els.push(tierText('anchor', tiers,
        clampRegion({ col: 1, colSpan: cols, row: rows - 2, rowSpan: 2 }, cols, rows), 2,
        { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700 } }))
    }
    if (tiers.fineprint) {
      els.push(tierText('fineprint', tiers,
        clampRegion({ col: half + 1, colSpan: cols - half, row: 1, rowSpan: 1 }, cols, rows), 4,
        { style: { align: 'right', valign: 'top' } }))
    }
    return els
  },
}

/** Centered — hero centred with symmetric air; anchor below; fine print pinned
 *  to top and bottom edges. Quiet, poster-like. */
const centered: Staging = {
  id: 'centered', name: 'Centered',
  blurb: 'Hero centred with symmetric air above and below.',
  knobs: [],
  compose({ tiers, cols, rows }) {
    const els: ElementV2[] = []
    if (tiers.fineprint) els.push(tierText('fineprint', tiers,
      clampRegion({ col: 1, colSpan: cols, row: 1, rowSpan: 1 }, cols, rows), 4,
      { style: { align: 'center', valign: 'top' } }))
    if (tiers.hero) els.push(tierText('hero', tiers,
      clampRegion({ col: 1, colSpan: cols, row: Math.round(rows * 0.32), rowSpan: Math.round(rows * 0.3) }, cols, rows), 1,
      { level: 'display', style: { align: 'center', valign: 'middle', fontWeight: 700 } }))
    if (tiers.anchor) els.push(tierText('anchor', tiers,
      clampRegion({ col: 1, colSpan: cols, row: Math.round(rows * 0.66), rowSpan: 2 }, cols, rows), 2,
      { level: 'headline', style: { align: 'center', valign: 'top' } }))
    if (tiers.support) els.push(tierText('support', tiers,
      clampRegion({ col: Math.round(cols * 0.25), colSpan: Math.round(cols * 0.5), row: rows - 2, rowSpan: 2 }, cols, rows), 3,
      { style: { align: 'center', valign: 'bottom' } }))
    return els
  },
}

/** Editorial — a left type column (hero + support stacked) beside an open right
 *  field; anchor bottom-right, fine print top-right. */
const editorial: Staging = {
  id: 'editorial', name: 'Editorial',
  blurb: 'Left type column against an open right field.',
  knobs: [{ id: 'colw', pick: [6, 7, 8] }],
  compose({ tiers, cols, rows, knobs }) {
    const els: ElementV2[] = []
    const colw = Math.min(Number(knobs.colw ?? 7), cols - 1)
    if (tiers.hero) els.push(tierText('hero', tiers,
      clampRegion({ col: 1, colSpan: colw, row: 2, rowSpan: Math.round(rows * 0.34) }, cols, rows), 1,
      { level: 'display', style: { align: 'left', valign: 'top', fontWeight: 700 } }))
    if (tiers.support) els.push(tierText('support', tiers,
      clampRegion({ col: 1, colSpan: colw, row: Math.round(rows * 0.4), rowSpan: 4 }, cols, rows), 3,
      { style: { align: 'left', valign: 'top' } }))
    if (tiers.fineprint) els.push(tierText('fineprint', tiers,
      clampRegion({ col: colw + 1, colSpan: cols - colw, row: 2, rowSpan: 2 }, cols, rows), 4,
      { style: { align: 'right', valign: 'top' } }))
    if (tiers.anchor) els.push(tierText('anchor', tiers,
      clampRegion({ col: colw + 1, colSpan: cols - colw, row: rows - 3, rowSpan: 3 }, cols, rows), 2,
      { level: 'headline', style: { align: 'right', valign: 'bottom', fontWeight: 700 } }))
    return els
  },
}

/** Index — a numbered/enumerated feel: fine print as a top rail, hero mid, and
 *  support as a left index column with the anchor beneath it. */
const index: Staging = {
  id: 'index', name: 'Index',
  blurb: 'Top rail of meta, hero mid-canvas, indexed support column.',
  knobs: [{ id: 'heroRow', pick: [4, 5, 6] }],
  compose({ tiers, cols, rows, knobs }) {
    const els: ElementV2[] = []
    const heroRow = Number(knobs.heroRow ?? 5)
    if (tiers.fineprint) els.push(tierText('fineprint', tiers,
      clampRegion({ col: 1, colSpan: cols, row: 1, rowSpan: 1 }, cols, rows), 4,
      { style: { align: 'left', valign: 'top' } }))
    if (tiers.hero) els.push(tierText('hero', tiers,
      clampRegion({ col: 1, colSpan: cols, row: heroRow, rowSpan: Math.round(rows * 0.3) }, cols, rows), 1,
      { level: 'display', style: { align: 'left', valign: 'top', fontWeight: 700 } }))
    if (tiers.support) els.push(tierText('support', tiers,
      clampRegion({ col: 1, colSpan: Math.round(cols / 2), row: Math.round(rows * 0.68), rowSpan: 3 }, cols, rows), 3,
      { style: { align: 'left', valign: 'top' } }))
    if (tiers.anchor) els.push(tierText('anchor', tiers,
      clampRegion({ col: 1, colSpan: cols, row: rows - 2, rowSpan: 2 }, cols, rows), 2,
      { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700 } }))
    return els
  },
}

export const STAGINGS: Staging[] = [tower, split, frame, centered, editorial, index]

export function getStaging(id: string): Staging | undefined {
  return STAGINGS.find(s => s.id === id)
}
