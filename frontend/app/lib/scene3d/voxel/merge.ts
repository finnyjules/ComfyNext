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

export function mergeMeshes(
  inputs: MeshData[], op: MergeOp, blend: number, resolution: number,
): { data: MeshData; open: boolean } {
  if (inputs.length === 0) return { data: { positions: new Float32Array(0), indices: new Uint32Array(0) }, open: false }
  if (inputs.length === 1) return { data: inputs[0]!, open: false }

  let res = resolution
  for (let attempt = 0; attempt < 4; attempt++) {
    // ONE lattice for every input, so the fields line up node-for-node and no
    // resampling step is needed between them. Per-input lattices would have to
    // be interpolated onto a common one, blurring every merge.
    const grids = inputs.map((d) => buildTriGrid(d, cellFor(d, res)))
    const lattice = unionLattice(grids, res)

    const fields: Float32Array[] = []
    for (const g of grids) {
      const { sdf, open } = buildSdf(g, lattice)
      if (open) return { data: inputs[0]!, open: true }
      fields.push(sdf.values)
    }

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
    if (data.positions.length / 3 <= MESH_VERTEX_CAP) return { data, open: false }
    res = Math.max(8, Math.round(res * 0.75))
  }

  // Same last-resort floor as remeshObject: a coarse shape beats an error.
  const grids = inputs.map((d) => buildTriGrid(d, cellFor(d, 8)))
  const lattice = unionLattice(grids, 8)
  const { sdf } = buildSdf(grids[0]!, lattice)
  return { data: surfaceNets(sdf), open: false }
}
