import { test, expect } from '@playwright/test'
import { openBlankWorkflow, waitForBackend } from './_helpers'

// Guards the shape of the expand transition, not just its declared duration.
//
// The card does not cross-fade in — it unfolds from under a header that never
// moves, so what this samples is how much of the card the clip has revealed.
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

  // How much of the card is revealed ~40% of the way through the transition.
  const mid = await page.evaluate(async () => {
    const t0 = performance.now()
    ;(document.querySelector('.node-capsule') as HTMLElement).click()
    return await new Promise<{ revealed: number, full: number }>((resolve) => {
      const tick = () => {
        const card = [...document.querySelectorAll('.comfy-node')]
          .find(c => c.querySelector('.node-head')) as HTMLElement | undefined
        if (performance.now() - t0 >= 170) {
          if (!card) { resolve({ revealed: -1, full: -1 }); return }
          // clip-path computes to `inset(0px 0px Npx 0px round 12px)`; N is how
          // much of the bottom is still hidden.
          const m = /inset\(([^)]*)\)/.exec(getComputedStyle(card).clipPath || '')
          const hidden = m ? parseFloat(m[1].split(/\s+/)[2] || '0') : 0
          const full = card.getBoundingClientRect().height
          resolve({ revealed: full - hidden, full })
          return
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  })

  // Partway open: more than the header alone, less than the whole card. A
  // front-loaded easing would already be at ~full here, and an instant swap
  // would report the full height on the first frame.
  expect(mid.full).toBeGreaterThan(100)
  expect(mid.revealed).toBeGreaterThan(44)
  expect(mid.revealed).toBeLessThan(mid.full * 0.85)
})
