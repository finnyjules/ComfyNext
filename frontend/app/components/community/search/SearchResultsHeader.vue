<script setup>
import { computed } from 'vue'
import { formatNumber } from '~/lib/community/formatters.js'

const props = defineProps({
  total: { type: Number, default: 0 },
  query: { type: String, default: '' },
  sort: { type: String, default: 'relevance' },
  viewMode: { type: String, default: 'grid' },
})

const emit = defineEmits(['update:sort', 'update:viewMode'])

const sortOptions = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'popular', label: 'Most Popular' },
  { value: 'newest', label: 'Newest' },
  { value: 'runs', label: 'Most Runs' },
  { value: 'favorites', label: 'Most Favorites' },
]

const resultText = computed(() => {
  const count = formatNumber(props.total)
  const suffix = props.total === 1 ? 'result' : 'results'
  if (props.query) {
    return `${count} ${suffix} for "${props.query}"`
  }
  return `${count} ${suffix}`
})
</script>

<template>
  <div class="flex items-center justify-between gap-4 pb-6 border-b border-border mb-6 md:flex-col md:items-start">
    <p class="text-lg md:text-base font-semibold text-foreground whitespace-nowrap">{{ resultText }}</p>

    <div class="flex items-center gap-4">
      <!-- Sort dropdown -->
      <div class="flex items-center gap-2">
        <label for="sort-select" class="text-sm text-muted-foreground/70 whitespace-nowrap">Sort by</label>
        <select
          id="sort-select"
          class="sort-select appearance-none bg-accent border border-border rounded-md text-foreground text-sm py-2 pl-3 pr-8 cursor-pointer transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring hover:border-foreground/30"
          :value="sort"
          @change="emit('update:sort', $event.target.value)"
        >
          <option
            v-for="option in sortOptions"
            :key="option.value"
            :value="option.value"
            class="bg-muted text-foreground"
          >
            {{ option.label }}
          </option>
        </select>
      </div>

      <!-- View toggle -->
      <div class="flex items-center bg-accent border border-border rounded-md overflow-hidden" role="group" aria-label="View mode">
        <button
          class="flex items-center justify-center p-2 bg-transparent border-none cursor-pointer transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring"
          :class="viewMode === 'grid'
            ? 'text-comfy-yellow/80 bg-comfy-yellow/15'
            : 'text-muted-foreground/70 hover:text-foreground hover:bg-accent'"
          aria-label="Grid view"
          @click="emit('update:viewMode', 'grid')"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
          </svg>
        </button>
        <button
          class="flex items-center justify-center p-2 bg-transparent border-none border-l border-border cursor-pointer transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring"
          :class="viewMode === 'list'
            ? 'text-comfy-yellow/80 bg-comfy-yellow/15'
            : 'text-muted-foreground/70 hover:text-foreground hover:bg-accent'"
          aria-label="List view"
          @click="emit('update:viewMode', 'list')"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Custom select arrow */
.sort-select {
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%236b6b80' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
}

/* View toggle button separator */
.flex > button + button {
  border-left: 1px solid var(--border);
}
</style>
