# 3D Studio Primitives + Add Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per the user's request, dispatch implementation subagents with **model: opus**.

**Goal:** Grow the 3D Studio's primitive set from 6 to 14 shapes and replace the invisible native `+ Add` select with a Smart Layout-style bottom toolbar whose "+ Primitive" button opens a grouped menu.

**Architecture:** Two self-contained tasks. Task 1 extends the scene document model (`PrimitiveKind` union) and the engine's geometry factory — the add-menu, serialization, and validation are all driven by the same list, so old scenes parse unchanged. Task 2 rebuilds the surface's add UX: a floating bottom-center pill (Grid-editor style) with a "+ Primitive" popup menu and the relocated Upload GLB button.

**Tech Stack:** Three.js 0.171 built-in geometries, lucide-vue-next icons (already installed). Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-17-3d-studio-primitives-toolbar-design.md` — read it first.

## Global Constraints

- Zero new npm dependencies.
- The 14 kinds, in canonical order (menu order = `PRIMITIVE_KINDS` order): `box, sphere, cylinder, cone, torus, plane, capsule, pyramid, prism, icosahedron, octahedron, dodecahedron, torusKnot, ring`.
- Menu groups: Basics (box…plane) · Solids (capsule, pyramid, prism) · Polyhedra (icosahedron, octahedron, dodecahedron) · Decorative (torusKnot, ring).
- Flat kinds (`plane`, `ring`) render double-sided; all other kinds stay front-side.
- Old scene JSONs must parse unchanged; unknown kinds are dropped by `parseDoc`, never errors.
- Esc while the primitive menu is open closes ONLY the menu (never the modal) — extend the surface's existing capture-phase Esc precedence chain.
- Commit hygiene (parallel sessions): stage ONLY the files this plan touches, commit directly to `main`, never `git add -A`, never stash.
- Typecheck gate: `cd frontend && npx vue-tsc --noEmit | grep -i scene3d` → no output.
- Dev servers: 127.0.0.1:3000 (Nuxt, HMR) and 127.0.0.1:8188 (ComfyUI) — reuse if healthy, never kill servers you didn't start; always 127.0.0.1, never localhost.

---

### Task 1: 8 new primitives in model + engine

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts:5` (PrimitiveKind union) and `:42` (PRIMITIVE_KINDS)
- Modify: `frontend/app/lib/scene3d/engine.ts` (`geometryFor()` ~line 27; `syncObject`'s primitive-creation branch)
- Test: `frontend/tests/unit/scene3d-config.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: existing `PrimitiveKind`, `PRIMITIVE_KINDS`, `createPrimitive`, `parseDoc`, `serializeDoc` from `~/lib/scene3d/config`; `geometryFor` (module-private) in `~/lib/scene3d/engine`.
- Produces: `PrimitiveKind`/`PRIMITIVE_KINDS` covering all 14 kinds in the canonical order above — Task 2's menu iterates `PRIMITIVE_KINDS` groupings and calls the existing `addPrimitive(kind)` handler; no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/scene3d-config.unit.spec.ts` inside the existing `describe('scene3d config')`:

```ts
  it('round-trips a document containing every primitive kind', () => {
    const doc = defaultDoc()
    for (const kind of PRIMITIVE_KINDS) doc.objects.push(createPrimitive(kind, doc.objects))
    expect(PRIMITIVE_KINDS).toHaveLength(14)
    const back = parseDoc(serializeDoc(doc))
    expect(back).toEqual(doc)
    expect(back.objects.map((o) => (o as any).primitive)).toEqual([...PRIMITIVE_KINDS])
  })

  it('drops objects with an unknown primitive kind instead of erroring', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects.push({ ...raw.objects[0], id: 'obj_bad', primitive: 'blob' })
    const back = parseDoc(JSON.stringify(raw))
    expect(back.objects).toHaveLength(1)
    expect((back.objects[0] as any).primitive).toBe('box')
  })
```

Add `PRIMITIVE_KINDS` to the existing import from `~/lib/scene3d/config`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: FAIL — `expect(PRIMITIVE_KINDS).toHaveLength(14)` gets 6.

- [ ] **Step 3: Extend the model**

In `frontend/app/lib/scene3d/config.ts` replace the union (line 5) and list (line 42):

```ts
export type PrimitiveKind =
  | 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane'
  | 'capsule' | 'pyramid' | 'prism'
  | 'icosahedron' | 'octahedron' | 'dodecahedron'
  | 'torusKnot' | 'ring'
```

```ts
export const PRIMITIVE_KINDS: PrimitiveKind[] = [
  'box', 'sphere', 'cylinder', 'cone', 'torus', 'plane',
  'capsule', 'pyramid', 'prism',
  'icosahedron', 'octahedron', 'dodecahedron',
  'torusKnot', 'ring',
]
```

(`createPrimitive`'s name derivation capitalizes the first letter — "torusKnot" → "TorusKnot" is accepted per spec; no change there.)

- [ ] **Step 4: Extend the engine**

In `frontend/app/lib/scene3d/engine.ts`, `geometryFor()` — add the 8 cases (keep the existing 6 verbatim):

```ts
    case 'capsule': return new THREE.CapsuleGeometry(0.35, 0.5, 8, 24)
    // 4-sided cone = pyramid; rotated so the square footprint is axis-aligned.
    case 'pyramid': return new THREE.ConeGeometry(0.55, 1, 4, 1).rotateY(Math.PI / 4)
    case 'prism': return new THREE.CylinderGeometry(0.5, 0.5, 1, 3)
    case 'icosahedron': return new THREE.IcosahedronGeometry(0.55)
    case 'octahedron': return new THREE.OctahedronGeometry(0.55)
    case 'dodecahedron': return new THREE.DodecahedronGeometry(0.55)
    case 'torusKnot': return new THREE.TorusKnotGeometry(0.4, 0.12, 128, 16)
    case 'ring': return new THREE.RingGeometry(0.22, 0.5, 48).rotateX(-Math.PI / 2)
```

In `syncObject`'s primitive-creation branch (where `new THREE.MeshStandardMaterial()` is constructed for a new primitive root), make flat kinds double-sided at creation time — retype rebuilds go through root re-creation (`sourceKey`), so creation-time is sufficient:

```ts
        const mat = new THREE.MeshStandardMaterial()
        // Flat shapes must be visible from both sides (plane was previously
        // invisible from below; ring inherits the fix).
        if (obj.primitive === 'plane' || obj.primitive === 'ring') mat.side = THREE.DoubleSide
        const mesh = new THREE.Mesh(geometryFor(obj.primitive), mat)
```

(Adapt to the exact current constructor line — the mesh today is built as `new THREE.Mesh(geometryFor(obj.primitive), new THREE.MeshStandardMaterial())`; split it as shown.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts`
Expected: all pass (6 + 2 + 3). Then `npx vue-tsc --noEmit | grep -i scene3d` → no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/scene3d/config.ts frontend/app/lib/scene3d/engine.ts frontend/tests/unit/scene3d-config.unit.spec.ts
git commit -m "feat(3d-studio): 8 new primitives (capsule, pyramid, prism, polyhedra, torus knot, ring)"
```

---

### Task 2: Bottom add-toolbar with "+ Primitive" menu

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` only.

**Interfaces:**
- Consumes: `PRIMITIVE_KINDS`, `PrimitiveKind` (Task 1, 14 kinds); the surface's existing `addPrimitive(kind)`, `triggerGlbUpload()`, `onGlbFilePicked`, `uploading`, `uploadError`, `glbFileInput`, `webglOk`, and the capture-phase `onKey` Esc chain (`Scene3DStudioSurface.vue:212-236`).
- Produces: no new exports — UI-only rework inside the surface.

Current state to modify (verified 2026-07-17): the native `<select>` lives in the top-left overlay at `Scene3DStudioSurface.vue:386-396`; Upload GLB button + hidden file input + error text live in the Objects `StudioSection` at `:429-440`; empty-state copy at `:412-414`; Esc handling in `onKey` at `:222-234`.

- [ ] **Step 1: Script changes**

Add state + menu data + outside-click close near the other refs (~line 60):

```ts
const primMenuOpen = ref(false)

// Menu groups (spec order). Icons: real lucide glyphs where they exist,
// nearest-match otherwise — verify each import against the installed
// lucide-vue-next export list and substitute the closest available glyph
// for any missing name (keep the labels exactly as written).
const PRIM_GROUPS: { label: string; kinds: { kind: PrimitiveKind; label: string; icon: Component }[] }[] = [
  { label: 'Basics', kinds: [
    { kind: 'box', label: 'Box', icon: Box },
    { kind: 'sphere', label: 'Sphere', icon: Circle },
    { kind: 'cylinder', label: 'Cylinder', icon: Cylinder },
    { kind: 'cone', label: 'Cone', icon: Cone },
    { kind: 'torus', label: 'Torus', icon: Torus },
    { kind: 'plane', label: 'Plane', icon: Square },
  ] },
  { label: 'Solids', kinds: [
    { kind: 'capsule', label: 'Capsule', icon: Pill },
    { kind: 'pyramid', label: 'Pyramid', icon: Pyramid },
    { kind: 'prism', label: 'Prism', icon: Triangle },
  ] },
  { label: 'Polyhedra', kinds: [
    { kind: 'icosahedron', label: 'Icosahedron', icon: Gem },
    { kind: 'octahedron', label: 'Octahedron', icon: Diamond },
    { kind: 'dodecahedron', label: 'Dodecahedron', icon: Hexagon },
  ] },
  { label: 'Decorative', kinds: [
    { kind: 'torusKnot', label: 'Torus knot', icon: InfinityIcon }, // import as `Infinity as InfinityIcon` — bare `Infinity` shadows the JS global
    { kind: 'ring', label: 'Ring', icon: CircleDashed },
  ] },
]

function pickPrimitive(kind: PrimitiveKind) {
  addPrimitive(kind)
  primMenuOpen.value = false
}

// Outside click closes the menu (registered only while open).
function onPrimMenuOutside(e: PointerEvent) {
  if (!(e.target as HTMLElement)?.closest?.('[data-prim-menu]')) primMenuOpen.value = false
}
watch(primMenuOpen, (open) => {
  if (open) window.addEventListener('pointerdown', onPrimMenuOutside, true)
  else window.removeEventListener('pointerdown', onPrimMenuOutside, true)
})
```

Import `type Component` from `vue` and the icon names from `lucide-vue-next` (extending the existing import line). Remove the `PRIMITIVE_KINDS` import ONLY if nothing else in the file still uses it after the select is deleted — `PRIM_GROUPS` supersedes it in the template (`PrimitiveKind` stays imported).

Extend `onKey`'s Escape branch — the menu owns Esc ahead of everything else (insert BEFORE the StudioColor yield):

```ts
  else if (e.key === 'Escape') {
    // Open primitive menu owns Esc: close it, never the modal.
    if (primMenuOpen.value) {
      e.preventDefault()
      e.stopImmediatePropagation()
      primMenuOpen.value = false
      return
    }
    // An open StudioColor popover owns Escape (its own capture listener closes
    ...existing chain unchanged...
```

Also ensure the outside-click listener is removed in the existing `onBeforeUnmount` (add `window.removeEventListener('pointerdown', onPrimMenuOutside, true)`).

- [ ] **Step 2: Template changes**

(a) Delete the native `<select>` block (`:388-396`) from the top-left overlay; keep gizmo mode / snap / Set camera there unchanged.

(b) Inside the viewport container (sibling of the top-left overlay, still under `v-if="webglOk"` semantics), add the bottom toolbar — Grid-editor pill styling per `GridEditorShell.vue`'s bottom cluster:

```vue
        <!-- Bottom add-toolbar (Grid editor pill style): + Primitive menu · Upload GLB -->
        <div v-if="webglOk" class="absolute bottom-3 left-1/2 -translate-x-1/2 z-10" data-prim-menu>
          <p v-if="uploadError" class="mb-2 text-center text-[11px] text-red-400/90">{{ uploadError }}</p>
          <div class="relative flex items-center gap-1 rounded-[12px] border border-[#2a2a2a] bg-[#1a1a1a]/95 p-1.5 shadow-lg">
            <button
              type="button"
              class="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors cursor-pointer"
              :class="primMenuOpen ? 'bg-white/15 text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'"
              @click="primMenuOpen = !primMenuOpen"
            >
              <Plus class="size-4" /> Primitive
            </button>
            <div class="mx-0.5 h-5 w-px bg-white/10" />
            <button
              type="button"
              :disabled="uploading"
              class="flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-white/70 transition-colors hover:bg-white/10 hover:text-white cursor-pointer disabled:opacity-50"
              @click="triggerGlbUpload"
            >
              <Loader2 v-if="uploading" class="size-4 animate-spin" />
              <Upload v-else class="size-4" />
              {{ uploading ? 'Uploading…' : 'Upload GLB' }}
            </button>

            <!-- Primitive menu: popup card above the button (Brand-panel mechanic) -->
            <div
              v-if="primMenuOpen"
              class="absolute bottom-full left-0 z-30 mb-2 w-64 rounded-lg border border-white/10 bg-[#161616] p-2 shadow-2xl"
            >
              <div v-for="group in PRIM_GROUPS" :key="group.label" class="mb-1.5 last:mb-0">
                <p class="mb-1 px-1 text-[10px] uppercase tracking-[0.12em] text-white/35">{{ group.label }}</p>
                <div class="grid grid-cols-2 gap-0.5">
                  <button
                    v-for="p in group.kinds"
                    :key="p.kind"
                    type="button"
                    class="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
                    @click="pickPrimitive(p.kind)"
                  >
                    <component :is="p.icon" class="size-4 shrink-0 opacity-70" />
                    {{ p.label }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
```

(c) In the Objects section: delete the Upload GLB `StudioButton` and the `<p v-if="uploadError">` line (`:433-440`), but KEEP the hidden `<input ref="glbFileInput" …>` (move it next to the new toolbar button or leave it in the rail markup — it is `class="hidden"`, position is irrelevant; do not duplicate it). Keep "Import wired model" where it is. Update the empty-state copy (`:412-414`) to:

```vue
        <div v-if="!doc.objects.length" class="text-xs text-white/40">
          Empty scene — add a primitive or upload a GLB from the toolbar below<span v-if="wiredGlbUrl">, or import the wired model</span>.
        </div>
```

- [ ] **Step 3: Typecheck + unit gates**

Run: `cd frontend && npx vue-tsc --noEmit | grep -i scene3d` → no output; `npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts` → all pass.

- [ ] **Step 4: Browser verification**

At `http://127.0.0.1:3000/dev/scene3d-lab` (reuse running servers; HMR): open the surface and verify —
- Bottom pill renders centered; "+ Primitive" opens the grouped menu ABOVE the button; all 4 groups and 14 entries present.
- Each of the 8 NEW shapes adds, is selected on add, and renders (spot-check capsule, pyramid, torus knot, ring at minimum — orbit to see them).
- Ring and plane are visible from BELOW (orbit under the ground plane).
- Esc with the menu open closes only the menu (modal stays); Esc again (no selection) closes the modal; reopen.
- Outside click closes the menu; W/E/R still switch gizmo modes after using the menu.
- Upload GLB works from the toolbar (any .glb, or skip actual upload if none at hand and verify the picker opens + `uploadError` renders above the pill on a bad file).
- Bake a scene containing at least one new shape → widgets fill; open the depth URL and confirm the new shape is present in the pass.
Screenshots: (a) open menu over the viewport, (b) a baked scene with new shapes.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(3d-studio): bottom add-toolbar with grouped Primitive menu"
```
