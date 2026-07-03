<script setup lang="ts">
// Wraps ONE inline-markup studio control (Gradient/Shader/Texture Studio — surfaces
// that write straight into a nested reactive `config` rather than looping over a
// ControlSpec[] like Space Type). One line per control: `<BindableRow>` around the
// existing label+input markup, right-click (or the trailing chip) opens the same
// promote/bind/unbind menu Space Type gets via BindableControlChip.
//
// Gradient's controls are raw `<label class="flex justify-between">…</label>` +
// `<input>` pairs, not a single component that owns its own label row (like
// SpaceType's StudioSlider) — so there's no single flex row to inject the chip
// into without editing every label. Instead the chip renders on its own thin row
// ABOVE the slotted control, right-aligned and only when bound (mirrors SpaceType's
// treatment of its `kind === 'slider'` case, which also floats the chip above the
// control rather than inside its label). A plain block `div` (not `display:contents`)
// — Gradient's rows rely on `mb-*` margin utilities for spacing, not a parent
// grid/flex that a contents-wrapper would need to stay transparent for.
import type { StudioControlDesc } from '~/lib/collection/studioBindables'
import BindableControlChip from '~/components/vue-canvas/studio/BindableControlChip.vue'

const props = defineProps<{
  controlKey: string
  label: string
  kind: string
  min?: number
  max?: number
  step?: number
  options?: string[]
  bound: string | null
}>()

const emit = defineEmits<{ (e: 'menu', event: MouseEvent, control: StudioControlDesc): void }>()

function desc(): StudioControlDesc {
  return { key: props.controlKey, label: props.label, kind: props.kind, min: props.min, max: props.max, step: props.step, options: props.options }
}
function onMenu(e: MouseEvent) { emit('menu', e, desc()) }
</script>

<template>
  <div @contextmenu.prevent="onMenu">
    <div v-if="bound" class="flex justify-end">
      <BindableControlChip :column-key="bound" @menu="onMenu" />
    </div>
    <slot />
  </div>
</template>
