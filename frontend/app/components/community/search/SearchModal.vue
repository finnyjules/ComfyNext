<script setup>
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useStore } from '@nanostores/vue'
import { $searchModalOpen } from '~/composables/community/ui.js'
import { getWorkflows, getByCategory } from '~/data/community/workflowService.js'
import { categories } from '~/data/community/mock/generators/categories.js'
import WorkflowGrid from '~/components/community/workflow/WorkflowGrid.vue'
import AppSearchBar from './AppSearchBar.vue'
import BaseTabGroup from '~/components/community/ui/BaseTabGroup.vue'

const isOpen = useStore($searchModalOpen)
const modalRef = ref(null)

// Category filter state
const activeCategory = ref('all')
const allCategories = [
  { id: 'all', label: 'All' },
  ...categories.map((c) => ({ id: c.id, label: c.label })),
]

// Sort state
const activeSort = ref('popular')
const sortTabs = [
  { id: 'popular', label: 'Popular' },
  { id: 'trending', label: 'Trending' },
  { id: 'newest', label: 'Newest' },
]

// Pagination
const ITEMS_PER_PAGE = 24
const page = ref(1)
const allResults = ref([])
const total = ref(0)

function fetchData() {
  try {
    let result
    if (activeCategory.value === 'all') {
      result = getWorkflows({ page: 1, limit: 9999, sort: activeSort.value })
    } else {
      result = getByCategory(activeCategory.value, { page: 1, limit: 9999, sort: activeSort.value })
    }
    allResults.value = result.data
    total.value = result.total
  } catch (err) {
    console.error('[SearchModal] fetchData failed:', err)
    allResults.value = []
    total.value = 0
  }
}

const displayedWorkflows = computed(() => {
  return allResults.value.slice(0, page.value * ITEMS_PER_PAGE)
})

const canLoadMore = computed(() => {
  return displayedWorkflows.value.length < total.value
})

function loadMore() {
  page.value++
}

function setCategory(catId) {
  activeCategory.value = catId
  page.value = 1
  fetchData()
}

watch(activeSort, () => {
  page.value = 1
  fetchData()
})

// Close modal
function close() {
  $searchModalOpen.set(false)
}

// Lock body scroll and focus search input when opening
watch(isOpen, (open) => {
  if (open) {
    document.body.style.overflow = 'hidden'
    // Fetch data if not loaded yet
    if (allResults.value.length === 0) {
      fetchData()
    }
    // Focus search input after render
    nextTick(() => {
      const input = modalRef.value?.querySelector('.search-bar__input')
      if (input) input.focus()
    })
  } else {
    document.body.style.overflow = ''
  }
})

// Escape key to close
function handleKeydown(e) {
  if (e.key === 'Escape' && isOpen.value) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="isOpen" ref="modalRef" class="fixed inset-0 z-[400] flex flex-col" role="dialog" aria-modal="true" aria-label="Search templates">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/60" @click="close" />

        <!-- Content -->
        <div class="search-modal-content relative flex flex-col w-full h-full bg-background overflow-hidden">
          <!-- Header with close button -->
          <div class="flex justify-end items-center px-6 py-3 shrink-0 border-b border-border">
            <UiButton variant="outline" size="sm" class="gap-2" aria-label="Close search" @click="close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              <kbd class="text-xs text-muted-foreground/70 pointer-events-none">ESC</kbd>
            </UiButton>
          </div>

          <!-- Search + filters + grid (scrollable area) -->
          <div class="search-modal-body flex-1 overflow-y-auto pt-8 pb-20">
            <!-- Search bar -->
            <div class="max-w-[640px] md:max-w-full w-full mx-auto mb-6 px-6">
              <AppSearchBar :placeholder="`Search ${total} templates...`" />
            </div>

            <!-- Category pills -->
            <div class="search-modal-filters flex flex-wrap justify-center gap-2 mb-8 px-6 md:overflow-x-auto md:flex-nowrap md:justify-start md:pb-1">
              <button
                v-for="cat in allCategories"
                :key="cat.id"
                class="inline-flex items-center px-4 py-2 text-sm font-medium border rounded-full whitespace-nowrap cursor-pointer transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring"
                :class="activeCategory === cat.id
                  ? 'bg-foreground border-foreground text-background hover:bg-white hover:border-white hover:text-background'
                  : 'text-muted-foreground bg-transparent border-border hover:text-foreground hover:border-foreground/30'"
                @click="setCategory(cat.id)"
              >
                {{ cat.label }}
              </button>
            </div>

            <!-- Sort tabs -->
            <div class="px-6 mb-6 mx-auto max-w-7xl">
              <BaseTabGroup :tabs="sortTabs" v-model="activeSort" />
            </div>

            <!-- Grid -->
            <WorkflowGrid
              :workflows="displayedWorkflows"
              variant="gallery"
              columns="3"
            />

            <!-- Load more -->
            <div v-if="canLoadMore" class="flex flex-col items-center gap-3 mt-10">
              <UiButton variant="outline" @click="loadMore">
                Load more workflows
              </UiButton>
              <p class="text-xs text-muted-foreground/70 m-0">
                Showing {{ displayedWorkflows.length }} of {{ total }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* custom-scrollbar for body */
.search-modal-body {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
.search-modal-body::-webkit-scrollbar {
  width: 6px;
}
.search-modal-body::-webkit-scrollbar-track {
  background: transparent;
}
.search-modal-body::-webkit-scrollbar-thumb {
  background-color: var(--border);
  border-radius: 3px;
}

/* custom-scrollbar for mobile category pills */
@media (max-width: 768px) {
  .search-modal-filters {
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }
  .search-modal-filters::-webkit-scrollbar {
    height: 4px;
  }
  .search-modal-filters::-webkit-scrollbar-track {
    background: transparent;
  }
  .search-modal-filters::-webkit-scrollbar-thumb {
    background-color: var(--border);
    border-radius: 2px;
  }
}

/* Transition */
.modal-enter-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active .search-modal-content {
  transition: transform 0.2s ease;
}
.modal-leave-active {
  transition: opacity 0.15s ease;
}
.modal-leave-active .search-modal-content {
  transition: transform 0.15s ease;
}
.modal-enter-from {
  opacity: 0;
}
.modal-enter-from .search-modal-content {
  transform: translateY(-8px);
}
.modal-leave-to {
  opacity: 0;
}
.modal-leave-to .search-modal-content {
  transform: translateY(-8px);
}
</style>
