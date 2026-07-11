<script setup lang="ts">
/** Top-level Brand page (the `brand` tab): manage the app-wide kit library —
 *  colors, fonts, logo slots, assets. Assignment to a project stays in the
 *  ProjectMenu popover; this page never touches ProjectDoc.brandKitId. */
import type { BrandKit, BrandKitEntry } from '~~/shared/brand/types'
import { brandSwatches } from '~~/shared/brand/resolve'
import { useBrandLibrary, slugifyKitName } from '~/composables/useBrandLibrary'
import { toast } from 'vue-sonner'

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
  try {
    await save(entry)
    selectedId.value = entry.id
  } catch (err) {
    console.error('[Brand] save kit:', err)
    toast.error('Brand kit save failed')
  }
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
  try {
    await save(entry)
    selectedId.value = entry.id
  } catch (err) {
    console.error('[Brand] save kit:', err)
    toast.error('Brand kit save failed')
  }
}
async function renameKit(name: string) {
  if (!selected.value || !name.trim()) return
  try {
    await save({ ...selected.value, name: name.trim() })
  } catch (err) {
    console.error('[Brand] save kit:', err)
    toast.error('Brand kit save failed')
  }
}
async function deleteKit() {
  if (!selected.value) return
  try {
    await remove(selected.value.id)
    selectedId.value = kits.value[0]?.id ?? null
  } catch (err) {
    console.error('[Brand] delete kit:', err)
    toast.error('Brand kit delete failed')
  }
}
async function patchKit(patch: Partial<BrandKit>) {
  if (!selected.value) return
  try {
    await save({ ...selected.value, kit: { ...selected.value.kit, ...patch } })
  } catch (err) {
    console.error('[Brand] save kit:', err)
    toast.error('Brand kit save failed')
  }
}
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
            <span v-for="s in brandSwatches(k.kit).slice(0, 3)" :key="s.name + s.hex" class="size-3 rounded-sm border border-white/10"
                  :style="{ background: s.hex }" />
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
