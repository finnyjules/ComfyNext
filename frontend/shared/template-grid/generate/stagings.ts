import type {
  BrandKit, ElementV2, Region, TextLevel, TextOverflow, TextStyleV2, Tiers, TierId, TierSpec,
} from '../types'
import type { Rng } from './rng'
import type { KnobSpec } from './knobs'
import { DEFAULT_TIER_LEVELS, tierEntries } from './tiers'

export interface StagingInput {
  tiers: Tiers
  cols: number
  rows: number
  /** Master format px (the design-time output). Drives the hero/anchor
   *  dramatic type override — `typeSize` still reflows it per output format. */
  canvas: { w: number; h: number }
  rng: Rng
  knobs: Record<string, unknown>
  brand?: BrandKit
}

/** What a staging hands back to the orchestrator: elements ordered
 *  back→front (the staged z-order), plus an optional declaration of which
 *  element-id pairs are INTENTIONALLY overlapping (e.g. an overprinted
 *  title, text laid behind a photo). `overlaps` pairs are exempted from the
 *  validator's collision check — undeclared collisions still fail. */
export interface StagingResult {
  elements: ElementV2[]
  overlaps?: Array<[string, string]>
}

export interface Staging {
  id: string
  name: string
  blurb: string
  knobs: KnobSpec[]
  supports?: { minTiers?: number; maxTiers?: number; surfaces?: string[] }
  compose(input: StagingInput): StagingResult
}

/** Every staging rolls this knob — the user-directed drama lever: how big the
 *  hero reads relative to the canvas. */
const HERO_SCALE_KNOB: KnobSpec = { id: 'heroScale', pick: [0.10, 0.14, 0.18] }

/** Build a placed text element for ONE item of a tier's (already-filtered)
 *  list. `index` is this item's position in that filtered list, not its raw
 *  position in the stored tier — a disabled/empty item 0 never shifts a
 *  valid item 1's id. `origin:'staging'` marks it regenerable. No default
 *  colour here — `applyContrast` (in generate.ts) fills it from the
 *  surface's light/dark contrast unless the tier's own `spec.type.color`
 *  already won. */
export function tierText(
  id: TierId, index: number, item: TierSpec, region: Region, priority: number,
  opts: { level?: TextLevel; style?: TextStyleV2; overflow?: TextOverflow } = {},
): ElementV2 {
  return {
    id: `tier_${id}_${index}`,
    type: 'text',
    content: item.content,
    level: opts.level ?? DEFAULT_TIER_LEVELS[id],
    priority,
    region,
    origin: 'staging',
    role: id.toUpperCase(),
    ...(opts.overflow ? { overflow: opts.overflow } : {}),
    style: {
      ...opts.style,
      ...item.type,   // tier's own type wins — survives re-roll
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

/** Hero/anchor dramatic type: hero's `style.fontSize` is a whole master-px
 *  override — `heroScale` (10-18% of canvas height) is the user-directed
 *  "much bigger hero" lever, with a tight `lineHeight` and slightly negative
 *  `letterSpacing` for a poster-like set. Anchor tracks proportionally
 *  underneath it (tight setting). Computed once per `compose()` call so
 *  every staging gets identical drama for a given knob roll; a tier's own
 *  `type` (spread last in `tierText`) still wins. */
function dramaticType(knobs: Record<string, unknown>, canvas: { w: number; h: number }):
  { hero: TextStyleV2; anchor: TextStyleV2 } {
  const heroScale = Number(knobs.heroScale ?? 0.14)
  const heroFontSize = Math.round(heroScale * canvas.h)
  const anchorFontSize = Math.round(0.45 * heroFontSize)
  return {
    hero: { fontSize: heroFontSize, lineHeight: 0.92, letterSpacing: -Math.round(0.03 * heroFontSize) },
    anchor: { fontSize: anchorFontSize, letterSpacing: -Math.round(0.02 * anchorFontSize) },
  }
}

/** Enabled, non-empty items for one tier, filtered-list order — the source
 *  of truth for both element ids and distribution (NOT raw storage index). */
function tierItems(entries: Array<{ id: TierId; items: TierSpec[] }>, id: TierId): TierSpec[] {
  return entries.find(e => e.id === id)?.items ?? []
}

/** Support-style distribution: item *i* stacks at `base.row + i * rowSpan`
 *  (clamped to the grid). Nothing is dropped — an overflow item just keeps
 *  stacking downward (clamping shrinks its span rather than losing it).
 *
 *  `singleRowSpan`, when given, is the box height used ONLY when there's
 *  exactly one item — the round-1 generous span. `base.rowSpan` stays the
 *  compact multi-item value, used whenever 2+ items must share the slot. A
 *  lone item gets the bigger box back instead of the space reserved for
 *  stacking it never needs. */
function stackVertical(
  id: TierId, items: TierSpec[], base: Region, cols: number, rows: number,
  priority: number, opts: { level?: TextLevel; style?: TextStyleV2 } = {},
  singleRowSpan?: number,
): ElementV2[] {
  const rowSpan = items.length === 1 && singleRowSpan !== undefined ? singleRowSpan : base.rowSpan
  return items.map((item, i) => tierText(id, i, item,
    clampRegion({ ...base, row: base.row + i * rowSpan, rowSpan }, cols, rows), priority, opts))
}

/** Fine-print distribution for tower/centered: items alternate between the
 *  left and right corner regions by index (0→left, 1→right, 2→left one row
 *  down, …) — nothing dropped, overflow keeps stacking downward within its
 *  corner. */
function stackCorners(
  id: TierId, items: TierSpec[], left: Region, right: Region, cols: number, rows: number,
  priority: number, opts: { level?: TextLevel; style?: TextStyleV2 } = {},
): ElementV2[] {
  return items.map((item, i) => {
    const base = i % 2 === 0 ? left : right
    const layer = Math.floor(i / 2)
    return tierText(id, i, item,
      clampRegion({ ...base, row: base.row + layer * base.rowSpan }, cols, rows), priority, opts)
  })
}

/**
 * Tower — hero stacked at the top, fine print pinned to the corners, anchor
 * (date) blown up at the bottom. The MAT+FEST composition.
 */
const tower: Staging = {
  id: 'tower',
  name: 'Tower',
  blurb: 'Hero stacked top, anchor as a bottom slab; corners hold the fine print.',
  knobs: [{ id: 'align', pick: ['left', 'right'] }, HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs }) {
    const els: ElementV2[] = []
    const left = knobs.align !== 'right'
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)
    const full = { col: 1, colSpan: cols }
    const align: TextStyleV2['align'] = left ? 'left' : 'right'
    const half = Math.round(cols / 2)

    const fine = items('fineprint')
    if (fine.length) {
      els.push(...stackCorners('fineprint', fine,
        { col: 1, colSpan: half, row: 1, rowSpan: 1 },
        { col: half + 1, colSpan: cols - half, row: 1, rowSpan: 1 },
        cols, rows, 4, { style: { align, valign: 'top' } }))
    }
    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ ...full, row: 2, rowSpan: Math.round(rows * 0.4) }, cols, rows), 1,
        { level: 'display', overflow: 'grow', style: { align, valign: 'top', fontWeight: 700, ...drama.hero } }))
    }
    const support = items('support')
    if (support.length) {
      els.push(...stackVertical('support', support,
        { col: 1, colSpan: half, row: Math.round(rows * 0.56), rowSpan: 1 },
        cols, rows, 3, { style: { align: 'left', valign: 'top' } }, 2))
    }
    const anchor = items('anchor')
    if (anchor.length) {
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ ...full, row: Math.round(rows * 0.72), rowSpan: Math.round(rows * 0.2) }, cols, rows), 2,
        { level: 'headline', style: { align, valign: 'bottom', fontWeight: 700, ...drama.anchor } }))
    }
    return { elements: els }
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
  knobs: [{ id: 'drop', pick: [2, 3, 4] }, HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs }) {
    const els: ElementV2[] = []
    const half = Math.round(cols / 2)
    const drop = Number(knobs.drop ?? 3)
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)

    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ col: 1, colSpan: cols, row: 2, rowSpan: Math.round(rows * 0.22) }, cols, rows), 1,
        { level: 'display', overflow: 'grow', style: { align: 'left', valign: 'top', fontWeight: 700, ...drama.hero } }))
    }
    const support = items('support')
    if (support.length) {
      els.push(...stackVertical('support', support,
        { col: 1, colSpan: half, row: Math.round(rows * 0.44), rowSpan: 2 },
        cols, rows, 3, { style: { align: 'left', valign: 'top' } }, 3))
    }
    const anchor = items('anchor')
    if (anchor.length) {
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ col: 1, colSpan: cols, row: rows - drop - 2, rowSpan: 2 }, cols, rows), 2,
        { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700, ...drama.anchor } }))
    }
    const fine = items('fineprint')
    if (fine.length) {
      els.push(...stackVertical('fineprint', fine,
        { col: half, colSpan: cols - half + 1, row: rows - 1, rowSpan: 1 },
        cols, rows, 4, { style: { align: 'right', valign: 'bottom' } }))
    }
    return { elements: els }
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
  knobs: [{ id: 'corner', pick: ['tl', 'bl'] }, HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs }) {
    const els: ElementV2[] = []
    const heroTop = knobs.corner === 'bl' ? Math.round(rows * 0.55) : 2
    const half = Math.round(cols / 2)
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)

    const hero = items('hero')
    if (hero.length) {
      // colSpan stops at `half` (not half+1) so it never shares a column
      // with the right-rail support/fine print, regardless of row overlap.
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ col: 1, colSpan: half, row: heroTop, rowSpan: Math.round(rows * 0.28) }, cols, rows), 1,
        { level: 'display', overflow: 'grow', style: { align: 'left', valign: 'top', fontWeight: 700, ...drama.hero } }))
    }
    const support = items('support')
    if (support.length) {
      els.push(...stackVertical('support', support,
        { col: half + 1, colSpan: cols - half, row: Math.round(rows * 0.42), rowSpan: 3 },
        cols, rows, 3, { style: { align: 'right', valign: 'top' } }))
    }
    const anchor = items('anchor')
    if (anchor.length) {
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ col: 1, colSpan: cols, row: rows - 2, rowSpan: 2 }, cols, rows), 2,
        { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700, ...drama.anchor } }))
    }
    const fine = items('fineprint')
    if (fine.length) {
      els.push(...stackVertical('fineprint', fine,
        { col: half + 1, colSpan: cols - half, row: 1, rowSpan: 1 },
        cols, rows, 4, { style: { align: 'right', valign: 'top' } }))
    }
    return { elements: els }
  },
}

/** Centered — hero centred with symmetric air; anchor below; fine print pinned
 *  to top and bottom edges. Quiet, poster-like. */
const centered: Staging = {
  id: 'centered', name: 'Centered',
  blurb: 'Hero centred with symmetric air above and below.',
  knobs: [HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs }) {
    const els: ElementV2[] = []
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)
    const half = Math.round(cols / 2)

    const fine = items('fineprint')
    if (fine.length) {
      els.push(...stackCorners('fineprint', fine,
        { col: 1, colSpan: half, row: 1, rowSpan: 1 },
        { col: half + 1, colSpan: cols - half, row: 1, rowSpan: 1 },
        cols, rows, 4, { style: { align: 'center', valign: 'top' } }))
    }
    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ col: 1, colSpan: cols, row: Math.round(rows * 0.32), rowSpan: Math.round(rows * 0.3) }, cols, rows), 1,
        { level: 'display', overflow: 'grow', style: { align: 'center', valign: 'middle', fontWeight: 700, ...drama.hero } }))
    }
    const anchor = items('anchor')
    if (anchor.length) {
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ col: 1, colSpan: cols, row: Math.round(rows * 0.66), rowSpan: 2 }, cols, rows), 2,
        { level: 'headline', style: { align: 'center', valign: 'top', ...drama.anchor } }))
    }
    const support = items('support')
    if (support.length) {
      els.push(...stackVertical('support', support,
        { col: Math.round((cols - Math.round(cols * 0.5)) / 2) + 1, colSpan: Math.round(cols * 0.5), row: rows - 2, rowSpan: 2 },
        cols, rows, 3, { style: { align: 'center', valign: 'bottom' } }))
    }
    return { elements: els }
  },
}

/** Editorial — a left type column (hero + support stacked) beside an open right
 *  field; anchor bottom-right, fine print top-right. */
const editorial: Staging = {
  id: 'editorial', name: 'Editorial',
  blurb: 'Left type column against an open right field.',
  // Fraction of `cols`, not an absolute count — the authoring grid's column
  // count varies by format class/version (6 on a v2 square, 78 on a
  // baseline-derived v3 grid), so a fixed literal like `7` reads as "most of
  // the canvas" on one and "a sliver" on the other. ~50–67% of the width.
  knobs: [{ id: 'colw', pick: [0.5, 0.58, 0.67] }, HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs }) {
    const els: ElementV2[] = []
    const colw = Math.min(Math.max(1, Math.round(cols * Number(knobs.colw ?? 0.58))), cols - 1)
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)

    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ col: 1, colSpan: colw, row: 2, rowSpan: Math.round(rows * 0.34) }, cols, rows), 1,
        { level: 'display', overflow: 'grow', style: { align: 'left', valign: 'top', fontWeight: 700, ...drama.hero } }))
    }
    const support = items('support')
    if (support.length) {
      els.push(...stackVertical('support', support,
        { col: 1, colSpan: colw, row: 2 + Math.round(rows * 0.34), rowSpan: 2 },
        cols, rows, 3, { style: { align: 'left', valign: 'top' } }, 4))
    }
    const fine = items('fineprint')
    if (fine.length) {
      els.push(...stackVertical('fineprint', fine,
        { col: colw + 1, colSpan: cols - colw, row: 2, rowSpan: 2 },
        cols, rows, 4, { style: { align: 'right', valign: 'top' } }))
    }
    const anchor = items('anchor')
    if (anchor.length) {
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ col: colw + 1, colSpan: cols - colw, row: rows - 3, rowSpan: 3 }, cols, rows), 2,
        { level: 'headline', style: { align: 'right', valign: 'bottom', fontWeight: 700, ...drama.anchor } }))
    }
    return { elements: els }
  },
}

/** Index — a numbered/enumerated feel: fine print as a top rail, hero mid, and
 *  support as a left index column with the anchor beneath it. */
const index: Staging = {
  id: 'index', name: 'Index',
  blurb: 'Top rail of meta, hero mid-canvas, indexed support column.',
  knobs: [{ id: 'heroRow', pick: [4, 5, 6] }, HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs }) {
    const els: ElementV2[] = []
    const heroRow = Number(knobs.heroRow ?? 5)
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)

    const fine = items('fineprint')
    if (fine.length) {
      els.push(...stackVertical('fineprint', fine,
        { col: 1, colSpan: cols, row: 1, rowSpan: 1 },
        cols, rows, 4, { style: { align: 'left', valign: 'top' } }))
    }
    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ col: 1, colSpan: cols, row: heroRow, rowSpan: Math.round(rows * 0.3) }, cols, rows), 1,
        { level: 'display', overflow: 'grow', style: { align: 'left', valign: 'top', fontWeight: 700, ...drama.hero } }))
    }
    const support = items('support')
    if (support.length) {
      els.push(...stackVertical('support', support,
        { col: 1, colSpan: Math.round(cols / 2), row: Math.round(rows * 0.68), rowSpan: 1 },
        cols, rows, 3, { style: { align: 'left', valign: 'top' } }, 3))
    }
    const anchor = items('anchor')
    if (anchor.length) {
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ col: 1, colSpan: cols, row: rows - 2, rowSpan: 2 }, cols, rows), 2,
        { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700, ...drama.anchor } }))
    }
    return { elements: els }
  },
}

export const STAGINGS: Staging[] = [tower, split, frame, centered, editorial, index]

export function getStaging(id: string): Staging | undefined {
  return STAGINGS.find(s => s.id === id)
}
