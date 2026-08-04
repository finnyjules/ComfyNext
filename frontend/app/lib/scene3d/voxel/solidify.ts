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

  // Boundary = a directed edge whose reverse never appears. Those are the only
  // edges with one adjacent triangle, and they are exactly the rim to stitch.
  const seen = new Set<number>()
  const key = (a: number, b: number) => a * vCount + b
  for (let t = 0; t < ix.length; t += 3) {
    const a = ix[t]!, b = ix[t + 1]!, c = ix[t + 2]!
    seen.add(key(a, b)); seen.add(key(b, c)); seen.add(key(c, a))
  }
  for (let t = 0; t < ix.length; t += 3) {
    const tri = [ix[t]!, ix[t + 1]!, ix[t + 2]!]
    for (let e = 0; e < 3; e++) {
      const a = tri[e]!, b = tri[(e + 1) % 3]!
      if (seen.has(key(b, a))) continue // interior edge — shared with a neighbour
      // Rim quad from the outer edge down to its inner twin.
      indices.push(a, vCount + a, vCount + b)
      indices.push(a, vCount + b, b)
    }
  }

  return { positions, indices: new Uint32Array(indices) }
}
