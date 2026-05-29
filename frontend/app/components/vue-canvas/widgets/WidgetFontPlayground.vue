<script setup lang="ts">
/**
 * WidgetFontPlayground — local typography render. Type a word, pick a variable
 * font, drag its axes (weight/width/slant/optical-size/…), set colors, and the
 * widget rasterizes the result to a PNG client-side (real fonts, pixel-perfect)
 * and uploads it. The RenderType Python node loads that PNG as IMAGE + MASK.
 *
 * No AI, no cost — this is a pure local render, mirroring the Compositor's
 * canvas-bake → /upload/image pipeline, plus `ctx.fontVariationSettings` for
 * the variable axes.
 *
 * State (modelValue) is one JSON blob:
 *   { fontId, text, size, color, bg, axes:{tag:val}, rendered, w, h }
 * `rendered` is the uploaded filename the Python node loads.
 */
import { VARIABLE_FONTS_BY_ID, DEFAULT_FONT_ID, type VariableFont, type FontAxis } from '~/data/variable-fonts'
import { useElementSize } from '@vueuse/core'
import {
  type Transform3D, IDENTITY_TRANSFORM, isIdentity, hasTilt,
  composeMatrix, projectPoint, affineFromMatrix, transformedBounds, cssTransform,
} from '~/utils/textWarp'
import {
  type GoogleFont, googleAxisList, buildGoogleCssUrl, quickGoogleCssUrl, nearestWeight,
} from '~/data/google-fonts'
import FontPicker from './FontPicker.vue'

const props = defineProps<{
  modelValue: string
  label?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

interface PlaygroundState {
  fontId: string                  // active variable font (when fontSource === 'variable')
  fontSource: 'variable' | 'google'
  googleFamily: string            // active Google family (when fontSource === 'google')
  googleAxes: { tag: string; min: number; max: number; default: number }[]
  googleWeights: number[]         // static weights offered when the Google font has no axes
  weight: number                  // chosen weight for a static Google font
  text: string
  size: number          // px in the live preview / catalog scale
  color: string
  bg: string            // 'transparent' or hex
  axes: Record<string, number>
  letterSpacing: number // em, scales with font size (can be negative to tighten)
  kerning: boolean      // font-kerning on/off
  transform: Transform3D // rotate / tilt / skew — baked into the PNG
  rendered: string      // uploaded filename
  w: number
  h: number
}

function defaultsForFont(font: VariableFont): Record<string, number> {
  return Object.fromEntries(font.axes.map(a => [a.tag, a.default]))
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

function parse(s: string): PlaygroundState {
  let o: any = {}
  try { o = JSON.parse(s || '{}') } catch { o = {} }
  const fontId = VARIABLE_FONTS_BY_ID[o.fontId] ? o.fontId : DEFAULT_FONT_ID
  const font = VARIABLE_FONTS_BY_ID[fontId]!
  return {
    fontId,
    fontSource: o.fontSource === 'google' ? 'google' : 'variable',
    googleFamily: typeof o.googleFamily === 'string' ? o.googleFamily : '',
    googleAxes: Array.isArray(o.googleAxes) ? o.googleAxes : [],
    googleWeights: Array.isArray(o.googleWeights)
      ? o.googleWeights.filter((x: any) => Number.isFinite(+x)).map(Number)
      : [],
    weight: num(o.weight, 400),
    text: typeof o.text === 'string' ? o.text : 'Type',
    size: Number.isFinite(+o.size) ? +o.size : font.defaultSize,
    color: typeof o.color === 'string' ? o.color : '#ffffff',
    bg: typeof o.bg === 'string' ? o.bg : 'transparent',
    axes: (o.axes && typeof o.axes === 'object') ? { ...defaultsForFont(font), ...o.axes } : defaultsForFont(font),
    letterSpacing: Number.isFinite(+o.letterSpacing) ? +o.letterSpacing : 0,
    kerning: typeof o.kerning === 'boolean' ? o.kerning : true,
    transform: parseTransform(o.transform),
    rendered: typeof o.rendered === 'string' ? o.rendered : '',
    w: Number.isFinite(+o.w) ? +o.w : 0,
    h: Number.isFinite(+o.h) ? +o.h : 0,
  }
}

const state = ref<PlaygroundState>(parse(props.modelValue))
watch(() => props.modelValue, (v) => {
  // Only re-pull if the incoming value diverges (avoid clobbering live edits).
  const incoming = parse(v)
  if (
    incoming.rendered !== state.value.rendered ||
    incoming.fontId !== state.value.fontId ||
    incoming.fontSource !== state.value.fontSource ||
    incoming.googleFamily !== state.value.googleFamily ||
    incoming.text !== state.value.text
  ) {
    state.value = incoming
  }
})

// The resolved font in play — variable (curated) or Google (catalog). Both
// preview and bake read `family`, `axes` (sliders) and `cssUrl` from here, so
// the rest of the widget never branches on the source again.
interface ActiveFont {
  source: 'variable' | 'google'
  family: string
  axes: FontAxis[]
  cssUrl: string
  key: string        // 'var:<id>' | 'goog:<family>' — highlights the picker row
  weights: number[]  // static weight options (Google fonts with no axes)
}

/** Rebuild a GoogleFont from the persisted state so the catalog isn't needed on reload. */
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
      cssUrl: axes.length
        ? buildGoogleCssUrl(gf)
        : quickGoogleCssUrl(gf.family, state.value.weight || nearestWeight(gf, 400)),
      key: 'goog:' + gf.family,
      weights: gf.weights,
    }
  }
  const f = VARIABLE_FONTS_BY_ID[state.value.fontId] ?? VARIABLE_FONTS_BY_ID[DEFAULT_FONT_ID]!
  return { source: 'variable', family: f.family, axes: f.axes, cssUrl: f.cssUrl, key: 'var:' + f.id, weights: [] }
})

const fontLabel = computed(() =>
  activeFont.value.source === 'google'
    ? activeFont.value.family
    : (VARIABLE_FONTS_BY_ID[state.value.fontId]?.label ?? activeFont.value.family))
const fontSublabel = computed(() => (activeFont.value.source === 'google' ? 'Google' : 'Variable'))
const showWeightPicker = computed(() =>
  activeFont.value.source === 'google' && activeFont.value.axes.length === 0 && activeFont.value.weights.length > 1)

// Preview element size (ResizeObserver → layout px, unaffected by transforms),
// used so the preview's perspective distance scales like the bake's.
const previewEl = ref<HTMLElement | null>(null)
const { width: previewW } = useElementSize(previewEl)

const transformIsIdentity = computed(() => isIdentity(state.value.transform))
const hasTiltActive = computed(() => hasTilt(state.value.transform))

const transformSliders = [
  { key: 'rotate', label: 'Rotate', min: -180, max: 180, step: 1 },
  { key: 'tiltX', label: 'Tilt X', min: -60, max: 60, step: 1 },
  { key: 'tiltY', label: 'Tilt Y', min: -60, max: 60, step: 1 },
  { key: 'skewX', label: 'Skew X', min: -45, max: 45, step: 1 },
  { key: 'skewY', label: 'Skew Y', min: -45, max: 45, step: 1 },
] as const

// ---- Font loading ----------------------------------------------------------
// Inject the Google Fonts CSS link once per font family, then wait for the
// face to be ready before baking so the canvas uses real glyphs.

const loadedFonts = new Set<string>()
const fontReady = ref(false)

function ensureFontLink(cssUrl: string) {
  if (typeof document === 'undefined') return
  if (loadedFonts.has(cssUrl)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = cssUrl
  link.dataset.fontPlayground = ''
  document.head.appendChild(link)
  loadedFonts.add(cssUrl)
}

async function waitFontReady(a: ActiveFont) {
  fontReady.value = false
  ensureFontLink(a.cssUrl)
  if (typeof document !== 'undefined' && (document as any).fonts) {
    const wght = state.value.axes.wght ?? state.value.weight ?? 700
    const spec = `${wght} 64px "${a.family}"`
    try {
      await Promise.race([
        (document as any).fonts.load(spec).then(() => (document as any).fonts.ready),
        new Promise(r => setTimeout(r, 2500)),
      ])
    } catch { /* fall through; bake will use whatever's available */ }
  }
  fontReady.value = true
}

// ---- Live preview style ----------------------------------------------------

const variationSettings = computed(() =>
  Object.entries(state.value.axes).map(([t, v]) => `"${t}" ${v}`).join(', '))

const previewStyle = computed(() => ({
  fontFamily: `"${activeFont.value.family}", sans-serif`,
  // Static Google fonts carry weight only through font-weight (no wght axis),
  // so mirror the bake's resolution here or the preview ignores the dropdown.
  fontWeight: String(state.value.axes.wght ?? state.value.weight ?? 400),
  fontVariationSettings: variationSettings.value,
  fontSize: `${Math.min(64, state.value.size / 2)}px`,   // scaled down to fit the node
  color: state.value.color,
  lineHeight: '1.1',
  letterSpacing: `${state.value.letterSpacing}em`,
  fontKerning: state.value.kerning ? 'normal' : 'none',
  transform: cssTransform(state.value.transform, previewW.value || 300),
  transformOrigin: 'center',
}))

const stageBg = computed(() => state.value.bg === 'transparent'
  ? 'repeating-conic-gradient(#2a2a2a 0% 25%, #1e1e1e 0% 50%) 50% / 16px 16px'   // checker
  : state.value.bg)

// ---- Bake + upload ---------------------------------------------------------
//
// Render at 2× the catalog size for a crisp output. Canvas is sized to the
// measured text bounding box + padding so the type is tightly cropped.

const SCALE = 2
const PAD = 0.25  // fraction of font size as padding around the text

let bakeTimer: ReturnType<typeof setTimeout> | null = null
const baking = ref(false)

function scheduleBake() {
  if (bakeTimer) clearTimeout(bakeTimer)
  bakeTimer = setTimeout(bakeAndUpload, 400)
}

const MAX_DIM = 4096  // clamp the output so an extreme tilt can't blow up memory

/** Render the flat (un-transformed) word to a tightly-cropped canvas. */
function renderFlat(s: PlaygroundState): HTMLCanvasElement {
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
  // Fill the background on the flat plane so it warps *with* the letters
  // (a tilted word keeps its own backing, not a rectangle behind the quad).
  if (s.bg !== 'transparent') {
    ctx.fillStyle = s.bg
    ctx.fillRect(0, 0, W, H)
  }
  applyCtxFont(ctx, fontPx)
  ctx.fillStyle = s.color
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillText(s.text, pad, pad + ascent)
  return canvas
}

/** Affine [a,b,c,d,e,f] mapping source triangle (u,v)→dest (x,y) via U⁻¹. */
function triAffine(
  u0: number, v0: number, u1: number, v1: number, u2: number, v2: number,
  x0: number, y0: number, x1: number, y1: number, x2: number, y2: number,
): [number, number, number, number, number, number] | null {
  const det = u0 * (v1 - v2) - v0 * (u1 - u2) + (u1 * v2 - u2 * v1)
  if (Math.abs(det) < 1e-9) return null
  const i00 = (v1 - v2) / det, i01 = (v2 - v0) / det, i02 = (v0 - v1) / det
  const i10 = (u2 - u1) / det, i11 = (u0 - u2) / det, i12 = (u1 - u0) / det
  const i20 = (u1 * v2 - u2 * v1) / det, i21 = (u2 * v0 - u0 * v2) / det, i22 = (u0 * v1 - u1 * v0) / det
  const a = i00 * x0 + i01 * x1 + i02 * x2
  const c = i10 * x0 + i11 * x1 + i12 * x2
  const e = i20 * x0 + i21 * x1 + i22 * x2
  const b = i00 * y0 + i01 * y1 + i02 * y2
  const d = i10 * y0 + i11 * y1 + i12 * y2
  const f = i20 * y0 + i21 * y1 + i22 * y2
  return [a, b, c, d, e, f]
}

/**
 * Apply the 3D transform to the flat render. Pure affine (rotate/skew, no tilt)
 * goes through one crisp ctx.setTransform; a true tilt is warped as a triangle
 * mesh so perspective foreshortening rasterises correctly. Alpha is preserved
 * (the MASK rides along), and the canvas is sized to the transformed bounds.
 */
function warpCanvas(flat: HTMLCanvasElement, t: Transform3D): HTMLCanvasElement {
  const W0 = flat.width, H0 = flat.height
  const cx = W0 / 2, cy = H0 / 2
  const m = composeMatrix(t, W0)
  const b = transformedBounds(m, W0, H0)
  const margin = 4
  const rawW = b.width + margin * 2, rawH = b.height + margin * 2
  const scale = Math.min(1, MAX_DIM / Math.max(rawW, rawH))
  const Wd = Math.max(2, Math.ceil(rawW * scale))
  const Hd = Math.max(2, Math.ceil(rawH * scale))

  const out = document.createElement('canvas')
  out.width = Wd
  out.height = Hd
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Source (su,sv) → output px.
  const map = (su: number, sv: number): [number, number] => {
    const [px, py] = projectPoint(m, su - cx, sv - cy)
    return [(px - b.minX + margin) * scale, (py - b.minY + margin) * scale]
  }

  if (!hasTilt(t)) {
    // Affine: draw the whole bitmap once, no triangle seams.
    const [a, bb, c, d] = affineFromMatrix(m)
    const [ex, ey] = map(0, 0)
    // map(0,0) already encodes A·(-center)+offset; a..d are the linear part.
    ctx.setTransform(a * scale, bb * scale, c * scale, d * scale, ex, ey)
    ctx.drawImage(flat, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    return out
  }

  // Perspective: warp a grid of textured triangles.
  const N = 24
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const su0 = (i / N) * W0, su1 = ((i + 1) / N) * W0
      const sv0 = (j / N) * H0, sv1 = ((j + 1) / N) * H0
      const d00 = map(su0, sv0), d10 = map(su1, sv0)
      const d11 = map(su1, sv1), d01 = map(su0, sv1)
      drawTri(ctx, flat, su0, sv0, su1, sv0, su1, sv1, d00, d10, d11)
      drawTri(ctx, flat, su0, sv0, su1, sv1, su0, sv1, d00, d11, d01)
    }
  }
  return out
}

function drawTri(
  ctx: CanvasRenderingContext2D, img: CanvasImageSource,
  u0: number, v0: number, u1: number, v1: number, u2: number, v2: number,
  d0: [number, number], d1: [number, number], d2: [number, number],
) {
  const aff = triAffine(u0, v0, u1, v1, u2, v2, d0[0], d0[1], d1[0], d1[1], d2[0], d2[1])
  if (!aff) return
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(d0[0], d0[1]); ctx.lineTo(d1[0], d1[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath()
  ctx.clip()
  ctx.transform(aff[0], aff[1], aff[2], aff[3], aff[4], aff[5])
  ctx.drawImage(img, 0, 0)
  ctx.restore()
}

async function bakeAndUpload() {
  const s = state.value
  if (!s.text.trim()) return
  await waitFontReady(activeFont.value)

  const flat = renderFlat(s)
  const out = isIdentity(s.transform) ? flat : warpCanvas(flat, s.transform)

  const blob = await new Promise<Blob | null>(r => out.toBlob(r, 'image/png'))
  if (!blob) return

  baking.value = true
  try {
    const fd = new FormData()
    const slug = activeFont.value.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const fname = `type_${slug}_${Date.now()}.png`
    fd.append('image', new File([blob], fname, { type: 'image/png' }))
    fd.append('overwrite', 'true')
    const res = await fetch('/upload/image', { method: 'POST', body: fd })
    if (res.ok) {
      const data = await res.json() as { name?: string; subfolder?: string }
      const name = data.subfolder ? `${data.subfolder}/${data.name}` : (data.name || fname)
      commit({ rendered: name, w: out.width, h: out.height })
    }
  } catch { /* leave previous render in place on failure */ }
  finally { baking.value = false }
}

function applyCtxFont(ctx: CanvasRenderingContext2D, px: number) {
  const wght = state.value.axes.wght ?? state.value.weight ?? 700
  ctx.font = `${wght} ${px}px "${activeFont.value.family}", sans-serif`
  // Variable axes — supported in Chromium (ComfyNext's runtime). Harmless
  // no-op where unsupported (weight still applies via ctx.font above).
  if ('fontVariationSettings' in ctx) {
    ;(ctx as any).fontVariationSettings = variationSettings.value
  }
  // wdth also maps to the standard fontStretch where present.
  const wdth = state.value.axes.wdth
  if (wdth && 'fontStretch' in ctx) {
    ;(ctx as any).fontStretch = `${(wdth / 100) * 100}%`
  }
  // Letter-spacing (em → px) and kerning. Chromium honours both, and
  // measureText accounts for ctx.letterSpacing, so the tight crop stays correct.
  if ('letterSpacing' in ctx) {
    ;(ctx as any).letterSpacing = `${state.value.letterSpacing * px}px`
  }
  if ('fontKerning' in ctx) {
    ctx.fontKerning = state.value.kerning ? 'normal' : 'none'
  }
}

// ---- Mutations -------------------------------------------------------------

function commit(patch: Partial<PlaygroundState> = {}) {
  state.value = { ...state.value, ...patch }
  emit('update:modelValue', JSON.stringify(state.value))
}

function setText(v: string) { commit({ text: v }); scheduleBake() }
function setSize(v: number) { commit({ size: v }); scheduleBake() }
function setColor(v: string) { commit({ color: v }); scheduleBake() }
function setBg(v: string) { commit({ bg: v }); scheduleBake() }
function setLetterSpacing(v: number) { commit({ letterSpacing: v }); scheduleBake() }
function toggleKerning() { commit({ kerning: !state.value.kerning }); scheduleBake() }
function setTransform(patch: Partial<Transform3D>) {
  commit({ transform: { ...state.value.transform, ...patch } }); scheduleBake()
}
function resetTransform() {
  commit({ transform: { ...IDENTITY_TRANSFORM } }); scheduleBake()
}
function setAxis(tag: string, v: number) {
  commit({ axes: { ...state.value.axes, [tag]: v } })
  scheduleBake()
}
function pickVariable(id: string) {
  const f = VARIABLE_FONTS_BY_ID[id]
  if (!f) return
  commit({ fontSource: 'variable', fontId: id, axes: defaultsForFont(f), size: f.defaultSize })
  waitFontReady(activeFont.value).then(scheduleBake)
}
function pickGoogle(gf: GoogleFont) {
  const axes = Object.fromEntries(googleAxisList(gf).map(a => [a.tag, a.default]))
  commit({
    fontSource: 'google',
    googleFamily: gf.family,
    googleAxes: gf.axes,
    googleWeights: gf.weights,
    weight: nearestWeight(gf, 400),
    axes,
  })
  waitFontReady(activeFont.value).then(scheduleBake)
}
function onPickFont(payload: { source: 'variable'; id: string } | { source: 'google'; font: GoogleFont }) {
  if (payload.source === 'variable') pickVariable(payload.id)
  else pickGoogle(payload.font)
}
function setWeight(w: number) {
  commit({ weight: w })
  waitFontReady(activeFont.value).then(scheduleBake)
}
function toggleTransparent() {
  setBg(state.value.bg === 'transparent' ? '#000000' : 'transparent')
}

onMounted(() => {
  waitFontReady(activeFont.value).then(() => {
    // Bake on mount if we don't yet have a render (fresh node).
    if (!state.value.rendered) scheduleBake()
  })
})
</script>

<template>
  <div class="nopan nodrag font-pg">
    <!-- Live preview stage -->
    <div class="font-pg__stage" :style="{ background: stageBg }">
      <div ref="previewEl" class="font-pg__preview" :style="previewStyle">{{ state.text || 'Type' }}</div>
      <div v-if="baking" class="font-pg__baking">baking…</div>
    </div>

    <!-- Text + font row -->
    <input
      class="font-pg__text"
      :value="state.text"
      placeholder="Type something…"
      @input="setText(($event.target as HTMLInputElement).value)"
    />
    <FontPicker
      :selected-key="activeFont.key"
      :label="fontLabel"
      :sublabel="fontSublabel"
      @pick="onPickFont"
    />
    <select
      v-if="showWeightPicker"
      class="font-pg__select"
      :value="state.weight"
      @change="setWeight(+($event.target as HTMLSelectElement).value)"
    >
      <option v-for="w in activeFont.weights" :key="w" :value="w" class="bg-[#1b1b1b]">Weight {{ w }}</option>
    </select>

    <!-- Axis sliders (per font) -->
    <div class="font-pg__axes">
      <div v-for="ax in activeFont.axes" :key="ax.tag" class="font-pg__axis">
        <div class="font-pg__axis-head">
          <span>{{ ax.label }}</span>
          <span class="font-pg__axis-val">{{ Math.round((state.axes[ax.tag] ?? ax.default) * 100) / 100 }}</span>
        </div>
        <input
          type="range"
          :min="ax.min" :max="ax.max" :step="ax.step ?? 1"
          :value="state.axes[ax.tag] ?? ax.default"
          class="font-pg__range"
          @input="setAxis(ax.tag, +($event.target as HTMLInputElement).value)"
        />
      </div>
      <!-- Size -->
      <div class="font-pg__axis">
        <div class="font-pg__axis-head">
          <span>Size</span>
          <span class="font-pg__axis-val">{{ state.size }}</span>
        </div>
        <input
          type="range" min="24" max="400" step="1"
          :value="state.size"
          class="font-pg__range"
          @input="setSize(+($event.target as HTMLInputElement).value)"
        />
      </div>
      <!-- Letter spacing (em) -->
      <div class="font-pg__axis">
        <div class="font-pg__axis-head">
          <span>Spacing</span>
          <span class="font-pg__axis-val">{{ (Math.round(state.letterSpacing * 100) / 100).toFixed(2) }}em</span>
        </div>
        <input
          type="range" min="-0.1" max="0.5" step="0.01"
          :value="state.letterSpacing"
          class="font-pg__range"
          @input="setLetterSpacing(+($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <!-- Transform (rotate / tilt / skew) -->
    <div class="font-pg__transform">
      <div class="font-pg__section-head">
        <span>Transform</span>
        <button v-if="!transformIsIdentity" type="button" class="font-pg__reset" @click="resetTransform">reset</button>
      </div>
      <div v-for="c in transformSliders" :key="c.key" class="font-pg__axis">
        <div class="font-pg__axis-head">
          <span>{{ c.label }}</span>
          <span class="font-pg__axis-val">{{ Math.round(state.transform[c.key]) }}°</span>
        </div>
        <input
          type="range"
          :min="c.min" :max="c.max" :step="c.step"
          :value="state.transform[c.key]"
          class="font-pg__range"
          @input="setTransform({ [c.key]: +($event.target as HTMLInputElement).value })"
        />
      </div>
      <div v-if="hasTiltActive" class="font-pg__axis">
        <div class="font-pg__axis-head">
          <span>Depth</span>
          <span class="font-pg__axis-val">{{ Math.round(state.transform.depth) }}</span>
        </div>
        <input
          type="range" min="0" max="100" step="1"
          :value="state.transform.depth"
          class="font-pg__range"
          @input="setTransform({ depth: +($event.target as HTMLInputElement).value })"
        />
      </div>
    </div>

    <!-- Colors -->
    <div class="font-pg__colors">
      <label class="font-pg__color">
        <input type="color" :value="state.color" @input="setColor(($event.target as HTMLInputElement).value)" />
        <span>Text</span>
      </label>
      <label class="font-pg__color" :class="{ 'font-pg__color--off': state.bg === 'transparent' }">
        <input
          type="color"
          :value="state.bg === 'transparent' ? '#000000' : state.bg"
          :disabled="state.bg === 'transparent'"
          @input="setBg(($event.target as HTMLInputElement).value)"
        />
        <span>BG</span>
      </label>
      <button
        type="button"
        class="font-pg__transparent"
        :class="{ 'font-pg__transparent--on': state.bg === 'transparent' }"
        @click="toggleTransparent"
      >Transparent</button>
      <button
        type="button"
        class="font-pg__toggle"
        :class="{ 'font-pg__toggle--on': state.kerning }"
        @click="toggleKerning"
      >Kerning</button>
    </div>
  </div>
</template>

<style scoped>
.font-pg {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 4px 0 6px;
  user-select: none;
}
.font-pg__stage {
  position: relative;
  height: 110px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.08);
}
.font-pg__preview {
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 10px;
}
.font-pg__baking {
  position: absolute;
  top: 4px; right: 6px;
  font-size: 9px;
  color: rgba(255,255,255,0.45);
  background: rgba(0,0,0,0.4);
  padding: 1px 5px;
  border-radius: 4px;
}
.font-pg__text, .font-pg__select {
  width: 100%;
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  color: rgba(255,255,255,0.92);
  outline: none;
}
.font-pg__text:focus, .font-pg__select:focus { border-color: rgba(255,255,255,0.25); }
.font-pg__select { cursor: pointer; }

.font-pg__axes { display: flex; flex-direction: column; gap: 5px; }
.font-pg__axis { display: flex; flex-direction: column; gap: 1px; }
.font-pg__axis-head {
  display: flex; justify-content: space-between;
  font-size: 10px; color: rgba(255,255,255,0.55);
}
.font-pg__axis-val { font-variant-numeric: tabular-nums; color: rgba(255,255,255,0.8); }
.font-pg__range {
  width: 100%; height: 4px; cursor: pointer; accent-color: #818cf8;
}

.font-pg__transform { display: flex; flex-direction: column; gap: 5px; }
.font-pg__section-head {
  display: flex; justify-content: space-between; align-items: center;
  font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em;
  color: rgba(255,255,255,0.38); margin-top: 2px;
}
.font-pg__reset {
  font-size: 9.5px; text-transform: none; cursor: pointer;
  background: none; border: none; color: rgba(129,140,248,0.95);
}

.font-pg__colors { display: flex; align-items: center; gap: 8px; }
.font-pg__color {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 10.5px; color: rgba(255,255,255,0.6); cursor: pointer;
}
.font-pg__color input[type="color"] {
  width: 22px; height: 22px; border: none; border-radius: 5px;
  background: none; cursor: pointer; padding: 0;
}
.font-pg__color--off { opacity: 0.5; }
.font-pg__transparent {
  margin-left: auto;
  font-size: 10px; padding: 3px 8px; border-radius: 5px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.65); cursor: pointer;
}
.font-pg__transparent--on {
  background: rgba(129,140,248,0.22);
  border-color: rgba(129,140,248,0.4);
  color: rgb(199,210,254);
}
.font-pg__toggle {
  font-size: 10px; padding: 3px 8px; border-radius: 5px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  color: rgba(255,255,255,0.65); cursor: pointer;
}
.font-pg__toggle--on {
  background: rgba(129,140,248,0.22);
  border-color: rgba(129,140,248,0.4);
  color: rgb(199,210,254);
}
</style>
