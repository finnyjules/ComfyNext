# Smart Layout — Staging × Surface generation

**Date:** 2026-08-07
**Status:** Design (approved for planning)
**Area:** `frontend/` Smart Layout (Swiss modular-grid engine)

---

## Plain-language summary

Smart Layout already lays out Swiss-style posters on a modular grid and reflows
one design across every ad format. Today it ships four fixed starting
compositions ("archetypes"). This feature turns Smart Layout into something you
can **generate** with: rank your content by importance, then hit **Shuffle** and
**Surprise** to flip through genuinely different, always-tasteful poster layouts —
the way the reference "Swiss Grid Studio" tool does, but built into the editor
you already have.

The trick that makes endless variety stay poster-grade is two independent axes:

- **Staging** — *how* the importance hierarchy is arranged (Tower, Split, Frame…).
- **Surface** — *what* fills the field (flat paper, holographic gradient, tint, duotone photo).

A small hand-authored set of each multiplies into a large, always-coherent space.
Every roll is **seeded**, so a layout you love is reproducible and you can keep
editing it by hand afterward.

Nothing about rendering changes: generation is a pure function that emits the
**existing** template schema, so the resolver, the Satori render pipeline, and
format reflow all consume it unchanged.

---

## Background: current state

Smart Layout is a rule-based, deterministic Swiss-grid engine (see
`docs/superpowers/specs/2026-06-10-smart-layout-swiss-grid-design.md` and
`…/2026-06-26-smart-layout-v3-sectioned-canvas-design.md`).

Key pieces this design builds on:

- **Schema** — `frontend/shared/template-grid/types.ts`: `TemplateV2` / `TemplateV3`.
  Elements are placed by **grid region** `{col,colSpan,row,rowSpan}` and carry
  `level`, `priority`, `role`, and a `style`. v3 adds `sections`.
- **Resolver** — `frontend/shared/template-grid/resolve.ts` (`resolveFormat` →
  `ResolvedLayout`). Its docstring: *"The renderer and the editor both consume
  this output; neither does grid math of its own."* This is the single shared
  module every render surface routes through.
- **Archetypes** — `frontend/shared/template-grid/archetypes.ts`: 4 curated
  compositions (`hero-band`, `split`, `type-poster`, `editorial`), each an
  `Archetype { id, name, blurb, background?, brand?, elements: ElementV2[] }`.
- **Text/fit** — `frontend/shared/template-grid/text.ts` (`fitText`, `wrapLines`,
  `typeSize`, `LEVELS`).
- **Render** — `frontend/server/templates/translate.ts` (`templateToSatori`) →
  `frontend/server/api/render-template.post.ts` (satori → resvg → PNG). The
  Python node `comfy_extras/nodes_smart_layout.py` delegates to this endpoint.
- **Editor** — `frontend/app/composables/useGridEditor.ts` +
  `frontend/app/components/templates/GridEditorShell.vue` (top bar, floating
  left panel [formats/variables/layers], right inspector, bottom tool cluster,
  in-product AI agent via `AgentBar`), hosted by
  `frontend/app/components/vue-canvas/SmartLayoutEditorModal.vue`.
- **House style enforcement** — `frontend/app/lib/agent/designPrinciples.ts`
  (`SWISS_DESIGN_PROMPT`) and `verify.ts` (`SWISS_LIMITS`: max 4 colours, max 3
  type sizes, off-canvas / low-contrast / narrow-headline checks).

The four archetypes are the seeds we generalize; the single `background`
fill/image is the seed of the surface axis.

---

## Goals & non-goals

### Goals (v1 — the vertical slice)

1. A formal **importance-tier** content model (Hero / Anchor / Support / Fine print).
2. **Staging** as a hand-authored, seeded generator of tier placements — ~6 stagings.
3. **Surface** as an independent axis — ~4 (flat, holographic, tint, split-field);
   duotone-photo when an image is available.
4. Seeded **Shuffle** (re-roll knobs within the current staging+surface) and
   **Surprise** (jump both axes), with **per-axis lock** and a visible seed.
5. Editor integration: a **Layout / Freeform** mode toggle in the single toolbar;
   Layout mode adds **semantic items** (Headline, Anchor, List, Detail, Image);
   the right panel hosts **Layout controls** + **Type controls**.
6. Output is a standard `TemplateV3` — resolver, Satori render, and format reflow
   inherited unchanged; house limits respected by construction.

### Non-goals (v1)

- Node-face Shuffle/Surprise (rolling from the canvas node without opening the
  editor) — fast-follow.
- A large library (15–20 stagings, many image surfaces) — fast-follow; v1 proves
  the loop with a modest set.
- AI-driven generation from a prompt — the existing `AgentBar` already covers
  intent-driven editing and coexists untouched.
- New render surfaces or backend layout math — explicitly avoided (parity).

---

## Core concepts

### Hierarchy of importance (the spine)

A layout is a **staging of a hierarchy of importance**, not an assembly of
functional zones. Content is ranked into tiers; a layout dramatizes that ranking
through scale, position, whitespace, and contrast.

v1 tiers (ordered, most→least important):

| Tier | id | Typical content | Default level |
|------|------|------------------|---------------|
| 1 | `hero` | The one thing read across the room | display |
| 2 | `anchor` | The key fact that pays off the hero (date, name) | h1 |
| 3 | `support` | Programme, features, short list | h3 / body |
| 4 | `fineprint` | Venue, hours, URL, tags, credits | caption |

Tiers map onto the existing element `level`; a tier is the *semantic rank*,
`level` is the *type size bucket* it defaults to.

### Two axes: Staging × Surface

- **Staging** decides *arrangement*: which tier goes huge, where the eye enters,
  flush/split, cropping, corner anchoring.
- **Surface** decides *field*: background fill/image and the contrast policy the
  type adapts to.

They are independent by default; a compatibility declaration lets a staging opt
out of surfaces it can't carry (see `supports`).

### Seeded generation

Every roll is `(staging, surface, seed, knobs, locks)`. The same tuple always
produces the same template (per memory *seeded-randomness-in-render-pipelines*:
hash-based RNG, never `Math.random`). Shuffle re-rolls knobs (+ unlocked axes)
under a new seed; Surprise re-rolls both axes; a locked axis holds. The tuple is
stored on the template so a roll is reproducible and editable.

---

## Data model

All additions are **optional** fields on `TemplateV3` — existing templates and
the four archetypes keep working untouched.

### Tiers (content + type, decoupled from placement)

```ts
// shared/template-grid/generate/tiers.ts
interface TierSpec {
  content: string          // literal text OR a '{{ props.x }}' / '{{ brand.x }}' binding
  type?: Partial<TextStyleV2>   // font, weight, size mode, tracking, colour — edited by Type controls
  enabled?: boolean        // a tier may be empty for a given piece
}
type TierId = 'hero' | 'anchor' | 'support' | 'fineprint'

interface TemplateV3 {
  // …existing…
  tiers?: Record<TierId, TierSpec>
}
```

- **Content decoupled from placement**: tiers carry *what to say* and *how it's
  typeset*; stagings decide *where it goes*. Re-rolling restages the same tier
  content + type — so **your type choices survive a Shuffle** (they live on the
  tier, not the placed element).
- **Wiring**: `autopopulateTiers(template, props)` maps wired sockets to tiers by
  order (`text_layer_1`→hero, …), overridable inline. This answers the content-
  input question: type by default, a wired socket overrides its tier. Images
  wired in feed the duotone-photo surface / an image tier.

### Generation state (on the template)

```ts
interface GenState {
  staging: string          // staging id
  surface: string          // surface id
  seed: number
  knobs?: Record<string, unknown>   // resolved knob values for reproducibility
  locks?: { staging?: boolean; surface?: boolean }
}
interface TemplateV3 { /* …existing… */ gen?: GenState }
```

### Element origin (so re-rolls don't clobber manual work)

```ts
interface ElementV2 { /* …existing… */ origin?: 'staging' | 'freeform' }
```

Shuffle/Surprise **regenerate only `origin: 'staging'` elements**; `freeform`
elements (added in Freeform mode) are preserved. Newly generated elements are
tagged `'staging'`.

### Staging (a pure, seeded composer)

```ts
// shared/template-grid/generate/stagings.ts
interface Staging {
  id: string
  name: string
  blurb: string
  supports?: { minTiers?: number; maxTiers?: number; surfaces?: string[] }
  knobs: KnobSpec[]                       // degrees of freedom Shuffle may roll
  compose(input: {
    tiers: Record<TierId, TierSpec>
    grid: GridSpec
    rng: SeededRng
    knobs: Record<string, unknown>
    brand: BrandKit
  }): ElementV2[]                          // placed-by-region elements, origin:'staging'
}
```

A staging is **pure**: given tiers + grid + a seeded RNG + knob values, it emits
concrete `ElementV2[]` on the grid. It never renders — the emitted elements are
standard schema. v1 stagings: **Tower, Split, Frame, Centered, Editorial, Index.**

### Surface (fills the field + sets contrast policy)

```ts
// shared/template-grid/generate/surfaces.ts
interface Surface {
  id: string
  name: string
  kind: 'procedural' | 'image'
  needsImage?: boolean
  knobs: KnobSpec[]
  apply(input: {
    template: TemplateV3
    rng: SeededRng
    knobs: Record<string, unknown>
    brand: BrandKit
    image?: string       // present for image surfaces
  }): void               // writes template.background + a contrast policy tiers adapt to
}
```

v1 surfaces: **Flat paper, Holographic gradient, Tint block, Split-field**
(procedural, free, instant) + **Duotone photo** (when an image is wired/picked).
Surfaces write into the existing `template.background`, so the current Background
panel keeps working as a manual override.

### Knobs & RNG

```ts
// shared/template-grid/generate/knobs.ts
interface KnobSpec { id: string; kind: 'pick' | 'toggle' | 'range'; domain: unknown }
// shared/template-grid/generate/rng.ts — hash(seed, salt)→[0,1); pick/roll helpers
```

### Orchestrator

```ts
// shared/template-grid/generate/generate.ts
function generate(template: TemplateV3, opts: {
  staging: string; surface: string; seed: number
  knobs?: Record<string, unknown>; brand: BrandKit; image?: string
}): TemplateV3   // returns a new template: staging elements replaced, background set, gen stamped

function shuffle(template: TemplateV3, brand, image?): TemplateV3   // new seed; roll unlocked axes+knobs
function surprise(template: TemplateV3, brand, image?): TemplateV3  // new seed; roll BOTH axes (respect locks)
```

`shuffle`/`surprise` pick `(staging, surface, knobs)` under a seeded RNG honoring
`gen.locks`, then call `generate`.

---

## Architecture & isolation boundaries

New pure engine, one job each, all under `frontend/shared/template-grid/generate/`:

| Module | Responsibility | Depends on |
|--------|----------------|-----------|
| `tiers.ts` | tier model, tier↔element mapping, autopopulate-from-props | types |
| `rng.ts` | seeded hash RNG + pick/roll helpers | — |
| `knobs.ts` | knob spec + seeded knob resolution | rng |
| `stagings.ts` | staging registry (6 pure composers) | types, text, grid, knobs, rng |
| `surfaces.ts` | surface registry (4–5 appliers) | types, brand, knobs, rng |
| `generate.ts` | orchestrator: tuple → `TemplateV3`; shuffle/surprise | all of the above |

**Isolation test:** `generate()` takes content + axes + seed and returns a
standard template. Everything downstream (resolve, translate/satori, editor DOM,
Python node, format reflow) consumes that output exactly as it consumes a
hand-authored layout — no new render path, no backend layout math. This is what
keeps the render-parity concern (memory *smart-layout-render-parity*) from
regressing: generation sits *upstream* of the single resolver.

**House style by construction:** stagings/surfaces are authored within
`SWISS_LIMITS` (≤4 colours, ≤3 type sizes). `verify.ts` validates generated
output; a roll that trips a limit is rejected and re-rolled (bounded retries).

### Editor changes

- `useGridEditor.ts` — add generation actions: `setStaging`, `setSurface`,
  `toggleLock`, `shuffle`, `surprise`, `editorMode` (`'layout' | 'freeform'`),
  `addTierItem(tier)`, plus tier-type getters/setters. All mutate `template`
  through the existing history stack (undo/redo works on rolls).
- `GridEditorShell.vue` — replace the double cluster with **one toolbar**: a
  `Layout / Freeform` segmented toggle; in Layout mode the add-tools are semantic
  (`+ Headline / + Anchor / + List / + Detail / + Image`); Brand + zoom retained.
- Right panel — new `LayoutControlsPanel.vue` (staging chips, surface chips,
  Shuffle/Surprise, seed + per-axis lock, format row) stacked above the
  **Type controls** for the selected item. Type controls reuse the existing
  `FontPicker` and the ring word-type control pattern (font/weight/size/tracking/
  colour). When nothing is selected, the panel shows Layout controls + Canvas
  (grid/background) as today.
- `SmartLayoutEditorModal.vue` — on open, if the layout has no elements, seed
  `tiers` from wired sockets (`autopopulateTiers`) and run one `generate` so a
  freshly dropped node already shows a real staged poster instead of a blank grid.

---

## User flow

1. Drop a Smart Layout node, wire content (or type into tiers), open the editor.
2. Editor opens in **Layout mode** showing a generated poster.
3. **Shuffle** re-rolls within the current staging+surface; **Surprise** jumps
   both axes. Lock an axis to hold it ("keep this staging, try surfaces"). The
   seed is shown; a great roll is reproducible.
4. Select the Hero → tune **Type controls** (font/weight/tracking/colour); those
   choices ride on the tier and survive further rolls.
5. Add a semantic item (+ List) or flip to **Freeform** to place anything by hand.
6. Save & close → node re-renders through the existing pipeline; reflow to every
   format is automatic.

---

## Testing strategy

Per memory (*parity-tests-agree-on-wrong-answer*, *graceful-fallback-hides-
integration-failure*), tests assert behavior, not just "it rendered":

- **Determinism** — same `(staging, surface, seed, knobs)` → byte-identical
  template; different seeds → different templates.
- **Distinctness** — each staging produces a *different* placement for the same
  tiers (guards a silent fall-through to one staging).
- **Content correlation** — every enabled tier's content appears in the output;
  scale ordering holds (`hero ≥ anchor ≥ support ≥ fineprint` type sizes).
- **Validity** — generated output passes `resolveFormat` with no off-canvas /
  overlap, across tier counts 1–4 and all v1 formats; passes `SWISS_LIMITS`.
- **Surface independence** — swapping surface leaves placement unchanged; swapping
  staging leaves `template.background` unchanged (axis independence).
- **Type persistence** — a tier type override survives Shuffle/Surprise.
- **Origin preservation** — a `freeform` element survives a re-roll; `staging`
  elements are replaced.
- **Editor** — mode toggle switches toolbars; `+ Headline` adds a hero-tier item;
  Type controls write to the tier; undo reverts a Shuffle.

---

## Risks & mitigations

- **Re-roll clobbers manual edits.** Mitigated by `origin` tagging + tier-level
  type overrides; Shuffle only replaces staging-origin elements.
- **Combinatorial ugliness** (a staging×surface pair that reads badly). Mitigated
  by `supports` compatibility + `verify.ts` reject-and-reroll + hand-authoring
  each staging/surface within house limits.
- **Schema drift** with saved layouts (memory *port-schema-sync-name-aware*). All
  new fields optional; a template with no `gen`/`tiers` is a valid legacy layout
  that simply can't Shuffle until tiers are populated.
- **Render parity.** Avoided structurally: generation emits the existing schema
  and routes through the one resolver; no new render surface is introduced.

---

## Fast-follow (post-v1)

- Grow to 15–20 stagings and more surfaces (incl. richer image treatments).
- Node-face Shuffle/Surprise without opening the editor.
- Deeper per-staging knobs; staging-family variants.
- Optional: let the AI agent *drive* Shuffle/Surprise as a command.
