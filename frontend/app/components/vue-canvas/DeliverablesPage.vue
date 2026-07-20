<!-- frontend/app/components/vue-canvas/DeliverablesPage.vue -->
<script setup lang="ts">
import { computed, inject, ref, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import type { ProjectDoc } from '~/lib/projectDoc'
import { useDeliverables } from '~/composables/useDeliverables'
import { planZip, planSetZip, downloadZip, viewUrl } from '~/lib/deliverables/zip'
import type { DeliverableItem } from '~/lib/deliverables/model'
import DeliverableTile from './DeliverableTile.vue'
import DeliverableSetOverlay from './DeliverableSetOverlay.vue'

defineProps<{ projectName: string }>()
const emit = defineEmits<{ openInCanvas: [nodeId: string] }>()

const docRef = inject<Ref<ProjectDoc | null>>('projectDoc', ref(null))
const persist = inject<() => void>('persistDeliverables', () => {})
const dl = useDeliverables(docRef, persist)

const picked = ref<Set<string>>(new Set())
function togglePick(id: string) {
  const s = new Set(picked.value); s.has(id) ? s.delete(id) : s.add(id); picked.value = s
}
function clearPick() { picked.value = new Set() }
const pickedSingleIds = computed(() =>
  dl.items.value.filter(i => picked.value.has(i.id) && i.kind === 'single').map(i => i.id))
function groupPicked() {
  dl.groupItems(pickedSingleIds.value)
  clearPick()
}

const openSetId = ref<string | null>(null)
const openSet = computed(() =>
  dl.items.value.find(i => i.id === openSetId.value && i.kind === 'set') as Extract<DeliverableItem, { kind: 'set' }> | undefined)

async function downloadSingle(item: Extract<DeliverableItem, { kind: 'single' }>) {
  const a = document.createElement('a'); a.href = viewUrl(item.ref); a.download = item.ref.filename; a.click()
}
async function downloadAll() {
  if (!dl.items.value.length) return
  const { skipped } = await downloadZip(planZip(dl.items.value), 'Deliverables')
  if (skipped.length) toast.warning(`${skipped.length} file(s) unavailable and skipped`)
}

const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)
function onDragStart(index: number, ev: DragEvent) {
  dragIndex.value = index
  if (ev.dataTransfer) { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', String(index)) }
}
function onDragOver(index: number, ev: DragEvent) {
  ev.preventDefault()
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
  dragOverIndex.value = index
}
function onDrop(index: number, ev: DragEvent) {
  ev.preventDefault()
  const from = dragIndex.value
  dragOverIndex.value = null
  dragIndex.value = null
  if (from === null || from === index) return
  dl.moveItem(from, index)
}
function onDragEnd() {
  dragIndex.value = null
  dragOverIndex.value = null
}
</script>

<template>
  <div class="h-full w-full overflow-auto bg-[#121316] text-[#eceef2]">
    <div class="sticky top-0 z-20 flex items-center gap-4 border-b border-white/7 bg-[#121316]/85 px-8 py-3.5 backdrop-blur">
      <span class="text-[13px] text-white/40">{{ projectName }} · Ready to deliver</span>
      <div class="flex-1" />
      <button class="rounded-lg border border-white/13 px-3 py-1.5 text-[13px] text-white/70 hover:text-white" @click="downloadAll">Download all</button>
      <button class="cursor-default rounded-lg border border-white/7 px-3 py-1.5 text-[13px] text-white/40" disabled title="Coming soon">Share <span class="ml-1 font-mono text-[9px] uppercase tracking-wider text-white/30">soon</span></button>
    </div>

    <div class="mx-auto max-w-[1180px] px-8 pb-6 pt-10">
      <h1 class="text-[26px] font-semibold tracking-tight">Ready to deliver</h1>
      <p class="mt-2 max-w-[56ch] text-[14px] leading-relaxed text-white/32">Artifacts you marked ready. Name them, group them into sets, and drag to arrange. Download any one, a set, or everything as a zip.</p>
    </div>

    <div v-if="picked.size" class="mx-auto mb-1 flex max-w-[1180px] items-center gap-3.5 px-8">
      <span class="inline-flex items-center gap-2 rounded-[10px] border border-white/13 bg-[#191b1f] px-3 py-1.5 text-[13px]"><b class="font-mono text-[#4f8cff]">{{ picked.size }}</b> selected</span>
      <button v-if="pickedSingleIds.length >= 2" class="rounded-lg bg-[#4f8cff] px-2.5 py-1.5 text-[12.5px] font-semibold text-[#0a1120]" @click="groupPicked">Group into set</button>
      <button class="text-[12.5px] text-white/32" @click="clearPick">Clear</button>
    </div>

    <div v-if="!dl.items.value.length" class="mx-auto max-w-[1180px] px-8 py-16 text-center text-white/40">
      Nothing here yet. On the canvas, open an image, video, or audio artifact and choose <b class="text-white/70">Mark ready</b>.
    </div>

    <div v-else class="mx-auto grid max-w-[1180px] gap-x-6 gap-y-8 px-8 pb-24" style="grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));">
      <div
        v-for="(item, index) in dl.items.value" :key="item.id"
        draggable="true"
        class="transition motion-reduce:transition-none"
        :class="dragOverIndex === index && dragIndex !== index ? 'opacity-60' : ''"
        @dragstart="onDragStart(index, $event)"
        @dragover="onDragOver(index, $event)"
        @drop="onDrop(index, $event)"
        @dragend="onDragEnd"
      >
        <DeliverableTile
          :item="item" :picked="picked.has(item.id)"
          @toggle-pick="togglePick(item.id)"
          @rename="name => dl.renameItem(item.id, name)"
          @download="item.kind === 'single' && downloadSingle(item)"
          @remove="dl.removeItem(item.id)"
          @open-canvas="item.kind === 'single' && item.ref.sourceNodeId && emit('openInCanvas', item.ref.sourceNodeId)"
          @open-set="openSetId = item.id"
        />
      </div>
    </div>

    <DeliverableSetOverlay
      v-if="openSet" :set="openSet"
      @close="openSetId = null"
      @ungroup="dl.ungroupItem(openSet.id); openSetId = null"
      @move="(from, to) => dl.moveWithinSet(openSet!.id, from, to)"
      @remove-member="i => dl.removeSetMember(openSet!.id, i)"
    />
  </div>
</template>
