import { test, expect, type Page } from '@playwright/test'
import { dropNode, waitForBackend } from './_helpers'

/**
 * Grouping — end-to-end.
 *
 * The assertion that matters is the world-transform invariant: group, move the
 * group, ungroup, and every child must end up exactly where the screen showed
 * it. A viewport that merely LOOKS right is not evidence — grouping fails in
 * precisely the way a screenshot cannot catch, so this reads numeric state out
 * of the properties panel.
 *
 * Why reading the Position inputs is a sufficient proxy for WORLD position:
 * those inputs bind the selected object's LOCAL transform (axisField() in
 * Scene3DStudioSurface.vue reads `selected.position[axis]` verbatim). Both
 * primitives start at the root, so pre-group local == world. `groupObjects`
 * always creates the group at identity rotation and unit scale (pinned by
 * scene3d-hierarchy.unit.spec.ts), so while they are grouped a child's world
 * position is exactly `group.position + child.local`; and after `ungroupObject`
 * both children are back at the root, where local == world again. So the
 * end-state check "child local == pre-group local + the offset the group was
 * dragged by" IS the world-transform invariant for this case, expressed
 * entirely through the DOM — no extra production hook required.
 */

// ── setup ─────────────────────────────────────────────────────────────────────

/**
 * A local variant of tests/_helpers.ts's openBlankWorkflow that does NOT wait for
 * 'networkidle'. Against the live backend this suite runs against (a real ComfyUI
 * at 127.0.0.1:8188, per the task's environment — not a mocked one), the app polls
 * /system_stats continuously, so 'networkidle' never fires and the shared helper
 * times out entirely before it even reaches the "Start a blank project" button.
 * Kept local rather than patched into the shared helper because parallel sessions
 * are actively touching this repo and other specs already depend on the shared
 * helper's exact behavior — not this task's place to change it.
 * (Copied from tests/shader-fill.spec.ts, which documents the same constraint.)
 */
async function openBlankWorkflow(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('sailor:Comfy.VueNodes.Enabled', 'true') } catch {}
  })
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await page.reload()
  await page.waitForLoadState('domcontentloaded')

  const vueFlow = page.locator('.vue-flow').first()
  if (await vueFlow.isVisible({ timeout: 3_000 }).catch(() => false)) {
    // A project already auto-resumed (e.g. a prior test in this file left one).
  } else {
    // The new project tab boots a whole embedded ComfyUI iframe (bridge handshake,
    // node-def registration) before VueNodeCanvas mounts — this takes noticeably
    // longer than a plain SPA route change, and the first click occasionally
    // doesn't take, so retry rather than trusting a single one.
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.getByRole('button', { name: /Start a blank project/i }).first().click()
      const ok = await vueFlow.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false)
      if (ok) break
      if (attempt === 2) throw new Error('openBlankWorkflow: .vue-flow never appeared after 3 attempts')
    }
  }

  const skipStartModal = page.getByRole('button', { name: /Skip — start with a blank canvas/i })
  if (await skipStartModal.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skipStartModal.click()
    await skipStartModal.waitFor({ state: 'hidden', timeout: 5_000 })
  }
}

// ── studio helpers ───────────────────────────────────────────────────────────

type Vec3 = [number, number, number]

const AXES = ['Position X', 'Position Y', 'Position Z'] as const

/** The object-list row for `name`. Rows are rendered by Scene3DObjectRow.vue,
 *  which stamps `data-object-name` — matching on the attribute rather than on
 *  visible text keeps this unambiguous when a group and a child share a word. */
function row(page: Page, name: string) {
  return page.locator(`[data-testid="object-row"][data-object-name="${name}"]`)
}

/** Read the selected object's LOCAL position out of the Transform panel. */
async function readPosition(page: Page): Promise<Vec3> {
  const out: number[] = []
  for (const label of AXES) out.push(Number(await page.getByLabel(label).inputValue()))
  return out as Vec3
}

/** Type a position into the Transform panel (v-model.number commits on `input`,
 *  which `fill` dispatches). */
async function writePosition(page: Page, p: Vec3) {
  for (let i = 0; i < 3; i++) await page.getByLabel(AXES[i]!).fill(String(p[i]))
}

/** Select a row and wait for the Transform panel to actually be showing THAT
 *  object before reading — the panel is driven by Vue reactivity, so a bare read
 *  straight after the click can race it. Keyed on the row's selected styling
 *  (`bg-white/15`), which is what tells us `selectedIds` has landed. */
async function selectOnly(page: Page, name: string) {
  await row(page, name).click()
  await expect(row(page, name)).toHaveClass(/bg-white\/15/)
}

/** Add a primitive from the viewport's add-menu. The menu click is scoped to the
 *  toolbar pill (`[data-prim-menu]`) so a kind label that also appears elsewhere
 *  in the inspector can never be picked up by accident. */
async function addPrimitive(page: Page, label: string) {
  const toolbar = page.locator('[data-prim-menu]')
  await toolbar.getByRole('button', { name: 'Primitive', exact: true }).click()
  await toolbar.getByRole('button', { name: label, exact: true }).click()
}

// ── the test ─────────────────────────────────────────────────────────────────

test.describe('3D Studio — object grouping (E2E)', () => {
  test('group, move the group, ungroup — every child keeps its world position', async ({ page }) => {
    await waitForBackend(page)
    await openBlankWorkflow(page)
    // Taller than the config default (1600x1000): at 1000px the freshly-added
    // node's footer (Edit/Render) lands directly behind the fixed "Ask about the
    // graph" chat bar, which intercepts the click even though it's visually a thin
    // strip — Playwright's actionability check is a real hit-test, so it (correctly)
    // refuses a click something else would eat.
    await page.setViewportSize({ width: 1600, height: 1300 })

    await dropNode(page, 'Scene3DStudio')

    // Open the studio via the node's own Edit button — that handler is literally
    // `window.dispatchEvent(new CustomEvent('sailor:openScene3DStudio', …))`
    // (Scene3DStudioNode.vue:79), so this is the brief's entry recipe driven
    // through the real UI, and it needs no scraping of the vue-flow node id.
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('3D Studio', { exact: true })).toBeVisible({ timeout: 15_000 })

    // A fresh Scene3DStudio node parses to defaultDoc(), whose `objects` is empty —
    // asserted so a seeded default can never make the counts below vacuous.
    await expect(page.locator('[data-testid="object-row"]')).toHaveCount(0)

    // ── two primitives, at deliberately DIFFERENT positions ──────────────────
    // Both primitives are created at [0, 0.5, 0]. Left there, the group's bounds
    // centre would coincide with both children and every child local would be
    // exactly zero — a state in which "forgot to rebase" and "rebased correctly"
    // produce the SAME numbers. Distinct positions are what make the assertion
    // at the end able to fail.
    const BOX_POS: Vec3 = [1.5, 0.5, -0.5]
    const SPHERE_POS: Vec3 = [-0.5, 2, 1]

    await addPrimitive(page, 'Box')
    await expect(row(page, 'Box')).toHaveCount(1)
    await selectOnly(page, 'Box')
    await writePosition(page, BOX_POS)

    await addPrimitive(page, 'Sphere')
    await expect(row(page, 'Sphere')).toHaveCount(1)
    await selectOnly(page, 'Sphere')
    await writePosition(page, SPHERE_POS)

    // Record the pre-group positions by READING them back, rather than trusting
    // what we typed — if a write silently didn't land, the invariant below would
    // otherwise be checked against a fiction.
    await selectOnly(page, 'Box')
    const boxBefore = await readPosition(page)
    expect(boxBefore).toEqual(BOX_POS)
    await selectOnly(page, 'Sphere')
    const sphereBefore = await readPosition(page)
    expect(sphereBefore).toEqual(SPHERE_POS)

    // ── group ────────────────────────────────────────────────────────────────
    await selectOnly(page, 'Box')
    await row(page, 'Sphere').click({ modifiers: ['Shift'] })
    await expect(page.getByRole('button', { name: 'Group', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Group', exact: true }).click()

    // A group row appeared, it reports two children, and both primitives now sit
    // INSIDE its subtree. Scene3DObjectRow renders a row's descendants as
    // siblings within the row's own wrapper <div>, so the wrapper containing the
    // group row must also contain both child rows — and, since the tree is
    // rendered from `rootObjects()`, three rows total means neither child is also
    // still being drawn at the root.
    const groupRow = row(page, 'Group')
    await expect(groupRow).toHaveCount(1)
    await expect(groupRow.locator('[data-testid="object-row-children"]')).toHaveText('2')
    const groupBlock = groupRow.locator('xpath=..')
    await expect(groupBlock.locator('[data-testid="object-row"][data-object-name="Box"]')).toHaveCount(1)
    await expect(groupBlock.locator('[data-testid="object-row"][data-object-name="Sphere"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="object-row"]')).toHaveCount(3)

    // The children are still where the user left them: their world position is
    // group.position + local while grouped (the group is created at identity
    // rotation / unit scale), so this is a real check, not bookkeeping.
    await selectOnly(page, 'Group')
    const groupBefore = await readPosition(page)
    for (const [name, before] of [['Box', boxBefore], ['Sphere', sphereBefore]] as const) {
      await selectOnly(page, name)
      const local = await readPosition(page)
      for (let i = 0; i < 3; i++) expect(local[i]! + groupBefore[i]!).toBeCloseTo(before[i]!, 5)
    }

    // ── move the group ───────────────────────────────────────────────────────
    const DELTA_X = 2.5
    await selectOnly(page, 'Group')
    await page.getByLabel('Position X').fill(String(groupBefore[0]! + DELTA_X))
    await expect
      .poll(async () => (await readPosition(page))[0])
      .toBeCloseTo(groupBefore[0]! + DELTA_X, 5)

    // ── ungroup ──────────────────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Ungroup', exact: true }).click()
    await expect(row(page, 'Group')).toHaveCount(0)
    await expect(page.locator('[data-testid="object-row"]')).toHaveCount(2)

    // ── THE INVARIANT ────────────────────────────────────────────────────────
    // Back at the root, local == world again. Each child must read its original
    // world position shifted by exactly the offset the group was moved by — no
    // more (the group's transform applied twice), no less (the rebase skipped),
    // and nothing at all on the untouched axes.
    for (const [name, before] of [['Box', boxBefore], ['Sphere', sphereBefore]] as const) {
      const expected: Vec3 = [before[0]! + DELTA_X, before[1]!, before[2]!]
      await selectOnly(page, name)
      for (let i = 0; i < 3; i++) {
        await expect
          .poll(async () => (await readPosition(page))[i]!, { timeout: 5_000 })
          .toBeCloseTo(expected[i]!, 5)
      }
    }
  })
})
