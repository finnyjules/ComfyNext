# Parallel Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** N concurrent runs display correctly (prompt_id-keyed registry) and cloud-only prompts execute concurrently across a lazily-spawned pool of `--cpu` ComfyUI workers, surfaced as a parallel "deal N takes" gesture.

**Architecture:** A pure run-registry module keyed by prompt_id replaces the single-active-run bookkeeping for direct-mode runs; a Nitro plugin owns worker lifecycle (spawn/health/reap); the HTTP proxy and `/ws` upgrade dispatcher learn a `?comfyWorker=N` selector; a conservative pool-eligibility predicate + least-loaded scheduler route prompts; `queueParallel` fans out seed-varied takes.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, vitest (`cd frontend && npm run test:unit -- <name>`), Nitro plugins (`server/plugins/trainingQueue.ts` is the pattern), node:child_process.

**Spec:** `docs/superpowers/specs/2026-07-08-parallel-dispatch-design.md`

## Global Constraints

- Work on `main`, no branches. Explicit staging + pathspec commits ONLY (`git commit -m "..." -- <paths>`); NEVER `git add -A` (a concurrent session shares this repo).
- Direct mode only: everything here is inert when `sailor:Comfy.DirectExecution.Enabled` is not 'true'. Bridge path (flag OFF) behavior must be byte-identical.
- Do NOT touch `custom_nodes/sailor_bridge/`, sketchbook-owned files (`useTakes.ts`, `LightTableModal.vue`, `lib/draft/*`, `lib/artifact/takeDiff.ts`) except where a task explicitly says so, or flag defaults.
- `mapWsEvent` already forwards `prompt_id` on every event (wsEventMap.ts:46-95) — rely on it, don't re-add.
- `useDirectExecution.queue()` already returns `{ prompt_id?, node_errors?, error? }` — extend, don't rewrite.
- Known suite noise: ~8 pre-existing failures in concurrent-session specs (spacetype-palette, video-model-adapt, …). Zero NEW failures allowed; all graph/ws/direct specs green.
- Worker ports: `8189 + i` for worker i (0-based pool index); main instance stays 8188 and is NEVER treated as a pool worker. Env: `NUXT_COMFY_POOL_SIZE` (default '2'), `NUXT_COMFY_PYTHON` (default `<repoRoot>/.venv/bin/python3.12`). Pool workers spawn `main.py --listen 127.0.0.1 --port <port> --cpu` with cwd = repo root.
- Fallback posture everywhere: any pool/worker failure ⇒ silent serial fallback to main (one console.warn), never a blocked run.

---

### Task 1: Run registry (pure lib)

**Files:**
- Create: `frontend/app/lib/graph/runRegistry.ts`
- Test: `frontend/tests/unit/run-registry.unit.spec.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface RunEntry {
    promptId: string
    tabId: string
    live: boolean
    worker: number          // 0 = main instance
    label?: string
    startedAt: number       // Date.now() at registration
    status: 'queued' | 'running' | 'done' | 'error'
  }
  export function registerRun(e: Omit<RunEntry, 'status' | 'startedAt'>): RunEntry
  export function markRunning(promptId: string): RunEntry | null
  export function finishRun(promptId: string, status: 'done' | 'error'): RunEntry | null  // removes entry, returns it
  export function getRun(promptId: string): RunEntry | null
  export function inFlight(filter?: { tabId?: string; worker?: number }): RunEntry[]
  export function clearAllRuns(): void   // test hook + tab-close cleanup
  ```
- Module-singleton `Map<string, RunEntry>` (plain module state; NOT a ref — consumers poll or wrap). One reactive escape hatch: `export const inFlightCount = ref(0)` updated on every mutation (drives the "N running" pill without making the Map reactive).

- [ ] **Step 1: Failing tests** — register→getRun roundtrip; markRunning transitions queued→running; finishRun removes + returns entry; inFlight filters by tabId and by worker; inFlightCount ref tracks size; unknown promptId → null everywhere; clearAllRuns resets.
- [ ] **Step 2: verify FAIL** (`npm run test:unit -- run-registry`) → **Step 3: implement** → **Step 4: PASS**
- [ ] **Step 5: Commit** `git commit -m "feat(parallel): prompt_id-keyed run registry" -- frontend/app/lib/graph/runRegistry.ts frontend/tests/unit/run-registry.unit.spec.ts`

### Task 2: Registry wiring in default.vue (Slice A complete)

**Files:**
- Modify: `frontend/app/layouts/default.vue` (three surgical regions, exact anchors below)
- Create: `frontend/app/lib/graph/resolveEventTab.ts`
- Test: `frontend/tests/unit/resolve-event-tab.unit.spec.ts`

**Interfaces:**
- Consumes: Task 1 registry.
- Produces: `resolveEventTab(promptId: string | null | undefined, activeProjectTabId: string | null): string | null` — pure: registry hit → entry.tabId, else activeProjectTabId (today's fallback). Used by handleBridgeEvent for direct events.

Integration facts (from recon, verify against live code):
- Direct queue branch: `default.vue:846-867` — after `direct.queue(...)` succeeds with `res.prompt_id`, call `registerRun({ promptId: res.prompt_id, tabId: runTabId, live: !!opts.live, worker: 0 })`. (Worker becomes real in Task 6 — pass the chosen worker through.)
- Watchdog: `armQueueWatchdog(tabId)` / `QUEUE_WATCHDOG_MS = 8000` at `default.vue:1489-1512`; today it is global and cleared by `queued` (line ~2541) or `execution_start` (~2617). Direct mode has NO `queued` event. Change: for direct runs, arm a PER-RUN timer stored in a `Map<promptId, timer>` beside the registry call; clear it in handleBridgeEvent when `execution_start` (or any event) for that promptId arrives; on fire → same toast + `finishRun(promptId, 'error')` + tab idle if that tab has no other inFlight runs. Bridge-path watchdog stays untouched.
- handleBridgeEvent (~2470-2649): where the direct-branch events attribute to the active tab, use `resolveEventTab(data.prompt_id, <current fallback>)`. On `execution_start` → `markRunning`; on `execution_complete`/`execution_error` → `finishRun`; tab status set to 'idle' ONLY when `inFlight({ tabId }).length === 0` after removal (two concurrent runs on one tab: first completion must not clear the spinner).
- "N running" pill reads `useTabs().runningCount` (tabs.status based) — unchanged; correct because tab status now flips idle only when its registry drains.

- [ ] **Step 1: Failing tests for resolveEventTab** (registry hit wins; miss falls back; null promptId falls back)
- [ ] **Step 2: FAIL → Step 3: implement helper + wire default.vue per above (read each region first; minimal diffs; preserve draft-override logic verbatim)**
- [ ] **Step 4: full unit suite — zero new failures; manually trace (in report) the two-runs-one-tab completion ordering**
- [ ] **Step 5: Commit** `-- frontend/app/lib/graph/resolveEventTab.ts frontend/app/layouts/default.vue frontend/tests/unit/resolve-event-tab.unit.spec.ts`

### Task 3: Worker pool (Nitro plugin + ensure route)

**Files:**
- Create: `frontend/server/utils/comfyWorkerPool.ts`, `frontend/server/api/pool/ensure.post.ts`, `frontend/server/plugins/comfyWorkerPool.ts`
- Modify: `frontend/nuxt.config.ts` (runtimeConfig: `comfyPoolSize: ''` ← NUXT_COMFY_POOL_SIZE, `comfyPython: ''` ← NUXT_COMFY_PYTHON)
- Test: `frontend/tests/unit/comfy-worker-pool.unit.spec.ts`

**Interfaces:**
- Produces (server/utils/comfyWorkerPool.ts):
  ```typescript
  export interface WorkerState { index: number; port: number; status: 'stopped'|'starting'|'ready'; pid?: number; lastUsedAt: number }
  export function workerPort(index: number): number            // 8189 + index
  export function shouldReap(w: WorkerState, now: number, idleMs?: number): boolean  // ready && now-lastUsedAt > 15*60_000
  export async function ensureWorker(index: number): Promise<WorkerState>  // spawn if needed, poll /system_stats until ready (30s timeout), record on globalThis
  export function touchWorker(index: number): void
  export function poolSize(): number   // clamp(Number(runtimeConfig.comfyPoolSize)||2, 0, 4)
  ```
- State on `globalThis.__cnComfyPool` (HMR-safe, trainingQueue.ts precedent). Plugin: defineNitroPlugin → reap interval every 60s (guarded singleton timer like `g.__cnTrainingQueueTimer`); kills reaped child processes (SIGTERM). Spawn: `child_process.spawn(python, ['main.py','--listen','127.0.0.1','--port',String(port),'--cpu'], { cwd: repoRoot, stdio: 'ignore', detached: false })` where repoRoot = `fileURLToPath(new URL('../..', import.meta.url))` resolved to the git root — verify the actual relative depth at implementation time and port-probe (net connect to port) before spawning; if occupied by a live ComfyUI (`/system_stats` 200) adopt it, else pick failure→fallback (status 'stopped').
- `POST /api/pool/ensure` body `{ worker: number }` → `{ port, status }`; index out of `poolSize()` range → 400. Route must be in the app's own API namespace (NOT proxied to ComfyUI — `/api` IS in PROXY_PREFIXES; check `comfyui-proxy.ts` skip logic for Nuxt-owned routes and follow the existing pattern for internal `/api/*` routes, e.g. how `/api/lipsync/speech` coexists).

- [ ] **Step 1: Failing tests** for the pure parts: workerPort math; shouldReap boundaries; poolSize clamps (0, garbage, >4).
- [ ] **Step 2: FAIL → Step 3: implement utils + route + plugin → Step 4: PASS + `npx nuxi typecheck`-equivalent clean for new files**
- [ ] **Step 5: Commit** `-- frontend/server/utils/comfyWorkerPool.ts frontend/server/api/pool/ensure.post.ts frontend/server/plugins/comfyWorkerPool.ts frontend/nuxt.config.ts frontend/tests/unit/comfy-worker-pool.unit.spec.ts`

### Task 4: Worker routing in proxy + WS dispatcher

**Files:**
- Create: `frontend/server/utils/workerRoute.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts` (target computation, ~lines 40-49), `frontend/nuxt.config.ts` (comfy-ws-proxy dispatcher, ~lines 43-106)
- Test: `frontend/tests/unit/worker-route.unit.spec.ts`

**Interfaces:**
- Produces: `resolveWorkerTarget(url: string): { port: number; cleanUrl: string }` — parses `comfyWorker=N` from the query string; returns port 8188 when absent/invalid/negative/NaN, `8189+N` when 0≤N≤7; `cleanUrl` = url with the param removed (other params preserved, `?` dropped if empty).
- comfyui-proxy.ts: compute `const { port, cleanUrl } = resolveWorkerTarget(path)` and proxy to `http://127.0.0.1:${port}${backendPath(cleanUrl)}` with origin header rewritten to that same target (mirror existing `origin: COMFY_BACKEND` line).
- nuxt.config.ts dispatcher: same helper inlined (nuxt.config cannot import from server/utils at config-eval time — duplicate the ~10-line parse inside the config function with a comment naming `workerRoute.ts` as canonical; keep both trivially small).

- [ ] **Step 1: Failing tests** — absent param → 8188 + unchanged url; `?comfyWorker=1` → 8190 + param stripped; combined `?clientId=x&comfyWorker=0` → 8189, clientId preserved; garbage/`-1`/`99` → 8188 + param stripped.
- [ ] **Step 2: FAIL → Step 3: implement + wire both call sites → Step 4: PASS, zero new failures**
- [ ] **Step 5: Commit** `-- frontend/server/utils/workerRoute.ts frontend/server/middleware/comfyui-proxy.ts frontend/nuxt.config.ts frontend/tests/unit/worker-route.unit.spec.ts`

### Task 5: Pool-eligibility predicate

**Files:**
- Create: `frontend/app/lib/graph/cloudOnly.ts`
- Test: `frontend/tests/unit/cloud-only.unit.spec.ts`

**Interfaces:**
- Consumes: `ApiPrompt` type from `~/lib/graph/graphToPrompt`; objectInfo map (class_type → `{ category?, ... }`).
- Produces: `isPoolEligible(prompt: ApiPrompt, objectInfo: Record<string, any>): boolean`.

Rules (reuse the costEstimate.ts precedent — read `frontend/app/lib/costEstimate.ts:42-56` first):
- A node is CLOUD if `class_type.endsWith('RemoteNode')` OR its objectInfo `category` matches `/\/Replicate$/` OR starts with `'api node'`.
- A node is UTILITY_SAFE if class_type ∈ `new Set(['EmptyImage','LoadImage','SaveImage','PreviewImage','ImageBatch','LoadImageFromUrl','SaveImageWebsocket','ETN_LoadImageBase64','GateNode'])` — VERIFY each name exists in this codebase's object_info/comfy_extras before finalizing (check `comfy_extras/nodes_gate.py` for the gate's real class name); drop names that don't exist, add the real gate name.
- Eligible ⟺ prompt has ≥1 node AND every node is CLOUD or UTILITY_SAFE AND class_type present in objectInfo. Unknown/missing → false (conservative).

- [ ] **Step 1: Failing tests** — all-cloud prompt eligible; cloud+utility eligible; one KSampler (category 'sampling') → false; unknown class_type → false; empty prompt → false; reuse a golden fixture prompt from `frontend/tests/unit/__fixtures__/golden/` for at least one case.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS**
- [ ] **Step 5: Commit** `-- frontend/app/lib/graph/cloudOnly.ts frontend/tests/unit/cloud-only.unit.spec.ts`

### Task 6: Per-worker WS + scheduler + queueParallel

**Files:**
- Modify: `frontend/app/composables/useDirectExecution.ts`
- Create: `frontend/app/lib/graph/pickWorker.ts`
- Test: `frontend/tests/unit/pick-worker.unit.spec.ts`, extend `frontend/tests/unit/ws-event-map.unit.spec.ts` if URL building changes

**Interfaces:**
- Consumes: Task 1 `inFlight({ worker })`, Task 5 `isPoolEligible`, Task 4 query convention.
- Produces:
  ```typescript
  export function pickWorker(inFlightByWorker: number[], poolSize: number): number
  // pickWorker: pool workers are indices 1..poolSize (0 = main, never picked here);
  // returns 1-based pool worker with fewest in-flight, ties → lowest index; poolSize 0 → 0 (main).
  interface QueueOpts { worker?: number }   // 0/absent = main; N>=1 = pool worker N-1 → query comfyWorker=N-1
  queue(prompt, workflow, opts?: QueueOpts) // appends `?comfyWorker=${opts.worker-1}` to the POST path when worker>=1
  queueParallel(items: { prompt: ApiPrompt; workflow: LiteGraphWorkflow; label?: string }[], ctx: { objectInfo: Record<string, any> }): Promise<QueueResult[]>
  ```
- `queueParallel`: if items.length ≤ 1 or any item not `isPoolEligible` → sequential `queue()` on main (current behavior). Else: `$fetch('/api/pool/ensure', ...)` for the workers it plans to use (Promise.allSettled; failures shrink the usable pool, all-fail → main); per item pick via `pickWorker` fed from `inFlight({worker: i}).length`; open that worker's WS before queueing.
- Per-worker WS: refactor module state (`ws`, `wantConnected`, `reconnectAttempt`, `reconnectTimer` at useDirectExecution.ts:56-62) into `Map<number, SocketState>` keyed by worker (0 = main). `connect()` keeps its no-arg signature (connects worker 0); internal `connectWorker(n)` builds URL via existing `buildWsUrl(origin, clientId)` + (`n>=1 ? `&comfyWorker=${n-1}` : ''`). Same clientId for all sockets. Disconnect a pool worker's socket when `inFlight({worker:n})` drains to 0 (check on finishRun via a registry-poll in the completion path or a lightweight callback — simplest: check inside the onEvent fan-out after execution_complete/error events).
- Do NOT change existing callers: `queue(prompt, workflow)` with no opts must behave exactly as today (worker 0, no query param). Existing ws-event-map tests must stay green.

- [ ] **Step 1: Failing tests for pickWorker** (least-loaded; tie→lowest; poolSize 0→0; single worker) — and a buildWsUrl+comfyWorker composition test.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: all ws/direct/graph specs green**
- [ ] **Step 5: Commit** `-- frontend/app/composables/useDirectExecution.ts frontend/app/lib/graph/pickWorker.ts frontend/tests/unit/pick-worker.unit.spec.ts frontend/tests/unit/ws-event-map.unit.spec.ts`

### Task 7: Parallel takes gesture (Slice C — touches shared canvas file, be surgical)

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue` (the run-workflow assembly around lines 5634-5665 + the Re-roll scope dropdown), `frontend/app/layouts/default.vue` (runVueWorkflow signature passthrough)
- Test: none new (pure passthrough; the loop logic is 10 lines) — manual trace in report

**Interfaces:**
- Consumes: Task 6 `queueParallel`, Task 5 predicate, existing `rerollScope: 'variation'` seed machinery (`randomizeSeedsOnLiveState(seedScope)` + `upstreamSeedScope` at VueNodeCanvas.vue:5646-5653).
- Produces: run option `takes?: number` flowing from the Re-roll dropdown to the dispatch site.

Behavior: a new dropdown item "Re-roll ×4 (parallel)" in the existing Play/Re-roll scope dropdown (read `NodePlayButton`/scope-dropdown component to find the menu source — memory: footer Play/Re-roll split button, 3 run scopes), visible ONLY when direct execution flag is on. When `takes=4`: at the dispatch site, loop 4×: `randomizeSeedsOnLiveState(seedScope)` → assemble filtered workflow + prompt (reusing the exact same assembly the single run does — extract the per-iteration assembly into a local function if and only if the existing code structure requires duplication otherwise) → collect. Then `queueParallel(items, { objectInfo })` and `registerRun` each result with the chosen worker + tabId (coordinate with the Task 2 registration point — registration happens where prompt_ids come back). Not pool-eligible → sequential loop of `queue()` (still 4 takes, just serial — same UX, slower).

- [ ] **Step 1: read the dropdown + dispatch code paths fully; write the wiring**
- [ ] **Step 2: unit suite zero new failures; typecheck clean**
- [ ] **Step 3: Commit** `-- frontend/app/components/vue-canvas/VueNodeCanvas.vue frontend/app/layouts/default.vue`

### Task 8: Live verification

**Files:** none (report + screenshots; fixes committed pathspec as needed)

- [ ] **Step 1:** ComfyUI main running (8188); start the `frontend-harness` preview server; navigate via `127.0.0.1` (localhost 426 gotcha); enable Direct execution flag.
- [ ] **Step 2:** Project with one EmptyImage node → "Re-roll ×4 (parallel)": verify via server logs + network that ≥2 distinct `?comfyWorker=` targets were POSTed, workers spawned (ports 8189/8190 respond to /system_stats), 4 takes land attributed to the right node, pill shows >1 running mid-flight, all watchdogs quiet.
- [ ] **Step 3:** GPU-shaped graph (add a KSampler without running it — just verify predicate): confirm dispatch targets main only (no comfyWorker param).
- [ ] **Step 4:** Kill one worker process mid-run (`kill <pid>`): its run surfaces execution_error/lost-worker path, other runs complete, dev server unharmed.
- [ ] **Step 5:** Flag OFF regression: normal single run through bridge unchanged. Screenshot proof of the 4-take light table. Write findings to the SDD report.

## Self-review notes

- Spec coverage: Slice A = T1+T2; Slice B = T3+T4+T5+T6; Slice C = T7; live = T8. Spec's "mapWsEvent forwards prompt_id" + "queue returns error" already exist on main (verified by recon) — no tasks needed.
- Deliberate deviations from spec: worker WS selector uses the same `comfyWorker` query on `/ws` (spec said "one WS per active worker" — implemented via query param on the same dispatcher); scheduler counts in-flight from the registry (client-side) rather than server queue depth — good enough for a 2-worker pool.
- Type note: `QueueOpts.worker` is 1-based app-side (0=main) while the query param is the 0-based pool index — the off-by-one is contained entirely inside `queue()`; `pickWorker` returns the 1-based app-side number. Implementers: read the Interfaces blocks carefully.
