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
 *   • "yours" is pinned first with a divider — every take is compared against
 *     what you already have, and clicking it is one-tap undo (select(null)).
 *   • hover = preview (the parent renders the take live and restores on leave);
 *     click = select; keep commits; dismiss / Escape restores and closes.
 *   • two explicit buttons: ↻ different directions (always) and ≈ variations of
 *     this (only once something is selected).
 *   • a take whose thumbnail failed shows an error tile and stays selectable —
 *     only the picture failed, not the config. A take with NO entry in the map
 *     yet is a different thing: still drawing (the strip goes up the instant the
 *     takes land, thumbnails stream in after), so it shows a pending tile.
 *   • keyboard parity: focusing a tile previews it exactly as hovering does, and
 *     blurring restores — the live preview is the whole point of the strip, and
 *     it cannot be mouse-only.
 */
import { computed, onBeforeUnmount, onMounted } from 'vue'
import StudioButton from '~/components/vue-canvas/studio/StudioButton.vue'
import type { VibeTake } from '~/lib/vibePrompt'

/** What a thumbnail may be: a data URL, a canvas the studio already drew, or
 *  null when the render failed. */
type Thumb = string | HTMLCanvasElement | null | undefined

const props = withDefaults(defineProps<{
  takes: VibeTake[]
  /** Keyed by the take OBJECT, never by index — the strip must not care how the
   *  parent orders or re-rolls the list. */
  thumbs: Map<VibeTake, Thumb>
  /** Thumbnail of the config the user already had ("yours"). */
  current?: Thumb
  selected?: VibeTake | null
  busy?: boolean
  /** True while the model is looking at these four pictures and deciding whether
   *  to fix any of them. A hint, never a block: every tile stays usable. */
  reviewing?: boolean
  /** False when the selected take moved nothing a "±" could be taken around —
   *  the host decides (it owns the controls); the strip just greys the button. */
  canVary?: boolean
}>(), { current: null, selected: null, busy: false, reviewing: false, canVary: true })

const emit = defineEmits<{
  /** Preview this take live, or (null) go back to the original. */
  hover: [take: VibeTake | null]
  /** Select this take, or (null) reselect the original — the strip stays open. */
  select: [take: VibeTake | null]
  keep: []
  dismiss: []
  moreDirections: []
  variationsOf: [take: VibeTake]
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
const TAG = 'pointer-events-none absolute inset-x-0 bottom-0 truncate px-1.5 pb-1 pt-3 text-left text-[10px] leading-none text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]'
</script>

<template>
  <div data-testid="take-strip" :aria-busy="busy ? 'true' : 'false'"
       class="flex flex-col gap-2 rounded-[8px] border border-white/10 bg-white/[0.03] p-2">
    <div data-testid="take-row" class="flex items-stretch gap-[5px]" @mouseleave="onHover(null)">
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

      <!-- ② the takes -->
      <button v-for="(t, i) in takes" :key="i" data-testid="take-tile" type="button"
              :data-label="t.label" :data-selected="selected === t ? 'true' : 'false'"
              :aria-label="t.label" :aria-pressed="selected === t ? 'true' : 'false'"
              :title="t.rationale"
              :class="[TILE, 'h-[96px] min-w-0 flex-1',
                       selected === t ? 'border-action ring-1 ring-action' : 'border-white/12 hover:border-white/30']"
              @mouseenter="onHover(t)" @mouseleave="onHover(null)"
              @focus="onHover(t)" @blur="onHover(null)" @click="emit('select', t)">
        <img v-if="sources.get(t)" :src="sources.get(t)!" alt="" class="h-full w-full object-cover">
        <!-- ③ still drawing — NOT a failure. -->
        <span v-else-if="pending.has(t)" data-testid="take-pending"
              class="block h-full w-full animate-pulse bg-white/[0.07]" />
        <!-- ④ error tile: the render threw. Never a blank strip. -->
        <span v-else data-testid="take-error"
              class="flex h-full w-full items-center justify-center bg-white/[0.04] text-[11px] text-white/35">
          couldn’t draw
        </span>
        <span :class="TAG">{{ t.label }}</span>
      </button>
    </div>

    <!-- ⑤ actions: two whole-strip controls. Keep/Variations move per-card (Task 3). -->
    <div data-testid="take-actions" class="flex items-center gap-2">
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
