<script setup>
import { ref, reactive, watch, onMounted, nextTick, computed } from 'vue'
import { useDebounce } from '~/composables/community/useDebounce.js'
import { useScrollAnimation } from '~/composables/community/useScrollAnimation.js'
import { useBreakpoint } from '~/composables/community/useBreakpoint.js'
import { searchWorkflows, getFilterCounts } from '~/data/community/workflowService.js'
import { categories, baseModels } from '~/data/community/mock/generators/categories.js'

import SearchResultsHeader from './SearchResultsHeader.vue'
import SearchFilterSidebar from './SearchFilterSidebar.vue'
import SearchActiveFilters from './SearchActiveFilters.vue'
import WorkflowGrid from '~/components/community/workflow/WorkflowGrid.vue'
import WorkflowCard from '~/components/community/workflow/WorkflowCard.vue'

const props = defineProps({
  initialCategory: { type: String, default: '' },
  categoryLabel: { type: String, default: '' },
})

// Breakpoint
const { isMobile } = useBreakpoint()

// Search state
const query = ref('')
const filters = ref({
  category: [],
  model: [],
  difficulty: null,
  outputType: [],
  technique: [],
})
const sort = ref('relevance')
const viewMode = ref('grid')
const page = ref(1)

// Results state
const results = ref([])
const total = ref(0)
const totalPages = ref(0)
const filterCounts = ref({})
const isLoading = ref(false)
const isLoadingMore = ref(false)

// Mobile filter panel
const showMobileFilters = ref(false)

// Animation
const containerRef = ref(null)
const { revealOnScroll } = useScrollAnimation()

// Debounced query for watchers
const debouncedQuery = useDebounce(query, 300)

// Read URL params on mount
function readUrlParams() {
  if (typeof window === 'undefined') return

  const params = new URLSearchParams(window.location.search)

  if (params.has('q')) query.value = params.get('q')
  if (params.has('sort')) sort.value = params.get('sort')
  if (params.has('view')) viewMode.value = params.get('view')

  if (params.has('category')) {
    filters.value.category = params.get('category').split(',').filter(Boolean)
  }
  if (params.has('model')) {
    filters.value.model = params.get('model').split(',').filter(Boolean)
  }
  if (params.has('difficulty')) {
    filters.value.difficulty = params.get('difficulty')
  }
}

// Update URL to reflect current state
function updateUrl() {
  if (typeof window === 'undefined') return

  const params = new URLSearchParams()

  if (query.value) params.set('q', query.value)
  if (filters.value.category.length) params.set('category', filters.value.category.join(','))
  if (filters.value.model.length) params.set('model', filters.value.model.join(','))
  if (filters.value.difficulty) params.set('difficulty', filters.value.difficulty)
  if (filters.value.outputType?.length) params.set('outputType', filters.value.outputType.join(','))
  if (sort.value !== 'relevance') params.set('sort', sort.value)
  if (viewMode.value !== 'grid') params.set('view', viewMode.value)

  const qs = params.toString()
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  window.history.replaceState({}, '', url)
}

// Perform search
async function performSearch(append = false) {
  if (!append) {
    isLoading.value = true
  } else {
    isLoadingMore.value = true
  }

  try {
    const result = searchWorkflows(query.value, filters.value, {
      page: page.value,
      limit: 24,
      sort: sort.value,
    })

    if (append) {
      results.value = [...results.value, ...result.data]
    } else {
      results.value = result.data
    }

    total.value = result.total
    totalPages.value = result.totalPages
    filterCounts.value = getFilterCounts()
  } finally {
    isLoading.value = false
    isLoadingMore.value = false
  }
}

// Load more
function loadMore() {
  if (page.value < totalPages.value) {
    page.value++
    performSearch(true)
  }
}

// Handle filter updates from sidebar
function handleFiltersUpdate(newFilters) {
  filters.value = { ...newFilters }
}

// Handle removing a single filter from active filters
function handleRemoveFilter(type, value) {
  const updated = { ...filters.value }
  if (type === 'difficulty') {
    updated.difficulty = null
  } else if (Array.isArray(updated[type])) {
    updated[type] = updated[type].filter((v) => v !== value)
  }
  filters.value = updated
}

// Handle clear all filters
function handleClearAll() {
  filters.value = {
    category: [],
    model: [],
    difficulty: null,
    outputType: [],
    technique: [],
  }
}

// Can load more
const canLoadMore = computed(() => page.value < totalPages.value)

// Page title
const pageTitle = computed(() => {
  if (props.categoryLabel) return props.categoryLabel
  if (query.value) return `Search: ${query.value}`
  return 'Browse Workflows'
})

// Watch for changes to trigger new search (debounced query)
watch(debouncedQuery, () => {
  page.value = 1
  performSearch()
  updateUrl()
})

// Watch filters deep
watch(
  () => filters.value,
  () => {
    page.value = 1
    performSearch()
    updateUrl()
  },
  { deep: true }
)

// Watch sort
watch(sort, () => {
  page.value = 1
  performSearch()
  updateUrl()
})

// Watch view mode
watch(viewMode, () => {
  updateUrl()
})

// Mount
onMounted(() => {
  readUrlParams()

  // If initialCategory prop provided, pre-set it
  if (props.initialCategory && !filters.value.category.includes(props.initialCategory)) {
    filters.value.category = [props.initialCategory]
  }

  performSearch()

  nextTick(() => {
    if (containerRef.value) {
      revealOnScroll(containerRef.value, { y: 20 })
    }
  })
})
</script>

<template>
  <section ref="containerRef" class="min-h-[60vh] py-16 md:py-20">
    <div class="mx-auto max-w-7xl px-4">
      <!-- Page header -->
      <div class="mb-8">
        <h1 class="text-xl font-semibold text-foreground mb-2">{{ pageTitle }}</h1>
        <p v-if="categoryLabel" class="text-lg md:text-base text-muted-foreground">
          Browse {{ categoryLabel }} workflows from the community
        </p>
      </div>

      <!-- Mobile filter toggle -->
      <UiButton
        v-if="isMobile"
        variant="outline"
        size="sm"
        class="mb-4 gap-2"
        @click="showMobileFilters = !showMobileFilters"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
        <span>Filters</span>
        <span
          v-if="filters.category.length || filters.model.length || filters.difficulty || filters.outputType.length"
          class="inline-flex items-center justify-center min-w-[20px] h-5 px-1 bg-comfy-yellow text-white text-xs font-semibold rounded-full"
        >
          {{ filters.category.length + filters.model.length + (filters.difficulty ? 1 : 0) + filters.outputType.length }}
        </span>
      </UiButton>

      <div class="flex gap-8 items-start lg:flex-row flex-col">
        <!-- Sidebar -->
        <div
          class="shrink-0 lg:relative lg:opacity-100 lg:pointer-events-auto fixed inset-0 z-[300] pointer-events-none opacity-0 transition-all duration-250"
          :class="{ 'pointer-events-auto opacity-100': showMobileFilters }"
        >
          <!-- Mobile overlay backdrop -->
          <div
            v-if="isMobile && showMobileFilters"
            class="absolute inset-0 bg-black/60"
            @click="showMobileFilters = false"
          />
          <div
            class="relative lg:static lg:w-auto lg:max-w-none lg:h-auto lg:bg-transparent lg:border-0 lg:p-0 lg:overflow-visible lg:translate-x-0 absolute top-0 left-0 w-80 max-w-[85vw] h-full bg-background border-r border-border p-6 overflow-y-auto -translate-x-full transition-transform duration-250"
            :class="{ 'translate-x-0': showMobileFilters }"
          >
            <div v-if="isMobile" class="flex items-center justify-between mb-4 pb-4 border-b border-border">
              <h3 class="text-lg font-semibold text-foreground">Filters</h3>
              <button
                class="flex p-1 text-muted-foreground/70 hover:text-foreground rounded-sm transition-all duration-150"
                aria-label="Close filters"
                @click="showMobileFilters = false"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <SearchFilterSidebar
              :filters="filters"
              :filter-counts="filterCounts"
              :categories="categories"
              :base-models="baseModels"
              @update:filters="handleFiltersUpdate"
            />
          </div>
        </div>

        <!-- Main content -->
        <div class="flex-1 min-w-0">
          <!-- Results header -->
          <SearchResultsHeader
            :total="total"
            :query="query"
            :sort="sort"
            :view-mode="viewMode"
            @update:sort="sort = $event"
            @update:view-mode="viewMode = $event"
          />

          <!-- Active filters -->
          <SearchActiveFilters
            :filters="filters"
            :query="query"
            @remove-filter="handleRemoveFilter"
            @clear-all="handleClearAll"
          />

          <!-- Loading state -->
          <div v-if="isLoading" class="flex flex-col items-center justify-center gap-4 py-20 text-muted-foreground/70 text-sm">
            <div class="search-island-spinner w-9 h-9 border-3 border-border border-t-comfy-yellow rounded-full animate-spin" />
            <p>Searching workflows...</p>
          </div>

          <!-- Empty state -->
          <div v-else-if="results.length === 0" class="flex flex-col items-center justify-center text-center py-20 px-6">
            <svg class="text-muted-foreground/70 mb-4 opacity-50" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <h3 class="text-xl font-semibold text-foreground mb-2">No workflows found</h3>
            <p class="text-sm text-muted-foreground/70 max-w-[400px] mb-6">
              Try adjusting your search or filters to find what you're looking for.
            </p>
            <UiButton variant="outline" @click="handleClearAll(); query = ''">
              Clear all filters
            </UiButton>
          </div>

          <!-- Results: Grid view -->
          <WorkflowGrid
            v-else-if="viewMode === 'grid'"
            :workflows="results"
            variant="compact"
          />

          <!-- Results: List view -->
          <div v-else class="flex flex-col gap-4">
            <WorkflowCard
              v-for="workflow in results"
              :key="workflow.id"
              :workflow="workflow"
              variant="expanded"
            />
          </div>

          <!-- Load more -->
          <div v-if="canLoadMore && !isLoading" class="flex flex-col items-center gap-3 pt-10">
            <UiButton
              variant="outline"
              size="lg"
              class="min-w-[200px] hover:border-comfy-yellow hover:bg-comfy-yellow/10 hover:shadow-[0_0_15px_rgba(240,255,65,0.15)]"
              :disabled="isLoadingMore"
              @click="loadMore"
            >
              <span v-if="isLoadingMore" class="search-island-spinner w-[18px] h-[18px] border-2 border-border border-t-comfy-yellow rounded-full animate-spin" />
              <span v-else>Load more workflows</span>
            </UiButton>
            <p class="text-xs text-muted-foreground/70">
              Showing {{ results.length }} of {{ total }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.search-island-spinner {
  border-width: 3px;
}
.search-island-spinner.w-\[18px\] {
  border-width: 2px;
}

/* custom-scrollbar kept for sidebar inner */
.overflow-y-auto {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.overflow-y-auto::-webkit-scrollbar {
  width: 6px;
}
.overflow-y-auto::-webkit-scrollbar-track {
  background: transparent;
}
.overflow-y-auto::-webkit-scrollbar-thumb {
  background-color: var(--border);
  border-radius: 3px;
}
</style>
