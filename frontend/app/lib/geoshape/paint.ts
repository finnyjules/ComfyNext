/**
 * geologo paint resolution — normalizes the config's paint fields into what
 * the render stage (Task 6) consumes.
 *
 * `mergeConfig` (config.ts) already fully validates `fill` / `stroke` /
 * `overlapFill`, so this stage is deliberately thin: it only applies the
 * `invert` semantic on top of already-valid paints.
 *
 * invert semantics (kept simple + testable — a "swap the two colors" move,
 * not a real render-time knockout):
 *   - invert:false — fill/stroke/overlapFill pass straight through.
 *   - invert:true, solid fill (string) — fill becomes the old stroke (or a
 *     sensible default '#ffffff' when stroke is null), and stroke becomes
 *     the old fill.
 *   - invert:true, gradient/pattern fill — a gradient/pattern can't become a
 *     solid stroke, so this degrades gracefully: fill is left intact and
 *     stroke is left untouched. There is nothing sensible to swap.
 *
 * A fuller "knockout on a filled background" inversion (e.g. painting the
 * negative space, not just recoloring) is a render-stage concern for
 * Task 6 — this stage only resolves colors.
 */
import type { VectorPaint } from '~/lib/vector/svg'
import type { GeoShapeConfig } from './config'

export interface ResolvedPaint {
  fill: VectorPaint
  stroke: string | null
  overlapFill: VectorPaint
  invert: boolean
}

export function resolvePaint(cfg: GeoShapeConfig): ResolvedPaint {
  if (!cfg.invert) {
    return { fill: cfg.fill, stroke: cfg.stroke, overlapFill: cfg.overlapFill, invert: cfg.invert }
  }

  // Only a solid (string) fill has a sensible fill<->stroke swap. Gradients
  // and patterns degrade gracefully: keep the fill as-is.
  if (typeof cfg.fill === 'string') {
    return {
      fill: cfg.stroke ?? '#ffffff',
      stroke: cfg.fill,
      overlapFill: cfg.overlapFill,
      invert: cfg.invert,
    }
  }

  return { fill: cfg.fill, stroke: cfg.stroke, overlapFill: cfg.overlapFill, invert: cfg.invert }
}
