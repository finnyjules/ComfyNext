<script setup lang="ts">
/** Jitter-style preset gallery: grouped sections, 2-up cards with live
 *  thumbnails, a disabled "Custom" tail card (the property-keyframe milestone's
 *  entry point). Teleported to body so the inspector's overflow doesn't clip it.
 *  Must stack above CompositorModal's z-[100] context (z-[110] backdrop, z-[111] panel). */
import { SUPPORTED_IN_IDS, SUPPORTED_OUT_IDS, SUPPORTED_LOOP_IDS } from '~/lib/motion/evaluate'
import { KINETIC_PRESETS_BY_ID, KINETIC_GROUP_LABELS, type KineticGroup } from '~/data/kinetic-presets'
import PresetThumb from '~/components/vue-canvas/compositor/PresetThumb.vue'
import { X } from 'lucide-vue-next'

const props = defineProps<{
  slotKind: 'in' | 'out' | 'loop'
  currentId: string | null
  anchorRect: { top: number; left: number; width: number } | null
  layerKind?: string
}>()
const emit = defineEmits<{ pick: [id: string]; clear: []; close: [] }>()

// v1 limitation: copy-based presets (echoes/tiles) draw extra whole-unit
// copies, which per-char text animation can't express — hidden for text layers.
const COPY_BASED_IDS = new Set(['inward-echoes', 'grid-scroll-x', 'grid-scroll-y', 'noise-tile'])

const ids = computed(() => {
  const base = props.slotKind === 'in' ? SUPPORTED_IN_IDS : props.slotKind === 'out' ? SUPPORTED_OUT_IDS : SUPPORTED_LOOP_IDS
  return props.layerKind === 'text' ? base.filter(id => !COPY_BASED_IDS.has(id)) : base
})

/** Group ids by catalog group; uncataloged ids (e.g. 'marquee') land in 'other'. */
const sections = computed(() => {
  const by = new Map<string, { label: string; ids: string[] }>()
  for (const id of ids.value) {
    const g = (KINETIC_PRESETS_BY_ID[id]?.group ?? 'other') as KineticGroup | 'other'
    const label = g === 'other' ? 'More' : KINETIC_GROUP_LABELS[g as KineticGroup] ?? g
    if (!by.has(g)) by.set(g, { label, ids: [] })
    by.get(g)!.ids.push(id)
  }
  return [...by.values()]
})
const label = (id: string) => KINETIC_PRESETS_BY_ID[id]?.label ?? id

const style = computed(() => {
  const a = props.anchorRect
  if (!a) return { top: '80px', right: '320px' }
  // Anchor left of the inspector, clamped to the viewport.
  const top = Math.max(16, Math.min(a.top, window.innerHeight - 440))
  return { top: `${top}px`, left: `${Math.max(16, a.left - 296)}px` }
})

function onKeydown(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <!-- click-away backdrop -->
    <div class="fixed inset-0 z-[110]" @pointerdown="emit('close')" />
    <div class="fixed z-[111] w-72 max-h-[420px] flex flex-col rounded-xl border border-white/10 bg-[#141416]/98 shadow-2xl"
      :style="style" @pointerdown.stop>
      <div class="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span class="text-[11px] uppercase tracking-[0.12em] text-white/50">{{ slotKind }} presets</span>
        <div class="flex items-center gap-1">
          <button v-if="currentId" class="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-white/60 hover:text-white/90 cursor-pointer"
            @click="emit('clear')">Clear</button>
          <button class="text-white/45 hover:text-white/80 p-1 cursor-pointer" @click="emit('close')"><X class="size-3.5" /></button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <div v-for="s in sections" :key="s.label">
          <div class="text-[10px] uppercase tracking-[0.12em] text-white/35 mb-1.5">{{ s.label }}</div>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="id in s.ids" :key="id"
              class="group flex flex-col gap-1 rounded-lg border p-1.5 text-left cursor-pointer transition-colors"
              :class="id === currentId ? 'border-white/60 bg-white/[0.08]' : 'border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06]'"
              @click="emit('pick', id)">
              <PresetThumb :preset-id="id" :slot-kind="slotKind" />
              <span class="text-[10.5px] truncate" :class="id === currentId ? 'text-white' : 'text-white/65'">{{ label(id) }}</span>
            </button>
            <!-- Custom: the property-keyframe milestone's visible entry point -->
            <div v-if="s === sections[sections.length - 1]"
              class="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/[0.12] p-1.5 opacity-50 select-none"
              title="Custom property animation — coming soon">
              <div class="w-full aspect-[4/3] grid place-items-center rounded bg-white/[0.02] text-white/40 text-lg">+</div>
              <span class="text-[10.5px] text-white/45">Custom <span class="text-[8px] uppercase border border-white/20 rounded px-0.5 ml-0.5">soon</span></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
