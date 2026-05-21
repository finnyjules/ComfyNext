<script setup>
import { formatDate } from '~/lib/community/formatters.js'

defineProps({
  versions: { type: Array, default: () => [] },
})
</script>

<template>
  <section v-if="versions.length" class="version-history">
    <h2 class="version-history__heading">Version History</h2>
    <div class="version-history__list">
      <div v-for="version in versions" :key="version.version" class="version-history__item">
        <div class="version-history__marker" />
        <div class="version-history__content">
          <div class="version-history__header">
            <span class="version-history__version">v{{ version.version }}</span>
            <span class="version-history__date">{{ formatDate(version.date) }}</span>
          </div>
          <p class="version-history__changelog">{{ version.changelog }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.version-history {
  &__heading {
    font-size: $text-xl;
    font-weight: $weight-bold;
    color: $color-text-primary;
    margin-bottom: $space-4;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: $space-4;
    padding-left: $space-4;
    border-left: 2px solid $color-border;
  }

  &__item {
    display: flex;
    align-items: flex-start;
    gap: $space-3;
    position: relative;
  }

  &__marker {
    position: absolute;
    left: calc(-#{$space-4} - 5px);
    top: $space-1;
    width: 8px;
    height: 8px;
    border-radius: $radius-full;
    background: $color-primary;
    border: 2px solid $color-bg-primary;
  }

  &__content {
    flex: 1;
  }

  &__header {
    display: flex;
    align-items: center;
    gap: $space-3;
    margin-bottom: $space-1;
  }

  &__version {
    font-size: $text-sm;
    font-weight: $weight-semibold;
    color: $color-text-primary;
  }

  &__date {
    font-size: $text-xs;
    color: $color-text-tertiary;
  }

  &__changelog {
    font-size: $text-sm;
    color: $color-text-secondary;
    line-height: $leading-normal;
  }
}
</style>
