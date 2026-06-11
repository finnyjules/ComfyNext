<script setup lang="ts">
/**
 * Starting-point gallery shown over the canvas when a layout is empty. Offers
 * the built-in Swiss archetypes (live wireframe previews) plus the user's
 * saved templates. Picking one loads it into the editor.
 */
import { onMounted, ref } from 'vue'

import type { GridEditorContext } from '~/composables/useGridEditor'
import { ARCHETYPES, applyArchetype } from '~~/shared/template-grid/archetypes'
import type { Archetype } from '~~/shared/template-grid/archetypes'
import { resolveFormat } from '~~/shared/template-grid/resolve'
import type { TemplateV2 } from '~~/shared/template-grid/types'

const ctx = inject<GridEditorContext>('gridEditor')!
const { template } = ctx

const PREVIEW_PROPS = { text_layer_1: 'Headline goes here', text_layer_2: 'A supporting subhead line', image_layer_1: '' }

interface Block { left: string; top: string; width: string; height: string; kind: string }

/** Wireframe blocks for an archetype, scaled into a fixed-width thumb. */
function previewBlocks(arch: Archetype, thumbW: number, thumbH: number): Block[] {
  const tpl = applyArchetype(template.value, arch)
  const master = tpl.master
  const f = tpl.formats[master]
  const r = resolveFormat(tpl, master, PREVIEW_PROPS, arch.brand ?? {})
  const sx = thumbW / f.w
  const sy = thumbH / f.h
  return r.elements.filter(e => !e.culled).map(e => ({
    left: `${e.rect.x * sx}px`, top: `${e.rect.y * sy}px`,
    width: `${Math.max(2, e.rect.w * sx)}px`, height: `${Math.max(2, e.rect.h * sy)}px`,
    kind: e.el.type,
  }))
}
function archBg(arch: Archetype): string {
  const fill = arch.background?.fill ?? '#0E0E10'
  return fill.startsWith('{{')
    ? (fill.includes('primary') ? (arch.brand?.primary ?? '#E2362B') : (arch.brand?.background ?? '#0E0E10'))
    : fill
}

const cards = ARCHETYPES.map(a => ({ arch: a, blocks: previewBlocks(a, 168, 168), bg: archBg(a) }))

// -- Saved templates ----------------------------------------------------------

interface SavedMeta { id: string; name: string; version: number; formatCount: number; elementCount: number }
const saved = ref<SavedMeta[]>([])
onMounted(async () => {
  try {
    const res = await fetch('/api/templates')
    const data = await res.json()
    saved.value = (data.items ?? []).filter((t: SavedMeta) => t.version === 2 && t.elementCount > 0)
  } catch { /* gallery still shows built-ins */ }
})

async function loadSaved(id: string) {
  try {
    const res = await fetch(`/api/templates/${id}`)
    if (!res.ok) return
    const full = await res.json() as TemplateV2
    // Keep the node's own id/name; adopt the saved composition + brand.
    ctx.loadTemplate({ ...full, id: template.value.id, name: full.name ?? template.value.name })
  } catch { /* ignore */ }
}

function blockColor(kind: string): string {
  return kind === 'image' ? 'rgba(150,180,255,0.35)' : kind === 'shape' ? 'rgba(226,54,43,0.5)' : 'rgba(255,255,255,0.85)'
}
</script>

<template>
  <div class="absolute inset-0 z-10 overflow-y-auto bg-[#121212]/95 backdrop-blur-sm">
    <div class="max-w-3xl mx-auto px-8 py-10">
      <h2 class="text-[15px] text-white/90 font-medium">Start from a layout</h2>
      <p class="text-[12px] text-white/45 mt-1">Pick a Swiss starting point — it reflows to every ad format. Or add elements yourself from the top bar.</p>

      <div class="grid grid-cols-2 gap-4 mt-6">
        <button
          v-for="c in cards"
          :key="c.arch.id"
          class="text-left rounded-xl border border-white/[0.08] hover:border-[#96b4ff]/50 bg-[#0e0e10] overflow-hidden transition-colors cursor-pointer group"
          @click="ctx.loadArchetype(c.arch)"
        >
          <div class="relative mx-auto my-4 rounded" :style="{ width: '168px', height: '168px', background: c.bg }">
            <div
              v-for="(b, i) in c.blocks"
              :key="i"
              class="absolute rounded-[1px]"
              :style="{ left: b.left, top: b.top, width: b.width, height: b.height, background: blockColor(b.kind) }"
            />
          </div>
          <div class="px-4 pb-3">
            <div class="text-[13px] text-white/85 group-hover:text-white">{{ c.arch.name }}</div>
            <div class="text-[11px] text-white/40 mt-0.5 leading-snug">{{ c.arch.blurb }}</div>
          </div>
        </button>
      </div>

      <template v-if="saved.length">
        <h3 class="text-[12px] uppercase tracking-[0.12em] text-white/35 mt-10 mb-3">Your saved templates</h3>
        <div class="grid grid-cols-3 gap-3">
          <button
            v-for="t in saved"
            :key="t.id"
            class="text-left rounded-lg border border-white/[0.08] hover:border-[#96b4ff]/50 bg-[#0e0e10] p-3 transition-colors cursor-pointer"
            @click="loadSaved(t.id)"
          >
            <div class="text-[12px] text-white/85 truncate">{{ t.name }}</div>
            <div class="text-[10px] text-white/40 mt-0.5">{{ t.elementCount }} elements · {{ t.formatCount }} formats</div>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
