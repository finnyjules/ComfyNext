// tests/sketch-solver-lab.spec.ts
import { test, expect } from '@playwright/test'

test('circle stays tangent to the line as the endpoint moves', async ({ page }) => {
  await page.goto('/dev/sketch-solver-lab')
  // wait for the page to hydrate and publish its API (avoids first-click hydration race)
  await page.waitForSelector('[data-ready]')
  await page.waitForFunction(() => !!(window as any).__sketchLab)

  // load the demo through the API, not a button click
  await page.evaluate(() => (window as any).__sketchLab.loadTangentDemo())

  const perp = async () => page.evaluate(() => {
    const d = (window as any).__sketchLab.doc
    const p = (id: string) => d.entities.find((e: any) => e.id === id)
    const a = p('a'), b = p('b'), c = p('cc'), C = d.entities.find((e: any) => e.id === 'C')
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy)
    const dPerp = Math.abs((dx * (c.y - a.y) - dy * (c.x - a.x)) / L)
    return { perp: dPerp, r: C.r }
  })

  const before = await perp()
  expect(Math.abs(before.perp - before.r)).toBeLessThan(0.05)

  await page.evaluate(() => (window as any).__sketchLab.setPoint('b', 12, 7))
  const after = await perp()
  expect(after.perp).toBeCloseTo(after.r, 1) // still tangent after the move
})
