// Sample a mesh into a signed distance field on a lattice.
//
// Signing is by EXTERIOR FLOOD FILL, not by winding number: seed a queue with
// every boundary node, expand through 6-neighbours, and refuse to cross the
// surface band. Whatever the fill never reaches is inside. That is robust to
// the slightly-degenerate triangles real meshes carry, and needs no per-node
// ray casting.
import { closestDistance, type TriGrid } from './triGrid'
import { boundsOf } from './bounds'

export interface Lattice {
  min: [number, number, number]
  dims: [number, number, number]
  cell: number
}

export interface Sdf extends Lattice {
  /** Node (i,j,k) at (k * dims.y + j) * dims.x + i. Negative inside. */
  values: Float32Array
}

/** Interior nodes as a fraction of surface-band nodes, below which the input is
 *  treated as an open surface.
 *
 *  The comparison is against the BAND, not against total volume, and that
 *  choice is load-bearing. For a genuinely open surface the fill leaks inside
 *  and the interior count collapses to ~0 while the band stays large. Compared
 *  against total volume instead, a thin CLOSED shell — exactly what `solidify`
 *  produces, and what a torus already is — has a tiny interior too, and would
 *  be misclassified as open. */
export const OPEN_INTERIOR_RATIO = 0.25

/** Nodes of empty margin outside the mesh. Two, so the exterior fill always has
 *  a seed ring that no surface band can block, and surface nets has a cell of
 *  room beyond the outermost crossing. */
const PAD = 2

function latticeFrom(
  lo: [number, number, number], hi: [number, number, number], resolution: number,
): Lattice {
  const longest = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6)
  const cell = longest / resolution
  return {
    cell,
    min: [lo[0] - cell * PAD, lo[1] - cell * PAD, lo[2] - cell * PAD],
    dims: [
      Math.max(2, Math.ceil((hi[0] - lo[0]) / cell) + 2 * PAD + 1),
      Math.max(2, Math.ceil((hi[1] - lo[1]) / cell) + 2 * PAD + 1),
      Math.max(2, Math.ceil((hi[2] - lo[2]) / cell) + 2 * PAD + 1),
    ],
  }
}

export function latticeFor(grid: TriGrid, resolution: number): Lattice {
  const { lo, hi } = boundsOf(grid.data)
  return latticeFrom(lo, hi, resolution)
}

/** One lattice covering every input — what a merge samples all its meshes onto
 *  so their fields can be combined node-by-node with no resampling. */
export function unionLattice(grids: TriGrid[], resolution: number): Lattice {
  const lo: [number, number, number] = [Infinity, Infinity, Infinity]
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const g of grids) {
    const b = boundsOf(g.data)
    for (let a = 0; a < 3; a++) {
      if (b.lo[a]! < lo[a]!) lo[a] = b.lo[a]!
      if (b.hi[a]! > hi[a]!) hi[a] = b.hi[a]!
    }
  }
  if (!Number.isFinite(lo[0])) return latticeFrom([0, 0, 0], [0, 0, 0], resolution)
  return latticeFrom(lo, hi, resolution)
}

const EXTERIOR = 1
const BAND = 2

export function buildSdf(grid: TriGrid, lattice: Lattice): { sdf: Sdf; open: boolean } {
  const { min, dims, cell } = lattice
  const [nx, ny, nz] = dims
  const total = nx * ny * nz
  const values = new Float32Array(total)
  const flags = new Uint8Array(total)

  // 1. Unsigned distance, exact only inside a narrow band. Surface nets never
  //    reads further than one cell from a crossing, so paying for exact
  //    distances across the whole volume would be pure waste.
  const FAR = cell * 3
  const bandCut = cell * 0.75
  let bandCount = 0
  for (let k = 0, idx = 0; k < nz; k++) {
    const z = min[2] + k * cell
    for (let j = 0; j < ny; j++) {
      const y = min[1] + j * cell
      for (let i = 0; i < nx; i++, idx++) {
        const d = closestDistance(grid, min[0] + i * cell, y, z, FAR)
        values[idx] = d
        if (d < bandCut) { flags[idx] = BAND; bandCount++ }
      }
    }
  }

  // 2. Exterior flood fill from the lattice boundary, blocked by the band.
  const queue = new Int32Array(total)
  let head = 0
  let tail = 0
  const push = (idx: number): void => {
    if (flags[idx]! !== 0) return
    flags[idx] = EXTERIOR
    queue[tail++] = idx
  }
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        if (i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1) {
          push((k * ny + j) * nx + i)
        }
  while (head < tail) {
    const idx = queue[head++]!
    const i = idx % nx
    const j = ((idx / nx) | 0) % ny
    const k = (idx / (nx * ny)) | 0
    if (i > 0) push(idx - 1)
    if (i < nx - 1) push(idx + 1)
    if (j > 0) push(idx - nx)
    if (j < ny - 1) push(idx + nx)
    if (k > 0) push(idx - nx * ny)
    if (k < nz - 1) push(idx + nx * ny)
  }

  // 3. Open detection — see OPEN_INTERIOR_RATIO.
  let interior = 0
  for (let idx = 0; idx < total; idx++) if (flags[idx] === 0) interior++
  const open = bandCount === 0 || interior < OPEN_INTERIOR_RATIO * bandCount

  // 4. Sign. Band nodes were never reached by the fill and have no side of
  //    their own, so each takes the sign of its neighbours: exterior if any
  //    6-neighbour is exterior, interior otherwise. The band is ~1 node thick
  //    at a 0.75-cell cut, so one pass settles it — and because a band node's
  //    distance is near zero either way, a mis-signed one moves the
  //    interpolated surface by well under a cell.
  for (let idx = 0; idx < total; idx++) {
    if (flags[idx] === EXTERIOR) { values[idx] = values[idx]!; continue }
    if (flags[idx] === 0) { values[idx] = -values[idx]!; continue }
    const i = idx % nx
    const j = ((idx / nx) | 0) % ny
    const k = (idx / (nx * ny)) | 0
    const outside =
      (i > 0 && flags[idx - 1] === EXTERIOR)
      || (i < nx - 1 && flags[idx + 1] === EXTERIOR)
      || (j > 0 && flags[idx - nx] === EXTERIOR)
      || (j < ny - 1 && flags[idx + nx] === EXTERIOR)
      || (k > 0 && flags[idx - nx * ny] === EXTERIOR)
      || (k < nz - 1 && flags[idx + nx * ny] === EXTERIOR)
    values[idx] = outside ? values[idx]! : -values[idx]!
  }

  return { sdf: { values, min, dims, cell }, open }
}
