<script setup>
defineProps({
  dependencies: { type: Object, default: () => ({ models: [], customNodes: [] }) },
})
</script>

<template>
  <section class="workflow-deps">
    <h2 class="workflow-deps__heading">Dependencies</h2>
    <div v-if="dependencies.models?.length" class="workflow-deps__group">
      <h3 class="workflow-deps__subheading">Required Models</h3>
      <div class="workflow-deps__list">
        <div v-for="model in dependencies.models" :key="model.name" class="workflow-deps__item">
          <span class="workflow-deps__status workflow-deps__status--installed" />
          <span class="workflow-deps__name">{{ model.name }}</span>
          <span v-if="model.size" class="workflow-deps__size">{{ model.size }}</span>
        </div>
      </div>
    </div>
    <div v-if="dependencies.customNodes?.length" class="workflow-deps__group">
      <h3 class="workflow-deps__subheading">Custom Nodes</h3>
      <div class="workflow-deps__list">
        <div v-for="node in dependencies.customNodes" :key="node" class="workflow-deps__item">
          <span class="workflow-deps__status workflow-deps__status--installed" />
          <span class="workflow-deps__name">{{ node }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style lang="scss" scoped>
.workflow-deps {
  &__heading {
    font-size: $text-xl;
    font-weight: $weight-bold;
    color: $color-text-primary;
    margin-bottom: $space-4;
  }

  &__group {
    margin-bottom: $space-6;
  }

  &__subheading {
    font-size: $text-sm;
    font-weight: $weight-semibold;
    color: $color-text-secondary;
    margin-bottom: $space-3;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: $space-2;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: $space-3;
    padding: $space-3 $space-4;
    background: $color-bg-tertiary;
    border-radius: $radius-md;
  }

  &__status {
    width: 8px;
    height: 8px;
    border-radius: $radius-full;
    flex-shrink: 0;

    &--installed {
      background: $color-success;
    }
  }

  &__name {
    font-size: $text-sm;
    color: $color-text-primary;
    font-weight: $weight-medium;
  }

  &__size {
    margin-left: auto;
    font-size: $text-xs;
    color: $color-text-tertiary;
  }
}
</style>
