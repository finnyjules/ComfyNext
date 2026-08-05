<script setup lang="ts">
// Prop-driven entry point for a select row. Same one-render-path reasoning as
// StudioSlider. Public props unchanged for the 23 existing call sites (v-model plus
// `options`); `label` and `bound` are additions for callers that want the row to
// draw its own label rather than a separate one above it.
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import StudioRow from './StudioRow.vue'

const model = defineModel<string>({ required: true })
const props = defineProps<{ options: string[]; label?: string; bound?: string | null }>()

const spec = computed(() => ({
  key: 'inline', label: props.label ?? '', kind: 'select',
  options: props.options, default: props.options[0] ?? '', group: '',
} as ControlSpec))
</script>

<template>
  <!-- `:bindable="false"` on purpose. StudioRow shows the variable glyph by default
       and `select` is a bindable kind, so without this every one of the 23 prop-driven
       selects would grow a hexagon whose click emits `promote` into a component that
       declares no such emit — a visible affordance that does nothing. Schema-driven
       selects reach StudioRow through StudioControlPanel, which does wire promotion. -->
  <StudioRow
    :spec="spec" :model-value="model" :bound="bound ?? null" :bindable="false"
    @update:model-value="(v) => (model = String(v))"
  />
</template>
