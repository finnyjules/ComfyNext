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
      const fs_dyReq = Number.isFinite(Number((_p as any)?.fsRowSpacing)) ? Number((_p as any).fsRowSpacing) : 0.5
      const fs_R     = Number.isFinite(Number((_p as any)?.fsRadius))     ? Number((_p as any).fsRadius)     : 0.78
      const fs_wReq  = Number.isFinite(Number((_p as any)?.fsWidth))      ? Number((_p as any).fsWidth)      : 1.0
      // Quantize column spacing + row spacing so a whole number of lattice periods
      // spans the tile (else the slider continuously rescales the grid and breaks the
      // seam). ncols is forced even so the (col+row)%2 two-tone parity also wraps.
      const ncols = 2 * Math.max(1, Math.round(cells / fs_wReq / 2))
      const fs_w = cells / ncols
      const npairs = Math.max(1, Math.round(cells / (2 * fs_dyReq)))
      const fs_dy = cells / (2 * npairs)
      const fs_g = 0.03
      const gxx = u * cells, gyy = v * cells
      // Lowest-row owner: pixel belongs to the lowest-row circle that contains it.
      // Creates interlocking scallop fan shapes with grout lines.
      // Normalize x by fs_w so distance is elliptic (semi-axes fs_R*fs_w, fs_R).
      const fsOwner = (px: number, py: number): [number, number] | null => {
        const pxn = px / fs_w
        const jc = Math.round(py / fs_dy)
        let bj: number | null = null, bi = 0, bd = 1e9
        for (let dj = -3; dj <= 3; dj++) {
          const j = jc + dj
          const off = (((j % 2) + 2) % 2) * 0.5
          const ic = Math.round(pxn - off)
          for (let di = -2; di <= 2; di++) {
            const i = ic + di, cxn = i + off, cy = j * fs_dy
            const d = Math.hypot(pxn - cxn, py - cy)
            if (d < fs_R) {
              if (bj === null || j < bj || (j === bj && d < bd)) { bj = j; bi = i; bd = d }
            }
          }
        }
        return bj === null ? null : [bi, bj]
      }
      const o = fsOwner(gxx, gyy)
      if (!o) return { role: 2, fx: 0.5, fy: 0.5 }
      for (const [ax, ay] of [[fs_g, 0], [-fs_g, 0], [0, fs_g], [0, -fs_g]] as [number, number][]) {
        const n = fsOwner(gxx + ax, gyy + ay)
        if (!n || n[0] !== o[0] || n[1] !== o[1]) return { role: 2, fx: 0.5, fy: 0.5 }
      }
      const off = (((o[1] % 2) + 2) % 2) * 0.5
      const cxn = o[0] + off, cy = o[1] * fs_dy
      return { role: (((o[0] + o[1]) % 2) + 2) % 2, fx: (gxx / fs_w - cxn) / (2 * fs_R) + 0.5, fy: (gyy - cy) / (2 * fs_R) + 0.5 }
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
    case 'hex': {
      const flat = _p && String((_p as any).hexOrient) === 'flat'
      const uw = ((u % 1) + 1) % 1, vw = ((v % 1) + 1) % 1
      const x0 = flat ? vw : uw, y0 = flat ? uw : vw
      const K = 1.1547005
      const nx = Math.max(9, Math.round(cells / 3) * 3)
      const ny = 2 * Math.round((nx * K) / 2)
      const sx = 1 / nx, sy = 1 / ny
      const r0 = Math.round(y0 / sy)
      let best = 1e9, bcol = 0, brow = 0, bcx = 0, bcy = 0
      for (let dr = -1; dr <= 1; dr++) {
        const row = r0 + dr
        const off = (((row % 2) + 2) % 2) * 0.5
        const c0 = Math.round(x0 / sx - off)
        for (let dc = -1; dc <= 1; dc++) {
          const col = c0 + dc
          const cx = (col + off) * sx, cy = row * sy
          const d = (x0 - cx) ** 2 + (y0 - cy) ** 2
          if (d < best) { best = d; bcol = col; brow = row; bcx = cx; bcy = cy }
        }
      }
      const role = (((bcol - Math.floor(brow / 2) - brow) % 3) + 3) % 3
      const lx = (x0 - bcx) / sx + 0.5, ly = (y0 - bcy) / sy + 0.5
      return flat ? { role, fx: ly, fy: lx } : { role, fx: lx, fy: ly }
    }
    case 'cairo': {
      const chC = 6 * Math.max(1, Math.round(cells / 6))
      const Px = u * chC, Py = v * chC
      const ic = Math.round((Px - 3) / 6), jc = Math.round((Py - 3) / 6)
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const cx = 3 + 6 * (ic + di), cy = 3 + 6 * (jc + dj)
        const dx = Px - cx, dy = Py - cy
        for (let k = 0; k < 4; k++) {
          let rx: number, ry: number
          if (k === 0) { rx = dx; ry = dy }
          else if (k === 1) { rx = dy; ry = -dx }
          else if (k === 2) { rx = -dx; ry = -dy }
          else { rx = -dy; ry = dx }
          const lx = rx + 3, ly = ry + 3
          if (ly >= 0 && (ly - 3 * lx + 6) >= 0 && (-lx - 3 * ly + 12) >= 0 && (lx - 3 * ly + 12) >= 0 && (3 * lx + ly + 6) >= 0) {
            const role = k < 2 ? 0 : (k === 2 ? 1 : 2)
            return { role, fx: (lx + 3) / 6, fy: ly / 4 }
          }
        }
      }
      return { role: 0, fx: 0, fy: 0 } // unreachable (full coverage); safe fallback
    }
    case 'cubes': {
      const uw = ((u % 1) + 1) % 1, vw = ((v % 1) + 1) % 1
      const K = 1.1547005
      // cubes need no mult-3 / >=9 clamp (the role is per-hex angular, not a global
      // color period) -> map cells directly to cube count so the slider scales cube
      // SIZE: cells=2 = a few huge cubes, cells=40 = many small ones. ny stays even
      // (row-offset wrap). Low counts have mild anisotropy but still read as cubes.
      const nx = Math.max(2, Math.round(cells))
      const ny = 2 * Math.max(1, Math.round((nx * K) / 2))
      const sx = 1 / nx, sy = 1 / ny
      const r0 = Math.round(vw / sy)
      let best = 1e9, bcx = 0, bcy = 0
      for (let dr = -1; dr <= 1; dr++) {
        const row = r0 + dr
        const off = (((row % 2) + 2) % 2) * 0.5
        const c0 = Math.round(uw / sx - off)
        for (let dc = -1; dc <= 1; dc++) {
          const cx = (c0 + dc + off) * sx, cy = row * sy
          const d = (uw - cx) ** 2 + (vw - cy) ** 2
          if (d < best) { best = d; bcx = cx; bcy = cy }
        }
      }
      const dx = uw - bcx, dy = (vw - bcy) * (sx / sy)
      const ang = (((Math.atan2(dy, dx) * 180) / Math.PI - 30) % 360 + 360) % 360
      const role = Math.floor(ang / 120) % 3
      return { role, fx: (uw - bcx) / sx + 0.5, fy: (vw - bcy) / sy + 0.5 }
    }
    default:
      return { role: 0, fx, fy }
  }
}
