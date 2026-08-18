# Elements — ready-made animated text & layout pieces

**Date:** 2026-08-18
**Status:** Approved design, pre-implementation
**Inspiration:** Butter.video's block gallery (Callouts / Stickers / Marquees / Kinetic Text / Carousels)

## Plain summary

An **Element** is a ready-made animated piece — a "SOLD OUT" badge, a speech bubble, a
scrolling marquee, a glowing headline, a product carousel — that a casual user grabs from a
gallery, drops in, and retypes. The magic promise: **retype the text and it still looks
right.** The badge grows around the new words; the scallops don't stretch; the bubble's tail
stays a tail.

Under the hood an Element is a **recipe, not a sticker**: a small function that measures the
current text and redraws its layers from scratch every time something changes. The layers it
produces are completely ordinary Compositor layers, so everything that already works on
layers (animation, export, the agent) keeps working. Next to the layers, Sailor stores the
recipe card ({which element, the text, dial settings, seed}); editing re-runs the recipe.
Power users can **detach** — the recipe is forgotten and the layers become plain, freely
editable Compositor content.

Elements pull their colors from the active brand kit, so unlike Butter's generic presets,
the gallery is *your brand's* callouts on arrival.

## Decisions already made (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Host surface | **Compositor** (Frame node layer stack) | Only surface with shapes + text as sibling layers, groups, per-layer motion (~70 kinetic presets), agent command surface with undo, and the video export path. Vector Type stays the deep single-text instrument — it structurally can't hold a shape+text compound. |
| Instance model | **Materialized parametric + detach** | Compose writes real `LocalLayer`s; recipe stored alongside; recompose on edit; detach = drop recipe, keep layers. Every existing layer consumer works unchanged; catalog churn can never break old artwork (worst case: auto-detach to plain layers). Rejected: virtual "ElementLayer" kind (5+ consumer seams, silent-miss risk), plain bundles with reflow rules (scallops/bubbles stretch badly). |
| Name | **Elements** (user-facing + module name) | "Block" collides with the existing `useBlockLibrary` saved-node-bundle feature and is Butter's word. "Elements" is the Canva-standard casual term. Internal collision with Smart Layout's `TextElementV2`/`ShapeElementV2` is acceptable — those are scoped template types, never user-facing. |
| Entry points | **Both** canvas-level and inside-Compositor, one gallery component | Canvas: pick → new pre-filled Frame node (casual start-from-element path). Compositor: "Elements" tab in add-layer flow (overlay-on-content path, Butter's main use). |
| v1 families | **Badges & callouts, Kinetic text, Marquees, Carousels & showcases** | Counters/social-proof deferred (needs countTween wiring — new machinery). |
| Taste integration | **Palette-only in v1** | Elements take bg/fg/accent from the active brand kit on insert; neutral fallback. Full facet mapping (fonts, shape language) deferred. |
| Authoring | **First-party curated only in v1** | No user-saved or third-party elements yet; that flywheel (Butter's "Creator Blocks") is a later stage. |

## Architecture

### Module: `frontend/app/lib/elements/`

- `types.ts` — the contracts below.
- `catalog.ts` — `ELEMENTS: ElementSpec[]` + `ELEMENT_CATEGORIES`, static TS, staging-style.
- `compose/` — one file per family (badges, kinetic, marquees). Badge outlines call
  `lib/geoshape` generators (circle, pill, scallop, burst, speech bubble) at measured text
  bounds + padding, so outlines are **regenerated, never stretched** (longer text ⇒ more
  scallops at constant scallop size).
- `apply.ts` — insert / recompose / detach, implemented as command batches through
  `applyCompositorCommand` (undo for free, verifier runs).

### Contracts

```ts
interface ElementSpec {
  id: string                        // 'badge-scallop', 'kinetic-glow', 'carousel-ring'
  name: string                      // "Scalloped sticker"
  category: ElementCategory         // 'callouts' | 'stickers' | 'kinetic-text' | 'marquees' | 'carousels'
  blurb: string
  backend: 'layers' | 'node'        // see Two backends
  slots: ElementSlot[]              // { id, label, kind: 'text' | 'image', default, overflow: 'grow' | 'shrink' }
  knobs: KnobSpec[]                 // reuses Smart Layout's KnobSpec shape
  compose?(ctx: ElementComposeCtx): LocalLayer[]  // required when backend === 'layers'
  node?: { nodeType: string; propertyOverrides: Record<string, unknown> }  // required when backend === 'node'
}

interface ElementComposeCtx {
  slots: Record<string, string>
  knobs: Record<string, unknown>
  seed: number
  palette: ElementPalette           // { bg, fg, accent } resolved from brand kit; neutral fallback
  frame: { w: number; h: number }
  measure(text: string, style: TextMeasureStyle): { w: number; h: number }
}

interface ElementInstance {         // stored per group in node property `sailor_elements`
  elementId: string
  slots: Record<string, string>
  knobs: Record<string, unknown>
  seed: number
  version: number                   // for future migrations
}
```

### Invariants

1. **`compose` is pure and deterministic** — same inputs + seed ⇒ identical layers. Reroll =
   seed bump. Previews and snapshot tests fall out of this. No `Math.random`, no `Date.now`.
2. **One ruler:** `measure` is injected and backed by the same canvas measurement
   `layoutTextUnits` (`lib/motion/animatedText.ts`) uses to paint. Measuring and drawing with
   the same code is the entire "retype and it fits" guarantee.
3. **Stable layer keys:** compose assigns deterministic role-based keys
   (`${groupId}:bg`, `${groupId}:text0`) so recompose does not invalidate animation/timeline
   references (list-addressing lesson: stable ids, never positions).
4. **Serialization:** `sailor_elements` must be explicitly added to node persistence —
   `convertToLiteGraph` silently drops unknown `node.data` fields (known trap).
5. **Graceful degradation:** unknown `elementId` at load ⇒ auto-detach. Layers are real, so
   artwork survives catalog churn by construction.

### Editing: three tiers

1. **On the node (casual loop):** click the text on the Frame node preview, retype inline;
   recipe recomposes. Most users never go deeper.
2. **In the Compositor:** the element renders in the layer stack as **one collapsed group row
   with an element badge** ("Scalloped sticker"), not loose layers. Selecting it shows the
   recipe's controls: text slots, knobs, animation picker, palette-role picker, Reroll,
   Detach. Any change re-runs compose.
3. **Detach:** expanding the group or grabbing an inner layer prompts once — "Detach to edit
   layers freely?" Yes ⇒ instance deleted, layers become ordinary. Regular undo applies; no
   special re-attach in v1.

**Guard rail:** while intact, inner layers are hands-off. Every mutation path (drag,
properties panel, agent commands) routes to the recipe controls or the detach prompt. There
is no state where recipe and layers disagree.

### Gallery

One component, two mounts:

- **Canvas-level:** "Elements" entry alongside the studios (studio-options / toolbox). Pick ⇒
  `sailor:addNode` inserts a Frame node pre-filled via `propertyOverrides`
  (`sailor_localLayers` + `sailor_elements` + `sailor_frame` sized to the element). Shows all
  categories.
- **Inside Compositor:** "Elements" tab in the add-layer flow. Pick ⇒ command batch adds the
  group to the open doc. Shows layer-backed categories only (a carousel is its own node, not
  an overlay layer).

Category rail is **job-named** (Callouts, Stickers, Kinetic Text, Marquees, Carousels) —
never technology-named. Cards are **live previews** for layer-backed elements: each card runs
the element's compose (deterministic ⇒ cacheable) with the active brand palette, so the
gallery shows *your* colors, not canned screenshots. (Precedent: `text-effects.ts`
`cssPreview` renders the user's own word.) Node-backed cards use prerendered thumbnails in
v1 (live effect previews per card would spin up WebGL contexts).

### Agent path

The catalog registers intents ("sold out sticker", "sale badge", "speech bubble", "scrolling
banner", "product carousel") in `lib/agent/capabilities.ts` / `action-catalog.ts`. New
compositor surface ops: `insertElement`, `setElementSlot`, `setElementKnob`, `detachElement` —
routed through `applyCompositorCommand` so agent edits target the recipe, never raw layers,
and get inverse-command undo.

### Two backends

- **`layers`** (badges, callouts, kinetic text, marquees): compose ⇒ `LocalLayer[]` group as
  above.
- **`node`** (carousels & showcases): the gallery card inserts a **preconfigured Expressive /
  Space Type node** (effect id + params + user text applied). Same card UI, same job-named
  category; the user never learns two substrates exist. v1 featured set drawn from the
  Expressive family: ring (photo+word carousel) plus curated picks (streamer, contour,
  string candidates — final list chosen during implementation by what demos well).
- **Image slots** (`kind: 'image'`) are offered by node-backed elements only in v1, filled
  through the existing pick-from-canvas / upload flow (Frame "Add image" precedent). Layer-
  backed elements are text-only in v1.

### Family notes

- **Badges & callouts** — the pure retype-fit test. Shape from geoshape at measured bounds;
  entrance animation from kinetic presets. For text-in-fixed-shape variants, reuse Smart
  Layout's `TextOverflow` logic (`shrink` / `shrink-then-truncate` / `grow`).
- **Kinetic text** — one TextLayer; the recipe's value is the curated combination:
  motion preset (typewriter, scramble, neon-flicker) + `LayerEffect` (bloom ⇒ "Glow", grain,
  duotone) + tuned speed/stagger. Known limitation: `copies`/`blur`-capability presets (echo
  trails, motion blur) are withheld from text layers because blur is declared-but-unwired in
  `paint.ts`; v1 selects from presets that work. Wiring blur is a small follow-up, not v1.
- **Marquees** — TextLayer + existing `marquee` / `grid-scroll-x/y` loop presets, optional
  band shape behind.
- **Carousels & showcases** — node-backed, see Two backends. Caveat acknowledged: featuring
  Expressive surfaces promotes their existing polish debt (deferred-headless, unverified
  overlay) into a casual-facing path.

## Error handling

- Compose failures or out-of-frame output ⇒ insertion rejected with a message; never a
  half-inserted group. `verifyCompositor` runs on the result (existing `LayoutIssue` check).
- `ElementInstance.version` gates future migrations (port-schema lesson: merge by name/era).
- Unknown element id ⇒ auto-detach (see Invariant 5).

## Testing

1. **Unit:** determinism snapshots (same spec+slots+knobs+seed ⇒ identical layers); fit
   property tests across text lengths (short/long/multiline/emoji) asserting text bounds ⊆
   shape bounds for every badge/callout; overflow-mode behavior; palette-role assignment.
2. **E2E (Playwright):** insert from both mounts; retype on the node and assert reflow;
   detach flow; agent "add a sold out sticker" round-trip; carousel card inserts a
   configured Expressive node.
3. **Runtime verification with a broken control** (standing lesson: unit tests have agreed
   on wrong answers before; verify by breaking a knob and watching it fail).

## Out of scope for v1

- Counters & social-proof family (countTween wiring), user-authored/saved elements, full
  taste-facet restyling (fonts/shape language), Vector-Type-as-layer bridge, re-attach after
  detach, in-Compositor node-backed elements (`SourceLayer` / frame-source-backed layers),
  wiring text-layer blur/copies capabilities.

## Landing checklist

- Update `docs/VISION|ROADMAP|STATE.md` + the ⛵ dashboard artifact on each commit (standing
  rule).
