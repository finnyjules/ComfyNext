<script setup lang="ts">
const props = defineProps<{
  breadcrumbs: { name: string; index: number }[]
}>()

const emit = defineEmits<{
  navigate: [index: number]
}>()
</script>

<template>
  <div class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10">
    <template v-for="(crumb, i) in breadcrumbs" :key="crumb.index">
      <!-- Separator -->
      <svg v-if="i > 0" class="size-3 text-white/30 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 18 15 12 9 6" />
      </svg>
      <!-- Clickable breadcrumb (all except the last one) -->
      <button
        v-if="i < breadcrumbs.length - 1"
        class="text-xs text-white/60 hover:text-white/90 transition-colors cursor-pointer truncate max-w-[160px]"
        @click="emit('navigate', crumb.index)"
      >
        {{ crumb.name }}
      </button>
      <!-- Current level (not clickable) -->
      <span v-else class="text-xs text-white/90 font-medium truncate max-w-[160px]">
        {{ crumb.name }}
      </span>
    </template>
  </div>
</template>
