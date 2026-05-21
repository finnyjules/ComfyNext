<script setup>
import { ref, computed } from 'vue'

const props = defineProps({
  filters: { type: Object, required: true },
  filterCounts: { type: Object, default: () => ({}) },
  categories: { type: Array, default: () => [] },
  baseModels: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:filters'])

const outputTypes = ['Image', 'Video', 'Audio', '3D', 'Text']
const difficulties = ['Beginner', 'Intermediate', 'Advanced', 'Expert']

// Track collapsed state per group
const collapsed = ref({
  category: false,
  model: false,
  difficulty: false,
  outputType: true,
})

function toggleGroup(group) {
  collapsed.value[group] = !collapsed.value[group]
}

function getCount(group, value) {
  return props.filterCounts?.[group]?.[value] ?? 0
}

function isChecked(group, value) {
  const arr = props.filters[group]
  if (!arr) return false
  return arr.includes(value)
}

function toggleCheckbox(group, value) {
  const current = [...(props.filters[group] || [])]
  const idx = current.indexOf(value)
  if (idx >= 0) {
    current.splice(idx, 1)
  } else {
    current.push(value)
  }
  emit('update:filters', { ...props.filters, [group]: current })
}

function setDifficulty(value) {
  const newVal = props.filters.difficulty === value ? null : value
  emit('update:filters', { ...props.filters, difficulty: newVal })
}

const hasActiveFilters = computed(() => {
  return (
    (props.filters.category?.length > 0) ||
    (props.filters.model?.length > 0) ||
    props.filters.difficulty ||
    (props.filters.outputType?.length > 0) ||
    (props.filters.technique?.length > 0)
  )
})

function clearAll() {
  emit('update:filters', {
    category: [],
    model: [],
    difficulty: null,
    outputType: [],
    technique: [],
  })
}
</script>

<template>
  <aside class="w-[240px] shrink-0 lg:w-full">
    <div class="flex items-center justify-between mb-6">
      <h3 class="text-lg font-semibold text-foreground">Filters</h3>
      <button
        v-if="hasActiveFilters"
        class="text-sm text-comfy-yellow/80 hover:text-comfy-yellow hover:underline bg-transparent border-none cursor-pointer p-0 transition-all duration-150"
        @click="clearAll"
      >
        Clear all
      </button>
    </div>

    <!-- Category filter -->
    <div class="border-b border-border pb-4 mb-4 last:border-b-0 last:mb-0">
      <button
        class="flex items-center justify-between w-full py-2 bg-transparent border-none cursor-pointer text-sm font-semibold text-foreground hover:text-comfy-yellow/80 focus-visible:ring-2 focus-visible:ring-ring"
        @click="toggleGroup('category')"
        :aria-expanded="!collapsed.category"
      >
        <span>Category</span>
        <svg
          class="transition-transform duration-150 text-muted-foreground/70"
          :class="{ '-rotate-90': collapsed.category }"
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div v-show="!collapsed.category" class="filter-group-body flex flex-col gap-1 pt-2 max-h-[280px] overflow-y-auto">
        <label
          v-for="cat in categories"
          :key="cat.id"
          class="flex items-center gap-2 px-2 py-1 rounded-sm cursor-pointer transition-all duration-150 hover:bg-accent select-none"
        >
          <input
            type="checkbox"
            class="filter-input absolute opacity-0 w-0 h-0 pointer-events-none"
            :checked="isChecked('category', cat.id)"
            @change="toggleCheckbox('category', cat.id)"
          />
          <span class="filter-checkmark relative w-4 h-4 shrink-0 border-2 border-foreground/30 rounded-sm bg-accent transition-all duration-150" />
          <span class="flex-1 text-sm text-muted-foreground truncate">{{ cat.label }}</span>
          <span class="text-xs text-muted-foreground/70 tabular-nums min-w-[20px] text-right">{{ getCount('category', cat.id) }}</span>
        </label>
      </div>
    </div>

    <!-- Base Model filter -->
    <div class="border-b border-border pb-4 mb-4 last:border-b-0 last:mb-0">
      <button
        class="flex items-center justify-between w-full py-2 bg-transparent border-none cursor-pointer text-sm font-semibold text-foreground hover:text-comfy-yellow/80 focus-visible:ring-2 focus-visible:ring-ring"
        @click="toggleGroup('model')"
        :aria-expanded="!collapsed.model"
      >
        <span>Base Model</span>
        <svg
          class="transition-transform duration-150 text-muted-foreground/70"
          :class="{ '-rotate-90': collapsed.model }"
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div v-show="!collapsed.model" class="filter-group-body flex flex-col gap-1 pt-2 max-h-[280px] overflow-y-auto">
        <label
          v-for="model in baseModels"
          :key="model"
          class="flex items-center gap-2 px-2 py-1 rounded-sm cursor-pointer transition-all duration-150 hover:bg-accent select-none"
        >
          <input
            type="checkbox"
            class="filter-input absolute opacity-0 w-0 h-0 pointer-events-none"
            :checked="isChecked('model', model)"
            @change="toggleCheckbox('model', model)"
          />
          <span class="filter-checkmark relative w-4 h-4 shrink-0 border-2 border-foreground/30 rounded-sm bg-accent transition-all duration-150" />
          <span class="flex-1 text-sm text-muted-foreground truncate">{{ model }}</span>
          <span class="text-xs text-muted-foreground/70 tabular-nums min-w-[20px] text-right">{{ getCount('model', model) }}</span>
        </label>
      </div>
    </div>

    <!-- Difficulty filter -->
    <div class="border-b border-border pb-4 mb-4 last:border-b-0 last:mb-0">
      <button
        class="flex items-center justify-between w-full py-2 bg-transparent border-none cursor-pointer text-sm font-semibold text-foreground hover:text-comfy-yellow/80 focus-visible:ring-2 focus-visible:ring-ring"
        @click="toggleGroup('difficulty')"
        :aria-expanded="!collapsed.difficulty"
      >
        <span>Difficulty</span>
        <svg
          class="transition-transform duration-150 text-muted-foreground/70"
          :class="{ '-rotate-90': collapsed.difficulty }"
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div v-show="!collapsed.difficulty" class="filter-group-body flex flex-col gap-1 pt-2 max-h-[280px] overflow-y-auto">
        <label
          v-for="level in difficulties"
          :key="level"
          class="flex items-center gap-2 px-2 py-1 rounded-sm cursor-pointer transition-all duration-150 hover:bg-accent select-none"
        >
          <input
            type="radio"
            name="difficulty"
            class="filter-input absolute opacity-0 w-0 h-0 pointer-events-none"
            :checked="filters.difficulty === level"
            @change="setDifficulty(level)"
          />
          <span class="filter-radio-mark relative w-4 h-4 shrink-0 border-2 border-foreground/30 rounded-full bg-accent transition-all duration-150" />
          <span class="flex-1 text-sm text-muted-foreground truncate">{{ level }}</span>
          <span class="text-xs text-muted-foreground/70 tabular-nums min-w-[20px] text-right">{{ getCount('difficulty', level) }}</span>
        </label>
      </div>
    </div>

    <!-- Output Type filter -->
    <div class="border-b border-border pb-4 mb-4 last:border-b-0 last:mb-0">
      <button
        class="flex items-center justify-between w-full py-2 bg-transparent border-none cursor-pointer text-sm font-semibold text-foreground hover:text-comfy-yellow/80 focus-visible:ring-2 focus-visible:ring-ring"
        @click="toggleGroup('outputType')"
        :aria-expanded="!collapsed.outputType"
      >
        <span>Output Type</span>
        <svg
          class="transition-transform duration-150 text-muted-foreground/70"
          :class="{ '-rotate-90': collapsed.outputType }"
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <div v-show="!collapsed.outputType" class="filter-group-body flex flex-col gap-1 pt-2 max-h-[280px] overflow-y-auto">
        <label
          v-for="type in outputTypes"
          :key="type"
          class="flex items-center gap-2 px-2 py-1 rounded-sm cursor-pointer transition-all duration-150 hover:bg-accent select-none"
        >
          <input
            type="checkbox"
            class="filter-input absolute opacity-0 w-0 h-0 pointer-events-none"
            :checked="isChecked('outputType', type)"
            @change="toggleCheckbox('outputType', type)"
          />
          <span class="filter-checkmark relative w-4 h-4 shrink-0 border-2 border-foreground/30 rounded-sm bg-accent transition-all duration-150" />
          <span class="flex-1 text-sm text-muted-foreground truncate">{{ type }}</span>
          <span class="text-xs text-muted-foreground/70 tabular-nums min-w-[20px] text-right">{{ getCount('outputType', type) }}</span>
        </label>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* custom-scrollbar for filter group bodies */
.filter-group-body {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.filter-group-body::-webkit-scrollbar {
  width: 6px;
}
.filter-group-body::-webkit-scrollbar-track {
  background: transparent;
}
.filter-group-body::-webkit-scrollbar-thumb {
  background-color: var(--border);
  border-radius: 3px;
}

/* Checkbox mark pseudo-element */
.filter-checkmark::after {
  content: '';
  position: absolute;
  top: 1px;
  left: 4px;
  width: 5px;
  height: 8px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) scale(0);
  transition: transform 150ms;
}

.filter-input:checked + .filter-checkmark {
  background-color: var(--comfy-yellow);
  border-color: var(--comfy-yellow);
}
.filter-input:checked + .filter-checkmark::after {
  transform: rotate(45deg) scale(1);
}
.filter-input:focus-visible + .filter-checkmark {
  outline: 2px solid var(--comfy-yellow);
  outline-offset: 2px;
}

/* Radio mark pseudo-element */
.filter-radio-mark::after {
  content: '';
  position: absolute;
  top: 3px;
  left: 3px;
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: var(--comfy-yellow);
  transform: scale(0);
  transition: transform 150ms;
}

.filter-input:checked + .filter-radio-mark {
  border-color: var(--comfy-yellow);
}
.filter-input:checked + .filter-radio-mark::after {
  transform: scale(1);
}
.filter-input:focus-visible + .filter-radio-mark {
  outline: 2px solid var(--comfy-yellow);
  outline-offset: 2px;
}
</style>
