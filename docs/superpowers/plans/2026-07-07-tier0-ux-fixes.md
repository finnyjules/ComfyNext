# Tier 0 UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every first-session dead end found in the 2026-07-07 UX audit: flag-off blank canvas, BYO-API-key wall, tab-close data loss, unpriced credit nodes, dead help link, dev leaks.

**Architecture:** All changes are in the Nuxt frontend (`frontend/`). The AI-key change moves key resolution server-side (env var via runtimeConfig, client key becomes an optional override); everything else is targeted edits to existing files. No new dependencies.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Vitest (`npm run test:unit`), vue-sonner toasts (already imported in `default.vue` as `toast`).

## Global Constraints

- Work directly on `main` — NEVER create a feature branch (user rule).
- `git add` only the files you touched, by explicit path — NEVER `git add -A` (user rule). The repo has unrelated uncommitted changes; do not stage or revert them.
- All paths below are relative to `frontend/` unless prefixed with `../`.
- Run unit tests from `frontend/`: `npx vitest run tests/unit/<file> --reporter=basic` (full suite: `npm run test:unit`).
- Copy/tone: calm, one-line, no exclamation marks. Error copy names the fix, not just the failure.
- Color idioms: no purple/violet accents; helper text `text-[11px] text-white/40`.
- Comments: only where the code can't say it (constraint/why), matching each file's existing comment density.
- Explicitly OUT of scope (decided during planning, don't chase): the canvas FPS/debug HUD is the LiteGraph iframe's `Comfy.Graph.CanvasInfo` setting — once Task 4 makes the Vue canvas the default it's no longer visible to default users, so it is not touched here. The Run button's blue color is PARKED by the user — do not change `--action` or `#818cf8`.

---

### Task 1: Server-side Anthropic key resolution (pure helpers + tests)

**Files:**
- Modify: `server/lib/agentRequest.ts`
- Test: `tests/unit/agent-request.unit.spec.ts`

**Interfaces:**
- Produces: `optionalApiKey(v: unknown): string | undefined` and `resolveAnthropicKey(serverKey: string | undefined, clientKey: string | undefined): string` (throws `{statusCode: 503}` when neither is set). Task 2 calls both from every AI route.
- Keeps: `requireApiKey` stays exported until Task 2 removes its last callers, then it is deleted here (step 6).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/agent-request.unit.spec.ts` (match the file's existing describe/import style):

```ts
import { optionalApiKey, resolveAnthropicKey } from '~~/server/lib/agentRequest'
// (merge into the existing import from the same module)

describe('resolveAnthropicKey', () => {
  it('prefers the client key (BYOK override) over the server key', () => {
    expect(resolveAnthropicKey('sk-server', 'sk-client')).toBe('sk-client')
  })
  it('falls back to the server key when the client sends none', () => {
    expect(resolveAnthropicKey('sk-server', undefined)).toBe('sk-server')
    expect(resolveAnthropicKey('sk-server', '')).toBe('sk-server')
  })
  it('throws 503 with remedy copy when neither key exists', () => {
    try {
      resolveAnthropicKey(undefined, undefined)
      expect.unreachable('should have thrown')
    } catch (e: any) {
      expect(e.statusCode).toBe(503)
      expect(e.message).toContain('NUXT_ANTHROPIC_API_KEY')
    }
  })
  it('treats whitespace-only keys as absent', () => {
    expect(() => resolveAnthropicKey('   ', '  ')).toThrow()
  })
})

describe('optionalApiKey', () => {
  it('passes through a real key and normalizes empty to undefined', () => {
    expect(optionalApiKey('sk-abc')).toBe('sk-abc')
    expect(optionalApiKey('')).toBeUndefined()
    expect(optionalApiKey(undefined)).toBeUndefined()
    expect(optionalApiKey(null)).toBeUndefined()
  })
  it('still rejects oversized keys', () => {
    expect(() => optionalApiKey('x'.repeat(501))).toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/agent-request.unit.spec.ts --reporter=basic`
Expected: FAIL — `optionalApiKey`/`resolveAnthropicKey` not exported.

- [ ] **Step 3: Implement the helpers**

In `server/lib/agentRequest.ts`, after `requireApiKey` (line ~38):

```ts
export function optionalApiKey(v: unknown): string | undefined {
  return optionalString(v, 'apiKey', MAX_KEY_CHARS)
}

/** Shared-key resolution: the client's own key (BYOK override) wins, else the
 *  server's env key. 503 (not 400) when neither — the request was fine, the
 *  deployment isn't. */
export function resolveAnthropicKey(serverKey: string | undefined, clientKey: string | undefined): string {
  const key = (clientKey || '').trim() || (serverKey || '').trim()
  if (!key) {
    throw Object.assign(
      new Error('AI assist isn’t configured on this server. Set NUXT_ANTHROPIC_API_KEY when starting the app, or paste your own key in Settings → AI.'),
      { statusCode: 503 },
    )
  }
  return key
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/agent-request.unit.spec.ts --reporter=basic`
Expected: PASS (all, including pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/agentRequest.ts tests/unit/agent-request.unit.spec.ts
git commit -m "feat(ai): server-side Anthropic key resolution with BYOK override"
```

---

### Task 2: Wire the shared key into all 7 AI routes + ai-status endpoint

**Files:**
- Modify: `nuxt.config.ts` (runtimeConfig block, ~line 8)
- Modify: `server/api/vibe.post.ts:12`, `server/api/agent-plan.post.ts:28`, `server/api/agent-review.post.ts:28`, `server/api/copy-assist.post.ts:12`, `server/api/explain.post.ts:5-9`, `server/api/pipeline-suggest.post.ts:53-56`, `server/api/font-suggest.post.ts:38-41`
- Create: `server/api/ai-status.get.ts`
- Modify: `server/lib/agentRequest.ts` (delete `requireApiKey` once unused)
- Test: `tests/unit/agent-request.unit.spec.ts` (drop `requireApiKey` tests)

**Interfaces:**
- Consumes: `resolveAnthropicKey`, `optionalApiKey` from Task 1.
- Produces: `GET /api/ai-status` → `{ configured: boolean }` (true iff the server env key is set). Task 3's `useAiStatus` calls it.

- [ ] **Step 1: Add the runtime config entry**

In `nuxt.config.ts` inside `runtimeConfig`, after `replicateToken: ''`:

```ts
    // Server-only shared Anthropic key powering all AI-assist routes.
    // Set via NUXT_ANTHROPIC_API_KEY. Users may still paste their own key in
    // Settings → AI as a per-browser override; that one is sent per-request.
    anthropicApiKey: '',
```

- [ ] **Step 2: Rewire the 4 routes that use `requireApiKey`**

In each of `vibe.post.ts`, `agent-plan.post.ts`, `agent-review.post.ts`, `copy-assist.post.ts`, replace

```ts
const apiKey = requireApiKey(body?.apiKey)
```

with

```ts
const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(body?.apiKey))
```

and update the `../lib/agentRequest` import (`requireApiKey` → `optionalApiKey, resolveAnthropicKey`). `useRuntimeConfig` is Nitro-auto-imported in `server/api/**` — no import line needed.

- [ ] **Step 3: Rewire the 3 routes with manual key checks**

`explain.post.ts` — replace lines 5–9's destructure/check:

```ts
  const { graphData, apiKey: clientKey } = body || {}
  const apiKey = resolveAnthropicKey(useRuntimeConfig(event).anthropicApiKey, optionalApiKey(clientKey))
```

`pipeline-suggest.post.ts` — same pattern at lines 53–56: rename the destructured `apiKey` to `clientKey`, delete the `if (!apiKey || typeof apiKey !== 'string')` throw, add the `resolveAnthropicKey` line. `font-suggest.post.ts` lines 38–41: identical treatment. All three keep using the local `apiKey` const at their `x-api-key` header sites unchanged. Add the `optionalApiKey, resolveAnthropicKey` import from `../lib/agentRequest` to each.

- [ ] **Step 4: Create the status endpoint**

`server/api/ai-status.get.ts`:

```ts
// Lets the client know whether the server carries a shared Anthropic key —
// only a boolean ever leaves the server. Drives the prompt bar's setup notice.
export default defineEventHandler((event) => {
  return { configured: !!useRuntimeConfig(event).anthropicApiKey }
})
```

- [ ] **Step 5: Delete `requireApiKey`**

Remove `requireApiKey` from `server/lib/agentRequest.ts` (grep first: `grep -rn requireApiKey server/ tests/` must show only the definition and its old tests). Delete its tests from `tests/unit/agent-request.unit.spec.ts`.

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/unit/agent-request.unit.spec.ts tests/unit/agent-plan.unit.spec.ts --reporter=basic` → PASS.
Then live-check with the dev server (ask the user's running instance or `pnpm --dir . dev`):
`curl -s http://127.0.0.1:3002/api/ai-status` → `{"configured":false}` (no env key set locally yet), and `curl -s -X POST http://127.0.0.1:3002/api/vibe -H 'content-type: application/json' -d '{"phrase":"warmer","controls":[]}'` → 503 with the remedy message (not 400 "apiKey is required").

- [ ] **Step 7: Commit**

```bash
git add nuxt.config.ts server/api/vibe.post.ts server/api/agent-plan.post.ts server/api/agent-review.post.ts server/api/copy-assist.post.ts server/api/explain.post.ts server/api/pipeline-suggest.post.ts server/api/font-suggest.post.ts server/api/ai-status.get.ts server/lib/agentRequest.ts tests/unit/agent-request.unit.spec.ts
git commit -m "feat(ai): shared server key on all AI routes + /api/ai-status"
```

---

### Task 3: Client — key becomes optional everywhere, setup notice in the prompt bar

**Files:**
- Create: `app/composables/useAiStatus.ts`
- Modify: `app/composables/useCanvasAgent.ts:117`, `app/composables/useExplain.ts:105-111`, `app/composables/useVibeControl.ts:14-15`, `app/composables/usePortIntent.ts:78-79`, `app/composables/useCopyAssist.ts:43-47`, `app/lib/fontSuggest.ts`, `app/components/agent/CanvasPromptBar.vue`, `app/components/SettingsModal.vue:132`
- Test: `tests/unit/font-suggest-request.unit.spec.ts`

**Interfaces:**
- Consumes: `GET /api/ai-status` from Task 2.
- Produces: `useAiStatus(): { serverKeyConfigured: Ref<boolean | null>, aiAvailable: ComputedRef<boolean> }`.

- [ ] **Step 1: Update the fontSuggest tests (TDD for the one pure lib)**

In `tests/unit/font-suggest-request.unit.spec.ts`, replace the two no-key tests: `buildSuggestRequest(null, 'elegant serif')` now returns `{ ok: true, body: { query: 'elegant serif' } }` (no apiKey field) and `buildSuggestRequest('   ', 'elegant serif')` the same. Keep the blank-query test (`ok: false`, no error). Add: `expect(buildSuggestRequest('sk-key', 'q')).toEqual({ ok: true, body: { apiKey: 'sk-key', query: 'q' } })`.

- [ ] **Step 2: Run to verify fail, then update the lib**

Run: `npx vitest run tests/unit/font-suggest-request.unit.spec.ts --reporter=basic` → FAIL.
Rewrite `app/lib/fontSuggest.ts` decision block (server resolves the key now — the client only decides *whether* to send one):

```ts
export type SuggestRequest =
  | { ok: true; body: { apiKey?: string; query: string } }
  | { ok: false; error?: string }

/** Decide how to call /api/font-suggest. Blank query -> silent no-op; a local
 *  key rides along as a BYOK override, otherwise the server key applies. */
export function buildSuggestRequest(apiKey: string | null | undefined, query: string): SuggestRequest {
  const q = (query ?? '').trim()
  if (!q) return { ok: false }
  const key = (apiKey ?? '').trim()
  return { ok: true, body: key ? { apiKey: key, query: q } : { query: q } }
}
```

Delete `STANDARD_KEY_ERROR` (grep confirms its only consumers were this fn and the spec). Re-run → PASS.

- [ ] **Step 3: Remove the five composable guards**

- `useCanvasAgent.ts:117`: delete the line `if (!opts.apiKey()) { error.value = 'Add your Anthropic key in Settings → AI.'; return }`.
- `useExplain.ts:105-111`: delete the `if (!apiKey) {...}` block; change the fetch body to `body: { graphData: graphDescription, apiKey: apiKey || undefined }`.
- `useVibeControl.ts:15`: delete the `if (!apiKey) throw ...` line; change the `$fetch` body's `apiKey` to `apiKey: apiKey || undefined`.
- `usePortIntent.ts:79`: delete the `if (!apiKey) throw ...` line; in the `base` object change `apiKey` to `apiKey: apiKey || undefined`.
- `useCopyAssist.ts:43-47`: delete the `if (!apiKey) { error.value = ...; return }` block; in the `$fetch` body pass `apiKey: apiKey || undefined`.

Server 503s (with remedy copy) now flow through each surface's existing error channel.

- [ ] **Step 4: Create `useAiStatus`**

`app/composables/useAiStatus.ts`:

```ts
// Whether AI assist can work right now: the server carries a shared key
// (/api/ai-status) or this browser has a BYOK override. Module-level state —
// one fetch per session. Optimistic while unknown (null) so the setup notice
// never flashes during load.
const serverKeyConfigured = ref<boolean | null>(null)
let fetched = false

export function useAiStatus() {
  const { getLocalSetting } = useLocalSettings()
  if (import.meta.client && !fetched) {
    fetched = true
    $fetch<{ configured: boolean }>('/api/ai-status')
      .then((r) => { serverKeyConfigured.value = !!r?.configured })
      .catch(() => { serverKeyConfigured.value = null })
  }
  const aiAvailable = computed(() => {
    if (getLocalSetting('Sailor.AI.AnthropicApiKey')) return true
    return serverKeyConfigured.value !== false
  })
  return { serverKeyConfigured, aiAvailable }
}
```

- [ ] **Step 5: Prompt-bar setup notice**

In `CanvasPromptBar.vue` script: `const { aiAvailable } = useAiStatus()`. In the template, insert between the result card and the input bar (i.e. immediately before `<!-- Input bar … -->`):

```html
    <p v-if="!aiAvailable" class="px-1 text-[11px] leading-snug text-white/40">
      AI assist isn’t set up — start the app with NUXT_ANTHROPIC_API_KEY, or paste your own key in Settings → AI.
    </p>
```

- [ ] **Step 6: Settings copy**

`SettingsModal.vue:132` description becomes: `'Optional — AI assist uses the app’s built-in key. Paste your own to override; it stays in this browser and is sent only with your requests.'`

- [ ] **Step 7: Verify + commit**

Run: `npm run test:unit` → PASS (full suite guards against a missed import).

```bash
git add app/composables/useAiStatus.ts app/composables/useCanvasAgent.ts app/composables/useExplain.ts app/composables/useVibeControl.ts app/composables/usePortIntent.ts app/composables/useCopyAssist.ts app/lib/fontSuggest.ts app/components/agent/CanvasPromptBar.vue app/components/SettingsModal.vue tests/unit/font-suggest-request.unit.spec.ts
git commit -m "feat(ai): drop client key wall — BYOK is now an optional override"
```

---

### Task 4: Vue canvas on by default

**Files:**
- Modify: `app/composables/useVueNodesEnabled.ts:7`
- Modify: `app/components/SettingsModal.vue:174` (local-setting hydration)
- Test: create `tests/unit/vue-nodes-enabled-default.unit.spec.ts`

**Interfaces:**
- Produces: `vueNodesEnabled` defaults to `true` when the localStorage key is unset; only the explicit string `'false'` disables. Everything gated on it (canvas mount `default.vue:2885`, prompt bar `:3163`, start-graph seeding) follows automatically.

- [ ] **Step 1: Write the failing test**

`tests/unit/vue-nodes-enabled-default.unit.spec.ts` (check `tests/unit/__setup__` for the DOM env; specs run with localStorage available — mirror how other composable specs import):

```ts
import { describe, expect, it } from 'vitest'
import { vueNodesDefault } from '~/composables/useVueNodesEnabled'

describe('vueNodesDefault', () => {
  it('is ON when the setting was never touched', () => {
    expect(vueNodesDefault(null)).toBe(true)
  })
  it('respects an explicit off', () => {
    expect(vueNodesDefault('false')).toBe(false)
  })
  it('stays on for the legacy explicit true', () => {
    expect(vueNodesDefault('true')).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/unit/vue-nodes-enabled-default.unit.spec.ts --reporter=basic` → FAIL (`vueNodesDefault` not exported).

- [ ] **Step 3: Implement**

In `useVueNodesEnabled.ts`, add the exported pure decision and use it in `load()`:

```ts
/** Default-ON: only an explicit 'false' (Settings toggle) disables the Vue canvas. */
export function vueNodesDefault(stored: string | null): boolean {
  return stored !== 'false'
}
```

and change line 7 to `vueNodesEnabled.value = vueNodesDefault(localStorage.getItem('sailor:Comfy.VueNodes.Enabled'))`. Also change the initial ref: `const vueNodesEnabled = ref(true)` (SSR/first-paint should assume the default, not flash the legacy canvas).

- [ ] **Step 4: Settings toggle shows the real default**

`SettingsModal.vue` line ~174 hydrates local settings with `getLocalSetting(def.id) ?? ''` — an unset VueNodes toggle would show OFF while the feature is ON. Change that line to:

```ts
      localSettingsCache.value[def.id] = getLocalSetting(def.id) ?? (def.id === 'Comfy.VueNodes.Enabled' ? 'true' : '')
```

- [ ] **Step 5: Run tests, then commit**

Run: `npx vitest run tests/unit/vue-nodes-enabled-default.unit.spec.ts --reporter=basic` → PASS.

```bash
git add app/composables/useVueNodesEnabled.ts app/components/SettingsModal.vue tests/unit/vue-nodes-enabled-default.unit.spec.ts
git commit -m "feat(canvas): Vue node canvas on by default"
```

---

### Task 5: Start-graph seeding fails loudly

**Files:**
- Modify: `app/components/vue-canvas/VueNodeCanvas.vue:5866-5868` (+ the function's tail, ~5983)
- Modify: `app/layouts/default.vue:252-279` (`seedStarterGraph`, `onStartModalPick`)

**Interfaces:**
- Consumes: `toast` (vue-sonner, already in scope in `default.vue` — see `toast.error` at :561).
- Produces: `materializeStartGraph(opts): boolean` — `false` when the generator type is missing from `objectInfo`.

- [ ] **Step 1: Return a success flag**

In `VueNodeCanvas.vue` `materializeStartGraph`: line 5868 `if (!genInfo) return` → `if (!genInfo) return false`; add `return true` after the closing `nextTick(() => fitView({ padding: 0.3 }))` line at the function end.

- [ ] **Step 2: Surface failures in the layout**

In `default.vue`, replace `seedStarterGraph` and the body of `onStartModalPick`:

```ts
async function seedStarterGraph(nodeType: string, tries = 0) {
  const canvas = vueCanvasRef.value
  if (canvas?.materializeStartGraph) {
    await canvas.refreshSchema?.()
    if (canvas.materializeStartGraph({ generatorNodeType: nodeType }) === false) {
      toast.error('Couldn’t add the starter', { description: `The backend doesn’t provide “${nodeType}”. Check that ComfyUI is running and up to date, then try again from the + menu.` })
    }
  } else if (tries < 40) {
    setTimeout(() => seedStarterGraph(nodeType, tries + 1), 50)
  } else {
    toast.error('Couldn’t set up the project', { description: 'The canvas didn’t finish loading. Refresh the page and try again.' })
  }
}
```

and in `onStartModalPick`'s `nextTick` callback:

```ts
  nextTick(async () => {
    const canvas = vueCanvasRef.value
    if (!canvas?.materializeStartGraph) {
      toast.error('Couldn’t set up the project', { description: 'The canvas didn’t finish loading. Refresh the page and try again.' })
      return
    }
    await canvas.refreshSchema?.()
    const ok = canvas.materializeStartGraph({ sourceNodeType, generatorNodeType: payload.nodeType })
    if (ok === false) {
      toast.error('Couldn’t add the starter', { description: `The backend doesn’t provide “${payload.nodeType}”. Check that ComfyUI is running and up to date, then try again from the + menu.` })
    }
  })
```

(Keep the existing comments above both functions; trim the parts that describe the old silent behavior.)

- [ ] **Step 3: Verify + commit**

Run: `npm run test:unit` → PASS (no spec covers the layout; the suite catches syntax/type fallout via imports).

```bash
git add app/components/vue-canvas/VueNodeCanvas.vue app/layouts/default.vue
git commit -m "fix(onboarding): start-modal seeding errors are loud, not silent"
```

---

### Task 6: Tab close tombstones instead of deleting

**Files:**
- Modify: `app/layouts/default.vue` (close-X handler at :2775, new `closeProjectTab` near `snapshotActiveCanvasIntoDoc` ~:1049)

**Interfaces:**
- Consumes: existing `snapshotActiveCanvasIntoDoc(tabId)`, `saveDurableVersion(tab, doc)`, `docHasContent`, `persistWorkflows`, `closeTab` — all already in `default.vue` scope.

- [ ] **Step 1: Add the close path**

Below `snapshotActiveCanvasIntoDoc` (after :1060):

```ts
// Closing a tab must never destroy work: flush the live canvas into the doc
// (only the ACTIVE tab has unsaved on-screen state), mirror it to the durable
// server-side project version, and only then drop the session copy. The
// project stays restorable from All Projects / Recent — closing ≠ deleting.
function closeProjectTab(tab: any) {
  if (tab.id === activeTab.value?.id) snapshotActiveCanvasIntoDoc(tab.id)
  const doc = savedWorkflows[tab.id]
  if (doc && docHasContent(doc)) saveDurableVersion(tab, doc)
  delete savedWorkflows[tab.id]
  persistWorkflows()
  closeTab(tab.id)
}
```

- [ ] **Step 2: Rewire the X**

At :2775 replace `@click.stop="() => { delete savedWorkflows[tab.id]; persistWorkflows(); closeTab(tab.id) }"` with `@click.stop="closeProjectTab(tab)"`.

- [ ] **Step 3: Verify in the browser**

No unit seam (the function is glue over already-tested helpers); verify live instead: start the dev servers, build a small graph in a new project, close its tab, then confirm the project reopens **with the graph** from Home → Recent projects (it loads via `useProjects().loadProject` at `default.vue:1613`). Also close a *background* tab and confirm the active canvas is untouched.

- [ ] **Step 4: Commit**

```bash
git add app/layouts/default.vue
git commit -m "fix(tabs): closing a tab saves a durable version instead of deleting the autosave"
```

---

### Task 7: Cost estimate covers credit-billed API nodes

**Files:**
- Modify: `app/lib/costEstimate.ts`
- Test: `tests/unit/costEstimate.unit.spec.ts`

**Interfaces:**
- Produces: `isApiCreditBilled(n: EstimateInputNode): boolean`; `estimateUsdForNodes` now includes those nodes, with `credits: true` on their breakdown items and ` (credits)` in the label. `CostBreakdownItem` gains optional `credits?: boolean`. Callers (`default.vue:526`, run estimate ~:1956) need no changes.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/costEstimate.unit.spec.ts` (reuse its existing helpers/imports):

```ts
describe('credit-billed API nodes', () => {
  const kling = {
    id: '9',
    type: 'KlingTextToVideoNode',
    category: 'api node/video/Kling',
    // Real shape: a JSONata expr whose branches are {"type":"usd","usd":N} literals.
    badgeExpr: '($m := widgets.mode; $contains($m,"10") ? {"type":"usd","usd":0.7} : {"type":"usd","usd":0.35})',
  }
  it('includes api-node categories in the estimate as an approximate floor', () => {
    const est = estimateUsdForNodes([kling])
    expect(est).not.toBeNull()
    expect(est!.usd).toBeCloseTo(0.7)
    expect(est!.approximate).toBe(true)
    expect(est!.breakdown[0]!.credits).toBe(true)
    expect(est!.breakdown[0]!.label).toContain('(credits)')
  })
  it('still excludes unpriced local nodes', () => {
    expect(estimateUsdForNodes([{ id: '1', type: 'LoadImage', category: 'image', badgeExpr: null }])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run tests/unit/costEstimate.unit.spec.ts --reporter=basic` → FAIL.

- [ ] **Step 3: Implement**

In `costEstimate.ts`: extend the interface and the loop:

```ts
export interface CostBreakdownItem { id: string; label: string; usd: number; credits?: boolean }

/** Stock Comfy API nodes (Kling, OpenAI, …) bill in Comfy credits. Their
 *  price_badge carries the same {"usd":N} literals, so the parsed floor doubles
 *  as a USD-equivalent estimate — approximate by nature. */
export function isApiCreditBilled(n: EstimateInputNode): boolean {
  return !isReplicateBilled(n) && (n.category || '').startsWith('api node')
}
```

and in `estimateUsdForNodes` replace the skip line:

```ts
  for (const n of nodes) {
    const creditBilled = isApiCreditBilled(n)
    if (!isReplicateBilled(n) && !creditBilled) continue
    const cost = parseBadgeUsd(n.badgeExpr)
    if (!cost) continue
    usd += cost.usd
    approximate = approximate || cost.approximate || creditBilled
    breakdown.push({
      id: n.id,
      label: (n.title || n.type) + (creditBilled ? ' (credits)' : ''),
      usd: cost.usd,
      ...(creditBilled ? { credits: true } : {}),
    })
  }
```

Update the file's header comment: estimation now spans Replicate BYOK **and** credit-billed API nodes; the post-run *actual* tally (`default.vue:1906`) stays Replicate-only on purpose (credits reconcile via the credit-delta refresh).

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/unit/costEstimate.unit.spec.ts --reporter=basic` → PASS (old tests included — none assert exclusion of api-node categories; if one does, update it to the new contract).

- [ ] **Step 5: Commit**

```bash
git add app/lib/costEstimate.ts tests/unit/costEstimate.unit.spec.ts
git commit -m "feat(cost): pre-run estimate covers credit-billed API nodes"
```

---

### Task 8: Price hints on selection chips

**Files:**
- Modify: `app/components/vue-canvas/SelectionActionChips.vue`

**Interfaces:**
- Consumes: `fetchObjectInfo` (cached, exported from `~/composables/useVueNodes`), `parseBadgeUsd` from `~/lib/costEstimate` (Task 7 unchanged signature).

- [ ] **Step 1: Compute hints from the live schema**

In `SelectionActionChips.vue` script, after `const chips = ...`:

```ts
// Truthful $ hints from the same price_badge the nodes themselves show —
// no hand-maintained price list to drift. objectInfo is cached; this await
// resolves instantly after the canvas's first fetch.
import { parseBadgeUsd } from '~/lib/costEstimate'
import { fetchObjectInfo } from '~/composables/useVueNodes'

const hints = ref<Record<string, string>>({})
onMounted(async () => {
  const info = await fetchObjectInfo()
  const out: Record<string, string> = {}
  for (const chip of chips) {
    const cost = parseBadgeUsd(info?.[chip.nodeType]?.price_badge?.expr)
    if (cost) out[chip.nodeType] = `${cost.approximate ? '~' : ''}$${cost.usd.toFixed(2)}`
  }
  hints.value = out
})
```

(Merge the imports into the existing import block; add `ref, onMounted` from `vue`.)

- [ ] **Step 2: Render the hint**

Inside the chip button, after `{{ chip.chipLabel }}`:

```html
      <span v-if="hints[chip.nodeType]" class="text-white/35">{{ hints[chip.nodeType] }}</span>
```

- [ ] **Step 3: Verify in the browser**

With both dev servers up: generate/select an image artifact → the chip strip shows e.g. `Upscale ~$0.14` (exact figure comes from the backend's badge). Screenshot for the sign-off note.

- [ ] **Step 4: Commit**

```bash
git add app/components/vue-canvas/SelectionActionChips.vue
git commit -m "feat(cost): selection chips carry price hints from price_badge"
```

---

### Task 9: A real /help page

**Files:**
- Create: `app/pages/help.vue`

**Interfaces:**
- Consumes: the existing sidebar link `AppSidebar.vue:23` (`to: '/help'`) — no sidebar change needed.

- [ ] **Step 1: Create the page**

`app/pages/help.vue` — match the home page's idiom (dark, `text-[13px]` headings, `text-[11px]` labels, white-opacity neutrals). Every shortcut listed below is verified against the code (`VueNodeCanvas.vue:1279-1353`, `:5167-5184`; tab rename `default.vue:2751`):

```vue
<!-- frontend/app/pages/help.vue -->
<script setup lang="ts">
// Minimal help surface: the three things a new user actually needs — how to
// get a first result, what things cost, and the keyboard the canvas answers to.
import { ArrowLeft } from 'lucide-vue-next'

const shortcuts: { keys: string; does: string }[] = [
  { keys: '⌘Z / ⌘⇧Z', does: 'Undo / redo canvas changes' },
  { keys: '⌘C / ⌘V', does: 'Copy / paste selected nodes' },
  { keys: 'Delete', does: 'Delete the selection' },
  { keys: 'Esc', does: 'Close menus and previews' },
  { keys: 'S · C · A', does: 'Drop a sticky note · checklist · arrow' },
  { keys: 'Right-click canvas', does: 'Run All, Fit View, Select All, annotations' },
  { keys: 'Double-click a tab', does: 'Rename the project' },
]
</script>

<template>
  <div class="min-h-screen bg-background text-white">
    <div class="mx-auto max-w-2xl px-6 py-10">
      <NuxtLink to="/" class="mb-8 inline-flex items-center gap-1.5 text-[12px] text-white/40 transition hover:text-white/80">
        <ArrowLeft class="size-3.5" /> Back to home
      </NuxtLink>

      <h1 class="text-[20px] font-semibold tracking-tight">Help</h1>

      <section class="mt-8">
        <h2 class="text-[11px] font-medium uppercase tracking-wide text-white/50">Getting started</h2>
        <ol class="mt-3 space-y-2 text-[13px] leading-relaxed text-white/75">
          <li>1. Pick a starting point on Home — “Create an image” drops a ready-to-run generator on the canvas.</li>
          <li>2. Type what you want into the node’s prompt, then press its Play button (or Run, top right).</li>
          <li>3. Your result lands on the canvas and is saved to Assets. Select it to see one-click follow-ups.</li>
        </ol>
        <p class="mt-3 text-[12px] leading-relaxed text-white/40">
          Stuck on a graph? Select some nodes and hit <span class="text-white/60">Explain</span> in the toolbar — it describes what the graph does in plain language.
        </p>
      </section>

      <section class="mt-8">
        <h2 class="text-[11px] font-medium uppercase tracking-wide text-white/50">Costs</h2>
        <p class="mt-3 text-[13px] leading-relaxed text-white/75">
          Anything that calls a paid model shows its price before you run it — on the node’s badge, on action buttons, and on the Run button as a live estimate. Local nodes are free. Runs above your confirm threshold (Settings → “Confirm runs above”) ask first, with a per-node breakdown.
        </p>
      </section>

      <section class="mt-8">
        <h2 class="text-[11px] font-medium uppercase tracking-wide text-white/50">Keyboard</h2>
        <table class="mt-3 w-full text-[12.5px]">
          <tbody>
            <tr v-for="s in shortcuts" :key="s.keys" class="border-t border-white/5">
              <td class="w-44 py-2 pr-4 font-medium text-white/80">{{ s.keys }}</td>
              <td class="py-2 text-white/55">{{ s.does }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Verify in the browser**

Navigate to `/help` on the dev server: page renders, no router warning in the console, Back link returns Home. Screenshot.

- [ ] **Step 3: Commit**

```bash
git add app/pages/help.vue
git commit -m "feat(help): real /help page — getting started, costs, shortcuts"
```

---

### Task 10: Dev routes stay out of production builds

**Files:**
- Modify: `nuxt.config.ts`

**Interfaces:**
- Produces: in non-dev builds, `pages/dev/**` plus the loose harness pages (`engine-test`, `sgtest`, `streamertest`, `timeline-harness`, `gl-conformance`) don't exist as routes.

- [ ] **Step 1: Add the pages hook**

`nuxt.config.ts` already uses an inline-module function in `modules` (the ws-proxy workaround, ~line 30) — append a second one right after it, inside the `modules` array (a plain config `hooks:` block has no access to `nuxt.options.dev`, which is the reliable dev/build signal here):

```ts
    // Inline module: strip dev harness routes (pages/dev/**, engine-test,
    // sgtest, …) from production builds so hosted deploys don't ship debug
    // surfaces. `nuxt dev` keeps them all.
    function (_options, nuxt) {
      if (nuxt.options.dev) return
      const DEV_PAGES = /^\/(dev(\/|$)|engine-test|sgtest|streamertest|timeline-harness|gl-conformance)/
      nuxt.hook('pages:extend', (pages) => {
        for (let i = pages.length - 1; i >= 0; i--) {
          if (DEV_PAGES.test(pages[i]!.path)) pages.splice(i, 1)
        }
      })
    },
```

- [ ] **Step 2: Verify both modes**

Dev: `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/dev/palette-lab` → 200 (dev unaffected).
Prod: `npx nuxt build 2>&1 | tail -3` succeeds; then `node .output/server/index.mjs & sleep 3 && curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/dev/palette-lab; kill %1` → 404, and `/help` → 200. (Skip the prod smoke if the build takes >10 min on this machine; the hook is declarative enough to review.)

- [ ] **Step 3: Commit**

```bash
git add nuxt.config.ts
git commit -m "chore(build): strip dev harness routes from production builds"
```

---

### Task 11: Whole-slice browser verification (sign-off gate)

**Files:** none (verification only)

- [ ] **Step 1: Fresh-profile first-run pass**

With ComfyUI (8188) + a Nuxt dev server up, in a **clean browser profile** (no localStorage): Home → “Create an image”. Expected now: the Vue canvas mounts (Task 4) and a ready-to-run generator node appears (Task 5 would toast loudly if it failed). Screenshot the canvas with the seeded node.

- [ ] **Step 2: AI path**

Without any key anywhere: prompt bar shows the setup notice (Task 3); asking anyway surfaces the 503 remedy copy inline. Then start the server with `NUXT_ANTHROPIC_API_KEY=<key>` and confirm the notice disappears and an ask round-trips.

- [ ] **Step 3: Close-tab safety**

Build a 2-node graph, close the tab via X, reopen from Recent → graph intact (Task 6).

- [ ] **Step 4: Cost surfaces**

Place a Kling (or any `api node/*`) generator → Run button estimate now includes it (Task 7). Select an image artifact → chips show `~$` hints (Task 8).

- [ ] **Step 5: Help + prod hygiene**

Sidebar “?” opens /help (Task 9). Confirm the pages:extend hook exists for prod (Task 10 verified in its own task).

- [ ] **Step 6: Report**

Summarize results with screenshots to the user; call out anything deferred or flaky. No commit.
