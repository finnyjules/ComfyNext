# Type Studio Effect Gallery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Type Studio effect dropdown with a `CatalogModal` gallery whose cards show cached default-look thumbnails per effect.

**Architecture:** A memoized thumbnail generator renders each effect once via one shared offscreen `SpaceTypeEngine` → object-URL map. A thin gallery component wraps `CatalogModal`. The editor swaps its `<select>` for a button that opens the gallery.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, Three.js, Vitest.

## Global Constraints

- One transient WebGL context total for thumbnail generation (create → render all → dispose). No live canvases in the grid (context-budget).
- No-WebGL / per-effect failure must degrade gracefully (label-only cards), never throw.
- Reuse `CatalogModal` (props `open/title/subtitle/items/selectedId/searchQuery/searchPlaceholder`; emits `close`/`confirm(item)`/`update:selectedId`/`update:searchQuery`; slots `#card({item})`/`#detail({item})`).
- Picking an effect just sets `effectId`; the existing watcher handles the switch.
- Run tests from `frontend/`: `npx vitest run <path>`. `vue-tsc --noEmit` has a large pre-existing baseline — only confirm no NEW errors in touched files. Commit on `main`; end commit bodies with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## Task 1: Thumbnail generator

**Files:**
- Create: `app/lib/spacetype/thumbnails.ts`
- Test: `frontend/tests/unit/spacetype-thumbnails.unit.spec.ts`

**Interfaces:**
- Consumes: `SpaceTypeEngine` from `./engine`; `SPACE_TYPE_EFFECTS` from `./effects`; `defaultsFromControls` from `./effect`; `defaultSpaceTypeState`, `texOptsFromState`, `ensureSpaceTypeFont`, `type SpaceTypeState` from `./state`; `detectWebGL` from `./webgl`.
- Produces: `effectThumbnails(): Promise<Record<string, string>>` (memoized; `{effectId: objectURL}`), and `__resetThumbnailCache()` (test-only).

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/spacetype-thumbnails.unit.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

beforeEach(() => vi.restoreAllMocks())

describe('effectThumbnails', () => {
  it('resolves to an empty map and is memoized when WebGL is unavailable', async () => {
    vi.resetModules()
    vi.doMock('~/lib/spacetype/webgl', () => ({ detectWebGL: () => false }))
    const mod = await import('~/lib/spacetype/thumbnails')
    const a = mod.effectThumbnails()
    const b = mod.effectThumbnails()
    expect(a).toBe(b) // same memoized promise
    expect(await a).toEqual({})
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-thumbnails.unit.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `thumbnails.ts`**

Create `app/lib/spacetype/thumbnails.ts`:

```ts
import { SpaceTypeEngine } from './engine'
import { SPACE_TYPE_EFFECTS } from './effects'
import { defaultsFromControls } from './effect'
import { defaultSpaceTypeState, texOptsFromState, ensureSpaceTypeFont, type SpaceTypeState } from './state'
import { detectWebGL } from './webgl'

const THUMB_W = 320, THUMB_H = 200, SAMPLE_WORD = 'Type'
let _cache: Promise<Record<string, string>> | null = null

/** Render each effect's default look once (one shared offscreen engine) → cached {id: objectURL}.
 *  Memoized for the session. No WebGL → {} (cards fall back to label-only). */
export function effectThumbnails(): Promise<Record<string, string>> {
  if (!_cache) _cache = generate()
  return _cache
}

async function generate(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  if (!detectWebGL()) return out
  const base = defaultSpaceTypeState()
  await ensureSpaceTypeFont(String(base.params.font))
  const canvas = document.createElement('canvas')
  let engine: SpaceTypeEngine | null = null
  try {
    engine = new SpaceTypeEngine(canvas, {
      effect: SPACE_TYPE_EFFECTS[0]!, width: THUMB_W, height: THUMB_H,
      fps: 30, loopDuration: 6, alpha: false, bgColor: base.bgColor,
    })
    for (const e of SPACE_TYPE_EFFECTS) {
      try {
        const params = defaultsFromControls(e.controls)
        params.text = SAMPLE_WORD
        const state: SpaceTypeState = { ...base, effectId: e.id, params }
        engine.setEffect(e)
        engine.build(params, texOptsFromState(state))
        engine.renderFrame(0, params)
        out[e.id] = URL.createObjectURL(await engine.frameToBlob())
      } catch { /* skip this effect's thumbnail */ }
    }
  } finally {
    engine?.dispose()
  }
  return out
}

/** Test-only: reset the memoized cache. */
export function __resetThumbnailCache(): void { _cache = null }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-thumbnails.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep "spacetype/thumbnails.ts" || echo "(clean)"`
Expected: `(clean)`.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/lib/spacetype/thumbnails.ts frontend/tests/unit/spacetype-thumbnails.unit.spec.ts
git commit -m "feat(space-type): cached effect-thumbnail generator (one shared offscreen engine)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Gallery modal component

**Files:**
- Create: `app/components/vue-canvas/SpaceTypeEffectGalleryModal.vue`

**Interfaces:**
- Consumes: `SPACE_TYPE_EFFECTS` from `~/lib/spacetype/effects`; `effectThumbnails` from `~/lib/spacetype/thumbnails`; the shared `CatalogModal` (auto-imported).
- Produces: a component with prop `selectedId: string` and emits `close`, `select: [id: string]`.

- [ ] **Step 1: Create the component**

Create `app/components/vue-canvas/SpaceTypeEffectGalleryModal.vue`:

```vue
<script setup lang="ts">
// Effect picker for Type Studio — wraps the shared CatalogModal. Cards show a cached
// default-look thumbnail per effect (generated once by effectThumbnails). Picking an
// effect emits `select`; the editor sets effectId and the existing watcher switches.
import { ref, computed, onMounted } from 'vue'
import { SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects'
import { effectThumbnails } from '~/lib/spacetype/thumbnails'

const props = defineProps<{ selectedId: string }>()
const emit = defineEmits<{ close: []; select: [id: string] }>()

const thumbs = ref<Record<string, string>>({})
onMounted(async () => { thumbs.value = await effectThumbnails() })

const searchQuery = ref('')
const draftId = ref(props.selectedId)
const items = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return SPACE_TYPE_EFFECTS
    .map(e => ({ id: e.id, label: e.label }))
    .filter(e => !q || e.label.toLowerCase().includes(q))
})
</script>

<template>
  <CatalogModal
    :open="true"
    title="Pick an effect"
    :subtitle="`${SPACE_TYPE_EFFECTS.length} effects`"
    :items="items"
    :selected-id="draftId"
    :search-query="searchQuery"
    search-placeholder="Search effects…"
    empty-message="No effects match."
    @close="emit('close')"
    @confirm="(it: any) => emit('select', it.id)"
    @update:selected-id="(id: string) => (draftId = id)"
    @update:search-query="(q: string) => (searchQuery = q)"
  >
    <template #card="{ item }">
      <div class="flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-t-lg bg-neutral-950">
        <img v-if="thumbs[(item as any).id]" :src="thumbs[(item as any).id]" :alt="(item as any).label" class="h-full w-full object-cover" />
        <span v-else class="text-[10px] text-white/30">{{ (item as any).label }}</span>
      </div>
      <div class="px-3 py-2">
        <span class="text-[13px] font-medium text-white/90">{{ (item as any).label }}</span>
      </div>
    </template>
    <template #detail="{ item }">
      <div class="space-y-3 p-4">
        <div class="flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-lg bg-neutral-950">
          <img v-if="thumbs[(item as any).id]" :src="thumbs[(item as any).id]" :alt="(item as any).label" class="max-h-full max-w-full" />
          <span v-else class="text-xs text-white/30">{{ (item as any).label }}</span>
        </div>
        <span class="text-sm font-semibold text-white/95">{{ (item as any).label }}</span>
      </div>
    </template>
  </CatalogModal>
</template>
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep "SpaceTypeEffectGalleryModal.vue" || echo "(clean)"`
Expected: `(clean)`. (If `CatalogModal` isn't auto-resolved in the type check, add `import CatalogModal from '~/components/CatalogModal.vue'`.)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeEffectGalleryModal.vue
git commit -m "feat(space-type): effect gallery modal (CatalogModal + cached thumbnails)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire the gallery into the editor

**Files:**
- Modify: `app/components/vue-canvas/SpaceTypeSurface.vue`

**Interfaces:**
- Consumes: `SpaceTypeEffectGalleryModal` (Task 2).
- Produces: the effect `<select>` is replaced by a button opening the gallery; picking sets `effectId`.

- [ ] **Step 1: Import + state + handler**

In `SpaceTypeSurface.vue` script, add the import (near the other component imports):
```ts
import SpaceTypeEffectGalleryModal from './SpaceTypeEffectGalleryModal.vue'
```
Add the ref + handler (near other refs):
```ts
const showEffectGallery = ref(false)
function onPickEffect(id: string) { effectId.value = id; showEffectGallery.value = false }
```

- [ ] **Step 2: Replace the `<select>` with a button**

In the template, the effect picker currently is (around lines 710-713):
```vue
          <label class="mb-1 block text-[11px] text-white/50">Effect</label>
          <select v-model="effectId" class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85">
            <option v-for="e in SPACE_TYPE_EFFECTS" :key="e.id" :value="e.id" class="bg-neutral-900">{{ e.label }}</option>
          </select>
```
Replace the `<select>...</select>` (keep the `<label>`) with:
```vue
          <button type="button" @click="showEffectGallery = true"
                  class="flex w-full items-center justify-between rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85 hover:border-white/25">
            <span class="truncate">{{ effect.label }}</span>
            <span class="ml-2 shrink-0 text-white/40">▾</span>
          </button>
```

- [ ] **Step 3: Mount the gallery modal**

Add near the end of the `#controls` template (or just before `</StudioModalShell>`):
```vue
        <SpaceTypeEffectGalleryModal
          v-if="showEffectGallery"
          :selected-id="effectId"
          @select="onPickEffect"
          @close="showEffectGallery = false"
        />
```
(`CatalogModal` is `fixed`/teleported, so it overlays correctly regardless of nesting.)

- [ ] **Step 4: Typecheck + suite**

Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep "SpaceTypeSurface.vue" | grep -v "(10[0-9]," || echo "(no new errors)"` then `npx vitest run tests/unit/`
Expected: no new errors (known onVibeRevert line ~105 excepted); full suite green.
Manual (needs ComfyUI running): the Effect field is now a button showing the current effect; clicking opens the gallery with a thumbnail per effect; search filters; picking switches the effect and applies its defaults; no "too many contexts" console errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue
git commit -m "feat(space-type): open the effect gallery from the editor (replaces dropdown)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `cd frontend && npm run test:unit` — full suite green (incl. the thumbnails spec).
- [ ] `cd frontend && npx vue-tsc --noEmit` — no new errors in touched files.
- [ ] **In-app:** effect button → gallery → thumbnails render, search works, picking switches the effect; one transient context (no cap errors).

## Notes / deferred

- Categories, default-scene-based thumbnails, animated thumbnails, and object-URL revocation are out of scope (see spec).
