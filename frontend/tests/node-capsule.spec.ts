import { test, expect, type Page } from '@playwright/test'
import { openBlankWorkflow, waitForBackend } from './_helpers'

// Adding a node headlessly: dispatch sailor:addNode on the window. This is the
// same path the toolbox and the nodes sidebar use (useNodeSearch.ts:171), so it
// exercises real node creation rather than a test-only shortcut.
async function addNode(page: Page, nodeType: string): Promise<string> {
  const before = await page.locator('.vue-flow__node').count()
  await page.evaluate((t) => {
    window.dispatchEvent(new CustomEvent('sailor:addNode', { detail: { nodeType: t } }))
  }, nodeType)
  await expect.poll(async () => page.locator('.vue-flow__node').count()).toBeGreaterThan(before)
  const last = page.locator('.vue-flow__node').last()
  return (await last.getAttribute('data-id')) ?? ''
}

// Force node.data directly through the dev-only sailor:test:setNodeData
// listener (VueNodeCanvas.vue) — sidesteps a paid/real generation just to
// exercise the collapsed UI.
async function setNodeData(page: Page, match: string, patch: Record<string, unknown>) {
  await page.evaluate(({ match, patch }) => {
    window.dispatchEvent(new CustomEvent('sailor:test:setNodeData', { detail: { match, patch } }))
  }, { match, patch })
}

test.describe('node capsule', () => {
  test.beforeEach(async ({ page }) => {
    await waitForBackend(page)
    await openBlankWorkflow(page)
  })

  test('a freshly added generator opens as a card, not a capsule', async ({ page }) => {
    await addNode(page, 'KSampler')
    await expect(page.locator('.comfy-node').first()).toBeVisible()
    await expect(page.locator('.node-capsule')).toHaveCount(0)
  })

  test('a collapsed node shows its read-out and expands on click', async ({ page }) => {
    await addNode(page, 'KSampler')

    // Force the collapsed state directly rather than running a paid generation.
    await setNodeData(page, 'KSampler', { collapsed: true })

    const capsule = page.locator('.node-capsule')
    await expect(capsule).toBeVisible()
    await expect(capsule).toContainText('steps')

    await capsule.click()
    await expect(page.locator('.node-capsule')).toHaveCount(0)
  })

  test('collapsing keeps existing edges attached', async ({ page }) => {
    const clipId = await addNode(page, 'CLIPTextEncode')

    // sailor:applyEffect splices a real node after an existing one with a real
    // edge (see "Browser E2E graph wiring recipe" — vue-flow ignores synthetic
    // DOM drags, so this dev event is the only headless way to create a wire
    // that behaves exactly like one dragged by hand). CLIPTextEncode's
    // CONDITIONING output feeds straight into KSampler's positive input.
    await page.evaluate((nodeId) => {
      window.dispatchEvent(new CustomEvent('sailor:applyEffect', {
        detail: { nodeId, nodeType: 'KSampler', output: 'CONDITIONING' },
      }))
    }, clipId)

    await expect.poll(async () => page.locator('.vue-flow__edge').count()).toBeGreaterThan(0)
    const edgeCount = await page.locator('.vue-flow__edge').count()

    await setNodeData(page, 'KSampler', { collapsed: true })
    await expect(page.locator('.node-capsule')).toBeVisible()
    await expect(page.locator('.vue-flow__edge')).toHaveCount(edgeCount)
  })

  test('the action button does not expand the capsule', async ({ page }) => {
    await addNode(page, 'KSampler')
    await setNodeData(page, 'KSampler', { collapsed: true })
    await page.locator('.node-capsule__action').click()
    await expect(page.locator('.node-capsule')).toBeVisible()
  })
})
