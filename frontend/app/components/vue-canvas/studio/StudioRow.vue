<script setup lang="ts">
/**
 * One studio control, as one 28px row. The row IS the control: the fill behind it
 * shows the value, dragging anywhere on it scrubs, clicking the number types an
 * exact value, and double-clicking resets to the declared default.
 *
 * Kind-agnostic on purpose — the value side comes from rows/registry.ts, so this
 * file never grows a per-kind branch. Complex kinds (curve, path, gradientStops,
 * fillList) render this row as a header and expand a body beneath it via the
 * #body slot.
 */
import { computed, ref } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import { fillFraction, fillOrigin, parseTyped, resetValue } from '~/lib/studio/row'
import { scrubValue } from '~/lib/studio/scrub'
import { controlKindToVariableType } from '~/lib/collection/studioBindables'
import { rowRenderers, NUMERIC_KINDS } from './rows/registry'
import VariableGlyph from './VariableGlyph.vue'
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent } from 'reka-ui'

const props = defineProps<{
  spec: ControlSpec
  modelValue: string | number | boolean
  bound?: string | null
  bindable?: boolean
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: string | number | boolean): void
  (e: 'promote'): void
  (e: 'menu', event: MouseEvent): void
  // Clicking a bound row's column name jumps to the wired Collection, replacing the
  // "Edit in table" button the old two-line bound row carried.
  (e: 'goToCollection'): void
}>()

const numeric = computed(() => NUMERIC_KINDS.has(props.spec.kind))
const renderer = computed(() => rowRenderers[props.spec.kind] ?? null)
const min = computed(() => Number((props.spec as { min?: number }).min ?? 0))
const max = computed(() => Number((props.spec as { max?: number }).max ?? 1))
const step = computed(() => Number((props.spec as { step?: number }).step ?? 1))
const num = computed(() => Number(props.modelValue))

// The painted band runs between the origin and the value, so a bipolar slider grows
// out of the middle in whichever direction the value went.
const band = computed(() => {
  if (!numeric.value) return null
  const o = fillOrigin(min.value, max.value)
  const f = fillFraction(num.value, min.value, max.value)
  return { left: `${Math.min(o, f) * 100}%`, width: `${Math.abs(f - o) * 100}%` }
})

const editing = ref(false)
const dragged = ref(false)

function onPointerDown(e: PointerEvent) {
  if (!numeric.value || props.bound || editing.value) return
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  dragged.value = false
  const startX = e.clientX
  const startValue = num.value
  function move(ev: PointerEvent) {
    if (Math.abs(ev.clientX - startX) > 2) dragged.value = true
    if (!dragged.value) return
    emit('update:modelValue', scrubValue({
      startValue, deltaPx: ev.clientX - startX,
      min: min.value, max: max.value, step: step.value, fine: ev.shiftKey,
    }))
  }
  function up(ev: PointerEvent) {
    el.releasePointerCapture(e.pointerId)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    // A press with no movement is a click: jump to where they clicked.
    if (!dragged.value) {
      const r = el.getBoundingClientRect()
      const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
      const raw = min.value + f * (max.value - min.value)
      emit('update:modelValue', parseTyped(String(raw), min.value, max.value, step.value) ?? num.value)
    }
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}

function onReset() {
  if (props.bound) return
  if (!numeric.value) return
  emit('update:modelValue', resetValue({
    default: Number((props.spec as { default?: number }).default),
    min: min.value, max: max.value,
  }))
}

function onCommit(raw: string) {
  editing.value = false
  const v = parseTyped(raw, min.value, max.value, step.value)
  if (v !== null) emit('update:modelValue', v)
}

/** Clicking the value opens typed entry on numeric kinds. The wrapper span stops the
 *  event so the row's own drag never starts from the number — otherwise a click
 *  meant to type would scrub by a pixel or two first. */
function onValuePointerDown() {
  if (numeric.value && !props.bound) editing.value = true
}
</script>

<template>
  <div>
    <div
      class="group relative flex h-7 select-none items-center justify-between overflow-hidden rounded-md bg-white/[0.05] px-2.5"
      :class="numeric && !bound && !editing ? 'cursor-ew-resize' : ''"
      @pointerdown="onPointerDown"
      @dblclick="onReset"
      @contextmenu.prevent="emit('menu', $event)"
    >
      <div
        v-if="band"
        class="pointer-events-none absolute inset-y-0"
        :style="{ left: band.left, width: band.width, background: bound ? 'rgba(244,114,182,0.20)' : 'rgba(255,255,255,0.13)' }"
      ></div>

      <span class="relative flex min-w-0 items-center gap-1.5">
        <TooltipProvider v-if="spec.hint" :delay-duration="200">
          <TooltipRoot>
            <TooltipTrigger as-child>
              <span class="cursor-help truncate text-[11px] text-white/72 underline decoration-dotted decoration-white/20 underline-offset-2">{{ spec.label }}</span>
            </TooltipTrigger>
            <TooltipPortal>
              <TooltipContent
                side="top" :side-offset="6" :collision-padding="8"
                class="pointer-events-none z-[200] max-w-[220px] rounded-md border border-white/10 bg-[#1b1b1f] px-2 py-1 text-[11px] leading-snug text-white/85 shadow-lg shadow-black/40"
              >{{ spec.hint }}</TooltipContent>
            </TooltipPortal>
          </TooltipRoot>
        </TooltipProvider>
        <span v-else class="truncate text-[11px] text-white/72">{{ spec.label }}</span>
        <VariableGlyph
          v-if="bindable !== false && controlKindToVariableType(spec.kind)"
          :bound="bound ?? null"
          @promote="emit('promote')"
          @menu="(e: MouseEvent) => emit('menu', e)"
        />
      </span>

      <span class="relative flex shrink-0 items-center gap-2" @dblclick.stop>
        <button
          v-if="bound"
          type="button"
          class="max-w-[100px] truncate font-mono text-[11px] underline decoration-dotted underline-offset-2"
          style="color: var(--var-accent-text)"
          :title="`${bound} — edit in table`"
          @pointerdown.stop
          @click.stop="emit('goToCollection')"
        >{{ bound }}</button>
        <span v-else-if="renderer" @pointerdown.stop.prevent="onValuePointerDown">
          <component
            :is="renderer"
            :value="modelValue"
            :spec="spec"
            :step="step"
            :editing="editing"
            @commit="onCommit"
            @cancel="editing = false"
            @update:value="(v: string | number | boolean) => emit('update:modelValue', v)"
          />
        </span>
      </span>
    </div>
    <slot name="body" />
  </div>
</template>
