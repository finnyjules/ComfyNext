// The brushes. All of them share one loop — gather the vertices in range,
// weight each by its falloff, displace — and differ only in the direction they
// push. Keeping that loop in one place is what makes adding a brush a few lines
// rather than a new file.
import type { SculptSession } from '~/lib/scene3d/sculpt/session'

export type BrushKind = 'draw' | 'smooth' | 'inflate' | 'flatten'

export interface BrushStamp {
  /** Where the brush touches the surface, in the mesh's object space. */
  centre: [number, number, number]
  /** Surface normal at `centre`. Used by `draw`; ignored by `inflate`, which
   *  reads each vertex's own normal instead. */
  normal: [number, number, number]
  radius: number
  /** 0–1. `draw` and `inflate` add an absolute offset, so they scale this by
   *  `radius` to feel the same at any brush size. `smooth` and `flatten`
   *  instead pull a FRACTION of the way toward a geometry-derived target (the
   *  neighbour average, or the region's plane) — `strength` already IS that
   *  fraction, so multiplying by `radius` again would make the same value
   *  over- or under-smooth depending on brush size. Deliberately NOT
   *  radius-scaled for those two. */
  strength: number
  /** Alt-held: carve inward instead of pushing outward. */
  invert: boolean
}

/** 1 at the centre, 0 at the rim, smooth at both ends. Squaring keeps the
 *  centre plateau-ish so a stroke does not leave a spike at its midpoint. */
export function falloff(t: number): number {
  // NaN fails every comparison (including `>=`), so it would otherwise fall
  // through this guard and come back out as NaN instead of 0 — exported, so
  // guard it here too, not just at the one call site in `applyBrush`.
  if (Number.isNaN(t) || t >= 1) return 0
  const u = 1 - t * t
  return u * u
}

export function applyBrush(session: SculptSession, kind: BrushKind, stamp: BrushStamp): void {
  // A zero (or negative) radius makes `d / stamp.radius` a 0/0 NaN for any
  // vertex `verticesNear` returns sitting exactly at `stamp.centre` (its `r2`
  // test passes on exact coincidence even when `r2` is 0). NaN then defeats
  // BOTH guards below: `falloff`'s `t >= 1` and this function's `w <= 0` are
  // both false for NaN (every comparison with NaN is false), so it falls
  // through and gets written into `positions`. Bail before any of that runs.
  if (stamp.radius <= 0) return
  const [cx, cy, cz] = stamp.centre
  const hits = session.verticesNear(cx, cy, cz, stamp.radius)
  if (hits.length === 0) return
  const p = session.positions
  const sign = stamp.invert ? -1 : 1
  const scale = stamp.strength * stamp.radius

  // `flatten` needs the region's average plane before it can move anything, so
  // it takes one gathering pass first.
  let planeY = 0
  let pnx = 0, pny = 0, pnz = 0
  if (kind === 'flatten') {
    let ax = 0, ay = 0, az = 0
    for (let n = 0; n < hits.length; n++) {
      const v = hits[n]!
      ax += p[v * 3]!; ay += p[v * 3 + 1]!; az += p[v * 3 + 2]!
      pnx += session.normals[v * 3]!
      pny += session.normals[v * 3 + 1]!
      pnz += session.normals[v * 3 + 2]!
    }
    const inv = 1 / hits.length
    ax *= inv; ay *= inv; az *= inv
    const nl = Math.hypot(pnx, pny, pnz) || 1
    pnx /= nl; pny /= nl; pnz /= nl
    // Signed distance of the plane from the origin along its normal.
    planeY = ax * pnx + ay * pny + az * pnz
  }

  for (let n = 0; n < hits.length; n++) {
    const v = hits[n]!
    const x = p[v * 3]!, yy = p[v * 3 + 1]!, z = p[v * 3 + 2]!
    const d = Math.hypot(x - cx, yy - cy, z - cz)
    const w = falloff(d / stamp.radius)
    if (w <= 0) continue

    let dx = 0, dy = 0, dz = 0
    if (kind === 'draw') {
      dx = stamp.normal[0] * w * scale * sign
      dy = stamp.normal[1] * w * scale * sign
      dz = stamp.normal[2] * w * scale * sign
    } else if (kind === 'inflate') {
      // The vertex's OWN normal — that is the whole difference from `draw`, and
      // what makes this expand a form rather than push one side of it.
      dx = session.normals[v * 3]! * w * scale * sign
      dy = session.normals[v * 3 + 1]! * w * scale * sign
      dz = session.normals[v * 3 + 2]! * w * scale * sign
    } else if (kind === 'smooth') {
      // KNOWN DEFECT (carried from Task 10): `neighboursOf` lists one entry per
      // incident triangle, so a vertex shared by N triangles appears N times.
      // Averaging that list directly over-weights high-valence neighbours and
      // biases smoothing toward them instead of pulling uniformly toward the
      // surrounding surface. Dedupe before averaging — every distinct neighbour
      // counts exactly once, regardless of how many triangles it touches.
      const nb = session.neighboursOf(v)
      if (nb.length === 0) continue
      const seen = new Set<number>()
      let mx = 0, my = 0, mz = 0, count = 0
      for (let k = 0; k < nb.length; k++) {
        const u = nb[k]!
        if (seen.has(u)) continue
        seen.add(u)
        mx += p[u * 3]!; my += p[u * 3 + 1]!; mz += p[u * 3 + 2]!
        count++
      }
      if (count === 0) continue
      const inv = 1 / count
      dx = (mx * inv - x) * w * stamp.strength
      dy = (my * inv - yy) * w * stamp.strength
      dz = (mz * inv - z) * w * stamp.strength
    } else { // flatten
      const along = x * pnx + yy * pny + z * pnz
      const pull = (planeY - along) * w * stamp.strength
      dx = pnx * pull; dy = pny * pull; dz = pnz * pull
    }

    // ALWAYS before the write — undo depends on it.
    session.recordVertex(v)
    p[v * 3] = x + dx
    p[v * 3 + 1] = yy + dy
    p[v * 3 + 2] = z + dz
  }
}
