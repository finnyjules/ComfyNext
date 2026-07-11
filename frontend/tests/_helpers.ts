import { Page, expect } from '@playwright/test'

/**
 * Open the home page and switch to a blank workflow so VueNodeCanvas is mounted.
 * The canvas listens for `sailor:openTimeline` and `sailor:openSmartLayout`
 * custom events to launch the respective full-screen editors.
 *
 * The VueFlow node canvas only mounts when the localStorage feature flag
 * `sailor:Comfy.VueNodes.Enabled` is set to 'true'. Playwright starts
 * fresh, so we seed it before navigation.
 */
export async function openBlankWorkflow(page: Page) {
  // SSR renders with `vueNodesEnabled = false` because localStorage isn't
  // available server-side. The composable updates the ref on first client-
  // side call but a race against the layout's v-if leaves the legacy iframe
  // mounted on first navigation. Cleanest fix: seed localStorage, then reload.
  await page.addInitScript(() => {
    try { localStorage.setItem('sailor:Comfy.VueNodes.Enabled', 'true') } catch {}
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.reload()
  await page.waitForLoadState('networkidle')

  await page.getByRole('button', { name: /^Start a blank project$/ }).click()
  await page.locator('.vue-flow').first().waitFor({ state: 'visible', timeout: 20_000 })

  // Fresh blank projects pop the "Get Started" intent modal (StartProjectModal),
  // which intercepts all canvas clicks. Skip it when it shows up.
  const skipStartModal = page.getByRole('button', { name: /Skip — start with a blank canvas/i })
  if (await skipStartModal.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skipStartModal.click()
    await skipStartModal.waitFor({ state: 'hidden', timeout: 5_000 })
  }
}

/** The timeline editor's full-screen overlay. Several modals share the
 *  `.fixed.inset-0.z-[100]` shell (intent picker, pose editor, …), so scope
 *  by the editor's header text to stay unambiguous in strict mode. */
export function timelineEditorOverlay(page: Page) {
  return page.locator('.fixed.inset-0.z-\\[100\\]').filter({ hasText: 'Timeline Editor' })
}

/** Wait for the timeline editor overlay to appear. */
export async function openTimelineEditor(page: Page) {
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('sailor:openTimeline', { detail: { nodeId: 'pw-fake' } })),
  )
  await timelineEditorOverlay(page).waitFor({ state: 'visible', timeout: 10_000 })
}

/** Wait for the SmartLayout editor overlay to appear (uses its own modal). */
export async function openSmartLayoutEditor(page: Page, nodeId: string) {
  await page.evaluate((id) =>
    window.dispatchEvent(new CustomEvent('sailor:openSmartLayout', { detail: { nodeId: id } })),
    nodeId,
  )
}

/**
 * Add a node to the canvas. Bypasses the synthetic HTML5 DnD path (whose
 * DataTransfer doesn't survive `dispatchEvent`) by using the existing
 * `sailor:addNode` custom event that VueNodeCanvas listens for.
 */
export async function dropNode(page: Page, nodeType: string) {
  await page.evaluate((type) => {
    window.dispatchEvent(new CustomEvent('sailor:addNode', { detail: { nodeType: type } }))
  }, nodeType)
  // The node renders on the next render tick.
  await page.waitForTimeout(300)
}

/** Wait for ComfyUI's /object_info to respond — proves the backend is ready. */
export async function waitForBackend(page: Page) {
  await expect.poll(async () => {
    const r = await page.request.get('/object_info').catch(() => null)
    return r?.status() ?? 0
  }, { timeout: 60_000, intervals: [1000, 2000, 3000] }).toBe(200)
}
