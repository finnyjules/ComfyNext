<script setup lang="ts">
import type { Component } from 'vue'

export interface MenuItem {
  id?: string
  label?: string
  icon?: Component
  action?: () => void
  disabled?: boolean
  danger?: boolean
  divider?: boolean
  // When set, item shows a small color swatch instead of icon
  swatch?: string
  // Optional submenu items (one level deep)
  children?: MenuItem[]
  // Optional shortcut hint shown on the right
  shortcut?: string
}

const props = defineProps<{
  x: number
  y: number
  items: MenuItem[]
}>()

const emit = defineEmits<{
  close: []
}>()

const rootRef = ref<HTMLDivElement | null>(null)
const submenuOpenIndex = ref<number | null>(null)

// Keep the menu inside the viewport. Measured after mount to avoid SSR mismatches.
const adjustedPos = ref({ x: props.x, y: props.y })
onMounted(() => {
  nextTick(() => {
    const el = rootRef.value
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let nx = props.x
    let ny = props.y
    if (nx + rect.width + 8 > vw) nx = Math.max(8, vw - rect.width - 8)
    if (ny + rect.height + 8 > vh) ny = Math.max(8, vh - rect.height - 8)
    adjustedPos.value = { x: nx, y: ny }
  })
})

function onItemClick(item: MenuItem) {
  if (item.disabled || item.divider) return
  if (item.children?.length) return // submenu, handled on hover
  item.action?.()
  emit('close')
}

function onBackdropClick(e: MouseEvent) {
  // Only close when clicking outside the menu (and any open submenu)
  const target = e.target as Node
  if (rootRef.value?.contains(target)) return
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  // mousedown (not click) so we close before any nested click handler fires
  window.addEventListener('mousedown', onBackdropClick, true)
  // Closing on wheel/scroll matches OS conventions and avoids the menu floating
  // away from its anchor point when the canvas pans.
  window.addEventListener('wheel', () => emit('close'), { capture: true, once: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.removeEventListener('mousedown', onBackdropClick, true)
})

function openSubmenu(index: number, item: MenuItem) {
  if (!item.children?.length || item.disabled) {
    submenuOpenIndex.value = null
    return
  }
  submenuOpenIndex.value = index
}
</script>

<template>
  <Teleport to="body">
    <div
      ref="rootRef"
      class="fixed z-[200] min-w-[200px] py-1 bg-[#1a1a1a]/97 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl text-[13px] text-white/90 select-none"
      :style="{ left: `${adjustedPos.x}px`, top: `${adjustedPos.y}px` }"
      role="menu"
      @contextmenu.prevent
    >
      <template v-for="(item, idx) in items" :key="item.id ?? idx">
        <div
          v-if="item.divider"
          class="my-1 mx-2 h-px bg-white/10"
        />
        <button
          v-else
          type="button"
          :disabled="item.disabled"
          class="relative w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
          :class="[
            item.disabled
              ? 'opacity-40 cursor-not-allowed'
              : item.danger
                ? 'hover:bg-rose-500/15 text-rose-300'
                : 'hover:bg-white/8',
          ]"
          @mouseenter="openSubmenu(idx, item)"
          @click="onItemClick(item)"
        >
          <span class="flex items-center justify-center w-4 h-4 shrink-0">
            <span
              v-if="item.swatch"
              class="w-3 h-3 rounded-full border border-white/20"
              :style="{ backgroundColor: item.swatch }"
            />
            <component v-else-if="item.icon" :is="item.icon" class="w-3.5 h-3.5 text-white/60" />
          </span>
          <span class="flex-1 truncate">{{ item.label }}</span>
          <span v-if="item.shortcut" class="text-[11px] text-white/40 ml-3">{{ item.shortcut }}</span>
          <span v-if="item.children?.length" class="text-white/40 ml-1">›</span>

          <!-- Submenu (one level deep) -->
          <div
            v-if="item.children?.length && submenuOpenIndex === idx"
            class="absolute top-0 left-full ml-1 min-w-[160px] py-1 bg-[#1a1a1a]/97 backdrop-blur-md border border-white/10 rounded-lg shadow-2xl"
          >
            <button
              v-for="(sub, sIdx) in item.children"
              :key="sub.id ?? sIdx"
              type="button"
              :disabled="sub.disabled"
              class="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-white/8 transition-colors"
              :class="{ 'opacity-40 cursor-not-allowed': sub.disabled }"
              @click.stop="onItemClick(sub)"
            >
              <span class="flex items-center justify-center w-4 h-4 shrink-0">
                <span
                  v-if="sub.swatch"
                  class="w-3 h-3 rounded-full border border-white/20"
                  :style="{ backgroundColor: sub.swatch }"
                />
                <component v-else-if="sub.icon" :is="sub.icon" class="w-3.5 h-3.5 text-white/60" />
              </span>
              <span class="flex-1 truncate">{{ sub.label }}</span>
            </button>
          </div>
        </button>
      </template>
    </div>
  </Teleport>
</template>
