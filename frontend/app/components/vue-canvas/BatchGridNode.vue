<script setup lang="ts">
// Frontend-only results pile from a Smart Layout batch export — chromeless
// like the artifact cards: a slightly disorderly stack of outputs with a
// count badge. Clicking the pile selects the node (Vue Flow default);
// explicit actions live in the toolbar below: expand (gallery) + ZIP.
// The gallery modal is owned by VueNodeCanvas (codebase convention —
// node-local modal state doesn't survive Vue Flow node re-renders). Data
// lives in properties.sailor_batch and rehydrates with the workflow.
import { Download, Loader2, Maximize2 } from 'lucide-vue-next'
import { BATCH_PROP, type BatchGridPayload } from '~/lib/collection/matrix'
import { downloadBatchZip } from '~/lib/collection/batchZip'

const props = defineProps<{ id: string; data: any }>()

const payload = computed<BatchGridPayload | null>(
  () => props.data?.properties?.[BATCH_PROP] ?? null)
const items = computed(() => payload.value?.items ?? [])
const count = computed(() => items.value.length)

// The messy pile: up to two peek cards behind the cover, each with its own
// tilt. Deterministic per node (id-seeded) so the pile doesn't reshuffle on
// every re-render, but different nodes lean differently.
const seed = computed(() => [...String(props.id)].reduce((a, ch) => a + ch.charCodeAt(0), 0))
const tilt = (i: number) => {
  const base = [-6, 5, -2][i % 3]!
  return base + ((seed.value >> (i * 2)) % 3) - 1
}
const peeks = computed(() => items.value.slice(1, 3))

function openGallery() {
  window.dispatchEvent(new CustomEvent('sailor:openBatchGallery', { detail: { nodeId: props.id } }))
}

const zipping = ref(false)
async function downloadZip() {
  if (zipping.value || !payload.value) return
  zipping.value = true
  try {
    await downloadBatchZip(payload.value)
  } finally {
    zipping.value = false
  }
}

const btnCls = 'size-7 rounded-md bg-white/[0.06] hover:bg-white/[0.14] border border-white/10 '
  + 'flex items-center justify-center text-white/60 hover:text-white transition-colors cursor-pointer disabled:opacity-50'
</script>

<template>
  <div class="w-[220px] select-none">
    <!-- The pile: clicking selects the node, dragging moves it (no handlers
         here on purpose). Cover scales down uncropped within 220×190 max;
         the shrink-wrap wrapper makes the peeks track the cover's box. -->
    <div class="relative flex justify-center w-full">
      <div class="relative inline-block max-w-full">
        <!-- peek cards — real outputs poking out at odd angles (cropped to the
             cover's box; they're decorative backdrop) -->
        <img
          v-for="(peek, i) in peeks"
          :key="peek.filename"
          :src="peek.url"
          class="absolute inset-0 w-full h-full object-cover rounded-lg border border-white/15 shadow-lg"
          :style="{ transform: `rotate(${tilt(i + 1)}deg) translate(${(i + 1) * 4}px, ${(i + 1) * 3}px)` }"
          draggable="false"
        >
        <!-- cover — never cropped -->
        <img
          v-if="items[0]"
          :src="items[0].url"
          class="relative block max-w-full max-h-[190px] w-auto h-auto rounded-lg border border-white/20 shadow-xl"
          :style="{ transform: `rotate(${tilt(0) / 3}deg)` }"
          draggable="false"
        >
        <div v-else class="relative w-[190px] h-[150px] rounded-lg bg-white/[0.05] border border-dashed border-white/15 flex items-center justify-center text-white/30 text-xs">
          no outputs
        </div>
        <!-- count badge — pinned to the pile itself -->
        <span class="absolute -top-2 -right-2 min-w-6 h-6 px-1.5 rounded-full bg-[#96b4ff] text-neutral-900 text-[11px] font-semibold flex items-center justify-center shadow-md">
          {{ count }}
        </span>
      </div>
    </div>

    <p class="mt-2 text-[10px] text-white/40 text-center truncate">
      {{ payload?.layoutName || 'Batch' }} · {{ count }} outputs
    </p>
    <!-- Actions — expand (gallery modal) + download (ZIP of all outputs) -->
    <div class="mt-1.5 flex flex-col items-center gap-1.5 nopan nodrag">
      <button :class="btnCls" title="Expand" @click.stop="openGallery">
        <Maximize2 class="size-3.5" />
      </button>
      <button :class="btnCls" title="Download all (ZIP)" :disabled="zipping" @click.stop="downloadZip">
        <Loader2 v-if="zipping" class="size-3.5 animate-spin" />
        <Download v-else class="size-3.5" />
      </button>
    </div>
  </div>
</template>
