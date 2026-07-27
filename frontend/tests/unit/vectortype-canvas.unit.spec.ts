/**
 * Vector Type — the shared canvas render path (`~/lib/vectortype/canvas`).
 *
 * Everything drawn anywhere in the product — the editor preview, the node card,
 * the cascade bake and the studio frame source — goes through `vectorTypeFrame`
 * + `vtPlacement`. Those two are pure (no canvas, no DOM), so the semantics the
 * schema PROMISED but nothing implemented until now — `size` as em-in-output-px,
 * `tracking` in 1/1000 em applied after shaping, `align`, and the per-glyph
 * stagger wave — can be pinned exactly here rather than eyeballed in a browser.
 *
 * NO NETWORK: the same eight-character Inter variable subset the outline spec
 * uses (opsz + wght, 2048 upem).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as fontkit from 'fontkit'
import { describe, expect, it } from 'vitest'
import { normaliseAxes, type VtFont } from '~/lib/vectortype/font'
import { DEFAULT_CONFIG, mergeConfig, type VectorTypeConfig } from '~/lib/vectortype/config'
import { vectorTypeFrame, vectorTypeSVG, vtExportName, vtIsAnimated, vtPlacement } from '~/lib/vectortype/canvas'
import { placeOutlines } from '~/lib/vectortype/render'
import { commandsToPathData } from '~/lib/vector/svg'

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

/** The fixture only carries " Sailorg", so every test word comes from that set. */
const WORD = 'Sailor'

function cfg(patch: Partial<VectorTypeConfig> = {}): VectorTypeConfig {
  return mergeConfig({ ...DEFAULT_CONFIG, text: WORD, ...patch })
}

function wghtTrack(from = 100, to = 900) {
  return { path: 'axes.wght', from, to, easing: 'linear' as const, loops: 1, hold: 0, cycleOffset: 0, delay: 0 }
}

describe('vectorTypeFrame — the shared render path', () => {
  it('lays out one glyph per shaped glyph, with the run width in font units', () => {
    const f = vectorTypeFrame(font, cfg(), 0)
    expect(f.outlines.glyphs.length).toBe(WORD.length)
    expect(f.outlines.unitsPerEm).toBe(2048)
    expect(f.outlines.width).toBeGreaterThan(0)
    expect(f.staggered).toBe(false)
    expect(f.shapings).toBe(1)
  })

  it('applies tracking as extra advance per glyph in 1/1000 em, AFTER shaping', () => {
    const plain = vectorTypeFrame(font, cfg({ tracking: 0 }), 0)
    const tracked = vectorTypeFrame(font, cfg({ tracking: 100 }), 0)
    // 100/1000 em × 2048 upem = 204.8 font units per gap, and there are n-1 gaps
    // (never after the last glyph — see the note in canvas.ts).
    const gaps = WORD.length - 1
    expect(tracked.outlines.width - plain.outlines.width).toBeCloseTo(204.8 * gaps, 6)
    // Shaping is untouched: same glyphs, same command counts, only the pen moved.
    expect(tracked.outlines.glyphs.map(g => g.glyphId)).toEqual(plain.outlines.glyphs.map(g => g.glyphId))
    expect(tracked.outlines.glyphs[0]!.x).toBe(plain.outlines.glyphs[0]!.x)
    expect(tracked.outlines.glyphs[1]!.x - plain.outlines.glyphs[1]!.x).toBeCloseTo(204.8, 6)
  })

  it('negative tracking tightens rather than throwing', () => {
    const tight = vectorTypeFrame(font, cfg({ tracking: -50 }), 0)
    const plain = vectorTypeFrame(font, cfg({ tracking: 0 }), 0)
    expect(tight.outlines.width).toBeLessThan(plain.outlines.width)
  })

  it('an axis track moves the OUTLINE — geometry, not a bitmap', () => {
    const c = cfg({ motion: { ...DEFAULT_CONFIG.motion, tracks: [wghtTrack()], duration: 4 } })
    const light = vectorTypeFrame(font, c, 0)
    const heavy = vectorTypeFrame(font, c, 4)
    expect(light.config.axes.wght).toBeCloseTo(100, 6)
    expect(heavy.config.axes.wght).toBeCloseTo(900, 6)
    // Same topology (gvar moves points, never adds them) but different coordinates.
    const cmds = (f: typeof light) => f.outlines.glyphs.flatMap(g => g.commands.map(x => x.command))
    expect(cmds(heavy)).toEqual(cmds(light))
    const coords = (f: typeof light) => f.outlines.glyphs.flatMap(g => g.commands.flatMap(x => x.args))
    expect(coords(heavy)).not.toEqual(coords(light))
  })

  it('does not mutate the config it was handed', () => {
    const c = cfg({ motion: { ...DEFAULT_CONFIG.motion, tracks: [wghtTrack()], duration: 4 } })
    const before = structuredClone(c)
    vectorTypeFrame(font, c, 1.7)
    expect(c).toEqual(before)
  })
})

describe('the travelling wave, as PIXELS would see it', () => {
  const staggered = () => cfg({
    motion: {
      ...DEFAULT_CONFIG.motion,
      tracks: [wghtTrack()],
      duration: 4,
      stagger: { delay: 0.4, order: 'forward', seed: 0 },
    },
  })

  it('shapes each glyph at its OWN axis position — the whole point of the studio', () => {
    const f = vectorTypeFrame(font, staggered(), 2)
    expect(f.staggered).toBe(true)
    // Six glyphs at six distinct clock times ⇒ six distinct axis positions, not
    // one instance reused. (Six, not seven: `forward` puts glyph 0 on the shared
    // clock, so it hits the base shaping already in the memo.)
    expect(f.shapings).toBe(WORD.length)
  })

  it('gives the glyphs DIFFERENT geometry at one instant (not the same word re-drawn)', () => {
    const wave = vectorTypeFrame(font, staggered(), 2)
    const flat = vectorTypeFrame(font, cfg({ motion: { ...DEFAULT_CONFIG.motion, tracks: [wghtTrack()], duration: 4 } }), 2)
    // The un-staggered run puts every glyph at ONE weight; the staggered one must
    // not produce the same advances, or the wave never happened.
    const adv = (f: typeof wave) => f.outlines.glyphs.map(g => Math.round(g.advance))
    expect(adv(wave)).not.toEqual(adv(flat))
    // And the wave's own advances must not be uniform across identical letters.
    expect(new Set(adv(wave)).size).toBeGreaterThan(1)
  })

  it('collapses to ONE shaping when the delay is zero', () => {
    const c = staggered()
    c.motion.stagger.delay = 0
    const f = vectorTypeFrame(font, c, 2)
    expect(f.staggered).toBe(false)
    expect(f.shapings).toBe(1)
  })

  it('is deterministic — a repeat pass at the same time is byte-identical', () => {
    const c = staggered()
    c.motion.stagger.order = 'random'
    c.motion.stagger.seed = 7
    const a = vectorTypeFrame(font, c, 1.3)
    const b = vectorTypeFrame(font, c, 1.3)
    expect(b.outlines.glyphs.flatMap(g => g.commands.flatMap(x => x.args)))
      .toEqual(a.outlines.glyphs.flatMap(g => g.commands.flatMap(x => x.args)))
  })

  it('memoises identical axis positions — `edges` order pairs up and costs less', () => {
    const c = staggered()
    c.motion.stagger.order = 'edges'
    const f = vectorTypeFrame(font, c, 2)
    expect(f.staggered).toBe(true)
    // 6 glyphs, ranks 0 2 4 4 2 0 → 3 distinct positions, not 6.
    expect(f.shapings).toBeLessThan(WORD.length + 1)
  })

  it('a per-glyph `glyph.*` track gives each glyph a different transform', () => {
    const c = cfg({
      motion: {
        ...DEFAULT_CONFIG.motion,
        tracks: [{ path: 'glyph.opacity', from: 0, to: 1, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 }],
        duration: 4,
        stagger: { delay: 0.5, order: 'forward', seed: 0 },
      },
    })
    const f = vectorTypeFrame(font, c, 2)
    const opacities = f.transforms.map(t => t.opacity)
    expect(new Set(opacities.map(o => o.toFixed(4))).size).toBeGreaterThan(1)
    // …while the config's own axes are untouched — `glyph.*` is not a config leaf.
    expect((f.config as any).glyph).toBeUndefined()
  })
})

describe('vtPlacement — size, align, and the y-flip', () => {
  const box = { width: 1000, height: 400 }

  it('size is the EM size in output pixels (CSS font-size semantics)', () => {
    const p = vtPlacement(vectorTypeFrame(font, cfg({ size: 204.8 }), 0), box)
    // 204.8px em over a 2048 upem font ⇒ exactly 0.1 output px per font unit.
    expect(p.scale).toBeCloseTo(0.1, 10)
    expect(p.flipY).toBe(true)
  })

  it('centres, left-anchors and right-anchors the INK', () => {
    const frame = vectorTypeFrame(font, cfg({ size: 120 }), 0)
    const b = frame.outlines.bbox
    const scale = 120 / 2048
    const inkW = (b.maxX - b.minX) * scale

    const left = vtPlacement(vectorTypeFrame(font, cfg({ size: 120, align: 'left' }), 0), box)
    const centre = vtPlacement(vectorTypeFrame(font, cfg({ size: 120, align: 'center' }), 0), box)
    const right = vtPlacement(vectorTypeFrame(font, cfg({ size: 120, align: 'right' }), 0), box)

    // The ink's LEFT edge in output space is `x + minX*scale`.
    expect(left.x + b.minX * scale).toBeCloseTo(0, 6)
    expect(centre.x + b.minX * scale).toBeCloseTo((box.width - inkW) / 2, 6)
    expect(right.x + b.minX * scale).toBeCloseTo(box.width - inkW, 6)
  })

  it('honours padding on every side', () => {
    const frame = vectorTypeFrame(font, cfg({ size: 120, align: 'left' }), 0)
    const p = vtPlacement(frame, { ...box, padding: 40 })
    expect(p.x + frame.outlines.bbox.minX * (120 / 2048)).toBeCloseTo(40, 6)
  })

  it('does not divide by zero on empty text', () => {
    const frame = vectorTypeFrame(font, cfg({ text: '' }), 0)
    expect(frame.outlines.glyphs).toHaveLength(0)
    const p = vtPlacement(frame, box)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
  })
})

describe('vtIsAnimated', () => {
  it('is true only when there are tracks — stagger alone animates nothing', () => {
    expect(vtIsAnimated(cfg())).toBe(false)
    expect(vtIsAnimated(cfg({ motion: { ...DEFAULT_CONFIG.motion, stagger: { delay: 0.5, order: 'forward', seed: 0 } } }))).toBe(false)
    expect(vtIsAnimated(cfg({ motion: { ...DEFAULT_CONFIG.motion, tracks: [wghtTrack()] } }))).toBe(true)
  })

  it('survives a config straight out of storage', () => {
    expect(vtIsAnimated(undefined)).toBe(false)
    expect(vtIsAnimated({} as any)).toBe(false)
    expect(vtIsAnimated({ motion: 'later' } as any)).toBe(false)
  })
})

// ── The vector output ───────────────────────────────────────────────────────
//
// Sailor's first non-pixel deliverable, so these tests are about the FILE, not
// about "it rendered". The three things that can be silently wrong in an SVG
// export — an upside-down y, a raster payload hiding inside, and a per-glyph
// motion transform that never made it out — each get a test that would fail for
// the right reason.

function paths(svg: string): string[] {
  return svg.match(/<path\b[^>]*\/>/g) ?? []
}
function attrOf(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1]
}
function dOf(tag: string): string {
  return attrOf(tag, 'd') ?? ''
}
/** Every (x, y) pair a path `d` mentions, in document space. */
function pointsOf(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const m of d.matchAll(/[MLQC]([-\d.\s]+)/g)) {
    const nums = (m[1] as string).trim().split(/\s+/).map(Number).filter(Number.isFinite)
    for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i] as number, nums[i + 1] as number])
  }
  return out
}
const yMax = (d: string) => Math.max(...pointsOf(d).map(p => p[1]))
const yMin = (d: string) => Math.min(...pointsOf(d).map(p => p[1]))

const BOX = { width: 1280, height: 720 }

describe('vectorTypeSVG — editable outlines, not a raster embed', () => {
  it('writes one <path> per glyph, with real curve commands', () => {
    const { svg, frame } = vectorTypeSVG(font, cfg({ text: 'Sailor' }), 0, BOX)
    const p = paths(svg)
    expect(p).toHaveLength(6)
    expect(frame.outlines.glyphs).toHaveLength(6)
    for (const tag of p) {
      const d = dOf(tag)
      expect(d.startsWith('M')).toBe(true)
      expect(d).toContain('Z')
      // Plausible command count: a Latin glyph is a handful to a few dozen
      // commands — not 2 (a box) and not thousands (a traced bitmap). `l` is a
      // legitimate 5 (four corners and a close), which is why the floor is low.
      const n = (d.match(/[MLQCZ]/g) ?? []).length
      expect(n).toBeGreaterThanOrEqual(5)
      expect(n).toBeLessThan(400)
    }
    // Letterforms are CURVES. `S`, `a`, `o` and `r` cannot be drawn with lines,
    // so their absence would mean something flattened the outline on the way out.
    const curvy = p.map(dOf).filter(d => /[QC]/.test(d))
    expect(curvy.length).toBeGreaterThanOrEqual(4)
    // Task 4 pinned Inter's `g` at 46 commands; the run as a whole should be of
    // that order, not an order of magnitude off.
    const total = p.reduce((s, t) => s + (dOf(t).match(/[MLQCZ]/g) ?? []).length, 0)
    expect(total).toBeGreaterThan(60)
    expect(total).toBeLessThan(600)
  })

  it('contains NO raster payload anywhere', () => {
    const { svg } = vectorTypeSVG(font, cfg(), 0, { ...BOX, background: '#0b0d12' })
    expect(svg).not.toContain('<image')
    expect(svg).not.toContain('data:image')
    expect(svg).not.toContain('base64')
    expect(svg).not.toContain('xlink:href')
    // The only <rect> permitted is the background, and it must not be the ink.
    expect((svg.match(/<rect/g) ?? []).length).toBe(1)
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
  })

  it('frames the OUTPUT BOX, so the SVG and the PNG are interchangeable', () => {
    const { svg } = vectorTypeSVG(font, cfg(), 0, BOX)
    expect(svg).toContain('viewBox="0 0 1280 720"')
    expect(svg).toContain('width="1280"')
    expect(svg).toContain('height="720"')
  })

  it('is RIGHT SIDE UP — the descender hangs below the baseline', () => {
    // Font space is y-up, SVG is y-down. This asserts the flip by MEANING rather
    // than by restating the formula: `g` has a descender and `S` does not, so in
    // a correct export `g`'s lowest ink is below `S`'s, and its topmost ink is
    // not. Flip the sign anywhere in the chain and both comparisons invert.
    const { svg } = vectorTypeSVG(font, cfg({ text: 'Sg' }), 0, BOX)
    const [S, g] = paths(svg).map(dOf) as [string, string]
    expect(yMax(g)).toBeGreaterThan(yMax(S))
    expect(yMin(g)).toBeGreaterThan(yMin(S))
  })

  it('places the ink inside the box, matching vtPlacement', () => {
    const c = cfg({ text: 'Sailor', size: 200 })
    const { svg, frame } = vectorTypeSVG(font, c, 0, BOX)
    const place = vtPlacement(frame, BOX)
    const all = paths(svg).flatMap(t => pointsOf(dOf(t)))
    const ys = all.map(p => p[1])
    const b = frame.outlines.bbox
    // The source bbox's MAX y is the output's TOP edge (the flip), and both ends
    // land where the shared placement says they do.
    expect(Math.min(...ys)).toBeCloseTo(place.y - b.maxY * place.scale, 2)
    expect(Math.max(...ys)).toBeCloseTo(place.y - b.minY * place.scale, 2)
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...ys)).toBeLessThanOrEqual(BOX.height)
  })

  it('describes the SAME geometry the canvas replays', () => {
    // Not a second implementation: the `d` must be the placed command list the
    // Path2D path is built from, character for character.
    const c = cfg({ text: 'Sailor', size: 180, tracking: 40, align: 'right' })
    const { svg, frame } = vectorTypeSVG(font, c, 0, BOX)
    const place = vtPlacement(frame, BOX)
    const expected = placeOutlines(frame.outlines, place).map(cmds => commandsToPathData(cmds, 3))
    expect(paths(svg).map(dOf)).toEqual(expected)
  })

  it('exports the frame at time `t`, not the base config', () => {
    const c = cfg({ motion: { ...DEFAULT_CONFIG.motion, tracks: [wghtTrack()], duration: 4 } })
    const a = vectorTypeSVG(font, c, 0, BOX)
    const b = vectorTypeSVG(font, c, 4, BOX)
    expect(a.frame.config.axes.wght).toBeCloseTo(100, 6)
    expect(b.frame.config.axes.wght).toBeCloseTo(900, 6)
    expect(b.svg).not.toEqual(a.svg)
    // Same topology, different coordinates — the axis moved the outline.
    const shape = (s: string) => paths(s).map(t => (dOf(t).match(/[MLQCZ]/g) ?? []).join(''))
    expect(shape(b.svg)).toEqual(shape(a.svg))
  })

  it('carries the STROKE as attributes, never baked into the geometry', () => {
    const plain = vectorTypeSVG(font, cfg({ strokeWidth: 0 }), 0, BOX)
    const outlined = vectorTypeSVG(font, cfg({ strokeWidth: 6, stroke: '#ff0055' }), 0, BOX)
    // Identical `d` — a stroke that had been outlined into geometry would double
    // the contour count and change every coordinate.
    expect(paths(outlined.svg).map(dOf)).toEqual(paths(plain.svg).map(dOf))
    expect(outlined.svg).toContain('stroke="#ff0055"')
    expect(outlined.svg).toContain('stroke-width="6"')
    // Matches ctx.lineJoin = 'round'; SVG's default miter spikes at sharp joins.
    expect(outlined.svg).toContain('stroke-linejoin="round"')
    expect(plain.svg).not.toContain('stroke=')
    expect(plain.svg).not.toContain('stroke-width=')
  })

  it('carries the per-glyph STAGGER transform, so a wave does not export flat', () => {
    const c = cfg({
      text: 'Sailor',
      motion: {
        ...DEFAULT_CONFIG.motion,
        duration: 4,
        stagger: { delay: 0.4, order: 'forward', seed: 0 },
        tracks: [
          { path: 'glyph.dy', from: -120, to: 0, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 },
          { path: 'glyph.opacity', from: 0, to: 1, easing: 'linear', loops: 1, hold: 0, cycleOffset: 0, delay: 0 },
        ],
      },
    })
    const { svg, frame } = vectorTypeSVG(font, c, 2, BOX)
    expect(frame.staggered).toBe(true)
    const tags = paths(svg)
    const transforms = tags.map(t => attrOf(t, 'transform'))
    // Every glyph moved, and each by its OWN amount — one shared transform would
    // mean the stagger was flattened on the way out.
    expect(transforms.every(t => typeof t === 'string' && t.startsWith('translate('))).toBe(true)
    expect(new Set(transforms).size).toBe(tags.length)
    const opacities = tags.map(t => attrOf(t, 'opacity'))
    expect(new Set(opacities).size).toBeGreaterThan(1)
  })

  it('writes no transform and no opacity when nothing animates', () => {
    const { svg } = vectorTypeSVG(font, cfg(), 0, BOX)
    expect(svg).not.toContain('transform=')
    expect(svg).not.toContain('opacity=')
  })

  it('paints the background only when there is one', () => {
    expect(vectorTypeSVG(font, cfg(), 0, { ...BOX, background: '#0b0d12' }).svg).toContain('<rect')
    expect(vectorTypeSVG(font, cfg(), 0, { ...BOX, background: null }).svg).not.toContain('<rect')
  })

  it('survives empty text rather than emitting a broken document', () => {
    const { svg, frame } = vectorTypeSVG(font, cfg({ text: '' }), 0, BOX)
    expect(frame.outlines.glyphs).toHaveLength(0)
    expect(paths(svg)).toHaveLength(0)
    expect(svg).toContain('viewBox="0 0 1280 720"')
  })
})

describe('vtExportName', () => {
  it('derives a filesystem-safe stem from the text', () => {
    expect(vtExportName(cfg({ text: 'Sailor Wave' }))).toBe('sailor-wave')
    expect(vtExportName(cfg({ text: '  ¡Hola!  ' }))).toBe('hola')
  })

  it('never returns an empty stem', () => {
    expect(vtExportName(cfg({ text: '' }))).toBe('vector-type')
    expect(vtExportName(cfg({ text: '///' }))).toBe('vector-type')
    expect(vtExportName(undefined)).toBe('vector-type')
  })
})
