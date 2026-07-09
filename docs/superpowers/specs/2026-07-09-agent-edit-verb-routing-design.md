# Agent edit-verb routing + coverage matrix — design

**Date:** 2026-07-09
**Status:** Approved (brainstorm dialogue)

## Goal

1. Make the three new edit-action nodes (`RemoveObjectNode`, `TextEditNode`,
   `RecolorObjectNode`) agent-plannable: natural phrasings like "remove the
   car", "make the shirt red", "change the text to X" route to them.
2. Produce a **living verb→node coverage matrix** (doc) and a **guard test**
   so a node added to the Actions panel without an agent-visibility decision
   fails CI instead of silently rotting (user decision: "Living doc + guard
   test").

## Approach (decided)

`AGENT_CAPABILITIES` in `frontend/app/lib/agent/capabilities.ts` stays the
single source of truth for agent verb knowledge. No new registry. The doc is
written against it; the guard test derives from it.

## 1. New capability entries

Three `kind: 'effect'` entries in the "Image · editing & transformation"
block, shaped like the existing EditImageNode/BlendSceneNode entries
(`inputs: [{ name: 'image', type: 'IMAGE' }]`, `outputs: IMG`):

- **RemoveObjectNode** — title "Remove an object", summary "Erase a described
  object and fill the hole from the scene (Nano Banana 2)". Intents (moved
  from EditImageNode plus new): 'remove an object', 'remove the person',
  'remove the car', 'remove the object', 'erase the object', 'get rid of the
  object', 'delete the object', 'remove the thing in the background', 'clean
  up the photo', 'erase him from the picture', 'take out the object',
  'photoshop out'.
- **TextEditNode** — title "Edit text in an image", summary "Find and replace
  rendered text, matching the original typography (Nano Banana 2)". Intents:
  'change the text', 'replace the text', 'edit the text in the image', 'make
  it say', 'fix the typo', 'change the sign to say', 'change the words',
  'rewrite the label', 'change the headline text', 'replace the word',
  'update the text on the poster'.
- **RecolorObjectNode** — title "Recolor an object", summary "Change one
  object's colour, keeping material, texture and lighting (Nano Banana 2)".
  Intents: 'change the color of' (moved from EditImageNode), 'recolor the
  object', 'make the shirt red', 'recolour it', 'change the car to blue',
  'make it a different color', 'turn the dress green', 'swap the color',
  'brand color the product', 'colorway'.

## 2. Routing corrections (migrations, not just additions)

- **EditImageNode** loses the intents that moved above (its removal block —
  'remove an object', 'remove the person', 'remove the car', 'remove the
  object', 'erase the object', 'get rid of the object', 'photoshop out' — and
  'change the color of'). It KEEPS the broad/ambiguous edits: 'edit this
  image', 'change her shirt', 'make her hair blue', 'change the background',
  'change the sky', 'make it nighttime', 'add a hat', etc. Its code comment
  about owning removals is replaced by one pointing at RemoveObjectNode.
- **Paraphrase table** (`tests/unit/agent-capability-routing.unit.spec.ts`):
  the existing row `'remove the person from the photo' → EditImageNode`
  becomes `→ RemoveObjectNode`. 'remove the background' rows stay
  RemoveBackgroundNode (both spellings). ~10 new rows lock in the three
  nodes' phrasings, including collision guards: 'remove the background' must
  NOT route to RemoveObjectNode; 'change her shirt' stays EditImageNode;
  'make a text effect' stays TextEffectNode (not TextEditNode); 'restyle'
  stays the restyle family (not recolor).
- No `supersedes` and no boost changes: the standard effect boost (2) matches
  the family; specificity comes from intent phrase matching.

## 3. Coverage matrix doc

`docs/agent/edit-verb-coverage.md` — a table of the common edit verbs
(from the 2026-07-08 tier analysis) with columns: verb / example phrasing /
covering node (or GAP) / agent-visible / interactive surface. Content:

- Tier 1: remove object ✓, remove background ✓, upscale ✓, enhance detail ✓,
  expand-outpaint ✓, restyle ✓.
- Tier 2: relight ✓, reframe-rotate ✓ (RotateCameraNode + LensReframe),
  harmonize composite ✓ node-level (BlendSceneNode; the Frame layer Harmonize
  is modal-only — noted), face fix/restore ✓, text edit ✓ (new), recolor ✓
  (new).
- Tier 3 & gaps: virtual try-on (partial: SwapProductNode/PersonSwap),
  pose/expression change (pose ✓ via PoseMannequin; expression = GAP),
  shadow/reflection generation (GAP; BlendSceneNode partially), material swap
  (GAP), age/hairstyle (GAP, likely off-brand), colorize B&W (GAP),
  perspective correction (GAP).
- A closing "candidates for next slice" list ranked by the tier analysis.
- Header note: agent-visibility column is guaranteed by the guard test; verbs
  are maintained in `capabilities.ts` intents, and this doc is the human map,
  not a parallel registry.

## 4. Guard test

New spec `frontend/tests/unit/agent-coverage-guard.unit.spec.ts`:

- For every `ACTION_CATALOG` entry with `intent: 'edit' | 'enhance'` and
  `source: 'image'` (the agent-relevant image editors), assert the nodeType
  is EITHER in `AGENT_CAPABILITIES` OR in a new exported
  `AGENT_EXCLUDED: Record<nodeType, reason>` list in `capabilities.ts`.
- Failure message tells the developer exactly what to do (add a capability
  entry with intents, or an exclusion with a reason).
- Seed `AGENT_EXCLUDED` with the currently-uncovered catalog nodes and honest
  reasons (e.g. LayerizeGraphicNode / SplitPhotoLayersNode if absent —
  determined at implementation time by running the assertion and triaging
  each failure rather than guessing here).

## 5. Testing

- Extended paraphrase table is the behavioral check (existing harness).
- Guard test as §4.
- One live agent smoke: "remove the traffic cone" on a canvas with an image →
  agent plan places RemoveObjectNode (free to verify the plan; running it is
  paid and user-owned).

## Error handling

No new runtime paths — routing is pure data. A phrase matching nothing falls
through to the existing generic catalog ranking, unchanged.
