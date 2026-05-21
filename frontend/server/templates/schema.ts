/**
 * Template layout schema — the long-lived contract between the visual editor
 * (which authors layouts) and the renderer (which turns them into PNGs).
 *
 * Design intent:
 *  - Anchor + size + offset gets us 80% of layouts with no constraint solver.
 *  - Per-aspect overrides (`overrides[aspect_key]`) handle the structural
 *    differences between e.g. 1:1 and 9:16, where the layout fundamentally
 *    needs different placement, not just resizing.
 *  - Content fields support `{{ props.x }}` / `{{ brand.y }}` interpolation
 *    so a layout is reused across many runs with different data.
 *
 * Schema versioning: bump `version` when making a breaking change. The
 * renderer should refuse to load layouts with a version it doesn't recognize
 * rather than silently misinterpret old files.
 */

export const SCHEMA_VERSION = 1

// 9-point anchor grid. Picks which corner/edge of the parent the element's
// own corresponding corner is pinned to, with `offset` measured inward.
export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

// Lengths are either pixels (number), a percentage string ("50%"), or the
// keywords "auto" (hug content) / "fill" (take remaining available space).
export type Length = number | `${number}%` | 'auto' | 'fill'

export interface Offset { x: Length; y: Length }
export interface Size { w: Length; h: Length }

// ---------- Per-element style typings ----------

export type ImageFit = 'cover' | 'contain' | 'smart_crop' | 'stretch'

export interface TextStyle {
  fontFamily?: string                  // resolved to a loaded font on the server
  fontSize?: number                    // px; if `autoFit`, treated as max
  fontWeight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900
  color?: string                       // any CSS color or {{ token }}
  align?: 'left' | 'center' | 'right'
  lineHeight?: number                  // unitless multiplier
  letterSpacing?: number               // px
  autoFit?: boolean                    // shrink to fit bbox; min governed by minSize
  minSize?: number                     // px floor when autoFit is on
}

export interface ImageStyle {
  fit?: ImageFit
  borderRadius?: number                // px
}

export interface ShapeStyle {
  fill?: string                        // any CSS color or {{ token }}
  borderRadius?: number
  borderColor?: string
  borderWidth?: number
}

// ---------- Element types ----------

interface BaseElement {
  id: string                           // stable across edits
  role?: string                        // semantic tag; used by SmartLayout / editor (HEADLINE, HERO, LOGO, CTA, …)
  anchor: Anchor
  offset: Offset
  size: Size
  // Per-aspect overrides; any field on this element can be overridden.
  // Keyed by the aspect key from `Template.aspects` (e.g. "1x1", "9x16").
  overrides?: Record<string, Partial<BaseElement> & Partial<TextElement & ImageElement & ShapeElement>>
}

export interface TextElement extends BaseElement {
  type: 'text'
  content: string                      // supports {{ interpolation }}
  style?: TextStyle
}

export interface ImageElement extends BaseElement {
  type: 'image'
  content: string                      // URL or {{ props.x }} token resolving to a URL
  style?: ImageStyle
}

export interface ShapeElement extends BaseElement {
  type: 'shape'
  shape: 'rect' | 'circle'
  style?: ShapeStyle
}

export type LayoutElement = TextElement | ImageElement | ShapeElement

// ---------- Top-level template ----------

export interface BackgroundSpec {
  fill?: string                        // solid color or {{ token }}
  image?: string                       // URL or {{ token }}; covers the canvas
}

export interface AspectSpec {
  w: number
  h: number
  label?: string                       // human-readable ("Instagram square")
}

export interface Template {
  version: typeof SCHEMA_VERSION
  id: string
  name: string
  // Aspects this template is authored for. The editor lets designers switch
  // between them, and the SmartLayout node iterates over them to produce the
  // variant matrix.
  aspects: Record<string, AspectSpec>
  // Optional default aspect used when the renderer is called without one;
  // also the aspect the editor opens in first.
  defaultAspect?: string
  background?: BackgroundSpec
  elements: LayoutElement[]
}

// ---------- Render-time inputs ----------

export interface RenderProps {
  [k: string]: string | number | boolean | undefined
}

export interface RenderBrand {
  primary?: string
  secondary?: string
  accent?: string
  foreground?: string
  background?: string
  fontDisplay?: string
  fontBody?: string
  logo?: string                        // URL
  [k: string]: string | undefined
}

export interface RenderRequest {
  template: Template
  aspect?: string                      // key into template.aspects; defaults to defaultAspect or first
  props?: RenderProps
  brand?: RenderBrand
  // Explicit width/height override an aspect lookup. Either pass aspect or w/h.
  width?: number
  height?: number
}
