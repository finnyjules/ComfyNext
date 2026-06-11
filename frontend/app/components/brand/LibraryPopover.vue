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

    <!-- App-wide brand fonts (shared across kits + projects) -->
    <div class="pt-2 border-t border-white/10">
      <BrandFontsPanel />
    </div>
  </div>
</template>
