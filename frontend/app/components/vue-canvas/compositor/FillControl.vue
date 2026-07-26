<script setup lang="ts">
/**
 * FillControl — a single fill/stroke picker for the Frame modal that offers the
 * full Type-Studio fill set (solid / gradient / ombre / grid / noise / checkerboard
 * / stripes / qr). A swatch trigger (live preview) expands an inline panel with the
 * type dropdown, colour A/B, angle and density. Emits a `Paint`:
 *   solid → plain hex string · gradient → a compositor Gradient · else → a Fill object
 * so it drops straight into resolvePaint without new render code.
 */
import { ref, reactive, computed, inject, watch, onMounted } from 'vue'
import type { ComputedRef } from 'vue'
import { ChevronDown, Dices } from 'lucide-vue-next'
import StudioColor from '~/components/vue-canvas/studio/StudioColor.vue'
import GradientEditor from '~/components/vue-canvas/compositor/GradientEditor.vue'
import ShaderFillEditor from '~/components/vue-canvas/widgets/ShaderFillEditor.vue'
import { type Fill, type FillType, type ShaderSpec, FILL_TYPES, DEFAULT_FILL, DEFAULT_SHADER_SPEC, fillTileCanvas } from '~/lib/spacetype/fillTile'
import { rollPaintItem, gradientFromPaint } from '~/lib/compositor/fillPalette'
import { type Paint, type Gradient, isFill, isGradient } from '~/composables/useCompositorLayers'
import type { BrandKit } from '~~/shared/brand/types'
import { brandSwatches as kitSwatches } from '~~/shared/brand/resolve'

const props = withDefaults(defineProps<{ modelValue: Paint | undefined; allowNone?: boolean; nested?: boolean }>(), { allowNone: false, nested: false })
const emit = defineEmits<{ 'update:modelValue': [Paint] }>()

/** The type list this instance offers. `nested` is set on the fill editor that
 *  ShaderFillEditor mounts for `spec.input` — excluding 'shader' there is the
 *  depth-1 nesting guard (normalizeFill, fillTile.ts) made visible in the UI
 *  rather than a user picking "shader" again and having it silently collapsed
 *  on save. */
const availableTypes = computed<FillType[]>(() => props.nested ? FILL_TYPES.filter((t) => t !== 'shader') : FILL_TYPES)

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

/** Normalize whatever Paint we were handed into an editable multi-stop Gradient. */
function toGrad(p: Paint | undefined, f: Fill): Gradient {
  return gradientFromPaint(p, f.a, f.b, f.angle)
}

const fill = reactive<Fill>(toFill(props.modelValue))
const grad = ref<Gradient>(toGrad(props.modelValue, fill))
watch(() => props.modelValue, (v) => { Object.assign(fill, toFill(v)); grad.value = toGrad(v, fill); drawPreview() })

/** Editable Fill → the Paint we emit (solid → hex, patterns → Fill object). Gradient
 *  is emitted from `grad` (the native multi-stop Gradient), not collapsed here.
 *  Spreads `f` rather than listing fields — a shader fill's `.shader` spec (or any
 *  field added later) must survive round-tripping through this control, not be
 *  silently dropped by an incomplete field list (see Task 6's known-blocker note). */
function paintFromFill(f: Fill): Paint {
  if (f.type === 'solid') return f.a
  return { ...f }
}
function push() {
  if (!isNone.value) emit('update:modelValue', fill.type === 'gradient' ? grad.value : paintFromFill(fill))
  drawPreview()
}
function setType(t: FillType) {
  // Switching INTO gradient seeds it from the current colours; an authored gradient
  // is preserved while you stay on the gradient type.
  if (t === 'gradient' && fill.type !== 'gradient') grad.value = toGrad(undefined, fill)
  // Switching INTO shader seeds a fresh spec (cloned — DEFAULT_SHADER_SPEC is a
  // shared module constant, never mutated in place) so the editor has something
  // real to bind to immediately, rather than relying on the `?? DEFAULT_SHADER_SPEC`
  // fallback below until the user's first edit.
  if (t === 'shader' && !fill.shader) fill.shader = structuredClone(DEFAULT_SHADER_SPEC)
  fill.type = t; push()
}
function onGrad(g: Gradient) { grad.value = g; push() }
function onShaderSpec(spec: ShaderSpec) { fill.shader = spec; push() }

// ── Shuffle: roll a tasteful fill from the Vessell palette (patterns + a few
// brand gradients). A rolling counter seeds the pick so repeated clicks vary. ──
let rollN = 0
function shuffle() {
  rollN += 1
  const pick = rollPaintItem(rollN)
  if (isGradient(pick)) {
    grad.value = pick
    fill.type = 'gradient'
    emit('update:modelValue', grad.value)
  } else {
    Object.assign(fill, pick)
    emit('update:modelValue', paintFromFill(fill))
  }
  drawPreview()
}
function setColor(key: 'a' | 'b', v: string) { fill[key] = v; push() }
function setNum(key: 'angle' | 'density', v: number) { fill[key] = v; push() }
function toggleNone() {
  if (isNone.value) push()                          // re-enable with the current fill
  else emit('update:modelValue', 'none')
}

// Active project brand kit → one-click swatches. Null-safe: FillControl also
// renders in contexts without a project (dev labs), where the inject is absent.
const projectBrand = inject<{ activeKit: ComputedRef<BrandKit | undefined> } | null>('sailor:brand', null)
const brandSwatches = computed(() => kitSwatches(projectBrand?.activeKit.value))
function applyBrandColor(hex: string) {
  if (fill.type === 'gradient') fill.type = 'solid'
  setColor('a', hex)
}

// Gradient gets its own editor; patterns keep the A/B + angle + density controls.
const needsB = computed(() => fill.type !== 'solid' && fill.type !== 'gradient')
const needsAngle = computed(() => fill.type === 'ombre' || fill.type === 'stripes')
const needsDensity = computed(() => fill.type === 'grid' || fill.type === 'checkerboard' || fill.type === 'stripes' || fill.type === 'noise' || fill.type === 'qr')

function drawGradientPreview(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const g = grad.value
  const stops = [...g.stops].sort((a, b) => a.offset - b.offset)
  let cg: CanvasGradient
  if (g.type === 'radial') cg = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2)
  else {
    const rad = (g.angle * Math.PI) / 180, hx = (Math.cos(rad) * w) / 2, hy = (Math.sin(rad) * h) / 2
    cg = ctx.createLinearGradient(w / 2 - hx, h / 2 - hy, w / 2 + hx, h / 2 + hy)
  }
  for (const s of stops) cg.addColorStop(Math.max(0, Math.min(1, s.offset)), s.color)
  ctx.fillStyle = cg; ctx.fillRect(0, 0, w, h)
}
function drawPreview() {
  const cv = previewRef.value; if (!cv) return
  const ctx = cv.getContext('2d'); if (!ctx) return
  ctx.clearRect(0, 0, cv.width, cv.height)
  if (isNone.value) {
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(1, cv.height - 1); ctx.lineTo(cv.width - 1, 1); ctx.stroke()
    return
  }
  if (fill.type === 'gradient') { drawGradientPreview(ctx, cv.width, cv.height); return }
  try { ctx.drawImage(fillTileCanvas(fill, 28), 0, 0, cv.width, cv.height) } catch { /* no canvas */ }
}
onMounted(drawPreview)
watch(fill, drawPreview, { deep: true })
watch(grad, drawPreview, { deep: true })
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
      <button type="button" class="h-8 w-8 shrink-0 grid place-items-center rounded border border-[#2a2a2a] bg-[#1a1a1a] text-white/55 hover:text-white cursor-pointer" title="Shuffle a palette fill" @click="shuffle">
        <Dices class="size-4" />
      </button>
      <button v-if="allowNone" type="button" class="h-8 px-2 rounded border border-[#2a2a2a] bg-[#1a1a1a] text-[11px] text-white/70 hover:text-white cursor-pointer" :title="isNone ? 'Add a fill' : 'Remove'" @click="toggleNone">
        {{ isNone ? 'Add' : '✕' }}
      </button>
    </div>

    <div v-if="open && !isNone" class="mt-2 rounded-lg border border-white/10 bg-[#141414] p-2.5 space-y-2.5">
      <div v-if="brandSwatches.length" class="flex items-center gap-1.5">
        <span class="text-[9px] uppercase tracking-[0.1em] text-white/35 shrink-0">Brand</span>
        <button
          v-for="s in brandSwatches" :key="s.name + s.hex" type="button"
          class="size-5 rounded border border-white/15 cursor-pointer hover:scale-110 transition-transform"
          :style="{ background: s.hex }" :title="s.name" @click="applyBrandColor(s.hex)"
        />
      </div>

      <select :value="fill.type" class="w-full rounded bg-white/10 px-2 py-1.5 text-xs text-white/90 outline-none capitalize cursor-pointer"
        @change="setType(($event.target as HTMLSelectElement).value as FillType)">
        <option v-for="t in availableTypes" :key="t" :value="t">{{ t }}</option>
      </select>

      <GradientEditor v-if="fill.type === 'gradient'" :model-value="grad" @update:model-value="onGrad" />

      <ShaderFillEditor v-else-if="fill.type === 'shader'" :model-value="fill.shader ?? DEFAULT_SHADER_SPEC" @update:model-value="onShaderSpec" />

      <div v-else class="flex items-center gap-1.5">
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
