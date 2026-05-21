<script setup>
import { formatNumber } from '~/lib/community/formatters.js'

defineProps({
  stats: { type: Object, required: true },
})
</script>

<template>
  <div class="workflow-stats">
    <div class="workflow-stats__item">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
      <span>{{ formatNumber(stats.runs) }} runs</span>
    </div>
    <div class="workflow-stats__item">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      <span>{{ formatNumber(stats.favorites) }} favorites</span>
    </div>
    <div class="workflow-stats__item">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17L17 7M17 7H7M17 7V17"/></svg>
      <span>{{ formatNumber(stats.forks) }} forks</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.workflow-stats {
  display: flex;
  align-items: center;
  gap: $space-5;
  margin-bottom: $space-4;

  &__item {
    display: flex;
    align-items: center;
    gap: $space-2;
    font-size: $text-sm;
    color: $color-text-tertiary;
  }
}
</style>
