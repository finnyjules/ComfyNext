<script setup lang="ts">
/** Free-form brand image collection (product shots, patterns, textures).
 *  Metadata lives on the kit; files live in the ComfyUI input folder. */
import type { BrandAsset, BrandKit } from '~~/shared/brand/types'
import { uploadBrandImage } from '~/lib/brand/upload'
import { toast } from 'vue-sonner'

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
    } catch (err) {
      console.error('[Brand] asset upload:', err)
      toast.error(`Upload failed: ${file.name}`)
    }
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
