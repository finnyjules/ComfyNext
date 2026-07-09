# Concurrency correctness audit — parallel dispatch

**Date:** 2026-07-08
**Method:** 4 parallel audit agents over run-lifecycle state, cost/credit accounting, result attribution/routing, assembly+socket races.
**Trigger:** parallel dispatch (spill-to-pool singles + Re-roll ×4) shipped; user hit "second run runs forever" and "sometimes still serial." Rather than keep patching reactively, mapped the full single-run-assumption surface.

## The one-line diagnosis

**The run registry (`runRegistry.ts`) is correctly prompt_id-keyed. Three other layers were never ported to it and still use single-value global state or dead `event.source` worker routing.** Every finding is an instance of that. The fix is structural and uniform: make the registry entry the single source of per-run truth, and route ALL event handling by `event.data.prompt_id`.

All four agents independently converged on this same fix.

## Two reported symptoms, root-caused

- **"Second run runs forever / no completion"** → `eventWorker(event.source)` (VueNodeCanvas:121) is *dead* in direct mode: direct events are re-broadcast as same-window `window.postMessage({direct:true,…})` (default.vue:2542), whose `event.source` never matches an `iframe[data-worker]`, so it always returns 0. On a pool-enabled multi-tab setup the tab's `activeWorker` slot is ≥1, so `isActiveWorker` is false and `executing`/`progress`/`execution_complete` are dropped (VueNodeCanvas:2417) → glow never clears. Compounded by per-worker single-value maps overwriting when main holds 2 runs.
- **"Sometimes still serial"** → `queueSmart` reads `mainInFlight` from the registry (useDirectExecution:495) but `registerRun` only runs *after* the POST resolves (default.vue:907/942). A second rapid run reads main as idle and also picks main. Spill only fires when runs are spaced far enough apart to register first.

## Findings by tier

### TIER 0 — BILLING (recorded/displayed money is wrong) — fix first

| # | State | Bug | Sev |
|---|-------|-----|-----|
| B1 | `executedNodeIds` global Set (default.vue:2269) | Concurrent runs union their nodes; `estimateReplicateUsd` sums BOTH runs' Replicate nodes. 4× nano-banana ($0.03) records **$0.48 for $0.12** actual. `clear()` on a new start can also wipe a completed run → undercount to $0. | HIGH |
| B2 | `runOutputs` global array (2273) | Interleaved `executed` events mix output images across runs; a `GenerationRecord` saves run B's image at run A's cost, or empty outputs with nonzero cost. | HIGH |
| B3 | `runStartCredits` + credit-delta watcher + `pendingGen` globals (2267/2319/2278) | Two credit-billed runs: balance delta covers both, lands on whichever card shows; the other records `credits:null`. Records silently dropped when `pendingGen` is overwritten. | HIGH |
| B4 | `runCostDeadline` single global (2268) | A Replicate run's `deadline=0` switches off a concurrent Comfy-native run's credit watch → its cost never lands. | MED |

### TIER 1 — CORRECTNESS (wrong/lost results, defeated spill)

| # | State | Bug | Sev |
|---|-------|-----|-----|
| C1 | `eventWorker(event.source)` (VueNodeCanvas:121) | Dead in direct mode → `isActiveWorker` mis-fires → dropped completion/progress on pool-multi-tab = **"runs forever."** | HIGH |
| C2 | `queueSmart` registration timing (useDirectExecution:495 vs default.vue:907) | `mainInFlight` read is stale → rapid singles both pick main = **"still serial."** | HIGH |
| C3 | `runningCanvasByWorker`/`runningNodeByWorker` one-per-worker (default.vue:1837, VueNodeCanvas:115) | Main legitimately holds 2 runs (run 1 + a pool-cold fallback); run B's submit overwrites run A's canvas id → A's `executed` mis-buffered or lands on a **collision-id node on the wrong canvas**. | HIGH |
| C4 | `currentRunSilent` / `pendingLiveRuns` (1565) | Header comment literally assumes "one prompt at a time" (now false). A live + real run overlap → real run mis-tagged silent → **its result + generation record suppressed**. | MED |
| C5 | `tabNodeProgress` global (2235) drives `validatedRun` | B's `execution_start` resets it mid-A → A reads `completed:0` → A treated as silent-failure, result dropped. | MED |
| C6 | attribution by static `activeWorker` not the run's real `res.worker` (default.vue:1841) | The worker a run spilled to ≠ the tab's round-robin slot; gate compares unrelated quantities. | MED |

### TIER 2 — ROBUSTNESS

| # | Issue | Sev |
|---|-------|-----|
| R1 | No lock around `runVueWorkflow`; seeds are safe (sync snapshot) but `applyDraftOverrides`/`applyPendingPromotes` read live state *after* awaits → overlapping runs cross-consume draft/promote marks. Wrap assemble→dispatch in `withKeyedLock` (pattern exists). | MED-HIGH |
| R2 | Cold-boot spill: `queueSmart` awaits `/api/pool/ensure` up to ~30s before the POST; `registerRun`+watchdog only arm *after*. A wedged boot hangs the run with no feedback and no stall watchdog. Register provisional + watchdog + client timeout before the ensure probe. | MED |
| R3 | Cost-confirm `costConfirm.value` single slot (2336): two independent threshold-crossing Runs → first's confirm promise dropped, that run hangs (safe, not an unconfirmed spend). Make it a FIFO queue. | MED |

### TIER 3 — COSMETIC (self-heals; fix by pointing display at the active tab's per-prompt entry)

`executionStartTime` (wrong duration), `currentRunProgressPct` (progress bar fight), `currentRunningNode` (label flicker), `lastRunResult` (single card), running-canvas dot. All already have correct per-prompt twins (`promptProgress`, `promptNodeInfo`, `runningNodeByPrompt`) — the display just reads the global instead.

### Genuinely safe (audited, no change)
Node-result placement core (keys off `event.data.node_id`, VueNodeCanvas:2499); `materializeAutoImageSinks` (synchronous + `alreadyWired` guard); pool socket drain under mixed singles+takes (`pendingPosts` reservation composes); `activeRunNodeIds` (union set, self-heals); `runRegistry`/`promptProgress`/`promptNodeInfo`/`directRunWatchdogs`/`runningNodeByPrompt` (already prompt-keyed).

## The structural fix (kills Tiers 0–1 at once)

1. **Enrich `RunEntry`** (already carries `promptId`, `tabId`, `worker`, `live`, `startedAt`) with: `canvasId`, `startCredits`, `executedNodeIds: Set`, `outputs: GenOutput[]`, `nodeProgress: {completed,total}`, `pendingGenRecord`.
2. **Route every event handler by `event.data.prompt_id` → registry entry** — in BOTH default.vue (cost/lifecycle) and VueNodeCanvas (result placement). Delete the global accumulators and the `eventWorker`/`activeWorker` gate; gate placement on `entry.canvasId === displayedCanvasId` (buffer otherwise).
3. **Reserve the in-flight slot synchronously at routing time** (queueSmart/queue register as `queued` *before* the POST, or a reservation counter read by `inFlight`) — fixes C2.
4. **Lock the assembly path** (`withKeyedLock` around runVueWorkflow) — fixes R1.
5. **Register + watchdog + client timeout before the ensure probe** — fixes R2.
6. **Bridge-path fallback:** non-direct runs don't register; the per-run map must fall back to a synthetic key (`local_${prompt_id||ts}`) so single bridge runs keep working.

## Recommended sequencing (SDD epic)

- **Phase 1 — registry as source of truth:** enrich RunEntry + a `perRun` accessor; no behavior change yet (pure scaffolding + tests).
- **Phase 2 — billing (Tier 0):** move executedNodeIds/outputs/credits/deadline onto the entry; golden tests with 2 overlapping runs asserting each records its own cost. *Highest stakes — do under test.*
- **Phase 3 — result attribution (Tier 1 C1/C3/C6):** replace eventWorker/activeWorker gate with prompt_id→entry routing + canvasId gating in VueNodeCanvas.
- **Phase 4 — spill correctness (C2) + assembly lock (R1) + cold-boot (R2).**
- **Phase 5 — lifecycle/silent/progress (C4/C5 + Tier 3):** point displays at the active run's entry.
- Each phase live-verified with two concurrent runs before the next.

Until this lands, **direct-execution + pool is correct for a single run but mis-bills and mis-attributes under real concurrency** — the flag is default-OFF, so no shipped user is exposed, but our own dogfooding is.
