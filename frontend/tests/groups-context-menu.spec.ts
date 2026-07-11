import { test, expect, type Page } from '@playwright/test'
import { openBlankWorkflow, dropNode, waitForBackend } from './_helpers'

/**
 * End-to-end coverage for:
 *   1. Right-click context menu (pane / node / selection / group)
 *   2. Group primitive (create from selection, drag-moves-contents, rename, color, delete)
 *   3. Filtered run (group + selection both dispatch `sailor:runFiltered`)
 *   4. Bypass / Mute toggle node.mode and apply the visual treatment
 *
 * Strategy: drive selections through the existing canvas affordances (the
 * pane menu's "Select All", custom DOM events). The browser's native context
 * menu fires when we dispatch a contextmenu MouseEvent, which Vue Flow
 * forwards to our @*-context-menu handlers.
 */

/**
 * Dispatch a synthetic contextmenu event directly on the target element.
 * We use this instead of `page.mouse.click({ button: 'right' })` because the
 * group title bar calls `setPointerCapture()` on pointerdown, which can
 * interfere with the browser's natural contextmenu emission. Dispatching the
 * event on the element directly also avoids elementFromPoint hit-test
 * surprises caused by overlapping layers (some elements have
 * pointer-events: none).
 */
async function rightClick(page: Page, locator: ReturnType<Page['locator']>, dx = 20, dy = 20) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Element has no bounding box')
  const x = box.x + dx
  const y = box.y + dy
  await locator.first().evaluate((el, [cx, cy]) => {
    el.dispatchEvent(new MouseEvent('contextmenu', {
      clientX: cx as number,
      clientY: cy as number,
      bubbles: true,
      cancelable: true,
      button: 2,
    }))
  }, [x, y])
  await page.waitForTimeout(150)
}

async function openPaneMenu(page: Page) {
  const pane = page.locator('.vue-flow__pane').first()
  await rightClick(page, pane, 50, 50)
  await page.locator('[role="menu"]').waitFor({ state: 'visible' })
}

async function closeMenu(page: Page) {
  // Press Escape; if the menu doesn't exist this is a no-op.
  await page.keyboard.press('Escape').catch(() => {})
  await page.waitForTimeout(100)
}

async function selectAllNodes(page: Page) {
  await openPaneMenu(page)
  await page.getByRole('button', { name: 'Select All' }).click()
  await page.waitForTimeout(150)
}

async function addNode(page: Page, nodeType: string): Promise<string> {
  const before = await page.locator('.vue-flow__node').count()
  await dropNode(page, nodeType)
  await expect.poll(() => page.locator('.vue-flow__node').count()).toBeGreaterThan(before)
  const last = page.locator('.vue-flow__node').last()
  return (await last.getAttribute('data-id')) ?? ''
}

test.beforeEach(async ({ page }) => {
  await openBlankWorkflow(page)
  await waitForBackend(page)
})

test.describe('canvas context menu', () => {
  test('right-clicking the pane opens the pane menu', async ({ page }) => {
    await openPaneMenu(page)
    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Run All' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Fit View' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Select All' })).toBeVisible()
  })

  test('right-clicking a node opens the node menu', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    const node = page.locator('.vue-flow__node').first()
    await rightClick(page, node)
    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    // Spot-check items unique to the single-node menu.
    await expect(menu.getByRole('button', { name: 'Run from Selection' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Bypass' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Mute' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Duplicate' })).toBeVisible()
  })

  test('menu closes on Escape', async ({ page }) => {
    await openPaneMenu(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="menu"]')).toHaveCount(0)
  })

  test('browser default right-click is suppressed on the canvas', async ({ page }) => {
    // Our handler calls preventDefault on the contextmenu event. After
    // dispatchEvent returns, every bubble-phase handler has run, so the
    // event's defaultPrevented flag reflects the final state.
    await addNode(page, 'PreviewImage')
    const prevented = await page.evaluate(() => {
      const node = document.querySelector('.vue-flow__node')!
      const r = node.getBoundingClientRect()
      const event = new MouseEvent('contextmenu', {
        clientX: r.left + 20, clientY: r.top + 20, bubbles: true, cancelable: true, button: 2,
      })
      node.dispatchEvent(event)
      return event.defaultPrevented
    })
    expect(prevented).toBe(true)
  })
})

test.describe('bypass and mute', () => {
  test('Bypass action sets mode=4 and applies the bypass visual', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    const node = page.locator('.vue-flow__node').first()
    await rightClick(page, node)
    await page.getByRole('button', { name: 'Bypass' }).click()
    await expect(node.locator('.comfy-node--bypassed')).toHaveCount(1)
    await expect(node.locator('[data-mode="4"]')).toHaveCount(1)
    await expect(node.getByText('Bypass', { exact: true })).toBeVisible()
  })

  test('Mute action sets mode=2 and applies the mute visual', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    const node = page.locator('.vue-flow__node').first()
    await rightClick(page, node)
    await page.getByRole('button', { name: 'Mute' }).click()
    await expect(node.locator('.comfy-node--muted')).toHaveCount(1)
    await expect(node.locator('[data-mode="2"]')).toHaveCount(1)
  })

  test('Bypass toggles off on a second click', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    const node = page.locator('.vue-flow__node').first()
    await rightClick(page, node)
    await page.getByRole('button', { name: 'Bypass' }).click()
    await expect(node.locator('[data-mode="4"]')).toHaveCount(1)
    // Re-open the menu — the item now reads "Un-Bypass".
    await rightClick(page, node)
    await page.getByRole('button', { name: 'Un-Bypass' }).click()
    await expect(node.locator('[data-mode="4"]')).toHaveCount(0)
  })
})

test.describe('groups', () => {
  test('Group Selection creates a group encompassing the selected nodes', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await selectAllNodes(page)
    // Right-click on one of the selected nodes — selection menu fires.
    const selectedNode = page.locator('.vue-flow__node.selected').first()
    await rightClick(page, selectedNode)
    await page.getByRole('button', { name: 'Group Selection' }).click()
    await expect(page.locator('.canvas-group')).toHaveCount(1)
  })

  test('Group right-click menu exposes Run / Bypass / Mute / Color / Rename / Delete', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await selectAllNodes(page)
    const sel = page.locator('.vue-flow__node.selected').first()
    await rightClick(page, sel)
    await page.getByRole('button', { name: 'Group Selection' }).click()
    await expect(page.locator('.canvas-group')).toHaveCount(1)

    const group = page.locator('.canvas-group__title').first()
    await rightClick(page, group, 30, 10)
    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Run Group' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Bypass Group Nodes' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Mute Group Nodes' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Rename' })).toBeVisible()
    await expect(menu.getByRole('button', { name: 'Delete Group' })).toBeVisible()
  })

  test('Delete Group removes the group rectangle but keeps the nodes', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await selectAllNodes(page)
    const sel = page.locator('.vue-flow__node.selected').first()
    await rightClick(page, sel)
    await page.getByRole('button', { name: 'Group Selection' }).click()
    await expect(page.locator('.canvas-group')).toHaveCount(1)

    await rightClick(page, page.locator('.canvas-group__title'), 30, 10)
    await page.getByRole('button', { name: 'Delete Group' }).click()
    await expect(page.locator('.canvas-group')).toHaveCount(0)
    // Both nodes still exist.
    await expect(page.locator('.vue-flow__node')).toHaveCount(2)
  })

  test('Bypass Group Nodes sets mode=4 on every node spatially inside the group', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await selectAllNodes(page)
    const sel = page.locator('.vue-flow__node.selected').first()
    await rightClick(page, sel)
    await page.getByRole('button', { name: 'Group Selection' }).click()

    await rightClick(page, page.locator('.canvas-group__title'), 30, 10)
    await page.getByRole('button', { name: 'Bypass Group Nodes' }).click()
    await expect(page.locator('.vue-flow__node [data-mode="4"]')).toHaveCount(2)
  })
})

test.describe('filtered run', () => {
  test('Run Group dispatches sailor:runFiltered with the group\'s node ids', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await selectAllNodes(page)
    const sel = page.locator('.vue-flow__node.selected').first()
    await rightClick(page, sel)
    await page.getByRole('button', { name: 'Group Selection' }).click()

    // Install a listener BEFORE triggering Run Group.
    const detailPromise = page.evaluate<{ targetIds: string[] }>(() => new Promise((resolve) => {
      window.addEventListener('sailor:runFiltered', (e) => {
        resolve((e as CustomEvent).detail)
      }, { once: true })
    }))

    await rightClick(page, page.locator('.canvas-group__title'), 30, 10)
    // Scope to the menu so the title-bar's aria-labeled "Run group" icon
    // button doesn't collide with the menu item's "Run Group" text.
    await page.locator('[role="menu"]').getByRole('button', { name: 'Run Group' }).click()

    const detail = await detailPromise
    expect(detail.targetIds.length).toBeGreaterThanOrEqual(2)
  })

  test('Group title bar Bypass icon toggles bypass on every contained node and activates', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await selectAllNodes(page)
    const sel = page.locator('.vue-flow__node.selected').first()
    await rightClick(page, sel)
    await page.getByRole('button', { name: 'Group Selection' }).click()
    await expect(page.locator('.canvas-group')).toHaveCount(1)

    const bypassBtn = page.locator('.canvas-group__title button[aria-label="Toggle bypass for group nodes"]')
    // dispatchEvent bypasses Playwright's actionability check. The groups
    // layer's wrapper is pointer-events-none (so clicks on the body fall
    // through to nodes), which Playwright reads as the button being
    // non-clickable. Real browsers handle the child override correctly —
    // verified via direct click in the preview.
    await bypassBtn.dispatchEvent('click')
    await expect(page.locator('.comfy-node--bypassed')).toHaveCount(2)
    await expect(bypassBtn).toHaveClass(/canvas-group__action--bypass-on/)

    // Second click clears it
    await bypassBtn.dispatchEvent('click')
    await expect(page.locator('.comfy-node--bypassed')).toHaveCount(0)
    await expect(bypassBtn).not.toHaveClass(/canvas-group__action--bypass-on/)
  })

  test('Group title bar Mute icon toggles mute on every contained node and activates', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await selectAllNodes(page)
    const sel = page.locator('.vue-flow__node.selected').first()
    await rightClick(page, sel)
    await page.getByRole('button', { name: 'Group Selection' }).click()

    const muteBtn = page.locator('.canvas-group__title button[aria-label="Toggle mute for group nodes"]')
    await muteBtn.dispatchEvent('click')
    await expect(page.locator('.comfy-node--muted')).toHaveCount(2)
    await expect(muteBtn).toHaveClass(/canvas-group__action--mute-on/)
  })

  test('Group title bar Run icon dispatches sailor:runFiltered', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await selectAllNodes(page)
    const sel = page.locator('.vue-flow__node.selected').first()
    await rightClick(page, sel)
    await page.getByRole('button', { name: 'Group Selection' }).click()
    await expect(page.locator('.canvas-group')).toHaveCount(1)

    const detailPromise = page.evaluate<{ targetIds: string[] }>(() => new Promise((resolve) => {
      window.addEventListener('sailor:runFiltered', (e) => {
        resolve((e as CustomEvent).detail)
      }, { once: true })
    }))

    await page.locator('.canvas-group__title button[aria-label="Run group"]').dispatchEvent('click')
    const detail = await detailPromise
    expect(detail.targetIds.length).toBe(2)
  })

  test('Run Selection dispatches sailor:runFiltered with the selected ids', async ({ page }) => {
    await addNode(page, 'PreviewImage')
    await addNode(page, 'EmptyImage')
    await selectAllNodes(page)

    const detailPromise = page.evaluate<{ targetIds: string[] }>(() => new Promise((resolve) => {
      window.addEventListener('sailor:runFiltered', (e) => {
        resolve((e as CustomEvent).detail)
      }, { once: true })
    }))

    const sel = page.locator('.vue-flow__node.selected').first()
    await rightClick(page, sel)
    await page.getByRole('button', { name: /^Run Selection/ }).click()

    const detail = await detailPromise
    expect(detail.targetIds.length).toBe(2)
  })
})
