# Concurrency correctness — registry as single source of per-run truth

**Date:** 2026-07-08
**Status:** approved (user chose the full structural epic)
**Audit:** `docs/strategy/2026-07-08-concurrency-correctness-audit.md` (the design exploration + full findings)
**Applies to:** direct-execution mode only (`Comfy.DirectExecution.Enabled`); bridge-iframe mode is strictly serial and must stay byte-identical.

## Problem

Parallel dispatch (spill-to-pool singles via `queueSmart`, Re-roll ×4 via `queueParallel`) put 2–4 runs in flight at once. The run registry (`runRegistry.ts`) is correctly `prompt_id`-keyed, but three layers were never ported to it and still use single-value global state or dead `event.source` worker routing:

1. **Cost/credit accumulators** (default.vue) — global singletons → N² Replicate USD overcount, wrong-image cost records, credit spend on the wrong run.
2. **Result attribution / worker routing** (VueNodeCanvas) — `eventWorker(event.source)` is dead in direct mode (returns 0 always) + per-worker single-value maps → "runs forever," wrong-canvas result placement.
3. **Lifecycle/display state** (default.vue) — global singletons → result suppression, wrong duration/progress.

Plus a spill-defeating race: `queueSmart` reads `inFlight` but `registerRun` happens *after* the POST, so rapid singles both pick main.

## Design: one source of truth

### 1. Enrich `RunEntry` (runRegistry.ts)

Current `RunEntry`: `{ promptId, tabId, worker, live, startedAt, status }`. Add a mutable per-run state bag:

```ts
interface RunEntry {
  promptId: string
  tabId: string
  worker: number
  live: boolean
  startedAt: number
  status: 'queued' | 'running' | 'done' | 'error'
  canvasId: string | null          // NEW — which project canvas dispatched it
  // per-run accumulators (mutated in place by event handlers):
  startCredits: number | null      // NEW — balance snapshot at execution_start
  costDeadline: number             // NEW — replaces global runCostDeadline (0 = disabled)
  executedNodeIds: Set<string>     // NEW — nodes THIS run executed
  outputs: GenOutput[]             // NEW — output files from THIS run's executed events
  nodeProgress: { completed: number; total: number }  // NEW
  runningNode: string | null       // NEW — the node this run is currently executing
  pendingGenRecord: PendingGen | null  // NEW — replaces global pendingGen
}
```

`registerRun` initializes the accumulators (empty Set/array, 0 progress). Mutators return snapshots as today (documented — callers re-fetch).

### 2. `perRun(promptId)` accessor + bridge fallback

```ts
export function perRun(promptId: string | null | undefined): RunEntry | TransientRun
```

- Registered (direct) prompt → the live `RunEntry`.
- Unregistered (bridge-path, or missing prompt_id) → a **transient** per-run bag keyed by `local_${promptId ?? '_'}` in a small module Map, torn down on that run's completion. This preserves single bridge-run behavior byte-identically: bridge runs never register, so they get a synthetic bag and the old single-run semantics fall out naturally (one transient at a time).

Every consumer that reads a global accumulator today takes a `promptId` and reads `perRun(promptId)` instead:
- `estimateReplicateUsd(promptId)` reads `perRun(promptId).executedNodeIds`
- the credit-delta watcher resolves the run by promptId, reads `startCredits`/`costDeadline` off the entry, attaches cost to that run's result
- `flushPendingGen(promptId)` flushes `perRun(promptId).pendingGenRecord`

### 3. Synchronous in-flight reservation (fixes the spill race)

Add to runRegistry:
```ts
export function reserve(worker: number): number   // returns reservationId; bumps a per-worker count
export function inFlight(filter?): RunEntry[]      // count now includes active reservations
export function releaseReservation(id: number): void
// registerRun(entry, reservationId?) consumes a reservation into a real run.
```

`queueSmart`/`queueParallel` call `reserve(worker)` **synchronously at the moment they pick a worker**, before any `await`. The reservation makes `inFlight({worker:0})` immediately reflect the pending run, so a second rapid `queueSmart` sees main busy and spills. The reservation is upgraded to a full run by `registerRun` (default.vue passes the reservationId returned in `QueueResult`), or released if dispatch fails. Mirrors the socket layer's `pendingPosts` pattern exactly.

### 4. Route ALL event handling by prompt_id

**default.vue** `handleBridgeEvent`: every branch that reads/writes a global run variable instead reads `perRun(event.data.prompt_id)`. Delete the globals (`executedNodeIds`, `runOutputs`, `runStartCredits`, `runCostDeadline`, `pendingGen`, and drive the status bar from the active tab's entry). `currentRunSilent` → `perRun(promptId).live` (the `live` flag already exists). `tabNodeProgress`/`validatedRun` → `perRun(promptId).nodeProgress`.

**VueNodeCanvas** `handleBridgeMessage`: **delete the `eventWorker(event.source)` + `activeWorker` gate.** Resolve `const entry = getRun(event.data.prompt_id)`. Gate result placement on `entry?.canvasId === <this canvas's id>` (buffer into `pendingTakesByCanvas` otherwise). Replace `runningNodeByWorker`/`runningCanvasByWorker` reads with `entry` fields / the existing `runningNodeByPrompt`. Node-result placement core (keys off `event.data.node_id`) is already safe — unchanged.

### 5. Assembly lock

Wrap the assemble→dispatch body of `runVueWorkflow` in `withKeyedLock('assemble-run', …)` (pattern exists in keyedLock.ts) so `applyDraftOverrides`/`applyPendingPromotes` live-state reads after awaits can't cross-consume between overlapping runs. Seeds are already safe (synchronous snapshot per take) — this covers the draft/promote registries.

### 6. Cold-boot spill feedback

In the spill path: register a provisional `queued` run + arm the stall watchdog + give the `/api/pool/ensure` `$fetch` a client-side timeout **before** awaiting the ensure probe, so a wedged worker boot fails loudly instead of hanging with no feedback.

## Phases (each live-verified with two concurrent runs before the next)

- **Phase 1 — scaffolding:** enrich `RunEntry`, add `perRun`/`reserve`/`releaseReservation`, unit tests. No behavior change (globals still authoritative; new fields unused).
- **Phase 2 — billing (Tier 0):** move executedNodeIds/outputs/startCredits/costDeadline/pendingGen onto the entry; `estimateReplicateUsd(promptId)`, the credit watcher, `flushPendingGen(promptId)` all per-run. Golden test: two overlapping runs (one Replicate $0.03, one free) each record their own cost; 4× nano-banana records $0.12 total not $0.48.
- **Phase 3 — result attribution (C1/C3/C6):** replace the eventWorker/activeWorker gate in VueNodeCanvas with prompt_id→entry routing + `canvasId` gating; add `canvasId` at register time.
- **Phase 4 — spill correctness (C2) + assembly lock (R1) + cold-boot (R2):** synchronous reservation; keyed lock; provisional register + watchdog before ensure.
- **Phase 5 — lifecycle/display (C4/C5 + Tier 3):** `currentRunSilent`→entry.live, `tabNodeProgress`→entry.nodeProgress, status bar reads the active tab's entry; cost-confirm FIFO queue (R3).

## Out of scope

Bridge-path behavior changes; history-listing routes showing pool-worker runs (separate small follow-up); multiplayer; the direct-execution flag default.

## Risks

- Billing phase touches money — golden tests with concurrent runs are mandatory before it's considered done.
- `RunEntry` mutation-returns-snapshot semantics: consumers must re-fetch, never cache an entry across a transition (existing documented gotcha).
- default.vue and VueNodeCanvas are large shared files a concurrent sketchbook session also edits — surgical diffs, pathspec commits, BLOCKED-on-conflict.
