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
  overrides?: Record<string, { region?: Region }>   // per-format-key escape hatch
  hidden?: boolean               // excluded from render + canvas (toggle in layers)
  locked?: boolean               // editor-only: blocks canvas selection/drag
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

export interface TemplateV2 {
  version: 2
  id: string
  name: string
  master: string                          // key into formats; the design-time format
  formats: Record<string, FormatSpec>
  grid: GridSpec
  typeScale: TypeScaleSpec
  background?: { fill?: string; image?: string }
  elements: ElementV2[]
}
