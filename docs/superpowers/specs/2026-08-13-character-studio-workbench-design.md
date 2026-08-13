# Character Studio — Workbench Redesign

**Date:** 2026-08-13
**Status:** Approved design, pending implementation plan
**Supersedes the presentation layer of:** [2026-08-12-character-system-unification-design.md](2026-08-12-character-system-unification-design.md) (data model, API, and state machine from that spec are UNCHANGED)

## Plain-language summary

The character system that landed on 2026-08-13 works, but its panel projects the machine's anatomy onto the screen: six stacked sections (Looks, Descriptor, Reference Sheet with internal slot names, Uploaded Photos, status chips twice, priced buttons) with no visible order. Julien's verdict: wrong surface entirely. This redesign moves character-building into a **Character Studio modal** — a workbench where the composite sheet is the centerpiece, like Sailor's other studios — and shrinks the side panel to a thin roster. The state machine (draft → testing → locked) keeps running underneath but is never spoken of: the user sees four words — **Not built · Not tested · N/10 poses · Ready**.

Decisions made in brainstorming (Julien, 2026-08-13):
- **Wrong surface, not wrong pipeline**: building/testing moves off the panel entirely.
- **Entry:** from the panel, no canvas node needed — as a **modal**, not full-screen.
- **Panel keeps roster only.**
- **Studio shape: B — sheet workbench** (over guided-journey and hero-card options).
- **Quiet readiness** (over an explicit Lock ritual): no lock/draft/stress jargon anywhere.

## 1 · Shell and entry

- `CharacterLibraryPanel.vue` splits into:
  - **`CharacterRosterPanel.vue`** — one card per character: portrait thumbnail (`portraitUrl` → cover fallback), name, one readiness line (see §3), and two actions: **Image** (use-in-image flow, incl. the existing sheet-vs-LoRA menu) and **Shot** (cast). Plus a dashed **+ New character** card. Card click (anywhere except the two action buttons) opens the studio.
  - **`CharacterStudioModal.vue`** — the workbench. Modal chrome mirrors `ShotDirectorSurface`/`LipSyncSurface` (same overlay/teleport/dismissal idiom).
- "+ New character" opens the studio in a creation state: name field + photo drop; the first uploaded photo becomes the cover, then the workbench appears.
- **`CharacterSheetNode.vue` (the canvas builder node) retires.** The canvas keeps only the light `CharacterNode` cast capsule. Absorb any still-unique behavior (wired-image source intake) into the studio's photo drawer (accepting a canvas image via the existing `FillImagePicker`/`imageUrlToFile` kit is acceptable follow-up scope if wired intake is wanted later; not required for v1).
- The dev harness page (`pages/dev/character-panel.vue`) points at the roster + studio pair.

## 2 · The workbench

Layout (top to bottom, matching the approved mockup):

- **Header:** character name (inline-editable), readiness badge, close ✕.
- **Left rail — Looks:** one entry per state (label + mini readiness), active look highlighted; **+ New look** at the bottom offers two creators: *Describe* (label + descriptor → new draft state) and **Dress her** (the existing wardrobe flow — garment photo or outfit text → generates the dressed cover → new state). Dressing IS look-creation; it no longer exists as a separate panel feature.
- **Stage — the sheet:** the composite sheet rendered large (panels shown seamlessly in the composite's layout; NO slot-name placeholders). Empty state: a single message + primary button "Build her sheet · ~$price" (price from source mode, as today). Hovering a region of the sheet offers **"Redo this shot"** (per-panel reroll → re-bake, existing plumbing). While generating: progress overlays on the stage itself.
- **Descriptor line:** one inline text row under the stage, italic value, placeholder "What she wears in this look — it travels into every shot." Saves on blur/Enter via `patchState` (existing editor logic from commit `9028a1096` relocates here).
- **Photos drawer:** a small horizontal strip (thumbnails + "+" tile) labeled "her photos". Upload/remove/set-cover via a hover affordance on each thumb. No section headline, no explanatory paragraph, no per-photo "Sheet" buttons (that affordance dies; sheet source selection is automatic: cover photo, or LoRA when trained).
- **Footer:** left — "Test 10 poses · ~$0.80" (ghost button, only when a sheet exists); center hint text; right — ⋯ overflow menu (**Train identity** → existing trainer seed flow; **Delete character**) and the primary **Rebuild sheet / Build her sheet** button.

## 3 · Quiet readiness

User-facing vocabulary is exactly four states, derived from the existing machine — no new fields:

| Underneath | Shown as |
|---|---|
| draft, no `sheetImage` | **Not built** (grey) |
| draft, `sheetImage` set | **Not tested** (grey) |
| testing (grid judged partially / previous run) | **N/10 poses** (amber) |
| locked | **Ready** (action-blue check) |

- **Test mode:** footer's "Test 10 poses" swaps the stage for the 10-tile grid (existing stress flow: sequential generation, abort-on-failure, ✓/✕ per tile, live tally "N of M held up so far — mark each: is this her?"). At 10/10 the client sends the existing lock patch automatically — the badge flips to **Ready** with a brief confirmation; there is no Lock button. Under 10/10, the footer hint: *"Fix the description, not the model — edit what she wears, redo a panel, then test again."* "Back to sheet" exits test mode (tiles stay session-local, as today).
- Words **locked / draft / stress** never appear in UI text. Server code and API keep them unchanged.
- Content edits demoting a locked state (server behavior, unchanged) surface only as the badge quietly returning to **Not tested**.

## 4 · Scope and non-goals

- **Presentation-only.** No changes to: shared model, registry, PATCH API, lock validation, store methods, bus events, cast/compile path, sheet generation pipeline, stress module. All existing unit + E2E suites remain valid; the E2E spec's panel-driven selectors update to the roster/studio equivalents.
- Files: new `CharacterRosterPanel.vue` + `CharacterStudioModal.vue` (replacing `CharacterLibraryPanel.vue`), deletion of `CharacterSheetNode.vue` (+ its node-type registration; existing saved graphs with that node type degrade gracefully — render as the plain cast capsule via the binding they already carry), layout mount swap.
- **StudioButton adoption:** the new components use `StudioButton` for action buttons from the start (the old panel's hand-rolled buttons were flagged repeatedly; new files start clean). Action blue only.
- Non-goals: wired-image intake into the studio (follow-up), roster-side look switching (deliberately rejected — casting a specific look happens in the studio or the cast node), any change to paid-verification obligations (still owed from the previous spec).

## Kill list (explicitly removed UI)

The five-slot placeholder grid with internal slot names · the LOOKS/DESCRIPTOR/REFERENCE SHEET/UPLOADED PHOTOS section stack · duplicate status labels ("Draft" chip + "draft — not stress-tested") · per-photo "Sheet" buttons · the Cover explainer paragraph · "stress-tested" as user-facing language · the standalone Dress and Train sections (folded into + New look and ⋯ respectively).
