<script setup lang="ts">
/**
 * WidgetTextOnPath — render text along a curve (arc, circle, wave, line).
 *
 * Shows an SVG preview of the path with an approximation of the text laid
 * along it. On bake, renders to Canvas2D via textOnPath.ts and uploads.
 *
 * State: { text, fontId, fontSource, googleFamily, googleAxes, googleWeights,
 *          weight, axes, size, letterSpacing, color, bg, path, rendered, w, h }
 */
import { useElementSize } from '@vueuse/core'
import { VARIABLE_FONTS_BY_ID, DEFAULT_FONT_ID, type FontAxis } from '~/data/variable-fonts'
import { type GoogleFont, googleAxisList, buildGoogleCssUrl, quickGoogleCssUrl, nearestWeight } from '~/data/google-fonts'
import {
  renderTextOnPath, previewPathSvg,
  type PathParams, type PathType, type TextOnPathOptions,
  DEFAULT_PATH,
} from '~/utils/textOnPath'
import FontPicker from './FontPicker.vue'

const props = defineProps<{ modelValue: string; label?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

interface TopState {
  text: string
  fontId: string; fontSource: 'variable' | 'google'
  googleFamily: string
  googleAxes: { tag: string; min: number; max: number; default: number }[]
  googleWeights: number[]; weight: number
  axes: Record<string, number>
  size: number; letterSpacing: number; color: string; bg: string
  path: PathParams
  rendered: string; w: number; h: number
}

const num = (v: any, d: number) => (Number.isFinite(+v) ? +v : d)

function parsePath(o: any): PathParams {
  if (!o || typeof o !== 'object') return { ...DEFAULT_PATH }
  const t = o.type as PathType
  switch (t) {
    case 'arc': return { type: 'arc', radius: num(o.radius, 200), startAngle: num(o.startAngle, -90), endAngle: num(o.endAngle, 90) }
    case 'circle': return { type: 'circle', radius: num(o.radius, 200) }
    case 'wave': return { type: 'wave', amplitude: num(o.amplitude, 40), frequency: num(o.frequency, 2), phase: num(o.phase, 0) }
    case 'line': return { type: 'line', curvature: num(o.curvature, 0.3) }
    default: return { ...DEFAULT_PATH }
  }
}

function parse(s: string): TopState {
  let o: any = {}
  try { o = JSON.parse(s || '{}') } catch { o = {} }
  const fontId = VARIABLE_FONTS_BY_ID[o.fontId] ? o.fontId : DEFAULT_FONT_ID
  const font = VARIABLE_FONTS_BY_ID[fontId]!
  return {
    text: typeof o.text === 'string' ? o.text : 'Hello World',
    fontId, fontSource: o.fontSource === 'google' ? 'google' : 'variable',
    googleFamily: typeof o.googleFamily === 'string' ? o.googleFamily : '',
    googleAxes: Array.isArray(o.googleAxes) ? o.googleAxes : [],
    googleWeights: Array.isArray(o.googleWeights) ? o.googleWeights.filter((x: any) => Number.isFinite(+x)).map(Number) : [],
    weight: num(o.weight, 400),
    axes: (o.axes && typeof o.axes === 'object') ? o.axes : Object.fromEntries(font.axes.map(a => [a.tag, a.default])),
    size: num(o.size, 80), letterSpacing: num(o.letterSpacing, 0.02),
    color: typeof o.color === 'string' ? o.color : '#ffffff',
    bg: typeof o.bg === 'string' ? o.bg : 'transparent',
    path: parsePath(o.path),
    rendered: typeof o.rendered === 'string' ? o.rendered : '',
    w: num(o.w, 0), h: num(o.h, 0),
  }
}

const state = ref<TopState>(parse(props.modelValue))
watch(() => props.modelValue, (v) => { const inc = parse(v); if (inc.rendered !== state.value.rendered || inc.text !== state.value.text) state.value = inc })

// ── Active font ─────────────────────────────────────────────────────────────

interface ActiveFont { source: 'variable' | 'google'; family: string; axes: FontAxis[]; cssUrl: string; key: string }
function googleFromState(): GoogleFont {
  return { family: state.value.googleFamily || 'Roboto', category: 'sans', weights: state.value.googleWeights.length ? state.value.googleWeights : [400], italic: false, axes: state.value.googleAxes }
}
const activeFont = computed<ActiveFont>(() => {
  if (state.value.fontSource === 'google') {
    const gf = googleFromState(); const axes = googleAxisList(gf)
    return { source: 'google', family: gf.family, axes, cssUrl: axes.length ? buildGoogleCssUrl(gf) : quickGoogleCssUrl(gf.family, state.value.weight || nearestWeight(gf, 400)), key: 'goog:' + gf.family }
  }
  const f = VARIABLE_FONTS_BY_ID[state.value.fontId] ?? VARIABLE_FONTS_BY_ID[DEFAULT_FONT_ID]!
  return { source: 'variable', family: f.family, axes: f.axes, cssUrl: f.cssUrl, key: 'var:' + f.id }
})
const fontLabel = computed(() => activeFont.value.source === 'google' ? activeFont.value.family : (VARIABLE_FONTS_BY_ID[state.value.fontId]?.label ?? activeFont.value.family))
const variationSettings = computed(() => Object.entries(state.value.axes).map(([t, v]) => `"${t}" ${v}`).join(', '))

// Font loading
const loaded = new Set<string>()
function ensureFont(url: string) { if (typeof document === 'undefined' || loaded.has(url)) return; const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = url; document.head.appendChild(l); loaded.add(url) }
watch(() => activeFont.value.cssUrl, u => ensureFont(u), { immediate: true })

// ── Preview ─────────────────────────────────────────────────────────────────
const previewEl = ref<HTMLElement | null>(null)
const { width: previewW, height: previewH } = useElementSize(previewEl)
const svgPath = computed(() => previewPathSvg(state.value.path, previewW.value || 240, previewH.value || 80))
const stageBg = computed(() => state.value.bg === 'transparent' ? 'repeating-conic-gradient(#2a2a2a 0% 25%, #1e1e1e 0% 50%) 50% / 16px 16px' : state.value.bg)

// ── Path type options ───────────────────────────────────────────────────────
const PATH_TYPES: { id: PathType; label: string }[] = [
  { id: 'arc', label: 'Arc' },
  { id: 'circle', label: 'Circle' },
  { id: 'wave', label: 'Wave' },
  { id: 'line', label: 'Curved Line' },
]

// ── Bake ────────────────────────────────────────────────────────────────────
const baking = ref(false)
let bakeTimer: ReturnType<typeof setTimeout> | null = null
function scheduleBake() { if (bakeTimer) clearTimeout(bakeTimer); bakeTimer = setTimeout(bakeAndUpload, 500) }

async function bakeAndUpload() {
  const s = state.value
  if (!s.text.trim()) return
  ensureFont(activeFont.value.cssUrl)
  const wght = s.axes.wght ?? s.weight ?? 700
  try { await Promise.race([document.fonts.load(`${wght} 64px "${activeFont.value.family}"`).then(() => document.fonts.ready), new Promise(r => setTimeout(r, 2500))]) } catch {}

  baking.value = true
  try {
    const canvas = renderTextOnPath({
      text: s.text, fontFamily: activeFont.value.family, fontWeight: wght,
      fontSizePx: s.size, variationSettings: variationSettings.value,
      letterSpacing: s.letterSpacing, color: s.color, bgColor: s.bg, path: s.path,
    })
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    if (!blob) return
    const fd = new FormData()
    const fname = `textpath_${Date.now()}.png`
    fd.append('image', new File([blob], fname, { type: 'image/png' }))
    fd.append('overwrite', 'true')
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (res.ok) {
      const data = await res.json() as { name?: string; subfolder?: string }
      const name = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name || fname)
      commit({ rendered: name, w: canvas.width, h: canvas.height })
    }
  } catch {} finally { baking.value = false }
}

// ── Mutations ───────────────────────────────────────────────────────────────
function commit(patch: Partial<TopState> = {}) { state.value = { ...state.value, ...patch }; emit('update:modelValue', JSON.stringify(state.value)) }
function setText(v: string) { commit({ text: v }); scheduleBake() }
function setSize(v: number) { commit({ size: v }); scheduleBake() }
function setLetterSpacing(v: number) { commit({ letterSpacing: v }); scheduleBake() }
function setColor(v: string) { commit({ color: v }); scheduleBake() }
function setBg(v: string) { commit({ bg: v }); scheduleBake() }
function setAxis(tag: string, v: number) { commit({ axes: { ...state.value.axes, [tag]: v } }); scheduleBake() }
function toggleTransparent() { setBg(state.value.bg === 'transparent' ? '#000000' : 'transparent') }

function setPathType(t: PathType) {
  const defaults: Record<PathType, PathParams> = {
    arc: { type: 'arc', radius: 200, startAngle: -90, endAngle: 90 },
    circle: { type: 'circle', radius: 200 },
    wave: { type: 'wave', amplitude: 40, frequency: 2, phase: 0 },
    line: { type: 'line', curvature: 0.3 },
  }
  commit({ path: defaults[t] }); scheduleBake()
}

function setPathParam(key: string, v: number) {
  commit({ path: { ...state.value.path, [key]: v } as PathParams }); scheduleBake()
}

function onPickFont(payload: { source: 'variable'; id: string } | { source: 'google'; font: GoogleFont }) {
  if (payload.source === 'variable') {
    const f = VARIABLE_FONTS_BY_ID[payload.id]
    if (f) { commit({ fontSource: 'variable', fontId: payload.id, axes: Object.fromEntries(f.axes.map(a => [a.tag, a.default])) }); scheduleBake() }
  } else {
    const gf = payload.font
    commit({ fontSource: 'google', googleFamily: gf.family, googleAxes: gf.axes, googleWeights: gf.weights, weight: nearestWeight(gf, 400), axes: Object.fromEntries(googleAxisList(gf).map(a => [a.tag, a.default])) })
    scheduleBake()
  }
}

onMounted(() => { if (!state.value.rendered) scheduleBake() })
</script>

<template>
  <div class="nopan nodrag top">
    <!-- SVG path preview -->
    <div ref="previewEl" class="top__stage" :style="{ background: stageBg }">
      <svg class="top__svg" :viewBox="`0 0 ${previewW || 240} ${previewH || 80}`" preserveAspectRatio="xMidYMid meet">
        <path :d="svgPath" fill="none" stroke="rgba(129,140,248,0.4)" stroke-width="1.5" stroke-dasharray="4,3" />
      </svg>
      <div class="top__text-hint" :style="{ fontFamily: `'${activeFont.family}', sans-serif`, fontWeight: String(state.axes.wght ?? state.weight ?? 700), color: state.color, fontSize: '14px' }">
        {{ state.text || 'Hello World' }}
      </div>
      <div v-if="baking" class="top__baking">baking…</div>
    </div>

    <input class="top__input" :value="state.text" placeholder="Type text…" @input="setText(($event.target as HTMLInputElement).value)" />
    <FontPicker :selected-key="activeFont.key" :label="fontLabel" sublabel="" @pick="onPickFont" />

    <!-- Path type selector -->
    <div class="top__path-row">
      <button v-for="pt in PATH_TYPES" :key="pt.id" type="button" class="top__path-btn" :class="{ 'top__path-btn--active': state.path.type === pt.id }" @click="setPathType(pt.id)">{{ pt.label }}</button>
    </div>

    <!-- Path params (dynamic per type) -->
    <div class="top__section">
      <template v-if="state.path.type === 'arc'">
        <div class="top__slider"><div class="top__slider-head"><span>Radius</span><span class="top__slider-val">{{ (state.path as any).radius }}</span></div>
          <input type="range" min="50" max="600" step="1" :value="(state.path as any).radius" class="top__range" @input="setPathParam('radius', +($event.target as HTMLInputElement).value)" /></div>
        <div class="top__slider"><div class="top__slider-head"><span>Start</span><span class="top__slider-val">{{ (state.path as any).startAngle }}°</span></div>
          <input type="range" min="-180" max="180" step="1" :value="(state.path as any).startAngle" class="top__range" @input="setPathParam('startAngle', +($event.target as HTMLInputElement).value)" /></div>
        <div class="top__slider"><div class="top__slider-head"><span>End</span><span class="top__slider-val">{{ (state.path as any).endAngle }}°</span></div>
          <input type="range" min="-180" max="180" step="1" :value="(state.path as any).endAngle" class="top__range" @input="setPathParam('endAngle', +($event.target as HTMLInputElement).value)" /></div>
      </template>
      <template v-else-if="state.path.type === 'circle'">
        <div class="top__slider"><div class="top__slider-head"><span>Radius</span><span class="top__slider-val">{{ (state.path as any).radius }}</span></div>
          <input type="range" min="50" max="600" step="1" :value="(state.path as any).radius" class="top__range" @input="setPathParam('radius', +($event.target as HTMLInputElement).value)" /></div>
      </template>
      <template v-else-if="state.path.type === 'wave'">
        <div class="top__slider"><div class="top__slider-head"><span>Amplitude</span><span class="top__slider-val">{{ (state.path as any).amplitude }}</span></div>
          <input type="range" min="5" max="200" step="1" :value="(state.path as any).amplitude" class="top__range" @input="setPathParam('amplitude', +($event.target as HTMLInputElement).value)" /></div>
        <div class="top__slider"><div class="top__slider-head"><span>Frequency</span><span class="top__slider-val">{{ (state.path as any).frequency }}</span></div>
          <input type="range" min="0.5" max="8" step="0.1" :value="(state.path as any).frequency" class="top__range" @input="setPathParam('frequency', +($event.target as HTMLInputElement).value)" /></div>
        <div class="top__slider"><div class="top__slider-head"><span>Phase</span><span class="top__slider-val">{{ (state.path as any).phase }}°</span></div>
          <input type="range" min="0" max="360" step="1" :value="(state.path as any).phase" class="top__range" @input="setPathParam('phase', +($event.target as HTMLInputElement).value)" /></div>
      </template>
      <template v-else-if="state.path.type === 'line'">
        <div class="top__slider"><div class="top__slider-head"><span>Curvature</span><span class="top__slider-val">{{ ((state.path as any).curvature).toFixed(2) }}</span></div>
          <input type="range" min="-1" max="1" step="0.01" :value="(state.path as any).curvature" class="top__range" @input="setPathParam('curvature', +($event.target as HTMLInputElement).value)" /></div>
      </template>
    </div>

    <!-- Font axes + size -->
    <div class="top__section">
      <div v-for="ax in activeFont.axes" :key="ax.tag" class="top__slider"><div class="top__slider-head"><span>{{ ax.label }}</span><span class="top__slider-val">{{ Math.round((state.axes[ax.tag] ?? ax.default) * 100) / 100 }}</span></div>
        <input type="range" :min="ax.min" :max="ax.max" :step="ax.step ?? 1" :value="state.axes[ax.tag] ?? ax.default" class="top__range" @input="setAxis(ax.tag, +($event.target as HTMLInputElement).value)" /></div>
      <div class="top__slider"><div class="top__slider-head"><span>Size</span><span class="top__slider-val">{{ state.size }}px</span></div>
        <input type="range" min="24" max="300" step="1" :value="state.size" class="top__range" @input="setSize(+($event.target as HTMLInputElement).value)" /></div>
      <div class="top__slider"><div class="top__slider-head"><span>Spacing</span><span class="top__slider-val">{{ state.letterSpacing.toFixed(2) }}em</span></div>
        <input type="range" min="-0.05" max="0.3" step="0.005" :value="state.letterSpacing" class="top__range" @input="setLetterSpacing(+($event.target as HTMLInputElement).value)" /></div>
    </div>

    <!-- Colors -->
    <div class="top__colors">
      <label class="top__color"><input type="color" :value="state.color" @input="setColor(($event.target as HTMLInputElement).value)" /><span>Text</span></label>
      <label class="top__color" :class="{ 'top__color--off': state.bg === 'transparent' }">
        <input type="color" :value="state.bg === 'transparent' ? '#000000' : state.bg" :disabled="state.bg === 'transparent'" @input="setBg(($event.target as HTMLInputElement).value)" /><span>BG</span>
      </label>
      <button type="button" class="top__toggle" :class="{ 'top__toggle--on': state.bg === 'transparent' }" @click="toggleTransparent">Transparent</button>
    </div>
  </div>
</template>

<style scoped>
.top { display: flex; flex-direction: column; gap: 7px; padding: 4px 0 6px; user-select: none; }
.top__stage { position: relative; height: 80px; border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
.top__svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.top__text-hint { position: relative; z-index: 1; white-space: nowrap; max-width: 90%; overflow: hidden; text-overflow: ellipsis; opacity: 0.5; font-size: 14px; }
.top__baking { position: absolute; top: 4px; right: 6px; font-size: 9px; color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.4); padding: 1px 5px; border-radius: 4px; }
.top__input { width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 5px 8px; font-size: 12px; color: rgba(255,255,255,0.92); outline: none; }
.top__input:focus { border-color: rgba(255,255,255,0.25); }

.top__path-row { display: flex; gap: 3px; }
.top__path-btn { flex: 1; font-size: 10px; padding: 4px 0; border-radius: 5px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); color: rgba(255,255,255,0.6); cursor: pointer; transition: all 0.15s; }
.top__path-btn:hover { background: rgba(255,255,255,0.08); }
.top__path-btn--active { background: rgba(129,140,248,0.18) !important; border-color: rgba(129,140,248,0.5) !important; color: rgb(199,210,254); }

.top__section { display: flex; flex-direction: column; gap: 5px; }
.top__slider { display: flex; flex-direction: column; gap: 1px; }
.top__slider-head { display: flex; justify-content: space-between; font-size: 10px; color: rgba(255,255,255,0.55); }
.top__slider-val { font-variant-numeric: tabular-nums; color: rgba(255,255,255,0.8); }
.top__range { width: 100%; } /* slider visual unified globally in main.css (input[type=range]) */

.top__colors { display: flex; align-items: center; gap: 8px; }
.top__color { display: inline-flex; align-items: center; gap: 5px; font-size: 10.5px; color: rgba(255,255,255,0.6); cursor: pointer; }
.top__color input[type="color"] { width: 22px; height: 22px; border: none; border-radius: 5px; background: none; cursor: pointer; padding: 0; }
.top__color--off { opacity: 0.5; }
.top__toggle { margin-left: auto; font-size: 10px; padding: 3px 8px; border-radius: 5px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.65); cursor: pointer; }
.top__toggle--on { background: rgba(129,140,248,0.22); border-color: rgba(129,140,248,0.4); color: rgb(199,210,254); }
</style>
