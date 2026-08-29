<script setup lang="ts">
/**
 * Canvas sketch review strip — four instant sketches, docked above the prompt
 * bar, reviewed before any land. A twin of the studio take strip: same tray,
 * same 96px ReviewTile chrome, same per-card Keep on hover, same Cancel/Re-roll
 * bar below. PRESENTATION + gesture only — reports what the user did
 * (hover/select/keep/cancel/reroll/dropAt); the canvas host turns a commit into
 * one image node and tears down the transient sketch-pad state.
 */
import { ref } from 'vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import ReviewTile from '~/components/vue-canvas/studio/ReviewTile.vue'
import { TRAY_FLOATING, TILES_ROW, ACTIONS_BAR } from '~/components/vue-canvas/studio/reviewStripStyles'

const props = withDefaults(defineProps<{
  images: string[]
  selected: number | null
  busy?: boolean
}>(), { busy: false })

const emit = defineEmits<{
  select: [index: number]
  keep: []
  cancel: []
  reroll: []
  dropAt: [payload: { index: number; clientX: number; clientY: number }]
}>()

// Drag-to-place: press-move past threshold lifts the tile into a ghost that
// follows the pointer; release reports the drop point in screen space. A
// press-release under threshold stays a click (select) — draggedThisPress
// tells the two apart. ReviewTile owns pointer capture + forwards the events.
const DRAG_THRESHOLD = 4
const drag = ref<{ index: number; x: number; y: number; started: boolean } | null>(null)
const draggedThisPress = ref(false)

function onDown(i: number, e: PointerEvent) {
  draggedThisPress.value = false
  drag.value = { index: i, x: e.clientX, y: e.clientY, started: false }
}
function onMove(e: PointerEvent) {
  const d = drag.value
  if (!d) return
  if (!d.started && Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD) return
  d.started = true
  d.x = e.clientX; d.y = e.clientY
}
function onUp(e: PointerEvent) {
  const d = drag.value
  drag.value = null
  draggedThisPress.value = !!d?.started
  if (d?.started) emit('dropAt', { index: d.index, clientX: e.clientX, clientY: e.clientY })
}
// The OS can steal a gesture mid-drag — clear drag state, never emit dropAt.
function onCancel() {
  const d = drag.value
  drag.value = null
  draggedThisPress.value = !!d?.started
}
function onTileClick(i: number) {
  if (draggedThisPress.value) return
  emit('select', i)
}
</script>

<template>
  <div data-testid="sketch-strip" :class="TRAY_FLOATING">
    <div :class="TILES_ROW">
      <ReviewTile v-for="(src, i) in images" :key="i"
                  tile-testid="sketch-tile" :selected="selected === i" draggable
                  @click="onTileClick(i)"
                  @tilepointerdown="onDown(i, $event)" @tilepointermove="onMove"
                  @tilepointerup="onUp" @tilepointercancel="onCancel">
        <!-- draggable="false": a native <img> drag fires a spurious
             pointercancel that would kill our drag-to-place before the ghost
             appears (live-only; jsdom never starts native drag). -->
        <img :src="src" alt="" draggable="false" class="h-full w-full object-cover">
        <template #actions>
          <StudioButton data-testid="sketch-keep" variant="primary" class="pointer-events-auto"
                        :disabled="busy" @click.stop="emit('select', i); emit('keep')">
            Keep
          </StudioButton>
        </template>
      </ReviewTile>
    </div>

    <div data-testid="sketch-actions" :class="ACTIONS_BAR">
      <StudioButton data-testid="sketch-cancel" variant="subtle" @click="emit('cancel')">Cancel</StudioButton>
      <span class="flex-1" />
      <StudioButton data-testid="sketch-reroll" variant="neutral" :disabled="busy" @click="emit('reroll')">↻ Re-roll</StudioButton>
    </div>

    <div v-if="drag?.started" data-testid="sketch-ghost"
         class="pointer-events-none fixed z-50 h-[80px] w-[80px] overflow-hidden rounded-[6px] border border-white/25 shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
         :style="{ left: drag.x + 'px', top: drag.y + 'px', transform: 'translate(-50%, -50%) rotate(-3deg)' }">
      <img :src="images[drag.index]" alt="" class="h-full w-full object-cover">
    </div>
  </div>
</template>
