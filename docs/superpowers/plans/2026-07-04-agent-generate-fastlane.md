# Agent Fast-Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the agent planner returns a trivially-safe single node placement (one `addNode`, generator or studio, no wiring), skip the ghost/Keep&Run proposal ceremony — place the node directly (selected, in view, NOT run) and show a one-line confirmation (spec: `docs/superpowers/specs/2026-07-04-agent-generate-fastlane-design.md`).

**Architecture:** One pure predicate (`app/lib/agent/fastlane.ts`) decides eligibility from the parsed commands alone. One branch in `useCanvasAgent.ask()` (after the graph ghosts are built) commits through the SAME `opts.commit()` path the Keep button uses — so undo/glimm/id-mapping are identical — then sets `answer` instead of `changes`, and does NOT arm the run→look→fix review. Everything non-trivial is byte-identical to today.

**Tech Stack:** Vue 3 / TypeScript, vitest (`tests/unit/*.unit.spec.ts`), Playwright with `page.route()` mocking `/api/agent-plan` (deterministic, no real model call).

## Global Constraints

- Work on `main`, explicit `git add` paths only, never `-A`; no rebase/reset/stash (parallel sessions may commit).
- **Never auto-run a billable node.** The fast lane places and focuses; it must not call `opts.run`.
- Freeform/agent behavior for any non-eligible plan stays byte-identical — no changes to the planner prompt, `/api/agent-plan`, the proposal card UI, or `CanvasPromptBar.vue`.
- Predicate is PURE (commands in, boolean out) — no Vue, no I/O, no snapshot access.
- Commands run from `/Users/julien/Documents/GitHub/ComfyNext/frontend`.

Key facts verified in the current code (do not re-derive):
- `Command` = `{ op: string; target?: string; args?: Record<string, unknown> }` (`app/lib/agent/commandSurface.ts:44`).
- An `addNode` command carries its node type at `args.nodeType` (`app/lib/agent/surfaces/canvas.ts:247`).
- `capabilityByType(nodeType)` → `AgentCapability | undefined` with `.kind` (`'studio'|'generator'|'effect'`) and `.frontendOnly?` and `.title` (`app/lib/agent/capabilities.ts:114`).
- In `ask()`, after the loop, `graphBuilt: ProposedChange[]` holds the graph commands and `opts.commit()` promotes the on-canvas ghosts and returns committed ids. `keep()` calls `opts.commit()` then clears `changes/original/issues/review` (`useCanvasAgent.ts:215`).

---

### Task 1: `isFastLanePlacement` predicate (TDD)

**Files:**
- Create: `frontend/app/lib/agent/fastlane.ts`
- Test: `frontend/tests/unit/agent-fastlane.unit.spec.ts`

**Interfaces:**
- Produces (Task 2 consumes): `export function isFastLanePlacement(commands: Command[]): boolean`.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/agent-fastlane.unit.spec.ts`. Match the import style of an existing unit spec (`tests/unit/action-catalog.unit.spec.ts` uses the `~` alias) — adjust the path if that spec uses relative imports.

```ts
import { describe, it, expect } from 'vitest'
import { isFastLanePlacement } from '../../app/lib/agent/fastlane'
import type { Command } from '../../app/lib/agent/commandSurface'

const addNode = (nodeType: string, extra: Partial<Command> = {}): Command =>
  ({ op: 'addNode', args: { nodeType, id: '$new1', widgetOverrides: { prompt: 'a red fox' } }, ...extra })

describe('isFastLanePlacement', () => {
  it('accepts a single generator addNode', () => {
    expect(isFastLanePlacement([addNode('GenerateImageNode')])).toBe(true)
  })
  it('accepts a single frontend-only studio addNode (gradient/texture exception)', () => {
    expect(isFastLanePlacement([addNode('GradientStudio')])).toBe(true)
    expect(isFastLanePlacement([addNode('TextureStudio')])).toBe(true)
  })
  it('rejects a single effect addNode (a lone unwired edit is a half-plan)', () => {
    expect(isFastLanePlacement([addNode('EditImageNode')])).toBe(false)
    expect(isFastLanePlacement([addNode('UpscaleImageNode')])).toBe(false)
  })
  it('rejects a multi-command plan (addNode + connect)', () => {
    expect(isFastLanePlacement([
      addNode('GenerateImageNode'),
      { op: 'connect', args: { from: '$new1', to: 'node-2' } },
    ])).toBe(false)
  })
  it('rejects a single non-addNode command', () => {
    expect(isFastLanePlacement([{ op: 'setWidget', target: 'node-1', args: { name: 'steps', value: 30 } }])).toBe(false)
    expect(isFastLanePlacement([{ op: 'tuneNode', target: 'node-1', args: { request: 'bluer' } }])).toBe(false)
  })
  it('rejects an addNode that targets an existing node', () => {
    expect(isFastLanePlacement([addNode('GenerateImageNode', { target: 'node-1' })])).toBe(false)
  })
  it('rejects an unknown / non-catalog nodeType', () => {
    expect(isFastLanePlacement([addNode('SomeRawProviderNode')])).toBe(false)
  })
  it('rejects an empty plan', () => {
    expect(isFastLanePlacement([])).toBe(false)
  })
  it('rejects addNode with a non-string nodeType', () => {
    expect(isFastLanePlacement([{ op: 'addNode', args: {} }])).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/agent-fastlane.unit.spec.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `frontend/app/lib/agent/fastlane.ts`:

```ts
/**
 * Fast-lane eligibility for the canvas agent: is this plan a trivially-safe
 * single node placement that deserves to skip the ghost/Keep&Run ceremony?
 *
 * True iff the plan is exactly one addNode that CREATES a generator or a
 * (frontend-only) studio — free to place, free to run, nothing to wire, and
 * nothing existing to modify. Effects are excluded: a lone unwired EditImage
 * is a half-plan whose intent the ghost preview should show. Pure: commands
 * in, boolean out — no Vue, no I/O.
 */
import type { Command } from '~/lib/agent/commandSurface'
import { capabilityByType } from '~/lib/agent/capabilities'

export function isFastLanePlacement(commands: Command[]): boolean {
  if (commands.length !== 1) return false
  const cmd = commands[0]!
  if (cmd.op !== 'addNode') return false
  if (cmd.target) return false // creates, doesn't modify anything existing
  const nodeType = cmd.args?.nodeType
  if (typeof nodeType !== 'string') return false
  const cap = capabilityByType(nodeType)
  if (!cap) return false
  return cap.kind === 'generator' || (cap.kind === 'studio' && cap.frontendOnly === true)
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/agent-fastlane.unit.spec.ts` → all pass.

- [ ] **Step 5: Commit**

```bash
git add app/lib/agent/fastlane.ts tests/unit/agent-fastlane.unit.spec.ts
git commit -m "feat(agent): isFastLanePlacement predicate — single generator/studio addNode"
```

---

### Task 2: Fast-lane branch in `useCanvasAgent.ask()`

**Files:**
- Modify: `frontend/app/composables/useCanvasAgent.ts`

**Interfaces:**
- Consumes: Task 1's `isFastLanePlacement`; existing `opts.commit()`, `opts.getSnapshot`, `capabilityByType`, `graphBuilt`, `answer`, `original`, `changes`.
- Produces: no new exports. Behavior: an eligible plan commits + confirms + returns without a proposal card.

- [ ] **Step 1: Add imports** (top of `useCanvasAgent.ts`, with the other `~/lib/agent` imports):

```ts
import { isFastLanePlacement } from '~/lib/agent/fastlane'
import { capabilityByType } from '~/lib/agent/capabilities'
```

- [ ] **Step 2: Insert the fast-lane branch** in `ask()`. Locate this exact block (currently ~lines 138–147, right after the per-command loop closes and before `// Graph-health readout`):

```ts
      // Graph-health readout is about graph structure — only when graph changed.
      issues.value = graphBuilt.length ? verifyCanvas(probe) : []
```

Insert immediately BEFORE that line:

```ts
      // FAST LANE: a single generator/studio placement the user already fully
      // described (e.g. "a red fox in snow") needs no proposal ceremony. Commit
      // it through the SAME path as the Keep button (undo/glimm/id-map identical),
      // focus it, confirm in one line — and DO NOT run it (spending stays the
      // user's explicit act on the node). Anything else falls through to the
      // normal ghost → Keep/Reject flow below.
      if (isFastLanePlacement(commands) && graphBuilt.length === 1) {
        // Blueprint the ghost, then promote it exactly like keep() does.
        opts.preview(graphBuilt.map(c => c.command), true)
        const committed = opts.commit() || []
        changes.value = []; original = null; issues.value = []; review.value = null
        const nodeType = commands[0]!.args?.nodeType as string
        const title = capabilityByType(nodeType)?.title ?? 'the node'
        answer.value = message?.trim()
          ? message.trim()
          : `Added ${title} — press Run when you're ready.`
        if (committed.length) opts.run === undefined // no-op guard: never auto-run (documents intent)
        return
      }
```

Note: the `opts.run === undefined` line is a deliberate documentation no-op making the never-run rule visible at the call site; keep it or drop it, but do NOT call `opts.run`. The reviewer may flag it as dead — that's acceptable, it's intent-signalling; if the reviewer prefers, replace with a plain comment `// (intentionally no opts.run — never auto-run)`.

- [ ] **Step 3: Verify no double-commit path** — read the lines immediately after your insertion through the end of the `try` block. Confirm: when the branch `return`s, none of the later `opts.preview(graphBuilt…)` / `changes.value = built` code runs (the `return` guarantees it). The non-eligible path is untouched.

- [ ] **Step 4: Type-check + unit canary**

Run: `npx vue-tsc --noEmit -p . 2>&1 | grep -E "useCanvasAgent|fastlane"` → no hits (repo has ~600 pre-existing unrelated errors; only touched files must be clean).
Run: `npx vitest run tests/unit/agent-fastlane.unit.spec.ts` → still green.

- [ ] **Step 5: Commit**

```bash
git add app/composables/useCanvasAgent.ts
git commit -m "feat(agent): fast-lane branch — auto-place single generator/studio plans, no proposal card"
```

---

### Task 3: e2e — mocked planner, no real model call (controller)

**Files:**
- Create: `frontend/tests/agent-fastlane.spec.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the spec.** It intercepts `POST /api/agent-plan` with `page.route()` and returns canned responses (the route returns `{ text: <json-string> }`; `parseAgentResponse` decodes that inner JSON — inspect `app/lib/agent/protocol.ts:parseAgentResponse` to match the exact envelope shape the mock must return: the inner text is JSON with `commands`, and optionally `reasoning`/`rationale`/`message`). Requires the agent's Anthropic key gate to be satisfied — the mock bypasses the real call, but `ask()` still checks `opts.apiKey()`; seed a dummy key via the same localStorage key Settings uses (grep `Anthropic` in `app/components/SettingsModal.vue` for the exact key; set it in `addInitScript`).

```ts
import { expect, test, type Page } from '@playwright/test'
import { openBlankWorkflow, waitForBackend } from './_helpers'

// Inner text the /api/agent-plan route wraps in { text }. Shape must match what
// parseAgentResponse expects — VERIFY against app/lib/agent/protocol.ts before
// finalizing (commands[], reasoning?, rationale?/changeRationales?, message?).
function planText(commands: unknown[], message = ''): string {
  return JSON.stringify({ reasoning: '', commands, rationale: [], message })
}

async function seedAgentKey(page: Page) {
  // TODO(implementer): replace KEY with the exact localStorage key from
  // SettingsModal.vue (grep 'Anthropic'). A non-empty value satisfies the gate.
  await page.addInitScript(() => {
    try { localStorage.setItem('comfynext:Comfy.VueNodes.Enabled', 'true') } catch {}
    try { localStorage.setItem('<ANTHROPIC_KEY_STORAGE_KEY>', 'sk-ant-test') } catch {}
  })
}

test.describe('Agent fast-lane', () => {
  test.beforeEach(async ({ page }) => {
    await seedAgentKey(page)
    await waitForBackend(page)
    await openBlankWorkflow(page)
  })

  test('single-node plan auto-places with no proposal card, nothing running', async ({ page }) => {
    await page.route('**/api/agent-plan', async (route) => {
      await route.fulfill({ json: { text: planText([
        { op: 'addNode', args: { nodeType: 'GenerateImageNode', id: '$new1', widgetOverrides: { prompt: 'a red fox in snow' } } },
      ]) } })
    })
    const bar = page.getByPlaceholder(/Ask about the graph/i)
    await bar.fill('a red fox in snow')
    await bar.press('Enter')
    // A node appears…
    await expect.poll(async () => page.locator('.vue-flow__node').count()).toBeGreaterThan(0)
    // …with NO Keep/Reject proposal card (grep the proposal component's button text
    // — VERIFY: the AgentProposal card renders a "Keep" / "Keep & Run" button).
    await expect(page.getByRole('button', { name: /Keep & Run|^Keep$/ })).toHaveCount(0)
    // …and a one-line confirmation is shown.
    await expect(page.getByText(/press Run when you're ready|Added /i)).toBeVisible()
    // …and nothing is running (the run pill stays at 0).
    await expect(page.getByText(/0 running/)).toBeVisible()
  })

  test('multi-command plan still shows the proposal card (regression guard)', async ({ page }) => {
    await page.route('**/api/agent-plan', async (route) => {
      await route.fulfill({ json: { text: planText([
        { op: 'addNode', args: { nodeType: 'GenerateImageNode', id: '$new1', widgetOverrides: { prompt: 'a fox' } } },
        { op: 'addNode', args: { nodeType: 'UpscaleImageNode', id: '$new2' } },
        { op: 'connect', args: { from: '$new1', to: '$new2' } },
      ]) } })
    })
    const bar = page.getByPlaceholder(/Ask about the graph/i)
    await bar.fill('a fox, then upscale it')
    await bar.press('Enter')
    // The proposal card / Keep affordance appears as today.
    await expect(page.getByRole('button', { name: /Keep & Run|^Keep$/ })).toBeVisible({ timeout: 15_000 })
  })
})
```

- [ ] **Step 2: Resolve the TODOs** — before running, replace `<ANTHROPIC_KEY_STORAGE_KEY>` with the real key (grep `SettingsModal.vue`), confirm the `parseAgentResponse` envelope (adjust `planText` if it expects `changeRationales` not `rationale`, or a bare commands array), and confirm the proposal button label (grep `AgentProposal.vue` / `CanvasPromptBar.vue` for "Keep"). Confirm the placeholder text matches `CanvasPromptBar.vue`.

- [ ] **Step 3: Run** — `PW_BASE_URL=http://localhost:3000 npx playwright test tests/agent-fastlane.spec.ts` (backend :8188 + dev server :3000 up). Expected: 2 passed. Debug with prior lessons: overlay-intercepted clicks, swallow unexpected file choosers, prefer role/text locators.

- [ ] **Step 4: Commit**

```bash
git add tests/agent-fastlane.spec.ts
git commit -m "test(agent): fast-lane e2e — mocked planner, auto-place vs proposal-card regression"
```

## Self-review notes

- Spec coverage: §2 predicate ✓ (T1, full truth table incl. studio/effect split), §3 branch ✓ (T2 — same commit path, sets answer, no review arm, no run), §4 no-UI-no-door-change ✓ (only useCanvasAgent + new lib file touched), §5 unit + e2e ✓ (T1 + T3, e2e mocks the route per spec).
- The spec says "after parse + the existing dry-run/verify step" — the branch is placed after `graphBuilt` is populated (the per-command dry-run loop) and gated on `graphBuilt.length === 1` so a command the dry-run rejected can't slip through as a phantom fast-lane. Predicate + built-count agree before committing.
- Type consistency: `isFastLanePlacement(commands: Command[])` defined T1, called T2 with the same `commands` array from `callModel`. `capabilityByType(...).title` used in T2 confirmation, exists per capabilities.ts:114 + interface.
- The e2e is authored with explicit VERIFY TODOs rather than guessed magic strings (envelope shape, storage key, button label) — the implementer resolves them against the real files; this is intentional, not a placeholder gap in the logic.
