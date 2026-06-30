# Smart Layout — Auto-Layout Stacks (v3 hardening, Slice 1)

**Date:** 2026-06-30
**Status:** Design — pending review
**Related:** `docs/superpowers/specs/2026-06-26-smart-layout-v3-sectioned-canvas-design.md` (the v3 sectioned-canvas foundation this evolves), `project_smart_layout_v3` (memory), `project_variables_data_merge` (parked on top of this)

## Goal

Make Smart Layout **best-in-class at cross-format adaptation** — one design that produces a great default on every format (1:1 → story → wide → ad banners) with light nudging to perfect it.

That capability requires a layout primitive the current engine doesn't have: a **container that holds children, arranges them by rule, and can re-arrange per format**. Today v3 sections only *scale* children proportionally, so text doesn't reflow and stacks don't re-orient — the #1 reason cross-format adaptation looks broken.

This spec defines **Slice 1**: introduce **Stacks** — Figma-style auto-layout containers — working in a single format. It is the foundation; cross-format adaptation rides on top in Slice 2.

### Decisions locked in brainstorming

- **Bar = cross-format magic.** The differentiator is one-design-many-formats done well.
- **Automation level = "one great default + nudge."** The engine produces a strong per-format layout automatically; the user nudges a few things. (Not fully-automatic, not manual-with-assists.)
- **Auto-layout behaviors in scope (all four):** text auto-fit & reflow, stack-direction flip, align & distribute, safe-area / margins. *Slice 1 delivers the container + align/distribute/auto-fit in one format; direction-flip and safe-area are Slice 2 (they are per-format adaptation behaviors).*
- **Container model = Figma auto-layout**, chosen for intuitiveness (direction, padding, gap, align, hug/fill/fixed).
- **Name = "Stack"** ("Frame" is already used by the Frame node / Compositor). Verb: "wrap in stack."
- **Sequencing = foundation-first (Approach A).** Slice 1 = stacks in one format with a cross-format-aware schema; Slice 2 = adaptation; Slice 3 = assists/remix/nesting polish.

## Non-goals (explicitly Slice 2+)

- Aspect-driven **stack-direction flip** per format (the landscape→story move).
- **Safe-area / margin** adaptation per format/platform.
- Per-format **nudge/override** of stack properties.
- **Nested** stacks (schema allows them; editor support deferred).
- **Reference remix**, richer assists, individual deep child editing.

Slice 1's job: stacks feel great in one format, with the schema already shaped so Slice 2 only *adds* adaptation.

## Principle: additive evolution, not rebuild

A `SectionV3` is already a box + children + per-format overrides (`frontend/shared/template-grid/types.ts:129`). A Stack is a section with layout rules. Everything here is **additive**: when the new `layout` field is absent, a section resolves exactly as today (verified by a back-compat snapshot test). The v2 resolver, satori→PNG render, fonts, tokens, brand merge, and per-output override machinery are untouched.

## Schema (`frontend/shared/template-grid/types.ts`)

```ts
export type LayoutAxis = 'horizontal' | 'vertical'
export type MainAlign  = 'start' | 'center' | 'end' | 'space-between'
export type CrossAlign = 'start' | 'center' | 'end' | 'stretch'
export type SizeMode   = 'hug' | 'fill' | 'fixed'

export interface AutoLayout {
  direction: LayoutAxis
  /** Inner insets, in fine-grid cells. */
  padding: { top: number; right: number; bottom: number; left: number }
  /** Space between children, in fine-grid cells. */
  gap: number
  mainAlign: MainAlign
  crossAlign: CrossAlign
}
```

- `SectionV3` gains **`layout?: AutoLayout`**. Present → auto-layout Stack (engine computes child rects). Absent → today's absolute-region section, unchanged.
- `ElementV2Base` gains **`layoutSizing?: { main: SizeMode; cross: SizeMode }`**, consulted only when the element is a Stack child.
  - Defaults: text → `{ main: 'hug', cross: 'fill' }`; image/shape → `{ main: 'fixed', cross: 'fill' }`.
- Inside a Stack, a child's `region` is **ignored for position** (computed by the engine) but its current main-axis span **seeds the `fixed` size on drop**, so wrapping existing elements doesn't resize them. **Child order = array order** in `section.children`.
- **All units are fine-grid cells** (baseline-derived), not px — padding/gap/sizes share one source of truth with the existing grid and snapping.

## Engine (`frontend/shared/template-grid/resolve.ts`)

One new **pure** function, a single-axis flexbox solver:

```ts
layoutStack(section: SectionV3, frameRect: Rect, ctx: ResolveCtx): Map<elementId, Rect>
```

Algorithm:
1. Resolve the Stack box: `sectionRegionFor(...)` → region → `rect` (existing path).
2. Apply `padding` → inner content rect.
3. **Main-axis sizing per child:**
   - `hug` text → auto-fit measure (reuses the existing shrink/overflow/`fitElementAtRect` text path — already headless for server render).
   - `fixed` → seeded extent (from the child's region span at drop time).
   - `fill` → equal share of `innerMain − Σ(hug+fixed) − Σ(gap)`.
4. **Distribute** along the main axis per `mainAlign`, inserting `gap` between children.
5. **Cross-axis** size/place per `crossAlign` (`stretch` fills the cross extent; `start/center/end` align at intrinsic cross size).
6. Emit child rects → existing `fitElementAtRect` for final fitting/bleed handling.

Sections **without** `layout` skip this pass entirely. No DOM dependency — unit-testable in isolation (the resolver already measures text headlessly for satori render).

`resolve.ts` is already the largest file in this module; `layoutStack` lives in a new sibling `frontend/shared/template-grid/autolayout.ts` and is imported by the resolver, keeping the solver independently testable and `resolve.ts` from growing further.

## Editor UX

Revives the **already-built but dormant** section overlay (`GridEditorCanvas.vue:546-587`: box + label + select + move/resize) as the Stack surface. Composable hooks already exist in `useGridEditor.ts` (`isV3Mode`, `sections`, `resolvedSections`, `setSectionRegion`, `groupSelectedInto`, `ungroupSelectedSection`, `addSection`).

- **Stack tool** in the toolbar: drag to draw a Stack, *or* select elements → **"Wrap in stack."** Replaces the old confusing Group/Ungroup verbs with a single spatial Figma-style affordance.
- **Reparent by drag:** drop an element onto a Stack → becomes a flowing child; drag out → leaves (back to ungrouped absolute element).
- **Stack inspector** (when a Stack is selected): direction toggle (horizontal/vertical), padding, gap, a 9-position align control (main × cross), and per-child **hug / fill / fixed** chips — the familiar Figma panel.
- **Canvas:** children render in computed flow and **re-layout live** as controls change.

The dormant section engine + overlay are kept (per the v3 rehaul note) — Slice 1 turns them on under the "Stack" name with layout rules attached.

## Data flow

`useGridEditor` (Stack create / reparent / inspector edits) → mutate `AnyGridTemplate` via pure ops in `autolayout.ts` + `sections.ts` → resolver runs `layoutStack` for layout-bearing sections → canvas preview + satori render both consume the same resolved rects. One source of truth; canvas matches render (the existing v3 invariant).

## Error handling / edge cases

- **Empty Stack** → renders just its box (padding preserved); no children, no crash.
- **Overflow** (children exceed main extent even after hug-shrink) → existing text overflow policy applies per child; `fill` children clamp to a minimum; a Stack never pushes children outside its box.
- **All-`fill` with zero leftover** → distribute the inner extent equally.
- **Single child** → behaves as padding + alignment around one element.
- **Reparent into a layout-less section** → no-op until that section has a `layout` (drawing a Stack always creates one with sensible defaults).

## Testing

- **Pure engine tests** extend `template-grid-sections.unit.spec.ts` (or a new `template-grid-autolayout.unit.spec.ts`): each `direction × mainAlign × crossAlign`, gap & padding, text `hug` auto-fit, `fill` distribution, `fixed` seeding, empty/single/overflow edge cases.
- **Back-compat snapshot:** a `layout`-less section resolves byte-identically to today (guards the additive claim; zero v2/v3 regressions).
- **In-app Playwright screenshot sign-off** before "done" — draw a Stack, wrap elements, toggle direction/align, confirm visually (standing rule: never ship a visual feature on unit tests alone). Dev-server/preview port gotcha noted in `project_smart_layout_v3` (3001→3002; screenshot against the live port).

## Default Stack on create

Drawing a Stack or "wrap in stack" creates: `{ direction: 'vertical', padding: {2,2,2,2}, gap: 1, mainAlign: 'start', crossAlign: 'stretch' }` (fine-grid cells), with children seeded `fixed`-main except text (`hug`). Sensible "looks good immediately" baseline.

## Slice boundary / what unblocks next

When Slice 1 lands, Slice 2 (cross-format adaptation) becomes: a per-format pass that may flip `direction` by aspect, apply `safeArea` insets, and honor per-format property overrides — all *on top of* the same `layoutStack` solver, no new primitive. That is the point where "cross-format magic" becomes visible, and where `project_variables_data_merge` can finally un-park (a trustworthy template → batch over rows × formats).
