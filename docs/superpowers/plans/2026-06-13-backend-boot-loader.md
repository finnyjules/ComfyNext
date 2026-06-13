# Backend boot / ready loader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show backend boot/ready state (and restart recovery) in the existing top-center `CanvasStatusBar` pill, driven by an active HTTP health poll, auto-reloading the canvas when the backend comes back.

**Architecture:** A frontend-only `useBackendHealth` composable polls a ComfyUI endpoint and exposes liveness + a recovery signal. `default.vue` combines that with a reactive bridge-ready flag into a busy/label state, feeds it to `CanvasStatusBar` (new `backend` view) + a masking backdrop, and on recovery calls the existing `forceReloadCanvas()`. No backend changes.

**Tech Stack:** Vue 3 / Nuxt 4 (TypeScript), Vitest unit tests.

---

## File Structure

**Create:**
- `frontend/app/composables/useBackendHealth.ts` — HTTP liveness poll + debounce + recovery signal. Auto-imported by Nuxt.
- `frontend/tests/unit/useBackendHealth.unit.spec.ts` — its unit tests.

**Modify:**
- `frontend/app/components/CanvasStatusBar.vue` — add a `backend` view (highest priority) + two props.
- `frontend/app/layouts/default.vue` — reactive bridge-ready flag; wire the poll; derive busy/label; re-gate the masking backdrop; pass props to `CanvasStatusBar`; recovery → `forceReloadCanvas()`.

**Why this split:** the poll/debounce/recovery logic is the only non-trivial, testable unit — it lives in its own composable. The component and layout changes are presentational wiring verified by type-check + manual.

---

## Task 1: `useBackendHealth` composable (TDD)

**Files:**
- Create: `frontend/app/composables/useBackendHealth.ts`
- Test: `frontend/tests/unit/useBackendHealth.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/useBackendHealth.unit.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useBackendHealth } from '~/composables/useBackendHealth'

// fetchFn that resolves (=up) or rejects (=down) per a scripted boolean list;
// the last entry repeats for any extra polls.
function makeFetch(results: boolean[]) {
  let i = 0
  return vi.fn(async () => {
    const ok = results[Math.min(i, results.length - 1)]
    i++
    if (ok) return {} as Response
    throw new Error('network')
  })
}

describe('useBackendHealth', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('flips down only after 2 consecutive failures (debounce)', async () => {
    const fetchFn = makeFetch([true, false, false])
    const h = useBackendHealth('http://x', { fetchFn, healthyMs: 100, downMs: 50, failures: 2 })
    h.start()
    await vi.advanceTimersByTimeAsync(0)     // tick 1: success → up
    expect(h.backendUp.value).toBe(true)
    await vi.advanceTimersByTimeAsync(100)   // tick 2: fail #1 → still up
    expect(h.backendUp.value).toBe(true)
    await vi.advanceTimersByTimeAsync(100)   // tick 3: fail #2 → down
    expect(h.backendUp.value).toBe(false)
    h.stop()
  })

  it('does NOT fire onRecovered on the initial down→up (first boot)', async () => {
    const onRecovered = vi.fn()
    const fetchFn = makeFetch([false, false, true])  // boots while backend down
    const h = useBackendHealth('http://x', { fetchFn, onRecovered, healthyMs: 100, downMs: 50, failures: 2 })
    h.start()
    await vi.advanceTimersByTimeAsync(0)     // fail #1
    await vi.advanceTimersByTimeAsync(50)    // fail #2 → down
    await vi.advanceTimersByTimeAsync(50)    // first-ever success → up, NOT recovery
    expect(h.backendUp.value).toBe(true)
    expect(onRecovered).not.toHaveBeenCalled()
    h.stop()
  })

  it('fires onRecovered once when a previously-up backend goes down then up', async () => {
    const onRecovered = vi.fn()
    const fetchFn = makeFetch([true, false, false, true])
    const h = useBackendHealth('http://x', { fetchFn, onRecovered, healthyMs: 100, downMs: 50, failures: 2 })
    h.start()
    await vi.advanceTimersByTimeAsync(0)     // up (everUp = true)
    await vi.advanceTimersByTimeAsync(100)   // fail #1
    await vi.advanceTimersByTimeAsync(50)    // fail #2 → down
    await vi.advanceTimersByTimeAsync(50)    // up → recovery
    expect(onRecovered).toHaveBeenCalledTimes(1)
    h.stop()
  })

  it('stop() halts polling', async () => {
    const fetchFn = makeFetch([true])
    const h = useBackendHealth('http://x', { fetchFn, healthyMs: 100 })
    h.start()
    await vi.advanceTimersByTimeAsync(0)
    const calls = fetchFn.mock.calls.length
    h.stop()
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchFn.mock.calls.length).toBe(calls)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/useBackendHealth.unit.spec.ts`
Expected: FAIL — cannot resolve `~/composables/useBackendHealth` (module doesn't exist).

- [ ] **Step 3: Write the composable**

Create `frontend/app/composables/useBackendHealth.ts`:

```typescript
import { ref, type Ref } from 'vue'

export interface BackendHealth {
  /** HTTP liveness (debounced). Optimistic at start. */
  backendUp: Ref<boolean>
  /** True once the backend has been reachable at least once. */
  everUp: Ref<boolean>
  start: () => void
  stop: () => void
}

export interface BackendHealthOpts {
  onRecovered?: () => void
  healthyMs?: number      // poll interval while up (default 5000)
  downMs?: number         // poll interval while down (default 1500)
  timeoutMs?: number      // per-probe timeout (default 2000)
  failures?: number       // consecutive fails before flipping down (default 2)
  fetchFn?: typeof fetch  // injectable for tests
}

/**
 * Polls `${origin}/system_stats` to track whether the ComfyUI backend HTTP
 * server is up. Uses `no-cors` so no CORS config is needed — a resolved fetch
 * means the server responded; a rejection/timeout means it's down. Fires
 * `onRecovered` on a genuine down→up transition (after having been up at least
 * once), so the initial boot does not count as a recovery.
 */
export function useBackendHealth(origin: string, opts: BackendHealthOpts = {}): BackendHealth {
  const healthyMs = opts.healthyMs ?? 5000
  const downMs = opts.downMs ?? 1500
  const timeoutMs = opts.timeoutMs ?? 2000
  const maxFailures = opts.failures ?? 2
  const doFetch = opts.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a))

  const backendUp = ref(true)   // optimistic; the debounce flips it on real failures
  const everUp = ref(false)
  let consecutiveFailures = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = true

  async function probe(): Promise<boolean> {
    try {
      await doFetch(`${origin}/system_stats`, {
        mode: 'no-cors',
        signal: AbortSignal.timeout(timeoutMs),
      })
      return true
    } catch {
      return false
    }
  }

  async function tick(): Promise<void> {
    if (stopped) return
    const ok = await probe()
    if (stopped) return
    if (ok) {
      consecutiveFailures = 0
      const wasDown = !backendUp.value
      backendUp.value = true
      if (wasDown && everUp.value) opts.onRecovered?.()
      everUp.value = true
    } else {
      consecutiveFailures++
      if (consecutiveFailures >= maxFailures) backendUp.value = false
    }
    if (stopped) return
    timer = setTimeout(tick, backendUp.value ? healthyMs : downMs)
  }

  function start(): void {
    if (!stopped) return
    stopped = false
    timer = setTimeout(tick, 0)
  }

  function stop(): void {
    stopped = true
    if (timer) { clearTimeout(timer); timer = null }
  }

  return { backendUp, everUp, start, stop }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/useBackendHealth.unit.spec.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/composables/useBackendHealth.ts frontend/tests/unit/useBackendHealth.unit.spec.ts
git commit -m "feat(boot-loader): useBackendHealth poll composable with recovery signal

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `CanvasStatusBar` backend view

**Files:**
- Modify: `frontend/app/components/CanvasStatusBar.vue`

- [ ] **Step 1: Add the two props**

In `frontend/app/components/CanvasStatusBar.vue`, the `defineProps` currently is:

```typescript
const props = defineProps<{
  running: boolean
  currentNode: string
  progress: { completed: number; total: number }
  percent: number
  startedAt: number | null
  lastResult: RunResult | null
}>()
```

Add two props for the backend/loading state:

```typescript
const props = defineProps<{
  running: boolean
  currentNode: string
  progress: { completed: number; total: number }
  percent: number
  startedAt: number | null
  lastResult: RunResult | null
  backendBusy?: boolean
  backendLabel?: string
}>()
```

- [ ] **Step 2: Give the backend view priority in the `view` computed**

Replace the `view` computed:

```typescript
const view = computed<'running' | 'success' | 'error' | null>(() => {
  if (props.running) return 'running'
  if (props.lastResult?.kind === 'error') return 'error'
  if (props.lastResult?.kind === 'success') return 'success'
  return null
})
```

with (adds `'backend'`, checked first so booting/loading wins over run states):

```typescript
const view = computed<'backend' | 'running' | 'success' | 'error' | null>(() => {
  if (props.backendBusy) return 'backend'
  if (props.running) return 'running'
  if (props.lastResult?.kind === 'error') return 'error'
  if (props.lastResult?.kind === 'success') return 'success'
  return null
})
```

- [ ] **Step 3: Render the backend view**

In the template, the pill's border `:class` binding currently is:

```vue
      :class="{
        'border-white/10': view === 'running',
        'border-emerald-500/30': view === 'success',
        'border-red-500/35': view === 'error',
      }"
```

Add a neutral border for the backend view:

```vue
      :class="{
        'border-white/10': view === 'running' || view === 'backend',
        'border-emerald-500/30': view === 'success',
        'border-red-500/35': view === 'error',
      }"
```

Then, immediately after the opening `<div ...>` of the pill and BEFORE the `<!-- Running -->` template block, add the backend block:

```vue
      <!-- Backend booting / reconnecting / loading -->
      <template v-if="view === 'backend'">
        <Loader2 class="size-3.5 shrink-0 animate-spin text-white/55" />
        <span class="text-[12px] text-white/85 truncate max-w-[320px]" :title="backendLabel">
          {{ backendLabel || 'Loading…' }}
        </span>
      </template>
```

And change the existing `<!-- Running -->` block's opening tag from `<template v-if="view === 'running'">` to `<template v-else-if="view === 'running'">` so the chain is mutually exclusive (the success/error blocks are already `v-else-if`).

- [ ] **Step 4: Type-check the touched file**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "CanvasStatusBar" || echo "no CanvasStatusBar type errors"`
Expected: `no CanvasStatusBar type errors`.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/CanvasStatusBar.vue
git commit -m "feat(boot-loader): backend status view in CanvasStatusBar pill

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire it in `default.vue`

**Files:**
- Modify: `frontend/app/layouts/default.vue`

- [ ] **Step 1: Add a reactive bridge-ready flag**

In `default.vue`, find the bridge-ready state declaration:

```typescript
let bridgeIsReady = false
let bridgeReadyResolve: (() => void) | null = null
let bridgeReadyPromise: Promise<void> = new Promise((r) => { bridgeReadyResolve = r })
```

Add a reactive ref right after it (the existing `bridgeIsReady` is a plain `let`, not reactive, so the template needs this):

```typescript
let bridgeIsReady = false
const bridgeReady = ref(false) // reactive mirror of bridgeIsReady for the template
let bridgeReadyResolve: (() => void) | null = null
let bridgeReadyPromise: Promise<void> = new Promise((r) => { bridgeReadyResolve = r })
```

- [ ] **Step 2: Keep the ref in sync in markBridgeReady / resetBridgeReady**

Change `resetBridgeReady`:

```typescript
function resetBridgeReady() {
  bridgeIsReady = false
  bridgeReadyPromise = new Promise((r) => { bridgeReadyResolve = r })
}
```
to:
```typescript
function resetBridgeReady() {
  bridgeIsReady = false
  bridgeReady.value = false
  bridgeReadyPromise = new Promise((r) => { bridgeReadyResolve = r })
}
```

Change `markBridgeReady`:

```typescript
function markBridgeReady() {
  if (bridgeIsReady) return
  bridgeIsReady = true
  bridgeReadyResolve?.()
}
```
to:
```typescript
function markBridgeReady() {
  if (bridgeIsReady) return
  bridgeIsReady = true
  bridgeReady.value = true
  bridgeReadyResolve?.()
}
```

- [ ] **Step 3: Wire the health poll + derived state**

Find the `forceReloadCanvas` definition and the line after it:

```typescript
const comfyOrigin = useRuntimeConfig().public.comfyOrigin || 'http://127.0.0.1:8188'
const comfyIframeSrc = ref(`${comfyOrigin}/`)
function forceReloadCanvas() {
  resetBridgeReady()
  endWorkflowLoading()
  comfyIframeSrc.value = `${comfyOrigin}/?_cb=${Date.now()}`
}
```

Immediately AFTER that function, add the health poll + derived busy/label state:

```typescript
// Backend boot/ready loader. Polls the backend; on a genuine restart recovery,
// reload the (now-stale) iframe against the fresh backend.
const { backendUp, start: startHealthPoll, stop: stopHealthPoll } =
  useBackendHealth(comfyOrigin, { onRecovered: () => forceReloadCanvas() })

// Truly ready = backend HTTP up AND ComfyUI ready inside the iframe.
const canvasReady = computed(() => backendUp.value && bridgeReady.value)
const hasBeenReady = ref(false)
watch(canvasReady, (v) => { if (v) hasBeenReady.value = true })

// The status pill is "busy" while the backend/canvas isn't ready OR a workflow
// is loading; the label reflects which.
const backendBusy = computed(() => !canvasReady.value || workflowLoading.value)
const backendLabel = computed(() => {
  if (!backendUp.value) return hasBeenReady.value ? 'Reconnecting to ComfyUI…' : 'Starting ComfyUI…'
  if (!bridgeReady.value) return 'Loading ComfyUI…'
  return 'Loading workflow…'
})

onMounted(() => { if (import.meta.client) startHealthPoll() })
onBeforeUnmount(() => stopHealthPoll())
```

NOTE: `useBackendHealth`, `computed`, `watch`, `onMounted`, `onBeforeUnmount`, and `ref` are all Nuxt auto-imports — no import statement is needed. If the file already has an `onMounted`/`onBeforeUnmount`, add these calls inside the existing hooks instead of adding new ones (both forms work; duplicate hooks are also fine in Vue, but prefer merging).

- [ ] **Step 4: Re-gate the masking backdrop (remove its text/spinner)**

Find the loading overlay:

```vue
            <div
              v-if="!iframeReady || workflowLoading"
              class="absolute inset-0 z-30 bg-[#121212] flex flex-col items-center justify-center gap-3"
            >
              <div class="size-5 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
              <span class="text-xs text-white/30">
                {{ !iframeReady ? 'Starting ComfyUI…' : 'Loading workflow…' }}
              </span>
            </div>
```

Replace it with a plain opaque mask gated on the new state (the pill now carries the spinner + text):

```vue
            <div
              v-if="backendBusy"
              class="absolute inset-0 z-30 bg-[#121212]"
            />
```

- [ ] **Step 5: Pass the props to CanvasStatusBar**

Find the `<CanvasStatusBar ... />` usage and add the two props (keep all existing ones):

```vue
        <CanvasStatusBar
          v-if="activeTab.type === 'project'"
          :running="executionStartTime !== null && !currentRunSilent"
          :current-node="currentRunningNode"
          :progress="tabNodeProgress"
          :percent="currentRunProgressPct"
          :started-at="executionStartTime"
          :last-result="lastRunResult"
          :backend-busy="backendBusy"
          :backend-label="backendLabel"
          @stop="stopFromStatusBar"
          @dismiss-result="dismissRunResult"
        />
```

- [ ] **Step 6: Type-check the touched file**

Run: `cd frontend && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -i "default.vue" | grep -iv "possibly\|index type\|Property 'text'" || echo "no new default.vue errors"`
Expected: `no new default.vue errors`. (default.vue may have pre-existing unrelated errors; only confirm none reference the new `backendBusy`/`backendLabel`/`backendUp`/`canvasReady`/`bridgeReady` code.)

- [ ] **Step 7: Commit**

```bash
git add frontend/app/layouts/default.vue
git commit -m "feat(boot-loader): drive backend status pill + masking backdrop, auto-reload on recovery

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Manual in-browser verification (needs user)

The poll + iframe behavior isn't unit-testable end-to-end, so this is a guided check (frontend hot-reloads via Nuxt — no ComfyUI restart needed to load the change, but you'll restart ComfyUI to test recovery).

- [ ] **Step 1:** With the dev frontend running, open a project workflow. Confirm that while ComfyUI boots inside the iframe, the **top-center pill** shows "Loading ComfyUI…" (and "Starting ComfyUI…" if the backend HTTP isn't up yet), with a masking dark backdrop, and that the pill **clears** once the canvas is ready.
- [ ] **Step 2:** With the workflow open and ready, **kill ComfyUI** (the supervisor will relaunch it). Confirm the pill switches to **"Reconnecting to ComfyUI…"** within ~3s.
- [ ] **Step 3:** When the supervisor's ComfyUI is back, confirm the canvas **auto-reloads** (forceReloadCanvas), the pill passes through "Loading ComfyUI…", then clears — and your workflow is intact.
- [ ] **Step 4:** Confirm normal runs still work: trigger a workflow run and confirm the pill shows the **running** state (node/progress/elapsed) as before — i.e. the backend view only appears when actually booting, not during normal operation.

---

## Self-Review

- **Spec coverage:** 3-state model (down/starting/ready) → `backendLabel` computed (Task 3) ✓; shown in CanvasStatusBar as a priority `backend` view (Task 2) ✓; active HTTP health poll with debounce + recovery signal (Task 1) ✓; auto-reload on recovery via `forceReloadCanvas` (Task 3 onRecovered) ✓; masking backdrop kept, text moved to pill (Task 3 step 4) ✓; reactive bridge-ready flag (Task 3 steps 1–2) ✓; no-cors probe / no backend change (Task 1) ✓; initial-boot doesn't trigger recovery (Task 1 test + everUp guard) ✓; unit tests (Task 1) + manual (Task 4) ✓.
- **Placeholder scan:** no TBD/TODO; every code step has full code.
- **Type/name consistency:** `useBackendHealth(origin, opts) → { backendUp, everUp, start, stop }` defined in Task 1, consumed in Task 3 with matching destructure (`backendUp`, `start`, `stop`). Props `backendBusy: boolean` / `backendLabel: string` defined on `CanvasStatusBar` (Task 2) and passed from `default.vue` as `:backend-busy`/`:backend-label` (Task 3 step 5). `canvasReady`/`bridgeReady`/`hasBeenReady`/`workflowLoading` all defined before use in Task 3. The `view` union gains `'backend'` consistently between the computed (Task 2 step 2) and the template branch (Task 2 step 3).
