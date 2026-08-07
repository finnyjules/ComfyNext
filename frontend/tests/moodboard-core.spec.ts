import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { openBlankWorkflow, dropNode, waitForBackend } from './_helpers'
// The REAL submit-time injection the app calls (app/layouts/default.vue
// imports this same module) — not a fixture re-implementation.
import { injectLoraStyleIntoPrompt as realInjectLoraStyle } from '../app/lib/graph/styleInject'
import { moodboardStyleBlock } from '../app/lib/taste/styleBlock'

// This project is ESM (no __dirname global) — derive it from import.meta.url.
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Moodboard core E2E (plan 2026-08-06-moodboards-a-core, Task A8).
 *
 * The full user journey against the LIVE dev server, everything real except
 * POST /api/taste/read (mocked — no paid Fable call in CI):
 *
 *   create board → upload 3 images → Read (mocked) → EDIT the summary → Save
 *   → library carries the edit → gallery Moodboards tab → pick into slot B
 *   → THE COMPOSED-PROMPT ASSERTION (the point of the whole plan): the
 *     serialized workflow, run through the app's run-time injection logic,
 *     yields widgets_values[0] starting with the taste block
 *   → delete the node → the library entry survives.
 *
 * Page state is pulled through Vue's dev-only `__vueParentComponent` backlink
 * to reach VueNodeCanvas's defineExpose surface (getNodes / getWorkflow) — the
 * same objects the app itself serializes at Run, not test fixtures.
 */

// ── the mocked Fable reading (everything else is real) ──────────────────────
const MOCK_SUMMARY = 'A8 test world of soft pastels.'
const EDITED_SUMMARY = `${MOCK_SUMMARY} Edited.`
const MOCK_READ_RESPONSE = {
  summary: MOCK_SUMMARY,
  palette: [
    { name: 'Blush', hex: '#F6C1CB' },
    { name: 'Teal', hex: '#3B6B70' },
  ],
  avoids: ['neon'],
  briefs: [],
  reading: { facets: {}, avoids: ['neon'] },
}

// Screenshots land in the invoking session's scratchpad when A8_SHOT_DIR is
// set; otherwise in test-results so a plain run still keeps its evidence.
const SHOT_DIR = process.env.A8_SHOT_DIR ?? path.resolve(__dirname, '../test-results/a8-shots')

// ── minimal in-memory PNG fixtures (must really decode in the browser: the
//    modal decodes client-side before uploading, so an invalid PNG would be
//    silently skipped and the board would come up short) ─────────────────────
function crc32(buf: Buffer): number {
  let c: number
  const table: number[] = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}
function makePng(w: number, h: number, [r, g, b]: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // color type: truecolor RGB
  const row = Buffer.alloc(1 + w * 3) // filter byte 0 + pixels
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = r
    row[2 + x * 3] = g
    row[3 + x * 3] = b
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ── page-state extraction via the dev __vueParentComponent backlink ─────────
/** Walk up from `.vue-flow` to the VueNodeCanvas instance's defineExpose surface. */
async function pullNodeData(page: Page, nodeId: string): Promise<{ properties: Record<string, any>, widgetsValues: any[] }> {
  return await page.evaluate((id) => {
    let c: any = (document.querySelector('.vue-flow') as any)?.__vueParentComponent
    while (c && !(c.exposed && typeof c.exposed.getNodes === 'function')) c = c.parent
    if (!c) throw new Error('VueNodeCanvas exposed surface not reachable')
    const n = c.exposed.getNodes().find((n: any) => String(n.id) === String(id))
    if (!n) throw new Error(`node ${id} not found`)
    return JSON.parse(JSON.stringify({
      properties: n.data?.properties ?? {},
      widgetsValues: n.data?.widgetsValues ?? [],
    }))
  }, nodeId)
}

/** The REAL serialized workflow — the same getWorkflow() the Run path calls. */
async function pullSerializedWorkflow(page: Page): Promise<any> {
  return await page.evaluate(() => {
    let c: any = (document.querySelector('.vue-flow') as any)?.__vueParentComponent
    while (c && !(c.exposed && typeof c.exposed.getWorkflow === 'function')) c = c.parent
    if (!c) throw new Error('VueNodeCanvas exposed surface not reachable')
    return JSON.parse(JSON.stringify(c.exposed.getWorkflow()))
  })
}

// The run-path injection is now the REAL exported function (Task B2 moved it
// from default.vue into ~/lib/graph/styleInject.ts) — no more verbatim replica
// to keep in sync. The objectInfo argument only matters for GenerateImageNode's
// name-resolved style_block write; the FLUX prompt fold under test here never
// consults it, so `{}` is exact.
const injectLoraStyleIntoPrompt = (workflow: any) => realInjectLoraStyle(workflow, {})

// ── run-scoped state (created live, cleaned in afterAll) ────────────────────
const runTag = Date.now()
const boardName = `A8 E2E Board ${runTag}`
const expectedId = `a8-e2e-board-${runTag}` // slugifyMoodboardName(boardName)
let createdId = ''      // library id once saved
let createdFolder = ''  // input/moodboard_<ms> minted by the upload

test.afterAll(async ({ request }) => {
  // DELETE the library entry this run created (route is idempotent).
  if (createdId) await request.delete(`/api/moodboards/${createdId}`).catch(() => {})
  // rm the input/moodboard_* folder this run created — guard hard against
  // deleting anything that is not a moodboard folder.
  if (/^moodboard_\d+$/.test(createdFolder)) {
    const dir = path.resolve(__dirname, '../../input', createdFolder)
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

test('moodboard core: create → read → correct → save → apply → composed prompt → node delete leaves library intact', async ({ page }) => {
  test.setTimeout(180_000)
  fs.mkdirSync(SHOT_DIR, { recursive: true })

  // Mock ONLY the Fable read; count hits so "the reading appeared" is provably
  // the mock's doing and not a stray real call (or a cached previous reading).
  let readHits = 0
  await page.route('**/api/taste/read', async (route) => {
    readHits++
    await route.fulfill({ json: MOCK_READ_RESPONSE })
  })

  await waitForBackend(page)
  await openBlankWorkflow(page)

  // ── 1. Moodboard node + modal: upload, read, edit, save ───────────────────
  let moodboardNodeId = ''
  await test.step('add Moodboard node and open its modal', async () => {
    const before = await page.locator('.vue-flow__node').evaluateAll(els => els.map(e => e.getAttribute('data-id')))
    await dropNode(page, 'Moodboard')
    await expect.poll(async () =>
      (await page.locator('.vue-flow__node').count())).toBe(before.length + 1)
    const after = await page.locator('.vue-flow__node').evaluateAll(els => els.map(e => e.getAttribute('data-id')))
    moodboardNodeId = after.find(id => !before.includes(id)) ?? ''
    expect(moodboardNodeId).toBeTruthy()

    await page.evaluate((id) =>
      window.dispatchEvent(new CustomEvent('sailor:openMoodboard', { detail: { nodeId: id } })), moodboardNodeId)
    await expect(page.getByTestId('moodboard-modal')).toBeVisible()
  })

  const modal = page.getByTestId('moodboard-modal')

  await test.step('upload 3 fixture PNGs (real upload, real folder mint)', async () => {
    await modal.getByTestId('mb-name').fill(boardName)
    await modal.getByTestId('mb-file-input').setInputFiles([
      { name: 'blush.png', mimeType: 'image/png', buffer: makePng(64, 64, [246, 193, 203]) },
      { name: 'teal.png', mimeType: 'image/png', buffer: makePng(64, 64, [59, 107, 112]) },
      { name: 'cream.png', mimeType: 'image/png', buffer: makePng(64, 64, [244, 238, 224]) },
    ])
    await expect(modal.getByTestId('mb-board-image')).toHaveCount(3, { timeout: 15_000 })

    // The minted input/moodboard_<ms> folder, straight from the served image URL.
    const src = await modal.getByTestId('mb-board-image').first().getAttribute('src')
    createdFolder = new URL(src!, 'http://x').searchParams.get('folder') ?? ''
    expect(createdFolder).toMatch(/^moodboard_\d+$/)
  })

  await test.step('Read (mocked) fills the reading; then EDIT the summary', async () => {
    await modal.getByTestId('mb-read').click()
    await expect(modal.getByTestId('mb-summary')).toHaveValue(MOCK_SUMMARY, { timeout: 10_000 })
    expect(readHits).toBe(1) // the reading came from OUR mock, nothing else
    await expect(modal.getByTestId('mb-swatch')).toHaveCount(2)
    await expect(modal.getByTestId('mb-swatch').first()).toContainText('Blush')
    await expect(modal.getByTestId('mb-avoid')).toHaveCount(1)
    await expect(modal.getByTestId('mb-avoid').first()).toContainText('neon')

    // The correction loop: the user edits the machine's words.
    await modal.getByTestId('mb-summary').fill(EDITED_SUMMARY)
    await page.screenshot({ path: path.join(SHOT_DIR, 'a8-modal.png') })
  })

  await test.step('Save persists the EDITED summary to the library', async () => {
    await modal.getByTestId('mb-save').click()
    await expect.poll(async () => {
      const res = await page.request.get('/api/moodboards')
      const { moodboards } = await res.json() as { moodboards: any[] }
      return moodboards.find(m => m.name === boardName)?.reading?.summary ?? null
    }, { timeout: 10_000 }).toBe(EDITED_SUMMARY)

    const res = await page.request.get('/api/moodboards')
    const { moodboards } = await res.json() as { moodboards: any[] }
    const entry = moodboards.find(m => m.name === boardName)
    createdId = entry.id
    expect(createdId).toBe(expectedId)
    expect(entry.folder).toBe(createdFolder)

    // Save also wrote the node↔library reference onto the opening node.
    const nodeData = await pullNodeData(page, moodboardNodeId)
    expect(nodeData.properties.sailor_moodboard).toBe(createdId)
  })

  await test.step('close modal — node pile face shows the board', async () => {
    await modal.getByRole('button', { name: 'Close' }).click()
    await expect(modal).toBeHidden()
    const nodeEl = page.locator(`.vue-flow__node[data-id="${moodboardNodeId}"]`)
    // The pile renders the board's images (not the dashed empty state).
    await expect.poll(async () => nodeEl.locator('img').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    await nodeEl.screenshot({ path: path.join(SHOT_DIR, 'a8-pile.png') })
  })

  // ── 2. Gallery: Moodboards tab → pick into slot B ─────────────────────────
  let fluxNodeId = ''
  await test.step('add FluxMultiLoRARemoteNode and pick the board into slot B', async () => {
    const before = await page.locator('.vue-flow__node').evaluateAll(els => els.map(e => e.getAttribute('data-id')))
    await dropNode(page, 'FluxMultiLoRARemoteNode')
    await expect.poll(async () =>
      (await page.locator('.vue-flow__node').count())).toBe(before.length + 1)
    const after = await page.locator('.vue-flow__node').evaluateAll(els => els.map(e => e.getAttribute('data-id')))
    fluxNodeId = after.find(id => !before.includes(id)) ?? ''
    expect(fluxNodeId).toBeTruthy()

    await page.evaluate((id) =>
      window.dispatchEvent(new CustomEvent('sailor:openLoraGallery', {
        detail: { nodeId: id, widgetName: 'lora_b', kind: 'style' },
      })), fluxNodeId)

    // Scope everything to the catalog modal's overlay shell: after the pick,
    // the NODE grows its own slot-card button named after the board, so an
    // unscoped locator would re-resolve to that and wreck the hidden check.
    const catalog = page.locator('.fixed.inset-0.z-\\[100\\]')
      .filter({ has: page.getByRole('button', { name: /^Moodboards/ }) })
    // The Moodboards filter chip only exists once the library has entries —
    // its presence is itself an assertion that the saved board reached the tab.
    await expect(catalog).toBeVisible({ timeout: 10_000 })
    await catalog.getByRole('button', { name: /^Moodboards/ }).click()
    const card = catalog.getByRole('button', { name: new RegExp(boardName) }).first()
    await expect(card).toBeVisible()
    await page.screenshot({ path: path.join(SHOT_DIR, 'a8-gallery.png') })

    await card.click()
    await catalog.getByRole('button', { name: `Use ${boardName}` }).click()
    await expect(catalog).toBeHidden() // modal closed
  })

  const expectedBlock = moodboardStyleBlock({
    summary: EDITED_SUMMARY,
    palette: MOCK_READ_RESPONSE.palette,
    avoids: MOCK_READ_RESPONSE.avoids,
  })

  await test.step('slot B carries the weightless apply (properties, no scale)', async () => {
    const { properties } = await pullNodeData(page, fluxNodeId)
    expect(String(properties.aesthetic_b)).toMatch(/^In the style of: A8 test world of soft pastels\. Edited\./)
    expect(properties.aesthetic_b).toBe(expectedBlock)
    expect(properties.sailor_moodboard_b).toBe(createdId)

    // Screenshot the picked slot card itself. The node overflows the viewport
    // at canvas zoom, so fit the view first (the canvas's own exposed
    // fitView), then clip around the card's box.
    const slotCard = page.getByTitle(`${boardName} — click to change Moodboard`)
    await expect(slotCard).toBeVisible()
    await page.evaluate(() => {
      let c: any = (document.querySelector('.vue-flow') as any)?.__vueParentComponent
      while (c && !(c.exposed && typeof c.exposed.fitView === 'function')) c = c.parent
      c?.exposed.fitView()
    })
    await page.waitForTimeout(400)
    const box = (await slotCard.boundingBox())!
    const vp = page.viewportSize()!
    const x = Math.max(0, box.x - 24)
    const y = Math.max(0, box.y - 24)
    await page.screenshot({
      path: path.join(SHOT_DIR, 'a8-card.png'),
      clip: { x, y, width: Math.min(box.width + 48, vp.width - x), height: Math.min(box.height + 48, vp.height - y) },
    })
  })

  // ── 3. THE COMPOSED-PROMPT ASSERTION ──────────────────────────────────────
  await test.step('the serialized workflow, through the run-path injection, yields the block in widgets_values[0]', async () => {
    // The REAL serialization the Run path consumes — pulled from the page, not
    // a fixture. First prove the serializer carried the slot properties at all
    // (convertToLiteGraph silently drops non-properties state).
    const workflow = await pullSerializedWorkflow(page)
    const fluxNode = (workflow.nodes as any[]).find(n => n.type === 'FluxMultiLoRARemoteNode')
    expect(fluxNode, 'serialized workflow must contain the multi-LoRA node').toBeTruthy()
    expect(fluxNode.properties?.aesthetic_b).toBe(expectedBlock)
    expect(fluxNode.properties?.sailor_moodboard_b).toBe(createdId)
    expect(Array.isArray(fluxNode.widgets_values)).toBe(true)

    // Apply the same injection the app applies at submit time — the REAL
    // exported injectLoraStyleIntoPrompt from ~/lib/graph/styleInject.ts.
    const injected = JSON.parse(JSON.stringify(workflow))
    injectLoraStyleIntoPrompt(injected)
    const wv0 = String((injected.nodes as any[]).find(n => n.type === 'FluxMultiLoRARemoteNode').widgets_values[0])
    expect(wv0.startsWith(expectedBlock)).toBe(true)
    expect(wv0).toMatch(/^In the style of: A8 test world of soft pastels\. Edited\./)
    expect(wv0).toContain('#F6C1CB') // a palette hex from the mocked reading

    // BROKEN CONTROL: same real serialized state with aesthetic_b blanked —
    // the block must disappear from the composed prompt. If this half ever
    // passes with the block still present, the positive assertion above is
    // proven vacuous.
    const control = JSON.parse(JSON.stringify(workflow))
    const controlNode = (control.nodes as any[]).find(n => n.type === 'FluxMultiLoRARemoteNode')
    controlNode.properties.aesthetic_b = ''
    injectLoraStyleIntoPrompt(control)
    const controlWv0 = String(controlNode.widgets_values[0])
    expect(controlWv0).not.toContain('In the style of:')
    expect(controlWv0).not.toContain('#F6C1CB')
  })

  // ── 4. node deletion leaves the library intact ────────────────────────────
  await test.step('delete the Moodboard node — the library entry survives', async () => {
    const nodeEl = page.locator(`.vue-flow__node[data-id="${moodboardNodeId}"]`)
    // Select WITHOUT opening the modal: the node's click-vs-drag guard ignores
    // clicks that travelled ≥5px, while Vue Flow still selects on pointerdown —
    // so a small real drag both selects and keeps the modal closed.
    const box = (await nodeEl.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 12, { steps: 4 })
    await page.mouse.up()
    await expect(nodeEl).toHaveClass(/selected/)
    await expect(page.getByTestId('moodboard-modal')).toBeHidden()

    // keydown Delete on the pane (bubbles to the window listener Vue Flow uses).
    await page.locator('.vue-flow__pane').first().evaluate((pane) => {
      pane.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    })
    await expect(nodeEl).toHaveCount(0, { timeout: 5_000 })

    const res = await page.request.get('/api/moodboards')
    const { moodboards } = await res.json() as { moodboards: any[] }
    const entry = moodboards.find(m => m.id === createdId)
    expect(entry, 'library entry must survive node deletion').toBeTruthy()
    expect(entry.reading.summary).toBe(EDITED_SUMMARY)
  })
})
