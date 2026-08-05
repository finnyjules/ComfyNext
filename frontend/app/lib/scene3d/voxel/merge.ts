// Boolean operations through the distance field.
//
// Chosen over exact mesh CSG because the output is ALREADY a clean uniform mesh
// — you can keep sculpting a merge result without remeshing it first — and
// because a smooth-min gives a fillet at the join for free. The cost accepted
// in exchange: sharp edges soften at grid resolution. Merging a box into a box
// will not give you a crisp corner. If crisp hard-surface booleans are ever
// wanted, they belong behind this same action at blend 0, not inside here.
import { MESH_VERTEX_CAP, type MeshData } from '~/lib/scene3d/mesh'
import { buildTriGrid } from './triGrid'
import { buildSdf, unionLattice } from './sdf'
import { surfaceNets } from './surfaceNets'
// Measured against each input's OWN longest axis, so a small object in a big
// merge still gets sampled finely enough to survive.
import { cellFor } from './bounds'

export type MergeOp = 'union' | 'subtract' | 'intersect'

/** Polynomial smooth minimum. At k = 0 this is exactly min(). */
function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b)
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/** Smooth maximum, the same construction mirrored — needed so `intersect` and
 *  `subtract` get a fillet too rather than only `union`. */
function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k)
}

// Same last-resort floor as remeshObject: below this the field is too coarse
// to mean anything, so the ladder stops shrinking here rather than continuing
// forever. Reachable in production — the resolution slider goes to 128, and
// 0.75-per-step needs about ten shrinks to reach it (Finding 4, Task 16
// review) — so the ladder MUST actually get here rather than giving up early.
const MIN_RESOLUTION = 8

export function mergeMeshes(
  inputs: MeshData[], op: MergeOp, blend: number, resolution: number,
  // Overridable only so a unit test can force the ladder to exhaust without
  // needing a genuinely 40k-vertex mesh; every real caller uses the default.
  vertexCap: number = MESH_VERTEX_CAP,
): { data: MeshData; open: boolean; failed?: boolean } {
  if (inputs.length === 0) return { data: { positions: new Float32Array(0), indices: new Uint32Array(0) }, open: false }
  if (inputs.length === 1) return { data: inputs[0]!, open: false }

  let res = resolution
  // Openness is a property of the MESH, not of the lattice sampling it, so it
  // is only trustworthy checked at the finest resolution this call ever tries
  // — the very first pass, before any shrinking. Re-checking it at every
  // shrunk step (as a strict per-attempt port of the old 4-try loop would)
  // breaks down once the ladder runs all the way to `MIN_RESOLUTION`: a
  // perfectly closed shape (a sphere, say) has so little of the lattice left
  // as interior at res 8 that `OPEN_INTERIOR_RATIO`'s heuristic can trip a
  // false positive, refusing a merge that was never actually open. The
  // Vue caller already probes every input's openness at the full slider
  // resolution before ever calling this (see mergeSelection's own `remesh`
  // loop); this check is the defensive fallback for callers that skip that —
  // direct tests included — and only needs to run once.
  let openChecked = false
  for (;;) {
    // ONE lattice for every input, so the fields line up node-for-node and no
    // resampling step is needed between them. Per-input lattices would have to
    // be interpolated onto a common one, blurring every merge.
    const grids = inputs.map((d) => buildTriGrid(d, cellFor(d, res)))
    const lattice = unionLattice(grids, res)

    const fields: Float32Array[] = []
    for (const g of grids) {
      const { sdf, open } = buildSdf(g, lattice)
      if (!openChecked && open) return { data: inputs[0]!, open: true }
      fields.push(sdf.values)
    }
    openChecked = true

    const base = fields[0]!
    const out = new Float32Array(base.length)
    out.set(base)
    for (let f = 1; f < fields.length; f++) {
      const other = fields[f]!
      for (let i = 0; i < out.length; i++) {
        const a = out[i]!
        const b = other[i]!
        out[i] = op === 'union' ? smin(a, b, blend)
          : op === 'intersect' ? smax(a, b, blend)
          : smax(a, -b, blend) // subtract — the FIRST input is the base
      }
    }

    const data = surfaceNets({ values: out, min: lattice.min, dims: lattice.dims, cell: lattice.cell })
    const vertexCount = data.positions.length / 3
    if (vertexCount <= vertexCap) return { data, open: false }
    if (res <= MIN_RESOLUTION) {
      // Exhausted the ladder AND at the floor: `data` here is a REAL merge —
      // every input's field, actually combined — it is simply too dense.
      // Reporting it as a plain success (the old behaviour, which instead
      // substituted `inputs[0]` alone) would silently hand back a shape that
      // is not the merge at all; `failed: true` tells the caller to refuse and
      // say so, never to commit `data` as-is.
      return { data, open: false, failed: true }
    }
    res = Math.max(MIN_RESOLUTION, Math.round(res * 0.75))
  }
}
