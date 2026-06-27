<script setup>
import { ref, computed } from 'vue'
import { useCommunityNav } from '~/composables/useCommunityNav'
import { getCreator, getCreatorWorkflows } from '~/data/community/creatorService.js'
import { formatNumber } from '~/lib/community/formatters.js'
import WorkflowGrid from '~/components/community/workflow/WorkflowGrid.vue'

const props = defineProps({
  handle: { type: String, required: true },
})

const { goBack: navBack } = useCommunityNav()

const creator = computed(() => getCreator(props.handle))

const bannerImage = computed(() =>
  creator.value?.bannerUrl || creator.value?.avatarUrl
)

// Sort tabs
const sort = ref('popular')
const sortTabs = [
  { id: 'popular', label: 'Popular' },
  { id: 'newest', label: 'Newest' },
  { id: 'runs', label: 'Most Runs' },
  { id: 'favorites', label: 'Most Favorites' },
]

// All templates with pagination
const ITEMS_PER_PAGE = 12
const page = ref(1)

const allTemplates = computed(() => {
  if (!creator.value) return { data: [], total: 0 }
  return getCreatorWorkflows(creator.value.id, {
    page: 1,
    limit: page.value * ITEMS_PER_PAGE,
    sort: sort.value,
  })
})

const canLoadMore = computed(() =>
  allTemplates.value.data.length < allTemplates.value.total
)

function loadMore() {
  page.value++
}

function setSort(id) {
  sort.value = id
  page.value = 1
}

function goBack() {
  navBack()
}
</script>

<template>
  <div v-if="creator" class="comfyhub">
    <div class="relative bg-background">
      <!-- Back button -->
      <div class="px-6 pt-4 pb-2">
        <UiButton
          variant="ghost"
          size="sm"
          class="gap-1 text-muted-foreground hover:text-foreground"
          @click="goBack"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </UiButton>
      </div>

      <!-- Full-width banner image -->
      <div class="relative w-full h-[280px] overflow-hidden">
        <img
          :src="bannerImage"
          alt=""
          class="w-full h-full object-cover"
          aria-hidden="true"
        />
        <div class="absolute bottom-0 left-0 right-0 h-1/3 banner-fade" />
      </div>

      <!-- Two-column layout below banner -->
      <div class="px-6 pb-10 grid grid-cols-[280px_1fr] gap-10 items-start">
        <!-- Left column: creator info -->
        <div class="-mt-16 relative z-[2]">
          <!-- Avatar -->
          <UiAvatar class="size-20 border-4 border-background mb-4">
            <UiAvatarImage :src="creator.avatarUrl" :alt="creator.displayName" />
            <UiAvatarFallback class="text-2xl">{{ creator.displayName?.charAt(0) }}</UiAvatarFallback>
          </UiAvatar>

          <!-- Name + badge -->
          <h1 class="text-xl font-semibold text-foreground leading-tight tracking-tight mb-0.5">
            {{ creator.displayName }}
            <span v-if="creator.badges?.includes('verified')" class="inline-block align-middle ml-1">💎</span>
          </h1>

          <!-- Handle -->
          <p class="text-sm text-muted-foreground mb-3">{{ creator.handle }}</p>

          <!-- Bio -->
          <p v-if="creator.bio" class="text-sm text-muted-foreground leading-relaxed mb-4">
            {{ creator.bio }}
          </p>

          <!-- Social link as text -->
          <a
            v-if="creator.socialLinks?.twitter"
            :href="creator.socialLinks.twitter"
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm text-muted-foreground/70 hover:text-foreground transition-colors no-underline block mb-6"
          >
            {{ creator.socialLinks.twitter.replace('https://', '') }}
          </a>

          <!-- Stats -->
          <div class="flex flex-col gap-1.5">
            <div class="flex items-baseline gap-3">
              <span class="text-sm text-muted-foreground/70 w-12">Views</span>
              <span class="text-sm font-bold text-foreground">{{ formatNumber(creator.stats.totalRuns) }}</span>
            </div>
            <div class="flex items-baseline gap-3">
              <span class="text-sm text-muted-foreground/70 w-12">Likes</span>
              <span class="text-sm font-bold text-foreground">{{ formatNumber(creator.stats.totalFavorites) }}</span>
            </div>
            <div class="flex items-baseline gap-3">
              <span class="text-sm text-muted-foreground/70 w-12">Runs</span>
              <span class="text-sm font-bold text-foreground">{{ formatNumber(creator.stats.totalRuns) }}</span>
            </div>
          </div>
        </div>

        <!-- Right column: templates -->
        <div class="pt-4">
          <!-- Header -->
          <div class="flex items-center gap-2 mb-4">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-muted-foreground">
              <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
            </svg>
            <span class="text-lg font-semibold text-foreground">Templates</span>
            <span class="text-sm text-muted-foreground/70">{{ allTemplates.total }}</span>
          </div>

          <!-- Sort tabs -->
          <div class="flex gap-1 mb-2 border-b border-border">
            <button
              v-for="tab in sortTabs"
              :key="tab.id"
              class="px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-all duration-150"
              :class="sort === tab.id
                ? 'text-foreground border-b-palette-yellow'
                : 'text-muted-foreground/70 border-b-transparent hover:text-muted-foreground'"
              @click="setSort(tab.id)"
            >
              {{ tab.label }}
            </button>
          </div>

          <!-- Count -->
          <p class="text-sm text-muted-foreground/70 mb-4">
            {{ allTemplates.total }} templates
          </p>

          <!-- Grid -->
          <WorkflowGrid
            :workflows="allTemplates.data"
            variant="gallery"
            columns="4"
          />

          <!-- Load more -->
          <div v-if="canLoadMore" class="mt-10 flex flex-col items-center gap-3">
            <UiButton variant="secondary" @click="loadMore">
              Load more templates
            </UiButton>
            <p class="m-0 text-xs text-muted-foreground/70">
              Showing {{ allTemplates.data.length }} of {{ allTemplates.total }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.banner-fade {
  background: linear-gradient(to bottom, transparent, var(--background));
}
</style>
