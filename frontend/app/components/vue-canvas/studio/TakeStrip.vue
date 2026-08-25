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
 *     only the picture failed, not the config.
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
}>(), { current: null, selected: null, busy: false })

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

function onHover(take: VibeTake | null) {
  if (props.busy) return // mid-render: a preview swap now would fight the engine
  emit('hover', take)
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('dismiss')
}
onMounted(() => document.addEventListener('keydown', onEsc))
onBeforeUnmount(() => document.removeEventListener('keydown', onEsc))

const TILE = 'group relative h-[52px] overflow-hidden rounded-[5px] border transition enabled:cursor-pointer'
const TAG = 'pointer-events-none absolute inset-x-0 bottom-0 truncate px-1.5 pb-1 pt-3 text-left text-[10px] leading-none text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]'
</script>

<template>
  <div data-testid="take-strip" :aria-busy="busy ? 'true' : 'false'"
       class="flex flex-col gap-2 rounded-[8px] border border-white/10 bg-white/[0.03] p-2">
    <div data-testid="take-row" class="flex items-stretch gap-[5px]" @mouseleave="onHover(null)">
      <!-- ① yours — the anchor, and the undo -->
      <button data-testid="take-yours" type="button"
              :data-selected="selected ? 'false' : 'true'"
              :class="[TILE, 'w-[76px] shrink-0 border-dashed',
                       selected ? 'border-white/25 hover:border-white/45' : 'border-white/55']"
              @mouseenter="onHover(null)" @click="emit('select', null)">
        <img v-if="currentSrc" :src="currentSrc" alt="" class="h-full w-full object-cover">
        <span v-else class="block h-full w-full bg-white/[0.06]" />
        <span :class="TAG">yours</span>
      </button>

      <div data-testid="take-divider" class="my-0.5 w-px shrink-0 bg-white/10" />

      <!-- ② the takes -->
      <button v-for="(t, i) in takes" :key="i" data-testid="take-tile" type="button"
              :data-label="t.label" :data-selected="selected === t ? 'true' : 'false'"
              :title="t.rationale"
              :class="[TILE, 'min-w-0 flex-1',
                       selected === t ? 'border-action ring-1 ring-action' : 'border-white/12 hover:border-white/30']"
              @mouseenter="onHover(t)" @mouseleave="onHover(null)" @click="emit('select', t)">
        <img v-if="sources.get(t)" :src="sources.get(t)!" alt="" class="h-full w-full object-cover">
        <!-- ③ error tile: the render threw. Never a blank strip. -->
        <span v-else data-testid="take-error"
              class="flex h-full w-full items-center justify-center bg-white/[0.04] text-[11px] text-white/35">
          couldn’t draw
        </span>
        <span :class="TAG">{{ t.label }}</span>
      </button>
    </div>

    <!-- ④ actions: diverge · converge · undo · commit -->
    <div class="flex items-center gap-2">
      <StudioButton data-testid="take-more" variant="secondary" :disabled="busy" @click="emit('moreDirections')">
        ↻ different directions
      </StudioButton>
      <StudioButton data-testid="take-variations" variant="secondary" :disabled="busy || !selected"
                    @click="selected && emit('variationsOf', selected)">
        ≈ variations of this
      </StudioButton>
      <span class="flex-1" />
      <StudioButton data-testid="take-dismiss" variant="subtle" @click="emit('dismiss')">Dismiss</StudioButton>
      <StudioButton data-testid="take-keep" variant="primary" :disabled="busy || !selected" @click="emit('keep')">
        Keep
      </StudioButton>
    </div>
  </div>
</template>
