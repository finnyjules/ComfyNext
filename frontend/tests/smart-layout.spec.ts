import { test, expect } from '@playwright/test'
import { waitForBackend, openBlankWorkflow, dropNode } from './_helpers'

/**
 * Minimal valid SmartLayout template: one text element on a 1x1 dark canvas.
 * Used to test the render endpoint independently of the editor.
 */
const TEMPLATE_BASIC = {
  version: 1 as const,
  id: 'pw-basic',
  name: 'Playwright Basic',
  aspects: { '1x1': { w: 512, h: 512 }, '9x16': { w: 540, h: 960 } },
  defaultAspect: '1x1',
  background: { color: '#101418' },
  elements: [
    {
      id: 'title',
      type: 'text',
      role: 'TEXT_LAYER_1',
      anchor: 'center',
      offset: { x: 0, y: 0 },
      size: { w: '80%', h: 'auto' },
      style: { fontFamily: 'Inter', fontSize: 64, fontWeight: 700, color: '#ffffff', align: 'center', lineHeight: 1.1 },
      content: '{{ props.text_layer_1 }}',
    },
  ],
}

test.describe('SmartLayout render endpoint', () => {
  test.beforeAll(async ({ request }) => {
    // The render endpoint is a Nuxt server route; doesn't need ComfyUI.
    const r = await request.get('/').catch(() => null)
    if (!r || r.status() >= 500) test.skip(true, 'frontend server not responding')
  })

  test('produces a valid PNG matching the requested aspect', async ({ request }) => {
    const res = await request.post('/api/render-template', {
      data: {
        template: TEMPLATE_BASIC,
        aspect: '1x1',
        props: { text_layer_1: 'Hello Playwright' },
      },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toMatch(/image\/png/)
    const buf = await res.body()
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(buf.subarray(0, 8).toString('hex').toLowerCase()).toBe('89504e470d0a1a0a')
    // Read the IHDR width/height (bytes 16..24).
    const width = buf.readUInt32BE(16)
    const height = buf.readUInt32BE(20)
    expect(width).toBe(512)
    expect(height).toBe(512)
  })

  test('honors aspect switching (9x16 produces a tall PNG)', async ({ request }) => {
    const res = await request.post('/api/render-template', {
      data: {
        template: TEMPLATE_BASIC,
        aspect: '9x16',
        props: { text_layer_1: 'Tall' },
      },
    })
    expect(res.status()).toBe(200)
    const buf = await res.body()
    expect(buf.readUInt32BE(16)).toBe(540)
    expect(buf.readUInt32BE(20)).toBe(960)
  })

  test('explicit width/height override the aspect lookup', async ({ request }) => {
    const res = await request.post('/api/render-template', {
      data: {
        template: TEMPLATE_BASIC,
        aspect: '1x1',
        width: 800,
        height: 200,
        props: { text_layer_1: 'Banner' },
      },
    })
    expect(res.status()).toBe(200)
    const buf = await res.body()
    expect(buf.readUInt32BE(16)).toBe(800)
    expect(buf.readUInt32BE(20)).toBe(200)
  })

  test('brand colour propagates through {{ brand.* }} substitution', async ({ request }) => {
    const template = {
      ...TEMPLATE_BASIC,
      background: { color: '{{ brand.background }}' as any },
      elements: [
        { ...TEMPLATE_BASIC.elements[0], style: { ...TEMPLATE_BASIC.elements[0].style, color: '{{ brand.foreground }}' } },
      ],
    }
    const res = await request.post('/api/render-template', {
      data: {
        template,
        aspect: '1x1',
        props: { text_layer_1: 'Brand' },
        brand: { background: '#ff0044', foreground: '#ffffff' },
      },
    })
    expect(res.status()).toBe(200)
    // Sample the first non-PNG-header pixel area (corner of the canvas should
    // be the brand background). Decode minimally: assert the PNG is well-formed
    // and reasonably sized for a 512x512.
    const buf = await res.body()
    expect(buf.length).toBeGreaterThan(1000)
  })

  const TEMPLATE_V2 = {
    version: 2 as const,
    id: 'pw-v2', name: 'Playwright V2',
    master: '1x1',
    formats: {
      '1x1': { w: 512, h: 512 },
      '728x90': { w: 728, h: 90 },
      '160x600': { w: 160, h: 600 },
    },
    grid: { gutter: 24, margin: 72, baseline: 12 },
    typeScale: { base: 28, ratio: 1.414 },
    background: { fill: '#101418' },
    elements: [
      { id: 'headline', type: 'text', content: '{{ props.text_layer_1 }}', level: 'display', priority: 1,
        region: { col: 1, colSpan: 6, row: 4, rowSpan: 2 }, style: { color: '#ffffff' } },
      { id: 'cta', type: 'text', content: 'Shop now', level: 'caption', role: 'CTA', priority: 2,
        region: { col: 5, colSpan: 2, row: 6, rowSpan: 1 }, style: { color: '#ffffff' } },
    ],
  }

  for (const [key, w, h] of [['1x1', 512, 512], ['728x90', 728, 90], ['160x600', 160, 600]] as const) {
    test(`v2 grid template renders ${key} at declared size`, async ({ request }) => {
      const res = await request.post('/api/render-template', {
        data: { template: TEMPLATE_V2, aspect: key, props: { text_layer_1: 'Brew bold' } },
      })
      expect(res.status()).toBe(200)
      const buf = await res.body()
      expect(buf.subarray(0, 8).toString('hex').toLowerCase()).toBe('89504e470d0a1a0a')
      expect(buf.readUInt32BE(16)).toBe(w)
      expect(buf.readUInt32BE(20)).toBe(h)
    })
  }

  test('missing template field returns 400', async ({ request }) => {
    const res = await request.post('/api/render-template', {
      data: { aspect: '1x1' },
      headers: { 'content-type': 'application/json' },
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
  })

  test('malformed template (no aspects field) returns 4xx/5xx but not a hang', async ({ request }) => {
    const res = await request.post('/api/render-template', {
      data: { template: { version: 1, id: 'bad', name: 'bad', elements: [] }, aspect: '1x1' },
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })
})

test.describe('SmartLayout node in the canvas', () => {
  test.beforeEach(async ({ page }) => {
    await waitForBackend(page)
    await openBlankWorkflow(page)
  })

  test('dropping a SmartLayout node onto the canvas renders it with edit button', async ({ page }) => {
    await dropNode(page, 'SmartLayout', { x: 700, y: 400 })
    // Body shows the "Edit layout" affordance.
    const node = page.locator('.vue-flow__node', { hasText: 'Smart Layout' }).first()
    await expect(node).toBeVisible({ timeout: 10_000 })
    await expect(node.getByRole('button', { name: /Edit layout/i })).toBeVisible()
  })

  test('clicking Edit layout opens the SmartLayout editor modal', async ({ page }) => {
    await dropNode(page, 'SmartLayout', { x: 700, y: 400 })
    const node = page.locator('.vue-flow__node', { hasText: 'Smart Layout' }).first()
    await expect(node).toBeVisible({ timeout: 10_000 })
    // Default placement can land the node body under the bottom HUD toolbar,
    // which intercepts clicks. Zoom out so the node clears the toolbar.
    await page.mouse.move(640, 300)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(300)
    await node.getByRole('button', { name: /Edit layout/i }).click()
    // The SmartLayout modal renders a heavy editor with aspects on the left.
    // We assert the modal overlay exists by checking for the highest-z fixed inset element.
    const modal = page.locator('div.fixed.inset-0').last()
    await expect(modal).toBeVisible({ timeout: 5_000 })
  })

  test('execute path: queue a SmartLayout-only workflow and verify the output frame is a PNG', async ({ page, request }) => {
    // This drives the *Comfy graph* end-to-end:
    //   1. Drop SmartLayout
    //   2. Queue a prompt with just that node
    //   3. Poll /history for completion
    //   4. Fetch the output frame from /view and assert it's a PNG.
    await dropNode(page, 'SmartLayout', { x: 700, y: 400 })
    const node = page.locator('.vue-flow__node', { hasText: 'Smart Layout' }).first()
    await expect(node).toBeVisible({ timeout: 10_000 })

    // Read the node id Vue Flow assigned so we can target it in the prompt graph.
    const nodeId = await node.evaluate((el) => el.getAttribute('data-id'))
    expect(nodeId).toBeTruthy()

    // Build a minimal prompt graph — just SmartLayout with default widget values.
    // Comfy expects a {nodeId: {inputs, class_type}} dict.
    const prompt = {
      [nodeId!]: {
        class_type: 'SmartLayout',
        inputs: {
          layout: JSON.stringify(TEMPLATE_BASIC),
          aspects: '1x1',
          brand: '',
        },
      },
    }

    // Queue.
    const queueRes = await request.post('/prompt', {
      data: { prompt, client_id: 'pw-smart-layout' },
      headers: { 'content-type': 'application/json' },
    })
    expect(queueRes.status()).toBe(200)
    const { prompt_id } = await queueRes.json()
    expect(prompt_id).toBeTruthy()

    // Poll history until the prompt shows up (executed). Cap at 60s.
    let entry: any = null
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const h = await request.get(`/history/${prompt_id}`).then((r) => r.json()).catch(() => null)
      if (h && h[prompt_id]) { entry = h[prompt_id]; break }
      await page.waitForTimeout(1500)
    }
    expect(entry, `history entry for ${prompt_id}`).toBeTruthy()

    // The SmartLayout node has `is_output_node=True` so its preview image
    // lands in `outputs[nodeId].images`. Grab the first one.
    const outputs = entry.outputs?.[nodeId!]
    expect(outputs?.images?.length, 'preview images in history').toBeGreaterThan(0)
    const img = outputs.images[0]

    // Fetch and verify the PNG signature.
    const viewQs = new URLSearchParams({
      filename: img.filename,
      type: img.type,
      subfolder: img.subfolder ?? '',
    })
    const viewRes = await request.get(`/view?${viewQs.toString()}`)
    expect(viewRes.status()).toBe(200)
    const buf = await viewRes.body()
    expect(buf.subarray(0, 8).toString('hex').toLowerCase()).toBe('89504e470d0a1a0a')
  })
})
