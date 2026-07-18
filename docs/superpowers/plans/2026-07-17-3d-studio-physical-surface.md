# 3D Studio Physical Surface Properties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per the user's request, dispatch implementation subagents with **model: opus**.

**Goal:** Standard becomes a full physical surface — clearcoat, sheen, glow, transparency/refraction (incl. dispersion + attenuation), iridescence, reflection intensity — with a grouped Selection panel; Glass shares the same engine.

**Architecture:** Two tasks. Task 1 extends the doc model (13 new optional fields, tolerant parsing, defaults that render identically to today) and rebuilds the factory: `standard` + `glass` both produce `MeshPhysicalMaterial` through one shared `applyPhysical` path, with in-place updates that trigger a shader recompile ONLY when a define-gated property crosses zero. Task 2 rebuilds the Selection UI into collapsible property groups and browser-verifies every group.

**Tech Stack:** Three.js 0.171 `MeshPhysicalMaterial` (all properties built in). Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-17-3d-studio-physical-surface-design.md` — read it first.

## Global Constraints

- Zero new npm dependencies.
- Back-compat is a hard requirement: with all new fields absent, `standard` must render indistinguishably from the old `MeshStandardMaterial` look (defaults: clearcoat 0, sheen 0, iridescence 0, transmission 0, dispersion 0, opacity 1, emissive '#000000', envMapIntensity 1, attenuationDistance 0→Infinity).
- Define-gated recompiles: `material.needsUpdate = true` ONLY when `transmission`, `clearcoat`, `sheen`, `iridescence`, `dispersion` cross zero or `transparent` (opacity < 1) toggles — never on plain slider movement.
- `attenuationDistance` 0 maps to `Infinity` (three's "off").
- Stylized types (toon/matcap/fresnel/gradient/image) untouched; identityKey semantics unchanged.
- Commit hygiene (parallel sessions): stage ONLY this plan's files, commit to `main`, never `git add -A`, never stash.
- Gates per task: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts` green; `npx vue-tsc --noEmit | grep -i scene3d` → no output.
- Dev servers 127.0.0.1:3000/8188 — reuse, never kill others'; browser verification uses REAL pointer interactions (this feature's history: synthetic events produced false passes; also the pane's drag `modifiers` never reach mouse events).

---

### Task 1: Model + physical factory

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts` (SceneMaterial fields ~line 31-46; MATERIAL_DEFAULTS ~line 73; parseMaterial optional-field guards)
- Modify: `frontend/app/lib/scene3d/materials.ts` (standard + glass factory cases; updateMaterial standard/glass branches)
- Test: extend `frontend/tests/unit/scene3d-config.unit.spec.ts` and `frontend/tests/unit/scene3d-materials.unit.spec.ts`

**Interfaces:**
- Consumes: existing `SceneMaterial`, `MATERIAL_DEFAULTS`, `parseMaterial` pattern (`str`/`num` helpers), `materialFor`/`updateMaterial`/`identityKey`.
- Produces (Task 2 relies on these exact names): new optional `SceneMaterial` fields `clearcoat, clearcoatRoughness, sheen, sheenColor, emissive, emissiveIntensity, opacity, dispersion, attenuationColor, attenuationDistance, iridescence, iridescenceIOR, envMapIntensity`; matching keys in `MATERIAL_DEFAULTS` (values below); `standard`/`glass` both returning `THREE.MeshPhysicalMaterial`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/scene3d-config.unit.spec.ts` (inside the describe):

```ts
  it('round-trips every physical surface field', () => {
    const doc = defaultDoc()
    const o = createPrimitive('box', doc.objects)
    Object.assign(o.material, {
      clearcoat: 0.8, clearcoatRoughness: 0.2, sheen: 0.5, sheenColor: '#ffddee',
      emissive: '#220044', emissiveIntensity: 2.5, opacity: 0.7, dispersion: 1.5,
      attenuationColor: '#88ffcc', attenuationDistance: 2, iridescence: 0.9,
      iridescenceIOR: 1.8, envMapIntensity: 2,
    })
    doc.objects.push(o)
    expect(parseDoc(serializeDoc(doc))).toEqual(doc)
  })
```

In `frontend/tests/unit/scene3d-materials.unit.spec.ts`, change the standard class expectation and add:

```ts
    // standard is a full physical surface now
    expect(materialFor(base())).toBeInstanceOf(THREE.MeshPhysicalMaterial)
```

```ts
  it('updates physical params in place and recompiles only on define crossings', () => {
    const m = materialFor(base()) as THREE.MeshPhysicalMaterial
    const v0 = m.version
    // plain param movement: no recompile
    expect(updateMaterial(m, base({ clearcoatRoughness: 0.3, envMapIntensity: 2 }))).toBe(true)
    expect(m.version).toBe(v0)
    // crossing zero on a define-gated param: exactly one recompile
    expect(updateMaterial(m, base({ transmission: 0.5 }))).toBe(true)
    expect(m.version).toBe(v0 + 1)
    // moving within the enabled range: no further recompile
    expect(updateMaterial(m, base({ transmission: 0.7 }))).toBe(true)
    expect(m.version).toBe(v0 + 1)
    // opacity < 1 toggles transparent: recompile
    expect(updateMaterial(m, base({ transmission: 0.7, opacity: 0.5 }))).toBe(true)
    expect(m.version).toBe(v0 + 2)
    expect(m.transparent).toBe(true)
  })

  it('maps attenuationDistance 0 to Infinity (off)', () => {
    const m = materialFor(base({ attenuationDistance: 0 })) as THREE.MeshPhysicalMaterial
    expect(m.attenuationDistance).toBe(Infinity)
    const m2 = materialFor(base({ attenuationDistance: 2 })) as THREE.MeshPhysicalMaterial
    expect(m2.attenuationDistance).toBe(2)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts`
Expected: FAIL — round-trip drops the unknown fields; standard is MeshStandardMaterial (note: `MeshPhysicalMaterial` IS an instance of `MeshStandardMaterial`, so the OLD class test keeps passing — that's fine, keep it).

- [ ] **Step 3: Extend the model (config.ts)**

Append to the `SceneMaterial` interface (after `image?: string`):

```ts
  // physical surface (standard + glass; all optional, defaults render identical
  // to the pre-physical look)
  clearcoat?: number            // 0–1
  clearcoatRoughness?: number   // 0–1
  sheen?: number                // 0–1
  sheenColor?: string
  emissive?: string             // '#000000' = off
  emissiveIntensity?: number    // 0–5
  opacity?: number              // 0–1 (alpha translucency; <1 sets transparent)
  dispersion?: number           // 0–5 (chromatic aberration in transmission)
  attenuationColor?: string
  attenuationDistance?: number  // 0 = off (maps to Infinity)
  iridescence?: number          // 0–1
  iridescenceIOR?: number       // 1–2.33
  envMapIntensity?: number      // 0–3
```

Append to `MATERIAL_DEFAULTS`:

```ts
  clearcoat: 0,
  clearcoatRoughness: 0.1,
  sheen: 0,
  sheenColor: '#ffffff',
  emissive: '#000000',
  emissiveIntensity: 1,
  opacity: 1,
  dispersion: 0,
  attenuationColor: '#ffffff',
  attenuationDistance: 0,
  iridescence: 0,
  iridescenceIOR: 1.3,
  envMapIntensity: 1,
```

Append to `parseMaterial`'s optional-field block (same present-and-valid pattern as the existing lines):

```ts
    if (typeof m?.clearcoat === 'number') out.clearcoat = num(m.clearcoat, MATERIAL_DEFAULTS.clearcoat)
    if (typeof m?.clearcoatRoughness === 'number') out.clearcoatRoughness = num(m.clearcoatRoughness, MATERIAL_DEFAULTS.clearcoatRoughness)
    if (typeof m?.sheen === 'number') out.sheen = num(m.sheen, MATERIAL_DEFAULTS.sheen)
    if (typeof m?.sheenColor === 'string') out.sheenColor = m.sheenColor
    if (typeof m?.emissive === 'string') out.emissive = m.emissive
    if (typeof m?.emissiveIntensity === 'number') out.emissiveIntensity = num(m.emissiveIntensity, MATERIAL_DEFAULTS.emissiveIntensity)
    if (typeof m?.opacity === 'number') out.opacity = num(m.opacity, MATERIAL_DEFAULTS.opacity)
    if (typeof m?.dispersion === 'number') out.dispersion = num(m.dispersion, MATERIAL_DEFAULTS.dispersion)
    if (typeof m?.attenuationColor === 'string') out.attenuationColor = m.attenuationColor
    if (typeof m?.attenuationDistance === 'number') out.attenuationDistance = num(m.attenuationDistance, MATERIAL_DEFAULTS.attenuationDistance)
    if (typeof m?.iridescence === 'number') out.iridescence = num(m.iridescence, MATERIAL_DEFAULTS.iridescence)
    if (typeof m?.iridescenceIOR === 'number') out.iridescenceIOR = num(m.iridescenceIOR, MATERIAL_DEFAULTS.iridescenceIOR)
    if (typeof m?.envMapIntensity === 'number') out.envMapIntensity = num(m.envMapIntensity, MATERIAL_DEFAULTS.envMapIntensity)
```

- [ ] **Step 4: Rebuild the factory (materials.ts)**

Add near the factory (above `materialFor`):

```ts
// ── Physical surface (standard + glass share one builder) ────────────────────
/** Apply every physical-surface param from the doc onto a MeshPhysicalMaterial.
 *  Shared by creation and in-place update so the two can never drift. */
function applyPhysical(p: THREE.MeshPhysicalMaterial, mat: SceneMaterial): void {
  const isGlass = mat.type === 'glass'
  p.color.set(mat.color)
  p.roughness = mat.roughness
  p.metalness = mat.metalness
  p.transmission = mat.transmission ?? (isGlass ? MATERIAL_DEFAULTS.transmission : 0)
  p.ior = mat.ior ?? MATERIAL_DEFAULTS.ior
  p.thickness = mat.thickness ?? MATERIAL_DEFAULTS.thickness
  p.clearcoat = mat.clearcoat ?? MATERIAL_DEFAULTS.clearcoat
  p.clearcoatRoughness = mat.clearcoatRoughness ?? MATERIAL_DEFAULTS.clearcoatRoughness
  p.sheen = mat.sheen ?? MATERIAL_DEFAULTS.sheen
  p.sheenColor.set(mat.sheenColor ?? MATERIAL_DEFAULTS.sheenColor)
  p.emissive.set(mat.emissive ?? MATERIAL_DEFAULTS.emissive)
  p.emissiveIntensity = mat.emissiveIntensity ?? MATERIAL_DEFAULTS.emissiveIntensity
  p.opacity = mat.opacity ?? MATERIAL_DEFAULTS.opacity
  p.transparent = p.opacity < 1
  p.dispersion = mat.dispersion ?? MATERIAL_DEFAULTS.dispersion
  p.attenuationColor.set(mat.attenuationColor ?? MATERIAL_DEFAULTS.attenuationColor)
  const att = mat.attenuationDistance ?? MATERIAL_DEFAULTS.attenuationDistance
  p.attenuationDistance = att > 0 ? att : Infinity
  p.iridescence = mat.iridescence ?? MATERIAL_DEFAULTS.iridescence
  p.iridescenceIOR = mat.iridescenceIOR ?? MATERIAL_DEFAULTS.iridescenceIOR
  p.envMapIntensity = mat.envMapIntensity ?? MATERIAL_DEFAULTS.envMapIntensity
}

/** Shader-define fingerprint: three only compiles the branches for features
 *  that are ACTIVE, so crossing any of these boundaries needs a recompile. */
function physicalDefineKey(p: THREE.MeshPhysicalMaterial): string {
  return [p.transmission > 0, p.clearcoat > 0, p.sheen > 0, p.iridescence > 0,
    p.dispersion > 0, p.transparent].join('|')
}
```

Replace the `glass` factory case AND the `standard`/default case with:

```ts
    case 'glass':
    case 'standard': {
      const p = new THREE.MeshPhysicalMaterial()
      applyPhysical(p, mat)
      m = p
      break
    }
```

(Keep `default:` falling through to the same block — i.e. `case 'glass': case 'standard': default: { ... }` — so the exhaustiveness behaviour is unchanged.)

Replace the `standard` and `glass` branches of `updateMaterial` with one:

```ts
    case 'standard':
    case 'glass': {
      const p = m as THREE.MeshPhysicalMaterial
      const before = physicalDefineKey(p)
      applyPhysical(p, mat)
      // Recompile only when a define-gated feature toggled — three compiles
      // transmission/clearcoat/sheen/iridescence/dispersion branches only when
      // active, and `transparent` swaps the render list. Plain slider movement
      // must NOT recompile (per-tick jank).
      if (physicalDefineKey(p) !== before) p.needsUpdate = true
      return true
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts`
Expected: all green (including the pre-existing glass in-place test — glass params still update in place). Then `npx vue-tsc --noEmit | grep -i scene3d` → no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/scene3d/config.ts frontend/app/lib/scene3d/materials.ts frontend/tests/unit/scene3d-config.unit.spec.ts frontend/tests/unit/scene3d-materials.unit.spec.ts
git commit -m "feat(3d-studio): physical surface model + factory (clearcoat/sheen/glow/transparency/iridescence/reflection)"
```

---

### Task 2: Grouped Selection panel + browser verification

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` only
  (matParam proxies near line ~150; the `standard` and `glass` template blocks
  in the Selection section).

**Interfaces:**
- Consumes: Task 1's fields + `MATERIAL_DEFAULTS` keys (exact names above); the surface's `matParam` helper, existing `matColor`/`matRoughness`/`matMetalness`/`matIor`/`matTransmission`/`matThickness` proxies, `StudioSlider`/`StudioColor` kit.
- Produces: no new exports — UI only.

- [ ] **Step 1: Script — add the proxies**

Next to the existing `matParam` proxies:

```ts
const matClearcoat = matParam('clearcoat')
const matClearcoatRoughness = matParam('clearcoatRoughness')
const matSheen = matParam('sheen')
const matSheenColor = matParam('sheenColor')
const matEmissive = matParam('emissive')
const matEmissiveIntensity = matParam('emissiveIntensity')
const matOpacity = matParam('opacity')
const matDispersion = matParam('dispersion')
const matAttenuationColor = matParam('attenuationColor')
const matAttenuationDistance = matParam('attenuationDistance')
const matIridescence = matParam('iridescence')
const matIridescenceIOR = matParam('iridescenceIOR')
const matEnvMapIntensity = matParam('envMapIntensity')
```

- [ ] **Step 2: Template — merge standard+glass into grouped sections**

Replace the two existing blocks (`matType === 'standard'` and `matType === 'glass'`) with ONE:

```vue
        <!-- physical surface: standard + glass share the grouped panel -->
        <template v-if="selectedIsPrimitive && (matType === 'standard' || matType === 'glass')">
          <div>
            <p class="mb-1.5 text-[10px] uppercase tracking-[0.12em] text-white/35">Surface</p>
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-white/55">Color</span>
                <StudioColor v-model="matColor" />
              </div>
              <StudioSlider v-model="matRoughness" label="Roughness" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matMetalness" label="Metalness" :min="0" :max="1" :step="0.01" />
            </div>
          </div>

          <details class="group">
            <summary class="cursor-pointer select-none py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 hover:text-white/60">Coat &amp; sheen</summary>
            <div class="space-y-3 pt-1">
              <StudioSlider v-model="matClearcoat" label="Clearcoat" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matClearcoatRoughness" label="Coat roughness" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matSheen" label="Sheen" :min="0" :max="1" :step="0.01" />
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-white/55">Sheen colour</span>
                <StudioColor v-model="matSheenColor" />
              </div>
            </div>
          </details>

          <details class="group">
            <summary class="cursor-pointer select-none py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 hover:text-white/60">Glow</summary>
            <div class="space-y-3 pt-1">
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-white/55">Emissive</span>
                <StudioColor v-model="matEmissive" />
              </div>
              <StudioSlider v-model="matEmissiveIntensity" label="Intensity" :min="0" :max="5" :step="0.05" />
            </div>
          </details>

          <details class="group" :open="matType === 'glass'">
            <summary class="cursor-pointer select-none py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 hover:text-white/60">Transparency</summary>
            <div class="space-y-3 pt-1">
              <StudioSlider v-model="matOpacity" label="Opacity" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matTransmission" label="Transmission" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matIor" label="IOR" :min="1" :max="2.33" :step="0.01" />
              <StudioSlider v-model="matThickness" label="Thickness" :min="0" :max="2" :step="0.05" />
              <StudioSlider v-model="matDispersion" label="Dispersion" :min="0" :max="5" :step="0.05" />
              <div class="flex items-center justify-between">
                <span class="text-[11px] text-white/55">Attenuation</span>
                <StudioColor v-model="matAttenuationColor" />
              </div>
              <StudioSlider v-model="matAttenuationDistance" label="Attenuation dist" :min="0" :max="10" :step="0.1" />
            </div>
          </details>

          <details class="group">
            <summary class="cursor-pointer select-none py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 hover:text-white/60">Iridescence</summary>
            <div class="space-y-3 pt-1">
              <StudioSlider v-model="matIridescence" label="Amount" :min="0" :max="1" :step="0.01" />
              <StudioSlider v-model="matIridescenceIOR" label="IOR" :min="1" :max="2.33" :step="0.01" />
            </div>
          </details>

          <details class="group">
            <summary class="cursor-pointer select-none py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 hover:text-white/60">Reflection</summary>
            <div class="space-y-3 pt-1">
              <StudioSlider v-model="matEnvMapIntensity" label="Intensity" :min="0" :max="3" :step="0.05" />
            </div>
          </details>
        </template>
```

(The old separate glass block disappears; note the Transparency group defaults
open for glass via `:open="matType === 'glass'"`. Note on `<details> :open`:
Vue binds it as the initial state; user toggling still works.)

- [ ] **Step 3: Gates**

Run: `cd frontend && npx vue-tsc --noEmit | grep -i scene3d` → no output; the 4 scene3d vitest files → green.

- [ ] **Step 4: Browser verification (REAL interactions; measure slider effects via the render)**

At `http://127.0.0.1:3000/dev/scene3d-lab` (reuse servers):
- Sphere + standard: confirm default look unchanged from before this feature (no visible difference on a fresh object).
- Open each group and push its slider(s) to max, confirming a visible change each time: Clearcoat (sharp secondary highlight), Sheen w/ colour (edge glow), Emissive colour + intensity (glow), Opacity 0.4 (ghosting), Transmission 1 + IOR 2 + Dispersion 4 on a sphere (glassy with rainbow fringing), Attenuation colour + distance (tinted depth), Iridescence 1 (rainbow film), Reflection 0 vs 3 (matte vs mirror-ish).
- Drag a slider continuously (e.g. roughness, then transmission within >0 range) — no visible hitching (recompile jank) once the feature is active.
- Glass type: Transparency group opens by default; still refracts as before.
- Save → reopen → all values restore. Export to Canvas → beauty matches viewport; open the depth pass URL → clean ramp (unaffected).
- Screenshots: (a) the grouped panel with a couple of groups open, (b) a sphere with iridescence + clearcoat, (c) a dispersive glass sphere.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(3d-studio): grouped physical-surface panel (coat/sheen/glow/transparency/iridescence/reflection)"
```
