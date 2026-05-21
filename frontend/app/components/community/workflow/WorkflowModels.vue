<script setup>
import { computed } from 'vue'
import { getPartnerIcon } from '~/lib/community/partnerIcons.js'

const props = defineProps({
  baseModel: { type: String, default: '' },
  dependencies: { type: Array, default: () => [] },
})

// Filter to only model-type dependencies (checkpoints, loras)
const models = props.dependencies
  .filter((d) => ['checkpoint', 'lora', 'controlnet'].includes(d.type))

// Icons per type
const typeIcons = {
  checkpoint: '🎯',
  lora: '✦',
  controlnet: '🎛',
}

// Partner logo for the base model (or null → fallback emoji)
const baseModelIcon = computed(() => getPartnerIcon(props.baseModel))
</script>

<template>
  <div v-if="baseModel || models.length" class="workflow-models">
    <span class="workflow-models__label">Models used</span>
    <div class="workflow-models__list">
      <div v-if="baseModel" class="workflow-models__item">
        <img v-if="baseModelIcon" :src="baseModelIcon" :alt="baseModel" class="workflow-models__partner-icon" />
        <span v-else class="workflow-models__icon">🎯</span>
        <span class="workflow-models__name">{{ baseModel }}</span>
      </div>
      <div v-for="model in models" :key="model.name" class="workflow-models__item">
        <span class="workflow-models__icon">{{ typeIcons[model.type] || '✦' }}</span>
        <span class="workflow-models__name">{{ model.name }}</span>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.workflow-models {
  display: flex;
  flex-direction: column;
  gap: $space-2;

  &__label {
    font-size: 11px;
    color: $color-text-primary;
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: $space-2;
  }

  &__item {
    display: flex;
    align-items: center;
    gap: $space-2;
  }

  &__icon {
    font-size: $text-sm;
    flex-shrink: 0;
  }

  &__partner-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
    border-radius: 4px;
  }

  &__name {
    font-size: $text-sm;
    font-weight: $weight-bold;
    color: $color-text-primary;
  }
}
</style>
