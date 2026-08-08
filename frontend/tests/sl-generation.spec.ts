import { test, expect, type Page } from '@playwright/test'
import { waitForBackend, openBlankWorkflow, dropNode, openSmartLayoutEditor } from './_helpers'

/**
 * Task 15 functional gate: opening a fresh Smart Layout editor with a wired
 * text socket should self-seed importance tiers and lay out one composition
 * immediately (no blank grid / gallery step), and the wired Shuffle/Surprise
 * actions (Task 14's plumbing) should actually change the layout — not just
 * "render something".
 *
 * Wiring technique (real pointer drag between handles, not a synthetic
 * dispatch — vue-flow ignores synthetic drags) copied from the proven
 * pattern in moodboard-wires.spec.ts.
 */

/** Write a widget value BY NAME on a live node (the widgetDefs-resolved slot). */
async function setWidgetByName(page: Page, nodeId: string, name: string, value: any): Promise<void> {
  await page.evaluate(({ id, name, value }) => {
    let c: any = (document.querySelector('.vue-flow') as any)?.__vueParentComponent
    while (c && !(c.exposed && typeof c.exposed.getNodes === 'function')) c = c.parent
    if (!c) throw new Error('VueNodeCanvas exposed surface not reachable')
    const n = c.exposed.getNodes().find((n: any) => String(n.id) === String(id))
    if (!n) throw new Error(`node ${id} not found`)
    const idx = (n.data?.widgetDefs ?? []).findIndex((d: any) => d?.name === name)
    if (idx < 0) throw new Error(`widget ${name} not found on ${id}`)
    n.data.widgetsValues[idx] = value
  }, { id: nodeId, name, value })
}

/** Read a widget value BY NAME off a live node (the persisted layout JSON
 *  string, for a SmartLayout node's `layout` widget). */
async function getWidgetByName(page: Page, nodeId: string, name: string): Promise<any> {
  return await page.evaluate(({ id, name }) => {
    let c: any = (document.querySelector('.vue-flow') as any)?.__vueParentComponent
    while (c && !(c.exposed && typeof c.exposed.getNodes === 'function')) c = c.parent
    if (!c) throw new Error('VueNodeCanvas exposed surface not reachable')
    const n = c.exposed.getNodes().find((n: any) => String(n.id) === String(id))
    if (!n) throw new Error(`node ${id} not found`)
    const idx = (n.data?.widgetDefs ?? []).findIndex((d: any) => d?.name === name)
    if (idx < 0) throw new Error(`widget ${name} not found on ${id}`)
    return n.data.widgetsValues[idx]
  }, { id: nodeId, name })
}

/** Depth-first search for an element by id across a v2/v3 layout's top-level
 *  `elements` AND any v3 `sections[].children` — mirrors `allElements()` in
 *  useGridEditor.ts closely enough for a test assertion (stops needing to
 *  know whether the dragged element happens to be a top-level layer or a
 *  frame child). */
function findElementInLayout(layout: any, id: string): any {
  const top = (layout.elements ?? []).find((e: any) => e.id === id)
  if (top) return top
  for (const sec of layout.sections ?? []) {
    const child = (sec.children ?? []).find((e: any) => e.id === id)
    if (child) return child
  }
  return null
}

/** Read one element's live (not-yet-saved) region/overhang straight out of
 *  the open GridEditorShell's `useGridEditor()` composable state — reached
 *  via Vue's internal `provide()` chain (GridEditorShell.vue provides
 *  'gridEditor' above the artboard), the same undocumented-but-stable-here
 *  trick this file already uses for `__vueParentComponent`/`.exposed`. Lets
 *  the test assert mid-drag state without a Save & close round-trip. */
async function readLiveElement(page: Page, elId: string): Promise<any> {
  return await page.evaluate((id) => {
    const root = document.querySelector('[data-artboard]')
    if (!root) throw new Error('[data-artboard] not found')
    let c: any = (root as any).__vueParentComponent
    while (c && !(c.provides && c.provides.gridEditor)) c = c.parent
    if (!c) throw new Error('gridEditor provide() not reachable from the artboard')
    const tpl = c.provides.gridEditor.template.value
    const all = [...(tpl.elements ?? [])]
    for (const sec of tpl.sections ?? []) all.push(...(sec.children ?? []))
    const el = all.find((e: any) => e.id === id)
    return el ? JSON.parse(JSON.stringify(el)) : null
  }, elId)
}

/** The live node's input index for a named input (handle = `input-<idx>`). */
async function inputIndexOf(page: Page, nodeId: string, inputName: string): Promise<number> {
  return await page.evaluate(({ id, inputName }) => {
    let c: any = (document.querySelector('.vue-flow') as any)?.__vueParentComponent
    while (c && !(c.exposed && typeof c.exposed.getNodes === 'function')) c = c.parent
    if (!c) throw new Error('VueNodeCanvas exposed surface not reachable')
    const n = c.exposed.getNodes().find((n: any) => String(n.id) === String(id))
    if (!n) throw new Error(`node ${id} not found`)
    return ((n.data?.inputs ?? []) as any[]).findIndex((i: any) => i?.name === inputName)
  }, { id: nodeId, inputName })
}

async function fitCanvas(page: Page): Promise<void> {
  await page.evaluate(() => {
    let c: any = (document.querySelector('.vue-flow') as any)?.__vueParentComponent
    while (c && !(c.exposed && typeof c.exposed.fitView === 'function')) c = c.parent
    c?.exposed.fitView()
  })
  await page.waitForTimeout(300)
}

async function addNodeAndGetId(page: Page, nodeType: string): Promise<string> {
  const before = await page.locator('.vue-flow__node').evaluateAll(els => els.map(e => e.getAttribute('data-id')))
  await dropNode(page, nodeType)
  await expect.poll(async () => (await page.locator('.vue-flow__node').count())).toBe(before.length + 1)
  const after = await page.locator('.vue-flow__node').evaluateAll(els => els.map(e => e.getAttribute('data-id')))
  const id = after.find(id => !before.includes(id)) ?? ''
  expect(id).toBeTruthy()
  return id
}

/** `sailor:addNode` always drops at the viewport center, so two adds stack
 *  exactly on top of each other. Nudge a node's canvas position after adding
 *  it so a second add doesn't land inside the first (which would otherwise
 *  cover its connection handles and eat the drag). */
async function nudgeNode(page: Page, nodeId: string, dx: number, dy: number): Promise<void> {
  await page.evaluate(({ id, dx, dy }) => {
    let c: any = (document.querySelector('.vue-flow') as any)?.__vueParentComponent
    while (c && !(c.exposed && typeof c.exposed.getNodes === 'function')) c = c.parent
    if (!c) throw new Error('VueNodeCanvas exposed surface not reachable')
    const n = c.exposed.getNodes().find((n: any) => String(n.id) === String(id))
    if (!n) throw new Error(`node ${id} not found`)
    n.position.x += dx
    n.position.y += dy
  }, { id: nodeId, dx, dy })
}

/** Point falls inside `box` (inclusive), used to steer clear of staged
 *  elements when hunting for genuinely empty artboard space. */
function pointInBox(p: { x: number; y: number }, box: { x: number; y: number; width: number; height: number }): boolean {
  return p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height
}

/** Finds a click point inside the artboard that doesn't land on any of the
 *  given element boxes — tries the four artboard corners (inset a few px so
 *  the click isn't swallowed by an edge-flush element) before falling back
 *  to the artboard's own centre-adjacent offsets. Generated layouts vary, so
 *  this can't hardcode a single "known empty" spot. */
function findEmptyPoint(
  artboardBox: { x: number; y: number; width: number; height: number },
  elementBoxes: Array<{ x: number; y: number; width: number; height: number }>,
): { x: number; y: number } {
  const inset = 10
  const candidates = [
    // Bottom corners first — a contextual toolbar (when something's
    // selected) floats ABOVE the selection, so it's likelier to intrude on
    // the top corners than the bottom ones.
    { x: artboardBox.x + inset, y: artboardBox.y + artboardBox.height - inset },
    { x: artboardBox.x + artboardBox.width - inset, y: artboardBox.y + artboardBox.height - inset },
    { x: artboardBox.x + artboardBox.width / 2, y: artboardBox.y + artboardBox.height - inset },
    { x: artboardBox.x + inset, y: artboardBox.y + inset },
    { x: artboardBox.x + artboardBox.width - inset, y: artboardBox.y + inset },
    { x: artboardBox.x + inset, y: artboardBox.y + artboardBox.height / 2 },
  ]
  for (const c of candidates) {
    if (!elementBoxes.some(b => pointInBox(c, b))) return c
  }
  throw new Error('No empty artboard point found — every candidate overlaps a staged element')
}

/** The project's default canvas can carry leftover nodes from a prior run
 *  against this same (persistent, non-mocked) dev server. Clear it so the
 *  test starts from a genuinely empty graph — otherwise a stray node can sit
 *  exactly where a fresh one spawns and steal its handle's hit area. */
async function clearCanvas(page: Page): Promise<void> {
  await page.evaluate(() => {
    let c: any = (document.querySelector('.vue-flow') as any)?.__vueParentComponent
    while (c && !(c.exposed && typeof c.exposed.getNodes === 'function')) c = c.parent
    if (!c) throw new Error('VueNodeCanvas exposed surface not reachable')
    const ns = c.exposed.getNodes()
    const es = c.exposed.getEdges()
    ns.splice(0, ns.length)
    es.splice(0, es.length)
  })
  await page.waitForTimeout(200)
}

test.describe('Smart Layout generation (wired Shuffle/Surprise)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForBackend(page)
    await openBlankWorkflow(page)
  })

  test('a wired Text socket seeds tiers + generates a poster on open, and Surprise re-rolls the seed', async ({ page }) => {
    await clearCanvas(page)

    // Wire a Text node (real STRING output) into the SmartLayout's
    // text_layer_1 input so autopopulateTiers has content to seed from.
    const textId = await addNodeAndGetId(page, 'Text')
    await setWidgetByName(page, textId, 'text', 'Summer Sale')
    // Every `sailor:addNode` spawns at the same viewport-center point — move
    // the Text node clear of that spot before the SmartLayout node lands on
    // top of it.
    await nudgeNode(page, textId, -500, -300)

    const slId = await addNodeAndGetId(page, 'SmartLayout')

    await fitCanvas(page)
    const textLayerIdx = await inputIndexOf(page, slId, 'text_layer_1')
    expect(textLayerIdx).toBeGreaterThan(-1)

    const srcHandle = page.locator(`.vue-flow__node[data-id="${textId}"] .vue-flow__handle[data-handleid="output-0"]`)
    const tgtHandle = page.locator(`.vue-flow__node[data-id="${slId}"] .vue-flow__handle[data-handleid="input-${textLayerIdx}"]`)
    const src = await srcHandle.boundingBox()
    const tgt = await tgtHandle.boundingBox()
    expect(src, 'Text output handle must be on screen').toBeTruthy()
    expect(tgt, 'SmartLayout text_layer_1 handle must be on screen').toBeTruthy()

    // Handles report a hit-box wider than their visible dot (the dot sits at
    // the outer edge, nearest the node border) — a dead-center click can land
    // on the node's own body chrome instead. Aim at the edge nearest the
    // wire direction: rightmost for an output handle, leftmost for an input.
    const sx = src!.x + src!.width - 2, sy = src!.y + src!.height / 2
    const tx = tgt!.x + 2, ty = tgt!.y + tgt!.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 6 })
    await page.mouse.move(tx, ty, { steps: 6 })
    await page.mouse.up()

    // Confirm the edge landed before opening the editor — readUpstreamText
    // reads live vue-flow edges, so the wire must exist first.
    await expect.poll(async () => await page.locator('.vue-flow__edge').count()).toBeGreaterThan(0)

    await openSmartLayoutEditor(page, slId)
    const modal = page.locator('div.fixed.inset-0').last()
    await expect(modal).toBeVisible({ timeout: 10_000 })

    // Task 15: a fresh layout with no staged elements and no tiers self-seeds
    // from the wired socket and runs one `generate()` — the editor opens
    // straight onto a real poster (staged elements present), no blank grid /
    // gallery step to click through first.
    const staged = modal.locator('[data-el-id^="tier_"]')
    await expect.poll(async () => await staged.count(), { timeout: 10_000 }).toBeGreaterThan(0)
    const initialStaged = await staged.allInnerTexts()
    expect(initialStaged.length).toBeGreaterThan(0)

    // Round-2a Task 5 fix-round regression: click-to-deselect. Clicking a
    // staged element hands the right panel to the element/tier inspector;
    // clicking a genuinely empty spot on the artboard must hand it back to
    // the canvas-level "Canvas" panel. The clip wrapper added around the
    // elements loop (GridEditorCanvas.vue) intercepts empty-canvas clicks,
    // so this previously never fired — verified against real pointer
    // clicks, not synthetic events (see memory: synthetic pointer events
    // prove nothing). Placed here (right after staged elements first
    // appear) rather than at the end of the journey so it doesn't ride on
    // the content-correctness assertions below.
    const canvasHeading = modal.locator('p.text-sm.font-medium.text-white\\/85', { hasText: 'Canvas' })
    const tierInspector = modal.locator('text=/^Type ·/')

    await staged.first().click()
    await expect(tierInspector).toBeVisible()
    await expect(canvasHeading).toBeHidden()

    const artboardBox = await modal.locator('[data-artboard]').boundingBox()
    expect(artboardBox, 'artboard bounding box must be measurable').toBeTruthy()
    const elementBoxes = await staged.evaluateAll(els => els.map(e => {
      const r = e.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }))
    // The contextual toolbar floats above the selected element (outside the
    // artboard's own bounds when the selection sits near the top) and must
    // also be avoided — a click that lands on it is a toolbar click, not an
    // empty-canvas click, regardless of which panel it happens to leave up.
    const toolbarBox = await modal.locator('[data-toolbar]').boundingBox()
    if (toolbarBox) elementBoxes.push(toolbarBox)
    const emptyPoint = findEmptyPoint(artboardBox!, elementBoxes)

    await page.mouse.click(emptyPoint.x, emptyPoint.y)
    await expect(canvasHeading).toBeVisible()
    await expect(tierInspector).toBeHidden()

    // Task 15 Critical fix: autopopulateV2 and the tier-seed+generate path
    // are mutually exclusive on a fresh layout — the wired text_layer_1 must
    // appear ONCE (as a tier_* staging element), never ALSO as a leftover
    // autopopulateV2 freeform element with id "text_layer_1" carrying the
    // same wired string.
    const freeformDup = modal.locator('[data-el-id="text_layer_1"]')
    expect(await freeformDup.count()).toBe(0)
    const summerSaleNodes = modal.locator('text="Summer Sale"')
    expect(await summerSaleNodes.count()).toBe(1)

    // Surprise re-rolls both axes under a new seed — click it twice and
    // assert the displayed seed actually changes each time (not merely "it
    // rendered" — see memory: graceful fallback hides integration failure).
    const surprise = modal.getByRole('button', { name: /Surprise/ })
    await expect(surprise).toBeVisible()
    const seedText = modal.locator('text=/seed \\d+/')
    const seed0 = await seedText.innerText()

    await surprise.click()
    await expect.poll(async () => await seedText.innerText()).not.toBe(seed0)
    const seed1 = await seedText.innerText()

    // Staged elements are still present (re-rolled, not wiped) after the
    // first Surprise.
    await expect.poll(async () => await staged.count()).toBeGreaterThan(0)

    await surprise.click()
    await expect.poll(async () => await seedText.innerText()).not.toBe(seed1)
    const seed2 = await seedText.innerText()
    expect(seed2).not.toBe(seed0)

    // Staged elements are still present after both re-rolls.
    await expect.poll(async () => await staged.count()).toBeGreaterThan(0)
  })

  test('reopening a saved generated layout does not duplicate the hero text', async ({ page }) => {
    // Merge-blocker regression: Task 15's dedup only covered the FRESH-open
    // path. On reopen, the layout already has `tiers` + staged elements, so
    // the old `else` branch ran autopopulateV2 over ALL props (including the
    // one the tier already renders literally) and appended a duplicate
    // freeform peer on top of the tier text. See omitConsumedProps in
    // shared/template-grid/generate/tiers.ts.
    await clearCanvas(page)

    const textId = await addNodeAndGetId(page, 'Text')
    await setWidgetByName(page, textId, 'text', 'Summer Sale')
    await nudgeNode(page, textId, -500, -300)

    const slId = await addNodeAndGetId(page, 'SmartLayout')

    await fitCanvas(page)
    const textLayerIdx = await inputIndexOf(page, slId, 'text_layer_1')
    expect(textLayerIdx).toBeGreaterThan(-1)

    const srcHandle = page.locator(`.vue-flow__node[data-id="${textId}"] .vue-flow__handle[data-handleid="output-0"]`)
    const tgtHandle = page.locator(`.vue-flow__node[data-id="${slId}"] .vue-flow__handle[data-handleid="input-${textLayerIdx}"]`)
    const src = await srcHandle.boundingBox()
    const tgt = await tgtHandle.boundingBox()
    expect(src, 'Text output handle must be on screen').toBeTruthy()
    expect(tgt, 'SmartLayout text_layer_1 handle must be on screen').toBeTruthy()

    const sx = src!.x + src!.width - 2, sy = src!.y + src!.height / 2
    const tx = tgt!.x + 2, ty = tgt!.y + tgt!.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 6 })
    await page.mouse.move(tx, ty, { steps: 6 })
    await page.mouse.up()

    await expect.poll(async () => await page.locator('.vue-flow__edge').count()).toBeGreaterThan(0)

    // First open: fresh layout self-seeds tiers + generates.
    await openSmartLayoutEditor(page, slId)
    let modal = page.locator('div.fixed.inset-0').last()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await expect.poll(async () => await modal.locator('[data-el-id^="tier_"]').count(), { timeout: 10_000 }).toBeGreaterThan(0)
    expect(await modal.locator('text="Summer Sale"').count()).toBe(1)

    // Save & close writes the generated layout (tiers + staged elements) back
    // to the node's widget.
    const saveBtn = modal.getByRole('button', { name: 'Save & close' })
    await expect(saveBtn).toBeVisible()
    await saveBtn.click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    // Reopen the same node: the layout is now non-fresh (has tiers + staged
    // elements). The hero text must still appear exactly once — no leftover
    // freeform "text_layer_1" element duplicating "tier_hero"'s content.
    await openSmartLayoutEditor(page, slId)
    modal = page.locator('div.fixed.inset-0').last()
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await expect.poll(async () => await modal.locator('[data-el-id^="tier_"]').count(), { timeout: 10_000 }).toBeGreaterThan(0)

    const freeformDup = modal.locator('[data-el-id="text_layer_1"]')
    expect(await freeformDup.count()).toBe(0)
    const summerSaleNodes = modal.locator('text="Summer Sale"')
    expect(await summerSaleNodes.count()).toBe(1)
  })

  test('mouse-dragging an element past the canvas edge sets overhang (Round-2a Task 10 fix)', async ({ page }) => {
    // Task 10's own report found the gap: nudgeSelected (keyboard/arrow nudge)
    // was unclamped with auto-overhang, but the actual mouse-drag path
    // (dragRegion() in shared/template-grid/editor.ts, called from
    // GridEditorCanvas.vue's onElementPointerMove) still clamped at the edge
    // and never set `overhang`. This is a real pointer drag — synthetic
    // dispatch proves nothing here (see memory: synthetic pointer events
    // prove nothing).
    await clearCanvas(page)

    const textId = await addNodeAndGetId(page, 'Text')
    await setWidgetByName(page, textId, 'text', 'Summer Sale')
    await nudgeNode(page, textId, -500, -300)

    const slId = await addNodeAndGetId(page, 'SmartLayout')

    await fitCanvas(page)
    const textLayerIdx = await inputIndexOf(page, slId, 'text_layer_1')
    expect(textLayerIdx).toBeGreaterThan(-1)

    const srcHandle = page.locator(`.vue-flow__node[data-id="${textId}"] .vue-flow__handle[data-handleid="output-0"]`)
    const tgtHandle = page.locator(`.vue-flow__node[data-id="${slId}"] .vue-flow__handle[data-handleid="input-${textLayerIdx}"]`)
    const src = await srcHandle.boundingBox()
    const tgt = await tgtHandle.boundingBox()
    expect(src, 'Text output handle must be on screen').toBeTruthy()
    expect(tgt, 'SmartLayout text_layer_1 handle must be on screen').toBeTruthy()

    const sx = src!.x + src!.width - 2, sy = src!.y + src!.height / 2
    const tx = tgt!.x + 2, ty = tgt!.y + tgt!.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 6 })
    await page.mouse.move(tx, ty, { steps: 6 })
    await page.mouse.up()

    await expect.poll(async () => await page.locator('.vue-flow__edge').count()).toBeGreaterThan(0)

    await openSmartLayoutEditor(page, slId)
    const modal = page.locator('div.fixed.inset-0').last()
    await expect(modal).toBeVisible({ timeout: 10_000 })

    const staged = modal.locator('[data-el-id^="tier_"]')
    await expect.poll(async () => await staged.count(), { timeout: 10_000 }).toBeGreaterThan(0)

    const target = staged.first()
    const elId = await target.getAttribute('data-el-id')
    expect(elId, 'dragged element must have a data-el-id').toBeTruthy()

    // Sanity control: freshly generated staged elements are never overhung.
    const elBefore = await readLiveElement(page, elId!)
    expect(elBefore, `element ${elId} must exist in the live template`).toBeTruthy()
    expect(elBefore.overhang).toBeFalsy()

    const before = await target.boundingBox()
    expect(before, 'staged element bounding box must be measurable').toBeTruthy()
    const artboardBox = await modal.locator('[data-artboard]').boundingBox()
    expect(artboardBox, 'artboard bounding box must be measurable').toBeTruthy()

    // Real pointer drag: grab the element's centre and drag it far to the
    // right, well past the artboard's right edge, staying on-screen (the
    // fixed 1600px viewport — see playwright.config.ts).
    const startX = before!.x + before!.width / 2
    const startY = before!.y + before!.height / 2
    const dx = Math.max(200, Math.min(500, 1590 - startX))
    const endX = startX + dx
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + dx / 2, startY, { steps: 6 })
    await page.mouse.move(endX, startY, { steps: 8 })
    await page.mouse.up()

    // Visual proof first: the element now renders past the artboard's right
    // edge instead of snapping back to it (a synthetic assertion here would
    // just prove the drag code ran, not that it moved the pixels — see
    // memory: graceful fallback hides integration failure).
    const after = await target.boundingBox()
    expect(after, 'dragged element bounding box must be measurable').toBeTruthy()
    expect(after!.x + after!.width).toBeGreaterThan(artboardBox!.x + artboardBox!.width)

    // Live composable state already has the flag, before any save — proves
    // the pointer-move handler itself set it (mirrors nudgeSelected), not
    // some derived-at-save-time behavior.
    const elLive = await readLiveElement(page, elId!)
    expect(elLive.overhang).toBe(true)
    expect(elLive.region.col).toBeGreaterThan(elBefore.region.col)

    // Save & close, then read the PERSISTED layout JSON back off the node's
    // widget — proves the flag was actually written to the template, not
    // just a transient render artifact.
    const saveBtn = modal.getByRole('button', { name: 'Save & close' })
    await expect(saveBtn).toBeVisible()
    await saveBtn.click()
    await expect(modal).not.toBeVisible({ timeout: 10_000 })

    const layoutAfter = JSON.parse(await getWidgetByName(page, slId, 'layout'))
    const elAfter = findElementInLayout(layoutAfter, elId!)
    expect(elAfter, `element ${elId} must exist in the saved layout`).toBeTruthy()
    expect(elAfter.overhang).toBe(true)
    // The drag only moved it horizontally — span/row untouched.
    expect(elAfter.region.colSpan).toBe(elBefore.region.colSpan)
    expect(elAfter.region.col).toBeGreaterThan(elBefore.region.col)
  })
})
