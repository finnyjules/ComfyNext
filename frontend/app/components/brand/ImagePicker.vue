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
import { toast } from 'vue-sonner'

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
    toast.error('Could not add brand image')
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
