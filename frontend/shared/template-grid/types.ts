/**
 * Smart Layout schema v2 — Swiss modular grid.
 * Elements are placed by grid region (column/row spans), not anchor+offset.
 * See docs/superpowers/specs/2026-06-10-smart-layout-swiss-grid-design.md.
 */

import type { ExpressiveParams } from '../text-layout/expressive'
export type { ExpressiveParams } from '../text-layout/expressive'
import type { ExpressiveBoxParams } from '../text-layout/boxes'
export type { ExpressiveBoxParams } from '../text-layout/boxes'
import type { PhotoTreatment } from './treatment'
export type { PhotoTreatment, TreatmentKind } from './treatment'

/** Manual per-word offset, stored as FRACTIONS of the element box
 *  (dx × boxWidth px) so a nudge scales proportionally across formats. */
export interface WordNudge { dx: number; dy: number }

/** ExpressiveParams + Smart-Layout-only manual per-word overrides. The core
 *  engine never sees `nudges`; the grid adapter applies them post-layout. */
export interface GridExpressiveParams extends ExpressiveParams {
  /** Word index (0-based, reading order) → offset. Cleared by any engine-param
   *  change (see mergeExpressivePatch); out-of-range indices are ignored. */
  nudges?: Record<number, WordNudge>
}

export type FormatClass = 'square' | 'portrait' | 'landscape' | 'strip' | 'skyscraper'
export type TextLevel = 'caption' | 'body' | 'subhead' | 'headline' | 'display'
export type TextOverflow = 'shrink' | 'shrink-then-truncate' | 'grow'

export type LayoutAxis = 'horizontal' | 'vertical'
export type MainAlign = 'start' | 'center' | 'end' | 'space-between'
export type CrossAlign = 'start' | 'center' | 'end' | 'stretch'
export type SizeMode = 'hug' | 'fill' | 'fixed'

export interface AutoLayout {
  direction: LayoutAxis
  /** Inner insets, in fine-grid cells. */
  padding: { top: number; right: number; bottom: number; left: number }
  /** Gap between children, in fine-grid cells. */
  gap: number
  mainAlign: MainAlign
  crossAlign: CrossAlign
}

export interface SafeArea { top: number; right: number; bottom: number; left: number }

export interface FormatSpec {
  w: number
  h: number
  label?: string
  class?: FormatClass            // explicit override; otherwise derived from w/h
  cols?: number                  // defaults per class
  rows?: number
  safeArea?: Partial<SafeArea>   // px insets reserved for platform UI chrome
}

// 1-based, inclusive spans: { col: 1, colSpan: 6 } fills columns 1..6.
export interface Region { col: number; colSpan: number; row: number; rowSpan: number }

/** Importance tier ids, most→least important. */
export type TierId = 'hero' | 'anchor' | 'support' | 'fineprint'

/** One importance tier: what it says + how it's typeset. Placement is decided
 *  by the staging, so tier type survives a re-roll. `content` supports
 *  {{ props.* }} / {{ brand.* }} like any element content. */
export interface TierSpec {
  content: string
  type?: Partial<TextStyleV2>
  enabled?: boolean
}
/** Stored form: round-1 templates hold one `TierSpec` per tier; round-2+
 *  supports a list (multiple items in one tier, e.g. a second meta-cluster).
 *  Read sites normalize via `normalizeTiers` so both shapes flow through
 *  identically — no stored-data rewrite needed. */
export type Tiers = Partial<Record<TierId, TierSpec | TierSpec[]>>

/** The reproducible generation tuple stamped on a generated template. */
export interface GenState {
  staging: string
  theme: string
  seed: number
  knobs?: Record<string, unknown>
  locks?: { staging?: boolean; theme?: boolean }
  /** When true, the hero tier (`tier_hero_0`) reads in the theme's accent
   *  colour instead of the default ink — a poster-style callout. */
  accentOnHero?: boolean
  /** Brand axis keys (background/foreground/accent) the user has hand-edited
   *  via `setBrandOverride`/`setBrand` — PINNED across every stamping trigger
   *  (a theme switch, Surprise's theme re-roll, missing-key backfill) until
   *  either restored (hex: null) removes the key, or an explicit `setTheme`
   *  clears the whole list (picking a theme = adopting its system). */
  brandEdits?: Array<'background' | 'foreground' | 'accent'>
}

export interface GridSpec {
  gutter: number; margin: number; baseline: number  // master px
  /** Per-axis gutters (master px). `column` = space between columns (horizontal),
   * `row` = space between rows (vertical). Either falls back to the uniform
   * `gutter`. */
  gutters?: { column?: number; row?: number }
  /** v3 grid dimensions — the number of columns / rows the canvas is divided
   * into. FIXED across every format, so placement reflows by identity (an
   * element at column 4/12 sits at the same fraction on every aspect). When
   * absent, derived from `baseline` (canvas ÷ baseline) for back-compat. */
  columns?: number
  rows?: number
  /** Per-side margins (master px). Any side left unset falls back to the
   * uniform `margin`. Lets a layout inset differently on each edge. */
  margins?: { top?: number; right?: number; bottom?: number; left?: number }
}
export interface TypeScaleSpec { base: number; ratio: number }                  // base = caption size, master px

export interface ElementV2Base {
  id: string
  name?: string                  // display name in the Layers panel (falls back to id)
  role?: string                  // HEADLINE, LOGO, CTA, IMAGE_LAYER_1, …
  priority: number               // 1 = most important; drives slot assignment + culling
  region: Region                 // placement on the master grid
  regionByClass?: Partial<Record<FormatClass, Region>>
  /** Per-output overrides, keyed by output id (falls back to format key for
   *  pre-outputs templates). Highest precedence — lets one output of a format
   *  diverge into a variation. `content` swaps the element's content for just
   *  this output (e.g. an outpainted image sized to that format). */
  overrides?: Record<string, { region?: Region; hidden?: boolean; content?: string }>
  hidden?: boolean               // excluded from render + canvas (toggle in layers)
  locked?: boolean               // editor-only: blocks canvas selection/drag
  /** Extend to the canvas edge on every side that the element's region
   *  borders. A region spanning the full grid → covers the whole canvas
   *  (full-bleed background); a half-grid region → bleeds on its three
   *  outer sides, keeps the grid line on the inner side. Ignores safe
   *  areas — for backgrounds that should fill behind platform UI chrome. */
  bleed?: boolean
  /** Bleed's aggressive sibling: place this element with RAW (unclamped)
   *  region math instead of the grid-clamped default — a region can start
   *  at col ≤ 0 or span past the grid, cropping off the canvas edge (a Swiss
   *  overhang). The canvas clips at render (editor artboard + Satori root);
   *  the element is only culled when its on-canvas intersection is empty or
   *  too small, never for being partially off-canvas. */
  overhang?: boolean
  /** Consulted only when this element is a Stack child. */
  layoutSizing?: { main: SizeMode; cross: SizeMode }
  /** Whether this element was placed by a staging (regenerated on re-roll) or
   *  added by hand in Freeform mode (preserved across re-rolls). Absent ⇒
   *  treated as 'freeform' (legacy elements are never clobbered). */
  origin?: 'staging' | 'freeform'
}

export interface TextStyleV2 {
  fontFamily?: string
  fontWeight?: 400 | 700
  color?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  valign?: 'top' | 'middle' | 'bottom' | 'justify'
  lineHeight?: number
  letterSpacing?: number               // px, kerning control
  /** Master-format px. Overrides the level-derived size but still scales per
   *  format (min-dim × class multiplier) and auto-fits within the region. */
  fontSize?: number
  transform?: 'none' | 'uppercase'
  /** Legibility panel/scrim drawn behind the text, filling its region. fill is
   *  brand-bindable; opacity 0–1 makes it a scrim over imagery. */
  panel?: { fill?: string; opacity?: number; radius?: number }
  /** Expressive per-word layout (overrides flow `align`/`valign`). When present,
   *  words are placed individually by the shared engine — identical in the
   *  editor DOM and the Satori export. Absent ⇒ normal flow (unchanged). */
  expressive?: GridExpressiveParams
  /** Vertical type — a title running up/down the region's edge. `up` rotates
   *  -90° (reads bottom→top); `down` rotates 90° (reads top→bottom). Absent/
   *  'horizontal' ⇒ normal flow (unchanged). The copy-fit pass runs against
   *  the region's SWAPPED axis so line length fits the region's height. */
  orientation?: 'horizontal' | 'up' | 'down'
}

/** True when `style.orientation` requests vertical ('up'/'down') AND actually
 *  applies. Expressive (word-level) placement takes over layout entirely, so
 *  a lingering `orientation` on an expressive style is a graceful no-op:
 *  expressive wins, orientation is ignored — rather than stamping a rotation
 *  the expressive path never renders. Single source of truth for the
 *  resolver's fit pass and both render surfaces (satori translate + the
 *  editor canvas). */
export function isVerticalTextStyle(style?: TextStyleV2): boolean {
  return !style?.expressive && (style?.orientation === 'up' || style?.orientation === 'down')
}

export interface TextElementV2 extends ElementV2Base {
  type: 'text'
  content: string                // supports {{ props.* }} / {{ brand.* }}
  level: TextLevel               // resolved via the type scale, never a raw px size
  overflow?: TextOverflow        // default 'shrink-then-truncate'
  maxLines?: number
  style?: TextStyleV2
}

export interface ImageElementV2 extends ElementV2Base {
  type: 'image'
  content: string
  focal?: { x: number; y: number }   // 0–1 cover-crop focus, default center
  collapse?: 'mark'                   // logo-style: render as centered square mark when small
  style?: {
    fit?: 'cover' | 'contain' | 'stretch'
    borderRadius?: number
    /** OPT-IN photo treatment (grayscale/duotone/grain). Absent ⇒ none.
     *  Never set by generate/shuffle/surprise — it rides the element like
     *  any other style field. @see ./treatment.ts */
    treatment?: PhotoTreatment
  }
}

export interface ShapeElementV2 extends ElementV2Base {
  type: 'shape'
  shape: 'rect' | 'circle'
  style?: { fill?: string; borderRadius?: number; borderColor?: string; borderWidth?: number }
}

export type ElementV2 = TextElementV2 | ImageElementV2 | ShapeElementV2

/** A chosen deliverable: an instance of a format. The same format may appear
 *  more than once (variations), each with its own id so per-output overrides
 *  and the rendered image are distinct. */
export interface OutputSpec {
  id: string
  format: string        // key into TemplateV2.formats
  label?: string        // display name (defaults to the format label)
}

/** Brand kit — re-exported from the app-wide brand module.
 * @see ../brand/types.ts */
export { BRAND_COLOR_KEYS } from '../brand/types'
export type { BrandKit, BrandColorKey } from '../brand/types'
import type { BrandKit } from '../brand/types'

export interface TemplateV2 {
  version: 2
  id: string
  name: string
  master: string                          // key into formats; the design-time format
  formats: Record<string, FormatSpec>
  grid: GridSpec
  typeScale: TypeScaleSpec
  background?: { fill?: string; image?: string }
  brand?: BrandKit                         // template-default brand; socket overrides
  /** Chosen deliverables to render, in order. When absent, derived from the
   *  node's `aspects` (one output per format) for back-compat. */
  outputs?: OutputSpec[]
  elements: ElementV2[]
  /** Top-level z-order (back → front): ids of ungrouped elements AND sections,
   *  interleaved. The single source of truth for stacking + the Layers panel.
   *  When absent, order is derived (elements first, then sections) so existing
   *  templates render identically. Children inside a section keep their own
   *  order via the section's `children` array. */
  order?: string[]
  /** Importance-tier content + type, decoupled from placement. Present when the
   *  layout is generatable; absent on hand-authored legacy layouts. */
  tiers?: Tiers
  /** Last generation tuple — lets Shuffle/Surprise reproduce and re-roll. */
  gen?: GenState
}

/**
 * Smart Layout v3 — sectioned, format-aware canvas on a baseline-derived fine
 * grid. A SectionV3 is a named box with its own region (+ per-class/per-output
 * overrides); its children are positioned in the master fine grid and ride the
 * section's box proportionally across formats. See
 * docs/superpowers/specs/2026-06-26-smart-layout-v3-sectioned-canvas-design.md.
 */
export interface SectionV3 {
  id: string
  name: string                            // "headline lockup", "logo + cta"
  region: Region                          // section box on the master fine grid
  regionByClass?: Partial<Record<FormatClass, Region>>
  /** Per-output overrides, keyed by output id (falls back to format key) —
   *  highest precedence, lets one output diverge into a variation. */
  overrides?: Record<string, { region?: Region; hidden?: boolean }>
  hidden?: boolean                        // culls the whole section + its children
  children: ElementV2[]                   // child regions are in the master fine grid
  /** Frame appearance — a box drawn behind the section's children. Any field
   *  set makes the section render (a synthetic shape at the section rect);
   *  absent → the section is an invisible grouping box (unchanged). */
  style?: { fill?: string; stroke?: string; strokeWidth?: number; radius?: number }
  /** Clip children to the frame bounds (Figma frame behaviour). When absent,
   *  children can overflow (a plain group). New frames default to clipping. */
  clip?: boolean
  /** Present → auto-layout (engine computes child rects). Absent →
   *  absolute-region section (children keep their grid positions). */
  layout?: AutoLayout
  /** Present → expressive placement: children keep their size but are scattered
   *  within the section box by a seeded rule (+ derived rotation). Mutually
   *  exclusive with `layout` — the resolver checks `expressive` first. */
  expressive?: ExpressiveBoxParams
}

/** v3 is a superset of v2: same top-level shape plus `sections`. Ungrouped
 *  elements stay in `elements` and resolve exactly as in v2. */
export interface TemplateV3 extends Omit<TemplateV2, 'version'> {
  version: 3
  sections: SectionV3[]
}

export type AnyGridTemplate = TemplateV2 | TemplateV3

/** Narrow an AnyGridTemplate to v3 on its version discriminant. */
export function isV3(t: AnyGridTemplate): t is TemplateV3 {
  return t.version === 3
}

/** True when a section is an auto-layout Stack (has layout rules). */
export function isLayoutStack(section: SectionV3): boolean {
  return section.layout != null
}
