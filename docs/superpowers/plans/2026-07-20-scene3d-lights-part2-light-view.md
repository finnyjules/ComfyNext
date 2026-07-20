# Scene3D Lights — Part 2: Light View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a **Light View** mode to the 3D Studio that makes lighting legible: toggle it on and objects re-shade to matte clay while each light gains explicit widgets — falloff sphere, spot cone, area rectangle, direction arrow, an intensity ring, and an HTML label (name + live intensity), selected light highlighted / others dimmed. All editor-only, excluded from export.

**Architecture:** Builds on Part 1 (lights are `THREE.Group` roots holding a PointLight/SpotLight/RectAreaLight + a color-tinted pick marker, tracked in `objectRoots`). The engine gains a `lightView` flag (clay swap on object meshes) and a per-light **widget group** added as a *child of the light root* (so it follows the transform and is auto-excluded from export by the recursive `isGizmoHelper` filter). HTML labels are a Vue overlay over the viewport, projecting light world positions to screen each frame.

**Tech Stack:** TypeScript, three.js `^0.171.0` (`RingGeometry`, `SphereGeometry`+`WireframeGeometry`, `ConeGeometry`, `EdgesGeometry`, `Line`/`LineSegments`, `ArrowHelper`, `MeshBasicMaterial`/`LineBasicMaterial`), Vitest, Vue 3.

## Global Constraints

- Widgets/clay are **editor-only** — never in the exported beauty/depth/normal images. Widgets are stamped `userData.isGizmoHelper = true` (already hidden by `collectEditorHelpers` from Part 1). Clay is a `lightView` render mode; **bake must render real materials** — `bake()` forces `setLightView(false)` around `renderPasses` and restores after.
- Clay is a per-object **material swap** on object meshes (NOT `scene.overrideMaterial`, which would clay the grid too).
- No new deps; three `^0.171.0` only. **No-semicolon** TS; match surrounding files.
- Commit hygiene: parallel sessions active — `git add` ONLY each task's named files, never `-A`/`.`. Check `git status --short <file>` first; stage only your hunks if a file carries parallel WIP, else BLOCKED.
- Frontend cwd `frontend/`. Single unit file: `npx vitest run tests/unit/<name>.unit.spec.ts`.

---

## Task 1: Engine — Light View flag + clay swap + selection tracking

**Files:**
- Modify: `app/lib/scene3d/engine.ts`
- Test: `tests/unit/scene3d-engine.unit.spec.ts`

**Interfaces:**
- Produces: `SceneEngine.setLightView(on: boolean): void`, `SceneEngine.lightView: boolean` (readonly-ish), `SceneEngine.setSelected(id: string | null): void`. When `lightView` is true, `syncObject` assigns a shared clay `MeshStandardMaterial` to object meshes instead of their real material (real material still built/updated so toggle-off restores it).

- [ ] **Step 1: Write the failing test** — append to `tests/unit/scene3d-engine.unit.spec.ts`. Use the existing `buildGeometry`/`SceneEngine` test scaffolding; test the clay swap via the prototype `syncObject` stand-in already used in that file (the "deferred geometry" describe shows the pattern — a `makeHost()` with `objectRoots`/`scene`). Add a focused test that a primitive mesh gets the clay material when `lightView` is on:

```ts
// (near the deferred-geometry describe, reuse its makeHost pattern)
it('swaps object meshes to clay in Light View and restores on exit', () => {
  const host = makeHost() as any
  host.lightView = false
  host.clay = new THREE.MeshStandardMaterial()
  const obj = { ...createPrimitive('box', []) }
  ;(SceneEngine.prototype as any).syncObject.call(host, obj)
  const mesh = host.objectRoots.get(obj.id) as THREE.Mesh
  const real = mesh.material
  expect(real).not.toBe(host.clay)
  host.lightView = true
  ;(SceneEngine.prototype as any).syncObject.call(host, obj)
  expect(mesh.material).toBe(host.clay)
  host.lightView = false
  ;(SceneEngine.prototype as any).syncObject.call(host, obj)
  expect(mesh.material).not.toBe(host.clay)
})
```
If the existing `makeHost` doesn't carry `clay`/`lightView`, extend it minimally in the test (as above) — the point is that `syncObject`'s material assignment honors `this.lightView` + `this.clay`. Adapt to how the real `syncObject` reads these.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-engine.unit.spec.ts`
Expected: FAIL — clay not applied.

- [ ] **Step 3: Implement** — in `app/lib/scene3d/engine.ts`:

3a. Add fields to `SceneEngine`: `lightView = false`, `private selectedId: string | null = null`, and a shared clay material built in the constructor:
```ts
readonly clay = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.85, metalness: 0 })
```

3b. Add methods:
```ts
setLightView(on: boolean): void {
  if (this.lightView === on) return
  this.lightView = on
  for (const obj of this.lastDoc?.objects ?? []) this.syncObject(obj) // re-apply materials/visibility
  this.updateLightWidgets() // no-op until Task 3; safe to call
}
setSelected(id: string | null): void {
  this.selectedId = id
  this.updateLightWidgets()
}
```
If the engine doesn't retain the last doc, capture it in `syncFromDoc` (`this.lastDoc = doc`). Add a stub `private updateLightWidgets(): void {}` now (Task 3 fills it) so `setLightView`/`setSelected` compile.

3c. In `syncObject`, at the point a primitive/glb mesh's material is assigned/updated (the `if (obj.kind === 'primitive')` tail and the glb material path), when `this.lightView` is true assign `this.clay` to the mesh's `.material` instead of the real material — but STILL build/update the real material object (so exiting Light View restores it). Concretely, after computing the real material as today, do:
```ts
mesh.material = this.lightView ? this.clay : realMaterial
```
For GLB groups (multiple meshes), traverse and swap each mesh's material to clay in Light View, restoring real materials otherwise (GLBs keep their own materials — store the original per mesh in `userData.realMaterial` on first assignment so restore works). Keep it minimal: primitives are the main case; for GLB, a traverse setting clay in light-view and restoring `userData.realMaterial` otherwise.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scene3d-engine.unit.spec.ts`
Expected: PASS (all — including existing parity/light tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/engine.ts tests/unit/scene3d-engine.unit.spec.ts
git commit -m "feat(scene3d): Light View clay mode + selection tracking on the engine"
```

---

## Task 2: `lightWidgets.ts` — the per-light widget builder

**Files:**
- Create: `app/lib/scene3d/lightWidgets.ts`
- Test: `tests/unit/scene3d-light-widgets.unit.spec.ts` (create)

**Interfaces:**
- Produces:
  - `buildLightWidget(obj: LightObject): THREE.Group` — a group (stamped `userData.isGizmoHelper = true`) of line/mesh viz in the light's LOCAL space (light emits along local −Z for spot/rect): an intensity ring (radius scales with intensity), and per-kind: point → wireframe falloff sphere + short rays; spot → wireframe cone at `angle`, length = range, + a −Z axis arrow; rect → a width×height rectangle outline + a −Z normal arrow. All tinted by the light color. An aim line along −Z for spot/rect.
  - `setWidgetSelected(group: THREE.Group, selected: boolean): void` — full opacity + visible detail when selected; dimmed opacity otherwise.
  - `disposeWidget(group: THREE.Group): void` — dispose all child geometries/materials.

- [ ] **Step 1: Write the failing test** — create `tests/unit/scene3d-light-widgets.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { buildLightWidget, setWidgetSelected, disposeWidget } from '~/lib/scene3d/lightWidgets'
import { createLight } from '~/lib/scene3d/config'

const finite = (g: THREE.Object3D): boolean => {
  let ok = true
  g.traverse((o) => {
    const geo = (o as THREE.Mesh).geometry
    if (geo) { const p = geo.getAttribute('position'); if (p) for (let i = 0; i < p.count * 3; i++) if (!Number.isFinite((p.array as ArrayLike<number>)[i])) ok = false }
  })
  return ok
}

describe('buildLightWidget', () => {
  it('builds a finite, editor-only widget for each light kind', () => {
    for (const kind of ['point', 'spot', 'rect'] as const) {
      const w = buildLightWidget(createLight(kind, []))
      expect(w).toBeInstanceOf(THREE.Group)
      expect(w.userData.isGizmoHelper).toBe(true)
      expect(w.children.length).toBeGreaterThan(0)
      expect(finite(w)).toBe(true)
    }
  })

  it('scales the spot cone with the spot angle', () => {
    const narrow = createLight('spot', []); narrow.angle = 0.2
    const wide = createLight('spot', []); wide.angle = 1.2
    const rN = new THREE.Box3().setFromObject(buildLightWidget(narrow)).getSize(new THREE.Vector3())
    const rW = new THREE.Box3().setFromObject(buildLightWidget(wide)).getSize(new THREE.Vector3())
    expect(rW.x).toBeGreaterThan(rN.x) // wider cone → wider bbox
  })

  it('dims via setWidgetSelected without throwing and disposes cleanly', () => {
    const w = buildLightWidget(createLight('point', []))
    setWidgetSelected(w, false)
    setWidgetSelected(w, true)
    expect(() => disposeWidget(w)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-light-widgets.unit.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — create `app/lib/scene3d/lightWidgets.ts`:

```ts
// Editor-only Light-View widgets: an explicit, legible representation of each
// light's position, strength, reach, and direction. Built in the light's LOCAL
// space (the light emits along local -Z for spot/rect) and added as a child of
// the light root, so it follows the light's transform and is excluded from export
// by the recursive isGizmoHelper filter in passes.ts.
import * as THREE from 'three'
import { stripAlpha } from '~/lib/color/convert'
import { type LightObject, LIGHT_DEFAULTS } from '~/lib/scene3d/config'

const INDICATIVE_RANGE = 6 // shown reach when distance = 0 (infinite)
const lineMat = (color: THREE.Color, opacity = 0.9) =>
  new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false, depthWrite: false })

/** Intensity → ring radius: a gentle log map so a bright light reads bigger
 *  without dwarfing the scene. */
function intensityRadius(intensity: number): number {
  return 0.25 + Math.min(1.5, Math.log2(1 + Math.max(0, intensity)) * 0.18)
}

export function buildLightWidget(obj: LightObject): THREE.Group {
  const group = new THREE.Group()
  group.userData.isGizmoHelper = true
  const color = new THREE.Color(stripAlpha(obj.color))
  const range = (obj.distance ?? 0) > 0 ? obj.distance! : INDICATIVE_RANGE

  // Intensity ring (faces local +Z, i.e. toward the marker), radius by intensity.
  const rr = intensityRadius(obj.intensity)
  const ring = new THREE.LineLoop(new THREE.CircleGeometry(rr, 40), lineMat(color))
  // CircleGeometry includes a center vertex at index 0; drop it for a clean loop.
  ring.geometry.deleteAttribute('normal'); ring.geometry.deleteAttribute('uv')
  const pos = ring.geometry.getAttribute('position')
  const loop = new Float32Array((pos.count - 1) * 3)
  for (let i = 1; i < pos.count; i++) { loop[(i - 1) * 3] = pos.getX(i); loop[(i - 1) * 3 + 1] = pos.getY(i); loop[(i - 1) * 3 + 2] = pos.getZ(i) }
  ring.geometry.setAttribute('position', new THREE.BufferAttribute(loop, 3))
  ring.geometry.setDrawRange(0, pos.count - 1)
  group.add(ring)

  if (obj.light === 'point') {
    // Falloff sphere (three great circles) + short rays.
    for (let a = 0; a < 3; a++) {
      const c = new THREE.LineLoop(new THREE.CircleGeometry(range, 48), lineMat(color, 0.35))
      c.geometry.deleteAttribute('normal'); c.geometry.deleteAttribute('uv')
      if (a === 1) c.rotation.x = Math.PI / 2
      if (a === 2) c.rotation.y = Math.PI / 2
      group.add(c)
    }
    const rayPts: number[] = []
    for (let i = 0; i < 6; i++) { const th = (i / 6) * Math.PI * 2; rayPts.push(0, 0, 0, Math.cos(th) * rr * 1.6, Math.sin(th) * rr * 1.6, 0) }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rayPts, 3)), lineMat(color)))
  } else if (obj.light === 'spot') {
    const angle = obj.angle ?? LIGHT_DEFAULTS.angle
    const r = Math.tan(angle) * range
    // Cone edges from apex (origin) to a -Z circle of radius r.
    const seg = 32, pts: number[] = []
    for (let i = 0; i < seg; i++) {
      const th = (i / seg) * Math.PI * 2, x = Math.cos(th) * r, y = Math.sin(th) * r
      pts.push(0, 0, 0, x, y, -range)                      // apex → rim
      const th2 = ((i + 1) / seg) * Math.PI * 2
      pts.push(x, y, -range, Math.cos(th2) * r, Math.sin(th2) * r, -range) // rim arc
    }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)), lineMat(color)))
    group.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), range * 0.6, color.getHex()))
  } else { // rect
    const w = (obj.width ?? LIGHT_DEFAULTS.width) / 2, h = (obj.height ?? LIGHT_DEFAULTS.height) / 2
    const rect = [-w, -h, 0, w, -h, 0, w, h, 0, -w, h, 0, -w, -h, 0]
    group.add(new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(rect, 3)), lineMat(color)))
    group.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 0), 1.5, color.getHex()))
  }

  // Aim line toward -Z for directional lights.
  if (obj.light !== 'point') {
    group.add(new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, -range], 3)), lineMat(color, 0.4)))
  }
  return group
}

export function setWidgetSelected(group: THREE.Group, selected: boolean): void {
  group.traverse((o) => {
    const m = (o as THREE.Line).material as THREE.Material | undefined
    if (m && 'opacity' in m) { (m as THREE.LineBasicMaterial).opacity = selected ? 1 : 0.28; m.needsUpdate = false }
  })
}

export function disposeWidget(group: THREE.Group): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(m)) m.forEach((x) => x.dispose()); else if (m) m.dispose()
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scene3d-light-widgets.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/lightWidgets.ts tests/unit/scene3d-light-widgets.unit.spec.ts
git commit -m "feat(scene3d): Light-View widget builder (falloff/cone/rect/arrow/intensity)"
```

---

## Task 3: Engine — wire widgets into the light lifecycle

**Files:**
- Modify: `app/lib/scene3d/engine.ts`
- Test: `tests/unit/scene3d-engine.unit.spec.ts`

**Interfaces:**
- Consumes: `buildLightWidget`/`setWidgetSelected`/`disposeWidget` (Task 2).
- Produces: each light root holds a widget child, rebuilt on light sync, `visible = lightView`, opacity by `selectedId`; `updateLightWidgets()` refreshes visibility/selection for all lights.

- [ ] **Step 1: Write the failing test** — append to `tests/unit/scene3d-engine.unit.spec.ts` (reuse the `makeHost` prototype-call pattern). Assert that after syncing a light with `lightView` on, the light root contains a widget child that is visible; with `lightView` off it's hidden:

```ts
it('attaches a Light-View widget to a light root, shown only in Light View', () => {
  const host = makeHost() as any
  host.lightView = true
  host.clay = new THREE.MeshStandardMaterial()
  host.selectedId = null
  const obj = createLight('spot', [])
  ;(SceneEngine.prototype as any).syncObject.call(host, obj)
  const root = host.objectRoots.get(obj.id) as THREE.Object3D
  const widget = root.children.find((c: THREE.Object3D) => c.userData.isGizmoHelper && c.type === 'Group')
  expect(widget).toBeTruthy()
  expect(widget!.visible).toBe(true)
})
```
(Adapt field access to the real `syncObject`. If `makeHost` lacks `lightView`/`clay`/`selectedId`, set them on the host object in the test.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-engine.unit.spec.ts`
Expected: FAIL — no widget child.

- [ ] **Step 3: Implement** — in `engine.ts`:

3a. Import `buildLightWidget, setWidgetSelected, disposeWidget` from `~/lib/scene3d/lightWidgets`.

3b. In the light arm of `syncObject` (both build and live-update), after applying the light props, (re)build the widget child: find any existing `root.userData.widget`, `disposeWidget` + `root.remove` it, then `const widget = buildLightWidget(obj)`, `root.add(widget)`, `root.userData.widget = widget`, `widget.visible = this.lightView`, `setWidgetSelected(widget, obj.id === this.selectedId)`. (Rebuild-on-sync is fine for ≤8 lights.)

3c. Implement `updateLightWidgets()` (replacing the Task 1 stub): iterate `objectRoots`; for each root with `userData.widget`, set `widget.visible = this.lightView` and `setWidgetSelected(widget, root.userData.sceneId === this.selectedId)`.

3d. Disposal: ensure the light-removal path (`disposeTree` / removal diff) disposes the widget — `disposeTree` traverses meshes, but the widget's `Line`/`LineSegments`/`ArrowHelper` may not all be `isMesh`; call `disposeWidget(root.userData.widget)` explicitly when removing a light root, or make `disposeTree` also dispose `Line`/`LineSegments` geometry+material. State which you did.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts`
Expected: PASS (passes test still confirms nested widget is export-excluded).

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/engine.ts tests/unit/scene3d-engine.unit.spec.ts
git commit -m "feat(scene3d): attach Light-View widgets to lights, shown only in Light View"
```

---

## Task 4: Surface — Light View toggle, auto-enter, and bake guard

**Files:**
- Modify: `app/components/vue-canvas/Scene3DStudioSurface.vue`

**Interfaces:**
- Consumes: `engine.setLightView`, `engine.setSelected` (Tasks 1/3).
- Produces: a Light-View toggle button in the top-left viewport toolbar (beside "snap"); `lightView` ref; auto-enter on first light add; `engine.setSelected` wired to selection; `bake()` renders real materials.

- [ ] **Step 1: Implement**

4a. `const lightView = ref(false)`. A `watch(lightView, (on) => engine?.setLightView(on))`. In the selection watch (`watch(selectedId, …)`), also call `engine?.setSelected(selectedId.value)`.

4b. Toggle button in the `.absolute.left-3.top-3` snap toolbar (beside the snap button) — a second button bound to `@click="lightView = !lightView"`, active-styled when on (mirror the snap button's active classes), labelled "Light" with a bulb/eye icon. Keep the toolbar's `@pointerdown.stop`.

4c. Auto-enter: in `addLight(kind)`, after pushing the first light, if this is the only light (`doc.objects.filter(o=>o.kind==='light').length === 1`), set `lightView.value = true`.

4d. Bake guard: in `bake()` (~line 694), before `renderPasses`, capture `const wasLightView = lightView.value; if (wasLightView) engine?.setLightView(false)`, and after the passes complete (in a `finally`), `if (wasLightView) engine?.setLightView(true)`. This guarantees the export renders real materials even if Light View is on. (Widgets are already excluded via `isGizmoHelper`; this handles the clay.)

- [ ] **Step 2: Type/compile check**

Run: `npx vue-tsc --noEmit 2>&1 | grep -i "Scene3DStudioSurface" | tail` — no NEW errors vs baseline.

- [ ] **Step 3: Commit**

```bash
git add app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): Light View toggle, auto-enter, and bake renders real materials"
```

---

## Task 5: Surface — HTML light labels + browser verification

**Files:**
- Modify: `app/components/vue-canvas/Scene3DStudioSurface.vue`

**Interfaces:**
- Produces: an HTML overlay over `viewportEl` that, in Light View, shows a chip per light (color dot + name + live intensity) at the light's projected screen position, updated each frame; hidden when Light View is off or the light is behind the camera.

- [ ] **Step 1: Implement**

5a. A reactive `lightLabels = ref<{ id: string; name: string; intensity: number; color: string; x: number; y: number; show: boolean }[]>([])`. A function `updateLightLabels()` that, when `lightView.value` and `engine`, iterates `doc.objects.filter(o => o.kind === 'light')`, projects each `light.position` through `engine.camera` (`new THREE.Vector3(...pos).project(engine.camera)`), computes screen `x = (ndc.x*0.5+0.5)*w`, `y = (-ndc.y*0.5+0.5)*h` against `viewportEl` size, and `show = ndc.z < 1` (in front of camera). Set `lightLabels.value`. Call it in the rAF `loop` (after `engine.render()`), guarded by `lightView.value` (clear to `[]` when off).

5b. Overlay markup inside the `relative` `viewportEl` container (a sibling of the canvas), `pointer-events-none` root with `@pointerdown.stop`, `v-for` over `lightLabels` → an absolutely-positioned chip (`left: x+'px'; top: y+'px'`, translate -50% to center) with a color dot and `{{ name }} · {{ intensity.toFixed(1) }}`, `v-show="label.show"`. Style small/legible (bg-black/60, text-white, rounded, text-[10px]).

- [ ] **Step 2: Browser verification** — reuse the running dev server on `127.0.0.1:3000` (do NOT spawn another). On `dev/scene3d-lab`, drive via `javascript_tool` (render loop makes pointer actions time out):
  1. Add a glass Dodecahedron and a Point + Spot + Area light; spread them out (set distinct positions via the Position inputs or gizmo).
  2. Toggle **Light View** on → confirm: objects turn matte clay; each light shows its widget (point falloff sphere, spot cone, area rect + arrows), an intensity ring, and an HTML label with name + intensity; the selected light is brighter, others dimmed.
  3. Change a light's intensity → the label number and ring update live; move a light → its widget follows.
  4. Toggle Light View off → real glass/materials return, widgets + labels gone.
  5. Confirm (console/JS) that widgets carry `isGizmoHelper` so export excludes them; optionally verify `collectEditorHelpers(engine.scene)` includes them.
  Screenshot Light View on and off.

- [ ] **Step 3: Final commit** if any polish needed.

---

## Self-Review Notes

- **Coverage:** clay + flags (T1), widget builder (T2), widget lifecycle wiring (T3), toggle + auto-enter + bake guard (T4), labels + live verify (T5).
- **Export safety:** widgets are `isGizmoHelper` children of light roots → excluded by Part 1's recursive `collectEditorHelpers`; clay is forced off in `bake()`.
- **Type consistency:** `buildLightWidget`/`setWidgetSelected`/`disposeWidget`, `setLightView`/`setSelected`/`updateLightWidgets` consistent across tasks.
- **Known risks (T5 verifies live):** clay/real-material restore correctness on toggle; widget transform following the light; label projection math; bake rendering real materials with Light View on.
