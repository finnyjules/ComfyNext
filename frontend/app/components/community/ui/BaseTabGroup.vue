<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  tabs: { type: Array, required: true }, // [{ id, label, count? }]
  modelValue: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const activeTab = ref(props.modelValue || props.tabs[0]?.id)

watch(() => props.modelValue, (val) => {
  if (val) activeTab.value = val
})

function selectTab(id) {
  activeTab.value = id
  emit('update:modelValue', id)
}
</script>

<template>
  <div class="flex gap-1 border-b border-border overflow-x-auto tab-scrollbar" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      role="tab"
      :aria-selected="activeTab === tab.id"
      class="px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-all duration-150 focus-visible:ring-2 focus-visible:ring-ring"
      :class="activeTab === tab.id
        ? 'text-palette-yellow border-b-palette-yellow'
        : 'text-muted-foreground/70 border-b-transparent hover:text-muted-foreground'"
      @click="selectTab(tab.id)"
    >
      {{ tab.label }}
      <span v-if="tab.count !== undefined" class="ml-1 text-xs text-muted-foreground/70">{{ tab.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.tab-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}
.tab-scrollbar::-webkit-scrollbar {
  height: 4px;
}
.tab-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.tab-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
}
</style>
