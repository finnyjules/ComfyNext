# 3D Studio add-toolbar — face+caret grammar (ported from the Frame toolbar)

**Date:** 2026-08-28
**Status:** approved (Julien: "apply our actions on the frame toolbar to the 3d studio toolbar")
**Scope:** the bottom add-pill of `Scene3DStudioSurface.vue` (~:3320-3440). No behavior changes to what the entries do.

## Design

The Frame toolbar's grammar, adapted to this pill's labeled style (keep the pill look — labels stay, this is a studio pill, not the modal's icon bar):

- **Primitive** → face+caret. Face shows the last-used primitive's icon+label (default: Box) and adds it in one click via the existing `pickPrimitive`/`addPrimitive` path; caret opens the existing grouped grid menu (`PRIM_GROUPS`) unchanged. Picking from the menu adds AND becomes the face.
- **Light** → face+caret. Face = last-used light kind (default: the first of `LIGHT_KINDS`), one-click `addLight(kind)`; caret opens the existing list.
- **Decal** → face+caret. Face = last-used decal entry (default: Text label), one click re-runs it — for decals that means re-ARMING the same placement (`addTextDecal` / `triggerDecalImageAdd`), matching today's entries; caret opens the existing two-row menu.
- **Upload GLB** stays a direct button (no menu, no face). **Generate** stays a plain toggle (it opens a flow panel, not a pick list) — no caret.
- Faces are plain refs, reset per studio session (no persistence) — same rule as the Frame.
- One shared `closeAddMenus()` replaces the four hand-rolled `x = false; y = false; …` chains; every toggle goes close-then-open; the existing outside-pointerdown and Escape closers route through it. Caret affordance: a small chevron zone per Frame's split-button pattern (two real buttons: face + caret), styled to the pill idiom.

## Non-goals

Menu contents, placement flows, Generate flow, Motion-mode hiding, and the pill's position/styling all stay as they are.

## Testing

- Pure seams (kind→icon/label tables, face reducers) live in a small module (or extend `toolbarMenus.ts` if it fits) with unit tests pinning defaults + last-used updates.
- Live (Playwright, real app — the studio opens from a canvas node): add Box via menu → face becomes Box → face click adds a second box (object count +1, one click); same for a light kind; Decal face re-arms text placement (placement state armed, Escape cancels); exclusion across the four popups; Escape closes; Upload GLB/Generate unchanged.
