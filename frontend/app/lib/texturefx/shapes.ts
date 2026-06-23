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
    case 'basketweave': {
      const ch = Math.max(4, Math.round(cells / 4) * 4)
      const bx = u * ch, by = v * ch
      const cx = Math.floor(bx), cy = Math.floor(by)
      const lfx = bx - cx, lfy = by - cy
      const P = (Math.floor(cx / 2) + Math.floor(cy / 2)) % 2
      if (P === 0) return { role: 0, fx: ((cx % 2) + lfx) / 2, fy: lfy }       // horizontal planks
      return { role: 1, fx: lfx, fy: ((cy % 2) + lfy) / 2 }                    // vertical planks
    }
    case 'herringbone': {
      const ch = Math.max(4, Math.round(cells / 4) * 4)
      const bx = u * ch, by = v * ch
      const cx = Math.floor(bx), cy = Math.floor(by)
      const lfx = bx - cx, lfy = by - cy
      const role = Math.floor((cx + cy) / 2) % 2
      const par = (cx + cy) % 2
      if (role === 0) return { role: 0, fx: (par + lfx) / 2, fy: lfy }         // horizontal brick
      return { role: 1, fx: lfx, fy: (par + lfy) / 2 }                         // vertical brick
    }
    case 'fishscale': {
      const gxx = u * cells, gyy = v * cells
      const R = 0.55
      const jc = Math.round(gyy)
      let best = 1e9, bcx = 0, bcy = 0
      for (let dj = -1; dj <= 1; dj++) {
        const j = jc + dj
        const off = (((j % 2) + 2) % 2) * 0.5
        const ic = Math.round(gxx - off)
        for (let di = -1; di <= 1; di++) {
          const cxp = ic + di + off, cyp = j
          const d = Math.hypot(gxx - cxp, gyy - cyp)
          if (d < best) { best = d; bcx = cxp; bcy = cyp }
        }
      }
      return { role: best < R ? 0 : 1, fx: (gxx - bcx) / (2 * R) + 0.5, fy: (gyy - bcy) / (2 * R) + 0.5 }
    }
    case 'pythagorean': {
      const a = 2, b = 1, s2 = 5
      const chP = Math.max(5, Math.round(cells / 5) * 5)
      const x = u * chP, y = v * chP
      const al = (a * x + b * y) / s2, be = (-b * x + a * y) / s2
      const m0 = Math.floor(al), n0 = Math.floor(be)
      for (let dm = -1; dm <= 1; dm++) for (let dn = -1; dn <= 1; dn++) {
        const m = m0 + dm, n = n0 + dn
        const Lx = a * m - b * n, Ly = b * m + a * n
        if (x >= Lx && x < Lx + a && y >= Ly && y < Ly + a) return { role: 0, fx: (x - Lx) / a, fy: (y - Ly) / a }
        const sx = Lx + a, sy = Ly
        if (x >= sx && x < sx + b && y >= sy && y < sy + b) return { role: 1, fx: (x - sx) / b, fy: (y - sy) / b }
      }
      return { role: 1, fx: 0, fy: 0 }
    }
    default:
      return { role: 0, fx, fy }
  }
}
