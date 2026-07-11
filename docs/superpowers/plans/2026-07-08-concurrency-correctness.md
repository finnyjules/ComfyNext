# Concurrency Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the prompt_id-keyed run registry the single source of per-run truth so concurrent direct-mode runs bill, attribute results, and animate independently.

**Architecture:** A parallel `RunState` map (keyed by prompt_id) holds the mutable per-run accumulators (executed nodes, outputs, credits, progress); `RunEntry` stays the immutable identity/status record + gains `canvasId`. Every event handler in default.vue and VueNodeCanvas routes by `event.data.prompt_id` instead of global singletons or `event.source`. A synchronous reservation primitive closes the spill race.

**Tech Stack:** Nuxt 4 / Vue 3 / TS, vitest (`cd frontend && npm run test:unit -- <name>`).

**Spec:** `docs/superpowers/specs/2026-07-08-concurrency-correctness-design.md`
**Audit (findings + file:line):** `docs/strategy/2026-07-08-concurrency-correctness-audit.md`

## Global Constraints

- Work on `main`, no branches. Explicit staging + pathspec commits ONLY (`git commit -m "..." -- <paths>`); NEVER `git add -A`. A concurrent sketchbook session edits default.vue + VueNodeCanvas — if `git status` shows either modified by someone else when you start, report BLOCKED for that file.
- Direct-mode only. Bridge-iframe path (flag off) must stay byte-identical — bridge runs never register, so per-run lookups must fall back to a transient synthetic bag keyed `local_${promptId ?? '_'}` giving the old single-run semantics.
- Known suite noise: ~8 pre-existing failures in concurrent-session specs (spacetype-palette, video-model-adapt, gradientfx-mesh, critique-fix-chips, artifact-next-steps). Compare the failing FILE LIST before/after; zero NEW failures.
- `RunEntry` mutators return NEW snapshots (existing gotcha) — never cache an entry across a transition; re-fetch via `getRun`. `RunState` (the accumulator bag) is a STABLE reference per prompt_id — safe to hold within one event's handling.
- Design refinement over the spec: the mutable accumulators live in a parallel `Map<promptId, RunState>` (not nested on RunEntry), so entry-snapshot churn never touches them.

---

### Task 1: RunState + perRun accessor + RunEntry.canvasId (registry scaffolding)

**Files:**
- Modify: `frontend/app/lib/graph/runRegistry.ts`
- Test: `frontend/tests/unit/run-state.unit.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GenOutputLike { [k: string]: any }
  export interface RunState {
    executedNodeIds: Set<string>
    outputs: GenOutputLike[]
    startCredits: number | null
    costDeadline: number            // 0 = credit watch disabled
    nodeProgress: { completed: number; total: number }
    runningNode: string | null
    pendingGenRecord: any | null
  }
  export function perRun(promptId: string | null | undefined): RunState  // registered → its state; else a transient bag keyed local_${id ?? '_'}
  export function dropRunState(promptId: string | null | undefined): void // tears down (registered or transient)
  ```
- `RunEntry` gains `canvasId: string | null`. `registerRun`'s `Omit` input must therefore accept `canvasId`; existing callers pass it (Task 6 wires the real value — for now accept it optional-defaulting to null so existing callers compile: make `canvasId?: string | null` on the input, default `null`).
- `registerRun` seeds a `RunState` (empty Set/array, startCredits null, costDeadline 0, progress 0/0, runningNode null, pendingGenRecord null). `finishRun` calls `dropRunState(promptId)`.
- Transient bags: a separate `Map<string, RunState>` for `local_*` keys; `perRun` creates on miss; `dropRunState` deletes.

- [ ] **Step 1: Failing tests** — perRun(registered id) returns the seeded state and is STABLE across calls (same ref, mutations persist); perRun(unregistered 'p') returns a transient, stable across calls; perRun(null) returns a stable `_`-keyed transient; finishRun drops the registered state (next perRun is fresh); dropRunState clears a transient; canvasId round-trips through registerRun/getRun.
- [ ] **Step 2: FAIL** (`npm run test:unit -- run-state`) → **Step 3: implement** → **Step 4: PASS + `npm run test:unit -- run-registry` still green**
- [ ] **Step 5: Commit** `-- frontend/app/lib/graph/runRegistry.ts frontend/tests/unit/run-state.unit.spec.ts`

### Task 2: Synchronous reservation primitive

**Files:**
- Modify: `frontend/app/lib/graph/runRegistry.ts`
- Test: `frontend/tests/unit/run-reservation.unit.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export function reserve(worker: number): number          // returns reservationId; bumps a per-worker reservation count
  export function releaseReservation(id: number): void     // drops it (dispatch failed / superseded by a real run)
  ```
- `inFlight(filter?)` now counts reservations too: an active reservation for worker W contributes to `inFlight({worker: W}).length` (and to the unfiltered count). Reservations have no tabId, so `inFlight({tabId})` ignores them.
- `registerRun` gains an optional 2nd arg `reservationId?: number` — consuming it releases that reservation (so it isn't double-counted once the real run exists).
- Reservation ids from a module counter; `import.meta`-free (no Date.now/random). Reservations stored in `Map<number, { worker: number }>`.

- [ ] **Step 1: Failing tests** — reserve(0) makes `inFlight({worker:0}).length === 1` with zero registered runs; two reserves stack; releaseReservation drops the count; registerRun with a reservationId consumes it (count stays 1, not 2, and is now a real run with a tabId); reserve does not affect `inFlight({tabId})`; `inFlightCount` ref reflects reservations too.
- [ ] **Step 2: FAIL → Step 3: implement → Step 4: PASS, run-registry + run-state still green**
- [ ] **Step 5: Commit** `-- frontend/app/lib/graph/runRegistry.ts frontend/tests/unit/run-reservation.unit.spec.ts`

### Task 3: Per-run cost tally (pure) + billing accumulators in default.vue

**Files:**
- Create: `frontend/app/lib/graph/runCost.ts`
- Modify: `frontend/app/layouts/default.vue`
- Test: `frontend/tests/unit/run-cost.unit.spec.ts`

**Interfaces:**
- Consumes: Task 1 `perRun`, existing `costEstimate.ts` (`isReplicateBilled`, `estimateUsdForNodes`, `vueNodesToEstimateInput`).
- Produces: `tallyReplicateUsd(executedNodeIds: Set<string>, allNodes: any[]): { usd: number; approximate: boolean } | null` — pure: filter allNodes to those whose id ∈ executedNodeIds AND `isReplicateBilled`, sum via `estimateUsdForNodes`. This is the current `estimateReplicateUsd` body with the node set passed in instead of read from a global.

default.vue transformation (read the audit's Tier-0 findings for exact anchors; verify current lines):
- Delete globals `executedNodeIds` (2269), `runOutputs` (2273). In `handleBridgeEvent`: `executing` → `perRun(event.data.prompt_id).executedNodeIds.add(String(nodeId))`; `executed` → `perRun(prompt_id).outputs.push(...)`; `execution_start` no longer `.clear()`s a global (the per-run bag starts empty at registerRun; for bridge/transient, a fresh `execution_start` should `dropRunState` then let the next `perRun` recreate — preserving the bridge "clear on start" semantics for the single transient).
- `estimateReplicateUsd()` → `tallyReplicateUsd(perRun(prompt_id).executedNodeIds, vueCanvasRef.value?.getNodes?.() || [])` at the `execution_complete` site; the GenerationRecord reads `perRun(prompt_id).outputs`.

- [ ] **Step 1: Failing tests for `tallyReplicateUsd`** — two disjoint node sets (run A = 1 Replicate node $0.03, run B = 1 free node) tallied separately give A=$0.03, B=null; a set of 4 identical Replicate nodes = 4×, but crucially tallying run A's set never includes run B's nodes (the N² bug: assert `tallyReplicateUsd(setA, allNodes)` sums ONLY setA even when allNodes contains B's Replicate nodes).
- [ ] **Step 2: FAIL → Step 3: implement runCost.ts + wire default.vue (surgical; preserve draft/bridge paths) → Step 4: run-cost green; full suite failing-file-list unchanged; typecheck no new errors on default.vue**
- [ ] **Step 5: Commit** `-- frontend/app/lib/graph/runCost.ts frontend/app/layouts/default.vue frontend/tests/unit/run-cost.unit.spec.ts`

### Task 4: Per-run credits (startCredits / costDeadline / pendingGen) in default.vue

**Files:**
- Modify: `frontend/app/layouts/default.vue`
- Test: none new mandated (wiring); if the credit-delta math is extractable as a pure helper, add one test for "delta computed against THIS run's startCredits."

**Interfaces:** Consumes Task 1 `perRun`/`dropRunState`.

Transformation (audit Tier-0 B3/B4):
- Delete globals `runStartCredits` (2267), `runCostDeadline` (2268), `pendingGen` (2278). `execution_start` → `perRun(prompt_id).startCredits = credits.value`. `execution_complete` sets `perRun(prompt_id).costDeadline` (0 for Replicate runs to disable, `now+8000` for Comfy-native).
- The credit-delta `watch(credits)` (2319): iterate the registry's in-flight runs whose `perRun(id).costDeadline > now` and whose costDeadline is armed; attribute `delta = perRun(id).startCredits - newVal` to THAT run's pendingGenRecord/result. Simplest correct rule for the common case: resolve the single run with an armed non-zero costDeadline; if multiple are armed, attribute to the one whose startCredits is highest (most recent). Document the heuristic; the accumulator is now per-run so no cross-contamination of the *record* even if the delta split is approximate.
- `flushPendingGen(promptId)` flushes `perRun(promptId).pendingGenRecord`; `execution_start` must NOT blanket-flush other runs' pending records (only its own, if any).

- [ ] **Step 1: implement per-run credit wiring; if a `creditDelta(startCredits, newBalance)` helper is extracted, TDD it (RED first)**
- [ ] **Step 2: full suite failing-file-list unchanged; typecheck clean on default.vue; manually trace in the report: two concurrent credit-billed runs each get their own startCredits and neither clobbers the other's pendingGenRecord**
- [ ] **Step 3: Commit** `-- frontend/app/layouts/default.vue [+ helper/test if created]`

### Task 5: Result attribution by prompt_id in VueNodeCanvas

**Files:**
- Modify: `frontend/app/components/vue-canvas/VueNodeCanvas.vue`
- Test: none new mandated (integration in a huge file); manual trace in report.

**Interfaces:** Consumes `getRun` from `~/lib/graph/runRegistry`; needs this canvas's own id (the prop it already gets for `runScopeMatches`).

Transformation (audit C1/C3/C6):
- Remove the `eventWorker(event.source)` + `isActiveWorker` gate (121-128, 2414-2417). Replace: `const entry = getRun(event.data.prompt_id)`. For direct events (have a registered entry): gate result placement / glow on `entry.canvasId === <this canvas id>` — if it doesn't match, buffer `executed` into `pendingTakesByCanvas[entry.canvasId]` and return; else place. For events with NO registered entry (bridge path): keep today's behavior (they flow to the displayed canvas as before).
- Replace `runningNodeByWorker[evWorker]` (115, 2415-2416, 144) reads/writes with the existing `runningNodeByPrompt` (already keyed correctly) and the per-run `entry`; `applyRunningForActiveWorker` (142) re-lights from `runningNodeByPrompt` filtered to entries whose `canvasId`/`tabId` match the shown canvas.
- Node-result placement core (keys off `event.data.node_id`, ~2499) is already safe — do not touch its placement logic, only its gating.

- [ ] **Step 1: read the full handleBridgeMessage + the worker/scope helpers; write the transformation**
- [ ] **Step 2: full suite failing-file-list unchanged; typecheck no new VueNodeCanvas errors; report a manual trace of: (a) a spilled pool-worker run's completion now clears its glow (was dropped), (b) two runs on worker 0 from different canvases each land on their own canvas**
- [ ] **Step 3: Commit** `-- frontend/app/components/vue-canvas/VueNodeCanvas.vue`

### Task 6: Synchronous reservation wired into dispatch (fixes spill race)

**Files:**
- Modify: `frontend/app/composables/useDirectExecution.ts`, `frontend/app/layouts/default.vue`
- Test: extend `frontend/tests/unit/pick-worker.unit.spec.ts` if a pure helper emerges; otherwise trace.

**Interfaces:** Consumes Task 2 `reserve`/`releaseReservation`, `registerRun(entry, reservationId?)`.

Transformation (audit C2):
- `queueSmart` and `queueParallel`: at the moment they pick a worker (synchronously, before any `await`), call `reserve(worker)` and carry the reservationId through to the `QueueResult` (add `reservationId?: number` to QueueResult). On dispatch failure, `releaseReservation`.
- `queueSmart`'s main-idle check now reads `inFlight({worker:0})` which INCLUDES reservations → a second rapid run sees main reserved-busy and spills. Verify the reserve happens before the `mainInFlight` read of the NEXT call by making reserve synchronous in the decision path.
- default.vue `registerRun(...)` calls pass `res.reservationId` so the reservation upgrades to a real run (no double count).

- [ ] **Step 1: implement reservation in queueSmart/queueParallel + thread reservationId; register consumes it**
- [ ] **Step 2: pick-worker/direct suites green; failing-file-list unchanged; report a trace: two synchronous back-to-back queueSmart calls → first reserves worker 0, second sees inFlight({worker:0})≥1 → spills to pool**
- [ ] **Step 3: Commit** `-- frontend/app/composables/useDirectExecution.ts frontend/app/layouts/default.vue [+ test]`

### Task 7: Assembly lock + cold-boot spill feedback

**Files:**
- Modify: `frontend/app/layouts/default.vue`, `frontend/app/composables/useDirectExecution.ts`

**Interfaces:** Consumes existing `withKeyedLock` (`~/lib/graph/keyedLock`), Task 2 reservation.

Transformation (audit R1/R2):
- Wrap the assemble→dispatch body of `runVueWorkflow` (the region reading live state through `applyDraftOverrides`/`applyPendingPromotes` after awaits) in `withKeyedLock('assemble-run', async () => { ... })`. Seeds are already safe; this serializes the draft/promote registry reads so overlapping runs can't cross-consume marks. Keep it TIGHT — only the assembly+dispatch, not the whole function, so it doesn't serialize away the concurrency we want (the lock releases once dispatched; the runs still execute concurrently server-side).
- Cold-boot: in the spill path, before awaiting `/api/pool/ensure`, register a provisional queued run + arm the stall watchdog, and give the ensure `$fetch` a client-side timeout (e.g. 35_000ms) so a wedged boot rejects loudly → falls back to main + surfaces the error, instead of hanging the promise with no feedback.

- [ ] **Step 1: implement the keyed lock (scoped tight) + cold-boot provisional register/watchdog/timeout**
- [ ] **Step 2: suites + typecheck; report: (a) two overlapping runs still dispatch concurrently (lock only covers assembly, releases before execution), (b) a simulated ensure timeout falls back to main with a toast, not a hang**
- [ ] **Step 3: Commit** `-- frontend/app/layouts/default.vue frontend/app/composables/useDirectExecution.ts`

### Task 8: Lifecycle/display per-run (silent, progress, status bar, cost-confirm)

**Files:**
- Modify: `frontend/app/layouts/default.vue`

**Interfaces:** Consumes Task 1 `perRun`, `getRun`.

Transformation (audit C4/C5 + Tier 3 + R3):
- `currentRunSilent` → read `getRun(prompt_id)?.live` (the flag already lives on the entry); delete the global where it drives result-suppression at `execution_complete`.
- `tabNodeProgress`/`validatedRun` → `perRun(prompt_id).nodeProgress`; `validatedRun = perRun(prompt_id).nodeProgress.completed > 0`.
- Status bar (`:started-at`/`:percent`/running-node): drive from the ACTIVE tab's in-flight run entry (`inFlight({tabId: activeTab.id})[0]` + its `perRun`), not the globals `executionStartTime`/`currentRunProgressPct`/`currentRunningNode`. Delete those globals once nothing reads them.
- Cost-confirm (`costConfirm.value`, ~2336): make it a FIFO queue of pending confirms so two independent threshold-crossing Runs each resolve their own promise (audit R3).

- [ ] **Step 1: implement per-run lifecycle/display + cost-confirm FIFO**
- [ ] **Step 2: suites + typecheck; report a trace: a live-preview run + a real run overlapping → the real run is NOT mis-tagged silent (its record persists); status bar shows the active tab's run**
- [ ] **Step 3: Commit** `-- frontend/app/layouts/default.vue`

### Task 9: Live verification (two concurrent runs)

**Files:** none (report + screenshots; fixes pathspec as needed)

- [ ] **Step 1:** ComfyUI main on 8188; start `frontend-harness`; navigate via 127.0.0.1 (localhost 426 gotcha); wait for the "Loading Sailor" boot pill to clear before clicking (project-create no-ops during boot); enable Direct execution; pump frames if a hidden tab stalls the mount.
- [ ] **Step 2:** Two cloud generator nodes (Flux Schnell, draft, ~$0.03 each). Run node A, immediately Run node B. Instrument `window.fetch` to capture `/prompt` POSTs. Verify: BOTH dispatch (one may carry `?comfyWorker=`), both glimm simultaneously and each clears on ITS OWN completion (not when the first finishes), both images land on their own nodes.
- [ ] **Step 3:** Billing check: after both complete, read the two generation records' recorded cost (via the app's history/generation store in `window` or the result cards) — each must show ~$0.03, NOT one showing $0.06 or $0. This is the N² bug's live proof.
- [ ] **Step 4:** Re-roll ×4 on one node: 4 takes land, total recorded cost ≈ 4×$0.03 = $0.12, not $0.48.
- [ ] **Step 5:** Flag-OFF regression: bridge single run unchanged. Screenshot the two-run concurrent glimm + the correct per-run costs. Write findings.

## Self-review notes

- Spec coverage: RunState/perRun/canvasId (T1), reservation (T2), billing Tier-0 (T3/T4), attribution C1/C3/C6 (T5), spill C2 (T6), assembly R1 + cold-boot R2 (T7), lifecycle C4/C5 + display + cost-confirm R3 (T8), live incl. billing proof (T9). Bridge fallback via transient `local_*` bag threaded through T1/T3.
- Deliberate design choice vs spec: accumulators in a parallel `RunState` map, not nested on the snapshot-churning `RunEntry` — avoids the cache-across-transition footgun; RunEntry only gains the immutable `canvasId`.
- The credit-delta split across simultaneous credit-billed runs (T4) is heuristic (balance moves are not per-run attributable from a single global balance) — the *records* are now per-run and uncontaminated; the delta attribution is best-effort and documented. A truly exact split would need per-prompt cost from the server (out of scope).
