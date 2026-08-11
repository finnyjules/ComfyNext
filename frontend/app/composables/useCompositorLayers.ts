/**
 * Local "design" layers for the Compositor — text and shapes authored directly
 * in the editor, with no upstream graph node. They live on the compositor node
 * (`node.data.properties.sailor_localLayers`) and are baked client-side into
 * a single RGBA overlay at submit time, then fed to the backend as an alpha
 * overlay (see `nodes_compositor.py`).
 *
 * Geometry is resolution-independent so the editor preview, the node thumbnail,
 * and the final bake all match exactly:
 *   - `x`, `y`      → normalized CENTER position (0..1 of canvas width/height)
 *   - sizes         → normalized to canvas WIDTH (uniform, so rotation never
 *                     shears regardless of canvas aspect)
 * One renderer (`drawLocalLayer`) draws to any 2D context at any resolution.
 */

export type LocalLayerKind = 'text' | 'rect' | 'ellipse' | 'line' | 'path' | 'image' | 'polygon' | 'star' | 'brush'

// ── Motion painter indirection ───────────────────────────────────────────────
// paintLayerStack(t) needs the motion module, but motion/paint.ts imports
// drawLocalLayer from THIS file — a static import here would be a cycle.
// paint.ts registers its functions on first import; callers that pass a time
// (modal preview, bake) import '~/lib/motion/paint' and guarantee registration.
// Type-only imports are erased at runtime, so they don't create a cycle
// (evaluate.ts/types.ts don't import this file).
import type { LayerMotionState } from '~/lib/motion/evaluate'
import type { FrameMotion } from '~/lib/motion/types'
import { axesToVariationSettings } from '~/lib/motion/axes'
import { expandClones, type Cloner } from '~/composables/useCloner'
import { fillIsShader } from '~/lib/spacetype/fillTile'
import { withFieldFrame, type FieldRequest } from '~/lib/shaderfill/field'
import {
  hasPaint, resolvePaint, OBJECT_SHADER_FIELD_PX, type ShaderFieldFrameCtx,
} from '~/lib/paint/resolve'
import { drawQuadWarp, type Quad } from '~/lib/compositor/warp'
import { polygonPathData, starPathData } from '~/lib/compositor/polygonGeometry'
import { resolveGroupCascade, type LayerGroup } from '~/lib/compositor/layerGroups'
import { layoutExpressive, type ExpressiveParams } from '~~/shared/text-layout/expressive'
import { type PaintStroke, stampStrokes, strokeBounds } from '~/lib/compositor/brushStamp'
import {
  applyEffectChain, applyStackPost, chainActive, isChainEffect,
  type AdjustEffect, type BloomEffect, type DofEffect, type DuotoneEffect,
  type GradientMapEffect, type GrainEffect, type PostEffect, type VignetteEffect,
} from '~/lib/compositor/postEffects'
import { applyDof, dofAvailable, dofShouldRun } from '~/lib/compositor/dofPass'
import { depthImageFor, requestDepth } from '~/lib/compositor/depthRegistry'
import { ensureFillBitmaps } from '~/lib/paint/imageFillCache'

// Throwaway 2D context used only for text measurement (localLayerBox mutates the
// ctx font), so it never touches a real render target.
let _measureCtx: CanvasRenderingContext2D | null = null
function measureCtx(): CanvasRenderingContext2D | null {
  if (!_measureCtx && typeof document !== 'undefined') _measureCtx = document.createElement('canvas').getContext('2d')
  return _measureCtx
}

interface MotionPainter {
  motionStateFor: (layer: LocalLayer, t: number, motion: FrameMotion) => LayerMotionState | null
  drawLayerWithMotion: (
    ctx: CanvasRenderingContext2D, layer: LocalLayer, W: number, H: number,
    maskLayer: LocalLayer | null, st: LayerMotionState, maskState: LayerMotionState | null,
  ) => void
  identityState: () => LayerMotionState
}
let _motionPainterImpl: MotionPainter | null = null
export function _registerMotionPainter(impl: MotionPainter) { _motionPainterImpl = impl }

// ── Paint (solid color or gradient) ──────────────────────────────────────────
// Moved to lib/compositor/paint.ts so CPU-only lib/ modules (fillTile.ts) can
// reference `Paint` without pointing back up at this composable — re-exported
// here unchanged so this file's ~40 existing importers don't need to move.
export {
  type GradientStop, type LinearGradient, type RadialGradient, type Gradient, type Paint, type ImageFill,
  isGradient, isFill, isImageFill,
} from '~/lib/compositor/paint'
import { type Paint, isFill, isImageFill } from '~/lib/compositor/paint'
import { buildDisplacementField, resampleBilinear, type DisplaceMapSpec } from '~/lib/compositor/displace'

// Layer effects (Figma-style). All distances normalized to canvas width, like
// every other dimension here, so they survive resize/export unchanged.
export interface DropShadowEffect {
  type: 'drop_shadow'
  color: string   // rgba/hex (alpha allowed)
  x: number       // offset X, normalized to canvas width
  y: number       // offset Y, normalized to canvas width
  blur: number    // blur radius, normalized to canvas width
  visible: boolean
}
export interface LayerBlurEffect {
  type: 'layer_blur'
  radius: number  // blur radius, normalized to canvas width
  visible: boolean
}
// Shadow cast inward from the layer's silhouette edge (Figma inner shadow).
export interface InnerShadowEffect {
  type: 'inner_shadow'
  color: string
  x: number       // offset X, normalized to canvas width
  y: number       // offset Y, normalized to canvas width
  blur: number    // blur radius, normalized to canvas width
  visible: boolean
}
// Blur what's BEHIND the layer, within its silhouette (Figma background blur).
// Previews correctly wherever the full stack is painted (paintLayerStack); a
// bake of locals alone can only blur the local backdrop below it — wired
// pixels behind it composite server-side, so they can't be pre-blurred.
export interface BackgroundBlurEffect {
  type: 'background_blur'
  radius: number  // blur radius, normalized to canvas width
  visible: boolean
}
export type { AdjustEffect, BloomEffect, DofEffect, DuotoneEffect, GradientMapEffect, GrainEffect, PostEffect, VignetteEffect }
export type LayerEffect =
  | DropShadowEffect | LayerBlurEffect | InnerShadowEffect | BackgroundBlurEffect
  | AdjustEffect | BloomEffect | GrainEffect | VignetteEffect | DuotoneEffect | GradientMapEffect
  // GPU-stage. Lives in the same per-layer effects array as the rest, but is routed by
  // GPU_TYPES rather than CHAIN_TYPES so applyEffectChain never sees it.
  | DofEffect

// Clip mask: the layer is clipped to a rect/ellipse region in CANVAS space
// (axis-aligned, normalized like everything else). For local layers this is
// applied in the canvas and carried into the bake, so the clipped alpha is also
// the generation coverage — the seam for "mask region == inpaint region".
export interface LayerMask {
  kind: 'rect' | 'ellipse'
  x: number          // normalized center X (of width)
  y: number          // normalized center Y (of height)
  w: number          // normalized to canvas width
  h: number          // normalized to canvas width
}

/** 4-corner projective (corner-pin / perspective) warp. Each corner is an OFFSET
 *  from the layer box's natural corner, normalized to the box half-extent
 *  (0 ⇒ no offset = the un-warped rectangle). Applied in the layer's local space. */
export interface CornerPin {
  tl: { x: number; y: number }
  tr: { x: number; y: number }
  br: { x: number; y: number }
  bl: { x: number; y: number }
}
export const IDENTITY_CORNER_PIN: CornerPin = { tl: { x: 0, y: 0 }, tr: { x: 0, y: 0 }, br: { x: 0, y: 0 }, bl: { x: 0, y: 0 } }
/** True when a corner-pin actually distorts (any corner offset is non-trivial). */
export function cornerPinActive(c: CornerPin | undefined | null): c is CornerPin {
  if (!c) return false
  const e = 1e-4
  return [c.tl, c.tr, c.br, c.bl].some(p => Math.abs(p.x) > e || Math.abs(p.y) > e)
}

interface LayerCommon {
  id: string
  kind: LocalLayerKind
  x: number          // normalized center X (0..1 of width)
  y: number          // normalized center Y (0..1 of height)
  rotation: number   // degrees
  skewX?: number     // horizontal slant in degrees (affine shear); default 0
  skewY?: number     // vertical slant in degrees; default 0
  cornerPin?: CornerPin // 4-corner projective warp; absent/identity ⇒ no distortion
  opacity: number    // 0..1
  visible?: boolean  // false = hidden everywhere (render, bake, export); undefined = visible
  locked?: boolean   // true = not selectable/editable from the canvas (panel still can)
  blend?: string     // blend mode vs layers below ('normal' default; same names as wired)
  groupId?: string   // layers sharing a groupId select/move/transform together
  groupName?: string // display name for the group (mirrored on every member)
  name?: string      // user-set display name (overrides the derived label)
  effects?: LayerEffect[] // drop shadow etc. — applied at render time
  mask?: LayerMask        // crop to a rect/ellipse region — applied at render time
  maskedById?: string     // DEPRECATED legacy local-only ref; read via layerMaskRef()
  maskedByKey?: string     // clipped by another layer's silhouette; a StackKey ('w:<slot>'|'l:<id>')
  maskShowSource?: boolean // when true, the mask source also renders normally at its z-position
  /** Freehand visibility painted on THIS layer (brush "Mask mode"). Strokes are
   *  width-normalized to the artboard and applied `destination-in` when the layer
   *  renders. Absent/empty ⇒ no stroke mask. */
  maskStrokes?: import('~/lib/compositor/brushStamp').PaintStroke[]
  /** Base visibility the stroke mask starts from. 'visible' (default): fully
   *  shown, erase strokes cut holes (brush hides, eraser un-hides). 'hidden':
   *  fully clipped, non-erase strokes reveal (invert). */
  maskBase?: 'visible' | 'hidden'
  /** Linked cloner: stamp this layer N times (linear/grid/radial) with falloff.
   *  Absent/disabled ⇒ a single instance, i.e. today's behavior. */
  cloner?: Cloner
  /** Motion (Kinetic Slates): timing + presets evaluated by app/lib/motion.
   *  Absent ⇒ the layer is static and always visible. */
  animation?: import('~/lib/motion/types').LayerAnimation
}

/** True when a layer is hidden (visible === false; undefined means visible). */
export function layerHidden(l: { visible?: boolean } | null | undefined): boolean {
  return l?.visible === false
}

/**
 * The StackKey of the layer this one is masked by, or undefined. Prefers the
 * new cross-source `maskedByKey`; falls back to the legacy local-only
 * `maskedById` (interpreted as `l:<id>`) so old frames keep rendering.
 */
export function layerMaskRef(
  l: { maskedByKey?: string; maskedById?: string } | null | undefined,
): string | undefined {
  if (l?.maskedByKey) return l.maskedByKey
  if (l?.maskedById) return `l:${l.maskedById}`
  return undefined
}

export interface TextLayer extends LayerCommon {
  kind: 'text'
  text: string
  fontFamily: string
  fontWeight: number     // 100..900 (was 400 | 700 — old values stay valid)
  fontSize: number       // normalized to canvas width
  color: Paint           // text fill — solid, gradient, or a patterned Fill
  align: 'left' | 'center' | 'right' | 'justify'
  /** Vertical alignment within the text box (`boxH`). Absent ⇒ 'top'. Only
   *  meaningful when `boxH` is set (otherwise there's no height to align in). */
  valign?: 'top' | 'middle' | 'bottom' | 'justify'
  lineHeight: number     // multiplier
  letterSpacing?: number // tracking in em (fraction of font size); default 0
  underline?: boolean    // draw an underline under each line
  strikethrough?: boolean// draw a line-through each line
  /** Display-only case transform (the stored `text` is left untouched, so it
   *  round-trips through inline editing). Absent ⇒ text renders verbatim. */
  textTransform?: 'uppercase' | 'lowercase' | 'capitalize'
  strokeColor: Paint
  strokeWidth: number    // normalized to canvas width (0 = no outline)
  boxW?: number          // optional text-box width (normalized to canvas width);
                         // set => words auto-wrap to fit, unset => explicit \n only
  boxH?: number          // optional text-box height (normalized to canvas width);
                         // enables valign + vertical justify. Absent => natural height.
  /** Live variable-font axis values (wght/wdth/slnt/…). When present, `wght`
   *  drives the numeric font-weight in the canvas `font` shorthand (the only
   *  variable-axis path that renders on every browser); the full set is also
   *  applied via `fontVariationSettings` where the canvas supports it. */
  axes?: Record<string, number>
  /** Expressive per-word layout. When present, words are grouped into lines by
   *  count and each is placed by a seeded rule (overriding flow `align`).
   *  Absent ⇒ normal line-based rendering (byte-identical to before). */
  expressive?: ExpressiveParams
}

export interface RectLayer extends LayerCommon {
  kind: 'rect'
  w: number; h: number    // normalized to canvas width
  fill: Paint             // '' / 'none' = no fill; or a gradient / patterned Fill
  stroke: Paint
  strokeWidth: number     // normalized to canvas width
  radius: number          // normalized to canvas width
}

export interface EllipseLayer extends LayerCommon {
  kind: 'ellipse'
  w: number; h: number
  fill: Paint
  stroke: Paint
  strokeWidth: number
}

/**
 * Bezier vector path — the core of the vector editor. Geometry is stored as an
 * SVG path string `d` whose coordinates are in LOCAL units (1 unit = canvas
 * width) and CENTERED on the path's bounding-box midpoint, so the layer's x/y +
 * rotation transform behaves exactly like every other layer. `scale` is a
 * uniform multiplier the resize handle drives; `bbox` is the un-scaled local
 * extent (cached on import/edit) used for selection boxes and hit-testing.
 */
export interface PathLayer extends LayerCommon {
  kind: 'path'
  d: string               // SVG path data, local units, centered on (0,0)
  bbox: { w: number; h: number } // un-scaled local extent (width-fraction units)
  scale: number           // uniform size multiplier
  fill: Paint             // '' / 'none' = no fill; or a gradient / patterned Fill
  fillRule: 'nonzero' | 'evenodd'
  stroke: Paint
  strokeWidth: number     // local units at scale=1 (scales with the shape)
}

export interface LineLayer extends LayerCommon {
  kind: 'line'
  w: number               // length, normalized to canvas width
  stroke: Paint
  strokeWidth: number
}

export interface ImageLayer extends LayerCommon {
  kind: 'image'
  filename: string        // uploaded image in ComfyUI's input dir
  w: number; h: number    // normalized to canvas width (aspect preserved on drop)
  tint?: Paint            // optional fill blended over the image, clipped to its alpha
  tintBlend?: string      // blend mode for the tint (same names as layer blend)
  tintOpacity?: number    // 0..1 tint strength; default 1
  displaceMap?: DisplaceMapSpec // present ⇒ layer is a lens warping everything below
}

export interface PolygonLayer extends LayerCommon {
  kind: 'polygon'
  w: number; h: number
  sides: number          // integer >= 3
  cornerRadius: number   // 0..1 ratio (scale-invariant)
  fill: Paint; stroke: Paint; strokeWidth: number
}
export interface StarLayer extends LayerCommon {
  kind: 'star'
  w: number; h: number
  points: number         // integer >= 3
  innerRatio: number     // 0.01..0.99 (inner radius / outer radius)
  cornerRadius: number   // 0..1 ratio
  fill: Paint; stroke: Paint; strokeWidth: number
}

export interface BrushLayer extends LayerCommon {
  kind: 'brush'
  strokes: PaintStroke[]
  fill: Paint            // region fill — full FillControl set; '' / 'none' = no fill
  stroke?: Paint         // optional outline of the painted silhouette
  strokeWidth?: number   // normalized to width
  w: number              // full-artboard bounds; 1 = artboard width
  h: number              // aspect (artboardH / artboardW)
}

export type LocalLayer = TextLayer | RectLayer | EllipseLayer | LineLayer | ImageLayer | PathLayer | PolygonLayer | StarLayer | BrushLayer

// Re-export so consumers of local layers can import the stroke type from one place.
export type { PaintStroke } from '~/lib/compositor/brushStamp'

let _idSeq = 0
function newId(): string {
  _idSeq += 1
  return `ll-${Date.now().toString(36)}-${_idSeq}`
}

// ── Ideogram Layerize import ─────────────────────────────────────────────────
// Convert the layers_json emitted by LayerizeGraphicNode (Ideogram Layerize)
// into Frame text layers. Ideogram reports a `resolution` (often different
// from the input size — it re-renders) and text containers whose item boxes
// are top-left px rects in that resolution space; our layers are normalized
// center coords, so the math here is the whole conversion. Schema sample:
//   { data: [{ resolution: "1152x864", text_containers: [{ items: [{
//       x, y, width, height, angle, alignment, font_file, font_size,
//       line_height, spans: [{ color, text }] }] }] }] }
export interface IdeogramImport { width: number; height: number; textLayers: TextLayer[] }

export function parseIdeogramLayers(json: string): IdeogramImport | null {
  let root: any
  try { root = JSON.parse(json) } catch { return null }
  const d = root?.data?.[0]
  if (!d) return null
  const [W, H] = String(d.resolution || '').split('x').map(Number)
  if (!W || !H) return null
  const textLayers: TextLayer[] = []
  for (const container of d.text_containers ?? []) {
    for (const item of container.items ?? []) {
      const spans: any[] = item.spans ?? []
      const text = spans.map((s) => s?.text ?? '').join('')
      if (!text.trim()) continue
      // 'Montserrat-Medium.ttf' → 'Montserrat'; camel-case splits get spaces.
      const file = String(item.font_file || '')
      const family = file.replace(/\.(ttf|otf)$/i, '').split('-')[0]
        .replace(/([a-z])([A-Z])/g, '$1 $2').trim()
      textLayers.push(createTextLayer({
        x: ((item.x ?? 0) + (item.width ?? 0) / 2) / W,
        y: ((item.y ?? 0) + (item.height ?? 0) / 2) / H,
        rotation: Number(item.angle) || 0,
        text,
        fontFamily: family || 'Inter',
        fontWeight: /bold|black|heavy|700|800|900/i.test(file) ? 700 : 400,
        fontSize: (Number(item.font_size) || 32) / W,
        color: spans[0]?.color || '#ffffff',
        align: (['left', 'center', 'right'] as const).includes(item.alignment) ? item.alignment : 'center',
        lineHeight: typeof item.line_height === 'number' && item.line_height > 0 ? item.line_height : 1.2,
      }))
    }
  }
  return { width: W, height: H, textLayers }
}

// ── Seedream Layerize import ─────────────────────────────────────────────────
// Convert the layers_json emitted by SeedreamLayerizeNode into Compositor image
// layers. Each layer's PNG lives in the input dir (referenced by `filename`);
// geometry follows the shared convention — x/y are normalized centers, w AND h
// normalize to WIDTH. A boxless layer (the base) fills the canvas. Ordered
// bottom→top by z. Schema sample:
//   { source: "seedream", width, height, layers: [{
//       filename, z_index, box: [left,top,right,bottom]|null, name, description }] }
export interface SeedreamImport { width: number; height: number; imageLayers: ImageLayer[] }

/** Convert a SeedreamLayerizeNode `layers_json` into Compositor image layers.
 *  Each layer's PNG lives in the input dir (referenced by `filename`); geometry
 *  follows the shared convention — x/y are normalized centers, w AND h normalize
 *  to WIDTH. A boxless layer (the base) fills the canvas. Ordered bottom→top by z. */
export function parseSeedreamLayers(json: string): SeedreamImport | null {
  let root: any
  try { root = JSON.parse(json) } catch { return null }
  const W = Number(root?.width), H = Number(root?.height)
  const raw: any[] = Array.isArray(root?.layers) ? root.layers : []
  if (!W || !H || !raw.length) return null
  const sorted = [...raw].sort((a, b) => (Number(a?.z_index) || 0) - (Number(b?.z_index) || 0))
  const imageLayers: ImageLayer[] = []
  for (const l of sorted) {
    const filename = String(l?.filename || '')
    if (!filename) continue
    const box = Array.isArray(l?.box) && l.box.length === 4 ? l.box.map(Number) : null
    let x = 0.5, y = 0.5, w = 1, h = H / W
    if (box) {
      const [left, top, right, bottom] = box
      x = ((left + right) / 2) / W
      y = ((top + bottom) / 2) / H
      w = (right - left) / W
      h = (bottom - top) / W        // width-normalized, per LayerCommon convention
    }
    imageLayers.push(createImageLayer(filename, 1, {
      x, y, w, h, opacity: 1, name: String(l?.name || '') || undefined,
    }))
  }
  if (!imageLayers.length) return null
  return { width: W, height: H, imageLayers }
}

// ── Factories ───────────────────────────────────────────────────────────────

export function createTextLayer(partial: Partial<TextLayer> = {}): TextLayer {
  return {
    id: newId(), kind: 'text',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    text: 'Double-click to edit',
    fontFamily: 'Inter', fontWeight: 700,
    fontSize: 0.08, color: '#ffffff', align: 'center', lineHeight: 1.2,
    strokeColor: '#000000', strokeWidth: 0,
    ...partial,
  }
}

export function createRectLayer(partial: Partial<RectLayer> = {}): RectLayer {
  return {
    id: newId(), kind: 'rect',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.3, h: 0.18, fill: '#3b82f6', stroke: '', strokeWidth: 0, radius: 0.02,
    ...partial,
  }
}

export function createEllipseLayer(partial: Partial<EllipseLayer> = {}): EllipseLayer {
  return {
    id: newId(), kind: 'ellipse',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.24, h: 0.24, fill: '#ef4444', stroke: '', strokeWidth: 0,
    ...partial,
  }
}

export function createPolygonLayer(partial: Partial<PolygonLayer> = {}): PolygonLayer {
  return {
    id: newId(), kind: 'polygon',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.24, h: 0.24, sides: 6, cornerRadius: 0,
    fill: '#3b82f6', stroke: '', strokeWidth: 0,
    ...partial,
  }
}
export function createStarLayer(partial: Partial<StarLayer> = {}): StarLayer {
  return {
    id: newId(), kind: 'star',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.24, h: 0.24, points: 5, innerRatio: 0.5, cornerRadius: 0,
    fill: '#f59e0b', stroke: '', strokeWidth: 0,
    ...partial,
  }
}

export function createLineLayer(partial: Partial<LineLayer> = {}): LineLayer {
  return {
    id: newId(), kind: 'line',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 0.4, stroke: '#ffffff', strokeWidth: 0.01,
    ...partial,
  }
}

export function createPathLayer(partial: Partial<PathLayer> = {}): PathLayer {
  return {
    id: newId(), kind: 'path',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    d: '', bbox: { w: 0.3, h: 0.3 }, scale: 1,
    fill: '#3b82f6', fillRule: 'nonzero', stroke: '', strokeWidth: 0,
    ...partial,
  }
}

/**
 * Convert a primitive shape (rect / ellipse / line) to an equivalent PathLayer
 * so it can take part in boolean ops, node editing, etc. Geometry is expressed
 * in the path local frame (centered on origin, units = canvas width), matching
 * the shape's own x/y/rotation. Returns the layer unchanged if already a path,
 * or null for kinds without a closed outline to convert (text / image).
 */
export function shapeToPathLayer(layer: LocalLayer): PathLayer | null {
  if (layer.kind === 'path') return layer
  const f = (v: number) => +v.toFixed(5)
  if (layer.kind === 'rect') {
    const { w, h } = layer
    const r = Math.max(0, Math.min(layer.radius, Math.min(w, h) / 2))
    const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2
    const d = r <= 0
      ? `M ${f(x0)} ${f(y0)} L ${f(x1)} ${f(y0)} L ${f(x1)} ${f(y1)} L ${f(x0)} ${f(y1)} Z`
      : `M ${f(x0 + r)} ${f(y0)} L ${f(x1 - r)} ${f(y0)} Q ${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + r)}` +
        ` L ${f(x1)} ${f(y1 - r)} Q ${f(x1)} ${f(y1)} ${f(x1 - r)} ${f(y1)}` +
        ` L ${f(x0 + r)} ${f(y1)} Q ${f(x0)} ${f(y1)} ${f(x0)} ${f(y1 - r)}` +
        ` L ${f(x0)} ${f(y0 + r)} Q ${f(x0)} ${f(y0)} ${f(x0 + r)} ${f(y0)} Z`
    return createPathLayer({
      d, bbox: { w, h }, scale: 1, x: layer.x, y: layer.y, rotation: layer.rotation,
      opacity: layer.opacity, fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth,
    })
  }
  if (layer.kind === 'ellipse') {
    const rx = layer.w / 2, ry = layer.h / 2, k = 0.5522847498 // cubic circle constant
    const kx = rx * k, ky = ry * k
    const d = `M 0 ${f(-ry)} C ${f(kx)} ${f(-ry)} ${f(rx)} ${f(-ky)} ${f(rx)} 0` +
      ` C ${f(rx)} ${f(ky)} ${f(kx)} ${f(ry)} 0 ${f(ry)}` +
      ` C ${f(-kx)} ${f(ry)} ${f(-rx)} ${f(ky)} ${f(-rx)} 0` +
      ` C ${f(-rx)} ${f(-ky)} ${f(-kx)} ${f(-ry)} 0 ${f(-ry)} Z`
    return createPathLayer({
      d, bbox: { w: layer.w, h: layer.h }, scale: 1, x: layer.x, y: layer.y, rotation: layer.rotation,
      opacity: layer.opacity, fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth,
    })
  }
  if (layer.kind === 'line') {
    const w = layer.w
    return createPathLayer({
      d: `M ${f(-w / 2)} 0 L ${f(w / 2)} 0`, bbox: { w, h: Math.max(layer.strokeWidth, 0.001) },
      scale: 1, x: layer.x, y: layer.y, rotation: layer.rotation, opacity: layer.opacity,
      fill: 'none', stroke: layer.stroke, strokeWidth: layer.strokeWidth,
    })
  }
  if (layer.kind === 'polygon') {
    const d = polygonPathData(layer.sides, layer.w, layer.h, layer.cornerRadius)
    if (!d) return null
    return createPathLayer({
      d, bbox: { w: layer.w, h: layer.h }, scale: 1,
      x: layer.x, y: layer.y, rotation: layer.rotation, opacity: layer.opacity,
      fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth,
    })
  }
  if (layer.kind === 'star') {
    const d = starPathData(layer.points, layer.innerRatio, layer.w, layer.h, layer.cornerRadius)
    if (!d) return null
    return createPathLayer({
      d, bbox: { w: layer.w, h: layer.h }, scale: 1,
      x: layer.x, y: layer.y, rotation: layer.rotation, opacity: layer.opacity,
      fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth,
    })
  }
  return null
}

/** Create an image layer. `aspect` (w/h) sizes the box so the image isn't
 *  distorted; defaults to a square. */
export function createImageLayer(filename: string, aspect = 1, partial: Partial<ImageLayer> = {}): ImageLayer {
  // Derive h from the *effective* width (a partial.w override included) so the
  // box keeps the image's aspect; partial can still override h explicitly.
  const w = partial.w ?? 0.6
  return {
    id: newId(), kind: 'image',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    filename, w, h: w / (aspect || 1),
    ...partial,
  }
}

export function createBrushLayer(partial: Partial<BrushLayer> = {}): BrushLayer {
  return {
    id: newId(), kind: 'brush',
    x: 0.5, y: 0.5, rotation: 0, opacity: 1,
    w: 1, h: 1, strokes: [], fill: '#3b82f6', stroke: '', strokeWidth: 0,
    ...partial,
  }
}

// ── Image-layer asset loading ────────────────────────────────────────────────
const _imageCache = new Map<string, HTMLImageElement>()

/** Resolve an image layer's filename to a ComfyUI /view URL. */
export function imageLayerUrl(filename: string): string {
  return `/view?${new URLSearchParams({ filename, type: 'input' })}`
}

/** Every ImageFill `src` referenced by a layer's fill or stroke, de-duplicated.
 *  Drives the preload so the synchronous resolve arm has the bitmap in hand. */
export function collectFillImageSrcs(layers: LocalLayer[]): string[] {
  const out = new Set<string>()
  for (const l of layers) {
    for (const p of [(l as any).fill, (l as any).stroke]) {
      if (isImageFill(p) && p.src) out.add(p.src)
    }
  }
  return [...out]
}

/** Preload every image layer's bitmap into the module cache so the synchronous
 *  `drawLocalLayer` can paint it. Resolves once all are loaded (or errored). */
export async function ensureLayerImages(layers: LocalLayer[]): Promise<void> {
  if (typeof window === 'undefined') return
  const jobs: Promise<unknown>[] = []
  for (const layer of layers) {
    if (layer.kind !== 'image') continue
    const url = imageLayerUrl(layer.filename)
    if (_imageCache.get(url)?.complete) continue
    jobs.push(new Promise((res) => {
      const im = new Image()
      im.onload = () => { _imageCache.set(url, im); res(null) }
      im.onerror = () => res(null)
      im.src = url
    }))
  }
  jobs.push(ensureFillBitmaps(collectFillImageSrcs(layers)))
  if (jobs.length) await Promise.all(jobs)
}

// ── Rendering ─────────────────────────────────────────────────────────────--

// `hasPaint` / `resolvePaint` / `resolveFill` / `resolveShaderFill` (and the fill-tile
// cache + OBJECT_SHADER_FIELD_PX) now live in ~/lib/paint/resolve.ts, verbatim, so a
// second studio can use the same resolver instead of growing a near-copy. Behaviour is
// unchanged; the only difference is that the frame state below is passed IN explicitly
// rather than read off a module global inside the resolver.

// ── Shader fills on frame primitives (Task 6) ────────────────────────────────────
// The Compositor is its OWN shader-fill host: `withFieldFrame`'s live-field ceiling
// (see ~/lib/shaderfill/field.ts) and the frozen-field count it returns must be this
// frame's own, never pooled with an open Space Type/Shape Studio node — those are a
// DIFFERENT host with their own per-owner call in ~/lib/spacetype/fills.ts's
// refreshLiveShaderFills (Task 4's `withShaderFillContext` scheme). `paintLayerStack`
// (below) is the ONE place that calls `withFieldFrame`, once per synchronous pass,
// with every shader fill this frame's own layers + background actually carry — so as
// long as it never awaits mid-pass (it doesn't), no other host's span can land
// between it and the resolveField calls that consume its `liveKeys`.
//
// `_fieldCtx` is THIS host's frame state, threaded into every resolvePaint call below
// as the explicit `field` argument (see ~/lib/paint/resolve.ts's header for why it is
// no longer a global inside the resolver). Its `.base` field and the pattern-matrix
// reasoning that consumes it are documented on `ShaderFieldFrameCtx` over there; the
// capture points are here (before every `applyXform`, and before the background's own
// center translate).
let _fieldCtx: ShaderFieldFrameCtx = { frameW: 1, frameH: 1, t: 0, fps: 30, base: null, bake: false, token: 0 }

/** Draw an image with a fill (`tint`) blended over it, clipped to the image's
 *  alpha. Three passes in a centered offscreen: image → blend-fill tint → keep
 *  only where the image is opaque (destination-in). Then place it centered. */
function drawTintedImage(
  ctx: CanvasRenderingContext2D, img: CanvasImageSource, layer: ImageLayer, w: number, h: number,
): void {
  const tw = Math.max(1, Math.round(w)), th = Math.max(1, Math.round(h))
  const off = document.createElement('canvas'); off.width = tw; off.height = th
  const octx = off.getContext('2d')
  if (!octx) { ctx.drawImage(img, -w / 2, -h / 2, w, h); return }
  octx.translate(tw / 2, th / 2) // center, so resolvePaint's gradient/pattern geometry lines up
  octx.drawImage(img, -tw / 2, -th / 2, tw, th)
  octx.globalCompositeOperation = WIRED_BLEND_OP[layer.tintBlend ?? 'normal'] ?? 'source-over'
  octx.globalAlpha = Math.max(0, Math.min(1, layer.tintOpacity ?? 1))
  octx.fillStyle = resolvePaint(octx, layer.tint!, { w: tw, h: th }, _fieldCtx)
  octx.fillRect(-tw / 2, -th / 2, tw, th)
  octx.globalAlpha = 1
  octx.globalCompositeOperation = 'destination-in' // clip the tint back to the image silhouette
  octx.drawImage(img, -tw / 2, -th / 2, tw, th)
  ctx.drawImage(off, -w / 2, -h / 2, w, h)
}

/** Apply a layer's display-only case transform to a string. */
function transformCase(s: string, t: TextLayer['textTransform']): string {
  if (t === 'uppercase') return s.toUpperCase()
  if (t === 'lowercase') return s.toLowerCase()
  if (t === 'capitalize') return s.replace(/\b\p{L}/gu, c => c.toUpperCase())
  return s
}

/** Split text into explicit-newline lines, applying any case transform so that
 *  measurement (wrap, box) and drawing operate on the same displayed glyphs. */
function textLines(layer: TextLayer): string[] {
  return transformCase(layer.text ?? '', layer.textTransform).split('\n')
}

/**
 * Final render lines: explicit newlines, then — when the layer has a text box
 * (`boxW`) — greedy word-wrap each line to fit the box. A word longer than the
 * box overflows on its own line rather than breaking mid-word. Needs a 2D
 * context for measurement; without one, falls back to explicit lines only.
 */
export function wrappedTextLines(ctx: CanvasRenderingContext2D | null, layer: TextLayer, W: number): string[] {
  const manual = textLines(layer)
  const boxPx = (layer.boxW ?? 0) * W
  if (!ctx || !(boxPx > 0)) return manual
  applyFont(ctx, layer, W)
  const out: string[] = []
  for (const line of manual) {
    const words = line.split(/\s+/).filter(Boolean)
    if (!words.length) { out.push(''); continue }
    let cur = words[0]
    for (let i = 1; i < words.length; i++) {
      const candidate = `${cur} ${words[i]}`
      if (ctx.measureText(candidate).width <= boxPx) cur = candidate
      else { out.push(cur); cur = words[i] }
    }
    out.push(cur)
  }
  return out
}

export function applyFont(ctx: CanvasRenderingContext2D, layer: TextLayer, W: number) {
  // A live `wght` axis drives the numeric weight in the `font` shorthand — the
  // one variable-axis path canvas honors on every browser (when a variable face
  // is loaded). Without this, an animated weight silently renders the static one.
  const wght = layer.axes?.wght
  const weight = wght != null && Number.isFinite(wght) ? Math.round(wght) : layer.fontWeight
  ctx.font = `${weight} ${layer.fontSize * W}px ${cssFontStack(layer.fontFamily)}`
  // Letter spacing (tracking). Canvas exposes `ctx.letterSpacing` as a CSS length
  // on modern browsers; `font` does NOT reset it, so we set it every time (0 when
  // unset) to avoid it leaking between layers. measureText honors it too, so wrap
  // and box math stay correct with no extra work.
  if ('letterSpacing' in ctx) {
    const tracking = Math.round((layer.letterSpacing || 0) * layer.fontSize * W * 1000) / 1000
    ;(ctx as unknown as { letterSpacing: string }).letterSpacing = `${tracking}px`
  }
  // Progressive enhancement: apply the FULL axis set (slnt/wdth/opsz/custom) via
  // fontVariationSettings, in the correct order (AFTER `font`, which resets it),
  // on browsers that expose the (non-standard) canvas property.
  if (layer.axes && 'fontVariationSettings' in ctx) {
    ;(ctx as unknown as { fontVariationSettings: string }).fontVariationSettings =
      axesToVariationSettings(layer.axes) || 'normal'
  }
}

function cssFontStack(family: string): string {
  // Quote families with spaces; keep a generic fallback so canvas always draws.
  const quoted = /\s/.test(family) ? `"${family}"` : family
  return `${quoted}, sans-serif`
}

/**
 * Bounding box of a layer in PIXELS (un-rotated), centered on origin.
 * For text this measures the rendered glyph block. A 2D context is required
 * for text measurement; pass any scratch context.
 */
export function localLayerBox(
  ctx: CanvasRenderingContext2D | null,
  layer: LocalLayer,
  W: number,
  H: number,
): { w: number; h: number } {
  if (layer.kind === 'text') {
    const lines = wrappedTextLines(ctx, layer, W)
    const lineH = layer.fontSize * W * layer.lineHeight
    // With a text box, the box width IS the layer width (selection/handles
    // track the box, not the glyph extents).
    if ((layer.boxW ?? 0) > 0) {
      return { w: Math.max(layer.boxW! * W, 4), h: Math.max(lines.length * lineH, lineH) }
    }
    let maxW = 0
    if (ctx) {
      applyFont(ctx, layer, W)
      for (const ln of lines) maxW = Math.max(maxW, ctx.measureText(ln || ' ').width)
    } else {
      // Rough fallback without measurement.
      maxW = Math.max(...lines.map(l => (l.length || 1))) * layer.fontSize * W * 0.6
    }
    return { w: Math.max(maxW, 4), h: Math.max(lines.length * lineH, lineH) }
  }
  if (layer.kind === 'line') {
    return { w: layer.w * W, h: Math.max(layer.strokeWidth * W, 6) }
  }
  if (layer.kind === 'path') {
    const s = (layer.scale || 1) * W
    return { w: Math.max(layer.bbox.w * s, 4), h: Math.max(layer.bbox.h * s, 4) }
  }
  if (layer.kind === 'brush') {
    // Size the selection box from the painted bounds LIVE, so it hugs the marks
    // regardless of the layer's stored w/h (which may be stale full-frame values).
    // The box is centred at the layer's x/y, which is exactly where the render
    // centres the strokes' bounds — so it wraps the rendered marks precisely.
    const b = strokeBounds((layer as BrushLayer).strokes)
    return { w: Math.max(4, (b.maxX - b.minX) * W), h: Math.max(4, (b.maxY - b.minY) * W) }
  }
  return { w: (layer as RectLayer).w * W, h: (layer as RectLayer).h * W }
}

/** Draw a single local layer onto a 2D context sized W×H. */
// Clip the context to a layer's mask region (canvas space). Caller wraps this in
// save()/restore(). No-op shape support beyond rect/ellipse for now.
function applyMaskClip(ctx: CanvasRenderingContext2D, mask: LayerMask, W: number, H: number) {
  const cx = mask.x * W, cy = mask.y * H, w = Math.max(0, mask.w * W), h = Math.max(0, mask.h * W)
  ctx.beginPath()
  if (mask.kind === 'ellipse') ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
  else ctx.rect(cx - w / 2, cy - h / 2, w, h)
  ctx.clip()
}

export function drawLocalLayer(
  ctx: CanvasRenderingContext2D,
  layer: LocalLayer,
  W: number,
  H: number,
  maskLayer?: LocalLayer | null,
  opacityMul = 1,
) {
  // Layer mask: clip this layer to another layer's alpha silhouette (Figma
  // "use as mask"). Render the content, then keep only where the mask layer's
  // alpha is, via destination-in on an offscreen.
  if (maskLayer) {
    // Offscreens are sized to the DEVICE canvas and rendered through the current
    // transform, so a masked layer stays sharp under any ctx scale (dpr preview,
    // or a high-res export that scales logical W×H up). Sizing to logical W×H
    // would composite at preview resolution and then upscale → blur.
    const t = ctx.getTransform()
    const dev = ctx.canvas
    const mk = () => {
      const c = document.createElement('canvas')
      c.width = Math.max(1, dev.width); c.height = Math.max(1, dev.height)
      return c
    }
    const off = mk()
    const octx = off.getContext('2d')
    if (octx) {
      octx.setTransform(t)
      drawLocalLayerSelf(octx, layer, W, H, opacityMul)
      // The mask must be rendered on its OWN offscreen and composited with
      // drawImage: paintLayer (inside drawLocalLayerSelf) sets
      // globalCompositeOperation itself, which would silently overwrite a
      // destination-in set here and paint the mask instead of clipping with it.
      const maskOff = mk()
      const mctx = maskOff.getContext('2d')
      if (mctx) {
        mctx.setTransform(t)
        drawLocalLayerSelf(mctx, maskLayer, W, H)
        octx.setTransform(1, 0, 0, 1, 0, 0) // composite in device space
        octx.globalCompositeOperation = 'destination-in'
        octx.drawImage(maskOff, 0, 0)
        octx.globalCompositeOperation = 'source-over'
      }
      // The layer's blend mode applies at the final composite against the real
      // backdrop (inside the offscreen it blends against transparency = no-op).
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0) // device-space stamp
      ctx.globalCompositeOperation = localBlendOp(layer)
      ctx.drawImage(off, 0, 0)
      ctx.restore()
      return
    }
  }
  drawLocalLayerSelf(ctx, layer, W, H, opacityMul)
}

/**
 * Render an item's alpha silhouette (full opacity, no effects/blend) onto `ctx`,
 * sized W×H. Used as the clip source for another item's mask. Wired items render
 * via their draw closure; local items via their own paint (no nested mask).
 *
 * RESERVED FOR PHASE 2 (submit-time mask compile → layer{i}_mask PNG): the live
 * renderer's mask path uses drawItemContent (real paint), not this silhouette.
 */
export function drawLayerSilhouette(ctx: CanvasRenderingContext2D, item: StackItem, W: number, H: number) {
  if (item.type === 'wired') {
    ctx.save()
    item.draw(ctx, W, H)
    ctx.restore()
    return
  }
  const ghost = { ...item.layer, opacity: 1, effects: undefined, blend: undefined } as LocalLayer
  drawLocalLayerSelf(ctx, ghost, W, H)
}

// True when a layer carries a freehand visibility mask (brush "Mask mode").
function hasStrokeMask(layer: LocalLayer): boolean {
  return (layer.maskStrokes?.length ?? 0) > 0 || layer.maskBase === 'hidden'
}

// A layer's own paint, including its crop (rect/ellipse) region — but NOT any
// stroke mask (applied around this by drawLocalLayerSelf) or layer-mask (applied
// by drawLocalLayer).
function paintLayerCropped(ctx: CanvasRenderingContext2D, layer: LocalLayer, W: number, H: number, opacityMul: number) {
  if (layer.mask) {
    ctx.save()
    applyMaskClip(ctx, layer.mask, W, H)
    paintLayer(ctx, layer, W, H, opacityMul)
    ctx.restore()
  } else {
    paintLayer(ctx, layer, W, H, opacityMul)
  }
}

/**
 * Clip a layer's already-rendered pixels to its freehand visibility mask
 * (`maskStrokes` + `maskBase`), applied `destination-in`. `ctx` holds the
 * layer's pixels rendered through the current transform `t` on a device-sized
 * offscreen; the mask is built on its OWN device-sized offscreen through the
 * SAME `t` (so a stroke normalized to the artboard lands on the same device
 * pixels as the layer), then composited in device space. Mirrors the
 * drawLocalLayer / drawItemMasked layer-mask recipe exactly.
 *
 * Semantics ("brush HIDES, eraser RESTORES" — the inverse of a paint layer, so a
 * mask stroke reads oppositely to a paint stroke): base 'visible' → fill white
 * (fully shown), then a PLAIN stroke carves a hole (destination-out, hides the
 * layer) and an ERASE stroke paints white back (restores visibility). This is
 * achieved by flipping each stroke's `erase` flag before stampStrokes, whose
 * carve/paint logic then does exactly that. base 'hidden' (not surfaced in v1) →
 * start transparent, plain strokes paint white (reveal) — normal stampStrokes.
 */
function applyStrokeMask(ctx: CanvasRenderingContext2D, layer: LocalLayer, W: number, H: number) {
  const t = ctx.getTransform()
  const dev = ctx.canvas
  const mask = document.createElement('canvas')
  mask.width = Math.max(1, dev.width); mask.height = Math.max(1, dev.height)
  const mctx = mask.getContext('2d')
  if (!mctx) return
  mctx.setTransform(t)
  const strokes = layer.maskStrokes ?? []
  // `base = W`: strokes are normalized to the artboard width, which is W logical
  // px in this transform space (mirrors renderStack's stampStrokes call).
  if ((layer.maskBase ?? 'visible') === 'visible') {
    // Fully visible everywhere; a plain brush stroke carves a hole (hide) and an
    // eraser stroke paints white back (restore). Invert `erase` so stampStrokes'
    // destination-out carve fires for plain strokes and its white paint for erase.
    mctx.fillStyle = '#fff'
    mctx.fillRect(0, 0, W, H)
    const inverted = strokes.map(s => ({ ...s, erase: !s.erase }))
    stampStrokes(mctx, inverted, W)
  } else {
    // base 'hidden': start transparent, plain strokes reveal (paint white).
    stampStrokes(mctx, strokes, W)
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0) // device space — matches the layer's pixels
  ctx.globalCompositeOperation = 'destination-in'
  ctx.drawImage(mask, 0, 0)
  ctx.restore()
}

// A layer's own paint including its crop AND its freehand stroke mask — but NOT
// any layer-mask, which drawLocalLayer applies around this.
function drawLocalLayerSelf(ctx: CanvasRenderingContext2D, layer: LocalLayer, W: number, H: number, opacityMul = 1) {
  if (!hasStrokeMask(layer)) {
    paintLayerCropped(ctx, layer, W, H, opacityMul)
    return
  }
  // Stroke mask: isolate the layer on a device-sized offscreen so destination-in
  // clips ONLY this layer (not the shared context), apply the mask, then stamp
  // back with the layer's blend (a no-op inside the transparent offscreen, so it
  // takes effect here against the real backdrop). Same recipe as the layer-mask.
  const t = ctx.getTransform()
  const dev = ctx.canvas
  const off = document.createElement('canvas')
  off.width = Math.max(1, dev.width); off.height = Math.max(1, dev.height)
  const octx = off.getContext('2d')
  if (!octx) { paintLayerCropped(ctx, layer, W, H, opacityMul); return }
  octx.setTransform(t)
  paintLayerCropped(octx, layer, W, H, opacityMul)
  applyStrokeMask(octx, layer, W, H)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0) // device-space stamp
  ctx.globalCompositeOperation = localBlendOp(layer)
  ctx.drawImage(off, 0, 0)
  ctx.restore()
}

/** A local layer's blend mode → canvas composite op ('normal' = source-over). */
export function localBlendOp(layer: { blend?: string }): GlobalCompositeOperation {
  return WIRED_BLEND_OP[layer.blend ?? 'normal'] ?? 'source-over'
}

// Composite an inner shadow INTO a rendered layer offscreen. Standard recipe:
// take the inverse of the content alpha, draw it with canvas shadow params (the
// shadow spills inward across the silhouette edge), keep only the part inside
// the content (destination-in), then stamp that over the content.
function compositeInnerShadow(off: HTMLCanvasElement, fx: InnerShadowEffect, W: number) {
  const mk = () => {
    const c = document.createElement('canvas')
    c.width = off.width; c.height = off.height
    return c
  }
  const inv = mk()
  const ictx = inv.getContext('2d')
  const sh = mk()
  const sctx = sh.getContext('2d')
  if (!ictx || !sctx) return
  ictx.fillStyle = '#000'
  ictx.fillRect(0, 0, inv.width, inv.height)
  ictx.globalCompositeOperation = 'destination-out'
  ictx.drawImage(off, 0, 0)
  sctx.shadowColor = fx.color
  sctx.shadowBlur = Math.max(0, fx.blur * W)
  sctx.shadowOffsetX = fx.x * W
  sctx.shadowOffsetY = fx.y * W
  sctx.drawImage(inv, 0, 0)
  sctx.shadowColor = 'transparent'
  sctx.globalCompositeOperation = 'destination-in'
  sctx.drawImage(off, 0, 0)
  // off's context still carries the layer's translate/rotate from the content
  // draw — stamp the shadow in identity space or it lands displaced.
  const octx = off.getContext('2d')
  if (octx) {
    octx.save()
    octx.setTransform(1, 0, 0, 1, 0, 0)
    octx.drawImage(sh, 0, 0)
    octx.restore()
  }
}

function paintLayer(
  ctx: CanvasRenderingContext2D,
  layer: LocalLayer,
  W: number,
  H: number,
  opacityMul = 1,
) {
  const baseOpacity = Math.max(0, Math.min(1, layer.opacity * opacityMul))
  const blendOp = localBlendOp(layer)
  const fx = (layer.effects ?? []).filter(e => e.visible)
  const shadow = fx.find((e): e is DropShadowEffect => e.type === 'drop_shadow')
  const blur = fx.find((e): e is LayerBlurEffect => e.type === 'layer_blur')
  const inner = fx.find((e): e is InnerShadowEffect => e.type === 'inner_shadow')
  const chain = fx.filter(isChainEffect)
  // Image layers only — nothing else has a depth map to drive the blur.
  const dof = layer.kind === 'image'
    ? fx.find((e): e is DofEffect => e.type === 'dof')
    : undefined
  // (background_blur is a stack-level effect — paintLayerStack applies it
  // against the backdrop before this layer paints.)

  // Slant (affine shear) + corner-pin (projective warp). Both fold into the per-clone
  // local transform / content draw, so absent ⇒ byte-identical to before.
  const skx = layer.skewX || 0, sky = layer.skewY || 0
  const hasSkew = skx !== 0 || sky !== 0
  const shearA = hasSkew ? Math.tan((sky * Math.PI) / 180) : 0
  const shearC = hasSkew ? Math.tan((skx * Math.PI) / 180) : 0
  const cp = cornerPinActive(layer.cornerPin) ? layer.cornerPin : null
  const applyXform = (c: CanvasRenderingContext2D, lx2: number, ly2: number, lrot2: number, ls2: number) => {
    c.translate(lx2 * W, ly2 * H)
    if (lrot2) c.rotate((lrot2 * Math.PI) / 180)
    if (hasSkew) c.transform(1, shearA, shearC, 1, 0, 0)
    if (ls2 !== 1) c.scale(ls2, ls2)
  }
  // No corner-pin ⇒ draw content directly. With it: render content to a box-sized
  // offscreen (centered, like the normal draw), then projectively warp that box onto
  // the corner-pin quad in local space.
  // Depth of field runs on the GPU (postEffects' 2D chain cannot do a variable-radius
  // shaped blur), so it renders the layer's content to an offscreen and hands back a
  // canvas. null ⇒ off, unavailable, or depth not ready yet — every caller falls back
  // to the normal draw, so a layer ALWAYS renders.
  //
  // Memoized because expandClones calls drawContent once per clone and the DOF result
  // is identical for all of them. The result is copied out of the pass's canvas, which
  // is reused between calls — holding a reference to it would alias.
  let dofMemo: HTMLCanvasElement | null | undefined
  const dofContent = (): HTMLCanvasElement | null => {
    if (dofMemo !== undefined) return dofMemo
    dofMemo = null
    if (!dof || !dofAvailable()) return dofMemo

    const filename = (layer as ImageLayer).filename
    const depth = depthImageFor(filename)
    if (!depth) { requestDepth(filename); return dofMemo }
    if (!dofShouldRun(dof, true)) return dofMemo

    const box = localLayerBox(measureCtx(), layer, W, H)
    const bw = Math.max(1, Math.round(box.w)), bh = Math.max(1, Math.round(box.h))
    const src = document.createElement('canvas'); src.width = bw; src.height = bh
    const sctx = src.getContext('2d')
    if (!sctx) return dofMemo
    sctx.translate(bw / 2, bh / 2)
    drawLayerContent(sctx, layer, W)

    const out = applyDof(src, depth, dof, W, bw, bh)
    if (!out) return dofMemo

    const owned = document.createElement('canvas'); owned.width = bw; owned.height = bh
    owned.getContext('2d')?.drawImage(out, 0, 0)
    dofMemo = owned
    return dofMemo
  }

  const drawContent = (c: CanvasRenderingContext2D) => {
    const dofCanvas = dofContent()
    if (!cp) {
      if (dofCanvas) {
        c.drawImage(dofCanvas, -dofCanvas.width / 2, -dofCanvas.height / 2)
        return
      }
      drawLayerContent(c, layer, W); return
    }
    const box = localLayerBox(measureCtx(), layer, W, H)
    const bw = Math.max(1, Math.round(box.w)), bh = Math.max(1, Math.round(box.h))
    // Corner-pin warps whatever the content is — including the defocused version, so
    // the two effects compose instead of one silently winning.
    let cc: HTMLCanvasElement
    if (dofCanvas) {
      cc = dofCanvas
    } else {
      cc = document.createElement('canvas'); cc.width = bw; cc.height = bh
      const cctx = cc.getContext('2d')
      if (!cctx) { drawLayerContent(c, layer, W); return }
      cctx.translate(bw / 2, bh / 2)
      drawLayerContent(cctx, layer, W)
    }
    const hw = box.w / 2, hh = box.h / 2
    const quad: Quad = [
      { x: -hw + cp.tl.x * hw, y: -hh + cp.tl.y * hh },
      { x:  hw + cp.tr.x * hw, y: -hh + cp.tr.y * hh },
      { x:  hw + cp.br.x * hw, y:  hh + cp.br.y * hh },
      { x: -hw + cp.bl.x * hw, y:  hh + cp.bl.y * hh },
    ]
    drawQuadWarp(c, cc, quad, 16)
  }

  // Linked cloner: paint once per clone (back-to-front; original last). No
  // cloner ⇒ a single identity transform ⇒ one paint exactly as before. Falloff
  // offset/rotation/scale fold into the layer's own translate/rotate/scale so
  // the rotation+scale pivot stays the layer center.
  for (const c of expandClones(layer.cloner, W / H)) {
    const lx = layer.x + c.dx
    const ly = layer.y + c.dy
    const lrot = layer.rotation + c.drot
    const lop = baseOpacity * c.dopacity
    const ls = c.dscale

    // Effected path: render the layer to an offscreen at canvas size, then
    // composite it with inner shadow / drop shadow / blur. Works identically for
    // text, shapes, vectors and images, and because bakeOverlay() renders through
    // here the effects are baked into generation exactly as previewed.
    if (shadow || blur || inner || chain.length) {
      const off = document.createElement('canvas')
      off.width = Math.max(1, Math.round(W))
      off.height = Math.max(1, Math.round(H))
      const octx = off.getContext('2d')
      if (octx) {
        // This offscreen's raw pixel space IS frame-pixel space 1:1 (off is sized
        // exactly W×H, no dpr) — capture it as the frame base BEFORE the shape's own
        // local transform below, so a frame-anchored fill painted on `octx` samples
        // the shared field at the correct frame-space location (see resolveShaderFill).
        _fieldCtx = { ..._fieldCtx, base: octx.getTransform() }
        applyXform(octx, lx, ly, lrot, ls)
        drawContent(octx)
        if (inner) compositeInnerShadow(off, inner, W)
        if (chain.length) applyEffectChain(off, chain, { W })
        ctx.save()
        ctx.globalAlpha = lop
        ctx.globalCompositeOperation = blendOp
        if (blur) ctx.filter = `blur(${Math.max(0, blur.radius * W)}px)`
        if (shadow) {
          ctx.shadowColor = shadow.color
          ctx.shadowBlur = Math.max(0, shadow.blur * W)
          ctx.shadowOffsetX = shadow.x * W
          ctx.shadowOffsetY = shadow.y * W
        }
        ctx.drawImage(off, 0, 0)
        ctx.restore()
        continue
      }
    }

    // Fast path (no effects): draw inline. No skew/cornerPin ⇒ identical to before.
    ctx.save()
    ctx.globalAlpha = lop
    ctx.globalCompositeOperation = blendOp
    _fieldCtx = { ..._fieldCtx, base: ctx.getTransform() } // frame base, before this shape's own transform
    applyXform(ctx, lx, ly, lrot, ls)
    drawContent(ctx)
    ctx.restore()
  }
}

// Per-kind shape rendering. Caller has already applied opacity + the layer's
// translate/rotate to `ctx`; here we just paint the geometry at the origin.
function drawLayerContent(ctx: CanvasRenderingContext2D, layer: LocalLayer, W: number) {
  if (layer.kind === 'text') {
    drawText(ctx, layer, W)
  } else if (layer.kind === 'rect') {
    const w = layer.w * W, h = layer.h * W
    const r = Math.max(0, Math.min(layer.radius * W, Math.min(w, h) / 2))
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, r)
    if (hasPaint(layer.fill)) { ctx.fillStyle = resolvePaint(ctx, layer.fill, { w, h }, _fieldCtx); ctx.fill() }
    if (hasPaint(layer.stroke) && layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth * W; ctx.strokeStyle = resolvePaint(ctx, layer.stroke, { w, h }, _fieldCtx); ctx.stroke()
    }
  } else if (layer.kind === 'ellipse') {
    const w = layer.w * W, h = layer.h * W
    ctx.beginPath()
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
    if (hasPaint(layer.fill)) { ctx.fillStyle = resolvePaint(ctx, layer.fill, { w, h }, _fieldCtx); ctx.fill() }
    if (hasPaint(layer.stroke) && layer.strokeWidth > 0) {
      ctx.lineWidth = layer.strokeWidth * W; ctx.strokeStyle = resolvePaint(ctx, layer.stroke, { w, h }, _fieldCtx); ctx.stroke()
    }
  } else if (layer.kind === 'path') {
    drawPath(ctx, layer, W)
  } else if (layer.kind === 'polygon' || layer.kind === 'star') {
    const d = layer.kind === 'polygon'
      ? polygonPathData(layer.sides, layer.w, layer.h, layer.cornerRadius)
      : starPathData(layer.points, layer.innerRatio, layer.w, layer.h, layer.cornerRadius)
    if (d) {
      drawPath(ctx, {
        ...layer, kind: 'path', d, bbox: { w: layer.w, h: layer.h }, scale: 1, fillRule: 'nonzero',
        fill: layer.fill, stroke: layer.stroke, strokeWidth: layer.strokeWidth,
      } as any, W)
    }
  } else if (layer.kind === 'line') {
    const w = layer.w * W
    ctx.beginPath()
    ctx.moveTo(-w / 2, 0)
    ctx.lineTo(w / 2, 0)
    ctx.lineCap = 'round'
    ctx.lineWidth = Math.max(1, layer.strokeWidth * W)
    ctx.strokeStyle = hasPaint(layer.stroke) ? resolvePaint(ctx, layer.stroke, { w, h: Math.max(layer.strokeWidth * W, 1) }, _fieldCtx) : '#ffffff'
    ctx.stroke()
  } else if (layer.kind === 'image') {
    const w = layer.w * W, h = layer.h * W
    const img = _imageCache.get(imageLayerUrl(layer.filename))
    if (img && img.complete && img.naturalWidth) {
      if (hasPaint(layer.tint)) drawTintedImage(ctx, img, layer, w, h)
      else ctx.drawImage(img, -w / 2, -h / 2, w, h)
    } else {
      // Not loaded yet — faint placeholder; a preload + re-render fills it in.
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(-w / 2, -h / 2, w, h)
    }
  } else if (layer.kind === 'brush') {
    if (!layer.strokes.length) return
    // Size the offscreen to the painted BOUNDS (a tight box), not the whole artboard,
    // so the layer's box/selection hug the marks. Strokes are width-normalized; shift
    // the offscreen so the bounds' top-left maps to (0,0). Rasterize at DEVICE
    // resolution (dpr) so the committed layer stays crisp on retina — `ctx` is
    // DPR-scaled, so the final drawImage at LOGICAL size renders the hi-res offscreen 1:1.
    const b = strokeBounds(layer.strokes)
    const w = Math.max(1, Math.round((b.maxX - b.minX) * W))
    const h = Math.max(1, Math.round((b.maxY - b.minY) * W))
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
    const dw = Math.max(1, Math.round(w * dpr))
    const dh = Math.max(1, Math.round(h * dpr))
    const off = document.createElement('canvas'); off.width = dw; off.height = dh
    const octx = off.getContext('2d'); if (!octx) return
    octx.save()
    octx.translate(-b.minX * W * dpr, -b.minY * W * dpr) // bounds' top-left → offscreen origin
    stampStrokes(octx, layer.strokes, W * dpr)           // base = artboard-width scale
    octx.restore()
    if (hasPaint(layer.fill)) {
      octx.save()
      octx.translate(dw / 2, dh / 2)             // center so resolvePaint's gradient/pattern lines up
      octx.globalCompositeOperation = 'source-in' // keep fill only where strokes painted
      // Brush's inner offscreen is bounds-cropped + dpr-scaled, NOT a plain copy of
      // frame-pixel space like the other primitives' offscreens are (see the capture
      // points in paintLayer above) — so a frame-anchored fill needs its OWN frame
      // base, computed directly from the same bounds/dpr/W used to build `off` above,
      // rather than inheriting whatever the outer shape transform last captured.
      const prevFieldBase = _fieldCtx.base
      if (typeof DOMMatrix !== 'undefined' && isFill(layer.fill) && fillIsShader(layer.fill) && layer.fill.shader.anchor === 'frame') {
        _fieldCtx = { ..._fieldCtx, base: new DOMMatrix().translateSelf(-b.minX * W * dpr, -b.minY * W * dpr).scaleSelf(dpr) }
      }
      octx.fillStyle = resolvePaint(octx, layer.fill, { w: dw, h: dh }, _fieldCtx)
      _fieldCtx = { ..._fieldCtx, base: prevFieldBase }
      octx.fillRect(-dw / 2, -dh / 2, dw, dh)
      octx.restore()
    }
    // Centered at the layer origin, which the caller placed at the bounds' centre.
    ctx.drawImage(off, -w / 2, -h / 2, w, h)
  }
}

function drawText(ctx: CanvasRenderingContext2D, layer: TextLayer, W: number) {
  const lineH = layer.fontSize * W * layer.lineHeight
  if (layer.expressive) { drawExpressiveText(ctx, layer, W, lineH); return }
  const lines = wrappedTextLines(ctx, layer, W)
  applyFont(ctx, layer, W)
  ctx.textBaseline = 'middle'
  // 'justify' isn't a canvas textAlign — draw its words manually, left-anchored.
  const canvasAlign = layer.align === 'justify' ? 'left' : layer.align
  ctx.textAlign = canvasAlign
  // Alignment anchors against the text box when one is set, else the widest line.
  let blockW: number
  if ((layer.boxW ?? 0) > 0) {
    blockW = layer.boxW! * W
  } else {
    blockW = 0
    for (const ln of lines) blockW = Math.max(blockW, ctx.measureText(ln || ' ').width)
  }
  const anchorX = canvasAlign === 'left' ? -blockW / 2 : canvasAlign === 'right' ? blockW / 2 : 0
  const totalH = lines.length * lineH
  // Horizontal justify needs a real box width to fill (nothing to justify to
  // otherwise); vertical position honours valign within the height box (boxH),
  // falling back to the legacy centred block when neither valign nor boxH set.
  const justifyH = layer.align === 'justify' && (layer.boxW ?? 0) > 0
  const boxHpx = (layer.boxH ?? 0) * W
  const va = layer.valign
  const startY = -totalH / 2 + lineH / 2          // legacy: block centred on origin
  const H = boxHpx > 0 ? boxHpx : totalH
  const vJustify = va === 'justify' && lines.length > 1
  const lineY = (i: number): number => {
    if (!va && boxHpx <= 0) return startY + i * lineH
    if (vJustify) return -H / 2 + lineH / 2 + (i / (lines.length - 1)) * (H - lineH)
    const s = va === 'top' ? -H / 2 + lineH / 2 : va === 'bottom' ? H / 2 - totalH + lineH / 2 : startY
    return s + i * lineH
  }
  const textBox = { w: Math.max(blockW, 1), h: Math.max(H, 1) }
  const stroke = hasPaint(layer.strokeColor) && layer.strokeWidth > 0
  if (stroke) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = layer.strokeWidth * W
    ctx.strokeStyle = resolvePaint(ctx, layer.strokeColor, textBox, _fieldCtx)
  }
  ctx.fillStyle = resolvePaint(ctx, layer.color, textBox, _fieldCtx)
  const fontPx = layer.fontSize * W
  const deco = layer.underline || layer.strikethrough
  const decoThick = Math.max(1, fontPx * 0.06)
  for (let i = 0; i < lines.length; i++) {
    const y = lineY(i)
    if (justifyH) {
      // Distribute the line's words edge-to-edge across blockW (last line too —
      // expressive/box justify has no ragged-last-line concept).
      const words = (lines[i] || '').split(/\s+/).filter(Boolean)
      const widths = words.map(w => ctx.measureText(w).width)
      const total = widths.reduce((a, b) => a + b, 0)
      const gap = words.length > 1 ? Math.max(0, (blockW - total) / (words.length - 1)) : 0
      let cx = -blockW / 2
      for (let k = 0; k < words.length; k++) {
        if (stroke) ctx.strokeText(words[k]!, cx, y)
        ctx.fillText(words[k]!, cx, y)
        cx += widths[k]! + gap
      }
      if (deco && words.length) {
        if (layer.underline) ctx.fillRect(-blockW / 2, y + fontPx * 0.34, blockW, decoThick)
        if (layer.strikethrough) ctx.fillRect(-blockW / 2, y - decoThick / 2, blockW, decoThick)
      }
      continue
    }
    if (stroke) ctx.strokeText(lines[i], anchorX, y)
    ctx.fillText(lines[i], anchorX, y)
    // Decoration lines span the drawn line, anchored to match the text alignment.
    // Drawn in the text's own fill so they inherit gradient/pattern fills.
    if (deco && lines[i]) {
      const lw = ctx.measureText(lines[i]).width
      const left = canvasAlign === 'left' ? anchorX : canvasAlign === 'right' ? anchorX - lw : anchorX - lw / 2
      if (layer.underline) ctx.fillRect(left, y + fontPx * 0.34, lw, decoThick)
      if (layer.strikethrough) ctx.fillRect(left, y - decoThick / 2, lw, decoThick)
    }
  }
}

/**
 * Expressive text: each word placed by the shared layout engine (overrides the
 * flow `align`). The block is centered on origin exactly like `drawText`, but we
 * position every word individually with a left anchor and the middle baseline.
 * Horizontal bound = the text box if set, else the widest natural line.
 */
function drawExpressiveText(ctx: CanvasRenderingContext2D, layer: TextLayer, W: number, lineH: number) {
  applyFont(ctx, layer, W)
  const source = transformCase(layer.text ?? '', layer.textTransform)
  let boxWidth = (layer.boxW ?? 0) * W
  if (!(boxWidth > 0)) {
    for (const ln of textLines(layer)) boxWidth = Math.max(boxWidth, ctx.measureText(ln || ' ').width)
    boxWidth = Math.max(boxWidth, 1)
  }
  // Height box (boxH) bounds vertical justify; without it, natural height.
  const boxHeight = (layer.boxH ?? 0) * W || undefined
  const lay = layoutExpressive({
    text: source, boxWidth, boxHeight, lineHeight: lineH,
    measure: (word) => ctx.measureText(word).width,
    params: layer.expressive!,
    justifyX: layer.align === 'justify',
    justifyY: layer.valign === 'justify',
  })
  if (!lay.words.length) return
  const originX = -boxWidth / 2
  const originY = -lay.height / 2
  const textBox = { w: Math.max(boxWidth, 1), h: Math.max(lay.height, 1) }
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  const stroke = hasPaint(layer.strokeColor) && layer.strokeWidth > 0
  if (stroke) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = layer.strokeWidth * W
    ctx.strokeStyle = resolvePaint(ctx, layer.strokeColor, textBox, _fieldCtx)
  }
  ctx.fillStyle = resolvePaint(ctx, layer.color, textBox, _fieldCtx)
  const fontPx = layer.fontSize * W
  const deco = layer.underline || layer.strikethrough
  const decoThick = Math.max(1, fontPx * 0.06)
  for (const wd of lay.words) {
    const x = originX + wd.x
    const y = originY + wd.y + lineH / 2   // band top → line's vertical center
    if (stroke) ctx.strokeText(wd.text, x, y)
    ctx.fillText(wd.text, x, y)
    if (deco && wd.text) {
      if (layer.underline) ctx.fillRect(x, y + fontPx * 0.34, wd.w, decoThick)
      if (layer.strikethrough) ctx.fillRect(x, y - decoThick / 2, wd.w, decoThick)
    }
  }
}

/**
 * Module-cached Path2D per `d` string — building a Path2D parses the path data,
 * which we'd otherwise repeat every animation frame.
 */
const _pathCache = new Map<string, Path2D>()
function path2dFor(d: string): Path2D | null {
  if (!d) return null
  let p = _pathCache.get(d)
  if (!p) {
    try { p = new Path2D(d) } catch { return null }
    if (_pathCache.size > 400) _pathCache.clear()
    _pathCache.set(d, p)
  }
  return p
}

/**
 * Draw a vector path layer. The context is already translated to the layer
 * center and rotated; here we scale into the path's local units (1 unit =
 * canvas width) times the layer's uniform `scale`, then fill/stroke the cached
 * Path2D. Gradients resolve against the un-scaled local bbox.
 */
function drawPath(ctx: CanvasRenderingContext2D, layer: PathLayer, W: number) {
  const p = path2dFor(layer.d)
  if (!p) return
  const s = (layer.scale || 1) * W
  ctx.save()
  ctx.scale(s, s)
  if (hasPaint(layer.fill)) {
    ctx.fillStyle = resolvePaint(ctx, layer.fill, layer.bbox, _fieldCtx)
    ctx.fill(p, layer.fillRule || 'nonzero')
  }
  if (hasPaint(layer.stroke) && layer.strokeWidth > 0) {
    ctx.lineWidth = layer.strokeWidth
    ctx.strokeStyle = resolvePaint(ctx, layer.stroke, layer.bbox, _fieldCtx)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke(p)
  }
  ctx.restore()
}

/** Draw all local layers (bottom→top order = array order). */
// One ordered stack item: a wired image layer (drawn via its own closure) or a
// local layer. The single source of truth for stack rendering — both canvases
// (Frame node, Compositor modal) and the bake go through paintLayerStack, so
// masking/effects can't drift between them (the bug-class this prevents).
export type StackItem =
  | { type: 'wired'; key: string; draw: (ctx: CanvasRenderingContext2D, W: number, H: number) => void }
  | { type: 'local'; key: string; layer: LocalLayer }

// Figma background blur: blur the ALREADY-PAINTED backdrop within the layer's
// silhouette, then the layer paints on top. Operates in device space so it's
// correct under the dpr transform renderers apply to the stack canvas.
function applyBackdropBlur(
  ctx: CanvasRenderingContext2D,
  layer: LocalLayer,
  localLayers: LocalLayer[],
  W: number,
  H: number,
  radius: number,
) {
  if (!(radius > 0)) return
  const t = ctx.getTransform()
  const dev = ctx.canvas
  const mk = () => {
    const c = document.createElement('canvas')
    c.width = dev.width; c.height = dev.height
    return c
  }
  // Silhouette: the layer's own alpha (full opacity, no effects) at device scale.
  const sil = mk()
  const silctx = sil.getContext('2d')
  if (!silctx) return
  silctx.setTransform(t)
  const ghost = { ...layer, opacity: 1, effects: undefined, blend: undefined } as LocalLayer
  const maskRef = layerMaskRef(layer)
  const maskLayer = maskRef?.startsWith('l:')
    ? localLayers.find(l => l.id === maskRef.slice(2)) ?? null
    : null
  drawLocalLayer(silctx, ghost, W, H, maskLayer)
  // Blur the current backdrop, clip to the silhouette, stamp it back.
  const out = mk()
  const octx = out.getContext('2d')
  if (!octx) return
  octx.filter = `blur(${Math.max(0, radius * W * t.a)}px)`
  octx.drawImage(dev, 0, 0)
  octx.filter = 'none'
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(sil, 0, 0)
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(out, 0, 0)
  ctx.restore()
}

// Displacement map: the layer's pixels are NOT drawn — instead they warp the backdrop
// already painted below this layer. Called from paintLayerStack's item loop. `ghost` draws
// a faint preview of the map in the editor so the layer doesn't appear to vanish (never in bake).
function applyDisplaceFromLayer(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer,
  W: number,
  H: number,
  opts?: { ghost?: boolean },
) {
  const spec = layer.displaceMap
  if (!spec) return
  const dev = ctx.canvas
  const w = dev.width, h = dev.height
  if (w < 1 || h < 1) return
  const t = ctx.getTransform()

  // 1. Snapshot the backdrop below this layer (device pixels; getImageData ignores transform).
  const src = ctx.getImageData(0, 0, w, h)

  // 2. Render the map layer (full colour, its transform baked in) to a device-sized offscreen.
  const off = document.createElement('canvas')
  off.width = w; off.height = h
  const octx = off.getContext('2d')
  if (!octx) return
  octx.setTransform(t)
  const mapGhost = { ...layer, opacity: 1, effects: undefined, blend: undefined, displaceMap: undefined } as LocalLayer
  drawLocalLayerSelf(octx, mapGhost, W, H)
  const mapData = octx.getImageData(0, 0, w, h)

  // 3+4. Build the offset field and resample the backdrop. amount is SCREEN px → scale to device.
  const field = buildDisplacementField(mapData.data, w, h, spec, t.a || 1)
  const amountDev = spec.amount * (t.a || 1)
  const outArr = resampleBilinear(src.data, field, amountDev, w, h)

  // 5. Write the warped backdrop back (putImageData is always device-space).
  ctx.putImageData(new ImageData(outArr, w, h), 0, 0)

  // Editor affordance: faint ghost of the map so it's visible/selectable. Never in bake.
  if (opts?.ghost) {
    const g = { ...layer, opacity: 0.14, effects: undefined, blend: undefined, displaceMap: undefined } as LocalLayer
    drawLocalLayerSelf(ctx, g, W, H)
  }
}

/** Every Paint slot a local layer can carry, kind-specific — walked by paintLayerStack's
 *  pre-pass (below) to find shader fills BEFORE anything paints, so beginFieldFrame sees
 *  the same set resolveFill will actually ask for during the pass. */
function layerPaints(layer: LocalLayer): Paint[] {
  switch (layer.kind) {
    case 'text': return [layer.color, layer.strokeColor]
    case 'line': return [layer.stroke]
    case 'image': return layer.tint ? [layer.tint] : []
    case 'brush': return layer.stroke ? [layer.fill, layer.stroke] : [layer.fill]
    default: return [layer.fill, layer.stroke] // rect / ellipse / polygon / star / path
  }
}

/** Whether `items`/`background` currently carry a LIVE shader fill — one whose
 *  `speed !== 0`, and therefore needs a real clock (`t`) to animate at all. A
 *  `speed: 0` fill is deliberately frozen and must NOT count here, or "frozen"
 *  becomes impossible to express: a host that starts a rAF loop whenever any
 *  shader fill exists (animated or not) would spin forever for a still fill.
 *  Pure + host-agnostic on purpose: both the Frame node card and the Compositor
 *  modal use this to decide whether THEY need to own a clock, and a unit test
 *  pins it directly so "does this need a clock" can't silently regress into
 *  waking every Frame on the canvas (see saf-frame-clock-report.md). */
export function hasAnimatedShaderFill(items: StackItem[], background?: Paint): boolean {
  const isLiveShader = (p: Paint | undefined): boolean => isFill(p) && fillIsShader(p) && p.shader.speed !== 0
  if (isLiveShader(background)) return true
  for (const it of items) {
    if (it.type !== 'local') continue
    if (layerPaints(it.layer).some(isLiveShader)) return true
  }
  return false
}

/** Collect a shader-fill Paint into `out` as a FieldRequest, sized EXACTLY the way
 *  resolveShaderFill sizes it at paint time (frame anchor → frame size; object anchor →
 *  the fixed OBJECT_SHADER_FIELD_PX) — see resolveShaderFill's doc for why the two must
 *  agree, and OBJECT_SHADER_FIELD_PX's doc for why object anchor doesn't need the box. */
function addShaderFieldRequest(out: FieldRequest[], paint: Paint | undefined, W: number, H: number, t: number, fps: number, bake: boolean) {
  if (!isFill(paint) || !fillIsShader(paint)) return
  const frame = paint.shader.anchor === 'frame'
  out.push({
    spec: paint.shader,
    w: frame ? Math.max(1, Math.round(W)) : OBJECT_SHADER_FIELD_PX,
    h: frame ? Math.max(1, Math.round(H)) : OBJECT_SHADER_FIELD_PX,
    t, fps, bake,
  })
}

export function paintLayerStack(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  items: StackItem[],
  localLayers: LocalLayer[],
  skip?: (layer: LocalLayer) => boolean,
  t?: number,
  motion?: { fps: number; duration: number },
  /** Per-key treatments for wired layers (mask ref + showSource). Locals carry their own. */
  wiredTreatments?: Record<string, { maskedByKey?: string; showSource?: boolean }>,
  /** Doc-level background fill, painted first (behind every layer). */
  background?: Paint,
  /** Nested-group registry (Task 1). Absent ⇒ no cascade, byte-identical to before. */
  groups?: LayerGroup[],
  /** Doc-level post-processing chain, applied to the finished composite.
   *  Absent/empty ⇒ byte-identical output. */
  post?: PostEffect[],
  /** True for a final export/bake (Render, motion bake, Frame download/publish) —
   *  opts shader-fill fields out of both the 512px live-preview clamp AND
   *  LIVE_FIELD_CEILING (Task 10): a bake has no frame budget, so every distinct
   *  descriptor renders at full resolution and stays live, however many there are.
   *  False (the default) is the live-preview behaviour byte-identical to before this
   *  param existed — every EXISTING positional call site is therefore unaffected;
   *  only export call sites pass `true` explicitly. */
  bake = false,
): { frozenCount: number } {
  const fieldT = t ?? 0, fieldFps = motion?.fps ?? 30
  _fieldCtx = {
    frameW: W, frameH: H, t: fieldT, fps: fieldFps,
    base: typeof ctx.getTransform === 'function' ? ctx.getTransform() : null,
    bake, token: 0,
  }
  // Task 6 / Item 1 (final review): one `withFieldFrame` call per rendered frame, scoped
  // to exactly the shader fills THIS document's layers/background carry this pass — see
  // the doc above resolveShaderFill for why this is the Compositor's own host boundary.
  // `withFieldFrame` owns the begin/end pairing in a try/finally (see its doc in
  // ~/lib/shaderfill/field.ts), so an exception anywhere in the drawing loop below (a
  // broken canvas op, a WebGL hiccup) can no longer leave the module-global field-frame
  // span stuck open and freeze every OTHER host's next frame. paintLayerStack never
  // awaits, so no other host's span can land inside this one either way.
  const shaderRequests: FieldRequest[] = []
  for (const it of items) {
    if (it.type !== 'local') continue
    for (const p of layerPaints(it.layer)) addShaderFieldRequest(shaderRequests, p, W, H, fieldT, fieldFps, bake)
  }
  addShaderFieldRequest(shaderRequests, background, W, H, fieldT, fieldFps, bake)

  // Make a missing clock DETECTABLE instead of silently rendering "frozen at zero"
  // forever — the exact failure mode that shipped Frames looking broken (the caller
  // passed no `t`, `fieldT` defaulted to 0, and a still gradient is indistinguishable
  // from a working-but-idle one). Only warns when a LIVE (`speed !== 0`) shader fill is
  // actually present and `t` itself was omitted — a `speed: 0` fill intentionally wants
  // t=0 and must stay silent. Dev-only: this is a wiring smell for whoever adds the next
  // surface, not a runtime condition to report in production.
  if (import.meta.dev && t === undefined && shaderRequests.some(r => r.spec.speed !== 0)) {
    console.warn(
      '[paintLayerStack] a live shader fill (speed !== 0) was painted with no `t` — it will ' +
      'render frozen at t=0. Pass real elapsed/scrub time as the `t` argument instead of ' +
      'leaving it `undefined`.',
    )
  }

  // Item 2 fix (final review): `_fieldCtx.token` must not outlive this span — the `finally`
  // below resets it to `0` (field.ts's own "no span" sentinel, see its "ACTUAL CURRENT RULE"
  // doc above `resolveField`) once this call returns, whether it threw or not. Before this
  // fix, `_fieldCtx.token` stayed set to the LAST real token forever, so any later call made
  // OUTSIDE this span — CompositorModal's `layerHitAt` → `drawLocalLayer` → `resolveShaderFill`
  // runs on every canvas hit test, never inside a `withFieldFrame` of its own — replayed that
  // now-stale nonzero token against whatever `_liveKeysToken` a completely unrelated host's
  // rAF loop had since advanced to, logging a HOST-ISOLATION violation on every click that
  // never actually happened.
  try {
    return withFieldFrame(shaderRequests, (frozenCount, token) => {
      _fieldCtx.token = token   // resolveShaderFill reads this to pass into every resolveField call

    // Background fill — the bottom-most thing in the frame, baked into output.
    if (hasPaint(background)) {
      ctx.save()
      _fieldCtx = { ..._fieldCtx, base: ctx.getTransform() } // frame base, before the center translate below
      ctx.translate(W / 2, H / 2) // center so gradient/pattern geometry spans the canvas
      ctx.fillStyle = resolvePaint(ctx, background!, { w: W, h: H }, _fieldCtx)
      ctx.fillRect(-W / 2, -H / 2, W, H)
      ctx.restore()
    }

    const byKey = new Map(items.map(it => [it.key, it]))
    // Resolve every item's mask reference (local → layerMaskRef; wired → treatments).
    const maskRefOf = (it: StackItem): string | undefined =>
      it.type === 'local' ? layerMaskRef(it.layer) : wiredTreatments?.[it.key]?.maskedByKey
    // Whether an item requests that its mask source remains visible at its own z-position.
    const showSourceOf = (it: StackItem): boolean =>
      it.type === 'local' ? !!it.layer.maskShowSource : !!wiredTreatments?.[it.key]?.showSource
    // Keys used as a mask source by someone → those items only clip, never self-paint
    // (unless the masked item sets showSource, in which case the source also renders normally).
    const maskSourceKeys = new Set<string>()
    const keepVisibleKeys = new Set<string>()
    for (const it of items) {
      const r = maskRefOf(it)
      if (r) {
        maskSourceKeys.add(r)
        if (showSourceOf(it)) keepVisibleKeys.add(r)
      }
    }

    for (const item of items) {
      if (maskSourceKeys.has(item.key) && !keepVisibleKeys.has(item.key)) continue

      if (item.type === 'wired') {
        const ref = maskRefOf(item)
        const maskItem = ref ? byKey.get(ref) ?? null : null
        if (maskItem) { drawItemMasked(ctx, item, maskItem, W, H, 'source-over'); continue }
        item.draw(ctx, W, H)
        continue
      }

      const layer = item.layer
      // Nested-group cascade (Task 1): absent `groups` ⇒ gc stays null ⇒ opacityMul
      // defaults to 1 everywhere below, byte-identical to pre-cascade behavior.
      const gc = groups ? resolveGroupCascade(layer.groupId, groups) : null
      if (layerHidden(layer) || gc?.hidden) continue
      if (skip?.(layer)) continue

      // Displacement map: consume this image layer as a lens over everything below.
      // Placed before mask/blend/motion — a map layer ignores all of those.
      if (layer.kind === 'image' && (layer as ImageLayer).displaceMap) {
        applyDisplaceFromLayer(ctx, layer as ImageLayer, W, H, { ghost: !bake })
        continue
      }

      const opacityMul = gc ? gc.opacity : 1

      const ref = layerMaskRef(layer)
      const maskItem = ref ? byKey.get(ref) ?? null : null
      const motionActive = t !== undefined && motion && _motionPainterImpl
        && (layer.animation || (maskItem?.type === 'local' && maskItem.layer.animation))
      if (motionActive) {
        const { motionStateFor, drawLayerWithMotion, identityState } = _motionPainterImpl!
        const st = layer.animation ? motionStateFor(layer, t!, motion!) : identityState()
        if (st) {
          if (!st.visible) continue
          // Phase-1 limitation: the motion path only carries a LOCAL mask. An
          // animated local layer masked by a WIRED silhouette renders unmasked for
          // that frame (the static path below handles wired-masks-local correctly).
          const maskLocal = maskItem?.type === 'local' ? maskItem.layer : null
          const maskState = maskLocal?.animation ? motionStateFor(maskLocal, t!, motion!) : null
          if (maskState && !maskState.visible) continue
          const bgBlur = layer.effects?.find(
            (e): e is BackgroundBlurEffect => e.type === 'background_blur' && e.visible,
          )
          if (bgBlur) applyBackdropBlur(ctx, layer, localLayers, W, H, bgBlur.radius)
          // Group-cascade limitation (Task 3, mirrors the mask limitation above): the
          // motion path composes its own effective layer in lib/motion/paint.ts and
          // doesn't thread an opacityMul through, so an animated layer's group cascade
          // opacity isn't applied for that frame. Visibility (gc.hidden) IS honored via
          // the `continue` above. Static (non-animated) layers are unaffected.
          drawLayerWithMotion(ctx, layer, W, H, maskLocal, st, maskState)
          continue
        }
      }
      const bgBlur = layer.effects?.find(
        (e): e is BackgroundBlurEffect => e.type === 'background_blur' && e.visible,
      )
      if (bgBlur) applyBackdropBlur(ctx, layer, localLayers, W, H, bgBlur.radius)

      if (maskItem && maskItem.type !== 'local') {
        // Wired silhouette masking a local layer → generic cross-source path.
        drawItemMasked(ctx, item, maskItem, W, H, localBlendOp(layer), opacityMul)
      } else {
        // Local content + local mask (or no mask) → unchanged fast path.
        drawLocalLayer(ctx, layer, W, H, maskItem?.type === 'local' ? maskItem.layer : null, opacityMul)
      }
    }

    if (post && chainActive(post)) applyStackPost(ctx, post, W)
    return { frozenCount }
    })
  } finally {
    _fieldCtx.token = 0
  }
}

/**
 * Render an item's REAL content onto `ctx` (wired image via its draw closure,
 * which folds the wired layer's own opacity/blend; local via `drawLocalLayerSelf`,
 * which includes the layer's crop). NOT a silhouette — full pixels/opacity/effects
 * preserved. Wired closures are wrapped in save/restore (no state-hygiene contract).
 */
function drawItemContent(ctx: CanvasRenderingContext2D, item: StackItem, W: number, H: number, opacityMul = 1) {
  if (item.type === 'wired') { ctx.save(); item.draw(ctx, W, H); ctx.restore(); return }
  drawLocalLayerSelf(ctx, item.layer, W, H, opacityMul)
}

/**
 * Draw `content` clipped to `mask`'s alpha, then stamp onto `ctx` with `blendOp`.
 * Both render their REAL paint on separate offscreens (mirrors the original
 * drawLocalLayer path), then destination-in keeps only where the mask is opaque.
 * Phase-1 limitation: a WIRED content layer's non-normal blend is folded inside
 * its draw closure against the transparent offscreen, so it's effectively lost
 * while masked — callers pass 'source-over' for wired content. Local content
 * stamps with its own blend, re-applied here against the real backdrop as before.
 */
function drawItemMasked(
  ctx: CanvasRenderingContext2D,
  content: StackItem,
  mask: StackItem,
  W: number,
  H: number,
  blendOp: string,
  opacityMul = 1,
) {
  // Device-resolution offscreens rendered through the current transform, so a
  // masked layer stays sharp under any ctx scale (dpr preview / high-res export).
  // Logical W×H offscreens would composite at preview res and upscale → blur.
  const t = ctx.getTransform()
  const dev = ctx.canvas
  const mk = () => {
    const c = document.createElement('canvas')
    c.width = Math.max(1, dev.width); c.height = Math.max(1, dev.height)
    return c
  }
  const off = mk()
  const octx = off.getContext('2d'); if (!octx) return
  octx.setTransform(t)
  drawItemContent(octx, content, W, H, opacityMul)
  const maskOff = mk()
  const mctx = maskOff.getContext('2d'); if (!mctx) return
  mctx.setTransform(t)
  drawItemContent(mctx, mask, W, H)
  octx.setTransform(1, 0, 0, 1, 0, 0) // composite in device space
  octx.globalCompositeOperation = 'destination-in'
  octx.drawImage(maskOff, 0, 0)
  octx.globalCompositeOperation = 'source-over'
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0) // device-space stamp
  ctx.globalCompositeOperation = blendOp as GlobalCompositeOperation
  ctx.drawImage(off, 0, 0)
  ctx.restore()
}

export function drawLocalLayers(
  ctx: CanvasRenderingContext2D,
  layers: LocalLayer[],
  W: number,
  H: number,
  bake = false,
) {
  paintLayerStack(ctx, W, H, layers.map(l => ({ type: 'local' as const, key: `l:${l.id}`, layer: l })), layers,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, bake)
}

/** Blend-mode name → canvas composite op (shared by node + modal wired draws). */
export const WIRED_BLEND_OP: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  soft_light: 'soft-light', hard_light: 'hard-light', difference: 'difference',
  lighten: 'lighten', darken: 'darken', add: 'lighter',
}

/** Transform of a wired image layer (normalized x/y, scale, rotation, blend). */
export interface WiredTransform {
  x: number; y: number; scale: number; rotation: number; opacity: number; blend: string
  cloner?: Cloner // linked cloner — stamp the layer N times (see useCloner)
}

/**
 * Draw one wired image layer — the SINGLE source of truth shared by the Frame
 * node and the Compositor modal so their previews can't drift apart. The image
 * is aspect-fit (contain) into the W×H artboard, then translated by the layer's
 * normalized x/y, rotated, and scaled. Fit is computed from the *actual* image
 * (not a separately-tracked dimension cache), so it never falls back to a
 * stretch-fill when a cache entry is missing.
 */
export function drawWiredImageLayer(
  ctx: CanvasRenderingContext2D,
  // Accepts a canvas too: a live studio slot supplies its frame as a canvas, which
  // has width/height but no naturalWidth/complete. Image behaviour is unchanged.
  img: HTMLImageElement | HTMLCanvasElement | undefined | null,
  layer: WiredTransform,
  W: number,
  H: number,
  maskImg?: HTMLImageElement | HTMLCanvasElement | null,   // white = hidden, image pixel space
  // Depth of field, matching what a local image layer gets. A wired image and an
  // uploaded one must expose the same features — a gap between them reads as a bug.
  dof?: DofEffect | null,
  depthImg?: CanvasImageSource | null,
) {
  if (!img) return
  const iw = 'naturalWidth' in img ? img.naturalWidth : img.width
  const ih = 'naturalHeight' in img ? img.naturalHeight : img.height
  if (!iw || !ih) return
  if ('complete' in img && !img.complete) return   // undecoded <img> — skip, as before
  // Apply the per-slot visibility mask ONCE (destination-out by the mask's alpha),
  // then the cloner loop draws the masked pixels exactly as it drew the plain image.
  let src: HTMLImageElement | HTMLCanvasElement = img
  const mReady = maskImg && (!('complete' in maskImg) || maskImg.complete)
    && (('naturalWidth' in maskImg ? maskImg.naturalWidth : maskImg.width) > 0)
  if (mReady) {
    const off = document.createElement('canvas'); off.width = iw; off.height = ih
    const octx = off.getContext('2d')
    if (octx) {
      octx.drawImage(img, 0, 0, iw, ih)
      octx.globalCompositeOperation = 'destination-out'
      octx.drawImage(maskImg as CanvasImageSource, 0, 0, iw, ih)
      src = off
    }
  }
  const cAspect = W / H, iAspect = iw / ih
  let fitW: number, fitH: number
  if (iAspect > cAspect) { fitW = W; fitH = W / iAspect } else { fitH = H; fitW = H * iAspect }

  // Defocus runs on the masked source, before the cloner stamps it — so every clone
  // shows the same blur and the GPU pass runs once. Needs fitW, hence its position
  // here: the pass renders at native size but must normalize by the ON-CANVAS width,
  // or the blur would track the source file's resolution rather than what you see.
  if (dof && depthImg && dofAvailable() && dofShouldRun(dof, true)) {
    const out = applyDof(src, depthImg, dof, W, iw, ih, fitW * layer.scale)
    if (out) {
      // Copy out of the pass's canvas — it is reused between calls, so holding the
      // reference would alias once a second DOF layer rendered.
      const owned = document.createElement('canvas'); owned.width = iw; owned.height = ih
      owned.getContext('2d')?.drawImage(out, 0, 0)
      src = owned
    }
  }

  const op = WIRED_BLEND_OP[layer.blend] ?? 'source-over'
  // Linked cloner: stamp the layer once per clone (back-to-front; original last).
  // No cloner ⇒ a single identity transform ⇒ exactly one draw as before.
  for (const c of expandClones(layer.cloner, W / H)) {
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity * c.dopacity))
    ctx.globalCompositeOperation = op
    ctx.translate(W / 2 + (layer.x + c.dx) * W, H / 2 + (layer.y + c.dy) * H)
    const rot = layer.rotation + c.drot
    if (rot) ctx.rotate((rot * Math.PI) / 180)
    ctx.scale(layer.scale * c.dscale, layer.scale * c.dscale)
    ctx.drawImage(src, -fitW / 2, -fitH / 2, fitW, fitH)
    ctx.restore()
  }
}

/**
 * Bake local layers into a transparent RGBA PNG blob at W×H. Returns null if
 * there are no layers. Fonts must already be loaded (call `ensureLayerFonts`).
 */
export function bakeOverlay(layers: LocalLayer[], W: number, H: number): Promise<Blob | null> {
  if (!layers.length) return Promise.resolve(null)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(W))
  canvas.height = Math.max(1, Math.round(H))
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, canvas.width, canvas.height) // stay transparent
  drawLocalLayers(ctx, layers, canvas.width, canvas.height, true) // export/bake: unclamped shader fields
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

/**
 * Ensure every text layer's font face is loaded so canvas text renders with the
 * real glyphs instead of a fallback. Resolves once all are ready (or timed out).
 */
export async function ensureLayerFonts(layers: LocalLayer[], W: number): Promise<void> {
  if (typeof document === 'undefined' || !(document as any).fonts) return
  const jobs: Promise<unknown>[] = []
  for (const layer of layers) {
    if (layer.kind !== 'text') continue
    const spec = `${layer.fontWeight} ${Math.max(8, layer.fontSize * W)}px ${cssFontStack(layer.fontFamily)}`
    try { jobs.push((document as any).fonts.load(spec)) } catch { /* ignore */ }
  }
  if (jobs.length) await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 1500))])
}
