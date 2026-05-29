/**
 * textOnPath — render text along a parametric curve.
 *
 * Each character is placed individually along the path: its center follows
 * the curve, and it's rotated to match the local tangent. This gives the
 * classic "text on a circle" / "text on a wave" effect.
 *
 * Pure math + Canvas2D — no DOM, no Vue, no GSAP.
 */

// ── Path types ──────────────────────────────────────────────────────────────

export type PathType = 'arc' | 'circle' | 'wave' | 'line'

export interface ArcPathParams {
  type: 'arc'
  radius: number       // px in the bake coordinate space
  startAngle: number   // degrees
  endAngle: number     // degrees
}

export interface CirclePathParams {
  type: 'circle'
  radius: number
}

export interface WavePathParams {
  type: 'wave'
  amplitude: number    // px
  frequency: number    // number of full waves across the text
  phase: number        // degrees (0–360)
}

export interface LinePathParams {
  type: 'line'
  /** Curvature: 0 = straight, positive = arc upward, negative = arc downward. */
  curvature: number    // -1..1
}

export type PathParams = ArcPathParams | CirclePathParams | WavePathParams | LinePathParams

export const DEFAULT_PATH: PathParams = { type: 'arc', radius: 200, startAngle: -90, endAngle: 90 }

// ── Parametric path evaluation ──────────────────────────────────────────────

interface PathPoint {
  x: number
  y: number
  angle: number  // radians, tangent direction
}

const deg = (d: number) => (d * Math.PI) / 180

/**
 * Evaluate a path at parameter `t` (0..1) and return position + tangent angle.
 * `totalLength` is used by some path types to scale correctly.
 */
function evalPath(path: PathParams, t: number, totalLength: number): PathPoint {
  switch (path.type) {
    case 'arc': {
      const a0 = deg(path.startAngle)
      const a1 = deg(path.endAngle)
      const a = a0 + (a1 - a0) * t
      return {
        x: path.radius * Math.cos(a),
        y: path.radius * Math.sin(a),
        angle: a + Math.PI / 2,  // tangent is perpendicular to radius
      }
    }
    case 'circle': {
      const a = -Math.PI / 2 + 2 * Math.PI * t  // start at top
      return {
        x: path.radius * Math.cos(a),
        y: path.radius * Math.sin(a),
        angle: a + Math.PI / 2,
      }
    }
    case 'wave': {
      const x = t * totalLength
      const phase = deg(path.phase)
      const omega = path.frequency * 2 * Math.PI
      const y = path.amplitude * Math.sin(omega * t + phase)
      // Tangent: dy/dt
      const dydt = path.amplitude * omega * Math.cos(omega * t + phase)
      const dxdt = totalLength
      return {
        x,
        y,
        angle: Math.atan2(dydt, dxdt),
      }
    }
    case 'line': {
      if (Math.abs(path.curvature) < 0.01) {
        // Straight line
        return { x: t * totalLength, y: 0, angle: 0 }
      }
      // Curve: treat curvature as an arc
      const maxAngle = path.curvature * Math.PI
      const r = totalLength / (2 * Math.abs(maxAngle))
      const a0 = -Math.abs(maxAngle)
      const a = a0 + 2 * Math.abs(maxAngle) * t
      const sign = path.curvature > 0 ? -1 : 1
      return {
        x: totalLength / 2 + r * Math.sin(a),
        y: sign * (r * Math.cos(a) - r * Math.cos(a0)),
        angle: a,
      }
    }
  }
}

// ── Path length estimation ──────────────────────────────────────────────────

function estimatePathLength(path: PathParams, refLength: number, steps = 200): number {
  let len = 0
  let prev = evalPath(path, 0, refLength)
  for (let i = 1; i <= steps; i++) {
    const curr = evalPath(path, i / steps, refLength)
    len += Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2)
    prev = curr
  }
  return len
}

// ── Rendering ───────────────────────────────────────────────────────────────

export interface TextOnPathOptions {
  text: string
  fontFamily: string
  fontWeight: number
  fontSizePx: number
  variationSettings: string
  letterSpacing: number    // em
  color: string
  bgColor: string          // 'transparent' or hex
  path: PathParams
}

/**
 * Render text along a path to a Canvas2D.
 * Returns the canvas element (caller converts to PNG / displays).
 */
export function renderTextOnPath(opts: TextOnPathOptions, scale = 2): HTMLCanvasElement {
  const {
    text, fontFamily, fontWeight, fontSizePx, variationSettings,
    letterSpacing, color, bgColor, path,
  } = opts

  const fontPx = fontSizePx * scale

  // Measure each character's width
  const scratch = document.createElement('canvas').getContext('2d')!
  scratch.font = `${fontWeight} ${fontPx}px "${fontFamily}", sans-serif`
  if ((scratch as any).fontVariationSettings !== undefined) {
    ;(scratch as any).fontVariationSettings = variationSettings
  }
  if ((scratch as any).letterSpacing !== undefined) {
    ;(scratch as any).letterSpacing = `${letterSpacing * fontPx}px`
  }

  const charWidths = [...text].map(ch => scratch.measureText(ch).width)
  const totalTextWidth = charWidths.reduce((s, w) => s + w, 0)

  // Path length → use as reference for wave/line paths
  const pathLen = estimatePathLength(path, totalTextWidth * 1.2)
  // Use the larger of text width and path length to ensure text fits
  const refLen = Math.max(totalTextWidth * 1.1, pathLen)

  // Place chars along the path
  // Each char center is at an accumulated distance along the path
  // Map distance → t parameter by normalizing to [0,1]
  let accumulated = 0
  const charPlacements: { char: string; t: number }[] = []
  for (let i = 0; i < charWidths.length; i++) {
    const halfW = charWidths[i] / 2
    accumulated += halfW
    charPlacements.push({
      char: text[i],
      t: accumulated / refLen,
    })
    accumulated += halfW
  }

  // Evaluate path positions for all chars + compute bounds
  const positions: (PathPoint & { char: string })[] = charPlacements.map(cp => ({
    ...evalPath(path, cp.t, refLen),
    char: cp.char,
  }))

  // Compute bounding box
  const margin = fontPx * 1.2
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of positions) {
    minX = Math.min(minX, p.x - margin)
    minY = Math.min(minY, p.y - margin)
    maxX = Math.max(maxX, p.x + margin)
    maxY = Math.max(maxY, p.y + margin)
  }

  const W = Math.max(2, Math.ceil(maxX - minX))
  const H = Math.max(2, Math.ceil(maxY - minY))

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // Background
  if (bgColor !== 'transparent') {
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, W, H)
  }

  // Draw each character
  ctx.font = `${fontWeight} ${fontPx}px "${fontFamily}", sans-serif`
  if ((ctx as any).fontVariationSettings !== undefined) {
    ;(ctx as any).fontVariationSettings = variationSettings
  }
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const p of positions) {
    if (!p.char.trim()) continue
    ctx.save()
    ctx.translate(p.x - minX, p.y - minY)
    ctx.rotate(p.angle)
    ctx.fillText(p.char, 0, 0)
    ctx.restore()
  }

  return canvas
}

/**
 * Generate an SVG preview path string for display in the widget.
 * Returns an SVG `d` attribute for a `<path>` element, scaled to fit
 * within a viewBox of width×height.
 */
export function previewPathSvg(
  path: PathParams,
  width: number,
  height: number,
  steps = 60,
): string {
  const refLen = width * 0.8
  const points: { x: number; y: number }[] = []

  for (let i = 0; i <= steps; i++) {
    const p = evalPath(path, i / steps, refLen)
    points.push({ x: p.x, y: p.y })
  }

  // Compute bounds and scale to fit
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }

  const pw = maxX - minX || 1
  const ph = maxY - minY || 1
  const sx = (width * 0.9) / pw
  const sy = (height * 0.8) / ph
  const s = Math.min(sx, sy)
  const ox = (width - pw * s) / 2 - minX * s
  const oy = (height - ph * s) / 2 - minY * s

  return points.map((p, i) => {
    const x = p.x * s + ox
    const y = p.y * s + oy
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}
