# Port Intent Popover — AI-assisted node suggestion & pipeline building

**Date:** 2026-06-09
**Status:** Approved design, ready for implementation planning

## Summary

Clicking a node's input/output port (or dropping a wire on empty canvas) opens a small
on-canvas popover with a single text field. Typing instantly filters type-compatible
nodes (free, local fuzzy search). Escalating to "Ask AI" sends the same text as a
natural-language intent to an LLM, which returns one node — or a small validated
pipeline — that gets auto-inserted, auto-wired to the anchor port, and configured.

Two tiers, one input:

- **Tier 0 (free, instant):** type-filtered fuzzy search over the installed node catalog.
- **Tier 1 (AI, user's Anthropic key, Haiku):** intent → 1..N nodes with wiring and
  best-effort widget values.

## Goals

- Make "what node comes next?" answerable at the port, without opening the full
  NodeSearchDialog or knowing node names.
- Let users describe an outcome ("upscale this 4x and sharpen") and get a working,
  wired sub-pipeline.
- Keep the free path primary; AI is a one-keystroke escalation, billed to the user's
  own Anthropic key at Haiku prices (consistent with the Explain feature).

## Non-goals

- Whole-workflow generation from a blank canvas (different feature).
- Replacing NodeSearchDialog — it stays for keyboard-shortcut and edge-splice flows.
- Conversational multi-turn refinement inside the popover (v1 is one shot + retry).

## 1. Interaction layer (Vue canvas)

New component: `frontend/app/components/vue-canvas/PortIntentPopover.vue`, mounted by
`VueNodeCanvas.vue`, positioned in canvas space at the anchor point.

**Triggers — both gestures:**

1. **Stationary click on a port** (`ComfyNodePort.vue` handles). Vue Flow handles also
   begin connection drags, so disambiguate by pointer travel: record `pointerdown`
   position; on `pointerup`, open the popover only if travel ≤ ~4px and no connection
   was started/completed.
2. **Wire dropped on empty canvas**: Vue Flow `onConnectEnd` with no valid target →
   open the popover at the drop position, carrying the source port.

**Anchor context** (kept for the whole popover session):
`{ nodeId, portName, portType, direction: 'input' | 'output', canvasPosition }`.

**Direction semantics:**

- Anchor is an **output** port → candidates are nodes with a type-compatible **input**
  (downstream insertion, laid out to the right).
- Anchor is an **input** port → candidates are nodes with a type-compatible **output**
  (upstream insertion, laid out to the left).
- Wildcard (`*`) or unknown port types → unfiltered candidate list.

**Dismissal:** Escape, click-away, or successful insertion. Popover is exclusive with
NodeSearchDialog.

## 2. Hybrid popover UI

One text input, two engines:

- **Live fuzzy results** as the user types: reuse the `useNodeSearch` index, filtered
  to type-compatible candidates per direction semantics. Arrow keys to navigate,
  Enter inserts the highlighted node and auto-wires it to the anchor. Empty input
  shows the full compatible list grouped by category, in the same order
  NodeSearchDialog uses.
- **"✦ Ask AI" row** pinned at the bottom of the results list (also Cmd+Enter from
  anywhere). Selecting it sends the current text as the intent. While waiting, the row
  shows a spinner. On success the result is inserted directly (no confirmation step —
  undo is one step) and the model's one-line `note` is shown briefly near the inserted
  nodes.
- Errors (validation failure after retry, network, missing API key) render inline in
  the popover; fuzzy results remain usable throughout. Missing API key links to the
  existing settings field (`ComfyNext.AI.AnthropicApiKey`).

## 3. AI endpoint

`frontend/server/api/pipeline-suggest.post.ts` — sibling of `explain.post.ts`:
same pattern (user-provided Anthropic key forwarded from local settings), model
**claude-haiku-4-5** for cost; model id kept in one constant for easy upgrades.

**Request payload (built client-side):**

- `intent`: the user's text.
- `anchor`: node type, port name, port type, direction.
- `catalog`: trimmed node catalog —
  - all nodes directly type-compatible with the anchor;
  - plus nodes within 1–2 type hops (so chains can bridge, e.g. IMAGE→LATENT→IMAGE);
  - each entry: type, display name, description, input/output names+types, widget
    names+types; enum widget options capped (e.g. first 20 + `"+N more"` marker).
- `graphContext`: short generated summary of nodes adjacent/upstream of the anchor
  (reuse the graph-to-markdown formatting approach from `useExplain.ts`, scoped down).

**Response — structured output (tool-forced JSON), 1..N nodes:**

```json
{
  "nodes": [
    { "id": "a", "type": "ImageUpscaleWithModel", "widgets": { "upscale_model": "..." } }
  ],
  "edges": [
    { "from": "anchor", "to": "a.image" },
    { "from": "a.IMAGE", "to": "b.image" }
  ],
  "note": "Upscales 4x with a sharp ESRGAN model"
}
```

The system prompt instructs the model to prefer the minimal answer (one node when one
node suffices) and to only use node types present in the supplied catalog.

## 4. Validation, insertion, repair

Validation runs client-side against the full `/object_info` schema (already cached by
`useNodeSearch`):

1. Every `nodes[].type` exists in `object_info`.
2. Every edge connects type-compatible ports; the anchor edge matches the anchor's
   type and direction.
3. Widget values: unknown widget names dropped; enum values must be members of the
   real option list (the capped list sent to the model may omit the chosen value's
   siblings, but the chosen value itself must exist); numeric values clamped to
   min/max. Invalid values fall back to node defaults — widget configuration is
   best-effort by design.

**Repair loop:** on validation failure, one retry with the specific validation errors
appended to the request. Second failure → inline error in the popover.

**Insertion (single undo step):**

- Lay out the chain left-to-right from an output anchor (right-to-left from an input
  anchor) using existing node spacing conventions in `VueNodeCanvas.vue`.
- Wire the anchor port to the chain, create internal edges, select all inserted nodes.
- Follow existing node-creation paths so `data.nodeType` / stack-key conventions stay
  consistent.

## 5. Phasing

- **Phase 1:** popover component, both triggers, type-filtered fuzzy tier, AI
  single-node path end-to-end (endpoint, schema, validation, insertion). The schema
  is 1..N from day one; the prompt nudges toward minimal answers.
- **Phase 2:** multi-node quality — catalog hop-bridging, repair-loop hardening,
  widget-value accuracy, layout polish for longer chains.

## Cost

Tier 0 costs nothing. Tier 1 is one Haiku call with a trimmed catalog (~a few
thousand input tokens, small output) on the user's own key — fractions of a cent per
ask, same trust model as Explain. No server-side key storage.

## Testing

- Unit: catalog trimming (type compatibility, hop bridging, enum capping); response
  validation (bad node type, bad edge, bad enum, numeric clamping); direction
  semantics for candidate filtering.
- Component: popover open/close for both gestures (click-vs-drag disambiguation),
  keyboard navigation, fuzzy filtering.
- Integration (manual protocol, like the compositor-frame test protocol): single-node
  insert from output port; chain insert from drag-to-empty; input-port upstream
  insert; missing-API-key path; validation-failure retry path; undo restores
  pre-insert state in one step.
