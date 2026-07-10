# Smart Layout — Sections as styleable frames (rename from Stack)

**Date:** 2026-07-10
**Surface:** Smart Layout v3 editor (`GridEditorShell` · `GridEditorCanvas` · `SectionInspector`) + shared resolver + satori renderer
**Harness:** `/dev/sl-modal`

## Problem / goal

Today there are two overlapping concepts:
- a **section** (`SectionV3`) — a group box with children; renders nothing itself, has no inspector.
- a **Stack** — a section with `layout` (auto-layout); has the `StackInspector` and the toolbar "Stack" button.

Unify them into one **Section** = a *frame inside a frame*: a box that groups children, with its own **fill · stroke · corner radius**, and **optional auto-layout**. Rename Stack → Section in the UI.

## Data model

Extend `SectionV3` (`shared/template-grid/types.ts`):

```
style?: { fill?: string; stroke?: string; strokeWidth?: number; radius?: number }
layout?: AutoLayout   // (existing) auto-layout — now toggleable, absent by default
```

`isLayoutStack(section)` stays (`layout != null`) as the "has auto-layout" predicate.

## Rendering — synthetic frame shape (no renderer change)

Sections are flattened at render time (`resolveFormat`, `resolve.ts:216` pushes only children).
The satori node builder (`v2ElementNode`, `translate.ts:315`) positions any resolved element
by its `rect` and renders `type: 'shape'` with `background` / `border` / `borderRadius`.

So: in `resolveFormat`, for each section that has a `style` with a fill or stroke, push a
**synthetic shape `ResolvedElement`** at the section's resolved rect, BEFORE its children
(template order = z-order → frame sits behind its children):

```
elements.push({
  el: { id: `${section.id}__frame`, type: 'shape', shape: 'rect', priority: 0,
        style: { fill, borderColor: stroke, borderWidth: strokeWidth, borderRadius: radius } },
  region: null, rect: sectionRect, culled: false, sectionFrame: true,
})
```

- `ResolvedElement` gains an optional `sectionFrame?: boolean` marker.
- Satori renders it via the existing shape path — **no `translate.ts` edit**.
- The section rect for the current format is `regionToRect(sectionRegionFor(...), metrics)` — already
  computed in both the auto-layout and absolute branches; reuse it.

## Editor canvas

`GridEditorCanvas` renders `resolved.elements` in order, so the frame shape draws behind its
children automatically. The frame element must be **non-interactive** (it's edited via the section
box, not as a standalone element):

- In the element loop, when `r.sectionFrame`, render just the shape visual with
  `pointer-events: none` and skip selection outline, resize handles, badges, context menu, dblclick.
- The existing `resolvedSections` overlay keeps drawing the section's **selection chrome** (dashed
  outline, name tab, resize handles) on top — unchanged.

## UI

- **Toolbar:** rename `Stack` → `Section` (icon: frame). Behaviour: wrap the current selection into a
  Section; with nothing selected, create an empty frame at a default region. New Section defaults:
  **auto-layout OFF, transparent fill, no stroke** (a plain frame).
- **Inspector:** `StackInspector` → `SectionInspector`, shown for **any** selected section
  (`selectedSection`, not only stacks):
  - **Fill** — colour / none.
  - **Stroke** — colour + width.
  - **Corner radius**.
  - **Auto-layout** toggle → when on, reveals the existing Direction / Gap / Padding / Align controls.
- Right panel: swap `selectedStack` → `selectedSection` for the inspector condition.

## Composable

- `setSectionStyle(id, patch)` — write `section.style`.
- `toggleSectionLayout(id, on)` — add a default `AutoLayout` (vertical) or delete `layout`.
- `wrapSelectionInSection()` / `addSection()` — create a plain frame (no layout) from selection or empty.
- Keep internal helpers (`wrapInStack`, `updateStackLayout`, `addChildToStack`, drag-reparent) as-is,
  exposed under section-named wrappers to limit churn.

## Slices

1. **Model + render:** `style` on `SectionV3`; synthetic frame in `resolveFormat`; `sectionFrame`
   flag; editor renders it non-interactively. Fill/stroke visible in editor + satori.
2. **Inspector + toolbar:** rename to Section; Fill/Stroke/Radius controls; auto-layout toggle;
   inspector shows for any section.

## Out of scope

- Nested sections (section inside a section) beyond what already works.
- Per-side stroke, gradients on stroke, shadow. (Fill already accepts any CSS colour/gradient via the
  shape path.)

## Verification

`/dev/sl-modal`: create a Section, give it a fill + stroke + radius → the frame draws behind its
children in the editor; render-true preview (and a real run) shows the same box. Toggle auto-layout
→ children reflow; toggle off → they keep positions. Switch formats → the frame + children reflow
together. Unit tests: synthetic frame emitted only when styled; `sectionFrame` flag; style setters.
