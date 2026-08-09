import type {
  BrandKit, ElementV2, ImageElementV2, Region, TextLevel, TextOverflow, TextStyleV2, Tiers, TierId, TierSpec,
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
  /** The wired image-socket CONTENT token (e.g. `'{{ props.image_layer_1 }}'`),
   *  threaded from `generate()`'s `opts.image` — undefined when no image is
   *  wired. A Family B/C staging (Task 3/4) passes this straight into
   *  `tierImage`'s `content` param; `getStaging`'s caller only needs
   *  PRESENCE (see `Staging.supports.needsImage` + `surprise()`'s pool
   *  filter) — the actual token value is what makes it resolvable at
   *  render/preview time via `resolveTokens`. */
  image?: string
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
  supports?: {
    minTiers?: number
    maxTiers?: number
    surfaces?: string[]
    /** Family C ("Photo-as-field") stagings: the composition IS the photo
     *  (full-bleed field, band, etc.) — degrading to no-photo would leave an
     *  empty/placeholder canvas, unlike Family B ("Photo-as-block") which
     *  degrades gracefully by just dropping the photo block. `surprise()`'s
     *  pool excludes these when `ctx.image` is absent, so the auto-roll
     *  never lands on one with nothing to show. */
    needsImage?: boolean
  }
  compose(input: StagingInput): StagingResult
}

/** Every staging rolls this knob — the user-directed drama lever: how big the
 *  hero reads relative to the canvas. */
const HERO_SCALE_KNOB: KnobSpec = { id: 'heroScale', pick: [0.10, 0.14, 0.18] }

/** Build a placed text element for ONE item of a tier's (already-filtered)
 *  list. `index` is this item's position in that filtered list, not its raw
 *  position in the stored tier — a disabled/empty item 0 never shifts a
 *  valid item 1's id. `origin:'staging'` marks it regenerable. No default
 *  colour here — `generate.ts` injects the theme's ink (`brand.foreground`,
 *  or `brand.accent` on the hero when `accentOnHero`) post-compose unless
 *  the tier's own `spec.type.color` already won. */
export function tierText(
  id: TierId, index: number, item: TierSpec, region: Region, priority: number,
  opts: { level?: TextLevel; style?: TextStyleV2; overflow?: TextOverflow; overhang?: boolean } = {},
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
    ...(opts.overhang ? { overhang: true } : {}),
    style: {
      ...opts.style,
      ...item.type,   // tier's own type wins — survives re-roll
    },
  }
}

/** Build a placed image element for one staging-owned photo slot. `slot` is a
 *  short staging-local name (e.g. `'0'`, `'right'`) — the id is always
 *  `img_<slot>` per the naming convention every staged element follows.
 *  `content` is the CONTENT token (`StagingInput.image`, e.g.
 *  `'{{ props.image_layer_1 }}'`) — callers pass it straight through, never
 *  a resolved URL. Defaults to `fit:'cover'` and a centered focal point;
 *  `opts.bleed`/`opts.overhang` pass through to the element flags a Family
 *  B/C staging needs (full-bleed photo fields, corner-pinned overhang crops)
 *  — see the family tables. No staging calls this yet (Round-2b Tasks 3–4
 *  are the first consumers); exported now so the interface lands ahead of
 *  its callers. */
export function tierImage(
  slot: string, content: string, region: Region, priority: number,
  opts: { bleed?: boolean; overhang?: boolean } = {},
): ImageElementV2 {
  return {
    id: `img_${slot}`,
    type: 'image',
    content,
    priority,
    region,
    origin: 'staging',
    focal: { x: 0.5, y: 0.5 },
    style: { fit: 'cover' },
    ...(opts.bleed ? { bleed: true } : {}),
    ...(opts.overhang ? { overhang: true } : {}),
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

/** Family A's tables give REGIONS as `[aFrac..bFrac]` — start/end fractions
 *  of the grid, not a start+span pair like the round-1 composers use. These
 *  two helpers convert that notation with `Math.round`, offsetting the start
 *  edge by one grid unit past its rounded fraction (`round(aFrac*n) + 1`)
 *  so two ADJACENT bands from the same table row (e.g. a hero ending at 0.55
 *  and a support column starting at 0.58) never round to the same grid line
 *  and collide — the round-1 collision class this task's family tables are
 *  most exposed to, since they're authored as continuous zones instead of
 *  composer-picked absolute offsets. */
function rowBand(aFrac: number, bFrac: number, rows: number): { row: number; rowSpan: number } {
  const row = Math.max(1, Math.round(aFrac * rows) + 1)
  const end = Math.max(row, Math.round(bFrac * rows))
  return { row, rowSpan: end - row + 1 }
}
function colBand(aFrac: number, bFrac: number, cols: number): { col: number; colSpan: number } {
  const col = Math.max(1, Math.round(aFrac * cols) + 1)
  const end = Math.max(col, Math.round(bFrac * cols))
  return { col, colSpan: end - col + 1 }
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
 * Tower — hero stacked at the top, a centered photo block mid-canvas, anchor
 * (date) as a bottom slab, fine print pinned to the corners. Family B
 * (round-2b Table B) rebuild: the photo only appears when `input.image` is
 * wired (`tierImage`, id `img_0`); without one the block's rows/cols are
 * simply air — hero/anchor/support keep their table positions, nothing
 * reflows. Support sits left of the photo, sized off the photo's OWN row
 * band (`photoRegion`), not a literal fraction — so degrade never depends on
 * whether the image actually rendered.
 */
const tower: Staging = {
  id: 'tower',
  name: 'Tower',
  blurb: 'Hero stacked top, a centered photo block, anchor as a bottom slab; corners hold the fine print.',
  knobs: [{ id: 'align', pick: ['left', 'right'] }, HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs, image }) {
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
    const heroRows = rowBand(0.10, 0.44, rows)
    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ ...full, ...heroRows }, cols, rows), 1,
        { level: 'display', overflow: 'grow', style: { align, valign: 'top', fontWeight: 700, ...drama.hero } }))
    }
    // Computed regardless of `image` presence — degrade keeps support's
    // position anchored to where the photo WOULD sit (the table's contract:
    // "support left of the photo" reads off the photo's row band, not the
    // photo element itself).
    const photoRows = rowBand(0.48, 0.72, rows)
    const photoCols = colBand(0.30, 0.70, cols)
    const photoRegion = clampRegion({ ...photoCols, ...photoRows }, cols, rows)
    if (image) {
      els.push(tierImage('0', image, photoRegion, 2))
    }
    const support = items('support')
    if (support.length) {
      const supportCols = colBand(0, 0.28, cols)
      els.push(...stackVertical('support', support,
        { ...supportCols, row: photoRegion.row, rowSpan: Math.max(1, Math.round(photoRegion.rowSpan / 2)) },
        cols, rows, 3, { style: { align: 'left', valign: 'top' } }, photoRegion.rowSpan))
    }
    const anchorRows = rowBand(0.76, 0.94, rows)
    const anchor = items('anchor')
    if (anchor.length) {
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ ...full, ...anchorRows }, cols, rows), 2,
        { level: 'headline', style: { align, valign: 'bottom', fontWeight: 700, ...drama.anchor } }))
    }
    return { elements: els }
  },
}

/**
 * Split — a hard vertical split: a full-height photo owns one half, a flush
 * type column owns the other (hero top, anchor mid, support low, fine print
 * bottom). Family B rebuild: no declared overlaps — the split is hard by
 * construction (photo/text column fractions never share a column). `side`
 * mirrors which half the photo takes (`'left'` flips it; default/`'right'`
 * matches the table). Degrade (`image` absent): the text column is unmoved,
 * the photo's half is just air.
 */
const split: Staging = {
  id: 'split',
  name: 'Split',
  blurb: 'Hard vertical split: a full-height photo against a flush type column.',
  knobs: [{ id: 'side', pick: ['left', 'right'] }, HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs, image }) {
    const els: ElementV2[] = []
    const photoLeft = knobs.side === 'left'
    const photoCols = photoLeft ? colBand(0, 0.5, cols) : colBand(0.5, 1, cols)
    const textCols = photoLeft ? colBand(0.5, 1, cols) : colBand(0, 0.5, cols)
    const align: TextStyleV2['align'] = photoLeft ? 'right' : 'left'
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)

    if (image) {
      els.push(tierImage('0', image,
        clampRegion({ ...photoCols, row: 1, rowSpan: rows }, cols, rows), 2, { bleed: true }))
    }
    const heroRows = rowBand(0.06, 0.30, rows)
    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ ...textCols, ...heroRows }, cols, rows), 1,
        { level: 'display', overflow: 'grow', style: { align, valign: 'top', fontWeight: 700, ...drama.hero } }))
    }
    const anchorRow = heroRows.row + heroRows.rowSpan
    const anchor = items('anchor')
    if (anchor.length) {
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ ...textCols, row: anchorRow, rowSpan: 2 }, cols, rows), 2,
        { level: 'headline', style: { align, valign: 'top', fontWeight: 700, ...drama.anchor } }))
    }
    const supportRows = rowBand(0.60, 0.80, rows)
    const support = items('support')
    if (support.length) {
      els.push(...stackVertical('support', support,
        { ...textCols, row: supportRows.row, rowSpan: 1 },
        cols, rows, 3, { style: { align, valign: 'top' } }, supportRows.rowSpan))
    }
    const fine = items('fineprint')
    if (fine.length) {
      els.push(...stackVertical('fineprint', fine,
        { ...textCols, row: rows - 1, rowSpan: 1 },
        cols, rows, 4, { style: { align, valign: 'bottom' } }))
    }
    return { elements: els }
  },
}

/**
 * Frame — a center-right photo with a top-left hero whose box crosses the
 * photo's edge (the first declared text-over-photo overlap in the family).
 * Family B rebuild: `(tier_hero_0, img_0)` is declared ONLY when an image is
 * actually placed — with `image` absent there's no `img_0` to overlap, so
 * the pair is omitted rather than dangling. The image is pushed FIRST so it
 * sits behind the hero (img before hero in `elements`, back→front).
 */
const frame: Staging = {
  id: 'frame',
  name: 'Frame',
  blurb: 'A center-right photo framed by a top-left hero that crosses its edge.',
  knobs: [HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs, image }) {
    const els: ElementV2[] = []
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)
    const overlaps: Array<[string, string]> = []

    const photoRows = rowBand(0.10, 0.60, rows)
    const photoCols = colBand(0.45, 0.95, cols)
    const photoRegion = clampRegion({ ...photoCols, ...photoRows }, cols, rows)
    if (image) {
      els.push(tierImage('0', image, photoRegion, 2))
    }
    const fine = items('fineprint')
    if (fine.length) {
      const fineCols = colBand(0.60, 1, cols)
      els.push(...stackVertical('fineprint', fine,
        { ...fineCols, row: 1, rowSpan: 1 },
        cols, rows, 4, { style: { align: 'right', valign: 'top' } }))
    }
    const heroRows = rowBand(0.04, 0.30, rows)
    const heroCols = colBand(0, 0.55, cols)
    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ ...heroCols, ...heroRows }, cols, rows), 1,
        { level: 'display', overflow: 'grow', style: { align: 'left', valign: 'top', fontWeight: 700, ...drama.hero } }))
      if (image) overlaps.push(['tier_hero_0', 'img_0'])
    }
    const support = items('support')
    if (support.length) {
      const supportCols = colBand(0, 0.45, cols)
      els.push(...stackVertical('support', support,
        { ...supportCols, row: heroRows.row + heroRows.rowSpan, rowSpan: 2 },
        cols, rows, 3, { style: { align: 'left', valign: 'top' } }, 4))
    }
    const anchorRows = rowBand(0.84, 0.96, rows)
    const anchor = items('anchor')
    if (anchor.length) {
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ col: 1, colSpan: cols, ...anchorRows }, cols, rows), 2,
        { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700, ...drama.anchor } }))
    }
    return { elements: els, ...(overlaps.length ? { overlaps } : {}) }
  },
}

/**
 * Corner — a photo pinned to the top-right corner (bleeding top+right), a
 * big hero anchoring the bottom-left. New Family B staging (round-2b
 * self-review correction folded the backpocket-19 "Reel" vertical-type move
 * in here): `crop:'bottom'` pushes the hero's rowSpan past the grid with
 * `overhang:true`; `heroOrientation:'up'` swaps the hero into a tall,
 * narrow region running the left edge and sets `style.orientation:'up'` —
 * the two knobs compose (a vertical hero can still crop past the bottom).
 */
const corner: Staging = {
  id: 'corner',
  name: 'Corner',
  blurb: 'A photo pinned to the top-right corner; a big hero anchors the opposite corner.',
  knobs: [
    { id: 'crop', pick: ['bottom', 'none'] },
    { id: 'heroOrientation', pick: ['horizontal', 'up'] },
    HERO_SCALE_KNOB,
  ],
  compose({ tiers, cols, rows, canvas, knobs, image }) {
    const els: ElementV2[] = []
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)
    const vertical = knobs.heroOrientation === 'up'
    const crop = knobs.crop === 'bottom'

    const photoRows = rowBand(0, 0.42, rows)
    const photoCols = colBand(0.55, 1, cols)
    const photoRegion = clampRegion({ ...photoCols, ...photoRows }, cols, rows)
    if (image) {
      els.push(tierImage('0', image, photoRegion, 2, { bleed: true }))
    }
    const fine = items('fineprint')
    if (fine.length) {
      const fineCols = colBand(0, 0.30, cols)
      const fineRows = rowBand(0, 0.12, rows)
      els.push(...stackVertical('fineprint', fine,
        { ...fineCols, row: fineRows.row, rowSpan: 1 },
        cols, rows, 4, { style: { align: 'left', valign: 'top' } }, fineRows.rowSpan))
    }
    // Two mutually-exclusive base regions: the default horizontal "big
    // bottom-left" box, or (heroOrientation:'up') a tall narrow strip along
    // the left edge — both stay clear of the photo/fine/anchor/support
    // regions below, so `crop`'s extension (rowSpan past the grid) never
    // needs a declared overlap either.
    const heroBase = vertical
      ? { ...colBand(0, 0.18, cols), ...rowBand(0.20, 0.95, rows) }
      : { ...colBand(0, 0.55, cols), ...rowBand(0.55, 0.90, rows) }
    const cropExtra = Math.max(3, Math.round(0.06 * rows))
    const heroRegion = crop ? { ...heroBase, rowSpan: heroBase.rowSpan + cropExtra } : clampRegion(heroBase, cols, rows)
    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!, heroRegion, 1,
        { level: 'display', overflow: 'grow', overhang: crop,
          style: {
            align: 'left', valign: 'bottom', fontWeight: 700, ...drama.hero,
            ...(vertical ? { orientation: 'up' as const } : {}),
          } }))
    }
    const anchorRows = rowBand(0.46, 0.55, rows)
    const anchorCols = colBand(0.45, 1, cols)
    const anchor = items('anchor')
    if (anchor.length) {
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ ...anchorCols, ...anchorRows }, cols, rows), 2,
        { level: 'headline', style: { align: 'right', valign: 'top', fontWeight: 700, ...drama.anchor } }))
    }
    const support = items('support')
    if (support.length) {
      const supportCols = colBand(0.60, 1, cols)
      const supportRows = rowBand(0.62, 0.98, rows)
      els.push(...stackVertical('support', support,
        { ...supportCols, row: supportRows.row, rowSpan: 3 },
        cols, rows, 3, { style: { align: 'right', valign: 'top' } }, supportRows.rowSpan))
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

/**
 * Statement — a giant flush-left hero owns the upper half of the canvas; a
 * `crop` knob lets it bleed off the left edge for the flagship "giant type"
 * look, or sit fully in-grid. Anchor sits small bottom-left, a support
 * column hugs the right edge, fine print pins the bottom corners.
 */
const statement: Staging = {
  id: 'statement',
  name: 'Statement',
  blurb: 'A giant flush-left hero owns the upper half — crop it to the edge, or keep it in-grid.',
  knobs: [{ id: 'crop', pick: ['left', 'none'] }, HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs }) {
    const els: ElementV2[] = []
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)
    const half = Math.round(cols / 2)
    const crop = knobs.crop === 'left'

    const hero = items('hero')
    if (hero.length) {
      const heroRows = rowBand(0.06, 0.55, rows)
      // `-0.04*cols` rounds to 0 (not negative) on a coarse authoring grid —
      // clamp to at least -1 so `crop:'left'` always produces a real
      // off-grid column, never a boundary-touching zero.
      const cropCol = Math.min(-1, Math.round(-0.04 * cols))
      const region = crop
        ? { col: cropCol, colSpan: cols - cropCol + 1, ...heroRows }
        : clampRegion({ col: 1, colSpan: cols, ...heroRows }, cols, rows)
      els.push(tierText('hero', 0, hero[0]!, region, 1,
        { level: 'display', overflow: 'grow', overhang: crop,
          style: { align: 'left', valign: 'top', fontWeight: 700, ...drama.hero } }))
    }
    const anchor = items('anchor')
    if (anchor.length) {
      const anchorRows = rowBand(0.80, 0.92, rows)
      const anchorCols = colBand(0, 0.6, cols)
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ ...anchorCols, ...anchorRows }, cols, rows), 2,
        { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700, ...drama.anchor } }))
    }
    const support = items('support')
    if (support.length) {
      const supportRows = rowBand(0.58, 0.72, rows)
      const supportCols = colBand(0.55, 1, cols)
      els.push(...stackVertical('support', support,
        { ...supportCols, row: supportRows.row, rowSpan: 1 },
        cols, rows, 3, { style: { align: 'left', valign: 'top' } }, supportRows.rowSpan))
    }
    const fine = items('fineprint')
    if (fine.length) {
      els.push(...stackCorners('fineprint', fine,
        { col: 1, colSpan: half, row: rows, rowSpan: 1 },
        { col: half + 1, colSpan: cols - half, row: rows, rowSpan: 1 },
        cols, rows, 4, { style: { align: 'left', valign: 'bottom' } }))
    }
    return { elements: els }
  },
}

/**
 * Manifesto — inverted mass: the ANCHOR (a date, usually) is the giant
 * display-scale element, while the hero sits small in the top-left corner.
 * A hairline rule separates the small-hero band from the giant-anchor band;
 * fine print rides just under the rule. `voice` swaps the anchor's family to
 * a serif numeral for the "date as graphic" look.
 */
const manifesto: Staging = {
  id: 'manifesto',
  name: 'Manifesto',
  blurb: 'Inverted mass — the anchor reads giant, the hero stays a small corner mark.',
  knobs: [
    { id: 'ruleWeight', pick: [1, 2, 3] },
    { id: 'voice', pick: ['grotesk', 'serif'] },
    HERO_SCALE_KNOB,
  ],
  compose({ tiers, cols, rows, canvas, knobs }) {
    const els: ElementV2[] = []
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)
    const serif = knobs.voice === 'serif'
    const ruleWeight = Math.max(1, Math.min(3, Number(knobs.ruleWeight ?? 2)))
    const ruleRow = Math.max(1, Math.round(0.10 * rows))
    const afterRule = ruleRow + ruleWeight
    const anchorCols = colBand(0, 0.65, cols)
    const supportCols = colBand(0.65, 1, cols)
    // Fine print rides the rows directly under the rule, one row per item
    // (stackVertical's compact spacing) — the giant anchor/support body must
    // start AFTER all of them, not just the first, or a 2nd+ fine-print item
    // lands on the same row as the anchor.
    const fine = items('fineprint')
    const bodyStart = afterRule + Math.max(1, fine.length)

    els.push({
      id: 'rule_0', type: 'shape', shape: 'rect', priority: 5, origin: 'staging',
      region: clampRegion({ col: 1, colSpan: cols, row: ruleRow, rowSpan: ruleWeight }, cols, rows),
      style: { fill: '{{ brand.foreground }}' },
    })
    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ col: 1, colSpan: Math.round(cols * 0.35), row: 1, rowSpan: Math.max(1, ruleRow - 1) }, cols, rows), 1,
        { level: 'headline', overflow: 'grow', style: { align: 'left', valign: 'top', fontWeight: 700, ...drama.anchor } }))
    }
    const anchor = items('anchor')
    if (anchor.length) {
      const anchorRows = rowBand(0.14, 0.44, rows)
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ ...anchorCols, row: Math.max(anchorRows.row, bodyStart), rowSpan: anchorRows.rowSpan }, cols, rows), 2,
        { level: 'display', overflow: 'grow',
          style: {
            align: 'left', valign: 'top', fontWeight: 700, ...drama.hero,
            ...(serif ? { fontFamily: 'Playfair Display' } : {}),
          } }))
    }
    const support = items('support')
    if (support.length) {
      const supportStart = Math.max(rowBand(0.14, 0.44, rows).row, bodyStart)
      els.push(...stackVertical('support', support,
        { ...supportCols, row: supportStart, rowSpan: 1 },
        cols, rows, 3, { style: { align: 'left', valign: 'top' } }, 4))
    }
    if (fine.length) {
      els.push(...stackVertical('fineprint', fine,
        { col: 1, colSpan: cols, row: afterRule, rowSpan: 1 },
        cols, rows, 4, { style: { align: 'left', valign: 'top' } }))
    }
    return { elements: els }
  },
}

/**
 * Ledger — fine print rides a top rail, the hero sits mid-canvas, and the
 * support tier lays out as a ruled table: each item gets its own row with a
 * hairline `rule_i` under it. Anchor closes the composition at the bottom.
 * (Family table A calls this composition `index` — renamed here because a
 * DIFFERENT `index` staging is already registered from round 1; see the
 * task report for the naming collision this avoids.)
 */
const ledger: Staging = {
  id: 'ledger',
  name: 'Ledger',
  blurb: 'Top rail of meta, hero mid-canvas, a ruled table for the support list.',
  knobs: [HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs }) {
    const els: ElementV2[] = []
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)
    const half = Math.round(cols / 2)

    const fine = items('fineprint')
    if (fine.length) {
      els.push(...stackVertical('fineprint', fine,
        { col: 1, colSpan: cols, row: 1, rowSpan: 1 },
        cols, rows, 4, { style: { align: 'left', valign: 'top' } }))
    }
    const heroRows = rowBand(0.28, 0.55, rows)
    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ col: 1, colSpan: cols, ...heroRows }, cols, rows), 1,
        { level: 'display', overflow: 'grow', style: { align: 'left', valign: 'top', fontWeight: 700, ...drama.hero } }))
    }
    const support = items('support')
    const step = Math.max(2, Math.round(0.06 * rows))
    const tableBase = heroRows.row + heroRows.rowSpan
    support.forEach((item, i) => {
      const rowStart = tableBase + i * step
      els.push(tierText('support', i, item,
        clampRegion({ col: 1, colSpan: half, row: rowStart, rowSpan: Math.max(1, step - 1) }, cols, rows), 3,
        { style: { align: 'left', valign: 'top' } }))
      els.push({
        id: `rule_${i}`, type: 'shape', shape: 'rect', priority: 5, origin: 'staging',
        region: clampRegion({ col: 1, colSpan: cols, row: rowStart + step - 1, rowSpan: 1 }, cols, rows),
        style: { fill: '{{ brand.foreground }}' },
      })
    })
    const anchor = items('anchor')
    if (anchor.length) {
      const lastRuleRow = support.length ? tableBase + (support.length - 1) * step + step - 1 : tableBase
      const anchorRow = Math.min(rows, lastRuleRow + 1)
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ col: 1, colSpan: cols, row: anchorRow, rowSpan: Math.max(1, rows - anchorRow + 1) }, cols, rows), 2,
        { level: 'headline', style: { align: 'left', valign: 'bottom', fontWeight: 700, ...drama.anchor } }))
    }
    return { elements: els }
  },
}

/**
 * Stacked — a single flush-left block, generous whitespace, no tricks: hero
 * then anchor immediately under it, with air below before a small support
 * corner and a fine-print corner opposite it. `align` flips the flush side
 * (and mirrors which corner support/fine print land in).
 */
const stacked: Staging = {
  id: 'stacked',
  name: 'Stacked',
  blurb: 'One flush-left block — hero, then anchor, then generous air.',
  knobs: [{ id: 'align', pick: ['left', 'right'] }, HERO_SCALE_KNOB],
  compose({ tiers, cols, rows, canvas, knobs }) {
    const els: ElementV2[] = []
    const entries = tierEntries(tiers)
    const items = (id: TierId) => tierItems(entries, id)
    const drama = dramaticType(knobs, canvas)
    const right = knobs.align === 'right'
    const align: TextStyleV2['align'] = right ? 'right' : 'left'

    const heroRows = rowBand(0.08, 0.40, rows)
    const hero = items('hero')
    if (hero.length) {
      els.push(tierText('hero', 0, hero[0]!,
        clampRegion({ col: 1, colSpan: cols, ...heroRows }, cols, rows), 1,
        { level: 'display', overflow: 'grow', style: { align, valign: 'top', fontWeight: 700, ...drama.hero } }))
    }
    const anchorRow = heroRows.row + heroRows.rowSpan
    const anchor = items('anchor')
    if (anchor.length) {
      els.push(tierText('anchor', 0, anchor[0]!,
        clampRegion({ col: 1, colSpan: cols, row: anchorRow, rowSpan: 2 }, cols, rows), 2,
        { level: 'headline', style: { align, valign: 'top', fontWeight: 700, ...drama.anchor } }))
    }
    const bottomRow = Math.max(anchorRow + 3, Math.round(rows * 0.75))
    const nearCols = colBand(0, 0.35, cols)
    const farCols = colBand(0.65, 1, cols)
    const support = items('support')
    if (support.length) {
      els.push(...stackVertical('support', support,
        { ...(right ? farCols : nearCols), row: bottomRow, rowSpan: 1 },
        cols, rows, 3, { style: { align: 'left', valign: 'top' } }, 2))
    }
    const fine = items('fineprint')
    if (fine.length) {
      els.push(...stackVertical('fineprint', fine,
        { ...(right ? nearCols : farCols), row: bottomRow, rowSpan: 1 },
        cols, rows, 4, { style: { align: 'left', valign: 'top' } }))
    }
    return { elements: els }
  },
}

export const STAGINGS: Staging[] = [
  tower, split, frame, corner, centered, editorial, index,
  statement, manifesto, ledger, stacked,
]

export function getStaging(id: string): Staging | undefined {
  return STAGINGS.find(s => s.id === id)
}
