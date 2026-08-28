# Frame: one species of layer + room to breathe

**Date:** 2026-08-27
**Status:** approved
**Scope:** CompositorModal-first (the modal is the real Frame editor; the inline card inherits what falls out for free)

## Why

Two structural causes make the Frame feel heavier than Figma:

1. **Two species of layer.** Wired layers (graph inputs, transforms stored as `layer{N}_*` widget values) and local layers (authored, stored in `sailor_localLayers`) never mix. Even in the modal, a wired image cannot join a multi-selection, be aligned, grouped, nudged, duplicated, or box-resized — uniform scale from center only. The Frame's most common content is its least manipulable.
2. **A letterboxed stage.** The modal's stage is clipped to the gap between the two side panels (`left-[272px] right-[320px]` + `overflow-hidden`, ~690px wide at a 1280px window) with a 48/56/92px matte inside that. Pan/zoom exists (wheel pan, pinch/⌘-wheel zoom, space-drag) but zoomed content crops at the panel edges instead of sliding under them, and nothing advertises the shortcuts. Content is ~21% of the window.

Decisions taken with Julien:
- Liveness is sacred: a wired layer must keep updating when upstream re-runs (no snapshot-on-arrival).
- Modal-first: the card stays preview + dive-in.
- Approach: unify the **data model** (one species), not per-verb adapters, not materialize-on-touch. Liveness is a property of the *content*, not the *transform*.

## Part A — one species of layer

### Data model

- `LocalLayer` gains a `wired` kind: `{ kind: 'wired', slot, x, y, w, h, rotation, opacity, blend, protect, groupId? }`.
- Wired layers live in `sailor_localLayers` and are ordered with normal `l:<id>` keys in `sailor_stackOrder`. The `w:<slot>` key form is retired after migration.
- The wire slot becomes a pure content feed. The layer owns transform, stacking, grouping, visibility, lock, name.

### Live content

- Paint resolves the slot's bitmap at draw time through the existing wired-feed machinery in `useCompositorLayers.ts` (`paintLayerStack` stays the single choke point). Upstream re-runs and live studio slots flow through unchanged.
- Aspect change on re-run: the layer keeps its center and width; height follows the new content aspect (preserves today's behavior).

### Verbs

- `selectedSlot` is retired. All selection goes through `selectedIds`; the modal's invisible pointer-target `<img>`s and the z-aware pixel hit test route to layer ids uniformly.
- Align, distribute, group/ungroup (nested), nudge, copy/paste, hide/lock/rename, drag-reorder in the layers panel, and 8-handle box-resize work on wired layers with no special cases.
- Amber handles retire. One cyan selection/handle system.
- **v1 exception:** ⌘D on a wired layer materializes a snapshot copy (existing copy-wired-into-frame path), not a second live reference. Two live layers on one slot cannot round-trip to the server renderer yet; forbid rather than silently drop from renders. Multi-reference is a v2 follow-up alongside the JSON-stack backend protocol.

### Backend parity

- The Python Compositor node keeps reading `layer{N}_*` widgets. The unified model does a **one-way write-through**: each wired layer's transform is mirrored into its slot's widgets on every mutation. Server Render is unchanged in v1.
- v2 (separate effort, not this spec): teach the node a serialized stack; delete the widget transform protocol.

### Migration

- Versioned: `data.properties.sailor_frameSchema = 2`.
- On first open of a frame without the flag: for each connected slot, synthesize a wired layer from the slot's widget transform, fold in `sailor_hiddenWired` / `sailor_lockedWired`, and replace `w:<slot>` stack-order keys with the new layer ids in place. Idempotent (guarded by the flag; re-running produces no duplicates).
- The write-through keeps widgets live, so the inline card, server render, and agent paths read correct values without their own migration.

### Edge cases

- Wire disconnected → the layer keeps its last-known bitmap, shows an "unlinked" badge; user can remove it or rewire the slot (rewiring the same slot re-links).
- Deleting a wired layer disconnects its edge (delete means delete in a one-species world). Undo restores both the layer and the edge.
- New edge lands on an empty slot → creates a wired layer at the default center placement, selected.

## Part B — room to breathe

- **Full-bleed stage.** The stage box spans the whole modal; the two glass panels keep their exact visual design but float over it. Zoomed content slides under panels; wheel/pinch/space-drag work anywhere that is not over a panel. Matte shrinks to a small constant.
- **Hideable chrome.** ⌘\ toggles both panels; state remembered per session. The zoom pill merges into the bottom toolbar; the prompt bar collapses to a pill until focused.
- **Legible navigation.** Zoom control becomes a menu: Fit (⌘0 refits to stage), 100%, zoom-to-selection (⌘2), with shortcut hints shown (pan/zoom stops being secret knowledge).

## Sequencing

Part A first, then Part B. B's layout surgery is safer once A has deleted the dual selection/handle code paths B would otherwise have to preserve.

## Testing

- Unit: migration idempotence (schema flag, no duplicate layers, stack-order key rewrite); write-through mirrors transform mutations to widgets; delete-disconnects-edge with undo restoring both.
- The dev harness `frontend/app/pages/dev/frame-lab.vue` mounts the real modal against a fixture node — extend its fixture with wired slots for browser verification.
- Browser pass (live, not synthetic-only): wire an image → select it together with a text layer → align, group, nudge, box-resize; re-run upstream and confirm the placed layer updates in place; render via the server path and confirm parity with the on-screen composite ("graceful fallback hides integration failure" — assert the real path ran).
- Known traps from memory: name-aware port schema sync at rehydration; `convertToLiteGraph` drops unknown `node.data` fields silently — verify `sailor_frameSchema` and wired-layer fields survive a save/reload round-trip.
