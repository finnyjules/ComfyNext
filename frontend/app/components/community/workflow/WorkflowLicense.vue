<script setup>
const props = defineProps({
  license: { type: String, default: 'MIT' },
})

const licenseInfo = {
  'MIT': { name: 'MIT License', description: 'This template is open-source, which means others can make copies and distribute it as they see fit', cc: false },
  'Apache-2.0': { name: 'Apache License 2.0', description: 'This template is open-source with patent protection for contributors', cc: false },
  'CC-BY-4.0': { name: 'Creative Commons Attribution', description: 'This template is open-source, which means others can make copies and distribute it with attribution', cc: true },
  'CC-BY-SA-4.0': { name: 'Creative Commons Attribution ShareAlike', description: 'This template is open-source, derivatives must use the same license', cc: true },
  'CC-BY-NC-4.0': { name: 'Creative Commons NonCommercial', description: 'This template is open-source for non-commercial use only', cc: true },
  'GPL-3.0': { name: 'GPL 3.0', description: 'This template is open-source, derivatives must also be open-source', cc: false },
}

const info = licenseInfo[props.license] || { name: props.license, description: 'This template is open-source, which means others can make copies and distribute it as they see fit', cc: true }
</script>

<template>
  <div class="workflow-license">
    <div class="workflow-license__icons">
      <!-- CC icon -->
      <svg class="workflow-license__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
        <text x="12" y="16" text-anchor="middle" font-size="12" font-weight="bold" fill="currentColor">CC</text>
      </svg>
      <!-- Zero / BY icon -->
      <svg class="workflow-license__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
        <text x="12" y="16" text-anchor="middle" font-size="10" font-weight="bold" fill="currentColor">0</text>
      </svg>
    </div>
    <span class="workflow-license__name">{{ info.name }}</span>
    <p class="workflow-license__description">{{ info.description }}</p>
  </div>
</template>

<style lang="scss" scoped>
.workflow-license {
  display: flex;
  flex-direction: column;
  gap: $space-2;

  &__icons {
    display: flex;
    gap: $space-2;
  }

  &__icon {
    color: $color-text-primary;
    flex-shrink: 0;
  }

  &__name {
    font-size: $text-sm;
    font-weight: $weight-bold;
    color: $color-text-primary;
  }

  &__description {
    font-size: $text-xs;
    color: $color-text-primary;
    line-height: $leading-normal;
  }
}
</style>
