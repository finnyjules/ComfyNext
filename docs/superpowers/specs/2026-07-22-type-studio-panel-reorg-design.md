# Type Studio panel reorganization — design

**Date:** 2026-07-22
**Scope:** `frontend/app/lib/spacetype/sections.ts`, `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (+ its unit test). No effect files are touched — a parallel session holds an uncommitted refactor across all 26 `frontend/app/lib/spacetype/effects/*.ts` files, and the effect-side `group` declarations do not change.

## Problem

The Type Studio right panel grew organically:

- Section order is arbitrary: `Type` (the text content) comes second after `Path`; appearance sections are split into two clusters (`Occlusion/Look/Blend/Style` near the top, `Color/Stroke/Shadow` far below) with a dozen geometry sections between them. `Color` — the only section that is *always* visible (it hosts the surface-injected fill swatches) and the second-heaviest group in the catalog — sits 16th.
- Camera controls (Projection, Pan X/Y) are buried inside the effect-picker card.
- Motion controls are a collapsed section mid-list, while 3D Studio gives motion its own inspector tab.
- Actions ("Generate as image", "Generate as video", "Send to timeline") sit under the preview; saving only happens implicitly on close. 3D Studio's pattern — a sticky Save/Export footer pinned to the bottom of the controls column with a status line — is the house style.

## Design

### 1. Design | Motion tabs

A segmented tab control at the top of the controls column, identical in style to 3D Studio's Build|Motion tabs (`Scene3DStudioSurface.vue` ~line 1410). The VibeControlBar stays **above** the tabs.

- **Design tab:** effect card + all sections except `Motion`, in the new order below.
- **Motion tab:** the active effect's `Motion`-group controls, rendered open (not a collapsible section). If the effect has no Motion controls, show a muted note: "This effect has no motion parameters."
- Tab state is component-local (`ref<'design' | 'motion'>`), defaulting to Design; it does not persist.

### 2. Section order

New `SPACE_TYPE_SECTIONS` order (display order; the array contents are unchanged apart from the new `Camera` entry):

| Band | Sections |
|---|---|
| Framing | Camera · Transform |
| Content | Type · Color · Stroke |
| Shape & geometry | Path · Layout · Stack · Stretch · Skew · Warp · Ribbon · Spiral · Slice · Wave · Glitch · Doodles |
| Finish | Layers · Occlusion · Look · Style · Blend · Shadow |
| Export | Output (+ the surface-injected Post card, last) |

`Motion` remains a valid group name (the tab filters on it) so the guard test (`tests/unit/spacetype-sections.unit.spec.ts`) keeps passing for every effect.

Bands are conceptual only — no visible band labels in the panel.

- **Camera** is a new surface-injected section: Projection (perspective/isometric) + Pan X/Y move out of the effect card. It is hidden when `frontLocked` (same condition that hides those controls today). No effect declares `group: 'Camera'`.
- The effect card shrinks to: effect picker, Reset to defaults, Make as default (+ dev-only thumbnail capture).
- Default collapsed/open states carry over per section name; `Camera` starts collapsed (matching today, where the camera controls were minor card items).

### 3. Sticky footer (Save + Render)

Pinned to the bottom of the controls column, visible on both tabs — same construction as 3D Studio's footer (`sticky bottom-0 z-10 mt-auto border-t bg-[#0e0e10]`):

- Status line (right-aligned, above the buttons): render error text, else "Saved ✓" flash after Save.
- **Save** (secondary StudioButton): calls the existing `saveConfig()` explicitly and flashes "Saved ✓" (~1.5 s). Closing the studio still auto-saves as today.
- **Render** (primary StudioButton) opens a small anchored menu with three items: **Render as image** (`generateImage`), **Render as video** (`generateVideo`), **Send to timeline** (`sendToTimeline`). Disabled while `baking`; the button label shows "Generating…" while busy.
- The three old buttons in the `#actions` slot under the preview are removed. The `#actions` slot is left empty/omitted.

### 4. Error handling

- Render/bake errors keep their existing surfaces (the preview-overlay `renderError` banner; the video-encode alert). The footer status line shows only the "Saved ✓" flash — Type Studio has no `bakeError`-style ref to mirror, and duplicating the preview banner in the footer would be noise.
- The Render menu closes on selection, Escape, or outside click; Escape must not also close the studio when the menu is open (stop propagation, matching the existing modal Escape handling).

## Testing

- Update `tests/unit/spacetype-sections.unit.spec.ts` expectations if they encode order; the group-name guard is unaffected (`Motion` stays in the list, `Camera` is surface-only).
- Manual E2E via dev server: open Type Studio, verify tab switch, section order on a geometry-heavy effect (e.g. ribbon) and a minimal one (e.g. ticker), Camera section behavior with a front-locked effect, Save flash, all three Render menu actions reachable, footer stays pinned while scrolling.

## Out of scope

- Any change to effect files or control `group` assignments (parallel-session conflict).
- Merging sections (e.g. Look/Style/Blend into Color).
- Visible band labels.
- Persisting the active tab.
