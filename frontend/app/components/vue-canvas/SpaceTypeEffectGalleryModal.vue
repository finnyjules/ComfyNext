<script setup lang="ts">
// Effect picker for Type Studio — wraps the shared CatalogModal. Cards show a cached
// default-look thumbnail per effect (generated once by effectThumbnails). Picking an
// effect emits `select`; the editor sets effectId and the existing watcher switches.
import { ref, computed, onMounted } from 'vue'
import { SPACE_TYPE_EFFECTS } from '~/lib/spacetype/effects'
import { effectThumbnails } from '~/lib/spacetype/thumbnails'

const props = defineProps<{ selectedId: string }>()
const emit = defineEmits<{ close: []; select: [id: string] }>()

const thumbs = ref<Record<string, string>>({})
onMounted(async () => { thumbs.value = await effectThumbnails() })

const searchQuery = ref('')
const draftId = ref(props.selectedId)
const items = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return SPACE_TYPE_EFFECTS
    .map(e => ({ id: e.id, label: e.label }))
    .filter(e => !q || e.label.toLowerCase().includes(q))
})
</script>

<template>
  <CatalogModal
    :open="true"
    title="Pick an effect"
    :subtitle="`${SPACE_TYPE_EFFECTS.length} effects`"
    :items="items"
    :selected-id="draftId"
    :search-query="searchQuery"
    search-placeholder="Search effects…"
    empty-message="No effects match."
    @close="emit('close')"
    @confirm="(it: any) => emit('select', it.id)"
    @update:selected-id="(id: string) => (draftId = id)"
    @update:search-query="(q: string) => (searchQuery = q)"
  >
    <template #card="{ item }">
      <div class="flex aspect-[16/10] w-full items-center justify-center overflow-hidden rounded-t-lg bg-neutral-950">
        <img v-if="thumbs[(item as any).id]" :src="thumbs[(item as any).id]" :alt="(item as any).label" class="h-full w-full object-cover" />
        <span v-else class="text-[10px] text-white/30">{{ (item as any).label }}</span>
      </div>
      <div class="px-3 py-2">
        <span class="text-[13px] font-medium text-white/90">{{ (item as any).label }}</span>
      </div>
    </template>
  </CatalogModal>
</template>
