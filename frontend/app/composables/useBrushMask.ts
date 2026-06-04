/**
 * Brush-mask tool for the Compositor inpainting feature. The user paints the
 * region they want the model to change; we keep strokes as resolution-independent
 * polylines (normalized artboard coords + a width-fraction radius), so the same
 * mask can be previewed on the editor canvas AND baked into the *source image's
 * native pixel space* for the model — no drift between what's painted and what's
 * sent. Mirrors the tool-mode contract of useVectorPen (active/down/move/up).
 *
 * Mask convention for FLUX Fill: WHITE = inpaint, BLACK = keep.
 */

export interface BrushStroke {
  points: { x: number; y: number }[] // normalized artboard coords (0..1)
  radius: number                     // normalized to artboard WIDTH (matches layer geometry)
  erase: boolean                     // erase strokes carve back out of the mask
}

/** Image placement on the artboard, in artboard LOGICAL px, plus the output
 *  (native) resolution to bake into. Matches how the editor draws the image. */
export interface MaskTarget {
  artW: number; artH: number   // artboard logical size (strokes are normalized to this)
  cxPx: number; cyPx: number   // image center, artboard logical px
  dwPx: number; dhPx: number   // image displayed size, artboard logical px
  rotationDeg: number          // image rotation
  outW: number; outH: number   // bake resolution (source image native px, capped)
}

export interface BakeOpts {
  featherPx?: number // gaussian blur on the mask edge (output px) — softer seams
  expandPx?: number  // grow the masked region outward (output px) before feather
}

const PREVIEW_FILL = 'rgba(56, 189, 248, 0.45)' // cyan wash over the painted area

export function useBrushMask() {
  const active = ref(false)
  const sizePx = ref(48)               // brush DIAMETER in display px (UI-facing)
  const mode = ref<'add' | 'erase'>('add')
  const strokes = ref<BrushStroke[]>([])
  const drawing = ref(false)
  const cursor = ref<{ x: number; y: number } | null>(null) // normalized, for the cursor ring

  // Display px → normalized width-fraction radius. `pxBase` is the artboard
  // logical width, so the on-screen brush size stays WYSIWYG at any zoom.
  function radiusNorm(pxBase: number): number {
    return Math.max(0.001, sizePx.value / 2 / Math.max(1, pxBase))
  }

  const hasMask = computed(() => strokes.value.some(s => !s.erase && s.points.length > 0))

  function setActive(v: boolean) { active.value = v; if (!v) { drawing.value = false } }
  function clear() { strokes.value = []; drawing.value = false }

  /** Begin a stroke at a normalized point. `pxBase` = artboard logical width. */
  function down(nx: number, ny: number, pxBase: number) {
    drawing.value = true
    strokes.value = [...strokes.value, { points: [{ x: nx, y: ny }], radius: radiusNorm(pxBase), erase: mode.value === 'erase' }]
  }
  function move(nx: number, ny: number) {
    cursor.value = { x: nx, y: ny }
    if (!drawing.value) return
    const last = strokes.value[strokes.value.length - 1]
    if (!last) return
    // Mutate the tail stroke in place but trigger reactivity by reassigning.
    last.points.push({ x: nx, y: ny })
    strokes.value = [...strokes.value]
  }
  function up() { drawing.value = false }

  // ── Rendering ──────────────────────────────────────────────────────────────
  /** Stamp the strokes onto a binary alpha mask (white on transparent) at W×H,
   *  honoring erase via destination-out. `toX/toY` map a normalized point to the
   *  target canvas; `rPx` maps the width-fraction radius to target px. */
  function stampMask(
    ctx: CanvasRenderingContext2D,
    toX: (x: number) => number, toY: (y: number) => number, rPx: (r: number) => number,
  ) {
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of strokes.value) {
      if (!s.points.length) continue
      ctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
      ctx.fillStyle = '#fff'
      ctx.strokeStyle = '#fff'
      const r = rPx(s.radius)
      // Dots at each sample (covers single-click stamps and stroke ends)…
      for (const p of s.points) {
        ctx.beginPath()
        ctx.arc(toX(p.x), toY(p.y), Math.max(0.5, r), 0, Math.PI * 2)
        ctx.fill()
      }
      // …plus a thick connecting polyline so fast drags stay continuous.
      const pts = s.points
      if (pts.length > 1) {
        ctx.lineWidth = r * 2
        ctx.beginPath()
        ctx.moveTo(toX(pts[0]!.x), toY(pts[0]!.y))
        for (let i = 1; i < pts.length; i++) ctx.lineTo(toX(pts[i]!.x), toY(pts[i]!.y))
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  /** Paint the translucent mask preview onto the editor overlay (W×H logical px). */
  function render(ctx: CanvasRenderingContext2D, W: number, H: number) {
    if (!strokes.value.length) return
    const tmp = document.createElement('canvas')
    tmp.width = Math.max(1, Math.round(W)); tmp.height = Math.max(1, Math.round(H))
    const tctx = tmp.getContext('2d')!
    stampMask(tctx, x => x * W, y => y * H, r => r * W)
    // Tint the binary mask with a flat wash via source-in, then composite.
    tctx.globalCompositeOperation = 'source-in'
    tctx.fillStyle = PREVIEW_FILL
    tctx.fillRect(0, 0, tmp.width, tmp.height)
    ctx.drawImage(tmp, 0, 0, W, H)
  }

  // ── Bake (for the model) ─────────────────────────────────────────────────--
  /** Render the mask into the source image's native pixel space: black bg,
   *  white where the user painted. Returns a canvas, or null if nothing painted. */
  function bakeMask(target: MaskTarget, opts: BakeOpts = {}): HTMLCanvasElement | null {
    if (!hasMask.value) return null
    const { artW, artH, cxPx, cyPx, dwPx, dhPx, rotationDeg, outW, outH } = target
    const sx = outW / dwPx, sy = outH / dhPx // artboard px → output px scale

    // 1) Hard-edged binary mask (white on transparent) in OUTPUT space. Replay
    //    strokes in artboard px; a single transform carries them into the
    //    image's native frame (inverse of how the image is drawn).
    const bin = document.createElement('canvas')
    bin.width = Math.max(1, Math.round(outW)); bin.height = Math.max(1, Math.round(outH))
    const bctx = bin.getContext('2d')!
    bctx.save()
    bctx.translate(outW / 2, outH / 2)
    bctx.scale(sx, sy)
    bctx.rotate((-rotationDeg * Math.PI) / 180)
    bctx.translate(-cxPx, -cyPx)
    // Expand grows the region outward: convert output px → artboard px and add to
    // every stroke's radius. radius is normalized-to-width → artboard px via artW.
    const expandArt = (opts.expandPx ?? 0) / Math.max(sx, 0.0001)
    stampMask(bctx, x => x * artW, y => y * artH, r => r * artW + expandArt)
    bctx.restore()

    // 2) Composite onto solid black, optionally feathering the edge for soft seams.
    const cv = document.createElement('canvas')
    cv.width = bin.width; cv.height = bin.height
    const ctx = cv.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, cv.width, cv.height)
    if (opts.featherPx && opts.featherPx > 0) ctx.filter = `blur(${opts.featherPx}px)`
    ctx.drawImage(bin, 0, 0)
    ctx.filter = 'none'
    return cv
  }

  return {
    active, sizePx, mode, strokes, drawing, cursor, hasMask,
    setActive, clear, down, move, up, radiusNorm, render, bakeMask, stampMask,
  }
}
