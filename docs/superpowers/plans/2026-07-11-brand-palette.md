# Brand Palette (Named Colors) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed color roles as the brand kit's editing model with a user-named palette ("Viridian" → hex), keep roles as references into it, and make the Smart Layout + Compositor agents resolve palette names.

**Architecture:** `BrandKit` gains `palette: {id,name,hex}[]` (source of truth) and `roles: role→entryId` (optional mapping). `effectiveBrand` materializes the six legacy role keys from the mapping and exposes flat `palette.<slug>` token keys, so every existing consumer — role tokens, archetypes, KV wire, `setBrand` — is untouched. Legacy kits resolve through a derived virtual palette; the first palette edit persists it. UI swap is confined to a new `PalettePanel` inside KitPanel; swatch surfaces move to one shared `brandSwatches()` helper.

**Tech Stack:** Nuxt 4 (Vue 3 + TypeScript + Tailwind), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-brand-palette-design.md`

## Global Constraints

- All frontend work happens in `frontend/`; run commands from `/Users/julien/Documents/GitHub/Sailor/frontend`.
- Unit tests: `npm run test:unit -- <file>` (Vitest). The unit suite has known pre-existing failures unrelated to brand — the gate is "no NEW failures".
- Kit edits PUT the whole kit — `@change`, never `@input`, on kit-editing controls.
- Legacy flat role colors (`primary`…`background`) remain readable forever; existing kit JSON loads unchanged; role tokens (`{{ brand.primary }}`) keep resolving for any kit.
- Roles reference palette entries **by id** (rename-stable). Palette token slugs come from `paletteSlug(name)`: lowercase, non-alphanumerics → `_`, collapse repeats, trim (`"Deep Viridian"` → `deep_viridian`); slug collisions → last entry wins.
- Brand affordances are hidden (`v-if`) when absent, not disabled.
- COMMIT HYGIENE: the working tree carries unrelated parallel-session WIP. Before editing any existing file, `git status --short <file>` must be clean — if dirty, STOP and report BLOCKED naming the file. Stage only your task's files individually; verify with `git diff --cached --stat`; never `git add -A`/`git add .`.
- Commit after each task.

---

### Task 1: Schema + resolution (palette, roles, slugs, swatches, KV)

**Files:**
- Modify: `frontend/shared/brand/types.ts`
- Modify: `frontend/shared/brand/resolve.ts`
- Test: `frontend/tests/unit/brand-palette.unit.spec.ts` (new)
- Test: `frontend/tests/unit/brand-kv.unit.spec.ts` (extend)

**Interfaces:**
- Consumes: existing `BrandKit`, `BRAND_COLOR_KEYS`, `compact`, `effectiveBrand`, `brandKitToKv`.
- Produces (later tasks rely on these exact names):
  - `interface BrandPaletteEntry { id: string; name: string; hex: string }`
  - `BrandKit.palette?: BrandPaletteEntry[]`, `BrandKit.roles?: Partial<Record<BrandColorKey, string>>` (value = entry id)
  - `paletteSlug(name: string): string`
  - `virtualPalette(kit: BrandKit | undefined): { entries: BrandPaletteEntry[]; roles: Partial<Record<BrandColorKey, string>> }` — derives from legacy flat fields when `kit.palette` is absent/empty; entry ids are `legacy-<roleKey>`, names "Primary" / "Secondary" / "Accent" / "Accent 2" / "Foreground" / "Background"; `roles` maps each present role to its derived entry.
  - `brandSwatches(kit: BrandKit | undefined): { name: string; hex: string }[]` — `kit.palette` entries (non-empty name+hex) if any, else the virtual palette's entries. `[]` for no kit / no colors.
  - `effectiveBrand(...)`: merges `palette` (later non-empty array replaces whole array) and `roles` (per-role, later wins); materializes each role key from `roles`→palette entry hex (fallback: merged legacy flat value); adds flat token keys `palette.<slug>` = hex onto the result for every palette entry (real or virtual) so `{{ brand.palette.<slug> }}` resolves via the existing flat-first lookup.
  - `brandKitToKv(...)`: after the `logos.*` lines, emits `palette.<slug>=<hex>` for each palette entry (skipping empty name/hex). Role keys keep being emitted with materialized values (serialize `effectiveBrand`-materialized roles? No — KV serializes the RAW kit as today; add role materialization inside `brandKitToKv` by resolving `roles`→palette before emitting role lines).

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/brand-palette.unit.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { effectiveBrand, paletteSlug, virtualPalette, brandSwatches } from '../../shared/brand/resolve'
import type { BrandKit } from '../../shared/brand/types'

const VIRIDIAN = { id: 'e1', name: 'Deep Viridian', hex: '#2A8C6E' }
const CORAL = { id: 'e2', name: 'Coral', hex: '#FF6B57' }

describe('paletteSlug', () => {
  it('lowercases and joins words with underscores', () => {
    expect(paletteSlug('Deep Viridian')).toBe('deep_viridian')
    expect(paletteSlug('Coral')).toBe('coral')
  })
  it('collapses repeats and trims edge separators', () => {
    expect(paletteSlug('  Neon -- Pink!! ')).toBe('neon_pink')
    expect(paletteSlug('Accent 2')).toBe('accent_2')
  })
  it('empty/symbol-only names slug to the empty string', () => {
    expect(paletteSlug('—')).toBe('')
  })
})

describe('virtualPalette', () => {
  it('derives entries + role mapping from legacy flat fields', () => {
    const { entries, roles } = virtualPalette({ primary: '#111111', background: '#000000' })
    expect(entries).toEqual([
      { id: 'legacy-primary', name: 'Primary', hex: '#111111' },
      { id: 'legacy-background', name: 'Background', hex: '#000000' },
    ])
    expect(roles).toEqual({ primary: 'legacy-primary', background: 'legacy-background' })
  })
  it('returns empty for kits with a real palette or no colors', () => {
    expect(virtualPalette({ palette: [VIRIDIAN] }).entries).toEqual([])
    expect(virtualPalette({}).entries).toEqual([])
    expect(virtualPalette(undefined).entries).toEqual([])
  })
})

describe('brandSwatches', () => {
  it('prefers palette entries, with names', () => {
    expect(brandSwatches({ palette: [VIRIDIAN, CORAL], primary: '#999999' }))
      .toEqual([{ name: 'Deep Viridian', hex: '#2A8C6E' }, { name: 'Coral', hex: '#FF6B57' }])
  })
  it('falls back to the virtual palette for legacy kits', () => {
    expect(brandSwatches({ accent: '#A3E635' })).toEqual([{ name: 'Accent', hex: '#A3E635' }])
  })
  it('skips palette entries missing a name or hex, and handles no kit', () => {
    expect(brandSwatches({ palette: [{ id: 'x', name: '', hex: '#fff' }, { id: 'y', name: 'Ok', hex: '' }, VIRIDIAN] }))
      .toEqual([{ name: 'Deep Viridian', hex: '#2A8C6E' }])
    expect(brandSwatches(undefined)).toEqual([])
  })
})

describe('effectiveBrand — palette & roles', () => {
  it('materializes role keys from roles→palette by id', () => {
    const kit: BrandKit = { palette: [VIRIDIAN, CORAL], roles: { background: 'e1', primary: 'e2' } }
    const b = effectiveBrand(undefined, kit)
    expect(b.background).toBe('#2A8C6E')
    expect(b.primary).toBe('#FF6B57')
  })
  it('renaming an entry does not break its role (id-referenced)', () => {
    const kit: BrandKit = { palette: [{ ...VIRIDIAN, name: 'Renamed' }], roles: { background: 'e1' } }
    expect(effectiveBrand(undefined, kit).background).toBe('#2A8C6E')
  })
  it('unmapped roles fall back to legacy flat values', () => {
    const kit: BrandKit = { palette: [VIRIDIAN], roles: { background: 'e1' }, primary: '#123456' }
    const b = effectiveBrand(undefined, kit)
    expect(b.primary).toBe('#123456')
  })
  it('dangling role ids (deleted entry) are ignored', () => {
    const kit: BrandKit = { palette: [VIRIDIAN], roles: { primary: 'gone' } }
    expect(effectiveBrand(undefined, kit).primary).toBeUndefined()
  })
  it('exposes flat palette token keys for real palettes', () => {
    const b = effectiveBrand(undefined, { palette: [VIRIDIAN] }) as unknown as Record<string, unknown>
    expect(b['palette.deep_viridian']).toBe('#2A8C6E')
  })
  it('exposes flat palette token keys for legacy (virtual) palettes', () => {
    const b = effectiveBrand(undefined, { accent: '#A3E635' }) as unknown as Record<string, unknown>
    expect(b['palette.accent']).toBe('#A3E635')
  })
  it('a later layer palette replaces the whole array; roles merge per-role', () => {
    const b = effectiveBrand(
      { palette: [CORAL], roles: { primary: 'e2', accent: 'e2' } },
      { palette: [VIRIDIAN], roles: { primary: 'e1' } },
    )
    expect(b.palette).toEqual([VIRIDIAN])
    expect(b.primary).toBe('#2A8C6E')   // e1 in the winning palette
    expect(b.accent).toBeUndefined()    // e2 no longer exists in the winning palette
  })
})
```

Append to `frontend/tests/unit/brand-kv.unit.spec.ts`:

```ts
describe('brandKitToKv — palette', () => {
  it('emits palette.<slug>= lines and materialized role lines', () => {
    expect(brandKitToKv({
      palette: [{ id: 'e1', name: 'Deep Viridian', hex: '#2A8C6E' }],
      roles: { background: 'e1' },
    })).toBe([
      'background=#2A8C6E',
      'palette.deep_viridian=#2A8C6E',
    ].join('\n'))
  })
  it('skips palette entries with empty name or hex', () => {
    expect(brandKitToKv({ palette: [{ id: 'x', name: '', hex: '#fff' }, { id: 'y', name: 'Ok', hex: '' }] })).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- tests/unit/brand-palette.unit.spec.ts tests/unit/brand-kv.unit.spec.ts`
Expected: FAIL — `paletteSlug`/`virtualPalette`/`brandSwatches` not exported; palette assertions fail.

- [ ] **Step 3: Implement**

In `frontend/shared/brand/types.ts`, add after `BrandAsset`:

```ts
export interface BrandPaletteEntry {
  id: string     // stable (e.g. crypto.randomUUID()); role refs survive renames
  name: string   // user-chosen, e.g. "Deep Viridian" — agents match on this
  hex: string    // #RRGGBB
}
```

and extend `BrandKit` (keep every existing field):

```ts
  /** Named color palette — the editing model. Legacy flat role fields above
   *  remain readable; new kits stop writing them once a palette exists. */
  palette?: BrandPaletteEntry[]
  /** Role → palette entry id. Roles are how templates bind ({{ brand.primary }}). */
  roles?: Partial<Record<BrandColorKey, string>>
```

In `frontend/shared/brand/resolve.ts`:

1. Extend the imports: `import type { BrandKit, BrandLogoSlots, BrandLogoSlotKey, BrandPaletteEntry } from './types'` and add `BrandColorKey` to the type imports.

2. Extend `compact()` — after the `assets` branch, add:

```ts
    else if (k === 'palette' && Array.isArray(v) && v.length) out.palette = v
    else if (k === 'roles' && v && typeof v === 'object' && !Array.isArray(v)) {
      const roles: Record<string, string> = {}
      for (const [rk, rv] of Object.entries(v)) {
        if (typeof rv === 'string' && rv !== '') roles[rk] = rv
      }
      if (Object.keys(roles).length) out.roles = roles
    }
```

3. Add the three helpers (above `effectiveBrand`):

```ts
/** Token slug for a palette entry name: lowercase, non-alphanumerics → "_",
 *  collapsed and trimmed. "Deep Viridian" → "deep_viridian". */
export function paletteSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

const LEGACY_ROLE_NAMES: Record<BrandColorKey, string> = {
  primary: 'Primary', secondary: 'Secondary', accent: 'Accent',
  accent2: 'Accent 2', foreground: 'Foreground', background: 'Background',
}

/** Derive a palette from a legacy kit's flat role fields. Empty when the kit
 *  already has a real palette (or no colors) — legacy kits need no migration;
 *  the editor persists this derivation on first palette edit. */
export function virtualPalette(kit: BrandKit | undefined): {
  entries: BrandPaletteEntry[]
  roles: Partial<Record<BrandColorKey, string>>
} {
  if (!kit || (kit.palette && kit.palette.length)) return { entries: [], roles: {} }
  const entries: BrandPaletteEntry[] = []
  const roles: Partial<Record<BrandColorKey, string>> = {}
  for (const key of BRAND_COLOR_KEYS) {
    const hex = kit[key]
    if (typeof hex === 'string' && hex !== '') {
      const id = `legacy-${key}`
      entries.push({ id, name: LEGACY_ROLE_NAMES[key], hex })
      roles[key] = id
    }
  }
  return { entries, roles }
}

/** One list for every swatch surface: named palette entries, falling back to
 *  the virtual (legacy-derived) palette. */
export function brandSwatches(kit: BrandKit | undefined): { name: string; hex: string }[] {
  if (!kit) return []
  const real = (kit.palette ?? []).filter(e => e.name !== '' && e.hex !== '')
  const entries = real.length ? real : virtualPalette(kit).entries
  return entries.map(e => ({ name: e.name, hex: e.hex }))
}
```

4. Replace `effectiveBrand` with:

```ts
/**
 * The one brand merge: template defaults ← active project kit ← wired socket
 * brand (the graph stays the ultimate override). Logo slots merge per-slot;
 * `logo` back-fills from `logos.primary`. Palette: a later layer's non-empty
 * palette replaces the whole array; roles merge per-role and then materialize
 * the six role keys (fallback: merged legacy flat values). Flat
 * `palette.<slug>` keys are added so {{ brand.palette.<slug> }} resolves via
 * the resolver's flat-first lookup — same shape the backend's KV parse yields.
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

  const roles: Partial<Record<BrandColorKey, string>> = Object.assign({}, ...layers.map(l => l.roles ?? {}))
  const palette = out.palette ?? []           // last non-empty array won via compact+assign
  const entries = palette.length ? palette : virtualPalette(out).entries
  const virtRoles = palette.length ? {} : virtualPalette(out).roles
  const allRoles = { ...virtRoles, ...roles }
  const byId = new Map(entries.map(e => [e.id, e]))
  for (const key of BRAND_COLOR_KEYS) {
    const entry = allRoles[key] != null ? byId.get(allRoles[key]!) : undefined
    if (entry) out[key] = entry.hex
    else if (palette.length && roles[key] != null) delete out[key]  // dangling id in a real palette
  }
  if (Object.keys(allRoles).length) out.roles = allRoles
  for (const e of entries) {
    const slug = paletteSlug(e.name)
    if (slug && e.hex) (out as Record<string, unknown>)[`palette.${slug}`] = e.hex
  }
  return out
}
```

5. Replace `brandKitToKv` role emission so roles materialize, and add palette lines. Full replacement:

```ts
export function brandKitToKv(kit: BrandKit): string {
  const c = compact(kit) as Record<string, unknown> & { logos?: BrandLogoSlots }
  const entries = (kit.palette ?? []).filter(e => e.name !== '' && e.hex !== '')
  const byId = new Map(entries.map(e => [e.id, e]))
  const lines: string[] = []
  for (const k of KV_ORDER) {
    if (k === 'logo') {
      const logo = c.logos?.primary ?? (c.logo as string | undefined)
      if (logo != null) lines.push(`logo=${logo}`)
      continue
    }
    // Role keys materialize through the palette mapping; flat legacy wins are
    // already in `c[k]`, mapping overrides them.
    const mapped = kit.roles?.[k as BrandColorKey]
    const viaPalette = mapped != null ? byId.get(mapped)?.hex : undefined
    const v = viaPalette ?? c[k]
    if (v != null) lines.push(`${k}=${v}`)
  }
  for (const slot of BRAND_LOGO_SLOT_KEYS) {
    const v = c.logos?.[slot]
    if (v != null) lines.push(`logos.${slot}=${v}`)
  }
  for (const e of entries) {
    const slug = paletteSlug(e.name)
    if (slug) lines.push(`palette.${slug}=${e.hex}`)
  }
  return lines.join('\n')
}
```

- [ ] **Step 4: Run the new tests, then all brand tests**

Run: `npm run test:unit -- tests/unit/brand-palette.unit.spec.ts tests/unit/brand-kv.unit.spec.ts tests/unit/brand-resolve.unit.spec.ts tests/unit/template-grid-tokens.unit.spec.ts`
Expected: PASS — including every pre-existing case (they pin back-compat).

- [ ] **Step 5: Run the full unit suite**

Run: `npm run test:unit`
Expected: no NEW failures beyond the known pre-existing set.

- [ ] **Step 6: Commit**

```bash
git add shared/brand/types.ts shared/brand/resolve.ts tests/unit/brand-palette.unit.spec.ts tests/unit/brand-kv.unit.spec.ts
git commit -m "feat(brand): named palette + role references in BrandKit resolution"
```

---

### Task 2: PalettePanel + KitPanel rewire (with legacy migration on first edit)

**Files:**
- Create: `frontend/app/components/brand/PalettePanel.vue`
- Modify: `frontend/app/components/brand/KitPanel.vue` (replace the fixed role color rows, template lines 17–31, and drop `COLOR_LABELS`/`setColor`)

**Interfaces:**
- Consumes: `BrandPaletteEntry`, `BrandColorKey`, `BRAND_COLOR_KEYS` from `~~/shared/brand/types`; `virtualPalette` from `~~/shared/brand/resolve`.
- Produces: `<BrandPalettePanel :kit="BrandKit" @update="(patch: Partial<BrandKit>) => …">` — emits whole-field patches `{ palette, roles }`; when persisting a derived legacy palette for the first time it ALSO clears the migrated flat fields (`{ palette, roles, primary: '', … }` for each field it derived from).

- [ ] **Step 1: Create `PalettePanel.vue`**

```vue
<script setup lang="ts">
/** Named brand palette editor + role assignment. The palette is the source of
 *  color truth; roles (what templates bind) reference entries BY ID so renames
 *  never break them. Legacy kits show their derived virtual palette; the first
 *  edit persists it and clears the migrated flat fields. */
import { BRAND_COLOR_KEYS, type BrandColorKey, type BrandKit, type BrandPaletteEntry } from '~~/shared/brand/types'
import { virtualPalette } from '~~/shared/brand/resolve'

const props = defineProps<{ kit: BrandKit }>()
const emit = defineEmits<{ update: [patch: Partial<BrandKit>] }>()

const ROLE_LABELS: Record<BrandColorKey, string> = {
  primary: 'Primary', secondary: 'Secondary', accent: 'Accent',
  accent2: 'Accent 2', foreground: 'Foreground', background: 'Background',
}

const isLegacy = computed(() => !(props.kit.palette && props.kit.palette.length))
const entries = computed<BrandPaletteEntry[]>(() =>
  isLegacy.value ? virtualPalette(props.kit).entries : props.kit.palette!)
const roles = computed<Partial<Record<BrandColorKey, string>>>(() =>
  isLegacy.value ? virtualPalette(props.kit).roles : (props.kit.roles ?? {}))

/** Every write goes through here: persists palette+roles, and on the first
 *  edit of a legacy kit clears the flat fields the derivation consumed. */
function persist(nextEntries: BrandPaletteEntry[], nextRoles: Partial<Record<BrandColorKey, string>>) {
  const patch: Partial<BrandKit> = { palette: nextEntries, roles: nextRoles }
  if (isLegacy.value) {
    for (const key of BRAND_COLOR_KEYS) {
      if (typeof props.kit[key] === 'string' && props.kit[key] !== '') (patch as Record<string, unknown>)[key] = ''
    }
  }
  emit('update', patch)
}

function addEntry() {
  persist([...entries.value, { id: crypto.randomUUID(), name: `Color ${entries.value.length + 1}`, hex: '#888888' }], roles.value)
}
function setEntry(id: string, patch: Partial<BrandPaletteEntry>) {
  persist(entries.value.map(e => e.id === id ? { ...e, ...patch } : e), roles.value)
}
function removeEntry(id: string) {
  // Unset any roles held by the deleted entry so the roles row updates.
  const nextRoles = { ...roles.value }
  for (const key of BRAND_COLOR_KEYS) if (nextRoles[key] === id) delete nextRoles[key]
  persist(entries.value.filter(e => e.id !== id), nextRoles)
}
function setRole(key: BrandColorKey, entryId: string) {
  const nextRoles = { ...roles.value }
  if (entryId === '') delete nextRoles[key]
  else nextRoles[key] = entryId
  persist(entries.value, nextRoles)
}
</script>

<template>
  <div class="space-y-2 text-xs">
    <div class="flex items-center justify-between">
      <span class="text-white/60">Palette</span>
      <button class="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.1] cursor-pointer text-white/70" @click="addEntry">Add color</button>
    </div>
    <div v-if="!entries.length" class="text-white/40">No colors yet — add one and name it.</div>
    <div v-for="e in entries" :key="e.id" class="flex items-center gap-1.5">
      <input
        type="color" :value="e.hex || '#000000'"
        class="size-6 shrink-0 rounded border border-white/10 bg-transparent p-0"
        @change="setEntry(e.id, { hex: ($event.target as HTMLInputElement).value })"
      ><!-- @change, not @input: every update PUTs the whole kit -->
      <input
        type="text" :value="e.name" placeholder="Name this color"
        class="min-w-0 flex-1 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
        @change="setEntry(e.id, { name: ($event.target as HTMLInputElement).value.trim() })"
      >
      <input
        type="text" :value="e.hex" placeholder="#RRGGBB"
        class="w-[4.5rem] shrink-0 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none"
        @change="setEntry(e.id, { hex: ($event.target as HTMLInputElement).value.trim() })"
      >
      <button class="shrink-0 size-5 rounded text-white/40 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer" title="Remove color" @click="removeEntry(e.id)">✕</button>
    </div>

    <!-- Roles: what templates bind ({{ brand.primary }} etc.) -->
    <div v-if="entries.length" class="pt-1 space-y-1">
      <span class="text-white/60">Roles</span>
      <div class="grid grid-cols-2 gap-x-2 gap-y-1">
        <label v-for="key in BRAND_COLOR_KEYS" :key="key" class="flex items-center justify-between gap-1.5">
          <span class="text-white/45">{{ ROLE_LABELS[key] }}</span>
          <select
            :value="roles[key] ?? ''"
            class="w-24 bg-[#1a1a1a] border border-[#2a2a2a] rounded px-1 py-0.5 text-white/90 outline-none cursor-pointer"
            @change="setRole(key, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">unset</option>
            <option v-for="e in entries" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </label>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Rewire `KitPanel.vue`**

In `frontend/app/components/brand/KitPanel.vue`:
1. Script block: remove `COLOR_LABELS` and `setColor`; the import shrinks to `import type { BrandKit } from '~~/shared/brand/types'`.
2. Template: replace the entire `v-for="key in BRAND_COLOR_KEYS"` block (lines 17–31) with:

```vue
    <BrandPalettePanel :kit="kit" @update="(p) => emit('update', p)" />
```

(Fonts + Logos sections stay as they are.)

- [ ] **Step 3: Verify — migration behavior via unit-level reasoning + smoke test**

Run: `npm run test:unit -- tests/unit/brand-palette.unit.spec.ts`
Expected: PASS (unchanged — the panel reuses `virtualPalette`, covered in Task 1).
Static check: `npx vue-tsc --noEmit 2>&1 | grep -i "PalettePanel\|KitPanel"` — expect no NEW errors (the repo has a large pre-existing tsc error baseline; only lines mentioning these two files matter). Skip if vue-tsc runs longer than ~3 minutes.

- [ ] **Step 4: Commit**

```bash
git add app/components/brand/PalettePanel.vue app/components/brand/KitPanel.vue
git commit -m "feat(brand): named palette editor + role assignment replaces fixed role rows"
```

---

### Task 3: Swatch surfaces move to `brandSwatches()`

**Files:**
- Modify: `frontend/app/components/vue-canvas/compositor/FillControl.vue` (lines 18, 97–101, 160–166)
- Modify: `frontend/app/components/vue-canvas/InpaintModal.vue` (lines 21, 443–450)
- Modify: `frontend/app/components/brand/StudioPage.vue` (lines 78, ~100)
- Modify: `frontend/app/components/brand/LibraryPopover.vue` (lines 48, ~68)
- Modify: `frontend/app/layouts/default.vue` (the `brandSwatches` computed at ~line 1577 ONLY — nothing else in this file)

**Interfaces:**
- Consumes: `brandSwatches(kit): { name, hex }[]` from `~~/shared/brand/resolve` (Task 1).
- Produces: every swatch surface shows named palette entries (legacy kits keep working via the virtual palette). No signature changes for consumers of `default.vue`'s `brandSwatches` computed (stays `string[]`).

- [ ] **Step 1: FillControl**

In `frontend/app/components/vue-canvas/compositor/FillControl.vue`:
1. Change the shared-types import (line 18) to `import type { BrandKit } from '~~/shared/brand/types'` and add `import { brandSwatches as kitSwatches } from '~~/shared/brand/resolve'`.
2. Replace the `brandSwatches` computed (lines 97–101) with:

```ts
const brandSwatches = computed(() => kitSwatches(projectBrand?.activeKit.value))
```

3. In the template's Brand row (lines 160–166), the loop becomes objects — change to:

```vue
        <button
          v-for="s in brandSwatches" :key="s.name + s.hex" type="button"
          class="size-5 rounded border border-white/15 cursor-pointer hover:scale-110 transition-transform"
          :style="{ background: s.hex }" :title="s.name" @click="applyBrandColor(s.hex)"
        />
```

- [ ] **Step 2: InpaintModal**

In `frontend/app/components/vue-canvas/InpaintModal.vue`:
1. Replace the import (line 21) with `import { brandSwatches } from '~~/shared/brand/resolve'`.
2. Replace the kit loop inside `recolorSwatches` (the `if (kit) { for (const key of BRAND_COLOR_KEYS) … }` block, lines ~446–451) with:

```ts
  for (const s of brandSwatches(brandLib.activeKit.value)) {
    if (!out.some(x => x.hex.toLowerCase() === s.hex.toLowerCase())) out.push({ label: s.name, hex: s.hex })
  }
```

(The `kit` local becomes unused — remove its declaration. The neutral-default fallback block stays.)

- [ ] **Step 3: StudioPage + LibraryPopover mini-swatches**

In both `frontend/app/components/brand/StudioPage.vue` (line 78 + usage ~100) and `frontend/app/components/brand/LibraryPopover.vue` (line 48 + usage ~68):
1. Delete `const SWATCH_KEYS = ['primary', 'accent', 'accent2'] as const`.
2. Add `import { brandSwatches } from '~~/shared/brand/resolve'` (LibraryPopover already has a script import block; StudioPage's imports sit at the top of its script).
3. Replace the swatch template span:

```vue
          <span v-for="s in brandSwatches(k.kit).slice(0, 3)" :key="s.name + s.hex" class="size-3 rounded-sm border border-white/10"
                :style="{ background: s.hex }" />
```

(In both files the loop variable `k` is the kit entry in the list — keep the surrounding markup identical.)

- [ ] **Step 4: default.vue ProjectMenu swatches**

In `frontend/app/layouts/default.vue`, replace the `brandSwatches` computed (~line 1577):

```ts
const brandSwatches = computed(() =>
  kitSwatches(brandLib.activeEntry.value?.kit).slice(0, 3).map(s => s.hex))
```

and add `import { brandSwatches as kitSwatches } from '~~/shared/brand/resolve'` next to the file's existing `~~/shared/brand` import (search for `brandKitToKv` — extend that import line's neighborhood; `brandKitToKv` is imported from `~~/shared/brand/resolve` already, so extend THAT import to `import { brandKitToKv, brandSwatches as kitSwatches } from '~~/shared/brand/resolve'`). Touch NOTHING else in this file.

- [ ] **Step 5: Verify + commit**

Run: `npm run test:unit -- tests/unit/brand-palette.unit.spec.ts` (helper regression) and confirm `git diff --stat` shows exactly the five files.

```bash
git add app/components/vue-canvas/compositor/FillControl.vue app/components/vue-canvas/InpaintModal.vue app/components/brand/StudioPage.vue app/components/brand/LibraryPopover.vue app/layouts/default.vue
git commit -m "feat(brand): swatch surfaces read the named palette via brandSwatches()"
```

---

### Task 4: Smart Layout inspector palette bind buttons

**Files:**
- Modify: `frontend/app/components/templates/GridPropertyPanel.vue` (next to `BRAND_COLOR_SLOTS`, line ~288)

**Interfaces:**
- Consumes: the panel's existing `effectiveBrand` computed (its result now carries `palette` + flat `palette.<slug>` keys), `paletteSlug` from `~~/shared/brand/resolve`, existing `brandTokenKey` (note its regex `brand\.(\w+)` does NOT match dotted paths — palette buttons manage their own active state).
- Produces: wherever the panel offers role bind buttons (fills/text color), palette entries appear as additional one-click binds to `{{ brand.palette.<slug> }}`.

- [ ] **Step 1: Add palette computeds**

Next to `BRAND_COLOR_SLOTS` (~line 288), add (extend the file's `~~/shared/brand` imports with `paletteSlug` from `~~/shared/brand/resolve` and `BrandPaletteEntry` type if needed):

```ts
// Named palette entries → one-click {{ brand.palette.<slug> }} binds, next to
// the role-slot binds. Names carry user meaning ("viridian"), roles carry
// template meaning — both stay available.
const brandPaletteEntries = computed(() =>
  (((effectiveBrand.value as any).palette ?? []) as { id: string; name: string; hex: string }[])
    .filter(e => e.name && e.hex && paletteSlug(e.name)))
function paletteTokenFor(name: string): string {
  return `{{ brand.palette.${paletteSlug(name)} }}`
}
```

- [ ] **Step 2: Surface the buttons**

Locate the template block that renders the role-slot bind buttons for fills/colors (the loop over `brandColorSlots` — search the template for `brandColorSlots`). Immediately after that loop's container, add:

```vue
        <button
          v-for="e in brandPaletteEntries" :key="e.id"
          class="px-1.5 h-6 rounded text-[10px] flex items-center gap-1 transition-colors cursor-pointer bg-white/[0.04] text-white/45 hover:bg-white/[0.08]"
          :title="`Bind to ${e.name}`"
          @click="bindToBrandToken(paletteTokenFor(e.name))"
        >
          <span class="size-3 rounded-sm border border-white/10" :style="{ background: e.hex }" />
          {{ e.name }}
        </button>
```

**Adaptation note:** the exact click handler name for "bind this style color to a brand token" must match what the role-slot buttons in that same loop call (the panel has a function that patches the style with a `{{ brand.<slot> }}` token — reuse it, passing the palette token string instead). If the existing handler takes a slot key rather than a full token, add a sibling one-liner that patches the same style key with the palette token. Read the surrounding code first; keep the change minimal and mirror the existing pattern. If the panel renders role binds in MORE than one place (e.g. text color and shape fill), add the palette buttons in each, same way.

- [ ] **Step 3: Verify + commit**

Run: `npm run test:unit -- tests/unit/template-grid-tokens.unit.spec.ts tests/unit/brand-palette.unit.spec.ts`
Expected: PASS. `git status --short` must show only `GridPropertyPanel.vue` staged at commit time.

```bash
git add app/components/templates/GridPropertyPanel.vue
git commit -m "feat(smart-layout): palette-entry bind buttons ({{ brand.palette.<slug> }})"
```

---

### Task 5: Agent awareness (Smart Layout hints + Compositor context)

**Files:**
- Modify: `frontend/app/lib/agent/surfaces/smartLayout.ts` (op hints, lines ~109–122)
- Modify: `frontend/app/lib/agent/surfaces/compositor.ts` (`CompositorState`, `describeCompositor`)
- Modify: `frontend/app/components/vue-canvas/CompositorModal.vue` (the `useCompositorAgent({ getState … })` block at line ~341)

**Interfaces:**
- Consumes: `brandSwatches` from `~~/shared/brand/resolve`; CompositorModal's existing `projectBrand` inject.
- Produces: `CompositorState.brandPalette?: { name: string; hex: string }[]`; the compositor snapshot's document object gains a `brandPalette` string; Smart Layout hints teach palette tokens.

- [ ] **Step 1: Smart Layout op hints**

In `frontend/app/lib/agent/surfaces/smartLayout.ts` make exactly these three string edits:
1. `setTextColor` hint (line ~109): after `OR a brand token like "{{ brand.foreground }}" / "{{ brand.primary }}" to bind it to the kit.` insert: `If the user names a brand palette colour (the brand context lists palette.<name> entries, e.g. "viridian"), bind "{{ brand.palette.<name> }}".`
2. `setElementStyle` hint (line ~110): after `colours: "{{ brand.primary|secondary|accent|accent2|foreground|background }}", fonts: "{{ brand.fontDisplay|fontBody }}".` insert: `Named palette colours bind as "{{ brand.palette.<name> }}" (see palette.* entries in the brand context).`
3. `setBackground` hint (line ~118): after `fill may also be a brand token like "{{ brand.background }}".` insert: `Or a named palette colour: "{{ brand.palette.<name> }}" when the user says e.g. "make the background viridian".`

- [ ] **Step 2: Compositor surface**

In `frontend/app/lib/agent/surfaces/compositor.ts`:
1. Extend the state interface:

```ts
export interface CompositorState {
  layers: LocalLayer[]
  background?: Paint
  /** Active brand kit's named palette — context only (compositor paints are
   *  literal hexes; the model translates "viridian" → its hex). */
  brandPalette?: { name: string; hex: string }[]
}
```

2. In `describeCompositor`, in the pushed `document` object's `current`, add after `coordinateSpace`:

```ts
      ...(state.brandPalette?.length
        ? { brandPalette: state.brandPalette.map(s => `${s.name} ${s.hex}`).join(', ') }
        : {}),
```

3. Check `applyCompositorCommand`'s state constructions: it builds fresh states from `{ layers, background }` — thread `brandPalette` through by spreading. Search the function (and its helpers) for `return { ok: true, template: state` patterns: `state` is built earlier; find where the new state object is first constructed (e.g. `const state = { layers: …, background: … }`) and include `brandPalette: input.brandPalette`. If states are produced by cloning `input`, nothing to do — verify and note which case held in your report.

- [ ] **Step 3: CompositorModal getState**

In `frontend/app/components/vue-canvas/CompositorModal.vue` (line ~341), change:

```ts
  getState: () => ({ layers: localLayers.value, background: background.value }),
```

to:

```ts
  getState: () => ({
    layers: localLayers.value,
    background: background.value,
    brandPalette: brandSwatches(projectBrand?.activeKit.value),
  }),
```

and add `brandSwatches` to the file's `~~/shared/brand/resolve` import (the file already imports `brandLogoUrl`? — check; if there is no existing import from `~~/shared/brand/resolve`, add `import { brandSwatches } from '~~/shared/brand/resolve'`).

- [ ] **Step 4: Verify + commit**

Run: `npm run test:unit -- tests/unit/agent-compositor-surface.unit.spec.ts tests/unit/agent-smart-layout-surface.unit.spec.ts`
Expected: PASS (these exercise `describeCompositor`/hints; if a snapshot-shape assertion fails because of the new optional field, the change broke a real contract — investigate, don't just update the snapshot; an ADDITIVE document field should not break existing assertions).

```bash
git add app/lib/agent/surfaces/smartLayout.ts app/lib/agent/surfaces/compositor.ts app/components/vue-canvas/CompositorModal.vue
git commit -m "feat(agent): smart-layout + compositor agents understand brand palette names"
```

---

### Task 6: Full verification pass

**Files:** none (verification; fix regressions where found).

- [ ] **Step 1: Full unit suite**

Run: `npm run test:unit`
Expected: no NEW failures beyond the known pre-existing set (gradientfx-mesh, spacetype-palette ×2, video-model-adapt, agent-capability-routing, artifact-next-steps ×2, critique-fix-chips ×2).

- [ ] **Step 2: Live walkthrough (dev server via preview tooling; use http://127.0.0.1:<port> — localhost 426s)**

1. Brand page → open a legacy kit: derived palette shows ("Primary" etc. with its colors), roles row pre-assigned. Edit one name → kit JSON now has `palette` + `roles`, migrated flat fields cleared.
2. Add "Viridian" `#2A8C6E`, assign it the Background role. Rename it "Deep Viridian" → role assignment survives (roles row still shows it; kit JSON `roles.background` id unchanged).
3. Project with the kit active: FillControl Brand row shows named swatches (hover tooltip = name); ProjectMenu/Studio mini-swatches show palette colors.
4. Smart Layout inspector: palette bind buttons appear next to role binds; clicking one sets `{{ brand.palette.deep_viridian }}` and the preview renders the hex.
5. Compositor agent context: with the modal open, confirm (via code path or agent debug) the snapshot document contains `brandPalette: "Deep Viridian #2A8C6E"`.
6. No-brand state: unassign the kit — swatch rows/buttons hidden.

- [ ] **Step 3: Commit any fixes**

`git status` — commit fixes with focused messages if needed.

---

## Self-Review Notes (spec → plan coverage)

- Spec §1 data model → Task 1. §2 resolution/tokens/KV → Task 1 (flat `palette.<slug>` keys ride the existing flat-first deep-token lookup from the previous feature; no tokens.ts change needed). §3 editor UI + migration-on-first-edit → Task 2. §4 agents → Task 5. §5 swatch surfaces → Tasks 3–4 (GridEditorShell's brand popover reads template-side defaults, not the kit — deliberately untouched). §6 edge cases → Task 1 tests (dangling ids, empty entries) + hidden states preserved by `brandSwatches` returning `[]`. §7 testing → Tasks 1 + 6.
- Known adaptation point: Task 4's bind-handler name is resolved by the implementer against the current (recently reworked) GridPropertyPanel — mirror the existing role-bind pattern.
