<script setup lang="ts">
/**
 * TakesStrip — a thumbnail row of a node's takes (Phase 1 prototype).
 * Presentational: parent owns the data and applies the change on `select`.
 * See docs/plans/2026-06-02-creative-studio-project-takes-design.md.
 */
import { Star, X } from 'lucide-vue-next'
import type { Take } from '~/composables/useTakes'

defineProps<{
  takes: Take[]
  activeTakeId: string | null | undefined
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'pin', id: string): void
  (e: 'discard', id: string): void
}>()

function thumb(t: Take): string | null {
  return t.images?.[0] ?? null
}
</script>

<template>
  <div class="border-t border-[#2a2a2a] px-2 py-2">
    <div class="flex items-center gap-1.5 mb-1.5">
      <span class="text-[10px] uppercase tracking-wide text-white/40">Takes</span>
      <span class="text-[10px] text-white/30 tabular-nums">{{ takes.length }}</span>
    </div>
    <!-- nowheel/nopan/nodrag: let the strip scroll without the canvas hijacking
         the wheel (zoom) or drag (pan). px/py give the active take's outer ring
         room so overflow-x-auto's vertical clip doesn't shave the thumbnail tops. -->
    <div class="nowheel nopan nodrag flex items-center gap-1.5 overflow-x-auto px-0.5 py-1.5">
      <div
        v-for="t in takes"
        :key="t.id"
        class="group relative shrink-0 size-12 rounded-md overflow-hidden cursor-pointer ring-1 transition-all"
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

        <!-- hover actions -->
        <div
          class="absolute inset-x-0 bottom-0 flex items-center justify-end gap-0.5 p-0.5 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
        >
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
    </div>
  </div>
</template>
