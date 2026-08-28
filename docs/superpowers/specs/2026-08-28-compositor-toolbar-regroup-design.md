# Compositor toolbar — collapse shapes, group by job

**Date:** 2026-08-28
**Status:** landed 2026-08-28 (`eb2900d0e` + `49a995341`; split face+chevron variant chosen — repeat stamping stays one click)
**Scope:** the bottom toolbar of `CompositorModal.vue` only. No behavior changes to any tool; this is chrome organization.

## Why

After Part B the bar carries the zoom cluster plus 17 targets. Five shape stamps each own a slot, import lives in two places (Add image, Import SVG), and the three AI flows sit ungrouped between drawing tools. Julien: "too much stuff going on — collapse the shapes into a menu, think about grouping."

## Design (Approach A — collapse by job, keep direct tools visible)

Bar order, left to right, with thin separators between groups:

1. **Zoom** cluster — unchanged (−, % menu, +).
2. **Select** (V).
3. **Undo · Redo** — separator after.
4. **T** (Add text) — stays top-level.
5. **Shapes ▾** — ONE button wearing the last-used shape's icon (Rectangle by default; not persisted across sessions). Menu rows: Rectangle, Ellipse, Line, Polygon, Star. Picking a row stamps that shape immediately AND becomes the button face, so repeat stamping is one click. Clicking the button face (not the chevron zone) stamps the current face directly; a small chevron affordance opens the menu. If a split face/chevron target is fiddly at 32px, the whole button opens the menu and the face is only a memory of last-used — implementer picks whichever reads cleanly, states which in the report.
6. **Pen** and **Brush** — stay visible (modal tools). Separator after.
7. **Insert ▾** — the existing Add-image menu gains an "Import SVG" row (same handler as the removed button). Button keeps the image icon.
8. **AI ✦ ▾** — one button; menu rows: AI vector, Generate in region, Smart select. Smart select renders disabled with its existing "select an image layer first" hint when not applicable. Each row keeps its existing tooltip text as a subtitle or title attr.
9. **Palette** (background/brand) — right end, unchanged.

Net: 17 buttons → 10 visible. Every collapsed item ≤ 2 clicks. All keyboard shortcuts unchanged (V, B, ⌘Z…). Menus follow the zoom menu's existing idiom (same glass styling, `@click.stop` wrapper, close on stage click-away, Escape closes — reuse the existing pattern/state shape rather than inventing a new one; the zoom menu is the reference implementation).

## Amendment 2026-08-28 — one grammar for every grouped control (approved: "generalize the shapes pattern")

The Shapes face+caret pattern becomes the toolbar's grammar for grouped controls:

- **AI ✦** becomes face+caret. Face = last-used flow's icon (AI vector by default, not persisted); face click re-enters that flow in one click; caret opens the three rows. When the last-used flow is Smart select and no image is selected, the face renders the same disabled state + hint as its row (caret always works).
- **Insert** becomes face+caret with an ANCHORED flyout (same idiom as Shapes) replacing the centered dialog as the first hop, in the modal only: rows Upload image · Pick from canvas… · Import SVG. Upload and Import SVG act immediately; "Pick from canvas…" opens the existing picker surface (the current centered popover's FillImagePicker) as the second hop. Face = last-used row (Upload default). The Frame card keeps its current centered AddImageSourcePopover unchanged (its overflow-clip constraint is why that dialog exists).
- Zoom keeps its existing form — its % readout is already its face.
- All faces reset per modal session (no persistence), matching Shapes. The shared exclusion (`closeToolbarMenus`) covers all flyouts.

Testing addendum: extend the toolbarMenus unit lists (AI + Insert rows + face reducers); live checks: AI face re-enters last-used flow one-click; disabled smart face state; Insert flyout rows act; Pick-from-canvas second hop opens the picker; card's popover unchanged.

## Non-goals

- No new tools, no removals — every current action stays reachable.
- No changes to the layers panel, inspector, or prompt pill.
- No persistence of last-used shape beyond the open modal session.

## Testing

- Unit: if the menu contents are data-driven (preferred — a small `TOOLBAR_SHAPES` / `TOOLBAR_AI` list), pin the lists and the last-used-face reducer. SFC-trapped click behavior is covered by the live pass.
- Live (Playwright on /dev/frame-lab, the established pattern): shapes menu opens, picking Star stamps a star AND the face becomes Star, second click stamps again without opening the menu (or per the chosen variant); Import SVG reachable under Insert; AI menu opens each flow; Smart select row disabled without an image selected; Escape/click-away close all menus; zoom menu unaffected.
