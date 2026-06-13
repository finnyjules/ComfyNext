# Backend boot / ready loader — design

**Date:** 2026-06-12
**Status:** Approved, pre-implementation

## Goal

Tell the user, in the existing top-center status pill (`CanvasStatusBar`), when
the ComfyUI backend is **booting** and when it's **ready** — including when the
backend is killed/restarted mid-session. On recovery from a restart, the canvas
auto-reloads against the fresh backend so the user is left in a usable state with
no manual steps.

## Problem (today)

- The existing full-screen overlay (`default.vue`) clears on the iframe DOM
  `load` event (`iframeReady`), which fires long before ComfyUI has finished
  booting *inside* the iframe — so most of the cold-boot shows a not-ready canvas
  with no indicator.
- There is **no active health detection**: the frontend never pings the backend,
  so it cannot show "booting" when the backend is genuinely down/restarting, and
  doesn't notice a restart until a postMessage/fetch fails.

## Decisions (from brainstorming)

- **Show it in `CanvasStatusBar`** (the top-center run-status pill), as a new
  view alongside running/success/error — consistent with how runs are surfaced.
- **Cover restarts (option B):** an active HTTP health poll detects the backend
  going down and coming back, not just the first load.
- **Auto-reload on recovery (option A):** when the backend returns after a
  restart, call the existing `forceReloadCanvas()` (reloads the iframe at the
  fresh backend, re-sends the saved per-tab workflow), then clear once ready.
- **Keep a masking backdrop (option i):** the existing opaque `bg-[#121212]`
  overlay stays as a plain mask over the not-yet-ready canvas; its text/spinner
  move into the pill (the pill is the sole informative element).
- **Frontend-only, HTTP poll** (not a parent-side websocket): simpler, reuses the
  existing overlay + `forceReloadCanvas` + bridge-ready handshake, no backend
  changes. (Websocket liveness was considered and rejected as heavier.)

## Readiness model — three states

True readiness = backend HTTP process up **AND** ComfyUI ready inside the iframe
(the bridge `{status:"ready"}` handshake). The pill reflects:

| State | Condition | Pill |
|-------|-----------|------|
| **down** | health poll failing (debounced) | spinner + "Starting ComfyUI…" (never been up) / "Reconnecting to ComfyUI…" (was up → restart) |
| **starting** | HTTP up, bridge **not** ready | spinner + "Loading ComfyUI…" |
| **ready** | HTTP up **and** bridge ready | pill returns to normal run/idle behaviour |

The backend view takes **priority over run states** (if the backend is booting,
nothing is running).

## Architecture

### `frontend/app/composables/useBackendHealth.ts` (NEW)

Owns the HTTP liveness poll and the recovery signal. Testable in isolation.

- **Signature:** `useBackendHealth(origin: string, opts?: { onRecovered?: () =>
  void; healthyMs?: number; downMs?: number; timeoutMs?: number; failures?:
  number }) => { backendUp: Ref<boolean>; start(): void; stop(): void }`.
- **Probe:** `fetch(\`${origin}/system_stats\`, { mode: 'no-cors', signal:
  AbortSignal.timeout(timeoutMs) })`. `no-cors` means we don't read the body (no
  CORS config needed) — a resolved fetch = backend responded (up); a rejected
  fetch/timeout = down. (`origin` defaults to the app's `comfyOrigin`.)
- **Cadence:** poll every `healthyMs` (default 5000) while up, `downMs` (default
  1500) while down — faster recovery detection.
- **Debounce:** flip `backendUp` to `false` only after `failures` (default 2)
  consecutive failed probes, so a single blip doesn't flash the pill. A single
  success flips it back to `true`.
- **Recovery signal:** track `everUp`. Fire `onRecovered` exactly once on a
  **down→up** transition *after the backend had previously been up* — i.e. a
  genuine restart, NOT the initial boot (the initial first-success must not
  trigger a reload, since the iframe is already loading fresh).
- `start()`/`stop()` manage the interval; cleaned up on unmount.

### `frontend/app/components/CanvasStatusBar.vue` (MODIFY)

Add a `backend` view that takes precedence over the existing views.

- **New props:** `backendBusy: boolean`, `backendLabel: string`.
- **`view` computed:** `if (backendBusy) return 'backend'` **before** the
  `running`/`success`/`error` checks.
- **Template:** a `<template v-else-if="view === 'backend'">` block — `Loader2`
  spinner + `{{ backendLabel }}`, neutral border (`border-white/10`), no buttons
  (it auto-clears when ready). Mirrors the running block's styling minus the
  controls.

### `frontend/app/layouts/default.vue` (MODIFY)

Wire it together.

- **Reactive bridge-ready flag:** add `const bridgeReady = ref(false)`; set it in
  `markBridgeReady()` (alongside `bridgeIsReady = true`) and clear it in
  `resetBridgeReady()`. (The existing `bridgeIsReady` is a plain `let` — not
  reactive — so the template needs this ref.)
- **Health poll:** `const { backendUp } = useBackendHealth(comfyOrigin, {
  onRecovered: () => forceReloadCanvas() })`, started on mount.
- **Derived state:**
  - `const canvasReady = computed(() => backendUp.value && bridgeReady.value)`.
  - `const backendBusy = computed(() => !canvasReady.value)`.
  - `const backendLabel = computed(() => !backendUp.value ? (everUp ?
    'Reconnecting to ComfyUI…' : 'Starting ComfyUI…') : 'Loading ComfyUI…')`
    (the `everUp` distinction comes from the composable — expose it, or derive a
    simple `hasBeenReady` ref in default.vue toggled true the first time
    `canvasReady` becomes true).
- **Status bar:** pass `:backend-busy="backendBusy"` and
  `:backend-label="backendLabel"` to `CanvasStatusBar`.
- **Masking backdrop (option i):** change the overlay gate from
  `v-if="!iframeReady || workflowLoading"` to `v-if="backendBusy ||
  workflowLoading"`, and remove its inline text/spinner (the pill now carries
  them) — leaving a plain opaque mask. (Keep `workflowLoading` so the
  per-workflow load still masks.)
- **Recovery:** `onRecovered → forceReloadCanvas()` already resets bridge-ready
  and cache-busts the iframe; the poll + handshake then drive the pill back
  through starting → ready.

### Data flow

`useBackendHealth` polls `comfyOrigin/system_stats` → `backendUp`. Bridge posts
`ready` → `bridgeReady`. `default.vue` combines them → `backendBusy` +
`backendLabel` → `CanvasStatusBar` pill + masking backdrop. Backend restart:
poll fails (debounced) → `backendUp=false` → pill "Reconnecting…"; poll succeeds
→ `onRecovered` → `forceReloadCanvas()` → iframe reloads → bridge re-handshakes →
`canvasReady` → pill clears.

## Error handling / edge cases

- **Initial boot:** `onRecovered` must not fire on the first up (guarded by
  `everUp`). The pill shows starting → loading → ready normally.
- **Flapping:** the 2-failure debounce + single-success recovery avoids pill
  flicker on a transient network hiccup.
- **No project tab open:** `CanvasStatusBar` only renders for a project tab — the
  loader is irrelevant before a workflow exists, which is correct.
- **Poll after unmount:** `stop()` clears the interval on `onBeforeUnmount`.
- **CORS:** `no-cors` liveness probe needs no backend CORS config; we never read
  the body.

## Testing

- **Unit (Vitest) `useBackendHealth.spec.ts`:** mock `fetch` + fake timers.
  - `backendUp` starts optimistic/unknown then reflects probe results; flips to
    `false` only after 2 consecutive failures; flips to `true` on one success.
  - `onRecovered` fires once on `up → (2 fails) down → up`; does **not** fire on
    the initial `down → up` (first boot) when never previously up.
  - `stop()` halts further polling.
- **Component (light) `CanvasStatusBar`:** with `backendBusy=true` +
  `backendLabel="Reconnecting to ComfyUI…"`, the pill renders the backend view
  and the label, and ignores `running`/`lastResult` (priority). (Skip if the
  repo has no component-test harness; cover via manual instead.)
- **Manual:** with the app open on a project, kill ComfyUI → pill shows
  "Reconnecting to ComfyUI…"; supervisor relaunches → canvas auto-reloads → pill
  "Loading ComfyUI…" → clears when ready, workflow intact.

## Out of scope

- Covering the dev-only Vite first-compile of the canvas component (it precedes
  any Vue component mounting, including the pill; absent in production builds).
- A parent-side websocket liveness channel (HTTP poll chosen instead).
- Per-worker boot status in the pool path (the global bridge-ready + single poll
  suffice; pool readiness keeps its existing `waitForWorkerReady`).
