<script setup lang="ts">
// Gallery for a BatchGrid node: contact-sheet grid grouped by format,
// per-image download + Download-all ZIP (same JSZip pattern as
// CollectionDrawer.exportZip).
import { Download, X, Loader2 } from 'lucide-vue-next'
import { downloadBatchZip } from '~/lib/collection/batchZip'
import type { BatchGridItem, BatchGridPayload } from '~/lib/collection/matrix'

const props = defineProps<{ payload: BatchGridPayload }>()
const emit = defineEmits<{ close: [] }>()

const byFormat = computed<{ label: string; items: BatchGridItem[] }[]>(() => {
  const groups = new Map<string, BatchGridItem[]>()
  for (const item of props.payload.items) {
    const list = groups.get(item.formatLabel) ?? []
    list.push(item)
    groups.set(item.formatLabel, list)
  }
  return [...groups.entries()].map(([label, items]) => ({ label, items }))
})

function varsLine(item: BatchGridItem): string {
  return Object.entries(item.vars).map(([k, v]) => `${k}: ${v}`).join(' · ')
}

function downloadOne(item: BatchGridItem) {
  const a = document.createElement('a')
  a.href = item.url
  a.download = item.filename
  a.click()
}

const zipping = ref(false)
async function downloadZip() {
  if (zipping.value) return
  zipping.value = true
  try {
    await downloadBatchZip(props.payload)
  } finally {
    zipping.value = false
  }
}

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="fixed inset-0 z-[95] bg-black/70 flex items-center justify-center p-6" @click.self="emit('close')">
    <div class="w-full max-w-5xl max-h-[85vh] rounded-xl bg-[#141419] border border-white/10 flex flex-col overflow-hidden">
      <div class="flex items-center gap-2 px-4 h-12 border-b border-white/[0.08] shrink-0">
        <p class="text-sm text-white/90">{{ payload.layoutName || 'Batch export' }}</p>
        <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/60">{{ payload.items.length }} outputs</span>
        <button
          class="ml-auto flex items-center gap-1.5 h-7 px-2.5 rounded bg-white/10 hover:bg-white/15 text-xs text-white/85 cursor-pointer disabled:opacity-50"
          :disabled="zipping"
          @click="downloadZip"
        >
          <Loader2 v-if="zipping" class="size-3.5 animate-spin" />
          <Download v-else class="size-3.5" />
          Download all (ZIP)
        </button>
        <button class="size-7 rounded hover:bg-white/10 flex items-center justify-center text-white/60 cursor-pointer" @click="emit('close')">
          <X class="size-4" />
        </button>
      </div>
      <div class="overflow-y-auto p-4 flex flex-col gap-5">
        <section v-for="group in byFormat" :key="group.label">
          <p class="text-[11px] uppercase tracking-wide text-white/40 mb-2">{{ group.label }} · {{ group.items.length }}</p>
          <div class="grid grid-cols-3 md:grid-cols-4 gap-3">
            <figure v-for="item in group.items" :key="item.filename" class="group relative">
              <img :src="item.url" class="w-full rounded-md border border-white/10" loading="lazy" draggable="false">
              <button
                class="absolute top-1.5 right-1.5 size-6 rounded bg-black/60 text-white/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                title="Download"
                @click="downloadOne(item)"
              >
                <Download class="size-3.5" />
              </button>
              <figcaption class="mt-1 text-[10px] text-white/45 truncate" :title="varsLine(item)">{{ varsLine(item) || item.formatLabel }}</figcaption>
            </figure>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
