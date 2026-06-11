import { chromium } from '@playwright/test'

const TEMPLATE = {
  version: 2, id: 'demo', name: 'Drag', master: '1x1',
  formats: { '1x1': { w: 1080, h: 1080 } },
  grid: { gutter: 24, margin: 72, baseline: 12 },
  typeScale: { base: 28, ratio: 1.414 },
  background: { fill: '#0f0f10' },
  elements: [
    { id: 'headline', type: 'text', content: 'Drag me', level: 'headline', priority: 1,
      region: { col: 1, colSpan: 2, row: 1, rowSpan: 1 }, style: { color: '#ffffff' } },
  ],
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
await page.addInitScript(() => {
  try { localStorage.setItem('comfynext:Comfy.VueNodes.Enabled', 'true') } catch {}
})
await page.goto('http://127.0.0.1:3010/')
await page.waitForLoadState('networkidle')
await page.reload()
await page.waitForLoadState('networkidle')
await page.getByRole('button', { name: /^Start a blank project$/ }).click()
await page.locator('.vue-flow').first().waitFor({ state: 'visible', timeout: 20000 })
const skip = page.getByRole('button', { name: /Skip — start with a blank canvas/i })
if (await skip.isVisible({ timeout: 2000 }).catch(() => false)) {
  await skip.click()
  await skip.waitFor({ state: 'hidden' })
}
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('comfynext:addNode', { detail: { nodeType: 'SmartLayout' } }))
})
const node = page.locator('.vue-flow__node', { hasText: 'Smart Layout' }).first()
await node.waitFor({ state: 'visible', timeout: 10000 })
await page.mouse.move(640, 300)
await page.mouse.wheel(0, 600)
await page.waitForTimeout(300)
await node.getByRole('button', { name: /Edit layout/i }).click()
const modal = page.locator('div.fixed.inset-0').last()
await modal.waitFor({ state: 'visible' })

await modal.getByRole('button', { name: 'JSON', exact: true }).click()
await modal.locator('textarea').fill(JSON.stringify(TEMPLATE))
await modal.getByRole('button', { name: 'Apply to previews' }).click()
await modal.getByRole('button', { name: 'Back to visual' }).click()
await page.waitForTimeout(600)

// Select + read starting region from the property panel
const el = modal.getByText('Drag me').first()
await el.click()
await page.waitForTimeout(300)
const colInput = modal.locator('label:has-text("Col") input').first()
const rowInput = modal.locator('label:has-text("Row") input').first()
console.log('before drag: col', await colInput.inputValue(), 'row', await rowInput.inputValue())

// Drag by ~2 cell strides right and 1 down. Scale readout shows the zoom; at
// 81% a 160px stride is ~130px on screen.
const box = await el.boundingBox()
const scaleText = await modal.getByText(/grid · \d+%/).textContent()
const zoom = Number(scaleText.match(/(\d+)%$/)[1]) / 100
const stride = 160 * zoom
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 + stride * 2, box.y + box.height / 2 + stride, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(300)
console.log('after drag: col', await colInput.inputValue(), 'row', await rowInput.inputValue())

await page.screenshot({ path: '/tmp/ge-6-drag.png' })
await browser.close()
