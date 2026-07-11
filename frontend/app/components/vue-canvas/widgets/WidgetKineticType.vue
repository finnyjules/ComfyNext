<script setup lang="ts">
/**
 * WidgetKineticType — compact inline card for the Kinetic Typography node.
 *
 * Shows a live animated preview, the text input, preset/font labels, and
 * an "Edit" button that opens the full KineticTypeModal. All heavy controls
 * (preset gallery, font picker, axis sliders, animation params, axis
 * keyframes, colors) live in the modal.
 *
 * State is a JSON blob stored in widgetsValues — the modal reads/writes it
 * through the same node data reference.
 */
import { useElementSize } from '@vueuse/core'
import {
  KINETIC_PRESETS_BY_ID,
  DEFAULT_KINETIC_PRESET_ID,
  DEFAULT_KINETIC_OPTS,
} from '~/data/kinetic-presets'
import {
  VARIABLE_FONTS_BY_ID,
  DEFAULT_FONT_ID,
  type FontAxis,
} from '~/data/variable-fonts'
import {
  type GoogleFont,
  googleAxisList,
  buildGoogleCssUrl,
  quickGoogleCssUrl,
  nearestWeight,
} from '~/data/google-fonts'
import {
  buildPreview,
  useKineticRenderer,
  type PreviewHandle,
  type AxisKeyframe,
} from '~/composables/useKineticRenderer'

const props = defineProps<{
  modelValue: string
  label?: string
  nodeId?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// ── State parsing (same shape as the modal) ─────────────────────────────────

interface WidgetState {
  text: string
  presetId: string
  fontId: string
  fontSource: 'variable' | 'google'
  googleFamily: string
  googleAxes: { tag: string; min: number; max: number; default: number }[]
  googleWeights: number[]
  weight: number
  axes: Record<string, number>
  color: string
  bg: string
  size: number
  letterSpacing: number
  duration: number
  stagger: number
  ease: string
  fps: number
  rendered: string[]
  axisKeyframes: AxisKeyframe[]
}

const num = (v: any, d: number) => (Number.isFinite(+v) ? +v : d)

function parse(s: string): WidgetState {
  let o: any = {}
  try { o = JSON.parse(s || '{}') } catch { o = {} }
  const fontId = VARIABLE_FONTS_BY_ID[o.fontId] ? o.fontId : DEFAULT_FONT_ID
  const font = VARIABLE_FONTS_BY_ID[fontId]!
  return {
    text: typeof o.text === 'string' ? o.text : 'Hello',
    presetId: KINETIC_PRESETS_BY_ID[o.presetId] ? o.presetId : DEFAULT_KINETIC_PRESET_ID,
    fontId,
    fontSource: o.fontSource === 'google' ? 'google' : 'variable',
    googleFamily: typeof o.googleFamily === 'string' ? o.googleFamily : '',
    googleAxes: Array.isArray(o.googleAxes) ? o.googleAxes : [],
    googleWeights: Array.isArray(o.googleWeights) ? o.googleWeights.filter((x: any) => Number.isFinite(+x)).map(Number) : [],
    weight: num(o.weight, 400),
    axes: (o.axes && typeof o.axes === 'object') ? o.axes : Object.fromEntries(font.axes.map(a => [a.tag, a.default])),
    color: typeof o.color === 'string' ? o.color : '#ffffff',
    bg: typeof o.bg === 'string' ? o.bg : 'transparent',
    size: num(o.size, 120),
    letterSpacing: num(o.letterSpacing, 0),
    duration: num(o.duration, DEFAULT_KINETIC_OPTS.duration),
    stagger: num(o.stagger, DEFAULT_KINETIC_OPTS.stagger),
    ease: typeof o.ease === 'string' ? o.ease : DEFAULT_KINETIC_OPTS.ease,
    fps: num(o.fps, 30),
    rendered: Array.isArray(o.rendered) ? o.rendered : [],
    axisKeyframes: Array.isArray(o.axisKeyframes) ? o.axisKeyframes : [],
  }
}

const state = ref<WidgetState>(parse(props.modelValue))
watch(() => props.modelValue, (v) => {
  state.value = parse(v)
})

// ── Active font (for preview styling) ───────────────────────────────────────

interface ActiveFont { family: string; cssUrl: string }

const activeFont = computed<ActiveFont>(() => {
  if (state.value.fontSource === 'google') {
    const gf: GoogleFont = {
      family: state.value.googleFamily || 'Roboto', category: 'sans',
      weights: state.value.googleWeights.length ? state.value.googleWeights : [400],
      italic: false, axes: state.value.googleAxes,
    }
    const axes = googleAxisList(gf)
    return {
      family: gf.family,
      cssUrl: axes.length ? buildGoogleCssUrl(gf) : quickGoogleCssUrl(gf.family, state.value.weight || nearestWeight(gf, 400)),
    }
  }
  const f = VARIABLE_FONTS_BY_ID[state.value.fontId] ?? VARIABLE_FONTS_BY_ID[DEFAULT_FONT_ID]!
  return { family: f.family, cssUrl: f.cssUrl }
})

const fontLabel = computed(() =>
  state.value.fontSource === 'google'
    ? state.value.googleFamily
    : (VARIABLE_FONTS_BY_ID[state.value.fontId]?.label ?? activeFont.value.family))

const presetLabel = computed(() =>
  KINETIC_PRESETS_BY_ID[state.value.presetId]?.label ?? state.value.presetId)

const variationSettings = computed(() =>
  Object.entries(state.value.axes).map(([t, v]) => `"${t}" ${v}`).join(', '))

// ── Font loading ────────────────────────────────────────────────────────────

const loaded = new Set<string>()
function ensureFont(url: string) {
  if (typeof document === 'undefined' || loaded.has(url)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'; link.href = url
  document.head.appendChild(link); loaded.add(url)
}
watch(() => activeFont.value.cssUrl, u => ensureFont(u), { immediate: true })

// ── Live preview (compact) ──────────────────────────────────────────────────

const previewEl = ref<HTMLElement | null>(null)
let currentPreview: PreviewHandle | null = null

const previewStyle = computed(() => ({
  fontFamily: `"${activeFont.value.family}", sans-serif`,
  fontWeight: String(state.value.axes.wght ?? state.value.weight ?? 700),
  fontVariationSettings: variationSettings.value,
  fontSize: `${Math.min(36, state.value.size / 4)}px`,
  color: state.value.color,
  lineHeight: '1.2',
  letterSpacing: `${state.value.letterSpacing}em`,
  whiteSpace: 'nowrap' as const,
}))

const stageBg = computed(() => state.value.bg === 'transparent'
  ? 'repeating-conic-gradient(#2a2a2a 0% 25%, #1e1e1e 0% 50%) 50% / 16px 16px'
  : state.value.bg)

function rebuildPreview() {
  if (!previewEl.value) return
  if (currentPreview) { currentPreview.destroy(); currentPreview = null }
  previewEl.value.textContent = state.value.text || 'Hello'
  nextTick(() => {
    if (!previewEl.value) return
    // forceLoop=true so the node preview replays continuously (otherwise a
    // one-shot "in" animation plays once and freezes on the final frame).
    currentPreview = buildPreview(previewEl.value, state.value.presetId, {
      duration: state.value.duration,
      stagger: state.value.stagger,
      ease: state.value.ease,
    }, true)
    currentPreview.timeline.play()
  })
}

watch(
  () => [state.value.text, state.value.presetId, state.value.duration, state.value.stagger, state.value.ease],
  () => rebuildPreview(),
  { deep: true },
)

function replayPreview() {
  if (currentPreview) currentPreview.timeline.restart()
  else rebuildPreview()
}

onMounted(() => nextTick(rebuildPreview))
onUnmounted(() => { if (currentPreview) { currentPreview.destroy(); currentPreview = null } })

// ── Text input ──────────────────────────────────────────────────────────────

function commit(patch: Partial<WidgetState> = {}) {
  state.value = { ...state.value, ...patch }
  emit('update:modelValue', JSON.stringify(state.value))
}

function setText(v: string) { commit({ text: v }) }

// ── Open modal ──────────────────────────────────────────────────────────────

function openModal() {
  window.dispatchEvent(new CustomEvent('sailor:openKineticType', {
    detail: { nodeId: props.nodeId },
  }))
}

// ── Bake status ─────────────────────────────────────────────────────────────

const { isBaking, bakeProgress } = useKineticRenderer()
</script>

<template>
  <div class="nopan nodrag kt">
    <!-- Compact preview + replay -->
    <div class="kt__stage" :style="{ background: stageBg }" @dblclick="openModal">
      <div ref="previewEl" class="kt__preview" :style="previewStyle">{{ state.text || 'Hello' }}</div>
      <button type="button" class="kt__replay" title="Replay" @click.stop="replayPreview">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
      </button>
      <div v-if="isBaking" class="kt__baking">baking {{ Math.round(bakeProgress * 100) }}%</div>
    </div>

    <!-- Text input -->
    <input
      class="kt__input"
      :value="state.text"
      placeholder="Type something…"
      @input="setText(($event.target as HTMLInputElement).value)"
    />

    <!-- Summary + Edit button -->
    <div class="kt__bar">
      <span class="kt__tag">{{ presetLabel }}</span>
      <span class="kt__dot">·</span>
      <span class="kt__tag">{{ fontLabel }}</span>
      <span class="kt__dot">·</span>
      <span class="kt__tag">{{ state.duration.toFixed(1) }}s</span>
      <button type="button" class="kt__edit" @click="openModal">Edit</button>
    </div>

    <!-- Frame count -->
    <div v-if="state.rendered.length" class="kt__frames">{{ state.rendered.length }} frames</div>
  </div>
</template>

<style scoped>
.kt { display: flex; flex-direction: column; gap: 6px; padding: 4px 0 4px; user-select: none; }

.kt__stage {
  position: relative; height: 72px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; border: 1px solid rgba(255,255,255,0.08);
  cursor: pointer;
}
.kt__stage:hover { border-color: rgba(255,255,255,0.15); }
.kt__preview { max-width: 100%; overflow: hidden; text-overflow: ellipsis; padding: 0 10px; }
.kt__replay {
  position: absolute; top: 5px; right: 5px;
  width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 5px; color: rgba(255,255,255,0.6); cursor: pointer;
}
.kt__replay:hover { background: rgba(0,0,0,0.7); color: #fff; }
.kt__baking {
  position: absolute; bottom: 3px; right: 5px;
  font-size: 8px; color: rgba(255,255,255,0.4);
  background: rgba(0,0,0,0.4); padding: 1px 4px; border-radius: 3px;
}

.kt__input {
  width: 100%; background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;
  padding: 4px 7px; font-size: 11px; color: rgba(255,255,255,0.9); outline: none;
}
.kt__input:focus { border-color: rgba(255,255,255,0.25); }

.kt__bar {
  display: flex; align-items: center; gap: 4px;
  font-size: 9.5px; color: rgba(255,255,255,0.4);
}
.kt__tag { white-space: nowrap; }
.kt__dot { color: rgba(255,255,255,0.2); }
.kt__edit {
  margin-left: auto;
  font-size: 10px; padding: 2px 8px; border-radius: 5px;
  background: rgba(129,140,248,0.15); border: 1px solid rgba(129,140,248,0.3);
  color: rgba(199,210,254,0.9); cursor: pointer;
  transition: all 0.15s;
}
.kt__edit:hover { background: rgba(129,140,248,0.25); border-color: rgba(129,140,248,0.5); }

.kt__frames { font-size: 9px; color: rgba(255,255,255,0.3); }
</style>
