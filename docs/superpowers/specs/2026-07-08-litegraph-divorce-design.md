# LiteGraph divorce — direct Vue execution path (Phases 1–3)

**Date:** 2026-07-08
**Status:** approved (user: "go for it"), executing overnight
**Strategy context:** appendix of `docs/strategy/2026-07-08-premise-wargame.md`
**Scope:** Phases 1–3 only. Phase 4 (demolition: delete bridge/iframe/fallback) is explicitly OUT — gated on the parity harness staying quiet through real dogfooding.

## Problem

With VueNodes on (default), the hidden ComfyUI iframe exists for four jobs: `graphToPrompt()` serialization, `queuePrompt()` dispatch, WebSocket progress relay, and the VueNodes=false fallback. Every run pays a loadWorkflow-into-iframe round-trip before queueing. The sketchbook loop is about to multiply run frequency; the iframe is a latency tax and a fragile dependency on ComfyUI frontend internals (upstream is churning: Nodes 2.0).

## Goal

Frontend builds the API prompt itself, queues directly, and listens to the execution WebSocket directly. The iframe path remains intact and becomes a **shadow verifier**: in dev, every run builds the prompt both ways and diffs them. Runtime behavior is switchable so any divergence can fall back instantly.

## Spike results (Phase 0)

- **gate_paused**: emitted SERVER-side (`execution.py:612`, `comfy_extras/nodes_gate.py`) over the WS. Bridge is a pure relay. Direct WS receives it natively. Gate nodes serialize like any node. **No blocker.**
- **Vue Flow perf on 300-node graphs**: deferred — only gates Phase 4 demolition, out of scope tonight.

## Design

### 1. `frontend/app/lib/graph/graphToPrompt.ts` (Phase 1)

Pure function: `(nodes, edges, objectInfo, options) → { prompt, workflow }` where `prompt` is ComfyUI API format `{ [nodeId]: { class_type, inputs } }`.

Responsibilities (matching LiteGraph `graphToPrompt` semantics):
- **Widget mapping**: positional `widgets_values` → named inputs using object_info input ordering (required then optional), skipping connection-only inputs; handle `control_after_generate` companion slots (seed widgets carry an extra positional value that must be skipped, and seed mutation semantics preserved).
- **Link resolution**: edges → `[upstreamNodeId, outputSlot]` input values.
- **Mute (mode 2)**: node dropped; downstream inputs fed by it become unconnected (dropped input entry).
- **Bypass (mode 4)**: node dropped; inputs pass through to consumers by matching type (first input of matching type routes to the corresponding output's consumers), chained bypasses resolved transitively.
- **Subgraph flattening**: inline `definitions.subgraphs` instances — remap interior node ids to unique ids, rewire boundary inputs/outputs through the instance's edges. (Recursive; cycle-guard.)
- **Frontend-only nodes**: reuse existing `stripFrontendOnlyNodes()` / `buildFilteredWorkflow()` conventions — builder operates on the already-filtered workflow, same as the bridge path receives today.
- Deterministic output (stable key order) so diffs are meaningful.

Existing code to reuse, not duplicate: `useVueNodes.ts` `convertToLiteGraph()` produces the LiteGraph-format workflow — the builder takes THAT as input (LiteGraph JSON in → API prompt out). This keeps one canonical intermediate format and lets golden tests feed saved ProjectDoc workflows directly.

### 2. Shadow parity harness (Phase 2)

Dev-only composable `useShadowParity()`: on each run, after the existing iframe path produces its prompt (`getPrompt` → `prompt_data` bridge event, already exists), build the same prompt via the TS builder and deep-diff (ignoring benign key-order / null-vs-absent). Divergences: `console.warn` with a structured diff + accumulate in a ring buffer readable from a dev panel/route. Never blocks or alters the run.

### 3. Direct execution channel (Phase 3)

- `useDirectExecution()` composable: owns a `client_id` (uuid, sessionStorage), opens `WS /ws?clientId=` via the existing Nuxt proxy (`comfyui-proxy.ts` — add `/ws` + `/prompt` to allow-list if absent), maps WS events (`status`, `executing`, `progress`, `executed`, `execution_error`, `execution_cached`, `gate_paused`) to the SAME event shapes `default.vue` already consumes from the bridge (`onBridgeMessage` contract), so downstream handling is unchanged.
- Queue: POST `/prompt` `{ prompt, client_id, extra_data: { extra_pnginfo: { workflow } } }`; surface HTTP 400 `node_errors` through the existing error path (red-ring + toast).
- **Runtime switch**: `sailor:Comfy.DirectExecution.Enabled` localStorage flag (Settings toggle, default OFF tonight). OFF = today's iframe path. ON = direct path, with shadow parity comparing against the iframe in dev. Flip to default ON only after harness soak.

### Error handling

- Builder throws typed errors (unknown class_type, missing object_info) → run aborts with visible toast BEFORE dispatch, never a silent bad prompt.
- WS disconnect → reuse `useBackendHealth` reconnect pill conventions; re-open WS with same client_id.

### Testing

- **Golden workflows**: unit tests feeding real saved workflows (LiteGraph JSON fixtures harvested from the repo's default/demo ProjectDocs + hand-built cases: mute, bypass chain, subgraph, seed control, converted widget-input) → snapshot API prompts.
- **Parity in dev** = the integration test: harness diff must be empty across dogfooding.
- Existing `npm run test:unit` conventions (vitest).

## Out of scope

Phase 4 demolition (bridge deletion, VueNodes=false removal, iframe unmount); Vue Flow perf work; image-upload node flows if they prove independent of the run path (verify during implementation, note findings).
