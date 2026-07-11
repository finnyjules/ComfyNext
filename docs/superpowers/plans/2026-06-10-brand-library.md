# Project Brand Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App-wide named brand kits (server-persisted JSON) with a per-project active kit chosen from the ProjectMenu, consumed by Smart Layout today and Kinetic Slates Phase 2 next, through one shared merge helper.

**Architecture:** `BrandKit` moves to `frontend/shared/brand/` (re-exported from template-grid; gains `accent2`). A pure `effectiveBrand()` merges template defaults ← active kit ← wired brand with undefined/empty stripping. File-backed Nuxt endpoints mirror the template endpoints. The active kit id lives on `ProjectDoc.brandKitId`. UI = `BrandKitPanel` (fields, extracted from GridEditorShell) inside `BrandLibraryPopover` (kit CRUD + active toggle), mounted from a Brand row in `ProjectMenu` and from GridEditorShell's existing brand button.

**Tech Stack:** Nuxt 4 (Vue 3 + TS), Nitro server routes (file-backed JSON), vitest (`cd frontend && npx vitest run tests/unit`).

**Spec:** `docs/superpowers/specs/2026-06-10-brand-library-design.md`

**Conventions:** all paths relative to repo root `/Users/julien/Documents/GitHub/Sailor`. Run tests from `frontend/`. Commit after every task. A parallel session may have uncommitted files — stage only your own files explicitly.

---

### Task 1: Shared brand types + accent2

**Files:**
- Create: `frontend/shared/brand/types.ts`
- Modify: `frontend/shared/template-grid/types.ts:85-101` (replace the BrandKit definition with a re-export)

- [ ] **Step 1: Create the shared module**

```ts
// frontend/shared/brand/types.ts
/**
 * Brand kit — the project-level brand roles every themed feature consumes
 * (Smart Layout templates, Kinetic Slates motion templates). Templates bind
 * via `{{ brand.<key> }}` tokens (shared/template-grid/tokens.ts); kits are
 * named entries in the app-wide library (server/brand-kits/*.json) and a
 * project picks its active kit via ProjectDoc.brandKitId.
 */

export interface BrandKit {
  primary?: string
  secondary?: string
  accent?: string
  /** Second gradient stop — slate templates build accent→accent2 gradients
   *  from color roles so the kit itself stays flat JSON. */
  accent2?: string
  foreground?: string
  background?: string
  fontDisplay?: string
  fontBody?: string
  logo?: string        // URL or uploaded-file path
}

export const BRAND_COLOR_KEYS = ['primary', 'secondary', 'accent', 'accent2', 'foreground', 'background'] as const
export type BrandColorKey = typeof BRAND_COLOR_KEYS[number]

export interface BrandKitEntry {
  id: string           // slug, [a-z0-9-]
  name: string         // user-facing, e.g. "LIV Golf 2025"
  kit: BrandKit
  updatedAt: string    // ISO timestamp
}
```

- [ ] **Step 2: Re-export from template-grid**

In `frontend/shared/template-grid/types.ts`, DELETE the `BrandKit` interface and the `BRAND_COLOR_KEYS`/`BrandColorKey` declarations (lines ~85-101, keep the doc comment if it reads well as a pointer) and add at the top of the file:

```ts
export { BRAND_COLOR_KEYS } from '../brand/types'
export type { BrandKit, BrandColorKey } from '../brand/types'
```

CAREFUL: `BRAND_COLOR_KEYS` now includes `'accent2'` — check its consumers (`grep -rn "BRAND_COLOR_KEYS" frontend/app frontend/shared`) and confirm each just iterates color slots for UI/binding (GridEditorShell swatch loop, GridPropertyPanel). Gaining one more swatch is the desired behavior; if any consumer does something positional/exhaustive that breaks, report rather than hack.

- [ ] **Step 3: Verify compile + existing suites**

Run: `cd frontend && npx vitest run tests/unit`
Expected: all pass (template-grid suites exercise the types transitively).

- [ ] **Step 4: Commit**

```bash
git add frontend/shared/brand/types.ts frontend/shared/template-grid/types.ts
git commit -m "Brand library: shared BrandKit types + accent2"
```

---

### Task 2: effectiveBrand merge helper (TDD)

**Files:**
- Create: `frontend/shared/brand/resolve.ts`
- Test: `frontend/tests/unit/brand-resolve.unit.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/tests/unit/brand-resolve.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { effectiveBrand } from '../../shared/brand/resolve'

describe('effectiveBrand', () => {
  const templateDefaults = { primary: '#111111', fontDisplay: 'Poppins', background: '#000000' }
  const activeKit = { primary: '#E2362B', accent: '#A3E635' }
  const wired = { accent: '#FF00FF' }

  it('merge order: template ← active kit ← wired', () => {
    const b = effectiveBrand(templateDefaults, activeKit, wired)
    expect(b.primary).toBe('#E2362B')      // kit over template
    expect(b.accent).toBe('#FF00FF')       // wired over kit
    expect(b.fontDisplay).toBe('Poppins')  // template survives where kit is silent
    expect(b.background).toBe('#000000')
  })
  it('strips undefined and empty-string values so partial kits inherit', () => {
    const b = effectiveBrand(templateDefaults, { primary: '', fontDisplay: undefined, accent: '#A3E635' })
    expect(b.primary).toBe('#111111')      // empty string does NOT clobber
    expect(b.fontDisplay).toBe('Poppins')  // undefined does NOT clobber
    expect(b.accent).toBe('#A3E635')
  })
  it('all arguments optional; no kit ⇒ template defaults verbatim', () => {
    expect(effectiveBrand(templateDefaults)).toEqual(templateDefaults)
    expect(effectiveBrand()).toEqual({})
    expect(effectiveBrand(undefined, activeKit)).toEqual(activeKit)
  })
  it('does not mutate its inputs', () => {
    const t = { ...templateDefaults }
    effectiveBrand(t, activeKit, wired)
    expect(t).toEqual(templateDefaults)
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run tests/unit/brand-resolve.unit.spec.ts` → module not found.

- [ ] **Step 3: Implement**

```ts
// frontend/shared/brand/resolve.ts
import type { BrandKit } from './types'

/** Drop undefined/empty-string entries so partial kits inherit instead of clobbering. */
function compact(kit: BrandKit | undefined): Partial<BrandKit> {
  if (!kit) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(kit)) {
    if (typeof v === 'string' && v !== '') out[k] = v
  }
  return out
}

/**
 * The one brand merge: template defaults ← active project kit ← wired socket
 * brand (the graph stays the ultimate override). Pass the result as the
 * `brand` scope of resolveTokens.
 */
export function effectiveBrand(
  templateDefaults?: BrandKit,
  activeKit?: BrandKit,
  wired?: BrandKit,
): BrandKit {
  return { ...compact(templateDefaults), ...compact(activeKit), ...compact(wired) }
}
```

- [ ] **Step 4: Run to verify PASS**, then the full suite. Commit:

```bash
git add frontend/shared/brand/resolve.ts frontend/tests/unit/brand-resolve.unit.spec.ts
git commit -m "Brand library: effectiveBrand merge with partial-kit stripping"
```

---

### Task 3: Brand-kit server endpoints

**Files:**
- Create: `frontend/server/api/brand-kits/index.get.ts`
- Create: `frontend/server/api/brand-kits/[id].put.ts`
- Create: `frontend/server/api/brand-kits/[id].delete.ts`
- Create: `frontend/server/brand-kits/.gitkeep`

Pattern source: read `frontend/server/api/templates/[id].put.ts` and `index.get.ts` first — these mirror them exactly.

- [ ] **Step 1: index.get.ts**

```ts
// frontend/server/api/brand-kits/index.get.ts
/** List every saved brand kit (full entries — kits are tiny). */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const KITS_DIR = join(process.cwd(), 'server', 'brand-kits')

export default defineEventHandler(async () => {
  let files: string[] = []
  try {
    files = (await readdir(KITS_DIR)).filter(f => f.endsWith('.json'))
  } catch {
    return { kits: [] } // directory missing on fresh checkouts
  }
  const kits = []
  for (const f of files) {
    try {
      kits.push(JSON.parse(await readFile(join(KITS_DIR, f), 'utf8')))
    } catch { /* skip corrupt file */ }
  }
  kits.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { kits }
})
```

- [ ] **Step 2: [id].put.ts**

```ts
// frontend/server/api/brand-kits/[id].put.ts
/** Upsert a brand kit. Body is the full BrandKitEntry; URL id must match. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const KITS_DIR = join(process.cwd(), 'server', 'brand-kits')

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[a-z0-9-]+$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  const body = await readBody<Record<string, any>>(event)
  if (!body || typeof body !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Missing body' })
  }
  if (body.id !== id) {
    throw createError({ statusCode: 400, statusMessage: `Body id '${body.id}' doesn't match URL id '${id}'` })
  }
  if (typeof body.name !== 'string' || !body.name.trim()) {
    throw createError({ statusCode: 400, statusMessage: 'Kit needs a name' })
  }
  if (!body.kit || typeof body.kit !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Kit needs a kit object' })
  }
  body.updatedAt = new Date().toISOString()
  await mkdir(KITS_DIR, { recursive: true })
  await writeFile(join(KITS_DIR, `${id}.json`), JSON.stringify(body, null, 2), 'utf8')
  return { ok: true, id }
})
```

- [ ] **Step 3: [id].delete.ts**

```ts
// frontend/server/api/brand-kits/[id].delete.ts
import { rm } from 'node:fs/promises'
import { join } from 'node:path'

const KITS_DIR = join(process.cwd(), 'server', 'brand-kits')

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[a-z0-9-]+$/i.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid id' })
  }
  await rm(join(KITS_DIR, `${id}.json`), { force: true })
  return { ok: true, id }
})
```

- [ ] **Step 4: Verify against the running dev server** (supervised Nuxt on :3002)

```bash
curl -s -X PUT http://127.0.0.1:3002/api/brand-kits/test-kit -H 'Content-Type: application/json' \
  -d '{"id":"test-kit","name":"Test","kit":{"primary":"#E2362B","accent2":"#22D3EE"}}'
curl -s http://127.0.0.1:3002/api/brand-kits | head -c 300
curl -s -X DELETE http://127.0.0.1:3002/api/brand-kits/test-kit
curl -s http://127.0.0.1:3002/api/brand-kits
```

Expected: `{"ok":true,...}`, list containing test-kit, `{"ok":true,...}`, `{"kits":[]}` (or pre-existing kits without test-kit). Also confirm `frontend/server/brand-kits/test-kit.json` appeared/disappeared on disk during the sequence.

- [ ] **Step 5: Commit**

```bash
git add frontend/server/api/brand-kits frontend/server/brand-kits/.gitkeep
git commit -m "Brand library: file-backed kit endpoints"
```

---

### Task 4: ProjectDoc.brandKitId + library composable

**Files:**
- Modify: `frontend/app/lib/projectDoc.ts` (interface + wrapper preservation)
- Create: `frontend/app/composables/useBrandLibrary.ts`
- Test: `frontend/tests/unit/project-doc-brand.unit.spec.ts`

- [ ] **Step 1: Failing test for doc round-trip**

```ts
// frontend/tests/unit/project-doc-brand.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { toProjectDoc, isProjectDoc } from '../../app/lib/projectDoc'

describe('ProjectDoc.brandKitId', () => {
  it('survives toProjectDoc pass-through for existing docs', () => {
    const doc = toProjectDoc({ canvases: [{ id: 'c1', name: 'Canvas 1', workflow: {} }], activeCanvasId: 'c1', brandKitId: 'liv-golf-2025' })
    expect(isProjectDoc(doc)).toBe(true)
    expect((doc as any).brandKitId).toBe('liv-golf-2025')
  })
  it('legacy bare workflows wrap without a brandKitId', () => {
    const doc = toProjectDoc({ nodes: [], links: [] })
    expect((doc as any).brandKitId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run → FAIL** (first test: property dropped or type error — depending on current pass-through it may pass already; if it passes as-is, note that and keep the test as a pin).

- [ ] **Step 3: Extend the interface**

In `frontend/app/lib/projectDoc.ts`:

```ts
export interface ProjectDoc {
  canvases: ProjectCanvas[]
  activeCanvasId: string
  /** Active brand-library kit for this project (id into /api/brand-kits).
   *  Unset/null ⇒ no brand theming; all consumers behave as before. */
  brandKitId?: string | null
}
```

`toProjectDoc` passes docs through by reference (`if (isProjectDoc(x)) return x`), so the field survives automatically — verify, don't assume.

- [ ] **Step 4: Implement the composable**

```ts
// frontend/app/composables/useBrandLibrary.ts
/**
 * App-wide brand-kit library (file-backed via /api/brand-kits) + the active
 * kit for the current project. The ProjectDoc owns brandKitId; this
 * composable owns fetching/caching the library and resolving the id to a kit.
 */
import { ref, computed, type Ref } from 'vue'
import type { BrandKit, BrandKitEntry } from '~~/shared/brand/types'

const kits = ref<BrandKitEntry[]>([])
const loaded = ref(false)

async function refresh(): Promise<void> {
  try {
    const res = await fetch('/api/brand-kits')
    if (res.ok) kits.value = (await res.json()).kits ?? []
    loaded.value = true
  } catch { /* offline dev — keep last list */ }
}

async function save(entry: BrandKitEntry): Promise<void> {
  const res = await fetch(`/api/brand-kits/${entry.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  })
  if (!res.ok) throw new Error(`save kit failed: ${res.status}`)
  await refresh()
}

async function remove(id: string): Promise<void> {
  await fetch(`/api/brand-kits/${id}`, { method: 'DELETE' })
  await refresh()
}

export function slugifyKitName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'kit'
}

export function useBrandLibrary(activeKitId?: Ref<string | null | undefined>) {
  if (!loaded.value) void refresh()
  const activeKit = computed<BrandKit | undefined>(() => {
    const id = activeKitId?.value
    if (!id) return undefined
    return kits.value.find(k => k.id === id)?.kit
  })
  const activeEntry = computed(() => kits.value.find(k => k.id === activeKitId?.value) ?? null)
  return { kits, loaded, refresh, save, remove, activeKit, activeEntry }
}
```

- [ ] **Step 5: Tests PASS + full suite. Commit:**

```bash
git add frontend/app/lib/projectDoc.ts frontend/app/composables/useBrandLibrary.ts frontend/tests/unit/project-doc-brand.unit.spec.ts
git commit -m "Brand library: ProjectDoc.brandKitId + useBrandLibrary composable"
```

---

### Task 5: BrandKitPanel + BrandLibraryPopover components

**Files:**
- Create: `frontend/app/components/brand/BrandKitPanel.vue`
- Create: `frontend/app/components/brand/BrandLibraryPopover.vue`

Source material: read GridEditorShell.vue lines 161-343 (the inline brand popover: color/hex field pattern, `TemplatesFontPicker` usage, container styling) — BrandKitPanel reproduces those field rows generically.

- [ ] **Step 1: BrandKitPanel.vue** — pure field editor, v-model style:

```vue
<!-- frontend/app/components/brand/BrandKitPanel.vue -->
<script setup lang="ts">
import { BRAND_COLOR_KEYS, type BrandKit } from '~~/shared/brand/types'

const props = defineProps<{ kit: BrandKit }>()
const emit = defineEmits<{ update: [patch: Partial<BrandKit>] }>()

const COLOR_LABELS: Record<string, string> = {
  primary: 'Primary', secondary: 'Secondary', accent: 'Accent',
  accent2: 'Accent 2', foreground: 'Foreground', background: 'Background',
}

function setColor(key: string, v: string) { emit('update', { [key]: v }) }

async function onLogoFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const fd = new FormData()
  fd.append('image', file)
  fd.append('overwrite', 'true')
  const res = await fetch('/upload/image', { method: 'POST', body: fd })
  if (res.ok) {
    const data = await res.json() as { name?: string; subfolder?: string }
    const name = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name ?? '')
    if (name) emit('update', { logo: `/view?filename=${encodeURIComponent(name)}&type=input` })
  }
}
</script>

<template>
  <div class="space-y-2 text-xs">
    <div v-for="key in BRAND_COLOR_KEYS" :key="key" class="flex items-center justify-between gap-2">
      <span class="text-white/60">{{ COLOR_LABELS[key] }}</span>
      <span class="flex items-center gap-1">
        <input
          type="color" :value="kit[key] || '#000000'"
          class="size-6 rounded border border-white/10 bg-transparent p-0"
          @input="setColor(key, ($event.target as HTMLInputElement).value)"
        >
        <input
          type="text" :value="kit[key] ?? ''" placeholder="unset"
          class="w-20 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
          @change="setColor(key, ($event.target as HTMLInputElement).value.trim())"
        >
      </span>
    </div>
    <div class="flex items-center justify-between gap-2">
      <span class="text-white/60">Display font</span>
      <TemplatesFontPicker :model-value="kit.fontDisplay ?? ''" @update:model-value="(v: string) => emit('update', { fontDisplay: v })" />
    </div>
    <div class="flex items-center justify-between gap-2">
      <span class="text-white/60">Body font</span>
      <TemplatesFontPicker :model-value="kit.fontBody ?? ''" @update:model-value="(v: string) => emit('update', { fontBody: v })" />
    </div>
    <div class="space-y-1">
      <span class="text-white/60">Logo</span>
      <input
        type="text" :value="kit.logo ?? ''" placeholder="https://… or upload"
        class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
        @change="emit('update', { logo: ($event.target as HTMLInputElement).value.trim() })"
      >
      <label class="inline-block px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.1] cursor-pointer text-white/70">
        Upload<input type="file" accept="image/*" class="hidden" @change="onLogoFile">
      </label>
    </div>
  </div>
</template>
```

(NOTE: the FontPicker component file is `frontend/app/components/templates/FontPicker.vue` with `modelValue: string` — Nuxt auto-import name `TemplatesFontPicker`. Verify the auto-import name compiles; adjust if the project registers it differently.)

- [ ] **Step 2: BrandLibraryPopover.vue** — library management hosting the panel:

```vue
<!-- frontend/app/components/brand/BrandLibraryPopover.vue -->
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { BrandKit, BrandKitEntry } from '~~/shared/brand/types'
import { useBrandLibrary, slugifyKitName } from '~/composables/useBrandLibrary'

const props = defineProps<{ activeKitId: string | null | undefined }>()
const emit = defineEmits<{ 'set-active': [id: string | null] }>()

const activeIdRef = computed(() => props.activeKitId)
const { kits, refresh, save, remove } = useBrandLibrary(activeIdRef)
void refresh()

const selectedId = ref<string | null>(props.activeKitId ?? null)
watch(() => props.activeKitId, (v) => { if (v) selectedId.value = v })
const selected = computed<BrandKitEntry | null>(() =>
  kits.value.find(k => k.id === selectedId.value) ?? null)

async function newKit() {
  const name = `Kit ${kits.value.length + 1}`
  const entry: BrandKitEntry = { id: `${slugifyKitName(name)}-${Date.now().toString(36)}`, name, kit: {}, updatedAt: '' }
  await save(entry)
  selectedId.value = entry.id
}
async function duplicateKit() {
  if (!selected.value) return
  const src = selected.value
  const entry: BrandKitEntry = { id: `${src.id}-copy-${Date.now().toString(36)}`, name: `${src.name} copy`, kit: { ...src.kit }, updatedAt: '' }
  await save(entry)
  selectedId.value = entry.id
}
async function renameKit(name: string) {
  if (!selected.value || !name.trim()) return
  await save({ ...selected.value, name: name.trim() })
}
async function deleteKit() {
  if (!selected.value) return
  const id = selected.value.id
  await remove(id)
  if (props.activeKitId === id) emit('set-active', null)
  selectedId.value = kits.value[0]?.id ?? null
}
async function patchKit(patch: Partial<BrandKit>) {
  if (!selected.value) return
  await save({ ...selected.value, kit: { ...selected.value.kit, ...patch } })
}

const SWATCH_KEYS = ['primary', 'accent', 'accent2'] as const
</script>

<template>
  <div class="w-80 rounded-xl bg-[#111113] border border-white/10 p-3 space-y-3 text-xs shadow-2xl">
    <div class="flex items-center justify-between">
      <span class="font-medium text-white/80">Brand kits</span>
      <span class="flex gap-1">
        <button class="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.1] text-white/70" @click="newKit">New</button>
        <button v-if="selected" class="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.1] text-white/70" @click="duplicateKit">Duplicate</button>
        <button v-if="selected" class="px-2 py-0.5 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-300" @click="deleteKit">Delete</button>
      </span>
    </div>
    <div v-if="!kits.length" class="text-white/40">No kits yet — create one.</div>
    <div v-for="k in kits" :key="k.id"
         class="flex items-center justify-between gap-2 px-2 py-1 rounded cursor-pointer"
         :class="selectedId === k.id ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'"
         @click="selectedId = k.id">
      <span class="flex items-center gap-2 min-w-0">
        <span class="flex gap-0.5 shrink-0">
          <span v-for="s in SWATCH_KEYS" :key="s" class="size-3 rounded-sm border border-white/10"
                :style="{ background: k.kit[s] || 'transparent' }" />
        </span>
        <span class="truncate text-white/80">{{ k.name }}</span>
      </span>
      <button
        class="px-1.5 py-0.5 rounded text-[10px]"
        :class="activeKitId === k.id ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/[0.06] text-white/50 hover:bg-white/[0.1]'"
        @click.stop="emit('set-active', activeKitId === k.id ? null : k.id)"
      >{{ activeKitId === k.id ? 'Active' : 'Set active' }}</button>
    </div>
    <div v-if="selected" class="pt-2 border-t border-white/10 space-y-2">
      <input
        :value="selected.name"
        class="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
        @change="renameKit(($event.target as HTMLInputElement).value)"
      >
      <BrandKitPanel :kit="selected.kit" @update="patchKit" />
    </div>
  </div>
</template>
```

(`BrandKitPanel` auto-imports as `BrandKitPanel` or `BrandBrandKitPanel` depending on the project's auto-import config for the new `brand/` directory — check how `vue-canvas/` components are referenced (e.g. `VueCanvasProjectMenu` in layouts/default.vue) and use the directory-prefixed name accordingly.)

- [ ] **Step 3: Compile check** — `npx vitest run tests/unit` (smoke) + `npx nuxt typecheck 2>&1 | tail -5` if configured; fix auto-import names.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/brand/
git commit -m "Brand library: BrandKitPanel + BrandLibraryPopover components"
```

---

### Task 6: ProjectMenu Brand row + layout wiring

**Files:**
- Modify: `frontend/app/components/vue-canvas/ProjectMenu.vue` (props/emits + a Brand section in the dropdown)
- Modify: `frontend/app/layouts/default.vue:~2578` (pass doc.brandKitId, handle set-brand-kit)

- [ ] **Step 1: Extend ProjectMenu**

Props: add `brandKitId?: string | null` and `brandKitName?: string | null` and `brandSwatches?: string[]`. Emits: add `setBrandKit: [id: string | null]`.

In the dropdown template, after the canvases section and before VERSIONS (read the template around line 264 to place it), add:

```vue
      <!-- Brand -->
      <div class="px-2 pt-2 border-t border-white/10">
        <button
          class="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] text-left"
          @click.stop="brandOpen = !brandOpen"
        >
          <span class="flex items-center gap-2 text-white/70">
            <span class="flex gap-0.5">
              <span v-for="(c, i) in (brandSwatches ?? [])" :key="i" class="size-3 rounded-sm border border-white/10" :style="{ background: c }" />
            </span>
            <span>{{ brandKitName ?? 'No brand kit' }}</span>
          </span>
          <span class="text-white/30 text-[10px]">Brand</span>
        </button>
        <BrandLibraryPopover
          v-if="brandOpen"
          class="mt-1"
          :active-kit-id="brandKitId"
          @set-active="(id) => emit('setBrandKit', id)"
        />
      </div>
```

with `const brandOpen = ref(false)` in the script (reset it to false in whatever watcher closes the dropdown — find where `open` resets). Use the verified auto-import name for the popover from Task 5.

- [ ] **Step 2: Wire the layout**

In `frontend/app/layouts/default.vue` at the `<VueCanvasProjectMenu` mount (~line 2578): bind the new props from the layout's project doc and handle the emit by setting `doc.brandKitId = id` through the same mutation path other doc edits use (canvas rename/add — read the neighboring handlers, e.g. `@addCanvas`/`@renameCanvas`, and mirror their persistence call). For `brandKitName`/`brandSwatches`, use `useBrandLibrary(computed(() => doc?.brandKitId))`'s `activeEntry`:

```ts
const brandLib = useBrandLibrary(computed(() => (projectDoc.value as any)?.brandKitId))
const brandKitName = computed(() => brandLib.activeEntry.value?.name ?? null)
const brandSwatches = computed(() => {
  const k = brandLib.activeEntry.value?.kit
  return k ? [k.primary, k.accent, k.accent2].filter(Boolean) as string[] : []
})
```

(`projectDoc` = whatever ref the layout passes as `:doc` today — read the mount and reuse it. Persisting: doc mutations flow through the layout's existing autosave; confirm by finding how `renameCanvas` persists.)

- [ ] **Step 3: Browser verification** (Nuxt :3002, Chrome MCP or preview tools)

1. Open the app, open the top-left project menu → Brand row shows "No brand kit".
2. Open it → New kit → set primary/accent/accent2 colors + a display font → "Set active" → row shows name + 3 swatches.
3. Reload the page → active kit still set (ProjectDoc autosave round-trip).
4. Second project/tab → its menu shows "No brand kit" (per-project isolation).

- [ ] **Step 4: Commit**

```bash
git add frontend/app/components/vue-canvas/ProjectMenu.vue frontend/app/layouts/default.vue
git commit -m "Brand library: ProjectMenu brand row + per-project active kit"
```

---

### Task 7: Smart Layout adopts effectiveBrand

**Files:**
- Modify: `frontend/app/composables/useGridEditor.ts:56-66` (merge via shared helper, accept active kit)
- Modify: `frontend/app/components/templates/GridEditorShell.vue` (new optional prop `activeKit`, swap inline brand popover body for the shared panel where it edits TEMPLATE defaults — see note)
- Modify: the GridEditorShell call site (`grep -rn "<TemplatesGridEditorShell\|<GridEditorShell" frontend/app`) to pass the active kit
- Test: `frontend/tests/unit/brand-grid-regression.unit.spec.ts`

NOTE ON SCOPE: GridEditorShell's existing popover edits the TEMPLATE's default brand (`ctx.setBrand`). That stays — it edits `template.brand`, not the library. The change here is (a) resolution: the active PROJECT kit slots between template defaults and the wired/sample brand; (b) the popover gains a small "Project kit: <name> (overrides these defaults)" hint line when an active kit exists. Do NOT replace the template-default editor with the library editor — they edit different layers of the merge.

- [ ] **Step 1: Failing regression + merge test**

```ts
// frontend/tests/unit/brand-grid-regression.unit.spec.ts
import { describe, it, expect } from 'vitest'
import { effectiveBrand } from '../../shared/brand/resolve'
import { resolveTokens } from '../../shared/template-grid/tokens'

describe('grid brand resolution with the shared merge', () => {
  const template = { primary: '#111111', fontDisplay: 'Poppins' }
  it('no active kit + no wired ⇒ template defaults verbatim (regression)', () => {
    const b = effectiveBrand(template, undefined, undefined)
    expect(resolveTokens('{{ brand.primary }}', {}, b)).toBe('#111111')
    expect(resolveTokens('{{ brand.fontDisplay }}', {}, b)).toBe('Poppins')
  })
  it('active kit slots between template and wired', () => {
    const b = effectiveBrand(template, { primary: '#E2362B' }, { primary: '#00FF00' })
    expect(resolveTokens('{{ brand.primary }}', {}, b)).toBe('#00FF00')
    const noWire = effectiveBrand(template, { primary: '#E2362B' })
    expect(resolveTokens('{{ brand.primary }}', {}, noWire)).toBe('#E2362B')
  })
  it('accent2 resolves through tokens', () => {
    const b = effectiveBrand(undefined, { accent2: '#22D3EE' })
    expect(resolveTokens('{{ brand.accent2 }}', {}, b)).toBe('#22D3EE')
  })
})
```

- [ ] **Step 2: Run → first run may PASS already** (it tests the shared pieces) — that's fine, it's the pin. The real change follows.

- [ ] **Step 3: useGridEditor merge**

Read `useGridEditor.ts:40-70`. The current computed is:

```ts
  const effectiveBrand = computed<Record<string, unknown>>(() => ({
    ...(template.value.brand ?? {}),
    ...sampleBrand.value,   // ← confirm the exact second spread by reading the file
  }))
```

Change to (rename local to avoid clashing with the import):

```ts
import { effectiveBrand as mergeBrand } from '~~/shared/brand/resolve'
// the composable gains an option: activeKit?: Ref<BrandKit | undefined>
  const effectiveBrand = computed<Record<string, unknown>>(() =>
    mergeBrand(template.value.brand, opts?.activeKit?.value, sampleBrand.value as BrandKit))
```

Add `activeKit` to the composable's options object (read its signature; if it takes positional args, add an options param non-breakingly). All existing callers omit it ⇒ unchanged behavior (the regression test pins the semantics; the full template-grid suite pins the rest).

- [ ] **Step 4: Thread the kit into the editor**

GridEditorShell: add `activeKit?: BrandKit` prop, pass into the `useGridEditor`/ctx creation (find where `ctx` is constructed — `const ctx = ...` near the top, possibly in the parent SmartLayoutEditorModal; trace `initialBrand` to find the seam) and into the brand popover hint:

```vue
<div v-if="activeKit" class="text-[10px] text-white/40 px-1">
  Project kit overrides these template defaults.
</div>
```

Call site (SmartLayoutEditorModal or wherever the shell mounts): `:active-kit="brandLib.activeKit.value"` using `useBrandLibrary(computed(() => doc?.brandKitId))` — reuse the same wiring pattern as Task 6's layout change; if the modal can't see the project doc, lift the active kit through a provide/inject or a prop from the layout (pick whichever the modal's existing data flow uses — read how it receives other app-level state).

- [ ] **Step 5: Full suite + browser check**

`npx vitest run tests/unit` — all green (especially `template-grid-*` suites untouched).
Browser: with an active kit set (Task 6), open Smart Layout grid editor on an archetype → elements bound to `{{ brand.primary }}` show the KIT's primary, not the archetype default; clear active kit → archetype defaults return.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/composables/useGridEditor.ts frontend/app/components/templates/GridEditorShell.vue frontend/tests/unit/brand-grid-regression.unit.spec.ts <call-site file>
git commit -m "Smart Layout: resolve brand through shared effectiveBrand with project kit"
```

---

### Task 8: Compositor entry point + acceptance pass

**Files:**
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (Brand button → popover)

- [ ] **Step 1: Mount the popover in the Compositor modal**

Add a "Brand" toolbar button next to the Motion button (Task 6 of the kinetic plan added Motion — grep `Motion preview` / `loadSlateFixture` for the toolbar block; copy neighbor classes). It toggles a floating `BrandLibraryPopover` anchored near the toolbar. Active-kit binding: the modal needs the project doc's `brandKitId` — read how the modal receives app-level context; if nothing suitable exists, the layout already computes `brandLib`/doc (Task 6): lift via `provide('sailor:brandKit', { activeKitId, setActive })` in the layout and `inject` in the modal (typed key in `frontend/app/lib/` if the project has an injection-keys convention — grep `InjectionKey` first and follow it).

```vue
<BrandLibraryPopover
  v-if="brandOpen"
  class="absolute top-12 right-4 z-30"
  :active-kit-id="injectedBrand?.activeKitId.value ?? null"
  @set-active="(id) => injectedBrand?.setActive(id)"
/>
```

- [ ] **Step 2: Acceptance run (browser)**

1. Create kit "LIV Test" (lime primary `#A3E635`, cyan accent2 `#22D3EE`, Archivo Black display), set active from the project menu.
2. Smart Layout: archetype gallery/grid editor shows kit colors (Task 7 check).
3. Compositor modal: Brand button opens the same library; switching the active kit there reflects back in the project menu (single source of truth).
4. Reload → everything persists. Screenshot the menu row + a themed archetype as proof.

- [ ] **Step 3: Full suite, commit**

```bash
git add frontend/app/components/vue-canvas/CompositorModal.vue <any injection-key file>
git commit -m "Brand library: Compositor entry point + acceptance"
```

---

## Out of scope (per spec)

Slate templates consuming the kit (that's the Phase 2 templates plan, which builds ON this), AI brand extraction, logo variants, re-theming placed content, migrating per-template brands.

## Risks for the implementer

- **Auto-import names** for the new `brand/` component directory — verify against how `vue-canvas/` components resolve (e.g. `VueCanvasProjectMenu`) before assuming.
- **`BRAND_COLOR_KEYS` + accent2** ripples into every swatch loop — that's intended, but check GridPropertyPanel doesn't overflow its layout with 6 swatches.
- **Two brand layers in the grid editor** (template defaults vs project kit) is the confusable part — the hint line in Task 7 step 4 is the mitigation; don't merge the two editors.
- **Parallel sessions**: stage only your own files; `git status` before every commit.
