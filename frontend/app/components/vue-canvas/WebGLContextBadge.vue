<script setup lang="ts">
// Dev-only badge showing how many live WebGL contexts the app holds vs the
// browser's practical cap. Past the cap the browser silently kills the oldest
// context (a studio/node "crash"), so this makes creeping toward it visible while
// building. Click to dump the live labels to the console. Not rendered in prod.
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import {
  liveWebGLContextCount, liveWebGLContextLabels, onWebGLContextChange, WEBGL_CONTEXT_SOFT_CAP,
} from '~/lib/webgl/contextRegistry'

const isDev = import.meta.dev
const count = ref(liveWebGLContextCount())
let off: (() => void) | null = null

onMounted(() => { off = onWebGLContextChange((n) => { count.value = n }) })
onBeforeUnmount(() => { off?.() })

const level = computed(() => {
  if (count.value >= WEBGL_CONTEXT_SOFT_CAP) return 'over'
  if (count.value >= WEBGL_CONTEXT_SOFT_CAP - 4) return 'near'
  return 'ok'
})

function dump() {
  // eslint-disable-next-line no-console
  console.log(`[WebGL] ${count.value}/${WEBGL_CONTEXT_SOFT_CAP} live contexts:`, liveWebGLContextLabels())
}
</script>

<template>
  <button
    v-if="isDev"
    type="button"
    class="fixed bottom-2 left-2 z-[9999] flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-[10px] tabular-nums shadow-sm transition"
    :class="{
      'border-white/10 bg-black/60 text-white/60 hover:text-white/90': level === 'ok',
      'border-amber-400/40 bg-amber-500/15 text-amber-300': level === 'near',
      'border-red-500/50 bg-red-600/20 text-red-300': level === 'over',
    }"
    :title="`Live WebGL contexts vs the browser cap (~${WEBGL_CONTEXT_SOFT_CAP}). Click to log which ones.`"
    @click="dump"
  >
    <span aria-hidden="true">◇</span>
    <span>{{ count }}/{{ WEBGL_CONTEXT_SOFT_CAP }} GL</span>
  </button>
</template>
