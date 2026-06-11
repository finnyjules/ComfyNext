<script setup lang="ts">
/**
 * Format strip for the grid editor: one tab per output format with a live
 * wireframe thumbnail (resolver-positioned blocks), the format label, and a
 * culled-element count. Clicking a tab switches the canvas to that format.
 */
import type { GridEditorContext } from '~/composables/useGridEditor'
import type { ResolvedLayout } from '~~/shared/template-grid/resolve'

const ctx = inject<GridEditorContext>('gridEditor')!
const { template, currentFormat, resolvedAll, selectedId, setFormat } = ctx

const THUMB_H = 36

interface Tab {
  key: string
  label: string
  w: number
  h: number
  thumbW: number
  cls: string
  isMaster: boolean
  culledCount: number
  blocks: Array<{ id: string; left: string; top: string; width: string; height: string; selected: boolean }>
}

const tabs = computed<Tab[]>(() => Object.entries(template.value.formats).map(([key, f]) => {
  const r: ResolvedLayout | undefined = resolvedAll.value[key]
  const thumbW = Math.max(24, Math.min(96, Math.round(THUMB_H * (f.w / f.h))))
  const sx = thumbW / f.w
  const sy = THUMB_H / f.h
  const blocks = (r?.elements ?? []).filter(e => !e.culled).map(e => ({
    id: e.el.id,
    left: `${e.rect.x * sx}px`,
    top: `${e.rect.y * sy}px`,
    width: `${Math.max(1, e.rect.w * sx)}px`,
    height: `${Math.max(1, e.rect.h * sy)}px`,
    selected: e.el.id === selectedId.value,
  }))
  return {
    key,
    label: f.label ?? key,
    w: f.w, h: f.h,
    thumbW,
    cls: r?.formatClass ?? 'square',
    isMaster: key === template.value.master,
    culledCount: (r?.elements ?? []).filter(e => e.culled).length,
    blocks,
  }
}))
</script>

<template>
  <div class="flex items-stretch gap-1 overflow-x-auto py-1" style="scrollbar-width: none">
    <button
      v-for="t in tabs"
      :key="t.key"
      class="shrink-0 flex flex-col items-center gap-1 px-2 py-1 rounded-md border transition-colors cursor-pointer"
      :class="currentFormat === t.key
        ? 'border-[#96b4ff]/60 bg-[#96b4ff]/10'
        : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]'"
      :title="`${t.label} · ${t.w}×${t.h} · ${t.cls}`"
      @click="setFormat(t.key)"
    >
      <div class="relative bg-black/60 border border-white/10 rounded-[2px]" :style="{ width: t.thumbW + 'px', height: '36px' }">
        <div
          v-for="b in t.blocks"
          :key="b.id"
          class="absolute rounded-[1px]"
          :class="b.selected ? 'bg-[#96b4ff]/80' : 'bg-white/25'"
          :style="{ left: b.left, top: b.top, width: b.width, height: b.height }"
        />
        <span
          v-if="t.culledCount"
          class="absolute -top-1.5 -right-1.5 min-w-3.5 h-3.5 px-0.5 rounded-full bg-amber-500/90 text-black text-[9px] font-medium flex items-center justify-center leading-none"
          :title="`${t.culledCount} element(s) culled in this format`"
        >–{{ t.culledCount }}</span>
      </div>
      <span class="text-[9px] leading-none" :class="currentFormat === t.key ? 'text-[#c9d6ff]' : 'text-white/40'">
        {{ t.key }}<span v-if="t.isMaster" class="text-[#96b4ff]"> ·M</span>
      </span>
    </button>
  </div>
</template>
