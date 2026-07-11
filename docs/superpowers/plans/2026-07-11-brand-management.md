# Brand Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote Sailor's project-scoped brand-kit system into a top-level Brand page with logo variants + asset collections, and wire brand values into Frame (fill swatches, image picker, text-font defaults) and Smart Layout (logo-slot tokens, asset quick-picks).

**Architecture:** Extend the existing `BrandKit` schema with optional `logos` (slot object) and `assets` (array) fields — no migration; the file-backed `/api/brand-kits` store and `sailor:brand` provide/inject stay the single source of truth. A new singleton `brand` tab renders a Studio page built from the same panel components the in-project popover uses. Frame surfaces consume brand via `inject('sailor:brand')` at three points: `FillControl`, `useLocalLayerEditor.addText`, and a new `BrandImagePicker`.

**Tech Stack:** Nuxt 4 (Vue 3 + TypeScript + Tailwind), Vitest, file-backed Nitro API. No Pinia — module-singleton composables.

**Spec:** `docs/superpowers/specs/2026-07-11-brand-management-design.md`

## Global Constraints

- All frontend work happens in `frontend/`; run commands from `/Users/julien/Documents/GitHub/Sailor/frontend`.
- Unit tests: `npm run test:unit -- <file>` (Vitest). Test files live in `frontend/tests/unit/*.unit.spec.ts`.
- Shared (server+client) code imports via `~~/shared/...`; app code via `~/...`. Components auto-import by path: `app/components/brand/KitPanel.vue` → `<BrandKitPanel>`.
- Kit edits PUT the **whole kit** on every change — use `@change`, never `@input`, on kit-editing controls (a picker drag would spam the API).
- New brand fields are **optional**; existing kit JSON files (`frontend/server/brand-kits/*.json`) must load unchanged. Legacy `kit.logo` (string) keeps working everywhere.
- UI idiom: dark Tailwind (`bg-[#1a1a1a]`, `border-[#2a2a2a]`, `text-white/60` etc.) — match neighboring components.
- Brand state flows through `inject('sailor:brand')` (`{ activeKit, activeKitId, setBrandKit }`, provided in `app/layouts/default.vue:1580`). Never create a parallel channel.
- When no brand kit is assigned, every new brand affordance is **hidden** (`v-if`), not disabled.
- Commit after each task: `git add <files> && git commit -m "..."`.

---

### Task 1: Schema + resolve extensions (`logos`, `assets`, `brandLogoUrl`, KV slots)

**Files:**
- Modify: `frontend/shared/brand/types.ts`
- Modify: `frontend/shared/brand/resolve.ts`
- Test: `frontend/tests/unit/brand-resolve.unit.spec.ts`
- Test: `frontend/tests/unit/brand-kv.unit.spec.ts`

**Interfaces:**
- Consumes: existing `BrandKit`, `BRAND_COLOR_KEYS`, `effectiveBrand`, `brandKitToKv`.
- Produces (later tasks rely on these exact names):
  - `interface BrandLogoSlots { primary?: string; mark?: string; wordmark?: string; onDark?: string }`
  - `const BRAND_LOGO_SLOT_KEYS = ['primary', 'mark', 'wordmark', 'onDark'] as const` and `type BrandLogoSlotKey`
  - `interface BrandAsset { id: string; name: string; path: string }` (`path` is a `/view?...` or external URL)
  - `BrandKit.logos?: BrandLogoSlots`, `BrandKit.assets?: BrandAsset[]`
  - `brandLogoUrl(kit: BrandKit | undefined, slot?: BrandLogoSlotKey): string | undefined` — `logos[slot] ?? (slot === 'primary' ? kit.logo : undefined)`
  - `effectiveBrand(...)` result now: merges `logos` per-slot across layers; sets `out.logo = logos.primary` when `logo` is unset (back-compat for `{{ brand.logo }}`)
  - `brandKitToKv(...)` now: the `logo=` line carries the effective primary (`logos.primary ?? logo`); additional `logos.<slot>=<url>` lines follow. `assets` are never serialized to KV.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/tests/unit/brand-resolve.unit.spec.ts` (inside the existing file, as a new `describe` block after the existing one):

```ts
import { brandLogoUrl } from '../../shared/brand/resolve'

describe('logos + assets extensions', () => {
  it('brandLogoUrl: slot wins, legacy logo is the primary fallback', () => {
    expect(brandLogoUrl({ logo: '/view?filename=old.png&type=input' })).toBe('/view?filename=old.png&type=input')
    expect(brandLogoUrl({ logo: '/view?filename=old.png&type=input', logos: { primary: '/view?filename=new.png&type=input' } }))
      .toBe('/view?filename=new.png&type=input')
    expect(brandLogoUrl({ logo: '/view?filename=old.png&type=input' }, 'mark')).toBeUndefined()
    expect(brandLogoUrl({ logos: { mark: '/view?filename=m.png&type=input' } }, 'mark')).toBe('/view?filename=m.png&type=input')
    expect(brandLogoUrl(undefined)).toBeUndefined()
  })
  it('effectiveBrand merges logos per-slot across layers', () => {
    const b = effectiveBrand(
      { logos: { primary: '/t-p.png', mark: '/t-m.png' } },
      { logos: { primary: '/k-p.png' } },
    )
    expect(b.logos).toEqual({ primary: '/k-p.png', mark: '/t-m.png' })
  })
  it('effectiveBrand back-fills legacy logo from logos.primary', () => {
    expect(effectiveBrand(undefined, { logos: { primary: '/k-p.png' } }).logo).toBe('/k-p.png')
    // explicit legacy logo is NOT clobbered
    expect(effectiveBrand(undefined, { logo: '/old.png', logos: { mark: '/m.png' } }).logo).toBe('/old.png')
  })
  it('effectiveBrand strips empty logo slots and keeps non-empty asset lists', () => {
    const b = effectiveBrand(undefined, {
      logos: { primary: '', mark: '/m.png' },
      assets: [{ id: 'a1', name: 'Pattern', path: '/p.png' }],
    })
    expect(b.logos).toEqual({ mark: '/m.png' })
    expect(b.assets).toEqual([{ id: 'a1', name: 'Pattern', path: '/p.png' }])
    expect(effectiveBrand(undefined, { assets: [] }).assets).toBeUndefined()
  })
})
```

(The existing `import { effectiveBrand } from '../../shared/brand/resolve'` line already covers `effectiveBrand`; merge the `brandLogoUrl` import into it.)

Append to `frontend/tests/unit/brand-kv.unit.spec.ts`:

```ts
describe('brandKitToKv — logo slots', () => {
  it('logo= line carries the effective primary; slots serialize as dotted keys', () => {
    expect(brandKitToKv({
      primary: '#0a0a0a',
      logos: { primary: '/view?filename=p.png&type=input', mark: '/view?filename=m.png&type=input' },
    })).toBe([
      'primary=#0a0a0a',
      'logo=/view?filename=p.png&type=input',
      'logos.primary=/view?filename=p.png&type=input',
      'logos.mark=/view?filename=m.png&type=input',
    ].join('\n'))
  })
  it('legacy logo still emits when no slots exist', () => {
    expect(brandKitToKv({ logo: '/old.png' })).toBe('logo=/old.png')
  })
  it('assets never serialize to KV', () => {
    expect(brandKitToKv({ assets: [{ id: 'a', name: 'x', path: '/x.png' }] })).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- tests/unit/brand-resolve.unit.spec.ts tests/unit/brand-kv.unit.spec.ts`
Expected: FAIL — `brandLogoUrl` is not exported; logos merge/KV assertions fail.

- [ ] **Step 3: Implement the schema and resolve changes**

In `frontend/shared/brand/types.ts`, after the `BrandKit` interface's `logo` field and before `BRAND_COLOR_KEYS`, replace the interface and add the new types:

```ts
export interface BrandLogoSlots {
  primary?: string   // /view?filename=…&type=input or external URL
  mark?: string      // square mark / favicon-style
  wordmark?: string
  onDark?: string    // light-on-dark variant
}

export interface BrandAsset {
  id: string
  name: string
  path: string       // /view?… or external URL
}

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
  logo?: string        // legacy single logo; logos.primary wins when set
  logos?: BrandLogoSlots
  assets?: BrandAsset[]
}

export const BRAND_LOGO_SLOT_KEYS = ['primary', 'mark', 'wordmark', 'onDark'] as const
export type BrandLogoSlotKey = typeof BRAND_LOGO_SLOT_KEYS[number]
```

In `frontend/shared/brand/resolve.ts`, replace `compact`, `effectiveBrand`, and `brandKitToKv`, and add `brandLogoUrl`:

```ts
import type { BrandKit, BrandLogoSlots, BrandLogoSlotKey } from './types'
import { BRAND_COLOR_KEYS, BRAND_LOGO_SLOT_KEYS } from './types'

/** Drop undefined/empty-string entries so partial kits inherit instead of
 *  clobbering. `logos` is compacted per-slot; empty `assets` lists drop. */
function compact(kit: BrandKit | undefined): Partial<BrandKit> {
  if (!kit) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(kit)) {
    if (typeof v === 'string' && v !== '') out[k] = v
    else if (k === 'logos' && v && typeof v === 'object' && !Array.isArray(v)) {
      const slots: Record<string, string> = {}
      for (const [sk, sv] of Object.entries(v)) {
        if (typeof sv === 'string' && sv !== '') slots[sk] = sv
      }
      if (Object.keys(slots).length) out.logos = slots
    }
    else if (k === 'assets' && Array.isArray(v) && v.length) out.assets = v
  }
  return out as Partial<BrandKit>
}

/**
 * The one brand merge: template defaults ← active project kit ← wired socket
 * brand (the graph stays the ultimate override). Logo slots merge per-slot;
 * `logo` back-fills from `logos.primary` so `{{ brand.logo }}` keeps working.
 */
export function effectiveBrand(
  templateDefaults?: BrandKit,
  activeKit?: BrandKit,
  wired?: BrandKit,
): BrandKit {
  const layers = [compact(templateDefaults), compact(activeKit), compact(wired)]
  const out: BrandKit = Object.assign({}, ...layers)
  const logos: BrandLogoSlots = Object.assign({}, ...layers.map(l => l.logos ?? {}))
  if (Object.keys(logos).length) out.logos = logos
  else delete out.logos
  if (!out.logo && logos.primary) out.logo = logos.primary
  return out
}

/** Resolve a logo slot with legacy fallback: logos[slot], then (primary only)
 *  the legacy kit.logo string. */
export function brandLogoUrl(kit: BrandKit | undefined, slot: BrandLogoSlotKey = 'primary'): string | undefined {
  if (!kit) return undefined
  return kit.logos?.[slot] ?? (slot === 'primary' ? (kit.logo || undefined) : undefined)
}

// Stable serialization order: colors first, then fonts, then logo(s).
const KV_ORDER: readonly string[] = [...BRAND_COLOR_KEYS, 'fontDisplay', 'fontBody', 'logo']

/**
 * Serialize a kit as `key=value` lines — the SmartLayout node's brand wire
 * format (parsed by splitting each line on the FIRST `=`, so values may
 * contain `=`, e.g. logo URLs). The `logo=` line carries the effective primary
 * (logos.primary ?? logo); slots follow as `logos.<slot>=` dotted keys, which
 * the backend keeps as flat dict keys — resolveTokens looks those up flat-first.
 * `assets` are UI-side quick-picks, never template tokens: not serialized.
 * Empty kit ⇒ empty string, which submit-time injection treats as "don't touch
 * the widget" — workflows without an active kit submit byte-identical values.
 */
export function brandKitToKv(kit: BrandKit): string {
  const c = compact(kit) as Record<string, unknown> & { logos?: BrandLogoSlots }
  const lines: string[] = []
  for (const k of KV_ORDER) {
    if (k === 'logo') {
      const logo = c.logos?.primary ?? (c.logo as string | undefined)
      if (logo != null) lines.push(`logo=${logo}`)
      continue
    }
    if (c[k] != null) lines.push(`${k}=${c[k]}`)
  }
  for (const slot of BRAND_LOGO_SLOT_KEYS) {
    const v = c.logos?.[slot]
    if (v != null) lines.push(`logos.${slot}=${v}`)
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- tests/unit/brand-resolve.unit.spec.ts tests/unit/brand-kv.unit.spec.ts`
Expected: PASS (all existing cases in both files must also still pass — they pin the back-compat contract).

- [ ] **Step 5: Run the full unit suite to catch downstream breakage**

Run: `npm run test:unit`
Expected: PASS. `brand-grid-regression.unit.spec.ts` and the smart-layout agent-surface specs exercise `effectiveBrand`/`brandKitToKv` indirectly — if any fail, the back-compat contract above is broken; fix `resolve.ts`, not the tests.

- [ ] **Step 6: Commit**

```bash
git add shared/brand/types.ts shared/brand/resolve.ts tests/unit/brand-resolve.unit.spec.ts tests/unit/brand-kv.unit.spec.ts
git commit -m "feat(brand): logo slots + asset collection in BrandKit schema"
```

---

### Task 2: Deep token paths — `{{ brand.logos.mark }}`

**Files:**
- Modify: `frontend/shared/template-grid/tokens.ts`
- Test: `frontend/tests/unit/template-grid-tokens.unit.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `resolveTokens` resolves dotted paths beyond two segments. Lookup order per scope: **flat dotted key first** (`brand['logos.mark']` — the Python SmartLayout node parses KV into a flat dict, `comfy_extras/nodes_smart_layout.py:539-546`), **then nested walk** (`brand.logos.mark` — the frontend editor passes the nested `effectiveBrand` result). Two-segment behavior is unchanged.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('resolveTokens', ...)` block of `frontend/tests/unit/template-grid-tokens.unit.spec.ts`:

```ts
  it('resolves deep paths on nested scopes (editor-side effectiveBrand)', () => {
    const brand = { logos: { mark: '/view?filename=m.png&type=input' } }
    expect(resolveTokens('{{ brand.logos.mark }}', {}, brand)).toBe('/view?filename=m.png&type=input')
  })
  it('resolves flat dotted keys first (backend KV-parsed dicts)', () => {
    const brand = { 'logos.mark': '/flat.png', logos: { mark: '/nested.png' } }
    expect(resolveTokens('{{ brand.logos.mark }}', {}, brand)).toBe('/flat.png')
  })
  it('missing deep paths blank in mixed strings and pass through whole tokens', () => {
    expect(resolveTokens('x {{ brand.logos.mark }} y', {}, {})).toBe('x  y')
    expect(resolveTokens('{{ brand.logos.mark }}', {}, {})).toBe('{{ brand.logos.mark }}')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- tests/unit/template-grid-tokens.unit.spec.ts`
Expected: FAIL — deep path resolves to the `logos` object (stringified) or `undefined`, not the slot value.

- [ ] **Step 3: Implement deep lookup**

In `frontend/shared/template-grid/tokens.ts`, replace the `lookup` function inside `resolveTokens`:

```ts
  const lookup = (path: string): unknown => {
    const [scope, ...rest] = path.split('.')
    const root = scope === 'props' ? props : scope === 'brand' ? brand : undefined
    if (!root || !rest.length) return undefined
    // Flat-first: backend KV parsing produces flat dotted keys ('logos.mark').
    const flat = rest.join('.')
    if (flat in root) return root[flat]
    // Nested walk: editor-side scopes are real objects.
    let cur: unknown = root
    for (const seg of rest) {
      if (cur == null || typeof cur !== 'object') return undefined
      cur = (cur as Record<string, unknown>)[seg]
    }
    return cur
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- tests/unit/template-grid-tokens.unit.spec.ts`
Expected: PASS, including the four pre-existing cases.

- [ ] **Step 5: Commit**

```bash
git add shared/template-grid/tokens.ts tests/unit/template-grid-tokens.unit.spec.ts
git commit -m "feat(template-grid): deep token paths for brand logo slots"
```

---

### Task 3: Asset URL helpers (`inputNameFromViewUrl`, `uploadBrandImage`)

**Files:**
- Create: `frontend/shared/brand/assets.ts`
- Create: `frontend/app/lib/brand/upload.ts`
- Test: `frontend/tests/unit/brand-assets.unit.spec.ts`

**Interfaces:**
- Produces:
  - `inputNameFromViewUrl(url: string): string | null` (in `~~/shared/brand/assets`) — extracts the ComfyUI input filename from a `/view?filename=…&type=input` URL; `null` for anything else (external URLs, output-type views). Tasks 6–7 use it to feed `addImageFromName`.
  - `uploadBrandImage(file: File): Promise<string>` (in `~/lib/brand/upload`) — uploads via `POST /upload/image` and returns the `/view?...&type=input` URL. Tasks 4 and 7 use it. Network-bound: no unit test; exercised in preview verification.

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/unit/brand-assets.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { inputNameFromViewUrl } from '../../shared/brand/assets'

describe('inputNameFromViewUrl', () => {
  it('extracts the filename from an input view URL', () => {
    expect(inputNameFromViewUrl('/view?filename=brand_logo.png&type=input')).toBe('brand_logo.png')
    expect(inputNameFromViewUrl('/view?filename=sub%2Flogo.png&type=input')).toBe('sub/logo.png')
  })
  it('defaults missing type to input', () => {
    expect(inputNameFromViewUrl('/view?filename=a.png')).toBe('a.png')
  })
  it('rejects non-input views and external URLs', () => {
    expect(inputNameFromViewUrl('/view?filename=a.png&type=output')).toBeNull()
    expect(inputNameFromViewUrl('https://example.com/logo.png')).toBeNull()
    expect(inputNameFromViewUrl('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/brand-assets.unit.spec.ts`
Expected: FAIL — module `shared/brand/assets` does not exist.

- [ ] **Step 3: Implement both helpers**

Create `frontend/shared/brand/assets.ts`:

```ts
// frontend/shared/brand/assets.ts
/** Extract the ComfyUI input filename from a `/view?filename=…&type=input`
 *  URL (the format brand logos/assets store). Returns null for external URLs
 *  and non-input views — callers must upload those before use as a layer. */
export function inputNameFromViewUrl(url: string): string | null {
  if (!url.startsWith('/view?')) return null
  const params = new URLSearchParams(url.slice('/view?'.length))
  if ((params.get('type') ?? 'input') !== 'input') return null
  return params.get('filename')
}
```

Create `frontend/app/lib/brand/upload.ts`:

```ts
// frontend/app/lib/brand/upload.ts
/** Upload a brand image (logo slot / asset) to the ComfyUI input folder and
 *  return its `/view` URL — the format BrandKit stores. Same endpoint the
 *  Frame uses for image layers, so brand files are layer-ready by name. */
export async function uploadBrandImage(file: File): Promise<string> {
  const safe = `brand_${Date.now().toString(36)}_${(file.name || 'image.png').replace(/[^\w.-]+/g, '_')}`
  const fd = new FormData()
  fd.append('image', new File([file], safe, { type: file.type }))
  fd.append('overwrite', 'true')
  const res = await fetch('/upload/image', { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`brand upload failed: ${res.status}`)
  const data = await res.json() as { name?: string; subfolder?: string }
  const name = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name ?? '')
  if (!name) throw new Error('brand upload returned no filename')
  return `/view?filename=${encodeURIComponent(name)}&type=input`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/brand-assets.unit.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/brand/assets.ts app/lib/brand/upload.ts tests/unit/brand-assets.unit.spec.ts
git commit -m "feat(brand): input-name and upload helpers for brand assets"
```

---

### Task 4: Logo-slots + assets panels; rewire KitPanel

**Files:**
- Create: `frontend/app/components/brand/LogoSlotsPanel.vue`
- Create: `frontend/app/components/brand/AssetsPanel.vue`
- Modify: `frontend/app/components/brand/KitPanel.vue` (replace the single-logo block, lines 54–64 of the template, and drop the now-unused `onLogoFile`)

**Interfaces:**
- Consumes: `BRAND_LOGO_SLOT_KEYS`, `BrandLogoSlotKey`, `BrandAsset`, `brandLogoUrl` (Task 1), `uploadBrandImage` (Task 3).
- Produces:
  - `<BrandLogoSlotsPanel :kit="BrandKit" @update="(patch: Partial<BrandKit>) => …">` — emits kit patches (`{ logos: {...} }`, and `{ logos, logo: '' }` when clearing the primary slot so the legacy string doesn't resurface).
  - `<BrandAssetsPanel :kit="BrandKit" @update="(patch: Partial<BrandKit>) => …">` — emits `{ assets: BrandAsset[] }` patches.
  - Both are consumed by `KitPanel` (this task) and the Studio page (Task 5). Both use `@change`-style discrete events only.

- [ ] **Step 1: Create `LogoSlotsPanel.vue`**

Create `frontend/app/components/brand/LogoSlotsPanel.vue`:

```vue
<script setup lang="ts">
/** Four labeled logo slots (primary / mark / wordmark / on-dark). The primary
 *  slot displays the legacy kit.logo as a fallback; writes always go to
 *  kit.logos (clearing primary also clears the legacy string so it doesn't
 *  resurface through the brandLogoUrl fallback). */
import { BRAND_LOGO_SLOT_KEYS, type BrandKit, type BrandLogoSlotKey } from '~~/shared/brand/types'
import { brandLogoUrl } from '~~/shared/brand/resolve'
import { uploadBrandImage } from '~/lib/brand/upload'

const props = defineProps<{ kit: BrandKit }>()
const emit = defineEmits<{ update: [patch: Partial<BrandKit>] }>()

const SLOT_LABELS: Record<BrandLogoSlotKey, string> = {
  primary: 'Primary', mark: 'Mark', wordmark: 'Wordmark', onDark: 'On dark',
}

function slotUrl(slot: BrandLogoSlotKey): string | undefined {
  return brandLogoUrl(props.kit, slot)
}
function setSlot(slot: BrandLogoSlotKey, url: string) {
  const logos = { ...props.kit.logos, [slot]: url }
  // Clearing primary must also clear the legacy string, or it resurfaces.
  emit('update', slot === 'primary' && !url ? { logos, logo: '' } : { logos })
}
async function onFile(slot: BrandLogoSlotKey, e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try { setSlot(slot, await uploadBrandImage(file)) }
  catch (err) { console.error('[Brand] logo upload:', err) }
}
</script>

<template>
  <div class="space-y-1.5 text-xs">
    <div v-for="slot in BRAND_LOGO_SLOT_KEYS" :key="slot" class="flex items-center gap-2">
      <span class="w-16 shrink-0 text-white/60">{{ SLOT_LABELS[slot] }}</span>
      <span
        class="size-7 shrink-0 rounded border border-white/10 bg-[#1a1a1a] bg-center bg-contain bg-no-repeat"
        :class="slot === 'onDark' ? 'bg-[#0a0a0a]' : ''"
        :style="slotUrl(slot) ? { backgroundImage: `url(${JSON.stringify(slotUrl(slot))})` } : {}"
      />
      <input
        type="text" :value="slotUrl(slot) ?? ''" placeholder="https://… or upload"
        class="min-w-0 flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
        @change="setSlot(slot, ($event.target as HTMLInputElement).value.trim())"
      >
      <label class="shrink-0 px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.1] cursor-pointer text-white/70">
        Upload<input type="file" accept="image/*" class="hidden" @change="onFile(slot, $event)">
      </label>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Create `AssetsPanel.vue`**

Create `frontend/app/components/brand/AssetsPanel.vue`:

```vue
<script setup lang="ts">
/** Free-form brand image collection (product shots, patterns, textures).
 *  Metadata lives on the kit; files live in the ComfyUI input folder. */
import type { BrandAsset, BrandKit } from '~~/shared/brand/types'
import { uploadBrandImage } from '~/lib/brand/upload'

const props = defineProps<{ kit: BrandKit }>()
const emit = defineEmits<{ update: [patch: Partial<BrandKit>] }>()

const assets = computed<BrandAsset[]>(() => props.kit.assets ?? [])

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (!files.length) return
  const added: BrandAsset[] = []
  for (const file of files) {
    try {
      added.push({
        id: crypto.randomUUID(),
        name: (file.name || 'asset').replace(/\.[^.]+$/, ''),
        path: await uploadBrandImage(file),
      })
    } catch (err) { console.error('[Brand] asset upload:', err) }
  }
  if (added.length) emit('update', { assets: [...assets.value, ...added] })
}
function renameAsset(id: string, name: string) {
  if (!name.trim()) return
  emit('update', { assets: assets.value.map(a => a.id === id ? { ...a, name: name.trim() } : a) })
}
function removeAsset(id: string) {
  // No cascade: the input-folder file stays, placed layers keep their URLs.
  emit('update', { assets: assets.value.filter(a => a.id !== id) })
}
</script>

<template>
  <div class="space-y-2 text-xs">
    <div class="flex items-center justify-between">
      <span class="text-white/60">{{ assets.length ? `${assets.length} asset${assets.length === 1 ? '' : 's'}` : 'No assets yet' }}</span>
      <label class="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.1] cursor-pointer text-white/70">
        Upload<input type="file" accept="image/*" multiple class="hidden" @change="onFiles">
      </label>
    </div>
    <div v-if="assets.length" class="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
      <div v-for="a in assets" :key="a.id" class="group rounded-lg border border-white/10 bg-[#161616] overflow-hidden">
        <div class="relative aspect-square bg-[#1a1a1a] bg-center bg-contain bg-no-repeat"
             :style="{ backgroundImage: `url(${JSON.stringify(a.path)})` }">
          <button
            class="absolute top-1 right-1 size-5 rounded bg-black/60 text-rose-300 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            title="Remove from kit" @click="removeAsset(a.id)"
          >✕</button>
        </div>
        <input
          :value="a.name"
          class="w-full bg-transparent px-1.5 py-1 text-[11px] text-white/80 outline-none"
          @change="renameAsset(a.id, ($event.target as HTMLInputElement).value)"
        >
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Rewire `KitPanel.vue`**

In `frontend/app/components/brand/KitPanel.vue`:
1. Delete the `onLogoFile` function from the script block (lines 14–26).
2. Replace the logo block in the template (the `<div class="space-y-1">…</div>` containing the "Logo" label, text input, and Upload label — lines 54–64) with:

```vue
    <div class="space-y-1">
      <span class="text-white/60">Logos</span>
      <BrandLogoSlotsPanel :kit="kit" @update="(p) => emit('update', p)" />
    </div>
```

(The popover intentionally does not embed `AssetsPanel` — assets are a page-level concern; the popover gains a "Manage brands →" link in Task 5.)

- [ ] **Step 4: Verify in preview**

Start the dev server (`preview_start` with the frontend config; create `.claude/launch.json` with `{"name": "frontend", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 3000}` in `frontend/.claude/launch.json` if absent). Then:
1. Open a project tab, open the ProjectMenu → Brand section → select a kit.
2. Confirm the four logo slots render; paste a URL into "Mark", confirm the kit JSON in `frontend/server/brand-kits/` gains `"logos": { "mark": … }` and the legacy `logo` field is untouched.
3. Check `preview_console_logs` for errors.

- [ ] **Step 5: Commit**

```bash
git add app/components/brand/LogoSlotsPanel.vue app/components/brand/AssetsPanel.vue app/components/brand/KitPanel.vue
git commit -m "feat(brand): logo-slot and asset panels, KitPanel logo slots"
```

---

### Task 5: Top-level Brand page (tab type, sidebar, Studio)

**Files:**
- Modify: `frontend/app/composables/useTabs.ts` (type unions line 6 + line 117, singleton branch near the assets branch at line 156)
- Modify: `frontend/app/components/AppSidebar.vue` (nav item + action branches)
- Modify: `frontend/app/layouts/default.vue` (tab icon near line 3492, render branch after the all-projects block ending line 3678)
- Create: `frontend/app/components/brand/StudioPage.vue`
- Modify: `frontend/app/components/brand/LibraryPopover.vue` ("Manage brands →" footer link)

**Interfaces:**
- Consumes: `useBrandLibrary`, `slugifyKitName`, `BrandKitPanel`, `BrandAssetsPanel` (Task 4), `BrandFontsPanel` (existing).
- Produces: tab type `'brand'` (singleton, id `'brand'`); `openTab({ type: 'brand' })`; `<BrandStudioPage />` rendered by the layout. The Studio manages the kit library only — it never assigns a kit to a project (assignment stays in ProjectMenu/Compositor popovers).

- [ ] **Step 1: Add the `brand` tab type**

In `frontend/app/composables/useTabs.ts`:
1. Line 6 — extend the `Tab` interface union: `type: 'home' | 'project' | 'assets' | 'community' | 'app' | 'train' | 'template-editor' | 'all-projects' | 'brand'`.
2. Line 117 — extend the `openTab` opts union the same way: `type: 'project' | 'assets' | 'community' | 'app' | 'train' | 'template-editor' | 'all-projects' | 'brand'`.
3. Immediately before the `if (opts.type === 'community')` branch, add a singleton branch mirroring `assets`:

```ts
    if (opts.type === 'brand') {
      const existing = tabs.value.find((t) => t.type === 'brand')
      if (existing) {
        activeTabId.value = existing.id
        return existing
      }
      const tab: Tab = {
        id: 'brand',
        label: opts.label ?? 'Brand',
        type: 'brand',
        closable: true,
      }
      tabs.value.push(tab)
      activeTabId.value = tab.id
      return tab
    }
```

- [ ] **Step 2: Add the sidebar entry**

In `frontend/app/components/AppSidebar.vue`:
1. Add `Palette` to the `lucide-vue-next` import (lines 2–10).
2. In `navItems` (lines 14–20), insert after the Assets item: `{ icon: Palette, label: 'Brand', action: 'openBrand' },`
3. In `handleAction` (lines 36–41), add: `else if (action === 'openBrand') openTab({ type: 'brand' })`
4. In `getActionActive` (lines 43–49), add: `if (action === 'openBrand') return activeTab.value.type === 'brand'`

- [ ] **Step 3: Create the Studio page**

Create `frontend/app/components/brand/StudioPage.vue`:

```vue
<script setup lang="ts">
/** Top-level Brand page (the `brand` tab): manage the app-wide kit library —
 *  colors, fonts, logo slots, assets. Assignment to a project stays in the
 *  ProjectMenu popover; this page never touches ProjectDoc.brandKitId. */
import type { BrandKit, BrandKitEntry } from '~~/shared/brand/types'
import { useBrandLibrary, slugifyKitName } from '~/composables/useBrandLibrary'

const { kits, loaded, refresh, save, remove } = useBrandLibrary()
void refresh()

const selectedId = ref<string | null>(null)
watch(kits, (list) => {
  if (!selectedId.value || !list.find(k => k.id === selectedId.value)) {
    selectedId.value = list[0]?.id ?? null
  }
}, { immediate: true })
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
  const entry: BrandKitEntry = {
    id: `${src.id}-copy-${Date.now().toString(36)}`,
    name: `${src.name} copy`,
    kit: { ...src.kit, logos: src.kit.logos ? { ...src.kit.logos } : undefined, assets: src.kit.assets?.map(a => ({ ...a })) },
    updatedAt: '',
  }
  await save(entry)
  selectedId.value = entry.id
}
async function renameKit(name: string) {
  if (!selected.value || !name.trim()) return
  await save({ ...selected.value, name: name.trim() })
}
async function deleteKit() {
  if (!selected.value) return
  await remove(selected.value.id)
  selectedId.value = kits.value[0]?.id ?? null
}
async function patchKit(patch: Partial<BrandKit>) {
  if (!selected.value) return
  await save({ ...selected.value, kit: { ...selected.value.kit, ...patch } })
}

const SWATCH_KEYS = ['primary', 'accent', 'accent2'] as const
</script>

<template>
  <div class="h-full flex bg-[#121212] text-sm">
    <!-- Kit list -->
    <aside class="w-64 shrink-0 border-r border-white/[0.06] flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <h1 class="text-white/85 font-medium">Brand</h1>
        <button class="px-2 py-1 rounded bg-white/[0.08] hover:bg-white/[0.14] text-xs text-white/80 cursor-pointer" @click="newKit">New kit</button>
      </div>
      <div class="flex-1 overflow-auto p-2 space-y-0.5">
        <div v-if="loaded && !kits.length" class="px-2 py-4 text-xs text-white/40">
          No brand kits yet — create one to define colors, fonts, logos and assets.
        </div>
        <button
          v-for="k in kits" :key="k.id"
          class="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left cursor-pointer"
          :class="selectedId === k.id ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'"
          @click="selectedId = k.id"
        >
          <span class="flex gap-0.5 shrink-0">
            <span v-for="s in SWATCH_KEYS" :key="s" class="size-3 rounded-sm border border-white/10"
                  :style="{ background: k.kit[s] || 'transparent' }" />
          </span>
          <span class="truncate text-xs text-white/80">{{ k.name }}</span>
        </button>
      </div>
    </aside>

    <!-- Kit editor -->
    <main v-if="selected" class="flex-1 overflow-auto">
      <div class="max-w-2xl mx-auto p-6 space-y-8">
        <div class="flex items-center gap-2">
          <input
            :value="selected.name"
            class="flex-1 bg-transparent text-lg text-white/90 outline-none border-b border-transparent focus:border-white/20"
            @change="renameKit(($event.target as HTMLInputElement).value)"
          >
          <button class="px-2 py-1 rounded bg-white/[0.06] hover:bg-white/[0.1] text-xs text-white/70 cursor-pointer" @click="duplicateKit">Duplicate</button>
          <button class="px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-xs text-rose-300 cursor-pointer" @click="deleteKit">Delete</button>
        </div>

        <!-- Colors + fonts + logo slots (KitPanel embeds BrandLogoSlotsPanel) -->
        <section>
          <h2 class="text-[10px] font-medium uppercase tracking-wider text-white/35 mb-3">Colors · Fonts · Logos</h2>
          <BrandKitPanel :kit="selected.kit" @update="patchKit" />
        </section>

        <!-- Brand assets -->
        <section>
          <h2 class="text-[10px] font-medium uppercase tracking-wider text-white/35 mb-3">Assets</h2>
          <BrandAssetsPanel :kit="selected.kit" @update="patchKit" />
        </section>

        <!-- App-wide uploaded fonts (shared across kits) -->
        <section>
          <h2 class="text-[10px] font-medium uppercase tracking-wider text-white/35 mb-3">Uploaded fonts (shared)</h2>
          <BrandFontsPanel />
        </section>
      </div>
    </main>
    <main v-else class="flex-1 grid place-items-center text-white/40 text-xs">
      Select or create a brand kit.
    </main>
  </div>
</template>
```

- [ ] **Step 4: Render the tab in the layout**

In `frontend/app/layouts/default.vue`:
1. Add `Palette` to the existing `lucide-vue-next` import (the one providing `Globe`, `Image`, `Wand`, `LayoutGrid` used at lines 3491–3495).
2. After the `all-projects` icon line (3495), add:

```vue
              <Palette v-else-if="tab.type === 'brand'" class="size-4" :class="tab.id === activeTabId ? 'text-white' : 'text-white/50'" />
```

3. After the all-projects render block (the `</div>` at line 3678), add:

```vue
        <!-- Brand page tab (app-wide kit library) -->
        <div
          v-for="tab in tabs.filter((t) => t.type === 'brand')"
          :key="tab.id"
          v-show="tab.id === activeTabId"
          class="h-full overflow-auto"
        >
          <BrandStudioPage />
        </div>
```

- [ ] **Step 5: Add "Manage brands →" to the popover**

In `frontend/app/components/brand/LibraryPopover.vue`, add to the script block:

```ts
const { openTab } = useTabs()
```

and add as the last child of the root `<div>` in the template (after the `BrandFontsPanel` block):

```vue
    <div class="pt-2 border-t border-white/10">
      <button class="text-white/50 hover:text-white/80 cursor-pointer" @click="openTab({ type: 'brand' })">
        Manage brands →
      </button>
    </div>
```

(`useTabs` is auto-imported in `app/composables`; the popover renders inside ProjectMenu and CompositorModal, both under the layout, so switching tabs from it is safe.)

- [ ] **Step 6: Verify in preview**

1. Reload the app. A Palette icon appears in the left rail; clicking opens a singleton "Brand" tab rendering the Studio.
2. Create a kit, set colors, upload a logo slot and two assets; confirm the JSON file under `frontend/server/brand-kits/`.
3. Open a project → ProjectMenu → Brand → "Manage brands →" switches to the Brand tab.
4. Reload the page: the Brand tab persists (sessionStorage) and re-renders.
5. `preview_console_logs` clean; take `preview_screenshot` of the Studio.

- [ ] **Step 7: Commit**

```bash
git add app/composables/useTabs.ts app/components/AppSidebar.vue app/layouts/default.vue app/components/brand/StudioPage.vue app/components/brand/LibraryPopover.vue
git commit -m "feat(brand): top-level Brand page — tab type, sidebar entry, studio"
```

---

### Task 6: FillControl brand swatch row

**Files:**
- Modify: `frontend/app/components/vue-canvas/compositor/FillControl.vue`

**Interfaces:**
- Consumes: `inject('sailor:brand')` (`activeKit: ComputedRef<BrandKit | undefined>`), `BRAND_COLOR_KEYS`.
- Produces: a "Brand" swatch row at the top of FillControl's expanded panel, in **every** FillControl instance (text color/stroke, shape fill/stroke, background — CompositorModal lines 3255–3360 and all other usages get it for free). Hidden when no kit or kit has no colors.

- [ ] **Step 1: Implement**

In `frontend/app/components/vue-canvas/compositor/FillControl.vue`:

Add to the script block (after the existing imports; `inject` and `computed` — extend the existing `vue` import):

```ts
import type { ComputedRef } from 'vue'
import { BRAND_COLOR_KEYS, type BrandKit } from '~~/shared/brand/types'

// Active project brand kit → one-click swatches. Null-safe: FillControl also
// renders in contexts without a project (dev labs), where the inject is absent.
const projectBrand = inject<{ activeKit: ComputedRef<BrandKit | undefined> } | null>('sailor:brand', null)
const brandSwatches = computed(() => {
  const k = projectBrand?.activeKit.value
  if (!k) return []
  return BRAND_COLOR_KEYS.map(key => k[key]).filter((v): v is string => !!v)
})
function applyBrandColor(hex: string) {
  if (fill.type === 'gradient') fill.type = 'solid'
  setColor('a', hex)
}
```

In the template, insert as the FIRST child of the expanded panel (`<div v-if="open && !isNone" class="mt-2 …">`, line 144), before the type `<select>`:

```vue
      <div v-if="brandSwatches.length" class="flex items-center gap-1.5">
        <span class="text-[9px] uppercase tracking-[0.1em] text-white/35 shrink-0">Brand</span>
        <button
          v-for="(c, i) in brandSwatches" :key="i" type="button"
          class="size-5 rounded border border-white/15 cursor-pointer hover:scale-110 transition-transform"
          :style="{ background: c }" :title="c" @click="applyBrandColor(c)"
        />
      </div>
```

- [ ] **Step 2: Verify in preview**

1. In a project with an active brand kit, add a Frame, enter edit mode, open the full editor (CompositorModal), select a shape, expand its fill control: the Brand row shows the kit colors; clicking one sets a solid fill.
2. Clear the project's brand kit (ProjectMenu → Brand → toggle "Active" off): the row disappears.
3. `preview_console_logs` clean (specifically: no inject warnings from lab pages — visit `/dev/frame-lab` if it mounts FillControl).

- [ ] **Step 3: Commit**

```bash
git add app/components/vue-canvas/compositor/FillControl.vue
git commit -m "feat(frame): brand color swatches in FillControl"
```

---

### Task 7: Frame — brand font default + brand image picker

**Files:**
- Modify: `frontend/app/composables/useLocalLayerEditor.ts` (addText, line 635)
- Create: `frontend/app/components/brand/ImagePicker.vue`
- Modify: `frontend/app/components/vue-canvas/ArtifactFrameNode.vue` (inline toolbar, line ~815)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (toolbar, near the "Add text" button at line 2798)

**Interfaces:**
- Consumes: `inject('sailor:brand')`, `brandLogoUrl`, `BRAND_LOGO_SLOT_KEYS`, `inputNameFromViewUrl` (Task 3), `uploadBrandImage` (Task 3), editor `addImageFromName(name, aspect)` / `addText()`.
- Produces: `<BrandImagePicker @add="(name: string, aspect: number) => …">` — a popover button listing logo slots + assets; renders nothing (`v-if`) when no kit or the kit has no logos/assets. New text layers default to the kit's `fontDisplay`.

- [ ] **Step 1: Brand font default for new text layers**

In `frontend/app/composables/useLocalLayerEditor.ts`:

At the top of the `useLocalLayerEditor(...)` function body (it runs in component `setup()` — both call sites, `ArtifactFrameNode.vue:280` and `CompositorModal.vue:306`, are setup-scoped, so `inject` is legal):

```ts
  // Active brand kit → font default for new text layers. Optional: the
  // editor also runs in dev labs with no project shell above it.
  const projectBrand = inject<{ activeKit: Ref<BrandKit | undefined> } | null>('sailor:brand', null)
```

Add the imports: `inject` from `vue` (extend the existing import) and `import type { BrandKit } from '~~/shared/brand/types'`.

Replace `addText` (line 635):

```ts
  function addText() {
    const fontDisplay = projectBrand?.activeKit.value?.fontDisplay
    const l = createTextLayer(fontDisplay ? { fontFamily: fontDisplay } : {})
    addLocal(l); nextTick(() => beginEdit(l.id)); return l
  }
```

- [ ] **Step 2: Create `BrandImagePicker`**

Create `frontend/app/components/brand/ImagePicker.vue`:

```vue
<script setup lang="ts">
/** One-click brand image drop-in for the Frame: lists the active kit's logo
 *  slots + assets; picking one resolves the ComfyUI input name (uploading
 *  external URLs first) and emits `add(name, aspect)` for addImageFromName. */
import { ImagePlus } from 'lucide-vue-next'
import type { ComputedRef } from 'vue'
import { BRAND_LOGO_SLOT_KEYS, type BrandKit } from '~~/shared/brand/types'
import { brandLogoUrl } from '~~/shared/brand/resolve'
import { inputNameFromViewUrl } from '~~/shared/brand/assets'
import { uploadBrandImage } from '~/lib/brand/upload'

const emit = defineEmits<{ add: [name: string, aspect: number] }>()

const projectBrand = inject<{ activeKit: ComputedRef<BrandKit | undefined> } | null>('sailor:brand', null)
const items = computed(() => {
  const k = projectBrand?.activeKit.value
  if (!k) return []
  const out: { key: string; label: string; url: string }[] = []
  for (const slot of BRAND_LOGO_SLOT_KEYS) {
    const url = brandLogoUrl(k, slot)
    if (url) out.push({ key: `logo-${slot}`, label: slot === 'primary' ? 'Logo' : `Logo · ${slot}`, url })
  }
  for (const a of k.assets ?? []) out.push({ key: a.id, label: a.name, url: a.path })
  return out
})

const open = ref(false)
const busy = ref(false)

function measureAspect(url: string): Promise<number> {
  return new Promise((resolve) => {
    const im = new Image()
    im.onload = () => resolve(im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : 1)
    im.onerror = () => resolve(1)
    im.src = url
  })
}

async function pick(item: { label: string; url: string }) {
  if (busy.value) return
  busy.value = true
  try {
    let name = inputNameFromViewUrl(item.url)
    if (!name) {
      // External URL → pull it client-side and reuse the upload path so the
      // layer references a real input file.
      const blob = await (await fetch(item.url)).blob()
      const file = new File([blob], `${item.label.replace(/[^\w.-]+/g, '_')}.png`, { type: blob.type || 'image/png' })
      name = inputNameFromViewUrl(await uploadBrandImage(file))
    }
    if (!name) throw new Error('could not resolve input name')
    const aspect = await measureAspect(`/view?${new URLSearchParams({ filename: name, type: 'input' })}`)
    emit('add', name, aspect)
    open.value = false
  } catch (err) {
    console.error('[Brand] add image:', err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="items.length" class="relative">
    <button
      type="button" class="nopan nodrag size-6 rounded flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
      title="Add brand image" @click="open = !open"
    >
      <ImagePlus class="size-3" />
    </button>
    <div
      v-if="open"
      class="nopan nodrag absolute bottom-full left-0 mb-1 z-50 w-48 max-h-64 overflow-auto rounded-lg border border-white/10 bg-[#111113] p-1.5 shadow-2xl"
    >
      <p class="px-1 pb-1 text-[9px] uppercase tracking-[0.1em] text-white/35">Brand</p>
      <button
        v-for="item in items" :key="item.key" type="button"
        class="w-full flex items-center gap-2 px-1.5 py-1 rounded hover:bg-white/[0.06] text-left cursor-pointer disabled:opacity-50"
        :disabled="busy" @click="pick(item)"
      >
        <span class="size-6 shrink-0 rounded border border-white/10 bg-[#1a1a1a] bg-center bg-contain bg-no-repeat"
              :style="{ backgroundImage: `url(${JSON.stringify(item.url)})` }" />
        <span class="truncate text-[11px] text-white/80">{{ item.label }}</span>
      </button>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Wire into the Frame inline toolbar**

In `frontend/app/components/vue-canvas/ArtifactFrameNode.vue`, in the inline edit toolbar (line ~815), immediately after the "Add image" button + hidden file input pair, add:

```vue
        <BrandImagePicker @add="(name, aspect) => editor.addImageFromName(name, aspect)" />
```

- [ ] **Step 4: Wire into the CompositorModal toolbar**

In `frontend/app/components/vue-canvas/CompositorModal.vue`, next to its "Add image" button (the toolbar cluster containing the "Add text" button at line 2798), add:

```vue
        <BrandImagePicker @add="(name, aspect) => addImageFromName(name, aspect)" />
```

(`addImageFromName` is already destructured from the editor at line 319.)

- [ ] **Step 5: Verify in preview**

1. With an active kit that has a logo slot and one asset: Frame edit mode shows the brand image button; clicking it lists "Logo" and the asset; picking one drops it on the artboard sized to its real aspect.
2. New text layer (`Add text`) uses the kit's display font (inspect the layer panel / rendered font).
3. Kit unassigned → brand image button gone, text layers back to Inter.
4. `preview_console_logs` clean.

- [ ] **Step 6: Commit**

```bash
git add app/composables/useLocalLayerEditor.ts app/components/brand/ImagePicker.vue app/components/vue-canvas/ArtifactFrameNode.vue app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(frame): brand image picker + brand font default for text layers"
```

---

### Task 8: Smart Layout — logo-slot tokens + asset quick-picks in the inspector

**Files:**
- Modify: `frontend/app/components/templates/GridPropertyPanel.vue` (image element Source section, lines 924–940; brand computeds near line 317)

**Interfaces:**
- Consumes: the panel's existing `effectiveBrand` computed (injected `gridEditor` context — already includes the active kit merge; Task 1 made its result carry `logos`/`assets`), `patchElement`, `BRAND_LOGO_SLOT_KEYS`.
- Produces: image elements can one-click bind `content` to `{{ brand.logo }}` (existing), `{{ brand.logos.mark }}` / `wordmark` / `onDark` (token — re-resolves on kit switch), or a brand asset's literal URL (snapshot — survives kit switch by design).

- [ ] **Step 1: Add slot/asset computeds**

In `frontend/app/components/templates/GridPropertyPanel.vue`, next to `hasBrandLogo`/`usingBrandLogo` (lines 317–318), add (import `BRAND_LOGO_SLOT_KEYS` from `~~/shared/brand/types` and reuse the existing `import type` if present):

```ts
// Non-primary logo slots available on the effective brand (primary is covered
// by the existing "Use brand logo" button via the legacy back-fill).
const brandLogoSlots = computed(() => {
  const logos = (effectiveBrand.value as any).logos as Record<string, string> | undefined
  if (!logos) return [] as string[]
  return BRAND_LOGO_SLOT_KEYS.filter(s => s !== 'primary' && typeof logos[s] === 'string')
})
const brandAssets = computed(() =>
  (((effectiveBrand.value as any).assets ?? []) as { id: string; name: string; path: string }[]))
function usingSlot(slot: string) {
  return el.value?.type === 'image' && (el.value as any).content === `{{ brand.logos.${slot} }}`
}
```

- [ ] **Step 2: Extend the image Source section**

In the template's image section (after the existing "Use brand logo" button, lines 930–939), add:

```vue
        <button
          v-for="slot in brandLogoSlots" :key="slot"
          class="mt-1.5 ml-1.5 px-2 h-6 rounded text-[10px] transition-colors cursor-pointer"
          :class="usingSlot(slot) ? 'bg-[#96b4ff]/25 text-[#c9d6ff]' : 'bg-white/[0.04] text-white/45 hover:bg-white/[0.08]'"
          @click="patchElement(el!.id, { content: `{{ brand.logos.${slot} }}` })"
        >
          {{ slot === 'onDark' ? 'On-dark logo' : slot[0].toUpperCase() + slot.slice(1) }}
        </button>
        <div v-if="brandAssets.length" class="mt-2">
          <p :class="labelCls" class="mb-1.5">Brand assets</p>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="a in brandAssets" :key="a.id"
              class="flex items-center gap-1.5 px-1.5 h-7 rounded bg-white/[0.04] hover:bg-white/[0.08] transition-colors cursor-pointer"
              :class="el!.content === a.path ? 'bg-[#96b4ff]/25' : ''"
              :title="a.name" @click="patchElement(el!.id, { content: a.path })"
            >
              <span class="size-5 rounded-sm border border-white/10 bg-[#1a1a1a] bg-center bg-contain bg-no-repeat"
                    :style="{ backgroundImage: `url(${JSON.stringify(a.path)})` }" />
              <span class="max-w-24 truncate text-[10px] text-white/60">{{ a.name }}</span>
            </button>
          </div>
        </div>
```

- [ ] **Step 3: Verify in preview**

1. Kit with a `mark` logo slot + an asset, assigned to the project. Add a Smart Layout node, open its editor, select an image element.
2. The Source section shows "Use brand logo", "Mark", and the asset chip. Clicking "Mark" sets content to `{{ brand.logos.mark }}` and the preview renders the mark image (this proves the Task 2 token path + Task 1 KV/merge end-to-end in the editor).
3. Run the workflow: the rendered output substitutes the mark (backend flat-key path — `brand_kit` widget now carries `logos.mark=` lines via `injectSmartLayoutBrand` → `brandKitToKv`, `default.vue:795`).
4. `preview_console_logs` + `preview_logs` clean.

- [ ] **Step 4: Commit**

```bash
git add app/components/templates/GridPropertyPanel.vue
git commit -m "feat(smart-layout): logo-slot tokens + brand asset quick-picks"
```

---

### Task 9: Full verification pass

**Files:** none (verification only; fix regressions where found).

- [ ] **Step 1: Full unit suite**

Run: `npm run test:unit`
Expected: PASS — zero failures.

- [ ] **Step 2: End-to-end preview walkthrough**

With both servers running (frontend dev + ComfyUI backend per CLAUDE.md):
1. **Brand page:** create a kit with 6 colors, display+body fonts, primary+mark logos, 2 assets. Reload → everything persists.
2. **Back-compat:** the two pre-existing kits (`kit-1-*`, `kit-2-*`) still list, open, and edit; their legacy `logo` shows in the Primary slot.
3. **Assign:** project → ProjectMenu → set the new kit active. Swatches show in the menu header.
4. **Frame:** fill controls show the Brand row; brand image picker drops the logo; new text layers use the display font.
5. **Smart Layout:** image element binds `{{ brand.logos.mark }}`; a run renders it; switching the project to a different kit re-renders with that kit's mark (token re-resolution) while an asset-bound element keeps its literal URL (snapshot semantics — per spec).
6. **No-brand state:** unassign the kit — Brand row, image picker, and inspector chips all disappear; new text layers default to Inter.

- [ ] **Step 3: Commit any fixes; then final commit if the tree is dirty**

```bash
git status
```

If clean: done. If fixes were needed, commit them with focused messages (`fix(brand): …`).

---

## Self-Review Notes (spec → plan coverage)

- Spec §1 data model → Task 1. §2 persistence → Tasks 1/3 (no API changes needed; PUT passes new fields through — verified `server/api/brand-kits/[id].put.ts` accepts arbitrary `kit` objects). §3 page → Tasks 4/5. §4 assignment → unchanged; "Manage brands…" via LibraryPopover link (Task 5) which ProjectMenu embeds. §5 Frame → Tasks 6/7. §6 auto-fill semantics → Tasks 6/7/8 (presets + new-element defaults only). §7 Smart Layout → Tasks 1/2/8. §8 edge cases → no-brand hidden states in Tasks 6/7/8; no-cascade delete in Task 4. §9 testing → Tasks 1/2/3 unit + Task 9 walkthrough.
- Deliberate deviation from spec §3: `AssetsPanel` is on the Studio page but not in the popover (popover stays lean; shared `KitPanel`/`LogoSlotsPanel` prevent drift for everything else). Spec's "image-layer picker gets a Brand section" is realized as a dedicated `BrandImagePicker` button beside "Add image" — Frame has no existing image-picker panel to extend.
