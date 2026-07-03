import { expect, test, type Locator, type Page } from '@playwright/test'
import { dropNode, openBlankWorkflow, waitForBackend } from './_helpers'

/**
 * Selection action chips (IA phase 4): selecting a video/audio artifact node
 * surfaces a chip sampler (takes-input actions + "All actions…"). Chips branch
 * a new action node off the artifact via comfynext:applyEffect; "All actions…"
 * deep-links the Actions panel to the artifact's domain.
 *
 * Selection mechanics: artifact bodies are one big "drop or click a file"
 * button, so a center click selects the node (mousedown bubbles to vue-flow)
 * AND opens a file chooser — swallowed by the beforeEach handler. Corner
 * clicks are unreliable (the project breadcrumb pill overlays top-left).
 */
async function selectNode(page: Page, node: Locator) {
  const bb = (await node.boundingBox())!
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2)
}

async function deselectAll(page: Page, node: Locator) {
  // Click the pane just left of the node's bottom-left corner — outside the
  // node, away from the top-left breadcrumb overlay. Clamp inside the
  // viewport: tall artifacts (+ the chip strip) can extend past its bottom,
  // and an off-viewport click is a silent no-op.
  const bb = (await node.boundingBox())!
  const vp = page.viewportSize()!
  await page.mouse.click(Math.max(bb.x - 30, 5), Math.min(bb.y + bb.height - 20, vp.height - 40))
}

test.describe('Selection action chips', () => {
  test.beforeEach(async ({ page }) => {
    page.on('filechooser', async () => { /* swallow artifact upload dialogs */ })
    await waitForBackend(page)
    await openBlankWorkflow(page)
  })

  test('video node: chips on select, branch on click, panel deep-link', async ({ page }) => {
    await dropNode(page, 'Video')
    const node = page.locator('.vue-flow__node').last()
    await expect(node).toBeVisible()

    await selectNode(page, node)
    const strip = node.locator('.sel-chips')
    await expect(strip).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Sync lips' })).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Enhance' })).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Describe' })).toBeVisible()

    // "Enhance" chip → a new node branches off (count grows; original stays).
    const before = await page.locator('.vue-flow__node').count()
    await strip.getByRole('button', { name: 'Enhance' }).click()
    await expect.poll(async () => page.locator('.vue-flow__node').count()).toBeGreaterThan(before)

    // "All actions…" → Actions panel opens on the Video tab (video hero visible).
    const videoNode = page.locator('.vue-flow__node').first()
    await selectNode(page, videoNode)
    await expect(videoNode.locator('.sel-chips')).toBeVisible()
    await videoNode.locator('.sel-chips').getByRole('button', { name: 'All actions…' }).click()
    const panel = page.locator('div.bg-\\[\\#1a1a1a\\]\\/95').first()
    await expect(panel).toBeVisible()
    await expect(panel.locator('.line-clamp-2').filter({ hasText: /^Generate a video$/ })).toBeVisible()
  })

  test('audio node: chips render; deselect hides them', async ({ page }) => {
    await dropNode(page, 'Audio')
    const node = page.locator('.vue-flow__node').last()
    await selectNode(page, node)
    const strip = node.locator('.sel-chips')
    await expect(strip).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Transcribe' })).toBeVisible()
    await expect(strip.getByRole('button', { name: 'Speakers' })).toBeVisible()

    await deselectAll(page, node)
    await expect(strip).toHaveCount(0)
  })
})
