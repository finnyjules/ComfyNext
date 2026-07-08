<script setup lang="ts">
/**
 * TakesStrip — a thumbnail row of a node's takes (Phase 1 prototype).
 * Presentational: parent owns the data and applies the change on `select`.
 * See docs/plans/2026-06-02-creative-studio-project-takes-design.md.
 */
import { Star, X, PencilLine, Maximize2, ArrowUpToLine } from 'lucide-vue-next'
import type { Take } from '~/composables/useTakes'

defineProps<{
  takes: Take[]
  activeTakeId: string | null | undefined
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'pin', id: string): void
  (e: 'discard', id: string): void
  (e: 'expand'): void
  (e: 'promote', id: string): void
}>()

function thumb(t: Take): string | null {
  return t.images?.[0] ?? null
}
</script>

<template>
  <div class="border-t border-[#2a2a2a] px-2 py-1">
    <!-- nowheel/nopan/nodrag: let the strip scroll without the canvas hijacking
         the wheel (zoom) or drag (pan). px/py give the active take's outer ring
         room so overflow-x-auto's vertical clip doesn't shave the thumbnail tops. -->
    <div class="nowheel nopan nodrag flex items-center gap-1.5 overflow-x-auto px-0.5 py-1.5">
      <div
        v-for="t in takes"
        :key="t.id"
        class="group relative shrink-0 size-12 rounded-md overflow-hidden cursor-pointer ring-1 transition-shadow"
        :class="t.id === activeTakeId
          ? 'ring-2 ring-[#96b4ff]'
          : 'ring-white/10 hover:ring-white/30'"
        :title="t.label || new Date(t.createdAt).toLocaleTimeString()"
        @click.stop="emit('select', t.id)"
      >
        <img
          v-if="thumb(t)"
          :src="thumb(t)!"
          class="size-full object-cover"
          loading="lazy"
        />
        <video
          v-else-if="t.videos?.length"
          :src="t.videos[0]"
          class="size-full object-cover"
          muted
          playsinline
          preload="metadata"
        />
        <div
          v-else
          class="size-full flex items-center justify-center bg-white/[0.04] text-[9px] text-white/40"
        >
          {{ t.audios?.length ? 'audio' : t.text ? 'text' : '—' }}
        </div>

        <!-- pinned marker -->
        <Star
          v-if="t.pinned"
          class="absolute top-0.5 left-0.5 size-3 text-amber-300 fill-amber-300 drop-shadow"
        />

        <!-- draft marker: dashed sketch chip (NOT pastel — pastel means AI) -->
        <span
          v-if="t.draft"
          class="absolute top-0.5 right-0.5 flex items-center justify-center size-3.5 rounded-[3px] border border-dashed border-white/60 bg-black/50"
          title="Draft render — promote for full quality"
        >
          <PencilLine class="size-2 text-white/80" />
        </span>

        <!-- hover actions -->
        <div
          class="absolute inset-x-0 bottom-0 flex items-center justify-end gap-0.5 p-0.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <button
            v-if="t.draft"
            class="size-4 rounded-sm flex items-center justify-center text-white/70 hover:text-emerald-300"
            title="Promote to full quality"
            @click.stop="emit('promote', t.id)"
          >
            <ArrowUpToLine class="size-3" />
          </button>
          <button
            class="size-4 rounded-sm flex items-center justify-center text-white/70 hover:text-amber-300"
            :title="t.pinned ? 'Unpin' : 'Pin to library'"
            @click.stop="emit('pin', t.id)"
          >
            <Star class="size-3" :class="{ 'fill-amber-300 text-amber-300': t.pinned }" />
          </button>
          <button
            class="size-4 rounded-sm flex items-center justify-center text-white/70 hover:text-red-400"
            title="Discard take"
            @click.stop="emit('discard', t.id)"
          >
            <X class="size-3" />
          </button>
        </div>
      </div>

      <button
        v-if="takes.length"
        class="shrink-0 size-12 rounded-md flex items-center justify-center ring-1 ring-white/10 text-white/50 hover:text-white hover:ring-white/30 cursor-pointer"
        title="Open Light Table (compare takes)"
        @click.stop="emit('expand')"
      >
        <Maximize2 class="size-4" />
      </button>
    </div>
  </div>
</template>
