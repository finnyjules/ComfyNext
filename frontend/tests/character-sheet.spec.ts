import { test, expect, type Page } from '@playwright/test'
import { openBlankWorkflow, waitForBackend } from './_helpers'

/**
 * Character sheet E2E (character-system plan, Task 15 — final verification).
 *
 * Proves the plan's acceptance property end-to-end: casting a character into
 * a Shot Director (video) AND using a character "in image" both resolve to
 * the SAME identity asset — the state's composite sheet filename. Two
 * consumers, one asset.
 *
 * `/api/characters-local` is route-intercepted with a fixture character
 * (`fixture-cal`) whose default state already has a locked `sheetImage` and
 * a `descriptor` — no live generation, no paid calls. `/prompt` and
 * `/upload/image` are also intercepted as a belt-and-suspenders guard
 * against real backend spend, though neither scenario should reach them:
 * Scenario A's `sailor:shotDirectorGenerate` writes the FilmShotNode's
 * widgets synchronously before it ever dispatches the run, and the app's own
 * cost-confirm gate (`runVueWorkflow`) blocks queuing until a user clicks
 * "Confirm" — which this spec never does.
 *
 * Page state (node data, including widgets with `sailor_widget: "internal"`
 * that never render in the DOM, like FilmShotNode's `model_options`) is read
 * through Vue's dev-only `__vueParentComponent` backlink up to
 * VueNodeCanvas's `defineExpose` surface (`getNodes`/`getEdges`) — the same
 * pattern `tests/moodboard-core.spec.ts` established, reading the app's own
 * live objects rather than a test fixture's guess at their shape.
 */

const SHEET_FILENAME = 'sheet-cal.png'
const DESCRIPTOR = 'soaked navy jacket'

const FIXTURE = {
  characters: [{
    name: 'Cal',
    slug: 'fixture-cal',
    states: [{
      id: 'default',
      label: 'Default',
      descriptor: DESCRIPTOR,
      refImages: ['cover-cal.png'],
      coverIndex: 0,
      panels: [],
      sheetImage: SHEET_FILENAME,
      status: 'locked',
      stressResult: null,
      updatedAt: '2026-08-13T00:00:00.000Z',
    }],
    loraName: null,
    trigger: null,
    notes: '',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
  }],
}

async function mockCharactersLocal(page: Page) {
  await page.route('**/api/characters-local', async (route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({ json: FIXTURE })
    } else if (method === 'PATCH') {
      // Nothing in either scenario should PATCH, but stub it so a stray
      // write can't hit the real registry file.
      await route.fulfill({ json: { ok: true } })
    } else {
      await route.continue()
    }
  })
}

/** Belt-and-suspenders: neither scenario should reach these (see file
 *  header), but intercept them anyway so a real submission can never spend. */
async function blockBackendSpend(page: Page) {
  await page.route('**/prompt', (route) =>
    route.fulfill({ json: { prompt_id: 'e2e-blocked', number: 0, node_errors: {} } }))
  await page.route('**/upload/image', (route) =>
    route.fulfill({ json: { name: 'e2e-blocked.png', subfolder: '', type: 'input' } }))
}

/** Walk up from `.vue-flow` to VueNodeCanvas's defineExpose surface — same
 *  recipe as tests/moodboard-core.spec.ts's pullNodeData/pullSerializedWorkflow. */
async function findExposed(page: Page, method: string) {
  return page.evaluateHandle((m) => {
    let c: any = (document.querySelector('.vue-flow') as any)?.__vueParentComponent
    while (c && !(c.exposed && typeof c.exposed[m] === 'function')) c = c.parent
    if (!c) throw new Error('VueNodeCanvas exposed surface not reachable')
    return c.exposed
  }, method)
}

async function pullNodes(page: Page): Promise<any[]> {
  const exposed = await findExposed(page, 'getNodes')
  return page.evaluate((e: any) => JSON.parse(JSON.stringify(e.getNodes())), exposed)
}

async function pullEdges(page: Page): Promise<any[]> {
  const exposed = await findExposed(page, 'getEdges')
  return page.evaluate((e: any) => JSON.parse(JSON.stringify(e.getEdges())), exposed)
}

/** `widgetsValues` is a positional array; `widgetDefs` carries the names in
 *  the same order — zip them to read a widget by name (including
 *  `sailor_widget: "internal"` ones, which never render as DOM inputs). */
function widgetByName(node: any, name: string): unknown {
  const defs: { name: string }[] = node?.data?.widgetDefs ?? []
  const idx = defs.findIndex((d) => d.name === name)
  if (idx < 0) return undefined
  return node?.data?.widgetsValues?.[idx]
}

test.describe('Character sheet: images and video consume the same identity asset', () => {
  test.beforeEach(async ({ page }) => {
    await mockCharactersLocal(page)
    await blockBackendSpend(page)
    await waitForBackend(page)
    await openBlankWorkflow(page)
  })

  test('Scenario A (video): Shot Director cast + Generate writes the FilmShotNode from the sheet + descriptor', async ({ page }) => {
    test.setTimeout(60_000)

    // Drop a Shot Director node (Studios door in the UI; the headless
    // sailor:addNode event is the same path the "Add" toolbar door uses).
    await page.evaluate(() =>
      window.dispatchEvent(new CustomEvent('sailor:addNode', { detail: { nodeType: 'ShotDirector' } })))
    const shotDirectorCard = page.locator('.vue-flow__node').filter({ hasText: 'Shot Director' }).first()
    await expect(shotDirectorCard).toBeVisible({ timeout: 10_000 })

    // Open its editor (real UI: double-click the card, same as the user).
    await shotDirectorCard.dblclick()
    const dialog = page.getByRole('dialog').filter({ hasText: 'Shot Director' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Cast fixture-cal via the "+ Cast" picker — the picker is the OTHER
    // editor of sheet.cast (alongside canvas wiring; see castEdges.ts), and
    // is fully drivable through real clicks with no synthetic-wire hack.
    await dialog.getByRole('button', { name: '+ Cast', exact: true }).click()
    const picker = page.getByRole('heading', { name: 'Cast a character', exact: true })
    await expect(picker).toBeVisible({ timeout: 10_000 })
    // Single-variant card → clicking the name picks directly (stateId: null,
    // the default state implied) rather than expanding a variant row.
    await page.getByText('Cal', { exact: true }).click()
    await expect(picker).toBeHidden()
    // Cast landed: the "No one cast yet…" placeholder is replaced by a chip
    // with a remove ("×") button.
    await expect(dialog.getByText('No one cast yet', { exact: false })).toBeHidden()
    await expect(dialog.getByRole('button', { name: '×', exact: true })).toBeVisible()

    // Generate — writes the FilmShotNode's widgets synchronously (see
    // handleShotDirectorGenerate in VueNodeCanvas.vue) before it ever
    // dispatches sailor:runFiltered, and closes this dialog.
    // Two buttons match /^Generate/ in this dialog: the environment-plate
    // "Generate ~$…" helper and the shot's own "Generate · ~$…" submit — the
    // middot disambiguates the real one.
    await dialog.getByRole('button', { name: /Generate ·/ }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    await expect.poll(async () => {
      const nodes = await pullNodes(page)
      const film = nodes.find((n: any) => n.data?.nodeType === 'FilmShotNode')
      return !!film && (film.data?.widgetDefs?.length ?? 0) > 0
    }, { timeout: 10_000, message: 'Generate should spawn a FilmShotNode with widget schema loaded' }).toBe(true)

    const nodes = await pullNodes(page)
    const film = nodes.find((n: any) => n.data?.nodeType === 'FilmShotNode')
    expect(film, 'FilmShotNode should exist').toBeTruthy()

    const prompt = widgetByName(film, 'prompt') as string
    expect(prompt, 'compiled prompt should carry the cast clause with the state descriptor in parens')
      .toContain(`(${DESCRIPTOR})`)

    const modelOptionsRaw = widgetByName(film, 'model_options') as string
    expect(modelOptionsRaw, 'model_options widget should exist (sailor_widget: internal — never rendered in the DOM)').toBeTruthy()
    const modelOptions = JSON.parse(modelOptionsRaw)
    expect(Array.isArray(modelOptions.image_urls) && modelOptions.image_urls.length > 0, 'image_urls should be populated from the cast').toBe(true)
    expect(modelOptions.image_urls[0]).toContain(`filename=${SHEET_FILENAME}`)
    expect(modelOptions.image_urls[0]).toContain('type=input')
  })

  test('Scenario B (image): "Use in image" wires the SAME sheet filename into a ConsistentFaceNode', async ({ page }) => {
    test.setTimeout(60_000)

    // Open the Characters panel (real UI toolbar button).
    await page.getByRole('button', { name: 'Characters', exact: true }).click()
    const characterRow = page.getByText('Cal', { exact: true }).first()
    await expect(characterRow).toBeVisible({ timeout: 10_000 })
    await characterRow.click() // expand the row to reveal its actions

    // fixture-cal has no loraName, so "Use in image" fires straight to the
    // sheet path (no lora/sheet menu — see CharacterLibraryPanel's useInImage).
    await page.getByRole('button', { name: 'Use in image', exact: true }).click()

    // Poll until both nodes exist AND the Image node's widget schema has
    // arrived (widgetDefs populates asynchronously off the object_info
    // fetch — reading widgetsValues before it lands races the schema).
    await expect.poll(async () => {
      const nodes = await pullNodes(page)
      const img = nodes.find((n: any) => n.data?.nodeType === 'Image')
      const face = nodes.find((n: any) => n.data?.nodeType === 'ConsistentFaceNode')
      return !!img && !!face && (img.data?.widgetDefs?.length ?? 0) > 0
    }, { timeout: 10_000, message: '"Use in image" should spawn an Image → ConsistentFaceNode pair with widget schema loaded' }).toBe(true)

    const nodes = await pullNodes(page)
    const imageNode = nodes.find((n: any) => n.data?.nodeType === 'Image')
    const faceNode = nodes.find((n: any) => n.data?.nodeType === 'ConsistentFaceNode')
    expect(imageNode, 'Image node should exist').toBeTruthy()
    expect(faceNode, 'ConsistentFaceNode should exist').toBeTruthy()

    // Bare filename (not a /view URL) — the shape identityRefs()/coverFirstRefs()
    // hand back, and the same sheet filename Scenario A sent as image_urls[0].
    expect(widgetByName(imageNode, 'image')).toBe(SHEET_FILENAME)

    const edges = await pullEdges(page)
    const wired = edges.some((e: any) => String(e.source) === String(imageNode.id) && String(e.target) === String(faceNode.id))
    expect(wired, 'Image node should be wired into the ConsistentFaceNode').toBe(true)
  })
})
