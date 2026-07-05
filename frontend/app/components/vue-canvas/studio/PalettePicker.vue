<script setup lang="ts">
// Color-theory palette picker, shared by the Duotone + Gradient Map surfaces.
// Two panes: a curated harmony gallery, and a "from seed color" mode that
// regenerates harmonies live. Emits either a 2-colour duotone or N gradient
// stops depending on `mode`.
import { ref, computed } from 'vue'
import { Palette, Sparkles, Minus, Plus } from 'lucide-vue-next'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import {
  HARMONY_TYPES, HARMONY_LABELS, harmonize, toDuotone, toStops,
  type HarmonyType, type GradientStop,
} from '~/lib/color/harmony'
import { CURATED_PALETTES, palettesByType } from '~/lib/color/palettes'

const props = withDefaults(defineProps<{
  mode: 'duotone' | 'stops'
  /** Stops requested in 'stops' mode. */
  stopCount?: number
  /** Initial seed for the "from color" pane. */
  seed?: string
}>(), { stopCount: 4, seed: '#4f8ad9' })

const emit = defineEmits<{
  (e: 'apply-duotone', v: { shadow: string; highlight: string }): void
  (e: 'apply-stops', v: GradientStop[]): void
}>()

const pane = ref<'gallery' | 'seed'>('gallery')
const seed = ref(props.seed)
const activeType = ref<HarmonyType>('complementary')
const count = ref(Math.max(2, Math.min(8, props.stopCount)))

// The colors generated from the seed for the currently-selected harmony.
const seedColors = computed(() => harmonize(seed.value, activeType.value, activeType.value === 'monochromatic' ? Math.max(3, count.value) : undefined))

/** The swatches shown for a candidate palette — the exact result that applying it yields. */
function preview(colors: string[]): string[] {
  if (props.mode === 'duotone') { const d = toDuotone(colors); return [d.shadow, d.highlight] }
  return toStops(colors, count.value).map(s => s.color)
}

function apply(colors: string[]) {
  if (props.mode === 'duotone') emit('apply-duotone', toDuotone(colors))
  else emit('apply-stops', toStops(colors, count.value))
}

const galleryRows = computed(() =>
  HARMONY_TYPES.map(type => ({ type, label: HARMONY_LABELS[type], palettes: palettesByType(type) }))
    .filter(r => r.palettes.length > 0),
)

const swatchGrad = (colors: string[]) => `linear-gradient(to right, ${colors.join(', ')})`
</script>

<template>
  <div class="flex flex-col gap-2 text-white/80">
    <!-- pane toggle + (stops-only) count stepper -->
    <div class="flex items-center gap-1">
      <button
        class="flex items-center gap-1 rounded px-2 py-1 text-[11px] transition"
        :class="pane === 'gallery' ? 'bg-white/[0.1] text-white' : 'text-white/50 hover:text-white/80'"
        @click="pane = 'gallery'"
      ><Palette :size="12" /> Palettes</button>
      <button
        class="flex items-center gap-1 rounded px-2 py-1 text-[11px] transition"
        :class="pane === 'seed' ? 'bg-white/[0.1] text-white' : 'text-white/50 hover:text-white/80'"
        @click="pane = 'seed'"
      ><Sparkles :size="12" /> From color</button>
      <div v-if="mode === 'stops'" class="ml-auto flex items-center gap-1 text-[11px] text-white/50">
        <span>Stops</span>
        <button class="rounded border border-white/10 p-0.5 hover:bg-white/10 disabled:opacity-30" :disabled="count <= 2" @click="count = Math.max(2, count - 1)"><Minus :size="11" /></button>
        <span class="w-4 text-center tabular-nums text-white/80">{{ count }}</span>
        <button class="rounded border border-white/10 p-0.5 hover:bg-white/10 disabled:opacity-30" :disabled="count >= 8" @click="count = Math.min(8, count + 1)"><Plus :size="11" /></button>
      </div>
    </div>

    <!-- Gallery: curated palettes grouped by harmony -->
    <div v-if="pane === 'gallery'" class="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
      <div v-for="row in galleryRows" :key="row.type">
        <div class="mb-1 text-[10px] uppercase tracking-wide text-white/30">{{ row.label }}</div>
        <div class="grid grid-cols-3 gap-1">
          <button
            v-for="p in row.palettes" :key="p.name" :title="p.name"
            class="h-7 overflow-hidden rounded border border-white/10 transition hover:border-white/30"
            :style="{ background: swatchGrad(preview(p.colors)) }"
            @click="apply(p.colors)"
          />
        </div>
      </div>
    </div>

    <!-- Seed mode: pick a base color, choose a harmony, apply -->
    <div v-else class="flex flex-col gap-2">
      <div class="flex items-center gap-2">
        <span class="text-[11px] text-white/60">Base</span>
        <StudioColor v-model="seed" />
        <div class="ml-auto h-7 flex-1 overflow-hidden rounded border border-white/10" :style="{ background: swatchGrad(preview(seedColors)) }" />
      </div>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="t in HARMONY_TYPES" :key="t"
          class="rounded px-2 py-1 text-[11px] transition"
          :class="activeType === t ? 'bg-white/[0.12] text-white' : 'text-white/50 hover:bg-white/[0.06] hover:text-white/80'"
          @click="activeType = t"
        >{{ HARMONY_LABELS[t] }}</button>
      </div>
      <button
        class="rounded-md border border-white/10 bg-white/[0.04] py-1.5 text-[11px] text-white/80 transition hover:bg-white/[0.08]"
        @click="apply(seedColors)"
      >Apply {{ HARMONY_LABELS[activeType].toLowerCase() }} harmony</button>
    </div>
  </div>
</template>
