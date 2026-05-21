<script setup>
defineProps({
  hover: { type: Boolean, default: true },
  padding: { type: Boolean, default: true },
})
</script>

<template>
  <div
    class="bg-card rounded-xl border border-border transition-all"
    :class="{
      'hover:-translate-y-1 hover:shadow-lg': hover,
      'p-6': padding,
    }"
  >
    <slot />
  </div>
</template>
