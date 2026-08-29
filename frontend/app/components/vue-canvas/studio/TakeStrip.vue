<script setup lang="ts">
/**
 * The take strip — four readings of one request, under the studio preview.
 *
 * PRESENTATION ONLY, on purpose: it fetches nothing, renders nothing, knows no
 * config shape and imports no studio. It is handed takes plus a thumbnail for
 * each and reports what the user did; the composable that owns the session
 * decides what any of it means. That is what lets one strip serve all five
 * studios (and, later, the canvas node) without a fork.
 *
 * Semantics settled with the owner:
 *   • "current" is pinned first with a divider — every take is compared against
 *     what you already have, and clicking it is one-tap undo (select(null)).
 *   • hover = preview (the parent renders the take live and restores on leave);
 *     click = select; keep commits; dismiss / Escape restores and closes.
 *   • ↻ Re-roll (different directions) sits on the whole-strip bar, always on.
 *     Keep lives per-card instead — revealed on hover/focus/selection.
 *   • a take whose thumbnail failed shows an error tile and stays selectable —
 *     only the picture failed, not the config. A take with NO entry in the map
 *     yet is a different thing: still drawing (the strip goes up the instant the
 *     takes land, thumbnails stream in after), so it shows a pending tile.
 *   • keyboard parity: focusing a tile previews it exactly as hovering does, and
 *     blurring restores — the live preview is the whole point of the strip, and
 *     it cannot be mouse-only.
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import ReviewTile from '~/components/vue-canvas/studio/ReviewTile.vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import { ACTIONS_BAR, TILES_ROW, TRAY_PANEL } from '~/components/vue-canvas/studio/reviewStripStyles'
import type { VibeTake } from '~/lib/vibePrompt'

/** What a thumbnail may be: a data URL, a canvas the studio already drew, or
 *  null when the render failed. */
type Thumb = string | HTMLCanvasElement | null | undefined

const props = withDefaults(defineProps<{
  takes: VibeTake[]
  /** Keyed by the take OBJECT, never by index — the strip must not care how the
   *  parent orders or re-rolls the list. */
  thumbs: Map<VibeTake, Thumb>
  /** Thumbnail of the config the user already had ("current"). */
  current?: Thumb
  selected?: VibeTake | null
  busy?: boolean
  /** True while the model is looking at these four pictures and deciding whether
   *  to fix any of them. A hint, never a block: every tile stays usable. */
  reviewing?: boolean
}>(), { current: null, selected: null, busy: false, reviewing: false })

const emit = defineEmits<{
  /** Preview this take live, or (null) go back to the original. */
  hover: [take: VibeTake | null]
  /** Select this take, or (null) reselect the original — the strip stays open. */
  select: [take: VibeTake | null]
  keep: []
  dismiss: []
  moreDirections: []
}>()

function srcOf(t: Thumb): string | null {
  if (!t) return null
  if (typeof t === 'string') return t || null
  // A canvas handed straight over: serialise once, here, rather than making
  // every studio adapter produce a data URL it may not need.
  try { return typeof t.toDataURL === 'function' ? t.toDataURL() : null } catch { return null }
}

const sources = computed(() => new Map(props.takes.map(t => [t, srcOf(props.thumbs.get(t))])))
const currentSrc = computed(() => srcOf(props.current))
/** No entry at all = the adapter has not answered yet. An entry of `null` = it
 *  answered, and the render failed. Only the second is an error. */
const pending = computed(() => new Set(props.takes.filter(t => !props.thumbs.has(t))))

function onHover(take: VibeTake | null) {
  if (props.busy) return // mid-render: a preview swap now would fight the engine
  emit('hover', take)
}

function onEsc(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  // Absorb it. The studio shell behind this listens for Escape on `window` (so it
  // runs after `document` in the bubble path) and skips a defaultPrevented event —
  // without this, one Escape would dismiss the strip AND close the whole studio.
  e.preventDefault()
  emit('dismiss')
}
onMounted(() => document.addEventListener('keydown', onEsc))
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onEsc)
  // Going away with a take still previewing means the same thing as dismissing:
  // put the original back. The host's own guard makes the ordinary
  // keep/dismiss unmount (where the session is already closed) a no-op.
  emit('dismiss')
})

const TILE = 'group relative overflow-hidden rounded-[5px] border transition enabled:cursor-pointer'
</script>

<template>
  <div data-testid="take-strip" :aria-busy="busy ? 'true' : 'false'" :class="TRAY_PANEL">
    <div data-testid="take-row" :class="TILES_ROW" @mouseleave="onHover(null)">
      <!-- ① current — the anchor, and the undo -->
      <div class="flex w-[76px] shrink-0 flex-col gap-1.5">
        <button data-testid="take-current" type="button" aria-label="current"
                :data-selected="selected ? 'false' : 'true'"
                :aria-pressed="selected ? 'false' : 'true'"
                :class="[TILE, 'h-[96px] w-full opacity-80',
                         selected ? 'border-white/12 hover:border-white/25' : 'border-white/20']"
                @mouseenter="onHover(null)" @focus="onHover(null)" @blur="onHover(null)"
                @click="emit('select', null)">
          <img v-if="currentSrc" :src="currentSrc" alt="" class="h-full w-full object-cover">
          <span v-else class="block h-full w-full bg-white/[0.06]" />
        </button>
        <span data-testid="take-current-mark"
              class="text-center text-[10px] uppercase tracking-[0.06em] text-white/35">current</span>
      </div>

      <div data-testid="take-divider" class="my-0.5 w-px shrink-0 bg-white/10" />

      <!-- ② the takes — each a cell: a clipped "card" wrapper (tile-button plus
           its own action row, siblings — a button cannot nest inside a button)
           holding the rounded clip, and the tooltip as a cell-level sibling of
           that wrapper so it still escapes upward, unclipped. -->
      <div v-for="(t, i) in takes" :key="i" data-testid="take-cell" class="group relative min-w-0 flex-1"
           @mouseenter="onHover(t)" @mouseleave="onHover(null)">
        <ReviewTile tile-testid="take-tile" :selected="selected === t" :label="t.label"
                    @click="emit('select', t)" @tilefocus="onHover(t)" @tileblur="onHover(null)">
          <img v-if="sources.get(t)" :src="sources.get(t)!" alt="" class="h-full w-full object-cover">
          <!-- ③ still drawing — NOT a failure. -->
          <span v-else-if="pending.has(t)" data-testid="take-pending"
                class="block h-full w-full animate-pulse bg-white/[0.07]" />
          <!-- ④ error tile: the render threw. Never a blank strip. -->
          <span v-else data-testid="take-error"
                class="flex h-full w-full items-center justify-center bg-white/[0.04] text-[11px] text-white/35">
            couldn’t draw
          </span>
          <template #actions>
            <StudioButton data-testid="take-keep" variant="primary" class="pointer-events-auto"
                          :disabled="busy" @click.stop="emit('select', t); emit('keep')">
              Keep
            </StudioButton>
          </template>
        </ReviewTile>
        <!-- styled description tooltip: supplementary weight, above its own card;
             replaces the native title (the unstyled OS box) with something on-brand
             that appears immediately on hover, unclipped, since the rounded card
             wrapper it floats above doesn't contain it. -->
        <div v-if="t.rationale" data-testid="take-tip"
             :class="['pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 z-10 w-[210px] -translate-x-1/2',
                      'rounded-[8px] border border-white/15 bg-[#161a21] px-2.5 py-2',
                      'text-[11.5px] leading-normal text-white/70 shadow-[0_8px_24px_rgba(0,0,0,0.45)]',
                      'opacity-0 transition-opacity duration-150',
                      'group-hover:opacity-100 group-focus-within:opacity-100',
                      selected === t ? '!opacity-100' : '']">
          {{ t.rationale }}
          <span class="absolute -bottom-[5px] left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45
                       border-b border-r border-white/15 bg-[#161a21]" />
        </div>
      </div>
    </div>

    <!-- ⑤ actions: two whole-strip controls. Keep lives per-card, above. -->
    <div data-testid="take-actions" :class="ACTIONS_BAR">
      <StudioButton data-testid="take-dismiss" variant="subtle" :disabled="busy" @click="emit('dismiss')">
        Cancel
      </StudioButton>
      <span v-if="reviewing" data-testid="take-reviewing" class="pl-1 text-[11px] text-white/40">
        looking at these<span class="animate-pulse">…</span>
      </span>
      <span class="flex-1" />
      <StudioButton data-testid="take-reroll" variant="neutral" :disabled="busy" @click="emit('moreDirections')">
        ↻ Re-roll
      </StudioButton>
    </div>
  </div>
</template>
