<script setup lang="ts">
// Shared toggle switch (white when on). Replaces the studios' enable checkboxes.
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <button type="button" role="switch" :aria-checked="model" @click.stop="model = !model"
          class="relative h-[16px] w-[28px] rounded-full transition-colors"
          :class="model ? 'bg-white' : 'bg-white/15'">
    <span class="absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all"
          :class="model ? 'left-[14px] bg-neutral-900' : 'left-[2px] bg-white/70'"></span>
  </button>
</template>
