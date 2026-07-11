<script setup lang="ts">
/**
 * Image source picker for the Smart Layout editor. Opened by the Image tool,
 * it offers two sources — images already on the ComfyUI node graph ("On canvas",
 * passed in) and the project's asset library ("Assets", fetched here). Picking a
 * thumbnail emits its URL; the shell adds an image element with that content.
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { useAssetLibrary } from '~/composables/useAssetLibrary'

const props = defineProps<{
  canvasImages: Array<{ url: string; label?: string }>
}>()
const emit = defineEmits<{ select: [url: string]; close: [] }>()

const { imageAssets, loading, fetchAssets, assetUrl } = useAssetLibrary()

type Tab = 'canvas' | 'assets'
// Open on whichever source actually has something.
const tab = ref<Tab>(props.canvasImages.length ? 'canvas' : 'assets')

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); emit('close') }
}
onMounted(() => {
  fetchAssets()
  window.addEventListener('keydown', onKey, true)
})
onUnmounted(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div
    class="absolute inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div class="flex max-h-[70vh] w-[560px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#141414] shadow-2xl">
      <!-- Tabs -->
      <div class="flex h-11 shrink-0 items-center gap-1 border-b border-white/[0.06] px-3">
        <button
          class="h-8 rounded-md px-3 text-[12px] transition-colors cursor-pointer"
          :class="tab === 'canvas' ? 'bg-white/[0.08] text-white' : 'text-white/55 hover:text-white'"
          @click="tab = 'canvas'"
        >
          On canvas <span class="text-white/30">{{ canvasImages.length }}</span>
        </button>
        <button
          class="h-8 rounded-md px-3 text-[12px] transition-colors cursor-pointer"
          :class="tab === 'assets' ? 'bg-white/[0.08] text-white' : 'text-white/55 hover:text-white'"
          @click="tab = 'assets'"
        >
          Assets <span class="text-white/30">{{ imageAssets.length }}</span>
        </button>
        <div class="flex-1" />
        <button
          class="flex size-8 items-center justify-center rounded-md text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white cursor-pointer"
          title="Close (Esc)"
          @click="emit('close')"
        >
          <X class="size-4" />
        </button>
      </div>

      <!-- Body -->
      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <template v-if="tab === 'canvas'">
          <div v-if="!canvasImages.length" class="py-10 text-center text-[12px] leading-relaxed text-white/40">
            No images on the canvas yet.<br>Generate or drop images on the graph, or switch to Assets.
          </div>
          <div v-else class="grid grid-cols-3 gap-2">
            <button
              v-for="(img, i) in canvasImages"
              :key="`c${i}`"
              class="relative aspect-square overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.03] transition-colors hover:border-white/40 cursor-pointer"
              :title="img.label || img.url"
              @click="emit('select', img.url)"
            >
              <img :src="img.url" class="size-full object-cover" draggable="false">
              <span v-if="img.label" class="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-left text-[9px] text-white/80">{{ img.label }}</span>
            </button>
          </div>
        </template>

        <template v-else>
          <div v-if="loading" class="py-10 text-center text-[12px] text-white/40">Loading assets…</div>
          <div v-else-if="!imageAssets.length" class="py-10 text-center text-[12px] text-white/40">No image assets yet.</div>
          <div v-else class="grid grid-cols-3 gap-2">
            <button
              v-for="a in imageAssets"
              :key="a.id"
              class="relative aspect-square overflow-hidden rounded-md border border-white/[0.06] bg-white/[0.03] transition-colors hover:border-white/40 cursor-pointer"
              :title="a.name"
              @click="emit('select', assetUrl(a))"
            >
              <img :src="assetUrl(a)" class="size-full object-cover" draggable="false">
              <span class="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-left text-[9px] text-white/80">{{ a.name }}</span>
            </button>
          </div>
        </template>
      </div>

      <!-- Footer -->
      <div class="flex h-11 shrink-0 items-center justify-between border-t border-white/[0.06] px-3">
        <button
          class="cursor-pointer text-[11px] text-white/50 underline underline-offset-2 hover:text-white"
          title="Add an image element with no source — fill it later or wire it to a socket"
          @click="emit('select', '')"
        >
          Add empty placeholder
        </button>
        <span class="text-[10px] text-white/30">Pick an image to place it on the artboard</span>
      </div>
    </div>
  </div>
</template>
