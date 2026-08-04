// Naive surface nets: one vertex per sign-changing cell, quads across every
// sign-changing lattice edge.
//
// Chosen over marching cubes deliberately. There is no 256-case table to carry,
// and — the reason that actually matters here — it produces well-conditioned,
// roughly uniform triangles instead of marching cubes' slivers. Uniform
// triangles are exactly what a sculpt brush needs: a sliver stretches into
// garbage the moment you push on it.
import type { MeshData } from '~/lib/scene3d/mesh'
import type { Sdf } from './sdf'

/** The 12 cell edges as pairs of corner indices, corner c being
 *  (c & 1, (c >> 1) & 1, (c >> 2) & 1) offset from the cell's minimum node. */
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
]

export function surfaceNets(sdf: Sdf): MeshData {
  const { values, dims, cell, min } = sdf
  const [nx, ny, nz] = dims
  const cx = nx - 1, cy = ny - 1, cz = nz - 1
  if (cx < 1 || cy < 1 || cz < 1) return { positions: new Float32Array(0), indices: new Uint32Array(0) }

  const nodeAt = (i: number, j: number, k: number): number => (k * ny + j) * nx + i
  const cellAt = (i: number, j: number, k: number): number => (k * cy + j) * cx + i

  // --- pass 1: one vertex per sign-changing cell ------------------------------
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1)
  const positions: number[] = []
  const corner = new Float64Array(8)

  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let mask = 0
        for (let c = 0; c < 8; c++) {
          const v = values[nodeAt(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]!
          corner[c] = v
          if (v < 0) mask |= 1 << c
        }
        if (mask === 0 || mask === 0xff) continue // no crossing

        // Average the zero crossings on every edge that changes sign.
        let sx = 0, sy = 0, sz = 0, n = 0
        for (const [a, b] of EDGES) {
          const va = corner[a]!, vb = corner[b]!
          if ((va < 0) === (vb < 0)) continue
          const t = va / (va - vb) // where along a->b the field hits zero
          const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1
          const bx = b & 1, by = (b >> 1) & 1, bz = (b >> 2) & 1
          sx += ax + (bx - ax) * t
          sy += ay + (by - ay) * t
          sz += az + (bz - az) * t
          n++
        }
        if (n === 0) continue

        cellVertex[cellAt(i, j, k)] = positions.length / 3
        positions.push(
          min[0] + (i + sx / n) * cell,
          min[1] + (j + sy / n) * cell,
          min[2] + (k + sz / n) * cell,
        )
      }
    }
  }

  // --- pass 2: a quad per sign-changing lattice edge ---------------------------
  // Each interior lattice edge is shared by exactly 4 cells. Walking them in a
  // consistent loop around the edge's axis gives counter-clockwise winding seen
  // from the axis's positive direction; when the field goes negative->positive
  // along the edge the outward normal points that way too, so the loop is
  // already front-facing. Otherwise it is reversed.
  const indices: number[] = []
  const quad = (a: number, b: number, c: number, d: number, flip: boolean): void => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) indices.push(a, c, b, a, d, c)
    else indices.push(a, b, c, a, c, d)
  }

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const here = values[nodeAt(i, j, k)]!
        const inside = here < 0

        // edge along +x — the 4 cells sharing it vary in y and z
        if (i < nx - 1 && j > 0 && k > 0) {
          const there = values[nodeAt(i + 1, j, k)]!
          if (inside !== (there < 0)) {
            quad(
              cellVertex[cellAt(i, j - 1, k - 1)]!,
              cellVertex[cellAt(i, j, k - 1)]!,
              cellVertex[cellAt(i, j, k)]!,
              cellVertex[cellAt(i, j - 1, k)]!,
              !inside,
            )
          }
        }
        // edge along +y — cells vary in z and x
        if (j < ny - 1 && i > 0 && k > 0) {
          const there = values[nodeAt(i, j + 1, k)]!
          if (inside !== (there < 0)) {
            quad(
              cellVertex[cellAt(i - 1, j, k - 1)]!,
              cellVertex[cellAt(i - 1, j, k)]!,
              cellVertex[cellAt(i, j, k)]!,
              cellVertex[cellAt(i, j, k - 1)]!,
              !inside,
            )
          }
        }
        // edge along +z — cells vary in x and y
        if (k < nz - 1 && i > 0 && j > 0) {
          const there = values[nodeAt(i, j, k + 1)]!
          if (inside !== (there < 0)) {
            quad(
              cellVertex[cellAt(i - 1, j - 1, k)]!,
              cellVertex[cellAt(i, j - 1, k)]!,
              cellVertex[cellAt(i, j, k)]!,
              cellVertex[cellAt(i - 1, j, k)]!,
              !inside,
            )
          }
        }
      }
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) }
}
