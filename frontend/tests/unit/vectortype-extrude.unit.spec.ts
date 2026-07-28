/**
 * Vector Type — EXTRUDE, as repeated offset copies of the glyph path.
 *
 * Two halves, deliberately kept apart:
 *
 *  1. **`extrudeOffsets` / `extrudeBudget` as PLAIN DATA.** No canvas, no DOM,
 *     no font — four numbers in, a list of `{dx, dy, scale}` out. That is the
 *     whole reason the geometry lives in its own module: a block shadow's
 *     correctness is arithmetic, and arithmetic asserted against exact numbers
 *     cannot be "it rendered something". One of these tests proves the purity
 *     rather than asserting it, by running the function with every canvas global
 *     replaced by a trap.
 *  2. **The canvas replay.** That the copies are drawn BENEATH the face, in the
 *     layer's own slot in the stack, carrying the layer's own paint — and the
 *     one decision a pure test cannot reach: with a run-anchored paint, the copy
 *     moves the GEOMETRY and leaves the PAINT SPACE where it is, so an extruded
 *     gradient is one continuous ramp across the whole block rather than N
 *     stacked recolourings of the face. The recording context reads back both
 *     the transform each paint happened under AND the matrix the copy's path was
 *     built with, so those two are separable facts rather than one blur.
 *
 * NO NETWORK, NO DOM: the same eight-character Inter variable subset every other
 * Vector Type spec uses, plus `Path2D`/`DOMMatrix` stubs (this suite runs in node).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as fontkit from 'fontkit'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { normaliseAxes, type VtFont } from '~/lib/vectortype/font'
import {
  DEFAULT_CONFIG,
  VT_EXTRUDE_DEPTH_MAX,
  mergeConfig,
  vtLayer,
  type VectorTypeConfig,
  type VtAppearanceLayer,
} from '~/lib/vectortype/config'
import {
  VT_EXTRUDE_FRAME_BUDGET,
  VT_EXTRUDE_MIN_SCALE,
  extrudeBudget,
  extrudeOffsets,
} from '~/lib/vectortype/extrude'
import { drawVectorType } from '~/lib/vectortype/canvas'

// ── half one: the pure geometry ─────────────────────────────────────────────

/** Only the four fields `extrudeOffsets` reads. Anything omitted defaults the
 *  way a layer that never went through `mergeLayer` would arrive. */
const spec = (p: Partial<VtAppearanceLayer>) => p as VtAppearanceLayer

/** Exact enough for trig, loose enough for float noise. */
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 10)

describe('extrudeOffsets — the copies, as plain data', () => {
  it('produces NO copies at depth 0 — an inert layer, not a one-copy one', () => {
    // The headline case: `depth` is a count, and a count of zero is nothing. A
    // renderer that drew one copy anyway would put a hard offset shadow behind
    // every letter of a config the user set to "no extrude".
    expect(extrudeOffsets(spec({ depth: 0, distance: 10, angle: 0 }))).toEqual([])
    // …and every way a depth can fail to be a positive count lands in the same
    // place, rather than producing NaN offsets that blank the glyph.
    for (const depth of [0, -1, -40, 0.4, NaN, Infinity, undefined, null, 'eight'] as unknown[]) {
      expect(extrudeOffsets(spec({ depth: depth as number, distance: 10 })), `depth ${String(depth)}`).toEqual([])
    }
    expect(extrudeOffsets(null)).toEqual([])
    expect(extrudeOffsets(undefined)).toEqual([])
  })

  it('produces exactly `depth` copies, ordered BACK TO FRONT', () => {
    const out = extrudeOffsets(spec({ depth: 5, angle: 0, distance: 10, taper: 0 }))
    expect(out.length).toBe(5)
    // `[0]` is the FARTHEST. Reversed, the nearest copy would be drawn last-but-
    // one and a tapered or translucent extrude would stack in the wrong order —
    // invisible in a flat opaque one, which is why it is asserted here.
    expect(out.map(c => c.dx)).toEqual([50, 40, 30, 20, 10])
    expect(out.every(c => c.dy === 0)).toBe(true)
  })

  it('spaces the copies at k × distance, not at distance/k or a fixed total', () => {
    for (const distance of [1, 3, 7.5, 40]) {
      const out = extrudeOffsets(spec({ depth: 4, angle: 0, distance }))
      expect(out.map(c => c.dx)).toEqual([4, 3, 2, 1].map(k => k * distance))
    }
    // A negative distance is a legal way to reverse the direction, not a bug.
    expect(extrudeOffsets(spec({ depth: 2, angle: 0, distance: -6 })).map(c => c.dx)).toEqual([-12, -6])
  })

  it('steps along `angle` with canvas’s own convention — 0 right, 90 DOWN', () => {
    // `dx = cos θ`, `dy = sin θ` with y pointing down: identical to fillTile's
    // gradient/stripe angle, which is the only other direction-in-degrees this
    // product shows a user. A private convention here would mean two "angle"
    // sliders in one panel rotating opposite ways.
    const at = (angle: number) => extrudeOffsets(spec({ depth: 1, angle, distance: 10 }))[0]!
    near(at(0).dx, 10); near(at(0).dy, 0)
    near(at(90).dx, 0); near(at(90).dy, 10)
    near(at(180).dx, -10); near(at(180).dy, 0)
    near(at(270).dx, 0); near(at(270).dy, -10)
    // The stored default, 135°, steps DOWN-LEFT under this convention. Asserted
    // because config.ts's comment used to claim down-right while nothing read
    // the field — the exact kind of claim that only becomes false once it draws.
    const d = at(135)
    expect(d.dx).toBeLessThan(0)
    expect(d.dy).toBeGreaterThan(0)
    near(Math.hypot(d.dx, d.dy), 10)
  })

  it('SHRINKS the far copies as `taper` rises, and the near ones least', () => {
    const flat = extrudeOffsets(spec({ depth: 4, angle: 0, distance: 10, taper: 0 }))
    expect(flat.map(c => c.scale)).toEqual([1, 1, 1, 1])

    const tapered = extrudeOffsets(spec({ depth: 4, angle: 0, distance: 10, taper: 0.5 }))
    // Back to front, so the scales RISE towards the face.
    expect(tapered.map(c => c.scale)).toEqual([0.5, 0.625, 0.75, 0.875])
    for (let i = 1; i < tapered.length; i++) {
      expect(tapered[i]!.scale).toBeGreaterThan(tapered[i - 1]!.scale)
    }
    // Every copy is smaller than the face it sits behind — the point of a taper.
    expect(tapered.every(c => c.scale < 1)).toBe(true)
    // The farthest copy is exactly `1 - taper`: the contract, not a curve fit.
    near(tapered[0]!.scale, 0.5)
    // Taper does NOT move the copies — only their size. A taper that also
    // shortened the reach would be two knobs wearing one label.
    expect(tapered.map(c => c.dx)).toEqual(flat.map(c => c.dx))
  })

  it('FLARES on a negative taper, and never mirrors or vanishes on a full one', () => {
    const flared = extrudeOffsets(spec({ depth: 4, angle: 0, distance: 10, taper: -1 }))
    expect(flared.map(c => c.scale)).toEqual([2, 1.75, 1.5, 1.25])

    const full = extrudeOffsets(spec({ depth: 8, angle: 0, distance: 10, taper: 1 }))
    // A scale of exactly 0 makes the CTM singular and Chrome drops the op; a
    // negative one MIRRORS the copy, which is a wrong picture rather than a
    // missing one. Floored, and the floor is visible in the exported constant.
    expect(full[0]!.scale).toBe(VT_EXTRUDE_MIN_SCALE)
    expect(full.every(c => c.scale > 0)).toBe(true)
    // …and only the copy that would have vanished is touched.
    expect(full[1]!.scale).toBeCloseTo(1 - 7 / 8, 10)
    // Out-of-range tapers clamp rather than invert.
    expect(extrudeOffsets(spec({ depth: 2, distance: 1, taper: 9 })).map(c => c.scale))
      .toEqual(extrudeOffsets(spec({ depth: 2, distance: 1, taper: 1 })).map(c => c.scale))
  })

  it('bounds `depth` at VT_EXTRUDE_DEPTH_MAX — the SAME cap the merge applies', () => {
    // Not a second, quieter cap: `mergeLayer` clamps a stored depth to this, and
    // this repeats it for a layer that reached the renderer unmerged (a raw
    // pre-stack blob's array is handed over as-is).
    expect(extrudeOffsets(spec({ depth: 1e6, distance: 1 })).length).toBe(VT_EXTRUDE_DEPTH_MAX)
    expect(extrudeOffsets(spec({ depth: VT_EXTRUDE_DEPTH_MAX, distance: 1 })).length).toBe(VT_EXTRUDE_DEPTH_MAX)
  })

  it('honours a lower `cap`, spreading the taper over the copies that DRAW', () => {
    const capped = extrudeOffsets(spec({ depth: 20, angle: 0, distance: 5, taper: 0.5 }), 4)
    expect(capped.length).toBe(4)
    // A capped extrude is a SHORTER extrude, not a truncated one: the far end
    // still reaches its full taper, so the picture reads as a complete block.
    near(capped[0]!.scale, 0.5)
    expect(capped.map(c => c.dx)).toEqual([20, 15, 10, 5])
    // The cap can only lower the count, never raise it past the real depth.
    expect(extrudeOffsets(spec({ depth: 3, distance: 5 }), 99).length).toBe(3)
    expect(extrudeOffsets(spec({ depth: 3, distance: 5 }), 0)).toEqual([])
  })

  it('never emits a NaN, whatever the layer holds', () => {
    // A NaN in `dx` reaches a matrix and blanks the entire glyph — a failure
    // that looks like "the text disappeared", not "the extrude is wrong".
    const junk = extrudeOffsets(spec({
      depth: 3, angle: NaN, distance: Infinity as number, taper: NaN,
    } as Partial<VtAppearanceLayer>))
    expect(junk.length).toBe(3)
    for (const c of junk) {
      expect(Number.isFinite(c.dx)).toBe(true)
      expect(Number.isFinite(c.dy)).toBe(true)
      expect(Number.isFinite(c.scale)).toBe(true)
    }
    const strings = extrudeOffsets({ depth: 2, angle: '90', distance: '10', taper: 'lots' } as unknown as VtAppearanceLayer)
    expect(strings.length).toBe(2)
    expect(strings.every(c => Number.isFinite(c.dx) && Number.isFinite(c.dy) && c.scale === 1)).toBe(true)
  })

  it('is PURE — it runs with every canvas global replaced by a trap', () => {
    // Proved, not asserted. If `extrudeOffsets` ever reaches for a canvas, a
    // matrix or the document to work out an offset, this throws instead of
    // quietly making the module un-testable and un-reusable by the SVG writer.
    const traps = ['document', 'window', 'Path2D', 'DOMMatrix', 'CanvasRenderingContext2D', 'OffscreenCanvas'] as const
    const had = traps.map(k => [k, (globalThis as Record<string, unknown>)[k]] as const)
    for (const k of traps) {
      Object.defineProperty(globalThis, k, {
        configurable: true,
        get() { throw new Error(`extrudeOffsets touched ${k}`) },
      })
    }
    try {
      const out = extrudeOffsets(spec({ depth: 6, angle: 30, distance: 4, taper: 0.25 }))
      expect(out.length).toBe(6)
      expect(out[0]!.scale).toBe(0.75)
    } finally {
      for (const [k, v] of had) {
        Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v })
      }
    }
  })
})

describe('extrudeBudget — the frame ceiling, also plain data', () => {
  it('leaves an ordinary config completely alone', () => {
    // The default depth over a normal word is two orders of magnitude inside the
    // budget. A budget that nudged the common case would be a quality knob
    // pretending to be a safety net.
    expect(extrudeBudget([8], 6)).toEqual({ caps: [8], dropped: 0 })
    expect(extrudeBudget([32], 24)).toEqual({ caps: [32], dropped: 0 })
    expect(extrudeBudget([], 40)).toEqual({ caps: [], dropped: 0 })
    expect(extrudeBudget([8, 8, 8], 0)).toEqual({ caps: [8, 8, 8], dropped: 0 })
  })

  it('shortens the FRONT-most extrude first, and reports what it took', () => {
    // 3 layers × 32 copies × 40 glyphs = 3,840, well over the budget.
    const { caps, dropped } = extrudeBudget([32, 32, 32], 40, 1200)
    expect(caps.reduce((s, d) => s + d, 0) * 40).toBeLessThanOrEqual(1200)
    expect(dropped).toBe(3840 - caps.reduce((s, d) => s + d, 0) * 40)
    expect(dropped).toBeGreaterThan(0)
    // Back to front: the layer nearest the face gives its copies up first,
    // because the layers above it are the most likely to cover them anyway.
    expect(caps[0]).toBe(30)
    expect(caps[1]).toBe(0)
    expect(caps[2]).toBe(0)
  })

  it('caps a single runaway layer without touching its neighbours’ shape', () => {
    const { caps, dropped } = extrudeBudget([32], 100, 1200)
    expect(caps).toEqual([12])
    expect(dropped).toBe((32 - 12) * 100)
  })

  it('defaults to VT_EXTRUDE_FRAME_BUDGET', () => {
    const explicit = extrudeBudget([32, 32], 60, VT_EXTRUDE_FRAME_BUDGET)
    expect(extrudeBudget([32, 32], 60)).toEqual(explicit)
    expect(explicit.dropped).toBeGreaterThan(0)
  })
})

// ── half two: the canvas replay ─────────────────────────────────────────────

const FIXTURE = fileURLToPath(new URL('../fixtures/inter-subset-var.ttf', import.meta.url))

function loadFixtureFont(): VtFont {
  const bytes = new Uint8Array(readFileSync(FIXTURE))
  const raw: any = (fontkit as any).create(bytes)
  return {
    id: 'inter-subset',
    axes: normaliseAxes(raw?.variationAxes),
    unitsPerEm: Number(raw?.unitsPerEm) || 1000,
    raw,
  }
}
const font = loadFixtureFont()
const WORD = 'Sail'
const N = WORD.length
const BOX = { width: 400, height: 200 }

const RED = '#ff0000'
const BLUE = '#0000ff'
const GREEN = '#00ff00'
const grad = (a: string, b: string) => ({
  type: 'linear' as const, angle: 0, stops: [{ offset: 0, color: a }, { offset: 1, color: b }],
})

function cfg(patch: Partial<VectorTypeConfig> = {}): VectorTypeConfig {
  return mergeConfig({ ...DEFAULT_CONFIG, text: WORD, size: 100, ...patch })
}
function stack(...layers: Partial<VtAppearanceLayer>[]): VectorTypeConfig {
  return cfg({ appearance: layers.map((l, i) => vtLayer({ id: `L${i}`, ...l })) })
}

type Mat = [number, number, number, number, number, number]

class FakeMatrix {
  constructor(public a = 1, public b = 0, public c = 0, public d = 1, public e = 0, public f = 0) {}
  static from(m: Mat): FakeMatrix { return new FakeMatrix(...m) }
  get mat(): Mat { return [this.a, this.b, this.c, this.d, this.e, this.f] }
  multiply(o: FakeMatrix): FakeMatrix {
    return new FakeMatrix(
      this.a * o.a + this.c * o.b,
      this.b * o.a + this.d * o.b,
      this.a * o.c + this.c * o.d,
      this.b * o.c + this.d * o.d,
      this.a * o.e + this.c * o.f + this.e,
      this.b * o.e + this.d * o.f + this.f,
    )
  }
  translate(x: number, y: number): FakeMatrix { return this.multiply(new FakeMatrix(1, 0, 0, 1, x, y)) }
  scale(x: number, y = x): FakeMatrix { return this.multiply(new FakeMatrix(x, 0, 0, y, 0, 0)) }
  inverse(): FakeMatrix {
    const det = this.a * this.d - this.b * this.c
    if (!det) return new FakeMatrix(NaN, NaN, NaN, NaN, NaN, NaN)
    return new FakeMatrix(
      this.d / det, -this.b / det, -this.c / det, this.a / det,
      (this.c * this.f - this.d * this.e) / det,
      (this.b * this.e - this.a * this.f) / det,
    )
  }
}

class FakeGradient {
  stops: string[] = []
  constructor(public coords: number[]) {}
  addColorStop(_o: number, c: string) { this.stops.push(c) }
}

/** Records the matrix each `addPath` baked in — that is how "the copy moved the
 *  GEOMETRY" is read separately from "the paint space stayed put". */
class FakePath2D {
  applied: Mat[] = []
  addPath(_p: unknown, m?: FakeMatrix) { this.applied.push(m ? m.mat : [1, 0, 0, 1, 0, 0]) }
  moveTo() {}
  lineTo() {}
  quadraticCurveTo() {}
  bezierCurveTo() {}
  closePath() {}
}

interface Rec {
  op: 'fill' | 'stroke'
  style: unknown
  alpha: number
  gco: string
  /** The CTM the paint happened under — the PAINT SPACE for an anchored layer. */
  m: Mat
  /** The matrix the drawn path was built with, or null on the flat fast path. */
  pathM: Mat | null
  depth: number
}

class RecCtx {
  paints: Rec[] = []
  gradients: FakeGradient[] = []
  saves = 0
  restores = 0
  private stack: Array<{ alpha: number; gco: string; filter: string; m: Mat }> = []
  private m: Mat = [1, 0, 0, 1, 0, 0]
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  filter = 'none'
  fillStyle: unknown = ''
  strokeStyle: unknown = ''
  lineWidth = 0
  lineJoin = ''

  getTransform(): FakeMatrix { return FakeMatrix.from(this.m) }
  setTransform(...a: unknown[]) {
    if (a.length === 1 && a[0] instanceof FakeMatrix) this.m = (a[0] as FakeMatrix).mat
    else this.m = (a as number[]).slice(0, 6) as Mat
  }
  save() {
    this.saves++
    this.stack.push({ alpha: this.globalAlpha, gco: this.globalCompositeOperation, filter: this.filter, m: [...this.m] as Mat })
  }
  restore() {
    this.restores++
    const s = this.stack.pop()
    if (s) {
      this.globalAlpha = s.alpha; this.globalCompositeOperation = s.gco
      this.filter = s.filter; this.m = s.m
    }
  }
  translate(x: number, y: number) { this.m = FakeMatrix.from(this.m).translate(x, y).mat }
  rotate(r: number) { this.m = FakeMatrix.from(this.m).multiply(new FakeMatrix(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0)).mat }
  scale(x: number, y: number) { this.m = FakeMatrix.from(this.m).scale(x, y).mat }
  clearRect() {}
  fillRect() {}
  beginPath() {}
  rect() {}
  clip() {}
  createLinearGradient(...coords: number[]) {
    const g = new FakeGradient(coords)
    this.gradients.push(g)
    return g
  }
  createRadialGradient(...coords: number[]) { return this.createLinearGradient(...coords) }
  createPattern() { return null }
  private record(op: 'fill' | 'stroke', path?: unknown) {
    this.paints.push({
      op,
      style: op === 'fill' ? this.fillStyle : this.strokeStyle,
      alpha: this.globalAlpha,
      gco: this.globalCompositeOperation,
      m: [...this.m] as Mat,
      pathM: path instanceof FakePath2D ? (path.applied[0] ?? null) : null,
      depth: this.stack.length,
    })
  }
  fill(path?: unknown) { this.record('fill', path) }
  stroke(path?: unknown) { this.record('stroke', path) }
}

let hadPath2D: unknown
let hadDOMMatrix: unknown
beforeAll(() => {
  hadPath2D = (globalThis as any).Path2D
  hadDOMMatrix = (globalThis as any).DOMMatrix
  ;(globalThis as any).Path2D = FakePath2D
  ;(globalThis as any).DOMMatrix = FakeMatrix
})
afterAll(() => {
  ;(globalThis as any).Path2D = hadPath2D
  ;(globalThis as any).DOMMatrix = hadDOMMatrix
})
afterEach(() => { vi.restoreAllMocks() })

function draw(c: VectorTypeConfig, t = 0, opts: Record<string, unknown> = {}) {
  const ctx = new RecCtx()
  const frame = drawVectorType(ctx as unknown as CanvasRenderingContext2D, font, c, t, { ...BOX, ...opts })
  return { ctx, frame }
}

/**
 * The paints belonging to each glyph, in stack order, read out of the
 * LAYER-MAJOR stream: layer `l` contributes `per[l]` paints to every glyph (an
 * extrude contributes one per copy) and finishes the whole run before layer
 * `l+1` starts.
 *
 * That ordering is itself load-bearing for this feature — a glyph-major loop
 * draws letter 2's block shadow over letter 1's face — and it is asserted
 * directly in `covers the WHOLE RUN before the next layer starts` below.
 */
function perGlyph(ctx: RecCtx, per: number[], n = N): Rec[][] {
  const out: Rec[][] = Array.from({ length: n }, () => [] as Rec[])
  let k = 0
  for (const p of per) {
    for (let i = 0; i < n; i++) for (let j = 0; j < p; j++) out[i]!.push(ctx.paints[k++] as Rec)
  }
  expect(k).toBe(ctx.paints.length)
  return out
}

const scaleOf = (m: Mat) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]))

describe('the canvas draws the copies BENEATH the face, in the layer’s own slot', () => {
  it('replays the glyph path once per copy, in the extrude’s stack position', () => {
    const { ctx } = draw(stack(
      { kind: 'extrude', paint: BLUE, depth: 5, distance: 6, angle: 0 },
      { kind: 'fill', paint: RED },
    ))
    expect(ctx.paints.length).toBe(6 * N)
    for (const g of perGlyph(ctx, [5, 1])) {
      // Five copies, THEN the face. The face is a separate layer — that is what
      // makes "an extrude under a gradient fill" a stack expression rather than
      // a second paint model — and it must land last.
      expect(g.map(p => p.style)).toEqual([BLUE, BLUE, BLUE, BLUE, BLUE, RED])
      expect(g.every(p => p.op === 'fill')).toBe(true)
    }
    // Nothing escaped the glyph's own save span, and every copy's save is paired.
    expect(ctx.saves).toBe(ctx.restores)
  })

  it('covers the WHOLE RUN before the next layer starts — reach, not just cells', () => {
    // The defect this found live, and the reason the stack loop is now the OUTER
    // one. An extrude has REACH: its copies step `depth × distance` px straight
    // over the neighbouring letters. Glyph-major (`for glyph: for layer`) draws
    // letter 2's block shadow on top of letter 1's FACE, because letter 1's face
    // was already finished — measured in the browser at the stored default 135°:
    // 4,674 of the face's 11,092 px eaten. Layer-major is what an ordered
    // appearance stack means.
    const { ctx } = draw(stack(
      { kind: 'extrude', paint: BLUE, depth: 6, distance: 30, angle: 180 },
      { kind: 'fill', paint: RED },
    ))
    const lastCopy = ctx.paints.map(p => p.style).lastIndexOf(BLUE)
    const firstFace = ctx.paints.map(p => p.style).indexOf(RED)
    // EVERY copy of EVERY glyph precedes EVERY face. Under glyph-major this is
    // false from the second letter onwards.
    expect(lastCopy).toBeLessThan(firstFace)
    expect(ctx.paints.slice(0, 6 * N).every(p => p.style === BLUE)).toBe(true)
    expect(ctx.paints.slice(6 * N).every(p => p.style === RED)).toBe(true)
  })

  it('steps each copy by k × distance in OUTPUT pixels, back to front', () => {
    const { ctx } = draw(stack({ kind: 'extrude', paint: RED, depth: 3, distance: 10, angle: 0 }))
    const g0 = perGlyph(ctx, [3])[0]!
    // No motion, so the base CTM is identity and the copy's translate is read
    // straight off the matrix. Farthest first: 30, 20, 10.
    expect(g0.map(p => p.m[4])).toEqual([30, 20, 10])
    expect(g0.every(p => p.m[5] === 0)).toBe(true)
  })

  it('does NOT scale the offsets with `size` — output px, like a stroke width', () => {
    const at = (size: number) => {
      const c = cfg({
        size,
        appearance: [
          vtLayer({ id: 'Le', kind: 'extrude', paint: RED, depth: 2, distance: 12, angle: 90 }),
          vtLayer({ id: 'Lf', kind: 'fill', paint: BLUE }),
        ],
      })
      return perGlyph(draw(c).ctx, [2, 1]).map(g => g.slice(0, 2).map(p => [p.m[4], p.m[5]]))
    }
    const small = at(40)
    const big = at(400)
    expect(small).toEqual(big)
    // 90° is straight DOWN: dy positive, dx zero (cos 90° is float noise).
    expect(small[0]!.map(([, dy]) => dy)).toEqual([24, 12])
    for (const [dx] of small[0]!) expect(dx).toBeCloseTo(0, 10)
  })

  it('scales the offsets by pixelRatio, exactly as the geometry is scaled', () => {
    // A 220px node card and a 1024px bake must show the SAME composition, not a
    // differently-proportioned one — the same rule the blur radius follows.
    const { ctx } = draw(stack({ kind: 'extrude', paint: RED, depth: 2, distance: 10, angle: 0 }), 0, { pixelRatio: 2 })
    expect(perGlyph(ctx, [2])[0]!.map(p => p.m[4])).toEqual([40, 20])
  })

  it('applies `taper` as a real scale, about the glyph’s cell-centre baseline', () => {
    const { ctx, frame } = draw(stack({ kind: 'extrude', paint: RED, depth: 4, distance: 10, angle: 0, taper: 0.5 }))
    const g0 = perGlyph(ctx, [4])[0]!
    // The copies really are smaller, in the order the pure function promised.
    expect(g0.map(p => scaleOf(p.m))).toEqual([0.5, 0.625, 0.75, 0.875])
    // …and the pivot is CONSISTENT across the copies: solving each copy's
    // matrix for the pivot it scaled about gives one point, not four. A pivot
    // that drifted with the copy would bend the extrude instead of receding it.
    const pivots = g0.map((p, i) => {
      const s = scaleOf(p.m)
      const dx = 10 * (4 - i)
      return (p.m[4] - dx) / (1 - s)
    })
    for (const p of pivots) expect(p).toBeCloseTo(pivots[0]!, 6)
    // Vertically the pivot is the BASELINE, which every glyph shares — so the
    // vertical translate is identical for all four copies AND across glyphs.
    const perG = perGlyph(ctx, [4])
    const ys = perG.flatMap(g => g.map(p => p.m[5] / (1 - scaleOf(p.m))))
    for (const y of ys) expect(y).toBeCloseTo(ys[0]!, 6)
    // Horizontally it is NOT shared: each letter tapers about its own cell, and
    // about the cell's CENTRE rather than its left edge. Consecutive pivots are
    // therefore half of one advance plus half of the next apart — a left-edge
    // pivot would step by ONE whole advance, which is what this discriminates.
    const xs = perG.map(g => (g[0]!.m[4] - 40) / (1 - scaleOf(g[0]!.m)))
    expect(new Set(xs.map(x => x.toFixed(4))).size).toBe(N)
    const s = 100 / (frame.outlines.unitsPerEm || 1000)
    const adv = frame.outlines.glyphs.map(g => g.advance * s)
    for (let i = 1; i < N; i++) {
      expect(xs[i]! - xs[i - 1]!).toBeCloseTo((adv[i - 1]! + adv[i]!) / 2, 6)
    }
  })

  it('leaves the layers above it at the UN-copied transform', () => {
    // A copy transform that leaked would push the face off the letter — and the
    // picture would still look like an extrude, just a wrong one.
    const { ctx } = draw(stack(
      { kind: 'extrude', paint: BLUE, depth: 3, distance: 20, angle: 45, taper: 0.6 },
      { kind: 'fill', paint: RED },
      { kind: 'stroke', paint: GREEN, width: 4 },
    ))
    for (const g of perGlyph(ctx, [3, 1, 1])) {
      const face = g[3]!
      const outline = g[4]!
      expect(face.m).toEqual([1, 0, 0, 1, 0, 0])
      expect(outline.m).toEqual([1, 0, 0, 1, 0, 0])
    }
  })
})

describe('the copies carry the LAYER’s own paint', () => {
  it('gives every copy the layer’s gradient, resolved ONCE for the glyph', () => {
    const { ctx } = draw(stack(
      { kind: 'extrude', paint: grad(RED, BLUE), anchor: 'glyph', depth: 4, distance: 8, angle: 0 },
    ))
    expect(ctx.paints.length).toBe(4 * N)
    expect(ctx.paints.every(p => p.style instanceof FakeGradient)).toBe(true)
    // One gradient per GLYPH (the anchor is `glyph`), not one per copy: four
    // copies sharing one paint server is the difference between an extrude and
    // four independently painted letters.
    expect(ctx.gradients.length).toBe(N)
    for (const g of perGlyph(ctx, [4])) {
      expect(new Set(g.map(p => p.style)).size).toBe(1)
    }
  })

  it('composes the layer opacity and blend over every copy', () => {
    const { ctx } = draw(stack(
      { kind: 'extrude', paint: BLUE, depth: 3, distance: 5, opacity: 0.4, blend: 'multiply' },
      { kind: 'fill', paint: RED },
    ))
    for (const g of perGlyph(ctx, [3, 1])) {
      for (const copy of g.slice(0, 3)) {
        expect(copy.alpha).toBeCloseTo(0.4, 10)
        expect(copy.gco).toBe('multiply')
      }
      // …and it does not leak onto the face above it.
      expect(g[3]!.alpha).toBe(1)
      expect(g[3]!.gco).toBe('source-over')
    }
  })
})

describe('the anchor decision — a copy moves the GEOMETRY, never the paint space', () => {
  it('keeps ONE word-anchored ramp under the whole block, sampled per copy', () => {
    // The decision, made observable. With `anchor: 'word'` the extrude's paint is
    // pinned to the RUN, so each copy is a window onto the same ramp at its own
    // offset and the block reads as one body lit by one gradient. The opposite
    // choice — moving the paint space with the copy — would make every copy an
    // identical recolouring of the face, i.e. N stacked stickers.
    const { ctx } = draw(stack(
      { kind: 'extrude', paint: grad(RED, BLUE), anchor: 'word', depth: 4, distance: 25, angle: 0 },
      { kind: 'fill', paint: GREEN },
    ))
    const g0 = perGlyph(ctx, [4, 1])[0]!
    const copies = g0.slice(0, 4)

    // ONE paint server for the whole RUN, shared by every copy of every glyph.
    expect(ctx.gradients.length).toBe(1)
    expect(new Set(ctx.paints.slice(0, 4).map(p => p.style)).size).toBe(1)
    // The PAINT SPACE is identical across the copies — that is the claim.
    for (const c of copies) expect(c.m).toEqual(copies[0]!.m)
    // The GEOMETRY is not: each copy's path was baked with its own matrix, and
    // they differ by exactly the offsets `extrudeOffsets` produced.
    const dxs = copies.map(c => c.pathM![4])
    expect(dxs.map(d => d - dxs[3]!)).toEqual([75, 50, 25, 0])
  })

  it('does the same for a GLYPH-anchored paint — one rule, no special case', () => {
    const { ctx } = draw(stack(
      { kind: 'extrude', paint: grad(RED, BLUE), anchor: 'glyph', depth: 3, distance: 30, angle: 0 },
    ))
    for (const g of perGlyph(ctx, [3])) {
      for (const c of g) expect(c.m).toEqual(g[0]!.m)
      const dxs = g.map(c => c.pathM![4])
      expect(dxs.map(d => d - dxs[2]!)).toEqual([60, 30, 0])
    }
  })
})

describe('the frame budget — bounded out loud, never silently', () => {
  it('reports ZERO dropped copies for anything a user reaches normally', () => {
    const { frame } = draw(stack(
      { kind: 'extrude', paint: BLUE, depth: VT_EXTRUDE_DEPTH_MAX, distance: 3 },
      { kind: 'fill', paint: RED },
    ))
    expect(frame.extrudeDropped).toBe(0)
    // A four-letter word at full depth is 128 copies — two orders inside it.
    expect(VT_EXTRUDE_DEPTH_MAX * N).toBeLessThan(VT_EXTRUDE_FRAME_BUDGET)
  })

  it('shortens an over-budget stack AND says so, on the frame and in the log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const long = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' // 40 glyphs
    const c = cfg({
      text: long,
      appearance: [
        vtLayer({ id: 'Le1', kind: 'extrude', depth: 32, distance: 2 }),
        vtLayer({ id: 'Le2', kind: 'extrude', depth: 32, distance: 4 }),
        vtLayer({ id: 'Lf', kind: 'fill' }),
      ],
    })
    const { ctx, frame } = draw(c)
    const glyphs = frame.outlines.glyphs.length
    expect(glyphs).toBe(40)
    expect(frame.extrudeDropped).toBeGreaterThan(0)
    // Not a silent cap: the log names what was bounded.
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/extrude shortened: \d+ offset copies dropped/)
    // And the frame really did draw fewer: total paints = copies + one face each.
    const copies = ctx.paints.length - glyphs
    expect(copies).toBe(2 * 32 * glyphs - frame.extrudeDropped)
    expect(copies).toBeLessThanOrEqual(VT_EXTRUDE_FRAME_BUDGET)
  })
})
