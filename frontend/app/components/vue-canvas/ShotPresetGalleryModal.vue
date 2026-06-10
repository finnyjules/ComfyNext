<script setup lang="ts">
/**
 * ShotPresetGalleryModal — picker for the "Film a shot" node. Cards render a
 * data-driven CSS thumbnail (person silhouette + motion arrow + overlay), the
 * recipe line, and the mood pitch. Selecting writes the preset id into the
 * node's `preset` widget and closes.
 *
 * State path mirrors TextEffectGalleryModal:
 *   node.widgetsValues[preset_idx] = selected preset id
 */
import { X } from 'lucide-vue-next'
import {
  SHOT_PRESETS, SHOT_CATEGORY_LABELS,
  type ShotPreset, type ShotCategory, type ShotArrow,
} from '~/data/shot-presets'

const props = defineProps<{
  nodeId: string
  nodes: any[]
}>()
const emit = defineEmits<{ close: [] }>()

const node = computed(() => props.nodes.find(n => n.id === props.nodeId))

const presetWidgetIdx = computed(() => {
  const defs = (node.value?.data?.widgetDefs ?? []) as any[]
  return defs.findIndex(d => d.name === 'preset')
})
const currentPresetId = computed<string | null>(() => {
  const idx = presetWidgetIdx.value
  if (idx < 0) return null
  const v = node.value?.data?.widgetsValues?.[idx]
  return typeof v === 'string' ? v : null
})

// -- Filtering ---------------------------------------------------------------

const searchQuery = ref('')
const activeFilterId = ref<string>('all')

const filters = computed(() => {
  const cats: ShotCategory[] = ['movement', 'angle', 'lens', 'composition']
  const counts = new Map<ShotCategory, number>()
  for (const p of SHOT_PRESETS) counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  return [
    { id: 'all', label: 'All', count: SHOT_PRESETS.length },
    ...cats.map(c => ({ id: c, label: SHOT_CATEGORY_LABELS[c], count: counts.get(c) ?? 0 })),
  ]
})

const visibleItems = computed<ShotPreset[]>(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return SHOT_PRESETS.filter((p) => {
    if (activeFilterId.value !== 'all' && p.category !== activeFilterId.value) return false
    if (!q) return true
    return [p.label, p.recipe, p.pitch].some(s => s.toLowerCase().includes(q))
  })
})

// -- Selection ---------------------------------------------------------------

function pick(id: string) {
  const idx = presetWidgetIdx.value
  if (idx < 0 || !node.value) return
  const wv = [...(node.value.data.widgetsValues ?? [])]
  wv[idx] = id
  node.value.data = { ...node.value.data, widgetsValues: wv }
  emit('close')
}

// -- Thumbnail helpers ---------------------------------------------------------

const ARROW_GLYPHS: Record<ShotArrow, string> = {
  in: '»', out: '«', up: '↑', upright: '↗', down: '↓', right: '→',
  orbit: '⟲', shake: '↯', dive: '⤵', flow: '⤳', rack: '⇄', none: '',
}
function arrowGlyph(p: ShotPreset): string {
  return ARROW_GLYPHS[p.thumb.arrow ?? 'none']
}
</script>

<template>
  <div class="fixed inset-0 z-[90] flex items-center justify-center" @click.self="emit('close')">
    <div class="absolute inset-0 bg-black/70 backdrop-blur-sm" @click="emit('close')" />
    <div class="relative w-[860px] max-w-[92vw] max-h-[84vh] flex flex-col rounded-2xl border border-white/10 bg-[#101216] shadow-2xl overflow-hidden">

      <!-- Header -->
      <div class="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-white/[0.08]">
        <div class="flex-1 min-w-0">
          <h2 class="text-sm font-semibold text-white/90">Pick a shot</h2>
          <p class="text-[11px] text-white/40">Each preset is a full recipe — size, angle, movement, lens, composition. Tweak any dimension under ADVANCED after picking.</p>
        </div>
        <input
          v-model="searchQuery"
          placeholder="Search shots…"
          class="w-44 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[12px] text-white/85 placeholder:text-white/30 focus:outline-none focus:border-white/25"
        >
        <button class="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white/90" @click="emit('close')">
          <X class="size-4" />
        </button>
      </div>

      <!-- Category chips -->
      <div class="flex items-center gap-1.5 px-5 py-2.5 border-b border-white/[0.08]">
        <button
          v-for="f in filters" :key="f.id"
          class="px-2.5 py-1 rounded-full text-[11px] transition-colors"
          :class="activeFilterId === f.id ? 'bg-white/15 text-white' : 'bg-white/5 text-white/50 hover:text-white/80'"
          @click="activeFilterId = f.id"
        >
          {{ f.label }} <span class="opacity-50">{{ f.count }}</span>
        </button>
      </div>

      <!-- Grid -->
      <div class="flex-1 overflow-y-auto p-4 grid grid-cols-3 gap-3 content-start">
        <button
          v-for="p in visibleItems" :key="p.id"
          class="text-left rounded-xl border p-2.5 transition-colors group"
          :class="currentPresetId === p.id
            ? 'border-blue-400/70 bg-blue-400/10'
            : 'border-white/10 bg-white/[0.03] hover:border-white/25'"
          @click="pick(p.id)"
        >
          <!-- CSS thumbnail -->
          <div
            class="relative h-20 rounded-lg overflow-hidden mb-2"
            style="background: linear-gradient(135deg, #232a3a, #161a23)"
            :style="p.thumb.tilt ? { transform: `rotate(${p.thumb.tilt}deg)` } : {}"
          >
            <!-- doorframe bars -->
            <template v-if="p.thumb.overlay === 'doorframe'">
              <div class="absolute left-0 top-0 bottom-0 w-[26%] bg-[#0c0e12]" />
              <div class="absolute right-0 top-0 bottom-0 w-[18%] bg-[#0c0e12]" />
            </template>
            <!-- mirror panel -->
            <div v-if="p.thumb.overlay === 'mirror'" class="absolute right-[12%] top-[10%] bottom-[10%] w-[30%] rounded-sm border-2 border-[#3a4154] bg-[#1d2230]" />
            <!-- blur disc (macro / rack / telephoto) -->
            <div v-if="p.thumb.overlay === 'blur'" class="absolute inset-0" style="background: radial-gradient(circle at 50% 50%, transparent 24%, rgba(16,20,28,.78) 62%)" />
            <!-- streak (motion blur / anamorphic flare) -->
            <div v-if="p.thumb.overlay === 'streak'" class="absolute left-0 right-0 top-1/2 h-[2px]" style="background: linear-gradient(to right, transparent, rgba(110,160,255,.7), transparent)" />
            <!-- OTS foreground shoulder -->
            <div v-if="p.thumb.overlay === 'shoulder'" class="absolute -left-2 -bottom-2 w-12 h-12 rounded-t-xl bg-[#252b37]" />
            <!-- POV hands -->
            <template v-if="p.thumb.overlay === 'hands'">
              <div class="absolute bottom-[-4px] left-[16%] w-5 h-7 rounded-t-lg bg-[#3a3022]" />
              <div class="absolute bottom-[-4px] right-[16%] w-5 h-7 rounded-t-lg bg-[#3a3022]" />
            </template>
            <!-- person silhouette -->
            <div
              v-if="(p.thumb.scale ?? 1) > 0"
              class="absolute left-1/2"
              :style="{ top: `${p.thumb.top ?? 22}%`, transform: `translateX(-50%) scale(${p.thumb.scale ?? 1})` }"
            >
              <div class="w-3.5 h-3.5 rounded-full bg-[#e8b06d] mx-auto" />
              <div class="w-[26px] h-5 rounded-t-lg bg-[#5b8dd9] -mt-0.5 mx-auto" />
            </div>
            <!-- motion arrow -->
            <span
              v-if="arrowGlyph(p)"
              class="absolute right-2 top-1.5 text-[#7ee08a] font-bold text-base leading-none"
            >{{ arrowGlyph(p) }}</span>
          </div>

          <div class="text-[12px] font-medium text-white/90 leading-tight">{{ p.label }}</div>
          <div class="text-[10px] text-white/45 leading-snug mt-0.5">{{ p.recipe }}</div>
          <div class="text-[10px] text-blue-300/70 italic leading-snug mt-0.5">{{ p.pitch }}</div>
        </button>
      </div>
    </div>
  </div>
</template>
