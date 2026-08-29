<script setup lang="ts">
/**
 * ReviewTile — the shared review-strip tile chrome, and the ONE source of
 * truth for the look both the studio take strip and the canvas sketch strip
 * must share: a fixed 96px clipped tile, the action-blue selection ring, and
 * the per-card action overlay revealed on hover / focus-within / selection.
 * Presentation only — knows nothing about takes, sketches, nodes, studios.
 *
 * DOM shape matters: the tile is a <button>, and its action (#actions, e.g.
 * Keep) is a SIBLING overlay inside a wrapping cell — never a descendant,
 * because a <button> cannot nest inside a <button>. The wrapper is the single
 * root, so a consumer's fall-through @click (which bubbles up from the button)
 * and @mouseenter/@mouseleave land on it; focus/blur don't bubble, so the
 * button forwards them as tilefocus/tileblur.
 *
 * Drag (opt-in via `draggable`): the tile owns its <button>, so it owns
 * pointer capture — capture MUST sit on the pointerdown target or the browser
 * re-targets move/up the instant the pointer leaves the tile, which is the
 * whole point of dragging onto the canvas. jsdom can't model capture, so this
 * is verified live, not in units. It captures here and forwards the raw
 * PointerEvents; the consumer runs the gesture (threshold, ghost, drop).
 */
const props = withDefaults(defineProps<{
  tileTestid: string
  selected?: boolean
  label?: string
  draggable?: boolean
}>(), { selected: false, label: undefined, draggable: false })

const emit = defineEmits<{
  tilefocus: []
  tileblur: []
  tilepointerdown: [e: PointerEvent]
  tilepointermove: [e: PointerEvent]
  tilepointerup: [e: PointerEvent]
  tilepointercancel: [e: PointerEvent]
}>()

// The clip + `group` (reveal trigger) live on the WRAPPER, matching the take
// strip exactly, so the button's ring and the Keep overlay both sit inside one
// rounded box and the overlay's corners are clipped like the tile's. The
// button carries only the border + selection ring.
const WRAP = 'group relative h-[96px] w-full min-w-0 flex-1 overflow-hidden rounded-[5px]'
const TILE = 'relative h-full w-full border transition enabled:cursor-pointer'
const RING_ON = 'border-action ring-1 ring-action'
const RING_OFF = 'border-white/12 hover:border-white/30'
const OVERLAY = 'pointer-events-none absolute inset-x-0 bottom-0 flex justify-end gap-1.5 p-1.5 opacity-0 transition bg-gradient-to-t from-black/85 to-transparent group-hover:opacity-100 group-focus-within:opacity-100'

function capture(e: PointerEvent) {
  const el = e.currentTarget as Element
  if (el?.setPointerCapture) { try { el.setPointerCapture(e.pointerId) } catch { /* no-op in test env */ } }
}
function release(e: PointerEvent) {
  const el = e.currentTarget as Element
  if (el?.releasePointerCapture) { try { el.releasePointerCapture(e.pointerId) } catch { /* no-op in test env */ } }
}
function onDown(e: PointerEvent) { if (!props.draggable) return; capture(e); emit('tilepointerdown', e) }
function onMove(e: PointerEvent) { if (props.draggable) emit('tilepointermove', e) }
function onUp(e: PointerEvent) { if (!props.draggable) return; release(e); emit('tilepointerup', e) }
function onCancel(e: PointerEvent) { if (!props.draggable) return; release(e); emit('tilepointercancel', e) }
</script>

<template>
  <!-- single-root wrapper: clip + sizing + the `group` reveal-trigger live
       here so the button and the sibling overlay share one rounded box.
       Consumer @click (bubbles up from the button) and @mouseenter/@mouseleave
       fall through to this root. -->
  <div :class="WRAP">
    <button type="button"
            :data-testid="tileTestid"
            :data-selected="selected ? 'true' : 'false'"
            :aria-pressed="selected ? 'true' : 'false'"
            :data-label="label"
            :aria-label="label"
            :class="[TILE, selected ? RING_ON : RING_OFF]"
            @focus="emit('tilefocus')" @blur="emit('tileblur')"
            @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onCancel">
      <slot />
    </button>
    <div v-if="$slots.actions"
         :data-testid="`${tileTestid}-actions`"
         :class="[OVERLAY, selected ? '!opacity-100' : '']">
      <slot name="actions" />
    </div>
  </div>
</template>
