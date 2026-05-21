<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { getWorkflows, getByCategory, searchWorkflows, getFilterCounts } from '~/data/community/workflowService.js'
import { categories } from '~/data/community/mock/generators/categories.js'
import { baseModels } from '~/data/community/mock/generators/categories.js'
import { useScrollAnimation } from '~/composables/community/useScrollAnimation.js'
import WorkflowGrid from '~/components/community/workflow/WorkflowGrid.vue'
import AppSearchBar from '~/components/community/global/AppSearchBar.vue'
import BaseDropdown from '~/components/community/ui/BaseDropdown.vue'

// Category filter state (top pills)
const activeCategory = ref('all')
const categoryOptions = [
  { id: 'all', label: 'All' },
  ...categories.map((c) => ({ id: c.id, label: c.label })),
]

// Sort state
const activeSort = ref('featured')
const sortOptions = [
  { id: 'featured', label: 'Featured' },
  { id: 'popular', label: 'Popular' },
  { id: 'newest', label: 'Newest' },
]

// Dropdown filter state
const filters = ref({
  category: [],
  model: [],
  difficulty: null,
  outputType: [],
  technique: [],
})

// Dropdown options
const difficulties = ['Beginner', 'Intermediate', 'Advanced', 'Expert']

// Pagination state
const ITEMS_PER_PAGE = 24
const page = ref(1)
const allResults = ref([])
const total = ref(0)

// Filter counts for dropdowns
const filterCounts = computed(() => getFilterCounts(allResults.value))

const modelOptions = computed(() =>
  baseModels
    .map((m) => ({ id: m, label: m, count: filterCounts.value?.model?.[m] || 0 }))
    .filter((m) => m.count > 0)
)

const difficultyOptions = computed(() =>
  difficulties.map((d) => ({ id: d, label: d, count: filterCounts.value?.difficulty?.[d] || 0 }))
)

// Fetch data based on current filters
function fetchData() {
  try {
    let result

    // Check if sidebar filters are active
    const hasFilters =
      filters.value.category.length > 0 ||
      filters.value.model.length > 0 ||
      filters.value.difficulty ||
      filters.value.outputType.length > 0 ||
      filters.value.technique.length > 0

    if (hasFilters) {
      result = searchWorkflows('', filters.value, { page: 1, limit: 9999, sort: activeSort.value })
    } else if (activeCategory.value === 'all') {
      result = getWorkflows({ page: 1, limit: 9999, sort: activeSort.value })
    } else {
      result = getByCategory(activeCategory.value, { page: 1, limit: 9999, sort: activeSort.value })
    }
    allResults.value = result.data
    total.value = result.total
  } catch (err) {
    console.error('[GallerySection] fetchData failed:', err)
    allResults.value = []
    total.value = 0
  }
}

// Displayed workflows (paginated slice)
const displayedWorkflows = computed(() => {
  return allResults.value.slice(0, page.value * ITEMS_PER_PAGE)
})

const canLoadMore = computed(() => {
  return displayedWorkflows.value.length < total.value
})

function loadMore() {
  page.value++
}

// Watch category and sort changes
watch([activeCategory, activeSort], () => {
  page.value = 1
  fetchData()
})

// Watch dropdown filter changes
watch(filters, () => {
  page.value = 1
  fetchData()
}, { deep: true })

// Scroll animation
const sectionRef = ref(null)
const { flipInChildren } = useScrollAnimation()

onMounted(() => {
  fetchData()

  // Cards 3D flip-in
  if (sectionRef.value) {
    flipInChildren(sectionRef.value, '.workflow-card')
  }
})
</script>

<template>
  <section ref="sectionRef" class="bg-background py-16 md:py-10">
    <div class="mx-auto max-w-7xl px-4">
      <!-- Sticky toolbar: search + filters + sort -->
      <div class="gallery-section__toolbar sticky top-0 z-50 pt-4 pb-4 -mt-4">
        <!-- Search bar -- full width, centered -->
        <div class="relative z-[100] mx-auto mb-6 w-full max-w-[640px] md:max-w-full">
          <AppSearchBar :placeholder="`Search ${total} templates...`" />
        </div>

        <!-- Dropdown filters -->
        <div class="flex items-center justify-end gap-3">
          <BaseDropdown label="Category" :options="categoryOptions" v-model="activeCategory" />
          <BaseDropdown label="Sort" :options="sortOptions" v-model="activeSort" />
          <BaseDropdown label="Models" :options="modelOptions" v-model="filters.model" multiple />
          <BaseDropdown label="Difficulty" :options="difficultyOptions" v-model="filters.difficulty" />
        </div>
      </div>

      <!-- Grid -- full container width -->
      <div>
        <WorkflowGrid
          :workflows="displayedWorkflows"
          variant="gallery"
          columns="3"
        />

        <!-- Load more -->
        <div v-if="canLoadMore" class="mt-10 flex flex-col items-center gap-3">
          <UiButton variant="secondary" @click="loadMore">
            Load more templates
          </UiButton>
          <p class="m-0 text-xs text-muted-foreground/70">
            Showing {{ displayedWorkflows.length }} of {{ total }}
          </p>
        </div>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
/* Sticky toolbar pseudo-elements for background coverage and fade */
.gallery-section__toolbar {
  &::before {
    content: '';
    position: absolute;
    top: -4rem;
    left: 50%;
    transform: translateX(-50%);
    width: 100vw;
    height: calc(100% + 4rem);
    background: var(--background);
    z-index: -1;
    pointer-events: none;
  }

  &::after {
    content: '';
    position: absolute;
    bottom: -16px;
    left: 50%;
    transform: translateX(-50%);
    width: 100vw;
    height: 16px;
    background: linear-gradient(to bottom, var(--background), transparent);
    pointer-events: none;
  }
}

/* Grid gap override */
:deep(.workflow-grid) {
  gap: 2rem;
  perspective: 1000px;
}
</style>
