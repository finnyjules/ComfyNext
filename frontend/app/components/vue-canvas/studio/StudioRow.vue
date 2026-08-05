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
import { computed, nextTick, ref } from 'vue'
import type { ControlSpec } from '~/lib/spacetype/effect'
import { fillFraction, fillOrigin, formatValue, nudgeValue, parseTyped, resetValue } from '~/lib/studio/row'
import { scrubValue } from '~/lib/studio/scrub'
import { controlKindToVariableType } from '~/lib/collection/studioBindables'
import { resolveRowRenderer, NUMERIC_KINDS } from './rows/registry'
import VariableGlyph from './VariableGlyph.vue'
import { TooltipProvider, TooltipRoot, TooltipTrigger, TooltipPortal, TooltipContent } from 'reka-ui'

// `bindable` is written as an OPT-OUT everywhere it is read (`bindable !== false`), but
// Vue casts an absent Boolean prop to `false` unless it has a default — so without this
// the variable glyph rendered on NO row at all, and the opt-out was unreachable. Found
// while checking the accessibility tree for the glyph the slider role was accused of
// hiding: it was not in the tree because it was not in the DOM.
const props = withDefaults(defineProps<{
  spec: ControlSpec
  modelValue: string | number | boolean
  bound?: string | null
  bindable?: boolean
}>(), { bound: null, bindable: true })
const emit = defineEmits<{
  (e: 'update:modelValue', v: string | number | boolean): void
  (e: 'promote'): void
  (e: 'menu', event: MouseEvent): void
  // Clicking a bound row's column name jumps to the wired Collection, replacing the
  // "Edit in table" button the old two-line bound row carried.
  (e: 'goToCollection'): void
}>()

const numeric = computed(() => NUMERIC_KINDS.has(props.spec.kind))
const renderer = computed(() => resolveRowRenderer(props.spec.kind))
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

/**
 * The element that IS the slider, for both focus and ARIA. It is a leaf on purpose:
 * `slider` is a children-presentational role, so hanging it on the row container —
 * which holds the variable glyph's button, the bound column's button and, while
 * typing, an `<input>` — is the `nested-interactive` pattern, and its practical
 * effect is that assistive tech drops those controls from the tree entirely. The
 * track is a sibling of them instead, so the row exposes a slider AND its buttons.
 *
 * It is `pointer-events-none` so it never intercepts the row's own drag, which means
 * the browser's default mousedown-focus can never land on it — every focus below is
 * therefore explicit.
 */
const track = ref<HTMLElement | null>(null)

/** Give the keyboard somewhere to be after a gesture that had no focus of its own. */
function focusTrack() {
  track.value?.focus()
}

function onPointerDown(e: PointerEvent) {
  // Primary button only. A right-click fires `pointerdown` too, and without this the
  // gesture whose entire purpose is opening the bind menu would also capture, run
  // `up()` with no movement, and click-to-position a brand new value into the
  // parameter. Middle-click/back/forward are left alone for the same reason.
  if (e.button !== 0) return
  if (!numeric.value || editing.value) return
  const el = e.currentTarget as HTMLElement
  // Clicking a native range focuses it, and the row must behave the same or a
  // click-then-arrow does nothing. Focusing HERE does not survive: the compatibility
  // `mousedown` runs afterwards and its default action moves focus to the nearest
  // focusable ancestor — which, now that the container is not focusable, is `<body>`
  // (measured: activeElement came back null). So claim focus on the way back up,
  // still long before any keystroke. Registered before the `bound` return because a
  // read-only slider is still a tab stop worth landing on.
  //
  // ...but NOT when the press landed on one of the row's own controls. The variable
  // glyph and the bound-column button are real buttons the user just focused by
  // clicking, and stealing that focus back on pointerup is exactly the bug this
  // handler exists to avoid (observed: clicking the glyph left focus on the track).
  const hit = e.target as Element | null
  if (!hit?.closest?.('button, input, select, textarea, a[href]')) {
    el.addEventListener('pointerup', focusTrack, { once: true })
  }
  if (props.bound) return
  el.setPointerCapture(e.pointerId)
  // Per-gesture, not per-component: a second pointer going down mid-drag used to
  // reset a shared flag, so releasing the FIRST pointer read `dragged === false`
  // and fired a spurious click-to-position jump. The template never reads it, so
  // it does not need to be reactive either.
  let dragged = false
  const startX = e.clientX
  const startValue = num.value
  function move(ev: PointerEvent) {
    if (ev.pointerId !== e.pointerId) return
    if (Math.abs(ev.clientX - startX) > 2) dragged = true
    if (!dragged) return
    emit('update:modelValue', scrubValue({
      startValue, deltaPx: ev.clientX - startX,
      min: min.value, max: max.value, step: step.value, fine: ev.shiftKey,
    }))
  }
  // Detaching is deliberately separate from finishing: `pointercancel` (touch, pen,
  // or the browser taking the gesture over for a scroll) never delivers `pointerup`,
  // and without this the `pointermove` listener stayed attached to the row with a
  // stale startX — after which merely HOVERING the row cleared the 2px test and
  // scrubbed continuously.
  function teardown() {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', onCancel)
    // Last, so a throw here can never leave the listeners attached.
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
  }
  function onCancel(ev: PointerEvent) {
    if (ev.pointerId !== e.pointerId) return
    teardown()
  }
  function up(ev: PointerEvent) {
    if (ev.pointerId !== e.pointerId) return
    teardown()
    // A press with no movement is a click: jump to where they clicked.
    if (!dragged) {
      const r = el.getBoundingClientRect()
      const f = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
      const raw = min.value + f * (max.value - min.value)
      emit('update:modelValue', parseTyped(String(raw), min.value, max.value, step.value) ?? num.value)
    }
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', onCancel)
}

/**
 * The keyboard path. What this replaces was a native `<input type="range">` —
 * focusable, arrow-keyable, self-describing — and this row becomes every control in
 * every studio, so the regression would have been permanent. Arrows move one step,
 * Shift-arrow ten (a native range's PageUp jump, on a key people actually press),
 * Home/End pin the ends. Bound rows are inert here exactly as they are under the
 * pointer, and an open text field keeps its own arrows for caret movement.
 */
function onKeydown(e: KeyboardEvent) {
  if (!numeric.value || props.bound || editing.value) return
  // The arithmetic lives in ~/lib/studio/row so it has a test path; both branches end
  // in parseTyped's snap-and-clamp, same as typed entry, so a keyed value and a typed
  // one can never land on different grids.
  const args = { value: num.value, min: min.value, max: max.value, step: step.value, coarse: e.shiftKey }
  let next: number
  switch (e.key) {
    case 'ArrowLeft': case 'ArrowDown': next = nudgeValue({ ...args, direction: -1 }); break
    case 'ArrowRight': case 'ArrowUp': next = nudgeValue({ ...args, direction: 1 }); break
    case 'Home': next = parseTyped(String(min.value), min.value, max.value, step.value) ?? num.value; break
    case 'End': next = parseTyped(String(max.value), min.value, max.value, step.value) ?? num.value; break
    default: return
  }
  // Handled either way — an arrow at the maximum must still not scroll the panel.
  e.preventDefault()
  // ...but it must not WRITE either. At an end the nudge returns the current value,
  // and key repeat would otherwise pour identical no-op writes into the document and
  // its undo stack.
  if (next === num.value) return
  emit('update:modelValue', next)
}

function onReset() {
  if (props.bound) return
  if (!numeric.value) return
  emit('update:modelValue', resetValue({
    default: Number((props.spec as { default?: number }).default),
    min: min.value, max: max.value,
  }))
}

/**
 * Both endings of typed entry unmount the input, and focus then falls to `<body>` —
 * arrow keys go dead until the user tabs all the way back, where the native range
 * this replaced simply stayed focused. So hand focus to the track.
 *
 * Only when the focus was still OURS at the moment the ending fired, though: blur
 * commits (clicking away, which is a legitimate ending) run with focus already gone,
 * and stealing it back would yank the user off whatever they just clicked.
 */
function restoreFocus() {
  const active = document.activeElement
  const ours = !!active && !!track.value?.parentElement?.contains(active)
  if (!ours) return
  // After the unmount, or the input is still there to be blurred by the focus call.
  nextTick(focusTrack)
}

function onCommit(raw: string) {
  restoreFocus()
  editing.value = false
  const v = parseTyped(raw, min.value, max.value, step.value)
  if (v !== null) emit('update:modelValue', v)
}

function onCancel() {
  restoreFocus()
  editing.value = false
}

/**
 * Clicking the value opens typed entry on numeric kinds. The wrapper span always
 * stops the event so the row's own drag never starts from the number — otherwise a
 * click meant to type would scrub by a pixel or two first.
 *
 * `preventDefault`, though, is scoped to the numeric case, and the scoping is the
 * whole point of doing this in a handler rather than with a `.prevent` modifier.
 * Cancelling `pointerdown` is what keeps the typed-entry field OPEN — otherwise the
 * compatibility `mousedown` runs its default action, moves focus to `<body>`, and
 * the field blur-commits shut in the same gesture it opened (Task 3's finding 1).
 * But that same cancellation also suppresses the default action that opens a native
 * `<select>` menu and the one that focuses a button, so applying it to every kind
 * would leave RowSelect's transparent select and RowColor's swatch dead on click.
 */
function onValuePointerDown(e: PointerEvent) {
  e.stopPropagation()
  // Primary button only, for the same reason `onPointerDown` above carries this guard:
  // a right-click fires `pointerdown` too, so without it right-clicking the readout
  // opened the bind menu AND typed entry in one gesture, and the field then blur-commits
  // a no-op write into the document and its undo stack — the very writes `onKeydown`
  // refuses. `stopPropagation` stays unconditional (the row handler ignores non-primary
  // anyway) so the numeric drag can never start from the number.
  if (e.button !== 0) return
  if (!numeric.value || props.bound) return
  e.preventDefault()
  editing.value = true
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

      <!-- The track: a childless element carrying the slider role, the tab stop and the
           keyboard, so the row's buttons stay siblings rather than descendants of a
           children-presentational role. Covers the whole row, so the focus ring is the
           row's outline and a screen reader's slider is the thing you actually drag. -->
      <div
        v-if="numeric"
        ref="track"
        tabindex="0"
        role="slider"
        class="pointer-events-none absolute inset-0 rounded-md outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/40"
        :aria-label="spec.label"
        :aria-valuemin="min"
        :aria-valuemax="max"
        :aria-valuenow="num"
        :aria-valuetext="bound ? bound : formatValue(num, step)"
        :aria-readonly="bound ? 'true' : undefined"
        @keydown="onKeydown"
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
        <span v-else-if="renderer" @pointerdown="onValuePointerDown">
          <component
            :is="renderer"
            :value="modelValue"
            :spec="spec"
            :step="step"
            :editing="editing"
            @commit="onCommit"
            @cancel="onCancel"
            @update:value="(v: string | number | boolean) => emit('update:modelValue', v)"
          />
        </span>
      </span>
    </div>
    <slot name="body" />
  </div>
</template>
