<!-- frontend/app/components/vue-canvas/DeliverableSetOverlay.vue -->
<script setup lang="ts">
import { toast } from 'vue-sonner'
import type { ArtifactRef, DeliverableItem } from '~/lib/deliverables/model'
import { viewUrl, planSetZip, downloadZip } from '~/lib/deliverables/zip'

const props = defineProps<{ set: Extract<DeliverableItem, { kind: 'set' }> }>()
const emit = defineEmits<{
  close: []; ungroup: []; move: [from: number, to: number]; removeMember: [index: number]
}>()

async function downloadAll() {
  const { skipped } = await downloadZip(planSetZip(props.set), props.set.name)
  if (skipped.length) toast.warning(`${skipped.length} file(s) unavailable and skipped`)
}

function downloadMember(member: ArtifactRef) {
  const a = document.createElement('a'); a.href = viewUrl(member); a.download = member.filename; a.click()
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-8" @click.self="emit('close')">
    <div class="max-h-[80vh] w-[560px] overflow-auto rounded-2xl border border-white/10 bg-[#16181d] p-5">
      <div class="mb-4 flex items-center gap-3">
        <h3 class="flex-1 text-[15px] font-semibold text-white">{{ set.name }}</h3>
        <button class="rounded-lg px-3 py-1.5 text-[12.5px] text-white/70 ring-1 ring-inset ring-white/13 hover:text-white" @click="emit('ungroup')">Ungroup</button>
        <button class="rounded-lg bg-[#4f8cff] px-3 py-1.5 text-[12.5px] font-semibold text-[#0a1120]" @click="downloadAll">Download all ({{ set.items.length }})</button>
      </div>
      <div class="flex flex-col gap-2">
        <div v-for="(m, i) in set.items" :key="m.subfolder + '/' + m.filename" class="flex items-center gap-3 rounded-lg p-2 hover:bg-white/5">
          <img :src="viewUrl(m)" :alt="m.filename" class="h-12 w-12 rounded-md object-cover" />
          <span class="flex-1 truncate font-mono text-[11px] text-white/60">{{ m.filename }}</span>
          <button class="text-white/40 hover:text-white" title="Download" @click="downloadMember(m)">⬇</button>
          <button class="text-white/40 hover:text-white disabled:opacity-30" :disabled="i === 0" @click="emit('move', i, i - 1)">↑</button>
          <button class="text-white/40 hover:text-white disabled:opacity-30" :disabled="i === set.items.length - 1" @click="emit('move', i, i + 1)">↓</button>
          <button class="text-white/40 hover:text-white" @click="emit('removeMember', i)">✕</button>
        </div>
      </div>
    </div>
  </div>
</template>
