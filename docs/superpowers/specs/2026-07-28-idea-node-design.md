# The Idea node — design

**Date:** 2026-07-28
**Status:** Design for review — not yet planned
**Framing:** A prompt becomes a first-class object on the canvas, and commits to a medium. This is the Explore axis from [VISION.md](../../VISION.md) made concrete — the only node whose identity is *not yet a material*.

## The idea in one line

An **Idea** holds a prompt and develops into a medium — image, video or sketch — and the generator it spawns reads that prompt live, so editing the Idea changes what gets made.

## Why this

A prompt today is trapped inside whichever node you typed it into. It is invisible from the canvas, uneditable without opening the node, and it dies with that node. Switching from image to video means retyping it somewhere else and losing the lineage.

Nothing on the canvas can hold a thought that has not become anything yet. The prompt bar is a *command* — you type, something happens immediately, by design. There is no object for "I have an idea and haven't decided what it is."

The Idea node is that object. Its value concentrates in two places:

1. **The idea outlives the generator.** Change medium, keep the thought.
2. **Several attempts share one source.** One prompt, three LoRAs; edit once, re-run all three, no drift between them. This is the diversity-of-directions finding in VISION.md made operational.

The second is why the live wire pays for itself. A single Idea feeding a single generator would be two nodes doing one node's job.

## What this is not

**Not a replacement for the prompt bar.** Typing there still fast-paths straight to a sketch, untouched — `looksLikeImageIdea` fires before the LLM classifier specifically so sketches feel instant ([CanvasPromptBar.vue:161](../../../frontend/app/components/agent/CanvasPromptBar.vue), [sketchIntent.ts:16](../../../frontend/app/lib/sketch/sketchIntent.ts)). An Idea is placed deliberately, for the case the prompt bar does not serve.

**Not a fan-out feature in v1.** One develop action, one child. But single-child must not leak into the data model or the language — see *The fan-out constraint*.

## Mediums: image, video, sketch

3D is deliberately excluded. `Generate3DNode` ([nodes_replicate.py:4816](../../../comfy_api_nodes/nodes_replicate.py)) takes an `IMAGE` input and has no prompt at all — Sailor has no text-to-3D. "Develop into 3D" would really be "develop into an image, then convert," which is a two-hop chain wearing a one-step label. Every menu entry should be a genuine single transform.

That exclusion is worth reading as a signal rather than a gap: check the shape of any future medium before the menu promises it.

## Data model — a new backend `Idea` node

About fifteen lines of Python modelled on `Text` ([nodes_text.py:168](../../../comfy_extras/nodes_text.py)): one multiline `text` widget, one `STRING` output. **No input port** — an Idea is a source, and a `source` input like `Text` carries would invite a use case nobody asked for.

Backend presence is required, not optional: the live wire is a real `STRING` edge, and only a schema-backed node gets ports. A frontend-only node like `SketchPile` gets none ([SketchPileNode.vue](../../../frontend/app/components/vue-canvas/SketchPileNode.vue) renders no handles at all).

**Kept separate from `Text` rather than reusing it.** `Text` carries a multi-entry iterator (`textEntries`, `activeEntryIndex`, `sailor:runTextIterator`) and is wired into SmartLayout and `readWiredText`, which hardcodes `nodeType === 'Text'` ([wiredProps.ts:22](../../../frontend/app/lib/collection/wiredProps.ts)). Overloading it would tangle two purposes. A distinct type costs almost nothing and keeps both honest.

Frontend registration follows the existing artifact convention: an `ARTIFACT_NODE_COMPONENTS` entry ([useVueNodes.ts:162](../../../frontend/app/composables/useVueNodes.ts)) plus a `markRaw` entry in the hoisted `nodeTypes` map ([VueNodeCanvas.vue:245](../../../frontend/app/components/vue-canvas/VueNodeCanvas.vue)).

## The live wire — `prompt_in` on the generators

`GenerateImageNode` and `GenerateVideoNode` each gain one new optional `STRING` input with `force_input=True`. That is the entire backend change.

The frontend needs nothing. `createNodeData` filters scalar types out of `data.inputs` *unless* `cfg.forceInput` ([VueNodeCanvas.vue:1536](../../../frontend/app/components/vue-canvas/VueNodeCanvas.vue)), so the port appears on its own. `grep force_input=True comfy_api_nodes/nodes_replicate.py` currently returns nothing — no Replicate generator exposes a wirable prompt today, which is why this cannot be built without touching the backend.

**When `prompt_in` is connected and non-empty it wins, and the generator's own prompt field goes read-only.** Not a silent precedence rule — the field visibly defers to the Idea, so there is never a question about which text is in play. `Text` does the opposite (widget beats upstream when non-empty, [nodes_text.py:209](../../../comfy_extras/nodes_text.py)) and that invisible rule is exactly what to avoid here.

The one qualifier: **connected but empty falls back to the widget's existing text.** Wiring an Idea you have not written yet should not silently blank a generator that already had a working prompt. The field stays read-only in that state — it is showing what will run, which is still true.

## The node

| Part | Behaviour |
|---|---|
| Body | A multiline text area. The prompt is the content, not a property behind a panel. |
| Output | One `STRING` port. |
| Develop control | A "Develop…" menu matching the artifact cards' idiom ([ArtifactImageNode.vue:1117](../../../frontend/app/components/vue-canvas/ArtifactImageNode.vue)) rather than a new affordance. Disabled while the text is empty. |
| Collapse tier | `manual`. Never collapses by default — it is the source of truth you keep editing. Collapsible on demand, because a canvas with an Idea and six variants does not need the prompt shouting. |
| Capsule read-out | The existing `{ from: 'text', property: 'text', max: 28 }` rule gives a truncated prompt for free. |

**Entry points, both deliberate:**

- **Add menu** — an entry alongside the existing items ([default.vue:124](../../../frontend/app/layouts/default.vue)).
- **Double-click empty canvas** — creates an Idea at that point with the cursor already in it. The gesture is unbound today; only `@pane-click` is wired ([VueNodeCanvas.vue:7243](../../../frontend/app/components/vue-canvas/VueNodeCanvas.vue)). This is the better of the two: it makes starting a thought as cheap as starting one on paper.

## The develop flow

**Image and video** spawn through `spliceAfterNode(ideaId, nodeType, 'STRING', undefined, { branch: true })`. The `STRING` output meets `prompt_in` and `findCompatiblePortIndex` ([portTypes.ts:47](../../../frontend/app/utils/portTypes.ts)) matches them by type with nothing hardcoded.

`branch: true` matters beyond tidiness. It is the mode that never re-points existing downstream edges ([VueNodeCanvas.vue:1732](../../../frontend/app/components/vue-canvas/VueNodeCanvas.vue)), so it is the one that stays correct the moment an Idea has more than one child.

**Neither auto-runs.** Generators cost money; spawning one should not spend it.

**Sketch** re-reads the Idea's current text and runs the existing `startSketch` flow ([VueNodeCanvas.vue:3461](../../../frontend/app/components/vue-canvas/VueNodeCanvas.vue)), placing the pile beside the Idea. It keeps its auto-run, because being instant is the whole point of a sketch.

Sketch is the honest exception to the live wire. `startSketch` builds a *hidden transient* generator and materialises a `SketchPile` — there is nothing persistent to wire to, and the pile has no handles. So there is no edge, the lineage is spatial, and re-sketching always re-reads the current text. The pile is a snapshot of the moment you pressed it rather than a live child, and it never goes stale-but-linked because it never claimed to be linked.

## Change medium lives on the generator, not the Idea

The generator knows it is fed by an Idea, so it offers *"make this a video instead"* — replacing itself, rewiring the prompt from the same Idea, leaving any siblings alone.

This was originally placed on the Idea, and that was right for a single child. It does not survive fan-out: with three generators on one Idea, "change the Idea's medium" has no coherent answer — replace all three, or ask which one, and both are worse than scoping it to the child that owns the decision.

It also reads better. You are changing *this attempt*, not the thought behind it. The Idea keeps one job — adding children; the child owns what it is.

Replacing a generator that already has results asks for confirmation first.

## The fan-out constraint

v1 ships one develop action and one child. **Single-child must not leak into the data model or the language**, because retrofitting it is a rewrite and preventing it is free:

- The Idea stores no reference to "its" generator. Children are derived from outgoing edges, as everything else on this canvas already does.
- Every develop uses `branch: true`, so a second child can never disturb the first.
- Change medium is scoped to one generator, never to "the Idea's medium".

With those three, fan-out later is a UI addition rather than a redesign.

## Out of scope

- **Fan-out UI** — developing the same Idea into several generators at once.
- **3D**, for the reason above.
- **Promote-from-generator** — lifting an existing generator's prompt out into an Idea. Genuinely valuable (it makes the node useful on canvases that already exist, not only new work) but independent, and better judged once the node exists.
- **Idea → Idea chaining.** No input port in v1.
- Any change to the prompt bar's sketch fast path.

## Risks

- **Commitment versus exploration.** You often do not know an idea wants to be a video until you have seen it as an image. Change-medium patches this but destroys the previous result to do it, so the node asks you to commit and then charges you for reconsidering. The confirm dialogue is where this will actually bite; it should name what is being lost.
- **Sketch will always read as the odd entry** — not live, no wire, different output shape. One of three behaving differently is a wart to keep explaining.
- **`prompt_in` is a backend change to shipped generator nodes.** Saved graphs must keep working: the input is optional, and with nothing wired the existing `prompt` widget behaves exactly as it does today.
- **The read-only prompt field needs to be obvious**, or a user will type into it, see nothing change, and lose trust in the wire.

## Testing

**Unit** — the Idea's develop targets resolve to the right node type per medium; `branch: true` is passed on every path; an empty Idea yields no develop action.

**Unit** — `prompt_in` precedence: wired and non-empty wins over the widget; wired and empty falls back to the widget; unwired behaves exactly as today (this is the saved-graph guarantee).

**E2E** — create an Idea by double-clicking the pane; type; develop into an image and assert a generator appears wired `STRING`→`prompt_in`; edit the Idea and assert the generator's effective prompt follows; change medium and assert the image generator is replaced by a video generator still wired to the same Idea; develop a sketch and assert a pile appears with no edge.

**E2E** — the fan-out guarantee, even though no UI exposes it: wire a second generator to the same Idea by hand and assert developing or changing one leaves the other untouched.

## Open questions for review

1. Does an Idea show which mediums it has already been developed into, or is the graph the only record?
2. Should the double-click gesture also work on an occupied area of canvas, or only genuinely empty space?
3. When a generator's prompt field is read-only, is there an affordance to detach from the Idea and go back to typing locally?
