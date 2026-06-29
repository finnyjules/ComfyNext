# Phase 3 — Node-canvas agent surface (scope)

*Status: scoped 2026-06-28, NOT yet building. Companion to `agentic-north-star.md`
(P3) and `agent-intent-corpus.md`. Grounded in two read-only code audits of the
live canvas substrate + node-discovery infra.*

## TL;DR

Phase 3 is **far cheaper than the north-star originally assumed.** The earlier
audit said the canvas was the laggard — "no granular bridge mutations
(connect/set-widget/delete), only `addNodeAtCenter`; everything else =
serialize→reload→re-queue." **That is stale.** The app migrated to a **Vue Flow
native canvas** (`VueNodeCanvas.vue` + `useVueNodes.ts`): the graph is plain Vue
refs (`nodes.value` / `edges.value`), and **every mutation an agent needs is
already LIVE and directly callable from Vue.** The iframe bridge is now a
fallback, not the path. No bridge surgery required.

The node-**discovery** infra (the genuinely hard part of "add an upscaler and
wire it correctly") also already exists: `/object_info` catalog, keyword/intent
ranking, type-distance catalog trimming, and port-compatibility matching.

So Phase 3 is **a describe + command-mapping + validation layer over existing
machinery** — the same shape as the five studio surfaces already shipped — plus
two genuinely new pieces: (1) a **plan-then-materialize** proposal lifecycle
(graph mutations aren't pure JSON), and (2) a **home for the agent on the canvas**
(the studios mount in a modal panel; the canvas has none).

## Capability ledger — everything the agent needs is LIVE

| Capability | Live function | File | How the agent reaches it |
|---|---|---|---|
| Add node (with widget overrides) | `useNodeSearch().addNode(type, {widgetOverrides})` → `comfynext:addNode` → `createNodeData` | `useNodeSearch.ts:121`, `VueNodeCanvas.vue:615,1329` | dispatch event |
| Delete node(s) | `deleteNodes(ids)` | `VueNodeCanvas.vue:3481` | call |
| Connect (edge) | `addEdges([edge])` / `onConnect` | `VueNodeCanvas.vue:184` | push validated edge |
| Disconnect (edge) | `deleteEdges(ids)` | `VueNodeCanvas.vue:3485` | call |
| Set widget by name | `setNamedWidget(node, name, value, objectInfo)` | `useFilteredPrompt.ts:678` | call |
| Splice into edge (A→N→B) | `spliceIntoEdge(edgeId, type, overrides?)` | `VueNodeCanvas.vue:715` | call |
| Splice after (transform downstream) | `spliceAfterNode(id, type, outType?, overrides?)` | `VueNodeCanvas.vue:762` | call |
| Move / duplicate / mute / bypass | `position=`, `duplicateNodes`, `setMode/toggleMode` | `VueNodeCanvas.vue:3383,3368,3374` | call |
| Run all / filtered / from-here-downstream | `emitRunAll`, `emitRunFiltered(ids,{direction})` | `VueNodeCanvas.vue:3361,3357,1772` | dispatch event |

**Conclusion:** zero substrate to build. The agent surface translates validated
commands into these calls.

## Discovery infra — also already built (reuse, don't rebuild)

| Need | Reuse | File |
|---|---|---|
| What node types exist + ports/widgets | `fetchObjectInfo()` cache, `getWidgetDefs()` | `useVueNodes.ts:59,94` |
| NL intent → node type (ranked) | `searchNodes`, `scoreNode`, `canonicalNodeForIntent` + `NODE_KEYWORDS`/`NODE_BOOST` | `nodeMatch.ts`, `nodeKeywords.ts` |
| Trim catalog to a relevant slice for the prompt | `buildCatalog(nodeTypes, objectInfo, anchor, {intent})` (hop-0 type matches + hop-1 bridges + intent bucket, capped ~150) | `portIntentCatalog.ts:74` |
| Port-correct wiring | `isTypeCompatible`, `matchingPort`, `anchorCandidates`, `linkInputPorts`, `outputPorts` | `portIntent.ts` |

This is exactly the "describe must cover the renderer's vocabulary" lesson: the
agent can only wire correctly if the snapshot shows it real node types + their
ports + the type-compatibility facts. `buildCatalog` already produces that slice.

## What is genuinely new (the real scope)

1. **Compact graph describe.** Summarize nodes (id, nodeType, title, key widget
   values, ports) + edges, *plus* a `buildCatalog`-trimmed slice of addable node
   types anchored on the current selection/intent. Full catalog won't fit; the
   slice is the whole game.
2. **Port-correct, ID-stable apply.** New nodes get real ids from `createNodeData`
   at materialize time, so the model must emit **placeholder ids** (`$new1`) that
   the composable resolves to real ids as it creates nodes, before wiring. Every
   `connect` is validated with `isTypeCompatible`/`matchingPort`; every
   `setWidget` validated against `objectInfo` widget names. **Validation is the
   trust layer** — a wrong wire silently corrupts a graph.
3. **Plan-then-materialize lifecycle.** Unlike the JSON surfaces (pure
   apply→live-preview→revert), graph mutations are imperative + async (events, id
   assignment, backend defaults). v1 keeps the **surface pure over a
   `CanvasSnapshot`** for *dry-run validation + human-readable plan only*, and the
   **composable materializes accepted ops into real Vue mutations on Keep**
   (resolving `$newN`→real id in order). Dismiss = nothing ever touched the graph.
   This avoids live-mutation churn + id fragility; the "preview" is a validated
   plan list (a reasonable UX for graph edits — like a migration preview).
4. **A canvas home for the agent.** Studios mount the bar in their modal `#controls`
   panel. The canvas is the root view — needs a new mount: a floating command bar
   / palette (⌘K-style) with the same `AgentBar`/`AgentProposal`/`AgentProgress`
   primitives. Smallest new UI in the whole project so far, but net-new.

## Architecture

- `lib/agent/surfaces/canvas.ts` (pure): `CanvasSnapshot = { nodes: NodeLite[];
  edges: EdgeLite[]; catalog: CatalogEntry[] }`; `describeCanvas(snapshot)` →
  `SurfaceSnapshot`; `applyCanvasCommand(snapshot, cmd)` → `CommandResult`
  (dry-run over the snapshot, validates type-compat + widget names + id refs,
  returns predicted snapshot + inverse + summary). **No Vue, no side effects** —
  unit-testable like the others.
- `composables/useCanvasAgent.ts`: owns `getSnapshot()` (from `useVueNodes` +
  `buildCatalog`), runs describe→`/api/agent-plan`→parse→dry-run→plan, and on Keep
  **materializes** via `addNode`/`addEdges`/`setNamedWidget`/`deleteNodes`/…,
  resolving placeholder ids. Reuses `protocol.ts` + `agent-plan.post.ts` unchanged.
- Mount: a canvas command palette component using existing agent UI primitives.

## Command vocabulary (v1)

`addNode` (type + widgetOverrides + optional `$newN` id) · `connect`
(from `$id|node:port` → to) · `setWidget` (node, name, value) · `deleteNode` ·
`deleteEdge` · `spliceAfter` (existing helper) · `setMode` (mute/bypass) · `run`
(filtered, from a node downstream). Deferred: move, duplicate, group, annotations.

## Verify / postconditions (the trust layer)

After dry-run: dangling **required** inputs, type-incompatible wires (should be
impossible if validated, but assert), nodes orphaned from any terminal/output,
graphs with no output node, cycles. Surfaces as warnings in the proposal exactly
like the studio `verify` functions.

## Build slices (value × risk, build in order)

- **Slice 0 — Read-only "explain the graph"** *(S, very low risk).* describe +
  Q&A only ("what does this graph do?", "why is nothing connected to SaveImage?").
  De-risks the describe layer + catalog slice with zero mutation. High trust win.
- **Slice 1 — Single-op edits on EXISTING nodes** *(S–M, low risk).* setWidget,
  mute/bypass, delete. Pure reuse of `setNamedWidget`/`setMode`/`deleteNodes`. No
  id resolution, no node creation. "set the seed to 42 on the sampler", "bypass
  the upscaler".
- **Slice 2 — Add + wire** *(M–L, real value + real risk).* The headline: "add an
  upscaler after this and connect it". Needs node resolution (`buildCatalog`/
  `searchNodes`), port validation (`portIntent`), `$newN` id resolution, and the
  plan-then-materialize lifecycle. **This is the proof milestone for the canvas.**
- **Slice 3 — Multi-node subgraph build** *(L, Compose altitude, Opus).* "build a
  txt2img pipeline with a refiner." Larger plans, layout placement, more verify.
- **Slice 4 — Run-in-the-loop** *(M).* Agent triggers `emitRunFiltered` and reads
  results back to confirm/iterate. Closes the perceive→act→verify loop on canvas.

## Open questions (decide before Slice 2)

1. **Undo integration** — materialized ops should land on the existing canvas
   history (`useCanvasHistory`) so ⌘Z works, vs the agent's own inverse-based
   revert. Likely: one history transaction per Keep.
2. **Proposal UX for a graph** — plan-list (recommended v1) vs ghost nodes drawn
   on canvas (richer, later).
3. **Model tier / cost** — Slice 2+ is Build/Compose altitude (Sonnet→Opus), not
   tune; bigger context (catalog slice) → higher per-call cost. Confirm tier map.
4. **Where the bar lives** — ⌘K palette vs persistent floating bar; how it knows
   the "anchor" (current selection) for `buildCatalog`.

## Recommendation

Build **Slice 0 then Slice 1** first (small, low-risk, immediately useful, and
they harden the describe + validation layers that Slice 2 depends on). Treat
**Slice 2 as the canvas proof milestone** and gate it on the four open questions
above. Slices 3–4 are post-proof. Do **not** start Slice 2 before 0/1 validate the
describe layer in-app with a real graph.
