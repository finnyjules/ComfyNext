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

/** An axis-aligned window in DOCUMENT space, the same units as the commands. */
export interface VectorRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Canvas/CSS `blur(Npx)` → `feGaussianBlur`'s `stdDeviation`.
 *
 * They are the SAME quantity and the conversion is the identity — the Filter
 * Effects spec defines `blur(<length>)` as "the standard deviation to the
 * Gaussian function", i.e. exactly `<feGaussianBlur stdDeviation="length">`.
 * (The factor-of-two people reach for belongs to `box-shadow`, whose blur
 * radius is 2σ. Applying it here would halve every blur in the export.)
 *
 * Measured rather than assumed, in Chrome: a 100×100 rect under
 * `ctx.filter = 'blur(12px)'` and the same rect under `stdDeviation="12"`
 * rasterised through an `<img>` give a bit-identical alpha profile — RMS 0.000
 * across the row, identical ink count, identical 10–90% edge width. `σ = 6`
 * gives RMS 15.5 and `σ = 24` gives 24.6, so the check is not blind to the
 * error it rules out.
 *
 * This exists as a named function rather than nothing at all so the claim has
 * one place to live and one place to be corrected — a bare pass-through in a
 * caller reads as "nobody thought about it".
 *
 * The UNITS still need care: a canvas blur radius is in DEVICE pixels and
 * ignores the CTM, while `stdDeviation` is in user units (with
 * `primitiveUnits` at its default). A caller whose viewBox is not 1:1 with its
 * rendered size must convert.
 */
export function blurRadiusToStdDeviation(radius: number): number {
  return Number.isFinite(radius) && radius > 0 ? radius : 0
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
  /**
   * Gaussian blur as `feGaussianBlur`'s `stdDeviation`, in DOCUMENT units.
   * Emits a `<filter>` in `<defs>`, ONE per distinct value across the whole
   * document, and references it. Use `blurRadiusToStdDeviation` if what you
   * have is a canvas/CSS blur radius.
   */
  blur?: number
  /**
   * An axis-aligned reveal window in DOCUMENT space. Emits a `<clipPath>` in
   * `<defs>`, one per distinct rect, and references it.
   *
   * It is applied on a WRAPPER `<g>`, never on the path itself, so a shape's
   * own `transform` (in `attrs`) moves the shape THROUGH the window instead of
   * dragging the window along with it. That distinction is the whole difference
   * between a reveal and a translated, permanently-masked shape.
   */
  clip?: VectorRect | null
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
  /**
   * Prefix for every generated `<defs>` id. Omitted → derived from the
   * document's own content (see `defsIdPrefix`), which is what makes two
   * different exports safe to paste into one file.
   */
  idPrefix?: string
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
 * Below this there is nothing to see, and a `<filter>` costs the renderer a
 * separate offscreen pass. In document units, so it is a sub-hundredth of an
 * output pixel on a 1:1 export.
 */
const MIN_STD_DEVIATION = 0.01

/**
 * How far a Gaussian reaches, in σ. Past 3σ a Gaussian holds 0.3% of its
 * energy; the filter REGION below is padded by this much so a blurred shape
 * fades out instead of being cut off at the edge of its own filter.
 */
const BLUR_REACH = 3

/**
 * FNV-1a, 32-bit, as 7 base-36 characters.
 *
 * Not for security — for a short id prefix that is a pure function of the
 * document's content. Deterministic (a re-export of the same frame gets the
 * same ids, so exports diff cleanly) and content-derived (two different
 * exports get different ids, so they can be pasted into one file without one
 * shape picking up the other's filter).
 */
function hash36(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(7, '0').slice(-7)
}

/**
 * The id prefix for a document, derived from what the document CONTAINS.
 *
 * Exported so a caller can predict the ids (a test, or a consumer stitching
 * several documents together) without re-deriving the hash.
 */
export function defsIdPrefix(content: string): string {
  return `s${hash36(content)}`
}

/** A `<defs>` registry: distinct values in first-use order, each with an id. */
class Defs {
  private readonly blurs = new Map<string, number>()
  private readonly clips = new Map<string, VectorRect>()

  constructor(private readonly precision: number) {}

  /** The key IS the serialised value, so two shapes that would emit identical
   *  markup share one definition however they were computed. */
  blurKey(sd: number): string {
    const key = formatNumber(sd, this.precision)
    if (!this.blurs.has(key)) this.blurs.set(key, sd)
    return key
  }

  clipKey(r: VectorRect): string {
    const n = (v: number) => formatNumber(v, this.precision)
    const key = `${n(r.x)} ${n(r.y)} ${n(r.width)} ${n(r.height)}`
    if (!this.clips.has(key)) this.clips.set(key, r)
    return key
  }

  /** Every distinct value, in first-use order — the string the id prefix hashes. */
  signature(): string {
    return `${[...this.blurs.keys()].join(',')}|${[...this.clips.keys()].join(',')}`
  }

  get empty(): boolean {
    return this.blurs.size === 0 && this.clips.size === 0
  }

  idFor(prefix: string, kind: 'b' | 'c', key: string): string {
    const index = kind === 'b' ? [...this.blurs.keys()].indexOf(key) : [...this.clips.keys()].indexOf(key)
    return `${prefix}-${kind}${index}`
  }

  render(prefix: string, viewBox: readonly number[]): string {
    const p = this.precision
    const n = (v: number) => formatNumber(v, p)
    const out: string[] = []
    let i = 0
    for (const sd of this.blurs.values()) {
      // A userSpaceOnUse region spanning the WHOLE document, padded by the
      // blur's reach. The default region is objectBoundingBox −10%…120%, which
      // for a tall narrow shape (a lowercase 'l', a thin facet) is far smaller
      // than the blur: measured in Chrome, a 12×100 rect at σ 12 kept 1920 ink
      // pixels under the default region against the canvas's 11246, and 11228
      // under this one. Document-wide also means the region does not depend on
      // the shape, which is what lets one filter serve every shape that shares
      // a radius.
      const pad = sd * BLUR_REACH
      out.push(`<filter${attrs([
        ['id', `${prefix}-b${i}`],
        ['filterUnits', 'userSpaceOnUse'],
        ['x', n((viewBox[0] as number) - pad)],
        ['y', n((viewBox[1] as number) - pad)],
        ['width', n((viewBox[2] as number) + pad * 2)],
        ['height', n((viewBox[3] as number) + pad * 2)],
        // SVG's default is linearRGB; canvas and CSS filters work in sRGB.
        // Leaving it out shifts a blurred colour edge by up to 2/255 against
        // the canvas — small, but it is drift, and it is free to remove.
        ['color-interpolation-filters', 'sRGB'],
      ])}><feGaussianBlur${attrs([['stdDeviation', n(sd)]])}/></filter>`)
      i++
    }
    i = 0
    for (const r of this.clips.values()) {
      out.push(`<clipPath${attrs([['id', `${prefix}-c${i}`], ['clipPathUnits', 'userSpaceOnUse']])}><rect${attrs([
        ['x', n(r.x)],
        ['y', n(r.y)],
        ['width', n(Math.max(0, r.width))],
        ['height', n(Math.max(0, r.height))],
      ])}/></clipPath>`)
      i++
    }
    return out.length ? `<defs>${out.join('')}</defs>` : ''
  }
}

/**
 * Shapes → a complete standalone SVG document.
 *
 * Commands must already be in document space; this writer applies no transform
 * of its own, which is what keeps it free of any studio's coordinate
 * conventions. Use `transformCommands` first.
 *
 * A shape carrying `blur` or `clip` is wrapped in a `<g>` that references a
 * `<defs>` entry. The wrapper is not decoration:
 *
 *  - it has NO transform, so a filter's `stdDeviation` and a clip's rect stay
 *    in document units however the shape itself is transformed — matching a
 *    canvas, whose blur radius is in device pixels and ignores the CTM, and
 *    whose `ctx.clip()` is taken before the per-shape transform;
 *  - filter and clip sit on the SAME wrapper, and SVG's rendering model applies
 *    the filter first and clips the result — the order `ctx.filter` then
 *    `ctx.clip()` then `fill()` produces.
 */
export function shapesToSVG(shapes: readonly VectorShape[], doc: SvgDocOptions = {}): string {
  const precision = doc.precision ?? 3
  const vb = doc.viewBox
  const width = doc.width ?? (vb ? vb[2] : 0)
  const height = doc.height ?? (vb ? vb[3] : 0)
  const viewBox = vb ?? [0, 0, width, height]

  const background = doc.background
    ? `<rect${attrs([
        ['x', formatNumber(viewBox[0], precision)],
        ['y', formatNumber(viewBox[1], precision)],
        ['width', formatNumber(viewBox[2], precision)],
        ['height', formatNumber(viewBox[3], precision)],
        ['fill', doc.background],
      ])}/>`
    : ''

  // PASS 1 — serialise the paths and register the defs. Ids cannot be written
  // yet: the prefix is a function of everything the document holds, which is
  // not known until the last shape has been read.
  const defs = new Defs(precision)
  const drawn: Array<{ path: string; blur: string | null; clip: string | null }> = []
  for (const s of shapes) {
    const d = commandsToPathData(s.commands ?? [], precision)
    if (!d) continue
    const extra: Array<[string, string | number | null | undefined]> = []
    for (const [k, v] of Object.entries(s.attrs ?? {})) extra.push([k, v])
    const path = `<path${attrs([
      ['d', d],
      ['fill', s.fill === null ? 'none' : s.fill],
      ['fill-rule', s.fillRule],
      ['stroke', s.stroke === null ? undefined : s.stroke],
      ['stroke-width', s.strokeWidth === undefined ? undefined : formatNumber(s.strokeWidth, precision)],
      ['opacity', s.opacity === undefined ? undefined : formatNumber(s.opacity, 4)],
      ...extra,
    ])}/>`
    const sd = Number.isFinite(s.blur as number) ? (s.blur as number) : 0
    const clip = s.clip
    drawn.push({
      path,
      blur: sd >= MIN_STD_DEVIATION ? defs.blurKey(sd) : null,
      clip: clip ? defs.clipKey(clip) : null,
    })
  }

  // The prefix hashes the geometry AND the defs, so two exports collide only
  // when they are the same picture — in which case the definitions they would
  // share are identical anyway.
  const prefix = doc.idPrefix
    ?? defsIdPrefix(`${viewBox.join(' ')}|${defs.signature()}|${drawn.map(x => x.path).join('')}`)

  // PASS 2 — wrap.
  const body: string[] = []
  if (background) body.push(background)
  for (const item of drawn) {
    let el = item.path
    if (item.blur !== null || item.clip !== null) {
      el = `<g${attrs([
        ['filter', item.blur === null ? undefined : `url(#${defs.idFor(prefix, 'b', item.blur)})`],
        ['clip-path', item.clip === null ? undefined : `url(#${defs.idFor(prefix, 'c', item.clip)})`],
      ])}>${el}</g>`
    }
    body.push(el)
  }

  const group = body.length
    ? `<g${attrs(Object.entries(doc.groupAttrs ?? {}))}>${body.join('')}</g>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg"${attrs([
    ['width', formatNumber(width, precision)],
    ['height', formatNumber(height, precision)],
    ['viewBox', viewBox.map(v => formatNumber(v, precision)).join(' ')],
  ])}>${defs.empty ? '' : defs.render(prefix, viewBox)}${group}</svg>`
}
