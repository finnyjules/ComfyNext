# Frame/Compositor: text typography controls + nested groups

Built overnight 2026-07-01 in response to the Figma-parity gap review. Two features,
both **additive** — absent/legacy data renders byte-identically to before.
Left **uncommitted on `main`** for your sign-off (your usual pattern).

## 1. Text typography controls

Closes the "text controls are thin" gap. Added to `TextLayer`, all optional:
`letterSpacing` (em), `underline`, `strikethrough`, `textTransform` (uppercase /
lowercase / capitalize). The stored `text` is never mutated by the case transform,
so inline editing round-trips.

- **Model + render**: `app/composables/useCompositorLayers.ts`
  - `letterSpacing` set once in `applyFont` (the single measure/draw choke point),
    so wrap/box math stays correct automatically. Reset to `0px` each call so it
    can't leak between layers. Uses the same `ctx.letterSpacing` path already in
    `useKineticRenderer`/`textOnPath`.
  - case transform applied in `textLines()` (feeds both measurement and draw).
  - underline/strikethrough drawn as `fillRect`s per line in `drawText`, in the
    text's own fill (so they pick up gradient/pattern fills). Underline sits at
    `+0.34·fontPx`, strike near the middle.
  - Because bake goes through the same renderer, exports match the preview.
- **Inspector UI**: `CompositorModal.vue` — new Line-height + Letter-spacing row and
  a Style row (underline / strikethrough / AB·ab·Aa case toggles). *(Line height
  had no control before; added it while here.)*
- **Inline-edit CSS**: matching `letterSpacing`/`textTransform`/`textDecoration`
  added to the contenteditable style in both `CompositorModal.vue` and
  `ArtifactFrameNode.vue`, so on-canvas editing looks like the render.
- **Tests**: `tests/unit/text-controls.unit.spec.ts` (10, passing).

## 2. Nested groups

Closes the "one level of groups" gap. **Key insight:** the paint stack is a flat
z-ordered array — rendering never consults groups — so nesting is purely an editor
concern (panel + selection + move). No renderer changes.

**Model (additive, no migration):** layers keep their flat immediate `groupId`;
nesting comes from a new registry `comfynext_localGroups: { id, name?, parentId? }[]`.
A group gets nested by changing only its *parent link* — member layers are never
rewritten. Old frames (layers with `groupId`, no registry) read as flat root groups
and look identical.

- **Pure helpers + tests**: `app/lib/compositor/layerGroups.ts` +
  `tests/unit/layer-groups.unit.spec.ts` (30, passing). Tree relations, cycle
  guards, `createGroupFromSelection` (fully-selected groups nest; loose/partial
  layers become direct members), `dissolveGroup` (promote one level),
  rename/reparent, `pruneEmptyGroups`.
- **Editor wiring**: `useLocalLayerEditor.ts` — registry read/write + undo history,
  `groupSiblings` now selects the outermost group, group/ungroup/select/rename are
  nesting-aware, `selectGroupById`, deletes prune the registry.
- **Panel**: `CompositorModal.vue` rewritten from 2-level to a recursive depth-tagged
  tree — expand/collapse, select, rename, ungroup, delete at any depth; drag reorder
  keeps working and now re-nests (cycle-guarded).

**Primary way to nest:** multi-select + Group (fully tested). Drag-to-reparent in
the panel also works but is the less-exercised path — worth a hands-on poke.

## Verification

- Unit: 40 new tests pass; full suite 1876 pass. The only 2 failures
  (`spacetype-palette.unit.spec.ts`) are **pre-existing on clean `main`** (confirmed
  by stashing) and unrelated to this work.
- Visual: dev harness at **`/dev/frame-lab`** (`app/pages/dev/frame-lab.vue`) mounts
  the real `CompositorModal` with a fixture. Confirmed via screenshots: tracking /
  underline / strikethrough / UPPERCASE / capitalize+combo all render; inspector
  controls bind correctly (Letter spacing showed 0.3 for the tracked layer); live
  underline toggle updated the canvas; panel showed `Header · 3 → Side · 1 + Row · 2`
  with correct indentation and per-group chevrons/counts. No console errors from this
  code. (Reach the harness at `http://127.0.0.1:<port>/dev/frame-lab` — `localhost`
  hits the IPv6 426 gotcha.)

## Files
- `app/composables/useCompositorLayers.ts` (text model + render)
- `app/composables/useLocalLayerEditor.ts` (group registry + ops)
- `app/lib/compositor/layerGroups.ts` (new — pure helpers)
- `app/components/vue-canvas/CompositorModal.vue` (inspector + recursive panel)
- `app/components/vue-canvas/ArtifactFrameNode.vue` (inline-edit CSS)
- `app/pages/dev/frame-lab.vue` (new — dev harness; delete if unwanted)
- `tests/unit/text-controls.unit.spec.ts`, `tests/unit/layer-groups.unit.spec.ts` (new)

## Not done (deliberately scoped out)
- Text-on-path already exists as a separate widget; not folded into TextLayer.
- Auto-layout / constraints (the other big Figma gap) — separate, larger effort.
- Variable-font axis picker still stored-but-not-exposed.
