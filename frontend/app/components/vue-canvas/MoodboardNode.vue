<!-- frontend/app/components/vue-canvas/MoodboardNode.vue -->
<script setup lang="ts">
// Moodboard pile card (plan 2026-08-06-moodboards-a-core, Task A5): the canvas
// face of an app-level moodboard library entry. Library owns the entry; this
// node only REFERENCES it by id in properties.sailor_moodboard — the sole
// persistent state (convertToLiteGraph drops any other data.* field on save).
// Click (a true click, not a drag) opens the brand-guidelines modal (A6).
import { useMoodboards } from '~/composables/useMoodboards'
import PileStack from './PileStack.vue'

const props = defineProps<{ id: string; data: any; selected?: boolean }>()

const { byId, loaded, refresh } = useMoodboards()
onMounted(() => { if (!loaded.value) void refresh() })

const entryId = computed(() => String(props.data?.properties?.sailor_moodboard || ''))
const entry = computed(() => (entryId.value ? byId(entryId.value) : undefined))

// Board image FILENAMES are component-local state (never node data): fetched
// from the list route whenever the referenced entry's folder changes.
const files = ref<string[]>([])
watch(() => entry.value?.folder, async (folder) => {
  files.value = []
  if (!folder) return
  try {
    const res = await fetch(`/api/moodboards/images?folder=${encodeURIComponent(folder)}`)
    if (res.ok) files.value = (await res.json()).files ?? []
  } catch { /* offline dev — keep the empty pile */ }
}, { immediate: true })

const images = computed(() => {
  const folder = entry.value?.folder
  if (!folder) return []
  return files.value.slice(0, 5).map(f =>
    `/api/moodboards/images?folder=${encodeURIComponent(folder)}&file=${encodeURIComponent(f)}`)
})
const overflow = computed(() => Math.max(0, files.value.length - 5))

function openBoard() {
  window.dispatchEvent(new CustomEvent('sailor:openMoodboard', { detail: { nodeId: props.id } }))
}

// Click-vs-drag: Vue Flow drags start on pointerdown; only open the modal for
// a true click (pointer travelled < 5px), so moving the pile doesn't pop it.
let downAt: { x: number, y: number } | null = null
function onPointerDown(e: PointerEvent) { downAt = { x: e.clientX, y: e.clientY } }
function onClick(e: MouseEvent) {
  if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) >= 5) return
  openBoard()
}
</script>

<template>
  <div class="w-[220px] select-none cursor-pointer" @pointerdown="onPointerDown" @click="onClick">
    <PileStack v-if="images.length" :images="images" :seed-key="entryId || String(props.id)" :selected="selected">
      <template #rail>
        <span
          v-if="overflow"
          class="min-w-6 h-6 px-1.5 rounded-full bg-black/55 backdrop-blur-sm border border-white/15 text-white/75 text-[11px] font-semibold flex items-center justify-center shadow-md"
          :title="`${files.length} images`"
        >+{{ overflow }}</span>
      </template>
    </PileStack>
    <!-- Empty board: dashed invitation (PileStack's own empty state says
         "no outputs", which is a results-deck voice — this is an input). -->
    <div v-else class="relative flex justify-center w-full">
      <div
        :class="['w-[190px] h-[150px] rounded-lg bg-white/[0.05] border border-dashed flex items-center justify-center text-white/30 text-[11px]',
                 selected ? 'border-action ring-2 ring-action/40' : 'border-white/15']"
      >
        drop inspiration
      </div>
    </div>
    <div class="mt-2 px-1 text-center">
      <div class="text-[13px] font-medium text-white/90 truncate">{{ entry?.name || 'Moodboard' }}</div>
      <div v-if="entry?.reading?.summary" class="text-[11px] text-white/45 truncate">{{ entry.reading.summary }}</div>
    </div>
  </div>
</template>
