import { makeRng } from './rng'
import type { ShapeConfig } from './config'

/**
 * A seeded point cloud for Gem mode. Points are drawn in a unit-ish ball, biased by
 * `spread` (tight → wide) and stretched along Z by `depth`. The hull of these points
 * (built in geometry.ts) becomes the faceted stone. Deterministic in seed+params.
 */
export function gemPoints(config: ShapeConfig): number[][] {
  const { vertices, depth, spread } = config.shape
  // Clamp BOTH ends: mergeConfig doesn't range-clamp, so a junk import (vertices: 1e8)
  // would otherwise hang ConvexGeometry. UI slider max is 40; 64 gives import headroom.
  const count = Math.min(64, Math.max(4, Math.round(vertices)))
  const rng = makeRng(config.seed, 'gem')
  const pts: number[][] = []
  for (let i = 0; i < count; i++) {
    // random direction on the sphere + radius biased by spread (spread→1 = fuller ball)
    const u = rng.next() * 2 - 1
    const theta = rng.next() * Math.PI * 2
    const r = Math.pow(rng.next(), 1 - 0.6 * spread) // spread high → radii pushed outward
    const s = Math.sqrt(1 - u * u)
    const x = r * s * Math.cos(theta) * (0.6 + spread)
    const y = r * s * Math.sin(theta) * (0.6 + spread)
    const z = r * u * depth
    pts.push([x, y, z])
  }
  return pts
}
