<script setup lang="ts">
// Prop-driven entry point for a colour row — the sibling StudioSlider, StudioSelect and
// StudioSwitch already had, and the reason `<label>Color</label>` + `<StudioColor>` pairs
// were still scattered through the studios: there was no labelled colour row to reach for.
//
// WITH a `label` this is a 28px StudioRow like every other control: label left, hex and
// swatch right. WITHOUT one it is the bare StudioColor swatch it always was, for the call
// sites that sit inside their own layout (a gradient stop strip, a palette grid).
//
// StudioColor itself is untouched — the popover, its saturation pad, hue, alpha,
// eyedropper and hex/RGB/OKLCH entry are all reused as the row's value renderer.
import { computed } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import StudioRow from './StudioRow.vue'
import StudioColor from './StudioColor.vue'

const model = defineModel<string>({ required: true })
const props = defineProps<{ label?: string; hint?: string; bound?: string | null }>()
const emit = defineEmits<{ (e: 'goToCollection'): void }>()

const spec = computed(() => ({
  key: 'inline', label: props.label ?? '', kind: 'color', default: '#000000', group: '',
  ...(props.hint ? { hint: props.hint } : {}),
} as ControlSpec))
</script>

<template>
  <StudioColor v-if="!label" v-model="model" />
  <!-- `:bindable="false"` for the same reason StudioSelect sets it: StudioRow shows the
       variable glyph by default and `color` is a bindable kind, so a labelled prop-driven
       colour would otherwise grow a hexagon whose click emits `promote` into a component
       that declares no such emit. Schema-driven colours reach StudioRow through
       StudioControlPanel, which does wire promotion. -->
  <StudioRow
    v-else
    :spec="spec"
    :model-value="model"
    :bound="bound ?? null"
    :bindable="false"
    @update:model-value="(v) => (model = String(v))"
    @go-to-collection="emit('goToCollection')"
  />
</template>
