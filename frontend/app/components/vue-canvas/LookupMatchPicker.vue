<script setup lang="ts">
// Match-column picker: shown when a LOOKUP edge is drawn between two collections
// that don't share a same-named key. Pick which column on each side is the key.
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { CollectionColumn } from '~/lib/collection/types'

const props = defineProps<{
  foreign: CollectionColumn[]   // lookup table (Themes) columns
  local: CollectionColumn[]     // driver (Players) columns
  anchor: { x: number; y: number }
}>()
const emit = defineEmits<{ (e: 'apply', v: { matchLocal: string; matchForeign: string }): void; (e: 'close'): void }>()

const matchForeign = ref(props.foreign[0]?.key ?? '')
const matchLocal = ref(props.local[0]?.key ?? '')

function apply() {
  if (!matchForeign.value || !matchLocal.value) return
  emit('apply', { matchLocal: matchLocal.value, matchForeign: matchForeign.value })
  emit('close')
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <teleport to="body">
    <div class="fixed inset-0 z-[200]" @click="emit('close')">
      <div class="absolute w-[280px] rounded-lg border border-white/15 bg-[#1a1a1a] p-3 text-white/90 shadow-xl"
           :style="{ left: anchor.x + 'px', top: anchor.y + 'px' }" @click.stop>
        <p class="mb-2 text-[12px] font-medium">Match on which column?</p>
        <label class="mb-1 block text-[11px] text-white/50">Lookup table key</label>
        <select v-model="matchForeign" class="mb-2 w-full rounded bg-white/10 px-2 py-1 text-[12px]">
          <option v-for="c in foreign" :key="c.key" :value="c.key">{{ c.label }}</option>
        </select>
        <label class="mb-1 block text-[11px] text-white/50">This table key</label>
        <select v-model="matchLocal" class="mb-3 w-full rounded bg-white/10 px-2 py-1 text-[12px]">
          <option v-for="c in local" :key="c.key" :value="c.key">{{ c.label }}</option>
        </select>
        <div class="flex justify-end gap-2">
          <button class="rounded px-2 py-1 text-[11px] text-white/60 hover:bg-white/10" @click="emit('close')">Cancel</button>
          <button class="rounded bg-[#f472b6]/20 px-2 py-1 text-[11px] text-[#f9a8d4] hover:bg-[#f472b6]/30" @click="apply">Link</button>
        </div>
      </div>
    </div>
  </teleport>
</template>
