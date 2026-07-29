/**
 * Vector Type — the EXTRUDED SILHOUETTE stroke.
 *
 * An extrude layer can carry its own outline: **one** contour around the whole
 * extruded body, the classic outlined-3D-lettering look. The thing that makes
 * this a real test rather than a `lineWidth` assignment is what it must NOT be —
 *
 *   > Stroking the copies individually draws an outline around *each* of them:
 *   > internal seam lines running straight through the block. That is not a
 *   > cheaper silhouette, it is a different, wrong picture.
 *
 * So four claims, ordered by how easy each would be to fake:
 *
 *  1. **The model round-trips.** `strokeColor` is on the LAYER, not inside its
 *     `paint` — `normalizePaint` rebuilds a paint field by declared field, so a
 *     colour smuggled in there works until you reopen the file. And `width`
 *     defaults per KIND: a fresh stroke layer must be visible immediately, a
 *     fresh extrude must not grow a keyline nobody asked for.
 *  2. **No body → no stroke.** A cold frame draws the un-unioned copies and
 *     strokes NOTHING — no error, no blocking, and in particular no fallback to
 *     per-copy outlines. The stroke appears when the body lands.
 *  3. **The SVG carries it as attributes on the body path** — the element is
 *     already there, so `lib/vector/svg.ts` needs no change, which §3 asserts
 *     against the spine directly rather than asserting it in prose.
 *  4. **It really is a silhouette**, measured against a deliberately PER-COPY
 *     control built from `extrudeCopyCommands` — the exact geometry a per-copy
 *     implementation would stroke. Three numbers separate them: how many closed
 *     contours the stroked ink has, how long it is, and — the decisive one —
 *     what fraction of it lies strictly INSIDE the body, which is what an
 *     internal seam is.
 *
 * Solid colours throughout §4, deliberately: the `resolvePaint` paint-box
 * clipping bug is live (a `Fill`-form gradient loses ~68 % of an extrude's ink at
 * the `glyph` anchor) and it is not this task's. A gradient in a measurement here
 * would be measuring that instead.
 *
 * NO NETWORK, NO DOM beyond a recording 2D context. paper.js runs headless where
 * a real union is needed.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as fontkit from 'fontkit'
import { beforeEach, describe, expect, it } from 'vitest'
import type { VectorCommand } from '~/lib/vector/svg'
import { shapesToSVG } from '~/lib/vector/svg'
import { normaliseAxes, type VtFont } from '~/lib/vectortype/font'
import {
  DEFAULT_CONFIG,
  LAYER_DEFAULTS,
  VT_DEFAULT_EXTRUDE_STROKE_WIDTH,
  VT_DEFAULT_STROKE_COLOR,
  VT_DEFAULT_STROKE_WIDTH,
  mergeConfig,
  vtDefaultWidth,
  vtLayer,
  type VectorTypeConfig,
  type VtAppearanceLayer,
} from '~/lib/vectortype/config'
import { visibleVtControls } from '~/lib/vectortype/controls'
import {
  clearSolidExtrudeCache,
  solidExtrudeCacheSize,
} from '~/lib/vectortype/extrudeBodyCache'
import { solidExtrudeBodyCached } from '~/lib/vectortype/extrudeSolid'
import { extrudeCopyCommands, vtSolidKey } from '~/lib/vectortype/extrude'
import {
  drawVectorType,
  vectorTypeFrame,
  vectorTypeSVG,
  vtPlacement,
  vtSolidExtrudeLayers,
} from '~/lib/vectortype/canvas'
import { glyphTransform as glyphPlacement, placeOutlines } from '~/lib/vectortype/render'

// ── fixtures ────────────────────────────────────────────────────────────────

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
const BLUE = '#0000ff'
const RED = '#ff0000'

function cfg(patch: Partial<VectorTypeConfig> = {}): VectorTypeConfig {
  return mergeConfig({ ...DEFAULT_CONFIG, text: WORD, size: 100, ...patch })
}
function stack(...layers: Partial<VtAppearanceLayer>[]): VectorTypeConfig {
  return cfg({ appearance: layers.map((l, i) => vtLayer({ id: `L${i}`, ...l })) })
}

/** The placed geometry of one config — the SAME three functions the renderer and
 *  the union both use, so a test that warms the cache warms the key the draw
 *  loop will look for. */
function inputsFor(c: VectorTypeConfig, layerIndex = 0) {
  const frame = vectorTypeFrame(font, c, 0)
  const place = vtPlacement(frame, BOX)
  const placed = placeOutlines(frame.outlines, place)
  const L = vtSolidExtrudeLayers(frame.config, frame.outlines.glyphs.length)[layerIndex]
  return {
    copies: L?.copies ?? [],
    commands: (i: number) => placed[i] as VectorCommand[],
    origin: (i: number) => glyphPlacement(frame.outlines.glyphs[i]!, place),
    advance: (i: number) => frame.outlines.glyphs[i]!.advance * place.scale,
  }
}

/** Unite every glyph of `c`'s solid extrude and leave the bodies in the cache —
 *  the state the surface's debounced watcher produces a moment after an edit. */
async function warm(c: VectorTypeConfig): Promise<VectorCommand[][]> {
  const { commands, copies, origin, advance } = inputsFor(c)
  const out: VectorCommand[][] = []
  for (let i = 0; i < N; i++) out.push(await solidExtrudeBodyCached(commands(i), copies, origin(i), advance(i)))
  return out
}

/** An identity `DOMMatrix` stand-in that CHAINS. The anchored paint path composes
 *  `pm.inverse().multiply(gm)` and asks `matScale` for the determinant, so a plain
 *  `{a,b,c,d,e,f}` literal is not enough — every op returns another matrix. */
class RecMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0
  inverse() { return new RecMatrix() }
  multiply() { return new RecMatrix() }
  translate() { return new RecMatrix() }
  scale() { return new RecMatrix() }
}

/** A recording 2D context that keeps FILLS AND STROKES APART, with the pen state
 *  each op was drawn under. Counting "paints" cannot tell a silhouette from a
 *  fill, which is the whole question here. */
class RecCtx {
  ops: Array<{ op: 'fill' | 'stroke'; cmds: any[]; style: any; lineWidth: number; lineJoin: string }> = []
  canvas = { width: 800, height: 400 }
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  filter = 'none'
  fillStyle: any = '#000'
  strokeStyle: any = '#000'
  lineWidth = 1
  lineJoin = 'miter'
  save() {}
  restore() {}
  beginPath() {}
  clip() {}
  rect() {}
  translate() {}
  rotate() {}
  scale() {}
  setTransform() {}
  getTransform() { return new RecMatrix() }
  clearRect() {}
  fillRect() {}
  createLinearGradient() { return { addColorStop() {} } }
  createRadialGradient() { return { addColorStop() {} } }
  createPattern() { return null }
  fill(p: any) { this.push('fill', p) }
  stroke(p: any) { this.push('stroke', p) }
  measureText() { return { width: 0 } }
  private push(op: 'fill' | 'stroke', p: any) {
    this.ops.push({
      op,
      cmds: p?.__cmds ?? [],
      style: op === 'fill' ? this.fillStyle : this.strokeStyle,
      lineWidth: this.lineWidth,
      lineJoin: this.lineJoin,
    })
  }
}

/** A `Path2D` stand-in that REMEMBERS what was replayed into it. */
class RecPath2D {
  __cmds: Array<{ command: string; args: number[] }> = []
  moveTo(...a: number[]) { this.__cmds.push({ command: 'moveTo', args: a }) }
  lineTo(...a: number[]) { this.__cmds.push({ command: 'lineTo', args: a }) }
  quadraticCurveTo(...a: number[]) { this.__cmds.push({ command: 'quadraticCurveTo', args: a }) }
  bezierCurveTo(...a: number[]) { this.__cmds.push({ command: 'bezierCurveTo', args: a }) }
  closePath() { this.__cmds.push({ command: 'closePath', args: [] }) }
  addPath(p: any) { if (p?.__cmds) this.__cmds.push(...p.__cmds) }
}
;(globalThis as any).Path2D = RecPath2D

function draw(c: VectorTypeConfig, opts: Record<string, unknown> = {}) {
  const ctx = new RecCtx()
  drawVectorType(ctx as unknown as CanvasRenderingContext2D, font, c, 0, { ...BOX, ...opts } as any)
  return ctx
}
const strokes = (ctx: RecCtx) => ctx.ops.filter(o => o.op === 'stroke')
const fills = (ctx: RecCtx) => ctx.ops.filter(o => o.op === 'fill')

// ── geometry, for the silhouette measurement ────────────────────────────────

type Pt = [number, number]

/** Flatten a command list into closed polylines, one per subpath. Curves are
 *  sampled at 16 segments, which is well under a pixel at this scale. */
function flatten(commands: readonly { command: string; args: number[] }[]): Pt[][] {
  const out: Pt[][] = []
  let cur: Pt[] = []
  let p: Pt = [0, 0]
  const push = (q: Pt) => { cur.push(q); p = q }
  const bez = (c1: Pt, c2: Pt, e: Pt) => {
    const a = p
    for (let i = 1; i <= 16; i++) {
      const t = i / 16, u = 1 - t
      push([
        u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * e[0],
        u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * e[1],
      ])
    }
  }
  for (const c of commands) {
    const a = c.args
    switch (c.command) {
      case 'moveTo':
        if (cur.length > 1) out.push(cur)
        cur = []
        push([a[0]!, a[1]!])
        break
      case 'lineTo': push([a[0]!, a[1]!]); break
      case 'quadraticCurveTo': {
        const s = p
        bez([s[0] + (2 / 3) * (a[0]! - s[0]), s[1] + (2 / 3) * (a[1]! - s[1])],
            [a[2]! + (2 / 3) * (a[0]! - a[2]!), a[3]! + (2 / 3) * (a[1]! - a[3]!)],
            [a[2]!, a[3]!])
        break
      }
      case 'bezierCurveTo': bez([a[0]!, a[1]!], [a[2]!, a[3]!], [a[4]!, a[5]!]); break
      case 'closePath': if (cur.length > 1) { cur.push(cur[0] as Pt); out.push(cur); cur = [] } break
    }
  }
  if (cur.length > 1) out.push(cur)
  return out
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1])

function polyLength(rings: Pt[][]): number {
  let n = 0
  for (const r of rings) for (let i = 1; i < r.length; i++) n += dist(r[i - 1] as Pt, r[i] as Pt)
  return n
}

/** Even-odd containment over every ring at once — the union's contours come out
 *  of paper as an outer boundary plus holes, and even-odd reads both without
 *  needing their winding. */
function inside(rings: Pt[][], q: Pt): boolean {
  let hit = false
  for (const r of rings) {
    for (let i = 1; i < r.length; i++) {
      const [x0, y0] = r[i - 1] as Pt
      const [x1, y1] = r[i] as Pt
      if ((y0 > q[1]) !== (y1 > q[1])) {
        const x = x0 + ((q[1] - y0) / (y1 - y0)) * (x1 - x0)
        if (x > q[0]) hit = !hit
      }
    }
  }
  return hit
}

/** Distance from `q` to the nearest edge of `rings`. */
function edgeDistance(rings: Pt[][], q: Pt): number {
  let best = Infinity
  for (const r of rings) {
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1] as Pt, b = r[i] as Pt
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const len2 = dx * dx + dy * dy
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / len2)) : 0
      best = Math.min(best, dist(q, [a[0] + t * dx, a[1] + t * dy]))
    }
  }
  return best
}

/** Sample a polyline set every ~1 unit. */
function sample(rings: Pt[][]): Pt[] {
  const out: Pt[] = []
  for (const r of rings) {
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1] as Pt, b = r[i] as Pt
      const n = Math.max(1, Math.ceil(dist(a, b)))
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
    }
  }
  return out
}

/**
 * THE MEASUREMENT. What fraction of this stroked ink is an INTERNAL SEAM?
 *
 * A seam is stroke that runs through the *interior* of the body rather than
 * around its edge, so: sampled at ~1 unit, inside the body, and further than
 * `TOL` from any of its contours. A true silhouette follows the body's boundary
 * exactly, so every one of its samples sits at distance ~0 and the fraction is
 * zero by construction. Per-copy outlines cross the block; theirs is not.
 */
const TOL = 2
function seamFraction(strokeRings: Pt[][], bodyRings: Pt[][]): number {
  const pts = sample(strokeRings)
  if (!pts.length) return 0
  let seam = 0
  for (const q of pts) if (inside(bodyRings, q) && edgeDistance(bodyRings, q) > TOL) seam++
  return seam / pts.length
}

// ════════════════════════════════════════════════════════════════════════════
// 1. The model — on the LAYER, defaulted per KIND, and a flat COLOUR
// ════════════════════════════════════════════════════════════════════════════

describe('the silhouette stroke is stored on the LAYER', () => {
  it('survives a merge round-trip on the layer', () => {
    const c = mergeConfig(stack({ kind: 'extrude', solid: true, width: 5, strokeColor: '#ff00aa' }))
    expect(c.appearance[0]!.strokeColor).toBe('#ff00aa')
    expect(c.appearance[0]!.width).toBe(5)
    // …and again, because "works until you reopen the file" is the trap.
    expect(mergeConfig(c).appearance[0]!.strokeColor).toBe('#ff00aa')
  })

  it('VANISHES when smuggled inside the paint — the trap, demonstrated', () => {
    // `normalizePaint` REBUILDS a paint field by declared field. A per-layer
    // property put inside one survives in memory and is dropped on the next
    // load; this is the negative control that says the field had to be a sibling.
    const c = mergeConfig({
      ...DEFAULT_CONFIG,
      appearance: [{ id: 'Lx', kind: 'extrude', solid: true, paint: { ...LAYER_DEFAULTS, type: 'solid', a: BLUE, strokeColor: '#ff00aa' } }],
    })
    expect((c.appearance[0]!.paint as any).strokeColor).toBeUndefined()
  })

  it('defaults the WIDTH per kind — a stroke layer is visible, an extrude is not outlined', () => {
    // Opposite defaults, deliberately. A stroke LAYER is a thing the user added
    // to the stack and must show up (the old zero default is what made users
    // conclude this studio had no stroke). An extrude's outline is one knob among
    // five and must be asked for.
    expect(vtDefaultWidth('stroke')).toBe(VT_DEFAULT_STROKE_WIDTH)
    expect(vtDefaultWidth('fill')).toBe(VT_DEFAULT_STROKE_WIDTH)
    expect(vtDefaultWidth('extrude')).toBe(VT_DEFAULT_EXTRUDE_STROKE_WIDTH)
    expect(VT_DEFAULT_EXTRUDE_STROKE_WIDTH).toBe(0)

    expect(vtLayer({ kind: 'stroke' }).width).toBe(VT_DEFAULT_STROKE_WIDTH)
    expect(vtLayer({ kind: 'extrude' }).width).toBe(0)
    // An EXPLICIT width is the caller's answer, including a zero one.
    expect(vtLayer({ kind: 'extrude', width: 4 }).width).toBe(4)
    expect(vtLayer({ kind: 'stroke', width: 0 }).width).toBe(0)
    // The same rule from storage, so a layer built in the UI and the same layer
    // round-tripped cannot end up with different outlines.
    expect(mergeConfig({ appearance: [{ kind: 'extrude' }] }).appearance[0]!.width).toBe(0)
    expect(mergeConfig({ appearance: [{ kind: 'stroke' }] }).appearance[0]!.width).toBe(VT_DEFAULT_STROKE_WIDTH)
  })

  it('is a flat COLOUR, not a Paint — rebuilt as a string or not at all', () => {
    // Deliberately narrow (see `VtAppearanceLayer.strokeColor`): widening it to
    // the nine-type fill model roughly doubles the extrude's control surface, and
    // the SVG spine cannot reference a paint server from a stroke anyway.
    const c = mergeConfig({ appearance: [{ kind: 'extrude', strokeColor: { type: 'gradient', a: RED, b: BLUE } }] })
    expect(c.appearance[0]!.strokeColor).toBe(VT_DEFAULT_STROKE_COLOR)
    expect(typeof c.appearance[0]!.strokeColor).toBe('string')
    expect(mergeConfig({ appearance: [{ kind: 'extrude', strokeColor: 42 }] }).appearance[0]!.strokeColor)
      .toBe(VT_DEFAULT_STROKE_COLOR)
  })

  it('offers the two controls only where they can paint', () => {
    // A width and a colour on an UNFUSED extrude would resolve, store, survive
    // the merge and change not one pixel — the dead control this schema exists to
    // prevent. There is no single contour to draw until the copies are united.
    const keysOf = (c: VectorTypeConfig) => visibleVtControls(c, 0).map(x => x.key)
    expect(keysOf(stack({ kind: 'fill' }))).not.toContain('layer.width')
    expect(keysOf(stack({ kind: 'fill' }))).not.toContain('layer.strokeColor')

    expect(keysOf(stack({ kind: 'stroke' }))).toContain('layer.width')
    // A stroke LAYER's colour is its `paint`; `strokeColor` is the extrude's.
    expect(keysOf(stack({ kind: 'stroke' }))).not.toContain('layer.strokeColor')

    expect(keysOf(stack({ kind: 'extrude', solid: false }))).not.toContain('layer.width')
    expect(keysOf(stack({ kind: 'extrude', solid: false }))).not.toContain('layer.strokeColor')

    expect(keysOf(stack({ kind: 'extrude', solid: true }))).toContain('layer.width')
    expect(keysOf(stack({ kind: 'extrude', solid: true }))).toContain('layer.strokeColor')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 2. The canvas — no body, no stroke; a body, exactly one
// ════════════════════════════════════════════════════════════════════════════

describe('the canvas strokes the CACHED body, and only that', () => {
  const DEPTH = 6
  const outlined = (over: Partial<VtAppearanceLayer> = {}) =>
    stack({ kind: 'extrude', depth: DEPTH, distance: 4, angle: 0, solid: true, paint: BLUE, width: 3, strokeColor: RED, ...over })

  beforeEach(() => clearSolidExtrudeCache())

  it('draws a COLD frame UNSTROKED — no body, no stroke, no error', () => {
    // The posture `resolveField` takes for a shader field that is still cooking:
    // return nothing and let the caller draw on. A cold extrude is `depth` copies
    // per glyph and NOT ONE stroke — the alternative, outlining each copy, is the
    // failure this feature is defined against.
    const ctx = draw(outlined())
    expect(fills(ctx)).toHaveLength(DEPTH * N)
    expect(strokes(ctx)).toHaveLength(0)
    // …and the cold frame united nothing.
    expect(solidExtrudeCacheSize()).toBe(0)
  })

  it('strokes ONE silhouette per glyph once the body lands', async () => {
    const c = outlined()
    const bodies = await warm(c)
    const ctx = draw(c)
    expect(fills(ctx)).toHaveLength(N)
    expect(strokes(ctx)).toHaveLength(N)
    for (let i = 0; i < N; i++) {
      const s = strokes(ctx)[i]!
      expect(s.style).toBe(RED)
      expect(s.lineWidth).toBe(3)
      // Miter spikes at every step between two copies; the canvas rounds them.
      expect(s.lineJoin).toBe('round')
      // It is the BODY's geometry, not the glyph's — same command count as the
      // union returned, which a glyph outline would not have.
      expect(s.cmds).toHaveLength(bodies[i]!.length)
    }
  })

  it('strokes the same body the fill filled — one path, two passes', async () => {
    const c = outlined()
    await warm(c)
    const ctx = draw(c)
    for (let i = 0; i < N; i++) {
      expect(strokes(ctx)[i]!.cmds).toEqual(fills(ctx)[i]!.cmds)
    }
  })

  it('draws NOTHING extra at width 0 or with a colour that does not paint', async () => {
    for (const over of [{ width: 0 }, { strokeColor: 'none' }, { strokeColor: '' }, { strokeColor: 'transparent' }]) {
      clearSolidExtrudeCache()
      const c = outlined(over)
      await warm(c)
      const ctx = draw(c)
      expect(fills(ctx), JSON.stringify(over)).toHaveLength(N)
      expect(strokes(ctx), JSON.stringify(over)).toHaveLength(0)
    }
  })

  it('leaves an UNFUSED extrude unstroked even with a warm body for the same geometry', async () => {
    // The switch is `solid`, not the presence of geometry — and this is the case
    // that would otherwise ship per-copy outlines by accident.
    const c = outlined()
    await warm(c)
    const loose = outlined({ solid: false })
    const ctx = draw(loose)
    expect(fills(ctx)).toHaveLength(DEPTH * N)
    expect(strokes(ctx)).toHaveLength(0)
  })

  it('strokes a body handed in by a BAKE too, without any cache at all', () => {
    const TRI: VectorCommand[] = [
      { command: 'moveTo', args: [10, 10] },
      { command: 'lineTo', args: [90, 10] },
      { command: 'lineTo', args: [90, 90] },
      { command: 'closePath', args: [] },
    ]
    const handed = new Map<string, VectorCommand[]>()
    for (let i = 0; i < N; i++) handed.set(vtSolidKey('L0', i), TRI)
    const ctx = draw(outlined(), { solid: handed })
    expect(fills(ctx)).toHaveLength(N)
    expect(strokes(ctx)).toHaveLength(N)
    for (const s of strokes(ctx)) expect(s.cmds).toHaveLength(TRI.length)
  })

  it('strokes a PARTIAL bake exactly where the bodies are', () => {
    const TRI: VectorCommand[] = [
      { command: 'moveTo', args: [10, 10] },
      { command: 'lineTo', args: [90, 10] },
      { command: 'closePath', args: [] },
    ]
    const handed = new Map<string, VectorCommand[]>([[vtSolidKey('L0', 1), TRI]])
    const ctx = draw(outlined(), { solid: handed })
    // Glyph 1 fused; the other three fell back to their copies — and the three
    // that fell back drew no outline at all.
    expect(fills(ctx)).toHaveLength(1 + DEPTH * (N - 1))
    expect(strokes(ctx)).toHaveLength(1)
  })

  it('does not disturb a STROKE layer, whose colour is still its own paint', async () => {
    const c = stack(
      { kind: 'extrude', depth: DEPTH, distance: 4, angle: 0, solid: true, paint: BLUE, width: 3, strokeColor: RED },
      { kind: 'stroke', width: 2, paint: '#00ff00' },
    )
    await warm(c)
    const ctx = draw(c)
    const st = strokes(ctx)
    expect(st).toHaveLength(N * 2)
    // Layer-major: every silhouette first, then every letterform outline.
    for (let i = 0; i < N; i++) expect(st[i]!.style).toBe(RED)
    for (let i = N; i < 2 * N; i++) { expect(st[i]!.style).toBe('#00ff00'); expect(st[i]!.lineWidth).toBe(2) }
  })

  it('strokes the body on the ANCHORED path too, where the paint is not a flat colour', async () => {
    // A word-anchored gradient extrude draws through the paint-space branch, which
    // builds its own `Path2D` per copy. The silhouette has to survive that branch
    // as well, or the outline would appear on solid extrudes only.
    const c = stack({
      kind: 'extrude', depth: DEPTH, distance: 4, angle: 0, solid: true, width: 3, strokeColor: RED,
      anchor: 'word',
      paint: { type: 'linear', stops: [{ offset: 0, color: RED }, { offset: 1, color: BLUE }] } as any,
    })
    await warm(c)
    const ctx = draw(c)
    expect(fills(ctx)).toHaveLength(N)
    expect(strokes(ctx)).toHaveLength(N)
    for (const s of strokes(ctx)) expect(s.style).toBe(RED)
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 3. The SVG — two attributes on the path that is already there
// ════════════════════════════════════════════════════════════════════════════

describe('the SVG carries the silhouette on the body path', () => {
  const DEPTH = 5
  const c = stack({ kind: 'extrude', depth: DEPTH, distance: 4, angle: 0, solid: true, paint: BLUE, width: 3, strokeColor: RED })
  const paths = (svg: string) => [...svg.matchAll(/<path\b[^>]*\/>/g)].map(m => m[0])
  const attr = (el: string, name: string) => el.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]

  async function bodies(): Promise<Map<string, VectorCommand[]>> {
    const list = await warm(c)
    const map = new Map<string, VectorCommand[]>()
    list.forEach((b, i) => map.set(vtSolidKey('L0', i), b))
    return map
  }

  beforeEach(() => clearSolidExtrudeCache())

  it('emits ONE stroked path per glyph with the bodies', async () => {
    const { svg } = vectorTypeSVG(font, c, 0, { ...BOX, solid: await bodies() })
    const els = paths(svg)
    expect(els).toHaveLength(N)
    for (const el of els) {
      expect(attr(el, 'stroke')).toBe(RED)
      expect(attr(el, 'stroke-width')).toBe('3')
      // The FILL is still the layer's paint — a silhouette is an outline ON the
      // body, not a replacement for it.
      expect(attr(el, 'fill')).toBe(BLUE)
      // A real fused contour, not a stub — `Sail`'s narrowest body (the `l`) is
      // still an eight-step staircase.
      expect((attr(el, 'd') ?? '').length).toBeGreaterThan(60)
    }
    // Matches `ctx.lineJoin = 'round'`; SVG's default is `miter`, which spikes at
    // every step between two copies.
    expect(svg).toContain('stroke-linejoin="round"')
  })

  it('emits the copies UNSTROKED with no bodies — the export of a cold state', async () => {
    const { svg } = vectorTypeSVG(font, c, 0, BOX)
    const els = paths(svg)
    expect(els).toHaveLength(DEPTH * N)
    for (const el of els) {
      expect(attr(el, 'stroke')).toBeUndefined()
      expect(attr(el, 'stroke-width')).toBeUndefined()
    }
    expect(svg).not.toContain('stroke-linejoin')
  })

  it('strokes only the glyphs a PARTIAL map has bodies for', async () => {
    const list = await warm(c)
    const partial = new Map<string, VectorCommand[]>([[vtSolidKey('L0', 2), list[2] as VectorCommand[]]])
    const { svg } = vectorTypeSVG(font, c, 0, { ...BOX, solid: partial })
    const els = paths(svg)
    expect(els).toHaveLength(1 + DEPTH * (N - 1))
    expect(els.filter(el => attr(el, 'stroke') === RED)).toHaveLength(1)
    // Not one copy of the three fallen-back glyphs carries a stroke. This is the
    // assertion a layer-wide `strokeWidth` would fail: it would outline all 15.
    expect(els.filter(el => attr(el, 'stroke-width') !== undefined)).toHaveLength(1)
  })

  it('omits the stroke at width 0, exactly as the canvas does', async () => {
    const flat = stack({ kind: 'extrude', depth: DEPTH, distance: 4, angle: 0, solid: true, paint: BLUE, width: 0, strokeColor: RED })
    const list = await warm(flat)
    const map = new Map<string, VectorCommand[]>()
    list.forEach((b, i) => map.set(vtSolidKey('L0', i), b))
    const { svg } = vectorTypeSVG(font, flat, 0, { ...BOX, solid: map })
    expect(paths(svg)).toHaveLength(N)
    for (const el of paths(svg)) expect(attr(el, 'stroke')).toBeUndefined()
  })

  it('needed NO change to the spine — it already writes a stroke beside a fill', () => {
    // `lib/vector/svg.ts` is studio-agnostic and untouched by this task. This is
    // the property that made that possible, asserted against the spine directly
    // rather than claimed in a report: one `<path>` can carry both.
    const svg = shapesToSVG([{
      commands: [{ command: 'moveTo', args: [0, 0] }, { command: 'lineTo', args: [10, 0] }, { command: 'closePath', args: [] }],
      fill: BLUE,
      stroke: RED,
      strokeWidth: 3,
    }], { width: 20, height: 20 })
    expect(svg).toContain(`fill="${BLUE}"`)
    expect(svg).toContain(`stroke="${RED}"`)
    expect(svg).toContain('stroke-width="3"')
  })
})

// ════════════════════════════════════════════════════════════════════════════
// 4. IT IS A SILHOUETTE — measured against a per-copy control
// ════════════════════════════════════════════════════════════════════════════

describe('the stroke is ONE outer contour, not N outlines', () => {
  const DEPTH = 8
  const c = stack({ kind: 'extrude', depth: DEPTH, distance: 5, angle: 135, solid: true, paint: BLUE, width: 3, strokeColor: RED })

  beforeEach(() => clearSolidExtrudeCache())

  /** The geometry a PER-COPY implementation would stroke: `extrudeCopyCommands`,
   *  which is the same list the union consumes and the SVG expands to. Not a
   *  strawman — it is literally the other implementation of this feature. */
  function perCopy(i: number): VectorCommand[] {
    const { commands, copies, origin, advance } = inputsFor(c)
    return extrudeCopyCommands(commands(i), copies, origin(i), advance(i)).flat()
  }

  it('has FEWER contours than the copies it fuses — the count, not the picture', async () => {
    const list = await warm(c)
    for (let i = 0; i < N; i++) {
      const body = flatten(list[i] as VectorCommand[])
      const copies = flatten(perCopy(i))
      // `Sail`'s letters have 1–2 contours each; eight copies have eight times
      // that. The union collapses the overlapping ones into one boundary.
      expect(copies.length, `glyph ${i}`).toBeGreaterThanOrEqual(DEPTH)
      expect(body.length, `glyph ${i}`).toBeLessThan(copies.length)
    }
  })

  it('is SHORTER than the per-copy outlines — less ink, by measurement', async () => {
    const list = await warm(c)
    let bodyLen = 0, copyLen = 0
    for (let i = 0; i < N; i++) {
      bodyLen += polyLength(flatten(list[i] as VectorCommand[]))
      copyLen += polyLength(flatten(perCopy(i)))
    }
    // The whole word, in output pixels of contour.
    expect(copyLen).toBeGreaterThan(bodyLen * 2)
  })

  it('runs NO seam through the block — the decisive number', async () => {
    // The failure signature is stroke *inside* the body. Sampled at ~1 px: a
    // silhouette follows the boundary, so nothing of it is more than TOL inside;
    // per-copy outlines cross the interior, and most of them are.
    const list = await warm(c)
    for (let i = 0; i < N; i++) {
      const body = flatten(list[i] as VectorCommand[])
      const silhouette = seamFraction(body, body)
      const control = seamFraction(flatten(perCopy(i)), body)
      expect(silhouette, `glyph ${i} silhouette`).toBe(0)
      // Eight copies stepped 5 px apart across a ~70 px letter: most of every
      // copy but the two extreme ones is interior.
      expect(control, `glyph ${i} per-copy`).toBeGreaterThan(0.4)
    }
  })

  it('is what the renderer actually strokes — the measurement is on the real op', async () => {
    // The three numbers above are computed from the union's output; this closes
    // the loop by measuring the geometry that reached `ctx.stroke`, so a renderer
    // that stroked something else would not be covered by them.
    const list = await warm(c)
    const ctx = draw(c)
    expect(strokes(ctx)).toHaveLength(N)
    for (let i = 0; i < N; i++) {
      const body = flatten(list[i] as VectorCommand[])
      expect(seamFraction(flatten(strokes(ctx)[i]!.cmds), body), `glyph ${i}`).toBe(0)
    }
  })
})
