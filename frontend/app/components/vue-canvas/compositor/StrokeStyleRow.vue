<!-- frontend/app/components/vue-canvas/compositor/StrokeStyleRow.vue -->
<script setup lang="ts">
/**
 * The two outline-style rows every stroked layer shares in the Frame inspector:
 *
 *  - Align (closed shapes only): where the outline sits relative to the edge —
 *    Center (what shapes always did), Inside, Outside.
 *  - Solid / Dashed: picking Dashed reveals the dash and gap lengths, in pixels
 *    of the output width, exactly like every other size field here.
 *
 * Emits patches for the layer's own `strokeAlign` / `strokeDash` fields; the
 * host writes them with its usual setLocal, so undo and persistence are unchanged.
 */
import { computed } from 'vue'
import type { StrokeAlign, StrokeDash } from '~/composables/useCompositorLayers'

const props = defineProps<{
  align?: StrokeAlign
  dash?: StrokeDash
  /** Closed shapes get the Align row; a line and a text outline don't. */
  showAlign?: boolean
  /** Output width in px — the same scale the inspector's other size fields use. */
  outWidth: number
  /**
   * Extra multiplier folded into the px↔norm conversion. A `path` layer paints
   * inside a ctx pre-scaled by `(layer.scale||1)*W`, and stores its dash in the
   * SAME local units as `strokeWidth` (local units at scale=1 — see PathLayer),
   * so its row must divide/multiply by that scale too, or a resized path renders
   * a dash at the wrong size. Every other kind stores dash already normalized to
   * `outWidth` directly (its ctx is never pre-scaled by anything but W), so they
   * omit this and get the no-op default of 1. Ignored — normalizes to a no-op —
   * for a value that isn't a positive finite number.
   */
  scale?: number
}>()
const scale = computed(() => {
  const s = props.scale
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : 1
})
const emit = defineEmits<{
  (e: 'update:align', v: StrokeAlign): void
  (e: 'update:dash', v: StrokeDash | undefined): void
}>()

const align = computed<StrokeAlign>(() => (props.align === 'inside' || props.align === 'outside' ? props.align : 'center'))
const dashed = computed(() => !!props.dash)
const px = (norm: number) => Math.round(norm * props.outWidth * scale.value)
const norm = (v: number) => Math.max(0, v) / (props.outWidth * scale.value)

function setDashed(on: boolean) {
  // A first switch to Dashed needs visible marks: 12px on, 8px off.
  emit('update:dash', on ? (props.dash ?? { dash: norm(12), gap: norm(8) }) : undefined)
}
function setPart(key: 'dash' | 'gap', valuePx: number) {
  const cur = props.dash ?? { dash: norm(12), gap: norm(8) }
  emit('update:dash', { ...cur, [key]: norm(valuePx) })
}
const numClass = 'w-full bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1.5 text-xs text-white/90 outline-none'
const selClass = numClass + ' cursor-pointer'
</script>

<template>
  <div class="space-y-1.5">
    <div v-if="showAlign">
      <div class="panel-label mb-1.5">Line sits</div>
      <select :value="align" :class="selClass" data-stroke-align
        @change="emit('update:align', ($event.target as HTMLSelectElement).value as StrokeAlign)">
        <option value="center">On the edge</option>
        <option value="inside">Inside the shape</option>
        <option value="outside">Outside the shape</option>
      </select>
    </div>
    <div>
      <select :value="dashed ? 'dashed' : 'solid'" :class="selClass" data-stroke-dashed
        @change="setDashed(($event.target as HTMLSelectElement).value === 'dashed')">
        <option value="solid">Solid line</option>
        <option value="dashed">Dashed line</option>
      </select>
      <div v-if="dashed" class="grid grid-cols-2 gap-1.5 mt-1.5">
        <div>
          <div class="panel-label mb-1">Dash</div>
          <input v-scrubnum type="number" min="0" step="1" :value="px(props.dash!.dash)" :class="numClass" data-stroke-dash
            @input="setPart('dash', parseFloat(($event.target as HTMLInputElement).value) || 0)">
        </div>
        <div>
          <div class="panel-label mb-1">Gap</div>
          <input v-scrubnum type="number" min="0" step="1" :value="px(props.dash!.gap)" :class="numClass" data-stroke-gap
            @input="setPart('gap', parseFloat(($event.target as HTMLInputElement).value) || 0)">
        </div>
      </div>
    </div>
  </div>
</template>
