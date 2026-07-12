<script setup lang="ts">
/**
 * Light Table — spread a node's takes on a grid and compare (spec:
 * 2026-07-07-sketchbook-loop-design.md §Light Table). Presentational like
 * TakesStrip: the parent owns the takes array and applies every change.
 * Keyboard-first: arrows / Enter / Cmd+Enter / P / X / Space / Esc.
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Star, X, ArrowUpToLine, GitBranch, PencilLine, Trash2 } from 'lucide-vue-next'
import type { Take } from '~/composables/useTakes'
import { diffTakeParams } from '~/lib/artifact/takeDiff'
import { keyToLightTableAction } from '~/lib/artifact/lightTableKeymap'

const props = defineProps<{
  takes: Take[]
  activeTakeId: string | null | undefined
  title?: string
  /** e.g. "~$0.03" — shown on Promote buttons; null hides the price. */
  promoteUsdLabel?: string | null
  /** Hosted on a Sketch node — every take is promotable even though it carries
   *  no `draft` flag (sketch bakes the fast model into widgets, not the mode). */
  sketch?: boolean
}>()

/** A take shows Promote when it's a mode-draft OR it lives on a sketch card. */
function canPromote(t: Take): boolean {
  return !!t.draft || !!props.sketch
}

const emit = defineEmits<{
  (e: 'select' | 'pin' | 'discard' | 'promote' | 'branch', id: string): void
  (e: 'discardOthers', keepId: string): void
  (e: 'close'): void
}>()

const focusedId = ref<string | null>(props.takes.at(-1)?.id ?? null)
const compareId = ref<string | null>(null)   // shift-click second selection
const lightboxId = ref<string | null>(null)

// Seed/repair focus as takes stream in or get discarded: focus the newest
// take when nothing valid is focused.
watch(() => props.takes, (takes) => {
  if (!takes.length) { focusedId.value = null; return }
  if (!takes.some(t => t.id === focusedId.value)) focusedId.value = takes.at(-1)!.id
}, { deep: false })

const focusedIdx = computed(() => props.takes.findIndex(t => t.id === focusedId.value))
const focused = computed(() => props.takes[focusedIdx.value] ?? null)
const compare = computed(() => props.takes.find(t => t.id === compareId.value) ?? null)
const diffRows = computed(() =>
  focused.value && compare.value && focused.value.id !== compare.value.id
    ? diffTakeParams(focused.value, compare.value)
    : [],
)

// Grid geometry for arrow navigation: measured columns-per-row.
const gridEl = ref<HTMLElement | null>(null)
function columns(): number {
  const el = gridEl.value
  if (!el) return 4
  return Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').length)
}

function move(dx: number, dy: number) {
  const idx = focusedIdx.value < 0 ? props.takes.length - 1 : focusedIdx.value
  const next = Math.min(props.takes.length - 1, Math.max(0, idx + dx + dy * columns()))
  focusedId.value = props.takes[next]?.id ?? focusedId.value
}

function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  const action = keyToLightTableAction(e)
  if (!action) return
  e.preventDefault()
  e.stopPropagation()
  const id = lightboxId.value ?? focusedId.value
  switch (action.type) {
    case 'move':
      if (lightboxId.value) {
        // In the lightbox, arrows flip between takes at identical framing (v1 A/B).
        const i = props.takes.findIndex(x => x.id === lightboxId.value)
        const n = Math.min(props.takes.length - 1, Math.max(0, i + action.dx + action.dy))
        lightboxId.value = props.takes[n]?.id ?? lightboxId.value
        focusedId.value = lightboxId.value
      } else {
        move(action.dx, action.dy)
      }
      break
    case 'setActive': if (id) emit('select', id); break
    case 'pin': if (id) emit('pin', id); break
    case 'discard': if (id) emit('discard', id); break
    case 'promote': {
      const take = props.takes.find(x => x.id === id)
      if (take && canPromote(take)) emit('promote', take.id)
      break
    }
    case 'lightbox': lightboxId.value = lightboxId.value ? null : focusedId.value; break
    case 'close':
      if (lightboxId.value) lightboxId.value = null
      else emit('close')
      break
  }
}

function onCellClick(t: Take, e: MouseEvent) {
  if (e.shiftKey && focusedId.value && focusedId.value !== t.id) compareId.value = t.id
  else { focusedId.value = t.id; compareId.value = null }
}

function fmt(v: any): string {
  if (v === undefined) return '—'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 60 ? s.slice(0, 57) + '…' : s
}

onMounted(() => window.addEventListener('keydown', onKeydown, true))
onUnmounted(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[90] flex flex-col bg-black/80 backdrop-blur-sm" @click.self="emit('close')">
      <!-- header -->
      <div class="flex items-center justify-between px-5 py-3 shrink-0">
        <div class="text-sm font-medium text-white/80">
          {{ title || 'Takes' }}
          <span class="text-white/40 ml-2">{{ takes.length }} take{{ takes.length === 1 ? '' : 's' }}</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="focused"
            class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer"
            title="Keep the focused + pinned takes, discard the rest"
            @click="emit('discardOthers', focused.id)"
          >
            <Trash2 class="size-3" /> Keep this, discard others
          </button>
          <button class="text-white/50 hover:text-white cursor-pointer" @click="emit('close')">
            <X class="size-4" />
          </button>
        </div>
      </div>

      <!-- grid -->
      <div ref="gridEl" class="grid gap-3 px-5 pb-3 overflow-y-auto grow" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); align-content: start">
        <div
          v-for="t in takes"
          :key="t.id"
          class="group relative rounded-lg overflow-hidden bg-white/[0.03] ring-1 cursor-pointer transition-shadow"
          :class="[
            t.id === focusedId ? 'ring-2 ring-action' : t.id === compareId ? 'ring-2 ring-amber-300/70' : 'ring-white/10 hover:ring-white/25',
            t.id === activeTakeId ? 'outline outline-1 outline-offset-2 outline-action/60' : '',
          ]"
          @click="onCellClick(t, $event)"
          @dblclick="lightboxId = t.id"
        >
          <img v-if="t.images?.[0]" :src="t.images[0]" class="w-full aspect-square object-contain bg-black/40" loading="lazy" />
          <div v-else class="w-full aspect-square flex items-center justify-center text-xs text-white/40">{{ t.text ? 'text' : t.audios?.length ? 'audio' : '—' }}</div>

          <!-- chips -->
          <div class="absolute inset-x-0 top-0 flex items-center gap-1 p-1.5 text-[10px]">
            <span v-if="t.draft" class="flex items-center gap-1 rounded border border-dashed border-white/50 bg-black/60 px-1 py-0.5 text-white/80"><PencilLine class="size-2.5" /> draft</span>
            <span v-if="t.promotedFrom" class="rounded bg-black/60 px-1 py-0.5 text-action border border-action/30">promoted</span>
            <span v-if="t.params?.seed !== undefined" class="rounded bg-black/60 px-1 py-0.5 text-white/60">seed {{ t.params.seed }}</span>
            <Star v-if="t.pinned" class="size-3 text-amber-300 fill-amber-300 ml-auto" />
          </div>

          <!-- hover actions -->
          <div class="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1 p-1.5 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
            <button v-if="canPromote(t)" class="flex items-center gap-1 rounded bg-white/10 hover:bg-white/20 px-1.5 py-0.5 text-[10px] text-white cursor-pointer" :title="sketch ? 'Promote — spawn the full generator beside this sketch' : 'Re-render at full quality' + (promoteUsdLabel ? ` · ${promoteUsdLabel}` : '')" @click.stop="emit('promote', t.id)">
              <ArrowUpToLine class="size-3" /> Promote<span v-if="promoteUsdLabel" class="text-white/50">{{ promoteUsdLabel }}</span>
            </button>
            <button class="rounded bg-white/10 hover:bg-white/20 p-1 text-white/80 cursor-pointer" title="Continue from this take on a new Image node" @click.stop="emit('branch', t.id)"><GitBranch class="size-3" /></button>
            <button class="rounded bg-white/10 hover:bg-white/20 p-1 text-white/80 cursor-pointer" :title="t.pinned ? 'Unpin' : 'Pin'" @click.stop="emit('pin', t.id)"><Star class="size-3" :class="{ 'fill-amber-300 text-amber-300': t.pinned }" /></button>
            <button class="rounded bg-white/10 hover:bg-red-500/30 p-1 text-white/80 cursor-pointer" title="Discard take" @click.stop="emit('discard', t.id)"><X class="size-3" /></button>
          </div>
        </div>
      </div>

      <!-- diff row (two selected takes) -->
      <div v-if="diffRows.length" class="shrink-0 border-t border-white/10 bg-black/60 px-5 py-2 flex flex-wrap gap-x-6 gap-y-1">
        <span class="text-[11px] text-white/40 w-full">Differences (focused vs shift-selected)</span>
        <span v-for="row in diffRows" :key="row.key" class="text-[11px] text-white/70">
          <span class="text-white/40">{{ row.key }}:</span> {{ fmt(row.a) }} <span class="text-white/30">→</span> {{ fmt(row.b) }}
        </span>
      </div>

      <!-- lightbox -->
      <div v-if="lightboxId" class="absolute inset-0 z-10 bg-black/95 flex items-center justify-center" @click="lightboxId = null">
        <img v-if="takes.find(t => t.id === lightboxId)?.images?.[0]" :src="takes.find(t => t.id === lightboxId)!.images![0]" class="max-w-[92vw] max-h-[92vh] object-contain" />
        <div class="absolute bottom-4 inset-x-0 text-center text-[11px] text-white/40">← → to flip · Space or Esc to close</div>
      </div>
    </div>
  </Teleport>
</template>
