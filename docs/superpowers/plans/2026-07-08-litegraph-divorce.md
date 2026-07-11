# LiteGraph Divorce (Phases 1–3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Frontend builds ComfyUI API prompts itself, queues directly, and listens to the execution WebSocket directly — with the existing iframe path kept as a shadow verifier and instant fallback.

**Architecture:** A pure TS prompt builder (`LiteGraphWorkflow` + `object_info` → API prompt) replaces the bridge's `graphToPrompt()`. A dev-only parity harness diffs both builders on every run. A direct execution composable (client_id + WS + POST /prompt) is wired behind a default-OFF settings flag. No demolition: bridge/iframe stay intact.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, vitest (`npm run test:unit` in `frontend/`), existing Nuxt proxy (`server/middleware/comfyui-proxy.ts`) + WS upgrade hook in `nuxt.config.ts`.

**Spec:** `docs/superpowers/specs/2026-07-08-litegraph-divorce-design.md`

## Global Constraints

- Work directly on `main`; NO feature branches. Stage with explicit paths and commit with pathspec (`git commit -m "..." -- <paths>`) — a concurrent session may stage files between your commands.
- All new pure logic lives in `frontend/app/lib/graph/`; composables in `frontend/app/composables/`.
- Tests: `frontend/tests/unit/*.unit.spec.ts`, run with `cd frontend && npm run test:unit -- <file>`; aliases `~` → `frontend/app`, `~~` → `frontend/`.
- Phase 4 demolition is FORBIDDEN in this plan: do not delete/modify bridge.js behavior, do not remove the iframe, do not touch the VueNodes fallback.
- Keep edits to `frontend/app/layouts/default.vue` surgical — another session also edits this file.
- LiteGraph workflow shape (input to builder) is what `convertToLiteGraph()` produces (`useVueNodes.ts:497`): nodes `{ id: number, type, pos, size, title?, inputs?, outputs?, widgets_values?, properties?, mode?, color?, bgcolor? }`, links `[linkId, originId, originSlot, targetId, targetSlot, type]`, optional `definitions.subgraphs`.
- `object_info` shape: `{ [classType]: { input: { required?: Record<string, Spec>, optional?: Record<string, Spec> }, output_node?: boolean } }` where `Spec = [typeOrComboArray, opts?]`.
- API prompt shape: `{ [nodeIdString]: { class_type: string, inputs: Record<string, scalar | [upstreamIdString, outputSlotNumber]> } }`.
- Node modes: 0 = normal, 2 = mute (NEVER), 4 = bypass.

---

### Task 1: Widget-order derivation (`widgetOrder.ts`)

**Files:**
- Create: `frontend/app/lib/graph/widgetOrder.ts`
- Test: `frontend/tests/unit/widget-order.unit.spec.ts`

**Interfaces:**
- Produces: `isWidgetInput(spec: any[]): boolean`; `widgetSlots(classType: string, objectInfo: Record<string, any>): WidgetSlot[]` where `WidgetSlot = { name: string, control?: true }` — the ordered names of inputs that consume `widgets_values` positions, with an extra `{ name: '<name>__control', control: true }` slot inserted after any input whose opts include `control_after_generate: true` (ComfyUI seed widgets serialize an extra positional value).

Rules (mirror LiteGraph/ComfyUI):
- Iterate `input.required` then `input.optional` in object-key insertion order.
- An input is a WIDGET input if its spec's first element is an Array (combo) OR one of `'INT' | 'FLOAT' | 'STRING' | 'BOOLEAN'` OR opts contain a `widget` hint (`spec[1]?.widget`) — EXCEPT when opts contain `forceInput: true` (connection-only, no widgets_values position).
- Everything else (e.g. `'IMAGE'`, `'MODEL'`, `'CONDITIONING'`) is a connection input: no widgets_values position.

- [ ] **Step 1: Write failing tests** — cases: (a) KSampler-like def (`seed` INT with `control_after_generate: true`, `steps` INT, `cfg` FLOAT, `sampler_name` combo, `model`/`positive` connections) → `['seed', 'seed__control', 'steps', 'cfg', 'sampler_name']`; (b) `forceInput: true` INT excluded; (c) optional after required; (d) unknown classType → throws `UnknownNodeTypeError`.
- [ ] **Step 2: Run to verify FAIL** (`npm run test:unit -- widget-order`)
- [ ] **Step 3: Implement** (also export `class UnknownNodeTypeError extends Error { constructor(public classType: string) { super(\`Unknown node type: \${classType}\`) } }`)
- [ ] **Step 4: Run to verify PASS**
- [ ] **Step 5: Commit** `git commit -m "feat(graph): widget-order derivation from object_info" -- frontend/app/lib/graph/widgetOrder.ts frontend/tests/unit/widget-order.unit.spec.ts`

### Task 2: Core prompt builder — linear graphs (`graphToPrompt.ts`)

**Files:**
- Create: `frontend/app/lib/graph/graphToPrompt.ts`
- Test: `frontend/tests/unit/graph-to-prompt.unit.spec.ts`

**Interfaces:**
- Consumes: `widgetSlots`, `UnknownNodeTypeError` from `~/lib/graph/widgetOrder`.
- Produces: `graphToPrompt(workflow: LiteGraphWorkflow, objectInfo: Record<string, any>): ApiPrompt` with types `ApiPrompt = Record<string, ApiNode>`, `ApiNode = { class_type: string, inputs: Record<string, any> }`. Export a local `LiteGraphWorkflow` type import from `~/composables/useVueNodes` if exported there, else re-declare structurally.

Rules:
- Skip UI-only node types: `new Set(['Note', 'MarkdownNote'])`, plus any node whose type is missing from objectInfo AND has no outputs used — otherwise throw `UnknownNodeTypeError`.
- Widget values: zip `widgetSlots(type)` against `widgets_values` positions; skip `__control` slots (consume position, don't emit); emit `inputs[name] = value`.
- Connections: build a link index from `workflow.links`; for each node input entry (`node.inputs[]` has `{ name, type, link }`), if `link != null` resolve to `[String(originId), originSlot]` and OVERRIDE any widget value of the same name (converted widget → connection wins).
- Output keys sorted numerically (stable diffs). Node ids stringified.

- [ ] **Step 1: Failing tests** — hand-built fixture: CheckpointLoader → KSampler → SaveImage chain with widgets_values incl. seed control value `'randomize'`; assert exact prompt object; assert converted-widget override (a `steps` input entry with a link beats positional value); assert Note skipped.
- [ ] **Step 2: Verify FAIL** → **Step 3: Implement** → **Step 4: Verify PASS**
- [ ] **Step 5: Commit** `-- frontend/app/lib/graph/graphToPrompt.ts frontend/tests/unit/graph-to-prompt.unit.spec.ts`

### Task 3: Mute + bypass semantics

**Files:**
- Modify: `frontend/app/lib/graph/graphToPrompt.ts`
- Test: append to `frontend/tests/unit/graph-to-prompt.unit.spec.ts`

**Interfaces:** unchanged public signature; internal `resolveSource(nodeId, slot): [string, number] | null` that walks through bypassed nodes.

Rules (mirror ComfyUI frontend behavior):
- Mode 2 (mute): node excluded from prompt; any downstream input fed by it is OMITTED from that consumer's `inputs` (server treats as missing).
- Mode 4 (bypass): node excluded; each consumed output re-routes to the bypassed node's FIRST INPUT whose declared type matches the output's type (by `node.inputs[].type` vs `node.outputs[].type`); follow chains of bypasses transitively; if no matching input, treat as mute for that consumer. Guard against cycles (visited set).

- [ ] **Step 1: Failing tests** — (a) muted upsteam node → consumer input omitted; (b) single bypass passes IMAGE through; (c) chained double bypass; (d) bypass with no matching input type → omitted; (e) bypass cycle does not hang.
- [ ] **Steps 2–4: FAIL → implement → PASS**
- [ ] **Step 5: Commit** `-- frontend/app/lib/graph/graphToPrompt.ts frontend/tests/unit/graph-to-prompt.unit.spec.ts`

### Task 4: Subgraph flattening

**Files:**
- Create: `frontend/app/lib/graph/flattenSubgraphs.ts`
- Modify: `frontend/app/lib/graph/graphToPrompt.ts` (call flatten first when `workflow.definitions?.subgraphs?.length`)
- Test: `frontend/tests/unit/flatten-subgraphs.unit.spec.ts`

**Interfaces:**
- Produces: `flattenSubgraphs(workflow: LiteGraphWorkflow): LiteGraphWorkflow` — pure; returns a new workflow with every subgraph-instance node (type matches `isSubgraphType` regex `/^[0-9a-f]{8}-[0-9a-f]{4}-/`) replaced by its definition's interior nodes.

Rules:
- READ FIRST: `frontend/app/composables/useVueNodes.ts:226-275` (`subgraphToLiteGraph`) and `:306-472` to learn the exact definition shape (interior `nodes`/`links`, boundary `inputs`/`outputs` arrays) — build the fixture to match it exactly.
- Remap interior node ids to `Number(String(instanceId) + String(innerId).padStart(4,'0'))` style unique numeric ids OR (simpler, allowed) switch flattening output ids to strings `${instanceId}:${innerId}` — prompt keys are strings anyway; if string ids are chosen, do flattening AFTER link resolution inputs are computed OR keep ids numeric-safe. Pick ONE, document it in the file header, and keep prompt output deterministic.
- Boundary wiring: instance input slot i receives outer link → route to interior consumers of definition input i; interior link to definition output j → route to outer consumers of instance output j. Recurse for nested subgraphs with a depth/cycle guard (max 16).

- [ ] **Step 1: Failing tests** — fixture: outer graph (Loader → subgraph-instance → SaveImage), definition (input boundary → interior KSampler-ish node → output boundary); assert flattened prompt equals the equivalent hand-inlined graph's prompt; nested-subgraph case; cycle guard throws.
- [ ] **Steps 2–4: FAIL → implement → PASS**
- [ ] **Step 5: Commit** `-- frontend/app/lib/graph/flattenSubgraphs.ts frontend/app/lib/graph/graphToPrompt.ts frontend/tests/unit/flatten-subgraphs.unit.spec.ts`

### Task 5: Golden fixtures + determinism

**Files:**
- Create: `frontend/tests/unit/__fixtures__/golden/*.json` (3+ composite workflows: txt2img-with-seed-control, mute+bypass mix, subgraph+converted-widget mix) + matching `*.prompt.json` expected outputs
- Test: `frontend/tests/unit/graph-to-prompt-golden.unit.spec.ts`

**Interfaces:** consumes only `graphToPrompt`.

- [ ] **Step 1: Build fixtures** (hand-authored, valid per the shapes above; include `extra`, `groups`, `pos/size` noise fields to prove they're ignored)
- [ ] **Step 2: Golden test** — for each fixture, `expect(graphToPrompt(wf, oi)).toEqual(JSON.parse(read(expected)))`; plus determinism: two calls produce `JSON.stringify`-identical output.
- [ ] **Steps 3–4: PASS** → **Step 5: Commit** `-- frontend/tests/unit/__fixtures__ frontend/tests/unit/graph-to-prompt-golden.unit.spec.ts`

### Task 6: Parity diff (`promptDiff.ts` + `useShadowParity`)

**Files:**
- Create: `frontend/app/lib/graph/promptDiff.ts`; `frontend/app/composables/useShadowParity.ts`
- Test: `frontend/tests/unit/prompt-diff.unit.spec.ts`

**Interfaces:**
- Produces: `diffPrompts(ours: ApiPrompt, theirs: ApiPrompt): PromptDivergence[]` with `PromptDivergence = { nodeId: string, field: string, ours: any, theirs: any }`; benign-equal rules: key order ignored; `null` vs missing → equal; numeric `1` vs `'1'` → NOT equal (real divergence).
- `useShadowParity()` returns `{ record(ours: ApiPrompt, theirs: ApiPrompt, label: string): void, log: Ref<ParityEntry[]> }` — ring buffer (last 50), `console.warn('[shadow-parity]', …)` on any divergence, module-level singleton state (same pattern as `useVueNodesEnabled.ts`).

- [ ] **Step 1: Failing tests** for `diffPrompts` (equal modulo order; null-vs-missing benign; value mismatch reported with nodeId+field; extra/missing node reported)
- [ ] **Steps 2–4: FAIL → implement → PASS** → **Step 5: Commit** `-- frontend/app/lib/graph/promptDiff.ts frontend/app/composables/useShadowParity.ts frontend/tests/unit/prompt-diff.unit.spec.ts`

### Task 7: Direct execution composable (`useDirectExecution.ts`)

**Files:**
- Create: `frontend/app/composables/useDirectExecution.ts`; `frontend/app/lib/graph/wsEventMap.ts`
- Test: `frontend/tests/unit/ws-event-map.unit.spec.ts`

**Interfaces:**
- Produces `mapWsEvent(msg: { type: string, data: any }, myClientId: string): BridgeShapedEvent | null` in `wsEventMap.ts` — pure, maps ComfyUI WS messages to the event object shapes `default.vue` already consumes (from the bridge inventory): `executing → { event: 'executing', node_id }`, `progress → { event: 'progress', percent }` (compute percent from `data.value/data.max*100`), `executed → { event: 'executed', node_id, output }`, `execution_error → { event: 'execution_error', node_id, exception_message, exception_type, traceback }`, `execution_success/execution_complete → { event: 'execution_complete', prompt_id }`, `execution_start → { event: 'execution_start', prompt_id }`, `gate_paused → { event: 'gate_paused', node_id, prompt_id }`, `status → null` (ignored v1); drop messages for other client ids where the payload carries one.
- Produces `useDirectExecution()` returning `{ connect(): void, queue(prompt: ApiPrompt, workflow: LiteGraphWorkflow): Promise<{ prompt_id?: string, node_errors?: any }>, onEvent(cb: (e: BridgeShapedEvent) => void): void, clientId: string }`:
  - clientId: `sessionStorage['sailor:clientId'] ||= crypto.randomUUID()`
  - WS URL: `\`\${location.protocol === 'https:' ? 'wss' : 'ws'}://\${location.host}/ws?clientId=\${clientId}\`` (nuxt.config.ts upgrade hook pipes to ComfyUI). Auto-reconnect with 1s→5s backoff while enabled; re-use same clientId.
  - queue: `$fetch('/prompt', { method: 'POST', body: { prompt, client_id: clientId, extra_data: { extra_pnginfo: { workflow } } } })`; on 400 catch → return `{ node_errors }` extracted from the error response body.

- [ ] **Step 1: Failing tests for `mapWsEvent`** (each mapping above + unknown type → null + foreign clientId dropped)
- [ ] **Steps 2–4: FAIL → implement both files → PASS** → **Step 5: Commit** `-- frontend/app/composables/useDirectExecution.ts frontend/app/lib/graph/wsEventMap.ts frontend/tests/unit/ws-event-map.unit.spec.ts`

### Task 8: Settings flag + run-path wiring in default.vue

**Files:**
- Create: `frontend/app/composables/useDirectExecutionEnabled.ts` (clone the `useVueNodesEnabled.ts` pattern EXACTLY; key `sailor:Comfy.DirectExecution.Enabled`; **default OFF**: `stored === 'true'`)
- Modify: `frontend/app/components/SettingsModal.vue` (add after the VueNodes entry: `{ id: 'Comfy.DirectExecution.Enabled', label: 'Direct execution (beta)', type: 'toggle', description: 'Queue prompts directly from the app, bypassing the bridge iframe', local: true }`)
- Modify: `frontend/app/layouts/default.vue` — surgical, two touch points:
  1. In the run path (`runVueWorkflow`, after the filtered LiteGraph workflow is finalized and would be posted via `loadWorkflow`): branch — if `directExecutionEnabled`: `const prompt = graphToPrompt(filtered, objectInfo); await direct.queue(prompt, filtered)`; surface thrown `UnknownNodeTypeError`/builder errors via the existing toast + abort BEFORE dispatch; else: existing postMessage path unchanged. In dev (`import.meta.dev`), ALSO always compute the builder prompt and, when the bridge is available, request `getPrompt` and `useShadowParity().record(ours, theirs, label)` on the `prompt_data` reply (fire-and-forget; never blocks the run).
  2. Extract the body of the bridge-event switch into `function handleBridgeEvent(data: any)` called from the existing `onBridgeMessage`; register `direct.onEvent(handleBridgeEvent)` so direct-WS events flow through identical handling.
- Test: `frontend/tests/unit/direct-execution-enabled.unit.spec.ts` (default OFF; `'true'` enables — test the pure `directExecutionDefault(stored)` helper)

**Interfaces:** consumes Task 2/6/7 exports.

- [ ] **Step 1: failing test for the default-OFF helper** → **Step 2: FAIL**
- [ ] **Step 3: implement composable + SettingsModal entry + default.vue wiring** (read the surrounding code first; keep diff minimal; `git diff` must touch only the described regions)
- [ ] **Step 4: `npm run test:unit` full suite PASS + `npx nuxi typecheck` (or `npm run typecheck` if defined) clean for touched files**
- [ ] **Step 5: Commit** `-- frontend/app/composables/useDirectExecutionEnabled.ts frontend/app/composables/useShadowParity.ts frontend/app/components/SettingsModal.vue frontend/app/layouts/default.vue frontend/tests/unit/direct-execution-enabled.unit.spec.ts`

### Task 9: Live browser verification (local, free)

**Files:** none created (report only; fixes as needed)

- [ ] **Step 1:** Start ComfyUI (`.venv/bin/python main.py --listen 127.0.0.1 --port 8188`, background) and the Nuxt dev server (preview tools / launch.json `frontend`).
- [ ] **Step 2:** In the app: confirm default behavior unchanged (flag OFF, run a trivial FREE local graph — e.g. solid Image/EmptyImage → preview — via the normal path; check shadow-parity console: expect zero divergences, note any).
- [ ] **Step 3:** Enable `Direct execution (beta)` in Settings; re-run the same graph; verify: POST /prompt 200 with prompt_id, WS progress events drive the node running state, output image appears on the artifact node, no bridge involvement in the network log for the run.
- [ ] **Step 4:** Verify error path: disconnect a required input (or unknown node type) → visible toast, no dispatch.
- [ ] **Step 5:** Screenshot proof + write findings (incl. any parity divergences and their fixes) into the session report; commit any fixes with pathspec.

## Self-review notes

- Spec coverage: builder (T1–5), parity (T6 + T8.1 dev hook), direct channel (T7–8), flag default OFF (T8), golden tests (T5), error handling (T2 UnknownNodeTypeError + T8 toast + T7 node_errors), WS reconnect (T7). Vue Flow perf spike + demolition: explicitly out (spec).
- Deliberate simplifications: `status` WS messages ignored v1 (queue-depth UI still fed by bridge until demolition); image-upload flows untouched (uploads already go through `/upload` proxy, independent of run path — verify in T9 if a Load Image graph is exercised).
