<script setup>
defineProps({
  workflow: { type: Object, required: true },
})
</script>

<template>
  <div class="quick-info">
    <div class="quick-info__item">
      <span class="quick-info__label">Category</span>
      <span class="quick-info__value">{{ workflow.categoryLabel }}</span>
    </div>
    <div class="quick-info__item">
      <span class="quick-info__label">Base Model</span>
      <span class="quick-info__value">{{ workflow.baseModel }}</span>
    </div>
    <div class="quick-info__item">
      <span class="quick-info__label">Difficulty</span>
      <span class="quick-info__value">{{ workflow.difficulty }}</span>
    </div>
    <div v-if="workflow.estimatedRunTime" class="quick-info__item">
      <span class="quick-info__label">Run Time</span>
      <span class="quick-info__value">~{{ workflow.estimatedRunTime }}s</span>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.quick-info {
  display: flex;
  flex-wrap: wrap;
  gap: $space-4;
  padding: $space-4;
  background: $color-bg-tertiary;
  border-radius: $radius-lg;

  &__item {
    display: flex;
    flex-direction: column;
    gap: $space-1;
  }

  &__label {
    font-size: $text-xs;
    color: $color-text-tertiary;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  &__value {
    font-size: $text-sm;
    font-weight: $weight-medium;
    color: $color-text-primary;
  }
}
</style>
