<script setup lang="ts">
// Shared modal chrome for the studio editors (Space Type, Gradient, Shader). Header
// (title · breadcrumb · esc/close, separated from the body by spacing — no divider rule)
// + big preview/actions on the left and a scrollable controls column on the right. No
// vertical rail seam. Change the chrome here and all three editors update.
//
// The controls column publishes its scroll offset as the `--studio-scroll` CSS var so the
// frosted-glass StudioSection cards can drift their specular/refraction as you scroll.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import AgentBar from '~/components/agent/AgentBar.vue'
import AgentProgress from '~/components/agent/AgentProgress.vue'
import AgentProposal from '~/components/agent/AgentProposal.vue'

// `agent` is the useStudioAgent() return (an object of refs + actions). When
// provided, the shell renders a bare prompt docked under the preview and lets the
// agent's progress / proposal take over the controls column — the same layout the
// Compositor uses, so every studio behaves consistently.
//
// Sizing is uniform across every studio. The larger 1400×820 frame started as an
// opt-in for 3D Studio's object list, then graduated to the default — the extra
// preview room helps every editor, and one size keeps the studios from feeling
// like different apps when you move between them.
const props = defineProps<{ title?: string; breadcrumb?: string; agent?: any; agentPlaceholder?: string }>()
const emit = defineEmits<{ close: [] }>()

const agentActive = computed(() => {
  const a = props.agent
  return !!a && (a.busy.value || a.reviewing?.value || a.hasProposal.value)
})

const rootEl = ref<HTMLElement | null>(null)
const controlsEl = ref<HTMLElement | null>(null)
let raf = 0
function onControlsScroll() {
  if (raf) return
  raf = requestAnimationFrame(() => {
    raf = 0
    const el = controlsEl.value
    if (el) el.style.setProperty('--studio-scroll', String(el.scrollTop))
  })
}

function onKeydown(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  if (e.key === 'Escape') { e.stopPropagation(); emit('close') }
}
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  rootEl.value?.focus()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
    <div ref="rootEl" tabindex="-1" role="dialog" aria-modal="true"
         class="flex h-[820px] max-h-[92vh] w-[1400px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0e10] text-white outline-none">
      <div class="flex shrink-0 items-center gap-2 px-4 pt-3 pb-1">
        <span class="text-[13px] font-medium tracking-[-0.01em] text-white/90">{{ title }}</span>
        <template v-if="breadcrumb">
          <span class="text-xs text-white/25">/</span>
          <span class="text-xs text-white/50">{{ breadcrumb }}</span>
        </template>
        <span class="flex-1"></span>
        <span class="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-white/30">esc</span>
        <button type="button" aria-label="Close" @click="emit('close')"
                class="text-white/45 transition-colors hover:text-white/80">✕</button>
      </div>
      <div class="flex min-h-0 flex-1 gap-4 p-4">
        <!-- Optional dedicated panel column (e.g. 3D Studio's object list), on the
             left of the preview — mirrors the Smart Layout / Frame layers panel. -->
        <div v-if="$slots.aside" class="flex w-56 shrink-0 min-h-0"><slot name="aside" /></div>
        <div class="flex min-h-0 flex-1 flex-col">
          <div class="flex min-h-0 flex-1 items-center justify-center"><slot name="preview" /></div>
          <!-- Agent prompt: bare (no container), docked under the preview — mirrors
               the Compositor. Its output renders in the controls column at right. -->
          <div v-if="agent" class="mt-3 shrink-0">
            <AgentBar
              :busy="agent.busy.value" :error="agent.error.value" :notice="agent.notice.value"
              :chips="[]" :placeholder="agentPlaceholder"
              @submit="agent.ask" @chip="agent.ask"
            />
          </div>
          <div class="mt-3 flex shrink-0 items-center gap-2"><slot name="actions" /></div>
        </div>
        <div ref="controlsEl" @scroll="onControlsScroll" class="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto pr-1 min-h-0">
          <!-- Assistant takeover: the agent's progress / proposal replace the controls
               while it's working, then hand back the controls when done. -->
          <template v-if="agentActive">
            <div class="flex items-center gap-2 pb-1">
              <span class="text-white/70">✦</span>
              <span class="text-sm font-medium">Assistant</span>
            </div>
            <AgentProgress v-if="agent.busy.value" :active="agent.busy.value" />
            <div v-else-if="agent.reviewing?.value && !agent.hasProposal.value" class="flex items-center gap-1.5 text-[11.5px] text-white/55">
              <span class="text-white/75">✦</span> Analyzing the result for imperfections<span class="animate-pulse">…</span>
            </div>
            <AgentProposal
              v-else-if="agent.hasProposal.value"
              :changes="agent.changes.value" :busy="agent.busy.value" :issues="agent.issues?.value"
              :review="agent.review.value" :reviewing="agent.reviewing?.value"
              @accept="agent.acceptChange" @reject="agent.rejectChange" @reroll="agent.reroll"
              @keep="agent.keep" @revert="agent.revert" @hover="(i: number | null) => agent.hovered.value = i"
            />
          </template>
          <slot v-else name="controls" />
        </div>
      </div>
    </div>
  </div>
</template>
