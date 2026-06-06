<script setup>
import { ref, computed } from 'vue'
import { useStore } from '@nanostores/vue'
import { $favoriteIds, toggleFavorite } from '~/composables/community/auth.js'
import { formatNumber } from '~/lib/community/formatters.js'
import BeforeAfterSlider from '~/components/community/ui/BeforeAfterSlider.vue'
import { useCommunityNav } from '~/composables/useCommunityNav'

const props = defineProps({
  workflow: { type: Object, required: true },
  variant: { type: String, default: 'compact' }, // compact, expanded, featured, gallery
})

const { navigateTo } = useCommunityNav()

const favoriteIds = useStore($favoriteIds)
const isFavorited = computed(() => favoriteIds.value.has(props.workflow.id))
const isHovered = ref(false)

const creatorInitial = computed(() =>
  props.workflow.creator?.displayName?.charAt(0)?.toUpperCase() ?? '?'
)

function handleFavorite(e) {
  e.preventDefault()
  e.stopPropagation()
  toggleFavorite(props.workflow.id)
}

function handleCardClick(e) {
  e.preventDefault()
  navigateTo({ view: 'workflow', slug: props.workflow.slug, label: props.workflow.title })
}
</script>

<template>
  <article
    class="group flex flex-col bg-card rounded-xl border border-white/5 shadow-lg shadow-black/20 transition-all duration-250 hover:border-white/15 overflow-hidden"
    :class="{
      'flex-row': variant === 'expanded',
      'bg-transparent border-0 rounded-xl hover:border-transparent': variant === 'gallery',
    }"
    @mouseenter="isHovered = true"
    @mouseleave="isHovered = false"
  >
    <a
      href="#"
      class="flex flex-col h-full"
      :class="{ 'gap-0': variant === 'gallery' }"
      @click="handleCardClick"
    >
      <!-- Thumbnail -->
      <div
        class="relative overflow-hidden flex-shrink-0"
        :class="{
          'aspect-square': variant !== 'featured' && variant !== 'expanded',
          'aspect-video': variant === 'featured',
          'w-[200px] min-h-[150px]': variant === 'expanded',
          'rounded-lg': variant === 'gallery',
        }"
      >
        <BeforeAfterSlider
          v-if="workflow.hasBeforeAfter && workflow.outputImages?.length >= 2"
          :beforeImage="workflow.outputImages[1].url"
          :afterImage="workflow.outputImages[0].url"
          class="w-full h-full object-cover transition-transform duration-[400ms] ease-in-out"
          :class="[
            variant === 'gallery' ? 'group-hover:scale-[1.03]' : 'group-hover:scale-105',
          ]"
        />
        <video
          v-else-if="workflow.previewVideoUrl"
          :src="workflow.previewVideoUrl"
          :poster="workflow.thumbnailUrl"
          autoplay
          muted
          loop
          playsinline
          preload="metadata"
          class="w-full h-full object-cover transition-transform duration-[400ms] ease-in-out"
          :class="[
            variant === 'gallery' ? 'group-hover:scale-[1.03]' : 'group-hover:scale-105',
          ]"
        />
        <img
          v-else
          :src="workflow.thumbnailUrl"
          :alt="workflow.title"
          class="w-full h-full object-cover transition-transform duration-[400ms] ease-in-out"
          :class="[
            variant === 'gallery' ? 'group-hover:scale-[1.03]' : 'group-hover:scale-105',
          ]"
          loading="lazy"
        />
        <div
          v-if="variant !== 'gallery'"
          class="absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity duration-250"
          :class="isHovered ? 'opacity-100' : 'opacity-0'"
        >
          <span class="inline-flex items-center gap-1 px-6 py-2 bg-comfy-yellow text-black font-semibold text-sm rounded-md">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            Run
          </span>
        </div>
        <UiBadge
          v-if="workflow.isNew && variant !== 'gallery'"
          variant="secondary"
          class="absolute top-2 left-2"
        >
          New
        </UiBadge>
        <UiBadge
          v-else-if="workflow.isUpdated && variant !== 'gallery'"
          variant="secondary"
          class="absolute top-2 left-2"
        >
          Updated
        </UiBadge>
        <UiBadge
          v-if="workflow.isStaffPick && variant !== 'gallery'"
          variant="outline"
          class="absolute top-2 right-2"
        >
          Staff Pick
        </UiBadge>
      </div>

      <!-- Info -->
      <div
        class="flex flex-col flex-1"
        :class="{
          'p-4 gap-2': variant !== 'gallery' && variant !== 'featured',
          'p-5 gap-2': variant === 'featured' || variant === 'expanded',
          'pt-3 px-0 pb-0 gap-1': variant === 'gallery',
        }"
      >
        <div v-if="variant !== 'gallery'" class="flex items-center justify-between gap-2">
          <span class="inline-flex px-2 py-px text-[10px] font-medium text-muted-foreground bg-accent rounded-full">
            {{ workflow.categoryLabel }}
          </span>
          <span v-if="variant !== 'compact'" class="text-xs text-muted-foreground/70">
            {{ workflow.difficulty }}
          </span>
        </div>

        <h3
          class="text-sm font-semibold text-foreground"
          :class="{
            'line-clamp-2': variant !== 'gallery',
            'line-clamp-1': variant === 'gallery',
            'text-base': variant === 'expanded',
            'text-lg': variant === 'featured',
          }"
        >
          {{ workflow.title }}
        </h3>

        <p
          v-if="variant === 'expanded' || variant === 'featured'"
          class="text-sm text-muted-foreground/70 line-clamp-2"
        >
          {{ workflow.shortDescription }}
        </p>

        <!-- Creator -->
        <div
          class="flex items-center gap-2"
          :class="{ 'mt-auto': variant !== 'gallery' }"
        >
          <UiAvatar class="size-6">
            <UiAvatarImage :src="workflow.creator.avatarUrl" :alt="workflow.creator.displayName" />
            <UiAvatarFallback>{{ creatorInitial }}</UiAvatarFallback>
          </UiAvatar>
          <span
            class="text-xs"
            :class="variant === 'gallery' ? 'text-muted-foreground/70' : 'text-muted-foreground'"
          >
            {{ workflow.creator.displayName }}
          </span>
        </div>

        <!-- Gallery tags as pills -->
        <div v-if="variant === 'gallery' && workflow.tags?.length" class="flex gap-1 flex-wrap">
          <span
            v-for="tag in workflow.tags.slice(0, 3)"
            :key="tag"
            class="text-[10px] px-2 py-px bg-accent text-muted-foreground rounded-full"
          >
            {{ tag }}
          </span>
        </div>

        <!-- Stats -->
        <div v-if="variant !== 'gallery'" class="flex items-center gap-4 pt-2 border-t border-border">
          <span class="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            {{ formatNumber(workflow.stats.runs) }}
          </span>
          <button
            class="inline-flex items-center gap-1 text-xs text-muted-foreground/70 cursor-pointer transition-colors duration-150 hover:text-destructive"
            :class="{ 'text-destructive': isFavorited }"
            @click="handleFavorite"
            :aria-label="isFavorited ? 'Remove from favorites' : 'Add to favorites'"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" :fill="isFavorited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            {{ formatNumber(workflow.stats.favorites) }}
          </button>
          <span v-if="variant !== 'compact'" class="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
            {{ formatNumber(workflow.stats.forks) }}
          </span>
        </div>

        <!-- Tags (featured only, not gallery) -->
        <div v-if="variant === 'featured'" class="flex gap-1 flex-wrap mt-1">
          <span
            v-for="tag in workflow.tags.slice(0, 3)"
            :key="tag"
            class="text-[10px] px-2 py-px bg-accent text-muted-foreground/70 rounded-sm"
          >
            {{ tag }}
          </span>
        </div>
      </div>
    </a>
  </article>
</template>

<style scoped>
/* Before/after slider fills the thumbnail container */
:deep(.before-after) {
  aspect-ratio: unset;
  position: absolute;
  inset: 0;
}
</style>
