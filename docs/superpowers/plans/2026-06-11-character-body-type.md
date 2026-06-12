# Character Trainer Body-Type Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the character trainer reproduce body type as well as it reproduces the face, by feeding real photos directly into the training set and guaranteeing full-body coverage in synthetic shots.

**Architecture:** Three changes. (1) The scene list becomes framing-tagged and a quota-based picker guarantees full-body/medium/close-up coverage (close-ups stay co-plurality so face quality holds). (2) The single-reference uploader becomes a small multi-reference set; real photos flagged for inclusion go straight into the dataset, and Ideogram only generates enough synthetic shots to top up to the target count. (3) Character mode trains at LoRA rank 32 for capacity to hold face + body in one trigger token.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript; Vitest for pure-function unit tests (`tests/unit/**/*.unit.spec.ts`, `npm run test:unit`); pure logic lives in `app/data/character-shot-scenes.ts`.

---

## Spec deviation (intentional)

The spec listed `frontend/server/api/cloud-train/start.post.ts:71` for the rank bump. Instead we bump rank **client-side** via a watcher on `trainingKind` (Task 8). Reason: `form.rank` drives both local training ([LoraTrainerSurface.vue:931](../../../frontend/app/components/LoraTrainerSurface.vue)) and the cloud payload ([LoraTrainerSurface.vue:1190](../../../frontend/app/components/LoraTrainerSurface.vue)); a client watcher covers both paths and makes the value visible/overridable in Advanced. The server default of 16 stays as a fallback.

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/app/data/character-shot-scenes.ts` | **(modify)** Framing-tagged scene list; pure functions `pickScenes`, `aspectForFraming`, `syntheticCount`; the `Framing` / `CharacterShotScene` types. Pure TS, no Vue. |
| `frontend/tests/unit/character-shot-scenes.unit.spec.ts` | **(create)** Unit tests for the three pure functions + scene-list invariants. |
| `frontend/app/components/LoraTrainerSurface.vue` | **(modify)** Multi-reference state/UI; rewritten `buildCharacterDataset()`; copy; rank watcher. |

---

## Task 1: Framing-tagged scene list

**Files:**
- Modify: `frontend/app/data/character-shot-scenes.ts`
- Test: `frontend/tests/unit/character-shot-scenes.unit.spec.ts`

- [ ] **Step 1: Write the failing test for scene-list invariants**

Create `frontend/tests/unit/character-shot-scenes.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CHARACTER_SHOT_SCENES, type CharacterShotScene } from '~/data/character-shot-scenes'

const byTier = (t: CharacterShotScene['framing']) =>
  CHARACTER_SHOT_SCENES.filter((s) => s.framing === t)

describe('CHARACTER_SHOT_SCENES', () => {
  it('every entry has a prompt and a valid framing tier', () => {
    for (const s of CHARACTER_SHOT_SCENES) {
      expect(typeof s.prompt).toBe('string')
      expect(s.prompt.length).toBeGreaterThan(0)
      expect(['closeup', 'medium', 'full']).toContain(s.framing)
    }
  })

  it('has enough scenes per tier to fill a 24-shot run without repeats', () => {
    // 24-shot quota: 10 closeup, 8 full, 6 medium (see pickScenes).
    expect(byTier('closeup').length).toBeGreaterThanOrEqual(10)
    expect(byTier('full').length).toBeGreaterThanOrEqual(8)
    expect(byTier('medium').length).toBeGreaterThanOrEqual(6)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- character-shot-scenes`
Expected: FAIL — `CHARACTER_SHOT_SCENES` entries are strings (no `.framing`), import of `CharacterShotScene` type errors / tier filters return 0.

- [ ] **Step 3: Replace the scene list with framing-tagged objects**

Rewrite `frontend/app/data/character-shot-scenes.ts`, replacing the `CHARACTER_SHOT_SCENES` declaration (keep the file's top doc comment, update it to mention tiers). Keep `CHARACTER_SHOT_ASPECTS` as-is.

```ts
export type Framing = 'closeup' | 'medium' | 'full'

export interface CharacterShotScene {
  prompt: string
  framing: Framing
}

export const CHARACTER_SHOT_SCENES: CharacterShotScene[] = [
  // --- close-ups (face large in frame → teaches the FACE) ---
  { prompt: 'close-up portrait, front view, soft window light, plain neutral background', framing: 'closeup' },
  { prompt: 'three-quarter view headshot, natural daylight, shallow depth of field', framing: 'closeup' },
  { prompt: 'profile view, side lighting, dark studio background', framing: 'closeup' },
  { prompt: 'headshot tilted slightly down, even softbox lighting, seamless backdrop', framing: 'closeup' },
  { prompt: 'close-up, soft diffused light, slight smile, beige background', framing: 'closeup' },
  { prompt: 'neutral expression, overhead soft light, white seamless backdrop', framing: 'closeup' },
  { prompt: 'looking up, dramatic rim lighting, dark background', framing: 'closeup' },
  { prompt: 'serious expression, high-contrast black and white, studio', framing: 'closeup' },
  { prompt: 'relaxed portrait, warm window backlight, indoor neutral wall', framing: 'closeup' },
  { prompt: 'close portrait in shade, cool soft light, greenery background', framing: 'closeup' },
  // --- medium / waist-up (some body, still readable face) ---
  { prompt: 'waist-up shot, warm indoor lamp light, cozy interior', framing: 'medium' },
  { prompt: 'medium shot, soft golden indoor light, bookshelf background', framing: 'medium' },
  { prompt: 'smiling, casual snapshot, bright midday sun, park background', framing: 'medium' },
  { prompt: 'laughing candidly, backlit by afternoon sun, outdoors', framing: 'medium' },
  { prompt: 'sitting at a cafe table, window light, blurred interior behind', framing: 'medium' },
  { prompt: 'wearing a casual t-shirt, flat studio lighting, grey backdrop', framing: 'medium' },
  { prompt: 'looking over the shoulder, twilight ambient light, street', framing: 'medium' },
  // --- full / three-quarter body (teaches BODY TYPE / proportions) ---
  { prompt: 'full-body shot standing, golden hour sunlight, urban street background', framing: 'full' },
  { prompt: 'full body walking, cloudy day, wide shot, city sidewalk', framing: 'full' },
  { prompt: 'full-body seated on steps, bright daylight, architectural background', framing: 'full' },
  { prompt: 'dynamic pose mid-stride, motion candid, sunny outdoor plaza', framing: 'full' },
  { prompt: 'three-quarter body turning toward camera, evening light, plain wall', framing: 'full' },
  { prompt: 'full-body standing relaxed, flat studio lighting, grey seamless backdrop', framing: 'full' },
  { prompt: 'full-body leaning against a wall, soft daylight, urban exterior', framing: 'full' },
  { prompt: 'full body standing front-on, even daylight, neutral outdoor background', framing: 'full' },
  { prompt: 'three-quarter body seated on a chair, warm indoor light, simple room', framing: 'full' },
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- character-shot-scenes`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/character-shot-scenes.ts frontend/tests/unit/character-shot-scenes.unit.spec.ts
git commit -m "feat(trainer): tag character shot scenes with framing tiers"
```

---

## Task 2: Quota-based scene picker `pickScenes`

**Files:**
- Modify: `frontend/app/data/character-shot-scenes.ts`
- Test: `frontend/tests/unit/character-shot-scenes.unit.spec.ts`

The picker allocates per tier with close-ups getting rounding priority so they stay co-plurality (preserves face), while guaranteeing body coverage. Allocation: `nClose = round(0.40·count)`, `nFull = round(0.35·count)`, `nMedium = count − nClose − nFull`. Within each tier, selection is spread across the tier (stride sampling) and wraps only if the tier is smaller than needed.

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/unit/character-shot-scenes.unit.spec.ts`:

```ts
import { pickScenes } from '~/data/character-shot-scenes'

const tierCounts = (scenes: { framing: string }[]) => ({
  closeup: scenes.filter((s) => s.framing === 'closeup').length,
  medium: scenes.filter((s) => s.framing === 'medium').length,
  full: scenes.filter((s) => s.framing === 'full').length,
})

describe('pickScenes', () => {
  it('returns exactly `count` scenes', () => {
    for (const c of [4, 8, 12, 16, 24]) {
      expect(pickScenes(c)).toHaveLength(c)
    }
  })

  it('hits the per-tier quotas (close co-plural, full >= ~33%, medium >= ~20%)', () => {
    for (const c of [8, 12, 16, 24]) {
      const t = tierCounts(pickScenes(c))
      expect(t.closeup).toBeGreaterThanOrEqual(t.full) // close-ups never fewer than full
      expect(t.closeup).toBeGreaterThanOrEqual(t.medium)
      expect(t.full).toBeGreaterThanOrEqual(Math.floor(c * 0.3))
      expect(t.medium).toBeGreaterThanOrEqual(Math.floor(c * 0.2))
    }
  })

  it('always includes at least one full-body scene for any positive count', () => {
    for (const c of [1, 2, 3, 4, 16]) {
      expect(pickScenes(c).some((s) => s.framing === 'full')).toBe(true)
    }
  })

  it('spreads selection within a tier rather than taking the first N', () => {
    // 24-shot run needs 10 close-ups; with 10 close-up scenes available it should
    // use distinct prompts (no early-index clustering / no repeats until exhausted).
    const close = pickScenes(24).filter((s) => s.framing === 'closeup')
    expect(new Set(close.map((s) => s.prompt)).size).toBe(close.length)
  })

  it('returns an empty array for count <= 0', () => {
    expect(pickScenes(0)).toEqual([])
    expect(pickScenes(-3)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- character-shot-scenes`
Expected: FAIL — `pickScenes` is not exported.

- [ ] **Step 3: Implement `pickScenes` and the `spread` helper**

Append to `frontend/app/data/character-shot-scenes.ts`:

```ts
/** Pick up to `k` items spread evenly across `pool` (wraps if k > pool.length). */
function spread<T>(pool: T[], k: number): T[] {
  if (k <= 0 || pool.length === 0) return []
  const out: T[] = []
  if (k >= pool.length) {
    // Use all, then wrap from the start to fill the remainder.
    for (let i = 0; i < k; i++) out.push(pool[i % pool.length]!)
    return out
  }
  const stride = pool.length / k
  for (let i = 0; i < k; i++) out.push(pool[Math.floor(i * stride)]!)
  return out
}

/**
 * Choose `count` scenes with guaranteed body coverage. Close-ups stay
 * co-plurality (face quality), full-body is always present (body type),
 * medium fills the middle. Selection is spread within each tier so repeated
 * runs vary instead of always taking the first scenes.
 */
export function pickScenes(count: number): CharacterShotScene[] {
  if (count <= 0) return []
  const closeups = CHARACTER_SHOT_SCENES.filter((s) => s.framing === 'closeup')
  const mediums = CHARACTER_SHOT_SCENES.filter((s) => s.framing === 'medium')
  const fulls = CHARACTER_SHOT_SCENES.filter((s) => s.framing === 'full')

  let nClose = Math.round(count * 0.4)
  let nFull = Math.round(count * 0.35)
  let nMedium = count - nClose - nFull
  if (nMedium < 0) { nClose += nMedium; nMedium = 0 } // pathological clamp
  if (nFull < 1 && count >= 1) { nFull = 1; if (nClose > 0) nClose -= 1; else nMedium -= 1 }

  return [
    ...spread(fulls, nFull),
    ...spread(closeups, nClose),
    ...spread(mediums, nMedium),
  ]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- character-shot-scenes`
Expected: PASS (all `pickScenes` + Task 1 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/character-shot-scenes.ts frontend/tests/unit/character-shot-scenes.unit.spec.ts
git commit -m "feat(trainer): quota-based scene picker guaranteeing body coverage"
```

---

## Task 3: `aspectForFraming` and `syntheticCount`

**Files:**
- Modify: `frontend/app/data/character-shot-scenes.ts`
- Test: `frontend/tests/unit/character-shot-scenes.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `frontend/tests/unit/character-shot-scenes.unit.spec.ts`:

```ts
import { aspectForFraming, syntheticCount } from '~/data/character-shot-scenes'

describe('aspectForFraming', () => {
  it('uses portrait 3:4 for full-body so a standing body is not squashed', () => {
    expect(aspectForFraming('full', 0)).toBe('3:4')
    expect(aspectForFraming('full', 5)).toBe('3:4')
  })
  it('cycles the configured aspects for non-full framings', () => {
    expect(aspectForFraming('closeup', 0)).toBe('1:1')
    expect(aspectForFraming('closeup', 1)).toBe('3:4')
    expect(aspectForFraming('medium', 2)).toBe('4:3')
    expect(aspectForFraming('closeup', 3)).toBe('1:1') // wraps
  })
})

describe('syntheticCount', () => {
  it('tops up to the target after counting real included photos', () => {
    expect(syntheticCount(16, 0)).toBe(16)
    expect(syntheticCount(16, 3)).toBe(13)
  })
  it('never goes negative when real photos meet or exceed the target', () => {
    expect(syntheticCount(16, 16)).toBe(0)
    expect(syntheticCount(16, 20)).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm run test:unit -- character-shot-scenes`
Expected: FAIL — `aspectForFraming` / `syntheticCount` not exported.

- [ ] **Step 3: Implement both functions**

Append to `frontend/app/data/character-shot-scenes.ts`:

```ts
/** Aspect ratio for a generated shot: full-body → portrait 3:4; others cycle. */
export function aspectForFraming(framing: Framing, idx: number): string {
  if (framing === 'full') return '3:4'
  return CHARACTER_SHOT_ASPECTS[idx % CHARACTER_SHOT_ASPECTS.length]!
}

/** How many synthetic shots to generate to reach `datasetCount` given the
 *  number of real reference photos already going into the training set. */
export function syntheticCount(datasetCount: number, realIncluded: number): number {
  return Math.max(0, datasetCount - realIncluded)
}
```

Note: `CHARACTER_SHOT_ASPECTS` already exists in this file (`['1:1', '3:4', '4:3']`); `aspectForFraming` relies on that order for the cycle test.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm run test:unit -- character-shot-scenes`
Expected: PASS (all unit tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/character-shot-scenes.ts frontend/tests/unit/character-shot-scenes.unit.spec.ts
git commit -m "feat(trainer): aspect-by-framing and synthetic top-up helpers"
```

---

## Task 4: Multi-reference state

**Files:**
- Modify: `frontend/app/components/LoraTrainerSurface.vue:215-222` (reference state)

- [ ] **Step 1: Replace the single-reference refs with a reference set**

Replace lines 215-222 (the block starting `const refInputRef` through `const buildError`):

```ts
const refInputRef = ref<HTMLInputElement | null>(null)

// A small set of reference photos. Real ones flagged `includeInTraining` are
// added to the dataset directly (this is what captures true body type);
// Ideogram seeds synthetic variety from them, round-robin (one ref per call).
interface ReferenceItem { file: File; previewUrl: string; includeInTraining: boolean }
const referenceFiles = ref<ReferenceItem[]>([])
const MAX_REFERENCES = 5

const subjectHint = ref('')
const datasetCount = ref(16)
const buildingDataset = ref(false)
const buildProgress = reactive({ done: 0, total: 0 })
const buildError = ref<string | null>(null)

const realIncludedCount = computed(
  () => referenceFiles.value.filter((r) => r.includeInTraining).length,
)
```

- [ ] **Step 2: Update the imports from the scene-data module**

Find the existing import of `CHARACTER_SHOT_SCENES` / `CHARACTER_SHOT_ASPECTS` near the top of `<script setup>` and replace it with:

```ts
import {
  CHARACTER_SHOT_SCENES,
  pickScenes,
  aspectForFraming,
  syntheticCount,
  type CharacterShotScene,
} from '~/data/character-shot-scenes'
```

(`CHARACTER_SHOT_SCENES` is still referenced by `expectedShots`/cost computeds; those get updated in Task 6. `CHARACTER_SHOT_ASPECTS` is no longer imported here — `aspectForFraming` owns it now.)

- [ ] **Step 3: Verify it typechecks (will still have references to old names)**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "LoraTrainerSurface" | head`
Expected: errors only about `referenceFile` / `referencePreview` still used elsewhere (fixed in Tasks 5-8). No errors about the new block itself.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/LoraTrainerSurface.vue
git commit -m "feat(trainer): multi-reference state for character dataset builder"
```

---

## Task 5: Reference picker handler + thumbnail UI

**Files:**
- Modify: `frontend/app/components/LoraTrainerSurface.vue:722-727` (handler), reference UI block (~1542-1609)

- [ ] **Step 1: Replace `onReferencePicked` with a multi-add handler + remove/toggle**

Replace `onReferencePicked` (lines 722-727) with:

```ts
function onReferencePicked(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files ?? [])
    .filter((f) => f.type.startsWith('image/'))
  for (const file of files) {
    if (referenceFiles.value.length >= MAX_REFERENCES) break
    referenceFiles.value.push({
      file,
      previewUrl: URL.createObjectURL(file),
      includeInTraining: true,
    })
  }
  ;(e.target as HTMLInputElement).value = '' // allow re-picking the same file
}

function removeReference(idx: number) {
  const r = referenceFiles.value[idx]
  if (r) URL.revokeObjectURL(r.previewUrl)
  referenceFiles.value.splice(idx, 1)
}
```

- [ ] **Step 2: Make the file input accept multiple**

Find the reference `<input type="file" ...>` (the one wired to `onReferencePicked`, near line 1561's button) and add the `multiple` attribute:

```html
<input ref="refInputRef" type="file" accept="image/*" multiple class="hidden" @change="onReferencePicked" />
```

- [ ] **Step 3: Replace the single-preview tile with a thumbnail row**

In the reference UI block, replace the single preview `<button>` / `<img v-if="referencePreview">` (around lines 1561-1566) with a thumbnail row + add tile:

```html
<div class="flex flex-wrap gap-2">
  <div
    v-for="(r, i) in referenceFiles"
    :key="i"
    class="relative w-20 h-20 rounded-lg overflow-hidden ring-1 ring-white/10 group"
  >
    <img :src="r.previewUrl" class="absolute inset-0 w-full h-full object-cover" />
    <button
      type="button"
      class="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white/90 text-xs leading-none opacity-0 group-hover:opacity-100"
      title="Remove"
      @click="removeReference(i)"
    >×</button>
    <label
      class="absolute bottom-0 inset-x-0 flex items-center gap-1 px-1 py-0.5 bg-black/55 text-[10px] text-white/80"
      title="Include this real photo in the training set"
    >
      <input type="checkbox" v-model="r.includeInTraining" class="scale-75" />
      <span>train</span>
    </label>
  </div>
  <button
    v-if="referenceFiles.length < MAX_REFERENCES"
    type="button"
    class="w-20 h-20 rounded-lg ring-1 ring-dashed ring-white/20 text-white/50 hover:text-white/80 hover:ring-white/40 text-2xl"
    title="Add a reference photo"
    @click="refInputRef?.click()"
  >+</button>
</div>
```

- [ ] **Step 4: Verify typecheck for this block**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "LoraTrainerSurface" | head`
Expected: remaining errors only about `buildCharacterDataset` / `expectedShots` / `regenerateShot` / `buildButtonClass` (Tasks 6-7) — none about `onReferencePicked`, `removeReference`, or the thumbnail markup.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/LoraTrainerSurface.vue
git commit -m "feat(trainer): multi-reference thumbnail picker with per-photo include toggle"
```

---

## Task 6: Top-up build flow

**Files:**
- Modify: `frontend/app/components/LoraTrainerSurface.vue` — `generateCharacterShot` (747-766), `addGeneratedImage` (768-779), `buildCharacterDataset` (781-823), `expectedShots` computed (365-371), `regenerateShot` (826+)

- [ ] **Step 1: Add an `isReference` flag to dataset items + a reference-add helper**

Find the `images.value.push({ ... })` shape used by `addGeneratedImage` (lines 772-777). Add `isReference: false` there, and add a sibling helper that appends a real reference photo. Place the helper directly after `addGeneratedImage`:

```ts
/** Upload a real reference photo and add it to the dataset (not generated). */
async function addReferenceToDataset(file: File) {
  try {
    const filename = await uploadImage(file)
    images.value.push({
      file, filename,
      previewUrl: URL.createObjectURL(file),
      caption: '', captionState: 'idle',
      generated: false, isReference: true, scene: '',
    })
  } catch { /* skip a failed upload */ }
}
```

If the dataset item type is declared explicitly (look for an `interface`/`type` with `generated` + `scene` fields near the top of `<script setup>`), add `isReference?: boolean` to it. If items are pushed as inline object literals only, no type edit is needed.

- [ ] **Step 2: Make `generateCharacterShot` take a scene object + a reference data URL**

Replace `generateCharacterShot` (747-766) with:

```ts
/** Generate one shot from a reference data URL for a given scene. Returns a File or null. */
async function generateCharacterShot(
  refDataUrl: string,
  scene: CharacterShotScene,
  idx: number,
): Promise<File | null> {
  const subject = subjectHint.value.trim()
  const prompt = subject ? `${subject}, ${scene.prompt}` : scene.prompt
  try {
    const res = await fetch('/api/cloud-train/character-shot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        referenceImageDataUrl: refDataUrl,
        prompt,
        aspectRatio: aspectForFraming(scene.framing, idx),
      }),
    })
    if (!res.ok) return null
    const { imageDataUrl } = await res.json() as { imageDataUrl?: string }
    return imageDataUrl ? dataUrlToFile(imageDataUrl, `char_${idx}_${images.value.length}.png`) : null
  } catch {
    return null
  }
}
```

- [ ] **Step 3: Rewrite `buildCharacterDataset` for the top-up flow**

Replace `buildCharacterDataset` (781-823) with:

```ts
async function buildCharacterDataset() {
  if (referenceFiles.value.length === 0 || buildingDataset.value) return
  buildError.value = null

  // Convert every reference to a data URL (capped at 1024px) for Ideogram seeding.
  const refDataUrls: string[] = []
  for (const r of referenceFiles.value) {
    const url = await imageToDataUrl(r.file, 1024)
    if (url) refDataUrls.push(url)
  }
  if (refDataUrls.length === 0) {
    buildError.value = 'Could not read the reference image(s).'
    return
  }

  buildingDataset.value = true

  // 1) Real photos flagged for training go straight into the dataset — this is
  //    what captures true body type. (Index-aligned with referenceFiles.)
  const realIncluded = referenceFiles.value.filter((r) => r.includeInTraining)
  for (const r of realIncluded) await addReferenceToDataset(r.file)

  // 2) Top up with synthetic variety to reach the target count.
  const target = Math.max(4, Math.min(CHARACTER_SHOT_SCENES.length + realIncluded.length, datasetCount.value || 16))
  const scenes = pickScenes(syntheticCount(target, realIncluded.length))

  buildProgress.total = scenes.length
  buildProgress.done = 0
  let made = 0

  // Small concurrency pool; each shot is independent. Seed round-robin across
  // all references (the model takes one per call), so variety uses every angle.
  const CONCURRENCY = 3
  let next = 0
  async function worker() {
    while (next < scenes.length) {
      const i = next++
      const scene = scenes[i]!
      const refUrl = refDataUrls[i % refDataUrls.length]!
      const file = await generateCharacterShot(refUrl, scene, i)
      if (file) { await addGeneratedImage(file, scene.prompt); made++ }
      buildProgress.done++
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, scenes.length || 1) }, worker))

  buildingDataset.value = false
  const total = realIncluded.length + made
  if (total > 0) {
    toast.success(`Added ${total} image${total === 1 ? '' : 's'}`, {
      description: 'Curate (remove any that drifted), then caption & train.',
    })
  } else {
    buildError.value = 'No images were added — check your Replicate token and try again.'
  }
}
```

- [ ] **Step 4: Update `expectedShots` and `regenerateShot` for the new refs**

In the `expectedShots` computed (365-371), replace the `!referenceFile.value` guard and the count expression:

```ts
  if (trainingKind.value !== 'character' || referenceFiles.value.length === 0) return 0
  const target = Math.min(datasetCount.value, CHARACTER_SHOT_SCENES.length + realIncludedCount.value)
  return syntheticCount(target, realIncludedCount.value)
```

In `regenerateShot` (826+), replace the `!referenceFile.value` guard and the re-roll call. Use the first reference as the seed and wrap the scene string in a lookup:

```ts
  if (!img || !img.generated || referenceFiles.value.length === 0) return
  // ... existing `key`/regenerating bookkeeping ...
  const refDataUrl = await imageToDataUrl(referenceFiles.value[0]!.file, 1024)
```

Then where it previously called `generateCharacterShot(refDataUrl, img.scene, ...)`, pass a scene object — reuse the stored prompt with a looked-up framing (default `medium` if not found):

```ts
  const sceneObj: CharacterShotScene =
    CHARACTER_SHOT_SCENES.find((s) => s.prompt === img.scene) ?? { prompt: img.scene ?? '', framing: 'medium' }
  const file = await generateCharacterShot(refDataUrl, sceneObj, idx)
```

- [ ] **Step 5: Verify typecheck + unit tests still green**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "LoraTrainerSurface" | head`
Expected: remaining errors only about `referenceFile`/`referencePreview` in copy/button bindings (Task 7) and the rank watcher (Task 8).
Run: `cd frontend && npm run test:unit -- character-shot-scenes`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/components/LoraTrainerSurface.vue
git commit -m "feat(trainer): real photos into dataset + synthetic top-up build flow"
```

---

## Task 7: Copy, build-button gating, and the full-body hint

**Files:**
- Modify: `frontend/app/components/LoraTrainerSurface.vue` — reference block copy (~1552-1554), build button disabled/class bindings (~1589-1592), cost line (~1554)

- [ ] **Step 1: Update the reference helper copy**

Replace the helper text near line 1552 (the "Drop one clear, front-on photo…" sentence). New copy:

```html
Drop a few photos — at least one clear face close-up and one full-length shot.
We generate <span class="text-white/75">{{ expectedShots }}</span> more to fill out the set,
then add them below to curate &amp; train. ~${{ (expectedShots * 0.08).toFixed(2) }}.
```

(`expectedShots` now returns the synthetic top-up count from Task 6, so the cost line tracks real Replicate spend.)

- [ ] **Step 2: Fix build-button disabled/active bindings**

Replace the `referenceFile`-based bindings on the Build button (~1589-1592) with `referenceFiles.length`:

```html
:class="referenceFiles.length && !buildingDataset
  /* keep the existing active classes here */ : /* keep existing disabled classes */"
:disabled="!referenceFiles.length || buildingDataset"
```

Search the reference block for any other `referenceFile`/`referencePreview` bindings (e.g. line 1797 `v-if="img.generated && referenceFile"`) and change them to `referenceFiles.length`.

- [ ] **Step 3: Add a soft full-body hint computed + render it**

Add this computed near `realIncludedCount`:

```ts
// Nudge: with no real photo flagged for training, body type can only come from
// Ideogram's invention. Non-blocking.
const showBodyHint = computed(
  () => trainingKind.value === 'character'
    && referenceFiles.value.length > 0
    && realIncludedCount.value === 0,
)
```

Render it under the thumbnail row in the reference block:

```html
<p v-if="showBodyHint" class="mt-2 text-[12px] text-amber-300/80">
  Tip: keep at least one real full-length photo set to <span class="font-medium">train</span> so the
  body type is learned from a real shot, not invented.
</p>
```

- [ ] **Step 4: Verify the dev build renders (manual smoke check)**

Run the app per CLAUDE.md (`cd frontend && npm run dev`), open the trainer, switch to Character mode. Confirm: the multi-thumbnail picker accepts several images, the +tile caps at 5, the per-photo "train" toggle works, the cost line tracks the synthetic count, and the amber hint shows only when no photo is set to train.
Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "LoraTrainerSurface" | head`
Expected: no remaining errors except the rank watcher (Task 8) if not yet added — ideally clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/LoraTrainerSurface.vue
git commit -m "feat(trainer): multi-reference copy, button gating, full-body training hint"
```

---

## Task 8: Character-mode LoRA rank 32

**Files:**
- Modify: `frontend/app/components/LoraTrainerSurface.vue` — add a watcher near the `trainingKind` declaration (~206) / `form` (~230)

- [ ] **Step 1: Add a watcher that bumps rank for character mode**

Add after the `form` reactive declaration (after line ~245, once `form` exists):

```ts
// Character LoRAs must hold face + body + hair in one trigger token, so they
// need more capacity than a style. Bump rank to 32 for character mode unless the
// user has already changed it; restore the style default when switching back.
watch(trainingKind, (kind, prev) => {
  if (kind === 'character' && form.rank === 16) form.rank = 32
  else if (kind === 'style' && prev === 'character' && form.rank === 32) form.rank = 16
})
```

Ensure `watch` is imported from `vue` (check the existing `import { ... } from 'vue'` line at the top of `<script setup>`; add `watch` if missing).

- [ ] **Step 2: Verify typecheck is fully clean**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "LoraTrainerSurface"`
Expected: no output (no errors).

- [ ] **Step 3: Manual confirm**

In the running app, toggle Style ↔ Character and open Advanced: rank shows 32 in Character mode, 16 in Style mode; a manual rank edit is not clobbered by toggling.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/LoraTrainerSurface.vue
git commit -m "feat(trainer): train character LoRAs at rank 32 for face+body capacity"
```

---

## Final verification

- [ ] **Step 1: Full unit suite**

Run: `cd frontend && npm run test:unit`
Expected: PASS, including `character-shot-scenes.unit.spec.ts`.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "LoraTrainerSurface\|character-shot-scenes"`
Expected: no output.

- [ ] **Step 3: End-to-end smoke**

In the running app, Character mode: add 2 references (one headshot + one full-body), leave both set to train, set count to 12, Build. Confirm the 2 real photos appear in the dataset immediately, ~10 synthetic shots generate (including visible full-body framings in 3:4), captioning + train proceed as before.
