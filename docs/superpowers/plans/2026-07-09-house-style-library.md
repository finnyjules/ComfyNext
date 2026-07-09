# House Style Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the ~47 locally-trained style LoRAs as a public, use-case-tagged style hub, with a repeatable `/dev/style-publisher` pipeline (profile backfill → thumbnail bake → catalog upsert).

**Architecture:** A git-committed catalog (`house-styles.json` + typed wrapper) with static thumbnails in `public/house-styles/`; a dev-only publisher page + dev-guarded Nitro endpoint that writes both; a `StyleHubModal` built on `CatalogModal`; "Use style" rides the two existing inference rails (`lora_url` = model ref for single-LoRA direct-run, `lora_b_url` = `.tar` for multi-lora stacking). Zero ComfyUI/Python changes except an optional `seed` passthrough in `lora-gen`.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Vitest (`npm run test:unit` in `frontend/`), Nitro server routes, Replicate via existing `runReplicate`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-09-house-style-library-design.md`.
- Work directly on `main`; NO feature branches. Stage with explicit paths (`git add <file> <file>`), NEVER `git add -A` (concurrent sessions).
- All commands run from `frontend/` unless the path says otherwise. Unit tests: `npm run test:unit` (vitest). Type safety: `npx vue-tsc --noEmit` has a PRE-EXISTING error baseline — record the error count before your change and assert no NEW errors, don't chase zero.
- New top-level `/api/*` server routes MUST be added to the allow-list in `frontend/server/middleware/comfyui-proxy.ts` (`NITRO_API_PREFIXES`) or they 404 (proxied to ComfyUI).
- Paid AI actions in UI (generate profile, bake thumbnails) get the pastel-gradient AI affordance; run/confirm buttons emerald; NEVER purple/violet.
- Dev pages under `frontend/app/pages/dev/` are auto-stripped from prod builds by `nuxt.config.ts` (`DEV_PAGES` regex) — no extra gating needed for pages. Dev-only SERVER routes are NOT stripped — they must guard with `import.meta.dev`.
- Characters (`kind === 'character'`) are always excluded — this library is styles only.
- The trained-LoRA sidecar dir is `<repoRoot>/models/loras/` (sibling of `frontend/`); server code resolves it as `path.resolve(process.cwd(), '..', 'models', 'loras')`.

---

### Task 1: Catalog data module + integrity tests

**Files:**
- Create: `frontend/app/data/house-styles.json`
- Create: `frontend/app/data/house-styles.ts`
- Test: `frontend/tests/unit/house-styles.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (leaf data module).
- Produces: `HouseStyle` interface, `USE_CASE_TAGS` const + `UseCaseTag` type, `VERTICALS`, `HOUSE_STYLES: HouseStyle[]`, `houseStyleById(id: string): HouseStyle | undefined`, `houseStylesForTag(tag: UseCaseTag): HouseStyle[]`, `houseStyleStyleBlock(s: Pick<HouseStyle, 'tasteProfile' | 'trigger'>): string`, `isReplicateModelRef(value: string): boolean`, `WEIGHTS_TAR_RE`. Later tasks import ALL of these from `~/data/house-styles`.

- [ ] **Step 1: Write the failing test**

`frontend/tests/unit/house-styles.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  HOUSE_STYLES, USE_CASE_TAGS, VERTICALS,
  houseStyleById, houseStylesForTag, houseStyleStyleBlock,
  isReplicateModelRef, WEIGHTS_TAR_RE,
} from '~/data/house-styles'

const publicDir = fileURLToPath(new URL('../../public', import.meta.url))

describe('house-styles catalog integrity', () => {
  it('has unique ids', () => {
    const ids = HOUSE_STYLES.map(s => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry is complete and valid', () => {
    for (const s of HOUSE_STYLES) {
      expect(s.id, s.id).toMatch(/^[a-z0-9-]+$/)
      expect(s.label.trim().length, s.id).toBeGreaterThan(0)
      expect(s.useCases.length, s.id).toBeGreaterThan(0)
      for (const t of s.useCases) expect(USE_CASE_TAGS, `${s.id} tag ${t}`).toContain(t)
      expect(s.trigger.trim().length, s.id).toBeGreaterThan(0)
      // tasteProfile REQUIRED — trigger-only styles land weak (spec §Risks)
      expect(s.tasteProfile.trim().length, s.id).toBeGreaterThan(40)
      expect(isReplicateModelRef(s.replicateModel), `${s.id} model ${s.replicateModel}`).toBe(true)
      expect(s.replicateModel, s.id).not.toContain(':') // version hash stripped
      expect(s.weightsUrl, s.id).toMatch(WEIGHTS_TAR_RE)
      expect(s.thumbnails.length, s.id).toBe(4)
      expect(s.examplePrompts.length, s.id).toBeGreaterThan(0)
    }
  })

  it('every thumbnail file exists on disk', () => {
    for (const s of HOUSE_STYLES) {
      for (const t of s.thumbnails) {
        expect(t, s.id).toMatch(new RegExp(`^/house-styles/${s.id}/thumb-[1-4]\\.webp$`))
        expect(existsSync(`${publicDir}${t}`), `${s.id}: missing ${t}`).toBe(true)
      }
    }
  })

  it('vertical overlay only references known tags', () => {
    for (const v of VERTICALS) for (const t of v.tags) expect(USE_CASE_TAGS).toContain(t)
  })

  it('helpers behave', () => {
    expect(houseStyleById('__nope__')).toBeUndefined()
    expect(houseStylesForTag(USE_CASE_TAGS[0]).every(s => s.useCases.includes(USE_CASE_TAGS[0]))).toBe(true)
    expect(houseStyleStyleBlock({ tasteProfile: 'Bold linocut.', trigger: 'rough_cut' }))
      .toBe('Bold linocut. rough_cut,')
    expect(houseStyleStyleBlock({ tasteProfile: 'Bold linocut.', trigger: '' })).toBe('Bold linocut.')
  })

  it('isReplicateModelRef mirrors the Python gate', () => {
    expect(isReplicateModelRef('finnyjules/jules-rough-cut')).toBe(true)
    expect(isReplicateModelRef('owner/model/version')).toBe(true)
    expect(isReplicateModelRef('https://replicate.delivery/a/b/trained_model.tar')).toBe(false)
    expect(isReplicateModelRef('owner/model.safetensors')).toBe(false)
    expect(isReplicateModelRef('huggingface.co/owner/model')).toBe(false)
    expect(isReplicateModelRef('hf.co/owner/model')).toBe(false)
    expect(isReplicateModelRef('civitai.com/models/123')).toBe(false)
    expect(isReplicateModelRef('single-segment')).toBe(false)
    expect(isReplicateModelRef('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- house-styles`
Expected: FAIL — cannot resolve `~/data/house-styles`.

- [ ] **Step 3: Write the data module**

`frontend/app/data/house-styles.json`:

```json
[]
```

`frontend/app/data/house-styles.ts`:

```ts
/**
 * House style library — ComfyNext-trained style LoRAs published for all users.
 * Entries are SELF-CONTAINED: no dependency on the local models/loras sidecars
 * (those exist only on the dev machine). Published via /dev/style-publisher,
 * which upserts house-styles.json and writes thumbnails to
 * public/house-styles/<id>/. Publishing = reviewing the git diff + committing.
 */
import rawEntries from './house-styles.json'

export const USE_CASE_TAGS = [
  'illustration', 'poster', 'branding', 'editorial', 'photography',
  'typography', 'anime', '3d', 'texture', 'ecomm', 'fashion', 'architecture',
] as const
export type UseCaseTag = (typeof USE_CASE_TAGS)[number]

export interface HouseStyle {
  id: string                 // kebab-case, e.g. 'rough-cut-revival'
  label: string
  useCases: UseCaseTag[]     // ≥1 — the primary browse dimension
  trigger: string
  tasteProfile: string       // dense conditioning block; REQUIRED
  replicateModel: string     // 'owner/model' (version stripped) — single-LoRA direct-run
  weightsUrl: string         // trained_model.tar — multi-lora stacking
  thumbnails: string[]       // exactly 4, under /house-styles/<id>/
  examplePrompts: string[]
  suggestedScale?: number
}

/** Curated tag groupings for future vertical browsing (phase 2 UI). */
export const VERTICALS: { label: string; tags: UseCaseTag[] }[] = [
  { label: 'Fashion', tags: ['fashion', 'editorial', 'ecomm'] },
  { label: 'Architecture', tags: ['architecture'] },
  { label: 'Graphic', tags: ['poster', 'branding', 'typography'] },
  { label: 'Illustration', tags: ['illustration', 'anime', '3d'] },
]

export const HOUSE_STYLES = rawEntries as HouseStyle[]

export function houseStyleById(id: string): HouseStyle | undefined {
  return HOUSE_STYLES.find(s => s.id === id)
}

export function houseStylesForTag(tag: UseCaseTag): HouseStyle[] {
  return HOUSE_STYLES.filter(s => s.useCases.includes(tag))
}

/**
 * The style-activation block that goes into the node's collapsed `aesthetic`
 * PROPERTY (folded into the prompt at submit by injectLoraStyleIntoPrompt).
 * Same shape LoRALibraryPanel uses for local trained styles.
 */
export function houseStyleStyleBlock(s: Pick<HouseStyle, 'tasteProfile' | 'trigger'>): string {
  return [s.tasteProfile.trim(), s.trigger.trim() ? `${s.trigger.trim()},` : '']
    .filter(Boolean).join(' ').trim()
}

/** Accepted trained-weights artifact shape (multi-lora loader requirement). */
export const WEIGHTS_TAR_RE = /^https:\/\/replicate\.delivery\/[^/]+\/[^/]+\/trained_model\.tar$/

/** TS mirror of comfy_api_nodes/replicate_refs.py::_is_replicate_model_ref. */
export function isReplicateModelRef(value: string): boolean {
  const s = (value || '').trim()
  if (!s || s.includes('://')) return false
  const low = s.toLowerCase()
  if (low.endsWith('.safetensors')) return false
  if (low.includes('huggingface.co') || low.includes('civitai.com') || low.startsWith('hf.co/')) return false
  const parts = s.split('/').filter(Boolean)
  return parts.length === 2 || parts.length === 3
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- house-styles`
Expected: PASS (entry loops are vacuous over `[]`; helper + ref-gate tests are live).

- [ ] **Step 5: Commit**

```bash
git add app/data/house-styles.json app/data/house-styles.ts tests/unit/house-styles.unit.spec.ts
git commit -m "feat(styles): house style catalog schema + integrity tests"
```

---

### Task 2: Benchmark shots constant

**Files:**
- Create: `frontend/app/data/house-style-benchmarks.ts`
- Test: `frontend/tests/unit/house-style-benchmarks.unit.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BenchmarkShot { id: 'portrait'|'scene'|'object'|'type'; prompt: string; seed: number; aspectRatio: '1:1' }`, `BENCHMARK_SHOTS: BenchmarkShot[]` (exactly 4, stable seeds). The publisher (Task 6) bakes thumbs from these; re-bakes must be reproducible, so NEVER edit prompts/seeds after styles ship (add new ids instead).

- [ ] **Step 1: Write the failing test**

`frontend/tests/unit/house-style-benchmarks.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BENCHMARK_SHOTS } from '~/data/house-style-benchmarks'

describe('house style benchmark shots', () => {
  it('has exactly 4 stable shots', () => {
    expect(BENCHMARK_SHOTS.map(s => s.id)).toEqual(['portrait', 'scene', 'object', 'type'])
    // Frozen: thumb grids across styles are only comparable if these never change.
    expect(BENCHMARK_SHOTS.map(s => s.seed)).toEqual([101101, 202202, 303303, 404404])
  })
  it('prompts are style-neutral and non-empty', () => {
    for (const s of BENCHMARK_SHOTS) {
      expect(s.prompt.trim().length).toBeGreaterThan(10)
      expect(s.aspectRatio).toBe('1:1')
      // the server injects trigger+aesthetic — prompts must not name any style
      expect(s.prompt.toLowerCase()).not.toMatch(/style|aesthetic/)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- house-style-benchmarks`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

`frontend/app/data/house-style-benchmarks.ts`:

```ts
/**
 * Fixed benchmark subjects + seeds for house-style thumbnails. Every style
 * bakes the SAME 4 shots so the hub grid compares apples to apples.
 * FROZEN once styles ship — a re-bake must reproduce the same grid.
 * Prompts are deliberately style-free: /api/inpaint/lora-gen injects the
 * style's trigger + aesthetic server-side (buildLoraPrompt).
 */
export interface BenchmarkShot {
  id: 'portrait' | 'scene' | 'object' | 'type'
  prompt: string
  seed: number
  aspectRatio: '1:1'
}

export const BENCHMARK_SHOTS: BenchmarkShot[] = [
  { id: 'portrait', seed: 101101, aspectRatio: '1:1', prompt: 'portrait of a woman with short dark hair, shoulders up, calm expression, plain background' },
  { id: 'scene', seed: 202202, aspectRatio: '1:1', prompt: 'a quiet street corner cafe at dusk, two empty chairs outside, warm light in the window' },
  { id: 'object', seed: 303303, aspectRatio: '1:1', prompt: 'a single sneaker on a small pedestal, clean studio product shot' },
  { id: 'type', seed: 404404, aspectRatio: '1:1', prompt: 'a poster dominated by the large word "NOVA" in bold lettering' },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- house-style-benchmarks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/data/house-style-benchmarks.ts tests/unit/house-style-benchmarks.unit.spec.ts
git commit -m "feat(styles): frozen benchmark shots for house-style thumbnails"
```

---

### Task 3: `lora-gen` optional seed passthrough

**Files:**
- Create: `frontend/server/utils/loraGenInput.ts`
- Modify: `frontend/server/api/inpaint/lora-gen.post.ts` (the `Body` interface + the `runReplicate` input construction)
- Test: `frontend/tests/unit/lora-gen-input.unit.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `buildLoraGenInput(opts: { prompt: string; aspectRatio?: string; loraScale?: number; guidanceScale?: number; seed?: number }): Record<string, unknown>` — the exact Replicate input object. `lora-gen.post.ts` body gains optional `seed?: number`. The publisher (Task 6) POSTs `{ name, prompt, aspectRatio, seed }`.

**Context for the implementer:** `lora-gen.post.ts` currently builds the input inline: `{ prompt, aspect_ratio, megapixels: '1', num_inference_steps: 22, guidance_scale (default 3.5), num_outputs: 1, output_format: 'png', lora_scale (default 1) }`. Extract that into `buildLoraGenInput` verbatim, add seed. **Do not change any default value** — other callers (character sheet regen) depend on them. Note the prompt passed to the builder is the ALREADY-BUILT `buildLoraPrompt(...)` output — the builder does not touch trigger/aesthetic logic.

- [ ] **Step 1: Write the failing test**

`frontend/tests/unit/lora-gen-input.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildLoraGenInput } from '../../server/utils/loraGenInput'

describe('buildLoraGenInput', () => {
  it('keeps the existing defaults exactly', () => {
    expect(buildLoraGenInput({ prompt: 'p' })).toEqual({
      prompt: 'p',
      aspect_ratio: '1:1',
      megapixels: '1',
      num_inference_steps: 22,
      guidance_scale: 3.5,
      num_outputs: 1,
      output_format: 'png',
      lora_scale: 1,
    })
  })
  it('passes seed only when finite', () => {
    expect(buildLoraGenInput({ prompt: 'p', seed: 101101 }).seed).toBe(101101)
    expect('seed' in buildLoraGenInput({ prompt: 'p' })).toBe(false)
    expect('seed' in buildLoraGenInput({ prompt: 'p', seed: Number.NaN })).toBe(false)
  })
  it('honors overrides', () => {
    const out = buildLoraGenInput({ prompt: 'p', aspectRatio: '4:3', loraScale: 0.7, guidanceScale: 4 })
    expect(out.aspect_ratio).toBe('4:3')
    expect(out.lora_scale).toBe(0.7)
    expect(out.guidance_scale).toBe(4)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- lora-gen-input`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`frontend/server/utils/loraGenInput.ts`:

```ts
/** Replicate input for trained-style sample generation (lora-gen endpoint). */
export function buildLoraGenInput(opts: {
  prompt: string
  aspectRatio?: string
  loraScale?: number
  guidanceScale?: number
  seed?: number
}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt: opts.prompt,
    aspect_ratio: opts.aspectRatio || '1:1',
    megapixels: '1',
    num_inference_steps: 22,
    guidance_scale: Number.isFinite(opts.guidanceScale) ? opts.guidanceScale : 3.5,
    num_outputs: 1,
    output_format: 'png',
    lora_scale: Number.isFinite(opts.loraScale) ? opts.loraScale : 1,
  }
  if (Number.isFinite(opts.seed)) input.seed = opts.seed
  return input
}
```

In `frontend/server/api/inpaint/lora-gen.post.ts`: add `seed?: number` to the `Body` interface, import `buildLoraGenInput`, and replace the inline input object in the `runReplicate(...)` call with `buildLoraGenInput({ prompt, aspectRatio: body.aspectRatio, loraScale: body.loraScale, guidanceScale: body.guidanceScale, seed: body.seed })` where `prompt` is the existing `buildLoraPrompt(...)` result. Nothing else in the handler changes.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test:unit -- lora-gen-input && npm run test:unit -- lora`
Expected: PASS, and the existing `lora-sidecar` / `loraPrompt` suites stay green.

- [ ] **Step 5: Commit**

```bash
git add server/utils/loraGenInput.ts server/api/inpaint/lora-gen.post.ts tests/unit/lora-gen-input.unit.spec.ts
git commit -m "feat(styles): optional seed passthrough in lora-gen for reproducible thumbnails"
```

---

### Task 4: Tag the community library (`LORA_LIBRARY`) with use cases

**Files:**
- Modify: `frontend/app/data/lora-library.ts`
- Test: `frontend/tests/unit/lora-library-tags.unit.spec.ts`

**Interfaces:**
- Consumes: `UseCaseTag` from `~/data/house-styles`.
- Produces: `LoRALibraryEntry` gains `useCases?: UseCaseTag[]`; ALL 40 entries get tagged. The hub (Task 7) filters community entries by these tags (falling back to `category` labels for display only).

- [ ] **Step 1: Write the failing test**

`frontend/tests/unit/lora-library-tags.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { LORA_LIBRARY } from '~/data/lora-library'
import { USE_CASE_TAGS } from '~/data/house-styles'

describe('community LoRA library use-case tags', () => {
  it('every entry is tagged with ≥1 known use case', () => {
    for (const e of LORA_LIBRARY) {
      expect(e.useCases?.length, e.label).toBeGreaterThan(0)
      for (const t of e.useCases!) expect(USE_CASE_TAGS, `${e.label}: ${t}`).toContain(t)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- lora-library-tags`
Expected: FAIL — `useCases` undefined on every entry.

- [ ] **Step 3: Add the field + tag all entries**

In `frontend/app/data/lora-library.ts`, add to the interface (below `suggestedScale`):

```ts
  /** Use-case tags for the Style Hub (see USE_CASE_TAGS in house-styles.ts). */
  useCases?: import('./house-styles').UseCaseTag[]
```

Then add a `useCases` line to every entry, per this mapping (label → tags):

| Entry | useCases |
|---|---|
| Flux Realism | `['photography', 'editorial']` |
| Koda · Kodachrome | `['photography', 'editorial', 'fashion']` |
| Tarot Card | `['illustration', 'poster']` |
| Polaroid Plus | `['photography', 'fashion']` |
| Super Realism | `['photography', 'ecomm']` |
| Face Realism | `['photography', 'editorial']` |
| Polaroid Mood | `['photography', 'fashion']` |
| Film Noir | `['photography', 'poster', 'editorial']` |
| Frosting Lane | `['illustration']` |
| Soft Pasty | `['illustration', 'editorial']` |
| Little Tinies | `['illustration']` |
| Sketch Sized | `['illustration']` |
| Ghibsky | `['illustration', 'anime']` |
| Sketched Manga | `['illustration', 'anime']` |
| Coloring Book | `['illustration']` |
| Haunted Linework | `['illustration', 'poster']` |
| MS Paint | `['illustration']` |
| Stippled | `['illustration', 'branding']` |
| Sonny Anime | `['anime', 'poster']` |
| Aesthetic Anime | `['anime', 'editorial']` |
| 90s Anime Art | `['anime', 'poster']` |
| Anime Blockprint | `['anime', 'poster', 'texture']` |
| Canopus Anime | `['anime']` |
| Animex | `['anime', 'illustration']` |
| 3D Isometric | `['3d', 'branding']` |
| Handwriting | `['typography', 'branding']` |
| Product Design | `['ecomm', 'branding', '3d']` |
| Yarn World | `['3d', 'texture', 'illustration']` |
| Retrofuturism | `['poster', 'illustration']` |
| Claymation | `['3d', 'illustration']` |
| Pixar 3D | `['3d', 'illustration']` |
| Cute 3D Kawaii | `['3d', 'illustration']` |
| Plushy World | `['3d', 'texture']` |
| 80s Cyberpunk | `['poster', 'photography']` |
| Furry | `['illustration']` |
| Blueprint | `['architecture', 'branding', 'poster']` |
| Pixel Background | `['illustration', 'texture']` |
| 3D Sketchfab | `['3d', 'ecomm']` |
| Bad 70s Food | `['photography']` |
| Victorian Satire | `['illustration', 'editorial']` |

- [ ] **Step 4: Run tests to verify pass**

Run: `npm run test:unit -- lora-library-tags && npm run test:unit -- house-styles`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add app/data/lora-library.ts tests/unit/lora-library-tags.unit.spec.ts
git commit -m "feat(styles): use-case tags on the community LoRA library"
```

---

### Task 5: Publish store util + dev-guarded publish endpoint + proxy allow-list

**Files:**
- Create: `frontend/server/utils/houseStylesStore.ts`
- Create: `frontend/server/api/house-styles/publish.post.ts`
- Modify: `frontend/server/middleware/comfyui-proxy.ts` (add `'/api/house-styles'` to `NITRO_API_PREFIXES`)
- Test: `frontend/tests/unit/house-styles-store.unit.spec.ts`

**Interfaces:**
- Consumes: `WEIGHTS_TAR_RE`-equivalent validation (duplicated here as plain logic — server utils must not import from `app/`).
- Produces:
  - `validateHouseStyleEntry(e: unknown): string[]` — returns human-readable errors, `[]` = valid. BLOCKS empty `tasteProfile` (spec requirement).
  - `upsertHouseStyle(entries: HouseStyleEntry[], entry: HouseStyleEntry): HouseStyleEntry[]` — pure; replaces by `replicateModel` key else appends; keeps array sorted by `label`.
  - `HouseStyleEntry` type (server-side twin of `HouseStyle`).
  - Endpoint `POST /api/house-styles/publish` — body `{ entry: Omit<HouseStyleEntry, 'thumbnails'>, thumbnails: string[] }` where `thumbnails` = exactly 4 `data:image/webp;base64,...` URLs. Writes `frontend/public/house-styles/<id>/thumb-{1..4}.webp` + upserts `frontend/app/data/house-styles.json`. Returns `{ ok: true, id, count }`. 404s outside dev.

- [ ] **Step 1: Write the failing test**

`frontend/tests/unit/house-styles-store.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateHouseStyleEntry, upsertHouseStyle, type HouseStyleEntry } from '../../server/utils/houseStylesStore'

const valid: HouseStyleEntry = {
  id: 'rough-cut-revival',
  label: 'Rough Cut Revival',
  useCases: ['illustration', 'poster'],
  trigger: 'rough_cut_revival',
  tasteProfile: 'This aesthetic converges raw, high-contrast linocut techniques with a bold, muted color scheme.',
  replicateModel: 'finnyjules/jules-rough_cut_revival',
  weightsUrl: 'https://replicate.delivery/xezq/abc123/trained_model.tar',
  thumbnails: ['/house-styles/rough-cut-revival/thumb-1.webp', '/house-styles/rough-cut-revival/thumb-2.webp', '/house-styles/rough-cut-revival/thumb-3.webp', '/house-styles/rough-cut-revival/thumb-4.webp'],
  examplePrompts: ['a lighthouse on a cliff'],
}

describe('validateHouseStyleEntry', () => {
  it('accepts a complete entry', () => {
    expect(validateHouseStyleEntry(valid)).toEqual([])
  })
  it('blocks missing taste profile', () => {
    expect(validateHouseStyleEntry({ ...valid, tasteProfile: '  ' }).join(' ')).toMatch(/taste/i)
  })
  it('blocks versioned model refs and weights-shaped models', () => {
    expect(validateHouseStyleEntry({ ...valid, replicateModel: 'o/m:abc' }).length).toBeGreaterThan(0)
    expect(validateHouseStyleEntry({ ...valid, replicateModel: 'https://x/y/trained_model.tar' }).length).toBeGreaterThan(0)
  })
  it('blocks bad weights url, bad id, empty tags, wrong thumb count', () => {
    expect(validateHouseStyleEntry({ ...valid, weightsUrl: 'https://elsewhere.com/x.tar' }).length).toBeGreaterThan(0)
    expect(validateHouseStyleEntry({ ...valid, id: 'Bad Id!' }).length).toBeGreaterThan(0)
    expect(validateHouseStyleEntry({ ...valid, useCases: [] }).length).toBeGreaterThan(0)
    expect(validateHouseStyleEntry({ ...valid, thumbnails: valid.thumbnails.slice(0, 2) }).length).toBeGreaterThan(0)
  })
})

describe('upsertHouseStyle', () => {
  it('appends new and replaces by replicateModel, sorted by label', () => {
    const other = { ...valid, id: 'azure-bloom', label: 'Azure Bloom', replicateModel: 'finnyjules/jules-azure' }
    let out = upsertHouseStyle([], valid)
    out = upsertHouseStyle(out, other)
    expect(out.map(e => e.id)).toEqual(['azure-bloom', 'rough-cut-revival'])
    const updated = { ...valid, label: 'Rough Cut Revival v2' }
    out = upsertHouseStyle(out, updated)
    expect(out.length).toBe(2)
    expect(out.find(e => e.replicateModel === valid.replicateModel)!.label).toBe('Rough Cut Revival v2')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- house-styles-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the store util**

`frontend/server/utils/houseStylesStore.ts`:

```ts
/** Server-side twin of HouseStyle (server utils must not import from app/). */
export interface HouseStyleEntry {
  id: string
  label: string
  useCases: string[]
  trigger: string
  tasteProfile: string
  replicateModel: string
  weightsUrl: string
  thumbnails: string[]
  examplePrompts: string[]
  suggestedScale?: number
}

const WEIGHTS_TAR_RE = /^https:\/\/replicate\.delivery\/[^/]+\/[^/]+\/trained_model\.tar$/

function isModelRef(value: string): boolean {
  const s = (value || '').trim()
  if (!s || s.includes('://') || s.includes(':')) return false
  const low = s.toLowerCase()
  if (low.endsWith('.safetensors')) return false
  if (low.includes('huggingface.co') || low.includes('civitai.com') || low.startsWith('hf.co/')) return false
  const parts = s.split('/').filter(Boolean)
  return parts.length === 2 || parts.length === 3
}

export function validateHouseStyleEntry(e: unknown): string[] {
  const errors: string[] = []
  const entry = e as Partial<HouseStyleEntry> | null
  if (!entry || typeof entry !== 'object') return ['entry must be an object']
  if (!entry.id || !/^[a-z0-9-]+$/.test(entry.id)) errors.push('id must be kebab-case')
  if (!entry.label?.trim()) errors.push('label required')
  if (!Array.isArray(entry.useCases) || entry.useCases.length === 0) errors.push('at least one use-case tag required')
  if (!entry.trigger?.trim()) errors.push('trigger required')
  if (!entry.tasteProfile || entry.tasteProfile.trim().length < 40)
    errors.push('taste profile required (≥40 chars) — trigger-only styles land weak')
  if (!entry.replicateModel || !isModelRef(entry.replicateModel))
    errors.push('replicateModel must be a bare owner/model ref (no version hash, no URL)')
  if (!entry.weightsUrl || !WEIGHTS_TAR_RE.test(entry.weightsUrl))
    errors.push('weightsUrl must be a replicate.delivery trained_model.tar')
  if (!Array.isArray(entry.thumbnails) || entry.thumbnails.length !== 4)
    errors.push('exactly 4 thumbnails required')
  if (!Array.isArray(entry.examplePrompts) || entry.examplePrompts.length === 0)
    errors.push('at least one example prompt required')
  return errors
}

export function upsertHouseStyle(entries: HouseStyleEntry[], entry: HouseStyleEntry): HouseStyleEntry[] {
  const rest = entries.filter(e => e.replicateModel !== entry.replicateModel)
  return [...rest, entry].sort((a, b) => a.label.localeCompare(b.label))
}
```

- [ ] **Step 4: Run store tests**

Run: `npm run test:unit -- house-styles-store`
Expected: PASS.

- [ ] **Step 5: Implement the publish endpoint + allow-list**

`frontend/server/api/house-styles/publish.post.ts`:

```ts
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { validateHouseStyleEntry, upsertHouseStyle, type HouseStyleEntry } from '../../utils/houseStylesStore'

interface Body {
  entry?: Omit<HouseStyleEntry, 'thumbnails'>
  thumbnails?: string[] // 4 × data:image/webp;base64,...
}

const WEBP_DATA_RE = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/

export default defineEventHandler(async (event) => {
  // Dev-tool only: writes into the repo tree (public/ + app/data/). Pages under
  // /dev are prod-stripped by nuxt.config, but server routes are NOT — guard here.
  if (!import.meta.dev) throw createError({ statusCode: 404, statusMessage: 'Not found' })

  const body = await readBody<Body>(event)
  if (!body?.entry) throw createError({ statusCode: 400, statusMessage: 'entry required' })
  if (!Array.isArray(body.thumbnails) || body.thumbnails.length !== 4)
    throw createError({ statusCode: 400, statusMessage: 'exactly 4 webp thumbnails required' })

  const id = String(body.entry.id || '')
  const entry: HouseStyleEntry = {
    ...body.entry,
    thumbnails: [1, 2, 3, 4].map(n => `/house-styles/${id}/thumb-${n}.webp`),
  }
  const errors = validateHouseStyleEntry(entry)
  if (errors.length) throw createError({ statusCode: 400, statusMessage: errors.join('; ') })

  const thumbDir = path.resolve(process.cwd(), 'public', 'house-styles', id)
  await fs.mkdir(thumbDir, { recursive: true })
  for (let i = 0; i < 4; i++) {
    const m = WEBP_DATA_RE.exec(body.thumbnails[i] || '')
    if (!m) throw createError({ statusCode: 400, statusMessage: `thumbnail ${i + 1} is not a webp data URL` })
    await fs.writeFile(path.join(thumbDir, `thumb-${i + 1}.webp`), Buffer.from(m[1], 'base64'))
  }

  const jsonPath = path.resolve(process.cwd(), 'app', 'data', 'house-styles.json')
  const current = JSON.parse(await fs.readFile(jsonPath, 'utf-8')) as HouseStyleEntry[]
  const next = upsertHouseStyle(current, entry)
  await fs.writeFile(jsonPath, `${JSON.stringify(next, null, 2)}\n`)

  return { ok: true, id, count: next.length }
})
```

In `frontend/server/middleware/comfyui-proxy.ts`, add `'/api/house-styles'` to the `NITRO_API_PREFIXES` array (around line 35, alphabetical placement fine).

- [ ] **Step 6: Verify dev server compiles + smoke the guard**

Run: `npm run dev` (or confirm the running dev server hot-reloads without errors), then:
`curl -s -X POST http://127.0.0.1:3000/api/house-styles/publish -H 'content-type: application/json' -d '{}' | head -c 200`
Expected: a 400 JSON error `entry required` (NOT ComfyUI proxy 404 — that would mean the allow-list edit is missing).

- [ ] **Step 7: Commit**

```bash
git add server/utils/houseStylesStore.ts server/api/house-styles/publish.post.ts server/middleware/comfyui-proxy.ts tests/unit/house-styles-store.unit.spec.ts
git commit -m "feat(styles): dev-guarded house-style publish endpoint + store util"
```

---

### Task 6: `/dev/style-publisher` page

**Files:**
- Create: `frontend/app/pages/dev/style-publisher.vue`

**Interfaces:**
- Consumes: `GET /api/loras-local` → `{ loras: Array<{ filename, name, trigger, aesthetic, kind, model, url, coverUrl }> }`; `PATCH /api/loras-local` body `{ filename, aesthetic }`; `POST /api/inpaint/lora-gen` body `{ name, prompt, aspectRatio, seed }` → `{ images: [dataUrl] }`; `POST /api/cloud-train/aesthetic` body `{ imageDataUrl }` → `{ aesthetic }`; `POST /api/house-styles/publish` (Task 5); `BENCHMARK_SHOTS` (Task 2); `HOUSE_STYLES`, `USE_CASE_TAGS` (Task 1).
- Produces: the publishing workflow. No exports.

**Notes for the implementer:**
- Dev pages are plain `<script setup>` pages (see `pages/dev/model-bakeoff.vue` for the skeleton) — no `definePageMeta`, no auth; prod-stripping is automatic via the `DEV_PAGES` regex in `nuxt.config.ts`.
- The sidecar taste profile is stored under the `aesthetic` key (the PATCH route's canonical field; it deletes legacy `taste_profile` on write). `loras-local` GET already merges both into `aesthetic`.
- `lora-gen` resolves the model from the sidecar by `name` (the filename base) — it needs `filename` minus `.safetensors`, and it 400s unless it matches `/^[a-zA-Z0-9_-]+$/`.
- webp conversion is CLIENT-side (no server encoder exists): draw the returned PNG data URL onto a canvas capped at 640px, `canvas.toBlob('image/webp', 0.85)`.
- Baking 4 thumbs costs real money (~$0.12-0.5/style). Buttons that spend get the pastel AI affordance; never purple.

- [ ] **Step 1: Build the page**

`frontend/app/pages/dev/style-publisher.vue`:

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { HOUSE_STYLES, USE_CASE_TAGS, type UseCaseTag } from '~/data/house-styles'
import { BENCHMARK_SHOTS } from '~/data/house-style-benchmarks'

interface LocalLora {
  filename: string
  name: string
  trigger: string | null
  aesthetic: string | null
  kind: 'character' | 'style' | null
  model: string | null
  url: string | null
  coverUrl: string | null
}

interface Draft {
  useCases: UseCaseTag[]
  examplePrompt: string
  thumbs: string[]        // baked full-res data URLs (png), in BENCHMARK_SHOTS order
  busy: string | null     // 'profile' | 'bake' | 'publish' | null
  error: string | null
  publishedOk: boolean
}

const loras = ref<LocalLora[]>([])
const drafts = ref<Record<string, Draft>>({})
const openFilename = ref<string | null>(null)

const styles = computed(() => loras.value.filter(l => l.kind !== 'character'))

const publishedModels = computed(() => new Set(HOUSE_STYLES.map(s => s.replicateModel)))
function modelBase(l: LocalLora): string { return (l.model || '').split(':')[0] }
function isPublished(l: LocalLora): boolean { return publishedModels.value.has(modelBase(l)) }
function kebab(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
function draftFor(l: LocalLora): Draft {
  if (!drafts.value[l.filename]) {
    const existing = HOUSE_STYLES.find(s => s.replicateModel === modelBase(l))
    drafts.value[l.filename] = {
      useCases: (existing?.useCases as UseCaseTag[]) ?? [],
      examplePrompt: existing?.examplePrompts[0] ?? '',
      thumbs: [],
      busy: null,
      error: null,
      publishedOk: false,
    }
  }
  return drafts.value[l.filename]
}
function genName(l: LocalLora): string { return l.filename.replace(/\.safetensors$/, '') }
function toggleTag(l: LocalLora, tag: UseCaseTag) {
  const d = draftFor(l)
  d.useCases = d.useCases.includes(tag) ? d.useCases.filter(t => t !== tag) : [...d.useCases, tag]
}

async function fetchLoras() {
  const res = await fetch('/api/loras-local')
  const data = await res.json()
  loras.value = data.loras ?? []
}
onMounted(fetchLoras)

/** One cheap sample gen → Qwen aesthetic → PATCH sidecar. */
async function generateProfile(l: LocalLora) {
  const d = draftFor(l)
  d.busy = 'profile'; d.error = null
  try {
    const gen = await fetch('/api/inpaint/lora-gen', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: genName(l), prompt: 'a varied collage of subjects', aspectRatio: '1:1' }),
    })
    if (!gen.ok) throw new Error(`sample gen failed: ${await gen.text()}`)
    const { images } = await gen.json()
    const aes = await fetch('/api/cloud-train/aesthetic', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: images[0] }),
    })
    if (!aes.ok) throw new Error(`aesthetic failed: ${await aes.text()}`)
    const { aesthetic } = await aes.json()
    const patch = await fetch('/api/loras-local', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: l.filename, aesthetic }),
    })
    if (!patch.ok) throw new Error(`sidecar patch failed: ${await patch.text()}`)
    l.aesthetic = aesthetic
  } catch (e: any) { d.error = String(e?.message || e) } finally { d.busy = null }
}

/** Bake the 4 frozen benchmark shots through the style's own model. */
async function bakeThumbs(l: LocalLora) {
  const d = draftFor(l)
  d.busy = 'bake'; d.error = null; d.thumbs = []
  try {
    for (const shot of BENCHMARK_SHOTS) {
      const res = await fetch('/api/inpaint/lora-gen', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: genName(l), prompt: shot.prompt, aspectRatio: shot.aspectRatio, seed: shot.seed }),
      })
      if (!res.ok) throw new Error(`${shot.id} failed: ${await res.text()}`) // break-on-first-failure money guard
      const { images } = await res.json()
      d.thumbs.push(images[0])
    }
  } catch (e: any) { d.error = String(e?.message || e) } finally { d.busy = null }
}

/** Downscale a data URL to ≤640px webp (client-side; no server encoder exists). */
async function toWebp(dataUrl: string, max = 640): Promise<string> {
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl })
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', 0.85))
  if (!blob) throw new Error('webp encode failed')
  return await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(blob)
  })
}

function canPublish(l: LocalLora): boolean {
  const d = draftFor(l)
  return Boolean(
    (l.aesthetic?.trim().length ?? 0) >= 40 && l.trigger?.trim() && modelBase(l) && l.url
    && d.useCases.length > 0 && d.examplePrompt.trim() && d.thumbs.length === 4 && !d.busy,
  )
}

async function publish(l: LocalLora) {
  const d = draftFor(l)
  d.busy = 'publish'; d.error = null
  try {
    const thumbnails = await Promise.all(d.thumbs.map(t => toWebp(t)))
    const res = await fetch('/api/house-styles/publish', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        entry: {
          id: kebab(l.name),
          label: l.name.replace(/_/g, ' '),
          useCases: d.useCases,
          trigger: l.trigger,
          tasteProfile: l.aesthetic,
          replicateModel: modelBase(l),
          weightsUrl: l.url,
          examplePrompts: [d.examplePrompt.trim()],
        },
        thumbnails,
      }),
    })
    if (!res.ok) throw new Error(await res.text())
    d.publishedOk = true
  } catch (e: any) { d.error = String(e?.message || e) } finally { d.busy = null }
}
</script>

<template>
  <div class="min-h-screen bg-neutral-950 text-white/90 p-8">
    <div class="max-w-4xl mx-auto space-y-6">
      <header>
        <h1 class="text-xl font-semibold">Style Publisher</h1>
        <p class="text-sm text-white/50">
          Backfill profile → bake 4 benchmark thumbs → publish into house-styles.json. Review the git diff, then commit.
        </p>
      </header>

      <div v-for="l in styles" :key="l.filename" class="rounded-lg border border-white/10 bg-white/[0.03]">
        <button class="w-full flex items-center gap-3 px-4 py-3 text-left"
          @click="openFilename = openFilename === l.filename ? null : l.filename">
          <img v-if="l.coverUrl" :src="l.coverUrl" class="size-10 rounded object-cover" />
          <div v-else class="size-10 rounded bg-white/10" />
          <div class="flex-1">
            <div class="text-sm font-medium">{{ l.name }}</div>
            <div class="text-xs text-white/40">{{ modelBase(l) || 'no model' }}</div>
          </div>
          <span v-if="isPublished(l) || draftFor(l).publishedOk"
            class="text-xs px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300">published</span>
          <span v-else-if="!l.aesthetic" class="text-xs px-2 py-0.5 rounded bg-amber-500/15 text-amber-300">needs profile</span>
        </button>

        <div v-if="openFilename === l.filename" class="px-4 pb-4 space-y-4 border-t border-white/10 pt-4">
          <!-- Taste profile -->
          <section>
            <div class="flex items-center justify-between">
              <h3 class="text-xs uppercase tracking-wide text-white/40">Taste profile</h3>
              <button class="text-xs px-3 py-1.5 rounded-md pastel-ai" :disabled="draftFor(l).busy !== null"
                @click="generateProfile(l)">
                {{ draftFor(l).busy === 'profile' ? 'Generating…' : (l.aesthetic ? 'Regenerate · ~$0.05' : 'Generate · ~$0.05') }}
              </button>
            </div>
            <p class="mt-1 text-xs text-white/60 whitespace-pre-wrap">{{ l.aesthetic || '— none (required to publish)' }}</p>
          </section>

          <!-- Tags + example prompt -->
          <section class="space-y-2">
            <h3 class="text-xs uppercase tracking-wide text-white/40">Use cases</h3>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="tag in USE_CASE_TAGS" :key="tag"
                class="text-xs px-2 py-1 rounded-full border"
                :class="draftFor(l).useCases.includes(tag)
                  ? 'border-white/60 bg-white/15' : 'border-white/15 text-white/50 hover:bg-white/5'"
                @click="toggleTag(l, tag)">{{ tag }}</button>
            </div>
            <input v-model="draftFor(l).examplePrompt" placeholder="Example prompt (required)"
              class="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm" />
          </section>

          <!-- Thumbnails -->
          <section>
            <div class="flex items-center justify-between">
              <h3 class="text-xs uppercase tracking-wide text-white/40">Benchmark thumbnails</h3>
              <button class="text-xs px-3 py-1.5 rounded-md pastel-ai" :disabled="draftFor(l).busy !== null"
                @click="bakeThumbs(l)">
                {{ draftFor(l).busy === 'bake' ? 'Baking…' : 'Bake 4 thumbs · ~$0.20' }}
              </button>
            </div>
            <div v-if="draftFor(l).thumbs.length" class="mt-2 grid grid-cols-4 gap-2">
              <img v-for="(t, i) in draftFor(l).thumbs" :key="i" :src="t" class="rounded aspect-square object-cover" />
            </div>
          </section>

          <p v-if="draftFor(l).error" class="text-xs text-red-400">{{ draftFor(l).error }}</p>

          <button class="w-full py-2 rounded-md text-sm font-medium bg-emerald-500/90 text-black disabled:opacity-30"
            :disabled="!canPublish(l)" @click="publish(l)">
            {{ draftFor(l).busy === 'publish' ? 'Publishing…' : (isPublished(l) ? 'Republish (updates entry)' : 'Publish to library') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pastel-ai {
  background: linear-gradient(120deg, rgba(167, 243, 208, 0.25), rgba(186, 230, 253, 0.25), rgba(254, 205, 211, 0.25));
  border: 1px solid rgba(255, 255, 255, 0.15);
}
.pastel-ai:disabled { opacity: 0.4; }
</style>
```

- [ ] **Step 2: Verify it compiles and renders**

Run: dev server up → open `http://127.0.0.1:3000/dev/style-publisher` (MUST be `127.0.0.1`, not `localhost` — known IPv6/426 gotcha). Expected: the list of ~47 styles renders with names + model refs, characters absent, "needs profile" badges on unprofiled entries. No paid buttons clicked yet.

- [ ] **Step 3: Typecheck guard**

Run: `npx vue-tsc --noEmit 2>&1 | grep -c error` — compare against the count from before this task (record it first). Expected: no NEW errors.

- [ ] **Step 4: Commit**

```bash
git add app/pages/dev/style-publisher.vue
git commit -m "feat(styles): /dev/style-publisher — profile backfill, thumb bake, publish"
```

---

### Task 7: Style Hub modal + Styles-panel entry point

**Files:**
- Create: `frontend/app/lib/styleHub.ts`
- Create: `frontend/app/components/StyleHubModal.vue`
- Modify: `frontend/app/components/vue-canvas/LoRALibraryPanel.vue` (header button + modal mount)
- Test: `frontend/tests/unit/style-hub.unit.spec.ts`

**Interfaces:**
- Consumes: `HOUSE_STYLES`, `USE_CASE_TAGS`, `houseStyleStyleBlock` (Task 1); `LORA_LIBRARY` + `useCases` (Task 4); `CatalogModal` (props `open/title/items/selectedId/filters/activeFilterId/searchQuery`, emits `close/confirm/update:*`, slots `#card{item,focused}` / `#detail{item}`); `useNodeSearch().addNode(nodeType, { widgetOverrides, propertyOverrides })`.
- Produces:
  - `HubItem = { id: string; label: string; tier: 'house' | 'community'; useCases: string[]; thumbnails: string[]; blurb: string; house?: HouseStyle; community?: LoRALibraryEntry }`
  - `hubItems(): HubItem[]` — house entries first (label-sorted), then community.
  - `hubFilters(items: HubItem[]): { id: string; label: string; count: number }[]` — one per USE_CASE_TAG with count > 0, plus `{ id: 'community', label: 'Community' }`.
  - `filterHubItems(items: HubItem[], filterId: string, query: string): HubItem[]`.
  - `hubNodeOptions(item: HubItem): { widgetOverrides: Record<string, unknown>; propertyOverrides?: Record<string, unknown> }` — house: `{ lora_url: replicateModel, lora_scale? }` + `{ aesthetic: houseStyleStyleBlock(...) }`; community: `{ lora_url: hfPath, prompt?: examplePrompt, lora_scale? }`.
  - `StyleHubModal.vue` — props `{ open: boolean }`, emits `close`.

- [ ] **Step 1: Write the failing test**

`frontend/tests/unit/style-hub.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { hubItems, hubFilters, filterHubItems, hubNodeOptions, type HubItem } from '~/lib/styleHub'

const house: HubItem = {
  id: 'rough-cut-revival', label: 'Rough Cut Revival', tier: 'house',
  useCases: ['illustration', 'poster'], thumbnails: ['/house-styles/rough-cut-revival/thumb-1.webp'],
  blurb: 'This aesthetic converges raw linocut.',
  house: {
    id: 'rough-cut-revival', label: 'Rough Cut Revival', useCases: ['illustration', 'poster'],
    trigger: 'rough_cut_revival', tasteProfile: 'This aesthetic converges raw linocut.',
    replicateModel: 'finnyjules/jules-rough_cut_revival',
    weightsUrl: 'https://replicate.delivery/x/y/trained_model.tar',
    thumbnails: ['/house-styles/rough-cut-revival/thumb-1.webp'], examplePrompts: ['a lighthouse'],
    suggestedScale: 0.9,
  } as any,
}

describe('styleHub', () => {
  it('hubItems puts house before community and maps community entries', () => {
    const items = hubItems()
    const firstCommunity = items.findIndex(i => i.tier === 'community')
    const lastHouse = items.map(i => i.tier).lastIndexOf('house')
    if (firstCommunity >= 0 && lastHouse >= 0) expect(lastHouse).toBeLessThan(firstCommunity)
    expect(items.some(i => i.tier === 'community')).toBe(true)
    for (const i of items) expect(i.id.length).toBeGreaterThan(0)
  })

  it('filters: community filter and tag filter + search', () => {
    const items = hubItems()
    const community = filterHubItems(items, 'community', '')
    expect(community.every(i => i.tier === 'community')).toBe(true)
    const anime = filterHubItems(items, 'anime', '')
    expect(anime.every(i => i.useCases.includes('anime'))).toBe(true)
    expect(filterHubItems(items, 'all', 'ghibsky').some(i => i.label === 'Ghibsky')).toBe(true)
    const filters = hubFilters(items)
    expect(filters.some(f => f.id === 'community')).toBe(true)
    expect(filters.every(f => f.id === 'community' || (f.count ?? 0) > 0)).toBe(true)
  })

  it('hubNodeOptions: house rides lora_url model ref + aesthetic property', () => {
    const opts = hubNodeOptions(house)
    expect(opts.widgetOverrides.lora_url).toBe('finnyjules/jules-rough_cut_revival')
    expect(opts.widgetOverrides.lora_scale).toBe(0.9)
    expect(opts.propertyOverrides!.aesthetic).toBe('This aesthetic converges raw linocut. rough_cut_revival,')
  })

  it('hubNodeOptions: community rides lora_url hfPath + example prompt', () => {
    const item = hubItems().find(i => i.tier === 'community' && i.community?.examplePrompt)!
    const opts = hubNodeOptions(item)
    expect(opts.widgetOverrides.lora_url).toBe(item.community!.hfPath)
    expect(opts.widgetOverrides.prompt).toBe(item.community!.examplePrompt)
    expect(opts.propertyOverrides).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- style-hub`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/styleHub.ts`**

`frontend/app/lib/styleHub.ts`:

```ts
import { HOUSE_STYLES, USE_CASE_TAGS, houseStyleStyleBlock, type HouseStyle } from '~/data/house-styles'
import { LORA_LIBRARY, type LoRALibraryEntry } from '~/data/lora-library'

export interface HubItem {
  id: string
  label: string
  tier: 'house' | 'community'
  useCases: string[]
  thumbnails: string[]
  blurb: string
  house?: HouseStyle
  community?: LoRALibraryEntry
}

export function hubItems(): HubItem[] {
  const house: HubItem[] = [...HOUSE_STYLES]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(s => ({
      id: `house:${s.id}`, label: s.label, tier: 'house',
      useCases: s.useCases, thumbnails: s.thumbnails,
      blurb: s.tasteProfile, house: s,
    }))
  const community: HubItem[] = LORA_LIBRARY.map(e => ({
    id: `community:${e.hfPath}`, label: e.label, tier: 'community',
    useCases: e.useCases ?? [], thumbnails: [],
    blurb: e.blurb, community: e,
  }))
  return [...house, ...community]
}

export function hubFilters(items: HubItem[]) {
  const tagFilters = USE_CASE_TAGS
    .map(tag => ({ id: tag as string, label: tag[0].toUpperCase() + tag.slice(1), count: items.filter(i => i.useCases.includes(tag)).length }))
    .filter(f => f.count > 0)
  return [...tagFilters, { id: 'community', label: 'Community', count: items.filter(i => i.tier === 'community').length }]
}

export function filterHubItems(items: HubItem[], filterId: string, query: string): HubItem[] {
  let out = items
  if (filterId === 'community') out = out.filter(i => i.tier === 'community')
  else if (filterId !== 'all') out = out.filter(i => i.useCases.includes(filterId))
  const q = query.trim().toLowerCase()
  if (q) out = out.filter(i => i.label.toLowerCase().includes(q) || i.blurb.toLowerCase().includes(q))
  return out
}

/** addNode options for "Use style" — both tiers ride FluxLoRARemoteNode.lora_url. */
export function hubNodeOptions(item: HubItem): {
  widgetOverrides: Record<string, unknown>
  propertyOverrides?: Record<string, unknown>
} {
  if (item.tier === 'house' && item.house) {
    const s = item.house
    return {
      widgetOverrides: {
        lora_url: s.replicateModel, // bare owner/model — backend _is_replicate_model_ref runs it directly
        ...(s.suggestedScale != null ? { lora_scale: s.suggestedScale } : {}),
      },
      propertyOverrides: { aesthetic: houseStyleStyleBlock(s) },
    }
  }
  const e = item.community!
  return {
    widgetOverrides: {
      lora_url: e.hfPath,
      ...(e.examplePrompt ? { prompt: e.examplePrompt } : {}),
      ...(e.suggestedScale != null ? { lora_scale: e.suggestedScale } : {}),
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- style-hub`
Expected: PASS.

- [ ] **Step 5: Build `StyleHubModal.vue`**

`frontend/app/components/StyleHubModal.vue`:

```vue
<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import CatalogModal from '~/components/CatalogModal.vue'
import { hubItems, hubFilters, filterHubItems, hubNodeOptions, type HubItem } from '~/lib/styleHub'
import { useNodeSearch } from '~/composables/useNodeSearch'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { addNode } = useNodeSearch()

const all = hubItems()
const activeFilterId = ref('all')
const searchQuery = ref('')
const selectedId = ref<string | null>(null)
const items = computed(() => filterHubItems(all, activeFilterId.value, searchQuery.value))
const filters = computed(() => hubFilters(all))

// Hover-cycle: one shared index ticker; each hovered house card cycles its 4 thumbs.
const hoveredId = ref<string | null>(null)
const cycleIdx = ref(0)
let cycleTimer: ReturnType<typeof setInterval> | null = null
function onCardEnter(item: HubItem) {
  hoveredId.value = item.id
  cycleIdx.value = 0
  if (cycleTimer) clearInterval(cycleTimer)
  cycleTimer = setInterval(() => { cycleIdx.value = (cycleIdx.value + 1) % 4 }, 700)
}
function onCardLeave() {
  hoveredId.value = null
  if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null }
}
onBeforeUnmount(() => { if (cycleTimer) clearInterval(cycleTimer) })
function cardThumb(item: HubItem): string | null {
  if (!item.thumbnails.length) return null
  const idx = hoveredId.value === item.id ? cycleIdx.value % item.thumbnails.length : 0
  return item.thumbnails[idx]
}

function onConfirm(item: HubItem) {
  const opts = hubNodeOptions(item)
  addNode('FluxLoRARemoteNode', opts)
  emit('close')
}
</script>

<template>
  <CatalogModal
    :open="open" title="Style Library" subtitle="House-trained styles + community LoRAs"
    :items="items" :selected-id="selectedId" :filters="filters" :active-filter-id="activeFilterId"
    :search-query="searchQuery" search-placeholder="Search styles…" confirm-label="Use style"
    empty-message="No styles match."
    @close="emit('close')" @confirm="onConfirm"
    @update:selected-id="selectedId = $event"
    @update:active-filter-id="activeFilterId = $event"
    @update:search-query="searchQuery = $event"
  >
    <template #card="{ item }">
      <div class="flex flex-col gap-2" @mouseenter="onCardEnter(item)" @mouseleave="onCardLeave()">
        <img v-if="cardThumb(item)" :src="cardThumb(item)!" class="w-full aspect-square rounded object-cover" />
        <div v-else class="w-full aspect-square rounded bg-white/5 flex items-center justify-center text-xs text-white/40 p-2 text-center">
          {{ item.label }}
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-medium truncate">{{ item.label }}</span>
          <span v-if="item.tier === 'house'" class="text-[10px] px-1 rounded bg-white/15 shrink-0">house</span>
        </div>
      </div>
    </template>

    <template #detail="{ item }">
      <div class="space-y-3">
        <div v-if="item.thumbnails.length" class="grid grid-cols-2 gap-2">
          <img v-for="t in item.thumbnails" :key="t" :src="t" class="rounded aspect-square object-cover" />
        </div>
        <h3 class="text-sm font-semibold">{{ item.label }}</h3>
        <div class="flex flex-wrap gap-1">
          <span v-for="t in item.useCases" :key="t" class="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/60">{{ t }}</span>
        </div>
        <details v-if="item.tier === 'house'" class="text-xs text-white/60">
          <summary class="cursor-pointer text-white/40">Taste profile</summary>
          <p class="mt-1 whitespace-pre-wrap">{{ item.blurb }}</p>
        </details>
        <p v-else class="text-xs text-white/60">{{ item.blurb }}</p>
        <div v-if="item.house?.examplePrompts.length || item.community?.examplePrompt" class="text-xs">
          <div class="text-white/40 mb-1">Example prompt</div>
          <p class="text-white/70 italic">{{ item.house?.examplePrompts[0] ?? item.community?.examplePrompt }}</p>
        </div>
      </div>
    </template>
  </CatalogModal>
</template>
```

- [ ] **Step 6: Wire the Styles-panel entry point**

In `frontend/app/components/vue-canvas/LoRALibraryPanel.vue`:

1. Script: `import StyleHubModal from '~/components/StyleHubModal.vue'` and add `const hubOpen = ref(false)`.
2. Header (around line 266): wrap the right side in a flex group and add a "Browse" button before the close `X`:

```html
<div class="flex items-center gap-1">
  <button
    class="flex items-center gap-1 px-2 h-6 rounded text-xs text-white/60 hover:bg-white/10 hover:text-white/90"
    title="Browse the style library"
    @click="hubOpen = true"
  >
    <LayoutGrid class="size-3.5" />
    Browse
  </button>
  <button class="flex items-center justify-center size-6 rounded hover:bg-white/10 …existing…" @click="$emit('close')">
    <X class="size-4 text-white/60" />
  </button>
</div>
```

(`LayoutGrid` from `lucide-vue-next`, matching the panel's existing icon imports.)
3. Template end (inside root): `<StyleHubModal :open="hubOpen" @close="hubOpen = false" />`.

- [ ] **Step 7: Verify in browser + typecheck**

Dev server → open the Styles dock panel → "Browse" opens the hub. With an empty `house-styles.json`, expect community entries under their tag filters + the Community filter; confirm a community style (e.g. Ghibsky) spawns a `FluxLoRARemoteNode` with `lora_url` = the hfPath and the example prompt filled. Run the vue-tsc baseline check (no NEW errors).

- [ ] **Step 8: Commit**

```bash
git add app/lib/styleHub.ts app/components/StyleHubModal.vue app/components/vue-canvas/LoRALibraryPanel.vue tests/unit/style-hub.unit.spec.ts
git commit -m "feat(styles): Style Hub modal + Styles panel entry point"
```

---

### Task 8: House tab in the node LoRA picker (`LoraGalleryModal`)

**Files:**
- Modify: `frontend/app/components/vue-canvas/LoraGalleryModal.vue`

**Interfaces:**
- Consumes: `HOUSE_STYLES`, `houseStyleStyleBlock` (Task 1). Existing modal internals: `targetWidget` (`'lora_name' | 'lora_a' | 'lora_b'`), the `set(name, value)` widget writer, `isCharacter`, `data.properties`.
- Produces: a "House" tab on style pickers (hidden when `isCharacter`). Confirming a house style writes:
  - single-LoRA picker (`targetWidget === 'lora_name'`): `lora_url` = `replicateModel` (direct-run path), `lora_name` = `'[None]'` (the combo's none sentinel — verify the exact option string in the node's combo options and use that), `properties.aesthetic` = `houseStyleStyleBlock(style)`.
  - multi-LoRA slot B (`targetWidget === 'lora_b'`): `lora_b_url` = `weightsUrl` (the `.tar` — multi-lora loads WEIGHTS, not model refs), `lora_b` = `'[None]'`, `scale_b` = `suggestedScale ?? 0.8`, `properties.aesthetic` = style block.
  - `lora_a` (character slot): House tab never shown (`isCharacter` is true there).

- [ ] **Step 1: Add tab state + house items**

In the script of `LoraGalleryModal.vue`:

```ts
import { HOUSE_STYLES, houseStyleStyleBlock, type HouseStyle } from '~/data/house-styles'

const tab = ref<'yours' | 'house'>('yours')

interface HouseItemLite { id: string; name: string; trigger: string; aesthetic: string; coverUrl: string; houseStyle: HouseStyle }
const houseItems = computed<HouseItemLite[]>(() => HOUSE_STYLES.map(s => ({
  id: `house:${s.id}`, name: s.label, trigger: s.trigger,
  aesthetic: s.tasteProfile, coverUrl: s.thumbnails[0], houseStyle: s,
})))
```

Feed `houseItems` through the same search filter as local items when `tab === 'house'` (mirror the existing name/trigger/aesthetic match). The tab strip renders only when `!isCharacter && HOUSE_STYLES.length > 0`; keep the existing single-grid behavior otherwise. Tab UI: two small buttons above the grid ("Your styles" / "House library") styled like the panel's existing tab pattern in `LoRALibraryPanel.vue`.

- [ ] **Step 2: Branch the confirm handler**

In `onConfirm`, before the existing local-LoRA logic:

```ts
const houseStyle = (item as any).houseStyle as HouseStyle | undefined
if (houseStyle) {
  const urlOverride = targetWidget.value === 'lora_b' ? 'lora_b_url' : 'lora_url'
  set(urlOverride, targetWidget.value === 'lora_b' ? houseStyle.weightsUrl : houseStyle.replicateModel)
  set(targetWidget.value, '[None]') // clear the name combo so the URL drives (verify sentinel string)
  if (targetWidget.value === 'lora_b') set('scale_b', houseStyle.suggestedScale ?? 0.8)
  if (data) data.properties.aesthetic = houseStyleStyleBlock(houseStyle)
  emit('close')
  return
}
```

Also skip the inline PATCH-metadata edit affordances for house items (they have no local sidecar) — gate those buttons on `!item.houseStyle`.

- [ ] **Step 3: Verify in browser**

Dev server → add a `FluxLoRARemoteNode` → click the LoRA picker → House tab appears (once ≥1 style is published; before that, verify the tab is hidden with empty catalog). Select a house style → node's `lora_url` widget holds the model ref, `lora_name` cleared, collapsed Style property populated. Repeat on a `FluxMultiLoRARemoteNode` slot B → `lora_b_url` holds the `.tar`.

- [ ] **Step 4: Typecheck + unit suite**

Run: `npm run test:unit` (full) + vue-tsc baseline check.
Expected: all green, no new type errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/vue-canvas/LoraGalleryModal.vue
git commit -m "feat(styles): House tab in node LoRA picker — model-ref + weights-tar writes"
```

---

### Task 9: Publish the catalog + browser verification pass

This task is operational (uses the tools built above) — it produces the actual committed catalog.

**Files:**
- Modified by tooling: `frontend/app/data/house-styles.json`, `frontend/public/house-styles/**`
- Possibly modified: `<repoRoot>/models/loras/*.json` sidecars (aesthetic backfill via PATCH)

- [ ] **Step 1: Backfill + publish 2 pilot styles end-to-end**

On `http://127.0.0.1:3000/dev/style-publisher`: pick one style WITH an existing profile (e.g. Rough_Cut_Revival) and one WITHOUT (profile backfill exercises the Qwen path). For each: generate profile if missing → tag use cases → example prompt → bake 4 thumbs (~$0.20/style, real money — this is the sanctioned spend) → Publish. Verify `git status` shows `house-styles.json` + 8 webp files; `npm run test:unit -- house-styles` passes (thumbnail-existence test now live).

- [ ] **Step 2: Verify the hub + picker with real entries**

Style Hub: both styles render with hover-cycling thumbs under their tags; "Use style" spawns a configured node. LoRA picker House tab: shows both; confirm writes widgets as specced. Take screenshots of the hub grid + detail pane for the user.

- [ ] **Step 3: One live paid generation per rail (user sign-off gate)**

Run ONE generation through a published entry via `lora_url` model ref (single-LoRA path) and — only with user go-ahead — one stacked run (character LoRA + house style via `lora_b_url` tar). Confirm the style visibly lands (taste profile injected at submit). **STOP and present results to the user before mass-publishing.**

- [ ] **Step 4: Mass-publish the remaining styles**

After sign-off: work through the remaining ~45 styles in the publisher (backfill ~37 profiles, tag, bake, publish). Batch commits every ~10 styles:

```bash
git add app/data/house-styles.json public/house-styles
git commit -m "content(styles): publish house styles batch N"
```

Sidecar changes live outside `frontend/` (`models/loras/*.json`) — they are the dev machine's records, commit only if the repo already tracks them (check `git ls-files ../models/loras | head`; if untracked, leave them).

- [ ] **Step 5: Final full verification**

Run: `npm run test:unit` (entire suite — catalog integrity now validates every published entry + thumbnail on disk). vue-tsc baseline check. Final hub screenshot for the user.

---

## Verification summary

| Check | Command / method |
|---|---|
| Catalog integrity (ids, tags, profiles, refs, thumbs on disk) | `npm run test:unit -- house-styles` |
| Benchmark freeze | `npm run test:unit -- house-style-benchmarks` |
| Store validation/upsert | `npm run test:unit -- house-styles-store` |
| Hub mapping/filter/node-options | `npm run test:unit -- style-hub` |
| Community tags | `npm run test:unit -- lora-library-tags` |
| lora-gen input | `npm run test:unit -- lora-gen-input` |
| No new type errors | `npx vue-tsc --noEmit` vs recorded baseline |
| UI + rails | Browser pass (Task 9) + screenshots; paid gens gated on user |
