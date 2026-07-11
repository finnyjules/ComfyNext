<script setup lang="ts">
// Frontend-only results deck from a Smart Layout batch export. Shows the
// first output as a stacked deck + count badge; click opens the gallery
// modal (owned here, teleported to body). Data lives in
// properties.sailor_batch and rehydrates with the workflow.
import { Images } from 'lucide-vue-next'
import { BATCH_PROP, type BatchGridPayload } from '~/lib/collection/matrix'

const props = defineProps<{ id: string; data: any }>()

const payload = computed<BatchGridPayload | null>(
  () => props.data?.properties?.[BATCH_PROP] ?? null)
const cover = computed(() => payload.value?.items?.[0]?.url ?? '')
const count = computed(() => payload.value?.items?.length ?? 0)

const galleryOpen = ref(false)
</script>

<template>
  <div class="w-[240px] rounded-xl bg-[#141419] border border-white/10 shadow-lg select-none">
    <div class="flex items-center gap-1.5 px-3 h-9 border-b border-white/[0.06]">
      <Images class="size-3.5 text-white/60" />
      <span class="text-xs text-white/85 truncate">{{ payload?.layoutName || 'Batch' }}</span>
      <span class="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/60">{{ count }}</span>
    </div>
    <div class="p-3 nopan nodrag">
      <button
        class="relative block w-full cursor-pointer group"
        title="Open gallery"
        @click="galleryOpen = true"
      >
        <!-- deck shadows -->
        <div class="absolute inset-0 translate-x-2 translate-y-2 rounded-md bg-white/[0.04] border border-white/10" />
        <div class="absolute inset-0 translate-x-1 translate-y-1 rounded-md bg-white/[0.07] border border-white/10" />
        <img
          v-if="cover"
          :src="cover"
          class="relative w-full rounded-md border border-white/15 group-hover:border-white/30 transition-colors"
          draggable="false"
        >
        <div v-else class="relative w-full aspect-square rounded-md bg-white/[0.05] flex items-center justify-center text-white/30 text-xs">
          no outputs
        </div>
      </button>
      <p class="mt-2 text-[10px] text-white/40 text-center">Click to browse {{ count }} outputs</p>
    </div>

    <Teleport to="body">
      <VueCanvasBatchGridModal v-if="galleryOpen && payload" :payload="payload" @close="galleryOpen = false" />
    </Teleport>
  </div>
</template>
