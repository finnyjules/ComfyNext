/**
 * The vector export spine — Sailor's one SVG writer.
 *
 * Deliberately knows NOTHING about type, fonts or any studio. Its input is a
 * list of shapes whose commands are already in document space; its output is an
 * SVG string. Vector Type is the first consumer (glyph outlines); Shape Studio
 * is the intended second (flat-shaded facets project to coloured polygons,
 * which is exactly a list of filled paths). Anything that can produce
 * `VectorCommand[]` can export vector without writing another serialiser.
 *
 * Everything here is pure: no DOM, no canvas, no fetch. `commandsToPathData` is
 * shared with the canvas renderer so the two outputs cannot drift — the SVG
 * `d` and the Path2D replay are built from the same transformed command list.
 */

/** The five path commands fontkit emits, and the only ones we serialise. */
export type VectorCommandName =
  | 'moveTo'
  | 'lineTo'
  | 'quadraticCurveTo'
  | 'bezierCurveTo'
  | 'closePath'

/**
 * One path command. `args` is flat and its length is fixed by the command:
 * moveTo/lineTo 2, quadraticCurveTo 4, bezierCurveTo 6, closePath 0.
 */
export interface VectorCommand {
  command: VectorCommandName
  args: number[]
}

/** How many numbers each command carries. Also the set of legal commands. */
export const COMMAND_ARITY: Record<VectorCommandName, number> = {
  moveTo: 2,
  lineTo: 2,
  quadraticCurveTo: 4,
  bezierCurveTo: 6,
  closePath: 0,
}

export function isVectorCommandName(v: unknown): v is VectorCommandName {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(COMMAND_ARITY, v)
}

/**
 * A scale-then-translate placement, with an optional y flip.
 *
 * The flip is the whole reason this exists: font space (and any right-handed
 * projection) is y-up with the baseline at 0, while canvas and SVG are y-down.
 * Baking the flip into the coordinates — rather than leaving it to a
 * `ctx.scale(1, -1)` at the call site — means stroke widths, dash patterns and
 * per-glyph transforms all stay in output units, and the SVG needs no wrapper
 * transform to match what the canvas drew.
 */
export interface Transform2D {
  /** Uniform scale from source units to output units. Default 1. */
  scale?: number
  /** Translation in OUTPUT units, applied after the scale. Default 0. */
  x?: number
  y?: number
  /** Negate y, turning y-up source space into y-down output space. Default true. */
  flipY?: boolean
}

/**
 * Apply a `Transform2D` to a command list, returning new plain objects.
 *
 * Always copies. fontkit caches glyph paths internally, so handing a caller a
 * reference into `glyph.path.commands` would let one mutation corrupt every
 * later read of that glyph.
 */
export function transformCommands(commands: readonly VectorCommand[], t: Transform2D = {}): VectorCommand[] {
  const s = Number.isFinite(t.scale as number) ? (t.scale as number) : 1
  const dx = Number.isFinite(t.x as number) ? (t.x as number) : 0
  const dy = Number.isFinite(t.y as number) ? (t.y as number) : 0
  const sy = t.flipY === false ? s : -s

  const out: VectorCommand[] = []
  for (const c of commands) {
    if (!c || !isVectorCommandName(c.command)) continue
    const args = c.args ?? []
    const mapped: number[] = new Array(args.length)
    for (let i = 0; i < args.length; i++) {
      // args alternate x, y, x, y … for every command shape we accept.
      mapped[i] = i % 2 === 0 ? dx + (args[i] as number) * s : dy + (args[i] as number) * sy
    }
    out.push({ command: c.command, args: mapped })
  }
  return out
}

/** Format a number for SVG: fixed precision, trailing zeros stripped, no `-0`. */
export function formatNumber(v: number, precision = 3): string {
  if (!Number.isFinite(v)) return '0'
  let s = v.toFixed(Math.max(0, Math.min(10, precision)))
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' || s === '' ? '0' : s
}

/** Commands → an SVG path `d`. Coordinates are used as given (document space). */
export function commandsToPathData(commands: readonly VectorCommand[], precision = 3): string {
  const parts: string[] = []
  for (const c of commands) {
    if (!c || !isVectorCommandName(c.command)) continue
    const a = c.args ?? []
    const n = (i: number) => formatNumber(a[i] as number, precision)
    switch (c.command) {
      case 'moveTo': parts.push(`M${n(0)} ${n(1)}`); break
      case 'lineTo': parts.push(`L${n(0)} ${n(1)}`); break
      case 'quadraticCurveTo': parts.push(`Q${n(0)} ${n(1)} ${n(2)} ${n(3)}`); break
      case 'bezierCurveTo': parts.push(`C${n(0)} ${n(1)} ${n(2)} ${n(3)} ${n(4)} ${n(5)}`); break
      case 'closePath': parts.push('Z'); break
    }
  }
  return parts.join('')
}

/**
 * Bounds of a command list's CONTROL POINTS.
 *
 * Exact for polygons (Shape Studio's projected facets) and a slight
 * over-estimate wherever a curve's control points sit outside its hull — good
 * enough to size a viewBox, not a substitute for a true outline bbox. Vector
 * Type does not use this: fontkit hands it exact per-glyph bounds already.
 */
export function controlPointBounds(
  commands: readonly VectorCommand[],
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of commands) {
    const a = c?.args ?? []
    for (let i = 0; i + 1 < a.length; i += 2) {
      const x = a[i] as number
      const y = a[i + 1] as number
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
}

/**
 * One paintable path in document space. Paint is optional throughout so a
 * caller can emit geometry only and style it downstream (CSS, or a consumer
 * that re-paints per facet).
 */
export interface VectorShape {
  commands: VectorCommand[]
  fill?: string | null
  stroke?: string | null
  strokeWidth?: number
  fillRule?: 'nonzero' | 'evenodd'
  opacity?: number
  /** Extra attributes, e.g. a Shape Studio facet id or a class for animation. */
  attrs?: Record<string, string | number>
}

export interface SvgDocOptions {
  /** Rendered size. Omitted → the viewBox size. */
  width?: number
  height?: number
  /** `[minX, minY, width, height]`. Omitted → `0 0 width height`. */
  viewBox?: [number, number, number, number]
  /** Painted as a full-bleed rect behind everything. Omitted → transparent. */
  background?: string | null
  /** Decimal places in path data. Default 3. */
  precision?: number
  /** Attributes on the wrapper `<g>`, e.g. a shared fill. */
  groupAttrs?: Record<string, string | number>
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
}

function esc(v: string | number): string {
  return String(v).replace(/[&<>"']/g, ch => XML_ESCAPES[ch] as string)
}

function attrs(pairs: Array<[string, string | number | null | undefined]>): string {
  const out: string[] = []
  for (const [k, v] of pairs) {
    if (v === null || v === undefined || v === '') continue
    out.push(`${k}="${esc(v)}"`)
  }
  return out.length ? ' ' + out.join(' ') : ''
}

/**
 * Shapes → a complete standalone SVG document.
 *
 * Commands must already be in document space; this writer applies no transform
 * of its own, which is what keeps it free of any studio's coordinate
 * conventions. Use `transformCommands` first.
 */
export function shapesToSVG(shapes: readonly VectorShape[], doc: SvgDocOptions = {}): string {
  const precision = doc.precision ?? 3
  const vb = doc.viewBox
  const width = doc.width ?? (vb ? vb[2] : 0)
  const height = doc.height ?? (vb ? vb[3] : 0)
  const viewBox = vb ?? [0, 0, width, height]

  const body: string[] = []
  if (doc.background) {
    body.push(`<rect${attrs([
      ['x', formatNumber(viewBox[0], precision)],
      ['y', formatNumber(viewBox[1], precision)],
      ['width', formatNumber(viewBox[2], precision)],
      ['height', formatNumber(viewBox[3], precision)],
      ['fill', doc.background],
    ])}/>`)
  }

  for (const s of shapes) {
    const d = commandsToPathData(s.commands ?? [], precision)
    if (!d) continue
    const extra: Array<[string, string | number | null | undefined]> = []
    for (const [k, v] of Object.entries(s.attrs ?? {})) extra.push([k, v])
    body.push(`<path${attrs([
      ['d', d],
      ['fill', s.fill === null ? 'none' : s.fill],
      ['fill-rule', s.fillRule],
      ['stroke', s.stroke === null ? undefined : s.stroke],
      ['stroke-width', s.strokeWidth === undefined ? undefined : formatNumber(s.strokeWidth, precision)],
      ['opacity', s.opacity === undefined ? undefined : formatNumber(s.opacity, 4)],
      ...extra,
    ])}/>`)
  }

  const group = body.length
    ? `<g${attrs(Object.entries(doc.groupAttrs ?? {}))}>${body.join('')}</g>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg"${attrs([
    ['width', formatNumber(width, precision)],
    ['height', formatNumber(height, precision)],
    ['viewBox', viewBox.map(v => formatNumber(v, precision)).join(' ')],
  ])}>${group}</svg>`
}
