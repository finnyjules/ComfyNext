# Scene3D Decals — image & text stamped onto solids

**Date:** 2026-08-14
**Status:** Approved direction (user asked for decals + confirmed text should ride the same pipeline)

## Plain-language summary

Today, putting a logo or a label on a 3D object means creating a separate floating object and eyeballing it against the face. This feature adds **decals**: you pick an image (or type some text), click a spot on the object, and the picture/text is stamped onto the surface like a sticker — it hugs the surface, respects transparency, and moves with the object. Text decals are flat printed labels (the existing extruded 3D Text stays for when you want depth).

## Scope

- New SceneObject kind `'decal'` in the 3D Studio.
- Two content types: **image** (uploaded PNG/JPG, alpha respected) and **text** (string + Google/library font + color, rendered to a canvas texture).
- Click-to-place on a solid's surface (primitives, GLBs, mesh kind). Reposition by re-clicking; size/spin/depth/opacity via panel sliders.
- Decals follow their target through moves/rotations/grouping, survive save/reload, and appear in headless bakes (Render button) for free.

Out of scope (fast-follows): drag-on-surface repositioning, SVG decal content, agent expressibility, decal-specific motion.

## Approach chosen

**THREE `DecalGeometry` (three/examples/jsm, import with `.js` extension per repo style) built in target-local space, parented under the target's root.**

Alternatives considered:
- *World-space bake with reprojection on every target move* — rejected: needs per-frame reprojection during gizmo drags.
- *UV-transform on the material* — rejected: can't bound the image to part of a face, no alpha cut-out, wraps all faces.

The local-space trick: temporarily treat the target mesh's world matrix as identity, build the `DecalGeometry` from decal position/orientation expressed in **target-local space**, then parent the decal mesh under the target root. The decal then follows the target for free; rebuilds are only needed when the decal's own params change or the target's **geometry** changes (tracked by the existing `geoKey`).

## Data model (`config.ts`)

Follow the `LightObject` precedent — flat fields on the base:

```ts
interface DecalObject extends SceneObjectBase {
  kind: 'decal'
  targetId: string            // the solid it is stamped on
  content:
    | { type: 'image'; image: string }        // input-dir filename, same as image material
    | { type: 'text'; text: string; font: string; color: string }  // font = google:Fam@W | local:id
  // base fields reinterpreted:
  // position = projection point, TARGET-LOCAL space
  // rotation = projector orientation (euler), target-local; z-spin is the user's "rotation" slider
  // scale.x/.y = decal width/height in world units; scale.z = projection depth
  opacity: number             // 0..1
}
```

- `parentId` is set to `targetId` at creation so the hierarchy panel nests decals under their solid and `worldMatrixOf` stays truthful.
- Factory `createDecal(target, hit, content, existing)` next to `createLight` (config.ts:591); defaults: size 0.5×(0.5/aspect), depth 0.25, opacity 1, text "LABEL" / Inter 700 / near-black.
- `parseDoc` gets a `kind === 'decal'` branch (unrecognised kinds are silently dropped — config.ts:854-901) with a tolerant `parseDecalContent` sub-parser. Drop a decal whose `targetId` no longer resolves.
- `sceneHasShaderFill` / `sceneHasOpalFlow` early-return false for `'decal'`.

## Engine (`engine.ts`)

- `syncObject` `sourceKey` gains `'decal'`; creation branch builds a `THREE.Group` root registered in `objectRoots` with `userData.sceneId` (so raycast-select resolves the **decal**, not the target — the pick walk stops at the first `sceneId`).
- The decal mesh is added under the **target's** root (looked up via `objectRoots.get(targetId)`). Because `orderParentsFirst` + `parentId = targetId` guarantees the target syncs first, the lookup is safe; if the target is missing (mid-delete), render nothing this sync.
- Rebuild key: hash of (content, position, rotation, scale, target `geoKey`). Stamped on `userData.decalKey`; mismatch → dispose + rebuild, following the async-token pattern used by fonts/GLBs (`root.userData.primObj` stamp) since image/font loads are async.
- Material: `MeshStandardMaterial { map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, opacity }`. Texture from the existing `getImageTexture` loader for images; for text, `makeTextTexture` from `spacetype/textTexture.ts` after a css2 `document.fonts.load` (the `ensureSpaceTypeFont` pattern). **Strip 8-digit-hex alpha before `new THREE.Color`** (known gotcha).
- Do **not** set `userData.isLight` (depth-bounds fitting in passes.ts must include decals); nothing else needed for bakes — rebake just re-runs `syncFromDoc` + `renderPasses`.
- Target geometry change (e.g. sculpt, param edit) → target `geoKey` changes → decal key mismatches → reprojects. Target deleted → its decals are deleted from the doc (cascade in the surface's delete handler).

## Placement interaction (`interaction.ts` + surface)

- New one-shot **placement mode**: surface sets `placingDecal = { content }`, canvas cursor becomes crosshair; next click raycasts against solid roots only (exclude lights/decals/gizmo helpers). On hit: convert hit point + face normal into target-local space, create the `DecalObject`, exit mode, select it. Escape/right-click cancels.
- Selection: decals are selectable and appear in the object list; the transform gizmo **detaches** for decals (extend the existing `isLight`-style opt-out at interaction.ts:618-624) — repositioning is via the panel's "Reposition" button (re-enters placement mode targeting the same decal) plus sliders.

## Studio panel (`Scene3DStudioSurface.vue` + `Scene3DObjectRow.vue`)

- Toolbar: a "Decal" add-group with two buttons — **Image** (file pick → placement mode) and **Text** (placement mode immediately, default text). Follow the lights toolbar pattern (:3199).
- Object row icon: extend the kind ternary in `Scene3DObjectRow.vue:29-30` (Sticker icon).
- New `StudioSection` gated on `selectedIsDecal` (model: the Light section :4022):
  - Image content: thumbnail + Replace button (reuse `onTexFilePicked` flow).
  - Text content: text input, FontPicker, StudioColor swatch.
  - Shared: Size (width slider; height follows texture aspect), Spin (z-rotation, degrees), Depth, Opacity, **Reposition** button.
- Duplicate: per-kind field spread branch (template: light branch :2743-2747); duplicated decal keeps the same target, offset spin slightly so it's visibly a copy.
- Delete of a target object also deletes objects with `targetId === deletedId`.

## Persistence

Scene state serialises whole-doc via `serializeDoc` into the `scene_state` widget — widgets survive `convertToLiteGraph` (curated map includes `widgets_values`), so **no `useVueNodes.ts` change**. The only persistence work is the `parseDoc` branch above.

## Error handling

- Missing/failed image or font load → render nothing for that decal (no placeholder mesh), keep the doc entry so a later successful load recovers; console.warn once.
- Decal whose target lost its mesh (e.g. GLB still loading) → skip this sync, retry on next (the target's async completion triggers `syncObject` again).

## Testing

- Unit (vitest): `parseDoc` round-trip for both content types; unknown-target drop; `createDecal` local-space math (world hit → target-local point/orientation) against hand-computed cases; rebuild-key stability (same params → same key, target geoKey change → new key).
- E2E (browser, `sailor:addNode` repro): create a box, place an image decal via clicked coordinates, assert a mesh with decal `sceneId` exists under the box root and survives serialize→parse→resync; move the box and assert the decal's world position moved with it (the graceful-fallback lesson: assert the path ran, don't just "it rendered").
- Broken control: revert the local-space projection (build against real world matrix) and confirm the follow-the-target E2E fails.
