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
// `bindable` defaults OFF: most colour rows are plain values. Turn it on for a colour that
// can be promoted to a Collection variable (the fillList swatches) — StudioRow then shows
// the variable glyph and the pink bound row, and this forwards promote/menu/goToCollection
// up to the surface's var-menu wiring. This is what FillSwatch used to hand-roll.
const props = withDefaults(
  defineProps<{ label?: string; hint?: string; bound?: string | null; bindable?: boolean }>(),
  { bindable: false },
)
const emit = defineEmits<{
  (e: 'goToCollection'): void
  (e: 'promote'): void
  (e: 'menu', ev: MouseEvent): void
}>()

const spec = computed(() => ({
  key: 'inline', label: props.label ?? '', kind: 'color', default: '#000000', group: '',
  ...(props.hint ? { hint: props.hint } : {}),
} as ControlSpec))
</script>

<template>
  <StudioColor v-if="!label" v-model="model" />
  <!-- `bindable` off by default: a plain colour row must NOT grow a variable glyph whose
       click emits `promote` into a parent that declares no such handler. Pass `:bindable`
       true only where the parent wires promote/menu (the fillList swatches). -->
  <StudioRow
    v-else
    :spec="spec"
    :model-value="model"
    :bound="bound ?? null"
    :bindable="bindable"
    @update:model-value="(v) => (model = String(v))"
    @promote="emit('promote')"
    @menu="(e: MouseEvent) => emit('menu', e)"
    @go-to-collection="emit('goToCollection')"
  />
</template>
