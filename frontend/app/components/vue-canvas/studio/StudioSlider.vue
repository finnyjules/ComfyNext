<script setup lang="ts">
// Shared slim slider with an optional label + mono value readout. White rail/thumb.
// The readout doubles as a drag-to-scrub handle (shift = fine) when unbound, and
// carries the variable glyph (promote/manage) in the same row.
import { scrubValue } from '~/lib/studio/scrub'
import VariableGlyph from '~/components/vue-canvas/studio/VariableGlyph.vue'
// Tooltip via reka-ui primitives (portal-based) so the popover escapes the
// studio section cards' overflow:hidden — matches the codebase tooltip stack.
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent } from 'reka-ui'

const model = defineModel<number>({ required: true })
const props = defineProps<{
  label?: string
  min: number
  max: number
  step?: number
  default?: number
  bound?: string | null
  bindable?: boolean
  scrubPx?: number
  hint?: string
}>()
const emit = defineEmits<{ (e: 'promote'): void; (e: 'menu', event: MouseEvent): void }>()

function onScrubDown(e: PointerEvent) {
  if (props.bound) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  const startX = e.clientX
  const startValue = Number(model.value)
  function move(ev: PointerEvent) {
    model.value = scrubValue({
      startValue, deltaPx: ev.clientX - startX,
      min: props.min, max: props.max, step: props.step ?? 1,
      scrubPx: props.scrubPx, fine: ev.shiftKey,
    })
  }
  function up() {
    el.releasePointerCapture(e.pointerId)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
</script>

<template>
  <div class="group">
    <div v-if="label" class="mb-1.5 flex items-center justify-between">
      <TooltipProvider v-if="hint" :delay-duration="200">
        <TooltipRoot>
          <TooltipTrigger as-child>
            <span
              class="cursor-help text-[11px] text-white/55 underline decoration-dotted decoration-white/25 underline-offset-2"
            >{{ label }}</span>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent
              side="top"
              :side-offset="6"
              :collision-padding="8"
              class="pointer-events-none z-[200] max-w-[220px] rounded-md border border-white/10 bg-[#1b1b1f] px-2 py-1 text-[11px] leading-snug text-white/85 shadow-lg shadow-black/40"
            >{{ hint }}</TooltipContent>
          </TooltipPortal>
        </TooltipRoot>
      </TooltipProvider>
      <span v-else class="text-[11px] text-white/55">{{ label }}</span>
      <div class="flex items-center gap-1.5">
        <span
          v-if="bound"
          class="max-w-[90px] truncate font-mono text-[11px]"
          style="color: var(--var-accent-text)"
          :title="bound"
        >{{ bound }}</span>
        <span
          v-else
          class="font-mono text-[11px] text-white/80"
          style="cursor: ew-resize; border-bottom: 1px dotted rgba(255,255,255,0.22); padding-bottom: 1px"
          @pointerdown="onScrubDown"
        >{{ Number(model) }}</span>
        <VariableGlyph
          v-if="bindable"
          :bound="bound ?? null"
          @promote="emit('promote')"
          @menu="(e: MouseEvent) => emit('menu', e)"
        />
      </div>
    </div>
    <input
      v-studio-reset :data-default="default" type="range"
      v-model.number="model" :min="min" :max="max" :step="step ?? 1"
      :data-bound="bound ? '' : null"
      class="studio-range w-full"
    />
  </div>
</template>
