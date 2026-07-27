<script setup lang="ts">
/**
 * WidgetTextMask — renders text as a black & white mask.
 *
 * Same font selection and axis controls as the other in-node type widgets
 * (it grew out of the retired Font Playground and still shares its FontPicker
 * and textWarp helpers), but always renders white text on black. The output
 * is a mask that can clip an upstream image.
 *
 * State: { fontId, fontSource, googleFamily, googleAxes, googleWeights,
 *          weight, text, size, axes, letterSpacing, kerning, transform,
 *          rendered, w, h, invert }
 */
import { useElementSize } from '@vueuse/core'
import { VARIABLE_FONTS_BY_ID, DEFAULT_FONT_ID, type VariableFont, type FontAxis } from '~/data/variable-fonts'
import {
  type GoogleFont, googleAxisList, buildGoogleCssUrl, quickGoogleCssUrl, nearestWeight,
} from '~/data/google-fonts'
import {
  type Transform3D, IDENTITY_TRANSFORM, isIdentity,
  composeMatrix, projectPoint, affineFromMatrix, transformedBounds, cssTransform, hasTilt,
} from '~/utils/textWarp'
import FontPicker from './FontPicker.vue'

const props = defineProps<{
  modelValue: string
  label?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

interface MaskState {
  fontId: string
  fontSource: 'variable' | 'google'
  googleFamily: string
  googleAxes: { tag: string; min: number; max: number; default: number }[]
  googleWeights: number[]
  weight: number
  text: string
  size: number
  axes: Record<string, number>
  letterSpacing: number
  kerning: boolean
  transform: Transform3D
  rendered: string
  w: number
  h: number
  invert: boolean   // when true: black text on white (inverted mask)
}

const num = (v: any, d: number) => (Number.isFinite(+v) ? +v : d)

function parseTransform(o: any): Transform3D {
  if (!o || typeof o !== 'object') return { ...IDENTITY_TRANSFORM }
  return {
    rotate: num(o.rotate, 0),
    skewX: num(o.skewX, 0),
    skewY: num(o.skewY, 0),
    tiltX: num(o.tiltX, 0),
    tiltY: num(o.tiltY, 0),
    depth: num(o.depth, IDENTITY_TRANSFORM.depth),
  }
}

function parse(s: string): MaskState {
  let o: any = {}
  try { o = JSON.parse(s || '{}') } catch { o = {} }
  const fontId = VARIABLE_FONTS_BY_ID[o.fontId] ? o.fontId : DEFAULT_FONT_ID
  const font = VARIABLE_FONTS_BY_ID[fontId]!
  return {
    fontId,
    fontSource: o.fontSource === 'google' ? 'google' : 'variable',
    googleFamily: typeof o.googleFamily === 'string' ? o.googleFamily : '',
    googleAxes: Array.isArray(o.googleAxes) ? o.googleAxes : [],
    googleWeights: Array.isArray(o.googleWeights) ? o.googleWeights.filter((x: any) => Number.isFinite(+x)).map(Number) : [],
    weight: num(o.weight, 400),
    text: typeof o.text === 'string' ? o.text : 'MASK',
    size: num(o.size, 200),
    axes: (o.axes && typeof o.axes === 'object') ? o.axes : Object.fromEntries(font.axes.map(a => [a.tag, a.default])),
    letterSpacing: num(o.letterSpacing, 0),
    kerning: typeof o.kerning === 'boolean' ? o.kerning : true,
    transform: parseTransform(o.transform),
    rendered: typeof o.rendered === 'string' ? o.rendered : '',
    w: num(o.w, 0),
    h: num(o.h, 0),
    invert: typeof o.invert === 'boolean' ? o.invert : false,
  }
}

const state = ref<MaskState>(parse(props.modelValue))
watch(() => props.modelValue, (v) => {
  const incoming = parse(v)
  if (incoming.rendered !== state.value.rendered || incoming.text !== state.value.text) {
    state.value = incoming
  }
})

// ── Active font ─────────────────────────────────────────────────────────────

interface ActiveFont {
  source: 'variable' | 'google'
  family: string
  axes: FontAxis[]
  cssUrl: string
  key: string
}

function googleFromState(): GoogleFont {
  return {
    family: state.value.googleFamily || 'Roboto',
    category: 'sans',
    weights: state.value.googleWeights.length ? state.value.googleWeights : [400],
    italic: false,
    axes: state.value.googleAxes,
  }
}

const activeFont = computed<ActiveFont>(() => {
  if (state.value.fontSource === 'google') {
    const gf = googleFromState()
    const axes = googleAxisList(gf)
    return {
      source: 'google',
      family: gf.family,
      axes,
      cssUrl: axes.length ? buildGoogleCssUrl(gf) : quickGoogleCssUrl(gf.family, state.value.weight || nearestWeight(gf, 400)),
      key: 'goog:' + gf.family,
    }
  }
  const f = VARIABLE_FONTS_BY_ID[state.value.fontId] ?? VARIABLE_FONTS_BY_ID[DEFAULT_FONT_ID]!
  return { source: 'variable', family: f.family, axes: f.axes, cssUrl: f.cssUrl, key: 'var:' + f.id }
})

const fontLabel = computed(() =>
  activeFont.value.source === 'google'
    ? activeFont.value.family
    : (VARIABLE_FONTS_BY_ID[state.value.fontId]?.label ?? activeFont.value.family))

const variationSettings = computed(() =>
  Object.entries(state.value.axes).map(([t, v]) => `"${t}" ${v}`).join(', '))

// ── Font loading ────────────────────────────────────────────────────────────

const loaded = new Set<string>()
function ensureFont(cssUrl: string) {
  if (typeof document === 'undefined' || loaded.has(cssUrl)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = cssUrl
  document.head.appendChild(link)
  loaded.add(cssUrl)
}
watch(() => activeFont.value.cssUrl, (url) => ensureFont(url), { immediate: true })

// ── Preview ─────────────────────────────────────────────────────────────────

const previewEl = ref<HTMLElement | null>(null)
const { width: previewW } = useElementSize(previewEl)

const textColor = computed(() => state.value.invert ? '#000000' : '#ffffff')
const bgColor = computed(() => state.value.invert ? '#ffffff' : '#000000')

const previewStyle = computed(() => ({
  fontFamily: `"${activeFont.value.family}", sans-serif`,
  fontWeight: String(state.value.axes.wght ?? state.value.weight ?? 700),
  fontVariationSettings: variationSettings.value,
  fontSize: `${Math.min(56, state.value.size / 3)}px`,
  color: textColor.value,
  lineHeight: '1.1',
  letterSpacing: `${state.value.letterSpacing}em`,
  fontKerning: state.value.kerning ? 'normal' : 'none',
  transform: cssTransform(state.value.transform, previewW.value || 300),
  transformOrigin: 'center',
}))

// ── Bake (always B&W) ───────────────────────────────────────────────────────

const SCALE = 2
const PAD = 0.25
const baking = ref(false)
let bakeTimer: ReturnType<typeof setTimeout> | null = null

function scheduleBake() {
  if (bakeTimer) clearTimeout(bakeTimer)
  bakeTimer = setTimeout(bakeAndUpload, 400)
}

function applyCtxFont(ctx: CanvasRenderingContext2D, px: number) {
  const wght = state.value.axes.wght ?? state.value.weight ?? 700
  ctx.font = `${wght} ${px}px "${activeFont.value.family}", sans-serif`
  if ('fontVariationSettings' in ctx) {
    ;(ctx as any).fontVariationSettings = variationSettings.value
  }
  if ((ctx as any).letterSpacing !== undefined) {
    ;(ctx as any).letterSpacing = `${state.value.letterSpacing * px}px`
  }
  if ('fontKerning' in ctx) ctx.fontKerning = state.value.kerning ? 'normal' : 'none'
}

async function bakeAndUpload() {
  const s = state.value
  if (!s.text.trim()) return

  // Ensure font
  ensureFont(activeFont.value.cssUrl)
  const wght = s.axes.wght ?? s.weight ?? 700
  const spec = `${wght} 64px "${activeFont.value.family}"`
  try {
    await Promise.race([
      document.fonts.load(spec).then(() => document.fonts.ready),
      new Promise(r => setTimeout(r, 2500)),
    ])
  } catch {}

  const fontPx = s.size * SCALE
  const pad = fontPx * PAD

  const scratch = document.createElement('canvas').getContext('2d')!
  applyCtxFont(scratch, fontPx)
  const metrics = scratch.measureText(s.text)
  const textW = Math.ceil(metrics.width)
  const ascent = metrics.actualBoundingBoxAscent || fontPx * 0.8
  const descent = metrics.actualBoundingBoxDescent || fontPx * 0.2
  const textH = Math.ceil(ascent + descent)

  const W = Math.max(2, textW + pad * 2)
  const H = Math.max(2, textH + pad * 2)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // Fill background
  ctx.fillStyle = bgColor.value
  ctx.fillRect(0, 0, W, H)

  // Draw text
  applyCtxFont(ctx, fontPx)
  ctx.fillStyle = textColor.value
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillText(s.text, pad, pad + ascent)

  const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
  if (!blob) return

  baking.value = true
  try {
    const fd = new FormData()
    const fname = `textmask_${Date.now()}.png`
    fd.append('image', new File([blob], fname, { type: 'image/png' }))
    fd.append('overwrite', 'true')
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (res.ok) {
      const data = await res.json() as { name?: string; subfolder?: string }
      const name = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name || fname)
      commit({ rendered: name, w: canvas.width, h: canvas.height })
    }
  } catch {}
  finally { baking.value = false }
}

// ── Mutations ───────────────────────────────────────────────────────────────

function commit(patch: Partial<MaskState> = {}) {
  state.value = { ...state.value, ...patch }
  emit('update:modelValue', JSON.stringify(state.value))
}

function setText(v: string) { commit({ text: v }); scheduleBake() }
function setSize(v: number) { commit({ size: v }); scheduleBake() }
function setLetterSpacing(v: number) { commit({ letterSpacing: v }); scheduleBake() }
function setAxis(tag: string, v: number) { commit({ axes: { ...state.value.axes, [tag]: v } }); scheduleBake() }
function toggleInvert() { commit({ invert: !state.value.invert }); scheduleBake() }

function pickVariable(id: string) {
  const f = VARIABLE_FONTS_BY_ID[id]
  if (!f) return
  commit({ fontSource: 'variable', fontId: id, axes: Object.fromEntries(f.axes.map(a => [a.tag, a.default])) })
  scheduleBake()
}
function pickGoogle(gf: GoogleFont) {
  commit({
    fontSource: 'google', googleFamily: gf.family, googleAxes: gf.axes,
    googleWeights: gf.weights, weight: nearestWeight(gf, 400),
    axes: Object.fromEntries(googleAxisList(gf).map(a => [a.tag, a.default])),
  })
  scheduleBake()
}
function onPickFont(payload: { source: 'variable'; id: string } | { source: 'google'; font: GoogleFont }) {
  if (payload.source === 'variable') pickVariable(payload.id)
  else pickGoogle(payload.font)
}

onMounted(() => { if (!state.value.rendered) scheduleBake() })
</script>

<template>
  <div class="nopan nodrag tm">
    <!-- Preview -->
    <div class="tm__stage" :style="{ background: bgColor }">
      <div ref="previewEl" class="tm__preview" :style="previewStyle">{{ state.text || 'MASK' }}</div>
      <div v-if="baking" class="tm__baking">baking…</div>
    </div>

    <!-- Text input -->
    <input
      class="tm__text"
      :value="state.text"
      placeholder="Type mask text…"
      @input="setText(($event.target as HTMLInputElement).value)"
    />

    <!-- Font picker -->
    <FontPicker
      :selected-key="activeFont.key"
      :label="fontLabel"
      sublabel=""
      @pick="onPickFont"
    />

    <!-- Axes + size -->
    <div class="tm__axes">
      <div v-for="ax in activeFont.axes" :key="ax.tag" class="tm__axis">
        <div class="tm__axis-head">
          <span>{{ ax.label }}</span>
          <span class="tm__axis-val">{{ Math.round((state.axes[ax.tag] ?? ax.default) * 100) / 100 }}</span>
        </div>
        <input type="range" :min="ax.min" :max="ax.max" :step="ax.step ?? 1" :value="state.axes[ax.tag] ?? ax.default" class="tm__range" @input="setAxis(ax.tag, +($event.target as HTMLInputElement).value)" />
      </div>
      <div class="tm__axis">
        <div class="tm__axis-head"><span>Size</span><span class="tm__axis-val">{{ state.size }}</span></div>
        <input type="range" min="48" max="600" step="1" :value="state.size" class="tm__range" @input="setSize(+($event.target as HTMLInputElement).value)" />
      </div>
      <div class="tm__axis">
        <div class="tm__axis-head"><span>Spacing</span><span class="tm__axis-val">{{ state.letterSpacing.toFixed(2) }}em</span></div>
        <input type="range" min="-0.1" max="0.5" step="0.01" :value="state.letterSpacing" class="tm__range" @input="setLetterSpacing(+($event.target as HTMLInputElement).value)" />
      </div>
    </div>

    <!-- Invert toggle -->
    <div class="tm__controls">
      <button type="button" class="tm__toggle" :class="{ 'tm__toggle--on': state.invert }" @click="toggleInvert">
        Invert
      </button>
    </div>
  </div>
</template>

<style scoped>
.tm { display: flex; flex-direction: column; gap: 7px; padding: 4px 0 6px; user-select: none; }
.tm__stage {
  position: relative; height: 90px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; border: 1px solid rgba(255,255,255,0.08);
}
.tm__preview { white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; padding: 0 10px; }
.tm__baking { position: absolute; top: 4px; right: 6px; font-size: 9px; color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.4); padding: 1px 5px; border-radius: 4px; }
.tm__text {
  width: 100%; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px; padding: 5px 8px; font-size: 12px; color: rgba(255,255,255,0.92); outline: none;
}
.tm__text:focus { border-color: rgba(255,255,255,0.25); }
.tm__axes { display: flex; flex-direction: column; gap: 5px; }
.tm__axis { display: flex; flex-direction: column; gap: 1px; }
.tm__axis-head { display: flex; justify-content: space-between; font-size: 10px; color: rgba(255,255,255,0.55); }
.tm__axis-val { font-variant-numeric: tabular-nums; color: rgba(255,255,255,0.8); }
.tm__range { width: 100%; } /* slider visual unified globally in main.css (input[type=range]) */
.tm__controls { display: flex; gap: 8px; }
.tm__toggle {
  font-size: 10px; padding: 3px 8px; border-radius: 5px;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.65); cursor: pointer;
}
.tm__toggle--on { background: rgba(129,140,248,0.22); border-color: rgba(129,140,248,0.4); color: rgb(199,210,254); }
</style>
