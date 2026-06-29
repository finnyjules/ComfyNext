<script setup lang="ts">
// The canvas agent's home — a persistent prompt box that sits just above the
// canvas toolbar (Phase 3, Slice 1). Ask about the graph or tell it to edit
// nodes; results (answer / proposal / progress) expand UPWARD above the input,
// which stays anchored just above the toolbar. Owns useCanvasAgent; the parent
// supplies the VueNodeCanvas ref (agentSnapshot + applyCanvasOps).
import { computed, ref } from 'vue'
import { Sparkles, ArrowUp } from 'lucide-vue-next'
import AgentProgress from '~/components/agent/AgentProgress.vue'
import AgentProposal from '~/components/agent/AgentProposal.vue'
import { useCanvasAgent } from '~/composables/useCanvasAgent'

const props = defineProps<{ vueCanvas?: any }>()
const { getLocalSetting } = useLocalSettings()

const ready = computed(() => typeof props.vueCanvas?.agentSnapshot === 'function' && typeof props.vueCanvas?.applyCanvasOps === 'function')

const {
  busy, error, reasoning, answer, changes, issues, hasProposal, hovered,
  ask, acceptChange, rejectChange, reroll, keep, dismiss,
} = useCanvasAgent({
  getSnapshot: () => props.vueCanvas.agentSnapshot(),
  materialise: (cmds) => props.vueCanvas.applyCanvasOps(cmds),
  apiKey: () => getLocalSetting('ComfyNext.AI.AnthropicApiKey') ?? '',
})

const phrase = ref('')
function go() { const p = phrase.value.trim(); if (p && !busy.value) { ask(p); phrase.value = '' } }
const hasResult = computed(() => busy.value || hasProposal.value || !!answer.value || !!error.value)
</script>

<template>
  <div v-if="ready" class="w-[460px] max-w-[calc(100vw-2rem)] flex flex-col gap-2">
    <!-- Results expand upward, above the input -->
    <div v-if="hasResult" class="max-h-[52vh] overflow-y-auto rounded-[12px] border border-[#2a2a2a] bg-[#1a1a1a]/95 p-3 shadow-xl backdrop-blur-md">
      <div v-if="busy"><AgentProgress :active="busy" /></div>
      <template v-else>
        <p v-if="error" class="text-[12px] leading-snug text-red-400/90">{{ error }}</p>
        <div v-else-if="answer">
          <p v-if="reasoning" class="mb-1 text-[11px] leading-snug text-white/40">{{ reasoning }}</p>
          <p class="whitespace-pre-line text-[12.5px] leading-relaxed text-white/85">{{ answer }}</p>
        </div>
        <AgentProposal
          v-if="hasProposal"
          :changes="changes" :busy="busy" :issues="issues"
          @accept="acceptChange" @reject="rejectChange" @reroll="reroll"
          @keep="keep" @revert="dismiss" @hover="(i: number | null) => hovered = i"
        />
      </template>
    </div>

    <!-- Input bar — matches the toolbar's look, anchored just above it -->
    <div class="flex items-center gap-2 rounded-[12px] border border-[#2a2a2a] bg-[#1a1a1a]/90 px-3 py-2 shadow-lg backdrop-blur-md">
      <Sparkles class="size-4 shrink-0 text-white/45" />
      <input
        v-model="phrase" :disabled="busy" type="text"
        placeholder="Ask about the graph, or tell me to change a node…"
        class="flex-1 bg-transparent text-[13px] text-white/90 placeholder:text-white/30 outline-none"
        @keydown.enter="go"
      >
      <button
        class="grid size-7 place-items-center rounded-[8px] bg-white text-neutral-900 transition hover:bg-white/90 disabled:opacity-40"
        :disabled="busy || !phrase.trim()" @click="go"
      ><ArrowUp class="size-4" /></button>
    </div>
  </div>
</template>
