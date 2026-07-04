# Start Modal Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `StartProjectModal.vue` as the taxonomy's capability showcase — 8 hero action cards + 6 studio tiles, no search/browse — fed from `ACTION_CATALOG`, with `node-capabilities.ts` deleted (spec: `docs/superpowers/specs/2026-07-03-start-modal-revamp-design.md`).

**Architecture:** Three small data moves, one component rewrite. (1) `action-catalog.ts` gains `source?` metadata, a `modalHero()` derivation, and absorbs the tiny `ARTIFACT_NODE_FOR_SOURCE` map so the pre-wire mechanic survives the catalog switch. (2) The toolbar door's `studiosOptions` array moves to a shared `app/data/studio-options.ts` so the modal and the door render from one list. (3) The modal keeps its shell/card CSS but drops search/groups; emits change from `Capability` to `{ nodeType, source? }` plus a new `studio` event routed to the existing `onLoadOption`.

**Tech Stack:** Nuxt 4 / Vue 3, vitest (`tests/unit/*.unit.spec.ts`), Playwright (`PW_BASE_URL=http://localhost:3000` against the running dev server).

## Global Constraints

- Work on `main`, explicit `git add` paths only, never `-A`; no rebase/reset/stash (parallel sessions may commit).
- **Explicit component imports in vue-canvas/components** — bare tags silently render as unknown elements (Nuxt auto-import is path-prefixed). `StartProjectModal.vue` is imported explicitly in `default.vue:24` already; any component the modal uses must be explicitly imported too.
- Copy per spec §2: headline `What do you want to make?` (unchanged), subline `Pick an action — or skip and build freely.`, studios row label `Craft it by hand`, footer `Skip — start with a blank canvas` (unchanged).
- Pastel dot ONLY on Shot Director + Lip-Sync tiles (gen-pastel snippet, gradient literal as in `SelectionActionChips.vue`); no purple.
- Modal must fit `max-h-[85vh]` without internal scrolling in the normal case (8 + 6 tiles).
- e2e verification is MANDATORY before claiming done (static review missed a broken render in Phase 4).
- Commands run from `/Users/julien/Documents/GitHub/ComfyNext/frontend`.

---

### Task 1: Catalog additions — `source`, `ARTIFACT_NODE_FOR_SOURCE`, `modalHero()` (TDD)

**Files:**
- Modify: `frontend/app/data/action-catalog.ts`
- Test: `frontend/tests/unit/action-catalog.unit.spec.ts`

**Interfaces:**
- Produces (Tasks 3–4 rely on): `type ActionSource = 'image' | 'video' | 'audio' | 'text'`; `ActionEntry.source?: ActionSource`; `const ARTIFACT_NODE_FOR_SOURCE: Record<ActionSource, string>` (= `{ image: 'Image', video: 'Video', audio: 'Audio', text: 'Text' }`); `function modalHero(): { nodeType: string; entry: ActionEntry }[]` returning exactly 8 items.

- [ ] **Step 1: Write the failing tests** — append inside the existing "ACTION_CATALOG integrity" describe block (add `modalHero, ARTIFACT_NODE_FOR_SOURCE` to the spec's import):

```ts
  it('modalHero returns 8 catalog-backed entries with per-domain caps', () => {
    const hero = modalHero()
    expect(hero).toHaveLength(8)
    for (const h of hero) {
      expect(ACTION_CATALOG[h.nodeType], h.nodeType).toBeDefined()
      expect(h.entry).toBe(ACTION_CATALOG[h.nodeType])
    }
    const domains = { image: 3, video: 2, audio: 2, '3d': 1 } as const
    let i = 0
    for (const [domain, cap] of Object.entries(domains)) {
      const expected = HERO_BY_DOMAIN[domain as keyof typeof HERO_BY_DOMAIN].slice(0, cap)
      expect(hero.slice(i, i + cap).map(h => h.nodeType)).toEqual(expected)
      i += cap
    }
  })

  it('every non-create modalHero entry declares a source, and sources map to artifacts', () => {
    for (const h of modalHero()) {
      if (h.entry.intent !== 'create') {
        expect(h.entry.source, `${h.nodeType} needs source`).toBeDefined()
        expect(ARTIFACT_NODE_FOR_SOURCE[h.entry.source!], `${h.nodeType} source maps`).toBeDefined()
      }
    }
  })
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/action-catalog.unit.spec.ts` → FAIL (`modalHero` not exported).

- [ ] **Step 3: Implement** in `action-catalog.ts`:

a. Extend the types (replace the current `ActionEntry` interface):

```ts
export type ActionSource = 'image' | 'video' | 'audio' | 'text'

export interface ActionEntry {
  useCase: string
  model: string
  intent: ActionIntent
  /** Upstream artifact this action consumes (absent = prompt-only). Drives
   *  the start-modal's pre-wired source artifact. Additive metadata — set
   *  where known; only surfaces that render an entry require it. */
  source?: ActionSource
}
```

b. Add `source` to the two hero takes-input entries (formatting matched to the file):

```ts
  EditImageNode:         { useCase: 'Edit an image',                  model: 'Nano Banana 2 / Flux Kontext',             intent: 'edit', source: 'image' },
  LipsyncNode:           { useCase: 'Sync lips to audio',             model: 'sync.so 2-pro',                            intent: 'edit', source: 'video' },
```

c. After `INTENT_ORDER`, add:

```ts
// Source-type → artifact node that supplies it (used to pre-wire a runnable
// graph when a start-modal pick consumes an upstream asset).
export const ARTIFACT_NODE_FOR_SOURCE: Record<ActionSource, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  text: 'Text',
}

// Start-modal hero tier: flatten HERO_BY_DOMAIN with per-domain caps so the
// modal shows 8 cards (2 rows) spanning all media types. Order = domain order.
const MODAL_HERO_CAPS: [ActionDomain, number][] = [
  ['image', 3], ['video', 2], ['audio', 2], ['3d', 1],
]
export function modalHero(): { nodeType: string; entry: ActionEntry }[] {
  return MODAL_HERO_CAPS.flatMap(([domain, cap]) =>
    HERO_BY_DOMAIN[domain].slice(0, cap)
      .filter(nt => ACTION_CATALOG[nt] != null)
      .map(nt => ({ nodeType: nt, entry: ACTION_CATALOG[nt]! })),
  )
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/action-catalog.unit.spec.ts` → all pass (12 tests).

- [ ] **Step 5: Commit**

```bash
git add app/data/action-catalog.ts tests/unit/action-catalog.unit.spec.ts
git commit -m "feat(ia): action-catalog source metadata + modalHero derivation + artifact map"
```

---

### Task 2: Extract shared `studio-options.ts`

**Files:**
- Create: `frontend/app/data/studio-options.ts`
- Modify: `frontend/app/layouts/default.vue` (the `studiosOptions` const, ~line 147–157, and the lucide import line carrying `Shapes, Blend, Aperture, Grid3x3, CaseSensitive`)

**Interfaces:**
- Produces: `export interface StudioOption { label: string; icon: Component; nodeType?: string; special?: string; pastel?: boolean }`; `export const STUDIO_OPTIONS: StudioOption[]` — content identical to today's `studiosOptions` including `SPACE_TYPE_ENABLED` / `KINETIC_ENABLED` gating.

- [ ] **Step 1: Create the module** — `frontend/app/data/studio-options.ts`:

```ts
// Studios — places you open and craft in (IA spec §1: defined by interaction
// model, not AI-ness). Single source for BOTH the toolbar Studios door and
// the start modal's "Craft it by hand" row — they must never drift.
// pastel = the studio bills AI credits when run.
import type { Component } from 'vue'
import { Blend, Aperture, Grid3x3, CaseSensitive, Clapperboard, AudioWaveform } from 'lucide-vue-next'
import { KINETIC_ENABLED } from '~/lib/kineticEnabled'
import { SPACE_TYPE_ENABLED } from '~/lib/spaceTypeEnabled'

export interface StudioOption {
  label: string
  icon: Component
  nodeType?: string
  special?: string
  pastel?: boolean
}

export const STUDIO_OPTIONS: StudioOption[] = [
  ...(SPACE_TYPE_ENABLED ? [{ label: 'Type', icon: CaseSensitive, special: 'space-type' }] : []),
  { label: 'Gradient', icon: Blend, nodeType: 'GradientStudio' },
  { label: 'Shader', icon: Aperture, nodeType: 'ShaderStudio' },
  { label: 'Pattern', icon: Grid3x3, nodeType: 'TextureStudio' },
  ...(KINETIC_ENABLED ? [{ label: 'Slate', icon: Clapperboard, special: 'slate-gallery' }] : []),
  { label: 'Shot Director', icon: Clapperboard, nodeType: 'ShotDirector', pastel: true },
  { label: 'Lip-Sync', icon: AudioWaveform, nodeType: 'LipSyncStudio', pastel: true },
]
```

- [ ] **Step 2: Re-point default.vue** — replace the whole `studiosOptions` const (including its comment block) with:

```ts
// Studios door options — shared with the start modal (app/data/studio-options.ts).
const studiosOptions = STUDIO_OPTIONS
```

Add `import { STUDIO_OPTIONS } from '~/data/studio-options'` next to the other `~/data` imports. Then prune now-unused lucide imports from default.vue's import list — `Blend`, `Aperture`, `Grid3x3`, `CaseSensitive` move out (verify each has no other use in the file before removing; `Shapes`, `Clapperboard`, `AudioWaveform` ARE still used — `Shapes` by the Studios sidebar item, the others by loadSections/sidebar — keep them).

- [ ] **Step 3: Verify + commit** — `grep -c "Blend\|Aperture\|Grid3x3\|CaseSensitive" app/layouts/default.vue` returns 0; toolbar door unaffected (template unchanged — same `studiosOptions` name).

```bash
git add app/data/studio-options.ts app/layouts/default.vue
git commit -m "refactor(ia): extract STUDIO_OPTIONS — shared by toolbar door and start modal"
```

---

### Task 3: Rewrite the modal; re-point the parent; delete `node-capabilities.ts`

**Files:**
- Modify: `frontend/app/components/StartProjectModal.vue` (full rewrite below)
- Modify: `frontend/app/layouts/default.vue` (`onStartModalPick` ~line 270, the `@start` binding ~line 3534, imports ~line 27)
- Delete: `frontend/app/data/node-capabilities.ts`

**Interfaces:**
- Consumes: Task 1's `modalHero`, `ARTIFACT_NODE_FOR_SOURCE`, `ActionSource`; Task 2's `STUDIO_OPTIONS`, `StudioOption`; existing `onLoadOption(opt)` in default.vue (handles `nodeType` / `special: 'space-type'` / `'slate-gallery'`).
- Produces: modal emits `start: [{ nodeType: string; source?: ActionSource }]`, `studio: [StudioOption]`, `skip: []`.

- [ ] **Step 1: Rewrite `StartProjectModal.vue`** — full replacement:

```vue
<script setup lang="ts">
/**
 * "Get Started" modal — the taxonomy's front door, shown on every fresh
 * blank project. Deliberately a CAPABILITY SHOWCASE, not an intent
 * collector: no prompt field (a prompt is untrustworthy before the user
 * knows what the product can do), no long-tail browse (that's the Actions
 * panel's job). 8 hero verbs + 6 studios, one glance, no scrolling.
 *
 * Picking an action drops the node — plus a pre-wired source artifact when
 * the action consumes one (entry.source) — so beginners land on a runnable
 * graph in one click. Studio tiles route through the same handler as the
 * toolbar's Studios door. Skip leaves a blank canvas.
 */
import { X, Image as ImageIcon, Film, Sparkles } from 'lucide-vue-next'
import { modalHero, type ActionSource } from '~/data/action-catalog'
import { STUDIO_OPTIONS, type StudioOption } from '~/data/studio-options'
import { getGeneratorIcon, getModelBrand } from '~/data/generator-icons'

const emit = defineEmits<{
  start: [payload: { nodeType: string; source?: ActionSource }]
  studio: [opt: StudioOption]
  skip: []
}>()

const heroCards = modalHero()

const SOURCE_HINT: Partial<Record<ActionSource, { label: string; icon: any }>> = {
  image: { label: 'from an image', icon: ImageIcon },
  video: { label: 'from a video', icon: Film },
}

function pickAction(nodeType: string, source?: ActionSource) {
  emit('start', { nodeType, source })
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('skip')
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-6" @click.self="emit('skip')">
    <!-- Modal panel -->
    <div class="relative w-[760px] max-w-full max-h-[85vh] flex flex-col bg-[#161616] border border-white/10 rounded-2xl shadow-2xl">
      <!-- Header -->
      <div class="px-8 pt-8 pb-4 shrink-0">
        <button
          class="absolute top-4 right-4 size-7 rounded-md flex items-center justify-center text-white/40 hover:text-white/85 hover:bg-white/[0.06] transition-colors cursor-pointer"
          title="Skip — open a blank canvas"
          @click="emit('skip')"
        >
          <X class="size-4" />
        </button>
        <h2 class="text-[20px] font-medium text-white tracking-[0.1px] mb-1">
          What do you want to make?
        </h2>
        <p class="text-[13px] text-white/45">
          Pick an action — or skip and build freely.
        </p>
      </div>

      <!-- Hero tier -->
      <div class="px-8 grid grid-cols-4 gap-2">
        <button
          v-for="h in heroCards"
          :key="h.nodeType"
          class="group/card flex flex-col items-start gap-2.5 p-3 min-h-[104px] rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/25 text-left transition-colors cursor-pointer"
          @click="pickAction(h.nodeType, h.entry.source)"
        >
          <span class="shrink-0 size-9 rounded-lg bg-white/[0.05] group-hover/card:bg-white/[0.09] flex items-center justify-center transition-colors">
            <component :is="getGeneratorIcon(h.nodeType) || Sparkles" class="size-5 text-white/85" :stroke-width="1.75" />
          </span>
          <div class="flex flex-col min-w-0 w-full">
            <span class="text-[12.5px] text-white/90 leading-tight line-clamp-2">{{ h.entry.useCase }}</span>
            <span class="text-[10.5px] text-white/40 truncate mt-0.5">{{ h.entry.model }}</span>
            <span
              v-if="h.entry.source && SOURCE_HINT[h.entry.source]"
              class="mt-1 inline-flex items-center gap-1 text-[10px] text-white/35"
            >
              <component :is="SOURCE_HINT[h.entry.source]!.icon" class="size-3" :stroke-width="1.75" />
              {{ SOURCE_HINT[h.entry.source]!.label }}
            </span>
          </div>
          <span v-if="getModelBrand(h.nodeType)" class="absolute top-2.5 right-2.5 text-[9px] uppercase tracking-wider text-white/25">
            {{ getModelBrand(h.nodeType) }}
          </span>
        </button>
      </div>

      <!-- Studios row -->
      <div class="px-8 pt-6 pb-2">
        <div class="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-white/40">
          Craft it by hand
        </div>
        <div class="grid grid-cols-6 gap-2">
          <button
            v-for="opt in STUDIO_OPTIONS"
            :key="opt.label"
            class="group/studio relative flex flex-col items-center gap-1.5 py-3 px-1 rounded-xl border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/25 transition-colors cursor-pointer"
            @click="emit('studio', opt)"
          >
            <component :is="opt.icon" class="size-5 text-white/80" :stroke-width="1.75" />
            <span class="text-[11px] text-white/75 leading-tight text-center">{{ opt.label }}</span>
            <span
              v-if="opt.pastel"
              class="gen-pastel absolute top-2 right-2 size-1.5 rounded-full"
              style="--gen-pastel: linear-gradient(90deg, rgba(255,214,231,.85), rgba(207,232,255,.85), rgba(214,255,224,.85), rgba(255,244,204,.85), rgba(231,214,255,.85), rgba(255,214,231,.85));"
              title="Uses AI credits"
            />
          </button>
        </div>
      </div>

      <!-- Footer -->
      <div class="px-8 py-4 shrink-0 flex items-center justify-end">
        <button
          class="text-[12px] text-white/45 hover:text-white/85 transition-colors cursor-pointer"
          @click="emit('skip')"
        >
          Skip — start with a blank canvas
        </button>
      </div>
    </div>
  </div>
</template>
```

Notes: hero buttons need `relative` for the absolute brand chip — add `relative` to the hero button class list. The card grid is 4-wide × 2 rows; studio grid 6-wide × 1 row. Total height fits well under 85vh — verify visually in Task 4.

- [ ] **Step 2: Re-point default.vue**

a. Replace the import at ~line 27:

```ts
import { ARTIFACT_NODE_FOR_SOURCE, type ActionSource } from '~/data/action-catalog'
```

(The `type ActionDomain` import added earlier stays; merge into one import statement from `~/data/action-catalog`.) Delete the `node-capabilities` import entirely.

b. Replace `onStartModalPick` (~line 270):

```ts
function onStartModalPick(payload: { nodeType: string; source?: ActionSource }) {
  const sourceNodeType = payload.source ? ARTIFACT_NODE_FOR_SOURCE[payload.source] : undefined
  startModalTabId.value = null
  // Defer one tick so the modal unmounts before we touch the canvas — keeps
  // any focus/scroll state clean and ensures the canvas is fully mounted.
  nextTick(() => {
    vueCanvasRef.value?.materializeStartGraph?.({
      sourceNodeType,
      generatorNodeType: payload.nodeType,
    })
  })
}

function onStartModalStudio(opt: { label: string; nodeType?: string; special?: string }) {
  startModalTabId.value = null
  nextTick(() => onLoadOption(opt))
}
```

c. At the `<StartProjectModal` mount (~line 3534), add `@studio="onStartModalStudio"` alongside the existing `@start`/`@skip` bindings.

- [ ] **Step 3: Delete the dead catalog** — `grep -rn "node-capabilities" app/ tests/` must show zero remaining consumers, then `git rm app/data/node-capabilities.ts`.

- [ ] **Step 4: Verify** — `npx vitest run tests/unit/action-catalog.unit.spec.ts` green; `npx vue-tsc --noEmit -p . 2>&1 | grep -E "StartProjectModal|node-capabilities|action-catalog|studio-options"` → no hits (repo has ~600 pre-existing unrelated errors; only the touched files must be clean).

- [ ] **Step 5: Commit**

```bash
git add app/components/StartProjectModal.vue app/layouts/default.vue
git rm app/data/node-capabilities.ts
git commit -m "feat(ia): start modal → capability showcase — 8 hero verbs + 6 studios, node-capabilities.ts retired"
```

---

### Task 4: e2e + visual verification (controller)

**Files:**
- Create: `frontend/tests/start-modal.spec.ts`

- [ ] **Step 1: Write the e2e spec** — note it must NOT use `openBlankWorkflow` (that helper skips the modal); it reimplements the open without the skip:

```ts
import { expect, test, type Page } from '@playwright/test'
import { waitForBackend } from './_helpers'

/** Open a fresh blank project and STOP at the Get Started modal. */
async function openToModal(page: Page) {
  await page.addInitScript(() => {
    try { localStorage.setItem('comfynext:Comfy.VueNodes.Enabled', 'true') } catch {}
  })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.reload()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: /^Start a blank project$/ }).click()
  await page.locator('.vue-flow').first().waitFor({ state: 'visible', timeout: 20_000 })
  await expect(page.getByText('What do you want to make?')).toBeVisible({ timeout: 5_000 })
}

test.describe('Start modal — capability showcase', () => {
  test.beforeEach(async ({ page }) => {
    await waitForBackend(page)
    await openToModal(page)
  })

  test('shows 8 hero cards and the studios row', async ({ page }) => {
    await expect(page.getByText('Pick an action — or skip and build freely.')).toBeVisible()
    for (const title of ['Generate an image', 'Edit an image', 'Generate a video', 'Sync lips to audio', 'Generate speech', 'Generate music', 'Generate a 3D model']) {
      await expect(page.getByRole('button', { name: new RegExp(title) }).first()).toBeVisible()
    }
    await expect(page.getByText('Craft it by hand')).toBeVisible()
    for (const studio of ['Gradient', 'Shader', 'Pattern', 'Shot Director', 'Lip-Sync']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${studio}$`) })).toBeVisible()
    }
    // Dead affordances gone: no search box, no long-tail browse.
    await expect(page.getByPlaceholder(/Search starting points/)).toHaveCount(0)
  })

  test('sourced action pick lands a pre-wired 2-node graph', async ({ page }) => {
    await page.getByRole('button', { name: /Edit an image/ }).first().click()
    await expect(page.getByText('What do you want to make?')).toHaveCount(0)
    await expect.poll(async () => page.locator('.vue-flow__node').count()).toBe(2)
    await expect.poll(async () => page.locator('.vue-flow__edge').count()).toBe(1)
  })

  test('studio tile drops the studio node', async ({ page }) => {
    await page.getByRole('button', { name: /^Gradient$/ }).click()
    await expect(page.getByText('What do you want to make?')).toHaveCount(0)
    await expect.poll(async () => page.locator('.vue-flow__node').count()).toBe(1)
  })

  test('skip leaves a blank canvas', async ({ page }) => {
    await page.getByRole('button', { name: /Skip — start with a blank canvas/ }).click()
    await expect(page.getByText('What do you want to make?')).toHaveCount(0)
    await expect(page.locator('.vue-flow__node')).toHaveCount(0)
  })
})
```

- [ ] **Step 2: Run** — `PW_BASE_URL=http://localhost:3000 npx playwright test tests/start-modal.spec.ts` (backend :8188 + dev server :3000 must be up). Expected: 4 passed. Debug with the Phase-4 lessons: overlays intercept corner clicks; prefer role/text locators; unexpected file choosers get swallowed with a `page.on('filechooser')` handler.

- [ ] **Step 3: Visual proof** — screenshot of the open modal (preview tools or Playwright `--headed` screenshot) for the user; confirm no internal scrollbar at default viewport.

- [ ] **Step 4: Commit**

```bash
git add tests/start-modal.spec.ts
git commit -m "test(ia): start-modal e2e — showcase contents, pre-wired pick, studio drop, skip"
```

## Self-review notes

- Spec coverage: §2 layout ✓ (T3 template), §3 data ✓ (T1 + T3 delete; studios shared module T2), §4 interactions ✓ (T3 emits/handlers, pre-wire preserved via ARTIFACT_NODE_FOR_SOURCE), §5 testing ✓ (T1 unit, T4 e2e incl. 2-node pre-wire assertion), §6 deferred items all absent from plan ✓.
- Type consistency: `ActionSource` defined T1, consumed T3 (modal + default.vue); `StudioOption` defined T2, consumed T3; `modalHero()` shape `{ nodeType, entry }` used in T1 tests and T3 template.
- The old modal's `ARTIFACT_NODE_FOR_INPUT` is superseded by `ARTIFACT_NODE_FOR_SOURCE` (same values, minus 'prompt' key) — the only consumer (`onStartModalPick`) is rewritten in T3.
