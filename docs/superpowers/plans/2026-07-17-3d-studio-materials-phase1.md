# 3D Studio Material Types Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Per the user's request, dispatch implementation subagents with **model: opus**.

**Goal:** Seven selectable material types for 3D Studio primitives — standard, toon, matcap, glass, fresnel, gradient, image — with a type picker and per-type controls in the Selection panel.

**Architecture:** Three tasks. Task 1 extends the scene document model (`SceneMaterial.type` + optional per-type params, tolerant parsing so old scenes load as `standard`). Task 2 adds a `materials.ts` factory module (create/update/dispose all Three materials, runtime-generated matcaps, small fresnel/gradient shaders) and delegates the engine's material handling to it. Task 3 rebuilds the Selection UI (type dropdown + conditional controls + image upload) and browser-verifies everything.

**Tech Stack:** Three.js 0.171 built-ins (MeshToonMaterial, MeshMatcapMaterial, MeshPhysicalMaterial, ShaderMaterial, CanvasTexture, DataTexture). Zero new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-17-3d-studio-materials-phase1-design.md` — read it first.

## Global Constraints

- Zero new npm dependencies.
- Material types, in canonical picker order: `standard, toon, matcap, glass, fresnel, gradient, image` (exported as `MATERIAL_TYPES`).
- Old scene JSONs (material without `type`) parse as `standard`, byte-identical behavior; unknown `type` degrades to `standard`, never errors.
- GLB objects keep their imported materials — all material UI stays behind the existing `selectedIsPrimitive` gate.
- Flat kinds (`plane`, `ring`) render double-sided for EVERY material type.
- Depth/normal bake passes must be unaffected (override materials; no geometry changes in this feature).
- Shared matcap textures are module-lifetime singletons, never disposed; image maps and per-material toon ramps are disposed with their material.
- Commit hygiene (parallel sessions): stage ONLY this plan's files, commit directly to `main`, never `git add -A`, never stash.
- Gates per task: the scene3d vitest files green; `cd frontend && npx vue-tsc --noEmit | grep -i scene3d` → no output.
- Dev servers: 127.0.0.1:3000 / 127.0.0.1:8188 — reuse if healthy, never kill servers you didn't start; always 127.0.0.1. `./dev.sh` (repo root) is the kill-and-take-over launcher if both are down.
- Browser verification of editor UI must use REAL pointer interactions (CDP clicks), never dispatched synthetic events — synthetic events bypass pointer capture and have produced false verification passes twice in this feature's history.

---

### Task 1: Material model — `config.ts`

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts` (SceneMaterial at line ~12; DEFAULT_MATERIAL at ~57; parseDoc material block at ~124-128)
- Test: `frontend/tests/unit/scene3d-config.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: existing `SceneMaterial`, `DEFAULT_MATERIAL`, `parseDoc`, `serializeDoc`, `createPrimitive`.
- Produces (Tasks 2–3 rely on these exact names):

```ts
export type MaterialType = 'standard' | 'toon' | 'matcap' | 'glass' | 'fresnel' | 'gradient' | 'image'
export const MATERIAL_TYPES: MaterialType[]   // canonical picker order
export interface SceneMaterial {
  type: MaterialType
  color: string
  roughness: number
  metalness: number
  toonSteps?: number
  matcap?: string
  ior?: number
  transmission?: number
  thickness?: number
  fresnelColor?: string
  fresnelPower?: number
  gradientB?: string
  gradientAxis?: 'x' | 'y' | 'z'
  image?: string
}
// Per-type param defaults, single source of truth for factory (Task 2) and UI proxies (Task 3):
export const MATERIAL_DEFAULTS: {
  toonSteps: number; matcap: string; ior: number; transmission: number; thickness: number
  fresnelColor: string; fresnelPower: number; gradientB: string; gradientAxis: 'x' | 'y' | 'z'
}
```

- [ ] **Step 1: Write the failing tests**

Append inside `describe('scene3d config')` in `frontend/tests/unit/scene3d-config.unit.spec.ts` (add `MATERIAL_TYPES` to the config import):

```ts
  it('round-trips every material type with params', () => {
    const doc = defaultDoc()
    const boxFor = (patch: any) => {
      const o = createPrimitive('box', doc.objects)
      Object.assign(o.material, patch)
      doc.objects.push(o)
    }
    boxFor({ type: 'toon', toonSteps: 4 })
    boxFor({ type: 'matcap', matcap: 'gold' })
    boxFor({ type: 'glass', ior: 1.8, transmission: 0.9, thickness: 1.2, roughness: 0.1 })
    boxFor({ type: 'fresnel', fresnelColor: '#ff00aa', fresnelPower: 5 })
    boxFor({ type: 'gradient', gradientB: '#123456', gradientAxis: 'z' })
    boxFor({ type: 'image', image: 'scene3d_tex_1.png' })
    expect(MATERIAL_TYPES).toHaveLength(7)
    const back = parseDoc(serializeDoc(doc))
    expect(back).toEqual(doc)
  })

  it('migrates old materials (no type field) to standard', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    const raw = JSON.parse(serializeDoc(doc))
    delete raw.objects[0].material.type
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).material.type).toBe('standard')
  })

  it('degrades an unknown material type to standard', () => {
    const doc = defaultDoc()
    doc.objects.push(createPrimitive('box', doc.objects))
    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].material.type = 'hologram'
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).material.type).toBe('standard')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: FAIL — `MATERIAL_TYPES` is not exported.

- [ ] **Step 3: Implement the model**

In `frontend/app/lib/scene3d/config.ts`:

Replace the `SceneMaterial` interface (line ~12) with the Produces block's version, and add above it:

```ts
export type MaterialType = 'standard' | 'toon' | 'matcap' | 'glass' | 'fresnel' | 'gradient' | 'image'
export const MATERIAL_TYPES: MaterialType[] = ['standard', 'toon', 'matcap', 'glass', 'fresnel', 'gradient', 'image']
```

Replace `DEFAULT_MATERIAL` (~line 57) and add `MATERIAL_DEFAULTS` beside it:

```ts
const DEFAULT_MATERIAL: SceneMaterial = { type: 'standard', color: '#9aa3af', roughness: 0.6, metalness: 0.0 }

/** Per-type parameter defaults — the single source of truth shared by the
 *  material factory (materials.ts) and the Selection UI's proxies. */
export const MATERIAL_DEFAULTS = {
  toonSteps: 3,
  matcap: 'chrome',
  ior: 1.5,
  transmission: 1,
  thickness: 0.5,
  fresnelColor: '#8ab4ff',
  fresnelPower: 3,
  gradientB: '#1c2740',
  gradientAxis: 'y' as const,
}
```

Replace the material block inside `parseDoc` (~lines 124-128) with a call to a new helper, defined next to `vec3`:

```ts
  const str = (v: any, fb: string): string => (typeof v === 'string' ? v : fb)
  const num = (v: any, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb)
  const parseMaterial = (m: any): SceneMaterial => {
    const out: SceneMaterial = {
      type: MATERIAL_TYPES.includes(m?.type) ? m.type : 'standard',
      color: str(m?.color, DEFAULT_MATERIAL.color),
      roughness: num(m?.roughness, DEFAULT_MATERIAL.roughness),
      metalness: num(m?.metalness, DEFAULT_MATERIAL.metalness),
    }
    // Optional per-type params: copy only when present AND valid, so absent
    // fields stay absent (keeps serialize→parse round-trips exact).
    if (typeof m?.toonSteps === 'number') out.toonSteps = num(m.toonSteps, MATERIAL_DEFAULTS.toonSteps)
    if (typeof m?.matcap === 'string') out.matcap = m.matcap
    if (typeof m?.ior === 'number') out.ior = num(m.ior, MATERIAL_DEFAULTS.ior)
    if (typeof m?.transmission === 'number') out.transmission = num(m.transmission, MATERIAL_DEFAULTS.transmission)
    if (typeof m?.thickness === 'number') out.thickness = num(m.thickness, MATERIAL_DEFAULTS.thickness)
    if (typeof m?.fresnelColor === 'string') out.fresnelColor = m.fresnelColor
    if (typeof m?.fresnelPower === 'number') out.fresnelPower = num(m.fresnelPower, MATERIAL_DEFAULTS.fresnelPower)
    if (typeof m?.gradientB === 'string') out.gradientB = m.gradientB
    if (m?.gradientAxis === 'x' || m?.gradientAxis === 'y' || m?.gradientAxis === 'z') out.gradientAxis = m.gradientAxis
    if (typeof m?.image === 'string') out.image = m.image
    return out
  }
```

and in the object-mapping block: `material: parseMaterial(o.material),`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts`
Expected: all pass (existing 7 + new 3). Then `npx vue-tsc --noEmit | grep -i scene3d` → no output.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/config.ts frontend/tests/unit/scene3d-config.unit.spec.ts
git commit -m "feat(3d-studio): material type model (7 types, tolerant parsing)"
```

---

### Task 2: Materials factory + engine delegation

**Files:**
- Create: `frontend/app/lib/scene3d/materials.ts`
- Modify: `frontend/app/lib/scene3d/engine.ts` (primitive material creation ~line 155 and the sync-update block ~line 180)
- Test: `frontend/tests/unit/scene3d-materials.unit.spec.ts` (new)

**Interfaces:**
- Consumes: `SceneMaterial`, `MaterialType`, `MATERIAL_DEFAULTS` from `./config` (Task 1); `PrimitiveKind`.
- Produces (Task 3 relies on these exact names):

```ts
// materials.ts
export function materialFor(mat: SceneMaterial, geometry?: THREE.BufferGeometry): THREE.Material
export function updateMaterial(m: THREE.Material, mat: SceneMaterial): boolean // true = updated in place; false = rebuild needed
export function disposeMaterial(m: THREE.Material): void
export const MATCAP_IDS: string[]              // ['chrome','clay','pearl','gold','carbon']
export function matcapThumb(id: string): string  // 64px PNG data URL for the picker swatch ('' in non-DOM envs)
export function onTextureError(cb: (filename: string) => void): () => void  // subscribe; returns unsubscribe
```

- [ ] **Step 1: Write the failing tests (node-safe parts only)**

```ts
// frontend/tests/unit/scene3d-materials.unit.spec.ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { materialFor, updateMaterial, MATCAP_IDS } from '~/lib/scene3d/materials'
import type { SceneMaterial } from '~/lib/scene3d/config'

const base = (patch: Partial<SceneMaterial> = {}): SceneMaterial =>
  ({ type: 'standard', color: '#9aa3af', roughness: 0.6, metalness: 0, ...patch })

describe('scene3d materials factory', () => {
  it('maps each type to the right THREE material class', () => {
    expect(materialFor(base())).toBeInstanceOf(THREE.MeshStandardMaterial)
    expect(materialFor(base({ type: 'toon' }))).toBeInstanceOf(THREE.MeshToonMaterial)
    expect(materialFor(base({ type: 'matcap' }))).toBeInstanceOf(THREE.MeshMatcapMaterial)
    expect(materialFor(base({ type: 'glass' }))).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect(materialFor(base({ type: 'fresnel' }))).toBeInstanceOf(THREE.ShaderMaterial)
    expect(materialFor(base({ type: 'gradient' }))).toBeInstanceOf(THREE.ShaderMaterial)
    expect(materialFor(base({ type: 'image' }))).toBeInstanceOf(THREE.MeshStandardMaterial)
  })

  it('updates in place while type and identity params are unchanged', () => {
    const m = materialFor(base())
    expect(updateMaterial(m, base({ color: '#ff0000', roughness: 0.2 }))).toBe(true)
    expect((m as THREE.MeshStandardMaterial).roughness).toBe(0.2)
  })

  it('requests a rebuild on type change and identity-param change', () => {
    expect(updateMaterial(materialFor(base()), base({ type: 'toon' }))).toBe(false)
    expect(updateMaterial(materialFor(base({ type: 'toon' })), base({ type: 'toon', toonSteps: 5 }))).toBe(false)
    expect(updateMaterial(materialFor(base({ type: 'matcap' })), base({ type: 'matcap', matcap: 'gold' }))).toBe(false)
    expect(updateMaterial(materialFor(base({ type: 'image' })), base({ type: 'image', image: 'a.png' }))).toBe(false)
  })

  it('updates glass params in place', () => {
    const m = materialFor(base({ type: 'glass' }))
    expect(updateMaterial(m, base({ type: 'glass', ior: 2.0, thickness: 1.5 }))).toBe(true)
    expect((m as THREE.MeshPhysicalMaterial).ior).toBe(2.0)
  })

  it('exposes the five matcap ids', () => {
    expect(MATCAP_IDS).toEqual(['chrome', 'clay', 'pearl', 'gold', 'carbon'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/scene3d-materials.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/scene3d/materials`.

- [ ] **Step 3: Implement `materials.ts`**

```ts
// frontend/app/lib/scene3d/materials.ts
// Material factory for 3D Studio primitives. One module owns creation, in-place
// update, and disposal for every material type, so the engine stays lean and
// the Selection UI can share the same defaults (config.MATERIAL_DEFAULTS).
//
// Node-safety: matcap textures and picker thumbnails need a canvas; in non-DOM
// environments (vitest) those degrade to null/'' while the material classes and
// update logic stay fully testable.
import * as THREE from 'three'
import { MATERIAL_DEFAULTS, type SceneMaterial } from './config'

const hasDOM = typeof document !== 'undefined'

// ── Matcaps: runtime-generated set (no bundled assets) ───────────────────────
export const MATCAP_IDS = ['chrome', 'clay', 'pearl', 'gold', 'carbon']

interface MatcapSpec { inner: string; mid: string; outer: string; highlight: number }
const MATCAP_SPECS: Record<string, MatcapSpec> = {
  chrome: { inner: '#f8fafc', mid: '#94a3b8', outer: '#1e293b', highlight: 0.9 },
  clay:   { inner: '#e7e2da', mid: '#b6aa99', outer: '#57503f', highlight: 0.25 },
  pearl:  { inner: '#fff7fb', mid: '#dcc8e8', outer: '#8e7a9d', highlight: 0.55 },
  gold:   { inner: '#fff3c4', mid: '#d9a441', outer: '#5c3a10', highlight: 0.8 },
  carbon: { inner: '#4b5563', mid: '#1f2937', outer: '#030712', highlight: 0.35 },
}

function drawMatcap(spec: MatcapSpec, size: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  // Sphere-shaded radial gradient, light from upper-left (matcap convention).
  const g = ctx.createRadialGradient(size * 0.38, size * 0.35, size * 0.05, size * 0.5, size * 0.5, size * 0.55)
  g.addColorStop(0, spec.inner)
  g.addColorStop(0.55, spec.mid)
  g.addColorStop(1, spec.outer)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  // Specular highlight dot.
  const h = ctx.createRadialGradient(size * 0.36, size * 0.32, 0, size * 0.36, size * 0.32, size * 0.16)
  h.addColorStop(0, `rgba(255,255,255,${spec.highlight})`)
  h.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = h
  ctx.fillRect(0, 0, size, size)
  return c
}

const matcapCache = new Map<string, THREE.Texture>()
/** Module-lifetime singleton textures — shared across materials, never disposed. */
function getMatcap(id: string): THREE.Texture | null {
  if (!hasDOM) return null
  const key = MATCAP_SPECS[id] ? id : MATCAP_IDS[0]!
  let t = matcapCache.get(key)
  if (!t) {
    t = new THREE.CanvasTexture(drawMatcap(MATCAP_SPECS[key]!, 256))
    t.colorSpace = THREE.SRGBColorSpace
    matcapCache.set(key, t)
  }
  return t
}

const thumbCache = new Map<string, string>()
export function matcapThumb(id: string): string {
  if (!hasDOM) return ''
  const key = MATCAP_SPECS[id] ? id : MATCAP_IDS[0]!
  let u = thumbCache.get(key)
  if (!u) { u = drawMatcap(MATCAP_SPECS[key]!, 64).toDataURL('image/png'); thumbCache.set(key, u) }
  return u
}

// ── Toon step ramp (per-material, disposed with it) ──────────────────────────
function toonRamp(steps: number): THREE.DataTexture {
  const n = Math.max(2, Math.min(5, Math.round(steps)))
  const data = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const v = Math.round((i / (n - 1)) * 255)
    data.set([v, v, v, 255], i * 4)
  }
  const t = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat)
  t.magFilter = t.minFilter = THREE.NearestFilter
  t.needsUpdate = true
  return t
}

// ── Image textures (cached per filename; failures broadcast to the UI) ───────
const imageCache = new Map<string, THREE.Texture>()
const errorSubs = new Set<(filename: string) => void>()
export function onTextureError(cb: (filename: string) => void): () => void {
  errorSubs.add(cb)
  return () => errorSubs.delete(cb)
}
function getImageTexture(filename: string): THREE.Texture | null {
  if (!hasDOM || !filename) return null
  let t = imageCache.get(filename)
  if (!t) {
    t = new THREE.TextureLoader().load(
      `/view?${new URLSearchParams({ filename, type: 'input' })}`,
      undefined,
      undefined,
      () => { imageCache.delete(filename); errorSubs.forEach((cb) => cb(filename)) },
    )
    t.colorSpace = THREE.SRGBColorSpace
    imageCache.set(filename, t)
  }
  return t
}

// ── Fresnel / gradient shaders (unlit; colorspace-correct output) ────────────
const FRESNEL_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`
const FRESNEL_FRAG = /* glsl */ `
  uniform vec3 uColor; uniform vec3 uRim; uniform float uPower;
  varying vec3 vNormal; varying vec3 vViewDir;
  void main() {
    float rim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0), uPower);
    gl_FragColor = vec4(mix(uColor, uRim, rim), 1.0);
    #include <colorspace_fragment>
  }`

const GRADIENT_VERT = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`
const GRADIENT_FRAG = /* glsl */ `
  uniform vec3 uColorA; uniform vec3 uColorB;
  uniform vec3 uBoxMin; uniform vec3 uBoxMax; uniform int uAxis;
  varying vec3 vPos;
  void main() {
    float p   = uAxis == 0 ? vPos.x    : (uAxis == 1 ? vPos.y    : vPos.z);
    float lo  = uAxis == 0 ? uBoxMin.x : (uAxis == 1 ? uBoxMin.y : uBoxMin.z);
    float hi  = uAxis == 0 ? uBoxMax.x : (uAxis == 1 ? uBoxMax.y : uBoxMax.z);
    float t = clamp((p - lo) / max(hi - lo, 1e-5), 0.0, 1.0);
    gl_FragColor = vec4(mix(uColorA, uColorB, t), 1.0);
    #include <colorspace_fragment>
  }`

const AXIS_INDEX = { x: 0, y: 1, z: 2 } as const

// ── Factory ──────────────────────────────────────────────────────────────────
export function materialFor(mat: SceneMaterial, geometry?: THREE.BufferGeometry): THREE.Material {
  let m: THREE.Material
  switch (mat.type) {
    case 'toon': {
      const t = new THREE.MeshToonMaterial({ color: mat.color })
      t.gradientMap = toonRamp(mat.toonSteps ?? MATERIAL_DEFAULTS.toonSteps)
      m = t
      break
    }
    case 'matcap': {
      const t = new THREE.MeshMatcapMaterial()
      const tex = getMatcap(mat.matcap ?? MATERIAL_DEFAULTS.matcap)
      if (tex) t.matcap = tex
      m = t
      break
    }
    case 'glass': {
      m = new THREE.MeshPhysicalMaterial({
        color: mat.color,
        roughness: mat.roughness,
        metalness: 0,
        transmission: mat.transmission ?? MATERIAL_DEFAULTS.transmission,
        ior: mat.ior ?? MATERIAL_DEFAULTS.ior,
        thickness: mat.thickness ?? MATERIAL_DEFAULTS.thickness,
      })
      break
    }
    case 'fresnel': {
      m = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(mat.color) },
          uRim: { value: new THREE.Color(mat.fresnelColor ?? MATERIAL_DEFAULTS.fresnelColor) },
          uPower: { value: mat.fresnelPower ?? MATERIAL_DEFAULTS.fresnelPower },
        },
        vertexShader: FRESNEL_VERT,
        fragmentShader: FRESNEL_FRAG,
      })
      break
    }
    case 'gradient': {
      // Bounding range comes from the geometry so the ramp always spans the
      // shape exactly; falls back to the unit-ish primitive envelope.
      let boxMin = new THREE.Vector3(-0.55, -0.55, -0.55)
      let boxMax = new THREE.Vector3(0.55, 0.55, 0.55)
      if (geometry) {
        if (!geometry.boundingBox) geometry.computeBoundingBox()
        if (geometry.boundingBox) { boxMin = geometry.boundingBox.min.clone(); boxMax = geometry.boundingBox.max.clone() }
      }
      m = new THREE.ShaderMaterial({
        uniforms: {
          uColorA: { value: new THREE.Color(mat.color) },
          uColorB: { value: new THREE.Color(mat.gradientB ?? MATERIAL_DEFAULTS.gradientB) },
          uBoxMin: { value: boxMin },
          uBoxMax: { value: boxMax },
          uAxis: { value: AXIS_INDEX[mat.gradientAxis ?? MATERIAL_DEFAULTS.gradientAxis] },
        },
        vertexShader: GRADIENT_VERT,
        fragmentShader: GRADIENT_FRAG,
      })
      break
    }
    case 'image': {
      const t = new THREE.MeshStandardMaterial({
        // White base so the texture shows untinted (the doc's colour is ignored
        // for image materials — there is no colour control in the image UI).
        color: '#ffffff',
        roughness: mat.roughness,
        metalness: mat.metalness,
      })
      const tex = getImageTexture(mat.image ?? '')
      if (tex) t.map = tex
      m = t
      break
    }
    case 'standard':
    default:
      m = new THREE.MeshStandardMaterial({ color: mat.color, roughness: mat.roughness, metalness: mat.metalness })
  }
  m.userData.matType = mat.type
  m.userData.identity = identityKey(mat)
  return m
}

/** Params that require a rebuild when they change (texture/ramp identity). */
function identityKey(mat: SceneMaterial): string {
  switch (mat.type) {
    case 'toon': return `toon:${mat.toonSteps ?? MATERIAL_DEFAULTS.toonSteps}`
    case 'matcap': return `matcap:${mat.matcap ?? MATERIAL_DEFAULTS.matcap}`
    case 'image': return `image:${mat.image ?? ''}`
    default: return mat.type
  }
}

export function updateMaterial(m: THREE.Material, mat: SceneMaterial): boolean {
  if (m.userData.matType !== mat.type || m.userData.identity !== identityKey(mat)) return false
  switch (mat.type) {
    case 'standard': {
      const s = m as THREE.MeshStandardMaterial
      s.color.set(mat.color); s.roughness = mat.roughness; s.metalness = mat.metalness
      return true
    }
    case 'toon': {
      (m as THREE.MeshToonMaterial).color.set(mat.color)
      return true
    }
    case 'matcap':
      return true // nothing tweakable in place; id changes rebuild via identity
    case 'glass': {
      const g = m as THREE.MeshPhysicalMaterial
      g.color.set(mat.color); g.roughness = mat.roughness
      g.ior = mat.ior ?? MATERIAL_DEFAULTS.ior
      g.transmission = mat.transmission ?? MATERIAL_DEFAULTS.transmission
      g.thickness = mat.thickness ?? MATERIAL_DEFAULTS.thickness
      return true
    }
    case 'fresnel': {
      const u = (m as THREE.ShaderMaterial).uniforms
      u.uColor!.value.set(mat.color)
      u.uRim!.value.set(mat.fresnelColor ?? MATERIAL_DEFAULTS.fresnelColor)
      u.uPower!.value = mat.fresnelPower ?? MATERIAL_DEFAULTS.fresnelPower
      return true
    }
    case 'gradient': {
      const u = (m as THREE.ShaderMaterial).uniforms
      u.uColorA!.value.set(mat.color)
      u.uColorB!.value.set(mat.gradientB ?? MATERIAL_DEFAULTS.gradientB)
      u.uAxis!.value = AXIS_INDEX[mat.gradientAxis ?? MATERIAL_DEFAULTS.gradientAxis]
      return true
    }
    case 'image': {
      const s = m as THREE.MeshStandardMaterial
      s.roughness = mat.roughness; s.metalness = mat.metalness
      return true
    }
  }
  return false
}

export function disposeMaterial(m: THREE.Material): void {
  // Dispose textures the material exclusively owns. Matcaps are shared
  // module-lifetime singletons — skip them.
  if ((m as THREE.MeshToonMaterial).isMaterial && (m as any).gradientMap) (m as any).gradientMap.dispose()
  const map = (m as THREE.MeshStandardMaterial).map
  if (map) { map.dispose(); if (m.userData.identity?.startsWith('image:')) imageCache.delete(m.userData.identity.slice(6)) }
  m.dispose()
}
```

Note for the implementer: verify `#include <colorspace_fragment>` compiles in a plain `ShaderMaterial` on three 0.171 (it resolves from `THREE.ShaderChunk` — grep three's examples for prior art). If the chunk name differs at this version, use the version's equivalent (it was `encodings_fragment` before r152) — the requirement is that hex colours in these shaders visually match the same hex on a standard material's albedo.

- [ ] **Step 4: Delegate the engine to the factory**

In `frontend/app/lib/scene3d/engine.ts`:

Add to imports: `import { materialFor, updateMaterial, disposeMaterial } from './materials'`

Replace the primitive-creation material block (~line 155):

```ts
        const mat = materialFor(obj.material)
        // Flat shapes must be visible from both sides (plane was previously
        // invisible from below; ring inherits the fix) — for every material type.
        if (obj.primitive === 'plane' || obj.primitive === 'ring') mat.side = THREE.DoubleSide
        const mesh = new THREE.Mesh(geometryFor(obj.primitive), mat)
```

Replace the sync-update block (~line 180, currently setting color/roughness/metalness):

```ts
    if (obj.kind === 'primitive') {
      const mesh = root as THREE.Mesh
      const current = mesh.material as THREE.Material
      if (!updateMaterial(current, obj.material)) {
        // Type or texture identity changed — rebuild, preserving double-siding.
        disposeMaterial(current)
        const fresh = materialFor(obj.material, mesh.geometry)
        if (obj.primitive === 'plane' || obj.primitive === 'ring') fresh.side = THREE.DoubleSide
        mesh.material = fresh
      }
    }
```

Also pass geometry at creation for gradient correctness: change the creation call to `materialFor(obj.material, geo)` by hoisting `const geo = geometryFor(obj.primitive)` above it and using `new THREE.Mesh(geo, mat)`.

`disposeTree` needs no change (it already disposes materials + textures on removal; matcap singletons live in the module cache, and its texture sweep disposing a shared matcap is acceptable — three re-uploads shared textures transparently on next use).

- [ ] **Step 5: Run tests + typecheck**

Run: `cd frontend && npx vitest run tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts`
Expected: all green. Then `npx vue-tsc --noEmit | grep -i scene3d` → no output.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/scene3d/materials.ts frontend/app/lib/scene3d/engine.ts frontend/tests/unit/scene3d-materials.unit.spec.ts
git commit -m "feat(3d-studio): materials factory (toon/matcap/glass/fresnel/gradient/image) + engine delegation"
```

---

### Task 3: Selection UI + browser verification

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` only
  (material proxies ~lines 110-112; Selection template section ~line 508+).

**Interfaces:**
- Consumes: `MATERIAL_TYPES`, `MATERIAL_DEFAULTS`, `MaterialType` from `~/lib/scene3d/config`; `MATCAP_IDS`, `matcapThumb`, `onTextureError` from `~/lib/scene3d/materials`; existing surface helpers (`enumProxy` at line ~105, `selected`, `selectedIsPrimitive`, `useInpaint().uploadDataUrl`, `StudioSelect` [v-model + `:options`], `StudioSlider`, `StudioColor`, `StudioSegmented`).
- Produces: no new exports — UI only.

- [ ] **Step 1: Script changes**

Next to the existing material proxies (`matColor`/`matRoughness`/`matMetalness`, ~line 110), add:

```ts
// Material type + per-type params. Proxies fall back to MATERIAL_DEFAULTS so
// sliders always have a number; the doc only records what the user touches.
const matType = computed<MaterialType>({
  get: () => selected.value?.material.type ?? 'standard',
  set: (v) => { if (selected.value) selected.value.material.type = v },
})
function matParam<K extends keyof typeof MATERIAL_DEFAULTS>(key: K) {
  return computed<any>({
    get: () => (selected.value?.material as any)?.[key] ?? MATERIAL_DEFAULTS[key],
    set: (v) => { if (selected.value) (selected.value.material as any)[key] = v },
  })
}
const matToonSteps = matParam('toonSteps')
const matMatcap = matParam('matcap')
const matIor = matParam('ior')
const matTransmission = matParam('transmission')
const matThickness = matParam('thickness')
const matFresnelColor = matParam('fresnelColor')
const matFresnelPower = matParam('fresnelPower')
const matGradientB = matParam('gradientB')
const matGradientAxis = matParam('gradientAxis')

// Image-material upload: file → dataURL → ComfyUI input dir → material.image.
const texFileInput = ref<HTMLInputElement | null>(null)
const texUploading = ref(false)
const texError = reactive<Record<string, boolean>>({})
function triggerTexUpload() { texFileInput.value?.click() }
async function onTexFilePicked(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file || !selected.value) return
  texUploading.value = true
  try {
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = () => rej(new Error('read failed'))
      r.readAsDataURL(file)
    })
    const filename = await inpaint.uploadDataUrl(dataUrl, `scene3d_tex_${props.nodeId}`)
    delete texError[filename]
    selected.value.material.image = filename
  } catch {
    if (selected.value?.material.image) texError[selected.value.material.image] = true
    else texError[''] = true
  } finally {
    texUploading.value = false
  }
}
// Engine-side texture load failures (e.g. restored doc referencing a deleted
// file) surface the same inline note.
let offTexError: (() => void) | null = null
onMounted(() => { offTexError = onTextureError((f) => { texError[f] = true }) })
onBeforeUnmount(() => { offTexError?.() })
```

Add the imports (`MATERIAL_TYPES`, `MATERIAL_DEFAULTS`, `type MaterialType` to the config import; new import line for `MATCAP_IDS, matcapThumb, onTextureError` from `~/lib/scene3d/materials`). Note there are already `onMounted`/`onBeforeUnmount` blocks — add the subscribe/unsubscribe lines into those instead of registering new hooks if the linter complains about multiple registrations (multiple registrations are legal Vue; either shape is fine).

- [ ] **Step 2: Template changes — Selection section**

Replace the current material controls inside `<StudioSection v-if="selected" title="Selection">` (the Color/Roughness/Metalness trio, ~lines 509-514) with:

```vue
        <div v-if="selectedIsPrimitive">
          <label class="mb-1 block text-[11px] text-white/55">Material</label>
          <StudioSelect v-model="matType" :options="MATERIAL_TYPES" />
        </div>

        <!-- standard -->
        <template v-if="selectedIsPrimitive && matType === 'standard'">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color</span>
            <StudioColor v-model="matColor" />
          </div>
          <StudioSlider v-model="matRoughness" label="Roughness" :min="0" :max="1" :step="0.01" />
          <StudioSlider v-model="matMetalness" label="Metalness" :min="0" :max="1" :step="0.01" />
        </template>

        <!-- toon -->
        <template v-else-if="selectedIsPrimitive && matType === 'toon'">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color</span>
            <StudioColor v-model="matColor" />
          </div>
          <StudioSlider v-model="matToonSteps" label="Steps" :min="2" :max="5" :step="1" />
        </template>

        <!-- matcap -->
        <template v-else-if="selectedIsPrimitive && matType === 'matcap'">
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Matcap</label>
            <div class="flex items-center gap-1.5">
              <button v-for="id in MATCAP_IDS" :key="id" type="button" :title="id"
                class="size-8 overflow-hidden rounded-full border transition-colors"
                :class="matMatcap === id ? 'border-white/80' : 'border-white/15 hover:border-white/40'"
                @click="matMatcap = id">
                <img :src="matcapThumb(id)" class="size-full" alt="" />
              </button>
            </div>
          </div>
        </template>

        <!-- glass -->
        <template v-else-if="selectedIsPrimitive && matType === 'glass'">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color</span>
            <StudioColor v-model="matColor" />
          </div>
          <StudioSlider v-model="matRoughness" label="Roughness" :min="0" :max="0.5" :step="0.01" />
          <StudioSlider v-model="matIor" label="IOR" :min="1" :max="2.33" :step="0.01" />
          <StudioSlider v-model="matTransmission" label="Transmission" :min="0" :max="1" :step="0.01" />
          <StudioSlider v-model="matThickness" label="Thickness" :min="0" :max="2" :step="0.05" />
        </template>

        <!-- fresnel -->
        <template v-else-if="selectedIsPrimitive && matType === 'fresnel'">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color</span>
            <StudioColor v-model="matColor" />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Rim colour</span>
            <StudioColor v-model="matFresnelColor" />
          </div>
          <StudioSlider v-model="matFresnelPower" label="Power" :min="1" :max="8" :step="0.1" />
        </template>

        <!-- gradient -->
        <template v-else-if="selectedIsPrimitive && matType === 'gradient'">
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color</span>
            <StudioColor v-model="matColor" />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-[11px] text-white/55">Color B</span>
            <StudioColor v-model="matGradientB" />
          </div>
          <div>
            <label class="mb-1 block text-[11px] text-white/55">Axis</label>
            <StudioSegmented v-model="matGradientAxis" :options="['x', 'y', 'z']" />
          </div>
        </template>

        <!-- image -->
        <template v-else-if="selectedIsPrimitive && matType === 'image'">
          <input ref="texFileInput" type="file" accept="image/*" class="hidden" @change="onTexFilePicked" />
          <div class="flex items-center gap-2">
            <img v-if="selected.material.image" class="size-12 rounded object-cover"
              :src="`/view?${new URLSearchParams({ filename: selected.material.image, type: 'input' })}`" alt="" />
            <StudioButton :disabled="texUploading" @click="triggerTexUpload">
              <span class="flex items-center gap-1.5">
                <Loader2 v-if="texUploading" class="h-3.5 w-3.5 animate-spin" />
                <Upload v-else class="h-3.5 w-3.5" />
                {{ texUploading ? 'Uploading…' : selected.material.image ? 'Replace image' : 'Upload image' }}
              </span>
            </StudioButton>
          </div>
          <p v-if="texError[selected.material.image ?? '']" class="text-[11px] text-red-400/90">texture failed</p>
          <StudioSlider v-model="matRoughness" label="Roughness" :min="0" :max="1" :step="0.01" />
          <StudioSlider v-model="matMetalness" label="Metalness" :min="0" :max="1" :step="0.01" />
        </template>
```

Keep the Position/Rotation/Scale blocks below unchanged. (`StudioSegmented` — verify its options prop shape against its own file before use; it's already used with a string array for lighting presets at line ~573, so `:options="['x','y','z']"` matches the existing call convention.)

- [ ] **Step 3: Gates**

Run: `cd frontend && npx vue-tsc --noEmit | grep -i scene3d` → no output; `npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts` → all green.

- [ ] **Step 4: Browser verification (REAL clicks only)**

At `http://127.0.0.1:3000/dev/scene3d-lab` (reuse running servers; `./dev.sh` from the repo root only if both ports are dead):
- Add a sphere; in Selection pick each material type from the dropdown in turn and confirm the viewport changes accordingly: toon (banded shading, steps slider changes band count), matcap (each of the 5 swatches visibly different), glass (transmissive; IOR slider distorts), fresnel (rim glow; power tightens it), gradient (two-colour ramp; axis X/Y/Z reorients it; both colour swatches work), image (upload a small PNG → texture appears; roughness still works), back to standard (original behaviour).
- Type-switch rapidly between all 7 on the same object — no console errors, no leak warnings.
- Save, close, reopen → every material restores from scene_state (spot-check matcap id + gradient axis persisted).
- Export to Canvas → beauty shows the styled materials exactly as the viewport (same renderer); open the depth pass URL → unchanged clean ramp (materials must not affect it).
- Screenshots: (a) the six non-standard types on six spheres side by side, (b) the baked beauty of that scene.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(3d-studio): material type picker + per-type controls"
```
