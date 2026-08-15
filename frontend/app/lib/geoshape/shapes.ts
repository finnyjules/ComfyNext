import { polygonVertices, starVertices, roundedPolygonPath, type Pt } from '~/lib/compositor/polygonGeometry'

export type BaseShapeKind = 'polygon' | 'star' | 'hexagon' | 'irregular'

export interface BaseShapeOpts {
  sides: number; starInner: number; irregularSeed: number
  size: number; roundCorners: number; roundRadius: number
}

// Small seeded RNG (mulberry32 over an xmur3 hash) — self-contained.
function rng(seed: number): () => number {
  const s = `geo|${seed}`
  let h = 1779033703 ^ s.length
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909)
  let a = (h ^= h >>> 16) >>> 0
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function irregularVertices(sides: number, size: number, seed: number): Pt[] {
  const base = polygonVertices(sides, size, size)
  const r = rng(seed)
  // jitter each vertex radially by ±30% of size/2
  return base.map((p) => { const k = 0.7 + r() * 0.6; return { x: p.x * k, y: p.y * k } })
}

/** One SVG `d` (centered on origin) for the chosen base shape. `roundCorners`
 *  gates rounding (0 = off) and `roundRadius`/100 is the corner-radius fraction. */
export function baseShapePath(kind: BaseShapeKind, o: BaseShapeOpts): string {
  const cr = o.roundCorners > 0 ? Math.max(0, Math.min(1, o.roundRadius / 100)) : 0
  switch (kind) {
    case 'polygon':   return roundedPolygonPath(polygonVertices(o.sides, o.size, o.size), cr)
    case 'hexagon':   return roundedPolygonPath(polygonVertices(6, o.size, o.size), cr)
    case 'star':      return roundedPolygonPath(starVertices(o.sides, o.starInner, o.size, o.size), cr)
    case 'irregular': return roundedPolygonPath(irregularVertices(o.sides, o.size, o.irregularSeed), cr)
  }
}
