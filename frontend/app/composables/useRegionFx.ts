/**
 * Animated "generate in this region" overlay, shared by the Compositor's
 * Generate-in-region panel and the Image-artifact Inpaint modal so both read as
 * one design. Given a region silhouette (white-on-transparent canvas at display
 * px) it paints, on a 2D overlay canvas:
 *   - a gently pulsing translucent fill of the region, and
 *   - a flowing PASTEL gradient stroke around its outline (dilate → punch-out);
 * and drives a glimm prism "sweep" band (WebGL, palette "citrus") on a second
 * canvas — CSS-masked to the same silhouette — while a generation is running.
 *
 * The host owns the canvases, the mask, and the busy flag; this owns the RAF +
 * glimm lifecycle. Extracted verbatim from CompositorModal's region overlay.
 */
import { ref, onBeforeUnmount, type Ref } from 'vue'

type GlimmController = import('glimm').ShaderController

/**
 * Single source of truth for the pastel accent on the CANVAS stroke. The button
 * fill and prompt hairline use the global `--pastel-gradient` CSS var
 * (app/assets/css/main.css), kept numerically identical to this array.
 */
export const REGION_PASTEL = ['#ffd6e7', '#cfe8ff', '#d6ffe0', '#fff4cc', '#e7d6ff', '#ffd6e7'] // [5]===[0] (cyclic)
export function regionPastelGradientCss(): string {
  return `linear-gradient(90deg, ${REGION_PASTEL.join(', ')})`
}

const GEN_SWEEP_PERIOD = 1.6   // s per sweep cycle
const GEN_SWEEP_ALPHA = 0.6    // peak band opacity while generating — softened so artwork shows through

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function lerpHex(a: string, b: string, u: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16)
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255
  return `rgb(${Math.round(ar + (br - ar) * u)},${Math.round(ag + (bg - ag) * u)},${Math.round(ab + (bb - ab) * u)})`
}
// Sample the cyclic pastel palette at fractional position `u` (wraps).
function pastelAt(u: number): string {
  u = ((u % 1) + 1) % 1
  const n = REGION_PASTEL.length - 1 // 5 cyclic segments
  const x = u * n, i = Math.floor(x) % n
  return lerpHex(REGION_PASTEL[i], REGION_PASTEL[(i + 1) % REGION_PASTEL.length], x - Math.floor(x))
}

export interface RegionFxOptions {
  /** 2D overlay canvas (pulse fill + flowing pastel stroke). */
  overlay: Ref<HTMLCanvasElement | null>
  /** WebGL sweep canvas (glimm prism band, CSS-masked to the silhouette). */
  sweep: Ref<HTMLCanvasElement | null>
  /** Current region silhouette: white/opaque region on transparent, display px. Null = no region. */
  getMask: () => HTMLCanvasElement | null
  /** On-screen display size of the stage the overlay covers. */
  getDims: () => { w: number; h: number }
  /** True while a generation is in flight (drives the prism sweep). */
  busy: () => boolean
}

export function useRegionFx(opts: RegionFxOptions) {
  const sweepMaskUrl = ref('') // data-URL of the silhouette, for the sweep's CSS mask

  let ringCanvas: HTMLCanvasElement | null = null // cached ring silhouette (logical px)
  let scratch: HTMLCanvasElement | null = null    // per-frame compositing scratch
  let raf = 0
  let t0 = 0
  let running = false
  let sweepCtrl: GlimmController | null = null
  let creating = false

  // Lazily create the glimm controller once its canvas is laid out (glimm sizes
  // itself from getBoundingClientRect, so the canvas must be in the DOM first).
  function ensureSweepCtrl() {
    if (sweepCtrl || creating) return
    const cv = opts.sweep.value
    if (!cv || cv.clientWidth < 1 || cv.clientHeight < 1) return
    creating = true
    import('glimm').then(({ createShader, resolvePalette }) => {
      creating = false
      if (sweepCtrl || !opts.sweep.value) return
      sweepCtrl = createShader({
        canvas: opts.sweep.value,
        palette: resolvePalette('citrus'),
        brightness: 0.85,   // ease the iridescence so it doesn't blow out over artwork
        swellAmount: 0.7,   // a little depth/crest on the band
      })
    }).catch(() => { creating = false })
  }
  function destroySweepCtrl() {
    sweepCtrl?.destroy()
    sweepCtrl = null
    creating = false
  }
  // Refresh the CSS mask from the region silhouette (white mask canvas → data URL).
  function updateSweepMask() {
    const m = opts.getMask()
    sweepMaskUrl.value = m ? m.toDataURL() : ''
  }

  // Build a ring (outline) from the mask: dilate it by offset-drawing in a circle,
  // then punch out the original → an outer stroke band of ~`sw` px.
  function rebuildRing() {
    const { w, h } = opts.getDims()
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h))
    if (!ringCanvas) ringCanvas = document.createElement('canvas')
    if (ringCanvas.width !== W || ringCanvas.height !== H) { ringCanvas.width = W; ringCanvas.height = H }
    const rctx = ringCanvas.getContext('2d'); if (!rctx) return
    rctx.setTransform(1, 0, 0, 1, 0, 0)
    rctx.clearRect(0, 0, W, H)
    const mask = opts.getMask(); if (!mask) return
    const sw = 3.5, steps = 16
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2
      rctx.drawImage(mask, Math.cos(a) * sw, Math.sin(a) * sw, W, H)
    }
    rctx.globalCompositeOperation = 'destination-out'
    rctx.drawImage(mask, 0, 0, W, H)
    rctx.globalCompositeOperation = 'source-over'
  }

  function scratchCtx(W: number, H: number): CanvasRenderingContext2D {
    if (!scratch) scratch = document.createElement('canvas')
    if (scratch.width !== W || scratch.height !== H) { scratch.width = W; scratch.height = H }
    const c = scratch.getContext('2d')!
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, W, H)
    return c
  }

  function renderOverlay(now?: number) {
    const cv = opts.overlay.value; if (!cv) return
    const { w, h } = opts.getDims()
    const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h))
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
    const pw = Math.round(W * dpr), ph = Math.round(H * dpr)
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph }
    const ctx = cv.getContext('2d'); if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const mask = opts.getMask(); if (!mask) return
    const t = ((now ?? nowMs()) - t0) / 1000

    // Region fill — pulse a translucent white. The mask is already white, so draw
    // it directly at the pulse alpha. (Drawing it then re-filling with `source-in`
    // would SQUARE the alpha — pulse·pulse — making the pulse nearly invisible.)
    const pulse = 0.16 + 0.30 * (0.5 + 0.5 * Math.sin(t * 1.4))
    ctx.save()
    ctx.globalAlpha = pulse
    ctx.drawImage(mask, 0, 0, W, H)
    ctx.restore()

    // Pastel gradient stroke — tint the cached ring with a colour-flowing gradient
    // (stops at fixed positions, colours sampled at a slowly-advancing offset, so
    // the palette visibly flows along the stroke).
    if (ringCanvas) {
      const sctx = scratchCtx(W, H)
      sctx.drawImage(ringCanvas, 0, 0)
      sctx.globalCompositeOperation = 'source-in'
      const shift = t * 0.16
      const g = sctx.createLinearGradient(0, 0, W, H)
      for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, pastelAt(i / 6 + shift))
      sctx.fillStyle = g
      sctx.fillRect(0, 0, W, H)
      sctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(scratch!, 0, 0, W, H)
    }
  }

  // Drive the glimm prism band: loop its progress while a generation is in flight,
  // fade its alpha out when idle. glimm renders on its own RAF; we only set state.
  function driveSweep() {
    ensureSweepCtrl()
    if (!sweepCtrl) return
    if (opts.busy()) {
      const tt = (nowMs() - t0) / 1000
      sweepCtrl.setProgress((tt % GEN_SWEEP_PERIOD) / GEN_SWEEP_PERIOD)
      sweepCtrl.setAlpha(GEN_SWEEP_ALPHA)
    } else {
      sweepCtrl.setAlpha(0)
    }
  }

  function loop() {
    renderOverlay(nowMs())
    driveSweep()
    raf = requestAnimationFrame(loop)
  }
  function startLoop() {
    if (raf) return
    t0 = nowMs()
    raf = requestAnimationFrame(loop)
  }

  /** Begin animating. Idempotent; refreshes the ring + sweep mask. */
  function start() {
    running = true
    rebuildRing()
    updateSweepMask()
    startLoop()
  }
  /** Stop animating and release the glimm controller. */
  function stop() {
    running = false
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    destroySweepCtrl()
  }
  /** Re-derive the ring + sweep mask after the region or stage size changed. */
  function rebuild() {
    rebuildRing()
    updateSweepMask()
    if (running) startLoop() // recover if the loop had stopped
  }

  onBeforeUnmount(stop)

  return { start, stop, rebuild, sweepMaskUrl }
}
