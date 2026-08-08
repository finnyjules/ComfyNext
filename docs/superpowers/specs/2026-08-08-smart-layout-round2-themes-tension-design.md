# Smart Layout Round 2 — Themes, multiplicity, and tension

**Date:** 2026-08-08
**Status:** Design (approved direction; supersedes the *surface axis* of the round-1 spec)
**Area:** `frontend/` Smart Layout generation (`shared/template-grid/generate/` + editor)
**Round 1:** `docs/superpowers/specs/2026-08-07-smart-layout-staging-surface-generation-design.md` (landed `f24f1f6f7`..`fa5cfcaf1`)

---

## Plain-language summary

Round 1 built the machine: importance tiers, staging × surface, seeded Shuffle.
Looking at real output against real Swiss posters (and the reference tool
[backpocket.so](https://backpocket.so/), whose 23 layouts we studied end to end),
five things are wrong or missing:

1. **The surfaces are useless.** Flat paper renders white-on-white (a broken
   colour token), the palettes are hardcoded pastels that ignore the brand kit,
   and "holographic" is a washed gradient. Replace the surface axis with a
   **theme**: one small palette, three roles (field / ink / accent), ink chosen
   automatically to contrast the field, accent applicable to the headline —
   stamped into the template's brand defaults so a project brand kit still
   re-skins everything.
2. **You can't add more of one element.** One tier = one element, so a second
   list or a second meta cluster is impossible — but several small clusters
   around one big thing is *the* Swiss look. Tiers become **lists**; the add
   buttons append.
3. **Photos got force-treated.** Round-2 direction was drifting toward
   auto-grayscale; Julien rejected it. Treatment (grayscale / duotone / grain)
   becomes an **opt-in per-image control**, never automatic, never rolled by
   Shuffle. Legibility over busy photos comes from text scrims, not from
   mutating the photo.
4. **Everything is polite.** Elements can't overlap and can't leave the canvas —
   but overprinted titles, text running behind photos, and numerals cropping off
   the edge are where the drama lives. **Overlap and overhang become declared,
   first-class moves** — for stagings and for hand edits.
5. **Text only runs horizontally.** Add **orientation** (vertical up/down) as a
   type control and a staging move.

With that vocabulary in place, the staging library gets rebuilt and grown
(~6 → ~14) around the families the 23-layout study surfaced: type-dominant,
photo-as-block, photo-as-field (overprint/bands), and texture (repetition).

Ship in two plans: **2a — engine capabilities** (items 1, 2, 3, 4, 5), then
**2b — staging library v2** (the compositions that use them).

---

## What we learned from the reference (backpocket.so, all 23 layouts)

- **Colour system:** ONE 7-swatch palette (black, white, paper `#f2f0ef`, red
  `#dd2200`, orange `#fc461f`, green `#2e6f40`, blue `#1d4ed8`) reused for
  exactly three roles — Background / Text / Accent. Text defaults to **Auto**
  (contrast-resolved). One toggle: *apply accent to the headline*. No gradients.
- **Content model:** ~8 named slots (title, date, two meta clusters, caption,
  badge, hosted-by, pay-off); each layout shows a subset. Multiplicity of small
  clusters is what makes posters read as designed.
- **Layout families:** type-dominant (Statement, Manifesto, Index, Stacked),
  photo-as-block (Classic, Split, Corner, Stack, Banner, Frame, Accent),
  photo-as-field with overprint or bands (Cover, Overlay, Lockup, Header,
  Footer), texture/treatment (Repeat, Type Wall, Reel), and per-layout type
  voice (Serif Dates).
- **Craft constants:** tight margins (~3%), title lines ~12–15% of canvas
  height, hairline rules as structure, edge-flush and edge-cropped type,
  photo-behind/over-text layering, rotated titles.
- **What they don't have that we do:** a brand system, campaign-matrix reflow,
  wired content, an agent. Round 2 must compose with those, not regress them.

---

## Item 1 — Theme model (replaces the surface axis)

### Concept

The generation axes become **Staging × Theme**. A *theme* is a colour system:

```ts
// shared/template-grid/generate/themes.ts
interface Theme {
  id: string                 // 'black' | 'white' | 'paper' | 'red' | 'orange' | 'green' | 'blue'
  name: string
  field: string              // background colour (flat; gradients are out of scope this round)
  // ink is NOT stored — it is resolved by luminance at generate time
}
export const THEME_PALETTE: string[]  // the shared swatches, used for field, ink override, accent
```

- **Auto ink:** `resolveInk(field): string` picks near-black ink (`#111`) on
  light fields, paper ink (`#f2f0ef`) on dark fields, by WCAG-ish relative
  luminance. Label-based contrast (round 1's `'light' | 'dark'`) is deleted —
  it caused the white-on-white bug.
- **Accent:** one palette colour + a toggle `accentOnHero` (backpocket's
  "apply accent to the headline"). The anchor tier may also take accent as a
  staging decision.
- **Overrides:** field, ink, and accent can each be overridden from the palette
  (or hex) in the Layout controls; *Auto* is the default for ink.
- **Override semantics (pinned):** the Layout-control overrides and the Brand
  popover edit the SAME storage — the stamped `template.brand` values; they are
  one layer, not two. Persistence: Shuffle/Surprise never touch them; picking a
  *different theme* re-stamps (choosing a theme means adopting its system). Full
  colour precedence, bottom → top: theme stamp → user overrides (Layout controls
  / popover, same thing) → project brand kit → per-element `type.color` (which
  also survives re-rolls).

### Brand integration (the part backpocket doesn't have)

On **theme change** (not on Shuffle), the theme stamps its resolved colours into
`template.brand` — the *lowest-precedence* layer of the existing merge
(`template.brand ← project kit ← wired socket`):

```
background ← theme.field     foreground ← resolveInk(field)     accent ← theme accent
```

Tier text binds to **roles** (`{{ brand.foreground }}`, hero/anchor optionally
`{{ brand.accent }}`), the canvas background binds to `{{ brand.background }}`.
Consequences, all inherited from the existing system:

- No kit → theme defaults resolve → **a token can never again be unresolved**
  (the round-1 bug is structurally dead).
- Project kit set → overrides the stamp → generated posters re-skin to the
  brand. Surprise explores stagings *of the brand*.
- The Brand popover edits the stamped values — it *is* the theme's palette
  editor. Shuffle never re-stamps; picking a different theme does.
- **Luminance guard at generate:** `generate()` resolves the *effective* merge
  and, if ink-on-field contrast falls under threshold (kit fights theme), flips
  the ink binding to the contrasting role. Computed, not labelled.

### Retirement of round-1 surfaces

- `flat` → theme `paper`. `tint` → themes `red`/`black`/`blue`. `holographic`
  and `split-field` are **deleted** (a gradient field can return later as a
  field *kind*; not this round). `duotone-photo` is deleted as a surface —
  full-bleed photo is a **staging family** (item 5 + plan 2b), and photo colour
  is item 3's opt-in treatment.
- `GenState.surface: string` → `GenState.theme: string` with a read-time
  migration at the generate/load choke points (name-aware, per the port-schema
  lesson): `flat→paper`, `tint→red`, `holographic→paper`, `split-field→black`,
  `duotone-photo→black`.
- `LayoutControlsPanel` swaps its Surface chip row for Theme chips (palette
  swatch chips) + ink Auto/override + accent + `accentOnHero` toggle.

## Item 2 — Multi-item tiers

### Schema

```ts
// types.ts — TierSpec stays (one item); tiers become lists
type Tiers = Partial<Record<TierId, TierSpec[]>>
```

Read-time normalization at the same choke points (`generate`, modal open,
`tierEntries`): a round-1 single `TierSpec` object is wrapped into `[spec]`.
No stored-data rewrite required.

### Behaviour

- `tierEntries` returns `Array<{ id: TierId; items: TierSpec[] }>` (enabled,
  non-empty items, importance order).
- **Editor:** `+ Headline / + Anchor / + List / + Detail` **append** an item to
  the tier (the round-1 overwrite is the bug being fixed). Items list under
  their tier in the content panel with per-item hide; a staged element's id
  becomes `tier_<tierId>_<index>`.
- **Stagings receive lists.** Each staging declares per-tier capacity
  (`hero: 1, anchor: 1, support: n, fineprint: n` typically) and *distributes*
  support/fineprint items into its slots — corner clusters, index columns,
  rails. Items beyond capacity stack into the staging's overflow slot (a rail
  or column), never silently dropped; the layers panel shows everything.
- Type controls stay **per-tier by default** (one voice per rank — Swiss), with
  per-item override possible via the same `TierSpec.type` since each item *is*
  a TierSpec.
- `omitConsumedProps` / `autopopulateTiers` update mechanically (first wired
  socket per tier seeds item 0).

## Item 3 — Photo treatment: opt-in control, never automatic

```ts
// ImageElementV2.style gains:
treatment?: { kind: 'none' | 'grayscale' | 'duotone' | 'grain'; intensity?: number }  // default none
```

- Declared as **ControlSpecs** on the image element (agent-legible +
  keyframeable for free, per the studio-param pattern). Duotone maps the photo
  through field→ink of the current theme.
- **Never rolled by Shuffle/Surprise; never defaulted on.** A user's choice
  rides the element.
- Render parity: implemented in both the editor DOM (CSS filters) and the
  Satori path. **Technical gate (verify in plan 2a's first image task):** Satori
  may not support CSS `filter`. Fallback decided in advance: pre-process the
  image server-side at render time (the render endpoint already inlines remote
  images in `inlineImages.ts`; treatment applies at inline time), while the
  editor uses CSS filters. Golden test compares the two.
- **Legibility is layout machinery, not photo mutation:** photo-field stagings
  use the existing text `panel` (scrim) style — a knob the shuffle may roll
  where the staging declares it — plus ink choice. The photo is never touched.

## Item 4 — Overlap + overhang as first-class moves

### Overhang (off-canvas)

- `ElementV2Base` gains `overhang?: boolean`. When set, the resolver uses an
  **unclamped** `regionToRect` (the clamping in `grid.ts:172-176` becomes the
  legacy path): raw grid math, regions may start before column 1 or extend past
  the last row; the canvas clips at render (both DOM and Satori already clip).
- Regions may therefore hold out-of-range `col/row` values **only when**
  `overhang` is set; `validateGenerated` rejects off-grid regions on elements
  *without* the flag (undeclared = accident, unchanged safety).
- **Editor:** drag/nudge clamps (`useGridEditor` move/nudge/duplicate paths)
  are removed; dragging an element past the edge sets `overhang: true` on it
  automatically (and clears it when fully back inside). The `bleed` flag keeps
  its existing meaning (extend-to-edge for backgrounds); overhang is its
  aggressive sibling.
- Reflow: overhang regions remap across formats by the same fractional identity
  as everything else — the crop is proportional, which is the point.

### Overlap (declared layering)

- Stagings emit elements **ordered back→front** and `generate()` writes
  `template.order` (the existing z-order array) from that order. Stagings
  declare intended overlaps: `compose()` returns
  `{ elements, overlaps?: Array<[id, id]> }` (ids of pairs meant to share
  space — photo-under-text for Cover-style, text-under-photo for Repeat-style).
- `validateGenerated` checks pairwise collisions **only among undeclared
  pairs**; declared pairs are legal. Round-1's blanket no-overlap unit test
  flips to per-staging geometry assertions (Cover asserts the title IS on the
  photo; Statement asserts the hero DOES exceed the top edge).
- Hand edits: manual overlap was always possible in Freeform; nothing blocks it.
  The validator only ever gates *generated* output.
- Legibility of declared overlaps: scrim/ink knobs (item 3), rolled only where
  the staging declares them.

## Item 5 — Text orientation

```ts
// TextStyleV2 gains:
orientation?: 'horizontal' | 'up' | 'down'    // default horizontal; up = 90° CCW (reads bottom→top)
```

- **Resolver:** for vertical orientations the copy-fit swaps axes (line length
  fits against the region's *height*) — implemented in shared `text.ts` so DOM
  and Satori agree. The resolved element carries a `rotation` of ∓90°.
- **Render:** both surfaces already have the rotation seam — Satori via
  `transform: rotate(...)` (proven at `translate.ts:323` for expressive
  children; extended to plain text), the editor DOM via the same CSS.
- **UI:** an orientation control in `TierTypePanel` (per tier/item). Stagings
  may set orientation as part of their voice (Reel-style vertical hero) and may
  declare it as a rollable knob.
- Composes with overhang: a vertical hero cropping off the top edge is a
  supported, testable staging move.

## Item 6 — Staging library v2 (plan 2b)

Rebuild the six composers and grow to ~14, organised by the studied families —
each staging declares: per-tier capacity, z-order + overlap intents, overhang
moves, type voice (tier `type` defaults, incl. serif and orientation), scrim
knobs, and its knob set. Hairline rules are shape elements (already
expressible). Craft floors change: margins tighten (~3% default in staged
output), hero scale targets ~12–15% of canvas height per line (level overrides
via `fontSize` where the typescale ceiling is too low), fine print sets small
and dense.

Planned set (names ours, not backpocket's — same families):

| Family | Stagings |
|---|---|
| Type-dominant | **Statement** (hero owns the top half, edge-cropped), **Manifesto** (rule + giant date), **Index** (ruled meta table), **Stacked** (flush block, air) |
| Photo-as-block | **Tower**, **Split**, **Frame**, **Corner** (rebuilt on v2 vocabulary) |
| Photo-as-field | **Cover** (overprint title), **Lockup** (centered jewel), **Band-header / Band-footer** (solid band carries the type) |
| Texture | **Repeat** (tier content repeated as an edge column, runs behind the photo), **Wall** (hero as dim full-canvas wall) |

Editorial and Centered fold into Stacked/Frame/Lockup rather than surviving
as-is. Every staging passes the new geometry assertions; the intra-staging
*undeclared*-overlap test still runs across the whole library.

---

## Migration & compatibility

- All schema changes optional/additive; legacy layouts remain valid.
- Choke-point migrations (no data rewrite): `gen.surface`→`gen.theme` map;
  single-`TierSpec`→array wrap; absence of `overhang`/`orientation`/`treatment`
  = today's behaviour.
- Round-1 unit tests are *expected* to change where they encoded politeness
  (no-overlap, clamped regions, surface registry) — those flips are part of
  plan 2a, not regressions.
- The agent surface (`SWISS_LIMITS` off-canvas check) updates to "reject
  *undeclared* off-canvas" in the same pass.

## Testing strategy

Per round-1 practice (behavioural assertions, RED-verified fixes):

- **Themes:** auto-ink flips at the luminance boundary; stamped brand resolves
  through the real merge (no-kit, kit-override, popover-edit cases); the
  white-on-white case is a named regression test; migration map covers every
  round-1 surface id.
- **Tiers:** append semantics; distribution honours capacity; overflow lands in
  the declared slot; normalization wraps legacy singles; `omitConsumedProps`
  parity with multi-item seeding.
- **Overlap/overhang:** unclamped rect math (negative col, beyond-cols);
  validator accepts declared / rejects undeclared for both; editor drag past
  edge sets the flag (E2E); per-staging geometry assertions.
- **Orientation:** axis-swapped fit; resolved rotation; DOM/Satori parity via
  the existing render-template E2E.
- **Treatment:** the Satori-filter gate task produces a golden comparing editor
  CSS vs rendered PNG; control never mutated by shuffle (unit).

## Risks

- **Satori CSS-filter support unknown** → gated early task with a pre-decided
  fallback (server-side pre-processing at image-inline time).
- **Unclamping regressions** — removing clamps that other editor paths rely on
  (duplicate/stagger placement, autopopulate) could scatter elements; the plan
  keeps clamping for *those* call sites and unclamps only explicit drag/nudge +
  overhang resolution.
- **Brand-stamp clobbering user edits** — mitigated by stamp-on-theme-change
  (never on shuffle) and the popover editing the same storage.
- **Scope** — two plans, hard gate between: 2a lands capabilities with the
  existing 6 stagings still functional (on themes, single-or-multi tiers);
  2b rebuilds the library.
