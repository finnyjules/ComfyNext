<script setup lang="ts">
import { X, RefreshCw } from 'lucide-vue-next'
import { marked } from 'marked'
import AgentBar from '~/components/agent/AgentBar.vue'
import AgentProgress from '~/components/agent/AgentProgress.vue'
import AgentProposal from '~/components/agent/AgentProposal.vue'
import { useCanvasAgent } from '~/composables/useCanvasAgent'

// vueCanvas is the VueNodeCanvas ref — present in Vue Flow mode. When it exposes
// agentSnapshot/applyCanvasOps the panel gains an interactive command bar that
// can edit the graph (Phase 3, Slice 1), folding the canvas agent into Explain.
const props = defineProps<{ vueCanvas?: any }>()

const { explainPanelOpen, graphData, explanation, loading, error, reset, submitExplanation, highlightedNodeId } = useExplain()
const { getLocalSetting } = useLocalSettings()

const canEdit = computed(() => typeof props.vueCanvas?.agentSnapshot === 'function' && typeof props.vueCanvas?.applyCanvasOps === 'function')
const {
  busy: caBusy, error: caError, reasoning: caReasoning, answer: caAnswer,
  changes: caChanges, issues: caIssues, hasProposal: caHasProposal, hovered: caHovered,
  ask: caAsk, acceptChange: caAccept, rejectChange: caReject, reroll: caReroll, keep: caKeep, dismiss: caDismiss,
} = useCanvasAgent({
  getSnapshot: () => props.vueCanvas.agentSnapshot(),
  materialise: (cmds) => props.vueCanvas.applyCanvasOps(cmds),
  apiKey: () => getLocalSetting('ComfyNext.AI.AnthropicApiKey') ?? '',
})

const nodeCount = computed(() => graphData.value?.nodes?.length ?? 0)

// Build a map of node title/type patterns → node IDs for hover detection
const nodePatternRegex = computed(() => {
  if (!graphData.value?.nodes?.length) return null
  // Build patterns: match "Title [id]", "Title", or "[id]" for each node
  const patterns = graphData.value.nodes.map((node) => {
    const escapedTitle = node.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const escapedType = node.type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // Match "Title [id]" or "Type [id]" first (most specific)
    return `(?:${escapedTitle}|${escapedType})\\s*\\[${node.id}\\]|\\[${node.id}\\]|(?:${escapedTitle}|${escapedType})(?=\\s|[,.:;)]|$)`
  })
  return new RegExp(`(${patterns.join('|')})`, 'g')
})

// Map to quickly find node ID from matched text
function findNodeIdFromText(text: string): number | null {
  if (!graphData.value?.nodes) return null
  // Try to extract [id] from the text
  const idMatch = text.match(/\[(\d+)\]/)
  if (idMatch) {
    const id = Number(idMatch[1])
    if (graphData.value.nodes.some(n => n.id === id)) return id
  }
  // Try to match by title or type
  for (const node of graphData.value.nodes) {
    if (text.includes(node.title) || text.includes(node.type)) return node.id
  }
  return null
}

// Post-process the rendered HTML to wrap node references in hoverable spans
const renderedHtml = computed(() => {
  if (!explanation.value) return ''
  let html = marked.parse(explanation.value) as string
  const regex = nodePatternRegex.value
  if (regex) {
    html = html.replace(regex, (match) => {
      const nodeId = findNodeIdFromText(match)
      if (nodeId != null) {
        return `<span class="node-ref" data-node-id="${nodeId}">${match}</span>`
      }
      return match
    })
  }
  return html
})

function onExplanationMouseOver(e: Event) {
  const target = (e.target as HTMLElement).closest?.('.node-ref') as HTMLElement | null
  if (target?.dataset?.nodeId) {
    highlightedNodeId.value = Number(target.dataset.nodeId)
  }
}

function onExplanationMouseOut(e: Event) {
  const target = (e.target as HTMLElement).closest?.('.node-ref') as HTMLElement | null
  if (target) {
    highlightedNodeId.value = null
  }
}

function retry() {
  if (graphData.value) {
    submitExplanation(graphData.value)
  }
}
</script>

<template>
  <Transition
    enter-active-class="transition-all duration-200 ease-out"
    leave-active-class="transition-all duration-150 ease-in"
    enter-from-class="opacity-0 translate-x-4"
    leave-to-class="opacity-0 translate-x-4"
  >
    <div
      v-if="explainPanelOpen"
      class="fixed right-4 top-14 w-[400px] max-h-[80vh] bg-[#1a1a1a] border border-[#2a2a2a] rounded-[12px] shadow-2xl z-[9999] flex flex-col overflow-hidden"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a]">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-white">Explain</span>
          <span v-if="nodeCount" class="text-xs text-white/40">{{ nodeCount }} node{{ nodeCount !== 1 ? 's' : '' }}</span>
        </div>
        <button
          class="text-white/40 hover:text-white transition-colors cursor-pointer"
          @click="reset()"
        >
          <X class="size-4" />
        </button>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto p-4 space-y-4">
        <!-- Loading state -->
        <div v-if="loading" class="flex items-center gap-3 py-6 justify-center">
          <div class="size-4 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
          <span class="text-sm text-white/50">Analyzing {{ nodeCount }} node{{ nodeCount !== 1 ? 's' : '' }}...</span>
        </div>

        <!-- Error state -->
        <div v-else-if="error" class="rounded-lg bg-red-500/10 border border-red-500/20 p-4">
          <p class="text-sm text-red-400 mb-3">{{ error }}</p>
          <button
            v-if="graphData"
            class="flex items-center gap-2 text-xs text-white/60 hover:text-white transition-colors cursor-pointer"
            @click="retry"
          >
            <RefreshCw class="size-3" />
            Retry
          </button>
        </div>

        <!-- Explanation content -->
        <div
          v-else-if="explanation"
          class="prose prose-invert prose-sm max-w-none text-white/80 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-white [&_h1]:mt-6 [&_h1]:mb-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-5 [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-white/90 [&_h3]:mt-4 [&_h3]:mb-1.5 [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-3 [&_li]:text-sm [&_li]:mb-1 [&_ul]:mb-3 [&_ol]:mb-3 [&_code]:text-xs [&_code]:bg-white/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_pre]:bg-[#0a0a0a] [&_pre]:border [&_pre]:border-[#2a2a2a] [&_pre]:rounded-lg [&_pre]:mb-3 [&_a]:text-white/70 [&_strong]:text-white/90 first:[&_h1]:mt-0 first:[&_h2]:mt-0 [&_.node-ref]:border-b [&_.node-ref]:border-solid [&_.node-ref]:border-[rgba(255,255,255,0.06)] [&_.node-ref]:cursor-pointer [&_.node-ref:hover]:border-white/70 [&_.node-ref:hover]:text-white [&_.node-ref]:transition-colors"
          v-html="renderedHtml"
          @mouseover="onExplanationMouseOver"
          @mouseout="onExplanationMouseOut"
        />
      </div>

      <!-- Interactive command bar (Vue Flow mode): ask or tell it to edit nodes. -->
      <div v-if="canEdit" class="border-t border-[#2a2a2a] p-3 space-y-2.5">
        <AgentBar
          :busy="caBusy" :error="caError"
          :chips="['What does this do?', 'Set steps to 30', 'Mute the upscaler']"
          placeholder="Ask, or tell me to change a node — e.g. set the seed to 42…"
          @submit="caAsk" @chip="caAsk"
        />
        <div v-if="caBusy"><AgentProgress :active="caBusy" /></div>
        <template v-else>
          <div v-if="caAnswer">
            <p v-if="caReasoning" class="mb-1 text-[11px] leading-snug text-white/40">{{ caReasoning }}</p>
            <p class="whitespace-pre-line text-[12.5px] leading-relaxed text-white/80">{{ caAnswer }}</p>
          </div>
          <AgentProposal
            v-if="caHasProposal"
            :changes="caChanges" :busy="caBusy" :issues="caIssues"
            @accept="caAccept" @reject="caReject" @reroll="caReroll"
            @keep="caKeep" @revert="caDismiss" @hover="(i: number | null) => caHovered = i"
          />
        </template>
      </div>
    </div>
  </Transition>
</template>
