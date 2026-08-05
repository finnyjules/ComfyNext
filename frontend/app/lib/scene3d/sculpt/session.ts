// The live state of a sculpt: a mutable vertex buffer, the queries a brush runs
// against it, and per-stroke undo.
//
// THE RULE THIS CLASS EXISTS TO ENFORCE: a stroke mutates `positions` and
// nothing else. Encoding back into the document happens only in commit().
// Writing scene_state per stroke would push ~70KB of base64 through the
// persistence recency guard and the 409 stale-write path on every pointermove.
import { encodeMesh, contentDigest, type MeshData } from '~/lib/scene3d/mesh'
import { buildTriGrid, raycastGrid, type TriGrid } from '~/lib/scene3d/voxel/triGrid'
import { boundsOf } from '~/lib/scene3d/voxel/bounds'

/** Strokes kept for undo. Each entry holds only the vertices its stroke
 *  touched, so depth costs far less than 32 mesh copies. */
export const UNDO_DEPTH = 32

export class SculptSession {
  /** The working buffer. Brushes write here directly. */
  readonly positions: Float32Array
  /** Shared by reference — topology never changes during a session. */
  readonly indices: Uint32Array
  /** Recomputed once per endStroke, never per pointermove. */
  normals: Float32Array

  dirty = false

  private grid: TriGrid
  private hashCell = 0.1
  private hashDims: [number, number, number] = [1, 1, 1]
  private hashMin: [number, number, number] = [0, 0, 0]
  private hashStart = new Int32Array(1)
  private hashItems = new Int32Array(0)

  private stroke: Map<number, number> | null = null
  private strokeSnapshot: number[] = []
  private undoStack: { indices: Int32Array; values: Float32Array }[] = []

  constructor(data: MeshData) {
    this.positions = data.positions.slice()
    this.indices = data.indices
    this.normals = new Float32Array(this.positions.length)
    // Placeholder so `grid` is assigned before rebuildAcceleration replaces it
    // with one sized from the real vertex spacing.
    this.grid = buildTriGrid({ positions: this.positions, indices: this.indices }, 0.05)
    this.recomputeNormals() // pick() reads these, so they must exist before the first stroke
    this.rebuildAcceleration()
  }

  // --- queries ---------------------------------------------------------------

  /** Vertex indices within `radius` of a point. Reads the spatial hash, so this
   *  is the query a brush can afford to run on every pointermove. */
  verticesNear(x: number, y: number, z: number, radius: number): Int32Array {
    const out: number[] = []
    const r2 = radius * radius
    const lo = [0, 0, 0]
    const hi = [0, 0, 0]
    const q = [x, y, z]
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.max(0, Math.floor((q[a]! - radius - this.hashMin[a]!) / this.hashCell))
      hi[a] = Math.min(this.hashDims[a]! - 1, Math.floor((q[a]! + radius - this.hashMin[a]!) / this.hashCell))
    }
    for (let k = lo[2]!; k <= hi[2]!; k++)
      for (let j = lo[1]!; j <= hi[1]!; j++)
        for (let i = lo[0]!; i <= hi[0]!; i++) {
          const c = (k * this.hashDims[1]! + j) * this.hashDims[0]! + i
          for (let e = this.hashStart[c]!; e < this.hashStart[c + 1]!; e++) {
            const v = this.hashItems[e]!
            const dx = this.positions[v * 3]! - x
            const dy = this.positions[v * 3 + 1]! - y
            const dz = this.positions[v * 3 + 2]! - z
            if (dx * dx + dy * dy + dz * dz <= r2) out.push(v)
          }
        }
    return Int32Array.from(out)
  }

  /** Nearest surface hit along a ray, in the mesh's own object space. */
  pick(
    origin: [number, number, number], dir: [number, number, number],
  ): { point: [number, number, number]; normal: [number, number, number] } | null {
    const hit = raycastGrid(this.grid, origin, dir)
    if (!hit) return null
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
    const point: [number, number, number] = [
      origin[0] + (dir[0] / len) * hit.t,
      origin[1] + (dir[1] / len) * hit.t,
      origin[2] + (dir[2] / len) * hit.t,
    ]
    const t = hit.tri * 3
    const a = this.indices[t]!, b = this.indices[t + 1]!, c = this.indices[t + 2]!
    const nx = (this.normals[a * 3]! + this.normals[b * 3]! + this.normals[c * 3]!) / 3
    const ny = (this.normals[a * 3 + 1]! + this.normals[b * 3 + 1]! + this.normals[c * 3 + 1]!) / 3
    const nz = (this.normals[a * 3 + 2]! + this.normals[b * 3 + 2]! + this.normals[c * 3 + 2]!) / 3
    const nl = Math.hypot(nx, ny, nz) || 1
    return { point, normal: [nx / nl, ny / nl, nz / nl] }
  }

  /** Neighbour vertices of `v`, for the smooth brush. Built lazily on first use
   *  and reused for the session's lifetime — topology never changes. */
  neighboursOf(v: number): Int32Array {
    if (!this.adjacency) this.buildAdjacency()
    const s = this.adjStart![v]!
    return this.adjacency!.subarray(s, this.adjStart![v + 1]!)
  }

  private adjacency: Int32Array | null = null
  private adjStart: Int32Array | null = null

  private buildAdjacency(): void {
    const vCount = this.positions.length / 3
    const counts = new Int32Array(vCount + 1)
    const bump = (a: number) => { counts[a + 1] = counts[a + 1]! + 1 }
    for (let t = 0; t < this.indices.length; t += 3) {
      const a = this.indices[t]!, b = this.indices[t + 1]!, c = this.indices[t + 2]!
      bump(a); bump(a); bump(b); bump(b); bump(c); bump(c)
    }
    const start = new Int32Array(vCount + 1)
    for (let v = 0; v < vCount; v++) start[v + 1] = start[v]! + counts[v + 1]!
    const items = new Int32Array(start[vCount]!)
    const cursor = new Int32Array(vCount)
    const put = (a: number, b: number) => { items[start[a]! + cursor[a]!++] = b }
    for (let t = 0; t < this.indices.length; t += 3) {
      const a = this.indices[t]!, b = this.indices[t + 1]!, c = this.indices[t + 2]!
      put(a, b); put(a, c); put(b, a); put(b, c); put(c, a); put(c, b)
    }
    this.adjacency = items
    this.adjStart = start
  }

  // --- strokes ---------------------------------------------------------------

  beginStroke(): void {
    this.stroke = new Map()
    this.strokeSnapshot = []
  }

  /** Snapshot a vertex before a brush moves it. Only the FIRST call per stroke
   *  stores anything — a stroke drags across the same vertices repeatedly, and
   *  overwriting the snapshot each pass would make undo restore a mid-stroke
   *  state rather than the state before the stroke began. */
  recordVertex(v: number): void {
    if (!this.stroke || this.stroke.has(v)) return
    this.stroke.set(v, this.strokeSnapshot.length / 3)
    this.strokeSnapshot.push(
      this.positions[v * 3]!, this.positions[v * 3 + 1]!, this.positions[v * 3 + 2]!,
    )
  }

  endStroke(): void {
    if (!this.stroke) return
    if (this.stroke.size > 0) {
      this.undoStack.push({
        indices: Int32Array.from(this.stroke.keys()),
        values: Float32Array.from(this.strokeSnapshot),
      })
      if (this.undoStack.length > UNDO_DEPTH) this.undoStack.shift()
      this.dirty = true
    }
    this.stroke = null
    this.strokeSnapshot = []
    this.recomputeNormals()
    this.rebuildAcceleration()
  }

  undo(): boolean {
    const last = this.undoStack.pop()
    if (!last) return false
    for (let n = 0; n < last.indices.length; n++) {
      const v = last.indices[n]!
      this.positions[v * 3] = last.values[n * 3]!
      this.positions[v * 3 + 1] = last.values[n * 3 + 1]!
      this.positions[v * 3 + 2] = last.values[n * 3 + 2]!
    }
    this.dirty = this.undoStack.length > 0
    this.recomputeNormals()
    this.rebuildAcceleration()
    return true
  }

  // --- maintenance -----------------------------------------------------------

  /** Once per stroke end. Per-pointermove would dominate the frame. */
  recomputeNormals(): void {
    const n = this.normals
    n.fill(0)
    const p = this.positions
    for (let t = 0; t < this.indices.length; t += 3) {
      const a = this.indices[t]! * 3, b = this.indices[t + 1]! * 3, c = this.indices[t + 2]! * 3
      const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!
      const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx
      for (const o of [a, b, c]) { n[o] = n[o]! + fx; n[o + 1] = n[o + 1]! + fy; n[o + 2] = n[o + 2]! + fz }
    }
    for (let i = 0; i < n.length; i += 3) {
      const len = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1
      n[i] = n[i]! / len; n[i + 1] = n[i + 1]! / len; n[i + 2] = n[i + 2]! / len
    }
  }

  /** Rebuild the vertex hash and the pick grid against the CURRENT positions.
   *  Runs on stroke end, not per pointermove: skip it and the brush keeps
   *  picking where the surface used to be, so strokes drift off the shape. */
  private rebuildAcceleration(): void {
    const p = this.positions
    const vCount = p.length / 3
    const { lo, hi } = boundsOf({ positions: p, indices: this.indices })

    // ~8 vertices per cell on average keeps the near-query cheap without
    // exploding the cell count.
    const extent = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1e-6)
    const perAxis = Math.max(1, Math.round(Math.cbrt(vCount / 8)))
    this.hashCell = extent / perAxis
    this.hashMin = [lo[0] - this.hashCell, lo[1] - this.hashCell, lo[2] - this.hashCell]
    this.hashDims = [0, 1, 2].map((a) =>
      Math.max(1, Math.ceil((hi[a]! - lo[a]!) / this.hashCell) + 3)) as [number, number, number]

    const cellCount = this.hashDims[0] * this.hashDims[1] * this.hashDims[2]
    const cellOf = (v: number): number => {
      const i = Math.min(this.hashDims[0] - 1, Math.max(0, Math.floor((p[v * 3]! - this.hashMin[0]) / this.hashCell)))
      const j = Math.min(this.hashDims[1] - 1, Math.max(0, Math.floor((p[v * 3 + 1]! - this.hashMin[1]) / this.hashCell)))
      const k = Math.min(this.hashDims[2] - 1, Math.max(0, Math.floor((p[v * 3 + 2]! - this.hashMin[2]) / this.hashCell)))
      return (k * this.hashDims[1] + j) * this.hashDims[0] + i
    }
    const counts = new Int32Array(cellCount + 1)
    for (let v = 0; v < vCount; v++) { const c = cellOf(v) + 1; counts[c] = counts[c]! + 1 }
    const start = new Int32Array(cellCount + 1)
    for (let c = 0; c < cellCount; c++) start[c + 1] = start[c]! + counts[c + 1]!
    const items = new Int32Array(start[cellCount]!)
    const cursor = new Int32Array(cellCount)
    for (let v = 0; v < vCount; v++) { const c = cellOf(v); items[start[c]! + cursor[c]!++] = v }
    this.hashStart = start
    this.hashItems = items

    this.grid = buildTriGrid({ positions: p, indices: this.indices }, Math.max(this.hashCell, 1e-4))
  }

  // --- commit ----------------------------------------------------------------

  toMeshData(): MeshData {
    return { positions: this.positions.slice(), indices: this.indices }
  }

  /** The ONLY place the session produces document-shaped data. */
  async commit(): Promise<{ mesh: string; meshKey: string }> {
    const mesh = await encodeMesh(this.toMeshData())
    this.dirty = false
    return { mesh, meshKey: contentDigest(mesh) }
  }
}
