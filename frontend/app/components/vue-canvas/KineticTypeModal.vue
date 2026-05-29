<script setup lang="ts">
/**
 * KineticTypeModal — full editor for the Kinetic Typography node.
 *
 * Opened via custom event from the compact inline widget. Reads/writes the
 * node's widgetsValues[params] JSON directly (same state shape the widget
 * and renderer use). All heavy controls live here: preset gallery, font
 * picker, axis sliders, animation params, axis keyframes, colors.
 */
import { useElementSize } from '@vueuse/core'
import {
  KINETIC_PRESETS,
  KINETIC_PRESETS_BY_ID,
  KINETIC_CATEGORY_LABELS,
  KINETIC_GROUP_LABELS,
  DEFAULT_KINETIC_PRESET_ID,
  DEFAULT_KINETIC_OPTS,
  EASE_OPTIONS,
  type KineticCategory,
  type KineticGroup,
  type KineticPreset,
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
  type KineticState,
  type KineticFontState,
  type PreviewHandle,
  type AxisKeyframe,
} from '~/composables/useKineticRenderer'
import FontPicker from './widgets/FontPicker.vue'
import AxisKeyframeEditor from './widgets/AxisKeyframeEditor.vue'

const props = defineProps<{
  nodeId: string
  nodes: any[]
}>()
const emit = defineEmits<{ close: [] }>()

// ── Node reference ──────────────────────────────────────────────────────────

const node = computed(() => props.nodes.find(n => n.id === props.nodeId))

const paramsIdx = computed(() => {
  const defs = (node.value?.data?.widgetDefs ?? []) as any[]
  return defs.findIndex(d => d.name === 'params')
})

function getRaw(): string {
  const idx = paramsIdx.value
  if (idx < 0) return '{}'
  return node.value?.data?.widgetsValues?.[idx] ?? '{}'
}

function setRaw(v: string) {
  const idx = paramsIdx.value
  if (idx < 0 || !node.value?.data?.widgetsValues) return
  node.value.data.widgetsValues[idx] = v
}

// ── State ───────────────────────────────────────────────────────────────────

interface WidgetState {
  text: string; presetId: string; fontId: string
  fontSource: 'variable' | 'google'; googleFamily: string
  googleAxes: { tag: string; min: number; max: number; default: number }[]
  googleWeights: number[]; weight: number
  axes: Record<string, number>; color: string; bg: string
  size: number; letterSpacing: number; duration: number
  stagger: number; ease: string; fps: number
  rendered: string[]; axisKeyframes: AxisKeyframe[]
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
    size: num(o.size, 120), letterSpacing: num(o.letterSpacing, 0),
    duration: num(o.duration, DEFAULT_KINETIC_OPTS.duration),
    stagger: num(o.stagger, DEFAULT_KINETIC_OPTS.stagger),
    ease: typeof o.ease === 'string' ? o.ease : DEFAULT_KINETIC_OPTS.ease,
    fps: num(o.fps, 30),
    rendered: Array.isArray(o.rendered) ? o.rendered : [],
    axisKeyframes: Array.isArray(o.axisKeyframes) ? o.axisKeyframes : [],
  }
}

const state = ref<WidgetState>(parse(getRaw()))
// Sync from node → local state when external changes arrive
watch(() => getRaw(), (v) => { state.value = parse(v) })

// ── Active font ─────────────────────────────────────────────────────────────

interface ActiveFont { source: 'variable' | 'google'; family: string; axes: FontAxis[]; cssUrl: string; key: string; weights: number[] }

function googleFromState(): GoogleFont {
  return { family: state.value.googleFamily || 'Roboto', category: 'sans', weights: state.value.googleWeights.length ? state.value.googleWeights : [400], italic: false, axes: state.value.googleAxes }
}

const activeFont = computed<ActiveFont>(() => {
  if (state.value.fontSource === 'google') {
    const gf = googleFromState(); const axes = googleAxisList(gf)
    return { source: 'google', family: gf.family, axes, cssUrl: axes.length ? buildGoogleCssUrl(gf) : quickGoogleCssUrl(gf.family, state.value.weight || nearestWeight(gf, 400)), key: 'goog:' + gf.family, weights: gf.weights }
  }
  const f = VARIABLE_FONTS_BY_ID[state.value.fontId] ?? VARIABLE_FONTS_BY_ID[DEFAULT_FONT_ID]!
  return { source: 'variable', family: f.family, axes: f.axes, cssUrl: f.cssUrl, key: 'var:' + f.id, weights: [] }
})

const fontLabel = computed(() => activeFont.value.source === 'google' ? activeFont.value.family : (VARIABLE_FONTS_BY_ID[state.value.fontId]?.label ?? activeFont.value.family))
const fontSublabel = computed(() => activeFont.value.source === 'google' ? 'Google' : 'Variable')
const variationSettings = computed(() => Object.entries(state.value.axes).map(([t, v]) => `"${t}" ${v}`).join(', '))

// Font loading
const loaded = new Set<string>()
function ensureFont(url: string) { if (typeof document === 'undefined' || loaded.has(url)) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; document.head.appendChild(l); loaded.add(url) }
watch(() => activeFont.value.cssUrl, u => ensureFont(u), { immediate: true })

// ── Preview ─────────────────────────────────────────────────────────────────

const previewEl = ref<HTMLElement | null>(null)
const { width: previewW } = useElementSize(previewEl)
let currentPreview: PreviewHandle | null = null

const previewStyle = computed(() => ({
  fontFamily: `"${activeFont.value.family}", sans-serif`,
  fontWeight: String(state.value.axes.wght ?? state.value.weight ?? 700),
  fontVariationSettings: variationSettings.value,
  fontSize: `${Math.min(72, state.value.size / 2)}px`,
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
    // forceLoop=true → continuous replay (one-shot "in"/"out" presets would
    // otherwise play once and freeze).
    currentPreview = buildPreview(previewEl.value, state.value.presetId, {
      duration: state.value.duration, stagger: state.value.stagger, ease: state.value.ease,
    }, true)
    currentPreview.timeline.play()
  })
}

watch(() => [state.value.text, state.value.presetId, state.value.duration, state.value.stagger, state.value.ease], () => rebuildPreview(), { deep: true })
function replayPreview() { if (currentPreview) currentPreview.timeline.restart(); else rebuildPreview() }
onMounted(() => nextTick(rebuildPreview))
onUnmounted(() => { if (currentPreview) currentPreview.destroy() })

// ── Bake ────────────────────────────────────────────────────────────────────

const { isBaking, bakeProgress, bake } = useKineticRenderer()

async function doBake() {
  const fontState: KineticFontState = {
    family: activeFont.value.family, cssUrl: activeFont.value.cssUrl,
    weight: state.value.axes.wght ?? state.value.weight ?? 700,
    variationSettings: variationSettings.value,
    letterSpacing: state.value.letterSpacing, sizePx: state.value.size,
    color: state.value.color, bgColor: state.value.bg,
  }
  const ks: KineticState = {
    text: state.value.text, font: fontState, presetId: state.value.presetId,
    opts: { duration: state.value.duration, stagger: state.value.stagger, ease: state.value.ease },
    fps: state.value.fps, duration: state.value.duration,
    axisKeyframes: state.value.axisKeyframes.length > 0 ? state.value.axisKeyframes : undefined,
  }
  const filenames = await bake(ks)
  if (filenames.length > 0) commit({ rendered: filenames })
}

// ── Mutations → write to node ───────────────────────────────────────────────

function commit(patch: Partial<WidgetState> = {}) {
  state.value = { ...state.value, ...patch }
  setRaw(JSON.stringify(state.value))
}

function setText(v: string) { commit({ text: v }) }
function setPreset(id: string) { commit({ presetId: id }) }
function setDuration(v: number) { commit({ duration: v }) }
function setStagger(v: number) { commit({ stagger: v }) }
function setEase(v: string) { commit({ ease: v }) }
function setSize(v: number) { commit({ size: v }) }
function setLetterSpacing(v: number) { commit({ letterSpacing: v }) }
function setColor(v: string) { commit({ color: v }) }
function setBg(v: string) { commit({ bg: v }) }
function setAxis(tag: string, v: number) { commit({ axes: { ...state.value.axes, [tag]: v } }) }
function toggleTransparent() { setBg(state.value.bg === 'transparent' ? '#000000' : 'transparent') }
function setAxisKeyframes(kfs: AxisKeyframe[]) { commit({ axisKeyframes: kfs }) }

function pickVariable(id: string) { const f = VARIABLE_FONTS_BY_ID[id]; if (!f) return; commit({ fontSource: 'variable', fontId: id, axes: Object.fromEntries(f.axes.map(a => [a.tag, a.default])) }) }
function pickGoogle(gf: GoogleFont) { commit({ fontSource: 'google', googleFamily: gf.family, googleAxes: gf.axes, googleWeights: gf.weights, weight: nearestWeight(gf, 400), axes: Object.fromEntries(googleAxisList(gf).map(a => [a.tag, a.default])) }) }
function onPickFont(payload: { source: 'variable'; id: string } | { source: 'google'; font: GoogleFont }) { if (payload.source === 'variable') pickVariable(payload.id); else pickGoogle(payload.font) }

const showAxisKeyframes = ref(false)

// ── Preset tab + grouping ───────────────────────────────────────────────────

const presetTab = ref<KineticCategory>('in')

// Within the active tab, group presets by their `group` field, preserving
// insertion order for the group headers.
const groupedPresets = computed(() => {
  const all = KINETIC_PRESETS.filter(p => p.category === presetTab.value)
  const groups: { group: KineticGroup; label: string; presets: KineticPreset[] }[] = []
  const seen = new Map<KineticGroup, number>()
  for (const p of all) {
    if (!seen.has(p.group)) {
      seen.set(p.group, groups.length)
      groups.push({ group: p.group, label: KINETIC_GROUP_LABELS[p.group], presets: [] })
    }
    groups[seen.get(p.group)!].presets.push(p)
  }
  return groups
})

// ── Per-card GSAP preview ───────────────────────────────────────────────────

const cardRefs = ref<Map<string, HTMLElement>>(new Map())
const cardPreviews = new Map<string, PreviewHandle>()

function setCardRef(id: string, el: HTMLElement | null) {
  if (el) cardRefs.value.set(id, el)
  else cardRefs.value.delete(id)
}

function mountCardPreviews() {
  // Kill old ones
  for (const [, handle] of cardPreviews) handle.destroy()
  cardPreviews.clear()

  nextTick(() => {
    for (const [id, el] of cardRefs.value) {
      const preset = KINETIC_PRESETS_BY_ID[id]
      if (!preset || !el) continue
      try {
        const handle = buildPreview(el, id, { duration: 1.5, stagger: 0.06, ease: 'power2.out' }, true)
        handle.timeline.play()
        cardPreviews.set(id, handle)
      } catch { /* skip broken previews */ }
    }
  })
}

// Rebuild card previews when the tab changes
watch(presetTab, () => {
  nextTick(mountCardPreviews)
})

// Also set the tab to match the current preset's category on mount
onMounted(() => {
  const current = KINETIC_PRESETS_BY_ID[state.value.presetId]
  if (current) presetTab.value = current.category
  nextTick(mountCardPreviews)
})

onUnmounted(() => {
  for (const [, handle] of cardPreviews) handle.destroy()
  cardPreviews.clear()
})

// Close on Escape
function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') emit('close') }
onMounted(() => window.addEventListener('keydown', onKeyDown))
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<template>
  <div class="ktm-overlay" @mousedown.self="emit('close')">
    <div class="ktm">
      <!-- Header -->
      <div class="ktm__header">
        <h2 class="ktm__title">Kinetic Typography</h2>
        <div class="ktm__header-right">
          <button v-if="!isBaking" type="button" class="ktm__bake-btn" @click="doBake">Bake frames</button>
          <span v-else class="ktm__bake-progress">Baking {{ Math.round(bakeProgress * 100) }}%</span>
          <span v-if="state.rendered.length" class="ktm__frame-count">{{ state.rendered.length }} frames</span>
          <button type="button" class="ktm__close" @click="emit('close')">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </div>

      <!-- Preview — fixed at the top, always visible -->
      <div class="ktm__stage" :style="{ background: stageBg }">
        <div ref="previewEl" class="ktm__preview" :style="previewStyle">{{ state.text || 'Hello' }}</div>
        <button type="button" class="ktm__replay" @click="replayPreview">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
        </button>
      </div>

      <div class="ktm__body">
        <!-- Left: Preset gallery -->
        <div class="ktm__left">
          <!-- Preset gallery — In / Out / Loop tabs -->
          <div class="ktm__presets">
            <!-- Tab bar -->
            <div class="ktm__tabs">
              <button
                v-for="cat in (['in', 'out', 'loop'] as KineticCategory[])" :key="cat"
                type="button"
                class="ktm__tab"
                :class="{ 'ktm__tab--active': presetTab === cat }"
                @click="presetTab = cat"
              >{{ KINETIC_CATEGORY_LABELS[cat] }}</button>
            </div>

            <!-- Grouped preset cards -->
            <div class="ktm__preset-list">
              <template v-for="g in groupedPresets" :key="g.group">
                <div class="ktm__group-label">{{ g.label }}</div>
                <div class="ktm__preset-grid">
                  <button
                    v-for="p in g.presets" :key="p.id" type="button"
                    class="ktm__preset-card"
                    :class="{ 'ktm__preset-card--active': state.presetId === p.id }"
                    :title="p.pitch"
                    @click="setPreset(p.id)"
                  >
                    <div class="ktm__card-preview">
                      <span :ref="(el: any) => setCardRef(p.id, el as HTMLElement)">Text</span>
                    </div>
                    <span class="ktm__preset-name">{{ p.label }}</span>
                  </button>
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- Right: Controls -->
        <div class="ktm__right">
          <!-- Text -->
          <input class="ktm__input" :value="state.text" placeholder="Type something…" @input="setText(($event.target as HTMLInputElement).value)" />

          <!-- Font -->
          <FontPicker :selected-key="activeFont.key" :label="fontLabel" :sublabel="fontSublabel" @pick="onPickFont" />

          <!-- Font axes -->
          <div class="ktm__section">
            <div class="ktm__section-label">Typography</div>
            <div v-for="ax in activeFont.axes" :key="ax.tag" class="ktm__slider">
              <div class="ktm__slider-head"><span>{{ ax.label }}</span><span class="ktm__slider-val">{{ Math.round((state.axes[ax.tag] ?? ax.default) * 100) / 100 }}</span></div>
              <input type="range" :min="ax.min" :max="ax.max" :step="ax.step ?? 1" :value="state.axes[ax.tag] ?? ax.default" class="ktm__range" @input="setAxis(ax.tag, +($event.target as HTMLInputElement).value)" />
            </div>
            <div class="ktm__slider">
              <div class="ktm__slider-head"><span>Size</span><span class="ktm__slider-val">{{ state.size }}px</span></div>
              <input type="range" min="24" max="400" step="1" :value="state.size" class="ktm__range" @input="setSize(+($event.target as HTMLInputElement).value)" />
            </div>
            <div class="ktm__slider">
              <div class="ktm__slider-head"><span>Spacing</span><span class="ktm__slider-val">{{ state.letterSpacing.toFixed(2) }}em</span></div>
              <input type="range" min="-0.1" max="0.5" step="0.01" :value="state.letterSpacing" class="ktm__range" @input="setLetterSpacing(+($event.target as HTMLInputElement).value)" />
            </div>
          </div>

          <!-- Animation -->
          <div class="ktm__section">
            <div class="ktm__section-label">Animation</div>
            <div class="ktm__slider">
              <div class="ktm__slider-head"><span>Duration</span><span class="ktm__slider-val">{{ state.duration.toFixed(1) }}s</span></div>
              <input type="range" min="0.3" max="8" step="0.1" :value="state.duration" class="ktm__range" @input="setDuration(+($event.target as HTMLInputElement).value)" />
            </div>
            <div class="ktm__slider">
              <div class="ktm__slider-head"><span>Stagger</span><span class="ktm__slider-val">{{ state.stagger.toFixed(2) }}s</span></div>
              <input type="range" min="0.01" max="0.3" step="0.005" :value="state.stagger" class="ktm__range" @input="setStagger(+($event.target as HTMLInputElement).value)" />
            </div>
            <div class="ktm__slider">
              <div class="ktm__slider-head"><span>Ease</span><span class="ktm__slider-val">{{ EASE_OPTIONS.find(e => e.id === state.ease)?.label || state.ease }}</span></div>
              <select class="ktm__select" :value="state.ease" @change="setEase(($event.target as HTMLSelectElement).value)">
                <option v-for="e in EASE_OPTIONS" :key="e.id" :value="e.id" class="bg-[#1b1b1b]">{{ e.label }}</option>
              </select>
            </div>
          </div>

          <!-- Axis keyframes -->
          <div v-if="activeFont.axes.length > 0" class="ktm__section">
            <button type="button" class="ktm__expander" @click="showAxisKeyframes = !showAxisKeyframes">
              <svg :class="{ 'ktm__chevron--open': showAxisKeyframes }" class="ktm__chevron" width="10" height="10" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Font Animation
              <span v-if="state.axisKeyframes.length" class="ktm__badge">{{ state.axisKeyframes.length }} kf</span>
            </button>
            <AxisKeyframeEditor v-if="showAxisKeyframes" :keyframes="state.axisKeyframes" :axes="activeFont.axes" :current-axes="state.axes" @update:keyframes="setAxisKeyframes" />
          </div>

          <!-- Colors -->
          <div class="ktm__section">
            <div class="ktm__section-label">Colors</div>
            <div class="ktm__colors">
              <label class="ktm__color"><input type="color" :value="state.color" @input="setColor(($event.target as HTMLInputElement).value)" /><span>Text</span></label>
              <label class="ktm__color" :class="{ 'ktm__color--off': state.bg === 'transparent' }">
                <input type="color" :value="state.bg === 'transparent' ? '#000000' : state.bg" :disabled="state.bg === 'transparent'" @input="setBg(($event.target as HTMLInputElement).value)" /><span>BG</span>
              </label>
              <button type="button" class="ktm__toggle" :class="{ 'ktm__toggle--on': state.bg === 'transparent' }" @click="toggleTransparent">Transparent</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ktm-overlay {
  position: fixed; inset: 0; z-index: 9000;
  background: rgba(0,0,0,0.6); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.ktm {
  width: min(920px, 92vw); height: min(640px, 82vh);
  background: #1a1a1a; border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px; overflow: hidden;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 80px rgba(0,0,0,0.5);
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.ktm__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid rgba(255,255,255,0.06);
}
.ktm__title { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.9); margin: 0; }
.ktm__header-right { display: flex; align-items: center; gap: 10px; }
.ktm__bake-btn {
  font-size: 11px; padding: 4px 12px; border-radius: 6px;
  background: rgba(129,140,248,0.2); border: 1px solid rgba(129,140,248,0.4);
  color: rgba(199,210,254,0.95); cursor: pointer;
}
.ktm__bake-btn:hover { background: rgba(129,140,248,0.3); }
.ktm__bake-progress { font-size: 11px; color: rgba(129,140,248,0.8); }
.ktm__frame-count { font-size: 10px; color: rgba(255,255,255,0.35); }
.ktm__close {
  width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;
  background: none; border: none; color: rgba(255,255,255,0.4); cursor: pointer; border-radius: 6px;
}
.ktm__close:hover { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.8); }

/* ── Body (two columns, each scrolls independently) ──────────────────────── */
.ktm__body {
  display: flex; gap: 0; flex: 1; min-height: 0;
}
.ktm__left {
  flex: 1 1 55%; display: flex; flex-direction: column; gap: 12px;
  padding: 16px 18px; border-right: 1px solid rgba(255,255,255,0.06);
  overflow-y: auto; min-height: 0;
}
.ktm__right {
  flex: 1 1 45%; display: flex; flex-direction: column; gap: 10px;
  padding: 16px 18px; overflow-y: auto; min-height: 0;
}

/* ── Preview stage (pinned above the two-column body) ────────────────────── */
.ktm__stage {
  position: relative; height: 120px; flex-shrink: 0;
  margin: 0 18px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; border: 1px solid rgba(255,255,255,0.08);
}
.ktm__preview { max-width: 100%; overflow: hidden; text-overflow: ellipsis; padding: 0 20px; }
.ktm__replay {
  position: absolute; top: 8px; right: 8px;
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.15);
  border-radius: 7px; color: rgba(255,255,255,0.7); cursor: pointer;
}
.ktm__replay:hover { background: rgba(0,0,0,0.7); color: #fff; }

/* ── Preset gallery ──────────────────────────────────────────────────────── */
.ktm__presets { display: flex; flex-direction: column; gap: 8px; }

.ktm__tabs { display: flex; gap: 2px; }
.ktm__tab {
  flex: 1; padding: 6px 0; border-radius: 6px; font-size: 11px; font-weight: 600;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
  color: rgba(255,255,255,0.5); cursor: pointer; transition: all 0.15s;
  text-transform: uppercase; letter-spacing: 0.05em;
}
.ktm__tab:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }
.ktm__tab--active {
  background: rgba(129,140,248,0.15) !important;
  border-color: rgba(129,140,248,0.4) !important;
  color: rgba(199,210,254,0.95);
}

.ktm__preset-list { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; }
.ktm__group-label {
  font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.45);
  margin-top: 4px; padding-bottom: 2px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.ktm__preset-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.ktm__preset-card {
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 8px 6px 6px; border-radius: 8px;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
  cursor: pointer; transition: all 0.15s;
}
.ktm__preset-card:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.15); }
.ktm__preset-card--active {
  background: rgba(129,140,248,0.15) !important;
  border-color: rgba(129,140,248,0.5) !important;
}
.ktm__card-preview {
  height: 32px; display: flex; align-items: center; justify-content: center;
  overflow: hidden; font-size: 20px; font-weight: 700; color: rgba(255,255,255,0.85);
  white-space: nowrap;
}
.ktm__card-preview :deep(div) { display: inline; }
.ktm__preset-name { font-size: 9.5px; color: rgba(255,255,255,0.55); white-space: nowrap; }

/* ── Controls ────────────────────────────────────────────────────────────── */
.ktm__input, .ktm__select {
  width: 100%; background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 7px;
  padding: 6px 10px; font-size: 13px; color: rgba(255,255,255,0.92); outline: none;
}
.ktm__input:focus, .ktm__select:focus { border-color: rgba(255,255,255,0.25); }

.ktm__section { display: flex; flex-direction: column; gap: 6px; }
.ktm__section-label {
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em;
  color: rgba(255,255,255,0.35); margin-top: 2px;
}
.ktm__slider { display: flex; flex-direction: column; gap: 2px; }
.ktm__slider-head { display: flex; justify-content: space-between; font-size: 11px; color: rgba(255,255,255,0.55); }
.ktm__slider-val { font-variant-numeric: tabular-nums; color: rgba(255,255,255,0.8); }
.ktm__range { width: 100%; height: 5px; cursor: pointer; accent-color: #818cf8; }

/* ── Colors ──────────────────────────────────────────────────────────────── */
.ktm__colors { display: flex; align-items: center; gap: 10px; }
.ktm__color { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: rgba(255,255,255,0.6); cursor: pointer; }
.ktm__color input[type="color"] { width: 24px; height: 24px; border: none; border-radius: 6px; background: none; cursor: pointer; padding: 0; }
.ktm__color--off { opacity: 0.5; }
.ktm__toggle {
  margin-left: auto; font-size: 10px; padding: 3px 10px; border-radius: 5px;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.65); cursor: pointer;
}
.ktm__toggle--on { background: rgba(129,140,248,0.22); border-color: rgba(129,140,248,0.4); color: rgb(199,210,254); }

/* ── Expander ────────────────────────────────────────────────────────────── */
.ktm__expander {
  display: flex; align-items: center; gap: 5px;
  font-size: 11px; color: rgba(255,255,255,0.55);
  background: none; border: none; cursor: pointer; padding: 2px 0;
}
.ktm__expander:hover { color: rgba(255,255,255,0.8); }
.ktm__chevron { transition: transform 0.15s; color: rgba(255,255,255,0.4); }
.ktm__chevron--open { transform: rotate(90deg); }
.ktm__badge { font-size: 9px; background: rgba(129,140,248,0.2); color: rgba(129,140,248,0.9); padding: 1px 6px; border-radius: 3px; margin-left: auto; }
</style>
