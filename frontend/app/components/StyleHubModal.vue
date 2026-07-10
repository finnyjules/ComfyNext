<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import CatalogModal from '~/components/CatalogModal.vue'
import { hubItems, hubFilters, filterHubItems, hubNodeOptions, type HubItem } from '~/lib/styleHub'
import { useNodeSearch } from '~/composables/useNodeSearch'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { addNode } = useNodeSearch()

const all = hubItems()
const activeFilterId = ref('all')
const searchQuery = ref('')
const selectedId = ref<string | null>(null)
const items = computed(() => filterHubItems(all, activeFilterId.value, searchQuery.value))
const filters = computed(() => hubFilters(all))

// Hover-cycle: one shared index ticker; each hovered house card cycles its 4 thumbs.
const hoveredId = ref<string | null>(null)
const cycleIdx = ref(0)
let cycleTimer: ReturnType<typeof setInterval> | null = null
function onCardEnter(item: HubItem) {
  hoveredId.value = item.id
  cycleIdx.value = 0
  if (cycleTimer) clearInterval(cycleTimer)
  cycleTimer = setInterval(() => { cycleIdx.value = (cycleIdx.value + 1) % 4 }, 700)
}
function onCardLeave() {
  hoveredId.value = null
  if (cycleTimer) { clearInterval(cycleTimer); cycleTimer = null }
}
onBeforeUnmount(() => { if (cycleTimer) clearInterval(cycleTimer) })
function cardThumb(item: HubItem): string | null {
  if (!item.thumbnails.length) return null
  const idx = hoveredId.value === item.id ? cycleIdx.value % item.thumbnails.length : 0
  return item.thumbnails[idx] ?? null
}

function onConfirm(item: HubItem) {
  const opts = hubNodeOptions(item)
  addNode('FluxLoRARemoteNode', opts)
  emit('close')
}
</script>

<template>
  <CatalogModal
    :open="open" title="Style Library" subtitle="House-trained styles + community LoRAs"
    :items="items" :selected-id="selectedId" :filters="filters" :active-filter-id="activeFilterId"
    :search-query="searchQuery" search-placeholder="Search styles…" confirm-label="Use style"
    empty-message="No styles match."
    @close="emit('close')" @confirm="onConfirm"
    @update:selected-id="selectedId = $event"
    @update:active-filter-id="activeFilterId = $event"
    @update:search-query="searchQuery = $event"
  >
    <template #card="{ item }">
      <div class="flex flex-col gap-2" @mouseenter="onCardEnter(item)" @mouseleave="onCardLeave()">
        <img v-if="cardThumb(item)" :src="cardThumb(item)!" class="w-full aspect-square rounded object-cover" />
        <div v-else class="w-full aspect-square rounded bg-white/5 flex items-center justify-center text-xs text-white/40 p-2 text-center">
          {{ item.label }}
        </div>
        <div class="flex items-center gap-1.5">
          <span class="text-xs font-medium truncate">{{ item.label }}</span>
          <span v-if="item.tier === 'house'" class="text-[10px] px-1 rounded bg-white/15 shrink-0">house</span>
        </div>
      </div>
    </template>

    <template #detail="{ item }">
      <div class="space-y-3">
        <div v-if="item.thumbnails.length" class="grid grid-cols-2 gap-2">
          <img v-for="t in item.thumbnails" :key="t" :src="t" class="rounded aspect-square object-cover" />
        </div>
        <h3 class="text-sm font-semibold">{{ item.label }}</h3>
        <div class="flex flex-wrap gap-1">
          <span v-for="t in item.useCases" :key="t" class="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/60">{{ t }}</span>
        </div>
        <details v-if="item.tier === 'house'" class="text-xs text-white/60">
          <summary class="cursor-pointer text-white/40">Taste profile</summary>
          <p class="mt-1 whitespace-pre-wrap">{{ item.blurb }}</p>
        </details>
        <p v-else class="text-xs text-white/60">{{ item.blurb }}</p>
        <div v-if="item.house?.examplePrompts.length || item.community?.examplePrompt" class="text-xs">
          <div class="text-white/40 mb-1">Example prompt</div>
          <p class="text-white/70 italic">{{ item.house?.examplePrompts[0] ?? item.community?.examplePrompt }}</p>
        </div>
      </div>
    </template>
  </CatalogModal>
</template>
