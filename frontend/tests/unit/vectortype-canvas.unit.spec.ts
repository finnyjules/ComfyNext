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
import { vectorTypeFrame, vtIsAnimated, vtPlacement } from '~/lib/vectortype/canvas'

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
