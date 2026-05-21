<script setup>
import { computed } from 'vue'
import { categories as allCategories } from '~/data/community/mock/generators/categories.js'

const props = defineProps({
  filters: { type: Object, required: true },
  query: { type: String, default: '' },
})

const emit = defineEmits(['removeFilter', 'clearAll'])

function getCategoryLabel(id) {
  return allCategories.find((c) => c.id === id)?.label ?? id
}

const pills = computed(() => {
  const items = []

  if (props.filters.category?.length) {
    props.filters.category.forEach((id) => {
      items.push({ type: 'category', value: id, label: getCategoryLabel(id) })
    })
  }

  if (props.filters.model?.length) {
    props.filters.model.forEach((m) => {
      items.push({ type: 'model', value: m, label: m })
    })
  }

  if (props.filters.difficulty) {
    items.push({ type: 'difficulty', value: props.filters.difficulty, label: props.filters.difficulty })
  }

  if (props.filters.outputType?.length) {
    props.filters.outputType.forEach((t) => {
      items.push({ type: 'outputType', value: t, label: t })
    })
  }

  if (props.filters.technique?.length) {
    props.filters.technique.forEach((t) => {
      items.push({ type: 'technique', value: t, label: t })
    })
  }

  return items
})

const hasFilters = computed(() => pills.value.length > 0)
</script>

<template>
  <div v-if="hasFilters" class="flex items-center gap-3 flex-wrap mb-4">
    <TransitionGroup name="pill" tag="div" class="flex items-center gap-2 flex-wrap">
      <button
        v-for="pill in pills"
        :key="`${pill.type}-${pill.value}`"
        class="inline-flex items-center gap-1 py-1 pl-3 pr-2 bg-comfy-yellow/15 border border-comfy-yellow/30 rounded-full cursor-pointer transition-all duration-150 whitespace-nowrap hover:bg-comfy-yellow/25 hover:border-comfy-yellow/50 focus-visible:ring-2 focus-visible:ring-ring"
        @click="emit('removeFilter', pill.type, pill.value)"
        :aria-label="`Remove ${pill.label} filter`"
      >
        <span class="text-xs text-muted-foreground/70 capitalize">{{ pill.type }}:</span>
        <span class="text-xs font-medium text-comfy-yellow/80">{{ pill.label }}</span>
        <svg
          class="text-muted-foreground/70 shrink-0 transition-all duration-150 group-hover:text-foreground"
          width="14" height="14" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" stroke-width="2"
        >
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </TransitionGroup>

    <button
      class="text-xs text-muted-foreground/70 bg-transparent border-none cursor-pointer py-1 transition-all duration-150 whitespace-nowrap hover:text-destructive hover:underline"
      @click="emit('clearAll')"
    >
      Clear all
    </button>
  </div>
</template>

<style scoped>
/* Pill hover: make remove icon brighter */
button:hover svg {
  color: var(--foreground);
}

/* Transition animations for pills */
.pill-enter-active {
  transition: all 150ms;
}
.pill-leave-active {
  transition: all 150ms;
  position: absolute;
}
.pill-enter-from {
  opacity: 0;
  transform: scale(0.8);
}
.pill-leave-to {
  opacity: 0;
  transform: scale(0.8);
}
.pill-move {
  transition: transform 150ms;
}
</style>
