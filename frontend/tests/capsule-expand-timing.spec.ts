import { test, expect } from '@playwright/test'
import { openBlankWorkflow, waitForBackend } from './_helpers'

// Guards the shape of the expand transition, not just its declared duration.
//
// The card does not cross-fade in — it grows, from under a header that never
// moves, so what this samples is the card's real height mid-transition.
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

  // The card's real height partway through, plus its height once settled.
  // Height is the thing that matters: clip-path looked the same but does not
  // affect layout, so the ports sat at their final positions from frame one and
  // the edges snapped. Sampling height proves the box is actually growing.
  const mid = await page.evaluate(async () => {
    const t0 = performance.now()
    ;(document.querySelector('.node-capsule') as HTMLElement).click()
    const cardNow = () => [...document.querySelectorAll('.comfy-node')]
      .find(c => c.querySelector('.node-head')) as HTMLElement | undefined

    const sampled = await new Promise<number>((resolve) => {
      const tick = () => {
        if (performance.now() - t0 >= 170) { resolve(cardNow()?.offsetHeight ?? -1); return }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await new Promise(r => setTimeout(r, 900))
    return { sampled, settled: cardNow()?.offsetHeight ?? -1 }
  })

  // Partway open: taller than the capsule it came from, shorter than the card
  // it is becoming. An instant swap reports the settled height immediately; a
  // front-loaded easing is already at ~full by here.
  expect(mid.settled).toBeGreaterThan(120)
  expect(mid.sampled).toBeGreaterThan(44)
  expect(mid.sampled).toBeLessThan(mid.settled * 0.9)
})
