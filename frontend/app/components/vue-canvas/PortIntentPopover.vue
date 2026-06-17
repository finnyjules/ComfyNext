<script setup lang="ts">
import type { PortAnchor, NodeTypeLite } from '~/lib/portIntent'
import { anchorCandidates } from '~/lib/portIntent'
import { NODE_KEYWORDS } from '~/lib/nodeKeywords'
import { searchNodes } from '~/lib/nodeMatch'

const props = defineProps<{
  anchor: PortAnchor
  screen: { x: number; y: number }
  aiState: 'idle' | 'loading' | 'error' | 'done'
  aiError?: string | null
  aiNote?: string | null
}>()

const emit = defineEmits<{
  (e: 'select-node', nodeType: string): void
  (e: 'ask-ai', intent: string): void
  (e: 'close'): void
}>()

const { nodeTypes, fetchNodeTypes } = useNodeSearch()

const query = ref('')
const selectedIndex = ref(0)
const rootEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLInputElement | null>(null)

const candidates = computed<NodeTypeLite[]>(() => {
  const list = anchorCandidates(nodeTypes.value, props.anchor)
  // Tokenized, ranked, keyword-aware match (see lib/nodeMatch). Empty query
  // returns the (capped) candidate list unchanged.
  return searchNodes(list, query.value, { keywords: NODE_KEYWORDS, limit: 8 })
})

// Rows are candidates + one trailing "Ask AI" row.
const rowCount = computed(() => candidates.value.length + 1)
const aiRowIndex = computed(() => candidates.value.length)

watch(query, () => { selectedIndex.value = 0 })

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value + 1) % rowCount.value
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = (selectedIndex.value - 1 + rowCount.value) % rowCount.value
  }
  else if (e.key === 'Enter') {
    e.preventDefault()
    if (e.metaKey || e.ctrlKey || selectedIndex.value === aiRowIndex.value) {
      submitAi()
    }
    else {
      const n = candidates.value[selectedIndex.value]
      if (n) emit('select-node', n.name)
    }
  }
  else if (e.key === 'Escape') {
    emit('close')
  }
}

function submitAi() {
  const intent = query.value.trim()
  if (intent && props.aiState !== 'loading') emit('ask-ai', intent)
}

function onDocPointerDown(e: PointerEvent) {
  if (rootEl.value && !rootEl.value.contains(e.target as Node)) emit('close')
}

onMounted(() => {
  fetchNodeTypes()
  nextTick(() => inputEl.value?.focus())
  document.addEventListener('pointerdown', onDocPointerDown, true)
})
onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown, true))
</script>

<template>
  <div
    ref="rootEl"
    class="fixed z-[90] w-80 rounded-lg border border-white/10 bg-[#1e1e1e] shadow-2xl text-sm overflow-hidden"
    :style="{ left: `${screen.x}px`, top: `${screen.y}px` }"
    @pointerdown.stop
    @click.stop
  >
    <input
      ref="inputEl"
      v-model="query"
      type="text"
      placeholder="What do you want to do?"
      class="w-full bg-transparent px-3 py-2.5 text-white placeholder-white/30 outline-none border-b border-white/10"
      @keydown="onKeydown"
    >

    <div class="max-h-72 overflow-y-auto py-1">
      <button
        v-for="(n, i) in candidates"
        :key="n.name"
        class="w-full flex items-center justify-between px-3 py-1.5 text-left"
        :class="i === selectedIndex ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5'"
        @mouseenter="selectedIndex = i"
        @click="emit('select-node', n.name)"
      >
        <span class="truncate">{{ n.displayName }}</span>
        <span class="ml-2 shrink-0 text-[10px] text-white/30">{{ n.category.split('/')[0] }}</span>
      </button>

      <button
        class="w-full flex items-center gap-2 px-3 py-2 text-left border-t border-white/10 disabled:opacity-50"
        :class="selectedIndex === aiRowIndex ? 'bg-emerald-500/15 text-emerald-200' : 'text-emerald-300/80 hover:bg-white/5'"
        :disabled="aiState === 'loading' || !query.trim()"
        @mouseenter="selectedIndex = aiRowIndex"
        @click="submitAi"
      >
        <span v-if="aiState === 'loading'" class="inline-block h-3 w-3 animate-spin rounded-full border border-emerald-300 border-t-transparent" />
        <span v-else>✦</span>
        <span class="truncate">
          {{ aiState === 'loading' ? 'Asking AI…' : (query.trim() ? `Ask AI: "${query.trim()}"` : 'Ask AI (type your intent)') }}
        </span>
        <span class="ml-auto shrink-0 text-[10px] text-white/30">⌘⏎</span>
      </button>
    </div>

    <div v-if="aiState === 'error' && aiError" class="px-3 py-2 text-xs text-red-400 border-t border-white/10">
      {{ aiError }}
    </div>
    <div v-else-if="aiState === 'done' && aiNote" class="px-3 py-2 text-xs text-emerald-300 border-t border-white/10">
      ✦ {{ aiNote }}
    </div>
  </div>
</template>
