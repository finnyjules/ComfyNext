<script setup lang="ts">
/**
 * Shared footer Render control for studio nodes — a white split button (Render +
 * caret) mirroring the generator's Play/Re-roll, but "Render" because studios bake
 * locally rather than run a backend. The caret offers the three run scopes; all
 * dispatch `sailor:studioRender` which VueNodeCanvas turns into a cascade.
 */
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { Play, ChevronUp, Loader2 } from 'lucide-vue-next'

const props = defineProps<{ nodeId: string; busy?: boolean }>()
const open = ref(false)

function fire(scope: 'self' | 'upstream' | 'downstream') {
  open.value = false
  window.dispatchEvent(new CustomEvent('sailor:studioRender', { detail: { sourceNodeId: props.nodeId, scope } }))
}
function onOutside(e: MouseEvent) {
  if (!(e.target as HTMLElement)?.closest?.('[data-studio-render]')) open.value = false
}
onMounted(() => window.addEventListener('mousedown', onOutside, true))
onBeforeUnmount(() => window.removeEventListener('mousedown', onOutside, true))

const OPTS = [
  { scope: 'self' as const, label: 'Render this' },
  { scope: 'upstream' as const, label: 'Rebuild from start → here' },
  { scope: 'downstream' as const, label: 'Run from here → end' },
]
</script>

<template>
  <div class="relative flex items-stretch gap-px nopan nodrag" data-studio-render>
    <button
      class="flex flex-1 items-center justify-center gap-1.5 rounded-l bg-white/90 px-2 py-1.5 text-[11px] font-medium text-neutral-900 transition hover:bg-white disabled:opacity-60"
      :disabled="busy"
      @click.stop="fire('downstream')"
    >
      <Loader2 v-if="busy" class="h-3 w-3 animate-spin" />
      <Play v-else class="h-3 w-3" />
      {{ busy ? 'Rendering…' : 'Render' }}
    </button>
    <button
      class="flex items-center justify-center rounded-r bg-white/90 px-1.5 text-neutral-900 transition hover:bg-white disabled:opacity-60"
      :disabled="busy"
      title="Render scope"
      @click.stop="open = !open"
    >
      <ChevronUp class="h-3 w-3 transition-transform" :class="open ? '' : 'rotate-180'" />
    </button>

    <div
      v-if="open"
      class="absolute bottom-full right-0 z-50 mb-1 w-48 overflow-hidden rounded-md border border-white/10 bg-neutral-800 shadow-xl"
    >
      <button
        v-for="o in OPTS" :key="o.scope"
        class="block w-full px-3 py-2 text-left text-[11px] text-white/85 transition hover:bg-white/10"
        @click.stop="fire(o.scope)"
      >{{ o.label }}</button>
    </div>
  </div>
</template>
