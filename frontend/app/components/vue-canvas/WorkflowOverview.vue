<script setup lang="ts">
import { Search, X, ChevronRight } from 'lucide-vue-next'
import { getTypeColor } from '~/composables/useVueNodes'

const props = defineProps<{
  nodes: any[]
}>()

const emit = defineEmits<{
  close: []
}>()

const activeTab = ref<'parameters' | 'nodes' | 'settings'>('nodes')
const searchQuery = ref('')
const expandedNodes = ref<Set<string>>(new Set())

function toggleNode(id: string) {
  if (expandedNodes.value.has(id)) {
    expandedNodes.value.delete(id)
  } else {
    expandedNodes.value.add(id)
  }
}

const filteredNodes = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return props.nodes
  return props.nodes.filter((n: any) =>
    n.data?.title?.toLowerCase().includes(q)
    || n.data?.nodeType?.toLowerCase().includes(q),
  )
})

function getAccentColor(node: any) {
  const firstOutput = node.data?.outputs?.[0]
  if (firstOutput) return getTypeColor(firstOutput.type)
  const firstInput = node.data?.inputs?.[0]
  if (firstInput) return getTypeColor(firstInput.type)
  return '#6b7280'
}
</script>

<template>
  <div class="h-full flex flex-col bg-[#141414] border-l border-[#2a2a2a] overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-[#2a2a2a] shrink-0">
      <span class="text-sm font-semibold text-white">Workflow Overview</span>
      <button
        class="text-white/40 hover:text-white transition-colors cursor-pointer"
        @click="emit('close')"
      >
        <X class="size-4" />
      </button>
    </div>

    <!-- Tabs -->
    <div class="flex items-center gap-1 px-3 py-2 border-b border-[#2a2a2a] shrink-0">
      <button
        v-for="tab in (['parameters', 'nodes', 'settings'] as const)"
        :key="tab"
        class="px-3 py-1.5 rounded text-xs font-medium transition-colors cursor-pointer"
        :class="activeTab === tab
          ? 'bg-white/10 text-white'
          : 'text-white/50 hover:text-white/70 hover:bg-white/5'"
        @click="activeTab = tab"
      >
        {{ tab === 'settings' ? 'Global Settings' : tab.charAt(0).toUpperCase() + tab.slice(1) }}
      </button>
    </div>

    <!-- Search -->
    <div class="px-3 py-2 border-b border-[#2a2a2a] shrink-0">
      <div class="flex items-center gap-2 bg-[#1e1e1e] rounded-lg px-3 py-1.5 border border-[#2a2a2a]">
        <Search class="size-3.5 text-white/30 shrink-0" />
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search..."
          class="bg-transparent text-xs text-white placeholder-white/30 outline-none w-full"
        />
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <!-- Parameters tab -->
      <div v-if="activeTab === 'parameters'" class="p-4">
        <p class="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-3">No favorited inputs</p>
        <div class="flex flex-col items-center justify-center py-8 text-center">
          <p class="text-xs text-white/40 mb-1">Inputs you favorite will show up here</p>
          <p class="text-[11px] text-white/30">In the Nodes tab, click the ⋮ on any input to add it here</p>
        </div>
      </div>

      <!-- Nodes tab -->
      <div v-else-if="activeTab === 'nodes'" class="py-1">
        <div
          v-for="node in filteredNodes"
          :key="node.id"
          class="border-b border-[#1e1e1e] last:border-0"
        >
          <!-- Node header -->
          <button
            class="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/5 transition-colors cursor-pointer"
            @click="toggleNode(node.id)"
          >
            <ChevronRight
              class="size-3 text-white/40 transition-transform shrink-0"
              :class="{ 'rotate-90': expandedNodes.has(node.id) }"
            />
            <div class="size-2 rounded-full shrink-0" :style="{ backgroundColor: getAccentColor(node) }" />
            <span class="text-xs font-medium text-white/80 truncate">{{ node.data?.title || node.data?.nodeType }}</span>
          </button>

          <!-- Expanded widgets -->
          <div
            v-if="expandedNodes.has(node.id) && node.data?.widgetDefs?.length"
            class="px-3 pb-2 pl-8"
          >
            <div
              v-for="(widget, i) in node.data.widgetDefs"
              :key="widget.name"
              class="flex items-start justify-between gap-2 py-1.5"
            >
              <span class="text-[11px] text-white/40 shrink-0 uppercase">{{ widget.name }}</span>
              <span class="text-[11px] text-white/70 text-right truncate max-w-[160px]">
                {{ node.data.widgetsValues?.[i] ?? '—' }}
              </span>
            </div>
          </div>

          <!-- Expanded but no widgets -->
          <div
            v-if="expandedNodes.has(node.id) && !node.data?.widgetDefs?.length"
            class="px-3 pb-2 pl-8"
          >
            <p class="text-[11px] text-white/30 italic">No configurable inputs</p>
          </div>
        </div>

        <!-- Empty state -->
        <div v-if="filteredNodes.length === 0" class="p-4 text-center">
          <p class="text-xs text-white/30">No nodes found</p>
        </div>
      </div>

      <!-- Global Settings tab -->
      <div v-else-if="activeTab === 'settings'" class="p-4">
        <p class="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-3">Workflow Settings</p>
        <p class="text-xs text-white/30">No global settings configured</p>
      </div>
    </div>
  </div>
</template>
