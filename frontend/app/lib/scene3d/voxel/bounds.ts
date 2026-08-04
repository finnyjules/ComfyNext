// The bounding box of a MeshData, and the cell size derived from it. Every
// other file in this module needs one or both; keeping them here is what stops
// the same six-line loop appearing in sdf.ts, index.ts and merge.ts.
import type { MeshData } from '~/lib/scene3d/mesh'

export function boundsOf(data: MeshData): {
  lo: [number, number, number]
  hi: [number, number, number]
} {
  const p = data.positions
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < p.length; i++) {
    const a = i % 3
    const v = p[i]!
    if (v < lo[a]!) lo[a] = v
    if (v > hi[a]!) hi[a] = v
  }
  // An empty mesh collapses to a degenerate box rather than propagating
  // Infinity into every lattice size downstream.
  if (!Number.isFinite(lo[0])) return { lo: [0, 0, 0], hi: [0, 0, 0] }
  return { lo, hi }
}

/** Cell size putting `resolution` cells along the mesh's longest axis. */
export function cellFor(data: MeshData, resolution: number): number {
  const { lo, hi } = boundsOf(data)
  return Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6) / resolution
}
