<script setup>
defineProps({
  label: { type: String, required: true },
  href: { type: String, default: null },
  variant: { type: String, default: 'default' }, // default, primary, success, warning
  removable: { type: Boolean, default: false },
})

defineEmits(['remove'])
</script>

<template>
  <component
    :is="href ? 'a' : 'span'"
    :href="href"
    class="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full whitespace-nowrap transition-all duration-150"
    :class="{
      'bg-accent text-muted-foreground border border-border hover:text-foreground hover:border-ring': variant === 'default',
      'bg-palette-yellow/15 text-palette-yellow border border-palette-yellow/30': variant === 'primary',
      'bg-green-500/15 text-green-500 border border-green-500/30': variant === 'success',
      'bg-orange-500/15 text-orange-500 border border-orange-500/30': variant === 'warning',
    }"
  >
    <span>{{ label }}</span>
    <button
      v-if="removable"
      class="flex text-inherit opacity-60 rounded-full p-px hover:opacity-100"
      aria-label="Remove tag"
      @click.prevent.stop="$emit('remove')"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  </component>
</template>
