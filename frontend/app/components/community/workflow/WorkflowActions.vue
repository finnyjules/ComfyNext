<script setup>
import { computed } from 'vue'
import { useStore } from '@nanostores/vue'
import { $favoriteIds, toggleFavorite } from '~/composables/community/auth.js'
import { formatNumber } from '~/lib/community/formatters.js'

const props = defineProps({
  workflowId: { type: String, required: true },
  stats: { type: Object, default: () => ({ runs: 0, favorites: 0, forks: 0 }) },
})

const favoriteIds = useStore($favoriteIds)
const isFavorited = computed(() => favoriteIds.value.has(props.workflowId))
</script>

<template>
  <div class="workflow-actions">
    <!-- Run in Comfy Cloud -->
    <button class="workflow-actions__btn workflow-actions__btn--run">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
        <polygon points="6,3 20,12 6,21" />
      </svg>
      Run in Comfy Cloud
    </button>

    <!-- Download .json -->
    <button class="workflow-actions__btn workflow-actions__btn--download">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
        <line x1="14.5" y1="4" x2="9.5" y2="20" />
      </svg>
      Download .json
    </button>

    <!-- Favorite -->
    <button
      class="workflow-actions__btn workflow-actions__btn--fav"
      :class="{ 'workflow-actions__btn--favorited': isFavorited }"
      :aria-label="isFavorited ? 'Remove from favorites' : 'Add to favorites'"
      @click="toggleFavorite(workflowId)"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" :fill="isFavorited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
      <span class="workflow-actions__count">{{ formatNumber(stats.favorites) }}</span>
    </button>
  </div>
</template>

<style lang="scss" scoped>
.workflow-actions {
  display: flex;
  align-items: center;
  gap: $space-3;
  flex-wrap: wrap;

  &__btn {
    display: inline-flex;
    align-items: center;
    gap: $space-2;
    padding: $space-2 $space-3;
    font-size: $text-base;
    font-weight: $weight-medium;
    border-radius: $radius-md;
    transition: all $transition-fast;
    cursor: pointer;
    white-space: nowrap;
    border: none;

    &--run {
      background: #0b8ce9;
      color: white;

      &:hover {
        background: darken(#0b8ce9, 8%);
      }
    }

    &--download {
      background: #262729;
      color: white;

      &:hover {
        background: lighten(#262729, 6%);
      }
    }

    &--fav {
      background: #262729;
      color: $color-text-tertiary;

      &:hover {
        color: $color-error;
      }
    }

    &--favorited {
      color: $color-error;
    }
  }

  &__count {
    font-size: $text-xs;
    font-weight: $weight-normal;
    opacity: 0.8;
    padding: $space-1 $space-2;
    border-radius: $radius-full;
  }
}
</style>
