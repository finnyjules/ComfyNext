/**
 * geoshape arrange — computes one placement per clone from a GeoShapeConfig.
 *
 * Dependency-light on purpose, same posture as `config.ts`: no `three`/`paper`
 * imports, just arithmetic. Callers turn each ClonePlacement into a paper
 * `Matrix` (translate + rotate + scale + skew) when rendering.
 */
import type { GeoShapeConfig } from './config'

export interface ClonePlacement {
  x: number
  y: number
  scale: number
  rotate: number
  skew: number
}

const DEG2RAD = Math.PI / 180

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** i/(count-1) guarded against divide-by-zero when count is 1. */
function rampT(i: number, count: number): number {
  return count > 1 ? i / (count - 1) : 0
}

export function arrange(cfg: GeoShapeConfig): ClonePlacement[] {
  const count = Math.max(1, Math.floor(cfg.count))

  if (cfg.layout === 'grid') {
    const cols = Math.max(1, Math.floor(cfg.gridCols))
    const rows = Math.max(1, Math.floor(cfg.gridRows))
    const total = cols * rows
    const placements: ClonePlacement[] = []
    for (let i = 0; i < total; i++) {
      const cx = i % cols
      const cy = Math.floor(i / cols)
      const t = rampT(i, total)
      placements.push({
        x: (cx - (cols - 1) / 2) * cfg.spacing,
        y: (cy - (rows - 1) / 2) * cfg.spacing,
        scale: lerp(cfg.scaleStart, cfg.scaleEnd, t),
        rotate: cfg.rotateBase + i * cfg.rotateStep,
        skew: cfg.skew,
      })
    }
    return placements
  }

  if (cfg.layout === 'linear') {
    const placements: ClonePlacement[] = []
    for (let i = 0; i < count; i++) {
      const t = rampT(i, count)
      placements.push({
        x: (i - (count - 1) / 2) * cfg.spacing,
        y: 0,
        scale: lerp(cfg.scaleStart, cfg.scaleEnd, t),
        rotate: cfg.rotateBase + i * cfg.rotateStep,
        skew: cfg.skew,
      })
    }
    return placements
  }

  // radial (default). `evenAngle` (default) spreads the clones evenly around the
  // full circle (360/count) so ANY count forms a clean ring; turning it off uses
  // the raw `angleStep` per clone (for fans/spirals that wrap deliberately).
  const step = cfg.evenAngle ? 360 / count : cfg.angleStep
  const placements: ClonePlacement[] = []
  for (let i = 0; i < count; i++) {
    const angle = (cfg.spin + i * step) * DEG2RAD
    const t = rampT(i, count)
    placements.push({
      x: cfg.radius * Math.cos(angle),
      y: cfg.radius * Math.sin(angle),
      scale: lerp(cfg.scaleStart, cfg.scaleEnd, t),
      rotate: cfg.rotateBase + i * cfg.rotateStep,
      skew: cfg.skew,
    })
  }
  return placements
}
