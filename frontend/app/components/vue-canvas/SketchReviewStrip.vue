<script setup lang="ts">
/**
 * Canvas sketch review strip — four instant sketches, docked above the prompt
 * bar, reviewed before any land. A twin of the studio take strip: same tray,
 * same 96px ReviewTile chrome, same per-card Keep on hover, same Cancel/Re-roll
 * bar below. PRESENTATION + gesture only — reports what the user did
 * (select/keep/cancel/reroll/dropAt); the canvas host turns a commit into
 * one image node and tears down the transient sketch-pad state.
 */
import { computed, ref } from 'vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import ReviewTile from '~/components/vue-canvas/studio/ReviewTile.vue'
import { TRAY_FLOATING, TILES_ROW, ACTIONS_BAR } from '~/components/vue-canvas/studio/reviewStripStyles'

const props = withDefaults(defineProps<{
  images: string[]
  selected: number | null
  busy?: boolean
  /** The in-flight (or last) generation failed. Overrides loading — the strip
   *  shows the error row instead of eternal skeletons. */
  error?: boolean
}>(), { busy: false, error: false })

const emit = defineEmits<{
  select: [index: number]
  keep: []
  cancel: []
  reroll: []
  dropAt: [payload: { index: number; clientX: number; clientY: number }]
}>()

// Opened the instant the prompt is submitted, before any sketch exists — no
// images yet and no error means the batch is still cooking on the server.
const loading = computed(() => !props.error && props.images.length === 0)

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
  <!-- Tray fills its wrapper so the flex-1 ReviewTiles distribute across the
       full width: the wrapper is sized to match the prompt bar's live width
       (VueNodeCanvas's sketchStripDockStyle), not a fixed guess. -->
  <div data-testid="sketch-strip" :class="[TRAY_FLOATING, 'w-full']">
    <!-- error: the run failed — a message in place of the tiles, never
         eternal skeletons. Re-roll (enabled, busy is false here) retries. -->
    <div v-if="error" data-testid="sketch-error"
         class="flex h-[96px] items-center justify-center text-center text-[12px] text-white/50">
      Couldn’t sketch that — try again
    </div>
    <!-- loading: opened the instant the prompt was submitted, before the
         batch exists — four non-interactive pulsing placeholders, same
         chrome as the ready tiles, no actions/click. -->
    <div v-else-if="loading" :class="TILES_ROW">
      <ReviewTile v-for="i in 4" :key="i" tile-testid="sketch-pending" :selected="false">
        <span class="block h-full w-full animate-pulse bg-white/[0.07]" />
      </ReviewTile>
    </div>
    <!-- ready: the batch landed. -->
    <div v-else :class="TILES_ROW">
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
            Add to canvas
          </StudioButton>
        </template>
      </ReviewTile>
    </div>

    <div data-testid="sketch-actions" :class="ACTIONS_BAR">
      <StudioButton data-testid="sketch-cancel" variant="subtle" @click="emit('cancel')">Cancel</StudioButton>
      <span class="flex-1" />
      <StudioButton data-testid="sketch-reroll" variant="neutral" :disabled="busy" @click="emit('reroll')">↻ Re-roll</StudioButton>
    </div>

    <!-- Teleported to <body>: the tray's backdrop-blur makes it a containing
         block for `fixed` descendants, so a ghost left inside would position
         against the blurred tray instead of the viewport and never appear
         under the cursor over the canvas. -->
    <Teleport to="body">
      <div v-if="drag?.started" data-testid="sketch-ghost"
           class="pointer-events-none fixed z-[60] h-[80px] w-[80px] overflow-hidden rounded-[6px] border border-white/25 shadow-[0_10px_30px_rgba(0,0,0,0.6)]"
           :style="{ left: drag.x + 'px', top: drag.y + 'px', transform: 'translate(-50%, -50%) rotate(-3deg)' }">
        <img :src="images[drag.index]" alt="" class="h-full w-full object-cover">
      </div>
    </Teleport>
  </div>
</template>
