# Scene3D — user-placeable lights + Light View

**Date:** 2026-07-20
**Status:** Design approved, implementing

## Problem

The 3D Studio has a single fixed "sun" (directional) + ambient + presets. Users can't add
their own lights, and — the bigger pain — even if they could, mainstream 3D tools make lights
*invisible math*: you can't see where a light is, how strong it is, or which way it points.

Two goals, one feature:
1. **Add lights** — user-placeable Point / Spot / Area (rect) lights that light the scene.
2. **Light View** — a viewport mode that makes lighting *legible*: where each light is, how
   strong, and its direction, shown explicitly with widgets, and objects re-shaded to matte
   clay so you read the light, not the material.

## Architecture

Lights are a **new scene-object kind**, `LightObject` (`kind: 'light'`), living in the same
`doc.objects` array as primitives/GLBs. This reuses the Objects list, id-diffing
(`syncFromDoc`), click-to-select raycasting, the move/rotate gizmo, visibility, and save/load.
The existing sun + ambient + presets stay as the **base rig**; user lights add on top.

Because `SceneObjectBase.material` is required and many call sites read `.material`
unconditionally, `LightObject` carries a **dummy default material** (the same pattern
`GlbObject` already uses) rather than refactoring the base — low-risk, and the material UI is
gated on `selectedIsPrimitive` so it never shows for a light.

### Data model (`config.ts`)

```ts
export type LightKind = 'point' | 'spot' | 'rect'
export interface LightObject extends SceneObjectBase {
  kind: 'light'
  light: LightKind
  color: string
  intensity: number
  distance?: number   // point/spot: range, 0 = infinite
  decay?: number      // point/spot: physical falloff (default 2)
  angle?: number      // spot: cone half-angle (rad)
  penumbra?: number   // spot: 0–1 edge softness
  width?: number      // rect
  height?: number     // rect
  castShadow?: boolean // point/spot only (rect can't in three.js)
}
export type SceneObject = PrimitiveObject | GlbObject | LightObject
export const LIGHT_KINDS: LightKind[] = ['point', 'spot', 'rect']
export const LIGHT_DEFAULTS = { color: '#ffffff', intensity: 8, distance: 0, decay: 2,
  angle: Math.PI / 6, penumbra: 0.3, width: 2, height: 2, castShadow: false }
```

- `createLight(kind, existing)` mirrors `createPrimitive` — `newId()`, `numberedName`,
  a **default position offset from origin** (e.g. `[2.5, 3, 2.5]`) so a new light isn't buried
  in the object, `material: { ...DEFAULT_MATERIAL }` (dummy), and the per-kind light defaults.
- `parseDoc`: add a `kind === 'light'` branch (validating `o.light ∈ LIGHT_KINDS`, clamping
  numerics with the existing `num()`/`str()` helpers) **between** the glb and primitive
  branches. `serializeDoc` is plain `JSON.stringify` — no change.
- **Do NOT** add lights to `PRIMITIVE_KINDS`/`PRIM_GROUPS` — unit tests pin those to the
  primitive set exactly. Lights use their own `LIGHT_KINDS` list and menu.

### Engine (`engine.ts`)

- Call `RectAreaLightUniformsLib.init()` once in the `SceneEngine` constructor (rect lights
  need it; only affects standard/physical materials, which the studio uses).
- A shared **clay material** (`MeshStandardMaterial`, mid-grey, roughness ~0.85, metalness 0)
  and a `lightView: boolean` flag with `setLightView(on)`. When on, `syncObject` assigns the
  clay material to object **meshes** instead of their real material (real material still built
  so toggle-off restores it); grid/helpers/widgets keep their own materials (so this is a
  per-object swap, **not** `scene.overrideMaterial`, which would clay the grid too).
- `syncObject` gains a `kind === 'light'` build branch: `sourceKey = 'light:' + light` (so
  changing light type rebuilds); create `THREE.PointLight` / `SpotLight` / `RectAreaLight` as
  the root, stamp `userData.sceneId`/`sourceKey`, add a small **invisible pick-proxy** (a tiny
  sphere mesh) to the root so raycast selection has a reliable target, add to `scene`, track in
  `objectRoots`. A spotlight's `.target` is added to the scene and positioned along the light's
  local forward each sync. The existing primitive tail is already guarded by
  `if (obj.kind === 'primitive')`, so lights fall through; live property updates go in a new
  `else if (obj.kind === 'light')` block (color/intensity/distance/decay/angle/penumbra/
  width/height/castShadow, all mutated in place — no rebuild for slider moves).
- Disposal: lights have no geometry, but the pick-proxy and any helper geometry must be
  disposed — extend `disposeTree` handling or dispose explicitly.

### Export safety (`passes.ts`)

Editor-only exclusion already works via a `userData.isGizmoHelper` flag that `renderPasses`
hides (it scans **direct** `scene.children`). Therefore:
- Light **widgets/helpers** (Light-View viz, pick-proxies made visible, labels' 3D anchors) are
  stamped `userData.isGizmoHelper = true` and added as **direct scene children** (three's light
  helpers are designed to be scene children and auto-follow their light), so they vanish from
  beauty/depth/normal automatically. (If any must be a child of the light root, broaden the
  `passes.ts` filter to a recursive traverse.)
- Exclude **light roots** from the depth-fit bounds loop (`bounds.expandByObject` over
  `objectRoots`) so a far-away light doesn't blow out the depth near/far.
- Clay is editor-only (a `lightView` render mode); export always renders real materials — the
  bake path calls the engine with `lightView` forced off (or clay simply isn't applied in the
  pass, which clones the camera and renders the live scene — ensure `setLightView(false)`
  around bake, then restore).

### Interaction / gizmo (`interaction.ts`)

- Selection already raycasts `objectRoots` recursively and walks parents to `userData.sceneId`
  — the pick-proxy on the light root makes lights selectable.
- The combined gizmo attaches scale+translate+rotate uniformly. Tag each instance with its
  `mode`, pass the selected object (or its `kind`) into `select()`, and **skip the scale
  instance for lights** (scale is meaningless; rect uses width/height sliders). Translate for
  all lights; rotate for spot/rect (to aim them).

## Light View (the centerpiece)

A toggle in the viewport top-left toolbar (beside "snap"), plus **auto-enter when the user adds
their first light**. When ON:

1. **Objects → matte clay** (engine `setLightView(true)`), restored on toggle-off.
2. **Per-light widgets** (a `lightWidgets.ts` module builds a `THREE.Group` per light, stamped
   `isGizmoHelper`, shown only in Light View):
   - **Where:** a bright color-tinted icon at the light's position.
   - **How strong:** a ring/glow whose radius scales with intensity (log-mapped, clamped);
     Point/Spot also draw a translucent **falloff sphere** at `distance` (or an indicative
     radius when `distance = 0`).
   - **Direction:** Spot → a wireframe **cone** at its real `angle` + an axis arrow; Rect → the
     **rectangle** (width×height) + a normal arrow; Point → short **radiating rays**. An **aim
     line** from the light toward the scene origin.
   - **Selected** light shows full detail at full opacity; **unselected** lights dim (reduced
     opacity, rings hidden) so it stays readable.
3. **HTML labels** (Vue overlay over `viewportEl`, `@pointerdown.stop`): each light's world
   position projected through `engine.camera` to screen → a small chip with **name + live
   intensity** (e.g. "Spot · 3.2"), color-dotted. Hidden when Light View is off or the light is
   behind the camera.

Widgets update when a light changes or the camera moves; labels update each frame with the
camera.

## Scope guard

Cap at **8 user lights**. `addLight` beyond the cap shows a brief message and no-ops.

## Persistence

`LightObject` is plain JSON in `objects`; `parseDoc` validates/defaults it. Scenes saved before
this change have no lights → identical. `serializeDoc` unchanged.

## Build order (phased tasks)

- **Phase A — lights light the scene:** ① model + `createLight` + `parseDoc` + config tests;
  ② engine light factory/sync + clay flag + `RectAreaLightUniformsLib.init` + light unit tests;
  ③ selectable pick-proxy + `isGizmoHelper` widgets excluded from passes + depth-bounds skip.
- **Phase B — usable UI:** ④ Add-Light menu + `addLight` + `duplicateObject`/list-icon +
  per-light controls + hide Size for lights; ⑤ gizmo scale-suppression for lights.
- **Phase C — Light View:** ⑥ toggle + clay wiring + auto-enter; ⑦ `lightWidgets.ts` viz
  (falloff/cone/rect/arrow/intensity/dimming); ⑧ HTML label overlay.
- **Phase D — polish + verify:** ⑨ 8-light cap + shadow toggles + full suite + browser
  verification (each type; position; Light View reads clearly; export excludes widgets).

## Testing

- **config:** light round-trips through parse/serialize; defaults + clamps; `createLight` gives
  the right kind/fields/id/name; old docs (no lights) parse unchanged; `LIGHT_KINDS` separate
  from `PRIMITIVE_KINDS` (existing pin tests still pass).
- **engine:** a testable `lightFor(obj)` maps each `LightKind` → the correct THREE light class
  with color/intensity/type-params set; clay flag swaps object mesh material and restores.
- **passes:** a light widget stamped `isGizmoHelper` is hidden across all three passes; light
  roots are excluded from the depth-fit bounds.
- **Live (Phase D):** add each light type, drag with gizmo, confirm colored light on a glass
  gem; toggle Light View → clay + widgets + labels read the light clearly; bake/export shows no
  widgets, real materials.
