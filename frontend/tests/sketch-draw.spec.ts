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
    D.clearSel(); D.pick(circles[0].id); D.pick(circles[1].id)
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
    D.clearSel(); D.pick(lines[0].id); D.pick(lines[1].id)
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
