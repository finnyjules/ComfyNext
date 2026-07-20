<!--
  NodeReadyBadge — the "marked ready to deliver" indicator for an artifact node.
  Rendered as the first child of an artifact node's (position:relative) root:
  a light-green stroke around the whole node + a green checkmark badge
  overhanging the top-right corner. Shown when the node's output is in the
  project's deliverables (readyNodeIds is provided by default.vue).
-->
<script setup lang="ts">
import { computed, inject } from 'vue'
import { Check } from 'lucide-vue-next'

const props = defineProps<{ nodeId: string | number }>()

const readyNodeIds = inject<{ value: Set<string> } | null>('readyNodeIds', null)
const isReady = computed(() => !!readyNodeIds?.value?.has(String(props.nodeId)))
</script>

<template>
  <template v-if="isReady">
    <!-- light-green stroke around the whole node -->
    <div class="pointer-events-none absolute -inset-[3px] z-40 rounded-[15px] border-2 border-emerald-400/70"></div>
    <!-- green checkmark badge, overhanging the top-right corner (above the node's
         own chrome toolbar, which sits at z-30) -->
    <div class="pointer-events-none absolute -right-2 -top-2 z-50 flex size-5 items-center justify-center rounded-full bg-emerald-500 shadow ring-2 ring-[#121316]">
      <Check class="size-3 text-white" :stroke-width="3" />
    </div>
  </template>
</template>
