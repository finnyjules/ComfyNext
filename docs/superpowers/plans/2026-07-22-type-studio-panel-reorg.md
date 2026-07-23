# Type Studio Panel Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Type Studio right panel into Design|Motion tabs with a logical section order, a new Camera section, and a sticky Save + Render footer (3D Studio pattern).

**Architecture:** Display order lives in `SPACE_TYPE_SECTIONS` (single source of truth); the surface renders sections by filtering effect controls per group. We reorder that array, gate the existing section loop by an inspector-tab ref, inject a surface-only Camera section (like Output), and replace the `#actions` slot with a sticky footer at the end of the `#controls` column.

**Tech Stack:** Vue 3 SFC (Nuxt 4), TypeScript, Tailwind, vitest.

**Spec:** `docs/superpowers/specs/2026-07-22-type-studio-panel-reorg-design.md`

## Global Constraints

- **Concurrent-edit hazard:** `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` carries ANOTHER session's uncommitted hunks (the import block at the top, and the `texOpts()` function body — anything mentioning `texOptsFromState` or `buildRibbonLabel`). NEVER edit, revert, or reformat those regions. Never run `git checkout`/`git stash` on this file. Line numbers drift — locate edit sites by anchor text, not line number.
- Do NOT edit any file under `frontend/app/lib/spacetype/effects/` (all 26 are dirty from the parallel session).
- Do NOT `git add frontend/app/components/vue-canvas/SpaceTypeSurface.vue` wholesale — the file is committed once, at the end, via hunk filtering (Task 5).
- Working dir for npm/vitest commands: `frontend/`.
- Match surrounding code style: Tailwind utility classes, `text-[11px] text-white/50` label idiom, `StudioSection`/`StudioButton` kit components.

---

### Task 1: Reorder `SPACE_TYPE_SECTIONS` + add `Camera`

**Files:**
- Modify: `frontend/app/lib/spacetype/sections.ts`
- Test: `frontend/tests/unit/spacetype-sections.unit.spec.ts`

**Interfaces:**
- Produces: `SPACE_TYPE_SECTIONS` in the new order, now including `'Camera'`. Later tasks rely on the exact names `'Camera'`, `'Motion'`, `'Output'`, `'Color'`.

- [ ] **Step 1: Write the failing order test**

Append to `frontend/tests/unit/spacetype-sections.unit.spec.ts`:

```ts
// The array IS the panel's display order (framing → content → shape → finish → motion → export).
// 'Camera' is surface-injected (no effect declares it); 'Motion' renders on the Motion tab.
it('panel order: framing → content → shape → finish → motion → output', () => {
  expect([...SPACE_TYPE_SECTIONS]).toEqual([
    'Camera', 'Transform',
    'Type', 'Color', 'Stroke',
    'Path', 'Layout', 'Stack', 'Stretch', 'Skew', 'Warp', 'Ribbon', 'Spiral', 'Slice', 'Wave', 'Glitch', 'Doodles',
    'Layers', 'Occlusion', 'Look', 'Style', 'Blend', 'Shadow',
    'Motion',
    'Output',
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run tests/unit/spacetype-sections.unit.spec.ts`
Expected: FAIL on the new order test (array mismatch); all pre-existing tests PASS.

- [ ] **Step 3: Reorder the array**

Replace the array in `frontend/app/lib/spacetype/sections.ts` (keep the file's doc comment, and extend it with one line noting `Camera` is surface-injected and `Motion` renders on the Motion tab):

```ts
export const SPACE_TYPE_SECTIONS = [
  // Framing
  'Camera', 'Transform',
  // Content
  'Type', 'Color', 'Stroke',
  // Shape & geometry
  'Path', 'Layout', 'Stack', 'Stretch', 'Skew', 'Warp', 'Ribbon', 'Spiral', 'Slice', 'Wave', 'Glitch', 'Doodles',
  // Finish
  'Layers', 'Occlusion', 'Look', 'Style', 'Blend', 'Shadow',
  // Animation — rendered on the Motion inspector tab, not in the Design list
  'Motion',
  // Export
  'Output',
] as const
```

- [ ] **Step 4: Run the full sections test to verify it passes**

Run: `cd frontend && npx vitest run tests/unit/spacetype-sections.unit.spec.ts`
Expected: PASS (all tests — the per-effect group guard proves no group got lost in the reorder).

- [ ] **Step 5: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git add frontend/app/lib/spacetype/sections.ts frontend/tests/unit/spacetype-sections.unit.spec.ts
git commit -m "feat(spacetype): reorder panel sections into framing/content/shape/finish/motion/export bands + Camera section

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Design | Motion inspector tabs

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (do NOT commit — Task 5 does)

**Interfaces:**
- Consumes: `SPACE_TYPE_SECTIONS` from Task 1.
- Produces: `inspectorTab: Ref<'design' | 'motion'>`, `sectionVisible(section): boolean`, `motionControlCount: ComputedRef<number>` — Task 3 extends `sectionVisible`'s Camera branch; Task 4's footer renders outside the tab gating.

- [ ] **Step 1: Add tab state to the script**

In `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`, directly below the `const sections = computed(...)` declaration (anchor: `SECTION_ORDER.map(name =>`), add. NOTE: the file already has an unrelated `activeTab` (project tab) — the new ref MUST be named `inspectorTab`:

```ts
// Inspector tabs — Design (everything) vs Motion (the effect's Motion-group controls),
// matching 3D Studio's Build|Motion split. Motion sections render open, not collapsible.
const inspectorTab = ref<'design' | 'motion'>('design')
const motionControlCount = computed(() => effect.value.controls.filter(c => c.group === 'Motion').length)
function sectionVisible(section: { name: string; controls: ControlSpec[] }): boolean {
  if (inspectorTab.value === 'motion') return section.name === 'Motion' && section.controls.length > 0
  if (section.name === 'Motion') return false
  return section.controls.length > 0 || section.name === 'Color' || section.name === 'Output'
}
```

- [ ] **Step 2: Add the tab strip to the template**

In the `#controls` slot, between `<VibeControlBar ... />` and the effect-card `<div class="rounded-lg border ...">`, insert (same construction as `Scene3DStudioSurface.vue`'s Build|Motion strip):

```html
<div class="flex shrink-0 gap-1 rounded-lg bg-white/[0.04] p-1 text-[11px]">
  <button type="button" class="flex-1 rounded px-2 py-1"
          :class="inspectorTab === 'design' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
          @click="inspectorTab = 'design'">Design</button>
  <button type="button" class="flex-1 rounded px-2 py-1"
          :class="inspectorTab === 'motion' ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white/80'"
          @click="inspectorTab = 'motion'">Motion</button>
</div>
```

- [ ] **Step 3: Gate the existing panel content by tab**

Three edits in the `#controls` template:

1. Effect card: add `v-show="inspectorTab === 'design'"` to the card `<div class="rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-2.5">` (anchor: the `<label ...>Effect</label>` inside it).
2. Section loop: on the `<StudioSection v-for="section in sections" ...>` element, replace
   `v-show="section.controls.length || section.name === 'Color' || section.name === 'Output'"` with
   `v-show="sectionVisible(section)"`, and replace `:open="openSections[section.name]"` with
   `:open="(section.name === 'Motion' && inspectorTab === 'motion') || openSections[section.name]"`.
   (Scoped to Motion so tab flips never churn the other sections' reactive `open` prop —
   StudioSection re-applies prop changes via a watch, which would reset manual toggles.)
3. Post card: add `v-show="inspectorTab === 'design'"` to `<StudioSection title="Post" :open="openSections.Post">`.

Then, directly after the tab strip from Step 2, add the empty-motion note:

```html
<p v-if="inspectorTab === 'motion' && !motionControlCount" class="px-1 pt-2 text-[11px] text-white/40">
  This effect has no motion parameters.
</p>
```

- [ ] **Step 4: Verify compile + tests**

Run: `cd frontend && npx vitest run tests/unit --silent 2>&1 | tail -5`
Expected: suite passes (same pass count as before the edit).
Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "SpaceTypeSurface" ; true`
Expected: no NEW errors mentioning SpaceTypeSurface (compare against pre-edit if any appear — repo has a large pre-existing typecheck baseline).

- [ ] **Step 5: No commit** — `SpaceTypeSurface.vue` is committed via hunk filtering in Task 5.

---

### Task 3: Camera section (move Projection + Pan out of the effect card)

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (do NOT commit — Task 5 does)

**Interfaces:**
- Consumes: `sectionVisible` from Task 2; existing `projection`, `panX`, `panY` refs and `frontLocked` computed.
- Produces: surface-injected `Camera` section content inside the section loop (pattern identical to the existing `Output` injection).

- [ ] **Step 1: Show the Camera section when not front-locked**

In `sectionVisible` (Task 2), insert a Camera branch before the final `return`:

```ts
  if (section.name === 'Camera') return !frontLocked.value
```

(If `frontLocked` is a plain ref/boolean rather than a computed, match its existing access pattern in the script.)

- [ ] **Step 2: Add Camera to the default-collapsed set**

In the `DEFAULT_COLLAPSED` set (anchor: `const DEFAULT_COLLAPSED = new Set([`), add `'Camera'` to the list.

- [ ] **Step 3: Inject the Camera controls into the section loop**

Inside the `StudioSection` loop body there is a surface-injection block `<template v-if="section.name === 'Output'">`. Directly BEFORE that template, add:

```html
<template v-if="section.name === 'Camera'">
  <div data-control class="text-xs">
    <label class="mb-1 block text-[11px] text-white/50">Projection</label>
    <select v-model="projection" class="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-xs text-white/85">
      <option value="perspective" class="bg-neutral-900">Perspective</option>
      <option value="isometric" class="bg-neutral-900">Isometric</option>
    </select>
  </div>
  <div data-control class="text-xs">
    <label class="mb-1.5 flex justify-between text-[11px] text-white/50">
      <span>Pan X</span><span class="font-mono text-white/80">{{ panX.toFixed(2) }}</span>
    </label>
    <input v-model.number="panX" type="range" min="-1" max="1" step="0.01" v-studio-reset class="studio-range w-full" />
  </div>
  <div data-control class="text-xs">
    <label class="mb-1.5 flex justify-between text-[11px] text-white/50">
      <span>Pan Y</span><span class="font-mono text-white/80">{{ panY.toFixed(2) }}</span>
    </label>
    <input v-model.number="panY" type="range" min="-1" max="1" step="0.01" v-studio-reset class="studio-range w-full" />
  </div>
</template>
```

- [ ] **Step 4: Remove the old camera controls from the effect card**

In the effect card, delete the entire `<template v-if="!frontLocked">` block (Projection label + select, Pan X label + range, Pan Y label + range). The card now ends after the Make-as-default row (and dev-only thumbnail button).

- [ ] **Step 5: Verify compile + tests**

Run: `cd frontend && npx vitest run tests/unit --silent 2>&1 | tail -5`
Expected: suite passes.
Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "SpaceTypeSurface" ; true`
Expected: no new errors for this file.

- [ ] **Step 6: No commit** — Task 5 commits.

---

### Task 4: Sticky Save + Render footer; remove `#actions`

**Files:**
- Modify: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue` (do NOT commit — Task 5 does)

**Interfaces:**
- Consumes: existing `saveConfig()`, `generateImage()`, `generateVideo()`, `sendToTimeline()`, `baking: Ref<boolean>`; `StudioButton` (already imported).
- Produces: `saveNow()`, `savedFlash: Ref<boolean>`, `renderMenuOpen: Ref<boolean>` — footer markup pinned via `sticky bottom-0 mt-auto` (3D Studio pattern, `Scene3DStudioSurface.vue` "Sticky action footer" comment).

- [ ] **Step 1: Add footer state to the script**

Below the `function saveConfig() {...}` definition, add:

```ts
// Sticky footer: explicit Save (with a transient flash) + a Render menu. Closing the
// studio still auto-saves (closeEditor → saveConfig) — Save is for checkpointing mid-edit.
const savedFlash = ref(false)
let savedFlashTimer: ReturnType<typeof setTimeout> | undefined
function saveNow() {
  saveConfig()
  savedFlash.value = true
  clearTimeout(savedFlashTimer)
  savedFlashTimer = setTimeout(() => { savedFlash.value = false }, 1500)
}

const renderMenuOpen = ref(false)
// Capture-phase so Escape closes the menu INSTEAD of the studio: StudioModalShell's own
// window keydown listener bails when defaultPrevented is set.
function onRenderMenuKeydown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  e.preventDefault(); e.stopPropagation()
  renderMenuOpen.value = false
}
function onRenderMenuPointerdown() { renderMenuOpen.value = false }
watch(renderMenuOpen, (open) => {
  if (open) {
    window.addEventListener('keydown', onRenderMenuKeydown, { capture: true })
    window.addEventListener('pointerdown', onRenderMenuPointerdown)
  } else {
    window.removeEventListener('keydown', onRenderMenuKeydown, { capture: true })
    window.removeEventListener('pointerdown', onRenderMenuPointerdown)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onRenderMenuKeydown, { capture: true })
  window.removeEventListener('pointerdown', onRenderMenuPointerdown)
  clearTimeout(savedFlashTimer)
})
```

(A second `onBeforeUnmount` call is fine in Vue; don't merge into the existing one.)

- [ ] **Step 2: Remove the `#actions` slot**

Delete the entire `<template #actions>...</template>` block (the three StudioButtons: Generate as image / Generate as video / Send to timeline). Do not delete the functions they called.

- [ ] **Step 3: Add the sticky footer at the end of `#controls`**

Directly after the closing `</StudioSection>` of the Post card (still inside `<template #controls>`), add:

```html
<!-- Sticky action footer: Save + Render, pinned bottom-right of the inspector column
     (3D Studio pattern). mt-auto pins it when the column is short; sticky bottom-0
     keeps it visible once the column scrolls. Visible on both inspector tabs. -->
<div class="sticky bottom-0 z-10 mt-auto border-t border-white/10 bg-[#0e0e10] pb-1 pt-2">
  <p v-if="savedFlash" class="mb-1.5 text-right text-xs text-emerald-400/80">Saved ✓</p>
  <div class="relative flex items-center justify-end gap-2">
    <StudioButton variant="secondary" :disabled="baking" @click="saveNow">Save</StudioButton>
    <StudioButton variant="primary" :disabled="baking" @pointerdown.stop @click="renderMenuOpen = !renderMenuOpen">
      {{ baking ? 'Generating…' : 'Render ▾' }}
    </StudioButton>
    <div v-if="renderMenuOpen" @pointerdown.stop
         class="absolute bottom-full right-0 z-20 mb-1.5 w-44 overflow-hidden rounded-lg border border-white/10 bg-[#1a1a1e] py-1 shadow-xl">
      <button type="button" class="block w-full px-3 py-1.5 text-left text-xs text-white/85 hover:bg-white/10"
              @click="renderMenuOpen = false; generateImage()">Render as image</button>
      <button type="button" class="block w-full px-3 py-1.5 text-left text-xs text-white/85 hover:bg-white/10"
              @click="renderMenuOpen = false; generateVideo()">Render as video</button>
      <button type="button" class="block w-full px-3 py-1.5 text-left text-xs text-white/85 hover:bg-white/10"
              @click="renderMenuOpen = false; sendToTimeline()">Send to timeline</button>
    </div>
  </div>
</div>
```

If `StudioButton` doesn't pass through `pointerdown` listeners (check `frontend/app/components/vue-canvas/StudioButton.vue` — attrs fall through to the root button unless `inheritAttrs` is disabled), wrap the Render button in a `<span @pointerdown.stop>` instead.

- [ ] **Step 4: Verify compile + tests**

Run: `cd frontend && npx vitest run tests/unit --silent 2>&1 | tail -5`
Expected: suite passes.
Run: `cd frontend && npx vue-tsc --noEmit 2>&1 | grep -i "SpaceTypeSurface" ; true`
Expected: no new errors for this file.

- [ ] **Step 5: No commit** — Task 5 commits.

---

### Task 5: Hunk-filtered commit of `SpaceTypeSurface.vue`

**Files:**
- Commit only: `frontend/app/components/vue-canvas/SpaceTypeSurface.vue`

The file also contains the parallel session's uncommitted hunks (import block + `texOpts()` body). Stage ONLY our hunks.

- [ ] **Step 1: Build a patch of our hunks**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git diff -U3 -- frontend/app/components/vue-canvas/SpaceTypeSurface.vue | awk '
  /^diff --git/ {hdr=$0 ORS; next}
  /^index |^--- |^\+\+\+ / {hdr=hdr $0 ORS; next}
  /^@@/ {if (buf != "" && keep) out=out buf; buf=$0 ORS; keep=1; next}
  {buf=buf $0 ORS; if ($0 ~ /texOptsFromState|buildRibbonLabel/) keep=0}
  END {if (buf != "" && keep) out=out buf; if (out != "") printf "%s%s", hdr, out}
' > /private/tmp/claude-501/-Users-julien-Documents-GitHub-Sailor/b53e319b-d1a4-4226-b88d-a8422647b4b8/scratchpad/ours.patch
grep -c "^@@" /private/tmp/claude-501/-Users-julien-Documents-GitHub-Sailor/b53e319b-d1a4-4226-b88d-a8422647b4b8/scratchpad/ours.patch
```

Expected: hunk count > 0. (If the parallel session has committed its work meanwhile, the filter is a no-op — every remaining hunk is ours.)

- [ ] **Step 2: Stage and verify**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git apply --cached /private/tmp/claude-501/-Users-julien-Documents-GitHub-Sailor/b53e319b-d1a4-4226-b88d-a8422647b4b8/scratchpad/ours.patch
git diff --cached -- frontend/app/components/vue-canvas/SpaceTypeSurface.vue | grep -cE "texOptsFromState|buildRibbonLabel" ; true
```

Expected: final grep prints `0` (their hunks are NOT staged). Also eyeball `git diff --cached --stat`.

- [ ] **Step 3: Commit**

```bash
cd /Users/julien/Documents/GitHub/Sailor
git commit -m "feat(spacetype): Type Studio Design|Motion tabs, Camera section, sticky Save/Render footer

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Note: the unstaged texOpts hunks remain in the working tree afterwards — that is correct; they belong to the other session.

---

### Task 6: Browser E2E verification

Performed by the orchestrating session (needs the Browser pane). Start a dev server (`.claude/launch.json` config, or fall back to the compile-check curl against Julien's :3000 if all 5 dev-server slots are taken), open a blank project, add a Space Type node (`window.dispatchEvent(new CustomEvent('sailor:addNode', { detail: { nodeType: 'SpaceType' } }))` — check the exact nodeType in `useVueNodes.ts` first), open Type Studio, then verify:

- [ ] Design|Motion tab strip renders under the vibe bar; switching tabs swaps content.
- [ ] Design tab: effect card first (no Projection/Pan inside), then Camera · Transform · Type · Color · Stroke · (effect geometry) · finish sections · Output · Post.
- [ ] Camera section: collapsed by default, contains Projection/Pan X/Pan Y, hidden for a front-locked effect (e.g. the String/path effect), and panning still moves the preview camera.
- [ ] Motion tab: Motion controls render open for an animated effect (e.g. ribbon); a motionless effect shows "This effect has no motion parameters."
- [ ] Footer: pinned bottom-right on both tabs, stays visible while the column scrolls; Save flashes "Saved ✓"; Render menu opens upward with all three items; Escape closes the menu but NOT the studio; outside click closes it.
- [ ] No new console errors.
