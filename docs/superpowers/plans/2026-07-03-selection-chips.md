# Selection Action Chips (IA Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per spec §3 (`docs/superpowers/specs/2026-07-03-studios-actions-ia-design.md`): selecting a media node surfaces its top takes-input actions as chips, plus an "All actions…" chip that opens the Actions panel pre-filtered to the node's media type. Chips are a sampler, never the whole store.

**Architecture:** Three seams, all existing: (1) chip data joins `app/data/action-catalog.ts` as `CHIPS_BY_DOMAIN`; (2) chip clicks reuse the `sailor:applyEffect` window event (VueNodeCanvas's `handleApplyEffect` at ~1676 is already output-generic — `output || 'IMAGE'` — and honors `branch: true` so a chip branches off the artifact rather than re-pointing its chain); (3) a new `sailor:openActions` event lets the canvas open the Actions panel with a target domain (new prop seam into `GeneratorsPanel.vue`, which today keeps `activeDomain` internal).

**Scope decision (locked):** chips mount on `ArtifactVideoNode` and `ArtifactAudioNode` when selected. `ArtifactImageNode` KEEPS its existing richer escalator (post-render NextStepsStrip + Edit menu) and gets nothing new — two stacked chip strips on image nodes would be clutter. Extending the image Edit menu with "All actions…" is deferred, noted in §Out-of-scope.

**Tech Stack:** Vue 3 / vue-flow custom nodes, vitest for the catalog test.

## Global Constraints

- Work directly on `main`; explicit `git add` paths only, NEVER `-A` (user rules). A meter-spike session may still be committing to main: no rebase/reset/stash; commit promptly after each task.
- Pastel = AI marker; chips that fire AI actions use the quiet `.ns-chip` styling with a pastel dot ONLY if we ever mix free chips in — v1 chips are all AI/paid, so match `NextStepsStrip.vue`'s quiet `.ns-chip` look (per its precedent: the *fix* chips are pastel, the generic escalator chips are quiet; selection chips are generic escalators). No purple accents.
- User-visible strings: chip labels are short verbs derived from the catalog useCase (mapping below); the trailing chip is exactly `All actions…`.
- Unit-test runs scoped to `tests/unit/action-catalog.unit.spec.ts`.
- All commands from `/Users/julien/Documents/GitHub/Sailor/frontend`.

---

### Task 1: `CHIPS_BY_DOMAIN` in the action catalog (TDD)

**Files:**
- Modify: `frontend/app/data/action-catalog.ts`
- Modify: `frontend/tests/unit/action-catalog.unit.spec.ts`

**Interfaces:**
- Produces: `CHIPS_BY_DOMAIN: Record<ActionDomain, { nodeType: string; chipLabel: string }[]>` — Task 3 consumes.

- [ ] **Step 1: Extend the unit spec** — add to the "ACTION_CATALOG integrity" describe block:

```ts
  it('every chip nodeType exists in the catalog and is a takes-input intent', () => {
    for (const [domain, chips] of Object.entries(CHIPS_BY_DOMAIN)) {
      for (const chip of chips) {
        const entry = ACTION_CATALOG[chip.nodeType]
        expect(entry, `${domain} chip ${chip.nodeType}`).toBeDefined()
        expect(entry!.intent, `${domain} chip ${chip.nodeType} must not be create`).not.toBe('create')
        expect(chip.chipLabel.length).toBeGreaterThan(0)
        expect(chip.chipLabel.length, `${chip.nodeType} chipLabel is a short verb`).toBeLessThanOrEqual(14)
      }
    }
  })
```

Add `CHIPS_BY_DOMAIN` to the spec's import. Run `npx vitest run tests/unit/action-catalog.unit.spec.ts` → FAIL (no export).

- [ ] **Step 2: Implement** — in `action-catalog.ts` after `HERO_BY_DOMAIN`:

```ts
// Selection chips — the 2–3 takes-input actions surfaced on a selected media
// node (spec §3: a sampler, never the whole store; "All actions…" opens the
// panel). chipLabel = the short verb form of the useCase for a 1-line strip.
export const CHIPS_BY_DOMAIN: Record<ActionDomain, { nodeType: string; chipLabel: string }[]> = {
  image: [
    { nodeType: 'EditImageNode',        chipLabel: 'Edit' },
    { nodeType: 'UpscaleImageNode',     chipLabel: 'Upscale' },
    { nodeType: 'RemoveBackgroundNode', chipLabel: 'Remove BG' },
  ],
  video: [
    { nodeType: 'LipsyncNode',     chipLabel: 'Sync lips' },
    { nodeType: 'EnhanceVideoNode', chipLabel: 'Enhance' },
    { nodeType: 'DescribeVideoNode', chipLabel: 'Describe' },
  ],
  audio: [
    { nodeType: 'TranscribeAudioNode',  chipLabel: 'Transcribe' },
    { nodeType: 'IdentifySpeakersNode', chipLabel: 'Speakers' },
  ],
  '3d': [],
  text: [],
}
```

(Image chips exist for future use by the Edit-menu deferral; no image component consumes them in this phase.)

- [ ] **Step 3: Run → PASS, commit**

```bash
git add app/data/action-catalog.ts tests/unit/action-catalog.unit.spec.ts
git commit -m "feat(ia): CHIPS_BY_DOMAIN — selection-chip sampler data with intent guard"
```

---

### Task 2: `sailor:openActions` seam — canvas → Actions panel with domain

**Files:**
- Modify: `frontend/app/layouts/default.vue`
- Modify: `frontend/app/components/vue-canvas/GeneratorsPanel.vue`

**Interfaces:**
- Consumes: existing `generatorsPanelOpen` ref, `openSubmenu` ref, `<VueCanvasGeneratorsPanel @close=…>` mount (~line 2944).
- Produces: window event contract `sailor:openActions` with `detail: { domain?: 'image'|'audio'|'video'|'3d'|'text' }`; `GeneratorsPanel` prop `focusDomain?: { domain: ActionDomain; ts: number } | null`.

- [ ] **Step 1: default.vue** — next to the other panel refs add:

```ts
// Canvas → Actions panel deep-link: anything on the canvas can dispatch
// `sailor:openActions` with an optional domain to open the panel on that
// tab (selection chips' "All actions…" uses this). ts forces the watcher to
// re-fire on repeated same-domain opens.
const actionsFocusDomain = ref<{ domain: string; ts: number } | null>(null)
function handleOpenActions(e: Event) {
  const domain = (e as CustomEvent).detail?.domain
  if (domain) actionsFocusDomain.value = { domain, ts: Date.now() }
  openSubmenu.value = null
  toolboxPanelOpen.value = false
  loraLibraryPanelOpen.value = false
  charactersPanelOpen.value = false
  blockLibraryPanelOpen.value = false
  generatorsPanelOpen.value = true
}
```

Register/unregister with the layout's existing window-listener lifecycle (find where other `sailor:*` listeners or mount hooks live in this file — mirror that): `window.addEventListener('sailor:openActions', handleOpenActions)` in `onMounted`, matching remove in `onUnmounted`.

Pass the prop at the panel mount: `<VueCanvasGeneratorsPanel :focus-domain="actionsFocusDomain" @close="generatorsPanelOpen = false" />`.

- [ ] **Step 2: GeneratorsPanel.vue** — declare and watch the prop (panel currently has `defineEmits<{ close: [] }>()` and no props):

```ts
const props = defineProps<{ focusDomain?: { domain: ActionDomain; ts: number } | null }>()
watch(() => props.focusDomain, (f) => {
  if (!f) return
  activeDomain.value = f.domain
  searchQuery.value = ''
}, { immediate: true })
```

Place after the `activeDomain`/`searchQuery` refs so ordering is valid. `ActionDomain` is already imported.

- [ ] **Step 3: Manual sanity + commit** — with a dev server running, in the browser console: `window.dispatchEvent(new CustomEvent('sailor:openActions', { detail: { domain: 'video' } }))` → panel opens on Video tab. If no server is running note it for the controller's verify task.

```bash
git add app/layouts/default.vue app/components/vue-canvas/GeneratorsPanel.vue
git commit -m "feat(ia): sailor:openActions seam — open Actions panel on a target domain"
```

---

### Task 3: `SelectionActionChips` component, mounted on video + audio artifacts

**Files:**
- Create: `frontend/app/components/vue-canvas/SelectionActionChips.vue`
- Modify: `frontend/app/components/vue-canvas/ArtifactVideoNode.vue`
- Modify: `frontend/app/components/vue-canvas/ArtifactAudioNode.vue`

**Interfaces:**
- Consumes: `CHIPS_BY_DOMAIN` (Task 1), `sailor:applyEffect` (existing, `branch: true` + `focus: true`), `sailor:openActions` (Task 2), `getGeneratorIcon` from `~/data/generator-icons`, `ACTION_CATALOG` for tooltips.
- Produces: `<SelectionActionChips :node-id="id" domain="video" />`.

- [ ] **Step 1: The component** — create `SelectionActionChips.vue`:

```vue
<!-- frontend/app/components/vue-canvas/SelectionActionChips.vue -->
<script setup lang="ts">
// Selection-driven action sampler (IA spec §3): the top takes-input actions
// for this media type, branching off the artifact via sailor:applyEffect
// (branch: true = new deliverable; never re-points the producing chain).
// "All actions…" deep-links the Actions panel to this domain. Chips use the
// quiet ns-chip look from NextStepsStrip — these are generic escalators, not
// pastel reviewer-fix chips.
import { MoreHorizontal } from 'lucide-vue-next'
import { ACTION_CATALOG, CHIPS_BY_DOMAIN, type ActionDomain } from '~/data/action-catalog'
import { getGeneratorIcon } from '~/data/generator-icons'

const props = defineProps<{ nodeId: string; domain: ActionDomain; output: string }>()

const chips = CHIPS_BY_DOMAIN[props.domain] ?? []

function fire(nodeType: string) {
  window.dispatchEvent(new CustomEvent('sailor:applyEffect', {
    detail: { nodeId: props.nodeId, nodeType, output: props.output, branch: true, focus: true },
  }))
}
function openAllActions() {
  window.dispatchEvent(new CustomEvent('sailor:openActions', { detail: { domain: props.domain } }))
}
</script>

<template>
  <div class="nopan nodrag sel-chips flex items-center gap-1 px-1.5 py-1 border-t border-white/5 bg-black/60">
    <button
      v-for="chip in chips"
      :key="chip.nodeType"
      class="sel-chip"
      :title="ACTION_CATALOG[chip.nodeType]?.useCase"
      @click.stop="fire(chip.nodeType)"
    >
      <component :is="getGeneratorIcon(chip.nodeType)" class="size-2.5" />
      {{ chip.chipLabel }}
    </button>
    <span class="flex-1" />
    <button class="sel-chip" title="All actions…" @click.stop="openAllActions()">
      <MoreHorizontal class="size-2.5" />
    </button>
  </div>
</template>

<style scoped>
.sel-chips { animation: sel-in 0.18s ease-out; }
@keyframes sel-in {
  from { opacity: 0; transform: translateY(3px); }
  to { opacity: 1; transform: translateY(0); }
}
.sel-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  height: 1.25rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
  font-size: 10px;
  color: rgb(255 255 255 / 0.7);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}
.sel-chip:hover { color: #fff; background-color: rgb(255 255 255 / 0.1); }
</style>
```

(If `getGeneratorIcon` returns undefined for a nodeType, `<component :is="undefined">` renders nothing — acceptable; all current chip nodeTypes have icons.)

- [ ] **Step 2: Mount on the video artifact** — in `ArtifactVideoNode.vue`: read the file first. Add `selected?: boolean` to the `defineProps` block (vue-flow passes it to custom nodes once declared). At the bottom of the node's root template (after the main body, inside the outermost node container so it reads as a footer, mirroring where ArtifactImageNode puts NextStepsStrip — check that file's lines ~674-685 for the pattern), add:

```html
    <SelectionActionChips v-if="selected" :node-id="id" domain="video" output="VIDEO" />
```

Import is auto-resolved by Nuxt (components dir); if the file uses explicit imports, add one.

- [ ] **Step 3: Mount on the audio artifact** — same recipe in `ArtifactAudioNode.vue`:

```html
    <SelectionActionChips v-if="selected" :node-id="id" domain="audio" output="AUDIO" />
```

- [ ] **Step 4: Verify + commit** — `npx vitest run tests/unit/action-catalog.unit.spec.ts` (canary; must stay green). If a dev server is up, select a Video node → chips appear; click Enhance → an EnhanceVideoNode spawns wired as a branch.

```bash
git add app/components/vue-canvas/SelectionActionChips.vue app/components/vue-canvas/ArtifactVideoNode.vue app/components/vue-canvas/ArtifactAudioNode.vue
git commit -m "feat(ia): selection action chips on video/audio artifacts"
```

---

### Task 4: Visual verification (controller inline)

- [ ] Add a Video node (Add → Sources → Video) + Audio node; select each → chip strip appears with the right verbs; deselect → gone.
- [ ] Video "Enhance" chip → EnhanceVideoNode appears branched off the video node (edge from video output; existing chain untouched).
- [ ] "All actions…" on the audio node → Actions panel opens on the Audio tab, search cleared.
- [ ] Image node: NO new strip (post-render escalator unchanged).
- [ ] Screenshot of a selected video node with chips.

## Out of scope (deferred, noted for later)

- "All actions…" entry in the image node's Edit menu (image keeps its existing richer escalator this phase).
- Relevance-ranked/dynamic chips (v1 is a fixed curated sampler per domain).
- Chips on Frame/Timeline/3D artifacts.

## Self-review notes

- Spec §3 chips requirement: sampler ✓ (2–3 + All actions), takes-input only ✓ (unit-guarded `intent !== 'create'`), panel pre-filtered ✓ (Task 2 seam sets domain + clears search).
- `branch: true` honors the artifact-generator-actions gotcha (splice would re-bill the producing chain on later runs).
- `handleApplyEffect` verified output-generic before planning (VueNodeCanvas.vue:1679 `output || 'IMAGE'`).
