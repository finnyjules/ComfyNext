# Named image references (`@refs`) — design

**Date:** 2026-07-06
**Status:** design, pending review
**Scope:** frontend-only primitive + a multimodal prompt node

## Motivation

The trigger for this work was wanting to build **spec/concept ad campaigns** around real
athletes (the "Stop him? Just pray." Nike-style images): cast a likeness, dress them in a
specific outfit, stage and light it like a photoshoot, keep it all cohesive across a set of
shots. The differentiating quality of those campaigns is **cohesiveness** — the same face,
the same outfit, the same light across every frame.

We deliberately **did not** build a `Campaign`/`Bible` object for this. A new top-level
concept is exactly the kind of complexity this app has avoided elsewhere. Instead we found
that cohesiveness is really a **reuse** problem: if every shot references *the same image*
for talent, wardrobe, light, and backdrop, cohesiveness is the default rather than something
policed per shot. The canvas already is the campaign; what's missing is a clean way to name
an image once and reuse it everywhere.

### Why the current pipeline can't do this yet

Two pipelines were traced end-to-end (see "Grounding" below):

- **Character (identity)** — reference photos → Ideogram training set → Flux LoRA on
  Replicate → inference injects a trigger word. Identity is solid, and *deliberately
  wardrobe-blind*: the training set is spread across outfits so the LoRA binds identity to
  the trigger, not to a look (`character-shot-scenes.ts`), and character LoRAs get **no**
  aesthetic injected at generation time (`loraPrompt.ts` `promptAesthetic`). Correct for
  identity; means wardrobe is not its job.
- **Re-dress (clothing)** — a family of Google Nano-Banana-2 nodes (Person Swap, Pose
  Mannequin, Swap Product, Swap Background), each a baked instruction string. There is **no
  "dress this person in this outfit" node**; wardrobe is always a byproduct. Critically,
  clothing is **text-conditioned, never reference-conditioned**: re-posing tells the model
  "keep clothing identical" but wires **no outfit image** to match against
  (`_pose_prompts.py`), so the garment is re-hallucinated every call and drifts across shots
  (logo shifts, colour warms, seams change).

**The single biggest weakness: the outfit is not pinned; it is re-hallucinated per pose.**
The fix is not a new subsystem — it is the ability to pin *any* image under a name and feed
that exact image back into the model.

## The primitive: named image references (`@refs`)

A **named image reference** is a handle (`@tracksuit`, `@doué`, `@grey-cyc`) that points at a
single image. Name an image once; reuse it anywhere on the canvas, and across canvases
(shots). The `@` symbol does double duty — the affordance that **creates** a reference and
the token you type to **consume** one are the same symbol.

This is intentionally *not* a new data system. It rides three systems the app already ships:

- **Assets** — persistent, cross-canvas image store (`Asset { id, path, kind, name }`,
  `/comfynext/assets`). Holds the pixels and survives reloads.
- **Variables binding machinery** — the pink `--var-accent` "this input is bound" affordance,
  the `promoteControl` one-click promote idiom, and client-side resolution at submit.
- **A flat registry** — a `name → assetId` map, **project-scoped** so a reference is reusable
  across every canvas (shot) in the project. Deliberately **not** the row/column Collections
  model; a single reference is a scalar handle, not a table row.

### Creation — the hover `@` button

Every media element on the canvas (image node output, pasted image, generation result) shows
an **`@` button on hover**. Click it → give the image a handle → it is promoted to a named
reference: registered in the `name → assetId` map and ensured-saved as an Asset for
persistence.

This is the media-shaped sibling of the existing "promote to variable" glyph on inputs. It is
ambient (available on *every* media, always), optional (skip it and the image is just an
image), and discoverable (visible where the eye already is) — no birth-moment ceremony, no
panel as the front door. A References panel still exists as a backstop for renaming, finding,
and promoting something not named at the time; it is not the primary entry point.

The `@` button carries a small thumbnail wherever a reference is shown, so a handle reads at a
glance without hunting for the original.

### Reuse — two skins of one mechanism

Both resolve `@name → image` by the same client-side path; you pick whichever keeps a given
spot on the canvas readable.

1. **Bind-by-name (zero nodes).** Any image input can be bound to `@name` — shows pink, no
   wire, resolves at submit. `@`-autocomplete lists existing references.
2. **Reference node (visible local proxy).** A tiny "shorthand" node you drop *next to the
   consumer*, set to `@tracksuit`, and wire in with a short local hop. This is the Comfy
   Set/Get / named-reroute pattern: a virtual connection by name instead of a literal cable
   dragged across the graph.

The Reference node is the canvas-simplification workhorse:

- **Off-canvas sources.** Because it resolves by name (not by wire), the original image need
  not be on the current canvas — it is pulled from Assets. A reference genuinely travels,
  including to a different shot's canvas.
- **Rename/replace propagates.** Change what `@tracksuit` points at and every Reference node
  and every bound input updates at once — the whole campaign re-skins in one edit. This is the
  cohesion payoff as an editing superpower.

### Prompts — Mode 1 and Mode 2

`@refs` are usable inside prompts, not only on image inputs. A reference is an image, so a
prompt mention is a **binding**, not pixel-pasting-into-text. It resolves two ways.

**Mode 1 — text substitution (in first scope).** `@name` in any prompt swaps in the
reference's **text handle**: its descriptor, or for a character-linked reference, its LoRA
**trigger word**. `@doué` → the trigger token; `@tracksuit` → "black Nike tracksuit". Pure
client-side string resolution on the existing submit path — a natural extension of what
`buildLoraPrompt()` already does when it injects a trigger. Requires references to carry a
scrap of text metadata (character refs already have `descriptor`/`trigger`).

**Mode 2 — multimodal `@`-prompt node (core; its own build phase).** Modelled on Krea's
Nano-Banana editor: a dedicated node whose prompt field accepts `@`-mentions rendered as
**chips**. At submit each chip resolves to an **attached reference image** on the Nano-Banana
call, and the mention text is rewritten to a positional anchor ("the garment in image 2").
Written naturally: *"put @doué in @tracksuit, shot like @grey-cyc"* → three reference images
wired + composed instruction.

Mode 2 has a **home** rather than being retrofitted across every node. The complexity of
per-node "does this accept reference images, how many?" only bites if *every* node must parse
image-mentions. A dedicated multimodal node is multimodal by construction, so the work
collapses to what the swap family already does: parse chips → resolve to filenames → pass as
the image-inputs array to Nano-Banana-2 → send the text. The existing Person Swap / Pose /
Swap Product nodes already pass multiple images to Nano-Banana-2; this is the same call shape
with a **prompt-authored** set of references instead of fixed slots.

Bonus: this node is the general form of the swap family (*"put @doué in @tracksuit"* subsumes
"dress a person", "swap product", etc.). It does **not** replace the shipped swap nodes — they
stay — but it removes the pressure to keep minting a new swap node per use case, and it is
where the deferred "Wear this" idea lives as a single sentence.

### Resolution

All resolution is **client-side at submit**, reusing the existing path:

- On image inputs / Reference nodes: `@name` resolves to the Asset filename and bakes into the
  node input.
- Mode 1: `@name` in a prompt string is replaced with the ref's text handle.
- Mode 2: chips resolve to attached image inputs + rewritten anchors on the Nano-Banana call.

Frontend-only references are stripped before the graph reaches ComfyUI (the same way
`stripVarsLinks()` removes VARS edges today). **ComfyUI sees a normal graph; no backend node
work is required for the primitive.**

## Architecture (grounded in existing code)

| Concern | Existing system | File(s) |
| --- | --- | --- |
| Image is a valid bindable type | `VariableType` already includes `'image'` (used by `brand.logo`, `image_layer_*`) | `frontend/app/lib/collection/types.ts`, `frontend/app/lib/collection/bindables.ts` |
| Binding data model + pink affordance | `VarBinding`, `BINDINGS_PROP`, `promoteControl`/`unbind` | `frontend/app/lib/collection/types.ts`, `frontend/app/composables/useStudioVarBindings.ts` |
| Client-side resolution at submit | `resolveBindings()`, `stripVarsLinks()` | `frontend/app/lib/collection/resolve.ts`, `useFilteredPrompt.ts` |
| Persistent, cross-canvas image store | Assets (`Asset`, `/comfynext/assets`, `assetUrl`) | `frontend/app/composables/useAssetLibrary.ts`, `frontend/shared/timeline/types.ts` |
| Paste birth hook | `handlePaste()` uploads to input dir, spawns `Image` node | `frontend/app/components/vue-canvas/VueNodeCanvas.vue` |
| Generation birth hook | output images populate `node.data.images[]` | `frontend/app/components/vue-canvas/ArtifactImageNode.vue` |
| Mode 2 model + call shape | Nano-Banana-2 multi-image edit nodes | `comfy_extras/nodes_person_swap.py`, `_pose_prompts.py`, `nodes_swap_product.py` |
| Mode 1 trigger injection precedent | `buildLoraPrompt()`, `promptAesthetic()` | `frontend/server/utils/loraPrompt.ts` |

New pieces to build:

- A `name → assetId` **reference registry** (persisted with the workflow/project; scalar, not
  Collections).
- The hover **`@` button** on media + naming flow, and a **References panel** backstop.
- The **Reference node** (shorthand proxy) with thumbnail, resolving by name.
- **Bind-by-name** on image inputs (extending the existing binding UI to accept a bare
  `@name` against the registry rather than a `collectionId/columnKey`).
- **Mode 1** prompt substitution (string pass at resolve time).
- **Mode 2** multimodal `@`-prompt node: chip editor + resolve chips → attached image array +
  anchor rewrite.

## Scope

**First slice (small, frontend-only):**
- The `@refs` registry + Assets-backed persistence.
- Hover `@` creation + References panel backstop.
- Reuse both skins: bind-by-name and the Reference node.
- `@`-autocomplete.
- **Mode 1** prompt text substitution.

**Its own phase (core, larger build):**
- **Mode 2** — the multimodal `@`-prompt node (chip editor, image-array wiring, anchor
  rewrite). This is where the real re-dress cohesion win lands, and it absorbs the former
  "Wear this" / garment-slot idea.

**Deferred entirely:**
- Cross-**project** reference sharing (references are project-scoped for now — reusable across
  a project's shots, but not shared between separate projects).
- Any change to the shipped swap nodes (they coexist untouched).

## Risks

1. **Persistence of the registry across reload.** "Reuse down the road" is the entire point,
   so references must survive restart. The VARS-edge persistence machinery is real and tested
   (`vars-edge-persistence.unit.spec.ts` round-trips through the full load pipeline; the
   "lost across restart" concern in older notes appears stale), but the **named-reference
   case specifically** must be verified, not assumed.
2. **Two identity engines.** The character LoRA (Flux) and Nano-Banana render faces
   independently; hops between them can shift likeness. `@refs` reduce *wardrobe/background*
   drift but do not by themselves guarantee face consistency across the two engines — worth
   stating so it is not silently expected.
3. **Mode 2 chip editor UX.** Rich-text-with-chips prompt fields are fiddly (caret handling,
   deletion, autocomplete). Contained because Mode 2 is a single dedicated node, but it is the
   riskiest surface.
4. **Garment fidelity across extreme poses.** Even reference-conditioned, Nano-Banana-2 can
   still improvise unseen parts of a garment (e.g. a jacket back on a 90° turn). `@refs` make
   this far better than text-only, not pixel-perfect.

## Non-goals

- No `Campaign`/`Bible` object, no new studio, no new top-level concept.
- No backend custom-node work for the primitive (Mode 2's node is the only new node).
- No replacement of the existing character or swap pipelines.
