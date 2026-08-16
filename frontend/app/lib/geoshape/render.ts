/**
 * geoshape render orchestration — the ONE pipeline that turns a
 * `GeoShapeConfig` into `VectorShape[]`, an SVG string, or pixels on a
 * canvas.
 *
 * `renderShapes` is the pipeline every consumer (preview, bake, SVG export)
 * must go through, for the same reason `vectortype/render.ts`'s header gives:
 * three surfaces each growing their own copy of "shape -> geometry" is drift
 * that no single render can reveal.
 *
 * `baseShapePath` (Task 1) -> `arrange` (Task 3) -> `resolvePaint` (Task 5,
 * applies `invert`'s colour swap) -> `composite` (Task 4, folds the placed
 * clones and paints with the RESOLVED colours). `resolvePaint` is called here
 * rather than inside `composite` because `composite` already reads its paint
 * straight off `cfg.fill`/`cfg.stroke`/`cfg.overlapFill` — this is the one
 * seam where the config handed to it is the POST-invert config, not the raw
 * one a caller stored.
 *
 * Only the colour-swap form of `invert` is applied. A geometric knockout
 * (e.g. painting the negative space of the mark against a filled background)
 * is a different feature — `paint.ts`'s header already scopes it out for the
 * identical reason — and is left for a future task.
 */
import type { VectorShape } from '~/lib/vector/svg'
import { commandsToPathData, shapesToSVG, isVectorGradient, isVectorPattern, type SvgDocOptions } from '~/lib/vector/svg'
import { baseShapePath } from './shapes'
import { arrange } from './arrange'
import { composite } from './boolean'
import { resolvePaint } from './paint'
import type { GeoShapeConfig } from './config'

/**
 * `GeoShapeConfig` -> the final composed mark, as paintable `VectorShape[]`
 * in document space (origin-centred, same convention `composite` already
 * builds in — see `boolean.ts`'s header).
 */
export async function renderShapes(cfg: GeoShapeConfig): Promise<VectorShape[]> {
  const baseD = baseShapePath(cfg.shape, {
    sides: cfg.sides,
    starInner: cfg.starInner,
    irregularSeed: cfg.irregularSeed,
    size: cfg.size,
    roundCorners: cfg.roundCorners,
    roundRadius: cfg.roundRadius,
  })
  const placements = arrange(cfg)
  const rp = resolvePaint(cfg)
  // The post-invert config `composite` actually paints with — it reads fill/
  // stroke/overlapFill straight off whatever `cfg` it is handed, so this is
  // the one place `invert` takes effect.
  const cfg2: GeoShapeConfig = { ...cfg, fill: rp.fill, stroke: rp.stroke, overlapFill: rp.overlapFill }
  return composite(baseD, placements, cfg2)
}

/**
 * `GeoShapeConfig` -> a standalone SVG document, `size + padding*2` square.
 *
 * The composed mark is origin-centred (paper's coordinates run through
 * `composite` untranslated), so the viewBox is centred on the origin too —
 * `[-w/2, -h/2, w, h]` — rather than the spine's own `[0,0,w,h]` default,
 * which would crop the negative half of every shape clean off the canvas.
 */
export async function toSvg(cfg: GeoShapeConfig, opts: Partial<SvgDocOptions> = {}): Promise<string> {
  const shapes = await renderShapes(cfg)
  const w = cfg.size + cfg.padding * 2
  const h = cfg.size + cfg.padding * 2
  return shapesToSVG(shapes, {
    width: w,
    height: h,
    viewBox: [-w / 2, -h / 2, w, h],
    ...opts,
  })
}

/** A fallback colour for a fill this canvas path cannot resolve (a gradient
 *  or pattern paint server): a full gradient-on-canvas replay is optional and
 *  out of scope here — see the module header. Mid-gray reads as "there is a
 *  fill here" without claiming to be the real one. */
const FALLBACK_FILL = '#808080'

/** Resolve one `VectorShape`'s fill to a `ctx.fillStyle`-able string: a solid
 *  string passes straight through; a gradient's first stop is used as a cheap
 *  stand-in; a pattern (no single representative colour) falls back to the
 *  same mid-gray a gradient without stops would. */
function canvasFillStyle(fill: VectorShape['fill']): string | null {
  if (fill === null || fill === undefined) return null
  if (typeof fill === 'string') return fill
  if (isVectorGradient(fill)) return fill.stops[0]?.color ?? FALLBACK_FILL
  if (isVectorPattern(fill)) return FALLBACK_FILL
  return FALLBACK_FILL
}

/**
 * Paint `shapes` onto a 2D canvas context, centred at `(w/2, h/2)` — the
 * shapes are origin-centred document-space geometry, so this is the one
 * translate that puts the mark in the middle of the box instead of with its
 * origin pinned at the canvas's own top-left corner.
 *
 * Used by both the live preview and the bake path, so there is one canvas
 * replay of this geometry, matching `toSvg`'s one SVG replay.
 */
export function drawToCanvas(shapes: VectorShape[], ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save()
  ctx.translate(w / 2, h / 2)
  for (const s of shapes) {
    const path = new Path2D(commandsToPathData(s.commands))
    const fillStyle = canvasFillStyle(s.fill)
    if (fillStyle) {
      ctx.fillStyle = fillStyle
      ctx.fill(path, s.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')
    }
    if (s.stroke) {
      ctx.strokeStyle = s.stroke
      ctx.lineWidth = s.strokeWidth ?? 1
      ctx.stroke(path)
    }
  }
  ctx.restore()
}
