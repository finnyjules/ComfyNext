# Parallel dispatch — run registry + cloud worker pool

**Date:** 2026-07-08
**Status:** draft for review
**Depends on:** LiteGraph divorce Phases 1–3 (direct execution channel, `docs/superpowers/specs/2026-07-08-litegraph-divorce-design.md`) — parallel dispatch only works in direct mode.
**Why now:** the light table's "deal N takes" gesture is the sketchbook loop's signature move; N sequential cloud waits (~80s for 4) vs concurrent (~20s) is the difference between dealing cards and waiting for a printer. This is the first real payoff of owning the run path.

## Problem

Two layers currently serialize everything:

1. **Client:** `default.vue` tracks a single active run — one watchdog, one status, and direct-channel events attribute to the active tab, not to a specific run. Two concurrent runs execute correctly but the UI narrates them as one blurry run.
2. **Server:** ComfyUI executes its queue one prompt at a time per instance. Fine for local-GPU physics; pure waste for cloud-node graphs (nano-banana, fal, Replicate) where execution is ~95% HTTP waiting.

## Design

### Slice A — prompt_id-keyed run registry (UI correctness, ships alone)

- Replace the single-active-run bookkeeping in `default.vue` with a registry: `Map<prompt_id, RunEntry>` where `RunEntry = { tabId, targetIds, startedAt, watchdogTimer, status, label }`.
- `useDirectExecution.queue()` already returns `prompt_id` — registry entry created on successful queue, removed on `execution_complete`/`execution_error`.
- **Event routing by prompt_id:** extend `mapWsEvent` (`frontend/app/lib/graph/wsEventMap.ts`) to forward `prompt_id` on EVERY event type (additive fields are proven inert for existing consumers — final-review precedent). `handleBridgeEvent` consults the registry first; falls back to today's active-tab attribution for bridge-path events (which lack registry entries).
- **Per-run watchdog:** each entry gets its own timer, cleared by that run's first `execution_start`. Kills the shared-watchdog misfire class.
- Status pill: "N running" already exists in the header — feed it `registry.size` in direct mode.
- **Known accepted quirk:** concurrent runs over the *same* nodes (takes fan-out) will interleave node-glow highlights. Per-node glow stays keyed by node; correctness of *results* (which take lands where) is keyed by prompt_id via the registry. Visual polish deferred.
- Bridge path (flag OFF) behavior unchanged — registry is populated only by direct queues.

### Slice B — cloud worker pool (server-side concurrency)

**Workers.** A Nitro plugin (`frontend/server/plugins/comfy-worker-pool.ts`, following the persistent-training-queue plugin pattern) lazily spawns up to `NUXT_COMFY_POOL_SIZE` (default 2) extra ComfyUI instances from the same repo root: `.venv/bin/python main.py --listen 127.0.0.1 --port <8189+i> --cpu`. Same working directory ⇒ shared `input/`/`output/`/`models/` — uploads made via the main instance are visible to workers, worker outputs are servable by the main instance's `/view`. `--cpu` keeps VRAM at zero; cloud-only graphs never touch CUDA.
- Lazy spawn on first pooled dispatch; health-check via `/system_stats`; reap after 15 min idle. Port-collision probe before spawn.
- `object_info` is fetched ONLY from the main instance (same repo ⇒ identical node defs).

**Routing.** The proxy (`frontend/server/middleware/comfyui-proxy.ts`) and the `/ws` dispatcher (nuxt.config.ts) accept a worker selector — `?comfyWorker=N` query param (stripped before forwarding) mapping to port 8189+N; absent ⇒ main (8188). The client opens one WS per *active* worker (lazily, same clientId), closed when that worker has no in-flight runs.

**Eligibility predicate** (`frontend/app/lib/graph/cloudOnly.ts`, pure): a prompt is pool-eligible iff every `class_type` is in the CLOUD_SAFE allow-list = API/cloud nodes (derivable from object_info: nodes with `price_badge`, plus the `comfy_api_nodes` categories) ∪ CPU-light utilities (Load/Save/Preview image, gates, primitives). Conservative: any unknown or GPU class_type ⇒ main instance. Unit-tested against the golden fixtures.

**Scheduler** (client-side, in `useDirectExecution`): pool-eligible prompts go to the worker with the fewest in-flight runs (registry knows); GPU prompts always to main. Add `queueParallel(prompts: {prompt, workflow, label}[])` that fans out across the pool in one call — the light table's entry point.

### Slice C — "deal N takes" wiring (thin)

The light table / re-roll variation path dispatches N seed-varied prompts via `queueParallel` when direct mode is on and the prompt is pool-eligible; falls back to today's sequential queueing otherwise. No new UI beyond takes arriving as they complete (the registry makes per-take attribution correct).

## Error handling

- Worker spawn/health failure ⇒ scheduler silently falls back to main (serial); one console.warn, never a blocked run.
- Worker dies mid-run ⇒ its WS closes; registry entries for that worker older than the reconnect window surface the existing execution_error path ("worker lost") and clear state.
- Pool disabled entirely when flag OFF or `NUXT_COMFY_POOL_SIZE=0`.

## Testing

- Unit: registry transitions (queue→start→complete/error, per-run watchdog), cloudOnly predicate (golden fixtures + GPU-node cases), scheduler pick logic, mapWsEvent prompt_id forwarding.
- Live: two EmptyImage-ish cloud-safe runs dispatched together → both complete with correct attribution; kill a worker mid-run → error surfaces; GPU workflow routes to main.

## Out of scope

Multi-GPU local parallelism; cross-machine/remote workers (compute-topology spec owns that); per-run glow disambiguation polish; changing the direct-execution flag default; Phase 4 demolition.

## Risks

- ComfyUI boot time (~5–15s) makes first pooled dispatch slow ⇒ lazy-spawn on project open (flag-gated), not on dispatch.
- `--cpu` instances still import torch (~1–2 GB RAM each) ⇒ default pool size 2, reaped when idle.
- Allow-list drift as new cloud nodes ship ⇒ derive from object_info metadata where possible, hand-list only the utility set.
