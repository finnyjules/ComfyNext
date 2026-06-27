<script setup lang="ts">
/**
 * FillControl — a single fill/stroke picker for the Frame modal that offers the
 * full Type-Studio fill set (solid / gradient / ombre / grid / noise / checkerboard
 * / stripes / qr). A swatch trigger (live preview) expands an inline panel with the
 * type dropdown, colour A/B, angle and density. Emits a `Paint`:
 *   solid → plain hex string · gradient → a compositor Gradient · else → a Fill object
 * so it drops straight into resolvePaint without new render code.
 */
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import { type Fill, type FillType, FILL_TYPES, DEFAULT_FILL, fillTileCanvas } from '~/lib/spacetype/fillTile'
import { type Paint, isFill, isGradient } from '~/composables/useCompositorLayers'

const props = withDefaults(defineProps<{ modelValue: Paint | undefined; allowNone?: boolean }>(), { allowNone: false })
const emit = defineEmits<{ 'update:modelValue': [Paint] }>()

const open = ref(false)
const previewRef = ref<HTMLCanvasElement | null>(null)

/** Normalize whatever Paint we were handed into an editable Fill. */
function toFill(p: Paint | undefined): Fill {
  if (isFill(p)) return { ...DEFAULT_FILL, ...p }
  if (isGradient(p)) {
    const stops = p.stops ?? []
    return {
      ...DEFAULT_FILL, type: 'gradient',
      a: stops[0]?.color ?? '#ffffff',
      b: stops[stops.length - 1]?.color ?? '#000000',
      angle: (p as { angle?: number }).angle ?? 45,
    }
  }
  const s = typeof p === 'string' && p && p !== 'none' ? p : '#3b82f6'
  return { ...DEFAULT_FILL, type: 'solid', a: s }
}

const isNone = computed(() => !!props.allowNone && (props.modelValue === 'none' || props.modelValue === '' || props.modelValue == null))

const fill = reactive<Fill>(toFill(props.modelValue))
watch(() => props.modelValue, (v) => { Object.assign(fill, toFill(v)); drawPreview() })

/** Editable Fill → the Paint we emit. Gradient maps to the compositor's spanning Gradient. */
function paintFromFill(f: Fill): Paint {
  if (f.type === 'solid') return f.a
  if (f.type === 'gradient') return { type: 'linear', angle: f.angle, stops: [{ offset: 0, color: f.a }, { offset: 1, color: f.b }] }
  return { type: f.type, a: f.a, b: f.b, textColor: f.textColor, angle: f.angle, density: f.density }
}
function push() { if (!isNone.value) emit('update:modelValue', paintFromFill(fill)); drawPreview() }
function setType(t: FillType) { fill.type = t; push() }
function setColor(key: 'a' | 'b', v: string) { fill[key] = v; push() }
function setNum(key: 'angle' | 'density', v: number) { fill[key] = v; push() }
function toggleNone() {
  if (isNone.value) push()                          // re-enable with the current fill
  else emit('update:modelValue', 'none')
}

const needsB = computed(() => fill.type !== 'solid')
const needsAngle = computed(() => fill.type === 'gradient' || fill.type === 'ombre' || fill.type === 'stripes')
const needsDensity = computed(() => fill.type === 'grid' || fill.type === 'checkerboard' || fill.type === 'stripes' || fill.type === 'noise' || fill.type === 'qr')

function drawPreview() {
  const cv = previewRef.value; if (!cv) return
  const ctx = cv.getContext('2d'); if (!ctx) return
  ctx.clearRect(0, 0, cv.width, cv.height)
  if (isNone.value) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(1, cv.height - 1); ctx.lineTo(cv.width - 1, 1); ctx.stroke()
    return
  }
  try { ctx.drawImage(fillTileCanvas(fill, 28), 0, 0, cv.width, cv.height) } catch { /* no canvas */ }
}
onMounted(drawPreview)
watch(fill, drawPreview, { deep: true })
</script>

<template>
  <div>
    <div class="flex items-center gap-1.5">
      <button type="button" class="h-8 w-8 shrink-0 rounded border border-[#2a2a2a] overflow-hidden bg-[#1a1a1a] cursor-pointer" @click="open = !open">
        <canvas ref="previewRef" width="28" height="28" class="h-full w-full" />
      </button>
      <button type="button" class="flex-1 h-8 rounded border border-[#2a2a2a] bg-[#1a1a1a] px-2 text-left text-xs text-white/85 capitalize flex items-center justify-between cursor-pointer" @click="open = !open">
        <span>{{ isNone ? 'No fill' : fill.type }}</span>
        <ChevronDown class="size-3.5 text-white/35 transition-transform" :class="open ? 'rotate-180' : ''" />
      </button>
      <button v-if="allowNone" type="button" class="h-8 px-2 rounded border border-[#2a2a2a] bg-[#1a1a1a] text-[11px] text-white/70 hover:text-white cursor-pointer" :title="isNone ? 'Add a fill' : 'Remove'" @click="toggleNone">
        {{ isNone ? 'Add' : '✕' }}
      </button>
    </div>

    <div v-if="open && !isNone" class="mt-2 rounded-lg border border-white/10 bg-[#141414] p-2.5 space-y-2.5">
      <select :value="fill.type" class="w-full rounded bg-white/10 px-2 py-1.5 text-xs text-white/90 outline-none capitalize cursor-pointer"
        @change="setType(($event.target as HTMLSelectElement).value as FillType)">
        <option v-for="t in FILL_TYPES" :key="t" :value="t">{{ t }}</option>
      </select>

      <div class="flex items-center gap-1.5">
        <span class="text-[9px] uppercase tracking-[0.1em] text-white/35 shrink-0">{{ needsB ? 'A' : 'Color' }}</span>
        <StudioColor :model-value="fill.a" @update:model-value="(v: string) => setColor('a', v)" />
        <template v-if="needsB">
          <span class="text-[9px] uppercase tracking-[0.1em] text-white/35 shrink-0 pl-1">B</span>
          <StudioColor :model-value="fill.b" @update:model-value="(v: string) => setColor('b', v)" />
        </template>
      </div>

      <div v-if="needsAngle">
        <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
          <span>Angle</span><span class="tabular-nums normal-case">{{ Math.round(fill.angle) }}°</span>
        </div>
        <input type="range" min="0" max="180" step="5" :value="fill.angle" class="w-full accent-white cursor-pointer"
          @input="setNum('angle', Number(($event.target as HTMLInputElement).value))" />
      </div>

      <div v-if="needsDensity">
        <div class="flex items-center justify-between text-[9px] uppercase tracking-[0.1em] text-white/35 mb-1">
          <span>Density</span><span class="tabular-nums normal-case">{{ Math.round(fill.density) }}</span>
        </div>
        <input type="range" min="1" max="32" step="1" :value="fill.density" class="w-full accent-white cursor-pointer"
          @input="setNum('density', Number(($event.target as HTMLInputElement).value))" />
      </div>
    </div>
  </div>
</template>
