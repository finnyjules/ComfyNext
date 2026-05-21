<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from 'vue'
import { getAutocomplete } from '~/data/community/workflowService.js'

const props = defineProps({
  query: { type: String, default: '' },
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'close'])

import { useCommunityNav } from '~/composables/useCommunityNav'

const { navigateTo } = useCommunityNav()

const results = ref(null)
const activeIndex = ref(-1)
let debounceTimer = null

// Flat list of all navigable items for keyboard nav
const flatItems = computed(() => {
  if (!results.value) return []
  const items = []

  if (results.value.workflows?.length) {
    results.value.workflows.forEach((w) => {
      items.push({ type: 'workflow', data: w, href: `/workflow/${w.slug}` })
    })
  }
  if (results.value.categories?.length) {
    results.value.categories.forEach((c) => {
      items.push({ type: 'category', data: c, href: `/workflows/${c.id}` })
    })
  }
  if (results.value.tags?.length) {
    results.value.tags.forEach((t) => {
      items.push({ type: 'tag', data: t, href: `/search?q=${encodeURIComponent(t)}` })
    })
  }
  if (results.value.creators?.length) {
    results.value.creators.forEach((c) => {
      items.push({ type: 'creator', data: c, href: `/creators/${c.handle.replace('@', '')}` })
    })
  }
  if (results.value.models?.length) {
    results.value.models.forEach((m) => {
      items.push({ type: 'model', data: m, href: `/search?q=${encodeURIComponent(m)}` })
    })
  }

  return items
})

const hasResults = computed(() => flatItems.value.length > 0)

watch(() => props.query, (newQuery) => {
  clearTimeout(debounceTimer)
  if (!newQuery || newQuery.length < 2) {
    results.value = null
    activeIndex.value = -1
    return
  }
  debounceTimer = setTimeout(() => {
    results.value = getAutocomplete(newQuery)
    activeIndex.value = -1
  }, 200)
})

function handleKeydown(e) {
  if (!props.visible || !hasResults.value) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, flatItems.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, -1)
  } else if (e.key === 'Enter' && activeIndex.value >= 0) {
    e.preventDefault()
    selectItem(flatItems.value[activeIndex.value])
  } else if (e.key === 'Escape') {
    emit('close')
  }
}

function selectItem(item) {
  emit('select', item)
  if (item.type === 'workflow') {
    navigateTo({ view: 'workflow', slug: item.data.slug, label: item.data.title })
  } else if (item.type === 'creator') {
    navigateTo({ view: 'creator', handle: item.data.handle.replace('@', ''), label: item.data.displayName })
  }
}

function getItemIndex(type, idx) {
  // Calculate flat index for a given group item
  let offset = 0
  const order = ['workflow', 'category', 'tag', 'creator', 'model']
  const groups = {
    workflow: results.value?.workflows || [],
    category: results.value?.categories || [],
    tag: results.value?.tags || [],
    creator: results.value?.creators || [],
    model: results.value?.models || [],
  }
  for (const key of order) {
    if (key === type) return offset + idx
    offset += groups[key].length
  }
  return -1
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  clearTimeout(debounceTimer)
})

defineExpose({ handleKeydown })
</script>

<template>
  <div
    v-if="visible && hasResults"
    class="autocomplete-dropdown absolute top-[calc(100%+0.25rem)] left-0 right-0 bg-muted border border-border rounded-lg shadow-xl z-[100] max-h-[420px] overflow-y-auto"
    role="listbox"
    aria-label="Search suggestions"
  >
    <!-- Workflows -->
    <div v-if="results.workflows?.length" class="py-2 border-b border-border last:border-b-0">
      <div class="px-4 py-1 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Templates</div>
      <a
        v-for="(w, i) in results.workflows"
        :key="`w-${w.id}`"
        :href="`/workflow/${w.slug}`"
        class="flex items-center gap-3 px-4 py-2 cursor-pointer no-underline transition-all duration-150"
        :class="activeIndex === getItemIndex('workflow', i) ? 'bg-accent' : 'hover:bg-accent'"
        role="option"
        :aria-selected="activeIndex === getItemIndex('workflow', i)"
        @mouseenter="activeIndex = getItemIndex('workflow', i)"
        @click.prevent="selectItem({ type: 'workflow', data: w, href: `/workflow/${w.slug}` })"
      >
        <img
          v-if="w.thumbnailUrl"
          :src="w.thumbnailUrl"
          :alt="w.title"
          class="w-10 h-[30px] object-cover rounded-sm shrink-0"
        />
        <div class="flex flex-col gap-px min-w-0">
          <span class="text-sm text-foreground truncate">{{ w.title }}</span>
          <span class="text-xs text-muted-foreground/70">by {{ w.creator }}</span>
        </div>
      </a>
    </div>

    <!-- Categories -->
    <div v-if="results.categories?.length" class="py-2 border-b border-border last:border-b-0">
      <div class="px-4 py-1 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Categories</div>
      <a
        v-for="(c, i) in results.categories"
        :key="`c-${c.id}`"
        :href="`/workflows/${c.id}`"
        class="flex items-center gap-3 px-4 py-2 cursor-pointer no-underline transition-all duration-150"
        :class="activeIndex === getItemIndex('category', i) ? 'bg-accent' : 'hover:bg-accent'"
        role="option"
        :aria-selected="activeIndex === getItemIndex('category', i)"
        @mouseenter="activeIndex = getItemIndex('category', i)"
        @click.prevent="selectItem({ type: 'category', data: c, href: `/workflows/${c.id}` })"
      >
        <svg class="shrink-0 text-muted-foreground/70" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
        </svg>
        <span class="text-sm text-foreground truncate">{{ c.label }}</span>
      </a>
    </div>

    <!-- Tags -->
    <div v-if="results.tags?.length" class="py-2 border-b border-border last:border-b-0">
      <div class="px-4 py-1 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Tags</div>
      <a
        v-for="(tag, i) in results.tags"
        :key="`t-${tag}`"
        :href="`/search?q=${encodeURIComponent(tag)}`"
        class="flex items-center gap-3 px-4 py-2 cursor-pointer no-underline transition-all duration-150"
        :class="activeIndex === getItemIndex('tag', i) ? 'bg-accent' : 'hover:bg-accent'"
        role="option"
        :aria-selected="activeIndex === getItemIndex('tag', i)"
        @mouseenter="activeIndex = getItemIndex('tag', i)"
        @click.prevent="selectItem({ type: 'tag', data: tag, href: `/search?q=${encodeURIComponent(tag)}` })"
      >
        <svg class="shrink-0 text-muted-foreground/70" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
        <span class="text-sm text-foreground truncate">{{ tag }}</span>
      </a>
    </div>

    <!-- Creators -->
    <div v-if="results.creators?.length" class="py-2 border-b border-border last:border-b-0">
      <div class="px-4 py-1 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Creators</div>
      <a
        v-for="(creator, i) in results.creators"
        :key="`cr-${creator.id}`"
        href="#"
        class="flex items-center gap-3 px-4 py-2 cursor-pointer no-underline transition-all duration-150"
        :class="activeIndex === getItemIndex('creator', i) ? 'bg-accent' : 'hover:bg-accent'"
        role="option"
        :aria-selected="activeIndex === getItemIndex('creator', i)"
        @mouseenter="activeIndex = getItemIndex('creator', i)"
        @click.prevent="selectItem({ type: 'creator', data: creator })"
      >
        <img
          v-if="creator.avatarUrl"
          :src="creator.avatarUrl"
          :alt="creator.displayName"
          class="w-7 h-7 rounded-full object-cover shrink-0"
        />
        <div class="flex flex-col gap-px min-w-0">
          <span class="text-sm text-foreground truncate">{{ creator.displayName }}</span>
          <span class="text-xs text-muted-foreground/70">@{{ creator.handle }}</span>
        </div>
      </a>
    </div>

    <!-- Models -->
    <div v-if="results.models?.length" class="py-2 border-b border-border last:border-b-0">
      <div class="px-4 py-1 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Models</div>
      <a
        v-for="(model, i) in results.models"
        :key="`m-${model}`"
        :href="`/search?q=${encodeURIComponent(model)}`"
        class="flex items-center gap-3 px-4 py-2 cursor-pointer no-underline transition-all duration-150"
        :class="activeIndex === getItemIndex('model', i) ? 'bg-accent' : 'hover:bg-accent'"
        role="option"
        :aria-selected="activeIndex === getItemIndex('model', i)"
        @mouseenter="activeIndex = getItemIndex('model', i)"
        @click.prevent="selectItem({ type: 'model', data: model, href: `/search?q=${encodeURIComponent(model)}` })"
      >
        <svg class="shrink-0 text-muted-foreground/70" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        </svg>
        <span class="text-sm text-foreground truncate">{{ model }}</span>
      </a>
    </div>
  </div>
</template>

<style scoped>
/* custom-scrollbar */
.autocomplete-dropdown {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.autocomplete-dropdown::-webkit-scrollbar {
  width: 6px;
}
.autocomplete-dropdown::-webkit-scrollbar-track {
  background: transparent;
}
.autocomplete-dropdown::-webkit-scrollbar-thumb {
  background-color: var(--border);
  border-radius: 3px;
}
</style>
