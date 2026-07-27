<script setup lang="ts">
/**
 * DEV — Vector Type demo.
 *
 * Proves the one thing the Vector Type Studio design turns on: a variable-font
 * axis animating as REAL GEOMETRY, not a re-rasterized bitmap. Outlines come
 * from fontkit's `getVariation()`, are drawn as Path2D, and can be written
 * straight out as SVG — the same paths, no tracing.
 *
 * Font source is the Google Fonts repo, not the CSS2 API: css2 only ever serves
 * static instances (curl UA → per-weight TTF; browser UA → woff2 that is still
 * one weight, split by unicode-range). See the design doc.
 */
import * as fontkit from 'fontkit'

const FONTS = [
  { id: 'inter', label: 'Inter', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf' },
  { id: 'archivo', label: 'Archivo', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf' },
  { id: 'robotoflex', label: 'Roboto Flex', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/robotoflex/RobotoFlex%5BGRAD,XOPQ,XTRA,YOPQ,YTAS,YTDE,YTFI,YTLC,YTUC,opsz,slnt,wdth,wght%5D.ttf' },
  { id: 'fraunces', label: 'Fraunces', url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/fraunces/Fraunces%5BSOFT,WONK,opsz,wght%5D.ttf' },
]

const fontId = ref('robotoflex')
const text = ref('Sailor')
const status = ref('idle')
const axes = ref<Record<string, { min: number; default: number; max: number }>>({})
const values = reactive<Record<string, number>>({})

/** Which axis the animation drives, and how. */
const animAxis = ref<string>('wght')
const playing = ref(true)
const speed = ref(0.5)

const showOutline = ref(true)
const showPoints = ref(false)

const canvas = ref<HTMLCanvasElement | null>(null)
const stats = reactive({ glyphs: 0, commands: 0, points: 0 })

let baseFont: any = null
let raf = 0
let t0 = 0

async function loadFont() {
  const entry = FONTS.find(f => f.id === fontId.value)!
  status.value = 'loading ' + entry.label + '…'
  try {
    const res = await fetch(entry.url)
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const bytes = new Uint8Array(await res.arrayBuffer())
    baseFont = (fontkit as any).create(bytes)
    const a = baseFont.variationAxes ?? {}
    axes.value = Object.fromEntries(Object.entries(a).map(([k, v]: [string, any]) =>
      [k, { min: v.min, default: v.default, max: v.max }]))
    for (const k of Object.keys(axes.value)) values[k] = axes.value[k]!.default
    if (!axes.value[animAxis.value]) animAxis.value = Object.keys(axes.value)[0] ?? ''
    status.value = `${entry.label} · ${Object.keys(axes.value).length} axes · ${(bytes.length / 1024 | 0)} KB`
  } catch (e: any) {
    status.value = 'failed: ' + e.message
    baseFont = null
  }
}

/** Build Path2D + stats for the current text at the current axis values. */
function buildPaths(axisOverride?: Record<string, number>) {
  if (!baseFont) return { paths: [] as Path2D[], svg: '', w: 0, h: 0 }
  const coords = { ...values, ...(axisOverride ?? {}) }
  const inst = baseFont.getVariation(coords)
  const run = inst.layout(text.value || ' ')
  const upem = inst.unitsPerEm || 1000

  const paths: Path2D[] = []
  let svgParts: string[] = []
  let x = 0, cmds = 0, pts = 0

  for (let i = 0; i < run.glyphs.length; i++) {
    const g = run.glyphs[i]
    const pos = run.positions[i]
    const p = new Path2D()
    for (const c of g.path.commands) {
      const a = c.args
      if (c.command === 'moveTo') { p.moveTo(x + a[0], a[1]); pts++ }
      else if (c.command === 'lineTo') { p.lineTo(x + a[0], a[1]); pts++ }
      else if (c.command === 'quadraticCurveTo') { p.quadraticCurveTo(x + a[0], a[1], x + a[2], a[3]); pts += 2 }
      else if (c.command === 'bezierCurveTo') { p.bezierCurveTo(x + a[0], a[1], x + a[2], a[3], x + a[4], a[5]); pts += 3 }
      else if (c.command === 'closePath') p.closePath()
      cmds++
    }
    paths.push(p)
    // Same geometry, written as SVG — nothing is traced or rasterized.
    svgParts.push(`<path transform="translate(${x} 0)" d="${g.path.toSVG()}"/>`)
    x += pos.xAdvance
  }
  stats.glyphs = run.glyphs.length
  stats.commands = cmds
  stats.points = pts
  return { paths, svg: svgParts.join(''), w: x, h: upem }
}

/** Schedule the next frame.
 *  requestAnimationFrame is throttled to ZERO in a hidden/background tab, which
 *  is exactly the state a headless browser renders in — so a pure rAF loop
 *  silently never runs there. Fall back to a timer when the document is hidden
 *  so the demo (and any offscreen capture of it) still advances. */
function schedule() {
  if (typeof document !== 'undefined' && document.hidden) {
    raf = window.setTimeout(draw, 1000 / 30) as unknown as number
  } else {
    raf = requestAnimationFrame(draw)
  }
}

function draw() {
  // Reschedule FIRST. An early return below must never kill the loop — one
  // empty frame while a font loads would otherwise freeze the demo forever.
  schedule()

  const cv = canvas.value
  if (!cv || !baseFont) return
  const ctx = cv.getContext('2d')!
  const W = cv.width, H = cv.height
  ctx.clearRect(0, 0, W, H)

  let over: Record<string, number> | undefined
  if (playing.value && animAxis.value && axes.value[animAxis.value]) {
    const ax = axes.value[animAxis.value]!
    const s = (Math.sin((performance.now() - t0) / 1000 * speed.value) + 1) / 2
    over = { [animAxis.value]: ax.min + (ax.max - ax.min) * s }
  }

  const { paths, w, h } = buildPaths(over)
  if (!paths.length || !w) return

  const pad = 56
  const scale = Math.min((W - pad * 2) / w, (H - pad * 2) / (h * 0.9))
  ctx.save()
  // Font space is y-up and sits on a baseline at 0; centre the cap height.
  ctx.translate((W - w * scale) / 2, H / 2 + (h * 0.34) * scale)
  ctx.scale(scale, -scale)

  for (const p of paths) {
    ctx.fillStyle = '#f2622e'
    ctx.fill(p, 'nonzero')
    if (showOutline.value) {
      ctx.lineWidth = 5 / scale
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.stroke(p)
    }
  }
  ctx.restore()
}

function downloadSvg() {
  const { svg, w, h } = buildPaths()
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-h * 0.8} ${w} ${h * 1.2}">`
    + `<g transform="scale(1,-1)" fill="#111">${svg}</g></svg>`
  const url = URL.createObjectURL(new Blob([doc], { type: 'image/svg+xml' }))
  const a = document.createElement('a')
  a.href = url; a.download = `${text.value || 'type'}.svg`; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

onMounted(async () => {
  t0 = performance.now()
  await loadFont()
  schedule()
})
onBeforeUnmount(() => { cancelAnimationFrame(raf); clearTimeout(raf) })
watch(fontId, async () => { await loadFont() })
</script>

<template>
  <div class="min-h-screen bg-[#0b0d12] p-6 text-white/90">
    <div class="mx-auto max-w-[1100px]">
      <div class="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">Dev · Vector Type</div>
      <h1 class="mb-1 text-xl font-semibold">A variable axis animating as real geometry</h1>
      <p class="mb-5 max-w-[70ch] text-[13px] text-white/50">
        Outlines come from fontkit at each axis position — the same paths get filled to canvas and
        written out as SVG. Nothing here is rasterized or traced.
      </p>

      <div class="mb-4 rounded-xl border border-white/10 bg-black/40 p-3">
        <canvas ref="canvas" width="1020" height="360" class="w-full rounded-lg"></canvas>
      </div>

      <div class="grid grid-cols-[1fr_320px] gap-4 max-[900px]:grid-cols-1">
        <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <select v-model="fontId" class="rounded-md border border-white/10 bg-white/[0.06] px-2 py-1.5 text-xs">
              <option v-for="f in FONTS" :key="f.id" :value="f.id">{{ f.label }}</option>
            </select>
            <input v-model="text" class="flex-1 rounded-md border border-white/10 bg-white/[0.06] px-2 py-1.5 text-xs" placeholder="Type something" />
            <button class="rounded-md bg-[#f2622e] px-3 py-1.5 text-xs font-medium text-black" @click="downloadSvg">Download SVG</button>
          </div>

          <div class="mb-3 flex flex-wrap items-center gap-3 text-[11px] text-white/60">
            <label class="flex items-center gap-1.5"><input v-model="playing" type="checkbox" /> Animate</label>
            <select v-model="animAxis" class="rounded border border-white/10 bg-white/[0.06] px-1.5 py-1 text-[11px]">
              <option v-for="(_a, k) in axes" :key="k" :value="k">{{ k }}</option>
            </select>
            <label class="flex items-center gap-1.5">speed
              <input v-model.number="speed" type="range" min="0.1" max="2" step="0.1" class="w-20" /></label>
            <label class="flex items-center gap-1.5"><input v-model="showOutline" type="checkbox" /> Show outline</label>
          </div>

          <div class="max-h-[240px] space-y-2 overflow-y-auto pr-1">
            <div v-for="(a, k) in axes" :key="k" class="flex items-center gap-2">
              <span class="w-14 shrink-0 font-mono text-[10px] uppercase text-white/45">{{ k }}</span>
              <input v-model.number="values[k]" type="range" :min="a.min" :max="a.max" step="1" class="flex-1" />
              <span class="w-12 text-right font-mono text-[10px] tabular-nums text-white/50">{{ Math.round(values[k] ?? 0) }}</span>
            </div>
          </div>
        </div>

        <div class="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-[12px]">
          <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">Status</div>
          <div class="mb-3 text-white/70">{{ status }}</div>
          <div class="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">This frame</div>
          <div class="space-y-1 font-mono text-[11px] text-white/60">
            <div class="flex justify-between"><span>glyphs</span><span class="tabular-nums">{{ stats.glyphs }}</span></div>
            <div class="flex justify-between"><span>path commands</span><span class="tabular-nums">{{ stats.commands }}</span></div>
            <div class="flex justify-between"><span>anchor points</span><span class="tabular-nums">{{ stats.points }}</span></div>
          </div>
          <p class="mt-3 text-[11px] leading-relaxed text-white/40">
            Command count stays constant as the axis moves — the outline's topology never changes,
            which is what makes animating between any two axis positions safe.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
