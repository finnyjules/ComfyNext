// mesh -> signed distance grid -> surface nets -> mesh.
//
// One module, three consumers: the Remesh action, the Merge action, and the
// sculpt brush's ray picking (which uses the triangle grid this builds on the
// way in). Built once and passed around rather than rebuilt per use.
export type { TriGrid } from './triGrid'
export { buildTriGrid, closestDistance, raycastGrid } from './triGrid'
export type { Sdf, Lattice } from './sdf'
export { buildSdf, latticeFor, unionLattice, OPEN_INTERIOR_RATIO } from './sdf'
export { surfaceNets } from './surfaceNets'
export { boundsOf, cellFor } from './bounds'

import type { MeshData } from '~/lib/scene3d/mesh'
import { buildTriGrid } from './triGrid'
import { buildSdf, latticeFor } from './sdf'
import { surfaceNets } from './surfaceNets'
import { cellFor } from './bounds'

/** Rebuild `data` as a uniform-density mesh at `resolution` cells along its
 *  longest axis. `open: true` means the input is not a closed surface and the
 *  result is meaningless — the caller must refuse and offer Solidify instead of
 *  showing it, and `data` comes back UNCHANGED so a careless caller cannot
 *  accidentally commit a mangled mesh. */
export function remesh(data: MeshData, resolution: number): { data: MeshData; open: boolean } {
  const grid = buildTriGrid(data, cellFor(data, resolution))
  const { sdf, open } = buildSdf(grid, latticeFor(grid, resolution))
  if (open) return { data, open: true }
  return { data: surfaceNets(sdf), open: false }
}
