<script setup lang="ts">
const props = defineProps<{
  widgetDef: { name: string; type: string; options?: string[]; min?: number; max?: number; step?: number; default?: any }
  modelValue: any
}>()
const emit = defineEmits<{ 'update:modelValue': [value: any] }>()

const isCombo = computed(() => Array.isArray(props.widgetDef.options) || props.widgetDef.type === 'COMBO')
const isNumber = computed(() => ['INT', 'FLOAT'].includes(props.widgetDef.type))
const isToggle = computed(() => props.widgetDef.type === 'BOOLEAN')
const isSeed = computed(() => props.widgetDef.name.toLowerCase().includes('seed'))
const isText = computed(() => props.widgetDef.type === 'STRING')
</script>
<template>
  <div class="px-2" data-slot="comfy-node-field">
    <label class="text-[9px] text-white/40 uppercase tracking-wide mb-0.5 block">{{ widgetDef.name }}</label>
    <VueCanvasWidgetsWidgetCombo v-if="isCombo" :options="widgetDef.options || []" :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" />
    <VueCanvasWidgetsWidgetSeed v-else-if="isSeed && isNumber" :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" />
    <VueCanvasWidgetsWidgetNumber v-else-if="isNumber" :model-value="modelValue" :min="widgetDef.min" :max="widgetDef.max" :step="widgetDef.step" :is-float="widgetDef.type === 'FLOAT'" @update:model-value="emit('update:modelValue', $event)" />
    <VueCanvasWidgetsWidgetToggle v-else-if="isToggle" :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)" />
    <VueCanvasWidgetsWidgetText v-else-if="isText" :model-value="modelValue" :multiline="widgetDef.name.toLowerCase().includes('text') || widgetDef.name.toLowerCase().includes('prompt')" @update:model-value="emit('update:modelValue', $event)" />
  </div>
</template>
