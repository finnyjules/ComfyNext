import type { Params } from '~/lib/spacetype/effect'

export type ShapeRegion = { role: number; fx: number; fy: number }

// Pure, seamless tiling-family sampler. u,v in [0,1]; integer `cells`.
// Returns the role index a pixel belongs to + its cell-local coords (fx,fy).
// Mirrored by the GLSL shapeRegion branch in renderer.ts.
export function shapeRegion(family: string, u: number, v: number, cells: number, _p?: Params): ShapeRegion {
  const gx = u * cells, gy = v * cells
  const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy)
  switch (family) {
    case 'octagon': {
      // Octagon tile (role 0); the 4 corner triangles (chamfer c) are the
      // "joint" (role 1) -- they merge across 4 cells into the small square.
      const c = 0.29
      const corner = (fx + fy < c) || ((1 - fx) + fy < c) || (fx + (1 - fy) < c) || ((1 - fx) + (1 - fy) < c)
      return { role: corner ? 1 : 0, fx, fy }
    }
    case 'pinwheel': {
      const cx = Math.floor(gx), cy = Math.floor(gy)
      const pin = _p && String((_p as any).pinwheel) !== 'off'
      let rx = fx, ry = fy
      if (pin) {
        const k = (cx & 1) === 0 ? ((cy & 1) === 0 ? 0 : 3) : ((cy & 1) === 0 ? 1 : 2)
        if (k === 1) { rx = fy; ry = 1 - fx } else if (k === 2) { rx = 1 - fx; ry = 1 - fy } else if (k === 3) { rx = 1 - fy; ry = fx }
      }
      return { role: rx > ry ? 0 : 1, fx, fy }
    }
    case 'chevron': {
      const tri = (x: number) => Math.abs((x - Math.floor(x)) * 2 - 1)
      const band = Math.floor(v * cells + tri(u * cells))
      return { role: ((band % 2) + 2) % 2, fx, fy }
    }
    default:
      return { role: 0, fx, fy }
  }
}
