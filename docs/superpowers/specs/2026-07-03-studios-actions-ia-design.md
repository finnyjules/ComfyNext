# Studios / Actions / Toolbox — Information Architecture

**Date:** 2026-07-03
**Status:** Approved direction, pending spec review
**Scope:** Frontend only (Vue). Naming, menu structure, and panel organization. No node behavior changes.

## 1. Taxonomy definitions

Four categories, each defined by a single test a user can verify themselves:

| Category | Definition | Test |
|---|---|---|
| **Starting point** | Inert scaffolding placed on the canvas | Has no opinion and makes no content: sources (Image, Text, Audio, Video, Collection) and surfaces (Frame, Smart Layout, Timeline) |
| **Studio** | A *place* you open and craft in | Opens a dedicated editor with persistent state you return to. Defined by interaction model, **not** by whether AI is inside — Shot Director and Lip-Sync are studios |
| **Action** | An AI-driven *verb* | A model does the work. Two sub-kinds already in code: `generator` (zero-input — creates from nothing) and `effect` (takes-input — transforms a selection) |
| **Toolbox tool** | Deterministic, local, free operation | "Would Photoshop have it?" Brightness, blur, blend, geometry, etc. Photoshop-parity is the anchor |

**Orthogonal signals rule:** category communicates *how you work*; the pastel (gen-pastel) treatment communicates *AI/billing*. These must never be conflated. A studio can be pastel-marked (Shot Director); nothing in the Toolbox is ever pastel.

**Zero-input vs takes-input rule:** zero-input verbs (Generate image/video/…) are reachable from a blank canvas and deserve toolbar-level access. Takes-input verbs (Edit, Upscale, Relight, …) are best surfaced at the selection (chips), with the Actions panel as the browsable catalog.

## 2. Toolbar: three doors

`Add · Studios · Generate` — one sentence each: *bring or scaffold something / make it by hand / make it by prompt.* All plain menus — **no gallery modal** (explicitly rejected).

### Add (starting points)
- **Surfaces group:** Frame, Smart Layout, **Timeline** (moves up from the studios block — by the interaction test it's a surface)
- **Sources group:** Image, Text, Audio, Video, **Collection** (moves here from the studios block — it's a source of values, like Image is a source of pixels), 3D (disabled/coming soon)
- Groups get visible section labels.

### Studios (new top-level menu, split out of Add)
- Items: **Type, Gradient, Shader, Pattern, Shot Director, Lip-Sync**
- Type Studio (`SpaceType`) is added — it is currently absent from the quick-add despite being a flagship studio (verify during implementation whether the omission was deliberate).
- **Icon truth-telling:** remove the sparkles icon from Gradient/Shader/Pattern (they are non-AI; sparkles falsely signals AI). Add the pastel marker to Shot Director and Lip-Sync (they bill).
- Character / CharacterSheet remain out of this menu (they are cards/references, placed via their own panels).

### Generate (new top-level menu — the fast lane, not the store)
- Curated shortlist of the main zero-input generators: **Image, Styled image (your LoRA), Video, Audio**.
- Audio expands to **Music / Speech** as a submenu (two nodes exist; the door stays four items wide).
- The long tail of zero-input generators (anime, emoji, consistent face, 3D, multi-view) lives in the Actions panel only.
- The whole menu is AI → the door itself carries the pastel treatment.

## 3. Panels

### Actions (renamed from "Generators")
The panel named "Generators" contains 60+ `effect` nodes that do not generate; "Actions" is the exact name for the union. Rename the sidebar panel header and button label.

Reorganization:
1. **Kill provider-first sections.** "Replicate / BFL / Kling" is internal plumbing leaked into the UI and is the root cause of "Generate an image" being buried. Provider becomes a small badge or a model picker on the item/node — never the organizing principle.
2. **Hero tier** at the top of each domain tab: the 3–5 highest-frequency actions (e.g. Image tab: Generate an image, Edit an image, Upscale an image), always visible without scrolling.
3. **Intent sections** below: Create / Edit / Enhance / Analyze — mapping ~1:1 onto existing `kind: 'generator'` vs `'effect'` (Edit/Enhance/Analyze partition the effects).
4. Keep the existing domain tabs (Image, Audio, Video, 3D, Text) — genuinely user-meaningful.
5. The four Generate-door items also appear here; the door duplicates the hero tier, it does not replace it.

### Toolbox (role unchanged, contents cleaned)
- Identity: **Photoshop-parity supplemental tools** — deterministic, local, free. Kept as its own panel, explicitly *not* merged into Actions.
- **AI items migrate out:** the current AI sub-sections (Face Swap, Denoise, AI upscale, and any other model-backed entries in `app/data/toolbox-items.ts`) move to the Actions panel. After migration the Toolbox is 100% deterministic and 100% free.
- Duplicate verbs across the two panels are legitimate and resolved by engine: Toolbox "Upscale 2×" = deterministic resampler; Actions "Upscale an image" = AI. The panel tells you the engine.

### Selection chips (contextual sampler for takes-input actions)
- Selecting a media node surfaces the top 3–4 relevant actions as chips (pattern already shipped for post-render chip strips and critique fix chips — generalize it), plus an "All actions…" chip that opens the Actions panel pre-filtered to the selection's media type.
- Chips are a sampler, never the whole store — the panel remains the browse-everything surface.

## 4. Out of scope / rejected / deferred

- **Rejected:** Studios gallery/showcase modal — plain menu only.
- **Rejected:** merging Toolbox into Actions — the AI-vs-Photoshop-parity split is the retained model.
- **Deferred:** unifying the Generate door with the canvas-agent prompt surface ("type what you want" as one input). Bolder and more coherent, but couples this IA work to agent reliability. Revisit after the doors ship.
- **Deferred:** command palette (cmd-K) across studios/actions/sources — cheap insurance that makes any taxonomy forgiving; not part of this slice.
- **Deferred:** empty-canvas state offering the three doors as onboarding — noted as the best place to teach the taxonomy; separate design.

## 5. Phasing

1. **Actions panel reorg** — rename to Actions, intent sections + hero tier, remove provider-first grouping. Cheapest, fixes the acute "Generate an image is buried" pain, no toolbar changes needed.
2. **Toolbar restructure** — Add menu section labels, Collection → sources, Timeline → surfaces, Studios split out as its own menu (with Type Studio added and icon fixes).
3. **Generate door** — curated four-item menu with pastel treatment.
4. **Selection chips generalization** — contextual actions on media-node selection.
5. **Toolbox AI migration** — move model-backed items from toolbox-items.ts into the Actions catalog.

Each phase is independently shippable; 1 and 2 have no ordering dependency between them.

## 6. Key files

| Surface | File |
|---|---|
| Add menu / toolbar | `frontend/app/layouts/default.vue` (~108–127) |
| Actions panel | `frontend/app/components/vue-canvas/GeneratorsPanel.vue` |
| Toolbox contents | `frontend/app/data/toolbox-items.ts` |
| Capability kinds (studio/generator/effect) | `frontend/app/lib/agent/capabilities.ts` |
| Studio node sets | `frontend/app/lib/studio/cascade.ts` |
| Generator icons | `frontend/app/data/generator-icons.ts` |
