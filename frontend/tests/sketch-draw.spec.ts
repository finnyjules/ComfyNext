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
