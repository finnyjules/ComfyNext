# Grouping in 3D Studio — design

**Date:** 2026-07-29
**Status:** Design approved — ready to plan
**Framing:** The first hierarchy in any Sailor studio. Scene3D's object list has been flat since it shipped; this gives it a tree, and gives the scene a way to say "these things are one thing."

## The idea in one line

Objects can be **grouped**: a group is an ordinary scene object with no geometry, and every object may name a `parentId`, so a logo, a rig, or a repeated cluster moves, rotates, scales and animates as a unit.

## Why now

This began as SVG import. A logo SVG is a dozen paths, and the decision to import it as one object per path — so each path keeps its own material, colour and motion — immediately runs into the fact that **3D Studio has no way to move twelve objects together**. Selection is a single id ([Scene3DStudioSurface.vue:78](../../../frontend/app/components/vue-canvas/Scene3DStudioSurface.vue)), object roots are added flat to the scene ([engine.ts:619](../../../frontend/app/lib/scene3d/engine.ts)), and the object list is a plain `v-for` with no nesting ([Scene3DStudioSurface.vue:1733](../../../frontend/app/components/vue-canvas/Scene3DStudioSurface.vue)).

So grouping is not SVG scaffolding. It is the missing primitive that SVG import happens to expose first, and it is worth building as a feature in its own right: two spheres and a light should be groupable the day this lands, with no SVG anywhere in sight.

**SVG import is a separate project, specified separately, and lands on top of this.** Nothing in this document is SVG-specific.

## What this is not

**Not a component or instance system.** A group is a transform container, not a reusable definition. Duplicating a group duplicates its children; there is no linkage between the copies.

**Not a layer or organisational folder.** Groups affect the scene graph — a group's transform composes into its children's. An empty group is legal but pointless.

**Not drag-to-reparent.** Reparenting happens through select-then-group and ungroup. The object list gains indentation and expand/collapse for *display*, not drop targets. Drag-and-drop reparenting is a plausible follow-up, deliberately excluded here.

## Data model

`doc.objects` **stays a flat array.** Hierarchy is expressed by reference, not by nesting. This is the decision the whole design rests on, and it is worth stating why.

Eight modules read `doc.objects` — [engine.ts](../../../frontend/app/lib/scene3d/engine.ts), [motion/apply.ts](../../../frontend/app/lib/scene3d/motion/apply.ts), [motion/render.ts](../../../frontend/app/lib/scene3d/motion/render.ts), [motion/defaults.ts](../../../frontend/app/lib/scene3d/motion/defaults.ts), [agentControls.ts](../../../frontend/app/lib/scene3d/agentControls.ts), [config.ts](../../../frontend/app/lib/scene3d/config.ts), and both surface components. Nested `children` arrays would force every one of them to learn recursion, and would break the `objects.<id>.motion.*` agent path scheme ([apply.ts:16](../../../frontend/app/lib/scene3d/motion/apply.ts)) that assumes a flat id space. A flat array plus a parent reference leaves seven of the eight untouched.

Two additions to [config.ts](../../../frontend/app/lib/scene3d/config.ts):

```ts
export interface SceneObjectBase {
  // ...existing fields
  /** Parent object id. Absent = top-level. A group's transform composes into
   *  its children's via the three scene graph — see the engine section. */
  parentId?: string
}

export interface GroupObject extends SceneObjectBase {
  kind: 'group'
}

export type SceneObject = PrimitiveObject | GlbObject | LightObject | GroupObject
```

`GroupObject` adds no fields of its own. It carries `material` from the base like every object, and like `LightObject` never renders it — `createGroup` stamps `DEFAULT_MATERIAL` and nothing reads it.

### Parser invariants

[config.ts:664](../../../frontend/app/lib/scene3d/config.ts) parses objects with a `flatMap` that **silently drops unknown kinds**. That is the right behaviour for forward compatibility, but it means an older build opening a newer doc deletes the groups and leaves children pointing at ids that no longer exist. Two invariants make that survivable, and both belong in the parser rather than at call sites:

1. **A `parentId` that resolves to no object in the doc is dropped.** Orphans surface at the root rather than vanishing or dangling. This is what saves a doc that has been through an older build.
2. **Cycles are broken at parse time.** Walk ancestors from each object; on revisiting an id, drop the `parentId` that closed the loop. A hand-edited, agent-written or round-tripped doc must never be able to hang the engine in an infinite walk.

Both are cheap (one pass with a `Set`) and both are unit-tested.

`version` stays `1`. Both additions are optional, so every existing doc loads unchanged with every object at the root.

## Engine

The change in `syncObject` ([engine.ts:619](../../../frontend/app/lib/scene3d/engine.ts)) is one line in spirit: instead of `this.scene.add(root)` unconditionally, add the root to its parent's root when `parentId` resolves, falling back to the scene. Three's scene graph composes the transforms — **no matrix maths of our own on the render path.**

Three consequences need real work.

**Sync order.** A child cannot be added to a parent root that does not exist yet, so the sync pass iterates parents-first. A topological ordering over `parentId` (Kahn's algorithm, or a memoised depth sort — depth sort is simpler and the cycle invariant guarantees it terminates). Reparenting is then just a re-add on the next sync, since `Object3D.add` removes from the previous parent automatically.

**`baseSizeFor()`** ([engine.ts:195](../../../frontend/app/lib/scene3d/engine.ts)) builds a geometry, measures its bounding box, and disposes it. A group has no geometry. It needs a separate path: `new THREE.Box3().setFromObject(root)` over the live subtree, which is also what makes the Size row meaningful for a group. Note this is a *live-scene* measurement where the primitive path is pure — the function signature has to accommodate both, so the group case takes the engine's root rather than rebuilding from the doc.

**Selection outlines** ([outlines.ts](../../../frontend/app/lib/scene3d/outlines.ts)) wrap a mesh. Selecting a group must outline its whole subtree.

Two smaller ones, both easy to get wrong:

- `sourceKey` gains a `group:` case so a retyped id tears down correctly.
- **`disposeTree` must not dispose a child object's geometry when a group root is removed.** Children are independent doc objects with their own roots and their own lifecycle; a group teardown that walks into them disposes GPU resources still referenced by `objectRoots`. The group's own teardown detaches children first (re-adding them to the scene or their new parent), then disposes only its own — empty — root.
- `sceneHasShaderFill` ([config.ts:222](../../../frontend/app/lib/scene3d/config.ts)) must skip `group` exactly as it skips `light`, or a group's unused `DEFAULT_MATERIAL` could switch on the per-frame shader-field readback for a scene that needs none.

### What comes free

**Motion needs no changes.** [apply.ts:63](../../../frontend/app/lib/scene3d/motion/apply.ts) writes additive deltas onto `obj.position` / `obj.rotation` / `obj.scale`. A group is an object, so it already has `motion`, already appears in the timeline, and animating it moves its children through the scene graph. Group motion is a capability this design acquires by accident rather than by construction — which is the sign the representation is right.

**Agent control needs no changes.** `objects.<id>.position` resolves against a flat id space that stays flat. A group is addressable the moment it exists.

**Visibility and delete cascade.** `root.visible = obj.visible` already hides a three subtree. Deleting a group deletes its descendants (computed from the flat array).

## Multi-select

Grouping needs a way to select several objects, and 3D Studio has none. This is the largest piece of UI work in the project.

`selectedId: ref<string | null>` becomes `selectedIds: ref<string[]>`, ordered, with the **last entry as the primary** (the anchor — what the properties panel titles itself after, and what the gizmo pivots on for a single selection). A `selectedId` computed returning the last entry keeps every existing consumer working unchanged; there are a dozen references and rewriting them all is churn for nothing.

- Shift-click or Cmd-click toggles membership, in the viewport ([interaction.ts](../../../frontend/app/lib/scene3d/interaction.ts) `onSelect`) and in the object list.
- Plain click replaces the selection, as everywhere else.
- **Clicking a child selects the child, not the group.** Groups are selected from the object list. Escape steps the selection up to the parent group when a child is selected, and clears the selection when a root object is. No enter-to-descend, and no deeper traversal model than that single step.

Escape currently clears the selection unconditionally ([Scene3DStudioSurface.vue:1277](../../../frontend/app/components/vue-canvas/Scene3DStudioSurface.vue)); the step-up case is a new branch ahead of it, not a replacement.

**The gizmo.** `TransformControls` attaches to exactly one `Object3D`. For a multi-selection, create a transient pivot `Object3D` at the selection's bounds centre, `Object3D.attach()` each selected root to it — `attach` preserves world transform, which is the entire trick — drive the pivot with the gizmo, then on drag end `attach` each root back to its real parent and write the resulting local transforms into the doc. No hand-rolled delta maths, and it is correct under rotated and scaled ancestors for free.

The pivot is transient: created on drag start, destroyed on drag end. It never enters `doc.objects` and never persists.

**The properties panel** shows the common editable subset for a multi-selection. Transform rows write the same delta to every selected object; **material edits write the full material to every selected object.** That is the answer to "make the whole logo gold" — no group-level material, no effective-material resolution chain in the engine, and each object keeps its own material afterward so one can still be tweaked alone.

## Group and ungroup

**Cmd+G** — group the current selection:

1. Create a `GroupObject` positioned at the selection's world bounds centre, rotation `[0,0,0]`, scale `[1,1,1]`.
2. Its `parentId` is the primary selection's `parentId`, so grouping inside an existing group nests rather than escaping to the root.
3. Each selected object's `parentId` becomes the new group's id, and its transform is rebased to preserve its world transform.
4. The new group becomes the selection.

**Cmd+Shift+G** — ungroup: each child's `parentId` becomes the group's `parentId`, transforms rebased to preserve world transforms, the group object is removed, and the freed children become the selection.

**Rebasing uses world-matrix decomposition, not subtraction.** A group created at identity rotation and scale makes naive subtraction *look* correct, and it stays correct right up until someone rotates that group and then drags another object into it — at which point the child lands somewhere wrong in a way that is very hard to attribute. Compose the child's world matrix, multiply by the inverse of the new parent's world matrix, decompose into position/quaternion/scale, write Euler back. The engine's live roots already carry accurate world matrices, so this reads them rather than recomputing from the doc.

Groups nest arbitrarily. The parser's cycle invariant is the only depth guard, and it is sufficient — there is no meaningful maximum depth to enforce.

## Object list

Renders as a tree from the flat array: roots are objects with no `parentId`, children resolved by lookup, **array order preserved within each level** so existing ordering semantics survive.

- Indentation per depth level, chevron to expand/collapse.
- Group rows show a child count.
- Expand/collapse state is local UI state, not doc state — it should not dirty the document or sync across windows.
- Delete on a group deletes its subtree, with the row's existing trash affordance ([Scene3DStudioSurface.vue:1745](../../../frontend/app/components/vue-canvas/Scene3DStudioSurface.vue)).

## Testing

Unit, extending [tests/unit/scene3d-config.unit.spec.ts](../../../frontend/tests/unit/scene3d-config.unit.spec.ts):

- A `parentId` referencing a missing object parses to root.
- A two-object cycle, and a three-object cycle, both parse to a broken chain rather than hanging.
- A group round-trips through parse unchanged.
- Sync ordering emits parents before children for a shuffled input array.
- `baseSizeFor` on a group returns the subtree bounds.
- **The property that matters most: group-then-ungroup leaves every child's world transform unchanged** — including with a rotated and non-uniformly scaled ancestor, which is the case naive subtraction fails.
- `sceneHasShaderFill` returns false for a scene of groups.

The existing `PRIM_GROUPS` drift test is unaffected: `group` is a `SceneObject` kind, not a `PrimitiveKind`, so the add-menu coverage assertion does not change.

E2E: there is no Scene3D browser suite today — [tests/shader-fill.spec.ts](../../../frontend/tests/shader-fill.spec.ts) is the closest harness (it opens a blank workflow without waiting on `networkidle`, since the app polls `/system_stats` continuously against a live backend) and this spec's setup should be modelled on it. The test adds two primitives, groups them, moves the group, ungroups, and asserts both world positions held.

**A deliberately-broken control must fail that test, or it proves nothing** — rebase by subtraction under a rotated parent and confirm the assertion goes red before wiring up the real decomposition. Grouping is exactly the kind of feature where the viewport looks plausible while the maths is wrong.

## Risks

**Attach/detach jitter.** The pivot trick mutates the scene graph mid-interaction. If `TransformControls` caches the attached object's matrix across a drag, the first frame after attach can pop. Mitigation: attach on drag *start* before the first delta, never mid-drag.

**Dispose reaching into children.** Called out above because it is the failure mode that produces a blank viewport with no error — the child's geometry is freed while `objectRoots` still holds the root.

**Selection widening leaks.** `selectedId` is read in about a dozen places; the computed shim keeps them working, but any place that *writes* `selectedId` needs converting. A missed writer silently collapses multi-selection to one.

## Follow-ups, explicitly not in this project

- SVG import (its own spec, lands on this).
- Drag-to-reparent in the object list.
- Marquee selection in the viewport.
- Group-level material override.
- Enter-to-descend / Escape-to-ascend selection traversal beyond the single Escape step.
