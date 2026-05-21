<script setup>
defineProps({
  isStaffPick: { type: Boolean, default: false },
  isFeatured: { type: Boolean, default: false },
  categoryLabel: { type: String, default: '' },
})
</script>

<template>
  <div class="workflow-badges">
    <span v-if="isStaffPick" class="workflow-badges__pill workflow-badges__pill--rank">
      <strong>#1</strong> Today
    </span>
    <span v-if="isFeatured" class="workflow-badges__pill workflow-badges__pill--featured">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
      </svg>
      Featured
    </span>
    <span v-if="categoryLabel" class="workflow-badges__pill">
      {{ categoryLabel }}
    </span>
  </div>
</template>

<style lang="scss" scoped>
.workflow-badges {
  display: flex;
  align-items: center;
  gap: $space-2;
  flex-wrap: wrap;

  &__pill {
    display: inline-flex;
    align-items: center;
    gap: $space-2;
    padding: $space-1 $space-2;
    border-radius: $radius-full;
    font-size: $text-xs;
    font-weight: $weight-bold;
    color: $color-text-primary;
    background: rgba(38, 39, 41, 0.2);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    white-space: nowrap;
    line-height: 1;

    &--rank {
      strong {
        font-weight: $weight-bold;
      }
    }

    &--featured {
      color: $color-brand-yellow;

      svg {
        flex-shrink: 0;
      }
    }
  }
}
</style>
