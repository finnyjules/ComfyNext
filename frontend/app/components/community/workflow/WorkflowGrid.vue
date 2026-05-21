<script setup>
import WorkflowCard from './WorkflowCard.vue'

defineProps({
  workflows: { type: Array, required: true },
  variant: { type: String, default: 'compact' },
  columns: { type: String, default: 'auto' }, // auto, 2, 3, 4
})
</script>

<template>
  <div
    class="workflow-grid"
    :class="[columns !== 'auto' ? `workflow-grid--${columns}col` : '']"
  >
    <WorkflowCard
      v-for="workflow in workflows"
      :key="workflow.id"
      :workflow="workflow"
      :variant="variant"
    />
  </div>
</template>

<style lang="scss" scoped>
.workflow-grid {
  @include workflow-grid;

  &--2col {
    grid-template-columns: repeat(2, 1fr);

    @include respond-below('md') {
      grid-template-columns: 1fr;
    }
  }

  &--3col {
    grid-template-columns: repeat(3, 1fr);

    @include respond-below('lg') {
      grid-template-columns: repeat(2, 1fr);
    }

    @include respond-below('sm') {
      grid-template-columns: 1fr;
    }
  }

  &--4col {
    grid-template-columns: repeat(4, 1fr);

    @include respond-below('xl') {
      grid-template-columns: repeat(3, 1fr);
    }

    @include respond-below('lg') {
      grid-template-columns: repeat(2, 1fr);
    }

    @include respond-below('sm') {
      grid-template-columns: 1fr;
    }
  }
}
</style>
