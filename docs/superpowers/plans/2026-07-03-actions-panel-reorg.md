# Actions Panel Reorg (IA Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the Generators panel to "Actions" and reorganize it from provider-first sections (Replicate/BFL/Kling) into a hero tier + intent sections (Create / Edit / Enhance / Analyze), per Phase 1 of `docs/superpowers/specs/2026-07-03-studios-actions-ia-design.md`.

**Architecture:** Extract the use-case metadata out of `GeneratorsPanel.vue` into a new pure-data module `app/data/action-catalog.ts` that adds an `intent` field per node, hero shortlists per domain, and a pure `groupByIntent()` function (unit-testable with vitest, no Vue/fetch dependency). The panel keeps its dynamic `/object_info` fetch but flattens the results into one item list per domain and lets the catalog do the grouping. Provider survives only as the existing brand chip on each card.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, vitest (`npm run test:unit`, tests in `frontend/tests/unit/*.unit.spec.ts`), Playwright for e2e (`frontend/tests/generators.spec.ts`).

## Global Constraints

- Work directly on `main` — do NOT create a branch (user rule).
- `git add` with explicit file paths only — NEVER `git add -A` (user rule).
- No purple/violet accents anywhere (user rule).
- Internal identifiers stay unchanged: panel key `'generators'`, localStorage keys `generators.collapsedSections` and `generators.showLegacy`, component filename `GeneratorsPanel.vue`. Only user-visible copy changes. (Stale provider-based entries in `generators.collapsedSections` are inert under the new `domain:intent` keys — no migration needed.)
- User-visible copy: panel header **Actions**, sidebar button **Actions**, search placeholder **"Search actions…"**, loading/empty/error copy says "actions" not "partner nodes".
- All frontend commands run from `/Users/julien/Documents/GitHub/Sailor/frontend`.

---

### Task 1: `action-catalog.ts` — data + pure grouping (TDD)

**Files:**
- Create: `frontend/app/data/action-catalog.ts`
- Test: `frontend/tests/unit/action-catalog.unit.spec.ts`

**Interfaces:**
- Consumes: nothing (pure data module).
- Produces (Task 2 relies on these exact names):
  - `type ActionDomain = 'image' | 'audio' | 'video' | '3d' | 'text'`
  - `type ActionIntent = 'create' | 'edit' | 'enhance' | 'analyze'`
  - `interface ActionEntry { useCase: string; model: string; intent: ActionIntent }`
  - `const ACTION_CATALOG: Record<string, ActionEntry>` — keyed by nodeType
  - `const DEPRECATED_NODES: Set<string>`
  - `const HERO_BY_DOMAIN: Record<ActionDomain, string[]>`
  - `const INTENT_ORDER: { id: ActionIntent | 'other'; label: string }[]`
  - `function groupByIntent<T extends { nodeType: string; label: string }>(items: T[], heroNodeTypes: string[]): { hero: T[]; sections: { intent: ActionIntent | 'other'; label: string; items: T[] }[] }`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/action-catalog.unit.spec.ts`. Before writing, open `frontend/tests/unit/studio-cascade.unit.spec.ts` and copy its import style for app modules (relative vs alias); the code below assumes relative imports — adjust the import path to match the existing convention if it differs.

```ts
import { describe, it, expect } from 'vitest'
import {
  ACTION_CATALOG, DEPRECATED_NODES, HERO_BY_DOMAIN, INTENT_ORDER, groupByIntent,
} from '../../app/data/action-catalog'

const VALID_INTENTS = ['create', 'edit', 'enhance', 'analyze']

function fake(nodeType: string, label = nodeType) {
  return { nodeType, label }
}

describe('ACTION_CATALOG integrity', () => {
  it('every entry has a valid intent', () => {
    for (const [nodeType, entry] of Object.entries(ACTION_CATALOG)) {
      expect(VALID_INTENTS, `${nodeType} intent "${entry.intent}"`).toContain(entry.intent)
      expect(entry.useCase.length, `${nodeType} useCase`).toBeGreaterThan(0)
    }
  })

  it('every hero nodeType exists in the catalog', () => {
    for (const [domain, nodeTypes] of Object.entries(HERO_BY_DOMAIN)) {
      for (const nt of nodeTypes) {
        expect(ACTION_CATALOG[nt], `${domain} hero ${nt}`).toBeDefined()
      }
    }
  })

  it('deprecated nodes are not in the catalog', () => {
    for (const nt of DEPRECATED_NODES) {
      expect(ACTION_CATALOG[nt], `${nt} is deprecated AND in catalog`).toBeUndefined()
    }
  })

  it('INTENT_ORDER is the four intents then More models', () => {
    expect(INTENT_ORDER.map(s => s.id)).toEqual(['create', 'edit', 'enhance', 'analyze', 'other'])
    expect(INTENT_ORDER[4]!.label).toBe('More models')
  })
})

describe('groupByIntent', () => {
  it('buckets items by intent in fixed section order and drops empty sections', () => {
    const items = [
      fake('UpscaleImageNode'),     // enhance
      fake('GenerateImageNode'),    // create
      fake('EditImageNode'),        // edit
      fake('DescribeImageNode'),    // analyze
    ]
    const { hero, sections } = groupByIntent(items, [])
    expect(hero).toEqual([])
    expect(sections.map(s => s.label)).toEqual(['Create', 'Edit', 'Enhance', 'Analyze'])
    expect(sections[0]!.items.map(i => i.nodeType)).toEqual(['GenerateImageNode'])
  })

  it('unmapped nodes land in a trailing "More models" section', () => {
    const items = [fake('SomeLegacyPartnerNode', 'Kling 3.0'), fake('GenerateImageNode')]
    const { sections } = groupByIntent(items, [])
    expect(sections.map(s => s.label)).toEqual(['Create', 'More models'])
    expect(sections[1]!.items[0]!.nodeType).toBe('SomeLegacyPartnerNode')
  })

  it('hero items follow heroNodeTypes order and are excluded from sections', () => {
    const items = [
      fake('EditImageNode'), fake('GenerateImageNode'), fake('UpscaleImageNode'),
    ]
    const { hero, sections } = groupByIntent(items, ['GenerateImageNode', 'EditImageNode'])
    expect(hero.map(i => i.nodeType)).toEqual(['GenerateImageNode', 'EditImageNode'])
    const sectioned = sections.flatMap(s => s.items.map(i => i.nodeType))
    expect(sectioned).toEqual(['UpscaleImageNode'])
  })

  it('hero nodeTypes absent from items are skipped without error', () => {
    const { hero } = groupByIntent([fake('GenerateImageNode')], ['MissingNode', 'GenerateImageNode'])
    expect(hero.map(i => i.nodeType)).toEqual(['GenerateImageNode'])
  })

  it('sorts section items by display title (useCase when mapped, label otherwise)', () => {
    const items = [
      fake('SketchToImageNode'),   // "Sketch to image"
      fake('GenerateAnimeNode'),   // "Generate an anime image"
      fake('GenerateImageNode'),   // "Generate an image"
    ]
    const { sections } = groupByIntent(items, [])
    expect(sections[0]!.items.map(i => i.nodeType))
      .toEqual(['GenerateAnimeNode', 'GenerateImageNode', 'SketchToImageNode'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/action-catalog.unit.spec.ts`
Expected: FAIL — cannot resolve `../../app/data/action-catalog`.

- [ ] **Step 3: Write the implementation**

Create `frontend/app/data/action-catalog.ts`. The `useCase`/`model` strings are moved **verbatim** from `USE_CASE_BY_NODE` in `GeneratorsPanel.vue:437-488`, each gaining an `intent`; `DEPRECATED_NODES` moves verbatim from `GeneratorsPanel.vue:493-510`.

```ts
/**
 * Action catalog — the Actions panel's organizing metadata.
 *
 * Maps each use-case node to its user-facing title, model subline, and
 * INTENT (create / edit / enhance / analyze). The panel fetches the live
 * node list from /object_info; this file decides how it reads.
 * Keep in sync when new action nodes ship — an unmapped node still shows,
 * but falls into the "More models" section with its raw label.
 */

export type ActionDomain = 'image' | 'audio' | 'video' | '3d' | 'text'
export type ActionIntent = 'create' | 'edit' | 'enhance' | 'analyze'

export interface ActionEntry {
  useCase: string
  model: string
  intent: ActionIntent
}

export const ACTION_CATALOG: Record<string, ActionEntry> = {
  // -- Image · create --------------------------------------------------------
  GenerateImageNode:     { useCase: 'Generate an image',              model: 'Many models · pick in gallery',            intent: 'create' },
  FluxLoRARemoteNode:    { useCase: 'Generate an image with your LoRA', model: 'Flux Dev + LoRA',                        intent: 'create' },
  GenerateAnimeNode:     { useCase: 'Generate an anime image',        model: 'Animagine XL',                             intent: 'create' },
  GenerateEmojiNode:     { useCase: 'Generate an emoji',              model: 'Flux Kontext + Emoji LoRA',                intent: 'create' },
  ConsistentFaceNode:    { useCase: 'Generate a consistent face',     model: 'Ideogram Character',                       intent: 'create' },
  SketchToImageNode:     { useCase: 'Sketch to image',                model: 'Nano Banana',                              intent: 'create' },
  // -- Image · edit -----------------------------------------------------------
  EditImageNode:         { useCase: 'Edit an image',                  model: 'Nano Banana 2 / Flux Kontext',             intent: 'edit' },
  RestyleFromImageNode:  { useCase: 'Restyle from an image',          model: 'Nano Banana / IP-Adapter',                 intent: 'edit' },
  RestyleWithLoRANode:   { useCase: 'Restyle with your style',        model: 'Moondream + Flux LoRA + Nano Banana 2',    intent: 'edit' },
  PersonSwap:            { useCase: 'Swap a person',                  model: 'Nano Banana 2',                            intent: 'edit' },
  PoseMannequin:         { useCase: 'Re-pose a character',            model: 'Nano Banana 2',                            intent: 'edit' },
  RelightNode:           { useCase: 'Relight a photo',                model: 'Nano Banana 2',                            intent: 'edit' },
  ProductShotNode:       { useCase: 'Make a product shot',            model: 'SDXL Ad-Inpaint',                          intent: 'edit' },
  RemoveBackgroundNode:  { useCase: 'Remove background',              model: '851-labs/bg-remover',                      intent: 'edit' },
  LayerizeGraphicNode:   { useCase: 'Layerize a graphic',             model: 'Ideogram Layerize',                        intent: 'edit' },
  SplitPhotoLayersNode:  { useCase: 'Split photo into layers',        model: 'BG Remover + LaMa / Bria Eraser',          intent: 'edit' },
  OutpaintImageNode:     { useCase: 'Expand / outpaint an image',     model: 'Flux Fill / Bria Expand',                  intent: 'edit' },
  // -- Image · enhance --------------------------------------------------------
  UpscaleImageNode:      { useCase: 'Upscale an image',               model: 'Clarity',                                  intent: 'enhance' },
  RestorePhotoNode:      { useCase: 'Restore an old photo',           model: 'Flux Kontext · Restore',                   intent: 'enhance' },
  FixFacesNode:          { useCase: 'Fix faces in a photo',           model: 'CodeFormer',                               intent: 'enhance' },
  // -- Image · analyze --------------------------------------------------------
  DescribeImageNode:     { useCase: 'Describe an image',              model: 'Moondream 2',                              intent: 'analyze' },
  ExtractTextNode:       { useCase: 'Extract text from image',        model: 'ByteDance Dolphin (OCR)',                  intent: 'analyze' },
  FindObjectsNode:       { useCase: 'Find objects in an image',       model: 'YOLO-World',                               intent: 'analyze' },
  // -- Video -------------------------------------------------------------------
  GenerateVideoNode:     { useCase: 'Generate a video',               model: 'Seedance / Veo 3 / Kling',                 intent: 'create' },
  LipsyncNode:           { useCase: 'Sync lips to audio',             model: 'sync.so 2-pro',                            intent: 'edit' },
  EnhanceVideoNode:      { useCase: 'Enhance a video',                model: 'Topaz',                                    intent: 'enhance' },
  DescribeVideoNode:     { useCase: 'Describe a video',               model: 'Gemini 2.5 Flash',                         intent: 'analyze' },
  // -- Audio -------------------------------------------------------------------
  GenerateMusicNode:     { useCase: 'Generate music',                 model: 'MusicGen',                                 intent: 'create' },
  GenerateSpeechNode:    { useCase: 'Generate speech',                model: 'MiniMax Speech-02 HD',                     intent: 'create' },
  CloneSingingVoiceNode: { useCase: 'Clone a singing voice',          model: 'RVC',                                      intent: 'edit' },
  TranscribeAudioNode:   { useCase: 'Transcribe audio',               model: 'Whisper',                                  intent: 'analyze' },
  IdentifySpeakersNode:  { useCase: 'Identify speakers in audio',     model: 'Whisper Diarization',                      intent: 'analyze' },
  // -- 3D ----------------------------------------------------------------------
  Generate3DNode:        { useCase: 'Generate a 3D model',            model: 'Hunyuan3D 2',                              intent: 'create' },
  // -- Text / LLM ---------------------------------------------------------------
  ChatLLMNode:           { useCase: 'Chat with an LLM',               model: 'GPT-5 / Claude / Gemini',                  intent: 'create' },
  BrainstormIdeasNode:   { useCase: 'Brainstorm ideas',               model: 'GPT-5 mini',                               intent: 'create' },
  ImprovePromptNode:     { useCase: 'Improve a prompt',               model: 'GPT-5 nano',                               intent: 'edit' },
  TranslateTextNode:     { useCase: 'Translate text',                 model: 'Gemini 3 Flash',                           intent: 'edit' },
  RewriteToneNode:       { useCase: 'Rewrite in a tone',              model: 'Claude 4.5 Haiku',                         intent: 'edit' },
  SummarizeTextNode:     { useCase: 'Summarize text',                 model: 'Gemini 3 Flash',                           intent: 'analyze' },
  ReasonStepByStepNode:  { useCase: 'Think step by step',             model: 'DeepSeek R1',                              intent: 'analyze' },
}

// Per-model classes still registered server-side for saved-workflow
// back-compat, but hidden from the panel — use-case nodes are the front door.
export const DEPRECATED_NODES = new Set<string>([
  'FluxProRemoteNode',
  'IdeogramV3TurboRemoteNode',
  'FluxKontextRemoteNode',
  'ClarityUpscaleRemoteNode',
  'RemoveBackgroundRemoteNode',
  'RestorePhotoRemoteNode',
  'CodeformerRemoteNode',
  'DescribeImageRemoteNode',
  'Seedance2RemoteNode',
  'Veo3RemoteNode',
  'KlingVideoRemoteNode',
  'LipsyncRemoteNode',
  'WhisperRemoteNode',
  'MusicGenRemoteNode',
  'MiniMaxSpeechRemoteNode',
  'Hunyuan3DRemoteNode',
])

// Hero tier — the 1–4 highest-frequency actions per domain tab, pinned above
// the intent sections and excluded from them. Order here = display order.
export const HERO_BY_DOMAIN: Record<ActionDomain, string[]> = {
  image: ['GenerateImageNode', 'FluxLoRARemoteNode', 'EditImageNode', 'UpscaleImageNode'],
  video: ['GenerateVideoNode', 'LipsyncNode', 'EnhanceVideoNode'],
  audio: ['GenerateSpeechNode', 'GenerateMusicNode', 'TranscribeAudioNode'],
  '3d':  ['Generate3DNode'],
  text:  ['ChatLLMNode', 'ImprovePromptNode'],
}

export const INTENT_ORDER: { id: ActionIntent | 'other'; label: string }[] = [
  { id: 'create',  label: 'Create' },
  { id: 'edit',    label: 'Edit' },
  { id: 'enhance', label: 'Enhance' },
  { id: 'analyze', label: 'Analyze' },
  { id: 'other',   label: 'More models' },
]

export interface ActionSection<T> {
  intent: ActionIntent | 'other'
  label: string
  items: T[]
}

/**
 * Split a flat item list into (hero, intent sections). Pure: no Vue, no I/O.
 * - hero follows heroNodeTypes order; missing types are skipped
 * - hero items never repeat in the sections below
 * - unmapped nodeTypes fall into 'other' ("More models"), always last
 * - empty sections are dropped; items sort by display title
 */
export function groupByIntent<T extends { nodeType: string; label: string }>(
  items: T[],
  heroNodeTypes: string[],
): { hero: T[]; sections: ActionSection<T>[] } {
  const heroSet = new Set(heroNodeTypes)
  const hero = heroNodeTypes
    .map(nt => items.find(it => it.nodeType === nt))
    .filter((it): it is T => it != null)

  const buckets = new Map<ActionIntent | 'other', T[]>()
  for (const it of items) {
    if (heroSet.has(it.nodeType)) continue
    const intent = ACTION_CATALOG[it.nodeType]?.intent ?? 'other'
    const bucket = buckets.get(intent)
    if (bucket) bucket.push(it)
    else buckets.set(intent, [it])
  }

  const title = (it: T) => ACTION_CATALOG[it.nodeType]?.useCase ?? it.label
  return {
    hero,
    sections: INTENT_ORDER
      .map(({ id, label }) => ({
        intent: id,
        label,
        items: (buckets.get(id) ?? []).sort((a, b) => title(a).localeCompare(title(b))),
      }))
      .filter(s => s.items.length > 0),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/action-catalog.unit.spec.ts`
Expected: PASS (all 9 tests).

- [ ] **Step 5: Commit**

```bash
git add app/data/action-catalog.ts tests/unit/action-catalog.unit.spec.ts
git commit -m "feat(ia): action catalog — intent metadata + hero tier + pure grouping"
```

---

### Task 2: Rework `GeneratorsPanel.vue` — flat fetch, hero tier, intent sections, copy rename

**Files:**
- Modify: `frontend/app/components/vue-canvas/GeneratorsPanel.vue`

**Interfaces:**
- Consumes from Task 1: `ACTION_CATALOG`, `DEPRECATED_NODES`, `HERO_BY_DOMAIN`, `INTENT_ORDER` (via `groupByIntent`'s section labels), `groupByIntent`, `ActionDomain`, `ActionSection`.
- Produces: no exports (leaf component). The panel's DOM must satisfy the Task 3 Playwright assertions: header text `Actions`, section headers `Create`/`Edit`/`Enhance`/`Analyze`, hero tiles with `.line-clamp-2` titles.

All edits below are within `GeneratorsPanel.vue`. Line numbers refer to the file as of commit `067900ed3`.

- [ ] **Step 1: Update the file-header doc comment (lines 1–10)**

Replace the comment block with:

```ts
/**
 * Actions panel — AI-driven verbs (generate / edit / enhance / analyze),
 * fetched live from /object_info (`api node/<domain>/<provider>` categories)
 * so new partner nodes appear automatically.
 *
 * Organization is intent-first (see ~/data/action-catalog.ts): a pinned hero
 * tier of the highest-frequency actions, then Create / Edit / Enhance /
 * Analyze sections. Provider is a detail on the card (brand chip), never the
 * grouping — users pick by what they want done, not by whose API runs it.
 */
```

- [ ] **Step 2: Import the catalog; delete the moved data**

Add to the imports (after the `getGeneratorIcon` import, line 21):

```ts
import {
  ACTION_CATALOG, DEPRECATED_NODES, HERO_BY_DOMAIN, groupByIntent,
  type ActionDomain, type ActionSection,
} from '~/data/action-catalog'
```

Then delete from this file:
- the whole `USE_CASE_BY_NODE` block (lines 430–488 incl. its comment),
- the whole `DEPRECATED_NODES` block (lines 490–510 incl. comment),
- and replace `useCaseFor` (lines 512–514) with:

```ts
function useCaseFor(item: PartnerNode): { useCase: string; model: string } | null {
  return ACTION_CATALOG[item.nodeType] ?? null
}
```

Replace the local domain type (line 43) with an alias so every existing `Domain` reference keeps compiling:

```ts
type Domain = ActionDomain
```

- [ ] **Step 3: Flatten the fetch — items, not provider sections**

Add `domain` to `PartnerNode` (line 44):

```ts
interface PartnerNode {
  nodeType: string
  label: string
  description: string
  provider: string
  domain: Domain
  price: string | null
  priceSuffix: string | null
  priceApprox: boolean
  priceVaries: boolean
}
```

Delete the `ProviderSection` interface (lines 122–126). Replace the state + loader (lines 141–193) with a flat list (same fetch, same filters, no grouping/sorting — the catalog sorts):

```ts
const allItems = ref<PartnerNode[]>([])
const loading = ref(true)
const fetchError = ref<string | null>(null)

async function loadPartnerNodes() {
  loading.value = true
  fetchError.value = null
  try {
    const res = await fetch('/object_info')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const info = await res.json() as Record<string, any>
    const items: PartnerNode[] = []
    for (const [nodeType, node] of Object.entries(info)) {
      const cat = (node?.category || '') as string
      if (!cat.startsWith('api node/')) continue
      if (DEPRECATED_NODES.has(nodeType)) continue  // hidden but still loadable in old workflows
      const parts = cat.split('/')
      // Shape: api node / <domain> / <provider>
      const domain = parts[1] as Domain | undefined
      const provider = parts[2] || 'Other'
      if (!domain || !['image', 'audio', 'video', '3d', 'text'].includes(domain)) continue
      const p = parsePrice(node?.price_badge)
      items.push({
        nodeType,
        label: node?.display_name || nodeType,
        description: (node?.description || '').split('\n')[0]!.slice(0, 200),
        provider,
        domain,
        price: p.price,
        priceSuffix: p.suffix,
        priceApprox: p.approx,
        priceVaries: p.varies,
      })
    }
    allItems.value = items
  } catch (e: any) {
    fetchError.value = e?.message || 'failed to load actions'
    allItems.value = []
  } finally {
    loading.value = false
  }
}
onMounted(loadPartnerNodes)
```

- [ ] **Step 4: Re-point counts, filtering, and collapse state at intents**

Replace `domainItemCount` (lines 200–204) and `legacyCountForDomain` (lines 219–223):

```ts
function domainItemCount(d: Domain): number {
  return allItems.value.filter(it => it.domain === d).length
}
```

```ts
function legacyCountForDomain(d: Domain): number {
  return allItems.value
    .filter(it => it.domain === d && isLegacyProvider(it.provider))
    .length
}
```

Replace `visibleSections` (lines 225–241) with the grouped computed. Note the two behavior details: the hero tier is suppressed while searching (search results should be one flat, complete grouping), and the use-case title joins the search haystack (users type "upscale", not "Clarity"):

```ts
const visibleGroups = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  const items = allItems.value
    .filter(it => it.domain === activeDomain.value)
    .filter(it => showLegacy.value || !isLegacyProvider(it.provider))
    .filter(it => !q
      || it.label.toLowerCase().includes(q)
      || it.description.toLowerCase().includes(q)
      || it.provider.toLowerCase().includes(q)
      || it.nodeType.toLowerCase().includes(q)
      || (ACTION_CATALOG[it.nodeType]?.useCase.toLowerCase().includes(q) ?? false))
  return groupByIntent(items, q ? [] : HERO_BY_DOMAIN[activeDomain.value])
})
```

Replace the section-key trio (lines 257–271) — collapse keys become `domain:intent` (stale provider keys in localStorage simply never match; leave the storage key name alone):

```ts
function sectionKey(s: ActionSection<PartnerNode>): string {
  return `${activeDomain.value}:${s.intent}`
}
function isCollapsed(s: ActionSection<PartnerNode>): boolean {
  if (searchQuery.value.trim()) return false
  return collapsedKeys.value.has(sectionKey(s))
}
function toggleSection(s: ActionSection<PartnerNode>) {
  const key = sectionKey(s)
  const next = new Set(collapsedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsedKeys.value = next
  saveCollapsed()
}
```

- [ ] **Step 5: Template — rename copy, add hero grid, switch sections to intents**

Copy renames (exact strings):
- Line 523: `Generators` → `Actions`
- Line 541 placeholder: `Search partner nodes…` → `Search actions…`
- Line 600 loading: `Loading partner nodes…` → `Loading actions…`
- Line 603 error: `Couldn't load partner nodes:` → `Couldn't load actions:`
- Line 610 empty-search: `No partner nodes match` → `No actions match`
- Line 616 empty: `No partner nodes in this category.` → `No actions in this category.`

In the content area, insert the hero grid **between** the empty-state `div` (ends line 618) and the section loop (starts line 620). Same handlers and icon treatment as the list rows, vertical tile layout, price chip pinned top-right:

```html
<!-- Hero tier — highest-frequency actions, pinned above the intent sections.
     Hidden while searching (search shows one flat grouping). -->
<div v-if="visibleGroups.hero.length" class="px-2 pt-2 grid grid-cols-2 gap-1.5">
  <button
    v-for="item in visibleGroups.hero"
    :key="item.nodeType"
    draggable="true"
    class="relative group flex flex-col items-start gap-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.09] border border-white/[0.06] hover:border-white/15 transition-colors cursor-grab active:cursor-grabbing px-2.5 py-2.5 text-left"
    :title="`${item.label} (${item.nodeType}) — click to add, or drag onto canvas`"
    @click="addNode(item.nodeType)"
    @dragstart="(e) => onCardDragStart(e, item)"
    @mouseenter="(e) => onCardEnter(e, item)"
    @mouseleave="onCardLeave"
  >
    <div
      class="relative size-9 rounded-md flex items-center justify-center shrink-0 ring-1 ring-white/10"
      :class="getGeneratorIcon(item.nodeType) || hasComfyBrandIcon(item.provider) ? 'bg-white/[0.04]' : ''"
      :style="getGeneratorIcon(item.nodeType) || hasComfyBrandIcon(item.provider)
        ? {}
        : { backgroundColor: providerColor(item.provider).bg, color: providerColor(item.provider).fg }"
    >
      <component
        v-if="getGeneratorIcon(item.nodeType)"
        :is="getGeneratorIcon(item.nodeType)"
        class="size-5 text-white/85"
        :stroke-width="1.75"
      />
      <span
        v-else-if="hasComfyBrandIcon(item.provider)"
        :class="[comfyBrandIconClass(item.provider), isComfyMonoIcon(item.provider) ? 'bg-white' : '']"
        class="size-5"
      />
      <component
        v-else
        :is="providerIcon(item.provider, item.domain)"
        class="size-4"
        :stroke-width="1.75"
      />
    </div>
    <span class="text-[12px] text-white/90 group-hover:text-white leading-tight line-clamp-2 transition-colors">
      {{ useCaseFor(item)?.useCase ?? item.label }}
    </span>
    <span
      v-if="item.price"
      class="absolute top-1.5 right-1.5 text-[9px] tabular-nums leading-none px-1 py-0.5 rounded bg-amber-500/15 text-amber-200/90 border border-amber-500/15"
    >{{ item.priceApprox ? '~' : '' }}{{ item.price }}</span>
  </button>
</div>
```

Then rework the section loop (lines 620–633): iterate `visibleGroups.sections`, header shows the intent label instead of the provider name. Only the loop line and the header span change — the row markup inside (lines 634–712) stays byte-identical except `section.domain` → `item.domain` on the fallback provider-icon line (~671):

```html
<div v-for="section in visibleGroups.sections" :key="sectionKey(section)" class="px-2 pt-2">
  <button
    class="w-full flex items-center justify-between px-1 pb-1.5 group cursor-pointer"
    @click="toggleSection(section)"
  >
    <span class="text-[10px] font-semibold uppercase tracking-[0.08em] text-white/40 group-hover:text-white/65 transition-colors">
      {{ section.label }}
      <span class="ml-1 text-white/25 normal-case tracking-normal">{{ section.items.length }}</span>
    </span>
    <ChevronDown
      class="size-3 text-white/30 group-hover:text-white/55 transition-all"
      :class="isCollapsed(section) ? '-rotate-90' : ''"
    />
  </button>
  <!-- existing rows div (lines 634-712) unchanged, except: -->
  <!--   :is="providerIcon(item.provider, section.domain)"  →  :is="providerIcon(item.provider, item.domain)" -->
</div>
```

Also fix the hover-preview Teleport (line 751): `providerIcon(hoveredItem.provider, activeDomain)` still compiles (activeDomain still exists) — leave as is.

- [ ] **Step 6: Type-check and unit-test**

Run: `npx nuxt typecheck 2>&1 | tail -20` (if the project has no typecheck script, `npx vue-tsc --noEmit -p .` — use whichever the repo supports; skip gracefully if neither is configured and rely on the dev-server overlay in Task 4)
Expected: no new errors in `GeneratorsPanel.vue`.

Run: `npm run test:unit -- tests/unit/action-catalog.unit.spec.ts`
Expected: PASS (unchanged).

- [ ] **Step 7: Commit**

```bash
git add app/components/vue-canvas/GeneratorsPanel.vue
git commit -m "feat(ia): Actions panel — hero tier + intent sections replace provider grouping"
```

---

### Task 3: Sidebar rename + Playwright spec update

**Files:**
- Modify: `frontend/app/layouts/default.vue:91`
- Modify: `frontend/tests/generators.spec.ts`

**Interfaces:**
- Consumes: Task 2's DOM (header `Actions`, intent section headers, hero tiles).
- Produces: nothing downstream.

- [ ] **Step 1: Rename the sidebar button label**

In `frontend/app/layouts/default.vue` line 91, change only the label (icon, panel key, and grouping comment stay):

```ts
{ label: 'Actions', icon: WandSparkles, panel: 'generators', dividerBefore: true },
```

- [ ] **Step 2: Sweep for other user-visible "Generators" strings**

Run: `grep -rn --include='*.vue' --include='*.ts' -E "['\">]Generators?['\"< ]" app/ | grep -v -i "generatorsPanel\|generator-icons\|panel === 'generators'\|panel: 'generators'\|'generators\."`
For each hit, change **display strings only** (labels, titles, aria/tooltips) from "Generators" to "Actions". Do not rename files, component names, panel keys, storage keys, or CSS classes. If a hit is ambiguous (e.g. copy that means "generator nodes" generically), leave it and note it in the commit message.

- [ ] **Step 3: Update the Playwright spec to the new UI**

In `frontend/tests/generators.spec.ts`:

a. Both `page.getByRole('button', { name: /^Generators$/ })` calls (lines 44 and 63) become:

```ts
await page.getByRole('button', { name: /^Actions$/ }).click()
```

b. Replace the first test (lines 43–60) — it asserted `.line-clamp-2` card titles under the old layout; now hero tiles use `.line-clamp-2` and section rows use `truncate` spans, so assert by text within the panel plus the new section headers:

```ts
test('panel shows hero tier + intent sections on the image tab', async ({ page }) => {
  await page.getByRole('button', { name: /^Actions$/ }).click()
  const panel = page.locator('div.bg-\\[\\#1a1a1a\\]\\/95').first()
  await expect(panel).toBeVisible({ timeout: 5_000 })

  // Hero tier (image tab is default): the pinned high-frequency actions.
  const hero = panel.locator('.line-clamp-2')
  await expect(hero.filter({ hasText: /^Generate an image$/ })).toBeVisible()
  await expect(hero.filter({ hasText: /^Edit an image$/ })).toBeVisible()
  await expect(hero.filter({ hasText: /^Upscale an image$/ })).toBeVisible()

  // Intent section headers replace provider names.
  for (const label of ['Create', 'Edit', 'Enhance', 'Analyze']) {
    await expect(panel.getByRole('button', { name: new RegExp(`^${label}( \\d+)?$`) })).toBeVisible()
  }

  // Non-hero use-case cards render inside their sections.
  await expect(panel.getByText('Remove background', { exact: true })).toBeVisible()
  await expect(panel.getByText('Restore an old photo', { exact: true })).toBeVisible()
  await expect(panel.getByText('Describe an image', { exact: true })).toBeVisible()
})
```

c. In the second test (lines 62–89), update the title collection to cover both card shapes — replace line 74:

```ts
const titles = await panel.locator('.line-clamp-2, .truncate').allInnerTexts()
```

(The deprecated-model names must not appear as either a hero tile or a section-row title; model names in `.line-clamp-1`/subline spans remain allowed — verify the sublines don't use `.truncate`; if they do, scope the row-title selector to the row's first text span instead, e.g. `.flex-col > span:first-child`.)

- [ ] **Step 4: Run what's runnable**

Run: `npm run test:unit`
Expected: PASS (all unit suites; this change touches none of them beyond Task 1's).

Playwright (`npm test -- tests/generators.spec.ts`) needs the ComfyUI backend on :8188 and the dev server; run it if both are up (`.venv/bin/python main.py --listen 127.0.0.1 --port 8188` from the repo root). If the backend isn't running, note it and rely on Task 4's visual verification; do not mark the plan complete without one of the two.

- [ ] **Step 5: Commit**

```bash
git add app/layouts/default.vue tests/generators.spec.ts
git commit -m "feat(ia): rename Generators → Actions in sidebar + update panel e2e spec"
```

---

### Task 4: Visual verification

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server and open the panel**

Use the preview tools (`preview_start` with the frontend dev config; create `.claude/launch.json` with `runtimeExecutable: "npm"`, `runtimeArgs: ["run", "dev"]`, port 3000 in `frontend/` if absent). The panel needs `/object_info` from ComfyUI on :8188 — start it if not running.

- [ ] **Step 2: Verify against this checklist**

- Sidebar button reads **Actions**; clicking opens the panel; header reads **Actions**.
- Image tab: hero grid shows Generate an image / Generate an image with your LoRA / Edit an image / Upscale an image as 2-column tiles with price chips.
- Below: **Create / Edit / Enhance / Analyze** section headers with counts; no provider headers anywhere; hero items do not repeat in sections.
- Each Audio / Video / 3D / Text tab shows its hero tier + sections.
- Searching "upscale" finds Upscale an image; hero grid disappears during search; clearing restores it.
- Collapsing "Edit" persists across a reload (localStorage).
- "Show legacy partners" reveals a **More models** section (legacy partner nodes, provider brand chips intact); hiding removes it.
- Click a hero tile → node lands on canvas; drag a section row → node lands on canvas.

- [ ] **Step 3: Screenshot proof + wrap up**

Take `preview_screenshot` of the open panel (image tab) for the user. If any checklist item fails, fix in source, re-verify, and amend/commit the fix before reporting done.

---

## Self-review notes

- **Spec coverage (Phase 1 scope):** rename ✓ (Tasks 2–3), provider sections removed ✓ (Task 2), hero tier ✓ (Tasks 1–2), intent sections mapped to generator/effect kinds ✓ (Task 1 catalog), domain tabs kept ✓ (untouched). Out of Phase 1 scope by design: Generate door, Add-menu changes, chips, Toolbox migration.
- **Legacy toggle** is preserved as-is; legacy items group under "More models" since they have no catalog entry — consistent with the spec's "provider becomes a detail."
- **Intent assignment judgment calls:** ProductShot → edit (transforms a product photo), ChatLLM/Brainstorm → create, ImprovePrompt/Translate/RewriteTone → edit, Summarize/Reason → analyze. Adjust freely at review — they're one-word edits in the catalog.
