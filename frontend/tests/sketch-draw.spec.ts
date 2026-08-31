// tests/sketch-draw.spec.ts
import { test, expect } from '@playwright/test'

test('draw a line and a tangent circle via the API, then drag keeps it solved', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    // draw a horizontal-ish line: two clicks
    D.setTool('line'); D.place(1, 2); D.place(12, 2)
    // draw a circle whose radius lands it tangent to that line:
    // center at (6,5), then a radius click 3 below → r≈3, bottom touches y=2 line
    D.setTool('circle'); D.place(6, 5); D.place(6, 2)
  })

  const info = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    return { ents: D.entityCount(), cons: D.constraintCount(), doc: D.doc }
  })
  // line(1) + its 2 pts + circle(1) + its center pt = 5 entities; at least the tangent constraint exists
  expect(info.ents).toBeGreaterThanOrEqual(5)
  expect(info.cons).toBeGreaterThanOrEqual(1)

  // perpendicular distance from the circle's center to the line == radius (tangent)
  const perp = () => page.evaluate(() => {
    const d = (window as any).__sketchDraw.doc
    const line = d.entities.find((e: any) => e.kind === 'line')
    const circle = d.entities.find((e: any) => e.kind === 'circle')
    const P = (id: string) => d.entities.find((e: any) => e.id === id)
    const a = P(line.p1), b = P(line.p2), c = P(circle.center)
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy)
    return { perp: Math.abs((dx * (c.y - a.y) - dy * (c.x - a.x)) / L), r: circle.r }
  })
  const before = await perp()
  expect(Math.abs(before.perp - before.r)).toBeLessThan(0.05)

  // drag the second line endpoint; tangency must survive
  await page.evaluate(() => {
    const d = (window as any).__sketchDraw.doc
    const line = d.entities.find((e: any) => e.kind === 'line')
    ;(window as any).__sketchDraw.drag(line.p2, 12, 6)
  })
  const after = await perp()
  expect(after.perp).toBeCloseTo(after.r, 1)
})

test('select two circles and apply concentric via the API', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('circle'); D.place(3, 5); D.place(3, 7)   // circle A, center (3,5)
    D.setTool('circle'); D.place(9, 5); D.place(9, 6)   // circle B, center (9,5) elsewhere
  })

  // select both circles, assert 'concentric' is an available verb, apply it
  const verbs = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    const circles = D.doc.entities.filter((e: any) => e.kind === 'circle')
    D.clearSel(); D.pick(circles[0].id); D.pick(circles[1].id, true)
    return D.availableConstraints().map((v: any) => v.kind)
  })
  expect(verbs).toContain('concentric')

  await page.evaluate(() => (window as any).__sketchDraw.apply('concentric'))

  const centers = await page.evaluate(() => {
    const d = (window as any).__sketchDraw.doc
    const cs = d.entities.filter((e: any) => e.kind === 'circle')
    const C = (id: string) => d.entities.find((e: any) => e.id === id)
    return cs.map((c: any) => C(c.center))
  })
  // concentric ⇒ the two centers coincide
  expect(Math.hypot(centers[0].x - centers[1].x, centers[0].y - centers[1].y)).toBeLessThan(0.01)
})

test('knot: unit path repeated 6x stays symmetric and welded under drag', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const result = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    // center (fixed) via point tool then fix through the doc
    D.setTool('point'); D.place(8, 6)
    const ctr = D.doc.entities.find((e: any) => e.kind === 'point').id
    D.doc.entities.find((e: any) => e.id === ctr).fixed = true
    // unit: line up + arc over — drawn with the path tool API
    D.setTool('path')
    D.place(8, 1); D.place(8, 3)                     // line segment
    D.setNextSegment('arc'); D.place(10.5, 4.5)      // arc segment
    D.finishPath(false)
    const path = D.doc.entities.find((e: any) => e.kind === 'path')
    // repeat 6x about the center
    D.repeat([path.id], ctr, 6)
    const paths = D.doc.entities.filter((e: any) => e.kind === 'path')
    const rotCount = D.doc.constraints.filter((c: any) => c.kind === 'rotatedFrom').length
    // drag the unit's outer anchor; symmetry must hold through the rules
    const outer = path.anchors[2]
    D.drag(outer, 11, 5.5)
    // check: every 60° copy of `outer` equals rotate(outer, k*60) about ctr
    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    const o = P(outer), c = P(ctr)
    let maxErr = 0
    for (const k of [1, 2, 3, 4, 5]) {
      const con = D.doc.constraints.find((x: any) => x.kind === 'rotatedFrom' && x.refs[1] === outer && Math.round(x.value) === k * 60)
      const cp = P(con.refs[0])
      const a = k * 60 * Math.PI / 180
      const rx = c.x + Math.cos(a) * (o.x - c.x) - Math.sin(a) * (o.y - c.y)
      const ry = c.y + Math.sin(a) * (o.x - c.x) + Math.cos(a) * (o.y - c.y)
      maxErr = Math.max(maxErr, Math.hypot(cp.x - rx, cp.y - ry))
    }
    return { paths: paths.length, rotCount, maxErr, status: D.status(), svg: D.copySvg().length }
  })

  expect(result.paths).toBe(6)
  expect(result.rotCount).toBeGreaterThanOrEqual(15)   // ≥3 pts × 5 copies
  expect(result.maxErr).toBeLessThan(0.01)             // symmetry held under drag
  expect(result.svg).toBeGreaterThan(50)               // real SVG came out
})

test('path: click-and-drag bows a segment into a circular arc', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const result = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('path')
    D.pathDown(2, 2); D.pathUp(2, 2)          // first anchor, plain click
    D.pathDown(8, 2)                          // second anchor — appends a line segment
    D.pathMove(5, 4.5)                        // drag past the threshold → bows live
    D.pathUp(5, 4.5)                          // release → commits the arc
    D.finishPath(false)
    const path = D.doc.entities.find((e: any) => e.kind === 'path')
    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    const arcSeg = path.segments.find((s: any) => s.kind === 'arc')
    const center = arcSeg ? P(arcSeg.center) : null
    const p0 = P(path.anchors[0]), p1 = P(path.anchors[1])
    const dCenter = center ? Math.abs(Math.hypot(center.x - p0.x, center.y - p0.y) - Math.hypot(center.x - p1.x, center.y - p1.y)) : Infinity
    return { hasArc: !!arcSeg, dCenter, pathData: D.pathData() }
  })

  expect(result.hasArc).toBe(true)
  expect(result.dCenter).toBeLessThan(1e-6)
  expect(result.pathData).toContain(' A ')
})

test('tangent joint: arc snaps tangent to the previous line and stays smooth', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('path')
    // a horizontal line a→J
    D.pathDown(1, 3); D.pathUp(1, 3)
    D.pathDown(6, 3); D.pathUp(6, 3)              // J = (6,3), segment 0 = line
    // bow an arc off J, dragging near-tangent (pointer near the exact-tangent
    // circle's own boundary point (8,5) — see m3-task-2's report: the brief's
    // literal pointer here (6.2,5) is only 0.2 off the straight J→Pnew chord,
    // which is ~78° off tangentDir under the documented free-arc-tangent-angle
    // rule (verified against ~/lib/sketch/infer.ts directly, and the identical
    // shape/tolerance is exercised by tests/unit/sketch-tangent-joint.unit.spec.ts's
    // own (2.2,2)-vs-(3,2) fixtures for the same span=4 case) — so it can never
    // snap. 8.2 mirrors that fix, translated to this J=(6,3): ~5.4° off horizontal,
    // inside the 12° tolerance)
    D.pathDown(6, 7)                               // Pnew above
    D.pathMove(8.2, 5)                             // near-tangent bulge
    D.pathUp(8.2, 5)
    D.finishPath(false)
    const path = D.doc.entities.find((e: any) => e.kind === 'path')
    const perpRule = D.doc.constraints.find((c: any) => c.kind === 'perpendicular')
    // tangent invariant: at J, the line direction ⊥ (arcCenter − J)
    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    const arcSeg = path.segments[1]
    const J = P(path.anchors[1]), C = P(arcSeg.center), La = P(path.anchors[0])
    const lineDir = { x: J.x - La.x, y: J.y - La.y }
    const radial = { x: C.x - J.x, y: C.y - J.y }
    const dotBefore = Math.abs(lineDir.x * radial.x + lineDir.y * radial.y)
    // now drag the line's far endpoint; tangency must hold
    D.drag(path.anchors[0], 1, 5)
    const J2 = P(path.anchors[1]), C2 = P(arcSeg.center), La2 = P(path.anchors[0])
    const ld2 = { x: J2.x - La2.x, y: J2.y - La2.y }, rd2 = { x: C2.x - J2.x, y: C2.y - J2.y }
    const dotAfter = Math.abs(ld2.x * rd2.x + ld2.y * rd2.y)
    return { hasPerp: !!perpRule, segKinds: path.segments.map((s: any) => s.kind), dotBefore, dotAfter, d: D.pathData() }
  })

  expect(out.segKinds).toEqual(['line', 'arc'])
  expect(out.hasPerp).toBe(true)                 // tangent joint captured
  expect(out.dotBefore).toBeLessThan(0.01)       // tangent at commit (line ⊥ radius)
  expect(out.dotAfter).toBeLessThan(0.05)        // still tangent after dragging the line
  expect(out.d).toContain(' A ')
})

test('select two lines at an angle and apply perpendicular via the API', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    // two lines at an arbitrary (non-perpendicular, non-parallel) angle
    D.setTool('line'); D.place(1, 1); D.place(8, 2)     // line A, shallow slope
    D.setTool('line'); D.place(2, 6); D.place(6, 9)      // line B, steep slope

    const lines = D.doc.entities.filter((e: any) => e.kind === 'line')
    D.clearSel(); D.pick(lines[0].id); D.pick(lines[1].id, true)
    const verbs = D.availableConstraints().map((v: any) => v.kind)

    D.apply('perpendicular')

    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    const [l1, l2] = lines.map((l: any) => ({ p1: P(l.p1), p2: P(l.p2) }))
    const dot = (l1.p2.x - l1.p1.x) * (l2.p2.x - l2.p1.x) + (l1.p2.y - l1.p1.y) * (l2.p2.y - l2.p1.y)
    return { verbs, cons: D.constraintCount(), status: D.status(), dot }
  })

  expect(out.verbs).toContain('perpendicular')
  expect(out.verbs).toContain('parallel')
  expect(out.status).toMatch(/^solved/)
  expect(Math.abs(out.dot)).toBeLessThan(0.01)   // direction vectors now orthogonal
})

test('select a bent path\'s corner and apply Right angle via the API', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    // a bent path — 3 anchors, 2 line segments, an arbitrary non-90 corner
    // angle. pathDown/pathUp with no move in between keeps both segments
    // straight lines (no bow past the drag threshold).
    D.setTool('path')
    D.pathDown(1, 1); D.pathUp(1, 1)      // a0
    D.pathDown(5, 1); D.pathUp(5, 1)      // a1 — corner
    D.pathDown(7, 5); D.pathUp(7, 5)      // a2
    D.finishPath(false)

    const path = D.doc.entities.find((e: any) => e.kind === 'path')
    const corner = path.anchors[1]

    D.clearSel(); D.pick(corner)
    const verbs = D.availableConstraints()
    const hasRightAngle = verbs.some((v: any) => v.kind === 'perpendicular' && v.label === 'Right angle')

    D.apply('perpendicular')

    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    const a0 = P(path.anchors[0]), a1 = P(path.anchors[1]), a2 = P(path.anchors[2])
    const u = { x: a1.x - a0.x, y: a1.y - a0.y }
    const v = { x: a2.x - a1.x, y: a2.y - a1.y }
    const dot = u.x * v.x + u.y * v.y
    return { hasRightAngle, segKinds: path.segments.map((s: any) => s.kind), status: D.status(), dot }
  })

  expect(out.segKinds).toEqual(['line', 'line'])
  expect(out.hasRightAngle).toBe(true)
  expect(out.status).toMatch(/^solved/)
  expect(Math.abs(out.dot)).toBeLessThan(0.01)   // the two segment directions are now orthogonal
})

test('path: Shift constrains a placed segment to the nearest 45° increment', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('path')
    D.pathDown(2, 2); D.pathUp(2, 2)      // first anchor, plain click
    // shift-place near-horizontal — should snap the segment flat to y=2
    D.placeShift(9, 2.4)
    D.pathUp(9, 2.4)
    D.finishPath(false)
    const path = D.doc.entities.find((e: any) => e.kind === 'path')
    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    const a0 = P(path.anchors[0]), a1 = P(path.anchors[1])
    return { a0, a1, segKinds: path.segments.map((s: any) => s.kind) }
  })

  expect(out.segKinds).toEqual(['line'])
  // axis-aligned: dy is (near-)zero, dx is not — the raw click's dy (0.4) is gone
  expect(Math.abs(out.a1.y - out.a0.y)).toBeLessThan(1e-6)
  expect(out.a1.y).toBeCloseTo(2, 6)
  expect(Math.abs(out.a1.x - out.a0.x)).toBeGreaterThan(1)
})

test('path: Shift snaps a near-vertical segment to exactly vertical', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('path')
    D.pathDown(3, 1); D.pathUp(3, 1)      // first anchor
    // shift-place near-vertical (small x drift) — should snap flat to x=3
    D.placeShift(3.3, 8)
    D.pathUp(3.3, 8)
    D.finishPath(false)
    const path = D.doc.entities.find((e: any) => e.kind === 'path')
    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    const a0 = P(path.anchors[0]), a1 = P(path.anchors[1])
    return { a0, a1 }
  })

  expect(Math.abs(out.a1.x - out.a0.x)).toBeLessThan(1e-6)
  expect(out.a1.x).toBeCloseTo(3, 6)
  expect(Math.abs(out.a1.y - out.a0.y)).toBeGreaterThan(1)
})

test('path: Shift-snapped horizontal segment captures a persistent constraint that survives dragging', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('path')
    D.pathDown(3, 3); D.pathUp(3, 3)      // prev anchor
    // shift-place near-horizontal — snaps flat, and should now also capture
    // a `horizontal` constraint on the two anchor points (not just the position)
    D.placeShift(11, 3.4)
    D.pathUp(11, 3.4)
    D.finishPath(false)
    const path = D.doc.entities.find((e: any) => e.kind === 'path')
    const a0id = path.anchors[0], a1id = path.anchors[1]
    const hasHorizontal = D.doc.constraints.some((c: any) =>
      c.kind === 'horizontal' && c.refs.includes(a0id) && c.refs.includes(a1id))

    // drag one endpoint off-axis; the solver should snap it back onto the horizontal
    D.drag(a1id, 11, 9)

    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    const a0 = P(a0id), a1 = P(a1id)
    return { hasHorizontal, a0, a1, status: D.status() }
  })

  expect(out.hasHorizontal).toBe(true)
  expect(out.status).toMatch(/^solved/)
  expect(Math.abs(out.a1.y - out.a0.y)).toBeLessThan(0.01)
})

test('undo/redo restores and reapplies drawing state', async ({ page }) => {
  await page.goto('/dev/sketch-draw'); await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)
  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('point'); D.place(2, 2); D.place(5, 5)   // two points
    const after2 = D.entityCount()
    D.undo()                                            // remove 2nd point
    const afterUndo = D.entityCount()
    D.redo()                                            // bring it back
    const afterRedo = D.entityCount()
    D.undo(); D.undo()                                  // back to empty (both points gone)
    return { after2, afterUndo, afterRedo, afterTwoUndo: D.entityCount() }
  })
  expect(out.after2).toBe(2)
  expect(out.afterUndo).toBe(1)
  expect(out.afterRedo).toBe(2)
  expect(out.afterTwoUndo).toBe(0)
})

test('path tool: removeLastAnchor steps back one anchor, cancelPath fully aborts with no ghost on undo', async ({ page }) => {
  await page.goto('/dev/sketch-draw'); await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)
  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    const baseline = D.entityCount()
    D.setTool('path')
    D.pathDown(1, 1); D.pathUp(1, 1)   // anchor 0 — its own committed history entry
    D.pathDown(4, 1); D.pathUp(4, 1)   // anchor 1 — another committed history entry
    const afterTwo = D.entityCount()
    const pendingAfterTwo = D.doc.entities.filter((e: any) => e.kind === 'point').length

    D.removeLastAnchor()               // back to 1 anchor — still pending, not cancelled; commits
    const pendingAfterBackspace = D.doc.entities.filter((e: any) => e.kind === 'point').length

    D.cancelPath()                     // abort entirely — deletes anchor 0 too; must ALSO commit,
                                        // or the next undo() below would skip straight over this
                                        // step and resurrect the already-removed anchor 1 (the
                                        // ghost-on-undo bug the brief calls out)
    const afterCancel = D.entityCount()
    const pathsAfterCancel = D.doc.entities.filter((e: any) => e.kind === 'path').length

    // one undo() should land on the state right before cancelPath (anchor 0
    // alone, baseline+1) — NOT jump past it back to baseline+2 (both anchors,
    // including the already-removed anchor 1 reappearing as a ghost)
    D.undo()
    const afterUndo = D.entityCount()

    return { baseline, afterTwo, pendingAfterTwo, pendingAfterBackspace, afterCancel, pathsAfterCancel, afterUndo }
  })

  expect(out.afterTwo).toBe(out.baseline + 2)          // two anchor points placed
  expect(out.pendingAfterTwo).toBe(2)
  expect(out.pendingAfterBackspace).toBe(1)             // removeLastAnchor dropped anchor 1
  expect(out.pathsAfterCancel).toBe(0)                  // no path entity ever committed
  expect(out.afterCancel).toBe(out.baseline)            // back to baseline — anchor 0 cleaned up too
  expect(out.afterUndo).toBe(out.baseline + 1)          // steps back ONE state (anchor 0), no ghost jump
})

test('path tool: selectTool (toolbar tool switch) cleans up a pending path AND commits — no ghost anchor on undo', async ({ page }) => {
  await page.goto('/dev/sketch-draw'); await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)
  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    const baseline = D.entityCount()
    D.setTool('path')
    D.pathDown(1, 1); D.pathUp(1, 1)   // anchor 0 — its own committed history entry
    D.pathDown(4, 1); D.pathUp(4, 1)   // anchor 1 — another committed history entry
    const afterTwo = D.entityCount()
    const idsAfterTwo = D.doc.entities.map((e: any) => e.id).sort()

    // real repro: click a DIFFERENT toolbar tool button mid-draw — setTool()
    // is the exact path selectTool() takes, wired to the toolbar's @click.
    // Both pending anchors are unreferenced (no path ever committed) so
    // cleanupPendingPath deletes them both — this call MUST also commit, or
    // the deletion never lands its own history entry and a single undo()
    // below jumps to a stale intermediate snapshot, resurrecting anchor 0
    // alone as an orphan ghost (present in the doc, but no longer part of
    // any pending path or committed path — selectTool already reset
    // pendingPath to null).
    D.setTool('point')
    const afterSwitch = D.entityCount()
    const pathsAfterSwitch = D.doc.entities.filter((e: any) => e.kind === 'path').length

    // one undo() must land EXACTLY on the full state right before the switch
    // (both anchors, matching what was actually on screen) — not a partial
    // ghost state with only one of the two deleted anchors resurrected.
    D.undo()
    const afterUndo = D.entityCount()
    const idsAfterUndo = D.doc.entities.map((e: any) => e.id).sort()

    return { baseline, afterTwo, idsAfterTwo, afterSwitch, pathsAfterSwitch, afterUndo, idsAfterUndo }
  })

  expect(out.afterTwo).toBe(out.baseline + 2)
  expect(out.afterSwitch).toBe(out.baseline)              // both pending anchors cleaned up on tool switch
  expect(out.pathsAfterSwitch).toBe(0)                    // no path entity ever committed
  expect(out.afterUndo).toBe(out.afterTwo)                // undo restores the FULL prior state...
  expect(out.idsAfterUndo).toEqual(out.idsAfterTwo)       // ...both original anchors, not a partial ghost
})

test('select a point and nudge() moves it by a world delta; undo restores it', async ({ page }) => {
  await page.goto('/dev/sketch-draw'); await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)
  const out = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('point'); D.place(4, 4)
    const pt = D.doc.entities.find((e: any) => e.kind === 'point')
    const before = { x: pt.x, y: pt.y }

    D.clearSel(); D.pick(pt.id)
    D.nudge(1, 0)
    const P = (id: string) => D.doc.entities.find((e: any) => e.id === id)
    const after = { x: P(pt.id).x, y: P(pt.id).y }

    D.undo()
    const restored = { x: P(pt.id).x, y: P(pt.id).y }

    return { before, after, restored }
  })

  expect(out.after.x).toBeCloseTo(out.before.x + 1, 6)
  expect(out.after.y).toBeCloseTo(out.before.y, 6)
  expect(out.restored.x).toBeCloseTo(out.before.x, 6)
  expect(out.restored.y).toBeCloseTo(out.before.y, 6)
})

test('pan & zoom: viewport is view state — wheel zooms toward the cursor, panBy pans, fitView resets, undo never touches it', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  // Vue's DOM update from a doc/viewport mutation is async (flushed on
  // nextTick, a microtask) — each step below is its own page.evaluate
  // round-trip so that microtask queue drains before the next read, rather
  // than reading the DOM synchronously mid-script inside one giant evaluate.
  const screenPos = (id: string) => page.evaluate((pointId) => {
    const circle = document.querySelector(`circle[data-point="${pointId}"]`) as SVGCircleElement
    return { x: Number(circle.getAttribute('cx')), y: Number(circle.getAttribute('cy')) }
  }, id)

  const initial = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    return D.getViewport()
  })
  expect(initial).toEqual({ scale: 34, panX: 40, panY: 400 })

  // place a point at world (5,5) and read its screen position straight off
  // the rendered circle (the sx/sy the template actually used) — no local
  // reimplementation of the mapping.
  const ptId = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.setTool('point'); D.place(5, 5)
    D.setTool('select')
    return D.doc.entities.find((e: any) => e.kind === 'point').id
  })
  const before = await screenPos(ptId)

  // zoom by 2x centered exactly on the point's current screen position — the
  // world point under the zoom center must stay under the same pixel.
  const afterZoom = await page.evaluate(({ x, y }) => {
    const D = (window as any).__sketchDraw
    D.zoomAt(x, y, 2)
    return D.getViewport()
  }, before)
  expect(afterZoom.scale).toBeCloseTo(68, 5)
  const afterZoomPos = await screenPos(ptId)
  // the zoom center (the point's own screen pos) stays put within a couple px
  expect(Math.abs(afterZoomPos.x - before.x)).toBeLessThan(2)
  expect(Math.abs(afterZoomPos.y - before.y)).toBeLessThan(2)

  // pan by (50, 0) — panX shifts +50, and the point's screen x shifts +50
  const afterPan = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.panBy(50, 0)
    return D.getViewport()
  })
  expect(afterPan.panX).toBeCloseTo(afterZoom.panX + 50, 5)
  expect(afterPan.panY).toBeCloseTo(afterZoom.panY, 5)
  const afterPanPos = await screenPos(ptId)
  expect(afterPanPos.x).toBeCloseTo(afterZoomPos.x + 50, 1)
  expect(afterPanPos.y).toBeCloseTo(afterZoomPos.y, 1)

  // place a second point at a known world coord post-zoom/pan — drawing must
  // still land at the mapping's own sx/sy, not the stale defaults.
  const { pt2Id, expectedScreen } = await page.evaluate((firstPtId) => {
    const D = (window as any).__sketchDraw
    D.setTool('point'); D.place(2, 3)
    D.setTool('select')
    const pt2Id = D.doc.entities.filter((e: any) => e.kind === 'point').find((e: any) => e.id !== firstPtId).id
    const vp = D.getViewport()
    return { pt2Id, expectedScreen: { x: vp.panX + 2 * vp.scale, y: vp.panY - 3 * vp.scale } }
  }, ptId)
  const newPointPos = await screenPos(pt2Id)
  // drawing still correct post-zoom/pan: the new point lands exactly where
  // the current sx/sy mapping says it should
  expect(newPointPos.x).toBeCloseTo(expectedScreen.x, 1)
  expect(newPointPos.y).toBeCloseTo(expectedScreen.y, 1)

  // fit/reset back to defaults
  const afterFit = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.fitView()
    return D.getViewport()
  })
  expect(afterFit).toEqual({ scale: 34, panX: 40, panY: 400 })

  // undo must NEVER touch the viewport — zoom/pan is view state, not model.
  // Re-zoom, then undo() (there IS history from the two placed points), and
  // confirm the viewport is unchanged.
  const { beforeUndo, afterUndo } = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.zoomAt(300, 200, 1.5)
    const beforeUndo = D.getViewport()
    D.undo()
    const afterUndo = D.getViewport()
    return { beforeUndo, afterUndo }
  })
  expect(afterUndo).toEqual(beforeUndo)   // undo did NOT touch the viewport
})

test('editable dimension chips: pin an arc radius, drag holds it, re-edit updates in place, undo removes the pin', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  // same bow recipe as the "click-and-drag bows a segment into a circular
  // arc" test above — a single arc segment (segIndex 0) is enough to exercise
  // the chip; the handler resolves center/startAnchor from any segment index.
  const drawn = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('path')
    D.pathDown(2, 2); D.pathUp(2, 2)          // first anchor, plain click
    D.pathDown(8, 2)                          // second anchor — appends a line segment
    D.pathMove(5, 4.5)                        // drag past the threshold → bows live
    D.pathUp(5, 4.5)                          // release → commits the arc
    D.finishPath(false)
    const path = D.doc.entities.find((e: any) => e.kind === 'path')
    const seg = path.segments[0]
    return { pathId: path.id, segIndex: 0, centerId: seg.center, startAnchorId: path.anchors[0] }
  })
  const { pathId, segIndex, centerId, startAnchorId } = drawn

  const radiusOf = () => page.evaluate(({ centerId, startAnchorId }) => {
    const d = (window as any).__sketchDraw.doc
    const P = (id: string) => d.entities.find((e: any) => e.id === id)
    const c = P(centerId), s = P(startAnchorId)
    return Math.hypot(c.x - s.x, c.y - s.y)
  }, { centerId, startAnchorId })

  const distanceConstraints = () => page.evaluate(() =>
    (window as any).__sketchDraw.doc.constraints.filter((c: any) => c.kind === 'distance'))

  expect((await distanceConstraints()).length).toBe(0)   // no pin before the first edit

  // pin the radius to 4 via the same code path a chip click uses
  await page.evaluate(({ pathId, segIndex }) => (window as any).__sketchDraw.setArcRadius(pathId, segIndex, 4), { pathId, segIndex })
  let pins = await distanceConstraints()
  expect(pins.length).toBe(1)
  expect(pins[0].value).toBe(4)
  expect([pins[0].refs[0], pins[0].refs[1]].sort()).toEqual([centerId, startAnchorId].sort())
  expect(await radiusOf()).toBeCloseTo(4, 1)
  const pinId = pins[0].id

  // drag the start anchor a bit — the pinned radius must hold
  await page.evaluate(({ startAnchorId }) => (window as any).__sketchDraw.drag(startAnchorId, 2.5, 2.8), { startAnchorId })
  expect(await radiusOf()).toBeCloseTo(4, 1)

  // edit the SAME chip again to 2 — updates the existing constraint in place,
  // never stacks a duplicate
  await page.evaluate(({ pathId, segIndex }) => (window as any).__sketchDraw.setArcRadius(pathId, segIndex, 2), { pathId, segIndex })
  pins = await distanceConstraints()
  expect(pins.length).toBe(1)
  expect(pins[0].id).toBe(pinId)
  expect(pins[0].value).toBe(2)
  expect(await radiusOf()).toBeCloseTo(2, 1)

  // undo back past the update, the drag, and the first pin — the constraint
  // itself must disappear (radius no longer forced)
  await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.undo(); D.undo(); D.undo()
  })
  expect((await distanceConstraints()).length).toBe(0)
})

test('editable dimension chips: setConstraintValue updates an existing distance constraint in place', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const info = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('point'); D.place(1, 1); D.place(5, 1)
    D.setTool('select')
    const pts = D.doc.entities.filter((e: any) => e.kind === 'point')
    D.pick(pts[0].id); D.pick(pts[1].id, true)
    D.apply('distance', 3)
    const con = D.doc.constraints.find((c: any) => c.kind === 'distance')
    return { conId: con.id, p1: pts[0].id, p2: pts[1].id }
  })

  const distOf = () => page.evaluate(({ p1, p2 }) => {
    const d = (window as any).__sketchDraw.doc
    const P = (id: string) => d.entities.find((e: any) => e.id === id)
    const a = P(p1), b = P(p2)
    return Math.hypot(a.x - b.x, a.y - b.y)
  }, { p1: info.p1, p2: info.p2 })

  expect(await distOf()).toBeCloseTo(3, 1)

  await page.evaluate((conId) => (window as any).__sketchDraw.setConstraintValue(conId, 7), info.conId)
  const con = await page.evaluate((conId) =>
    (window as any).__sketchDraw.doc.constraints.find((c: any) => c.id === conId), info.conId)
  expect(con.value).toBe(7)
  expect(await distOf()).toBeCloseTo(7, 1)
})

test('select tool: marquee box-select, click-empty-deselect, plain-click-replaces, shift-click-adds', async ({ page }) => {
  await page.goto('/dev/sketch-draw')
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchDraw)

  const ids = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.reset()
    D.setTool('point')
    D.place(2, 2)
    D.place(5, 5)
    D.place(9, 9)
    D.setTool('select')
    const pts = D.doc.entities.filter((e: any) => e.kind === 'point')
    return { a: pts[0].id, b: pts[1].id, c: pts[2].id }
  })

  // marqueeSelect a world rect covering exactly (2,2) and (5,5), missing (9,9)
  const marqueeSel = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.marqueeSelect(1, 1, 6, 6)
    return D.selection as string[]
  })
  expect(new Set(marqueeSel)).toEqual(new Set([ids.a, ids.b]))
  expect(marqueeSel.length).toBe(2)

  // clearSel resets to empty
  const afterClear = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.clearSel()
    return D.selection as string[]
  })
  expect(afterClear).toEqual([])

  // plain pick(a) then shift-add pick(b, true) → both selected
  const shiftAdd = await page.evaluate((ids) => {
    const D = (window as any).__sketchDraw
    D.pick(ids.a)
    D.pick(ids.b, true)
    return D.selection as string[]
  }, ids)
  expect(new Set(shiftAdd)).toEqual(new Set([ids.a, ids.b]))
  expect(shiftAdd.length).toBe(2)

  // plain (non-additive) pick(c) replaces the whole selection with just c
  const replaced = await page.evaluate((ids) => {
    const D = (window as any).__sketchDraw
    D.pick(ids.c)
    return D.selection as string[]
  }, ids)
  expect(replaced).toEqual([ids.c])

  // shift-marquee ADDS to the existing selection instead of replacing it
  const shiftMarquee = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    // rect covering only (2,2) — c ((9,9)) stays selected from the prior step
    D.marqueeSelect(1, 1, 3, 3, true)
    return D.selection as string[]
  })
  expect(new Set(shiftMarquee)).toEqual(new Set([ids.a, ids.c]))
  expect(shiftMarquee.length).toBe(2)

  // a non-additive marquee over empty space replaces selection with nothing
  const emptyMarquee = await page.evaluate(() => {
    const D = (window as any).__sketchDraw
    D.marqueeSelect(20, 20, 25, 25)
    return D.selection as string[]
  })
  expect(emptyMarquee).toEqual([])
})
