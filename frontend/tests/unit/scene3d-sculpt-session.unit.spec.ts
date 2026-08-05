import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { meshDataFromGeometry, contentDigest } from '~/lib/scene3d/mesh'
import { SculptSession, UNDO_DEPTH, commitSculptToDoc } from '~/lib/scene3d/sculpt/session'

const session = () =>
  new SculptSession(meshDataFromGeometry(new THREE.SphereGeometry(0.5, 48, 32)))

/** Nudge every vertex the session reports near a point, recording as we go. */
const nudge = (s: SculptSession, x: number, y: number, z: number, r: number, dy: number) => {
  const hits = s.verticesNear(x, y, z, r)
  for (let n = 0; n < hits.length; n++) {
    const i = hits[n]!
    s.recordVertex(i)
    s.positions[i * 3 + 1] += dy
  }
  return hits.length
}

/** Deterministic PRNG so a failure reproduces exactly instead of flaking. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Ground truth for verticesNear: a plain linear scan over every vertex. */
const bruteNear = (s: SculptSession, x: number, y: number, z: number, radius: number): number[] => {
  const out: number[] = []
  const r2 = radius * radius
  for (let v = 0; v < s.positions.length / 3; v++) {
    const dx = s.positions[v * 3]! - x
    const dy = s.positions[v * 3 + 1]! - y
    const dz = s.positions[v * 3 + 2]! - z
    if (dx * dx + dy * dy + dz * dz <= r2) out.push(v)
  }
  return out
}

/** Asserts verticesNear returns EXACTLY the brute-force set — not a superset
 *  or subset — across edge-case and randomised query points/radii. An
 *  off-by-one in the cell-range clamp would silently drop in-radius vertices
 *  near a cell boundary, which reads as a soft-edged brush, not a crash. */
const assertVerticesNearMatchesBruteForce = (s: SculptSession) => {
  const rng = mulberry32(0xc0ffee)
  const cases: Array<[number, number, number, number]> = [
    [0, 0.5, 0, 1e-4],   // radius far smaller than vertex spacing
    [0, 0.5, 0, 5],      // radius larger than the whole mesh
    [3, 3, 3, 0.5],      // query point well outside the mesh
    [3, 3, 3, 10],       // outside point, radius that reaches the whole mesh
  ]
  for (let n = 0; n < 100; n++) {
    cases.push([
      (rng() - 0.5) * 3, (rng() - 0.5) * 3, (rng() - 0.5) * 3,
      rng() * 1.5,
    ])
  }
  for (const [x, y, z, r] of cases) {
    const got = Array.from(s.verticesNear(x, y, z, r)).sort((a, b) => a - b)
    const want = bruteNear(s, x, y, z, r).sort((a, b) => a - b)
    expect(got).toEqual(want)
  }
}

describe('sculpt session', () => {
  it('finds only vertices inside the radius, and more as it grows', () => {
    const s = session()
    const small = s.verticesNear(0, 0.5, 0, 0.1)
    const large = s.verticesNear(0, 0.5, 0, 0.3)
    expect(small.length).toBeGreaterThan(0)
    expect(large.length).toBeGreaterThan(small.length)
    for (let n = 0; n < small.length; n++) {
      const i = small[n]!
      const d = Math.hypot(
        s.positions[i * 3]! - 0, s.positions[i * 3 + 1]! - 0.5, s.positions[i * 3 + 2]! - 0,
      )
      expect(d).toBeLessThanOrEqual(0.1 + 1e-6)
    }
  })

  it('verticesNear matches an exhaustive linear scan exactly, over 100+ random queries', () => {
    const s = session()
    assertVerticesNearMatchesBruteForce(s)
  })

  it('verticesNear still matches an exhaustive scan after a stroke rebuilds the hash', () => {
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.25, 0.15); s.endStroke()
    assertVerticesNearMatchesBruteForce(s)
  })

  it('undo restores the exact prior positions', () => {
    const s = session()
    const before = s.positions.slice()
    s.beginStroke()
    expect(nudge(s, 0, 0.5, 0, 0.2, 0.05)).toBeGreaterThan(0)
    s.endStroke()
    expect(s.positions).not.toEqual(before)
    expect(s.undo()).toBe(true)
    expect(s.positions).toEqual(before) // exact, not approximate
  })

  it('records each vertex once per stroke, so undo survives repeated passes', () => {
    // A stroke drags across the same vertices many times. If recordVertex
    // overwrote the snapshot each pass, undo would restore a MID-stroke state.
    const s = session()
    const before = s.positions.slice()
    s.beginStroke()
    nudge(s, 0, 0.5, 0, 0.2, 0.02)
    nudge(s, 0, 0.5, 0, 0.2, 0.02)
    nudge(s, 0, 0.5, 0, 0.2, 0.02)
    s.endStroke()
    expect(s.undo()).toBe(true)
    expect(s.positions).toEqual(before)
  })

  it('undoes strokes one at a time, most recent first', () => {
    const s = session()
    const before = s.positions.slice()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    const afterFirst = s.positions.slice()
    s.beginStroke(); nudge(s, 0.5, 0, 0, 0.2, 0.05); s.endStroke()
    expect(s.undo()).toBe(true)
    expect(s.positions).toEqual(afterFirst)
    expect(s.undo()).toBe(true)
    expect(s.positions).toEqual(before)
    expect(s.undo()).toBe(false) // nothing left
  })

  it('keeps at most UNDO_DEPTH strokes', () => {
    const s = session()
    for (let n = 0; n < UNDO_DEPTH + 5; n++) {
      s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.001); s.endStroke()
    }
    let undone = 0
    while (s.undo()) undone++
    expect(undone).toBe(UNDO_DEPTH)
  })

  it('tracks dirty across strokes and commit', async () => {
    const s = session()
    expect(s.dirty).toBe(false)
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    expect(s.dirty).toBe(true)
    await s.commit()
    expect(s.dirty).toBe(false)
  })

  it('is dirty after an undo that follows a commit (mesh no longer matches encoded doc)', async () => {
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    await s.commit()
    expect(s.dirty).toBe(false)
    s.undo()
    expect(s.dirty).toBe(true)
  })

  it('stays clean after a commit with no further edits', async () => {
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    await s.commit()
    expect(s.dirty).toBe(false)
  })

  it('is clean after undoing back to a state that was never committed', () => {
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    expect(s.dirty).toBe(true)
    s.undo()
    expect(s.dirty).toBe(false)
  })

  it('is dirty after undoing one of two committed strokes', async () => {
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    s.beginStroke(); nudge(s, 0.5, 0, 0, 0.2, 0.05); s.endStroke()
    await s.commit()
    expect(s.dirty).toBe(false)
    s.undo()
    expect(s.dirty).toBe(true)
  })

  it('is dirty when a new stroke replaces one that was undone after a commit (diamond case)', async () => {
    // stroke A, stroke B, commit, undo (back to A), stroke C: a naive
    // increment-on-stroke/decrement-on-undo counter would land back on B's
    // version number even though the content is now A+C, not A+B.
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke() // A
    s.beginStroke(); nudge(s, 0.5, 0, 0, 0.2, 0.05); s.endStroke() // B
    await s.commit()
    s.undo() // back to A
    s.beginStroke(); nudge(s, -0.5, 0, 0, 0.2, 0.05); s.endStroke() // C
    expect(s.dirty).toBe(true)
  })

  it('commit returns a payload whose digest matches', async () => {
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    const { mesh, meshKey } = await s.commit()
    expect(meshKey).toBe(contentDigest(mesh))
  })

  it('markDirty flips dirty to true on a freshly constructed session with no stroke', () => {
    // Gap 4 (in-panel Remesh): a remesh rebuilds a brand new SculptSession,
    // which is born clean (editVersion === committedVersion, both 0) exactly
    // like ordinary sculpt entry — but the new buffer already differs from
    // doc.objects (new topology, not an edited old one), so it must read
    // dirty immediately or a bare Exit right after Remesh would silently
    // discard it.
    const s = session()
    expect(s.dirty).toBe(false)
    s.markDirty()
    expect(s.dirty).toBe(true)
  })

  it('a session built from a remesh result starts with an empty undo ring', () => {
    // Hazard 2: undo entries hold {vertexIndex, oldPosition} against the OLD
    // topology, so replaying them post-remesh would scatter the mesh into
    // garbage. `remeshSculptSession` (Scene3DStudioSurface.vue) handles this
    // by constructing a brand new SculptSession rather than mutating one in
    // place — this asserts that construction path really does start clean.
    const s = session()
    s.beginStroke(); s.recordVertex(0); s.positions[0]! += 0.1; s.endStroke()
    expect(s.undo()).toBe(true) // the OLD session has undo history
    const fresh = new SculptSession(meshDataFromGeometry(new THREE.SphereGeometry(0.4, 32, 24)))
    expect(fresh.undo()).toBe(false) // the NEW one (a stand-in for a remesh result) has none
  })

  it('picks a ray aimed at the surface and misses one that is not', () => {
    const s = session()
    const hit = s.pick([0, 3, 0], [0, -1, 0])
    expect(hit).not.toBeNull()
    expect(hit!.point[1]).toBeCloseTo(0.5, 1)
    expect(s.pick([0, 3, 0], [0, 1, 0])).toBeNull() // pointing away
  })

  it('re-picks correctly after a stroke moved the surface', () => {
    // The pick structure is rebuilt on endStroke. Without that, the brush keeps
    // hitting where the surface USED to be and strokes drift off the shape.
    const s = session()
    const before = s.pick([0, 3, 0], [0, -1, 0])!
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.25, 0.2); s.endStroke()
    const after = s.pick([0, 3, 0], [0, -1, 0])!
    expect(after.point[1]).toBeGreaterThan(before.point[1] + 0.1)
  })
})

// Task 13 review, finding 1 (Important — silent data loss): `commitSculptSession`
// (Scene3DStudioSurface.vue) used to call `session.commit()` directly, which marks
// the session clean the instant the buffer is ENCODED. But the caller still had to
// warm the mesh cache and splice the result into `doc.objects` — either could fail
// AFTER that point, leaving `dirty` false while nothing was actually persisted. The
// next Save would then see a clean session, skip re-encoding via its own
// `!session.dirty` guard, and flash success while silently persisting the stale
// pre-sculpt doc forever. These pin `commitSculptToDoc`, the wrapper the surface now
// goes through instead, which must keep `dirty` truthful across every one of those
// failure shapes.
describe('commitSculptToDoc', () => {
  it('stays dirty when the encode succeeds but the downstream write throws', async () => {
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    expect(s.dirty).toBe(true)
    await expect(
      commitSculptToDoc(s, async () => { throw new Error('doc write failed') }),
    ).rejects.toThrow('doc write failed')
    // The failure happened strictly AFTER commit() encoded (and would, on its
    // own, have marked the session clean) — this is the exact case finding 1
    // covers: dirty must not read false when nothing landed anywhere.
    expect(s.dirty).toBe(true)
  })

  it('stays dirty when write reports no matching object (removed from the doc mid-sculpt)', async () => {
    // The accompanying Minor: `doc.objects.findIndex` coming back -1 (object
    // deleted while the session was open) is the same "nothing was actually
    // persisted" shape as a throw, and must be covered by the same fix.
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    const ok = await commitSculptToDoc(s, async () => false)
    expect(ok).toBe(false)
    expect(s.dirty).toBe(true)
  })

  it('a session left dirty by a failed commit is still committable on the next attempt', async () => {
    // Not just that `dirty` reads true — the working buffer itself must
    // survive untouched so a retry actually has something correct to send.
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    const positionsBefore = s.positions.slice()
    await commitSculptToDoc(s, async () => { throw new Error('boom') }).catch(() => {})
    expect(s.positions).toEqual(positionsBefore)
    const ok = await commitSculptToDoc(s, async () => true) // retry succeeds
    expect(ok).toBe(true)
    expect(s.dirty).toBe(false)
  })

  it('clears dirty once the write actually lands', async () => {
    const s = session()
    s.beginStroke(); nudge(s, 0, 0.5, 0, 0.2, 0.05); s.endStroke()
    const ok = await commitSculptToDoc(s, async () => true)
    expect(ok).toBe(true)
    expect(s.dirty).toBe(false)
  })

  it('no-ops on a clean session without calling write at all', async () => {
    const s = session()
    expect(s.dirty).toBe(false)
    let called = false
    const ok = await commitSculptToDoc(s, () => { called = true; return true })
    expect(ok).toBe(true)
    expect(called).toBe(false)
  })
})
