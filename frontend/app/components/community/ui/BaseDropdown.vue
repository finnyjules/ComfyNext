<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  options: { type: Array, required: true }, // [{ id, label, count? }]
  modelValue: { type: [Array, String, null], default: null },
  multiple: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue'])

const isOpen = ref(false)
const dropdownRef = ref(null)

// Count of selected items for badge
const selectedCount = computed(() => {
  if (props.multiple && Array.isArray(props.modelValue)) {
    return props.modelValue.length
  }
  return props.modelValue ? 1 : 0
})

// Display label for single-select: show selected option's label instead of count
const displayLabel = computed(() => {
  if (!props.multiple && props.modelValue) {
    const selected = props.options.find(o => o.id === props.modelValue)
    if (selected) return selected.label
  }
  return props.label
})

function toggle() {
  isOpen.value = !isOpen.value
}

function handleSelect(optionId) {
  if (props.multiple) {
    const current = Array.isArray(props.modelValue) ? [...props.modelValue] : []
    const idx = current.indexOf(optionId)
    if (idx >= 0) {
      current.splice(idx, 1)
    } else {
      current.push(optionId)
    }
    emit('update:modelValue', current)
  } else {
    // Single select — toggle off if same value
    const newVal = props.modelValue === optionId ? null : optionId
    emit('update:modelValue', newVal)
    isOpen.value = false
  }
}

function isSelected(optionId) {
  if (props.multiple && Array.isArray(props.modelValue)) {
    return props.modelValue.includes(optionId)
  }
  return props.modelValue === optionId
}

function clear() {
  if (props.multiple) {
    emit('update:modelValue', [])
  } else {
    emit('update:modelValue', null)
  }
}

// Close on outside click
function handleClickOutside(e) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target)) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})
</script>

<template>
  <div ref="dropdownRef" class="relative">
    <!-- Trigger button -->
    <button
      class="inline-flex items-center gap-2 px-3 py-1 text-sm font-medium whitespace-nowrap border rounded-full cursor-pointer transition-all duration-150"
      :class="isOpen
        ? 'text-foreground border-ring bg-accent'
        : 'text-muted-foreground bg-transparent border-border hover:text-foreground hover:border-ring'"
      @click="toggle"
    >
      <span class="leading-[1.4]">{{ displayLabel }}</span>
      <span
        v-if="multiple && selectedCount > 0"
        class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-[5px] text-[11px] font-bold text-background bg-palette-yellow rounded-full leading-none"
      >{{ selectedCount }}</span>
      <svg
        class="shrink-0 transition-all duration-150"
        :class="{ 'rotate-180': isOpen }"
        width="12" height="12" viewBox="0 0 12 12" fill="none"
      >
        <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <!-- Dropdown panel -->
    <Transition name="dropdown-fade">
      <div
        v-if="isOpen"
        class="absolute top-[calc(100%+0.5rem)] right-0 min-w-[220px] max-h-[320px] flex flex-col backdrop-blur-md bg-background/80 border border-border rounded-lg shadow-xl z-[100] overflow-hidden"
      >
        <div v-if="selectedCount > 0" class="px-3 py-2 border-b border-border flex justify-end">
          <button class="text-xs text-muted-foreground/70 bg-transparent border-none cursor-pointer p-0 hover:text-foreground" @click="clear">Clear all</button>
        </div>
        <ul class="list-none m-0 py-1 overflow-y-auto dropdown-scrollbar">
          <li
            v-for="opt in options"
            :key="opt.id"
            class="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-all duration-150 hover:bg-white/5 hover:text-foreground"
            :class="isSelected(opt.id) ? 'text-foreground' : 'text-muted-foreground'"
            @click="handleSelect(opt.id)"
          >
            <span
              class="inline-flex items-center justify-center w-4 h-4 shrink-0 border rounded-sm transition-all duration-150"
              :class="isSelected(opt.id)
                ? 'border-palette-yellow bg-palette-yellow/10 text-palette-yellow'
                : 'border-border text-palette-yellow'"
            >
              <svg v-if="isSelected(opt.id)" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7L6 10L11 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span class="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ opt.label }}</span>
            <span v-if="opt.count != null" class="text-xs text-muted-foreground/70 shrink-0">{{ opt.count }}</span>
          </li>
        </ul>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.dropdown-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}
.dropdown-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.dropdown-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.dropdown-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
}

.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.dropdown-fade-enter-from,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
