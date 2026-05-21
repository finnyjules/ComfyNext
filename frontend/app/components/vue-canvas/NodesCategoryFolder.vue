<script setup lang="ts">
import { ChevronRight, Folder } from 'lucide-vue-next'

const props = defineProps<{
  catPath: string
  label: string
  depth: number
  expandedCategories: Set<string>
  nodeTypes: { name: string; displayName: string; category: string; source: string; outputs: { name: string; type: string }[] }[]
}>()

const emit = defineEmits<{
  toggle: [catPath: string]
  addNode: [nodeType: string]
}>()

const isExpanded = computed(() => props.expandedCategories.has(props.catPath))

// Get subcategories and direct nodes for this path
const subcategories = computed(() => {
  const subs = new Set<string>()
  const prefix = props.catPath + '/'
  for (const node of props.nodeTypes) {
    if (node.category.startsWith(prefix)) {
      const rest = node.category.slice(prefix.length)
      const nextSeg = rest.split('/')[0]
      if (nextSeg) subs.add(nextSeg)
    }
  }
  return [...subs].sort()
})

const directNodes = computed(() => {
  return props.nodeTypes.filter(n => n.category === props.catPath)
})

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
</script>

<template>
  <div>
    <!-- Folder button -->
    <button
      class="w-full flex items-center gap-2 py-1.5 hover:bg-white/5 transition-colors cursor-pointer"
      :style="{ paddingLeft: `${12 + depth * 16}px` }"
      @click="emit('toggle', catPath)"
    >
      <ChevronRight
        class="size-3 text-white/40 transition-transform shrink-0"
        :class="{ 'rotate-90': isExpanded }"
      />
      <Folder class="size-3.5 text-white/40 shrink-0" />
      <span class="text-xs text-white/70">{{ label }}</span>
    </button>

    <!-- Expanded contents -->
    <div v-if="isExpanded">
      <!-- Subcategory folders (recursive) -->
      <VueCanvasNodesCategoryFolder
        v-for="sub in subcategories"
        :key="sub"
        :cat-path="`${catPath}/${sub}`"
        :label="sub"
        :depth="depth + 1"
        :expanded-categories="expandedCategories"
        :node-types="nodeTypes"
        @toggle="emit('toggle', $event)"
        @add-node="emit('addNode', $event)"
      />

      <!-- Direct nodes in this category -->
      <div
        v-for="node in directNodes"
        :key="node.name"
        class="flex items-center gap-2 py-1.5 hover:bg-white/5 cursor-pointer transition-colors rounded-md"
        :style="{ paddingLeft: `${28 + depth * 16}px` }"
        @click="emit('addNode', node.name)"
      >
        <div class="flex gap-0.5 shrink-0">
          <div
            v-for="output in node.outputs.slice(0, 2)"
            :key="output.name"
            class="size-1.5 rounded-full"
            :class="typeColor(output.type)"
          />
        </div>
        <span class="text-[11px] text-white/60 truncate">{{ node.displayName }}</span>
      </div>
    </div>
  </div>
</template>
