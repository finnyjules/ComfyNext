# Scene3D Text-to-3D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In the 3D Studio, a prompt generates a 3D shape and inserts it: **text → FLUX image → (review + re-roll) → image-to-3D → GLB → auto-fit → insert**, calling **fal.ai directly** via the app's existing server helpers. Default image-to-3D model **Hunyuan3D v2**, swappable.

**Architecture:** Pure fal "model adapter" logic in `server/utils/scene3dGen.ts` (unit-tested), two thin Nitro routes (`gen-image`, `gen-3d`) that wrap it with `runFal`, a client `fitGlbGroup` normalizer, and a generate panel in the studio that calls the routes and inserts via the existing `addGlb`.

**Tech Stack:** TypeScript, Nuxt/Nitro server routes, fal.ai (`runFal`/`firstFalImageUrl` from `server/utils/falRun.ts`), three.js (client GLB fit), Vitest, Vue 3.

## Global Constraints

- Reuse existing helpers — do NOT re-implement fal calling: `runFal(app, input, opts)`, `firstFalImageUrl(result)` (`server/utils/falRun.ts`), `getFalToken` (`server/utils/falStorage.ts`). Route pattern: `server/api/inpaint/flux-fill.post.ts`.
- Reuse insertion: `addGlb(url)` / `createGlbObject` / `loadGlb` — do NOT build a new GLB pipeline.
- fal outputs are public CDN URLs; FLUX's image URL feeds directly as the 3D model's image input (no upload). GLB URL is returned as-is (fetchable by `loadGlb`).
- **Confirmed fal schema (Hunyuan3D v2):** input `input_image_url`, `textured_mesh` (bool; 3× price), `seed`; output `model_mesh.url`. FLUX (`fal-ai/flux/dev`): input `prompt`, `image_size`, `num_images`, `seed`; output `images[].url` (use `firstFalImageUrl`).
- **No-semicolon** TS; match surrounding files. No new deps.
- Commit hygiene: parallel sessions active — `git add` ONLY each task's named files, never `-A`/`.`. Check `git status --short <file>` first; stage only your hunks or BLOCKED.
- Frontend cwd `frontend/`. Unit tests: `tests/unit/**/*.unit.spec.ts`, run `npx vitest run tests/unit/<name>.unit.spec.ts`. Vitest aliases: `~`→`app`, `~~`→frontend root (so `~~/server/utils/...` imports work).
- **Paid API:** the routes hit fal (real money) only at runtime. All unit tests mock/avoid network. Live end-to-end verification is gated (Task 5) — the controller confirms with the user before running paid generations.

---

## Task 1: fal model-adapter + prompt shaping (pure, tested)

**Files:**
- Create: `frontend/server/utils/scene3dGen.ts`
- Test: `frontend/tests/unit/scene3d-gen.unit.spec.ts`

**Interfaces:**
- Produces:
  - `shapeImagePrompt(prompt: string): string` — appends the single-object suffix.
  - `THREE_D_MODELS: Record<string, ThreeDModel>` where `ThreeDModel = { app: string, buildInput(imageUrl: string, opts: { textured?: boolean, seed?: number }): Record<string, unknown>, glbUrlFrom(result: unknown): string | null }`.
  - `DEFAULT_3D_MODEL = 'hunyuan3d-v2'`, `THREE_D_MODEL_IDS: string[]`.
  - `resolve3dModel(id: string | undefined): ThreeDModel` (falls back to default).

- [ ] **Step 1: Write the failing test** — create `frontend/tests/unit/scene3d-gen.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shapeImagePrompt, THREE_D_MODELS, DEFAULT_3D_MODEL, resolve3dModel } from '~~/server/utils/scene3dGen'

describe('scene3d text-to-3d generation logic', () => {
  it('shapes the image prompt toward a clean single object', () => {
    const out = shapeImagePrompt('a red ceramic mug')
    expect(out).toContain('a red ceramic mug')
    expect(out.toLowerCase()).toMatch(/single|centered|plain|background/)
  })

  it('defaults to hunyuan3d v2 and resolves unknown ids to the default', () => {
    expect(DEFAULT_3D_MODEL).toBe('hunyuan3d-v2')
    expect(resolve3dModel(undefined)).toBe(THREE_D_MODELS['hunyuan3d-v2'])
    expect(resolve3dModel('nope')).toBe(THREE_D_MODELS['hunyuan3d-v2'])
  })

  it('builds the hunyuan3d input with input_image_url + textured_mesh and reads model_mesh.url', () => {
    const m = THREE_D_MODELS['hunyuan3d-v2']!
    expect(m.app).toBe('fal-ai/hunyuan3d/v2')
    const input = m.buildInput('https://x/img.png', { textured: true, seed: 7 })
    expect(input.input_image_url).toBe('https://x/img.png')
    expect(input.textured_mesh).toBe(true)
    expect(input.seed).toBe(7)
    expect(m.glbUrlFrom({ model_mesh: { url: 'https://x/model.glb' } })).toBe('https://x/model.glb')
    expect(m.glbUrlFrom({})).toBeNull()
  })

  it('every registered model builds an image input and can read a glb url', () => {
    for (const id of Object.keys(THREE_D_MODELS)) {
      const m = THREE_D_MODELS[id]!
      expect(typeof m.app).toBe('string')
      const input = m.buildInput('https://x/i.png', {})
      // each model carries the image url under some field
      expect(Object.values(input)).toContain('https://x/i.png')
      expect(m.glbUrlFrom({ model_mesh: { url: 'g.glb' } })).toBe('g.glb')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-gen.unit.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — create `frontend/server/utils/scene3dGen.ts`:

```ts
// Pure fal text-to-3D helpers, shared by the /api/scene3d/gen-* routes and unit
// tested without any network. The routes wrap these with runFal().

const PROMPT_SUFFIX = ', single centered object, plain neutral background, product shot, full object in frame, soft studio lighting'

/** Bias the FLUX prompt toward a clean, single, centred object on a plain
 *  background — image-to-3D models reconstruct those far better than busy scenes. */
export function shapeImagePrompt(prompt: string): string {
  const p = prompt.trim()
  return p ? `${p}${PROMPT_SUFFIX}` : ''
}

export interface ThreeDModel {
  app: string
  buildInput(imageUrl: string, opts: { textured?: boolean, seed?: number }): Record<string, unknown>
  glbUrlFrom(result: unknown): string | null
}

// Standard fal output shape for these models is { model_mesh: { url } }.
const meshUrl = (result: unknown): string | null => {
  const u = (result as { model_mesh?: { url?: string } })?.model_mesh?.url
  return typeof u === 'string' && u ? u : null
}

export const THREE_D_MODELS: Record<string, ThreeDModel> = {
  // Confirmed schema: input_image_url + textured_mesh (3x price), output model_mesh.url.
  'hunyuan3d-v2': {
    app: 'fal-ai/hunyuan3d/v2',
    buildInput: (imageUrl, o) => ({ input_image_url: imageUrl, textured_mesh: o.textured ?? false, ...(o.seed != null ? { seed: o.seed } : {}) }),
    glbUrlFrom: meshUrl,
  },
  // The others use `image_url`; exact fields verified against fal's live schema at build.
  'trellis-2': {
    app: 'fal-ai/trellis-2',
    buildInput: (imageUrl) => ({ image_url: imageUrl }),
    glbUrlFrom: meshUrl,
  },
  'tripo-v2.5': {
    app: 'fal-ai/tripo3d/tripo/v2.5/image-to-3d',
    buildInput: (imageUrl, o) => ({ image_url: imageUrl, texture: o.textured ?? true }),
    glbUrlFrom: (r) => meshUrl(r) ?? ((r as { pbr_model?: { url?: string } })?.pbr_model?.url ?? null),
  },
  'triposr': {
    app: 'fal-ai/triposr',
    buildInput: (imageUrl) => ({ image_url: imageUrl }),
    glbUrlFrom: meshUrl,
  },
}

export const DEFAULT_3D_MODEL = 'hunyuan3d-v2'
export const THREE_D_MODEL_IDS = Object.keys(THREE_D_MODELS)

export function resolve3dModel(id: string | undefined): ThreeDModel {
  return THREE_D_MODELS[id ?? ''] ?? THREE_D_MODELS[DEFAULT_3D_MODEL]!
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scene3d-gen.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/utils/scene3dGen.ts tests/unit/scene3d-gen.unit.spec.ts
git commit -m "feat(scene3d): fal text-to-3D model adapter + prompt shaping (pure logic)"
```

---

## Task 2: Server routes — gen-image + gen-3d

**Files:**
- Create: `frontend/server/api/scene3d/gen-image.post.ts`, `frontend/server/api/scene3d/gen-3d.post.ts`

**Interfaces:**
- Consumes: `runFal`, `firstFalImageUrl` (auto-imported from `server/utils/falRun.ts`); `shapeImagePrompt`, `resolve3dModel` (auto-imported from `server/utils/scene3dGen.ts`).
- Produces: `POST /api/scene3d/gen-image` → `{ imageUrl, seed }`; `POST /api/scene3d/gen-3d` → `{ glbUrl }`.

- [ ] **Step 1: Implement gen-image** — create `frontend/server/api/scene3d/gen-image.post.ts` (mirror `server/api/inpaint/flux-fill.post.ts` structure — `defineEventHandler`, `readBody`, validate, `createError` on failure; `runFal`/`firstFalImageUrl`/`shapeImagePrompt` are auto-imported):

```ts
// POST /api/scene3d/gen-image — text → a clean single-object image via fal FLUX,
// the reference for the image-to-3D step. Returns a public fal CDN image URL.
interface Body { prompt?: string, seed?: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const prompt = (body?.prompt ?? '').trim()
  if (!prompt) throw createError({ statusCode: 400, message: 'prompt is required' })
  const seed = Number.isFinite(body?.seed) ? Math.round(body!.seed as number) : Math.floor(Date.now() % 2_000_000_000)

  const result = await runFal('fal-ai/flux/dev', {
    prompt: shapeImagePrompt(prompt),
    image_size: 'square_hd',
    num_images: 1,
    seed,
  })
  const imageUrl = firstFalImageUrl(result)
  if (!imageUrl) throw createError({ statusCode: 502, message: 'fal returned no image' })
  return { imageUrl, seed }
})
```

- [ ] **Step 2: Implement gen-3d** — create `frontend/server/api/scene3d/gen-3d.post.ts`:

```ts
// POST /api/scene3d/gen-3d — image → 3D (GLB) via a fal image-to-3D model.
// Returns the fal CDN GLB URL (fetchable by the studio's loadGlb).
interface Body { imageUrl?: string, model?: string, textured?: boolean, seed?: number }

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const imageUrl = (body?.imageUrl ?? '').trim()
  if (!imageUrl) throw createError({ statusCode: 400, message: 'imageUrl is required' })

  const model = resolve3dModel(body?.model)
  const input = model.buildInput(imageUrl, { textured: body?.textured, seed: body?.seed })
  // 3D generation can take up to ~4 min — widen the poll deadline past the default 120s.
  const result = await runFal(model.app, input, { pollDeadlineMs: 300_000 })
  const glbUrl = model.glbUrlFrom(result)
  if (!glbUrl) throw createError({ statusCode: 502, message: 'fal returned no 3D model' })
  return { glbUrl }
})
```

- [ ] **Step 3: Type/compile check**

Run: `npx nuxi typecheck 2>&1 | grep -i "scene3d/gen" | tail` (or the repo's typecheck). Expected: no NEW errors from these files. If `runFal`/`firstFalImageUrl`/`shapeImagePrompt`/`resolve3dModel` aren't auto-imported (Nitro auto-imports `server/utils`), add explicit imports. Verify auto-import by checking how `flux-fill.post.ts` references `runFal` (it relies on auto-import).

- [ ] **Step 4: Commit**

```bash
git add server/api/scene3d/gen-image.post.ts server/api/scene3d/gen-3d.post.ts
git commit -m "feat(scene3d): gen-image + gen-3d fal routes for text-to-3D"
```

---

## Task 3: Client-side GLB auto-fit

**Files:**
- Create: `frontend/app/lib/scene3d/fitGlb.ts`
- Test: `frontend/tests/unit/scene3d-fit-glb.unit.spec.ts`

**Interfaces:**
- Produces: `fitGlbGroup(group: THREE.Object3D, targetSize?: number): void` — recenters the group on the origin in X/Z, rests its base at y≈0, and uniformly scales so its largest dimension ≈ `targetSize` (default 1.5). Mutates the group's position/scale.

- [ ] **Step 1: Write the failing test** — create `frontend/tests/unit/scene3d-fit-glb.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { fitGlbGroup } from '~/lib/scene3d/fitGlb'

describe('fitGlbGroup', () => {
  it('scales a large off-centre mesh down to ~1.5 units and recentres it', () => {
    const group = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 6))
    mesh.position.set(50, 20, -30) // arbitrary offset + scale, like a generated GLB
    group.add(mesh)
    fitGlbGroup(group, 1.5)
    const box = new THREE.Box3().setFromObject(group)
    const size = box.getSize(new THREE.Vector3())
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(1.5, 1)
    const center = box.getCenter(new THREE.Vector3())
    expect(Math.abs(center.x)).toBeLessThan(0.01)
    expect(Math.abs(center.z)).toBeLessThan(0.01)
    expect(box.min.y).toBeCloseTo(0, 1) // base on the ground
  })

  it('is a no-op-safe on an empty group', () => {
    expect(() => fitGlbGroup(new THREE.Group())).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/scene3d-fit-glb.unit.spec.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — create `frontend/app/lib/scene3d/fitGlb.ts`:

```ts
import * as THREE from 'three'

/** Normalize a freshly-loaded (generated) GLB so it sits sensibly in the scene:
 *  uniform-scaled so its largest dimension ≈ targetSize, centred on X/Z, base on
 *  the y=0 ground plane. Mutates position/scale on the group. Safe on empty groups. */
export function fitGlbGroup(group: THREE.Object3D, targetSize = 1.5): void {
  const box = new THREE.Box3().setFromObject(group)
  if (box.isEmpty()) return
  const size = box.getSize(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z)
  if (maxDim < 1e-6) return
  const s = targetSize / maxDim
  group.scale.multiplyScalar(s)
  // Recompute the box at the new scale, then centre X/Z and drop the base to y=0.
  const scaled = new THREE.Box3().setFromObject(group)
  const c = scaled.getCenter(new THREE.Vector3())
  group.position.x -= c.x
  group.position.z -= c.z
  group.position.y -= scaled.min.y
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/scene3d-fit-glb.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/scene3d/fitGlb.ts tests/unit/scene3d-fit-glb.unit.spec.ts
git commit -m "feat(scene3d): auto-fit normalizer for generated GLBs"
```

---

## Task 4: Studio generate panel (prompt → image review → make 3D → insert)

**Files:**
- Modify: `frontend/app/components/vue-canvas/Scene3DStudioSurface.vue`
- Possibly modify: `frontend/app/lib/scene3d/glb.ts` or the addGlb path to apply `fitGlbGroup`

**Interfaces:**
- Consumes: `POST /api/scene3d/gen-image`, `POST /api/scene3d/gen-3d`; `fitGlbGroup`; existing `addGlb`, `THREE_D_MODEL_IDS`.

- [ ] **Step 1: Implement** (UI wiring — no unit test; verified by compile + Task 5 live check):

4a. State: `genOpen` (panel open), `genPrompt` (string), `genImageUrl` (string|null), `genSeed` (number), `gen3dModel` (default `'hunyuan3d-v2'`), `genTextured` (bool), `genStage` (`'idle'|'image'|'review'|'making'|'error'`), `genError` (string). Import `THREE_D_MODEL_IDS` from `~~/server/utils/scene3dGen` (or duplicate the id list in a client-safe const — check whether importing a server util into a component is allowed; if not, define a small client const `GEN_3D_MODELS = ['hunyuan3d-v2','trellis-2','tripo-v2.5','triposr']`).

4b. `async function genImage()`: `genStage='image'`, `POST /api/scene3d/gen-image { prompt: genPrompt, seed }` via `$fetch`; on success set `genImageUrl`, `genSeed`, `genStage='review'`; on error set `genError`, `genStage='error'`.

4c. `function reroll()`: bump seed, call `genImage()` again.

4d. `async function make3d()`: `genStage='making'`, `POST /api/scene3d/gen-3d { imageUrl: genImageUrl, model: gen3dModel, textured: genTextured }`; on success call `addGlb(glbUrl)` (which must apply the fit — see 4f), then close the panel and select the new object; on error set `genError`.

4e. **Toolbar entry**: add a **"Generate"** button beside "+ Primitive" / "Upload GLB" / "Light" that toggles `genOpen`. Mirror the existing toolbar-button/menu markup. Panel contents: prompt `<textarea>`, Generate button; when `genStage==='review'`: the image (`<img :src="genImageUrl">`), Re-roll + Make 3D buttons, model `<select>` over the model ids, a Textured checkbox; progress/spinner for `'image'`/`'making'`; inline `genError`.

4f. **Apply the fit on insert.** In `addGlb` (or the generated-insert path), after the GLB loads, call `fitGlbGroup(group)` before it's placed. Cleanest: since `loadGlb` returns the group and the engine builds the GLB object via `syncObject`→`loadGlb`, add an opt-in normalize: give the generated `GlbObject` a flag, or apply the fit in the engine's GLB build for objects marked generated. Simplest robust approach: in the generate flow, after `addGlb`, the object's transform is set from a `fitGlbGroup` measurement — OR add `fitGlbGroup(group)` inside `loadGlb`/the engine GLB build gated on a `generated` marker. Pick the least invasive: apply `fitGlbGroup` in the engine's GLB-load callback for all GLBs (uploaded GLBs also benefit from sane sizing) OR only generated ones. Document the choice; keep uploaded-GLB behaviour unless normalizing them is clearly better.

- [ ] **Step 2: Type/compile check**

Run: `npx vue-tsc --noEmit 2>&1 | grep -i "Scene3DStudioSurface\|scene3dGen\|fitGlb" | tail` — no NEW errors vs baseline.

- [ ] **Step 3: Commit**

```bash
git add app/components/vue-canvas/Scene3DStudioSurface.vue app/lib/scene3d/glb.ts
git commit -m "feat(scene3d): Generate panel — text-to-3D with image review and insert"
```

---

## Task 5: Live (paid) end-to-end verification + polish

- [ ] **Step 1: Run every relevant unit test**

Run: `npx vitest run tests/unit/scene3d-gen.unit.spec.ts tests/unit/scene3d-fit-glb.unit.spec.ts tests/unit/scene3d-*.unit.spec.ts`
Expected: all PASS.

- [ ] **Step 2: Confirm FAL_KEY is configured** — the routes need `FAL_KEY` (or `NUXT_FAL_TOKEN`) in `frontend/.env`. If absent, STOP and tell the user (they add it); do not attempt to source a key.

- [ ] **Step 3: GATED paid live check** — **the controller confirms with the user before running any paid generation.** Then, on the dev server (`127.0.0.1:3000`, reuse the running one), open the studio → Generate: type a simple prompt ("a small potted cactus"), confirm a FLUX image returns and renders in the review step; Re-roll once; Make 3D with Hunyuan3D v2 → confirm a GLB returns, inserts, auto-fits to a sensible size beside a reference primitive, and is selectable. Screenshot. Keep it to **1–2 generations** (~$0.20–0.40).

- [ ] **Step 4: Fixes** for anything the live run surfaces (exact fal field-name mismatches per model, CORS on the GLB fetch → add the `glb-proxy` passthrough route, fit tuning). Re-verify.

---

## Self-Review Notes

- **Coverage:** adapter+prompt (T1), routes (T2), auto-fit (T3), generate UI+insert (T4), paid E2E (T5).
- **Reuse:** `runFal`/`firstFalImageUrl`/`getFalToken`, `addGlb`/`createGlbObject`/`loadGlb` — no new pipelines.
- **Confirmed vs verify-at-build:** Hunyuan3D v2 fields confirmed (`input_image_url`/`textured_mesh`/`model_mesh.url`); other models' image field (`image_url`) and any output variance are pinned in the live check (each is a one-line adapter entry).
- **Type consistency:** `ThreeDModel`/`resolve3dModel`/`shapeImagePrompt`/`fitGlbGroup` signatures consistent across tasks.
- **Cost discipline:** unit tests never hit the network; the only paid step is Task 5, gated on user confirmation.
- **Known risks (T5 verifies live):** per-model fal field names; GLB-fetch CORS (proxy fallback ready); auto-fit sizing feel; fal latency/poll deadline.
