/**
 * Smart Layout schema v2 — Swiss modular grid.
 * Elements are placed by grid region (column/row spans), not anchor+offset.
 * See docs/superpowers/specs/2026-06-10-smart-layout-swiss-grid-design.md.
 */

export type FormatClass = 'square' | 'portrait' | 'landscape' | 'strip' | 'skyscraper'
export type TextLevel = 'caption' | 'body' | 'subhead' | 'headline' | 'display'
export type TextOverflow = 'shrink' | 'shrink-then-truncate' | 'grow'

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

export interface GridSpec { gutter: number; margin: number; baseline: number }  // master px
export interface TypeScaleSpec { base: number; ratio: number }                  // base = caption size, master px

export interface ElementV2Base {
  id: string
  role?: string                  // HEADLINE, LOGO, CTA, IMAGE_LAYER_1, …
  priority: number               // 1 = most important; drives slot assignment + culling
  region: Region                 // placement on the master grid
  regionByClass?: Partial<Record<FormatClass, Region>>
  /** Per-output overrides, keyed by output id (falls back to format key for
   *  pre-outputs templates). Highest precedence — lets one output of a format
   *  diverge into a variation. */
  overrides?: Record<string, { region?: Region; hidden?: boolean }>
  hidden?: boolean               // excluded from render + canvas (toggle in layers)
  locked?: boolean               // editor-only: blocks canvas selection/drag
  /** Extend to the canvas edge on every side that the element's region
   *  borders. A region spanning the full grid → covers the whole canvas
   *  (full-bleed background); a half-grid region → bleeds on its three
   *  outer sides, keeps the grid line on the inner side. Ignores safe
   *  areas — for backgrounds that should fill behind platform UI chrome. */
  bleed?: boolean
}

export interface TextStyleV2 {
  fontFamily?: string
  fontWeight?: 400 | 700
  color?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  lineHeight?: number
  letterSpacing?: number               // px, kerning control
  /** Master-format px. Overrides the level-derived size but still scales per
   *  format (min-dim × class multiplier) and auto-fits within the region. */
  fontSize?: number
  transform?: 'none' | 'uppercase'
  /** Legibility panel/scrim drawn behind the text, filling its region. fill is
   *  brand-bindable; opacity 0–1 makes it a scrim over imagery. */
  panel?: { fill?: string; opacity?: number; radius?: number }
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
  style?: { fit?: 'cover' | 'contain' | 'stretch'; borderRadius?: number }
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
