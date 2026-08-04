// A uniform spatial grid binning triangle indices, and the two queries built on
// it: nearest-surface distance and ray picking.
//
// ONE structure, THREE consumers — the SDF sample loop (sdf.ts), the sculpt
// brush's ray pick (sculpt/session.ts) and the merge (merge.ts). It is built
// once and passed around rather than rebuilt per use, which is most of why the
// voxel module earns its keep.
//
// Bins are CSR-style (`start` offsets into a flat `items`), not an array of
// arrays: a 40k-triangle mesh at 64^3 produces a few hundred thousand bin
// entries, and that many little JS arrays costs more in allocation and GC than
// the whole distance query.
import type { MeshData } from '~/lib/scene3d/mesh'
import { boundsOf } from './bounds'

export interface TriGrid {
  cell: number
  min: [number, number, number]
  dims: [number, number, number]
  /** Bin `c` owns items[start[c] .. start[c + 1]). Length dims.x*y*z + 1. */
  start: Int32Array
  items: Int32Array
  data: MeshData
  triCount: number
}

/** Cells of empty margin around the mesh, so a query just outside the surface
 *  still has cells to walk and the DDA has somewhere to enter from. */
const PAD = 1

export function buildTriGrid(data: MeshData, cell: number): TriGrid {
  const p = data.positions
  const ix = data.indices
  const triCount = (ix.length / 3) | 0

  // bLo/bHi, not lo/hi — those two names are taken below by the per-triangle
  // cell range, which is reused across both binning passes.
  const { lo: bLo, hi: bHi } = boundsOf(data)

  const min: [number, number, number] = [bLo[0] - cell * PAD, bLo[1] - cell * PAD, bLo[2] - cell * PAD]
  const dims: [number, number, number] = [
    Math.max(1, Math.ceil((bHi[0] - bLo[0]) / cell) + 2 * PAD + 1),
    Math.max(1, Math.ceil((bHi[1] - bLo[1]) / cell) + 2 * PAD + 1),
    Math.max(1, Math.ceil((bHi[2] - bLo[2]) / cell) + 2 * PAD + 1),
  ]
  const cellCount = dims[0] * dims[1] * dims[2]

  // Cell range a triangle overlaps, clamped into the grid.
  const lo = [0, 0, 0]
  const hi = [0, 0, 0]
  const triCells = (t: number): void => {
    for (let a = 0; a < 3; a++) {
      let mn = Infinity, mx = -Infinity
      for (let v = 0; v < 3; v++) {
        const c = p[ix[t * 3 + v]! * 3 + a]!
        if (c < mn) mn = c
        if (c > mx) mx = c
      }
      lo[a] = Math.max(0, Math.floor((mn - min[a]!) / cell))
      hi[a] = Math.min(dims[a]! - 1, Math.floor((mx - min[a]!) / cell))
    }
  }

  // Counting pass, then prefix sum, then fill pass.
  const counts = new Int32Array(cellCount + 1)
  for (let t = 0; t < triCount; t++) {
    triCells(t)
    for (let k = lo[2]!; k <= hi[2]!; k++)
      for (let j = lo[1]!; j <= hi[1]!; j++)
        for (let i = lo[0]!; i <= hi[0]!; i++)
          counts[(k * dims[1]! + j) * dims[0]! + i + 1]!++
  }
  const start = new Int32Array(cellCount + 1)
  for (let c = 0; c < cellCount; c++) start[c + 1] = start[c]! + counts[c + 1]!
  const items = new Int32Array(start[cellCount]!)
  const cursor = new Int32Array(cellCount)
  for (let t = 0; t < triCount; t++) {
    triCells(t)
    for (let k = lo[2]!; k <= hi[2]!; k++)
      for (let j = lo[1]!; j <= hi[1]!; j++)
        for (let i = lo[0]!; i <= hi[0]!; i++) {
          const c = (k * dims[1]! + j) * dims[0]! + i
          items[start[c]! + cursor[c]!++] = t
        }
  }

  return { cell, min, dims, start, items, data, triCount }
}

// --- closest point on a triangle (Ericson, Real-Time Collision Detection) ----
// Returns the SQUARED distance, so the hot loop never calls sqrt.

function pointTriDistSq(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az
  const acx = cx - ax, acy = cy - ay, acz = cz - az
  const apx = px - ax, apy = py - ay, apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  const sq = (x: number, y: number, z: number) => x * x + y * y + z * z
  if (d1 <= 0 && d2 <= 0) return sq(apx, apy, apz)                      // vertex A

  const bpx = px - bx, bpy = py - by, bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return sq(bpx, bpy, bpz)                     // vertex B

  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {                                  // edge AB
    const v = d1 / (d1 - d3)
    return sq(apx - abx * v, apy - aby * v, apz - abz * v)
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return sq(cpx, cpy, cpz)                     // vertex C

  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {                                  // edge AC
    const w = d2 / (d2 - d6)
    return sq(apx - acx * w, apy - acy * w, apz - acz * w)
  }

  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {                        // edge BC
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
    return sq(bpx - (cx - bx) * w, bpy - (cy - by) * w, bpz - (cz - bz) * w)
  }

  const denom = 1 / (va + vb + vc)                                      // face interior
  const v = vb * denom, w = vc * denom
  return sq(apx - abx * v - acx * w, apy - aby * v - acy * w, apz - abz * v - acz * w)
}

/** Distance from a point to the nearest triangle, capped at `maxRadius`.
 *
 *  Walks cells outward in Chebyshev shells and stops as soon as the nearest
 *  possible point in the next shell is further than the best hit so far — that
 *  early-out is what keeps this near-constant-time instead of scanning the
 *  whole grid. Returns `maxRadius` when nothing is inside it, which callers
 *  read as "far away"; the SDF only needs exact values in the narrow band. */
export function closestDistance(
  g: TriGrid, x: number, y: number, z: number, maxRadius: number,
): number {
  const p = g.data.positions
  const ix = g.data.indices
  const ci = Math.floor((x - g.min[0]) / g.cell)
  const cj = Math.floor((y - g.min[1]) / g.cell)
  const ck = Math.floor((z - g.min[2]) / g.cell)
  let bestSq = maxRadius * maxRadius
  const maxShell = Math.ceil(maxRadius / g.cell) + 1

  for (let s = 0; s <= maxShell; s++) {
    // The closest any triangle in shell s can be is (s-1)*cell away.
    const floor = Math.max(0, (s - 1) * g.cell)
    if (floor * floor > bestSq) break
    for (let k = ck - s; k <= ck + s; k++) {
      if (k < 0 || k >= g.dims[2]) continue
      for (let j = cj - s; j <= cj + s; j++) {
        if (j < 0 || j >= g.dims[1]) continue
        for (let i = ci - s; i <= ci + s; i++) {
          if (i < 0 || i >= g.dims[0]) continue
          // Shell surface only — the interior was covered by a previous s.
          const cheb = Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck))
          if (cheb !== s) continue
          const c = (k * g.dims[1] + j) * g.dims[0] + i
          for (let e = g.start[c]!; e < g.start[c + 1]!; e++) {
            const t = g.items[e]!
            const a = ix[t * 3]! * 3, b = ix[t * 3 + 1]! * 3, cc = ix[t * 3 + 2]! * 3
            const d = pointTriDistSq(
              x, y, z,
              p[a]!, p[a + 1]!, p[a + 2]!,
              p[b]!, p[b + 1]!, p[b + 2]!,
              p[cc]!, p[cc + 1]!, p[cc + 2]!,
            )
            if (d < bestSq) bestSq = d
          }
        }
      }
    }
  }
  return Math.sqrt(bestSq)
}

// --- ray picking -------------------------------------------------------------

/** Möller–Trumbore. Returns the ray parameter, or -1 on a miss. Double-sided:
 *  a sculpt brush must still pick a surface the user is looking at from inside
 *  a concavity. */
function rayTri(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
  const det = e1x * px + e1y * py + e1z * pz
  if (Math.abs(det) < 1e-12) return -1
  const inv = 1 / det
  const tx = ox - ax, ty = oy - ay, tz = oz - az
  const u = (tx * px + ty * py + tz * pz) * inv
  if (u < 0 || u > 1) return -1
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
  const v = (dx * qx + dy * qy + dz * qz) * inv
  if (v < 0 || u + v > 1) return -1
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv
  return t > 1e-7 ? t : -1
}

/** Nearest triangle hit along a ray, via a 3D DDA over the grid.
 *
 *  This is the brush's picking path and the reason the grid exists at all: a
 *  brute-force THREE.Raycaster over 80k triangles costs 5–15ms plus garbage per
 *  pointermove, which cannot hold 60Hz. The DDA visits a handful of cells. */
export function raycastGrid(
  g: TriGrid,
  origin: [number, number, number],
  dir: [number, number, number],
): { t: number; tri: number } | null {
  const p = g.data.positions
  const ix = g.data.indices
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
  const d = [dir[0] / len, dir[1] / len, dir[2] / len]

  // Clip the ray to the grid box (slab test) so the walk starts inside.
  let tMin = 0
  let tMax = Infinity
  for (let a = 0; a < 3; a++) {
    const lo = g.min[a]!
    const hi = lo + g.dims[a]! * g.cell
    if (Math.abs(d[a]!) < 1e-12) {
      if (origin[a]! < lo || origin[a]! > hi) return null
      continue
    }
    let t0 = (lo - origin[a]!) / d[a]!
    let t1 = (hi - origin[a]!) / d[a]!
    if (t0 > t1) { const s = t0; t0 = t1; t1 = s }
    if (t0 > tMin) tMin = t0
    if (t1 < tMax) tMax = t1
    if (tMin > tMax) return null
  }

  const at = (a: number) => origin[a]! + d[a]! * (tMin + 1e-6)
  const cellIdx = [0, 0, 0]
  const step = [0, 0, 0]
  const tNext = [0, 0, 0]
  const tDelta = [0, 0, 0]
  for (let a = 0; a < 3; a++) {
    cellIdx[a] = Math.min(g.dims[a]! - 1, Math.max(0, Math.floor((at(a) - g.min[a]!) / g.cell)))
    if (d[a]! > 0) {
      step[a] = 1
      tNext[a] = tMin + ((g.min[a]! + (cellIdx[a]! + 1) * g.cell) - at(a)) / d[a]!
      tDelta[a] = g.cell / d[a]!
    } else if (d[a]! < 0) {
      step[a] = -1
      tNext[a] = tMin + ((g.min[a]! + cellIdx[a]! * g.cell) - at(a)) / d[a]!
      tDelta[a] = -g.cell / d[a]!
    } else {
      step[a] = 0
      tNext[a] = Infinity
      tDelta[a] = Infinity
    }
  }

  let best = Infinity
  let bestTri = -1
  for (;;) {
    const c = (cellIdx[2]! * g.dims[1]! + cellIdx[1]!) * g.dims[0]! + cellIdx[0]!
    for (let e = g.start[c]!; e < g.start[c + 1]!; e++) {
      const t = g.items[e]!
      const a = ix[t * 3]! * 3, b = ix[t * 3 + 1]! * 3, cc = ix[t * 3 + 2]! * 3
      const hit = rayTri(
        origin[0], origin[1], origin[2], d[0]!, d[1]!, d[2]!,
        p[a]!, p[a + 1]!, p[a + 2]!,
        p[b]!, p[b + 1]!, p[b + 2]!,
        p[cc]!, p[cc + 1]!, p[cc + 2]!,
      )
      if (hit >= 0 && hit < best) { best = hit; bestTri = t }
    }
    // A hit inside the current cell is final — no later cell can beat it.
    const advance = Math.min(tNext[0]!, tNext[1]!, tNext[2]!)
    if (bestTri >= 0 && best <= advance) break
    if (advance > tMax) break
    const axis = tNext[0]! <= tNext[1]! && tNext[0]! <= tNext[2]! ? 0 : tNext[1]! <= tNext[2]! ? 1 : 2
    cellIdx[axis] = cellIdx[axis]! + step[axis]!
    if (cellIdx[axis]! < 0 || cellIdx[axis]! >= g.dims[axis]!) break
    tNext[axis] = tNext[axis]! + tDelta[axis]!
  }

  return bestTri >= 0 ? { t: best, tri: bestTri } : null
}
