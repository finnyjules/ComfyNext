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
