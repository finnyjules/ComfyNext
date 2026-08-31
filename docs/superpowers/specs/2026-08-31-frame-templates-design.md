# Templates — your own reusable Frames with fill-in slots

**Date:** 2026-08-31
**Status:** Approved design, pre-implementation
**Relationship:** *Elements are ours; Templates are yours* — and they share one
shelf. Elements
([2026-08-18-elements-gallery-design.md](2026-08-18-elements-gallery-design.md))
are first-party curated ready-mades with a fixed recipe (the Butter-style library).
Templates are the **user-authored** counterpart: you build a Frame, mark some parts
as swappable, and reuse it across projects. Both appear in **one gallery, two
sources** (see below). Built on the same Compositor/Frame surface, and it reuses the
detach seam from the timeline clip-in-place work
([2026-08-27-timeline-live-studio-clip-editing-design.md](2026-08-27-timeline-live-studio-clip-editing-design.md)).

## One shelf, two sources

The user sees a single library with two sections: **Sailor** (curated Elements —
the Butter-style ready-mades, first-party) and **Yours** (Templates you saved).
Same gallery, same "pick → drop in → fill the slots" gesture, so there is one place
to reach reusable pieces, not two. Under the hood they stay two mechanisms — an
Element is a curated `compose()` recipe (`lib/elements/`), a Template is a saved
Frame snapshot (`lib/frametemplate/`, this spec) — but that split is invisible to
the user. This spec builds the **Yours** half and the shared gallery seam; Elements
is its own spec and its own build.

## Plain summary

You build a **Frame** the normal way — text, a background bar or shape, a photo,
some motion. You hit **"Save as template."** You **tap the parts** you want to be
able to change later — a piece of text, a color, a photo. Those become **slots**;
everything you don't tap is **locked** to the template.

The template goes into your **library** — a personal shelf that follows you across
every project, like your brand kit. Drop it into any video and you get a **copy**:
the template's locked parts plus your own slot values. Retype the words, recolor
the bar, swap the photo — the rest stays exactly as the template drew it.

Later you improve the template. The next time you open a project that used it,
Sailor notices and **asks, per project, "this template changed — update the copies
in here?"** You choose. Old work is never rewritten behind your back. And you can
**freeze** any single copy when it's final, so it stops listening to the template
for good.

**Why this stays a small build:** because you *point at* the slots up front, the
rule is unambiguous — **slots belong to the copy, everything else belongs to the
template.** Sailor never has to guess who wins when both changed, which is the
expensive part of a full symbol system. We designed that problem away.

## The one honest limit (restyle vs. reshape)

- **Restyle** a template (change a color, timing, position, a locked layer's look)
  → this flows to old copies through the update prompt.
- **Reshape** a template (add a new slot, delete one, change a text slot into an
  image slot) → this does **not** retro-fit onto old copies. The update prompt only
  offers to update a copy when the template's slots still line up with the copy's.
  A reshape becomes a **new version** you place fresh.

This is deliberate: it keeps "update everywhere" safe and predictable, and it's the
trade that lets us skip slot-migration machinery in v1.

## Decisions already made (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Host surface | **Frame / Compositor layer stack** | The one surface where text, color, and photo slots all live as sibling layers, where "point at a part" = tap a layer, and where layers already animate (~70 per-layer motion presets). The single-moving-text case is just a one-layer Frame, so "both over time" is covered without a second substrate. Space Type *effects* (ribbon/tunnel) live elsewhere and become a later template flavor. |
| Creating a template | **Build a Frame, then "Save as template"** | No new authoring mode. You already know how to build a Frame; the only new gesture is saving and marking slots. |
| Marking slots | **Explicit — you tap the parts** | Declared slots are what make the rule unambiguous (copy owns slots, template owns the rest) and dodge the "which change wins" problem. Rejected: everything-swappable-by-default (reintroduces the conflict problem) and auto-detect (guesses wrong). |
| Where a template lives | **Global personal library, across all projects** | A make-once-grab-anywhere shelf, sitting under "Yours" next to Sailor's curated Elements. Needs a cross-project store (see Open questions). Rejected: project-only (can't reuse next video). |
| Updating old copies | **Ask per project; restyle-only** | On opening a project, if a placed copy's template changed and its slots still line up, offer to update *this project's* copies. Never silent, never retroactive across delivered work. Reshapes become new versions (see above). |
| Freezing a copy | **Per-copy detach** | Reuses the detach mechanic from the timeline clip work: drop the template link, keep the layers as plain content. The "this one is final" button. |
| Instance model | **Materialized + recipe card (mirror Elements)** | Placing writes real `LocalLayer`s into the target Frame; a small recipe card (template id + version + slot values) is stored alongside. Every existing layer consumer keeps working; a missing/removed template auto-detaches to plain layers, so artwork can never break. |

## Architecture

### Module: `frontend/app/lib/frametemplate/`

(Distinct name to avoid the heavily-overloaded "template" identifier — Smart
Layout already has `TextElementV2`/`ShapeElementV2` scoped template types, and
Elements owns `lib/elements/`. User-facing name is **Templates**; the module is
`frametemplate`.)

- `types.ts` — the contracts below.
- `store.ts` — the global library: list / get / save / update-version / delete,
  backed by the cross-project persistence chosen in Open questions.
- `author.ts` — "save this Frame as a template" and slot-marking: snapshot the
  Frame's layers, record the slot marks.
- `apply.ts` — place / update / freeze, implemented as command batches through
  `applyCompositorCommand` (undo for free, verifier runs), mirroring
  `lib/elements/apply.ts`.

### Contracts

```ts
type SlotKind = 'text' | 'color' | 'image'

interface SlotMark {
  id: string                 // stable slot id, referenced by copies
  layerKey: string           // which layer this slot lives on (role-based, stable)
  kind: SlotKind
  label: string              // "Headline", "Accent", "Photo"
}

interface Template {
  id: string
  name: string
  version: number            // bumped on every save; copies record which they're on
  layers: LocalLayer[]       // snapshot of the authored Frame's layers (the locked design)
  slots: SlotMark[]          // the parts a copy may change
  frameSize: { w: number; h: number }
  // Color slots and locked colors store plain color values (hex) in v1 — no
  // brand-kit coupling (deferred; see Open questions).
}

interface TemplateInstance {   // stored per group in Frame node property `sailor_frametemplates`
  templateId: string
  templateVersion: number      // the version this copy was last synced to
  slotValues: Record<string, string>   // slotId -> text / image src / color
  frozen: boolean              // true once the user froze (detached) this copy
}
```

### How the four operations work

- **Save as template** (`author.ts`): snapshot the current Frame's `LocalLayer`s
  into `Template.layers` with **stable role-based keys** (`headline`, `accent`,
  `photo0` — never positional; list-addressing lesson). Slot-marking tags a layer
  key + kind + label into `Template.slots`. Write to the library store at
  `version: 1`.

- **Place** (`apply.ts`): copy `Template.layers` into the target Frame as a group
  with fresh instance keys; fill slot layers from `slotValues` (defaults on first
  place); store the `TemplateInstance` recipe card. Materialized — the layers are
  real. A template placed into an *empty* Frame reads as a standalone piece; placed
  into a *populated* Frame it overlays as one more group — the group-as-unit choice
  is what enables both.

- **Update** (`apply.ts`, restyle path): for a copy whose `templateVersion <`
  library version **and whose slots still line up**, re-apply the template's
  **locked** layers while **preserving the copy's slot layers and their values**,
  then bump the copy's `templateVersion`. Runs as one undoable command batch.
  Triggered by the per-project prompt (below), never automatically.

- **Freeze / detach** (`apply.ts`): delete the `TemplateInstance` card; the layers
  stay as ordinary Compositor content. Same shape as the clip-in-place detach
  (`origin: undefined`). No re-attach in v1.

### The per-project update prompt

On opening a project (Frame node hydrate), compare each `TemplateInstance`'s
`templateVersion` against the library `Template.version`. For any that are behind
**and slot-compatible** (same slot ids + kinds), surface one non-blocking prompt:
*"N copies use templates that changed — review updates?"* The user reviews and
applies per copy (or all). Slot-**incompatible** copies are left untouched and
quietly stay on their old version (the reshape rule); they are not offered an
update.

### Invariants (carried from Elements + the clip work)

1. **Stable layer keys** — role-based, never positional, so update/animation
   references survive recompose (list-addressing lesson).
2. **Serialization is explicit** — `sailor_frametemplates` must be added to node
   persistence; `convertToLiteGraph` silently drops unknown `node.data` fields
   (known trap).
3. **Graceful degradation** — unknown `templateId` at load ⇒ auto-detach to plain
   layers. Artwork survives library churn by construction.
4. **One rule, no conflict resolution** — the copy owns its slot values; the
   template owns everything else. There is no state where they disagree.
5. **Every mutation is a command** — place/update/freeze/slot-edit route through
   `applyCompositorCommand` for undo and the layout verifier.

### Editing a copy (the casual loop)

Selecting a placed copy shows only its **slots** (a text box per text slot, a
color chip per color slot, a pick-photo button per image slot), plus **Freeze**.
The locked layers are hands-off while the copy is intact — tapping a locked layer
offers Freeze, exactly like Elements' guard rail. No state where the recipe and
the layers disagree.

### Agent path

Register template intents in `lib/agent/capabilities.ts` / `action-catalog.ts`:
"use my <name> template", "set the headline to …", "swap the photo". New ops
`placeTemplate`, `setTemplateSlot`, `freezeTemplate`, routed through
`applyCompositorCommand` so agent edits target the recipe, never raw layers, and
get inverse-command undo.

## Scope for v1

**In:** save a Frame as a template · tap text/color/image slots · a global library
(list/place/rename/delete) shown in the shared gallery under **Yours** (next to
Sailor's Elements) · place a copy and fill its slots · per-project restyle-update
prompt · freeze a copy · agent ops.

**Out (deliberately):**
- Slot **reshape** migration (add/remove/retype a slot flowing onto old copies) —
  reshape makes a new version; old copies stay put.
- Full symbol overrides (arbitrary per-property divergence + conflict resolution).
- Space Type / Expressive **effect** templates (the ribbon/tunnel substrate) — a
  later flavor once the Frame version proves out.
- Sharing templates between users / a template marketplace.
- Re-attach after freeze.
- Auto-reflow geometry (the Elements "badge grows around the text" magic) — a
  user template swaps a slot's *content*; it does not re-run a parametric compose.
  Longer text just runs longer (existing layer overflow behavior applies).

## Testing

1. **Unit:** save→place round-trip produces the template's locked layers plus the
   copy's slot values; slot-compatibility check (same ids+kinds); update preserves
   slot values while restyling locked layers; freeze leaves plain layers; unknown
   template id auto-detaches.
2. **E2E (Playwright):** build a Frame, save as template, place it in a second
   project, retype a text slot + swap a color, assert the render reflects the slot
   values and the locked design; bump the template, reopen, accept the per-project
   update, assert locked parts changed and slot values survived; freeze, then bump
   again, assert the frozen copy is untouched. (Mirror the timeline clip-edit
   harness approach: drive the real store, diff rendered pixels.)
3. **Runtime verification with a broken control** (standing lesson): break the
   slot-preserve step and watch the update test fail, proving the test has teeth.

## Open questions (for the plan / first task)

1. **Where the library persists.** A global, cross-project store is new. Options:
   an account-level store (if that infra is the right home) vs. a local persisted
   store first. Explicitly **not** tied to the brand kit. Decide before the store
   task; it gates everything else.
2. **Template unit = a group** (decided). A template is saved as a *bundle of
   layers* (a group), not a whole Frame, so it can be dropped both into an empty
   Frame (standalone) and onto a populated Frame (overlay onto existing content —
   the common reuse gesture). Authoring is unaffected: "build a Frame → save as
   template" saves its layers as the group; the user never groups by hand. Revisit
   only if standalone-only turns out to be the sole use.
3. **Brand-kit-aware colors — deferred.** Color slots and locked colors store plain
   hex in v1. Whether colors should later follow a brand-kit role (travel between
   kits) is a separate decision, made once the brand kit itself is thought through.
   No v1 decision depends on it.

## Landing checklist

- Update `docs/VISION|ROADMAP|STATE.md` + the ⛵ dashboard artifact on each commit
  (standing rule).
