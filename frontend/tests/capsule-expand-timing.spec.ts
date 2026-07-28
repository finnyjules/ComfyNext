import { test, expect } from '@playwright/test'
import { openBlankWorkflow, waitForBackend } from './_helpers'

// Guards the shape of the expand transition, not just its declared duration.
//
// The bug this exists for: the transition was eased on cubic-bezier(0.22, 1,
// 0.36, 1) (easeOutQuint), which put HALF the visible change in the first
// 100ms and spent the remaining 500ms crawling from 0.96 to 1.0. Raising the
// duration from 0.34s to 0.45s to 0.6s produced no perceptible difference,
// because every extra millisecond went into a tail nobody can see. Computed
// style looked correct the whole time — only sampling over real frames caught
// it, and the Browser pane cannot do that because it runs hidden and pauses
// rAF.
test('the expand transition spreads its motion across the duration', async ({ page }) => {
  await waitForBackend(page)
  await openBlankWorkflow(page)

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('sailor:addNode', { detail: { nodeType: 'KSampler' } }))
  })
  await expect(page.locator('.comfy-node').first()).toBeVisible()
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('sailor:test:setNodeData', {
      detail: { match: 'KSampler', patch: { collapsed: true, hasRun: true } },
    }))
  })
  await expect(page.locator('.node-capsule')).toBeVisible()

  // Opacity of the arriving card ~40% of the way through a 600ms transition.
  const midOpacity = await page.evaluate(async () => {
    const t0 = performance.now()
    ;(document.querySelector('.node-capsule') as HTMLElement).click()
    return await new Promise<number>((resolve) => {
      const tick = () => {
        const card = [...document.querySelectorAll('.comfy-node')]
          .find(c => c.querySelector('.node-head')) as HTMLElement | undefined
        if (performance.now() - t0 >= 240) {
          resolve(card ? +getComputedStyle(card).opacity : -1)
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  })

  // Front-loaded easing put this at ~0.93; an even curve puts it near 0.45.
  // The window is wide on purpose — this guards the SHAPE, so it should survive
  // a deliberate change of duration or curve and only fail on a return to an
  // easing that finishes before you can see it.
  expect(midOpacity).toBeGreaterThan(0.1)
  expect(midOpacity).toBeLessThan(0.8)
})
