// Turn an OPEN surface into a closed shell, so it has an inside for buildSdf's
// flood fill to find. Two offset copies along the vertex normals, the inner one
// wound backwards, stitched along the boundary.
import type { MeshData } from '~/lib/scene3d/mesh'

/** Area-weighted vertex normals — the same quantity three's computeVertexNormals
 *  produces, computed here so this module stays free of a THREE import. */
function vertexNormals(data: MeshData): Float32Array {
  const p = data.positions
  const ix = data.indices
  const n = new Float32Array(p.length)
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t]! * 3, b = ix[t + 1]! * 3, c = ix[t + 2]! * 3
    const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!
    const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!
    // Unnormalised cross product — its length IS twice the triangle area, which
    // is the weighting we want.
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
    for (const o of [a, b, c]) { n[o] = n[o]! + fx; n[o + 1] = n[o + 1]! + fy; n[o + 2] = n[o + 2]! + fz }
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1
    n[i] = n[i]! / len; n[i + 1] = n[i + 1]! / len; n[i + 2] = n[i + 2]! / len
  }
  return n
}

export function solidify(data: MeshData, thickness: number): MeshData {
  const p = data.positions
  const ix = data.indices
  const vCount = p.length / 3
  const half = thickness / 2
  const nrm = vertexNormals(data)

  // Outer shell occupies [0, vCount), inner shell [vCount, 2*vCount).
  const positions = new Float32Array(p.length * 2)
  for (let i = 0; i < p.length; i += 3) {
    positions[i] = p[i]! + nrm[i]! * half
    positions[i + 1] = p[i + 1]! + nrm[i + 1]! * half
    positions[i + 2] = p[i + 2]! + nrm[i + 2]! * half
    const j = p.length + i
    positions[j] = p[i]! - nrm[i]! * half
    positions[j + 1] = p[i + 1]! - nrm[i + 1]! * half
    positions[j + 2] = p[i + 2]! - nrm[i + 2]! * half
  }

  const indices: number[] = []
  // Outer shell keeps its winding; inner shell is reversed so it faces inward.
  for (let t = 0; t < ix.length; t += 3) {
    indices.push(ix[t]!, ix[t + 1]!, ix[t + 2]!)
    indices.push(vCount + ix[t + 2]!, vCount + ix[t + 1]!, vCount + ix[t]!)
  }

  // Boundary = a directed edge whose reverse never appears — but "never
  // appears" has to be asked in POSITION space, not index space. Three.js
  // duplicates vertices along UV seams (same position, different index: an
  // open-ended CylinderGeometry(.., 12, 1, true) carries 26 indices around
  // its 12-gon rings, not 12, because the seam column is doubled), so two
  // triangles sharing a real interior edge can each hold their own copy of
  // its vertices. Comparing raw indices then finds the seam's shared edge
  // twice — once per duplicate — and misreads it as two boundary edges
  // instead of the one interior edge it actually is. Welding every index to
  // a canonical one per quantised position before building `seen` collapses
  // that back down, so detection runs in the same space the mesh is
  // geometrically continuous in. The rim itself is still emitted with the
  // ORIGINAL (unwelded) indices, so it lines up with the `positions` arrays
  // built above from the unwelded vertex count.
  const weldKeyOf = (i: number): string => {
    const o = i * 3
    // 1e4 ~ 1/10th of a millimetre at unit scale — coarse enough to close a
    // float-rounding gap between "the same" vertex duplicated by three.js,
    // fine enough not to weld two genuinely distinct vertices together.
    const qx = Math.round(p[o]! * 1e4)
    const qy = Math.round(p[o + 1]! * 1e4)
    const qz = Math.round(p[o + 2]! * 1e4)
    return `${qx}_${qy}_${qz}`
  }
  const canonicalOf = new Int32Array(vCount)
  const firstByKey = new Map<string, number>()
  for (let v = 0; v < vCount; v++) {
    const wk = weldKeyOf(v)
    let first = firstByKey.get(wk)
    if (first === undefined) { first = v; firstByKey.set(wk, v) }
    canonicalOf[v] = first
  }
  const seen = new Set<number>()
  const key = (a: number, b: number) => a * vCount + b
  for (let t = 0; t < ix.length; t += 3) {
    const a = canonicalOf[ix[t]!]!, b = canonicalOf[ix[t + 1]!]!, c = canonicalOf[ix[t + 2]!]!
    seen.add(key(a, b)); seen.add(key(b, c)); seen.add(key(c, a))
  }
  for (let t = 0; t < ix.length; t += 3) {
    const tri = [ix[t]!, ix[t + 1]!, ix[t + 2]!]
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!, b = tri[(e + 1) % 3]!
      const wa = canonicalOf[a]!, wb = canonicalOf[b]!
      if (seen.has(key(wb, wa))) continue // interior edge — shared with a neighbour, in welded space
      // Rim quad from the outer edge down to its inner twin, in the
      // ORIGINAL index space so it addresses the real position arrays.
      indices.push(a, vCount + a, vCount + b)
      indices.push(a, vCount + b, b)
    }
  }

  return { positions, indices: new Uint32Array(indices) }
}
