import { test, expect, type Page } from '@playwright/test'
import { openBlankWorkflow, dropNode, waitForBackend } from './_helpers'

/**
 * Block Library — save a group as a reusable block, then insert it back
 * into the canvas (via click or drag) on the same or a fresh workflow.
 *
 * Storage is localStorage, so we wipe it in beforeEach. window.prompt is
 * stubbed via addInitScript so the save flow never hits a real dialog.
 */

async function rightClick(page: Page, locator: ReturnType<Page['locator']>, dx = 20, dy = 20) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Element has no bounding box')
  await locator.first().evaluate((el, [cx, cy]) => {
    el.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: cx as number, clientY: cy as number, bubbles: true, cancelable: true, button: 2,
    }))
  }, [box.x + dx, box.y + dy])
  await page.waitForTimeout(150)
}

async function openPaneMenu(page: Page) {
  const pane = page.locator('.vue-flow__pane').first()
  await rightClick(page, pane, 50, 50)
  await page.locator('[role="menu"]').waitFor({ state: 'visible' })
}

async function selectAllNodes(page: Page) {
  await openPaneMenu(page)
  await page.getByRole('button', { name: 'Select All' }).click()
  await page.waitForTimeout(150)
}

async function addNode(page: Page, nodeType: string) {
  const before = await page.locator('.vue-flow__node').count()
  await dropNode(page, nodeType)
  await expect.poll(() => page.locator('.vue-flow__node').count()).toBeGreaterThan(before)
}

async function makeGroupAroundEverything(page: Page) {
  await selectAllNodes(page)
  const sel = page.locator('.vue-flow__node.selected').first()
  await rightClick(page, sel)
  await page.getByRole('button', { name: 'Group Selection' }).click()
  await expect(page.locator('.canvas-group')).toHaveCount(1)
}

async function openBlocksPanel(page: Page) {
  // The Blocks sidebar item shares its label as the aria-label; click it.
  await page.getByRole('button', { name: 'Blocks', exact: true }).first().click()
  // Panel renders either an empty state or a card grid; both contain "Blocks"
  // in the header.
  await page.locator('.h-full.bg-\\[\\#1a1a1a\\]\\/95').filter({ hasText: 'Blocks' }).waitFor({ state: 'visible' })
}

test.beforeEach(async ({ page }) => {
  // Stub window.prompt to bypass the native save-name dialog.
  await page.addInitScript(() => {
    ;(window as any).__lastPrompt = null
    window.prompt = (msg?: string, def?: string) => {
      ;(window as any).__lastPrompt = msg
      return 'Test Block'
    }
  })
  await openBlankWorkflow(page)
  await waitForBackend(page)
  await page.evaluate(() => localStorage.removeItem('sailor:blocks'))
})

test.describe('block library', () => {
  test('empty state shows when no blocks are saved', async ({ page }) => {
    await openBlocksPanel(page)
    await expect(page.getByText('No blocks saved yet')).toBeVisible()
  })

  test('save-as-block (title-bar icon) stores the block in localStorage', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await makeGroupAroundEverything(page)
    await page.locator('.canvas-group__title button[aria-label="Save group as block"]').dispatchEvent('click')
    // Block is now in localStorage; open the panel and verify the card appears.
    await openBlocksPanel(page)
    await expect(page.locator('.block-card')).toHaveCount(1)
    await expect(page.locator('.block-card').first()).toContainText('Test Block')
    await expect(page.locator('.block-card').first()).toContainText('2 nodes')
  })

  test('save-as-block via right-click menu also works', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await makeGroupAroundEverything(page)
    await rightClick(page, page.locator('.canvas-group__title'), 30, 10)
    await page.getByRole('button', { name: /Save as Block/ }).click()
    await openBlocksPanel(page)
    await expect(page.locator('.block-card')).toHaveCount(1)
  })

  test('clicking a block card inserts its nodes + group onto the canvas', async ({ page }) => {
    // First save a block...
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await makeGroupAroundEverything(page)
    await page.locator('.canvas-group__title button[aria-label="Save group as block"]').dispatchEvent('click')

    const nodesBefore = await page.locator('.vue-flow__node').count()
    const groupsBefore = await page.locator('.canvas-group').count()

    // ...then click the card to insert again.
    await openBlocksPanel(page)
    await page.locator('.block-card').first().click()

    // Inserted: 2 more nodes (4 total) + 1 more group (2 total).
    await expect(page.locator('.vue-flow__node')).toHaveCount(nodesBefore + 2)
    await expect(page.locator('.canvas-group')).toHaveCount(groupsBefore + 1)
  })

  test('block persists across reloads', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await makeGroupAroundEverything(page)
    await page.locator('.canvas-group__title button[aria-label="Save group as block"]').dispatchEvent('click')

    await page.waitForTimeout(200)
    await page.reload()
    await page.locator('.vue-flow').first().waitFor({ state: 'visible' })
    await openBlocksPanel(page)
    await expect(page.locator('.block-card')).toHaveCount(1)
    await expect(page.locator('.block-card').first()).toContainText('Test Block')
  })

  test('deleting a block from the panel removes it', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await makeGroupAroundEverything(page)
    await page.locator('.canvas-group__title button[aria-label="Save group as block"]').dispatchEvent('click')
    await openBlocksPanel(page)
    await expect(page.locator('.block-card')).toHaveCount(1)

    // Confirm dialog → accept
    await page.addInitScript(() => { window.confirm = () => true })
    await page.evaluate(() => { window.confirm = () => true })

    // Open the card menu, click Delete
    await page.locator('.block-card button[aria-label*="actions"]').first().click()
    await page.getByRole('button', { name: 'Delete' }).click()

    await expect(page.locator('.block-card')).toHaveCount(0)
    await expect(page.getByText('No blocks saved yet')).toBeVisible()
  })
})
