<script setup lang="ts">
import { ref } from 'vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'

defineProps<{
  busy: boolean
  proposal: { rationale: string; chips: { label: string; before: string; after: string; path: string }[] } | null
}>()
const emit = defineEmits<{
  submit: [phrase: string]
  keep: []
  revert: []
  focusControl: [path: string]
}>()

const phrase = ref('')
function go() {
  const p = phrase.value.trim()
  if (p) emit('submit', p)
}
</script>

<template>
  <div class="mb-3">
    <!-- prompt bar -->
    <div class="flex items-center gap-2 rounded-[10px] border border-white/10 bg-white/[0.04] px-2.5 py-2">
      <span class="text-[13px] text-amber-400/90">✦</span>
      <input
        v-model="phrase"
        :disabled="busy"
        type="text"
        placeholder="Describe a vibe — 'warmer, more chaotic'"
        class="flex-1 bg-transparent text-[12.5px] text-white/90 placeholder:text-white/35 outline-none"
        @keydown.enter="go"
      >
      <StudioButton variant="primary" :disabled="busy || !phrase.trim()" @click="go">
        {{ busy ? '…' : 'Apply' }}
      </StudioButton>
    </div>

    <!-- proposal summary header -->
    <div v-if="proposal" class="mt-1.5 rounded-[11px] border border-amber-400/30 bg-white/[0.04] p-3">
      <div class="mb-1 flex items-center gap-2">
        <span class="text-amber-400/90">✦</span>
        <span class="text-[12.5px] font-semibold text-white/90">{{ proposal.chips.length }} change{{ proposal.chips.length === 1 ? '' : 's' }}</span>
        <span class="ml-auto flex gap-1.5">
          <button class="rounded-[7px] border border-white/10 px-3 py-1 text-[11.5px] text-white/60" @click="emit('revert')">Revert</button>
          <button class="rounded-[7px] bg-action px-3 py-1 text-[11.5px] font-semibold text-white" @click="emit('keep')">Keep</button>
        </span>
      </div>
      <p v-if="proposal.rationale" class="mb-2 text-[11px] italic text-white/40">{{ proposal.rationale }}</p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="chip in proposal.chips" :key="chip.path"
          class="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-[3px] text-[10.5px] tabular-nums text-amber-300"
          @click="emit('focusControl', chip.path)"
        >{{ chip.label }} {{ chip.before }}→{{ chip.after }}</button>
      </div>
    </div>
  </div>
</template>
