# Smart Layout — On-Canvas Editing Layer

**Date:** 2026-07-06
**Status:** Design approved, spec under review
**Surface:** Smart Layout editor (`frontend/app/components/templates/`)

## Problem

Smart Layout is capability-rich (v2 grid, v3 sectioned canvas, Stacks, brand kit,
archetypes, variables/collections, AI copy assist) but has an **interaction-feel gap**,
not a capability gap — the same pattern the Frame parity audit found.

An inventory of the current editor established that geometry editing is already ~80%
**direct on canvas**: click-to-select, drag-to-move (grid-snapped), 8-handle resize,
live restyle. The friction is elsewhere. Everything about **content and style** happens
in a **side panel**:

- **Text is panel-only** — no inline typing on the canvas.
- **Restyle is panel-only** — select, then hunt in the property panel for font/size/color.
- **"Turn into variable" is a right-click menu dive** — a power-user move, not an
  affordance on the slot.
- **Copy assist is panel-bound.**
- Missing cheap parity niceties that Frame already has: **keyboard nudge, multi-select,
  copy-paste of elements.**

Root cause (unifying the two pain points the user selected — "editing & iteration feel"
and "content & data input"): **you select a thing on the canvas, then your eyes and hands
travel to a panel to change its text, style, or binding, then travel back.** That
canvas↔panel round-trip *is* the friction. The two named pains are one problem:
**you can't edit content on the canvas.**

## Strategy

**Do not merge Smart Layout and Frame.** They are deliberately separate products:

- **Frame** = free-transform on a single artboard (drag anywhere, rotate, blend, opacity).
- **Smart Layout** = grid-snapped regions producing **many formats from one design,
  driven by variables/collections.**

Borrow Frame's **qualities** (direct, immediate, on-canvas, low-ceremony,
edit-the-thing-not-a-form), not Frame's **model** (free-transform). Those qualities are
model-agnostic and layer onto the grid without importing free positioning.

Through-line: **edit on the canvas, not in the panel — while keeping the multi-format +
data brain that makes Smart Layout its own thing.**

## Scope

### In scope

**Core (highest leverage — hits both pain points):**

1. **Inline text editing.** Double-click a text element → edit in place. On commit, route
   through existing binding logic: bound element → write the collection cell
   (`setCell`); unbound element → write literal `content`. No new persistence path — reuse
   `promoteLayoutElement` / `resolveBindings` semantics already in
   `frontend/app/lib/collection/`.

2. **Contextual floating toolbar.** On element select, a compact toolbar appears anchored
   above the selection with the highest-frequency controls **plus a variable-promote
   affordance**. The full `GridPropertyPanel` remains as the "everything else" surface —
   the toolbar is a fast path, not a replacement.

   The exact control set is pinned in "Open decision" below; the working proposal for a
   text element is: **font family · size · weight · color · align · [◆ make variable]**.
   Non-text elements (shape/image) show their relevant subset (e.g. fill, radius, fit).

3. **On-the-slot variable promote.** Reuse the existing **variable hexagon glyph** from the
   input-affordances work as the toolbar's promote control, so binding is one click on the
   thing instead of a right-click menu dive. Dispatches the existing
   turn-into-variable command (`promoteLayoutElement`). The right-click path stays as a
   secondary entry.

**Ported parity niceties (reuse Frame's work, generalized onto grid regions):**

4. **Keyboard nudge** — arrow keys move the selected element by one grid cell; Shift =
   larger step. Ports Frame's S1 keyboard slice.
5. **Copy-paste of elements** — Cmd+C / Cmd+V duplicates elements within the layout. Ports
   Frame's S2 copy-paste.
6. **Multi-select** — Shift+click and marquee select, enabling move/delete of several
   elements at once.

**Inline copy-assist (folds onto the core):**

7. Surface the existing `/api/copy-assist` rewrite/variations/translate actions in the
   contextual toolbar (or an inline affordance on a selected text element) instead of only
   in the property panel. No new backend.

### The multi-format propagation rule (the Smart-Layout-specific part)

Frame never had to answer this; Smart Layout must. Default behavior of an on-canvas edit,
given a design that emits many formats:

- **Content edits propagate across formats.** Editing a headline updates every format,
  because it is the same copy / same collection cell. (Bound content already resolves from
  a shared cell; literal content is treated as shared by default.)
- **Geometry edits are per-format.** Moving/resizing an element in 9:16 does **not** move it
  in 1:1 — divergent layouts per format is the entire point of Smart Layout. This reuses the
  existing per-output override system (`resolvedByOutput` / per-output overrides).
- **Two explicit escape hatches** on an edit:
  - **"This format only"** — locally override otherwise-shared content.
  - **"Apply to all formats"** — push a geometry change to every format at once.

### Out of scope (protects Smart Layout's identity)

- **No rotation, skew, blend modes, per-element opacity, or free positioning.** Those are
  Frame's model. Adding them would blur the two products the user explicitly wants kept
  separate.
- No changes to archetypes, format picker, export, or the collections data model beyond
  what inline editing already writes through.
- No undo/redo subsystem rework (tracked as a separate concern; note it if the editing
  layer makes a lightweight local history cheap, but do not scope it here).

## Reuse map

| Need | Reuse |
|------|-------|
| Text write-through (bound vs literal) | `frontend/app/lib/collection/` (`promoteLayoutElement`, `resolveBindings`, `setCell`) |
| Variable-promote command | existing turn-into-variable dispatch in `GridEditorCanvas.vue` |
| Variable hexagon glyph | input-affordances glyph component |
| Keyboard nudge / copy-paste / multi-select | Frame modal S1 (keyboard) + S2 (copy-paste) slices, generalized off free-transform onto grid regions |
| Per-format divergence | `resolvedByOutput` / per-output override system |
| Grid drag/resize math | `shared/template-grid/editor.ts` (`dragRegion`, `resizeRegion`) |
| Copy assist | `/api/copy-assist` + `frontend/server/lib/copyAssist.ts` |

## Components / boundaries

- **`InlineTextEditor`** — an in-place editable overlay for a selected text element.
  Input: the element + its binding state. Output: a commit that routes to cell-or-literal.
  Testable independently of the canvas.
- **`ContextualToolbar`** — a floating, selection-anchored control strip. Input: the
  selected element(s) + current style. Output: the same style/region/promote mutations the
  property panel already dispatches. No new mutation paths — it is a second view onto
  existing commands.
- **Selection/keyboard layer** — extends the existing canvas selection to support
  multi-select and keyboard nudge/copy-paste, emitting the same region/duplicate mutations.
- **Propagation resolver** — the small piece that decides content-shared vs geometry-local
  and applies the two escape hatches, sitting on top of the existing per-output override
  system.

Each unit communicates through the existing command/mutation surface, so the canvas and the
property panel stay consistent with the new toolbar by construction.

## Testing

- **Inline text:** editing a bound element writes the collection cell (not the template);
  editing an unbound element writes literal content; the correct format(s) update.
- **Propagation:** a content edit shows on all formats; a geometry edit shows only on the
  active format; "apply to all formats" pushes geometry everywhere; "this format only"
  overrides shared content locally.
- **Toolbar:** each control dispatches the same mutation as its property-panel equivalent
  (parity test — no behavioral drift between the two surfaces).
- **Ported niceties:** keyboard nudge moves by one cell / Shift = larger; copy-paste
  duplicates within the layout; multi-select moves/deletes a group.
- **Browser verification is required** (per project rule: visual/interaction work is not
  signed off on unit tests alone) — screenshot pass on the `/dev/v3editor` harness in the
  modal.

## Open decision (pin during spec/plan)

**Which 5–6 controls earn a contextual-toolbar slot** for each element type. Working
proposal above (text: font · size · weight · color · align · make-variable). This is the
one deliberately-deferred choice; everything else in this design is settled.

## Sequencing (suggested)

1. **Inline text editing** — biggest single win; standalone.
2. **Contextual toolbar** (with variable-promote in it) — the other half of the core.
3. **Propagation rule + escape hatches** — makes the above coherent across formats.
4. **Ported parity niceties** (keyboard / copy-paste / multi-select).
5. **Inline copy-assist.**
