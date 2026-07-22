<!-- frontend/app/components/vue-canvas/SketchStackOverlay.vue -->
<script setup lang="ts">
// The sketch pile's choose-one moment (spec 2026-07-21-sketch-pile-design.md
// §2): canvas dims, the pile's images FLIP-morph from the pile's screen rect
// into a vertical stack at their ON-CANVAS size (pure translate morph, clamped
// 120–320px), and each option offers Develop (img2img finisher) or Keep as
// image. Footer re-rolls the whole batch; while it's in flight the items are
// shimmer placeholders (the payload prop is reactive — items swap in place).
import { RefreshCw, X } from 'lucide-vue-next'
import { stackItemWidth, MAX_SKETCH_ITEMS, type SketchPilePayload } from '~/lib/sketch/sketchPile'

const props = defineProps<{
  payload: SketchPilePayload
  /** The pile cover's screen rect at open time (the morph origin). */
  origin: { x: number, y: number, width: number, height: number }
  /** False when the payload's source generator no longer exists (a pad-flow
   *  pile after reload — the hidden pad is stripped from saved docs). Honest
   *  refusal beats a button that silently does nothing. */
  canReroll: boolean
}>()
const emit = defineEmits<{ develop: [index: number], keep: [index: number], reroll: [], close: [] }>()

const loading = computed(() => !!props.payload.loading)
// While re-rolling show MAX_SKETCH_ITEMS shimmer slots; otherwise the items.
const slots = computed(() =>
  loading.value ? Array.from({ length: MAX_SKETCH_ITEMS }, () => null) : props.payload.items)
const itemW = computed(() => stackItemWidth(props.origin.width))

// FLIP morph: items mount in their final stack slots, get an initial transform
// putting them at the pile's rect, then release to identity with a stagger.
const itemEls = ref<HTMLElement[]>([])
const closing = ref(false)

// The :ref callback only fires with an element (the null-on-unmount call is
// skipped by its `if (el)` guard), so a re-roll landing FEWER items would
// strand detached elements in the array and inflate the close-stagger math.
// Reset before each re-render of the slot list; live refs repopulate.
watch(() => slots.value.length, () => { itemEls.value = [] })

/** The refs that are actually in the document right now. */
function liveItemEls(): HTMLElement[] {
  return itemEls.value.filter(el => el && el.isConnected)
}

function toOrigin(el: HTMLElement): string {
  const r = el.getBoundingClientRect()
  const s = r.width ? props.origin.width / r.width : 1
  return `translate(${props.origin.x - r.left}px, ${props.origin.y - r.top}px) scale(${s})`
}

onMounted(async () => {
  await nextTick()
  const els = liveItemEls()
  for (const el of els) {
    el.style.transform = toOrigin(el)
    el.style.opacity = '0.5'
  }
  void document.body.offsetHeight // commit start states before transitioning
  els.forEach((el, i) => {
    el.style.transition = `transform 220ms cubic-bezier(.2,.8,.2,1) ${i * 40}ms, opacity 180ms ease ${i * 40}ms`
    el.style.transform = ''
    el.style.opacity = '1'
  })
})

function requestClose() {
  if (closing.value) return
  closing.value = true
  const els = liveItemEls()
  els.forEach((el, i) => {
    el.style.transition = `transform 200ms cubic-bezier(.4,0,.8,.4) ${(els.length - 1 - i) * 30}ms, opacity 180ms ease ${(els.length - 1 - i) * 30}ms`
    el.style.transform = toOrigin(el)
    el.style.opacity = '0'
  })
  window.setTimeout(() => emit('close'), 200 + els.length * 30)
}

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') requestClose() }
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="fixed inset-0 z-[95] bg-black/70 overflow-y-auto" @click.self="requestClose">
    <div class="min-h-full flex flex-col items-center justify-center gap-3 py-10" @click.self="requestClose">
      <div
        v-for="(item, i) in slots"
        :key="i"
        :ref="el => { if (el) itemEls[i] = el as HTMLElement }"
        class="group relative shrink-0"
        :style="{ width: itemW + 'px', transformOrigin: 'top left' }"
      >
        <template v-if="item">
          <img :src="item.image" class="block w-full rounded-lg border border-white/20 shadow-xl" draggable="false">
          <!-- hover actions — mirrors the retired card footer: Keep outline,
               Develop solid-white primary (never emerald: no spend here) -->
          <div class="absolute inset-x-0 bottom-0 p-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/60 to-transparent rounded-b-lg">
            <!-- Same button idiom as the studio node footers (Edit / Render). -->
            <button
              class="flex flex-1 items-center justify-center rounded bg-white/10 px-2.5 py-1.5 text-[11px] text-white/80 transition hover:bg-white/20 cursor-pointer"
              title="Keep this option — it lands beside the pile as a regular Image card"
              @click.stop="emit('keep', i)"
            >
              Keep
            </button>
            <button
              class="flex flex-[1.4] items-center justify-center rounded bg-white/90 px-2 py-1.5 text-[11px] font-medium text-neutral-900 transition hover:bg-white cursor-pointer"
              title="Turn this rough into a finished, detailed image — keeps the composition"
              @click.stop="emit('develop', i)"
            >
              Develop
            </button>
          </div>
        </template>
        <div v-else class="stack-skeleton gen-stroke w-full rounded-lg" :style="{ height: Math.round(itemW * 0.75) + 'px' }" aria-label="Sketching…" />
      </div>

      <div class="shrink-0 flex items-center gap-2 mt-2 nopan">
        <button
          class="flex items-center gap-1.5 h-8 px-3 rounded-md bg-white/10 hover:bg-white/15 border border-white/15 text-xs text-white/85 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
          :disabled="loading || !canReroll"
          :title="canReroll
            ? 'Re-roll all 4 — same idea, fresh seed'
            : 'Re-roll unavailable — this pile\'s sketch generator is gone (saved docs drop it). Sketch again from the prompt bar.'"
          @click.stop="emit('reroll')"
        >
          <RefreshCw class="size-3.5" :class="loading ? 'animate-spin' : ''" />
          Re-roll all 4
        </button>
        <button
          class="size-8 rounded-md hover:bg-white/10 flex items-center justify-center text-white/60 cursor-pointer"
          title="Close"
          @click.stop="requestClose"
        >
          <X class="size-4" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Same neutral shimmer fill as the pile skeleton; the stroke is the shared
   .gen-stroke rotating translucent gradient ring (main.css). */
.stack-skeleton {
  background: linear-gradient(100deg, rgba(255,255,255,.04) 40%, rgba(255,255,255,.10) 50%, rgba(255,255,255,.04) 60%);
  background-size: 200% 100%;
  animation: stack-shimmer 1.1s linear infinite;
}
@keyframes stack-shimmer { to { background-position: -200% 0; } }
</style>
