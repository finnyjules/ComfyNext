<!-- frontend/app/components/vue-canvas/DeliverableTile.vue -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DeliverableItem, ArtifactRef } from '~/lib/deliverables/model'
import { viewUrl } from '~/lib/deliverables/zip'

const props = defineProps<{ item: DeliverableItem; picked: boolean }>()
const emit = defineEmits<{
  togglePick: []; rename: [name: string]; download: []; remove: []
  openCanvas: []; openSet: []
}>()

const cover = computed<ArtifactRef>(() =>
  props.item.kind === 'single' ? props.item.ref : props.item.items[props.item.coverIndex ?? 0]!)
const isVideo = computed(() => cover.value.media === 'video')
const setCount = computed(() => (props.item.kind === 'set' ? props.item.items.length : 0))

const editing = ref(false)
const draft = ref(props.item.name)
function commit() { editing.value = false; if (draft.value.trim() && draft.value !== props.item.name) emit('rename', draft.value.trim()) }
</script>

<template>
  <div class="group relative" :class="item.kind === 'set' ? 'stack' : ''">
    <div class="frameWrap relative">
      <div
        class="frame relative overflow-hidden rounded-xl border aspect-square transition"
        :class="picked ? 'border-[#4f8cff] shadow-[0_0_0_1px_#4f8cff]' : 'border-white/[0.07] group-hover:border-white/[0.13]'"
      >
        <img :src="viewUrl(cover)" :alt="item.name" class="h-full w-full object-cover" loading="lazy" draggable="false" />
        <div v-if="isVideo" class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div class="flex h-11 w-11 items-center justify-center rounded-full border border-white/13 bg-black/40 backdrop-blur">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
        <span v-if="setCount" class="absolute right-2.5 top-2.5 rounded-full border border-white/10 bg-black/60 px-2 py-0.5 font-mono text-[10.5px] backdrop-blur">{{ setCount }}</span>
        <button
          class="absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-md border backdrop-blur transition"
          :class="picked ? 'border-[#4f8cff] bg-[#4f8cff] opacity-100' : 'border-white/13 bg-black/50 opacity-0 group-hover:opacity-100'"
          @click.stop="emit('togglePick')"
        >
          <svg v-if="picked" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#0a1120" stroke-width="3"><path d="M5 12l5 5 9-11" /></svg>
        </button>
        <!-- hover actions -->
        <div class="absolute inset-0 flex items-end gap-2 rounded-xl bg-gradient-to-t from-black/70 to-transparent p-3 opacity-0 transition group-hover:opacity-100">
          <button class="flex-1 rounded-lg bg-white/95 px-2 py-2 text-[12.5px] font-semibold text-[#14151a] hover:bg-white" @click.stop="item.kind === 'set' ? emit('openSet') : emit('download')">
            {{ item.kind === 'set' ? 'Open set' : 'Download' }}
          </button>
          <button v-if="item.kind === 'single' && item.ref.sourceNodeId" class="rounded-lg bg-black/60 px-2 py-2 text-[12.5px] text-white ring-1 ring-inset ring-white/13 backdrop-blur hover:bg-black/80" @click.stop="emit('openCanvas')">Canvas</button>
          <button class="rounded-lg bg-black/60 px-2 py-2 text-white ring-1 ring-inset ring-white/13 backdrop-blur hover:bg-black/80" title="Remove" @click.stop="emit('remove')">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      </div>
    </div>
    <div class="mt-2.5 px-0.5">
      <input v-if="editing" v-model="draft" class="w-full bg-transparent text-[13.5px] text-white outline-none" draggable="false" @mousedown.stop @blur="commit" @keydown.enter="commit" @keydown.esc="editing = false" autofocus />
      <button v-else class="max-w-full truncate text-left text-[13.5px] text-white/90 hover:text-white" @click="editing = true; draft = item.name">{{ item.name }}</button>
    </div>
  </div>
</template>

<style scoped>
.stack .frameWrap::before, .stack .frameWrap::after {
  content: ''; position: absolute; inset: 0; border-radius: 12px;
  background: #191b1f; border: 1px solid rgba(255,255,255,.07);
}
.stack .frameWrap::before { transform: translate(6px, 6px); opacity: .55; }
.stack .frameWrap::after { transform: translate(3px, 3px); opacity: .8; }
.stack .frame { position: relative; z-index: 2; }
</style>
