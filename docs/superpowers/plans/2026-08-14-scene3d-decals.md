# Scene3D Decals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stamp an image or a text label onto the surface of a Scene3D solid (decal), placed by clicking the surface, following the solid through moves, surviving save/reload and headless bakes.

**Architecture:** New `'decal'` SceneObject kind. Geometry is a THREE `DecalGeometry` built in **target-local space** (project against a proxy mesh whose matrixWorld is identity) and parented under the target's root, so the decal follows the target with zero reprojection. Doc stores the projector pose (local point + normal-derived euler) plus flat `size/depth/spin/opacity` fields. Text content renders to a `CanvasTexture` after a css2 Google-font load — same pipeline as image content from there on.

**Tech Stack:** Vue 3 + TypeScript, three@0.171.0 (`three/examples/jsm/geometries/DecalGeometry.js` — import WITH the `.js` extension, matching `engine.ts:10`), vitest unit tests, Browser-pane E2E.

**Spec:** `docs/superpowers/specs/2026-08-14-scene3d-decals-design.md`

## Global Constraints

- Typecheck baseline is ~328 pre-existing errors; any error naming a decal type is OURS (typecheck-baseline-anchoring rule).
- `stripAlpha()` before every `new THREE.Color(...)` — 8-digit hex renders WHITE silently.
- Action-blue only for buttons; use `StudioButton`/existing Studio controls, never hand-rolled buttons.
- Decal roots must NOT set `userData.isLight` (passes.ts would exclude them from depth-bounds fitting).
- v1 targets are `kind === 'primitive'` objects only (their root IS a single `THREE.Mesh`). GLB targets are a fast-follow.
- Commit each task separately on `main` directly (repo convention), staging ONLY the task's own files (`git add <paths>`, never `git add -A` — parallel-session hygiene).
- Dev server for E2E: `./dev.sh` from repo root (kills strays, starts 3000 + 8188); browse `127.0.0.1`, never `localhost`.

---

### Task 1: Data model + parse (`config.ts`)

**Files:**
- Modify: `frontend/app/lib/scene3d/config.ts`
- Test: `frontend/tests/unit/scene3d-decals.unit.spec.ts` (create)

**Interfaces:**
- Consumes: existing `SceneObjectBase`, `newId`, `numberedName`, `DEFAULT_MATERIAL`, `parseDoc` internals, `sanitizeHierarchy`.
- Produces (later tasks rely on these exact names):
  - `type DecalContent = { type: 'image'; image: string } | { type: 'text'; text: string; font: string; color: string }`
  - `interface DecalObject extends SceneObjectBase { kind: 'decal'; targetId: string; content: DecalContent; size: number; depth: number; spin: number; opacity: number }`
  - `DECAL_DEFAULTS = { size: 0.6, depth: 0.25, spin: 0, opacity: 1, text: 'LABEL', color: '#1a1a1a', font: 'google:Inter@700' }` (exported const)
  - `createDecal(targetId: string, pose: { position: Vec3; rotation: Vec3 }, content: DecalContent, existing: SceneObject[]): DecalObject`
  - `SceneObject` union includes `DecalObject`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/scene3d-decals.unit.spec.ts`. Look at an existing unit spec in `frontend/tests/unit/` first and copy its import style/config.

```ts
import { describe, it, expect } from 'vitest'
import {
  parseDoc, serializeDoc, defaultDoc, createDecal, createPrimitive,
  DECAL_DEFAULTS, type DecalObject,
} from '~/lib/scene3d/config'   // adapt alias to what sibling specs use

function docWith(objects: any[]) {
  return JSON.stringify({ ...JSON.parse(serializeDoc(defaultDoc())), objects })
}

describe('scene3d decals — doc model', () => {
  it('createDecal parents the decal under its target', () => {
    const box = createPrimitive('box')
    const d = createDecal(box.id, { position: [0, 0.5, 0.5], rotation: [0, 0, 0] },
      { type: 'text', text: 'HI', font: DECAL_DEFAULTS.font, color: DECAL_DEFAULTS.color }, [box])
    expect(d.kind).toBe('decal')
    expect(d.targetId).toBe(box.id)
    expect(d.parentId).toBe(box.id)
    expect(d.size).toBe(DECAL_DEFAULTS.size)
  })

  it('round-trips image and text decals through serialize/parse', () => {
    const box = createPrimitive('box')
    const img = createDecal(box.id, { position: [0, 0, 0.5], rotation: [0.1, 0.2, 0.3] },
      { type: 'image', image: 'sticker.png' }, [box])
    const txt = createDecal(box.id, { position: [0.5, 0, 0], rotation: [0, 1.57, 0] },
      { type: 'text', text: 'ACME', font: 'google:Inter@700', color: '#112233' }, [box, img])
    const doc = defaultDoc(); doc.objects = [box, img, txt]
    const back = parseDoc(serializeDoc(doc))
    const decals = back.objects.filter((o): o is DecalObject => o.kind === 'decal')
    expect(decals).toHaveLength(2)
    expect(decals[0]!.content).toEqual({ type: 'image', image: 'sticker.png' })
    expect(decals[1]!.content).toEqual({ type: 'text', text: 'ACME', font: 'google:Inter@700', color: '#112233' })
    expect(decals[1]!.position).toEqual([0.5, 0, 0])
  })

  it('drops a decal whose target is missing or not a primitive', () => {
    const box = createPrimitive('box')
    const orphan = { ...createDecal('nope', { position: [0,0,0], rotation: [0,0,0] },
      { type: 'text', text: 'X', font: 'f', color: '#000' }, []) }
    const back = parseDoc(docWith([box, orphan]))
    expect(back.objects.some(o => o.kind === 'decal')).toBe(false)
  })

  it('tolerates junk fields and fills defaults', () => {
    const box = createPrimitive('box')
    const raw = { id: 'd1', kind: 'decal', targetId: box.id,
      content: { type: 'text', text: 'Y' }, size: 'huge', opacity: 9 }
    const back = parseDoc(docWith([box, raw]))
    const d = back.objects.find(o => o.kind === 'decal') as DecalObject
    expect(d.size).toBe(DECAL_DEFAULTS.size)
    expect(d.opacity).toBe(1)                       // clamped
    expect(d.content).toEqual({ type: 'text', text: 'Y', font: DECAL_DEFAULTS.font, color: DECAL_DEFAULTS.color })
  })

  it('drops a decal with unusable content', () => {
    const box = createPrimitive('box')
    const back = parseDoc(docWith([box, { id: 'd2', kind: 'decal', targetId: box.id, content: { type: 'image' } }]))
    expect(back.objects.some(o => o.kind === 'decal')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

From `frontend/`: `npx vitest run tests/unit/scene3d-decals.unit.spec.ts` (or the repo's unit-test npm script if sibling specs use one).
Expected: FAIL — `createDecal`/`DECAL_DEFAULTS` not exported.

- [ ] **Step 3: Implement in `config.ts`**

a) Types, next to `LightObject` (~line 253):

```ts
export type DecalContent =
  | { type: 'image'; image: string }   // input-dir filename, same store as material.image
  | { type: 'text'; text: string; font: string; color: string } // font: google:Fam@W | local:id

/** A sticker/label projected onto a primitive's surface. Base fields are
 *  reinterpreted: `position` = projection point and `rotation` = projector
 *  orientation, both in the TARGET'S local space (the engine bakes the decal
 *  geometry target-local and parents it under the target root, so the sticker
 *  follows the solid with no reprojection). `scale` is unused, like a light's.
 *  `parentId` is kept equal to `targetId`; the engine follows `targetId`. */
export interface DecalObject extends SceneObjectBase {
  kind: 'decal'
  targetId: string
  content: DecalContent
  size: number     // decal width, target-local units (height derives from texture aspect)
  depth: number    // projection box depth — how far the sticker wraps around curvature
  spin: number     // radians around the surface normal
  opacity: number  // 0..1
}
```

Extend the union: `export type SceneObject = PrimitiveObject | GlbObject | LightObject | GroupObject | DecalObject`.

b) `sceneHasShaderFill` and `sceneHasOpalFlow`: change both early-outs to
`if (o.kind === 'light' || o.kind === 'group' || o.kind === 'decal') return false`.

c) Defaults + factory next to `createLight` (~line 591):

```ts
export const DECAL_DEFAULTS = {
  size: 0.6, depth: 0.25, spin: 0, opacity: 1,
  text: 'LABEL', color: '#1a1a1a', font: 'google:Inter@700',
} as const

export function createDecal(
  targetId: string,
  pose: { position: Vec3; rotation: Vec3 },
  content: DecalContent,
  existing: SceneObject[],
): DecalObject {
  const label = content.type === 'text' ? 'Text decal' : 'Sticker'
  return {
    id: newId(), name: numberedName(label, existing), kind: 'decal',
    visible: true, position: pose.position, rotation: pose.rotation, scale: [1, 1, 1],
    material: { ...DEFAULT_MATERIAL }, // dummy, never rendered — same as lights/groups
    parentId: targetId, targetId, content,
    size: DECAL_DEFAULTS.size, depth: DECAL_DEFAULTS.depth,
    spin: DECAL_DEFAULTS.spin, opacity: DECAL_DEFAULTS.opacity,
  }
}
```

d) In `parseDoc`, add a tolerant content parser next to `parseContent` (~line 830):

```ts
const parseDecalContent = (raw: any): DecalContent | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  if (raw.type === 'image' && typeof raw.image === 'string') return { type: 'image', image: raw.image }
  if (raw.type === 'text' && typeof raw.text === 'string') {
    return { type: 'text', text: raw.text, font: str(raw.font, DECAL_DEFAULTS.font), color: str(raw.color, DECAL_DEFAULTS.color) }
  }
  return undefined // unusable content ⇒ the object is dropped (same as an unknown kind)
}
```

e) A `kind === 'decal'` branch in the objects `flatMap`, before the final `return []` (~line 900):

```ts
if (o.kind === 'decal' && typeof o.targetId === 'string') {
  const content = parseDecalContent(o.content)
  if (!content) return []
  return [{
    ...common, kind: 'decal' as const, targetId: o.targetId, content,
    size: num(o.size, DECAL_DEFAULTS.size), depth: num(o.depth, DECAL_DEFAULTS.depth),
    spin: num(o.spin, DECAL_DEFAULTS.spin),
    opacity: Math.min(1, Math.max(0, num(o.opacity, DECAL_DEFAULTS.opacity))),
    // parentId invariant: the hierarchy edge always mirrors the projection target,
    // whatever a stored doc claims — the engine follows targetId either way.
    parentId: o.targetId,
  }]
}
```

f) After the `objects` array is built and BEFORE `sanitizeHierarchy(objects)` (~line 903), drop decals whose target didn't survive or isn't a primitive:

```ts
const byId = new Map(objects.map((o) => [o.id, o]))
const survivors = objects.filter((o) => o.kind !== 'decal' || byId.get(o.targetId)?.kind === 'primitive')
sanitizeHierarchy(survivors)
```
…and use `survivors` in the returned doc's `objects` field.

- [ ] **Step 4: Run tests, verify they pass** — same command. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/scene3d/config.ts frontend/tests/unit/scene3d-decals.unit.spec.ts
git commit -m "feat(scene3d): DecalObject doc model — parse, defaults, factory"
```

---

### Task 2: Decal build helpers (`decals.ts`)

**Files:**
- Create: `frontend/app/lib/scene3d/decals.ts`
- Test: append to `frontend/tests/unit/scene3d-decals.unit.spec.ts`

**Interfaces:**
- Consumes: `DecalContent`, `DecalObject`, `Vec3` from `./config`; `DecalGeometry` from three examples.
- Produces (engine consumes in Task 3):
  - `eulerFromNormal(localNormal: Vec3): Vec3` — projector orientation (+Z along the outward normal), XYZ euler.
  - `decalKeyFor(obj: DecalObject, targetGeoKey: unknown): string` — rebuild cache key. **Excludes `opacity`** (updated in place).
  - `decalTextureFor(content: DecalContent): Promise<THREE.Texture>` — cached; failed loads evict so a later sync retries.
  - `buildDecalMesh(targetMesh: THREE.Mesh, obj: DecalObject, texture: THREE.Texture): THREE.Mesh` — TARGET-LOCAL geometry.

- [ ] **Step 1: Write failing tests** (append to the spec file)

```ts
import * as THREE from 'three'
import { eulerFromNormal, decalKeyFor } from '~/lib/scene3d/decals'

describe('scene3d decals — projector math', () => {
  it.each([
    [[0, 0, 1]], [[0, 0, -1]], [[1, 0, 0]], [[0, 1, 0]], [[0.5, 0.5, 0.7071]],
  ] as const)('eulerFromNormal(%j): applying the euler to +Z recovers the normal', (n) => {
    const e = eulerFromNormal([n[0], n[1], n[2]])
    const v = new THREE.Vector3(0, 0, 1)
      .applyEuler(new THREE.Euler(e[0], e[1], e[2], 'XYZ'))
    const expected = new THREE.Vector3(...n).normalize()
    expect(v.distanceTo(expected)).toBeLessThan(1e-6)
  })

  it('decalKeyFor changes with pose/content/target geometry, not opacity', () => {
    const base = { kind: 'decal', id: 'd', name: 'D', visible: true, targetId: 't',
      position: [0,0,0], rotation: [0,0,0], scale: [1,1,1], material: {} as any,
      content: { type: 'text', text: 'A', font: 'f', color: '#000' },
      size: 0.6, depth: 0.25, spin: 0, opacity: 1 } as any
    const k = decalKeyFor(base, 'geo1')
    expect(decalKeyFor({ ...base, opacity: 0.3 }, 'geo1')).toBe(k)
    expect(decalKeyFor({ ...base, spin: 1 }, 'geo1')).not.toBe(k)
    expect(decalKeyFor(base, 'geo2')).not.toBe(k)
    expect(decalKeyFor({ ...base, content: { ...base.content, text: 'B' } }, 'geo1')).not.toBe(k)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail** — module not found.

- [ ] **Step 3: Implement `frontend/app/lib/scene3d/decals.ts`**

IMPORTANT sub-checks before writing:
- Check `frontend/app/data/google-fonts.ts` (~line 77-85) for an exported css2-URL builder and `frontend/app/lib/spacetype/state.ts:35-47` (`ensureSpaceTypeFont`) for an exported font-loading helper. **Reuse whichever is exported** instead of the inline fallbacks below.
- Check `frontend/app/lib/scene3d/outlines.ts:122` — `parseGoogleFontValue` may already parse the `google:Fam@W` token; reuse if exported.
- Keep everything that touches `document` INSIDE function bodies so importing the module stays node-safe for vitest.

```ts
import * as THREE from 'three'
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js'
import type { DecalContent, DecalObject, Vec3 } from './config'

/** Projector orientation for a decal: +Z looks along the outward surface
 *  normal. Position-independent — lookAt from the origin. */
export function eulerFromNormal(localNormal: Vec3): Vec3 {
  const n = new THREE.Vector3(...localNormal).normalize()
  const helper = new THREE.Object3D()
  helper.lookAt(n)
  return [helper.rotation.x, helper.rotation.y, helper.rotation.z]
}

/** Rebuild key. Opacity is deliberately absent — the engine writes it to the
 *  material in place so the slider never re-projects geometry. */
export function decalKeyFor(obj: DecalObject, targetGeoKey: unknown): string {
  return JSON.stringify([obj.content, obj.position, obj.rotation, obj.spin, obj.size, obj.depth, targetGeoKey ?? null])
}

// One texture per distinct content, shared across decals and rebuilds. The
// engine must therefore NEVER dispose a decal texture — dispose geometry and
// material only (Material.dispose does not dispose .map).
const texCache = new Map<string, Promise<THREE.Texture>>()

export function decalTextureFor(content: DecalContent): Promise<THREE.Texture> {
  const key = JSON.stringify(content)
  let p = texCache.get(key)
  if (!p) {
    p = content.type === 'image' ? loadImageTexture(content.image) : makeTextDecalTexture(content)
    texCache.set(key, p)
    p.catch(() => texCache.delete(key)) // evict failures so the next sync retries
  }
  return p
}

function loadImageTexture(filename: string): Promise<THREE.Texture> {
  const url = `/view?${new URLSearchParams({ filename, type: 'input' }).toString()}`
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  })
}

function parseFontToken(font: string): { family: string; weight: number } {
  const m = /^google:([^@]+?)(?:@(\d+))?$/.exec(font)
  if (m) return { family: m[1]!, weight: m[2] ? Number(m[2]) : 700 }
  return { family: 'Inter', weight: 700 }
}

async function ensureCanvasFont(family: string, weight: number): Promise<void> {
  const id = `scene3d-decal-font-${family.replace(/\s+/g, '-')}-${weight}`
  if (!document.getElementById(id)) {
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${family.trim().replace(/\s+/g, '+')}:wght@${weight}&display=swap`
    document.head.appendChild(link)
  }
  try { await document.fonts.load(`${weight} 64px "${family}"`) } catch { /* canvas falls back to sans-serif */ }
}

async function makeTextDecalTexture(content: Extract<DecalContent, { type: 'text' }>): Promise<THREE.Texture> {
  const { family, weight } = parseFontToken(content.font)
  await ensureCanvasFont(family, weight)
  const pad = 32, fontPx = 192
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `${weight} ${fontPx}px "${family}", sans-serif`
  const w = Math.max(2, Math.ceil(measure.measureText(content.text || ' ').width)) + pad * 2
  const h = fontPx + pad * 2
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.font = `${weight} ${fontPx}px "${family}", sans-serif`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillStyle = content.color
  ctx.fillText(content.text || ' ', w / 2, h / 2)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/** Build the decal mesh in TARGET-LOCAL space: DecalGeometry reads the given
 *  mesh's matrixWorld, so projecting against a proxy that shares the target's
 *  geometry but sits at identity yields local-space output. The engine adds
 *  the result under the target's root with an identity transform. */
export function buildDecalMesh(targetMesh: THREE.Mesh, obj: DecalObject, texture: THREE.Texture): THREE.Mesh {
  const img = texture.image as { width?: number; height?: number } | undefined
  const aspect = img?.width && img?.height ? img.width / img.height : 1
  const proxy = new THREE.Mesh(targetMesh.geometry)
  proxy.updateMatrixWorld(true) // identity ⇒ local-space projection
  const helper = new THREE.Object3D()
  helper.rotation.set(obj.rotation[0], obj.rotation[1], obj.rotation[2])
  helper.rotateZ(obj.spin)
  const size = new THREE.Vector3(obj.size, obj.size / aspect, obj.depth)
  const geo = new DecalGeometry(proxy, new THREE.Vector3(...obj.position), helper.rotation, size)
  const mat = new THREE.MeshStandardMaterial({
    map: texture, transparent: true, opacity: obj.opacity,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4,
    roughness: 0.7, metalness: 0,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.castShadow = false
  mesh.receiveShadow = true
  return mesh
}
```

- [ ] **Step 4: Run tests, verify they pass** — `npx vitest run tests/unit/scene3d-decals.unit.spec.ts`. All green.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/decals.ts frontend/tests/unit/scene3d-decals.unit.spec.ts
git commit -m "feat(scene3d): decal build helpers — local-space DecalGeometry + text/image textures"
```

---

### Task 3: Engine wiring (`engine.ts` + motion filters)

**Files:**
- Modify: `frontend/app/lib/scene3d/engine.ts` (syncFromDoc dead-loop ~line 621-628, syncObject ~line 761-941)
- Modify: `frontend/app/lib/scene3d/motion/defaults.ts` (~lines 25, 42), `frontend/app/lib/scene3d/motion/render.ts` (~line 7)

**Interfaces:**
- Consumes: `buildDecalMesh`, `decalTextureFor`, `decalKeyFor` from `./decals`; `DecalObject` from `./config`.
- Produces: decal roots in `engine.objectRoots` keyed by decal id, `userData.sceneId` set (selection works), `userData.decalObj` stamped each sync, `userData.decalKey` for rebuilds. NO `userData.isLight`.

- [ ] **Step 1: Add the token map + cleanup**

Next to `glbTokens`/`fontTokens`/`meshTokens` declarations add `private decalTokens = new Map<string, number>()`. Add `this.decalTokens.delete(id)` in the dead-object loop (syncFromDoc, beside the other three deletes) AND in the sourceKey-mismatch teardown in `syncObject` (beside `this.fontTokens.delete(obj.id)`).

- [ ] **Step 2: Extend `syncObject`**

a) sourceKey (~line 765):
```ts
const sourceKey = obj.kind === 'primitive' ? `primitive:${obj.primitive}`
  : obj.kind === 'glb' ? `glb:${obj.url}`
  : obj.kind === 'group' ? 'group'
  : obj.kind === 'decal' ? 'decal'
  : `light:${obj.light}`
```

b) Creation branch — insert before the light `else`:
```ts
} else if (obj.kind === 'decal') {
  root = new THREE.Group() // decal mesh is added async once the texture resolves
```

c) Per-sync update branch — add after the `light` branch (~line 941):
```ts
} else if (obj.kind === 'decal') {
  // Stamped every sync so an async texture load applies the LATEST state.
  root.userData.decalObj = obj
  // Geometry is baked in TARGET-LOCAL space, so this root must sit at
  // identity under the TARGET root — undo the generic transform application
  // above, and follow targetId rather than parentId (a stray reparent must
  // not detach the sticker from its surface).
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1)
  const targetRoot = this.objectRoots.get(obj.targetId)
  if (targetRoot && root.parent !== targetRoot) targetRoot.add(root)
  const targetMesh = targetRoot as THREE.Mesh | undefined
  if (!targetMesh || !(targetMesh as any).isMesh) {
    // Target missing or still a placeholder group — render nothing this sync;
    // the next doc-driven sync retries.
    return
  }
  const existing = root.children[0] as THREE.Mesh | undefined
  if (existing) (existing.material as THREE.MeshStandardMaterial).opacity = obj.opacity
  const key = decalKeyFor(obj, targetMesh.userData.geoKey)
  if (root.userData.decalKey === key) return
  const tok = ++this.token
  this.decalTokens.set(obj.id, tok)
  decalTextureFor(obj.content).then((tex) => {
    if (this.decalTokens.get(obj.id) !== tok) return // stale (superseded/removed)
    const r = this.objectRoots.get(obj.id)
    if (!r) return
    const latest = (r.userData.decalObj as DecalObject | undefined) ?? obj
    const tRoot = this.objectRoots.get(latest.targetId) as THREE.Mesh | undefined
    if (!tRoot || !(tRoot as any).isMesh) return
    const old = r.children[0] as THREE.Mesh | undefined
    if (old) {
      r.remove(old)
      old.geometry.dispose()
      ;(old.material as THREE.Material).dispose() // does NOT dispose .map — the texture cache owns it
    }
    r.add(buildDecalMesh(tRoot, latest, tex))
    // Key recomputed at completion: the target's geometry may have changed
    // while the texture loaded.
    r.userData.decalKey = decalKeyFor(latest, tRoot.userData.geoKey)
  }).catch(() => { /* texture failed; cache evicted, next sync retries */ })
}
```

Note the TS narrowing: after adding `'decal'` to the union, the final `else` in the creation branch and the `light` update branch still narrow correctly because decal is handled explicitly before them. If tsc complains about the light `else` fallback in sourceKey/creation, adjust order so light remains the final else.

- [ ] **Step 3: Motion filters**

In `motion/defaults.ts` (both spots, ~line 25 and ~line 42) and `motion/render.ts` (~line 7), wherever objects are filtered with `kind === 'light'` (or `!== 'light'`), extend so decals are ALSO excluded from motion defaulting/animation — they follow their target's motion by parenting. Read each site and apply the same shape, e.g. `o.kind === 'light' || o.kind === 'decal'`.

- [ ] **Step 4: Typecheck delta**

Run from `frontend/`: `npx nuxi typecheck 2>&1 | tail -5` (or the repo's typecheck script). Compare against baseline (~328): NO new errors mentioning decal types. Exhaustiveness switches elsewhere (e.g. duplicate spread, object row) may now error on the widened union — if an error names `DecalObject`/`'decal'`, fix it in that file as part of this task (usually adding a trivial decal case).

- [ ] **Step 5: Run the full unit suite for scene3d** — `npx vitest run tests/unit/scene3d-decals.unit.spec.ts` plus any pre-existing scene3d specs (`ls tests/unit | grep -i scene3d`). All green. (Vitest counts lie under load — check the collected-file total matches.)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/scene3d/engine.ts frontend/app/lib/scene3d/motion/defaults.ts frontend/app/lib/scene3d/motion/render.ts
git commit -m "feat(scene3d): engine decal branch — target-local bake, async texture, motion exclusion"
```

---

### Task 4: Placement mode + gizmo suppression (`interaction.ts`)

**Files:**
- Modify: `frontend/app/lib/scene3d/interaction.ts` (onUp ~line 398-428, select ~line 618-635, selectMany + pivot attach sites — grep `attach(`)

**Interfaces:**
- Produces (surface consumes in Task 5):
  - `interface PlacementHit { targetId: string; localPoint: Vec3; localNormal: Vec3 }` (exported)
  - `beginPlacement(valid: (id: string) => boolean, cb: (hit: PlacementHit) => void): void`
  - `cancelPlacement(): void`
  - `get placementActive(): boolean`
  - `select(id, opts?: { noScale?: boolean; noGizmo?: boolean })` and `selectMany(ids, opts?: { noScale?: boolean; noGizmo?: boolean })` — **signature change**: the current boolean `isLight` param becomes `opts.noScale`. Update EVERY call site (grep `\.select\(` and `\.selectMany\(` across frontend/app).

- [ ] **Step 1: Add placement state + API**

```ts
export interface PlacementHit { targetId: string; localPoint: Vec3; localNormal: Vec3 }
// in the class:
private placement: { valid: (id: string) => boolean; cb: (hit: PlacementHit) => void } | null = null
beginPlacement(valid: (id: string) => boolean, cb: (hit: PlacementHit) => void): void { this.placement = { valid, cb } }
cancelPlacement(): void { this.placement = null }
get placementActive(): boolean { return this.placement !== null }
```

- [ ] **Step 2: Route clicks in `onUp`**

After the raycast produces `hits` (~line 414), BEFORE the selection loop:

```ts
if (this.placement) {
  const { valid, cb } = this.placement
  for (const hit of hits) {
    if (!hit.face || hit.object.userData.isGizmoHelper) continue
    let node: THREE.Object3D | null = hit.object
    while (node && !node.userData.sceneId) node = node.parent
    const id = node?.userData.sceneId as string | undefined
    if (!id || !valid(id)) continue // a decal/light on top of the surface — fall through to the next hit
    const targetRoot = this.engine.objectRoots.get(id)
    if (!targetRoot) continue
    const lp = targetRoot.worldToLocal(hit.point.clone())
    this.placement = null // consumed — a miss (loop exhausts) keeps placement armed; Escape cancels
    cb({ targetId: id, localPoint: [lp.x, lp.y, lp.z], localNormal: [hit.face.normal.x, hit.face.normal.y, hit.face.normal.z] })
    return
  }
  return // clicked empty space or an invalid object: stay in placement mode
}
```

(`hit.face.normal` is already in the target mesh's local space — for primitives the root IS the mesh, so no conversion.)

- [ ] **Step 3: Gizmo suppression**

Change `select(id: string | null, isLight = false)` → `select(id: string | null, opts: { noScale?: boolean; noGizmo?: boolean } = {})`:

```ts
for (const tc of this.gizmos) {
  const mode = (tc as unknown as { userData: Record<string, unknown> }).userData.mode
  if (!root || opts.noGizmo) tc.detach()
  else if (opts.noScale && mode === 'scale') tc.detach()
  else tc.attach(root)
}
```

Apply the same option object to `selectMany` and its pivot-attach path (the multi-select pivot code near line 522 has the equivalent `isLight`-gated detach — a selection containing any decal must attach NO gizmo to the pivot). Update every caller found by grep; the main one is the surface's `selectedIds` watch (Task 5 rewires it anyway, but keep this task compiling: pass `{ noScale: anyLight }` where the old boolean was passed).

- [ ] **Step 4: Typecheck** — same command as Task 3; no new decal-named or select-signature errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/lib/scene3d/interaction.ts frontend/app/components/vue-canvas/Scene3DStudioSurface.vue
git commit -m "feat(scene3d): surface placement mode + per-kind gizmo suppression"
```
(Include the surface file only if the call-site update touched it.)

---

### Task 5: Studio UI (surface + object row)

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`
- Modify: `frontend/app/components/vue-canvas/studio/Scene3DObjectRow.vue`

**Interfaces:**
- Consumes: `createDecal`, `DECAL_DEFAULTS`, `DecalContent`, `DecalObject` (config), `eulerFromNormal` (decals.ts), `beginPlacement`/`cancelPlacement`/`PlacementHit` (interaction), existing `FontPicker` + `StudioColor` + `StudioSlider` + `StudioSection` + `StudioButton` components, the existing image-upload flow inside `onTexFilePicked`.

- [ ] **Step 1: Object row icon** — in `Scene3DObjectRow.vue`, import `Sticker` from `lucide-vue-next` and extend the icon ternary:

```ts
const icon = computed(() =>
  props.object.kind === 'light' ? Lightbulb
  : props.object.kind === 'group' ? Folder
  : props.object.kind === 'decal' ? Sticker
  : Box)
```

- [ ] **Step 2: Surface script state**

Near the `selectedIsLight` computeds (~line 162):

```ts
const selectedIsDecal = computed(() => selected.value?.kind === 'decal')
const selectedDecal = computed<DecalObject | null>(() => (selected.value?.kind === 'decal' ? selected.value : null))
```

Placement flow (near `addLight`, ~line 2620):

```ts
// null = not placing; content set = placing a NEW decal; decalId set = repositioning.
const placingDecal = ref<null | { content?: DecalContent; decalId?: string }>(null)
const decalMenuOpen = ref(false)
const decalFileInput = ref<HTMLInputElement | null>(null)

function isDecalTarget(id: string): boolean {
  return doc.objects.find((o) => o.id === id)?.kind === 'primitive'
}
function beginDecalPlacement(spec: { content?: DecalContent; decalId?: string }) {
  placingDecal.value = spec
  decalMenuOpen.value = false
  interaction?.beginPlacement(isDecalTarget, onDecalPlaced)
}
function cancelDecalPlacement() {
  interaction?.cancelPlacement()
  placingDecal.value = null
}
function onDecalPlaced(hit: PlacementHit) {
  const spec = placingDecal.value
  placingDecal.value = null
  if (!spec) return
  const pose = { position: hit.localPoint, rotation: eulerFromNormal(hit.localNormal) }
  if (spec.decalId) {
    const d = doc.objects.find((o) => o.id === spec.decalId)
    if (d?.kind === 'decal') {
      d.targetId = hit.targetId; d.parentId = hit.targetId
      d.position = pose.position; d.rotation = pose.rotation
    }
    return
  }
  const o = createDecal(hit.targetId, pose, spec.content!, doc.objects)
  doc.objects.push(o)
  selectedId.value = o.id
}
function addTextDecal() {
  beginDecalPlacement({ content: { type: 'text', text: DECAL_DEFAULTS.text, font: DECAL_DEFAULTS.font, color: DECAL_DEFAULTS.color } })
}
async function onDecalFilePicked(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!file) return
  const filename = await uploadInputImage(file) // see below
  if (filename) beginDecalPlacement({ content: { type: 'image', image: filename } })
}
```

`uploadInputImage(file): Promise<string | null>`: read `onTexFilePicked` (~line 786 onward) — it already does file → dataURL → upload to the ComfyUI input dir. **Extract its upload core into a shared local helper** both callers use (keep `onTexFilePicked`'s per-object spinner/error handling in place, delegating the transport). Decal upload errors: `console.warn` + return null (no placement starts).

Escape: the surface already handles keys (grep the existing `keydown` handler with the Backspace guard) — add: if `placingDecal.value` is set, Escape calls `cancelDecalPlacement()` and stops there.

Selection watch (~line 1558) — replace the `anyLight` boolean pass-through:

```ts
const kinds = new Set(ids.map((id) => doc.objects.find((o) => o.id === id)?.kind))
interaction?.selectMany([...ids], { noScale: kinds.has('light'), noGizmo: kinds.has('decal') })
```

Decal params (next to `lightParam`, ~line 165):

```ts
function decalParam<K extends 'size' | 'depth' | 'spin' | 'opacity'>(key: K) {
  return computed<number>({
    get: () => selectedDecal.value?.[key] ?? DECAL_DEFAULTS[key],
    set: (v) => { if (selectedDecal.value) selectedDecal.value[key] = v },
  })
}
const decalSize = decalParam('size')
const decalDepth = decalParam('depth')
const decalOpacity = decalParam('opacity')
// Spin in DEGREES at the UI, radians in the doc.
const decalSpinDeg = computed<number>({
  get: () => Math.round(((selectedDecal.value?.spin ?? 0) * 180) / Math.PI),
  set: (v) => { if (selectedDecal.value) selectedDecal.value.spin = (v * Math.PI) / 180 },
})
const decalText = computed<string>({
  get: () => (selectedDecal.value?.content.type === 'text' ? selectedDecal.value.content.text : ''),
  set: (v) => { const c = selectedDecal.value?.content; if (c?.type === 'text') c.text = v },
})
const decalFont = computed<string>({
  get: () => (selectedDecal.value?.content.type === 'text' ? selectedDecal.value.content.font : DECAL_DEFAULTS.font),
  set: (v) => { const c = selectedDecal.value?.content; if (c?.type === 'text') c.font = v },
})
const decalColor = computed<string>({
  get: () => (selectedDecal.value?.content.type === 'text' ? selectedDecal.value.content.color : DECAL_DEFAULTS.color),
  set: (v) => { const c = selectedDecal.value?.content; if (c?.type === 'text') c.color = v },
})
```

- [ ] **Step 3: Surface template**

a) Toolbar: a Decal button + popup menu, cloned from the Light menu block (~line 3193-3208), placed beside it:

```html
<div v-if="decalMenuOpen" class="absolute bottom-full right-0 z-30 mb-2 w-44 rounded-lg border border-white/10 bg-[#161616] p-2 shadow-2xl">
  <button type="button" class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
    @click="addTextDecal">
    <Type class="size-4 shrink-0 opacity-70" /> Text label
  </button>
  <button type="button" class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-white/80 transition-colors hover:bg-white/10 hover:text-white cursor-pointer"
    @click="decalFileInput?.click()">
    <ImageIcon class="size-4 shrink-0 opacity-70" /> Image sticker
  </button>
</div>
<input ref="decalFileInput" type="file" accept="image/*" class="hidden" @change="onDecalFilePicked" />
```
Trigger button: `Sticker` icon, toggles `decalMenuOpen` (mirror the light trigger exactly, including closing the other menus on open). Import `Sticker`, `Type` and the image icon (`Image as ImageIcon`) from `lucide-vue-next`.

b) Placement hint overlay + cursor: on the canvas wrapper element add `:class="placingDecal ? 'cursor-crosshair' : ''"` and inside the viewport container:

```html
<div v-if="placingDecal" class="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-[11px] text-white/85">
  Click a surface to place — Esc to cancel
</div>
```

c) Decal section, after the Light StudioSection (~line 4057):

```html
<StudioSection v-if="selectedIsDecal" title="Decal" @pointerdown.capture="onControlsPointerDown">
  <div class="space-y-3">
    <template v-if="selectedDecal?.content.type === 'text'">
      <input v-model="decalText" type="text" placeholder="Label"
        class="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[12px] text-white/85 outline-none focus:border-white/25" />
      <FontPicker v-model="decalFont" />           <!-- match props/events of the existing usage ~line 1199 -->
      <div class="flex items-center justify-between">
        <span class="text-[11px] text-white/55">Color</span>
        <StudioColor v-model="decalColor" />
      </div>
    </template>
    <template v-else-if="selectedDecal?.content.type === 'image'">
      <img :src="texViewUrl(selectedDecal.content.image)" class="h-16 w-full rounded object-contain bg-white/5" />
      <StudioButton class="w-full" @click="decalFileInput?.click()">Replace image</StudioButton>
    </template>
    <StudioSlider v-model="decalSize" label="Size" hint="Sticker width on the surface" :min="0.05" :max="3" :step="0.01" />
    <StudioSlider v-model="decalSpinDeg" label="Spin" hint="Rotation around the surface normal" :min="-180" :max="180" :step="1" />
    <StudioSlider v-model="decalDepth" label="Wrap" hint="How far the sticker wraps around curved surfaces" :min="0.05" :max="2" :step="0.01" />
    <StudioSlider v-model="decalOpacity" label="Opacity" :min="0" :max="1" :step="0.01" />
    <StudioButton class="w-full" @click="beginDecalPlacement({ decalId: selectedDecal!.id })">Reposition</StudioButton>
  </div>
</StudioSection>
```

Check `FontPicker`'s actual name/props at its existing usage (~line 1199-1232) and the correct `StudioButton` import/variant before writing. NOTE: "Replace image" reuses `decalFileInput`, whose handler starts a NEW placement — for replace we want in-place swap. Give the handler a mode: if `selectedDecal` is an image decal AND `placingDecal` is null, `onDecalFilePicked` should instead set `selectedDecal.content = { type: 'image', image: filename }` (no placement). Implement via a `decalReplaceTarget = ref<string | null>(null)` set by the Replace button.

d) Duplicate — in the duplicate-copy spread (~line 2745, beside the light branch):

```ts
...(src.kind === 'decal' ? {
  targetId: src.targetId, content: JSON.parse(JSON.stringify(src.content)),
  size: src.size, depth: src.depth, spin: src.spin + Math.PI / 12, opacity: src.opacity,
} : {}),
```
(The spin offset makes the copy visible instead of z-fighting its source.)

- [ ] **Step 4: Compile check** — with the dev server running (`./dev.sh` if not already), `curl -s -o /dev/null -w "%{http_code}" 'http://127.0.0.1:3000/'` returns 200 and the Vite overlay shows no compile error (check `preview_logs`/console for the transformed module). Typecheck delta: no new decal-named errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/Scene3DStudioSurface.vue frontend/app/components/vue-canvas/studio/Scene3DObjectRow.vue
git commit -m "feat(scene3d): decal studio UI — place/reposition flow, decal section, list icon"
```

---

### Task 6: Live E2E verification + broken control + docs

**Files:**
- Modify (docs): `docs/STATE.md`, `docs/ROADMAP.md` if it lists 3D Studio gaps
- No product code except fixes found

This task is browser-driving, not code-writing. Use the Browser pane (NOT Bash-run servers): `./dev.sh` from repo root, then open `http://127.0.0.1:3000`. Known gotchas: hard-reload before debugging (HMR-stale pages), Browser pane hidden = rAF paused, synthetic pointer events prove nothing — use real clicks via `computer`.

- [ ] **Step 1: Build a scene** — new project, add a Scene3D node (`sailor:addNode` repro from memory if the UI path is slow), open the 3D Studio, add a Box primitive.
- [ ] **Step 2: Place a text decal** — Decal toolbar button → Text label → click the box's front face. Assert: object list shows "Text decal" nested under Box; viewport shows "LABEL" on the face (screenshot). Edit text to "SAILOR", pick a different Google font, change color — texture updates.
- [ ] **Step 3: Place an image sticker** — Decal → Image sticker → pick a small transparent PNG (generate one in the scratchpad with an ImageMagick/canvas one-liner and use the file chooser). Assert alpha renders (background shows through), Size/Spin/Wrap/Opacity sliders act.
- [ ] **Step 4: Follow-the-target proof** — with the decal placed, change the Box's Transform position/rotation in the panel by specific values. Screenshot before/after: the decal must stay glued to the same face. Then Reposition the decal onto a Sphere added next to the box.
- [ ] **Step 5: Persistence proof** — close the studio (state saves), hard-reload the page, reopen the studio: decals still present and rendered. Duplicate + delete: duplicating the box's decal yields a spun copy; deleting the Box removes its decals from the list.
- [ ] **Step 6: Broken control** (graceful-fallback rule: prove the mechanism, not "it rendered") — temporarily replace `proxy.updateMatrixWorld(true)` in `buildDecalMesh` with `proxy.matrixWorld.copy(targetMesh.matrixWorld)` + skip the identity: after moving the box, the decal must now detach/misplace. Confirm the failure, then `git checkout -- frontend/app/lib/scene3d/decals.ts` and confirm the pass again.
- [ ] **Step 7: Fix anything found** — any defect discovered goes through: reproduce → fix → re-verify → commit with its own message.
- [ ] **Step 8: Docs + dashboard** — update `docs/STATE.md` (3D Studio gains decals) and the live ⛵ build-dashboard artifact (read the LIVE artifact first, then redeploy with the same URL). Commit docs.

```bash
git add docs/STATE.md docs/ROADMAP.md
git commit -m "docs: 3D Studio decals landed — state + roadmap"
```
