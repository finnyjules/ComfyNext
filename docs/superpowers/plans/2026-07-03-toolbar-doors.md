# Toolbar Doors (IA Phases 2+3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the canvas toolbar into three "doors" per §2 of `docs/superpowers/specs/2026-07-03-studios-actions-ia-design.md`: **Add** (starting points, with labeled Surfaces/Sources groups), **Studios** (craft places, split out of Add, with truthful icons + pastel markers on the AI-billed ones), and **Generate** (curated zero-input AI verbs, pastel-treated).

**Architecture:** All changes live in `frontend/app/layouts/default.vue` (the floating bottom toolbar + its popup menus). The two existing mutually-exclusive submenu booleans (`loadMenuOpen`, `moreMenuOpen`) become one `openSubmenu` ref since we're growing to four submenus. Each new door copies the existing load-popup markup pattern; section headers copy the More-menu's "Annotate" sub-header pattern. Node placement continues through the existing `comfynext:addNode` event — no canvas changes.

**Tech Stack:** Nuxt 4 / Vue 3 / TypeScript, lucide-vue-next icons, existing `.gen-pastel` CSS convention (`app/assets/css/main.css:297`).

## Global Constraints

- Work directly on `main` — do NOT create a branch. `git add` explicit paths only — NEVER `git add -A` (user rules).
- A parallel session commits unrelated work to main: never rebase/reset/stash; re-read the current file before editing rather than trusting line numbers; if `default.vue` shows unexpected concurrent edits in the regions you're changing, STOP and report.
- No purple/violet accents. Pastel (`gen-pastel`) is the AI/billing marker — never amber or other accents for AI (user rules).
- User-visible strings exactly as specified: toolbar labels `Add`, `Studios`, `Generate`; group headers `Surfaces`, `Sources`.
- `SPACE_TYPE_ENABLED` and `KINETIC_ENABLED` flag-gating must be preserved for Type/Slate entries.
- Verification scope: this repo's Playwright suites place nodes via `comfynext:addNode` (not menu clicks), so no e2e updates expected; run `npx vitest run tests/unit/action-catalog.unit.spec.ts` as a canary only if you touched anything imported by it (you shouldn't). Visual verification happens in the final task.
- All commands run from `/Users/julien/Documents/GitHub/ComfyNext/frontend`.

Shared snippet — the **pastel dot** marker (AI-billed indicator on menu rows and the Generate toolbar icon). The gradient literal matches `NextStepsStrip.vue`'s established usage:

```html
<span
  class="gen-pastel size-1.5 rounded-full shrink-0"
  style="--gen-pastel: linear-gradient(90deg, rgba(255,214,231,.85), rgba(207,232,255,.85), rgba(214,255,224,.85), rgba(255,244,204,.85), rgba(231,214,255,.85), rgba(255,214,231,.85));"
  title="Uses AI credits"
/>
```

---

### Task 1: Submenu-state unification + Studios door

**Files:**
- Modify: `frontend/app/layouts/default.vue`

**Interfaces:**
- Consumes: existing `onLoadOption` special-case handling (`'slate-gallery'`, `'space-type'`), `addLoadNode`, `SPACE_TYPE_ENABLED`, `KINETIC_ENABLED`.
- Produces (Tasks 2–3 rely on): `openSubmenu: Ref<null | 'load' | 'studios' | 'generate' | 'more'>` replacing `loadMenuOpen`/`moreMenuOpen`; a generic `toggleSubmenu(name)` branch inside `toggleSidebarItem`; the popup + click-away-overlay markup pattern parameterized by submenu name.

- [ ] **Step 1: Unify submenu state**

In the script section, replace the two refs (`const loadMenuOpen = ref(false)` near the loadOptions block, and `const moreMenuOpen = ref(false)` near the annotate block) with one ref placed where `loadMenuOpen` was:

```ts
// One submenu open at a time. 'load' = Add, plus the Studios / Generate doors
// and the More overflow. null = all closed.
type SubmenuName = 'load' | 'studios' | 'generate' | 'more'
const openSubmenu = ref<SubmenuName | null>(null)
```

Then update every existing reference (grep `loadMenuOpen` and `moreMenuOpen`; current occurrences and their replacements):

| Old | New |
|---|---|
| `loadMenuOpen.value = false` (in `addLoadNode`, `onLoadOption`, `runSidebarItem`) | `openSubmenu.value = null` |
| `moreMenuOpen.value = false` (in `runSidebarItem`) | (delete — the line above already covers it; keep exactly one `openSubmenu.value = null`) |
| `if (item?.submenu === 'load') return loadMenuOpen.value` (isSidebarItemActive) | `if (item?.submenu) return openSubmenu.value === item.submenu \|\| (item.submenu === 'more' && (blockLibraryPanelOpen.value \|\| vueNodesSidebarOpen.value))` — replaces BOTH submenu lines |
| the `submenu === 'load'` and `submenu === 'more'` branches in `toggleSidebarItem` | one generic branch, below |
| template `v-if="loadMenuOpen && activeTab.type === 'project'"` (click-away overlay) | `v-if="openSubmenu && activeTab.type === 'project'"` with `@click="openSubmenu = null"` — ONE overlay replaces the two existing overlay divs (delete the `moreMenuOpen` one) |
| template `v-if="item.submenu === 'load' && loadMenuOpen"` | `v-if="item.submenu === 'load' && openSubmenu === 'load'"` |
| template `v-if="item.submenu === 'more' && moreMenuOpen"` | `v-if="item.submenu === 'more' && openSubmenu === 'more'"` |

The generic `toggleSidebarItem` branch (replaces both existing submenu branches; keep the `openAssets` branch and trailing `runSidebarItem(item)` as-is):

```ts
  if (item?.submenu) {
    // Close side panels so the popup isn't competing with them.
    toolboxPanelOpen.value = false
    generatorsPanelOpen.value = false
    loraLibraryPanelOpen.value = false
    charactersPanelOpen.value = false
    blockLibraryPanelOpen.value = false
    openSubmenu.value = openSubmenu.value === item.submenu ? null : (item.submenu as SubmenuName)
    return
  }
```

- [ ] **Step 2: Add the Studios toolbar item and options list**

In `sidebarItems`, insert directly after the `Add` entry:

```ts
  { label: 'Studios', icon: Shapes, submenu: 'studios' },
```

Add to the lucide-vue-next import: `Shapes, Blend, Aperture, Grid3x3, CaseSensitive` (verify each name compiles against the installed lucide-vue-next; if one is missing pick the closest equivalent and note it in your report).

Below `loadOptions`, add:

```ts
// Studios — places you open and craft in (spec §1: defined by interaction
// model, not AI-ness). Pastel dot = the studio bills AI credits when run.
const studiosOptions = [
  ...(SPACE_TYPE_ENABLED ? [{ label: 'Type', icon: CaseSensitive, special: 'space-type' }] : []),
  { label: 'Gradient', icon: Blend, nodeType: 'GradientStudio' },
  { label: 'Shader', icon: Aperture, nodeType: 'ShaderStudio' },
  { label: 'Pattern', icon: Grid3x3, nodeType: 'TextureStudio' },
  ...(KINETIC_ENABLED ? [{ label: 'Slate', icon: Clapperboard, special: 'slate-gallery' }] : []),
  { label: 'Shot Director', icon: Clapperboard, nodeType: 'ShotDirector', pastel: true },
  { label: 'Lip-Sync', icon: AudioWaveform, nodeType: 'LipSyncStudio', pastel: true },
]
```

`onLoadOption` already handles `special: 'slate-gallery'` / `'space-type'` / `nodeType` — reuse it for studio options (it closes the submenu via the Step 1 rename).

- [ ] **Step 3: Remove the studio entries from `loadOptions`**

Delete from `loadOptions`: the `KINETIC_ENABLED` Slate spread, the `SPACE_TYPE_ENABLED` Type Studio spread, and the `Gradient`, `Shader`, `Pattern`, `Shot Director`, `Lip-Sync` rows. (`Collection` and `Timeline` STAY in `loadOptions` — Task 2 regroups them.) After this step `loadOptions` = Frame, Smart Layout, Collection, Timeline (dividerAfter), Image, Text, Audio, Video, 3D.

- [ ] **Step 4: Render the Studios popup**

In the toolbar template, after the load-popup `div` (the one now gated on `openSubmenu === 'load'`), add a sibling popup using the same shell classes:

```html
              <!-- Studios door: craft places. Same popup shell as the Add menu. -->
              <div
                v-if="item.submenu === 'studios' && openSubmenu === 'studios'"
                class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex flex-col gap-0.5 min-w-[160px] bg-[#1a1a1a]/95 border border-[#2a2a2a] rounded-[12px] p-1.5 shadow-xl whitespace-nowrap"
                @click.stop
              >
                <button
                  v-for="opt in studiosOptions"
                  :key="opt.label"
                  class="flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-left transition-colors hover:bg-white/[0.08] cursor-pointer"
                  @click="onLoadOption(opt)"
                >
                  <component :is="opt.icon" class="size-4 text-white/70" :stroke-width="1.75" />
                  <span class="text-xs text-white/85 flex-1">{{ opt.label }}</span>
                  <span
                    v-if="opt.pastel"
                    class="gen-pastel size-1.5 rounded-full shrink-0"
                    style="--gen-pastel: linear-gradient(90deg, rgba(255,214,231,.85), rgba(207,232,255,.85), rgba(214,255,224,.85), rgba(255,244,204,.85), rgba(231,214,255,.85), rgba(255,214,231,.85));"
                    title="Uses AI credits"
                  />
                </button>
              </div>
```

- [ ] **Step 5: Verify and commit**

Confirm zero remaining references: `grep -n "loadMenuOpen\|moreMenuOpen" app/layouts/default.vue` → no hits. Load the layout in the dev server if one is running (HMR) and confirm no compile overlay; otherwise rely on the final task.

```bash
git add app/layouts/default.vue
git commit -m "feat(ia): Studios toolbar door — craft places split out of Add; unified submenu state"
```

---

### Task 2: Add menu regroup — Surfaces / Sources

**Files:**
- Modify: `frontend/app/layouts/default.vue`

**Interfaces:**
- Consumes: Task 1's `openSubmenu`, trimmed `loadOptions`, `onLoadOption`.
- Produces: `loadSections` (replaces flat `loadOptions`); Task 3 does not depend on it.

- [ ] **Step 1: Regroup the options**

Replace the (post-Task-1) `loadOptions` array with:

```ts
// Add menu — starting points only (spec §1: inert scaffolding). Two groups:
// Surfaces = places where work composes; Sources = media/data you bring in.
// Studios and Generate verbs live behind their own toolbar doors.
const loadSections = [
  { label: 'Surfaces', items: [
    { label: 'Frame', icon: Frame, nodeType: 'Compositor' },
    { label: 'Smart Layout', icon: LayoutTemplate, nodeType: 'SmartLayout' },
    { label: 'Timeline', icon: ListVideo, nodeType: 'Timeline' },
  ] },
  { label: 'Sources', items: [
    { label: 'Image', icon: Image, nodeType: 'Image' },
    { label: 'Text', icon: Type, nodeType: 'Text' },
    { label: 'Audio', icon: AudioWaveform, nodeType: 'Audio' },
    { label: 'Video', icon: Film, nodeType: 'Video' },
    { label: 'Collection', icon: Table2, nodeType: 'Collection' },
    { label: '3D', icon: Box, nodeType: 'Mesh', disabled: true, hint: 'coming soon' },
  ] },
]
```

Add `ListVideo` to the lucide import (Timeline's Clapperboard was shared with Shot Director; a timeline reads as a clip list, and Clapperboard now belongs to the Studios menu). Remove now-unused icon imports if any (check `Sparkles` usage — it's still used by the Explain toolbar item; leave it).

- [ ] **Step 2: Update the load popup template**

Replace the load popup's inner `<template v-for="opt in loadOptions">…</template>` block with grouped rendering (header pattern copied from the More menu's Annotate header):

```html
                <template v-for="(section, si) in loadSections" :key="section.label">
                  <div v-if="si > 0" class="h-px bg-white/10 mx-1 my-1" />
                  <p class="px-3 pt-0.5 pb-1 text-[9px] uppercase tracking-wider text-white/35">
                    {{ section.label }}
                  </p>
                  <button
                    v-for="opt in section.items"
                    :key="opt.label"
                    class="flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-left transition-colors"
                    :class="opt.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/[0.08] cursor-pointer'"
                    :disabled="opt.disabled"
                    @click="!opt.disabled && onLoadOption(opt)"
                  >
                    <component :is="opt.icon" class="size-4 text-white/70" :stroke-width="1.75" />
                    <span class="text-xs text-white/85 flex-1">{{ opt.label }}</span>
                    <span v-if="opt.hint" class="text-[9px] uppercase tracking-wider text-white/35">{{ opt.hint }}</span>
                  </button>
                </template>
```

Note: `dividerAfter` handling disappears with the flat list; the between-groups divider above replaces it. Grep `dividerAfter` afterwards — if the More/annotate menus still use it elsewhere keep those, but the load menu must not reference it.

- [ ] **Step 3: Verify and commit**

`grep -n "loadOptions" app/layouts/default.vue` → no hits (fully replaced by `loadSections`).

```bash
git add app/layouts/default.vue
git commit -m "feat(ia): Add menu regrouped into labeled Surfaces / Sources sections"
```

---

### Task 3: Generate door

**Files:**
- Modify: `frontend/app/layouts/default.vue`

**Interfaces:**
- Consumes: Task 1's `openSubmenu`, `toggleSidebarItem` generic branch, `addLoadNode`.
- Produces: nothing downstream.

- [ ] **Step 1: Toolbar item + options**

In `sidebarItems`, insert directly after the `Studios` entry:

```ts
  { label: 'Generate', icon: Sparkle, submenu: 'generate' },
```

Add `Sparkle, ImagePlus, Brush, Music, Mic` to the lucide import (same verify-or-nearest rule). Below `studiosOptions`, add:

```ts
// Generate door — the curated zero-input AI verbs (spec §2). The fast lane,
// not the store: the full catalog lives in the Actions panel. Audio expands
// inline to its two nodes rather than widening the door to five items.
const generateOptions = [
  { label: 'Image', icon: ImagePlus, nodeType: 'GenerateImageNode' },
  { label: 'Styled image', icon: Brush, nodeType: 'FluxLoRARemoteNode' },
  { label: 'Video', icon: Film, nodeType: 'GenerateVideoNode' },
]
const generateAudioOptions = [
  { label: 'Music', icon: Music, nodeType: 'GenerateMusicNode' },
  { label: 'Speech', icon: Mic, nodeType: 'GenerateSpeechNode' },
]
const generateAudioExpanded = ref(false)
```

Reset the expansion whenever the submenu closes — add a watcher next to the refs:

```ts
watch(openSubmenu, (v) => { if (v !== 'generate') generateAudioExpanded.value = false })
```

- [ ] **Step 2: Pastel-mark the toolbar button**

The Generate door is uniformly AI, so the marker sits on the toolbar icon itself. In the toolbar button template (the `<component :is="item.icon" …>` line), wrap icon + dot for submenu items that declare pastel. Simplest exact change — give the Generate sidebar item a flag and render the dot absolutely:

In `sidebarItems`, the Generate entry becomes:

```ts
  { label: 'Generate', icon: Sparkle, submenu: 'generate', pastel: true },
```

In the toolbar button, wrap the existing icon `<component>` in a relative span and add the dot:

```html
                <span class="relative">
                  <component :is="item.icon" class="size-4 text-white/70 group-hover:text-white transition-colors" :class="{ 'text-white': isSidebarItemActive(item) }" />
                  <span
                    v-if="item.pastel"
                    class="gen-pastel absolute -top-0.5 -right-1 size-1.5 rounded-full"
                    style="--gen-pastel: linear-gradient(90deg, rgba(255,214,231,.85), rgba(207,232,255,.85), rgba(214,255,224,.85), rgba(255,244,204,.85), rgba(231,214,255,.85), rgba(255,214,231,.85));"
                  />
                </span>
```

- [ ] **Step 3: Render the Generate popup**

Sibling to the Studios popup:

```html
              <!-- Generate door: curated zero-input AI verbs. Full catalog = Actions panel. -->
              <div
                v-if="item.submenu === 'generate' && openSubmenu === 'generate'"
                class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex flex-col gap-0.5 min-w-[160px] bg-[#1a1a1a]/95 border border-[#2a2a2a] rounded-[12px] p-1.5 shadow-xl whitespace-nowrap"
                @click.stop
              >
                <button
                  v-for="opt in generateOptions"
                  :key="opt.label"
                  class="flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-left transition-colors hover:bg-white/[0.08] cursor-pointer"
                  @click="addLoadNode(opt.nodeType)"
                >
                  <component :is="opt.icon" class="size-4 text-white/70" :stroke-width="1.75" />
                  <span class="text-xs text-white/85 flex-1">{{ opt.label }}</span>
                </button>
                <button
                  class="flex items-center gap-2 px-3 py-1.5 rounded-[8px] text-left transition-colors hover:bg-white/[0.08] cursor-pointer"
                  @click.stop="generateAudioExpanded = !generateAudioExpanded"
                >
                  <AudioWaveform class="size-4 text-white/70" :stroke-width="1.75" />
                  <span class="text-xs text-white/85 flex-1">Audio</span>
                  <ChevronDown class="size-3 text-white/40 transition-transform" :class="generateAudioExpanded ? '' : '-rotate-90'" />
                </button>
                <template v-if="generateAudioExpanded">
                  <button
                    v-for="opt in generateAudioOptions"
                    :key="opt.label"
                    class="flex items-center gap-2 pl-8 pr-3 py-1.5 rounded-[8px] text-left transition-colors hover:bg-white/[0.08] cursor-pointer"
                    @click="addLoadNode(opt.nodeType)"
                  >
                    <component :is="opt.icon" class="size-3.5 text-white/60" :stroke-width="1.75" />
                    <span class="text-xs text-white/80 flex-1">{{ opt.label }}</span>
                  </button>
                </template>
              </div>
```

`ChevronDown` — check the existing lucide import; add if absent. `addLoadNode(nodeType)` already dispatches `comfynext:addNode` and closes the submenu (post-Task-1 rename).

- [ ] **Step 4: Verify and commit**

```bash
git add app/layouts/default.vue
git commit -m "feat(ia): Generate toolbar door — curated zero-input AI verbs with pastel marker"
```

---

### Task 4: Visual verification (controller inline)

**Files:** none.

- [ ] Toolbar order reads: Select, Hand | Add, Studios, Generate, Assets | Actions, Styles, Characters, Toolbox | More | Explain. Generate icon carries the pastel dot.
- [ ] Add menu: **Surfaces** (Frame, Smart Layout, Timeline w/ list-video icon) then **Sources** (Image, Text, Audio, Video, Collection, 3D-disabled) with group headers; no studios present.
- [ ] Studios menu: Type (if flag on), Gradient, Shader, Pattern, Shot Director, Lip-Sync; no sparkles icons; pastel dots on Shot Director + Lip-Sync only; clicking Gradient drops a GradientStudio node; clicking Type opens Type Studio path (special-case).
- [ ] Generate menu: Image, Styled image, Video, Audio; Audio expands inline to Music/Speech; clicking Image drops a GenerateImageNode.
- [ ] Menus are mutually exclusive (opening Studios closes Add, etc.); click-away closes; opening a side panel (Actions) closes any open door.
- [ ] Screenshot of each open door for the user.

## Self-review notes

- Spec §2 coverage: Add regroup ✓ (Task 2), Collection→Sources ✓, Timeline→Surfaces ✓, Studios door + icon fixes + pastel ✓ (Task 1), Type Studio included behind existing flag ✓, Generate door w/ 4 items + audio submenu + pastel ✓ (Task 3). Character/CharacterSheet stay out ✓ (never added).
- The submenu-state unification is included in Task 1 because three-plus mutually-exclusive booleans is the file's existing pain becoming acute — targeted improvement per the working-in-existing-code rule, not unrelated refactoring.
- Type consistency: `openSubmenu`/`SubmenuName` defined Task 1, consumed Tasks 2–3; `onLoadOption` reused for studios (same option shape incl. `special`); `addLoadNode` for generate (plain nodeType adds).
