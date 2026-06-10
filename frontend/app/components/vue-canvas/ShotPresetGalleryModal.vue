<script setup lang="ts">
/**
 * ShotPresetGalleryModal — picker for the "Film a shot" node. Cards render a
 * data-driven CSS thumbnail (person silhouette + motion arrow + overlay), the
 * recipe line, and the mood pitch. Selecting writes the preset id into the
 * node's `preset` widget and closes.
 *
 * Built on CatalogModal (Teleport, Transition, Esc, keyboard nav — all free).
 *
 * State path mirrors TextEffectGalleryModal:
 *   node.widgetsValues[preset_idx] = selected preset id  (direct mutation)
 */
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

// -- Widget index + current value -------------------------------------------

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

// -- Confirm -----------------------------------------------------------------

function onConfirm(item: ShotPreset) {
  const idx = presetWidgetIdx.value
  if (idx < 0 || !node.value) { emit('close'); return }
  node.value.data.widgetsValues[idx] = item.id
  emit('close')
}

// -- Thumbnail helpers -------------------------------------------------------

const ARROW_GLYPHS: Record<ShotArrow, string> = {
  in: '»', out: '«', up: '↑', upright: '↗', down: '↓', right: '→',
  orbit: '⟲', shake: '↯', dive: '⤵', flow: '⤳', rack: '⇄', none: '',
}
function arrowGlyph(p: ShotPreset): string {
  return ARROW_GLYPHS[p.thumb.arrow ?? 'none']
}
</script>

<template>
  <CatalogModal
    :open="true"
    title="Pick a shot"
    subtitle="Each preset is a full recipe — size, angle, movement, lens, composition. Tweak any dimension under ADVANCED after picking."
    :items="visibleItems"
    :selected-id="currentPresetId"
    :filters="filters"
    :active-filter-id="activeFilterId"
    :search-query="searchQuery"
    search-placeholder="Search shots…"
    :confirm-label="'Use this shot'"
    empty-message="No shots match."
    @close="emit('close')"
    @confirm="(item: any) => onConfirm(item as ShotPreset)"
    @update:active-filter-id="(id: string) => activeFilterId = id"
    @update:search-query="(q: string) => searchQuery = q"
  >
    <!-- Card: data-driven CSS thumbnail + label / recipe / pitch lines. -->
    <template #card="{ item }">
      <!-- overflow-hidden keeps the tilted frame from bleeding past rounded corners -->
      <div class="relative h-20 overflow-hidden" style="background: linear-gradient(135deg, #232a3a, #161a23)">
        <!-- tilt wrapper — only the inner content tilts, not the card border -->
        <div
          class="absolute inset-0"
          :style="(item as ShotPreset).thumb.tilt ? { transform: `rotate(${(item as ShotPreset).thumb.tilt}deg)` } : {}"
        >
          <!-- doorframe bars -->
          <template v-if="(item as ShotPreset).thumb.overlay === 'doorframe'">
            <div class="absolute left-0 top-0 bottom-0 w-[26%] bg-[#0c0e12]" />
            <div class="absolute right-0 top-0 bottom-0 w-[18%] bg-[#0c0e12]" />
          </template>
          <!-- mirror panel -->
          <div
            v-if="(item as ShotPreset).thumb.overlay === 'mirror'"
            class="absolute right-[12%] top-[10%] bottom-[10%] w-[30%] rounded-sm border-2 border-[#3a4154] bg-[#1d2230]"
          />
          <!-- blur disc (macro / rack / telephoto) -->
          <div
            v-if="(item as ShotPreset).thumb.overlay === 'blur'"
            class="absolute inset-0"
            style="background: radial-gradient(circle at 50% 50%, transparent 24%, rgba(16,20,28,.78) 62%)"
          />
          <!-- streak (motion blur / anamorphic flare) -->
          <div
            v-if="(item as ShotPreset).thumb.overlay === 'streak'"
            class="absolute left-0 right-0 top-1/2 h-[2px]"
            style="background: linear-gradient(to right, transparent, rgba(110,160,255,.7), transparent)"
          />
          <!-- OTS foreground shoulder -->
          <div
            v-if="(item as ShotPreset).thumb.overlay === 'shoulder'"
            class="absolute -left-2 -bottom-2 w-12 h-12 rounded-t-xl bg-[#252b37]"
          />
          <!-- POV hands -->
          <template v-if="(item as ShotPreset).thumb.overlay === 'hands'">
            <div class="absolute bottom-[-4px] left-[16%] w-5 h-7 rounded-t-lg bg-[#3a3022]" />
            <div class="absolute bottom-[-4px] right-[16%] w-5 h-7 rounded-t-lg bg-[#3a3022]" />
          </template>
          <!-- person silhouette -->
          <div
            v-if="((item as ShotPreset).thumb.scale ?? 1) > 0"
            class="absolute left-1/2"
            :style="{
              top: `${(item as ShotPreset).thumb.top ?? 22}%`,
              transform: `translateX(-50%) scale(${(item as ShotPreset).thumb.scale ?? 1})`,
            }"
          >
            <div class="w-3.5 h-3.5 rounded-full bg-[#e8b06d] mx-auto" />
            <div class="w-[26px] h-5 rounded-t-lg bg-[#5b8dd9] -mt-0.5 mx-auto" />
          </div>
          <!-- motion arrow -->
          <span
            v-if="arrowGlyph(item as ShotPreset)"
            class="absolute right-2 top-1.5 text-[#7ee08a] font-bold text-base leading-none"
          >{{ arrowGlyph(item as ShotPreset) }}</span>
        </div>
      </div>

      <div class="px-3 pt-2 pb-3 flex flex-col gap-0.5">
        <div class="text-[12px] font-medium text-white/90 leading-tight">{{ (item as ShotPreset).label }}</div>
        <div class="text-[10px] text-white/45 leading-snug">{{ (item as ShotPreset).recipe }}</div>
        <div class="text-[10px] text-blue-300/70 italic leading-snug">{{ (item as ShotPreset).pitch }}</div>
      </div>
    </template>
  </CatalogModal>
</template>
