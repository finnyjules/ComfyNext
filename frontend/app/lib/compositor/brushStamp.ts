// Freehand brush strokes → white alpha coverage on a canvas. Strokes are stored
// width-normalized (both axes / artboard width); `base` is the px-per-unit for the
// target canvas (its width when a stroke spans the full artboard). The renderer
// then source-in-fills this alpha with any Paint. See the paintbrush design spec.

export interface PaintStroke {
  points: { x: number; y: number }[] // width-normalized (both axes ÷ artboard width)
  radius: number                     // width-normalized brush radius
  hardness: number                   // 1 = hard edge … 0 = fully soft
  opacity: number                    // 0..1 per-stroke flow
  erase: boolean                     // erase strokes carve alpha back out
}

/**
 * Convert a SCREEN-normalized pointer coord (`nx` = x/rectW, `ny` = y/rectH, both
 * in [0..1] of the artboard rect) into the WIDTH-normalized space strokes are
 * stored in (both axes ÷ artboard width). Only Y changes: a screen fraction of
 * HEIGHT becomes a fraction of WIDTH by scaling by the aspect (h/w). On a square
 * artboard (w===h) Y is unchanged; on a 2:1 landscape ny=1 maps to y=0.5.
 */
export function toWidthNorm(nx: number, ny: number, w: number, h: number): { x: number; y: number } {
  return { x: nx, y: ny * (h / w) }
}

/** Catmull-Rom resample: smooth a polyline through its points. Endpoints are kept
 *  exactly; interior gets `samples` interpolated points per segment. */
export function smoothPoints(points: { x: number; y: number }[], samples = 8): { x: number; y: number }[] {
  const n = points.length
  if (n < 3) return points
  const out: { x: number; y: number }[] = [points[0]!]
  for (let i = 0; i < n - 1; i++) {
    const p0 = points[i - 1] ?? points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] ?? p2
    for (let s = 1; s <= samples; s++) {
      const t = s / samples
      const t2 = t * t, t3 = t2 * t
      const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
      const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
      out.push({ x, y })
    }
  }
  // Catmull-Rom's last sample is mathematically exactly the final input point,
  // but floating-point rounding can leave a sub-epsilon residual; snap it back
  // so endpoints really are preserved exactly (see doc comment above).
  out[out.length - 1] = points[n - 1]!
  return out
}

/** Width-normalized radius → target px, floored so a dot always shows. */
export function strokeRadiusPx(stroke: PaintStroke, base: number): number {
  return Math.max(0.5, stroke.radius * base)
}

/** Paint ONE stroke as white alpha at full opacity. Hard = round polyline + dot
 *  caps; soft = overlapping radial-gradient stamps (solid core to `hardness`). */
export function drawStrokeAlpha(ctx: CanvasRenderingContext2D, stroke: PaintStroke, base: number): void {
  const pts = smoothPoints(stroke.points, stroke.hardness >= 0.999 ? 4 : 8)
  if (!pts.length) return
  const r = strokeRadiusPx(stroke, base)
  ctx.save()
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  if (stroke.hardness >= 0.999) {
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'
    for (const p of pts) { ctx.beginPath(); ctx.arc(p.x * base, p.y * base, r, 0, Math.PI * 2); ctx.fill() }
    if (pts.length > 1) {
      ctx.lineWidth = r * 2
      ctx.beginPath(); ctx.moveTo(pts[0]!.x * base, pts[0]!.y * base)
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x * base, pts[i]!.y * base)
      ctx.stroke()
    }
  } else {
    const inner = Math.max(0, Math.min(0.95, stroke.hardness))
    const step = Math.max(1, r * 0.35)
    const stamp = (x: number, y: number) => {
      const g = ctx.createRadialGradient(x, y, r * inner, x, y, r)
      g.addColorStop(0, '#fff'); g.addColorStop(inner, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
    let prev = pts[0]!
    stamp(prev.x * base, prev.y * base)
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]!
      const dx = (p.x - prev.x) * base, dy = (p.y - prev.y) * base
      const dist = Math.hypot(dx, dy)
      const steps = Math.max(1, Math.floor(dist / step))
      for (let s = 1; s <= steps; s++) stamp((prev.x * base) + (dx * s) / steps, (prev.y * base) + (dy * s) / steps)
      prev = p
    }
  }
  ctx.restore()
}

/** Composite all strokes onto `ctx`. Each paint stroke renders to its own temp
 *  canvas at full alpha, then composites at its `opacity` so a self-overlapping
 *  stroke stays uniform. Erase strokes carve directly with destination-out. */
export function stampStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: PaintStroke[],
  base: number,
  makeCanvas: () => HTMLCanvasElement,
): void {
  const w = ctx.canvas.width, h = ctx.canvas.height
  for (const s of strokes) {
    if (!s.points.length) continue
    if (s.erase) {
      ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity))
      drawStrokeAlpha(ctx, s, base); ctx.restore()
      continue
    }
    const tmp = makeCanvas(); tmp.width = w; tmp.height = h
    const tctx = tmp.getContext('2d'); if (!tctx) continue
    drawStrokeAlpha(tctx, s, base)
    ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, s.opacity)); ctx.globalCompositeOperation = 'source-over'
    ctx.drawImage(tmp, 0, 0); ctx.restore()
  }
}
