<script setup lang="ts">
// Wraps ONE inline-markup studio control (Gradient/Shader/Texture Studio — surfaces
// that write straight into a nested reactive `config` rather than looping over a
// ControlSpec[] like Space Type). One line per control: `<BindableRow>` around the
// existing label+input markup, right-click (or the glyph) opens the same
// promote/bind/unbind menu Space Type gets via VariableGlyph.
//
// Gradient's controls are raw `<label class="flex justify-between">…</label>` +
// `<input>` pairs, not a single component that owns its own label row (like
// SpaceType's StudioSlider) — so there's no single flex row to inject the glyph
// into without editing every label. Instead the glyph renders on its own thin row
// ABOVE the slotted control, right-aligned, hover-revealed when unbound (mirrors
// SpaceType's treatment of its `kind === 'slider'` case, which also floats the
// glyph above the control rather than inside its label). A plain block `div`
// (`.group`, not `display:contents`) — Gradient's rows rely on `mb-*` margin
// utilities for spacing, not a parent grid/flex that a contents-wrapper would
// need to stay transparent for.
import type { StudioControlDesc } from '~/lib/collection/studioBindables'
import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'

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

const emit = defineEmits<{ (e: 'menu', event: MouseEvent, control: StudioControlDesc): void; (e: 'promote', control: StudioControlDesc): void }>()

function desc(): StudioControlDesc {
  return { key: props.controlKey, label: props.label, kind: props.kind, min: props.min, max: props.max, step: props.step, options: props.options }
}
function onMenu(e: MouseEvent) { emit('menu', e, desc()) }
</script>

<template>
  <div class="group" @contextmenu.prevent="onMenu">
    <div class="flex justify-end">
      <VariableGlyph :bound="bound" @promote="emit('promote', desc())" @menu="onMenu" />
    </div>
    <slot />
  </div>
</template>
