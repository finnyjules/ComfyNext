# Scene3D Lights — Part 1: Foundation (placeable, controllable lights) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add user-placeable Point / Spot / Area (rect) lights to the 3D Studio as a new scene-object kind — they light the scene, are selectable and positionable with the gizmo, have per-type controls, and never leak into the exported images. (Light View visualization is Part 2, a separate plan.)

**Architecture:** `LightObject` (`kind: 'light'`) joins the `objects` array (reusing list/selection/gizmo/save-load). The engine builds a `THREE.PointLight`/`SpotLight`/`RectAreaLight` per light with a tinted, selectable marker + stock helper (both editor-only). The base sun+ambient+presets are untouched.

**Tech Stack:** TypeScript, three.js `^0.171.0` (`PointLight`/`SpotLight`/`RectAreaLight`; `RectAreaLightUniformsLib` + `RectAreaLightHelper`/`PointLightHelper`/`SpotLightHelper` from `examples/jsm`), Vitest, Vue 3.

## Global Constraints

- **Do NOT** add lights to `PRIMITIVE_KINDS` or `PRIM_GROUPS` — `tests/unit/scene3d-config.unit.spec.ts` pins those to the primitive set exactly. Lights use a separate `LIGHT_KINDS` list.
- `LightObject` carries a **dummy default material** (like `GlbObject`) — do not refactor the required `SceneObjectBase.material`.
- Old scenes (no lights) must parse/serialize unchanged.
- three `^0.171.0` only; the jsm light modules are present. No new deps. **No-semicolon** TS style; match surrounding files.
- Commit hygiene: parallel sessions active — `git add` ONLY each task's named files, never `-A`/`.`. Check `git status --short <file>` first; if a target file carries parallel WIP you didn't make, stage only your own hunks or report BLOCKED.
- Frontend cwd `frontend/`. Single unit file: `npx vitest run tests/unit/<name>.unit.spec.ts`.
- Light-View clay/widgets/labels are OUT OF SCOPE here (Part 2). This plan only needs lights that work, are selectable/placeable, controllable, and export-safe.

---

## Task 1: Light data model, factory, and parsing (config.ts)

**Files:**
- Modify: `app/lib/scene3d/config.ts`
- Test: `tests/unit/scene3d-config.unit.spec.ts`

**Interfaces:**
- Produces: `LightKind`, `LightObject`, `SceneObject` union incl. `LightObject`, `LIGHT_KINDS`, `LIGHT_DEFAULTS`, `createLight(kind, existing)`, and a `parseDoc` branch that round-trips lights.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/scene3d-config.unit.spec.ts`:

```ts
import { createLight, LIGHT_KINDS, LIGHT_DEFAULTS } from '~/lib/scene3d/config'

describe('scene3d lights model', () => {
  it('creates each light kind with sane defaults and a unique id/name', () => {
    for (const kind of LIGHT_KINDS) {
      const l = createLight(kind, [])
      expect(l.kind).toBe('light')
      expect(l.light).toBe(kind)
      expect(l.id).toMatch(/^obj_/)
      expect(typeof l.name).toBe('string')
      expect(l.color).toBe(LIGHT_DEFAULTS.color)
      expect(l.intensity).toBeGreaterThan(0)
      // dummy material present (type uniformity), position off the origin
      expect(l.material).toBeTruthy()
      expect(l.position.some((c) => c !== 0)).toBe(true)
    }
  })

  it('numbers duplicate light names', () => {
    const a = createLight('point', [])
    const b = createLight('point', [a])
    expect(b.name).not.toBe(a.name)
  })

  it('round-trips a light through parse/serialize with clamped fields', () => {
    const l = createLight('spot', [])
    l.intensity = 5; l.angle = 0.7; l.penumbra = 0.5; l.color = '#ff8800'; l.castShadow = true
    const doc = { ...defaultDocForTest(), objects: [l] }
    const back = parseDoc(JSON.parse(serializeDoc(doc)))
    const r = back.objects[0] as any
    expect(r.kind).toBe('light')
    expect(r.light).toBe('spot')
    expect(r.intensity).toBe(5)
    expect(r.color).toBe('#ff8800')
    expect(r.castShadow).toBe(true)
  })

  it('drops an unknown light kind and keeps old docs unchanged', () => {
    const doc = parseDoc({ version: 1, objects: [{ kind: 'light', light: 'laser', id: 'x', name: 'x' }] })
    expect(doc.objects.length).toBe(0)
  })
})
```

Add a `defaultDocForTest` helper near the top of the test file if one isn't already present:
```ts
const defaultDocForTest = () => parseDoc({ version: 1 })
```
(Use the file's existing default-doc helper if it already has one — check imports; `parseDoc`/`serializeDoc` are already imported in this spec.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: FAIL — `createLight`/`LIGHT_KINDS`/`LIGHT_DEFAULTS` not exported.

- [ ] **Step 3: Implement** — in `app/lib/scene3d/config.ts`:

3a. After the `GlbObject` interface / `SceneObject` union (around line 88-89), add:

```ts
export type LightKind = 'point' | 'spot' | 'rect'
export interface LightObject extends SceneObjectBase {
  kind: 'light'
  light: LightKind
  color: string
  intensity: number
  distance?: number   // point/spot range, 0 = infinite
  decay?: number      // point/spot falloff
  angle?: number      // spot cone half-angle (radians)
  penumbra?: number   // spot edge softness 0–1
  width?: number      // rect
  height?: number     // rect
  castShadow?: boolean // point/spot only
}
```
Change the union to: `export type SceneObject = PrimitiveObject | GlbObject | LightObject`.

3b. Near `PRIMITIVE_KINDS`/`LIGHTING_PRESETS`, add:

```ts
export const LIGHT_KINDS: LightKind[] = ['point', 'spot', 'rect']
export const LIGHT_DEFAULTS = {
  color: '#ffffff', intensity: 8, distance: 0, decay: 2,
  angle: Math.PI / 6, penumbra: 0.3, width: 2, height: 2, castShadow: false,
} as const
```

3c. After `createGlbObject` (around line 244-252), add — mirroring its structure (use the same `newId()`, `numberedName`, `DEFAULT_MATERIAL` helpers it uses):

```ts
export function createLight(kind: LightKind, existing: SceneObject[]): LightObject {
  const label = kind === 'rect' ? 'Area light' : kind === 'spot' ? 'Spot light' : 'Point light'
  return {
    id: newId(), name: numberedName(label, existing), kind: 'light', light: kind,
    visible: true, position: [2.5, 3, 2.5], rotation: [0, 0, 0], scale: [1, 1, 1],
    material: { ...DEFAULT_MATERIAL }, // dummy, never rendered; kept for type uniformity
    color: LIGHT_DEFAULTS.color, intensity: LIGHT_DEFAULTS.intensity,
    distance: LIGHT_DEFAULTS.distance, decay: LIGHT_DEFAULTS.decay,
    angle: LIGHT_DEFAULTS.angle, penumbra: LIGHT_DEFAULTS.penumbra,
    width: LIGHT_DEFAULTS.width, height: LIGHT_DEFAULTS.height,
    castShadow: LIGHT_DEFAULTS.castShadow,
  }
}
```

3d. In `parseDoc`'s per-object flatMap (the branch block ~line 319-343), **before** the primitive branch and after the glb branch, add (uses the file's local `num`/`str` clamp helpers and `common`):

```ts
if (o.kind === 'light' && LIGHT_KINDS.includes(o.light)) {
  return [{
    ...common, kind: 'light' as const, light: o.light,
    color: str(o.color, LIGHT_DEFAULTS.color),
    intensity: num(o.intensity, LIGHT_DEFAULTS.intensity),
    distance: num(o.distance, LIGHT_DEFAULTS.distance),
    decay: num(o.decay, LIGHT_DEFAULTS.decay),
    angle: num(o.angle, LIGHT_DEFAULTS.angle),
    penumbra: num(o.penumbra, LIGHT_DEFAULTS.penumbra),
    width: num(o.width, LIGHT_DEFAULTS.width),
    height: num(o.height, LIGHT_DEFAULTS.height),
    castShadow: o.castShadow === true,
  }]
}
```
If the file's `str`/`num` signatures differ (e.g. `num(v, fallback, min, max)`), match them; if there's no `str`, inline `typeof o.color === 'string' ? o.color : LIGHT_DEFAULTS.color`. Read the existing primitive branch to copy the exact helper usage.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: PASS — including the pre-existing `PRIMITIVE_KINDS`/`PRIM_GROUPS` pin tests (unchanged).

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/config.ts tests/unit/scene3d-config.unit.spec.ts
git commit -m "feat(scene3d): LightObject model, createLight, and light parsing"
```

---

## Task 2: Light factory + engine sync (lights actually light the scene)

**Files:**
- Modify: `app/lib/scene3d/engine.ts`
- Test: `tests/unit/scene3d-engine.unit.spec.ts`

**Interfaces:**
- Consumes: `LightObject`, `LIGHT_DEFAULTS` (Task 1).
- Produces: `lightFor(obj: LightObject): THREE.Light` (exported, pure factory) mapping each kind → the right THREE light with color/intensity/type-params applied. `syncObject` builds/updates light roots.

- [ ] **Step 1: Write the failing test** — append inside `tests/unit/scene3d-engine.unit.spec.ts`:

```ts
import { lightFor } from '~/lib/scene3d/engine'
import { createLight } from '~/lib/scene3d/config'

describe('scene3d light factory', () => {
  it('maps each light kind to the right THREE light with its params', () => {
    const point = lightFor(createLight('point', []))
    expect(point).toBeInstanceOf(THREE.PointLight)
    const spotObj = createLight('spot', []); spotObj.angle = 0.5; spotObj.penumbra = 0.4
    const spot = lightFor(spotObj) as THREE.SpotLight
    expect(spot).toBeInstanceOf(THREE.SpotLight)
    expect(spot.angle).toBeCloseTo(0.5)
    expect(spot.penumbra).toBeCloseTo(0.4)
    const rect = lightFor(createLight('rect', []))
    expect(rect).toBeInstanceOf(THREE.RectAreaLight)
  })

  it('applies color and intensity', () => {
    const o = createLight('point', []); o.color = '#ff0000'; o.intensity = 3.5
    const l = lightFor(o) as THREE.PointLight
    expect(l.color.getHexString()).toBe('ff0000')
    expect(l.intensity).toBe(3.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-engine.unit.spec.ts`
Expected: FAIL — `lightFor` not exported.

- [ ] **Step 3: Implement** — in `app/lib/scene3d/engine.ts`:

3a. Add imports (next to the other `three/examples/jsm` imports near line 10-11):

```ts
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
```

3b. In the `SceneEngine` constructor (after the renderer is created, ~line 234-240), call once:

```ts
RectAreaLightUniformsLib.init()
```

3c. Add the exported factory near `geometryFor` (module scope):

```ts
/** Build the THREE light for a LightObject (color/intensity/type params applied;
 *  position/rotation/shadow handled by the caller in syncObject). Pure + testable. */
export function lightFor(obj: LightObject): THREE.Light {
  const color = new THREE.Color(stripAlpha(obj.color))
  const intensity = obj.intensity
  if (obj.light === 'rect') {
    const l = new THREE.RectAreaLight(color, intensity, obj.width ?? LIGHT_DEFAULTS.width, obj.height ?? LIGHT_DEFAULTS.height)
    return l
  }
  if (obj.light === 'spot') {
    const l = new THREE.SpotLight(color, intensity, obj.distance ?? 0, obj.angle ?? LIGHT_DEFAULTS.angle, obj.penumbra ?? LIGHT_DEFAULTS.penumbra, obj.decay ?? LIGHT_DEFAULTS.decay)
    return l
  }
  const l = new THREE.PointLight(color, intensity, obj.distance ?? 0, obj.decay ?? LIGHT_DEFAULTS.decay)
  return l
}
```
Add `LightObject`, `LIGHT_DEFAULTS` to the `./config` import.

3d. In `syncObject`, extend `sourceKey` (line ~316) so a light-type change rebuilds:
```ts
const sourceKey = obj.kind === 'primitive' ? `primitive:${obj.primitive}`
  : obj.kind === 'glb' ? `glb:${obj.url}`
  : `light:${obj.light}`
```

3e. In the build-if-missing block (~line 325-350), add a light branch alongside primitive/glb. Build the light, wrap it in a `THREE.Group` root (so a spotlight's target can be a child and the pick-marker/helper attach cleanly), stamp userData, add to scene, track:

```ts
} else if (obj.kind === 'light') {
  const group = new THREE.Group()
  const light = lightFor(obj)
  group.add(light)
  group.userData.light = light
  if (light instanceof THREE.SpotLight) {
    // Spot aims at a target offset along the group's local -Z; keep target in the group.
    light.target.position.set(0, 0, -1)
    group.add(light.target)
  }
  root = group
  root.userData.sceneId = obj.id
  root.userData.sourceKey = sourceKey
  root.userData.isLight = true
  this.scene.add(root)
  this.objectRoots.set(obj.id, root)
}
```
(Follow the exact shape of the existing primitive/glb build arms for `root.userData.sceneId`/`sourceKey` stamping and `objectRoots.set`.)

3f. Transform application (position/rotation/scale/visible, ~line 351-354) already runs for all kinds — leave it; the group carries position/rotation. Then add a light live-update arm after the primitive tail (`if (obj.kind === 'primitive') { … }`), e.g.:

```ts
} else if (obj.kind === 'light') {
  const light = root.userData.light as THREE.Light
  const color = new THREE.Color(stripAlpha(obj.color))
  light.color.copy(color)
  light.intensity = obj.intensity
  if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) {
    light.distance = obj.distance ?? 0
    light.decay = obj.decay ?? LIGHT_DEFAULTS.decay
    light.castShadow = obj.castShadow === true
  }
  if (light instanceof THREE.SpotLight) {
    light.angle = obj.angle ?? LIGHT_DEFAULTS.angle
    light.penumbra = obj.penumbra ?? LIGHT_DEFAULTS.penumbra
  }
  if (light instanceof THREE.RectAreaLight) {
    light.width = obj.width ?? LIGHT_DEFAULTS.width
    light.height = obj.height ?? LIGHT_DEFAULTS.height
  }
}
```

3g. Disposal: the light group has no geometry now (marker/helper come in Task 3), so `disposeTree` is a safe no-op today. Leave a note that Task 3's marker/helper geometry must be disposed.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/scene3d-engine.unit.spec.ts`
Expected: PASS. (The `SceneEngine` deferred-geometry tests that construct via prototype still pass — `lightFor` is standalone and `RectAreaLightUniformsLib.init()` is safe in jsdom/node; if `init()` throws without WebGL, guard it: `try { RectAreaLightUniformsLib.init() } catch {}` — verify the existing engine tests still pass either way.)

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/engine.ts tests/unit/scene3d-engine.unit.spec.ts
git commit -m "feat(scene3d): build and sync Point/Spot/Rect lights from LightObjects"
```

---

## Task 3: Selectable, export-safe light markers

**Files:**
- Modify: `app/lib/scene3d/engine.ts` (marker + helper on the light group; helper update), `app/lib/scene3d/passes.ts` (recursive editor-helper exclusion + skip light roots in depth bounds)
- Test: `tests/unit/scene3d-passes.unit.spec.ts`

**Interfaces:**
- Produces: each light group contains a visible, color-tinted **pick marker** (small sphere mesh) + a stock light helper, both stamped `userData.isGizmoHelper = true`; `renderPasses` hides all `isGizmoHelper` objects recursively; light roots excluded from the depth-fit bounds.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/scene3d-passes.unit.spec.ts` (mirror how that file already invokes the helper-hiding logic; if it tests a pure helper function, extend it; otherwise test the exclusion predicate). Concretely, if `passes.ts` exposes the hide logic inline, add a small exported helper `collectEditorHelpers(scene)` and test it; if it's already testable, assert a nested `isGizmoHelper` mesh is collected:

```ts
import * as THREE from 'three'
import { collectEditorHelpers } from '~/lib/scene3d/passes'

it('collects editor helpers nested under a light group (not just direct children)', () => {
  const scene = new THREE.Scene()
  const group = new THREE.Group(); group.userData.isLight = true
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshBasicMaterial())
  marker.userData.isGizmoHelper = true
  group.add(marker)
  scene.add(group)
  const found = collectEditorHelpers(scene)
  expect(found).toContain(marker)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-passes.unit.spec.ts`
Expected: FAIL — `collectEditorHelpers` not exported / nested marker not found.

- [ ] **Step 3: Implement**

3a. In `passes.ts`, replace the direct-children filter (currently `engine.scene.children.filter(c => c.userData.isGizmoHelper && c.visible)`) with a recursive collector, and export it:

```ts
export function collectEditorHelpers(scene: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = []
  scene.traverse((o) => { if (o.userData.isGizmoHelper && o.visible) out.push(o) })
  return out
}
```
Use it where the old filter was: `const helpers = collectEditorHelpers(engine.scene)`; hide/restore exactly as before (set `.visible = false`, restore after). This now catches markers nested under a light group.

3b. In the depth-fit bounds loop (`bounds.expandByObject` over `engine.objectRoots.values()`), skip light roots:
```ts
for (const root of engine.objectRoots.values()) {
  if (root.userData.isLight) continue
  bounds.expandByObject(root)
}
```
(Adapt to the loop's actual form.)

3c. In `engine.ts` `syncObject` light-build branch (Task 2, step 3e), add a visible pick marker + stock helper to the group, both stamped `isGizmoHelper`:

```ts
const markerMat = new THREE.MeshBasicMaterial({ color, toneMapped: false })
const marker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), markerMat)
marker.userData.isGizmoHelper = true
group.add(marker)
group.userData.marker = marker
```
(Where `color` is the light's `THREE.Color`.) Update the marker color in the light live-update arm (`markerMat.color.copy(color)`). This marker is the reliable raycast target (solid sphere) and the always-visible representation. Stock direction helpers (SpotLightHelper cone, RectAreaLightHelper rect) are optional here and can be added in Part 2's Light View; the marker alone makes lights visible + selectable now.

3d. Disposal: in `disposeTree` (or the light-removal path), dispose the marker geometry/material. Since the marker is a Mesh under the root, the existing `isMesh` disposal in `disposeTree` should already handle it — verify `disposeTree` traverses and disposes mesh geometry+material; if so, no change needed.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/scene3d-passes.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/engine.ts app/lib/scene3d/passes.ts tests/unit/scene3d-passes.unit.spec.ts
git commit -m "feat(scene3d): selectable light markers, excluded from export passes"
```

---

## Task 4: Surface UI — add lights, list, and per-light controls

**Files:**
- Modify: `app/components/vue-canvas/Scene3DStudioSurface.vue`

**Interfaces:**
- Consumes: `createLight`, `LIGHT_KINDS`, `LIGHT_DEFAULTS`, `LightKind` from config (Task 1).
- Produces: an Add-Light menu, `addLight(kind)` (8-light cap), light-aware `duplicateObject`, a light icon in the Objects list, `selectedIsLight`, and a per-light control block in the Selection section (Size hidden for lights).

- [ ] **Step 1: Implement** (UI wiring — no unit test; verified by compile + Task 5 browser check):

4a. Imports (line ~18-23): add `createLight, LIGHT_KINDS, LIGHT_DEFAULTS, type LightKind` to the config import.

4b. State: add `const selectedIsLight = computed(() => selected.value?.kind === 'light')` beside `selectedIsPrimitive` (~line 60). Add `const lightMenuOpen = ref(false)`.

4c. `addLight(kind: LightKind)` mirroring `addPrimitive` (~line 539), with the cap:
```ts
const MAX_LIGHTS = 8
function addLight(kind: LightKind) {
  const count = doc.objects.filter((o) => o.kind === 'light').length
  if (count >= MAX_LIGHTS) { /* toast/among existing notify util */ return }
  const o = createLight(kind, doc.objects)
  doc.objects.push(o)
  selectedId.value = o.id
  lightMenuOpen.value = false
}
```
Use whatever lightweight notify/toast the file already uses for the cap message (search for an existing `notify`/`toast`; if none, a `console.warn` + early return is acceptable for now).

4d. `duplicateObject` (~line 559-577): add a light branch. Where it branches `createPrimitive` vs `createGlbObject`, add:
```ts
const copy = src.kind === 'primitive' ? createPrimitive(src.primitive, doc.objects)
  : src.kind === 'glb' ? createGlbObject(src.url, doc.objects)
  : createLight(src.light, doc.objects)
```
and copy the light fields when `src.kind === 'light'` (color/intensity/distance/decay/angle/penumbra/width/height/castShadow) alongside the existing material/params copy.

4e. Objects list icon (~line 792): swap the hard-coded `<Box>` by kind — e.g. `o.kind === 'light' ? Lightbulb : Box` (import `Lightbulb` from `lucide-vue-next` or the icon set already used). Keep it minimal.

4f. Add-Light toolbar button + menu, beside "+ Primitive"/"Upload GLB" (~line 733-751 / menu ~754-773). A third button toggling `lightMenuOpen`, with a small popup listing `LIGHT_KINDS` (label each: Point / Spot / Area) calling `addLight(kind)`. Mirror the primitive menu's markup/classes.

4g. Per-light control block in the Selection `<StudioSection>` (~line 813). Add a `<template v-if="selectedIsLight">` (NOT gated on `selectedIsPrimitive`) with:
- Color picker bound to `selected.light.color` (use the existing `StudioColor`/color-button pattern the material color uses; write a small `lightColorProxy` or bind through a computed that reads/writes `(selected as LightObject).color`).
- Intensity slider (0–20, step 0.1).
- If `selected.light.light === 'point' || 'spot'`: Distance (0–30, step 0.5; 0 = infinite), Decay (0–3, step 0.1), a Cast-shadow toggle.
- If `'spot'`: Angle (0.05–1.4 rad, step 0.01), Penumbra (0–1, step 0.05).
- If `'rect'`: Width (0.2–10, step 0.1), Height (0.2–10, step 0.1).
Bind each via a small proxy/computed writing back to the selected `LightObject` field (mirror how `doc.lighting.*` sliders and the material proxies at lines 136-207 read/write). Reuse `StudioSlider`, `StudioSegmented`, and the color control components already imported.

4h. Hide the **Size** block for lights: change its gate (~line 1118-1125) from always-on to `v-if="selected && !selectedIsLight"`. Position/Rotation stay for all kinds.

- [ ] **Step 2: Type/compile check**

Run: `npx vue-tsc --noEmit 2>&1 | grep -i "Scene3DStudioSurface\|config" | tail -20` — no NEW errors vs the ~328 baseline. (The `selected` union now includes `LightObject`; guard any `.material`/`.primitive` access already gated by `selectedIsPrimitive`.)

- [ ] **Step 3: Commit**

```bash
git add app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): add-light menu, light list item, and per-light controls"
```

---

## Task 5: Gizmo (scale-suppression for lights) + browser verification

**Files:**
- Modify: `app/lib/scene3d/interaction.ts`, `app/components/vue-canvas/Scene3DStudioSurface.vue` (pass selected kind into `select`)

**Interfaces:**
- Produces: `GizmoController.select(id, kind?)` (or `select(obj)`) attaches translate+rotate for lights and hides the scale instance.

- [ ] **Step 1: Implement**

5a. In `interaction.ts`, tag each gizmo instance with its mode at build time (`tc.userData.mode = part.mode` in the build loop ~line 96-144). Change `select` (~line 216-223) to accept the kind: `select(id: string | null, isLight = false)`. When attaching, for each gizmo instance: if `isLight && tc.userData.mode === 'scale'` → `tc.detach()` (skip); else attach as today. When `id` is null, detach all (unchanged).

5b. In `Scene3DStudioSurface.vue`, the `watch(selectedId, …)` that calls `interaction.select(id)` (~line 506) — pass the kind: `interaction?.select(id, selected.value?.kind === 'light')`. Ensure `selected` is recomputed before this runs (it's a computed on `selectedId`, so read `doc.objects.find(...)` directly if ordering is a concern).

- [ ] **Step 2: Browser verification** — start/attach the dev server on `127.0.0.1:3000` (reuse the running one; do NOT spawn another — see project memory). The `dev/scene3d-lab` page mounts the studio. Because the render loop makes pointer actions time out, drive via `javascript_tool`. Steps:
  1. Add a Dodecahedron, set material to **glass** (so colored light is obvious).
  2. Add a **Point** light; set its color to a saturated hue and intensity high; confirm the gem picks up the colored light and a marker sphere appears at the light position.
  3. Select the light (click marker / list item) → confirm the right panel shows light controls (color/intensity/distance), NOT material/geometry, and the **Size** row is hidden.
  4. Confirm the gizmo on a selected light shows move+rotate but **no scale** handles.
  5. Add a **Spot** and an **Area** light; confirm each lights the scene.
  6. Confirm the marker spheres do NOT appear in an exported frame (call the bake/export path if reachable from the lab, or verify `collectEditorHelpers` hides them — at minimum screenshot the scene with lights, and confirm via console that markers carry `isGizmoHelper`).
  Screenshot before/after.

- [ ] **Step 3: Final commit** if any polish needed.

---

## Self-Review Notes

- **Coverage:** model+parse+factory (T1), engine light build/sync (T2), selectable+export-safe markers (T3), add/list/controls UI (T4), gizmo + live verify (T5). Light-View clay/widgets/labels are Part 2.
- **Flags handled:** dummy material on LightObject (T1); `LIGHT_KINDS` separate from `PRIMITIVE_KINDS` (T1, keeps pin tests green); recursive `isGizmoHelper` exclusion for nested markers (T3); `duplicateObject`/gizmo/Size-block light-awareness (T4/T5).
- **Type consistency:** `lightFor(obj)`, `createLight(kind, existing)`, `select(id, isLight)` signatures consistent across tasks.
- **Known risks (T5 verifies live):** RectAreaLight needs `init()` + only lights physical materials (studio's are); marker raycast reliability; export exclusion of nested markers.
