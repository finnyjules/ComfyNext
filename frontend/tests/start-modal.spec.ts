import { expect, test, type Page } from '@playwright/test'
import { waitForBackend } from './_helpers'

/**
 * Start modal — capability showcase (IA start-modal revamp). The modal is
 * the taxonomy's front door: 8 hero action cards + 6 studio tiles, no
 * search, no prompt. NOTE: openBlankWorkflow() from _helpers skips this
 * modal, so these tests reimplement the open WITHOUT the skip.
 */
async function openToModal(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('sailor:Comfy.VueNodes.Enabled', 'true') } catch {}
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /^Start a blank project$/ }).click()
  await page.locator('.vue-flow').first().waitFor({ state: 'visible', timeout: 20_000 })
  await expect(page.getByText('What do you want to make?')).toBeVisible({ timeout: 5_000 })
}

test.describe('Start modal — capability showcase', () => {
  test.beforeEach(async ({ page }) => {
    await waitForBackend(page)
    await openToModal(page)
  })

  test('shows 8 hero cards and the studios row', async ({ page }) => {
    await expect(page.getByText('Pick an action — or skip and build freely.')).toBeVisible()
    for (const title of ['Generate an image', 'Edit an image', 'Generate a video', 'Sync lips to audio', 'Generate speech', 'Generate music', 'Generate a 3D model']) {
      await expect(page.getByRole('button', { name: new RegExp(title) }).first()).toBeVisible()
    }
    await expect(page.getByText('Craft it by hand')).toBeVisible()
    // Prefix match: the pastel dot's title ("Uses AI credits") joins the
    // accessible name on Shot Director / Lip-Sync tiles.
    for (const studio of ['Gradient', 'Shader', 'Pattern', 'Shot Director', 'Lip-Sync']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${studio}`) }).first()).toBeVisible()
    }
    // Dead affordances gone: no search box.
    await expect(page.getByPlaceholder(/Search starting points/)).toHaveCount(0)
  })

  test('sourced action pick lands a pre-wired 2-node graph', async ({ page }) => {
    await page.getByRole('button', { name: /Edit an image/ }).first().click()
    await expect(page.getByText('What do you want to make?')).toHaveCount(0)
    await expect.poll(async () => page.locator('.vue-flow__node').count()).toBe(2)
    await expect.poll(async () => page.locator('.vue-flow__edge').count()).toBe(1)
  })

  test('studio tile drops the studio node', async ({ page }) => {
    await page.getByRole('button', { name: /^Gradient$/ }).click()
    await expect(page.getByText('What do you want to make?')).toHaveCount(0)
    await expect.poll(async () => page.locator('.vue-flow__node').count()).toBe(1)
  })

  test('skip leaves a blank canvas', async ({ page }) => {
    await page.getByRole('button', { name: /Skip — start with a blank canvas/ }).click()
    await expect(page.getByText('What do you want to make?')).toHaveCount(0)
    await expect(page.locator('.vue-flow__node')).toHaveCount(0)
  })
})
