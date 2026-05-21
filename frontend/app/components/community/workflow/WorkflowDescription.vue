<script setup>
defineProps({
  shortDescription: { type: String, default: '' },
  description: { type: String, default: '' },
})
</script>

<template>
  <div class="workflow-desc">
    <p class="workflow-desc__text">{{ shortDescription || description }}</p>
  </div>
</template>

<style lang="scss" scoped>
.workflow-desc {
  &__text {
    font-size: $text-sm;
    color: $color-text-primary;
    line-height: $leading-normal;
    @include line-clamp(3);
  }
}
</style>
