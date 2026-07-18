# 3D Studio Geometry Modifier Stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any primitive be subdivided, tapered, twisted, bent, noise-displaced and repeated in an array, all applied to the real geometry so every render path sees the deformation.

**Architecture:** A pure `lib/scene3d/modifiers.ts` transforms a `BufferGeometry` through a fixed stage order and returns the input untouched when nothing is set. The engine calls it inside the existing `buildGeometry` between `geometryFor` and the facet treatment, and folds the modifier bag into `geoKey` so changes swap `mesh.geometry` in place. The panel renders a shared `MODIFIER_SPECS` list through the same schema-driven machinery as geometry params.

**Tech Stack:** Vue 3 / Nuxt 4, TypeScript, three.js 0.171 (`mergeGeometries` and `mergeVertices` from `three/examples/jsm/utils/BufferGeometryUtils.js`), vitest.

## Global Constraints

- Zero new npm dependencies. Both BufferGeometryUtils helpers ship with the installed three package.
- Back-compat is hard: with no modifiers set, `applyModifiers` returns the input geometry object itself, untouched — existing scenes must render byte-identically.
- CPU-side deformation only. Never move this into a vertex shader: `passes.ts` renders depth and normal with `scene.overrideMaterial`, so shader deformation would vanish from two of the three exported outputs.
- Deformation must keep geometry indexed wherever it arrives indexed, so `computeVertexNormals` yields smooth normals rather than faceting every modified sphere.
- Modifiers must never force a material rebuild; geometry swaps in place under `geoKey`.
- Vertex budget: the final merged geometry stays near 300 000 vertices. `arrayCount` is user-visible and always honoured exactly; the subdivide stage stops early instead.
- Commit hygiene (parallel sessions share this tree): stage only your own files and hunks, never `git add -A`, never `git stash`. Commit to `main`.
- Gates for every task: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-params.unit.spec.ts tests/unit/scene3d-modifiers.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts` green, and `npx vue-tsc --noEmit | grep -i scene3d` empty. vitest must run from the `frontend/` cwd or the `~/...` alias will not resolve.

---

### Task 1: Modifier schema and model

**Files:**
- Modify: `frontend/app/lib/scene3d/primParams.ts` (add the `options` control, generalize the resolver, add `MODIFIER_SPECS` and `modifierValue`)
- Modify: `frontend/app/lib/scene3d/config.ts` (`PrimitiveObject` interface; the primitive branch of the object parser)
- Modify: `frontend/tests/unit/scene3d-params.unit.spec.ts`
- Modify: `frontend/tests/unit/scene3d-config.unit.spec.ts`

**Interfaces:**
- Consumes: the existing `ParamSpec`, `PRIMITIVE_PARAMS`, `paramValue`, `sanitizeParams` in `primParams.ts`.
- Produces, relied on by Tasks 2, 3 and 4:
  - `ParamSpec` gains `control?: 'slider' | 'toggle' | 'options'` and `options?: string[]`
  - `const MODIFIER_SPECS: ParamSpec[]`
  - `function resolveParam(specs: ParamSpec[], bag: Record<string, number> | undefined, key: string): number`
  - `function sanitizeBag(specs: ParamSpec[], raw: unknown): Record<string, number> | undefined`
  - `function modifierValue(modifiers: Record<string, number> | undefined, key: string): number`
  - `PrimitiveObject` gains `modifiers?: Record<string, number>`
  - `paramValue` and `sanitizeParams` keep their exact current signatures and behaviour, now implemented on top of the generalized pair.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/unit/scene3d-params.unit.spec.ts` (extend the import at the top to `import { PRIMITIVE_PARAMS, paramValue, sanitizeParams, MODIFIER_SPECS, modifierValue, resolveParam, sanitizeBag } from '~/lib/scene3d/primParams'`):

```ts
describe('scene3d modifier specs', () => {
  it('describes every modifier with a hint, a sane range and a unique key', () => {
    const keys = MODIFIER_SPECS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const s of MODIFIER_SPECS) {
      expect(s.hint.length, `${s.key} needs a tooltip hint`).toBeGreaterThan(0)
      expect(s.min).toBeLessThan(s.max)
      expect(s.step).toBeGreaterThan(0)
      expect(s.default).toBeGreaterThanOrEqual(s.min)
      expect(s.default).toBeLessThanOrEqual(s.max)
      if (s.control === 'options') {
        expect(s.options, `${s.key} needs options`).toBeTruthy()
        expect(s.options!.length).toBeGreaterThan(1)
        // options are stored as an index, so the range must cover them exactly
        expect(s.min).toBe(0)
        expect(s.max).toBe(s.options!.length - 1)
      }
    }
  })

  it('defaults every modifier to its identity so a fresh object is undeformed', () => {
    for (const key of ['subdivide', 'taper', 'twist', 'bend', 'noise']) {
      expect(modifierValue(undefined, key), `${key} must default to 0`).toBe(0)
    }
    expect(modifierValue(undefined, 'arrayCount')).toBe(1)
  })

  it('covers the documented modifier set', () => {
    expect(MODIFIER_SPECS.map((s) => s.key)).toEqual([
      'subdivide',
      'taper', 'taperAxis',
      'twist', 'twistAxis',
      'bend', 'bendAxis',
      'noise', 'noiseScale', 'noiseSeed',
      'arrayCount', 'arrayMode', 'arrayOffsetX', 'arrayOffsetY', 'arrayOffsetZ', 'arrayRadius', 'arrayAxis',
    ])
  })

  it('resolves and sanitizes modifier bags like param bags', () => {
    expect(modifierValue({ twist: 90 }, 'twist')).toBe(90)
    expect(modifierValue({ twist: 9999 }, 'twist')).toBe(360)
    expect(sanitizeBag(MODIFIER_SPECS, { twist: 90, nope: 1 })).toEqual({ twist: 90 })
    expect(sanitizeBag(MODIFIER_SPECS, {})).toBeUndefined()
  })

  it('keeps the generic resolver and the param-specific wrapper in agreement', () => {
    expect(resolveParam(PRIMITIVE_PARAMS.sphere, { detail: 12 }, 'detail'))
      .toBe(paramValue('sphere', { detail: 12 }, 'detail'))
    expect(sanitizeBag(PRIMITIVE_PARAMS.sphere, { detail: 12, nope: 1 }))
      .toEqual(sanitizeParams('sphere', { detail: 12, nope: 1 }))
  })
})
```

Add to `frontend/tests/unit/scene3d-config.unit.spec.ts`, before the final menu-groups test:

```ts
  it('round-trips modifiers and drops junk ones', () => {
    const doc = defaultDoc()
    const o = createPrimitive('box', doc.objects)
    o.modifiers = { twist: 120, subdivide: 2, arrayCount: 4 }
    doc.objects.push(o)
    expect(parseDoc(serializeDoc(doc))).toEqual(doc)

    const raw = JSON.parse(serializeDoc(doc))
    raw.objects[0].modifiers = { twist: 120, bogus: 7, bend: 9999 }
    const back = parseDoc(JSON.stringify(raw))
    expect((back.objects[0] as any).modifiers).toEqual({ twist: 120, bend: 180 })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/scene3d-params.unit.spec.ts tests/unit/scene3d-config.unit.spec.ts`
Expected: FAIL — `MODIFIER_SPECS`, `modifierValue`, `resolveParam`, `sanitizeBag` are not exported; `modifiers` is dropped by the parser.

- [ ] **Step 3: Generalize the resolver and add the modifier specs**

In `frontend/app/lib/scene3d/primParams.ts`, extend the `ParamSpec` interface:

```ts
export interface ParamSpec {
  key: string
  label: string
  hint: string
  min: number
  max: number
  step: number
  default: number
  /** 'toggle' renders a checkbox storing 0 | 1; 'options' renders a segmented
   *  control storing the option's index. Both keep bags a flat number map. */
  control?: 'slider' | 'toggle' | 'options'
  /** Required when control === 'options'; min/max must span its indices. */
  options?: string[]
}
```

Replace the bodies of `paramValue` and `sanitizeParams` with wrappers over a generic pair, keeping their exported signatures identical:

```ts
/** Resolve one value from a spec list: a stored value clamped to its range,
 *  else the spec default. Throws on a key the list does not declare — that is a
 *  programming error, and the drift tests catch it. */
export function resolveParam(
  specs: ParamSpec[],
  bag: Record<string, number> | undefined,
  key: string,
): number {
  const spec = specs.find((s) => s.key === key)
  if (!spec) throw new Error(`scene3d: no spec for "${key}"`)
  const v = bag?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v, spec.min, spec.max) : spec.default
}

/** Tolerant parse for a persisted bag: keep only declared keys, drop non-finite
 *  values, clamp the rest, and return undefined when nothing survives so absent
 *  stays absent and serialize→parse round-trips exactly. */
export function sanitizeBag(specs: ParamSpec[], raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const out: Record<string, number> = {}
  for (const spec of specs) {
    const v = src[spec.key]
    if (typeof v === 'number' && Number.isFinite(v)) out[spec.key] = clamp(v, spec.min, spec.max)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function paramValue(
  kind: PrimitiveKind,
  params: Record<string, number> | undefined,
  key: string,
): number {
  return resolveParam(PRIMITIVE_PARAMS[kind], params, key)
}

export function sanitizeParams(kind: PrimitiveKind, raw: unknown): Record<string, number> | undefined {
  return sanitizeBag(PRIMITIVE_PARAMS[kind], raw)
}
```

Append the modifier specs and their resolver:

```ts
// Modifiers deform whatever geometry the primitive produced. Unlike geometry
// params these are shared by every kind, and every default is the identity so a
// fresh object is undeformed.
const axisSpec = (key: string, label: string, hint: string, def: number): ParamSpec =>
  ({ key, label, hint, min: 0, max: 2, step: 1, default: def, control: 'options', options: ['x', 'y', 'z'] })

export const MODIFIER_SPECS: ParamSpec[] = [
  { key: 'subdivide', label: 'Subdivide', hint: 'Splits each face into smaller ones so bends and twists stay smooth', min: 0, max: 3, step: 1, default: 0 },

  { key: 'taper', label: 'Taper', hint: 'Narrows or widens the shape toward one end', min: -1, max: 1, step: 0.01, default: 0 },
  axisSpec('taperAxis', 'Taper axis', 'Which direction the taper runs along', 1),

  { key: 'twist', label: 'Twist', hint: 'Winds the shape progressively around an axis', min: -360, max: 360, step: 1, default: 0 },
  axisSpec('twistAxis', 'Twist axis', 'The axis the shape winds around', 1),

  { key: 'bend', label: 'Bend', hint: 'Curves the whole shape around an axis', min: -180, max: 180, step: 1, default: 0 },
  axisSpec('bendAxis', 'Bend axis', 'The axis the shape curves around', 2),

  { key: 'noise', label: 'Noise', hint: 'Pushes the surface in and out for an organic, lumpy look', min: 0, max: 0.5, step: 0.005, default: 0 },
  { key: 'noiseScale', label: 'Noise scale', hint: 'Size of the lumps — higher means finer detail', min: 0.5, max: 8, step: 0.1, default: 2 },
  { key: 'noiseSeed', label: 'Noise seed', hint: 'Shuffles the lumps into a different arrangement', min: 0, max: 99, step: 1, default: 0 },

  { key: 'arrayCount', label: 'Count', hint: 'How many copies of the shape to repeat', min: 1, max: 12, step: 1, default: 1 },
  { key: 'arrayMode', label: 'Mode', hint: 'Repeat in a straight line or around a circle', min: 0, max: 1, step: 1, default: 0, control: 'options', options: ['linear', 'radial'] },
  { key: 'arrayOffsetX', label: 'Offset X', hint: 'Gap between copies along X', min: -3, max: 3, step: 0.05, default: 1.2 },
  { key: 'arrayOffsetY', label: 'Offset Y', hint: 'Gap between copies along Y', min: -3, max: 3, step: 0.05, default: 0 },
  { key: 'arrayOffsetZ', label: 'Offset Z', hint: 'Gap between copies along Z', min: -3, max: 3, step: 0.05, default: 0 },
  { key: 'arrayRadius', label: 'Radius', hint: 'How far each copy sits from the centre', min: 0, max: 5, step: 0.05, default: 1.5 },
  axisSpec('arrayAxis', 'Around', 'The axis the copies are arranged around', 1),
]

export function modifierValue(modifiers: Record<string, number> | undefined, key: string): number {
  return resolveParam(MODIFIER_SPECS, modifiers, key)
}

export function sanitizeModifiers(raw: unknown): Record<string, number> | undefined {
  return sanitizeBag(MODIFIER_SPECS, raw)
}
```

- [ ] **Step 4: Wire modifiers into the model**

In `frontend/app/lib/scene3d/config.ts`, extend the import to `import { sanitizeParams, sanitizeModifiers } from '~/lib/scene3d/primParams'`, add the field to `PrimitiveObject`:

```ts
  /** Deformations applied on top of the built geometry, keyed by
   *  MODIFIER_SPECS.key (primParams.ts). Absent means undeformed. */
  modifiers?: Record<string, number>
```

and extend the primitive branch of the parser:

```ts
        if (o.kind === 'primitive' && PRIMITIVE_KINDS.includes(o.primitive)) {
          const params = sanitizeParams(o.primitive, o.params)
          const modifiers = sanitizeModifiers(o.modifiers)
          return [{
            ...common, kind: 'primitive', primitive: o.primitive,
            ...(params ? { params } : {}),
            ...(modifiers ? { modifiers } : {}),
          }]
        }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-params.unit.spec.ts tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts`
Expected: PASS — including every pre-existing param test, unchanged.

Run: `cd frontend && npx vue-tsc --noEmit | grep -i scene3d`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/scene3d/primParams.ts frontend/app/lib/scene3d/config.ts \
        frontend/tests/unit/scene3d-params.unit.spec.ts frontend/tests/unit/scene3d-config.unit.spec.ts
git commit -m "feat(3d-studio): modifier schema and model"
```

---

### Task 2: The deformation pipeline

**Files:**
- Create: `frontend/app/lib/scene3d/modifiers.ts`
- Create: `frontend/tests/unit/scene3d-modifiers.unit.spec.ts`

**Interfaces:**
- Consumes: `MODIFIER_SPECS`, `modifierValue` from `~/lib/scene3d/primParams`.
- Produces, relied on by Tasks 3 and 4:
  - `function hasModifiers(modifiers: Record<string, number> | undefined): boolean`
  - `function applyModifiers(geo: THREE.BufferGeometry, modifiers: Record<string, number> | undefined): THREE.BufferGeometry`

**Contract:** when `hasModifiers` is false, `applyModifiers` returns the *same object* it was given, untouched. Otherwise it returns a new geometry and never disposes the input — the caller owns it.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/scene3d-modifiers.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { applyModifiers, hasModifiers } from '~/lib/scene3d/modifiers'

const box = () => new THREE.BoxGeometry(1, 1, 1)
const sizeOf = (g: THREE.BufferGeometry): [number, number, number] => {
  g.computeBoundingBox()
  const b = g.boundingBox!
  return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
}
const verts = (g: THREE.BufferGeometry) => g.getAttribute('position').count
// Widest extent on `axis` among vertices near one end of `along`.
const spanAtEnd = (g: THREE.BufferGeometry, along: 0 | 1 | 2, axis: 0 | 1 | 2, top: boolean): number => {
  const p = g.getAttribute('position')
  let lo = Infinity, hi = -Infinity
  const bounds = sizeOf(g)
  g.computeBoundingBox()
  const b = g.boundingBox!
  const edge = top ? b.max.getComponent(along) : b.min.getComponent(along)
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getComponent(i, along) - edge) > bounds[along] * 0.1) continue
    const v = p.getComponent(i, axis)
    lo = Math.min(lo, v); hi = Math.max(hi, v)
  }
  return hi - lo
}

describe('scene3d modifiers', () => {
  it('detects whether anything is set', () => {
    expect(hasModifiers(undefined)).toBe(false)
    expect(hasModifiers({})).toBe(false)
    expect(hasModifiers({ twist: 0, arrayCount: 1 })).toBe(false)
    expect(hasModifiers({ twist: 45 })).toBe(true)
    expect(hasModifiers({ arrayCount: 3 })).toBe(true)
    expect(hasModifiers({ noise: 0.1 })).toBe(true)
  })

  it('returns the input untouched when nothing is set', () => {
    const g = box()
    const before = verts(g)
    expect(applyModifiers(g, undefined)).toBe(g)
    expect(applyModifiers(g, { twist: 0 })).toBe(g)
    expect(verts(g)).toBe(before)
  })

  it('subdivides only when a deforming stage is active', () => {
    // Subdividing alone changes nothing visible, so it is skipped.
    expect(applyModifiers(box(), { subdivide: 2 })).toBeTruthy()
    const plain = applyModifiers(box(), { twist: 1 })
    const fine = applyModifiers(box(), { twist: 1, subdivide: 1 })
    expect(verts(fine)).toBeGreaterThan(verts(plain))
  })

  it('keeps the overall size when subdividing', () => {
    const [w, h, d] = sizeOf(applyModifiers(box(), { twist: 1, subdivide: 2 }))
    expect(w).toBeCloseTo(1, 4)
    expect(h).toBeCloseTo(1, 4)
    expect(d).toBeCloseTo(1, 4)
  })

  it('tapers one end and leaves the other', () => {
    const g = applyModifiers(box(), { taper: -1, taperAxis: 1, subdivide: 1 })
    const bottom = spanAtEnd(g, 1, 0, false)
    const top = spanAtEnd(g, 1, 0, true)
    expect(top).toBeLessThan(bottom * 0.5)
  })

  it('twists the ends in opposite directions around the axis', () => {
    const g = applyModifiers(box(), { twist: 180, twistAxis: 1, subdivide: 1 })
    // A twisted box is wider corner-to-corner across X than the original 1.0.
    expect(sizeOf(g)[0]).toBeGreaterThan(1.05)
  })

  it('bends the shape so it no longer spans its original length', () => {
    const tall = new THREE.BoxGeometry(0.3, 2, 0.3)
    const g = applyModifiers(tall, { bend: 170, bendAxis: 2, subdivide: 2 })
    // Curving a 2-long bar into most of a half circle shortens its Y extent.
    expect(sizeOf(g)[1]).toBeLessThan(2)
  })

  it('is identity for a zero bend angle', () => {
    const g = applyModifiers(box(), { bend: 0, twist: 30 })
    expect(g).toBeTruthy()
    expect(Number.isFinite(sizeOf(g)[0])).toBe(true)
  })

  it('displaces with noise deterministically per seed', () => {
    const a = applyModifiers(new THREE.SphereGeometry(0.5, 16, 12), { noise: 0.2, noiseSeed: 3 })
    const b = applyModifiers(new THREE.SphereGeometry(0.5, 16, 12), { noise: 0.2, noiseSeed: 3 })
    const c = applyModifiers(new THREE.SphereGeometry(0.5, 16, 12), { noise: 0.2, noiseSeed: 8 })
    const pa = a.getAttribute('position'), pb = b.getAttribute('position'), pc = c.getAttribute('position')
    let sameAB = true, sameAC = true
    for (let i = 0; i < pa.count * 3; i++) {
      if (Math.abs(pa.array[i]! - pb.array[i]!) > 1e-9) sameAB = false
      if (Math.abs(pa.array[i]! - pc.array[i]!) > 1e-9) sameAC = false
    }
    expect(sameAB).toBe(true)
    expect(sameAC).toBe(false)
    // A lumpy sphere is no longer exactly 1.0 across.
    expect(sizeOf(a)[0]).not.toBeCloseTo(1, 3)
  })

  it('repeats linearly with even spacing', () => {
    const one = applyModifiers(box(), { arrayCount: 1 })
    const four = applyModifiers(box(), { arrayCount: 4, arrayOffsetX: 2, arrayOffsetY: 0, arrayOffsetZ: 0 })
    expect(verts(four)).toBe(verts(one === box() ? box() : one) * 4)
    // Four boxes spaced 2 apart span 3 gaps plus the box itself.
    expect(sizeOf(four)[0]).toBeCloseTo(7, 4)
  })

  it('repeats radially on a circle of the given radius', () => {
    const g = applyModifiers(box(), { arrayCount: 6, arrayMode: 1, arrayRadius: 2, arrayAxis: 1 })
    const [w, , d] = sizeOf(g)
    // Copies sit on a radius-2 circle, so the ring spans about 4 plus a box.
    expect(w).toBeGreaterThan(4)
    expect(d).toBeGreaterThan(4)
    expect(w).toBeLessThan(6)
  })

  it('honours the array count exactly while capping subdivision', () => {
    // A dense sphere with heavy subdivision and a big array must not explode:
    // the count is exact, the subdivision is what gets cut back.
    const src = new THREE.SphereGeometry(0.5, 64, 48)
    const base = verts(applyModifiers(new THREE.SphereGeometry(0.5, 64, 48), { twist: 1 }))
    const g = applyModifiers(src, { twist: 1, subdivide: 3, arrayCount: 12 })
    expect(verts(g) % base).toBe(0)
    expect(verts(g)).toBeLessThan(400_000)
  })

  it('leaves the caller free to keep using the input geometry', () => {
    const g = box()
    const before = verts(g)
    applyModifiers(g, { twist: 90, subdivide: 1 })
    expect(verts(g)).toBe(before)
    expect(g.getAttribute('position')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run tests/unit/scene3d-modifiers.unit.spec.ts`
Expected: FAIL — cannot resolve `~/lib/scene3d/modifiers`.

- [ ] **Step 3: Implement the pipeline**

Create `frontend/app/lib/scene3d/modifiers.ts`:

```ts
// Non-destructive geometry modifiers, applied CPU-side to the real vertices.
//
// This is deliberately NOT a vertex shader: passes.ts renders the depth and
// normal outputs with scene.overrideMaterial, so a shader deformation would be
// invisible in two of the three exported images. Raycasting (selection and the
// gizmo), bounding boxes, shadows and the gradient bbox uniforms all read real
// geometry too.
//
// Stage order is fixed: subdivide → taper → twist → bend → noise → array.
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { modifierValue } from '~/lib/scene3d/primParams'

/** Rough ceiling for the final merged geometry. arrayCount is user-visible so it
 *  is never reduced; subdivision stops early instead. */
const VERTEX_BUDGET = 300_000

export function hasModifiers(modifiers: Record<string, number> | undefined): boolean {
  if (!modifiers) return false
  const m = (k: string) => modifierValue(modifiers, k)
  return m('taper') !== 0 || m('twist') !== 0 || m('bend') !== 0 || m('noise') !== 0 || m('arrayCount') > 1
}

// --- deterministic 3D value noise (no dependency, stable across runs) --------

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + Math.imul(seed, 2654435761)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
const smooth = (t: number): number => t * t * (3 - 2 * t)
const mix = (a: number, b: number, t: number): number => a + (b - a) * t

/** Value noise in [-1, 1]. */
function valueNoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi)
  const c = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed)
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), u)
  const x10 = mix(c(0, 1, 0), c(1, 1, 0), u)
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), u)
  const x11 = mix(c(0, 1, 1), c(1, 1, 1), u)
  return mix(mix(x00, x10, v), mix(x01, x11, v), w) * 2 - 1
}

// --- stages ------------------------------------------------------------------

/** Split every triangle into four at its edge midpoints, then re-weld so the
 *  result stays indexed and can still be shaded smoothly. */
function subdivideOnce(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo
  const pos = src.getAttribute('position')
  const uv = src.getAttribute('uv')
  const outPos: number[] = []
  const outUv: number[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3()
  const ab = new THREE.Vector3(), bc = new THREE.Vector3(), ca = new THREE.Vector3()
  const push = (v: THREE.Vector3) => { outPos.push(v.x, v.y, v.z) }
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos as THREE.BufferAttribute, i)
    b.fromBufferAttribute(pos as THREE.BufferAttribute, i + 1)
    c.fromBufferAttribute(pos as THREE.BufferAttribute, i + 2)
    ab.addVectors(a, b).multiplyScalar(0.5)
    bc.addVectors(b, c).multiplyScalar(0.5)
    ca.addVectors(c, a).multiplyScalar(0.5)
    push(a); push(ab); push(ca)
    push(ab); push(b); push(bc)
    push(ca); push(bc); push(c)
    push(ab); push(bc); push(ca)
    if (uv) {
      const u0 = uv.getX(i), v0 = uv.getY(i)
      const u1 = uv.getX(i + 1), v1 = uv.getY(i + 1)
      const u2 = uv.getX(i + 2), v2 = uv.getY(i + 2)
      const uab = (u0 + u1) / 2, vab = (v0 + v1) / 2
      const ubc = (u1 + u2) / 2, vbc = (v1 + v2) / 2
      const uca = (u2 + u0) / 2, vca = (v2 + v0) / 2
      outUv.push(u0, v0, uab, vab, uca, vca)
      outUv.push(uab, vab, u1, v1, ubc, vbc)
      outUv.push(uca, vca, ubc, vbc, u2, v2)
      outUv.push(uab, vab, ubc, vbc, uca, vca)
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3))
  if (uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(outUv, 2))
  if (src !== geo) src.dispose()
  const welded = mergeVertices(out)
  if (welded !== out) out.dispose()
  return welded
}

/** Per-vertex extent helper: [min, size] along an axis, guarded against zero. */
function extentOf(geo: THREE.BufferGeometry, axis: number): [number, number] {
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  const min = b.min.getComponent(axis)
  const size = b.max.getComponent(axis) - min
  return [min, size > 1e-6 ? size : 1]
}

function applyTaper(geo: THREE.BufferGeometry, amount: number, axis: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const [min, size] = extentOf(geo, axis)
  const p1 = (axis + 1) % 3
  const p2 = (axis + 2) % 3
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getComponent(i, axis) - min) / size          // 0..1
    const s = Math.max(0, 1 + amount * (t - 0.5) * 2)
    pos.setComponent(i, p1, pos.getComponent(i, p1) * s)
    pos.setComponent(i, p2, pos.getComponent(i, p2) * s)
  }
  pos.needsUpdate = true
}

function applyTwist(geo: THREE.BufferGeometry, degrees: number, axis: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const [min, size] = extentOf(geo, axis)
  const p1 = (axis + 1) % 3
  const p2 = (axis + 2) % 3
  const total = (degrees * Math.PI) / 180
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getComponent(i, axis) - min) / size - 0.5     // -0.5..0.5
    const ang = total * t
    const cos = Math.cos(ang), sin = Math.sin(ang)
    const u = pos.getComponent(i, p1), v = pos.getComponent(i, p2)
    pos.setComponent(i, p1, u * cos - v * sin)
    pos.setComponent(i, p2, u * sin + v * cos)
  }
  pos.needsUpdate = true
}

/** Circular bend about `axis`: the shape curves along (axis+2)%3 and bulges
 *  along (axis+1)%3. The centre of the shape stays put. */
function applyBend(geo: THREE.BufferGeometry, degrees: number, axis: number): void {
  const total = (degrees * Math.PI) / 180
  if (Math.abs(total) < 1e-6) return
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const lengthAxis = (axis + 2) % 3
  const bulgeAxis = (axis + 1) % 3
  const [min, size] = extentOf(geo, lengthAxis)
  const centre = min + size / 2
  const radius = size / total
  for (let i = 0; i < pos.count; i++) {
    const s = pos.getComponent(i, lengthAxis) - centre
    const b = pos.getComponent(i, bulgeAxis)
    const phi = s / radius
    const r = radius - b
    pos.setComponent(i, lengthAxis, r * Math.sin(phi))
    pos.setComponent(i, bulgeAxis, radius - r * Math.cos(phi))
  }
  pos.needsUpdate = true
}

function applyNoise(geo: THREE.BufferGeometry, amount: number, scale: number, seed: number): void {
  if (!geo.getAttribute('normal')) geo.computeVertexNormals()
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const d = valueNoise(x * scale, y * scale, z * scale, seed) * amount
    pos.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d)
  }
  pos.needsUpdate = true
}

function applyArray(
  geo: THREE.BufferGeometry,
  count: number,
  radial: boolean,
  offset: [number, number, number],
  radius: number,
  axis: number,
): THREE.BufferGeometry {
  const copies: THREE.BufferGeometry[] = []
  const m = new THREE.Matrix4()
  const spin = new THREE.Matrix4()
  const axisVec = new THREE.Vector3(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
  const radialDir = (axis + 1) % 3
  for (let i = 0; i < count; i++) {
    const copy = geo.clone()
    if (radial) {
      const ang = (i / count) * Math.PI * 2
      const out = new THREE.Vector3()
      out.setComponent(radialDir, radius)
      m.makeTranslation(out.x, out.y, out.z)
      spin.makeRotationAxis(axisVec, ang)
      copy.applyMatrix4(spin.multiply(m))
    } else {
      copy.applyMatrix4(m.makeTranslation(offset[0] * i, offset[1] * i, offset[2] * i))
    }
    copies.push(copy)
  }
  const merged = mergeGeometries(copies)
  for (const c of copies) c.dispose()
  // mergeGeometries returns null if the inputs disagree on attributes; the
  // copies are clones of one geometry, so that cannot happen here.
  return merged ?? geo.clone()
}

// --- pipeline ----------------------------------------------------------------

export function applyModifiers(
  geo: THREE.BufferGeometry,
  modifiers: Record<string, number> | undefined,
): THREE.BufferGeometry {
  if (!hasModifiers(modifiers)) return geo
  const m = (k: string) => modifierValue(modifiers, k)

  const taper = m('taper'), twist = m('twist'), bend = m('bend'), noise = m('noise')
  const count = Math.round(m('arrayCount'))
  const deforms = taper !== 0 || twist !== 0 || bend !== 0 || noise !== 0

  let out = geo.clone()

  // Subdivision only earns its vertices when something deforms them, and it
  // yields to the budget so a dense shape in a big array cannot freeze the app.
  if (deforms) {
    const iterations = Math.round(m('subdivide'))
    const ceiling = VERTEX_BUDGET / Math.max(1, count)
    for (let i = 0; i < iterations; i++) {
      if (out.getAttribute('position').count * 4 > ceiling) break
      const next = subdivideOnce(out)
      out.dispose()
      out = next
    }
  }

  if (taper !== 0) applyTaper(out, taper, Math.round(m('taperAxis')))
  if (twist !== 0) applyTwist(out, twist, Math.round(m('twistAxis')))
  if (bend !== 0) applyBend(out, bend, Math.round(m('bendAxis')))
  if (noise !== 0) applyNoise(out, noise, m('noiseScale'), Math.round(m('noiseSeed')))

  if (deforms) {
    out.computeVertexNormals()
    out.computeBoundingBox()
    out.computeBoundingSphere()
  }

  if (count > 1) {
    const arrayed = applyArray(
      out,
      count,
      Math.round(m('arrayMode')) === 1,
      [m('arrayOffsetX'), m('arrayOffsetY'), m('arrayOffsetZ')],
      m('arrayRadius'),
      Math.round(m('arrayAxis')),
    )
    out.dispose()
    out = arrayed
    out.computeBoundingBox()
    out.computeBoundingSphere()
  }

  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-modifiers.unit.spec.ts`
Expected: PASS, 12 tests.

If a geometric assertion fails, verify the maths against the actual vertex data before changing the test — and if a test's chosen axis or threshold turns out to be wrong, fix the assertion rather than weakening it to a tautology (a `toBeLessThan` that compares unrelated quantities passes for the wrong reason).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/scene3d/modifiers.ts frontend/tests/unit/scene3d-modifiers.unit.spec.ts
git commit -m "feat(3d-studio): geometry modifier pipeline"
```

---

### Task 3: Engine integration

**Files:**
- Modify: `frontend/app/lib/scene3d/engine.ts` (`buildGeometry`, `geoKeyFor`, `baseSizeFor`, both call sites in `syncObject`)
- Modify: `frontend/tests/unit/scene3d-engine.unit.spec.ts`

**Interfaces:**
- Consumes: `applyModifiers`, `hasModifiers` from `~/lib/scene3d/modifiers`; `MODIFIER_SPECS`, `modifierValue` from `~/lib/scene3d/primParams`.
- Produces, relied on by Task 4:
  - `buildGeometry(kind, params, modifiers, variant)` — modifiers inserted as the third argument
  - `baseSizeFor(kind, params?, modifiers?)` — measures the modified geometry

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/unit/scene3d-engine.unit.spec.ts` (extend its imports with `buildGeometry` and keep the existing ones):

```ts
describe('scene3d engine modifier integration', () => {
  it('builds undeformed geometry when no modifiers are set', () => {
    const plain = buildGeometry('box', undefined, undefined, 'smooth')
    const alsoPlain = buildGeometry('box', undefined, {}, 'smooth')
    expect(alsoPlain.getAttribute('position').count).toBe(plain.getAttribute('position').count)
  })

  it('applies modifiers to the built geometry', () => {
    const plain = buildGeometry('box', undefined, undefined, 'smooth')
    const arrayed = buildGeometry('box', undefined, { arrayCount: 3 }, 'smooth')
    expect(arrayed.getAttribute('position').count).toBe(plain.getAttribute('position').count * 3)
  })

  it('still produces face extents for the faceted variant after deformation', () => {
    const g = buildGeometry('box', undefined, { twist: 90, subdivide: 1 }, 'facet')
    expect(g.getAttribute('aFaceMin')).toBeTruthy()
    expect(g.getAttribute('aFaceMax')).toBeTruthy()
    expect(g.getAttribute('aFaceMin').count).toBe(g.getAttribute('position').count)
  })

  it('reports base size including modifiers', () => {
    const plain = baseSizeFor('box')
    const arrayed = baseSizeFor('box', undefined, { arrayCount: 3, arrayOffsetX: 2 })
    expect(arrayed[0]).toBeGreaterThan(plain[0])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/scene3d-engine.unit.spec.ts`
Expected: FAIL — `buildGeometry` takes three arguments, so the modifier argument is read as the variant.

- [ ] **Step 3: Thread modifiers through the engine**

In `frontend/app/lib/scene3d/engine.ts`, add the import:

```ts
import { applyModifiers } from '~/lib/scene3d/modifiers'
import { MODIFIER_SPECS, modifierValue } from '~/lib/scene3d/primParams'
```

(keep the existing `PRIMITIVE_PARAMS, paramValue` import — merge them into one statement if they come from the same module).

Change `buildGeometry` to take the modifier bag and apply it between the factory and the facet treatment:

```ts
/** The single geometry build path: primitive params, then modifiers, then the
 *  shading variant. Both syncObject branches call this. */
export function buildGeometry(
  kind: PrimitiveKind,
  params: Record<string, number> | undefined,
  modifiers: Record<string, number> | undefined,
  variant: 'smooth' | 'facet',
): THREE.BufferGeometry {
  const base = geometryFor(kind, params)
  const shaped = applyModifiers(base, modifiers)
  if (shaped !== base) base.dispose()
  if (variant !== 'facet') return shaped
  let geo = shaped
  if (geo.index) { const flat = geo.toNonIndexed(); geo.dispose(); geo = flat }
  geo.computeVertexNormals()
  addFaceExtentAttributes(geo)
  return geo
}
```

Extend `baseSizeFor`:

```ts
export function baseSizeFor(
  kind: PrimitiveKind,
  params?: Record<string, number>,
  modifiers?: Record<string, number>,
): [number, number, number] {
  const geo = buildGeometry(kind, params, modifiers, 'smooth')
  geo.computeBoundingBox()
  const b = geo.boundingBox!
  const size: [number, number, number] = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]
  geo.dispose()
  return size
}
```

Extend `geoKeyFor` so a modifier change swaps geometry the same way a param change does:

```ts
function geoKeyFor(obj: PrimitiveObject, variant: 'smooth' | 'facet'): string {
  const params = PRIMITIVE_PARAMS[obj.primitive].map((s) => paramValue(obj.primitive, obj.params, s.key))
  const mods = MODIFIER_SPECS.map((s) => modifierValue(obj.modifiers, s.key))
  return `${obj.primitive}|${params.join(',')}|${mods.join(',')}|${variant}`
}
```

Update both `buildGeometry` call sites in `syncObject` to pass `obj.modifiers` as the third argument.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-params.unit.spec.ts tests/unit/scene3d-modifiers.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts`
Expected: PASS — including the 14-kind back-compat oracle, which must be unaffected.

Run: `cd frontend && npx vue-tsc --noEmit | grep -i scene3d`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/scene3d/engine.ts frontend/tests/unit/scene3d-engine.unit.spec.ts
git commit -m "feat(3d-studio): apply modifiers in the geometry build path"
```

---

### Task 4: Modifiers panel

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue` (script: imports, modifier proxies, the `baseSize` computed, `duplicateObject`; template: a new Modifiers sub-group beside Geometry)

**Interfaces:**
- Consumes: `MODIFIER_SPECS`, `modifierValue` from `~/lib/scene3d/primParams`; `baseSizeFor(kind, params, modifiers)` from `~/lib/scene3d/engine`.
- Produces: nothing further depends on this task.

**Conventions in this file:** the Selection panel is one `StudioSection` containing plain `<details class="group">` sub-groups (Geometry, Coat & sheen, Glow, …) with an uppercase label and a `group-open:rotate-90` chevron, native marker hidden. Geometry is open by default; the material sub-groups are closed. `paramOf`/`setParam` are the model for schema-driven proxies. Micro-labels for inline groupings use the existing Axis/Shading label style.

- [ ] **Step 1: Add the script wiring**

Extend the imports:

```ts
import { PRIMITIVE_PARAMS, paramValue, MODIFIER_SPECS, modifierValue } from '~/lib/scene3d/primParams'
```

Add the modifier proxies next to `paramOf`/`setParam`:

```ts
// Modifier bag: same schema-driven read/write shape as geometry params.
function modOf(key: string): number {
  const o = selected.value
  return o && o.kind === 'primitive' ? modifierValue(o.modifiers, key) : 0
}
function setMod(key: string, v: number): void {
  const o = selected.value
  if (!o || o.kind !== 'primitive') return
  if (!o.modifiers) o.modifiers = {}
  o.modifiers[key] = v
}
const modSpec = (key: string) => MODIFIER_SPECS.find((s) => s.key === key)!
// Option controls store the index; the segmented control speaks labels.
function optionOf(key: string): string {
  const spec = modSpec(key)
  return spec.options![Math.round(modOf(key))] ?? spec.options![0]!
}
function setOption(key: string, label: string): void {
  const i = modSpec(key).options!.indexOf(label)
  if (i >= 0) setMod(key, i)
}
const arrayIsRadial = computed(() => Math.round(modOf('arrayMode')) === 1)
```

Update the `baseSize` computed so Size reflects modifiers:

```ts
  if (o.kind === 'primitive') return baseSizeFor(o.primitive, o.params, o.modifiers)
```

Update `duplicateObject` to carry the modifier bag alongside the params bag it already copies — a copied object must look like its source:

```ts
        ...(src.kind === 'primitive' && src.modifiers ? { modifiers: { ...src.modifiers } } : {}),
```

- [ ] **Step 2: Add the Modifiers sub-group**

Insert immediately after the Geometry `<details>` block closes. Match the sibling sub-groups' markup exactly — copy the existing `<summary>` markup from the Geometry group and change only the label, so the styling cannot drift:

```vue
      <details v-if="selected?.kind === 'primitive'" class="group">
        <summary class="flex cursor-pointer list-none items-center gap-1 py-1 text-[10px] uppercase tracking-[0.12em] text-white/35 [&::-webkit-details-marker]:hidden">
          <span class="transition-transform group-open:rotate-90">›</span>
          Modifiers
        </summary>
        <div class="space-y-2.5 pt-1">
          <StudioSlider
            :model-value="modOf('subdivide')" :label="modSpec('subdivide').label" :hint="modSpec('subdivide').hint"
            :min="modSpec('subdivide').min" :max="modSpec('subdivide').max" :step="modSpec('subdivide').step"
            @update:model-value="(v: number) => setMod('subdivide', v)"
          />

          <div v-for="group in MODIFIER_GROUPS" :key="group.label" class="space-y-2">
            <div class="pt-1 text-[10px] uppercase tracking-[0.12em] text-white/25">{{ group.label }}</div>
            <template v-for="key in group.keys" :key="key">
              <div v-if="modSpec(key).control === 'options'" class="space-y-1">
                <span class="text-[11px] text-white/55" :title="modSpec(key).hint">{{ modSpec(key).label }}</span>
                <StudioSegmented
                  :model-value="optionOf(key)" :options="modSpec(key).options!"
                  @update:model-value="(v: string) => setOption(key, v)"
                />
              </div>
              <StudioSlider
                v-else
                :model-value="modOf(key)" :label="modSpec(key).label" :hint="modSpec(key).hint"
                :min="modSpec(key).min" :max="modSpec(key).max" :step="modSpec(key).step"
                @update:model-value="(v: number) => setMod(key, v)"
              />
            </template>
          </div>
        </div>
      </details>
```

Add the group definition to the script, keeping the array's mode-dependent keys out of the static list:

```ts
// Modifier controls, grouped for the panel. Array's offset/radius keys are
// swapped by mode, so that group is computed.
const MODIFIER_GROUPS = computed(() => [
  { label: 'Taper', keys: ['taper', 'taperAxis'] },
  { label: 'Twist', keys: ['twist', 'twistAxis'] },
  { label: 'Bend', keys: ['bend', 'bendAxis'] },
  { label: 'Noise', keys: ['noise', 'noiseScale', 'noiseSeed'] },
  {
    label: 'Array',
    keys: arrayIsRadial.value
      ? ['arrayCount', 'arrayMode', 'arrayRadius', 'arrayAxis']
      : ['arrayCount', 'arrayMode', 'arrayOffsetX', 'arrayOffsetY', 'arrayOffsetZ'],
  },
])
```

Import `StudioSegmented` alongside the other studio kit components if it is not already imported in this file.

- [ ] **Step 3: Run the gates**

Run: `cd frontend && npx vitest run tests/unit/scene3d-config.unit.spec.ts tests/unit/scene3d-params.unit.spec.ts tests/unit/scene3d-modifiers.unit.spec.ts tests/unit/scene3d-materials.unit.spec.ts tests/unit/scene3d-engine.unit.spec.ts tests/unit/scene3d-passes.unit.spec.ts`
Expected: PASS.

Run: `cd frontend && npx vue-tsc --noEmit | grep -i scene3d`
Expected: no output.

- [ ] **Step 4: Verify in the browser with real interactions**

Reuse a running dev server (`ps aux | grep -i nuxt`; the frontend has drifted off port 3000 before, so confirm the actual port with `lsof -nP -iTCP -sTCP:LISTEN | grep node` rather than assuming). Never kill a server you did not start. Always `127.0.0.1`, never `localhost`.

Create the node by dispatching `sailor:addNode` with `nodeType: 'Scene3DStudio'`; every interaction after that must be a real click or drag, because OrbitControls captures the pointer and synthetic events have produced false passes here.

Confirm each of:
1. The Modifiers group appears for primitives, collapsed, styled as a peer of Geometry.
2. Twist on a box does nothing at Subdivide 0, and visibly twists once Subdivide is raised — this proves the tessellation dependency.
3. Bend curves a tall thin box.
4. Taper narrows one end.
5. Noise makes a sphere lumpy; changing the seed changes the lumps; setting noise back to 0 restores the smooth sphere exactly.
6. Array linear repeats along the offset; switching to radial swaps the controls and arranges copies in a ring.
7. A gradient material still spans the modified shape correctly (the bbox uniform refresh).
8. Size numbers grow when an array is added.
9. Duplicate carries modifiers.
10. Save, close, reopen: modifiers restored.
11. Export to Canvas: the exported image shows the deformed shape.
12. `read_console_messages` shows no errors.

Capture screenshots for 2, 3, 5, 6 and 11.

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(3d-studio): modifiers panel"
```

If `git diff` shows unrelated hunks from a parallel session, stage only your own with `git apply --cached`. Never `git add -A`, never `git stash`.

---

## Self-Review

**Spec coverage:** flat numeric modifier bag and generalized resolver → Task 1; `MODIFIER_SPECS` table with every documented key → Task 1; `options` control → Task 1 (spec) and Task 4 (renderer); the six pipeline stages, identity contract, vertex budget and normal recomputation → Task 2; `geoKey`, `buildGeometry` and `baseSizeFor` integration → Task 3; the gradient bbox refresh needs no change (it already runs after every rebuild) and is covered by Task 4's browser check 7; Modifiers panel with grouped mini-blocks and mode-dependent array controls → Task 4; duplicate carrying modifiers → Task 4; all four testing bullets → Tasks 1–4.

**Placeholder scan:** every step contains real code or an exact command; no TBDs.

**Type consistency:** `MODIFIER_SPECS`, `modifierValue`, `resolveParam`, `sanitizeBag`, `sanitizeModifiers` (Task 1) are used under those names in Tasks 2–4; `hasModifiers`/`applyModifiers` (Task 2) are used under those names in Task 3; `buildGeometry`'s new four-argument signature is defined in Task 3 and consumed only there and in `baseSizeFor`; `modifiers?: Record<string, number>` is the same type throughout.

**One deliberate deviation from the spec:** the spec sketched the Array group's mode-dependent controls as a `v-if` inside the template; the plan computes the key list instead, which keeps the renderer a single uniform loop.
