<script setup lang="ts">
// Small pill shown beside a studio control's label once it's bound to a
// Collection column. Click opens the same variable menu a right-click on
// the control would (promote/bind/unbind) — the surface owns the menu,
// this component only renders the affordance and forwards the click.
defineProps<{ columnKey: string | null }>()

const emit = defineEmits<{ (e: 'menu', event: MouseEvent): void }>()
</script>

<template>
  <span
    v-if="columnKey"
    class="inline-block max-w-[80px] cursor-pointer truncate rounded-full bg-white/10 px-1.5 py-0 text-[10px] text-white/70 hover:bg-white/20"
    :title="columnKey"
    @click.stop="emit('menu', $event)"
  >{{ columnKey }}</span>
</template>
