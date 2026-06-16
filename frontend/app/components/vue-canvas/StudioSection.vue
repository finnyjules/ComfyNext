<script setup lang="ts">
// Shared collapsible section for the studio editors' controls column. Title on the
// left, optional badge (prop or #badge slot) on the right, body in the default slot.
import { ref } from 'vue'

const props = withDefaults(defineProps<{ title: string; badge?: string; open?: boolean }>(), { open: true })
const isOpen = ref(props.open)
</script>

<template>
  <details :open="isOpen" @toggle="isOpen = ($event.target as HTMLDetailsElement).open" class="rounded-lg bg-white/5">
    <summary class="flex cursor-pointer select-none items-center justify-between gap-2 px-3 py-2 text-xs font-medium text-white/80">
      <span>{{ title }}</span>
      <slot name="badge">
        <span v-if="badge" class="text-[10px] uppercase tracking-wide text-white/30">{{ badge }}</span>
      </slot>
    </summary>
    <div class="space-y-2 px-3 pb-3">
      <slot />
    </div>
  </details>
</template>
