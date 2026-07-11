<!-- frontend/app/components/vue-canvas/CollectionNode.vue -->
<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { Table2, ChevronLeft, ChevronRight } from 'lucide-vue-next'
import { COLLECTION_PROP, type CollectionData } from '~/lib/collection/types'
import { createCollection, rowLabel, clampPreviewRow } from '~/lib/collection/model'

const props = defineProps<{ id: string; data: Record<string, any>; selected?: boolean }>()

const collection = computed<CollectionData>(() => {
  const c = props.data.properties?.[COLLECTION_PROP] as CollectionData | undefined
  return c ?? createCollection('Collection')
})

onMounted(() => {
  if (!props.data.properties) props.data.properties = {}
  if (!props.data.properties[COLLECTION_PROP]) {
    props.data.properties[COLLECTION_PROP] = createCollection('Collection')
  }
})

const summary = computed(() =>
  `${collection.value.rows.length} rows · ${collection.value.columns.length} columns`)

const previewLabel = computed(() => {
  const c = collection.value
  if (!c.rows.length) return 'No rows'
  return `${c.previewRow + 1}/${c.rows.length} · ${rowLabel(c, c.previewRow)}`
})

function step(delta: number) {
  const c = props.data.properties[COLLECTION_PROP] as CollectionData
  if (!c.rows.length) return
  c.previewRow = (c.previewRow + delta + c.rows.length) % c.rows.length
  clampPreviewRow(c)
  // This component only receives its own `data`, not the full nodes/edges
  // graph — hand off to VueNodeCanvas (which owns both) to push the scrubbed
  // row onto any wired Smart Layout targets' live preview.
  window.dispatchEvent(new CustomEvent('sailor:collectionScrub', { detail: { nodeId: props.id } }))
}

function openTable() {
  window.dispatchEvent(new CustomEvent('sailor:openCollection', { detail: { nodeId: props.id } }))
}
</script>

<template>
  <div
    class="min-w-[190px] rounded-xl border bg-[#141414] text-white/90"
    :class="selected ? 'border-white/40' : 'border-[#2a2a2a]'"
  >
    <div class="flex items-center gap-2 px-3 h-9 border-b border-white/10">
      <Table2 class="size-3.5 text-white/60" />
      <span class="text-[12px] font-medium truncate flex-1">{{ collection.name }}</span>
    </div>
    <div class="px-3 py-2 text-[11px] text-white/40">{{ summary }}</div>
    <div class="flex items-center gap-1 px-2 pb-1" v-if="collection.rows.length">
      <button class="p-1 rounded hover:bg-white/10" @click.stop="step(-1)">
        <ChevronLeft class="size-3.5" />
      </button>
      <span class="flex-1 text-center text-[11px] text-white/70 truncate tabular-nums">
        {{ previewLabel }}
      </span>
      <button class="p-1 rounded hover:bg-white/10" @click.stop="step(1)">
        <ChevronRight class="size-3.5" />
      </button>
    </div>
    <div class="px-2 pb-2">
      <button
        class="w-full h-7 rounded-md text-[11px] bg-white/5 hover:bg-white/10 border border-white/10"
        @click.stop="openTable"
      >Open table</button>
    </div>
    <!-- Lookup input: another Collection's VARS output wires here to become a lookup table. Pink = variables. -->
    <Handle id="input-0" type="target" :position="Position.Left"
      class="!h-3 !w-3 !rounded-full !border-2 !border-[#f472b6]/60 !bg-[#1a1a1a]" />
    <Handle id="output-0" type="source" :position="Position.Right" />
  </div>
</template>
