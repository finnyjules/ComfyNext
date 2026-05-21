<script setup lang="ts">
import { Search, X } from 'lucide-vue-next'

const {
  nodeSearchOpen,
  searchQuery,
  activeFilter,
  selectedIndex,
  categories,
  filteredNodes,
  closeNodeSearch,
  addNode,
} = useNodeSearch()

const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLDivElement | null>(null)

// Left sidebar — 3 sections
const sidebarTop = [
  { id: 'most-relevant', label: 'Most relevant' },
  { id: 'recents', label: 'Recents' },
  { id: 'favorites', label: 'Favorites' },
]
const sidebarSources = [
  { id: 'essentials', label: 'Essentials' },
  { id: 'partner', label: 'Partner' },
  { id: 'core', label: 'Comfy' },
  { id: 'extensions', label: 'Extensions' },
]

watch(nodeSearchOpen, (open) => {
  if (open) nextTick(() => inputRef.value?.focus())
})

watch([searchQuery, activeFilter], () => {
  selectedIndex.value = 0
})

watch(selectedIndex, () => {
  nextTick(() => {
    const items = listRef.value?.querySelectorAll('[data-node-item]')
    const item = items?.[selectedIndex.value] as HTMLElement
    if (item) item.scrollIntoView({ block: 'nearest' })
  })
})

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeNodeSearch(); return }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filteredNodes.value.length - 1)
  }
  else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  }
  else if (e.key === 'Enter') {
    e.preventDefault()
    const node = filteredNodes.value[selectedIndex.value]
    if (node) addNode(node.name)
  }
}

const selectedNode = computed(() => filteredNodes.value[selectedIndex.value] || null)

function typeColor(type: string): string {
  const t = type?.toUpperCase()
  if (t === 'MODEL') return 'bg-purple-400'
  if (t === 'CLIP') return 'bg-yellow-400'
  if (t === 'IMAGE') return 'bg-blue-400'
  if (t === 'LATENT') return 'bg-pink-400'
  if (t === 'VAE') return 'bg-red-400'
  if (t === 'CONDITIONING') return 'bg-orange-400'
  if (t === 'MASK') return 'bg-emerald-400'
  return 'bg-white/30'
}

function sidebarBtnClass(id: string): string {
  return activeFilter.value === id
    ? 'text-white font-semibold bg-white/8'
    : 'text-white/40 hover:text-white/60 hover:bg-white/4'
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-150 ease-out"
      leave-active-class="transition-all duration-100 ease-in"
      enter-from-class="opacity-0 scale-95"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="nodeSearchOpen"
        class="fixed inset-0 z-[10000] flex items-start justify-center pt-[12vh]"
        @keydown="handleKeydown"
      >
        <div class="absolute inset-0 bg-black/50" @click="closeNodeSearch" />

        <!-- Dialog — 3 columns -->
        <div class="relative flex w-[700px] h-[420px] bg-[#1a1a1a] border border-[#2a2a2a] rounded-[12px] shadow-2xl overflow-hidden">

          <!-- Left sidebar (scrollable) -->
          <div class="w-[140px] border-r border-[#2a2a2a] bg-[#151515] py-1.5 flex flex-col shrink-0 overflow-y-auto">
            <!-- Top: relevance groups -->
            <button
              v-for="item in sidebarTop"
              :key="item.id"
              class="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer transition-colors shrink-0"
              :class="sidebarBtnClass(item.id)"
              @click="activeFilter = item.id"
            >
              {{ item.label }}
            </button>

            <div class="h-px bg-[#2a2a2a] mx-3 my-1.5 shrink-0" />

            <!-- Source groups -->
            <button
              v-for="item in sidebarSources"
              :key="item.id"
              class="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer transition-colors shrink-0"
              :class="sidebarBtnClass(item.id)"
              @click="activeFilter = item.id"
            >
              {{ item.label }}
            </button>

            <div class="h-px bg-[#2a2a2a] mx-3 my-1.5 shrink-0" />

            <!-- Node categories -->
            <button
              v-for="cat in categories"
              :key="cat"
              class="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer transition-colors shrink-0"
              :class="sidebarBtnClass(cat)"
              @click="activeFilter = cat"
            >
              {{ cat }}
            </button>
          </div>

          <!-- Center column -->
          <div class="flex-1 flex flex-col min-w-0">
            <!-- Search input -->
            <div class="flex items-center gap-2 px-3 py-2 border-b border-[#2a2a2a]">
              <Search class="size-3.5 text-white/30 shrink-0" />
              <input
                ref="inputRef"
                v-model="searchQuery"
                type="text"
                placeholder="Add a node..."
                class="flex-1 bg-transparent text-xs text-white placeholder:text-white/30 outline-none"
              />
              <button
                v-if="searchQuery"
                class="text-white/30 hover:text-white/60 cursor-pointer"
                @click="searchQuery = ''"
              >
                <X class="size-3" />
              </button>
              <kbd class="text-[9px] text-white/20 px-1 py-0.5 rounded bg-white/5 border border-white/10 shrink-0">ESC</kbd>
            </div>

            <!-- Results list -->
            <div ref="listRef" class="flex-1 overflow-y-auto">
              <div
                v-if="filteredNodes.length === 0"
                class="flex items-center justify-center py-8 text-[11px] text-white/30"
              >
                No nodes found
              </div>
              <button
                v-for="(node, index) in filteredNodes"
                :key="node.name"
                data-node-item
                class="w-full flex items-baseline gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors min-w-0"
                :class="index === selectedIndex ? 'bg-white/8' : 'hover:bg-white/4'"
                @click="addNode(node.name)"
                @mouseenter="selectedIndex = index"
              >
                <span class="text-xs font-semibold text-white/90 shrink-0">{{ node.displayName }}</span>
                <span v-if="node.description" class="text-[10px] text-white/30 truncate min-w-0">{{ node.description }}</span>
              </button>
            </div>
          </div>

          <!-- Right preview panel -->
          <div
            v-if="selectedNode"
            class="w-[170px] border-l border-[#2a2a2a] bg-[#151515] flex flex-col shrink-0 overflow-y-auto"
          >
            <!-- Mini node card -->
            <div class="p-2.5 border-b border-[#2a2a2a]">
              <div class="bg-[#1e1e1e] border border-[#333] rounded-md p-2">
                <div class="text-[9px] font-medium text-white/80 mb-1.5">{{ selectedNode.displayName }}</div>
                <div v-if="selectedNode.inputs.length" class="space-y-0.5">
                  <div v-for="inp in selectedNode.inputs.slice(0, 5)" :key="inp.name" class="flex items-center gap-1">
                    <div class="size-1.5 rounded-full shrink-0" :class="typeColor(inp.type)" />
                    <span class="text-[8px] text-white/50 truncate">{{ inp.name }}</span>
                  </div>
                </div>
                <div v-if="selectedNode.outputs.length" class="mt-1.5 space-y-0.5">
                  <div v-for="out in selectedNode.outputs.slice(0, 3)" :key="out.name" class="flex items-center justify-end gap-1">
                    <span class="text-[8px] text-white/50 truncate">{{ out.name }}</span>
                    <div class="size-1.5 rounded-full shrink-0" :class="typeColor(out.type)" />
                  </div>
                </div>
              </div>
            </div>

            <!-- Details -->
            <div class="p-2.5 flex-1">
              <div class="text-[11px] font-semibold text-white/90 mb-0.5">{{ selectedNode.displayName }}</div>
              <div class="text-[9px] text-white/30 mb-2">{{ selectedNode.category }}</div>

              <div v-if="selectedNode.description" class="text-[9px] text-white/40 leading-relaxed mb-3">
                {{ selectedNode.description }}
              </div>

              <template v-if="selectedNode.inputs.length">
                <div class="text-[8px] font-semibold text-white/50 uppercase tracking-wider mb-1">Inputs</div>
                <div class="space-y-0.5 mb-2.5">
                  <div v-for="inp in selectedNode.inputs" :key="inp.name" class="flex items-center justify-between gap-1">
                    <span class="text-[9px] text-white/60 truncate">{{ inp.name }}</span>
                    <span class="text-[8px] text-white/25 uppercase shrink-0">{{ inp.type }}</span>
                  </div>
                </div>
              </template>

              <template v-if="selectedNode.outputs.length">
                <div class="text-[8px] font-semibold text-white/50 uppercase tracking-wider mb-1">Outputs</div>
                <div class="space-y-0.5">
                  <div v-for="out in selectedNode.outputs" :key="out.name" class="flex items-center justify-between gap-1">
                    <span class="text-[9px] text-white/60 truncate">{{ out.name }}</span>
                    <span class="text-[8px] text-white/25 uppercase shrink-0">{{ out.type }}</span>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
