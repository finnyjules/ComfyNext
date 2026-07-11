<script setup lang="ts">
// The canvas agent's home — a persistent prompt box that sits just above the
// canvas toolbar (Phase 3, Slice 1). Ask about the graph or tell it to edit
// nodes; results (answer / proposal / progress) expand UPWARD above the input,
// which stays anchored just above the toolbar. Owns useCanvasAgent; the parent
// supplies the VueNodeCanvas ref (agentSnapshot + applyCanvasOps).
import { computed, nextTick, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { Sparkles, ArrowUp, X } from 'lucide-vue-next'
import AgentProgress from '~/components/agent/AgentProgress.vue'
import AgentProposal from '~/components/agent/AgentProposal.vue'
import AgentSweep from '~/components/agent/AgentSweep.vue'
import ImageSearchPickerModal from '~/components/agent/ImageSearchPickerModal.vue'
import { useCanvasAgent } from '~/composables/useCanvasAgent'
import { useAgentActivity } from '~/composables/useAgentActivity'
import { useAiStatus } from '~/composables/useAiStatus'
import { paidProducerFor } from '~/lib/artifact/nextSteps'

const props = defineProps<{ vueCanvas?: any }>()
const { getLocalSetting } = useLocalSettings()
const { aiAvailable } = useAiStatus()

const ready = computed(() => typeof props.vueCanvas?.agentSnapshot === 'function' && typeof props.vueCanvas?.agentPreview === 'function')

const {
  busy, error, reasoning, answer, changes, issues, review, reviewing, hasProposal, hovered,
  ask, acceptChange, rejectChange, reroll, keep, keepAndRun, reviewLastRun, reviewNode, autoReviewNode, dismiss,
} = useCanvasAgent({
  getSnapshot: (phrase?: string) => props.vueCanvas.agentSnapshot(phrase),
  preview: (cmds, animate) => props.vueCanvas.agentPreview(cmds, animate),
  commit: () => props.vueCanvas.agentCommit(),
  frameNodes: (ids: string[]) => props.vueCanvas.agentFrameNodes(ids),
  discard: () => props.vueCanvas.agentDiscard(),
  tune: (cmds) => props.vueCanvas.agentTune(cmds, getLocalSetting('Sailor.AI.AnthropicApiKey') ?? ''),
  tuneRevert: () => props.vueCanvas.agentTuneRevert(),
  // (anatomy repairs now go through an EditImageNode the review proposes, not a route)
  // Keep & Run: run the agent's result AND anything it feeds into (direction:
  // 'downstream') — so an inserted node re-renders the output it connects to —
  // but only that affected branch, never unrelated nodes (the top Run does the
  // whole canvas). New nodes execute (uncached) and edited nodes cache-miss;
  // truly-unchanged upstream stays cached.
  run: (targetIds: string[]) => window.dispatchEvent(new CustomEvent('sailor:runFiltered', { detail: { targetIds, direction: 'downstream' } })),
  runOutputImage: (targetIds: string[]) => props.vueCanvas.agentRunOutputImage(targetIds),
  resolveResultNode: (targetIds: string[]) => props.vueCanvas.agentResolveResultNode?.(targetIds) ?? null,
  apiKey: () => getLocalSetting('Sailor.AI.AnthropicApiKey') ?? '',
  // "find me a picture of X" → the model emits searchImages and the picker
  // takes over (search → select → import as Image nodes).
  searchImages: (query: string) => { searchQuery.value = query; searchOpen.value = true },
})

// Web-image-search picker (opened by the agent's searchImages command).
const searchOpen = ref(false)
const searchQuery = ref('')
function onSearchDone(imported: number, failed: number) {
  searchOpen.value = false
  if (imported) answer.value = `Imported ${imported} image${imported === 1 ? '' : 's'} onto the canvas.${failed ? ` ${failed} couldn’t be downloaded.` : ''}`
  else if (failed) answer.value = 'None of those images could be downloaded — try other picks.'
}

// Run→look→fix: when a Keep & Run finishes, review its output (reviewLastRun is a
// no-op unless a review is armed). VueNodeCanvas fires this on execution_complete.
function onRunComplete() { reviewLastRun() }
// On-demand "Critique" on any result node — judges its output against the prompt
// that made it (resolved by VueNodeCanvas). Fired from the node's run menu.
function onCritiqueNode(e: Event) {
  const id = (e as CustomEvent).detail?.nodeId
  if (!id || !ready.value) return
  reviewNode(String(id), props.vueCanvas.agentNodeIntent?.(String(id)) ?? '')
}
// Auto-critique: a fresh take landed on an image artifact. Gate hard —
// paid producer only, once per take, 3s settle so a Variations ×4 burst
// reviews the final state once instead of four times.
const reviewedTakes = new Map<string, string>()
const autoReviewTimers = new Map<string, ReturnType<typeof setTimeout>>()
function onAutoReview(e: Event) {
  const { nodeId, takeId } = (e as CustomEvent).detail || {}
  if (!nodeId || !takeId || !ready.value) return
  const id = String(nodeId)
  if (reviewedTakes.get(id) === String(takeId)) return
  clearTimeout(autoReviewTimers.get(id))
  autoReviewTimers.set(id, setTimeout(() => {
    autoReviewTimers.delete(id)
    const nodes = props.vueCanvas?.getNodes?.() ?? []
    const edges = props.vueCanvas?.getEdges?.() ?? []
    if (!paidProducerFor(id, nodes, edges)) return
    reviewedTakes.set(id, String(takeId))
    autoReviewNode(id, props.vueCanvas?.agentNodeIntent?.(id) ?? '')
  }, 3000))
}
onMounted(() => {
  window.addEventListener('sailor:agentRunComplete', onRunComplete)
  window.addEventListener('sailor:critiqueNode', onCritiqueNode)
  window.addEventListener('sailor:autoReview', onAutoReview)
})
onBeforeUnmount(() => {
  window.removeEventListener('sailor:agentRunComplete', onRunComplete)
  window.removeEventListener('sailor:critiqueNode', onCritiqueNode)
  window.removeEventListener('sailor:autoReview', onAutoReview)
  for (const t of autoReviewTimers.values()) clearTimeout(t)
})

// Drive the dot-grid "thinking" animation off the agent's busy state. (The white
// "analyzing" scan is rendered per-node, driven by useAgentActivity.analyzingNodeIds
// which useCanvasAgent sets during a review.)
const { thinking } = useAgentActivity()
watch(busy, (v) => { thinking.value = v })
onBeforeUnmount(() => { thinking.value = false })

// Hovering a proposal row highlights the node/wire it refers to on the canvas.
watch(hovered, (i) => {
  if (typeof props.vueCanvas?.agentHighlight !== 'function') return
  props.vueCanvas.agentHighlight(i != null ? changes.value[i]?.command ?? null : null)
})

// Slow glimm over the thinking card. Flip active false→true a tick AFTER the card
// mounts so AgentSweep measures a sized canvas (an immediate true-at-mount never
// starts the sweep — same gotcha as the on-canvas glimm).
const glimmActive = ref(false)
// Active while the agent is planning (busy) AND while it critiques the result
// (reviewing) — so the sweep runs across the whole generate→look→fix pass.
watch(() => busy.value || reviewing.value, async (v) => { if (v) { await nextTick(); glimmActive.value = true } else { glimmActive.value = false } })

const phrase = ref('')
function go() { const p = phrase.value.trim(); if (p && !busy.value) { ask(p); phrase.value = '' } }
const hasResult = computed(() => busy.value || reviewing.value || hasProposal.value || !!answer.value || !!error.value)
</script>

<template>
  <div v-if="ready" class="flex flex-col gap-2">
    <ImageSearchPickerModal :open="searchOpen" :query="searchQuery" @close="searchOpen = false" @done="onSearchDone" />
    <!-- Results expand upward, above the input -->
    <div v-if="hasResult" class="relative max-h-[52vh] overflow-y-auto rounded-[12px] border border-[#2a2a2a] bg-[#1a1a1a]/95 p-3 shadow-xl backdrop-blur-md">
      <!-- Slow glimm sweep over the thinking card while the agent works. Persistently
           mounted (active gated reactively) and painted ON TOP via z-10 so the screen
           blend reads over the card. -->
      <div class="pointer-events-none absolute inset-0 z-10" style="clip-path: inset(0 round 12px)">
        <AgentSweep :active="glimmActive" :period="3" palette="lagoon" />
      </div>
      <!-- Dismiss the card for the answer / error states (no proposal → no
           keep/revert controls, so this is the only way to close it). -->
      <button
        v-if="!busy && !reviewing && !hasProposal && (answer || error)"
        class="absolute right-2 top-2 z-20 grid size-6 place-items-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white/80"
        title="Dismiss" @click="dismiss"
      ><X class="size-3.5" /></button>
      <div v-if="busy"><AgentProgress :active="busy" /></div>
      <template v-else>
        <p v-if="error" class="pr-6 text-[12px] leading-snug text-red-400/90">{{ error }}</p>
        <div v-else-if="answer" class="pr-6">
          <p v-if="reasoning" class="mb-1 text-[11px] leading-snug text-white/40">{{ reasoning }}</p>
          <p class="whitespace-pre-line text-[12.5px] leading-relaxed text-white/85">{{ answer }}</p>
        </div>
        <!-- Run→look→fix: looking at the result before any fixes are surfaced. -->
        <div v-if="reviewing && !hasProposal" class="flex items-center gap-1.5 text-[11.5px] text-white/55">
          <span class="text-white/75">✦</span> Looking at the result<span class="animate-pulse">…</span>
        </div>
        <AgentProposal
          v-if="hasProposal"
          :changes="changes" :busy="busy" :issues="issues" :review="review" :reviewing="reviewing" runnable
          @accept="acceptChange" @reject="rejectChange" @reroll="reroll"
          @keep="keep" @keep-run="keepAndRun" @revert="dismiss" @hover="(i: number | null) => hovered = i"
        />
      </template>
    </div>

    <p v-if="!aiAvailable" class="px-1 text-[11px] leading-snug text-white/40">
      AI assist isn’t set up — start the app with NUXT_ANTHROPIC_API_KEY, or paste your own key in Settings → AI.
    </p>

    <!-- Input bar — dark box with a pastel ring that fades in when active -->
    <div class="prompt-field flex items-center gap-2.5 rounded-[12px] px-3.5 py-3.5 shadow-lg">
      <Sparkles class="size-4 shrink-0 text-white/45" />
      <input
        v-model="phrase" :disabled="busy" type="text"
        placeholder="Ask about the graph, or tell me to change a node…"
        class="min-w-0 flex-1 bg-transparent text-[13px] text-white/90 placeholder:text-white/30 outline-none"
        @keydown.enter="go"
      >
      <button
        class="grid size-7 place-items-center rounded-[8px] bg-white text-neutral-900 transition hover:bg-white/90 disabled:opacity-40"
        :disabled="busy || !phrase.trim()" @click="go"
      ><ArrowUp class="size-4" /></button>
    </div>
  </div>
</template>

<style scoped>
/* Dark prompt box with a pastel gradient ring that is INVISIBLE at rest and fades
   to full when the field is active (focused), muted (~40%) at rest. The ring is a masked pseudo-element
   so its opacity can transition — you can't fade a background-image gradient — and
   a full-pixel `padding` keeps it even on all sides despite the centred (fractional
   x) position. It slowly drifts regardless (paused for reduced-motion). */
.prompt-field {
  position: relative;
  background: #1a1a1a;
}
/* Animate the gradient by ROTATING a conic via the registered --pastel-angle
   custom property (declared globally in main.css). background-position animation
   is cached/frozen on masked elements in Chromium; animating the angle
   re-rasterizes the conic each frame, so the colours flow around the ring. */
.prompt-field::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;                       /* ring thickness */
  background: conic-gradient(from var(--pastel-angle), #ffd6e7, #cfe8ff, #d6ffe0, #fff4cc, #e7d6ff, #ffd6e7);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  opacity: 0.4;                       /* muted at rest */
  transition: opacity 0.4s ease;
  animation: prompt-pastel-spin 8s linear infinite;
  pointer-events: none;
}
.prompt-field:focus-within::before { opacity: 1; }   /* fade to full when active */
@keyframes prompt-pastel-spin {
  to { --pastel-angle: 360deg; }
}
@media (prefers-reduced-motion: reduce) {
  .prompt-field::before { animation: none; }
}
</style>
