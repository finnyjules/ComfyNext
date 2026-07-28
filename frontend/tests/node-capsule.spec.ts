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

  test('an expanded capsule collapses again when you click away', async ({ page }) => {
    // The spec's interaction model: pinned open until you click away. Nothing
    // used to unpin it — `collapsed = false` was the only writer in the whole
    // codebase, so a capsule opened once stayed a card for the session.
    await addNode(page, 'KSampler')
    // hasRun puts the node in the after-run tier's collapsed default, which is
    // what click-away returns to (`collapsed` goes back to undefined, not true).
    await setNodeData(page, 'KSampler', { collapsed: true, hasRun: true })

    await page.locator('.node-capsule').click()
    await expect(page.locator('.node-capsule')).toHaveCount(0)

    // Click bare canvas, clear of both the node (added at viewport centre) and
    // the toolbar overlays that sit in the corners.
    const pane = await page.locator('.vue-flow__pane').boundingBox()
    await page.mouse.click(pane!.x + 60, pane!.y + pane!.height / 2)
    await expect(page.locator('.node-capsule')).toBeVisible()
  })

  test('a capsule opens from the keyboard', async ({ page }) => {
    // The capsule is the ONLY way to open a collapsed node, so a mouse-only
    // handler puts those nodes out of keyboard reach entirely.
    await addNode(page, 'KSampler')
    await setNodeData(page, 'KSampler', { collapsed: true })
    await page.locator('.node-capsule').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('.node-capsule')).toHaveCount(0)
  })

  test('a stale error message does not survive the node clearing its error', async ({ page }) => {
    await addNode(page, 'KSampler')
    await setNodeData(page, 'KSampler', {
      collapsed: true, error: true, errorMessage: 'CUDA out of memory',
    })
    await expect(page.locator('.node-capsule')).toContainText('CUDA out of memory')

    // errorMessage is sticky — only a new exception overwrites it. The read-out
    // must key off `error`, or the failure outranks every later read-out.
    await setNodeData(page, 'KSampler', { error: false })
    await expect(page.locator('.node-capsule')).not.toContainText('CUDA')
    await expect(page.locator('.node-capsule')).toContainText('steps')
  })

  test('the failed capsule opens the card instead of re-running', async ({ page }) => {
    await addNode(page, 'KSampler')
    await setNodeData(page, 'KSampler', {
      collapsed: true, error: true, errorMessage: 'Something broke',
    })
    const action = page.locator('.node-capsule__action')
    await expect(action).toHaveAttribute('aria-label', 'Show the error')

    const runs: unknown[] = []
    await page.exposeFunction('__capsuleRun', (d: unknown) => { runs.push(d) })
    await page.evaluate(() => {
      window.addEventListener('sailor:runFiltered', (e) => {
        ;(window as any).__capsuleRun((e as CustomEvent).detail)
      })
    })

    await action.click()
    // It opens the card (where the untruncated error chip lives) …
    await expect(page.locator('.node-capsule')).toHaveCount(0)
    // … and does NOT spend money on the click that asked what went wrong.
    expect(runs).toEqual([])
  })

  test('the running capsule stops the run instead of doing nothing', async ({ page }) => {
    await addNode(page, 'KSampler')
    await setNodeData(page, 'KSampler', {
      collapsed: true, running: true, runningSince: Date.now(),
    })
    const action = page.locator('.node-capsule__action')
    await expect(action).toHaveAttribute('aria-label', 'Stop')

    const stops: unknown[] = []
    await page.exposeFunction('__capsuleStop', (d: unknown) => { stops.push(d) })
    await page.evaluate(() => {
      window.addEventListener('sailor:stopRun', (e) => {
        ;(window as any).__capsuleStop((e as CustomEvent).detail ?? {})
      })
    })

    await action.click()
    // The old wiring called dispatchRun, which returns early while running —
    // the button was inert. Assert the interrupt actually leaves the node.
    await expect.poll(() => stops.length).toBe(1)
  })
})
