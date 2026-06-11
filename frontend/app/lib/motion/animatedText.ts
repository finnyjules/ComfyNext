// frontend/app/lib/motion/animatedText.ts
/**
 * Per-character layout + animated drawing for TextLayers. Layout mirrors
 * drawText() in useCompositorLayers (same wrap, align, lineHeight math) but
 * exposes one cell per visible character so the evaluator's per-unit states
 * can transform them individually.
 */
import type { TextLayer } from '~/composables/useCompositorLayers'
import { wrappedTextLines, applyFont } from '~/composables/useCompositorLayers'
import type { UnitState } from './evaluate'

export interface CharCell {
  char: string
  x: number   // px center, in the layer's local (unrotated) frame
  y: number
  w: number   // px advance width
  h: number   // px em box (fontSize px) — the unit box for dy deltas
}

/** One cell per non-whitespace char. Local frame: origin = layer center,
 *  same convention as drawText (caller applies layer translate/rotate). */
export function layoutTextUnits(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  W: number,
  H: number,
): CharCell[] {
  void H // unused — kept for API symmetry with the draw function
  const lines = wrappedTextLines(ctx, layer, W)
  const fontPx = layer.fontSize * W
  const lineH = fontPx * layer.lineHeight
  applyFont(ctx, layer, W)
  let blockW = 0
  if ((layer.boxW ?? 0) > 0) blockW = layer.boxW! * W
  else for (const ln of lines) blockW = Math.max(blockW, ctx.measureText(ln || ' ').width)

  const totalH = lines.length * lineH
  const cells: CharCell[] = []
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const lineW = ctx.measureText(line || '').width
    // Line start X matches drawText's anchor math for each alignment.
    // Known limitation: per-char advances (sum of measureText(char)) can
    // differ from measureText(line) by kerning/shaping deltas, so the line's
    // far edge may drift a px or two vs the static drawText render — inherent
    // to per-character animation, acceptable at rest.
    let x = layer.align === 'left' ? -blockW / 2
      : layer.align === 'right' ? blockW / 2 - lineW
      : -lineW / 2
    const y = -totalH / 2 + lineH / 2 + li * lineH
    for (const char of [...line]) {
      const w = ctx.measureText(char).width
      if (char.trim()) cells.push({ char, x: x + w / 2, y, w, h: fontPx })
      x += w
    }
  }
  return cells
}

/**
 * Draw a text layer with per-unit motion states. The context must already be
 * in canvas space (NOT pre-translated): this function applies the layer's own
 * translate/rotate exactly like paintLayer's fast path, then draws each char
 * cell with its UnitState transform. `units.length` should equal the cell
 * count (the evaluator is called with that n); missing entries fall back to
 * rest.
 */
export function drawAnimatedTextLayer(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  W: number,
  H: number,
  units: UnitState[],
): void {
  const cells = layoutTextUnits(ctx, layer, W, H)
  ctx.save()
  ctx.translate(layer.x * W, layer.y * H)
  if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180)
  applyFont(ctx, layer, W)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const strokeOn = !!layer.strokeColor && layer.strokeColor !== 'none'
    && layer.strokeColor !== 'transparent' && layer.strokeWidth > 0
  if (strokeOn) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = layer.strokeWidth * W
    ctx.strokeStyle = layer.strokeColor
  }
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    const st = units[i] ?? { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 }
    if (st.opacity <= 0.001) continue
    ctx.save()
    ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity * st.opacity))
    if (st.clip && st.clip.amount > 0.001) {
      // Clip the cell box BEFORE the unit transform so the reveal edge stays
      // fixed while the glyph slides under it (mask-reveal look). Pad x by the
      // em box to survive glyph overhang.
      const a = Math.max(0, Math.min(1, st.clip.amount))
      let cx = cell.x - cell.w, cy = cell.y - cell.h / 2, cw = cell.w * 2, ch = cell.h
      if (st.clip.side === 'top') { cy += ch * a; ch *= (1 - a) }
      else if (st.clip.side === 'bottom') { ch *= (1 - a) }
      else if (st.clip.side === 'left') { cx += cw * a; cw *= (1 - a) }
      else { cw *= (1 - a) }
      ctx.beginPath()
      ctx.rect(cx, cy, Math.max(0, cw), Math.max(0, ch))
      ctx.clip()
    }
    ctx.translate(cell.x + st.dx * cell.h, cell.y + st.dy * cell.h)
    if (st.rotation) ctx.rotate((st.rotation * Math.PI) / 180)
    if (st.scale !== 1) ctx.scale(Math.max(0.001, st.scale), Math.max(0.001, st.scale))
    ctx.fillStyle = layer.color
    if (strokeOn) ctx.strokeText(cell.char, 0, 0)
    ctx.fillText(cell.char, 0, 0)
    ctx.restore()
  }
  ctx.restore()
}
