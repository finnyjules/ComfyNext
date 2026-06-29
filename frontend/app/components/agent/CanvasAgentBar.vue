<script setup lang="ts">
// The node-canvas agent home (Phase 3, Slice 0 — read-only "explain the graph").
// A collapsed ✦ launcher bottom-centre that expands into an ask bar + answer
// card. Owns useCanvasAgent; the parent supplies getSnapshot (it holds the Vue
// Flow refs) + apiKey. No mutations in this slice — answers + a graph-health
// readout only.
import { ref } from 'vue'
import { Sparkles, X } from 'lucide-vue-next'
import AgentBar from '~/components/agent/AgentBar.vue'
import AgentProgress from '~/components/agent/AgentProgress.vue'
import { useCanvasAgent } from '~/composables/useCanvasAgent'
import type { CanvasSnapshot } from '~/lib/agent/surfaces/canvas'

const props = defineProps<{ getSnapshot: () => CanvasSnapshot; apiKey: () => string }>()

const open = ref(false)
const { busy, error, reasoning, answer, issues, ask, clear } = useCanvasAgent({
  getSnapshot: () => props.getSnapshot(),
  apiKey: () => props.apiKey(),
})

function collapse() { open.value = false; clear() }
</script>

<template>
  <div class="canvas-agent absolute bottom-5 left-1/2 z-50 -translate-x-1/2">
    <!-- Collapsed launcher -->
    <button
      v-if="!open"
      class="flex items-center gap-2 rounded-full border border-white/10 bg-[#0e0e10]/85 px-4 py-2 text-[12px] text-white/80 shadow-2xl backdrop-blur-md transition hover:text-white hover:border-white/20"
      @click="open = true"
    >
      <Sparkles class="h-3.5 w-3.5" /> Ask about this graph
    </button>

    <!-- Expanded panel -->
    <div v-else class="glass-panel w-[460px] max-w-[calc(100vw-2rem)] rounded-xl border border-white/10 bg-[#0e0e10]/90 p-3 shadow-2xl backdrop-blur-md">
      <div class="mb-2 flex items-center justify-between">
        <span class="flex items-center gap-1.5 text-[11px] font-medium text-white/50"><Sparkles class="h-3 w-3" /> Canvas copilot</span>
        <button class="text-white/35 hover:text-white/80" title="Close" @click="collapse"><X class="h-3.5 w-3.5" /></button>
      </div>

      <AgentBar
        :busy="busy" :error="error"
        :chips="['What does this graph do?', 'Anything broken?', 'Explain the connections']"
        placeholder="Ask about the graph — e.g. what does this do, what’s missing…"
        @submit="ask" @chip="ask"
      />

      <div v-if="busy" class="pt-2.5"><AgentProgress :active="busy" /></div>

      <!-- Answer -->
      <div v-else-if="answer" class="pt-2.5">
        <p v-if="reasoning" class="mb-1.5 text-[11px] leading-snug text-white/40">{{ reasoning }}</p>
        <p class="whitespace-pre-line text-[12.5px] leading-relaxed text-white/85">{{ answer }}</p>
      </div>

      <!-- Passive graph-health readout (always available once we've inspected). -->
      <div v-if="issues.length" class="mt-2.5 space-y-1 border-t border-white/[0.06] pt-2">
        <p class="text-[9px] uppercase tracking-wide text-white/35">Graph health</p>
        <p v-for="(iss, k) in issues" :key="k" class="flex items-start gap-1.5 text-[11px] leading-snug text-amber-300/80">
          <span class="mt-px">⚠</span><span>{{ iss.message }}</span>
        </p>
      </div>
    </div>
  </div>
</template>
