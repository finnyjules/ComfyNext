<script setup lang="ts">
import { computed } from 'vue'

export interface MenuItem {
  label: string
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  action: () => void
}

const props = defineProps<{ x: number; y: number; items: (MenuItem | 'sep')[] }>()
const emit = defineEmits<{ close: [] }>()

// Keep the menu on-screen (rough clamp; menu is ~200px wide, ~32px/row).
const pos = computed(() => ({
  left: Math.min(props.x, window.innerWidth - 210) + 'px',
  top: Math.min(props.y, window.innerHeight - props.items.length * 32 - 16) + 'px',
}))

function run(item: MenuItem) {
  if (item.disabled) return
  item.action()
  emit('close')
}
</script>

<template>
  <div class="fixed inset-0 z-[130]" @pointerdown.self="emit('close')" @contextmenu.prevent="emit('close')">
    <div
      class="absolute min-w-[190px] bg-[#161616] border border-white/10 rounded-lg shadow-2xl py-1 text-xs select-none"
      :style="pos"
    >
      <template v-for="(item, i) in items" :key="i">
        <div v-if="item === 'sep'" class="my-1 h-px bg-white/10" />
        <button
          v-else
          class="w-full flex items-center gap-3 px-3 py-1.5 text-left transition-colors"
          :class="[
            item.disabled ? 'opacity-30 cursor-default' : 'hover:bg-white/10',
            item.danger ? 'text-red-300' : 'text-white/85',
          ]"
          @click="run(item)"
        >
          <span class="flex-1">{{ item.label }}</span>
          <span v-if="item.shortcut" class="text-white/30 tabular-nums">{{ item.shortcut }}</span>
        </button>
      </template>
    </div>
  </div>
</template>
